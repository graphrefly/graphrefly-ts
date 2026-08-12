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
import { D731_IMPLEMENTATION_MANIFEST_DIGEST } from "./d731-implementation-manifest.js";
import {
	D732_BUDGET_LIMITS,
	D732_COORDINATES_DIGEST,
	D732_D731_QUALIFICATION_COORDINATES,
	D732_DECISION_REF,
	D732_DECISION_REVISION,
	D732_DISPATCH_CLAIM_REF,
	D732_GENERATION_REF,
} from "./d732-coordinates.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export const D732_DISPATCH_CLAIM_SCHEMA =
	"graphrefly.b112.d732.single-use-dispatch-claim.v1" as const;
export const D732_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);

type ClaimScope = "live-fixed-root" | "injected-test-root";

export interface D732PersistedDispatchClaimV1 {
	readonly schemaVersion: typeof D732_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D732_DISPATCH_CLAIM_REF;
	readonly decisionRef: typeof D732_DECISION_REF;
	readonly decisionRevision: typeof D732_DECISION_REVISION;
	readonly generationRef: typeof D732_GENERATION_REF;
	readonly scope: ClaimScope;
	readonly blockCount: 1;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d731QualificationBundleDigest: string;
	readonly d731PreLiveBundleDigest: string;
	readonly pricingReadDigest: string;
	readonly routeEligibilityDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
}

export interface D732ExecutionAuthorityV1 {
	readonly revision: "graphrefly.b112.d732.execution-authority.v1";
	readonly scope: ClaimScope;
	readonly claim: D732PersistedDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}

interface ClaimState {
	readonly root: string;
	readonly file: string;
	readonly scope: ClaimScope;
	readonly bytes: Uint8Array;
	readonly rootIdentity: { readonly dev: number; readonly ino: number };
	readonly fileIdentity: { readonly dev: number; readonly ino: number };
}

const claims = new WeakMap<object, ClaimState>();
const authorities = new WeakSet<object>();

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

function material(
	scope: ClaimScope,
	input: {
		readonly pricingReadDigest: string;
		readonly routeEligibilityDigest: string;
		readonly zeroByokObservationDigest: string;
		readonly d731PreLiveBundleDigest: string;
	},
) {
	const candidate = record(input, "d732.claim.input");
	exactKeys(
		candidate,
		[
			"d731PreLiveBundleDigest",
			"pricingReadDigest",
			"routeEligibilityDigest",
			"zeroByokObservationDigest",
		],
		"d732.claim.input",
	);
	return strictSnapshot({
		schemaVersion: D732_DISPATCH_CLAIM_SCHEMA,
		claimRef: D732_DISPATCH_CLAIM_REF,
		decisionRef: D732_DECISION_REF,
		decisionRevision: D732_DECISION_REVISION,
		generationRef: D732_GENERATION_REF,
		scope,
		blockCount: 1 as const,
		blockHardCapMicrousd: D732_BUDGET_LIMITS.maxCostMicrousd,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
		coordinatesDigest: D732_COORDINATES_DIGEST,
		implementationManifestDigest: D731_IMPLEMENTATION_MANIFEST_DIGEST,
		d731QualificationBundleDigest: D732_D731_QUALIFICATION_COORDINATES.bundleDigest,
		d731PreLiveBundleDigest: digest(candidate.d731PreLiveBundleDigest, "d732.claim.preLive"),
		pricingReadDigest: digest(candidate.pricingReadDigest, "d732.claim.pricing"),
		routeEligibilityDigest: digest(candidate.routeEligibilityDigest, "d732.claim.eligibility"),
		zeroByokObservationDigest: digest(candidate.zeroByokObservationDigest, "d732.claim.zeroByok"),
	});
}

async function acquire(
	privateRootValue: string,
	scope: ClaimScope,
	input: {
		readonly pricingReadDigest: string;
		readonly routeEligibilityDigest: string;
		readonly zeroByokObservationDigest: string;
		readonly d731PreLiveBundleDigest: string;
	},
): Promise<D732PersistedDispatchClaimV1> {
	const requestedRoot = resolve(privateRootValue);
	const privateRoot = await realpath(requestedRoot);
	if (privateRoot !== requestedRoot) throw new TypeError("D732 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
		throw new TypeError("D732 private root ownership or mode is invalid");
	const claimRoot = join(privateRoot, `.${D732_DISPATCH_CLAIM_REF}`);
	await mkdir(claimRoot, { recursive: false, mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const claimRootStat = await lstat(claimRoot);
	const claimMaterial = material(scope, input);
	const claim = strictSnapshot({
		...claimMaterial,
		claimDigest: empiricalStrictJsonDigest(claimMaterial),
	}) as D732PersistedDispatchClaimV1;
	const bytes = strictJsonCodec.encode(claim);
	const claimFile = join(claimRoot, "dispatch-claim.v1.json");
	const writer = await open(
		claimFile,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await writer.writeFile(bytes);
		await writer.sync();
	} finally {
		await writer.close();
	}
	await chmod(claimFile, 0o600);
	await syncDirectory(claimRoot);
	await syncDirectory(privateRoot);
	const reader = await open(claimFile, constants.O_RDONLY | constants.O_NOFOLLOW);
	let fileStat: Awaited<ReturnType<typeof reader.stat>>;
	try {
		fileStat = await reader.stat();
		if (
			!fileStat.isFile() ||
			(fileStat.mode & 0o777) !== 0o600 ||
			fileStat.nlink !== 1 ||
			fileStat.size !== bytes.byteLength ||
			!sameBytes(new Uint8Array(await reader.readFile()), bytes)
		)
			throw new TypeError("D732 dispatch claim readback drifted");
	} finally {
		await reader.close();
	}
	claims.set(claim, {
		root: claimRoot,
		file: claimFile,
		scope,
		bytes,
		rootIdentity: { dev: claimRootStat.dev, ino: claimRootStat.ino },
		fileIdentity: { dev: fileStat.dev, ino: fileStat.ino },
	});
	return claim;
}

export async function acquireD732SingleUseDispatchClaim(input: {
	readonly pricingReadDigest: string;
	readonly routeEligibilityDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly d731PreLiveBundleDigest: string;
}): Promise<D732PersistedDispatchClaimV1> {
	return acquire(D732_PRIVATE_ROOT, "live-fixed-root", input);
}

export async function acquireD732SingleUseDispatchClaimAtRoot(
	privateRoot: string,
	input: {
		readonly pricingReadDigest: string;
		readonly routeEligibilityDigest: string;
		readonly zeroByokObservationDigest: string;
		readonly d731PreLiveBundleDigest: string;
	},
): Promise<D732PersistedDispatchClaimV1> {
	return acquire(privateRoot, "injected-test-root", input);
}

async function revalidate(claim: D732PersistedDispatchClaimV1, state: ClaimState): Promise<void> {
	const rootStat = await lstat(state.root);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		rootStat.dev !== state.rootIdentity.dev ||
		rootStat.ino !== state.rootIdentity.ino ||
		(await realpath(state.root)) !== state.root
	)
		throw new TypeError("D732 durable claim directory drifted");
	const reader = await open(state.file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await reader.stat();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== state.fileIdentity.dev ||
			stat.ino !== state.fileIdentity.ino ||
			!sameBytes(new Uint8Array(await reader.readFile()), state.bytes)
		)
			throw new TypeError("D732 durable claim file drifted");
	} finally {
		await reader.close();
	}
	literal(
		claim.claimDigest,
		empiricalStrictJsonDigest(
			material(state.scope, {
				d731PreLiveBundleDigest: claim.d731PreLiveBundleDigest,
				pricingReadDigest: claim.pricingReadDigest,
				routeEligibilityDigest: claim.routeEligibilityDigest,
				zeroByokObservationDigest: claim.zeroByokObservationDigest,
			}),
		),
		"d732.claim.digest",
	);
}

export async function consumeD732DispatchClaimForExecution(input: {
	readonly claim: D732PersistedDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}): Promise<D732ExecutionAuthorityV1> {
	const candidate = record(input, "d732.execution.input");
	exactKeys(candidate, ["claim", "currentKeyAdmission"], "d732.execution.input");
	const claim = candidate.claim as D732PersistedDispatchClaimV1;
	const state = typeof claim === "object" && claim !== null ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D732 claim is not fresh and constructed");
	claims.delete(claim);
	await revalidate(claim, state);
	const admission = consumeOpenRouterCurrentKeySpendAdmission(
		candidate.currentKeyAdmission as OpenRouterCurrentKeySpendAdmissionV1,
	);
	if (
		admission.limitMicrousd !== 32_000_000 ||
		admission.remainingMicrousd < D732_BUDGET_LIMITS.maxCostMicrousd ||
		admission.limitReset !== "none" ||
		admission.isManagementKey
	)
		throw new TypeError("D732 current-key admission is outside authority");
	const executionRoot = join(state.root, "execution-started");
	await mkdir(executionRoot, { recursive: false, mode: 0o700 });
	await chmod(executionRoot, 0o700);
	const marker = strictSnapshot({
		claimDigest: claim.claimDigest,
		currentKeyAdmissionDigest: admission.admissionDigest,
		remainingMicrousd: admission.remainingMicrousd,
	});
	const markerBytes = strictJsonCodec.encode(marker);
	const markerPath = join(executionRoot, "current-key-admission.v1.json");
	const writer = await open(
		markerPath,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await writer.writeFile(markerBytes);
		await writer.sync();
	} finally {
		await writer.close();
	}
	await syncDirectory(executionRoot);
	await syncDirectory(state.root);
	const authority = Object.freeze({
		revision: "graphrefly.b112.d732.execution-authority.v1" as const,
		scope: state.scope,
		claim,
		currentKeyAdmission: admission,
	});
	authorities.add(authority);
	return authority;
}

export function consumeD732ExecutionAuthority(value: unknown): D732ExecutionAuthorityV1 {
	if (typeof value !== "object" || value === null || !authorities.delete(value))
		throw new TypeError("D732 execution authority must be same-process and single-use");
	return value as D732ExecutionAuthorityV1;
}
