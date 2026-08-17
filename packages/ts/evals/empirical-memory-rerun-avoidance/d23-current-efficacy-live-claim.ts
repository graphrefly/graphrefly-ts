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
	D23_COORDINATES_DIGEST,
	D23_DECISION_REF,
	D23_DISPATCH_CLAIM_REF,
	D23_GENERATION_REF,
} from "./d23-current-efficacy-live-coordinates.js";
import {
	consumeD23Preclaim,
	type D23CredentialV1,
	type D23PreclaimV1,
} from "./d23-current-efficacy-live-preflight.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	createOpenRouterCurrentKeySpendAdmissionCapability,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";

export const D23_CLAIM_SCHEMA = "graphrefly-ts.d23.live-dispatch-claim.v1" as const;
export const D23_CURRENT_KEY_SCHEMA = "graphrefly-ts.d23.current-key-admission.v1" as const;
export const D23_EXECUTION_AUTHORITY_REVISION =
	"graphrefly-ts.d23.live-execution-authority.v1" as const;
export const D23_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d23",
);

type ClaimScope = "live-fixed-root" | "injected-test-root";
type Identity = Readonly<{ dev: number; ino: number }>;

export interface D23DispatchClaimV1 {
	readonly schemaVersion: typeof D23_CLAIM_SCHEMA;
	readonly claimRef: typeof D23_DISPATCH_CLAIM_REF;
	readonly decisionRef: typeof D23_DECISION_REF;
	readonly generationRef: typeof D23_GENERATION_REF;
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

export interface D23CurrentKeyAdmissionV1 {
	readonly schemaVersion: typeof D23_CURRENT_KEY_SCHEMA;
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

export interface D23ExecutionAuthorityV1 {
	readonly revision: typeof D23_EXECUTION_AUTHORITY_REVISION;
	readonly claim: D23DispatchClaimV1;
	readonly currentKeyAdmission: D23CurrentKeyAdmissionV1;
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
	Readonly<{ claim: D23DispatchClaimV1; base: OpenRouterCurrentKeySpendAdmissionV1 }>
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
	if ((await realpath(root)) !== root) throw new TypeError("D23 private root is not canonical");
	const stat = await lstat(root);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== 0o700 ||
		stat.nlink < 1 ||
		(process.getuid !== undefined && stat.uid !== process.getuid())
	)
		throw new TypeError("D23 private root ownership is invalid");
	return root;
}

function credentialBinding(value: D23CredentialV1): string {
	return empiricalStrictJsonDigest({
		credentialBindingRef: value.credentialBindingRef,
		credentialBindingRevision: value.credentialBindingRevision,
		keyVisiblePrefix: value.bearerToken.slice(0, 12),
		keyVisibleSuffix: value.bearerToken.slice(-3),
	});
}

function validateCredential(value: unknown): D23CredentialV1 {
	const credential = record(value, "D23 credential");
	exactKeys(
		credential,
		["bearerToken", "credentialBindingRef", "credentialBindingRevision"],
		"D23 credential",
	);
	if (
		typeof credential.bearerToken !== "string" ||
		credential.bearerToken.length < 16 ||
		Buffer.byteLength(credential.bearerToken, "utf8") > 4_096 ||
		credential.credentialBindingRef !== "openrouter.local-eval-2" ||
		credential.credentialBindingRevision !== "2026-08-14.v1"
	)
		throw new TypeError("D23 credential is outside the approved binding");
	return credential as unknown as D23CredentialV1;
}

function claimMaterial(
	scope: ClaimScope,
	preclaim: D23PreclaimV1,
	implementationManifestDigest: string,
	qualificationArtifactDigest: string,
	qualificationDigest: string,
) {
	return strictSnapshot({
		schemaVersion: D23_CLAIM_SCHEMA,
		claimRef: D23_DISPATCH_CLAIM_REF,
		decisionRef: D23_DECISION_REF,
		generationRef: D23_GENERATION_REF,
		scope,
		coordinatesDigest: D23_COORDINATES_DIGEST,
		preclaimDigest: digest(preclaim.preclaimDigest, "D23 claim preclaim"),
		pricingObservationDigest: digest(
			preclaim.pricingObservationDigest,
			"D23 claim pricing observation",
		),
		zeroByokObservationDigest: digest(
			preclaim.zeroByokObservationDigest,
			"D23 claim zero-BYOK observation",
		),
		credentialBindingDigest: digest(
			preclaim.credentialBindingDigest,
			"D23 claim credential binding",
		),
		implementationManifestDigest: digest(
			implementationManifestDigest,
			"D23 claim implementation manifest",
		),
		qualificationArtifactDigest: digest(
			qualificationArtifactDigest,
			"D23 claim qualification artifact",
		),
		qualificationDigest: digest(qualificationDigest, "D23 claim qualification"),
		blockCount: 1 as const,
		blockHardCapMicrousd: 6_000_000 as const,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
	});
}

async function acquire(
	privateRootValue: string,
	scope: ClaimScope,
	inputValue: {
		readonly preclaim: D23PreclaimV1;
		readonly nowMs: number;
		readonly implementationManifestDigest: string;
		readonly qualificationArtifactDigest: string;
		readonly qualificationDigest: string;
	},
): Promise<D23DispatchClaimV1> {
	const input = record(inputValue, "D23 claim input");
	exactKeys(
		input,
		[
			"implementationManifestDigest",
			"nowMs",
			"preclaim",
			"qualificationArtifactDigest",
			"qualificationDigest",
		],
		"D23 claim input",
	);
	const privateRoot = await assertPrivateRoot(privateRootValue);
	const preclaim = consumeD23Preclaim(input.preclaim, Number(input.nowMs));
	const claimRoot = join(privateRoot, `.${D23_DISPATCH_CLAIM_REF}`);
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
			throw new TypeError("D23 claim directory identity is invalid");
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
	}) as D23DispatchClaimV1;
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
			throw new TypeError("D23 claim readback drifted");
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

export function acquireD23DispatchClaim(input: Parameters<typeof acquire>[2]) {
	return acquire(D23_PRIVATE_ROOT, "live-fixed-root", input);
}

export function acquireD23DispatchClaimAtRootForTest(
	root: string,
	input: Parameters<typeof acquire>[2],
) {
	return acquire(root, "injected-test-root", input);
}

async function revalidateClaim(claim: D23DispatchClaimV1, state: ClaimState): Promise<void> {
	const rootStat = await lstat(state.root);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		rootStat.dev !== state.rootIdentity.dev ||
		rootStat.ino !== state.rootIdentity.ino ||
		(await realpath(state.root)) !== state.root
	)
		throw new TypeError("D23 durable claim directory drifted");
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
			throw new TypeError("D23 durable claim file drifted");
	} finally {
		await reader.close();
	}
	if (claim.coordinatesDigest !== D23_COORDINATES_DIGEST)
		throw new TypeError("D23 durable claim coordinates drifted");
}

export async function readD23CurrentKeyAdmission(inputValue: {
	readonly claim: D23DispatchClaimV1;
	readonly credential: D23CredentialV1;
	readonly fetch: typeof fetch;
	readonly signal: AbortSignal;
}): Promise<D23CurrentKeyAdmissionV1> {
	const input = record(inputValue, "D23 current-key input");
	exactKeys(input, ["claim", "credential", "fetch", "signal"], "D23 current-key input");
	const claim = input.claim as D23DispatchClaimV1;
	const state = claim !== null && typeof claim === "object" ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D23 current-key claim is forged or consumed");
	await revalidateClaim(claim, state);
	const credential = validateCredential(input.credential);
	if (credentialBinding(credential) !== claim.credentialBindingDigest)
		throw new TypeError("D23 current-key credential binding drifted");
	if (typeof input.fetch !== "function" || !(input.signal instanceof AbortSignal))
		throw new TypeError("D23 current-key capability is invalid");
	const base = await createOpenRouterCurrentKeySpendAdmissionCapability({
		fetch: input.fetch as typeof fetch,
	}).read({
		credential,
		expectedLimitMicrousd: 32_000_000,
		requiredRemainingMicrousd: 6_000_000,
		signal: input.signal,
	});
	const material = strictSnapshot({
		schemaVersion: D23_CURRENT_KEY_SCHEMA,
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
	}) as D23CurrentKeyAdmissionV1;
	currentKeys.set(result, { claim, base });
	return result;
}

export async function consumeD23DispatchClaim(inputValue: {
	readonly claim: D23DispatchClaimV1;
	readonly currentKeyAdmission: D23CurrentKeyAdmissionV1;
	readonly allowInjectedTestScope?: boolean;
}): Promise<D23ExecutionAuthorityV1> {
	const input = record(inputValue, "D23 execution input");
	exactKeys(
		input,
		Object.hasOwn(input, "allowInjectedTestScope")
			? ["allowInjectedTestScope", "claim", "currentKeyAdmission"]
			: ["claim", "currentKeyAdmission"],
		"D23 execution input",
	);
	const claim = input.claim as D23DispatchClaimV1;
	const state = claim !== null && typeof claim === "object" ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("D23 dispatch claim is forged or consumed");
	const currentKey = input.currentKeyAdmission as D23CurrentKeyAdmissionV1;
	const currentKeyState =
		currentKey !== null && typeof currentKey === "object" ? currentKeys.get(currentKey) : undefined;
	if (currentKeyState === undefined || currentKeyState.claim !== claim)
		throw new TypeError("D23 current-key admission is forged, replayed or cross-bound");
	claims.delete(claim);
	currentKeys.delete(currentKey);
	if (state.scope !== "live-fixed-root" && input.allowInjectedTestScope !== true)
		throw new TypeError("D23 execution rejected an injected claim");
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
		throw new TypeError("D23 current-key admission is outside the approved boundary");
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
		throw new TypeError("D23 execution marker drifted");
	const material = strictSnapshot({
		revision: D23_EXECUTION_AUTHORITY_REVISION,
		claim,
		currentKeyAdmission: currentKey,
	});
	const authority = Object.freeze({
		...material,
		authorityDigest: empiricalStrictJsonDigest(material),
	}) as D23ExecutionAuthorityV1;
	authorities.add(authority);
	return authority;
}

export function consumeD23ExecutionAuthority(value: unknown): D23ExecutionAuthorityV1 {
	if (value === null || typeof value !== "object" || !authorities.delete(value))
		throw new TypeError("D23 execution authority must be same-process and single-use");
	return value as D23ExecutionAuthorityV1;
}
