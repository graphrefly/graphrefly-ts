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
	D38_COORDINATES_DIGEST,
	D38_DECISION_REF,
	D38_DISPATCH_CLAIM_REF,
	D38_GENERATION_REF,
	D38_LIVE_APPROVAL_REVISION,
} from "./d38-premature-final-live-coordinates.js";
import {
	consumeD38Preclaim,
	type D38CredentialV1,
	type D38PreclaimV1,
} from "./d38-premature-final-live-preflight.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	createOpenRouterCurrentKeySpendAdmissionCapability,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export const D38_CLAIM_SCHEMA = "graphrefly-ts.d38.live-dispatch-claim.v2" as const;
export const D38_CURRENT_KEY_SCHEMA = "graphrefly-ts.d38.current-key-admission.v2" as const;
export const D38_EXECUTION_AUTHORITY_REVISION =
	"graphrefly-ts.d38.live-execution-authority.v2" as const;
export const D38_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d38",
);

type ClaimScope = "live-fixed-root" | "injected-test-root";
type Identity = Readonly<{ dev: number; ino: number }>;

export interface D38DispatchClaimV1 {
	readonly schemaVersion: typeof D38_CLAIM_SCHEMA;
	readonly claimRef: typeof D38_DISPATCH_CLAIM_REF;
	readonly decisionRef: typeof D38_DECISION_REF;
	readonly generationRef: typeof D38_GENERATION_REF;
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

export interface D38CurrentKeyAdmissionV1 {
	readonly schemaVersion: typeof D38_CURRENT_KEY_SCHEMA;
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

export interface D38ExecutionAuthorityV1 {
	readonly revision: typeof D38_EXECUTION_AUTHORITY_REVISION;
	readonly claim: D38DispatchClaimV1;
	readonly currentKeyAdmission: D38CurrentKeyAdmissionV1;
	readonly authorityDigest: string;
}

export interface D38PreexecutionFailureAuthorityV1 {
	readonly revision: "graphrefly-ts.d38.preexecution-failure-authority.v2";
	readonly claim: D38DispatchClaimV1;
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
	Readonly<{ claim: D38DispatchClaimV1; base: OpenRouterCurrentKeySpendAdmissionV1 }>
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
	if ((await realpath(root)) !== root) throw new TypeError("D38 private root is not canonical");
	const stat = await lstat(root);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== 0o700 ||
		stat.nlink < 1 ||
		(process.getuid !== undefined && stat.uid !== process.getuid())
	)
		throw new TypeError("D38 private root ownership is invalid");
	return root;
}

function credentialBinding(value: D38CredentialV1): string {
	return empiricalStrictJsonDigest({
		credentialBindingRef: value.credentialBindingRef,
		credentialBindingRevision: value.credentialBindingRevision,
		keyVisiblePrefix: value.bearerToken.slice(0, 12),
		keyVisibleSuffix: value.bearerToken.slice(-3),
	});
}

function validateCredential(value: unknown): D38CredentialV1 {
	const credential = record(value, "D38 credential");
	exactKeys(
		credential,
		["bearerToken", "credentialBindingRef", "credentialBindingRevision"],
		"D38 credential",
	);
	if (
		typeof credential.bearerToken !== "string" ||
		credential.bearerToken.length < 16 ||
		Buffer.byteLength(credential.bearerToken, "utf8") > 4_096 ||
		credential.credentialBindingRef !== "openrouter.local-eval-2" ||
		credential.credentialBindingRevision !== "2026-08-14.v1"
	)
		throw new TypeError("D38 credential is outside the approved binding");
	return credential as unknown as D38CredentialV1;
}

function claimMaterial(
	scope: ClaimScope,
	preclaim: D38PreclaimV1,
	implementationManifestDigest: string,
	qualificationArtifactDigest: string,
	qualificationDigest: string,
) {
	return strictSnapshot({
		schemaVersion: D38_CLAIM_SCHEMA,
		claimRef: D38_DISPATCH_CLAIM_REF,
		decisionRef: D38_DECISION_REF,
		generationRef: D38_GENERATION_REF,
		scope,
		coordinatesDigest: D38_COORDINATES_DIGEST,
		preclaimDigest: digest(preclaim.preclaimDigest, "D38 claim preclaim"),
		pricingObservationDigest: digest(
			preclaim.pricingObservationDigest,
			"D38 claim pricing observation",
		),
		zeroByokObservationDigest: digest(
			preclaim.zeroByokObservationDigest,
			"D38 claim zero-BYOK observation",
		),
		credentialBindingDigest: digest(
			preclaim.credentialBindingDigest,
			"D38 claim credential binding",
		),
		implementationManifestDigest: digest(
			implementationManifestDigest,
			"D38 claim implementation manifest",
		),
		qualificationArtifactDigest: digest(
			qualificationArtifactDigest,
			"D38 claim qualification artifact",
		),
		qualificationDigest: digest(qualificationDigest, "D38 claim qualification"),
		blockCount: 1 as const,
		blockHardCapMicrousd: 6_000_000 as const,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
	});
}

async function acquire(
	privateRootValue: string,
	scope: ClaimScope,
	inputValue: {
		readonly preclaim: D38PreclaimV1;
		readonly nowMs: number;
		readonly implementationManifestDigest: string;
		readonly qualificationArtifactDigest: string;
		readonly qualificationDigest: string;
	},
): Promise<D38DispatchClaimV1> {
	const input = record(inputValue, "D38 claim input");
	exactKeys(
		input,
		[
			"implementationManifestDigest",
			"nowMs",
			"preclaim",
			"qualificationArtifactDigest",
			"qualificationDigest",
		],
		"D38 claim input",
	);
	const privateRoot = await assertPrivateRoot(privateRootValue);
	const preclaim = consumeD38Preclaim(input.preclaim, Number(input.nowMs));
	const claimRoot = join(privateRoot, `.${D38_DISPATCH_CLAIM_REF}`);
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
			throw new TypeError("D38 claim directory identity is invalid");
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
	}) as D38DispatchClaimV1;
	const bytes = strictJsonCodec.encode(claim);
	const file = join(claimRoot, "dispatch-claim.v2.json");
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
			throw new TypeError("D38 claim readback drifted");
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

export function acquireD38DispatchClaim(input: Parameters<typeof acquire>[2]) {
	if (D38_LIVE_APPROVAL_REVISION === null) throw new TypeError("D38 live authority is unavailable");
	return acquire(D38_PRIVATE_ROOT, "live-fixed-root", input);
}

export function acquireD38DispatchClaimAtRootForTest(
	root: string,
	input: Parameters<typeof acquire>[2],
) {
	return acquire(root, "injected-test-root", input);
}

async function revalidateClaim(claim: D38DispatchClaimV1, state: ClaimState): Promise<void> {
	const rootStat = await lstat(state.root);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		rootStat.dev !== state.rootIdentity.dev ||
		rootStat.ino !== state.rootIdentity.ino ||
		(await realpath(state.root)) !== state.root
	)
		throw new TypeError("D38 durable claim directory drifted");
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
			throw new TypeError("D38 durable claim file drifted");
	} finally {
		await reader.close();
	}
	if (claim.coordinatesDigest !== D38_COORDINATES_DIGEST)
		throw new TypeError("D38 durable claim coordinates drifted");
}

export async function readD38CurrentKeyAdmission(inputValue: {
	readonly claim: D38DispatchClaimV1;
	readonly credential: D38CredentialV1;
	readonly fetch: typeof fetch;
	readonly signal: AbortSignal;
}): Promise<D38CurrentKeyAdmissionV1> {
	const input = record(inputValue, "D38 current-key input");
	exactKeys(input, ["claim", "credential", "fetch", "signal"], "D38 current-key input");
	const claim = input.claim as D38DispatchClaimV1;
	const state = claim !== null && typeof claim === "object" ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D38 current-key claim is forged or consumed");
	await revalidateClaim(claim, state);
	const credential = validateCredential(input.credential);
	if (credentialBinding(credential) !== claim.credentialBindingDigest)
		throw new TypeError("D38 current-key credential binding drifted");
	if (typeof input.fetch !== "function" || !(input.signal instanceof AbortSignal))
		throw new TypeError("D38 current-key capability is invalid");
	const base = await createOpenRouterCurrentKeySpendAdmissionCapability({
		fetch: input.fetch as typeof fetch,
	}).read({
		credential,
		expectedLimitMicrousd: 32_000_000,
		requiredRemainingMicrousd: 6_000_000,
		signal: input.signal,
	});
	const material = strictSnapshot({
		schemaVersion: D38_CURRENT_KEY_SCHEMA,
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
	}) as D38CurrentKeyAdmissionV1;
	currentKeys.set(result, { claim, base });
	return result;
}

export async function consumeD38DispatchClaim(inputValue: {
	readonly claim: D38DispatchClaimV1;
	readonly currentKeyAdmission: D38CurrentKeyAdmissionV1;
	readonly allowInjectedTestScope?: boolean;
}): Promise<D38ExecutionAuthorityV1> {
	const input = record(inputValue, "D38 execution input");
	exactKeys(
		input,
		Object.hasOwn(input, "allowInjectedTestScope")
			? ["allowInjectedTestScope", "claim", "currentKeyAdmission"]
			: ["claim", "currentKeyAdmission"],
		"D38 execution input",
	);
	const claim = input.claim as D38DispatchClaimV1;
	const state = claim !== null && typeof claim === "object" ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D38 dispatch claim is forged or consumed");
	const currentKey = input.currentKeyAdmission as D38CurrentKeyAdmissionV1;
	const currentKeyState =
		currentKey !== null && typeof currentKey === "object" ? currentKeys.get(currentKey) : undefined;
	if (currentKeyState === undefined || currentKeyState.claim !== claim)
		throw new TypeError("D38 current-key admission is forged, replayed or cross-bound");
	if (state.scope !== "live-fixed-root" && input.allowInjectedTestScope !== true)
		throw new TypeError("D38 execution rejected an injected claim");
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
		throw new TypeError("D38 current-key admission is outside the approved boundary");
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
		throw new TypeError("D38 execution marker drifted");
	const material = strictSnapshot({
		revision: D38_EXECUTION_AUTHORITY_REVISION,
		claim,
		currentKeyAdmission: currentKey,
	});
	const authority = Object.freeze({
		...material,
		authorityDigest: empiricalStrictJsonDigest(material),
	}) as D38ExecutionAuthorityV1;
	claims.delete(claim);
	currentKeys.delete(currentKey);
	authorities.set(authority, state);
	return authority;
}

export function consumeD38ExecutionAuthority(value: unknown): D38ExecutionAuthorityV1 {
	const objectValue = value !== null && typeof value === "object" ? value : null;
	const state = objectValue === null ? undefined : authorities.get(objectValue);
	if (state === undefined)
		throw new TypeError("D38 execution authority must be same-process and single-use");
	authorities.delete(objectValue!);
	consumedAuthorities.set(objectValue!, state);
	return value as D38ExecutionAuthorityV1;
}

function preexecutionFailureAuthority(
	claim: D38DispatchClaimV1,
	currentKeyAdmissionDigest: string | null,
	executionAuthorityDigest: string | null,
	failurePhase: D38PreexecutionFailureAuthorityV1["failurePhase"],
): D38PreexecutionFailureAuthorityV1 {
	const material = strictSnapshot({
		revision: "graphrefly-ts.d38.preexecution-failure-authority.v2" as const,
		claim,
		currentKeyAdmissionDigest,
		executionAuthorityDigest,
		failurePhase,
	});
	const result = Object.freeze({
		...material,
		authorityDigest: empiricalStrictJsonDigest(material),
	}) as D38PreexecutionFailureAuthorityV1;
	preexecutionFailures.add(result);
	return result;
}

export async function issueD38CurrentKeyFailureAuthority(
	claim: D38DispatchClaimV1,
): Promise<D38PreexecutionFailureAuthorityV1> {
	const state = claim !== null && typeof claim === "object" ? claims.get(claim) : undefined;
	if (state === undefined)
		throw new TypeError("D38 current-key failure claim is forged or consumed");
	await revalidateClaim(claim, state);
	claims.delete(claim);
	return preexecutionFailureAuthority(claim, null, null, "current-key-admission");
}

export async function issueD38PostCurrentKeyFailureAuthority(
	executionAuthority: D38ExecutionAuthorityV1,
): Promise<D38PreexecutionFailureAuthorityV1> {
	const state =
		executionAuthority !== null && typeof executionAuthority === "object"
			? authorities.get(executionAuthority)
			: undefined;
	if (state === undefined)
		throw new TypeError("D38 post-current-key authority is forged or consumed");
	await revalidateClaim(executionAuthority.claim, state);
	authorities.delete(executionAuthority);
	return preexecutionFailureAuthority(
		executionAuthority.claim,
		executionAuthority.currentKeyAdmission.admissionDigest,
		executionAuthority.authorityDigest,
		"post-current-key-implementation",
	);
}

export async function issueD38ExecutionBoundaryFailureAuthority(
	executionAuthority: D38ExecutionAuthorityV1,
): Promise<D38PreexecutionFailureAuthorityV1> {
	const state =
		executionAuthority !== null && typeof executionAuthority === "object"
			? consumedAuthorities.get(executionAuthority)
			: undefined;
	if (state === undefined)
		throw new TypeError("D38 execution-boundary authority is forged or unavailable");
	await revalidateClaim(executionAuthority.claim, state);
	consumedAuthorities.delete(executionAuthority);
	return preexecutionFailureAuthority(
		executionAuthority.claim,
		executionAuthority.currentKeyAdmission.admissionDigest,
		executionAuthority.authorityDigest,
		"execution-boundary",
	);
}

export function consumeD38PreexecutionFailureAuthority(
	value: unknown,
): D38PreexecutionFailureAuthorityV1 {
	if (value === null || typeof value !== "object" || !preexecutionFailures.delete(value))
		throw new TypeError("D38 preexecution failure authority is forged or replayed");
	return value as D38PreexecutionFailureAuthorityV1;
}
