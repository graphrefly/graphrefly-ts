import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open as openFile, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, exactKeys, record, strictSnapshot } from "./canonical.js";
import { D691_PRIVATE_PERSISTENCE_ROOT } from "./d691-historical-transfer-live.js";
import {
	consumeD708CurrentKeyExecutionAdmission,
	type D708CurrentKeyExecutionAdmissionV1,
} from "./d708-current-key-execution-admission.js";
import {
	consumeD708DispatchClaimAuthorization,
	type D708DispatchClaimAuthorizationV1,
} from "./d708-fresh-pricing-live.js";
import {
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D708_SINGLE_USE_DISPATCH_CLAIM_SCHEMA =
	"graphrefly.private-solution-eval.d708-single-use-dispatch-claim.v1" as const;
export const D708_SINGLE_USE_DISPATCH_CLAIM_REF =
	"d708-d707-fresh-pricing-separated-replacement-2026-08-09-v1" as const;
export const D708_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY =
	`.${D708_SINGLE_USE_DISPATCH_CLAIM_REF}` as const;
export const D708_LIVE_GENERATION_REF =
	"d708-d707-fresh-pricing-separated-replacement-2026-08-09-v1" as const;
const D708_CLAIM_FILE = "dispatch-claim.v1.json";
export const D708_EXECUTION_STATE_DIRECTORY = ".execution-decision" as const;
export const D708_EXECUTION_STARTED_FILE = "execution-started.v1.json" as const;
export const D708_EXECUTION_FAILED_FILE = "terminal-failed.v1.json" as const;

export interface D708SingleUseDispatchClaimV1 {
	readonly schemaVersion: typeof D708_SINGLE_USE_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D708_SINGLE_USE_DISPATCH_CLAIM_REF;
	readonly decisionRef: "decision.D708";
	readonly decisionRevision: "decision.D708.2026-08-09.v1";
	readonly generationRef: typeof D708_LIVE_GENERATION_REF;
	readonly disposition: "consumed-after-fresh-pricing-credential-and-zero-byok-before-current-key-or-provider";
	readonly blockCount: 1;
	readonly maxSpendMicrousd: 6_000_000;
	readonly noResetTotalLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface PersistedD708SingleUseDispatchClaimV1 {
	readonly claimPath: string;
	readonly claimDigest: string;
}

export interface AcquiredD708SingleUseDispatchClaimV1
	extends PersistedD708SingleUseDispatchClaimV1 {
	readonly currentKeyExecutionAdmission: D708CurrentKeyExecutionAdmissionV1;
}

const executionClaims = new WeakSet<object>();

function createClaim(): D708SingleUseDispatchClaimV1 {
	const material = strictSnapshot({
		schemaVersion: D708_SINGLE_USE_DISPATCH_CLAIM_SCHEMA,
		claimRef: D708_SINGLE_USE_DISPATCH_CLAIM_REF,
		decisionRef: "decision.D708" as const,
		decisionRevision: "decision.D708.2026-08-09.v1" as const,
		generationRef: D708_LIVE_GENERATION_REF,
		disposition:
			"consumed-after-fresh-pricing-credential-and-zero-byok-before-current-key-or-provider" as const,
		blockCount: 1 as const,
		maxSpendMicrousd: 6_000_000 as const,
		noResetTotalLimitMicrousd: 32_000_000 as const,
	});
	return strictSnapshot({ ...material, claimDigest: empiricalStrictJsonDigest(material) });
}

export async function acquireD708SingleUseDispatchClaim(input: {
	readonly authorization: D708DispatchClaimAuthorizationV1;
	readonly monotonicNowMs: number;
}): Promise<PersistedD708SingleUseDispatchClaimV1> {
	const candidate = record(input, "d708.dispatchClaimAdmission");
	exactKeys(candidate, ["authorization", "monotonicNowMs"], "d708.dispatchClaimAdmission");
	if (typeof candidate.monotonicNowMs !== "number") {
		throw new TypeError("D708 dispatch claim monotonic clock is invalid");
	}
	consumeD708DispatchClaimAuthorization(candidate.authorization, candidate.monotonicNowMs);
	return acquireD708SingleUseDispatchClaimAtPrivateRoot(D691_PRIVATE_PERSISTENCE_ROOT);
}

export async function acquireD708SingleUseDispatchClaimAtPrivateRoot(
	privateRootInput: string,
): Promise<PersistedD708SingleUseDispatchClaimV1> {
	const privateRoot = await assertSafePrivateRoot(privateRootInput);
	const claimPath = join(privateRoot, D708_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
	try {
		await mkdir(claimPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D708 paid dispatch is already claimed");
		}
		throw error;
	}

	try {
		const status = await lstat(claimPath);
		if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o700) {
			throw new TypeError("D708 dispatch claim does not have exact 0700 ownership");
		}
		if ((await realpath(claimPath)) !== claimPath) {
			throw new TypeError("D708 dispatch claim escaped its operator-private path");
		}
		const claim = createClaim();
		const claimBytes = strictJsonCodec.encode(claim);
		const claimFile = join(claimPath, D708_CLAIM_FILE);
		await writePrivateFile(claimFile, claimBytes);
		await syncDirectory(claimPath);
		await syncDirectory(privateRoot);
		const readback = new Uint8Array(await readFile(claimFile));
		if (!Buffer.from(readback).equals(claimBytes)) {
			throw new TypeError("D708 dispatch claim readback did not match canonical bytes");
		}
		return Object.freeze({ claimPath, claimDigest: claim.claimDigest });
	} catch (error) {
		throw new Error("D708 paid dispatch claim is consumed but not fully durable", {
			cause: error,
		});
	}
}

export function consumeD708SingleUseDispatchClaim(
	value: unknown,
): AcquiredD708SingleUseDispatchClaimV1 {
	if (value === null || typeof value !== "object" || !executionClaims.delete(value)) {
		throw new TypeError("D708 live block requires its same-process single-use claim");
	}
	const claim = value as AcquiredD708SingleUseDispatchClaimV1;
	if (
		typeof claim.claimPath !== "string" ||
		claim.claimPath.length === 0 ||
		typeof claim.claimDigest !== "string" ||
		!/^sha256:[0-9a-f]{64}$/.test(claim.claimDigest)
	) {
		throw new TypeError("D708 live claim is malformed");
	}
	return claim;
}

export async function consumePersistedD708DispatchClaimForExecution(
	currentKeyExecutionAdmission: D708CurrentKeyExecutionAdmissionV1,
): Promise<AcquiredD708SingleUseDispatchClaimV1> {
	return consumePersistedD708DispatchClaimForExecutionAtPrivateRoot(
		D691_PRIVATE_PERSISTENCE_ROOT,
		currentKeyExecutionAdmission,
	);
}

export async function consumePersistedD708DispatchClaimForExecutionAtPrivateRoot(
	privateRootInput: string,
	currentKeyExecutionAdmissionInput: D708CurrentKeyExecutionAdmissionV1,
): Promise<AcquiredD708SingleUseDispatchClaimV1> {
	const persisted = await validatePersistedD708DispatchClaimAtPrivateRoot(
		privateRootInput,
		undefined,
	);
	const { privateRoot, claimPath, claimDigest } = persisted;
	const currentKeyExecutionAdmission = consumeD708CurrentKeyExecutionAdmission(
		currentKeyExecutionAdmissionInput,
	);
	const executionPath = join(claimPath, D708_EXECUTION_STATE_DIRECTORY);
	try {
		await mkdir(executionPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D708 live execution already has a terminal decision");
		}
		throw error;
	}
	const executionStatus = await lstat(executionPath);
	if (
		!executionStatus.isDirectory() ||
		executionStatus.isSymbolicLink() ||
		(executionStatus.mode & 0o777) !== 0o700 ||
		(await realpath(executionPath)) !== executionPath
	) {
		throw new TypeError("D708 execution decision ownership is invalid");
	}
	const startedBytes = strictJsonCodec.encode({
		disposition: "execution-started-after-current-key-admission",
		currentKeyAdmissionDigest: currentKeyExecutionAdmission.admission.admissionDigest,
	});
	await writePrivateFile(join(executionPath, D708_EXECUTION_STARTED_FILE), startedBytes);
	await syncDirectory(executionPath);
	await syncDirectory(claimPath);
	await syncDirectory(privateRoot);
	await validateD708ExecutionStartedMarker(
		claimPath,
		currentKeyExecutionAdmission.admission.admissionDigest,
	);
	const acquired = Object.freeze({ claimPath, claimDigest, currentKeyExecutionAdmission });
	executionClaims.add(acquired);
	return acquired;
}

export async function validateD708ExecutionStartedMarker(
	claimPath: string,
	currentKeyAdmissionDigest: string,
): Promise<void> {
	const decisionPath = join(claimPath, D708_EXECUTION_STATE_DIRECTORY);
	const startedPath = join(decisionPath, D708_EXECUTION_STARTED_FILE);
	const expectedBytes = strictJsonCodec.encode({
		disposition: "execution-started-after-current-key-admission",
		currentKeyAdmissionDigest,
	});
	const decisionStatus = await lstat(decisionPath);
	if (
		!decisionStatus.isDirectory() ||
		decisionStatus.isSymbolicLink() ||
		(decisionStatus.mode & 0o777) !== 0o700 ||
		(await realpath(decisionPath)) !== decisionPath
	) {
		throw new TypeError("D708 execution decision ownership is invalid");
	}
	const handle = await openFile(startedPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	try {
		const status = await handle.stat();
		if (
			!status.isFile() ||
			(status.mode & 0o777) !== 0o600 ||
			status.size !== expectedBytes.byteLength ||
			(await realpath(startedPath)) !== startedPath
		) {
			throw new TypeError("D708 execution-started marker ownership is invalid");
		}
		const bytes = new Uint8Array(await handle.readFile());
		if (!Buffer.from(bytes).equals(expectedBytes)) {
			throw new TypeError("D708 execution-started marker bytes are not exact");
		}
	} finally {
		await handle.close();
	}
}

export async function validatePersistedD708DispatchClaimAtPrivateRoot(
	privateRootInput: string,
	claimInput: PersistedD708SingleUseDispatchClaimV1 | undefined,
): Promise<{
	readonly privateRoot: string;
	readonly claimPath: string;
	readonly claimDigest: string;
}> {
	const privateRoot = await assertSafePrivateRoot(privateRootInput);
	const claimPath = join(privateRoot, D708_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
	const claimFile = join(claimPath, D708_CLAIM_FILE);
	const status = await lstat(claimPath);
	if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o700) {
		throw new TypeError("D708 persisted claim ownership is invalid");
	}
	if ((await realpath(claimPath)) !== claimPath) {
		throw new TypeError("D708 persisted claim escaped its operator-private path");
	}
	const expected = createClaim();
	const expectedBytes = strictJsonCodec.encode(expected);
	const handle = await openFile(claimFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	let persistedBytes: Uint8Array;
	try {
		const fileStatus = await handle.stat();
		if (
			!fileStatus.isFile() ||
			(fileStatus.mode & 0o777) !== 0o600 ||
			fileStatus.size !== expectedBytes.byteLength ||
			(await realpath(claimFile)) !== claimFile
		) {
			throw new TypeError("D708 persisted claim file ownership is invalid");
		}
		persistedBytes = new Uint8Array(await handle.readFile());
	} finally {
		await handle.close();
	}
	if (!Buffer.from(persistedBytes).equals(expectedBytes)) {
		throw new TypeError("D708 persisted claim bytes are not exact");
	}
	if (
		claimInput !== undefined &&
		(claimInput.claimPath !== claimPath || claimInput.claimDigest !== expected.claimDigest)
	) {
		throw new TypeError("D708 persisted claim capability does not match exact bytes");
	}
	return Object.freeze({ privateRoot, claimPath, claimDigest: expected.claimDigest });
}

export async function markPersistedD708DispatchClaimFailed(
	claimInput: PersistedD708SingleUseDispatchClaimV1,
): Promise<void> {
	return markPersistedD708DispatchClaimFailedAtPrivateRoot(
		D691_PRIVATE_PERSISTENCE_ROOT,
		claimInput,
	);
}

export async function markPersistedD708DispatchClaimFailedAtPrivateRoot(
	privateRootInput: string,
	claimInput: PersistedD708SingleUseDispatchClaimV1,
): Promise<void> {
	const { privateRoot, claimPath } = await validatePersistedD708DispatchClaimAtPrivateRoot(
		privateRootInput,
		claimInput,
	);
	const decisionPath = join(claimPath, D708_EXECUTION_STATE_DIRECTORY);
	try {
		await mkdir(decisionPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D708 claim already has a terminal execution decision");
		}
		throw error;
	}
	await writePrivateFile(
		join(decisionPath, D708_EXECUTION_FAILED_FILE),
		strictJsonCodec.encode({ disposition: "terminal-failure-before-complete-generation" }),
	);
	await syncDirectory(decisionPath);
	await syncDirectory(claimPath);
	await syncDirectory(privateRoot);
}
