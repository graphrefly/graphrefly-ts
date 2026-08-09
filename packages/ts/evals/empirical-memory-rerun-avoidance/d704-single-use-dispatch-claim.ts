import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D691_PRIVATE_PERSISTENCE_ROOT } from "./d691-historical-transfer-live.js";
import {
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D704_SINGLE_USE_DISPATCH_CLAIM_SCHEMA =
	"graphrefly.private-solution-eval.d704-single-use-dispatch-claim.v1" as const;
export const D704_SINGLE_USE_DISPATCH_CLAIM_REF =
	"d704-d703-mutation-first-live-2026-08-09-v1" as const;
export const D704_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY =
	`.${D704_SINGLE_USE_DISPATCH_CLAIM_REF}` as const;
export const D704_LIVE_GENERATION_REF = "d704-d703-mutation-first-live-2026-08-09-v1" as const;
export const D704_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST =
	"sha256:55f34171855353a53ddc6e29c514a429acad64e12c1bb0a564a479a616e6ef0d" as const;
export const D704_CONSUMED_DISPATCH_CLAIM_DIGEST =
	"sha256:f6f5a8c077816b6842f3a19d12bc864cfa33935cae9e55d5f975e71e131682c4" as const;
const D704_CLAIM_FILE = "dispatch-claim.v1.json";
const D704_EXECUTION_DIRECTORY = ".execution-started";

export interface D704SingleUseDispatchClaimV1 {
	readonly schemaVersion: typeof D704_SINGLE_USE_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D704_SINGLE_USE_DISPATCH_CLAIM_REF;
	readonly decisionRef: "decision.D704";
	readonly decisionRevision: "decision.D704.2026-08-09.v1";
	readonly generationRef: typeof D704_LIVE_GENERATION_REF;
	readonly disposition: "consumed-before-credential-or-network";
	readonly blockCount: 1;
	readonly maxSpendMicrousd: 6_000_000;
	readonly noResetTotalLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface AcquiredD704SingleUseDispatchClaimV1 {
	readonly claimPath: string;
	readonly claimDigest: string;
}

const acquiredClaims = new WeakSet<object>();
const constructedConsumedHistories = new WeakSet<object>();

export interface D704ConsumedDispatchHistoryCapabilityV1 {
	readonly capabilityRef: "d704-consumed-dispatch-history";
	readonly capabilityRevision: "decision.D705.2026-08-09.v1";
	readonly claimArtifactDigest: typeof D704_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST;
	readonly claimDigest: typeof D704_CONSUMED_DISPATCH_CLAIM_DIGEST;
	readonly executionLeaseConsumed: true;
}

function createClaim(): D704SingleUseDispatchClaimV1 {
	const material = strictSnapshot({
		schemaVersion: D704_SINGLE_USE_DISPATCH_CLAIM_SCHEMA,
		claimRef: D704_SINGLE_USE_DISPATCH_CLAIM_REF,
		decisionRef: "decision.D704" as const,
		decisionRevision: "decision.D704.2026-08-09.v1" as const,
		generationRef: D704_LIVE_GENERATION_REF,
		disposition: "consumed-before-credential-or-network" as const,
		blockCount: 1 as const,
		maxSpendMicrousd: 6_000_000 as const,
		noResetTotalLimitMicrousd: 32_000_000 as const,
	});
	return strictSnapshot({ ...material, claimDigest: empiricalStrictJsonDigest(material) });
}

export async function acquireD704SingleUseDispatchClaim(): Promise<AcquiredD704SingleUseDispatchClaimV1> {
	return acquireD704SingleUseDispatchClaimAtPrivateRoot(D691_PRIVATE_PERSISTENCE_ROOT);
}

export async function acquireD704SingleUseDispatchClaimAtPrivateRoot(
	privateRootInput: string,
): Promise<AcquiredD704SingleUseDispatchClaimV1> {
	const privateRoot = await assertSafePrivateRoot(privateRootInput);
	const claimPath = join(privateRoot, D704_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
	try {
		await mkdir(claimPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D704 paid dispatch is already claimed");
		}
		throw error;
	}

	try {
		const status = await lstat(claimPath);
		if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o700) {
			throw new TypeError("D704 dispatch claim does not have exact 0700 ownership");
		}
		if ((await realpath(claimPath)) !== claimPath) {
			throw new TypeError("D704 dispatch claim escaped its operator-private path");
		}
		const claim = createClaim();
		const claimBytes = strictJsonCodec.encode(claim);
		const claimFile = join(claimPath, D704_CLAIM_FILE);
		await writePrivateFile(claimFile, claimBytes);
		await syncDirectory(claimPath);
		await syncDirectory(privateRoot);
		const readback = new Uint8Array(await readFile(claimFile));
		if (!Buffer.from(readback).equals(claimBytes)) {
			throw new TypeError("D704 dispatch claim readback did not match canonical bytes");
		}
		const acquired = Object.freeze({ claimPath, claimDigest: claim.claimDigest });
		acquiredClaims.add(acquired);
		return acquired;
	} catch (error) {
		throw new Error("D704 paid dispatch claim is consumed but not fully durable", {
			cause: error,
		});
	}
}

export function consumeD704SingleUseDispatchClaim(
	value: unknown,
): AcquiredD704SingleUseDispatchClaimV1 {
	if (value === null || typeof value !== "object" || !acquiredClaims.delete(value)) {
		throw new TypeError("D704 live block requires its same-process single-use claim");
	}
	const claim = value as AcquiredD704SingleUseDispatchClaimV1;
	if (
		typeof claim.claimPath !== "string" ||
		claim.claimPath.length === 0 ||
		typeof claim.claimDigest !== "string" ||
		!/^sha256:[0-9a-f]{64}$/.test(claim.claimDigest)
	) {
		throw new TypeError("D704 live claim is malformed");
	}
	return claim;
}

export async function consumePersistedD704DispatchClaimForExecution(): Promise<AcquiredD704SingleUseDispatchClaimV1> {
	return consumePersistedD704DispatchClaimForExecutionAtPrivateRoot(D691_PRIVATE_PERSISTENCE_ROOT);
}

export async function consumePersistedD704DispatchClaimForExecutionAtPrivateRoot(
	privateRootInput: string,
): Promise<AcquiredD704SingleUseDispatchClaimV1> {
	const privateRoot = await assertSafePrivateRoot(privateRootInput);
	const claimPath = join(privateRoot, D704_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
	const claimFile = join(claimPath, D704_CLAIM_FILE);
	const status = await lstat(claimPath);
	if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o700) {
		throw new TypeError("D704 persisted claim ownership is invalid");
	}
	if ((await realpath(claimPath)) !== claimPath) {
		throw new TypeError("D704 persisted claim escaped its operator-private path");
	}
	const expected = createClaim();
	const expectedBytes = strictJsonCodec.encode(expected);
	const persistedBytes = new Uint8Array(await readFile(claimFile));
	if (!Buffer.from(persistedBytes).equals(expectedBytes)) {
		throw new TypeError("D704 persisted claim bytes are not exact");
	}
	const executionPath = join(claimPath, D704_EXECUTION_DIRECTORY);
	try {
		await mkdir(executionPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D704 live execution is already consumed");
		}
		throw error;
	}
	await syncDirectory(claimPath);
	await syncDirectory(privateRoot);
	const acquired = Object.freeze({ claimPath, claimDigest: expected.claimDigest });
	acquiredClaims.add(acquired);
	return acquired;
}

export async function createD704ConsumedDispatchHistoryCapabilityAtPrivateRoot(
	privateRootInput: string,
): Promise<D704ConsumedDispatchHistoryCapabilityV1> {
	const privateRoot = await assertSafePrivateRoot(privateRootInput);
	const claimPath = join(privateRoot, D704_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
	const claimFile = join(claimPath, D704_CLAIM_FILE);
	const executionPath = join(claimPath, D704_EXECUTION_DIRECTORY);
	const claimStatus = await lstat(claimPath);
	const claimFileStatus = await lstat(claimFile);
	const executionStatus = await lstat(executionPath);
	if (
		!claimStatus.isDirectory() ||
		claimStatus.isSymbolicLink() ||
		(claimStatus.mode & 0o777) !== 0o700 ||
		!claimFileStatus.isFile() ||
		claimFileStatus.isSymbolicLink() ||
		(claimFileStatus.mode & 0o777) !== 0o600 ||
		!executionStatus.isDirectory() ||
		executionStatus.isSymbolicLink() ||
		(executionStatus.mode & 0o777) !== 0o700 ||
		(await realpath(claimPath)) !== claimPath ||
		(await realpath(claimFile)) !== claimFile ||
		(await realpath(executionPath)) !== executionPath
	) {
		throw new TypeError("D704 consumed dispatch history ownership is invalid");
	}
	const persistedBytes = new Uint8Array(await readFile(claimFile));
	const expectedBytes = strictJsonCodec.encode(createClaim());
	if (
		!Buffer.from(persistedBytes).equals(expectedBytes) ||
		`sha256:${createHash("sha256").update(persistedBytes).digest("hex")}` !==
			D704_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST
	) {
		throw new TypeError("D704 consumed dispatch history bytes are not exact");
	}
	const capability = Object.freeze({
		capabilityRef: "d704-consumed-dispatch-history" as const,
		capabilityRevision: "decision.D705.2026-08-09.v1" as const,
		claimArtifactDigest: D704_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST,
		claimDigest: D704_CONSUMED_DISPATCH_CLAIM_DIGEST,
		executionLeaseConsumed: true as const,
	});
	constructedConsumedHistories.add(capability);
	return capability;
}

export async function createD704ConsumedDispatchHistoryCapability(): Promise<D704ConsumedDispatchHistoryCapabilityV1> {
	return createD704ConsumedDispatchHistoryCapabilityAtPrivateRoot(D691_PRIVATE_PERSISTENCE_ROOT);
}

export function consumeD704ConsumedDispatchHistoryCapability(
	value: unknown,
): D704ConsumedDispatchHistoryCapabilityV1 {
	if (value === null || typeof value !== "object" || !constructedConsumedHistories.delete(value)) {
		throw new TypeError("D705 requires exact same-process D704 consumed dispatch history");
	}
	return value as D704ConsumedDispatchHistoryCapabilityV1;
}
