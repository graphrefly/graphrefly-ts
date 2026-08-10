import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open as openFile, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, exactKeys, record, strictSnapshot } from "./canonical.js";
import { D691_PRIVATE_PERSISTENCE_ROOT } from "./d691-historical-transfer-live.js";
import {
	consumeD711CurrentKeyExecutionAdmission,
	type D711CurrentKeyExecutionAdmissionV1,
} from "./d711-current-key-execution-admission.js";
import {
	consumeD711DispatchClaimAuthorization,
	type D711DispatchClaimAuthorizationV1,
} from "./d711-fresh-pricing-live.js";
import {
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D711_SINGLE_USE_DISPATCH_CLAIM_SCHEMA =
	"graphrefly.private-solution-eval.d711-single-use-dispatch-claim.v1" as const;
export const D711_SINGLE_USE_DISPATCH_CLAIM_REF =
	"d711-d710-untyped-http-429-retry-replacement-2026-08-10-v1" as const;
export const D711_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY =
	`.${D711_SINGLE_USE_DISPATCH_CLAIM_REF}` as const;
export const D711_LIVE_GENERATION_REF =
	"d711-d710-untyped-http-429-retry-replacement-2026-08-10-v1" as const;
const D711_CLAIM_FILE = "dispatch-claim.v1.json";
export const D711_EXECUTION_STATE_DIRECTORY = ".execution-decision" as const;
export const D711_EXECUTION_STARTED_FILE = "execution-started.v1.json" as const;
export const D711_EXECUTION_FAILED_FILE = "terminal-failed.v1.json" as const;

export interface D711SingleUseDispatchClaimV1 {
	readonly schemaVersion: typeof D711_SINGLE_USE_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D711_SINGLE_USE_DISPATCH_CLAIM_REF;
	readonly decisionRef: "decision.D711";
	readonly decisionRevision: "decision.D711.2026-08-10.v1";
	readonly generationRef: typeof D711_LIVE_GENERATION_REF;
	readonly disposition: "consumed-after-fresh-pricing-credential-and-zero-byok-before-current-key-or-provider";
	readonly blockCount: 1;
	readonly maxSpendMicrousd: 6_000_000;
	readonly noResetTotalLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface PersistedD711SingleUseDispatchClaimV1 {
	readonly claimPath: string;
	readonly claimDigest: string;
}

export interface AcquiredD711SingleUseDispatchClaimV1
	extends PersistedD711SingleUseDispatchClaimV1 {
	readonly currentKeyExecutionAdmission: D711CurrentKeyExecutionAdmissionV1;
}

const executionClaims = new WeakSet<object>();

function createClaim(): D711SingleUseDispatchClaimV1 {
	const material = strictSnapshot({
		schemaVersion: D711_SINGLE_USE_DISPATCH_CLAIM_SCHEMA,
		claimRef: D711_SINGLE_USE_DISPATCH_CLAIM_REF,
		decisionRef: "decision.D711" as const,
		decisionRevision: "decision.D711.2026-08-10.v1" as const,
		generationRef: D711_LIVE_GENERATION_REF,
		disposition:
			"consumed-after-fresh-pricing-credential-and-zero-byok-before-current-key-or-provider" as const,
		blockCount: 1 as const,
		maxSpendMicrousd: 6_000_000 as const,
		noResetTotalLimitMicrousd: 32_000_000 as const,
	});
	return strictSnapshot({ ...material, claimDigest: empiricalStrictJsonDigest(material) });
}

export async function acquireD711SingleUseDispatchClaim(input: {
	readonly authorization: D711DispatchClaimAuthorizationV1;
	readonly monotonicNowMs: number;
}): Promise<PersistedD711SingleUseDispatchClaimV1> {
	const candidate = record(input, "d711.dispatchClaimAdmission");
	exactKeys(candidate, ["authorization", "monotonicNowMs"], "d711.dispatchClaimAdmission");
	if (typeof candidate.monotonicNowMs !== "number") {
		throw new TypeError("D711 dispatch claim monotonic clock is invalid");
	}
	consumeD711DispatchClaimAuthorization(candidate.authorization, candidate.monotonicNowMs);
	return acquireD711SingleUseDispatchClaimAtPrivateRoot(D691_PRIVATE_PERSISTENCE_ROOT);
}

export async function acquireD711SingleUseDispatchClaimAtPrivateRoot(
	privateRootInput: string,
): Promise<PersistedD711SingleUseDispatchClaimV1> {
	const privateRoot = await assertSafePrivateRoot(privateRootInput);
	const claimPath = join(privateRoot, D711_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
	try {
		await mkdir(claimPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D711 paid dispatch is already claimed");
		}
		throw error;
	}

	try {
		const status = await lstat(claimPath);
		if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o700) {
			throw new TypeError("D711 dispatch claim does not have exact 0700 ownership");
		}
		if ((await realpath(claimPath)) !== claimPath) {
			throw new TypeError("D711 dispatch claim escaped its operator-private path");
		}
		const claim = createClaim();
		const claimBytes = strictJsonCodec.encode(claim);
		const claimFile = join(claimPath, D711_CLAIM_FILE);
		await writePrivateFile(claimFile, claimBytes);
		await syncDirectory(claimPath);
		await syncDirectory(privateRoot);
		const readback = new Uint8Array(await readFile(claimFile));
		if (!Buffer.from(readback).equals(claimBytes)) {
			throw new TypeError("D711 dispatch claim readback did not match canonical bytes");
		}
		return Object.freeze({ claimPath, claimDigest: claim.claimDigest });
	} catch (error) {
		throw new Error("D711 paid dispatch claim is consumed but not fully durable", {
			cause: error,
		});
	}
}

export function consumeD711SingleUseDispatchClaim(
	value: unknown,
): AcquiredD711SingleUseDispatchClaimV1 {
	if (value === null || typeof value !== "object" || !executionClaims.delete(value)) {
		throw new TypeError("D711 live block requires its same-process single-use claim");
	}
	const claim = value as AcquiredD711SingleUseDispatchClaimV1;
	if (
		typeof claim.claimPath !== "string" ||
		claim.claimPath.length === 0 ||
		typeof claim.claimDigest !== "string" ||
		!/^sha256:[0-9a-f]{64}$/.test(claim.claimDigest)
	) {
		throw new TypeError("D711 live claim is malformed");
	}
	return claim;
}

export async function consumePersistedD711DispatchClaimForExecution(
	currentKeyExecutionAdmission: D711CurrentKeyExecutionAdmissionV1,
): Promise<AcquiredD711SingleUseDispatchClaimV1> {
	return consumePersistedD711DispatchClaimForExecutionAtPrivateRoot(
		D691_PRIVATE_PERSISTENCE_ROOT,
		currentKeyExecutionAdmission,
	);
}

export async function consumePersistedD711DispatchClaimForExecutionAtPrivateRoot(
	privateRootInput: string,
	currentKeyExecutionAdmissionInput: D711CurrentKeyExecutionAdmissionV1,
): Promise<AcquiredD711SingleUseDispatchClaimV1> {
	const persisted = await validatePersistedD711DispatchClaimAtPrivateRoot(
		privateRootInput,
		undefined,
	);
	const { privateRoot, claimPath, claimDigest } = persisted;
	const currentKeyExecutionAdmission = consumeD711CurrentKeyExecutionAdmission(
		currentKeyExecutionAdmissionInput,
	);
	const executionPath = join(claimPath, D711_EXECUTION_STATE_DIRECTORY);
	try {
		await mkdir(executionPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D711 live execution already has a terminal decision");
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
		throw new TypeError("D711 execution decision ownership is invalid");
	}
	const startedBytes = strictJsonCodec.encode({
		disposition: "execution-started-after-current-key-admission",
		currentKeyAdmissionDigest: currentKeyExecutionAdmission.admission.admissionDigest,
	});
	await writePrivateFile(join(executionPath, D711_EXECUTION_STARTED_FILE), startedBytes);
	await syncDirectory(executionPath);
	await syncDirectory(claimPath);
	await syncDirectory(privateRoot);
	await validateD711ExecutionStartedMarker(
		claimPath,
		currentKeyExecutionAdmission.admission.admissionDigest,
	);
	const acquired = Object.freeze({ claimPath, claimDigest, currentKeyExecutionAdmission });
	executionClaims.add(acquired);
	return acquired;
}

export async function validateD711ExecutionStartedMarker(
	claimPath: string,
	currentKeyAdmissionDigest: string,
): Promise<void> {
	const decisionPath = join(claimPath, D711_EXECUTION_STATE_DIRECTORY);
	const startedPath = join(decisionPath, D711_EXECUTION_STARTED_FILE);
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
		throw new TypeError("D711 execution decision ownership is invalid");
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
			throw new TypeError("D711 execution-started marker ownership is invalid");
		}
		const bytes = new Uint8Array(await handle.readFile());
		if (!Buffer.from(bytes).equals(expectedBytes)) {
			throw new TypeError("D711 execution-started marker bytes are not exact");
		}
	} finally {
		await handle.close();
	}
}

export async function validatePersistedD711DispatchClaimAtPrivateRoot(
	privateRootInput: string,
	claimInput: PersistedD711SingleUseDispatchClaimV1 | undefined,
): Promise<{
	readonly privateRoot: string;
	readonly claimPath: string;
	readonly claimDigest: string;
}> {
	const privateRoot = await assertSafePrivateRoot(privateRootInput);
	const claimPath = join(privateRoot, D711_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
	const claimFile = join(claimPath, D711_CLAIM_FILE);
	const status = await lstat(claimPath);
	if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o700) {
		throw new TypeError("D711 persisted claim ownership is invalid");
	}
	if ((await realpath(claimPath)) !== claimPath) {
		throw new TypeError("D711 persisted claim escaped its operator-private path");
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
			throw new TypeError("D711 persisted claim file ownership is invalid");
		}
		persistedBytes = new Uint8Array(await handle.readFile());
	} finally {
		await handle.close();
	}
	if (!Buffer.from(persistedBytes).equals(expectedBytes)) {
		throw new TypeError("D711 persisted claim bytes are not exact");
	}
	if (
		claimInput !== undefined &&
		(claimInput.claimPath !== claimPath || claimInput.claimDigest !== expected.claimDigest)
	) {
		throw new TypeError("D711 persisted claim capability does not match exact bytes");
	}
	return Object.freeze({ privateRoot, claimPath, claimDigest: expected.claimDigest });
}

export async function markPersistedD711DispatchClaimFailed(
	claimInput: PersistedD711SingleUseDispatchClaimV1,
): Promise<void> {
	return markPersistedD711DispatchClaimFailedAtPrivateRoot(
		D691_PRIVATE_PERSISTENCE_ROOT,
		claimInput,
	);
}

export async function markPersistedD711DispatchClaimFailedAtPrivateRoot(
	privateRootInput: string,
	claimInput: PersistedD711SingleUseDispatchClaimV1,
): Promise<void> {
	const { privateRoot, claimPath } = await validatePersistedD711DispatchClaimAtPrivateRoot(
		privateRootInput,
		claimInput,
	);
	const decisionPath = join(claimPath, D711_EXECUTION_STATE_DIRECTORY);
	try {
		await mkdir(decisionPath, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D711 claim already has a terminal execution decision");
		}
		throw error;
	}
	await writePrivateFile(
		join(decisionPath, D711_EXECUTION_FAILED_FILE),
		strictJsonCodec.encode({ disposition: "terminal-failure-before-complete-generation" }),
	);
	await syncDirectory(decisionPath);
	await syncDirectory(claimPath);
	await syncDirectory(privateRoot);
}
