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

export const D705_SINGLE_USE_DISPATCH_CLAIM_SCHEMA =
	"graphrefly.private-solution-eval.d705-single-use-dispatch-claim.v1" as const;
export const D705_SINGLE_USE_DISPATCH_CLAIM_REF =
	"d705-d704-exact-replacement-2026-08-09-v1" as const;
export const D705_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY =
	`.${D705_SINGLE_USE_DISPATCH_CLAIM_REF}` as const;
export const D705_LIVE_GENERATION_REF = "d705-d704-exact-replacement-2026-08-09-v1" as const;
const D705_CLAIM_FILE = "dispatch-claim.v1.json";
const D705_EXECUTION_DIRECTORY = ".execution-started";

export interface D705SingleUseDispatchClaimV1 {
	readonly schemaVersion: typeof D705_SINGLE_USE_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D705_SINGLE_USE_DISPATCH_CLAIM_REF;
	readonly decisionRef: "decision.D705";
	readonly decisionRevision: "decision.D705.2026-08-09.v1";
	readonly generationRef: typeof D705_LIVE_GENERATION_REF;
	readonly disposition: "consumed-after-credential-presence-before-control-plane-or-provider";
	readonly blockCount: 1;
	readonly maxSpendMicrousd: 6_000_000;
	readonly noResetTotalLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface AcquiredD705SingleUseDispatchClaimV1 {
	readonly claimPath: string;
	readonly claimDigest: string;
}

const acquiredClaims = new WeakSet<object>();

function createClaim(): D705SingleUseDispatchClaimV1 {
	const material = strictSnapshot({
		schemaVersion: D705_SINGLE_USE_DISPATCH_CLAIM_SCHEMA,
		claimRef: D705_SINGLE_USE_DISPATCH_CLAIM_REF,
		decisionRef: "decision.D705" as const,
		decisionRevision: "decision.D705.2026-08-09.v1" as const,
		generationRef: D705_LIVE_GENERATION_REF,
		disposition: "consumed-after-credential-presence-before-control-plane-or-provider" as const,
		blockCount: 1 as const,
		maxSpendMicrousd: 6_000_000 as const,
		noResetTotalLimitMicrousd: 32_000_000 as const,
	});
	return strictSnapshot({ ...material, claimDigest: empiricalStrictJsonDigest(material) });
}

export async function acquireD705SingleUseDispatchClaim(): Promise<AcquiredD705SingleUseDispatchClaimV1> {
	return acquireD705SingleUseDispatchClaimAtPrivateRoot(D691_PRIVATE_PERSISTENCE_ROOT);
}

export async function acquireD705SingleUseDispatchClaimAtPrivateRoot(
	privateRootInput: string,
): Promise<AcquiredD705SingleUseDispatchClaimV1> {
	const privateRoot = await assertSafePrivateRoot(privateRootInput);
	const claimPath = join(privateRoot, D705_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
	try {
		await mkdir(claimPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D705 paid dispatch is already claimed");
		}
		throw error;
	}

	try {
		const status = await lstat(claimPath);
		if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o700) {
			throw new TypeError("D705 dispatch claim does not have exact 0700 ownership");
		}
		if ((await realpath(claimPath)) !== claimPath) {
			throw new TypeError("D705 dispatch claim escaped its operator-private path");
		}
		const claim = createClaim();
		const claimBytes = strictJsonCodec.encode(claim);
		const claimFile = join(claimPath, D705_CLAIM_FILE);
		await writePrivateFile(claimFile, claimBytes);
		await syncDirectory(claimPath);
		await syncDirectory(privateRoot);
		const readback = new Uint8Array(await readFile(claimFile));
		if (!Buffer.from(readback).equals(claimBytes)) {
			throw new TypeError("D705 dispatch claim readback did not match canonical bytes");
		}
		const acquired = Object.freeze({ claimPath, claimDigest: claim.claimDigest });
		acquiredClaims.add(acquired);
		return acquired;
	} catch (error) {
		throw new Error("D705 paid dispatch claim is consumed but not fully durable", {
			cause: error,
		});
	}
}

export function consumeD705SingleUseDispatchClaim(
	value: unknown,
): AcquiredD705SingleUseDispatchClaimV1 {
	if (value === null || typeof value !== "object" || !acquiredClaims.delete(value)) {
		throw new TypeError("D705 live block requires its same-process single-use claim");
	}
	const claim = value as AcquiredD705SingleUseDispatchClaimV1;
	if (
		typeof claim.claimPath !== "string" ||
		claim.claimPath.length === 0 ||
		typeof claim.claimDigest !== "string" ||
		!/^sha256:[0-9a-f]{64}$/.test(claim.claimDigest)
	) {
		throw new TypeError("D705 live claim is malformed");
	}
	return claim;
}

export async function consumePersistedD705DispatchClaimForExecution(): Promise<AcquiredD705SingleUseDispatchClaimV1> {
	return consumePersistedD705DispatchClaimForExecutionAtPrivateRoot(D691_PRIVATE_PERSISTENCE_ROOT);
}

export async function consumePersistedD705DispatchClaimForExecutionAtPrivateRoot(
	privateRootInput: string,
): Promise<AcquiredD705SingleUseDispatchClaimV1> {
	const privateRoot = await assertSafePrivateRoot(privateRootInput);
	const claimPath = join(privateRoot, D705_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
	const claimFile = join(claimPath, D705_CLAIM_FILE);
	const status = await lstat(claimPath);
	if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o700) {
		throw new TypeError("D705 persisted claim ownership is invalid");
	}
	if ((await realpath(claimPath)) !== claimPath) {
		throw new TypeError("D705 persisted claim escaped its operator-private path");
	}
	const expected = createClaim();
	const expectedBytes = strictJsonCodec.encode(expected);
	const persistedBytes = new Uint8Array(await readFile(claimFile));
	if (!Buffer.from(persistedBytes).equals(expectedBytes)) {
		throw new TypeError("D705 persisted claim bytes are not exact");
	}
	const executionPath = join(claimPath, D705_EXECUTION_DIRECTORY);
	try {
		await mkdir(executionPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D705 live execution is already consumed");
		}
		throw error;
	}
	await syncDirectory(claimPath);
	await syncDirectory(privateRoot);
	const acquired = Object.freeze({ claimPath, claimDigest: expected.claimDigest });
	acquiredClaims.add(acquired);
	return acquired;
}
