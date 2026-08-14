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
	D777_BUDGET_LIMITS,
	D777_COORDINATES_DIGEST,
	D777_DECISION_REF,
	D777_DECISION_REVISION,
	D777_DISPATCH_CLAIM_REF,
	D777_GENERATION_REF,
	D777_HISTORICAL_BUNDLE_DIGEST,
	D777_ROUTE_PROFILE_DIGEST,
} from "./d777-coordinates.js";
import { D777_IMPLEMENTATION_MANIFEST_DIGEST } from "./d777-implementation-manifest.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export const D777_DISPATCH_CLAIM_SCHEMA =
	"graphrefly.b112.d777.single-use-dispatch-claim.v1" as const;
export const D777_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);

type Scope = "live-fixed-root" | "injected-test-root";

export interface D777PersistedDispatchClaimV1 {
	readonly schemaVersion: typeof D777_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D777_DISPATCH_CLAIM_REF;
	readonly decisionRef: typeof D777_DECISION_REF;
	readonly decisionRevision: typeof D777_DECISION_REVISION;
	readonly generationRef: typeof D777_GENERATION_REF;
	readonly scope: Scope;
	readonly coordinatesDigest: string;
	readonly historicalBundleDigest: string;
	readonly routeProfileDigest: string;
	readonly pricingReadDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly implementationManifestDigest: string;
	readonly blockCount: 1;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface D777ExecutionAuthorityV1 {
	readonly revision: "graphrefly.b112.d777.execution-authority.v1";
	readonly claim: D777PersistedDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}

interface ClaimState {
	readonly root: string;
	readonly file: string;
	readonly scope: Scope;
	readonly rootIdentity: { readonly dev: number; readonly ino: number };
	readonly fileIdentity: { readonly dev: number; readonly ino: number };
	readonly bytes: Uint8Array;
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

function claimMaterial(
	scope: Scope,
	inputValue: {
		readonly pricingReadDigest: string;
		readonly zeroByokObservationDigest: string;
		readonly implementationManifestDigest: string;
	},
) {
	const input = record(inputValue, "d777.claim.input");
	exactKeys(
		input,
		["implementationManifestDigest", "pricingReadDigest", "zeroByokObservationDigest"],
		"d777.claim.input",
	);
	literal(
		input.implementationManifestDigest,
		D777_IMPLEMENTATION_MANIFEST_DIGEST,
		"d777.claim.implementation",
	);
	return strictSnapshot({
		schemaVersion: D777_DISPATCH_CLAIM_SCHEMA,
		claimRef: D777_DISPATCH_CLAIM_REF,
		decisionRef: D777_DECISION_REF,
		decisionRevision: D777_DECISION_REVISION,
		generationRef: D777_GENERATION_REF,
		scope,
		coordinatesDigest: D777_COORDINATES_DIGEST,
		historicalBundleDigest: D777_HISTORICAL_BUNDLE_DIGEST,
		routeProfileDigest: D777_ROUTE_PROFILE_DIGEST,
		pricingReadDigest: digest(input.pricingReadDigest, "d777.claim.pricing"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d777.claim.zeroByok"),
		implementationManifestDigest: digest(
			input.implementationManifestDigest,
			"d777.claim.implementation",
		),
		blockCount: 1 as const,
		blockHardCapMicrousd: 6_000_000 as const,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
	});
}

async function acquire(
	privateRootValue: string,
	scope: Scope,
	input: Parameters<typeof claimMaterial>[1],
): Promise<D777PersistedDispatchClaimV1> {
	const requestedRoot = resolve(privateRootValue);
	const privateRoot = await realpath(requestedRoot);
	if (privateRoot !== requestedRoot) throw new TypeError("D777 private root is not canonical");
	const parentStat = await lstat(privateRoot);
	if (
		!parentStat.isDirectory() ||
		parentStat.isSymbolicLink() ||
		(parentStat.mode & 0o777) !== 0o700
	)
		throw new TypeError("D777 private root ownership is invalid");
	const claimRoot = join(privateRoot, `.${D777_DISPATCH_CLAIM_REF}`);
	await mkdir(claimRoot, { recursive: false, mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const rootStat = await lstat(claimRoot);
	const material = claimMaterial(scope, input);
	const claim = strictSnapshot({
		...material,
		claimDigest: empiricalStrictJsonDigest(material),
	}) as D777PersistedDispatchClaimV1;
	const bytes = strictJsonCodec.encode(claim);
	const file = join(claimRoot, "dispatch-claim.v1.json");
	const writer = await open(
		file,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await writer.writeFile(bytes);
		await writer.sync();
	} finally {
		await writer.close();
	}
	await chmod(file, 0o600);
	await syncDirectory(claimRoot);
	await syncDirectory(privateRoot);
	const reader = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
	let fileStat: Awaited<ReturnType<typeof reader.stat>>;
	try {
		fileStat = await reader.stat();
		if (
			!fileStat.isFile() ||
			(fileStat.mode & 0o777) !== 0o600 ||
			fileStat.nlink !== 1 ||
			!sameBytes(new Uint8Array(await reader.readFile()), bytes)
		)
			throw new TypeError("D777 dispatch claim readback drifted");
	} finally {
		await reader.close();
	}
	claims.set(claim, {
		root: claimRoot,
		file,
		scope,
		rootIdentity: { dev: rootStat.dev, ino: rootStat.ino },
		fileIdentity: { dev: fileStat.dev, ino: fileStat.ino },
		bytes,
	});
	return claim;
}

export function acquireD777SingleUseDispatchClaim(input: Parameters<typeof claimMaterial>[1]) {
	return acquire(D777_PRIVATE_ROOT, "live-fixed-root", input);
}

export function acquireD777SingleUseDispatchClaimAtRootForTest(
	root: string,
	input: Parameters<typeof claimMaterial>[1],
) {
	return acquire(root, "injected-test-root", input);
}

async function revalidate(claim: D777PersistedDispatchClaimV1, state: ClaimState): Promise<void> {
	const rootStat = await lstat(state.root);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		rootStat.dev !== state.rootIdentity.dev ||
		rootStat.ino !== state.rootIdentity.ino ||
		(await realpath(state.root)) !== state.root
	)
		throw new TypeError("D777 durable claim directory drifted");
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
			throw new TypeError("D777 durable claim file drifted");
	} finally {
		await reader.close();
	}
	literal(
		claim.claimDigest,
		empiricalStrictJsonDigest(
			claimMaterial(state.scope, {
				pricingReadDigest: claim.pricingReadDigest,
				zeroByokObservationDigest: claim.zeroByokObservationDigest,
				implementationManifestDigest: claim.implementationManifestDigest,
			}),
		),
		"d777.claim.digest",
	);
}

export async function consumeD777DispatchClaimForExecution(inputValue: {
	readonly claim: D777PersistedDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}): Promise<D777ExecutionAuthorityV1> {
	const input = record(inputValue, "d777.execution.input");
	exactKeys(input, ["claim", "currentKeyAdmission"], "d777.execution.input");
	const claim = input.claim as D777PersistedDispatchClaimV1;
	const state = typeof claim === "object" && claim !== null ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D777 claim is not fresh and constructed");
	claims.delete(claim);
	await revalidate(claim, state);
	const admission = consumeOpenRouterCurrentKeySpendAdmission(input.currentKeyAdmission);
	if (
		admission.limitMicrousd !== 32_000_000 ||
		admission.remainingMicrousd < D777_BUDGET_LIMITS.maxCostMicrousd ||
		admission.limitReset !== "none" ||
		admission.isManagementKey
	)
		throw new TypeError("D777 current-key admission is outside authority");
	const executionRoot = join(state.root, "execution-started");
	await mkdir(executionRoot, { recursive: false, mode: 0o700 });
	await chmod(executionRoot, 0o700);
	const markerBytes = strictJsonCodec.encode(
		strictSnapshot({
			claimDigest: claim.claimDigest,
			currentKeyAdmissionDigest: admission.admissionDigest,
			remainingMicrousd: admission.remainingMicrousd,
		}),
	);
	const marker = await open(
		join(executionRoot, "current-key-admission.v1.json"),
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await marker.writeFile(markerBytes);
		await marker.sync();
	} finally {
		await marker.close();
	}
	await syncDirectory(executionRoot);
	await syncDirectory(state.root);
	const authority = Object.freeze({
		revision: "graphrefly.b112.d777.execution-authority.v1" as const,
		claim,
		currentKeyAdmission: admission,
	});
	if (state.scope === "live-fixed-root") authorities.add(authority);
	return authority;
}

export function consumeD777ExecutionAuthority(value: unknown): D777ExecutionAuthorityV1 {
	if (typeof value !== "object" || value === null || !authorities.delete(value))
		throw new TypeError("D777 live execution authority must be fixed-root and single-use");
	return value as D777ExecutionAuthorityV1;
}
