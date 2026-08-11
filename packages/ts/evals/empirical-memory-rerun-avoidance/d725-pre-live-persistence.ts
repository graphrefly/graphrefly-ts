import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import { isD725InjectedNoNetworkQualificationBundle } from "./d725-injected-no-network-qualification.js";
import {
	D725_GENERATION_REF,
	type D725PreLiveBundleV1,
	validateD725PreLiveBundle,
} from "./d725-terminal-http-real-provider.js";

export const D725_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d725.terminal-http-real-provider-persistence.v1" as const;

export interface D725PersistenceReceiptV1 {
	readonly schemaVersion: typeof D725_PERSISTENCE_SCHEMA;
	readonly generationRef: typeof D725_GENERATION_REF;
	readonly terminalHttpGraphEvidenceArtifactDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly generationArtifactDigest: string;
	readonly bundleArtifactDigest: string;
	readonly bundleDigest: string;
	readonly persistenceDigest: string;
}

export interface D725PersistenceFaultV1 {
	readonly revision: "graphrefly.b112.d725.persistence-fault.v1";
}

interface FileIdentity {
	readonly dev: number;
	readonly ino: number;
}

const faultStates = new WeakMap<
	object,
	{ readonly stage: "after-claim" | "after-artifacts-rename"; consumed: boolean }
>();

export function createD725PersistenceFault(
	stage: "after-claim" | "after-artifacts-rename",
): D725PersistenceFaultV1 {
	const capability = Object.freeze({
		revision: "graphrefly.b112.d725.persistence-fault.v1" as const,
	});
	faultStates.set(capability, { stage, consumed: false });
	return capability;
}

async function canonicalPrivateRoot(
	value: unknown,
): Promise<{ readonly path: string; readonly identity: FileIdentity }> {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError("D725 privateRoot is invalid");
	const absolute = resolve(value);
	if (absolute !== value) throw new TypeError("D725 privateRoot must be absolute and canonical");
	const stat = await lstat(absolute);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700)
		throw new TypeError("D725 privateRoot must be a real 0700 directory");
	if ((await realpath(absolute)) !== absolute)
		throw new TypeError("D725 privateRoot realpath drifted");
	return Object.freeze({ path: absolute, identity: { dev: stat.dev, ino: stat.ino } });
}

async function assertDirectoryIdentity(
	path: string,
	identity: FileIdentity,
	mode: number,
): Promise<void> {
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== mode ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D725 directory identity drifted");
}

async function writeCanonical(path: string, bytes: Uint8Array): Promise<FileIdentity> {
	const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D725 canonical artifact is not an owned 0600 file");
		await handle.writeFile(bytes);
		await handle.sync();
		return { dev: stat.dev, ino: stat.ino };
	} finally {
		await handle.close();
	}
}

async function assertFile(
	path: string,
	identity: FileIdentity,
	expected: Uint8Array,
): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		const actual = await handle.readFile();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(actual, expected)
		)
			throw new TypeError("D725 artifact identity or bytes drifted");
	} finally {
		await handle.close();
	}
}

export async function persistD725PreLiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D725PreLiveBundleV1;
	readonly fault?: D725PersistenceFaultV1;
}): Promise<D725PersistenceReceiptV1> {
	const input = record(inputValue, "d725.persist");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d725.persist",
	);
	if (!isD725InjectedNoNetworkQualificationBundle(input.bundle))
		throw new TypeError("D725 persistence requires the exact same-process injected qualification");
	const bundle = validateD725PreLiveBundle(input.bundle);
	let faultStage: "after-claim" | "after-artifacts-rename" | null = null;
	if (Object.hasOwn(input, "fault")) {
		const state =
			typeof input.fault === "object" && input.fault !== null
				? faultStates.get(input.fault)
				: undefined;
		if (state === undefined || state.consumed)
			throw new TypeError("D725 persistence fault is invalid or consumed");
		state.consumed = true;
		faultStage = state.stage;
	}
	const validatedRoot = await canonicalPrivateRoot(input.privateRoot);
	const privateRoot = validatedRoot.path;
	const finalRoot = join(privateRoot, D725_GENERATION_REF);
	const parentHandle = await open(privateRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
	let parentIdentity: FileIdentity | null = null;
	let claimCreated = false;
	let finalIdentity: FileIdentity | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsIdentity: FileIdentity | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let terminalBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let qualificationBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let generationBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let bundleBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let operationError: unknown = null;
	try {
		const parentStat = await parentHandle.stat();
		parentIdentity = { dev: parentStat.dev, ino: parentStat.ino };
		if (
			parentIdentity.dev !== validatedRoot.identity.dev ||
			parentIdentity.ino !== validatedRoot.identity.ino
		)
			throw new TypeError("D725 privateRoot changed before stable-handle acquisition");
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		try {
			await mkdir(finalRoot, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST")
				throw new TypeError("D725 generation already exists");
			throw error;
		}
		claimCreated = true;
		finalHandle = await open(finalRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		const finalStat = await finalHandle.stat();
		if (!finalStat.isDirectory() || (finalStat.mode & 0o777) !== 0o700)
			throw new TypeError("D725 claimed generation identity is invalid");
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		if (faultStage === "after-claim") throw new TypeError("D725 injected after-claim failure");
		terminalBytes = strictJsonCodec.encode(bundle.qualification.terminalHttpGraphEvidence);
		qualificationBytes = strictJsonCodec.encode(bundle.qualification);
		generationBytes = strictJsonCodec.encode(bundle.generation);
		bundleBytes = strictJsonCodec.encode(bundle);
		const artifacts = [
			["terminal-http-graph-evidence.v1.json", terminalBytes],
			["qualification.v1.json", qualificationBytes],
			["generation.v1.json", generationBytes],
			["bundle.v1.json", bundleBytes],
		] as const;
		const stagingRoot = join(finalRoot, `.d725-staging-${randomUUID()}`);
		await mkdir(stagingRoot, { mode: 0o700 });
		const stagingStat = await lstat(stagingRoot);
		const stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		await assertDirectoryIdentity(stagingRoot, stagingIdentity, 0o700);
		const identities = new Map<string, FileIdentity>();
		for (const [name, bytes] of artifacts)
			identities.set(name, await writeCanonical(join(stagingRoot, name), bytes));
		const stagingHandle = await open(stagingRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		for (const [name, bytes] of artifacts)
			await assertFile(join(stagingRoot, name), identities.get(name)!, bytes);
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		const artifactsRoot = join(finalRoot, "artifacts");
		await rename(stagingRoot, artifactsRoot);
		artifactsHandle = await open(artifactsRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		const artifactsStat = await artifactsHandle.stat();
		artifactsIdentity = { dev: artifactsStat.dev, ino: artifactsStat.ino };
		if (
			!artifactsStat.isDirectory() ||
			(artifactsStat.mode & 0o777) !== 0o700 ||
			artifactsIdentity.dev !== stagingIdentity.dev ||
			artifactsIdentity.ino !== stagingIdentity.ino
		)
			throw new TypeError("D725 committed artifacts identity drifted");
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		if (faultStage === "after-artifacts-rename")
			throw new TypeError("D725 injected post-rename failure");
		const commitBytes = strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly.b112.d725.terminal-http-real-provider-commit.v1",
				generationDigest: bundle.generation.generationDigest,
				bundleDigest: bundle.bundleDigest,
				artifactsDirectory: "artifacts",
			}),
		);
		const commitIdentity = await writeCanonical(join(finalRoot, "commit.v1.json"), commitBytes);
		await finalHandle.sync();
		for (const [name, bytes] of artifacts)
			await assertFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertFile(join(finalRoot, "commit.v1.json"), commitIdentity, commitBytes);
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		await parentHandle.sync();
		for (const [name, bytes] of artifacts)
			await assertFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertFile(join(finalRoot, "commit.v1.json"), commitIdentity, commitBytes);
		const finalHandleStat = await finalHandle.stat();
		const artifactsHandleStat = await artifactsHandle.stat();
		if (
			finalHandleStat.dev !== finalIdentity.dev ||
			finalHandleStat.ino !== finalIdentity.ino ||
			artifactsHandleStat.dev !== artifactsIdentity.dev ||
			artifactsHandleStat.ino !== artifactsIdentity.ino
		)
			throw new TypeError("D725 stable directory handle identity drifted");
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
	} catch (error) {
		operationError = error;
	}
	const closeResults = await Promise.allSettled([
		artifactsHandle?.close() ?? Promise.resolve(),
		finalHandle?.close() ?? Promise.resolve(),
	]);
	const closeErrors = closeResults
		.filter((result): result is PromiseRejectedResult => result.status === "rejected")
		.map((result) => result.reason);
	if (closeErrors.length > 0)
		operationError = new AggregateError(
			operationError === null ? closeErrors : [operationError, ...closeErrors],
			"D725 persistence handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null && claimCreated) {
		if (parentIdentity === null || finalIdentity === null) {
			cleanupError = new TypeError("D725 exact cleanup ownership was not established");
		} else {
			const currentRoot = await lstat(privateRoot).catch(() => null);
			const currentFinal = await lstat(finalRoot).catch(() => null);
			if (
				currentRoot === null ||
				currentRoot.dev !== parentIdentity.dev ||
				currentRoot.ino !== parentIdentity.ino ||
				currentFinal === null ||
				currentFinal.dev !== finalIdentity.dev ||
				currentFinal.ino !== finalIdentity.ino
			) {
				cleanupError = new TypeError("D725 cleanup refused after ownership drift");
			} else {
				try {
					await rm(finalRoot, { recursive: true, force: true });
					await parentHandle.sync();
				} catch (error) {
					cleanupError = error;
				}
			}
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	const parentCloseError = parentClose[0]?.status === "rejected" ? parentClose[0].reason : null;
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentCloseError !== null) errors.push(parentCloseError);
		if (errors.length > 1) throw new AggregateError(errors, "D725 persistence cleanup failed");
		throw operationError;
	}
	void parentCloseError;
	const material = strictSnapshot({
		schemaVersion: D725_PERSISTENCE_SCHEMA,
		generationRef: D725_GENERATION_REF,
		terminalHttpGraphEvidenceArtifactDigest: empiricalSha256(terminalBytes),
		qualificationArtifactDigest: empiricalSha256(qualificationBytes),
		generationArtifactDigest: empiricalSha256(generationBytes),
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
	});
	return Object.freeze({ ...material, persistenceDigest: empiricalStrictJsonDigest(material) });
}
