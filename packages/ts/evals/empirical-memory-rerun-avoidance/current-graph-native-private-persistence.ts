import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";

export interface CurrentGraphPrivatePersistenceReceiptV1 {
	readonly generationRef: string;
	readonly artifactDigests: Readonly<Record<string, string>>;
	readonly commitArtifactDigest: string;
	readonly receiptDigest: string;
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
		stat.nlink < 1 ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(process.getuid !== undefined && stat.uid !== process.getuid()) ||
		(await realpath(path)) !== path
	)
		throw new TypeError("current Graph private directory identity drifted");
}

async function writePrivateFile(path: string, bytes: Uint8Array): Promise<Identity> {
	const handle = await open(
		path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const stat = await handle.stat();
		if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600)
			throw new TypeError("current Graph private file identity drifted");
		return Object.freeze({ dev: stat.dev, ino: stat.ino });
	} finally {
		await handle.close();
	}
}

async function assertPrivateFile(
	path: string,
	identity: Identity,
	bytes: Uint8Array,
): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(new Uint8Array(await handle.readFile()), bytes)
		)
			throw new TypeError("current Graph private file readback drifted");
	} finally {
		await handle.close();
	}
}

export async function persistCurrentGraphPrivateGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly artifacts: Readonly<Record<string, Uint8Array>>;
	readonly commitBytes: Uint8Array;
}): Promise<CurrentGraphPrivatePersistenceReceiptV1> {
	if (!isAbsolute(input.privateRoot) || (await realpath(input.privateRoot)) !== input.privateRoot)
		throw new TypeError("current Graph private root is not canonical");
	if (!/^[a-z0-9][a-z0-9.-]{0,191}$/u.test(input.generationRef))
		throw new TypeError("current Graph private generation ref is invalid");
	const entries = Object.entries(input.artifacts);
	if (entries.length < 1 || entries.length > 8)
		throw new TypeError("current Graph private artifact count is invalid");
	for (const [name, bytes] of entries) {
		if (!/^[a-z0-9][a-z0-9.-]{0,95}\.json$/u.test(name) || !(bytes instanceof Uint8Array))
			throw new TypeError("current Graph private artifact entry is invalid");
		if (bytes.byteLength < 1 || bytes.byteLength > 4_194_304)
			throw new TypeError("current Graph private artifact exceeds its bound");
	}
	if (!(input.commitBytes instanceof Uint8Array) || input.commitBytes.byteLength < 1)
		throw new TypeError("current Graph private commit bytes are invalid");
	const rootStat = await lstat(input.privateRoot);
	const rootIdentity = Object.freeze({ dev: rootStat.dev, ino: rootStat.ino });
	await assertDirectory(input.privateRoot, rootIdentity, 0o700);
	const parentHandle = await open(
		input.privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	const finalRoot = join(input.privateRoot, input.generationRef);
	const stagingRoot = join(finalRoot, "staging");
	const artifactsRoot = join(finalRoot, "artifacts");
	const commitPath = join(finalRoot, "commit.v1.json");
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let finalIdentity: Identity | null = null;
	let artifactsIdentity: Identity | null = null;
	let operationError: unknown = null;
	let receipt: CurrentGraphPrivatePersistenceReceiptV1 | null = null;
	try {
		const parentStat = await parentHandle.stat();
		if (parentStat.dev !== rootIdentity.dev || parentStat.ino !== rootIdentity.ino)
			throw new TypeError("current Graph private parent handle drifted");
		await mkdir(finalRoot, { recursive: false, mode: 0o700 });
		finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const finalStat = await finalHandle.stat();
		finalIdentity = Object.freeze({ dev: finalStat.dev, ino: finalStat.ino });
		await assertDirectory(finalRoot, finalIdentity, 0o700);
		await finalHandle.sync();
		await parentHandle.sync();
		await mkdir(stagingRoot, { recursive: false, mode: 0o700 });
		artifactsHandle = await open(
			stagingRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const artifactsStat = await artifactsHandle.stat();
		artifactsIdentity = Object.freeze({ dev: artifactsStat.dev, ino: artifactsStat.ino });
		const identities = new Map<string, Identity>();
		for (const [name, bytes] of entries)
			identities.set(name, await writePrivateFile(join(stagingRoot, name), bytes));
		await artifactsHandle.sync();
		for (const [name, bytes] of entries)
			await assertPrivateFile(join(stagingRoot, name), identities.get(name)!, bytes);
		await rename(stagingRoot, artifactsRoot);
		await assertDirectory(artifactsRoot, artifactsIdentity, 0o700);
		await finalHandle.sync();
		const commitIdentity = await writePrivateFile(commitPath, input.commitBytes);
		await finalHandle.sync();
		await parentHandle.sync();
		for (const [name, bytes] of entries)
			await assertPrivateFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertPrivateFile(commitPath, commitIdentity, input.commitBytes);
		const [parentStable, finalStable, artifactsStable] = await Promise.all([
			parentHandle.stat(),
			finalHandle.stat(),
			artifactsHandle.stat(),
		]);
		if (
			parentStable.dev !== rootIdentity.dev ||
			parentStable.ino !== rootIdentity.ino ||
			finalStable.dev !== finalIdentity.dev ||
			finalStable.ino !== finalIdentity.ino ||
			artifactsStable.dev !== artifactsIdentity.dev ||
			artifactsStable.ino !== artifactsIdentity.ino
		)
			throw new TypeError("current Graph private stable handle drifted");
		await assertDirectory(input.privateRoot, rootIdentity, 0o700);
		await assertDirectory(finalRoot, finalIdentity, 0o700);
		await assertDirectory(artifactsRoot, artifactsIdentity, 0o700);
		for (const [name, bytes] of entries)
			await assertPrivateFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertPrivateFile(commitPath, commitIdentity, input.commitBytes);
		const artifactDigests = Object.freeze(
			Object.fromEntries(entries.map(([name, bytes]) => [name, empiricalSha256(bytes)])),
		);
		const receiptMaterial = strictSnapshot({
			generationRef: input.generationRef,
			artifactDigests,
			commitArtifactDigest: empiricalSha256(input.commitBytes),
		});
		receipt = Object.freeze({
			...receiptMaterial,
			receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
		});
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
			"current Graph private handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null && finalIdentity !== null) {
		try {
			await assertDirectory(finalRoot, finalIdentity, 0o700);
			const tombstone = join(input.privateRoot, `.d3-tombstone-${randomUUID()}`);
			await rename(finalRoot, tombstone);
			const moved = await lstat(tombstone);
			if (moved.dev !== finalIdentity.dev || moved.ino !== finalIdentity.ino)
				throw new TypeError("current Graph private tombstone ownership drifted");
			await rm(tombstone, { recursive: true, force: true });
			await parentHandle.sync();
		} catch (error) {
			cleanupError = error;
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentClose[0]?.status === "rejected") errors.push(parentClose[0].reason);
		if (errors.length > 1)
			throw new AggregateError(errors, "current Graph private persistence cleanup failed");
		throw operationError;
	}
	if (receipt === null) throw new TypeError("current Graph private persistence did not linearize");
	return receipt;
}
