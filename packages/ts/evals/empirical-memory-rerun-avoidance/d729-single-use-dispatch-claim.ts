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
	D729_BUDGET_LIMITS,
	D729_COORDINATES_DIGEST,
	D729_D727_QUALIFICATION_COORDINATES,
	D729_DECISION_REF,
	D729_DECISION_REVISION,
	D729_DISPATCH_CLAIM_REF,
	D729_GENERATION_REF,
} from "./d729-coordinates.js";
import { D729_IMPLEMENTATION_MANIFEST_DIGEST } from "./d729-implementation-manifest.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export const D729_DISPATCH_CLAIM_SCHEMA =
	"graphrefly.b112.d729.single-use-dispatch-claim.v1" as const;
export const D729_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);

type ClaimScope = "live-fixed-root" | "injected-test-root";

export interface D729PersistedDispatchClaimV1 {
	readonly schemaVersion: typeof D729_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D729_DISPATCH_CLAIM_REF;
	readonly decisionRef: typeof D729_DECISION_REF;
	readonly decisionRevision: typeof D729_DECISION_REVISION;
	readonly generationRef: typeof D729_GENERATION_REF;
	readonly scope: ClaimScope;
	readonly blockCount: 1;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d727QualificationBundleDigest: string;
	readonly d729PreLiveBundleDigest: string;
	readonly pricingReadDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
}

export interface D729ExecutionAuthorityV1 {
	readonly revision: "graphrefly.b112.d729.execution-authority.v1";
	readonly scope: ClaimScope;
	readonly claim: D729PersistedDispatchClaimV1;
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
		readonly zeroByokObservationDigest: string;
		readonly d729PreLiveBundleDigest: string;
	},
) {
	const candidate = record(input, "d729.claim.input");
	exactKeys(
		candidate,
		["d729PreLiveBundleDigest", "pricingReadDigest", "zeroByokObservationDigest"],
		"d729.claim.input",
	);
	return strictSnapshot({
		schemaVersion: D729_DISPATCH_CLAIM_SCHEMA,
		claimRef: D729_DISPATCH_CLAIM_REF,
		decisionRef: D729_DECISION_REF,
		decisionRevision: D729_DECISION_REVISION,
		generationRef: D729_GENERATION_REF,
		scope,
		blockCount: 1 as const,
		blockHardCapMicrousd: D729_BUDGET_LIMITS.maxCostMicrousd,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
		coordinatesDigest: D729_COORDINATES_DIGEST,
		implementationManifestDigest: D729_IMPLEMENTATION_MANIFEST_DIGEST,
		d727QualificationBundleDigest: D729_D727_QUALIFICATION_COORDINATES.bundleDigest,
		d729PreLiveBundleDigest: digest(candidate.d729PreLiveBundleDigest, "d729.claim.preLive"),
		pricingReadDigest: digest(candidate.pricingReadDigest, "d729.claim.pricing"),
		zeroByokObservationDigest: digest(candidate.zeroByokObservationDigest, "d729.claim.zeroByok"),
	});
}

async function acquire(
	privateRootValue: string,
	scope: ClaimScope,
	input: {
		readonly pricingReadDigest: string;
		readonly zeroByokObservationDigest: string;
		readonly d729PreLiveBundleDigest: string;
	},
): Promise<D729PersistedDispatchClaimV1> {
	const requestedRoot = resolve(privateRootValue);
	const privateRoot = await realpath(requestedRoot);
	if (privateRoot !== requestedRoot) throw new TypeError("D729 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
		throw new TypeError("D729 private root ownership or mode is invalid");
	const claimRoot = join(privateRoot, `.${D729_DISPATCH_CLAIM_REF}`);
	await mkdir(claimRoot, { recursive: false, mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const claimRootStat = await lstat(claimRoot);
	const claimMaterial = material(scope, input);
	const claim = strictSnapshot({
		...claimMaterial,
		claimDigest: empiricalStrictJsonDigest(claimMaterial),
	}) as D729PersistedDispatchClaimV1;
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
			throw new TypeError("D729 dispatch claim readback drifted");
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

export async function acquireD729SingleUseDispatchClaim(input: {
	readonly pricingReadDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly d729PreLiveBundleDigest: string;
}): Promise<D729PersistedDispatchClaimV1> {
	return acquire(D729_PRIVATE_ROOT, "live-fixed-root", input);
}

export async function acquireD729SingleUseDispatchClaimAtRoot(
	privateRoot: string,
	input: {
		readonly pricingReadDigest: string;
		readonly zeroByokObservationDigest: string;
		readonly d729PreLiveBundleDigest: string;
	},
): Promise<D729PersistedDispatchClaimV1> {
	return acquire(privateRoot, "injected-test-root", input);
}

async function revalidate(claim: D729PersistedDispatchClaimV1, state: ClaimState): Promise<void> {
	const rootStat = await lstat(state.root);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		rootStat.dev !== state.rootIdentity.dev ||
		rootStat.ino !== state.rootIdentity.ino ||
		(await realpath(state.root)) !== state.root
	)
		throw new TypeError("D729 durable claim directory drifted");
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
			throw new TypeError("D729 durable claim file drifted");
	} finally {
		await reader.close();
	}
	literal(
		claim.claimDigest,
		empiricalStrictJsonDigest(
			material(state.scope, {
				d729PreLiveBundleDigest: claim.d729PreLiveBundleDigest,
				pricingReadDigest: claim.pricingReadDigest,
				zeroByokObservationDigest: claim.zeroByokObservationDigest,
			}),
		),
		"d729.claim.digest",
	);
}

export async function consumeD729DispatchClaimForExecution(input: {
	readonly claim: D729PersistedDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}): Promise<D729ExecutionAuthorityV1> {
	const candidate = record(input, "d729.execution.input");
	exactKeys(candidate, ["claim", "currentKeyAdmission"], "d729.execution.input");
	const claim = candidate.claim as D729PersistedDispatchClaimV1;
	const state = typeof claim === "object" && claim !== null ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D729 claim is not fresh and constructed");
	claims.delete(claim);
	await revalidate(claim, state);
	const admission = consumeOpenRouterCurrentKeySpendAdmission(
		candidate.currentKeyAdmission as OpenRouterCurrentKeySpendAdmissionV1,
	);
	if (
		admission.limitMicrousd !== 32_000_000 ||
		admission.remainingMicrousd < D729_BUDGET_LIMITS.maxCostMicrousd ||
		admission.limitReset !== "none" ||
		admission.isManagementKey
	)
		throw new TypeError("D729 current-key admission is outside authority");
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
		revision: "graphrefly.b112.d729.execution-authority.v1" as const,
		scope: state.scope,
		claim,
		currentKeyAdmission: admission,
	});
	authorities.add(authority);
	return authority;
}

export function consumeD729ExecutionAuthority(value: unknown): D729ExecutionAuthorityV1 {
	if (typeof value !== "object" || value === null || !authorities.delete(value))
		throw new TypeError("D729 execution authority must be same-process and single-use");
	return value as D729ExecutionAuthorityV1;
}
