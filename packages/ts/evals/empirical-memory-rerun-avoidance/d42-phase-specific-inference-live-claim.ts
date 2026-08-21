import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	D42_COORDINATES_DIGEST,
	D42_DECISION_REF,
	D42_DISPATCH_CLAIM_REF,
	D42_GENERATION_REF,
	D42_LIVE_APPROVAL_REVISION,
} from "./d42-phase-specific-inference-live-coordinates.js";
import {
	consumeD42Preclaim,
	type D42CredentialV1,
	type D42PreclaimV1,
} from "./d42-phase-specific-inference-live-preflight.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	createOpenRouterCurrentKeySpendAdmissionCapability,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export const D42_CLAIM_SCHEMA = "graphrefly-ts.d42.live-dispatch-claim.v1" as const;
export const D42_CURRENT_KEY_SCHEMA = "graphrefly-ts.d42.current-key-admission.v1" as const;
export const D42_EXECUTION_AUTHORITY_REVISION =
	"graphrefly-ts.d42.live-execution-authority.v1" as const;
export const D42_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d42",
);

type ClaimScope = "live-fixed-root" | "injected-test-root";
type Identity = Readonly<{ dev: number; ino: number }>;

export interface D42DispatchClaimV1 {
	readonly schemaVersion: typeof D42_CLAIM_SCHEMA;
	readonly claimRef: typeof D42_DISPATCH_CLAIM_REF;
	readonly decisionRef: typeof D42_DECISION_REF;
	readonly generationRef: typeof D42_GENERATION_REF;
	readonly scope: ClaimScope;
	readonly coordinatesDigest: string;
	readonly preclaimDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly credentialBindingDigest: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly blockCount: 1;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface D42CurrentKeyAdmissionV1 {
	readonly schemaVersion: typeof D42_CURRENT_KEY_SCHEMA;
	readonly claimDigest: string;
	readonly credentialBindingDigest: string;
	readonly limitMicrousd: 32_000_000;
	readonly remainingMicrousd: number;
	readonly usageMicrousd: number;
	readonly limitReset: "none";
	readonly isManagementKey: false;
	readonly baseAdmissionDigest: string;
	readonly admissionDigest: string;
}

export interface D42ExecutionAuthorityV1 {
	readonly revision: typeof D42_EXECUTION_AUTHORITY_REVISION;
	readonly claim: D42DispatchClaimV1;
	readonly currentKeyAdmission: D42CurrentKeyAdmissionV1;
	readonly authorityDigest: string;
}

export interface D42PreexecutionFailureAuthorityV1 {
	readonly revision: "graphrefly-ts.d42.preexecution-failure-authority.v1";
	readonly claim: D42DispatchClaimV1;
	readonly currentKeyAdmissionDigest: string | null;
	readonly executionAuthorityDigest: string | null;
	readonly failurePhase:
		| "current-key-admission"
		| "post-current-key-implementation"
		| "execution-boundary";
	readonly authorityDigest: string;
}

interface ClaimState {
	readonly scope: ClaimScope;
	readonly root: string;
	readonly file: string;
	readonly rootIdentity: Identity;
	readonly fileIdentity: Identity;
	readonly bytes: Uint8Array;
}

const claims = new WeakMap<object, ClaimState>();
const currentKeys = new WeakMap<
	object,
	Readonly<{ claim: D42DispatchClaimV1; base: OpenRouterCurrentKeySpendAdmissionV1 }>
>();
const authorities = new WeakMap<object, ClaimState>();
const consumedAuthorities = new WeakMap<object, ClaimState>();
const preexecutionFailures = new WeakSet<object>();

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

async function assertPrivateRoot(rootValue: string): Promise<string> {
	const root = resolve(rootValue);
	if ((await realpath(root)) !== root) throw new TypeError("D42 private root is not canonical");
	const stat = await lstat(root);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== 0o700 ||
		stat.nlink < 1 ||
		(process.getuid !== undefined && stat.uid !== process.getuid())
	)
		throw new TypeError("D42 private root ownership is invalid");
	return root;
}

function credentialBinding(value: D42CredentialV1): string {
	return empiricalStrictJsonDigest({
		credentialBindingRef: value.credentialBindingRef,
		credentialBindingRevision: value.credentialBindingRevision,
		keyVisiblePrefix: value.bearerToken.slice(0, 12),
		keyVisibleSuffix: value.bearerToken.slice(-3),
	});
}

function validateCredential(value: unknown): D42CredentialV1 {
	const credential = record(value, "D42 credential");
	exactKeys(
		credential,
		["bearerToken", "credentialBindingRef", "credentialBindingRevision"],
		"D42 credential",
	);
	if (
		typeof credential.bearerToken !== "string" ||
		credential.bearerToken.length < 16 ||
		Buffer.byteLength(credential.bearerToken, "utf8") > 4_096 ||
		credential.credentialBindingRef !== "openrouter.local-eval-2" ||
		credential.credentialBindingRevision !== "2026-08-14.v1"
	)
		throw new TypeError("D42 credential is outside the approved binding");
	return credential as unknown as D42CredentialV1;
}

function claimMaterial(
	scope: ClaimScope,
	preclaim: D42PreclaimV1,
	implementationManifestDigest: string,
	qualificationArtifactDigest: string,
	qualificationDigest: string,
) {
	return strictSnapshot({
		schemaVersion: D42_CLAIM_SCHEMA,
		claimRef: D42_DISPATCH_CLAIM_REF,
		decisionRef: D42_DECISION_REF,
		generationRef: D42_GENERATION_REF,
		scope,
		coordinatesDigest: D42_COORDINATES_DIGEST,
		preclaimDigest: digest(preclaim.preclaimDigest, "D42 claim preclaim"),
		pricingObservationDigest: digest(
			preclaim.pricingObservationDigest,
			"D42 claim pricing observation",
		),
		zeroByokObservationDigest: digest(
			preclaim.zeroByokObservationDigest,
			"D42 claim zero-BYOK observation",
		),
		credentialBindingDigest: digest(
			preclaim.credentialBindingDigest,
			"D42 claim credential binding",
		),
		implementationManifestDigest: digest(
			implementationManifestDigest,
			"D42 claim implementation manifest",
		),
		qualificationArtifactDigest: digest(
			qualificationArtifactDigest,
			"D42 claim qualification artifact",
		),
		qualificationDigest: digest(qualificationDigest, "D42 claim qualification"),
		blockCount: 1 as const,
		blockHardCapMicrousd: 6_000_000 as const,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
	});
}

async function acquire(
	privateRootValue: string,
	scope: ClaimScope,
	inputValue: {
		readonly preclaim: D42PreclaimV1;
		readonly nowMs: number;
		readonly implementationManifestDigest: string;
		readonly qualificationArtifactDigest: string;
		readonly qualificationDigest: string;
	},
): Promise<D42DispatchClaimV1> {
	const input = record(inputValue, "D42 claim input");
	exactKeys(
		input,
		[
			"implementationManifestDigest",
			"nowMs",
			"preclaim",
			"qualificationArtifactDigest",
			"qualificationDigest",
		],
		"D42 claim input",
	);
	const privateRoot = await assertPrivateRoot(privateRootValue);
	const preclaim = consumeD42Preclaim(input.preclaim, Number(input.nowMs));
	const claimRoot = join(privateRoot, `.${D42_DISPATCH_CLAIM_REF}`);
	await mkdir(claimRoot, { recursive: false, mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const rootHandle = await open(
		claimRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	let rootStat: Awaited<ReturnType<typeof rootHandle.stat>>;
	try {
		rootStat = await rootHandle.stat();
		if (!rootStat.isDirectory() || (rootStat.mode & 0o777) !== 0o700 || rootStat.nlink < 2)
			throw new TypeError("D42 claim directory identity is invalid");
	} finally {
		await rootHandle.close();
	}
	const material = claimMaterial(
		scope,
		preclaim,
		String(input.implementationManifestDigest),
		String(input.qualificationArtifactDigest),
		String(input.qualificationDigest),
	);
	const claim = Object.freeze({
		...material,
		claimDigest: empiricalStrictJsonDigest(material),
	}) as D42DispatchClaimV1;
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
			throw new TypeError("D42 claim readback drifted");
	} finally {
		await reader.close();
	}
	claims.set(claim, {
		scope,
		root: claimRoot,
		file,
		rootIdentity: { dev: rootStat.dev, ino: rootStat.ino },
		fileIdentity: { dev: fileStat.dev, ino: fileStat.ino },
		bytes,
	});
	return claim;
}

export function acquireD42DispatchClaim(input: Parameters<typeof acquire>[2]) {
	if (D42_LIVE_APPROVAL_REVISION === null) throw new TypeError("D42 live authority is unavailable");
	return acquire(D42_PRIVATE_ROOT, "live-fixed-root", input);
}

export function acquireD42DispatchClaimAtRootForTest(
	root: string,
	input: Parameters<typeof acquire>[2],
) {
	return acquire(root, "injected-test-root", input);
}

async function revalidateClaim(claim: D42DispatchClaimV1, state: ClaimState): Promise<void> {
	const rootStat = await lstat(state.root);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		rootStat.dev !== state.rootIdentity.dev ||
		rootStat.ino !== state.rootIdentity.ino ||
		(await realpath(state.root)) !== state.root
	)
		throw new TypeError("D42 durable claim directory drifted");
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
			throw new TypeError("D42 durable claim file drifted");
	} finally {
		await reader.close();
	}
	if (claim.coordinatesDigest !== D42_COORDINATES_DIGEST)
		throw new TypeError("D42 durable claim coordinates drifted");
}

export async function readD42CurrentKeyAdmission(inputValue: {
	readonly claim: D42DispatchClaimV1;
	readonly credential: D42CredentialV1;
	readonly fetch: typeof fetch;
	readonly signal: AbortSignal;
}): Promise<D42CurrentKeyAdmissionV1> {
	const input = record(inputValue, "D42 current-key input");
	exactKeys(input, ["claim", "credential", "fetch", "signal"], "D42 current-key input");
	const claim = input.claim as D42DispatchClaimV1;
	const state = claim !== null && typeof claim === "object" ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D42 current-key claim is forged or consumed");
	await revalidateClaim(claim, state);
	const credential = validateCredential(input.credential);
	if (credentialBinding(credential) !== claim.credentialBindingDigest)
		throw new TypeError("D42 current-key credential binding drifted");
	if (typeof input.fetch !== "function" || !(input.signal instanceof AbortSignal))
		throw new TypeError("D42 current-key capability is invalid");
	const base = await createOpenRouterCurrentKeySpendAdmissionCapability({
		fetch: input.fetch as typeof fetch,
	}).read({
		credential,
		expectedLimitMicrousd: 32_000_000,
		requiredRemainingMicrousd: 6_000_000,
		signal: input.signal,
	});
	const material = strictSnapshot({
		schemaVersion: D42_CURRENT_KEY_SCHEMA,
		claimDigest: claim.claimDigest,
		credentialBindingDigest: claim.credentialBindingDigest,
		limitMicrousd: 32_000_000 as const,
		remainingMicrousd: base.remainingMicrousd,
		usageMicrousd: base.usageMicrousd,
		limitReset: "none" as const,
		isManagementKey: false as const,
		baseAdmissionDigest: base.admissionDigest,
	});
	const result = Object.freeze({
		...material,
		admissionDigest: empiricalStrictJsonDigest(material),
	}) as D42CurrentKeyAdmissionV1;
	currentKeys.set(result, { claim, base });
	return result;
}

export async function consumeD42DispatchClaim(inputValue: {
	readonly claim: D42DispatchClaimV1;
	readonly currentKeyAdmission: D42CurrentKeyAdmissionV1;
	readonly allowInjectedTestScope?: boolean;
}): Promise<D42ExecutionAuthorityV1> {
	const input = record(inputValue, "D42 execution input");
	exactKeys(
		input,
		Object.hasOwn(input, "allowInjectedTestScope")
			? ["allowInjectedTestScope", "claim", "currentKeyAdmission"]
			: ["claim", "currentKeyAdmission"],
		"D42 execution input",
	);
	const claim = input.claim as D42DispatchClaimV1;
	const state = claim !== null && typeof claim === "object" ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D42 dispatch claim is forged or consumed");
	const currentKey = input.currentKeyAdmission as D42CurrentKeyAdmissionV1;
	const currentKeyState =
		currentKey !== null && typeof currentKey === "object" ? currentKeys.get(currentKey) : undefined;
	if (currentKeyState === undefined || currentKeyState.claim !== claim)
		throw new TypeError("D42 current-key admission is forged, replayed or cross-bound");
	if (state.scope !== "live-fixed-root" && input.allowInjectedTestScope !== true)
		throw new TypeError("D42 execution rejected an injected claim");
	await revalidateClaim(claim, state);
	const base = consumeOpenRouterCurrentKeySpendAdmission(currentKeyState.base);
	if (
		base.admissionDigest !== currentKey.baseAdmissionDigest ||
		currentKey.claimDigest !== claim.claimDigest ||
		currentKey.credentialBindingDigest !== claim.credentialBindingDigest ||
		currentKey.limitMicrousd !== 32_000_000 ||
		currentKey.remainingMicrousd < 6_000_000 ||
		currentKey.limitReset !== "none" ||
		currentKey.isManagementKey !== false
	)
		throw new TypeError("D42 current-key admission is outside the approved boundary");
	const marker = join(state.root, ".execution-started");
	await mkdir(marker, { recursive: false, mode: 0o700 });
	await chmod(marker, 0o700);
	await syncDirectory(marker);
	await syncDirectory(state.root);
	const markerStat = await lstat(marker);
	if (
		!markerStat.isDirectory() ||
		markerStat.isSymbolicLink() ||
		(markerStat.mode & 0o777) !== 0o700 ||
		(await realpath(marker)) !== marker
	)
		throw new TypeError("D42 execution marker drifted");
	const material = strictSnapshot({
		revision: D42_EXECUTION_AUTHORITY_REVISION,
		claim,
		currentKeyAdmission: currentKey,
	});
	const authority = Object.freeze({
		...material,
		authorityDigest: empiricalStrictJsonDigest(material),
	}) as D42ExecutionAuthorityV1;
	claims.delete(claim);
	currentKeys.delete(currentKey);
	authorities.set(authority, state);
	return authority;
}

export function consumeD42ExecutionAuthority(value: unknown): D42ExecutionAuthorityV1 {
	const objectValue = value !== null && typeof value === "object" ? value : null;
	const state = objectValue === null ? undefined : authorities.get(objectValue);
	if (state === undefined)
		throw new TypeError("D42 execution authority must be same-process and single-use");
	authorities.delete(objectValue!);
	consumedAuthorities.set(objectValue!, state);
	return value as D42ExecutionAuthorityV1;
}

function preexecutionFailureAuthority(
	claim: D42DispatchClaimV1,
	currentKeyAdmissionDigest: string | null,
	executionAuthorityDigest: string | null,
	failurePhase: D42PreexecutionFailureAuthorityV1["failurePhase"],
): D42PreexecutionFailureAuthorityV1 {
	const material = strictSnapshot({
		revision: "graphrefly-ts.d42.preexecution-failure-authority.v1" as const,
		claim,
		currentKeyAdmissionDigest,
		executionAuthorityDigest,
		failurePhase,
	});
	const result = Object.freeze({
		...material,
		authorityDigest: empiricalStrictJsonDigest(material),
	}) as D42PreexecutionFailureAuthorityV1;
	preexecutionFailures.add(result);
	return result;
}

export async function issueD42CurrentKeyFailureAuthority(
	claim: D42DispatchClaimV1,
): Promise<D42PreexecutionFailureAuthorityV1> {
	const state = claim !== null && typeof claim === "object" ? claims.get(claim) : undefined;
	if (state === undefined)
		throw new TypeError("D42 current-key failure claim is forged or consumed");
	await revalidateClaim(claim, state);
	claims.delete(claim);
	return preexecutionFailureAuthority(claim, null, null, "current-key-admission");
}

export async function issueD42PostCurrentKeyFailureAuthority(
	executionAuthority: D42ExecutionAuthorityV1,
): Promise<D42PreexecutionFailureAuthorityV1> {
	const state =
		executionAuthority !== null && typeof executionAuthority === "object"
			? authorities.get(executionAuthority)
			: undefined;
	if (state === undefined)
		throw new TypeError("D42 post-current-key authority is forged or consumed");
	await revalidateClaim(executionAuthority.claim, state);
	authorities.delete(executionAuthority);
	return preexecutionFailureAuthority(
		executionAuthority.claim,
		executionAuthority.currentKeyAdmission.admissionDigest,
		executionAuthority.authorityDigest,
		"post-current-key-implementation",
	);
}

export async function issueD42ExecutionBoundaryFailureAuthority(
	executionAuthority: D42ExecutionAuthorityV1,
): Promise<D42PreexecutionFailureAuthorityV1> {
	const state =
		executionAuthority !== null && typeof executionAuthority === "object"
			? consumedAuthorities.get(executionAuthority)
			: undefined;
	if (state === undefined)
		throw new TypeError("D42 execution-boundary authority is forged or unavailable");
	await revalidateClaim(executionAuthority.claim, state);
	consumedAuthorities.delete(executionAuthority);
	return preexecutionFailureAuthority(
		executionAuthority.claim,
		executionAuthority.currentKeyAdmission.admissionDigest,
		executionAuthority.authorityDigest,
		"execution-boundary",
	);
}

export function consumeD42PreexecutionFailureAuthority(
	value: unknown,
): D42PreexecutionFailureAuthorityV1 {
	if (value === null || typeof value !== "object" || !preexecutionFailures.delete(value))
		throw new TypeError("D42 preexecution failure authority is forged or replayed");
	return value as D42PreexecutionFailureAuthorityV1;
}
