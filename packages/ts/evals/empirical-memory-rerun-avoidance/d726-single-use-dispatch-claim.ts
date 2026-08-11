import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	D726_BUDGET_LIMITS,
	D726_COORDINATES_DIGEST,
	D726_D725_QUALIFICATION_COORDINATES,
	D726_DECISION_REF,
	D726_DECISION_REVISION,
	D726_GENERATION_REF,
} from "./d726-coordinates.js";
import { D726_IMPLEMENTATION_MANIFEST_DIGEST } from "./d726-implementation-manifest.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export { D726_DECISION_REF, D726_DECISION_REVISION, D726_GENERATION_REF };
export const D726_DISPATCH_CLAIM_SCHEMA =
	"graphrefly.b112.d726.single-use-dispatch-claim.v2" as const;
export const D726_DISPATCH_CLAIM_REF =
	"d726-d725-terminal-http-live-replacement-2026-08-11-v2" as const;
export const D726_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);

type ClaimScope = "live-fixed-root" | "injected-test-root";

export interface D726PersistedDispatchClaimV1 {
	readonly schemaVersion: typeof D726_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D726_DISPATCH_CLAIM_REF;
	readonly decisionRef: typeof D726_DECISION_REF;
	readonly decisionRevision: typeof D726_DECISION_REVISION;
	readonly generationRef: typeof D726_GENERATION_REF;
	readonly scope: ClaimScope;
	readonly blockCount: 1;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d725BundleArtifactSha256: string;
	readonly d725BundleDigest: string;
	readonly d725QualificationDigest: string;
	readonly pricingReadDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
}

export interface D726ExecutionAuthorityV1 {
	readonly revision: "graphrefly.b112.d726.execution-authority.v2";
	readonly scope: ClaimScope;
	readonly claim: D726PersistedDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}

interface ClaimState {
	readonly claimRoot: string;
	readonly claimFile: string;
	readonly scope: ClaimScope;
	readonly bytes: Uint8Array;
}

const acquiredClaims = new WeakMap<object, ClaimState>();
const executionAuthorities = new WeakSet<object>();

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(
		path,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function claimMaterial(
	scope: ClaimScope,
	input: {
		readonly pricingReadDigest: string;
		readonly zeroByokObservationDigest: string;
	},
) {
	const candidate = record(input, "d726.claim.input");
	exactKeys(candidate, ["pricingReadDigest", "zeroByokObservationDigest"], "d726.claim.input");
	return strictSnapshot({
		schemaVersion: D726_DISPATCH_CLAIM_SCHEMA,
		claimRef: D726_DISPATCH_CLAIM_REF,
		decisionRef: D726_DECISION_REF,
		decisionRevision: D726_DECISION_REVISION,
		generationRef: D726_GENERATION_REF,
		scope,
		blockCount: 1 as const,
		blockHardCapMicrousd: D726_BUDGET_LIMITS.maxCostMicrousd,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
		coordinatesDigest: D726_COORDINATES_DIGEST,
		implementationManifestDigest: D726_IMPLEMENTATION_MANIFEST_DIGEST,
		d725BundleArtifactSha256: D726_D725_QUALIFICATION_COORDINATES.artifactSha256,
		d725BundleDigest: D726_D725_QUALIFICATION_COORDINATES.bundleDigest,
		d725QualificationDigest: D726_D725_QUALIFICATION_COORDINATES.qualificationDigest,
		pricingReadDigest: digest(candidate.pricingReadDigest, "d726.claim.pricingReadDigest"),
		zeroByokObservationDigest: digest(
			candidate.zeroByokObservationDigest,
			"d726.claim.zeroByokObservationDigest",
		),
	});
}

async function acquireAtRoot(
	privateRootValue: string,
	scope: ClaimScope,
	input: {
		readonly pricingReadDigest: string;
		readonly zeroByokObservationDigest: string;
	},
): Promise<D726PersistedDispatchClaimV1> {
	const requestedRoot = resolve(privateRootValue);
	const privateRoot = await realpath(requestedRoot);
	if (privateRoot !== requestedRoot) throw new TypeError("D726 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		rootStat.nlink < 1
	)
		throw new TypeError("D726 private root ownership or mode is invalid");
	const claimRoot = join(privateRoot, `.${D726_DISPATCH_CLAIM_REF}`);
	await mkdir(claimRoot, { recursive: false, mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const material = claimMaterial(scope, input);
	const claim = strictSnapshot({ ...material, claimDigest: empiricalStrictJsonDigest(material) });
	const bytes = strictJsonCodec.encode(claim);
	const claimFile = join(claimRoot, "dispatch-claim.v2.json");
	const handle = await open(
		claimFile,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	await chmod(claimFile, 0o600);
	await syncDirectory(claimRoot);
	await syncDirectory(privateRoot);
	const readHandle = await open(claimFile, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await readHandle.stat();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.size !== bytes.byteLength ||
			(await realpath(claimFile)) !== claimFile ||
			!sameBytes(new Uint8Array(await readHandle.readFile()), bytes)
		)
			throw new TypeError("D726 dispatch claim readback drifted");
	} finally {
		await readHandle.close();
	}
	acquiredClaims.set(claim, { claimRoot, claimFile, scope, bytes });
	return claim as D726PersistedDispatchClaimV1;
}

export async function acquireD726SingleUseDispatchClaim(input: {
	readonly pricingReadDigest: string;
	readonly zeroByokObservationDigest: string;
}): Promise<D726PersistedDispatchClaimV1> {
	return acquireAtRoot(D726_PRIVATE_ROOT, "live-fixed-root", input);
}

export async function acquireD726SingleUseDispatchClaimAtRoot(
	privateRootValue: string,
	input: {
		readonly pricingReadDigest: string;
		readonly zeroByokObservationDigest: string;
	},
): Promise<D726PersistedDispatchClaimV1> {
	return acquireAtRoot(privateRootValue, "injected-test-root", input);
}

async function revalidateClaim(
	claim: D726PersistedDispatchClaimV1,
	state: ClaimState,
): Promise<void> {
	const claimRootStat = await lstat(state.claimRoot);
	if (
		!claimRootStat.isDirectory() ||
		claimRootStat.isSymbolicLink() ||
		(claimRootStat.mode & 0o777) !== 0o700 ||
		(await realpath(state.claimRoot)) !== state.claimRoot
	)
		throw new TypeError("D726 durable claim directory drifted");
	const handle = await open(state.claimFile, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.size !== state.bytes.byteLength ||
			!sameBytes(new Uint8Array(await handle.readFile()), state.bytes)
		)
			throw new TypeError("D726 durable claim file drifted");
	} finally {
		await handle.close();
	}
	literal(
		claim.claimDigest,
		empiricalStrictJsonDigest(
			claimMaterial(state.scope, {
				pricingReadDigest: claim.pricingReadDigest,
				zeroByokObservationDigest: claim.zeroByokObservationDigest,
			}),
		),
		"d726.claim",
	);
}

export async function consumeD726DispatchClaimForExecution(input: {
	readonly claim: D726PersistedDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}): Promise<D726ExecutionAuthorityV1> {
	const candidate = record(input, "d726.execution.input");
	exactKeys(candidate, ["claim", "currentKeyAdmission"], "d726.execution.input");
	const claim = candidate.claim as D726PersistedDispatchClaimV1;
	const state = typeof claim === "object" && claim !== null ? acquiredClaims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D726 dispatch claim is not fresh and constructed");
	acquiredClaims.delete(claim);
	await revalidateClaim(claim, state);
	const admission = consumeOpenRouterCurrentKeySpendAdmission(
		candidate.currentKeyAdmission as OpenRouterCurrentKeySpendAdmissionV1,
	);
	if (
		admission.limitMicrousd !== 32_000_000 ||
		admission.remainingMicrousd < D726_BUDGET_LIMITS.maxCostMicrousd ||
		admission.limitReset !== "none" ||
		admission.isManagementKey
	)
		throw new TypeError("D726 current-key admission is outside the approved boundary");
	const executionRoot = join(state.claimRoot, "execution-started");
	await mkdir(executionRoot, { recursive: false, mode: 0o700 });
	await chmod(executionRoot, 0o700);
	const marker = strictSnapshot({
		claimDigest: claim.claimDigest,
		currentKeyAdmissionDigest: admission.admissionDigest,
		remainingMicrousd: admission.remainingMicrousd,
	});
	const markerBytes = strictJsonCodec.encode(marker);
	const markerPath = join(executionRoot, "current-key-admission.v1.json");
	const handle = await open(
		markerPath,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(markerBytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	await chmod(markerPath, 0o600);
	await syncDirectory(executionRoot);
	await syncDirectory(state.claimRoot);
	const authority = Object.freeze({
		revision: "graphrefly.b112.d726.execution-authority.v2" as const,
		scope: state.scope,
		claim,
		currentKeyAdmission: admission,
	});
	executionAuthorities.add(authority);
	return authority;
}

export function consumeD726ExecutionAuthority(value: unknown): D726ExecutionAuthorityV1 {
	if (typeof value !== "object" || value === null || !executionAuthorities.delete(value))
		throw new TypeError("D726 execution authority must be same-process and single-use");
	return value as D726ExecutionAuthorityV1;
}
