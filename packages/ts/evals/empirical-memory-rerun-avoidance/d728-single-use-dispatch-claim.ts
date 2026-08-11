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
	D728_BUDGET_LIMITS,
	D728_COORDINATES_DIGEST,
	D728_D727_QUALIFICATION_COORDINATES,
	D728_DECISION_REF,
	D728_DECISION_REVISION,
	D728_DISPATCH_CLAIM_REF,
	D728_GENERATION_REF,
} from "./d728-coordinates.js";
import { D728_IMPLEMENTATION_MANIFEST_DIGEST } from "./d728-implementation-manifest.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export const D728_DISPATCH_CLAIM_SCHEMA =
	"graphrefly.b112.d728.single-use-dispatch-claim.v1" as const;
export const D728_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);

type ClaimScope = "live-fixed-root" | "injected-test-root";

export interface D728PersistedDispatchClaimV1 {
	readonly schemaVersion: typeof D728_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D728_DISPATCH_CLAIM_REF;
	readonly decisionRef: typeof D728_DECISION_REF;
	readonly decisionRevision: typeof D728_DECISION_REVISION;
	readonly generationRef: typeof D728_GENERATION_REF;
	readonly scope: ClaimScope;
	readonly blockCount: 1;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d727QualificationBundleDigest: string;
	readonly d728PreLiveBundleDigest: string;
	readonly pricingReadDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
}

export interface D728ExecutionAuthorityV1 {
	readonly revision: "graphrefly.b112.d728.execution-authority.v1";
	readonly scope: ClaimScope;
	readonly claim: D728PersistedDispatchClaimV1;
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
		readonly d728PreLiveBundleDigest: string;
	},
) {
	const candidate = record(input, "d728.claim.input");
	exactKeys(
		candidate,
		["d728PreLiveBundleDigest", "pricingReadDigest", "zeroByokObservationDigest"],
		"d728.claim.input",
	);
	return strictSnapshot({
		schemaVersion: D728_DISPATCH_CLAIM_SCHEMA,
		claimRef: D728_DISPATCH_CLAIM_REF,
		decisionRef: D728_DECISION_REF,
		decisionRevision: D728_DECISION_REVISION,
		generationRef: D728_GENERATION_REF,
		scope,
		blockCount: 1 as const,
		blockHardCapMicrousd: D728_BUDGET_LIMITS.maxCostMicrousd,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
		coordinatesDigest: D728_COORDINATES_DIGEST,
		implementationManifestDigest: D728_IMPLEMENTATION_MANIFEST_DIGEST,
		d727QualificationBundleDigest: D728_D727_QUALIFICATION_COORDINATES.bundleDigest,
		d728PreLiveBundleDigest: digest(candidate.d728PreLiveBundleDigest, "d728.claim.preLive"),
		pricingReadDigest: digest(candidate.pricingReadDigest, "d728.claim.pricing"),
		zeroByokObservationDigest: digest(candidate.zeroByokObservationDigest, "d728.claim.zeroByok"),
	});
}

async function acquire(
	privateRootValue: string,
	scope: ClaimScope,
	input: {
		readonly pricingReadDigest: string;
		readonly zeroByokObservationDigest: string;
		readonly d728PreLiveBundleDigest: string;
	},
): Promise<D728PersistedDispatchClaimV1> {
	const requestedRoot = resolve(privateRootValue);
	const privateRoot = await realpath(requestedRoot);
	if (privateRoot !== requestedRoot) throw new TypeError("D728 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
		throw new TypeError("D728 private root ownership or mode is invalid");
	const claimRoot = join(privateRoot, `.${D728_DISPATCH_CLAIM_REF}`);
	await mkdir(claimRoot, { recursive: false, mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const claimRootStat = await lstat(claimRoot);
	const claimMaterial = material(scope, input);
	const claim = strictSnapshot({
		...claimMaterial,
		claimDigest: empiricalStrictJsonDigest(claimMaterial),
	}) as D728PersistedDispatchClaimV1;
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
			throw new TypeError("D728 dispatch claim readback drifted");
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

export async function acquireD728SingleUseDispatchClaim(input: {
	readonly pricingReadDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly d728PreLiveBundleDigest: string;
}): Promise<D728PersistedDispatchClaimV1> {
	return acquire(D728_PRIVATE_ROOT, "live-fixed-root", input);
}

export async function acquireD728SingleUseDispatchClaimAtRoot(
	privateRoot: string,
	input: {
		readonly pricingReadDigest: string;
		readonly zeroByokObservationDigest: string;
		readonly d728PreLiveBundleDigest: string;
	},
): Promise<D728PersistedDispatchClaimV1> {
	return acquire(privateRoot, "injected-test-root", input);
}

async function revalidate(claim: D728PersistedDispatchClaimV1, state: ClaimState): Promise<void> {
	const rootStat = await lstat(state.root);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		rootStat.dev !== state.rootIdentity.dev ||
		rootStat.ino !== state.rootIdentity.ino ||
		(await realpath(state.root)) !== state.root
	)
		throw new TypeError("D728 durable claim directory drifted");
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
			throw new TypeError("D728 durable claim file drifted");
	} finally {
		await reader.close();
	}
	literal(
		claim.claimDigest,
		empiricalStrictJsonDigest(
			material(state.scope, {
				d728PreLiveBundleDigest: claim.d728PreLiveBundleDigest,
				pricingReadDigest: claim.pricingReadDigest,
				zeroByokObservationDigest: claim.zeroByokObservationDigest,
			}),
		),
		"d728.claim.digest",
	);
}

export async function consumeD728DispatchClaimForExecution(input: {
	readonly claim: D728PersistedDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}): Promise<D728ExecutionAuthorityV1> {
	const candidate = record(input, "d728.execution.input");
	exactKeys(candidate, ["claim", "currentKeyAdmission"], "d728.execution.input");
	const claim = candidate.claim as D728PersistedDispatchClaimV1;
	const state = typeof claim === "object" && claim !== null ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D728 claim is not fresh and constructed");
	claims.delete(claim);
	await revalidate(claim, state);
	const admission = consumeOpenRouterCurrentKeySpendAdmission(
		candidate.currentKeyAdmission as OpenRouterCurrentKeySpendAdmissionV1,
	);
	if (
		admission.limitMicrousd !== 32_000_000 ||
		admission.remainingMicrousd < D728_BUDGET_LIMITS.maxCostMicrousd ||
		admission.limitReset !== "none" ||
		admission.isManagementKey
	)
		throw new TypeError("D728 current-key admission is outside authority");
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
		revision: "graphrefly.b112.d728.execution-authority.v1" as const,
		scope: state.scope,
		claim,
		currentKeyAdmission: admission,
	});
	authorities.add(authority);
	return authority;
}

export function consumeD728ExecutionAuthority(value: unknown): D728ExecutionAuthorityV1 {
	if (typeof value !== "object" || value === null || !authorities.delete(value))
		throw new TypeError("D728 execution authority must be same-process and single-use");
	return value as D728ExecutionAuthorityV1;
}
