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
	D36_COORDINATES_DIGEST,
	D36_DECISION_REF,
	D36_DISPATCH_CLAIM_REF,
	D36_GENERATION_REF,
	D36_LIVE_APPROVAL_REVISION,
} from "./d36-retained-span-live-coordinates.js";
import {
	consumeD36Preclaim,
	type D36CredentialV1,
	type D36PreclaimV1,
} from "./d36-retained-span-live-preflight.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	createOpenRouterCurrentKeySpendAdmissionCapability,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export const D36_CLAIM_SCHEMA = "graphrefly-ts.d36.live-dispatch-claim.v1" as const;
export const D36_CURRENT_KEY_SCHEMA = "graphrefly-ts.d36.current-key-admission.v1" as const;
export const D36_EXECUTION_AUTHORITY_REVISION =
	"graphrefly-ts.d36.live-execution-authority.v1" as const;
export const D36_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d36",
);

type ClaimScope = "live-fixed-root" | "injected-test-root";
type Identity = Readonly<{ dev: number; ino: number }>;

export interface D36DispatchClaimV1 {
	readonly schemaVersion: typeof D36_CLAIM_SCHEMA;
	readonly claimRef: typeof D36_DISPATCH_CLAIM_REF;
	readonly decisionRef: typeof D36_DECISION_REF;
	readonly generationRef: typeof D36_GENERATION_REF;
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

export interface D36CurrentKeyAdmissionV1 {
	readonly schemaVersion: typeof D36_CURRENT_KEY_SCHEMA;
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

export interface D36ExecutionAuthorityV1 {
	readonly revision: typeof D36_EXECUTION_AUTHORITY_REVISION;
	readonly claim: D36DispatchClaimV1;
	readonly currentKeyAdmission: D36CurrentKeyAdmissionV1;
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
	Readonly<{ claim: D36DispatchClaimV1; base: OpenRouterCurrentKeySpendAdmissionV1 }>
>();
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

async function assertPrivateRoot(rootValue: string): Promise<string> {
	const root = resolve(rootValue);
	if ((await realpath(root)) !== root) throw new TypeError("D36 private root is not canonical");
	const stat = await lstat(root);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== 0o700 ||
		stat.nlink < 1 ||
		(process.getuid !== undefined && stat.uid !== process.getuid())
	)
		throw new TypeError("D36 private root ownership is invalid");
	return root;
}

function credentialBinding(value: D36CredentialV1): string {
	return empiricalStrictJsonDigest({
		credentialBindingRef: value.credentialBindingRef,
		credentialBindingRevision: value.credentialBindingRevision,
		keyVisiblePrefix: value.bearerToken.slice(0, 12),
		keyVisibleSuffix: value.bearerToken.slice(-3),
	});
}

function validateCredential(value: unknown): D36CredentialV1 {
	const credential = record(value, "D36 credential");
	exactKeys(
		credential,
		["bearerToken", "credentialBindingRef", "credentialBindingRevision"],
		"D36 credential",
	);
	if (
		typeof credential.bearerToken !== "string" ||
		credential.bearerToken.length < 16 ||
		Buffer.byteLength(credential.bearerToken, "utf8") > 4_096 ||
		credential.credentialBindingRef !== "openrouter.local-eval-2" ||
		credential.credentialBindingRevision !== "2026-08-14.v1"
	)
		throw new TypeError("D36 credential is outside the approved binding");
	return credential as unknown as D36CredentialV1;
}

function claimMaterial(
	scope: ClaimScope,
	preclaim: D36PreclaimV1,
	implementationManifestDigest: string,
	qualificationArtifactDigest: string,
	qualificationDigest: string,
) {
	return strictSnapshot({
		schemaVersion: D36_CLAIM_SCHEMA,
		claimRef: D36_DISPATCH_CLAIM_REF,
		decisionRef: D36_DECISION_REF,
		generationRef: D36_GENERATION_REF,
		scope,
		coordinatesDigest: D36_COORDINATES_DIGEST,
		preclaimDigest: digest(preclaim.preclaimDigest, "D36 claim preclaim"),
		pricingObservationDigest: digest(
			preclaim.pricingObservationDigest,
			"D36 claim pricing observation",
		),
		zeroByokObservationDigest: digest(
			preclaim.zeroByokObservationDigest,
			"D36 claim zero-BYOK observation",
		),
		credentialBindingDigest: digest(
			preclaim.credentialBindingDigest,
			"D36 claim credential binding",
		),
		implementationManifestDigest: digest(
			implementationManifestDigest,
			"D36 claim implementation manifest",
		),
		qualificationArtifactDigest: digest(
			qualificationArtifactDigest,
			"D36 claim qualification artifact",
		),
		qualificationDigest: digest(qualificationDigest, "D36 claim qualification"),
		blockCount: 1 as const,
		blockHardCapMicrousd: 6_000_000 as const,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
	});
}

async function acquire(
	privateRootValue: string,
	scope: ClaimScope,
	inputValue: {
		readonly preclaim: D36PreclaimV1;
		readonly nowMs: number;
		readonly implementationManifestDigest: string;
		readonly qualificationArtifactDigest: string;
		readonly qualificationDigest: string;
	},
): Promise<D36DispatchClaimV1> {
	const input = record(inputValue, "D36 claim input");
	exactKeys(
		input,
		[
			"implementationManifestDigest",
			"nowMs",
			"preclaim",
			"qualificationArtifactDigest",
			"qualificationDigest",
		],
		"D36 claim input",
	);
	const privateRoot = await assertPrivateRoot(privateRootValue);
	const preclaim = consumeD36Preclaim(input.preclaim, Number(input.nowMs));
	const claimRoot = join(privateRoot, `.${D36_DISPATCH_CLAIM_REF}`);
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
			throw new TypeError("D36 claim directory identity is invalid");
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
	}) as D36DispatchClaimV1;
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
			throw new TypeError("D36 claim readback drifted");
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

export function acquireD36DispatchClaim(input: Parameters<typeof acquire>[2]) {
	if (D36_LIVE_APPROVAL_REVISION === null) throw new TypeError("D36 live authority is unavailable");
	return acquire(D36_PRIVATE_ROOT, "live-fixed-root", input);
}

export function acquireD36DispatchClaimAtRootForTest(
	root: string,
	input: Parameters<typeof acquire>[2],
) {
	return acquire(root, "injected-test-root", input);
}

async function revalidateClaim(claim: D36DispatchClaimV1, state: ClaimState): Promise<void> {
	const rootStat = await lstat(state.root);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		rootStat.dev !== state.rootIdentity.dev ||
		rootStat.ino !== state.rootIdentity.ino ||
		(await realpath(state.root)) !== state.root
	)
		throw new TypeError("D36 durable claim directory drifted");
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
			throw new TypeError("D36 durable claim file drifted");
	} finally {
		await reader.close();
	}
	if (claim.coordinatesDigest !== D36_COORDINATES_DIGEST)
		throw new TypeError("D36 durable claim coordinates drifted");
}

export async function readD36CurrentKeyAdmission(inputValue: {
	readonly claim: D36DispatchClaimV1;
	readonly credential: D36CredentialV1;
	readonly fetch: typeof fetch;
	readonly signal: AbortSignal;
}): Promise<D36CurrentKeyAdmissionV1> {
	const input = record(inputValue, "D36 current-key input");
	exactKeys(input, ["claim", "credential", "fetch", "signal"], "D36 current-key input");
	const claim = input.claim as D36DispatchClaimV1;
	const state = claim !== null && typeof claim === "object" ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D36 current-key claim is forged or consumed");
	await revalidateClaim(claim, state);
	const credential = validateCredential(input.credential);
	if (credentialBinding(credential) !== claim.credentialBindingDigest)
		throw new TypeError("D36 current-key credential binding drifted");
	if (typeof input.fetch !== "function" || !(input.signal instanceof AbortSignal))
		throw new TypeError("D36 current-key capability is invalid");
	const base = await createOpenRouterCurrentKeySpendAdmissionCapability({
		fetch: input.fetch as typeof fetch,
	}).read({
		credential,
		expectedLimitMicrousd: 32_000_000,
		requiredRemainingMicrousd: 6_000_000,
		signal: input.signal,
	});
	const material = strictSnapshot({
		schemaVersion: D36_CURRENT_KEY_SCHEMA,
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
	}) as D36CurrentKeyAdmissionV1;
	currentKeys.set(result, { claim, base });
	return result;
}

export async function consumeD36DispatchClaim(inputValue: {
	readonly claim: D36DispatchClaimV1;
	readonly currentKeyAdmission: D36CurrentKeyAdmissionV1;
	readonly allowInjectedTestScope?: boolean;
}): Promise<D36ExecutionAuthorityV1> {
	const input = record(inputValue, "D36 execution input");
	exactKeys(
		input,
		Object.hasOwn(input, "allowInjectedTestScope")
			? ["allowInjectedTestScope", "claim", "currentKeyAdmission"]
			: ["claim", "currentKeyAdmission"],
		"D36 execution input",
	);
	const claim = input.claim as D36DispatchClaimV1;
	const state = claim !== null && typeof claim === "object" ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D36 dispatch claim is forged or consumed");
	const currentKey = input.currentKeyAdmission as D36CurrentKeyAdmissionV1;
	const currentKeyState =
		currentKey !== null && typeof currentKey === "object" ? currentKeys.get(currentKey) : undefined;
	if (currentKeyState === undefined || currentKeyState.claim !== claim)
		throw new TypeError("D36 current-key admission is forged, replayed or cross-bound");
	claims.delete(claim);
	currentKeys.delete(currentKey);
	if (state.scope !== "live-fixed-root" && input.allowInjectedTestScope !== true)
		throw new TypeError("D36 execution rejected an injected claim");
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
		throw new TypeError("D36 current-key admission is outside the approved boundary");
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
		throw new TypeError("D36 execution marker drifted");
	const material = strictSnapshot({
		revision: D36_EXECUTION_AUTHORITY_REVISION,
		claim,
		currentKeyAdmission: currentKey,
	});
	const authority = Object.freeze({
		...material,
		authorityDigest: empiricalStrictJsonDigest(material),
	}) as D36ExecutionAuthorityV1;
	authorities.add(authority);
	return authority;
}

export function consumeD36ExecutionAuthority(value: unknown): D36ExecutionAuthorityV1 {
	if (value === null || typeof value !== "object" || !authorities.delete(value))
		throw new TypeError("D36 execution authority must be same-process and single-use");
	return value as D36ExecutionAuthorityV1;
}
