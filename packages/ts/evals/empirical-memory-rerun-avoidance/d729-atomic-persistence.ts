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
import { D729_GENERATION_REF } from "./d729-coordinates.js";
import {
	consumeConstructedD729LiveBundle,
	type D729LiveBundleV1,
} from "./d729-graph-native-live.js";

export const D729_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d729.atomic-persistence-receipt.v1" as const;

export interface D729PersistenceFaultV1 {
	readonly revision: "graphrefly.b112.d729.persistence-fault.v1";
}

const faults = new WeakMap<object, { stage: "after-write" | "after-rename"; consumed: boolean }>();

export function createD729PersistenceFaultForTest(
	stage: "after-write" | "after-rename",
): D729PersistenceFaultV1 {
	const capability = Object.freeze({
		revision: "graphrefly.b112.d729.persistence-fault.v1" as const,
	});
	faults.set(capability, { stage, consumed: false });
	return capability;
}

interface Identity {
	readonly dev: number;
	readonly ino: number;
}

async function assertDirectory(path: string, identity: Identity, mode: number): Promise<void> {
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== mode ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D729 persistence directory identity drifted");
}

async function writeFile(path: string, bytes: Uint8Array): Promise<Identity> {
	const handle = await open(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D729 persistence artifact identity drifted");
		return { dev: stat.dev, ino: stat.ino };
	} finally {
		await handle.close();
	}
}

async function assertFile(path: string, identity: Identity, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(new Uint8Array(await handle.readFile()), bytes)
		)
			throw new TypeError("D729 persistence artifact readback drifted");
	} finally {
		await handle.close();
	}
}

export async function persistD729LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D729LiveBundleV1;
	readonly fault?: D729PersistenceFaultV1;
}) {
	const input = record(inputValue, "d729.persist");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d729.persist",
	);
	const bundle = consumeConstructedD729LiveBundle(input.bundle);
	let faultStage: "after-write" | "after-rename" | null = null;
	if (Object.hasOwn(input, "fault")) {
		const state =
			typeof input.fault === "object" && input.fault !== null ? faults.get(input.fault) : undefined;
		if (state === undefined || state.consumed)
			throw new TypeError("D729 persistence fault is invalid or consumed");
		state.consumed = true;
		faultStage = state.stage;
	}
	if (typeof input.privateRoot !== "string" || resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D729 private root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	if (privateRoot !== input.privateRoot) throw new TypeError("D729 private root is not canonical");
	const parentHandle = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	const parentStat = await parentHandle.stat();
	const parentIdentity = { dev: parentStat.dev, ino: parentStat.ino };
	await assertDirectory(privateRoot, parentIdentity, 0o700);
	const finalRoot = join(privateRoot, D729_GENERATION_REF);
	let finalIdentity: Identity | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let operationError: unknown = null;
	let artifactBytes: readonly (readonly [string, Uint8Array])[] = [];
	try {
		await mkdir(finalRoot, { recursive: false, mode: 0o700 });
		finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const finalStat = await finalHandle.stat();
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		await assertDirectory(finalRoot, finalIdentity, 0o700);
		artifactBytes = [
			["qualification.v1.json", strictJsonCodec.encode(bundle.qualification)],
			["graph-evidence.v1.json", strictJsonCodec.encode(bundle.graphEvidence)],
			[
				"terminal-http-graph-evidence.v1.json",
				strictJsonCodec.encode(bundle.terminalHttpGraphEvidence),
			],
			["executor-failure-facts.v1.json", strictJsonCodec.encode(bundle.executorFailureFacts)],
			["observation.v1.json", strictJsonCodec.encode(bundle.observation)],
			[
				bundle.disposition === "success"
					? "success-generation.v1.json"
					: "partial-failure-generation.v1.json",
				strictJsonCodec.encode(bundle.generation),
			],
			["terminal-receipt.v1.json", strictJsonCodec.encode(bundle.terminalReceipt)],
			["bundle.v1.json", strictJsonCodec.encode(bundle)],
		];
		const stagingRoot = join(finalRoot, `.d729-staging-${randomUUID()}`);
		await mkdir(stagingRoot, { recursive: false, mode: 0o700 });
		const stagingStat = await lstat(stagingRoot);
		const stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		await assertDirectory(stagingRoot, stagingIdentity, 0o700);
		const identities = new Map<string, Identity>();
		for (const [name, bytes] of artifactBytes)
			identities.set(name, await writeFile(join(stagingRoot, name), bytes));
		const stagingHandle = await open(
			stagingRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		for (const [name, bytes] of artifactBytes)
			await assertFile(join(stagingRoot, name), identities.get(name)!, bytes);
		if (faultStage === "after-write") throw new TypeError("D729 injected post-write failure");
		await assertDirectory(privateRoot, parentIdentity, 0o700);
		await assertDirectory(finalRoot, finalIdentity, 0o700);
		const artifactsRoot = join(finalRoot, "artifacts");
		await rename(stagingRoot, artifactsRoot);
		artifactsHandle = await open(
			artifactsRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const artifactsStat = await artifactsHandle.stat();
		const artifactsIdentity = { dev: artifactsStat.dev, ino: artifactsStat.ino };
		if (
			artifactsIdentity.dev !== stagingIdentity.dev ||
			artifactsIdentity.ino !== stagingIdentity.ino
		)
			throw new TypeError("D729 artifacts identity drifted at rename");
		if (faultStage === "after-rename") throw new TypeError("D729 injected post-rename failure");
		const commit = strictSnapshot({
			schemaVersion: "graphrefly.b112.d729.atomic-commit.v1",
			generationRef: D729_GENERATION_REF,
			disposition: bundle.disposition,
			bundleDigest: bundle.bundleDigest,
			terminalReceiptDigest: bundle.terminalReceipt.terminalReceiptDigest,
			artifactsDirectory: "artifacts",
		});
		const commitBytes = strictJsonCodec.encode(commit);
		const commitIdentity = await writeFile(join(finalRoot, "commit.v1.json"), commitBytes);
		await finalHandle.sync();
		await parentHandle.sync();
		for (const [name, bytes] of artifactBytes)
			await assertFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertFile(join(finalRoot, "commit.v1.json"), commitIdentity, commitBytes);
		await assertDirectory(privateRoot, parentIdentity, 0o700);
		await assertDirectory(finalRoot, finalIdentity, 0o700);
		await assertDirectory(artifactsRoot, artifactsIdentity, 0o700);
		const [finalStable, artifactsStable] = await Promise.all([
			finalHandle.stat(),
			artifactsHandle.stat(),
		]);
		if (
			finalStable.dev !== finalIdentity.dev ||
			finalStable.ino !== finalIdentity.ino ||
			artifactsStable.dev !== artifactsIdentity.dev ||
			artifactsStable.ino !== artifactsIdentity.ino
		)
			throw new TypeError("D729 stable persistence handle drifted");
	} catch (error) {
		operationError = error;
	}
	const closes = await Promise.allSettled([
		artifactsHandle?.close() ?? Promise.resolve(),
		finalHandle?.close() ?? Promise.resolve(),
	]);
	const closeErrors = closes
		.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
		.map((entry) => entry.reason);
	if (closeErrors.length > 0)
		operationError = new AggregateError(
			operationError === null ? closeErrors : [operationError, ...closeErrors],
			"D729 persistence handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null && finalIdentity !== null) {
		const current = await lstat(finalRoot).catch(() => null);
		if (current?.dev === finalIdentity.dev && current.ino === finalIdentity.ino) {
			try {
				await rm(finalRoot, { recursive: true, force: true });
				await parentHandle.sync();
			} catch (error) {
				cleanupError = error;
			}
		} else {
			cleanupError = new TypeError("D729 persistence cleanup ownership drifted");
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentClose[0]?.status === "rejected") errors.push(parentClose[0].reason);
		if (errors.length > 1) throw new AggregateError(errors, "D729 persistence cleanup failed");
		throw operationError;
	}
	const artifactDigests = artifactBytes.map(([name, bytes]) => ({
		name,
		sha256: empiricalSha256(bytes),
	}));
	const receiptMaterial = strictSnapshot({
		schemaVersion: D729_PERSISTENCE_SCHEMA,
		generationRef: D729_GENERATION_REF,
		disposition: bundle.disposition,
		bundleDigest: bundle.bundleDigest,
		artifactDigests,
	});
	return Object.freeze({
		...receiptMaterial,
		persistenceDigest: empiricalStrictJsonDigest(receiptMaterial),
	});
}
