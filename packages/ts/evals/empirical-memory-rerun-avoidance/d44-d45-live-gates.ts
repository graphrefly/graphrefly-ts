import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import type {
	D45CanonicalEvidenceV1,
	D45PartialCanonicalEvidenceV1,
} from "./d45-graph-tool-authority.js";
import {
	validateD45CanonicalEvidence,
	validateD45PartialCanonicalEvidence,
} from "./d45-graph-tool-authority.js";
import type { OpenRouterCurrentKeySpendAdmissionV1 } from "./openrouter-current-key-spend-admission.js";
import { consumeOpenRouterCurrentKeySpendAdmission } from "./openrouter-current-key-spend-admission.js";

export const D44_D45_PRICING_SOURCE =
	"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints" as const;
export const D44_D45_ZERO_BYOK_SCHEMA = "graphrefly-ts.d44.d45-zero-byok-observation.v1" as const;
export const D44_D45_CLAIM_SCHEMA = "graphrefly-ts.d44.d45-live-claim.v1" as const;
export const D44_D45_LIVE_BUNDLE_SCHEMA = "graphrefly-ts.d44.d45-live-bundle.v1" as const;
export const D44_D45_LIVE_GENERATION_REF =
	"current-graph-native-live-2026-08-21-d44-d45-v1" as const;
export const D44_D45_LIVE_CLAIM_REF =
	"current-graph-native-live-claim-2026-08-21-d44-d45-v1" as const;
export const D44_D45_LIVE_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d44-d45-live",
);

export interface D44D45CredentialV1 {
	readonly bearerToken: string;
	readonly credentialBindingRef: "openrouter.local-eval-2";
	readonly credentialBindingRevision: "2026-08-21.d45.v1";
}

export interface D44D45PricingObservationV1 {
	readonly sourceUrl: typeof D44_D45_PRICING_SOURCE;
	readonly modelRef: "deepseek/deepseek-v4-flash-0731";
	readonly endpointModelRef: "deepseek/deepseek-v4-flash-20260731";
	readonly providerName: "DeepInfra";
	readonly providerTag: "deepinfra/fp8";
	readonly quantization: "fp8";
	readonly inputMicrousdPerMillionTokens: 80_000;
	readonly outputMicrousdPerMillionTokens: 180_000;
	readonly cacheReadMicrousdPerMillionTokens: 16_000;
	readonly supportedParametersDigest: string;
	readonly officialResponseDigest: string;
	readonly observedAtMs: number;
	readonly observationDigest: string;
}

export interface D44D45ZeroByokObservationV1 {
	readonly workspaceSlug: "graph-re-fly";
	readonly keyName: "Local Eval 2";
	readonly byokCredentialCount: 0;
	readonly providerObservation: "DeepInfra Not configured";
	readonly observedAtMs: number;
	readonly sourceArtifactDigest: string;
	readonly observationDigest: string;
}

export interface D44D45PreclaimV1 {
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly credentialBindingDigest: string;
	readonly preclaimDigest: string;
}

export interface D44D45DispatchClaimV1 {
	readonly schemaVersion: typeof D44_D45_CLAIM_SCHEMA;
	readonly claimRef: typeof D44_D45_LIVE_CLAIM_REF;
	readonly authorityRef: "graphrefly-ts:D44";
	readonly architectureRef: "graphrefly-ts:D45";
	readonly generationRef: typeof D44_D45_LIVE_GENERATION_REF;
	readonly preclaimDigest: string;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface D44D45ExecutionAuthorityV1 {
	readonly claim: D44D45DispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
	readonly authorityDigest: string;
}

export type D44D45LiveBundleV1 = Readonly<{
	schemaVersion: typeof D44_D45_LIVE_BUNDLE_SCHEMA;
	generationRef: typeof D44_D45_LIVE_GENERATION_REF;
	disposition: "success" | "partial-failure";
	claimDigest: string;
	currentKeyAdmissionDigest: string;
	pricingObservationDigest: string;
	zeroByokObservationDigest: string;
	implementationCommit: string;
	implementationManifestDigest: string;
	qualificationArtifactDigest: string;
	qualificationDigest: string;
	providerCalls: number;
	graphEvidence: D45CanonicalEvidenceV1 | null;
	partialGraphEvidence: D45PartialCanonicalEvidenceV1 | null;
	causalAttribution: "undetermined";
	efficacyClaim: "frozen-task-block-positive-differential" | "none";
	bundleDigest: string;
}>;

const preclaims = new WeakSet<object>();
const claims = new WeakMap<object, Readonly<{ file: string; bytes: Uint8Array }>>();

function object(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${path} must be an object`);
	return value as Record<string, unknown>;
}

function strings(value: unknown, path: string): readonly string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
		throw new TypeError(`${path} must be strings`);
	return Object.freeze([...value].sort()) as readonly string[];
}

export async function readD44D45FreshPricing(input: {
	readonly fetchImpl: typeof fetch;
	readonly nowMs: number;
}): Promise<D44D45PricingObservationV1> {
	const response = await input.fetchImpl(D44_D45_PRICING_SOURCE, {
		method: "GET",
		redirect: "error",
		cache: "no-store",
		credentials: "omit",
		referrerPolicy: "no-referrer",
		headers: { accept: "application/json", "cache-control": "no-cache, no-store, max-age=0" },
		signal: AbortSignal.timeout(30_000),
	});
	if (response.status !== 200 || response.redirected || response.url !== D44_D45_PRICING_SOURCE)
		throw new TypeError("D44 official pricing response was rejected or redirected");
	if (response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
		throw new TypeError("D44 official pricing response was not JSON");
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > 1_048_576))
		throw new TypeError("D44 official pricing response exceeded its declared bound");
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength < 1 || bytes.byteLength > 1_048_576)
		throw new TypeError("D44 official pricing response exceeded its byte bound");
	const root = object(
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
		"pricing",
	);
	const data = object(root.data, "pricing.data");
	if (data.id !== "deepseek/deepseek-v4-flash-0731")
		throw new TypeError("D44 official pricing model drifted");
	if (!Array.isArray(data.endpoints)) throw new TypeError("D44 official pricing endpoints drifted");
	const matches = data.endpoints
		.map((entry) => object(entry, "pricing.endpoint"))
		.filter(
			(endpoint) =>
				endpoint.provider_name === "DeepInfra" &&
				endpoint.tag === "deepinfra/fp8" &&
				endpoint.quantization === "fp8" &&
				(endpoint.model === "deepseek/deepseek-v4-flash-20260731" ||
					endpoint.name === "DeepInfra | deepseek/deepseek-v4-flash-20260731"),
		);
	if (matches.length !== 1) throw new TypeError("D44 official pricing exact route was unavailable");
	const endpoint = matches[0]!;
	const supported = strings(endpoint.supported_parameters, "pricing.supported_parameters");
	for (const required of ["reasoning", "tool_choice", "tools"])
		if (!supported.includes(required)) throw new TypeError(`D44 route omitted ${required}`);
	const pricing = object(endpoint.pricing, "pricing.endpoint.pricing");
	if (
		pricing.prompt !== "0.00000008" ||
		pricing.completion !== "0.00000018" ||
		pricing.input_cache_read !== "0.000000016"
	)
		throw new TypeError("D44 official pricing drifted from the frozen fp8 schedule");
	const material = strictSnapshot({
		sourceUrl: D44_D45_PRICING_SOURCE,
		modelRef: "deepseek/deepseek-v4-flash-0731" as const,
		endpointModelRef: "deepseek/deepseek-v4-flash-20260731" as const,
		providerName: "DeepInfra" as const,
		providerTag: "deepinfra/fp8" as const,
		quantization: "fp8" as const,
		inputMicrousdPerMillionTokens: 80_000 as const,
		outputMicrousdPerMillionTokens: 180_000 as const,
		cacheReadMicrousdPerMillionTokens: 16_000 as const,
		supportedParametersDigest: empiricalStrictJsonDigest(supported),
		officialResponseDigest: empiricalSha256(bytes),
		observedAtMs: input.nowMs,
	});
	return Object.freeze({ ...material, observationDigest: empiricalStrictJsonDigest(material) });
}

export function admitD44D45FreshZeroByok(input: {
	readonly bytes: Uint8Array;
	readonly credential: D44D45CredentialV1;
	readonly nowMs: number;
}): D44D45ZeroByokObservationV1 {
	if (input.bytes.byteLength < 1 || input.bytes.byteLength > 16_384)
		throw new TypeError("D44 zero-BYOK artifact exceeded its bound");
	const value = object(
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.bytes)),
		"zeroByok",
	);
	const observedAtMs = Date.parse(String(value.observedAt));
	if (
		value.schemaVersion !== D44_D45_ZERO_BYOK_SCHEMA ||
		value.decisionRef !== "graphrefly-ts:D45" ||
		value.authorityRef !== "graphrefly-ts:D44" ||
		value.workspaceName !== "GraphReFly" ||
		value.workspaceSlug !== "graph-re-fly" ||
		value.keyName !== "Local Eval 2" ||
		value.byokCredentialCount !== 0 ||
		value.providerObservation !== "DeepInfra Not configured" ||
		value.source !== "openrouter-browser-settings" ||
		!Number.isSafeInteger(observedAtMs) ||
		Math.abs(input.nowMs - observedAtMs) > 3_600_000 ||
		!input.credential.bearerToken.startsWith(String(value.keyVisiblePrefix)) ||
		!input.credential.bearerToken.endsWith(String(value.keyVisibleSuffix)) ||
		JSON.stringify(value.allowedModels) !== JSON.stringify(["deepseek/deepseek-v4-flash-0731"]) ||
		JSON.stringify(value.allowedProviders) !== JSON.stringify(["DeepInfra"])
	)
		throw new TypeError("D44 zero-BYOK observation failed same-credential admission");
	const material = strictSnapshot({
		workspaceSlug: "graph-re-fly" as const,
		keyName: "Local Eval 2" as const,
		byokCredentialCount: 0 as const,
		providerObservation: "DeepInfra Not configured" as const,
		observedAtMs,
		sourceArtifactDigest: empiricalSha256(input.bytes),
	});
	return Object.freeze({ ...material, observationDigest: empiricalStrictJsonDigest(material) });
}

export function composeD44D45Preclaim(input: {
	readonly pricing: D44D45PricingObservationV1;
	readonly zeroByok: D44D45ZeroByokObservationV1;
	readonly credential: D44D45CredentialV1;
}): D44D45PreclaimV1 {
	const material = strictSnapshot({
		pricingObservationDigest: input.pricing.observationDigest,
		zeroByokObservationDigest: input.zeroByok.observationDigest,
		credentialBindingDigest: empiricalStrictJsonDigest({
			credentialBindingRef: input.credential.credentialBindingRef,
			credentialBindingRevision: input.credential.credentialBindingRevision,
		}),
	});
	const result = Object.freeze({
		...material,
		preclaimDigest: empiricalStrictJsonDigest(material),
	});
	preclaims.add(result);
	return result;
}

export async function acquireD44D45DispatchClaim(input: {
	readonly privateRoot: string;
	readonly preclaim: D44D45PreclaimV1;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
}): Promise<D44D45DispatchClaimV1> {
	if (!preclaims.delete(input.preclaim))
		throw new TypeError("D44 preclaim must be same-process single-use");
	const privateRoot = resolve(input.privateRoot);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("D44 private root drifted");
	const claimRoot = join(privateRoot, `.${D44_D45_LIVE_CLAIM_REF}`);
	await mkdir(claimRoot, { mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const material = strictSnapshot({
		schemaVersion: D44_D45_CLAIM_SCHEMA,
		claimRef: D44_D45_LIVE_CLAIM_REF,
		authorityRef: "graphrefly-ts:D44" as const,
		architectureRef: "graphrefly-ts:D45" as const,
		generationRef: D44_D45_LIVE_GENERATION_REF,
		preclaimDigest: input.preclaim.preclaimDigest,
		implementationCommit: input.implementationCommit,
		implementationManifestDigest: input.implementationManifestDigest,
		qualificationArtifactDigest: input.qualificationArtifactDigest,
		qualificationDigest: input.qualificationDigest,
		blockHardCapMicrousd: 6_000_000 as const,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
	});
	const claim = Object.freeze({ ...material, claimDigest: empiricalStrictJsonDigest(material) });
	const bytes = strictJsonCodec.encode(claim);
	const file = join(claimRoot, "dispatch-claim.v1.json");
	const handle = await open(
		file,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	const rootHandle = await open(claimRoot, constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await rootHandle.sync();
	} finally {
		await rootHandle.close();
	}
	claims.set(claim, { file, bytes });
	return claim;
}

export async function consumeD44D45DispatchClaim(input: {
	readonly claim: D44D45DispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
}): Promise<D44D45ExecutionAuthorityV1> {
	const state = claims.get(input.claim);
	if (state === undefined) throw new TypeError("D44 dispatch claim was absent or consumed");
	const reader = await open(state.file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		if (!sameBytes(new Uint8Array(await reader.readFile()), state.bytes))
			throw new TypeError("D44 durable dispatch claim drifted");
	} finally {
		await reader.close();
	}
	claims.delete(input.claim);
	const currentKeyAdmission = consumeOpenRouterCurrentKeySpendAdmission(input.currentKeyAdmission);
	const material = strictSnapshot({
		claimDigest: input.claim.claimDigest,
		currentKeyAdmissionDigest: currentKeyAdmission.admissionDigest,
	});
	return Object.freeze({
		claim: input.claim,
		currentKeyAdmission,
		authorityDigest: empiricalStrictJsonDigest(material),
	});
}

export function constructD44D45LiveBundle(input: {
	readonly authority: D44D45ExecutionAuthorityV1;
	readonly pricing: D44D45PricingObservationV1;
	readonly zeroByok: D44D45ZeroByokObservationV1;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly providerCalls: number;
	readonly measurement:
		| Readonly<{ disposition: "success"; evidence: D45CanonicalEvidenceV1 }>
		| Readonly<{ disposition: "partial-failure"; partialEvidence: D45PartialCanonicalEvidenceV1 }>;
}): D44D45LiveBundleV1 {
	const graphEvidence =
		input.measurement.disposition === "success"
			? validateD45CanonicalEvidence(input.measurement.evidence)
			: null;
	const partialGraphEvidence =
		input.measurement.disposition === "partial-failure"
			? validateD45PartialCanonicalEvidence(input.measurement.partialEvidence)
			: null;
	const efficacyClaim =
		graphEvidence?.frozenGateWouldPass === true
			? ("frozen-task-block-positive-differential" as const)
			: ("none" as const);
	const material = strictSnapshot({
		schemaVersion: D44_D45_LIVE_BUNDLE_SCHEMA,
		generationRef: D44_D45_LIVE_GENERATION_REF,
		disposition: input.measurement.disposition,
		claimDigest: input.authority.claim.claimDigest,
		currentKeyAdmissionDigest: input.authority.currentKeyAdmission.admissionDigest,
		pricingObservationDigest: input.pricing.observationDigest,
		zeroByokObservationDigest: input.zeroByok.observationDigest,
		implementationCommit: input.implementationCommit,
		implementationManifestDigest: input.implementationManifestDigest,
		qualificationArtifactDigest: input.qualificationArtifactDigest,
		qualificationDigest: input.qualificationDigest,
		providerCalls: input.providerCalls,
		graphEvidence,
		partialGraphEvidence,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	return Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
}

export async function persistD44D45LiveBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D44D45LiveBundleV1;
}): Promise<Readonly<{ artifactDigest: string; receiptDigest: string }>> {
	if (!isAbsolute(input.privateRoot)) throw new TypeError("D44 persistence root must be absolute");
	const generationRoot = join(input.privateRoot, D44_D45_LIVE_GENERATION_REF);
	await mkdir(generationRoot, { mode: 0o700 });
	await chmod(generationRoot, 0o700);
	const target = join(generationRoot, "bundle.v1.json");
	const temp = `${target}.tmp-${process.pid}`;
	const bytes = strictJsonCodec.encode(input.bundle);
	const writer = await open(
		temp,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await writer.writeFile(bytes);
		await writer.sync();
	} finally {
		await writer.close();
	}
	await rename(temp, target);
	const root = await open(dirname(target), constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await root.sync();
	} finally {
		await root.close();
	}
	const artifactDigest = empiricalSha256(bytes);
	return Object.freeze({
		artifactDigest,
		receiptDigest: empiricalStrictJsonDigest({
			artifactDigest,
			bundleDigest: input.bundle.bundleDigest,
		}),
	});
}

export async function prepareD44D45PrivateRoot(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	await chmod(path, 0o700);
	const stat = await lstat(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700)
		throw new TypeError("D44 private root identity failed");
}

export async function removeD44D45TestRoot(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true });
}
