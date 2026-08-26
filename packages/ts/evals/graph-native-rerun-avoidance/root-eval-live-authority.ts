import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ObserveEvent } from "../../src/graph/inspect.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	coordinate,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	assertRootEvalFindingTerminalConsistency,
	assertRootEvalObservationRuntimeShape,
	assertRootEvalObservationSequence,
	assertRootEvalObservationTransition,
	EVAL_PROVIDER_OUTCOME_REASON_CODES,
	EVAL_VERIFICATION_STAGE_KEYS,
	EVAL_VERIFICATION_TERMINAL_REASONS,
	type EvalFinding,
	type EvalObservation,
	type EvalProviderOutcomeReasonCounts,
	type EvalVerificationDiagnostics,
	type EvalVerificationReasonCounts,
	type EvalVerificationStageCounts,
	ROOT_EVAL_TOPOLOGY_REVISION,
	type RootEvalRunResult,
} from "./eval-topology.js";
import { CURRENT_IMPLEMENTATION_MANIFEST_DIGEST } from "./implementation-manifest.js";
import {
	parseRootEvalUniqueJson,
	ROOT_EVAL_LIVE_DECISION_REF,
	ROOT_EVAL_LIVE_TASK_BINDING_DIGEST,
	RootEvalCallerSettlementDeadlineExpired,
	readRootEvalBoundedResponseBytes,
} from "./root-eval-live.js";
import {
	ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT_DIGEST,
	ROOT_EVAL_LIVE_QUALIFICATION,
} from "./root-eval-live-qualification.js";

export const ROOT_EVAL_LIVE_PRICING_SOURCE =
	"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints" as const;
export const ROOT_EVAL_LIVE_ZDR_SOURCE = "https://openrouter.ai/api/v1/endpoints/zdr" as const;
export const ROOT_EVAL_LIVE_CURRENT_KEY_ENDPOINT = "https://openrouter.ai/api/v1/key" as const;
export const ROOT_EVAL_LIVE_ZERO_BYOK_SCHEMA =
	"graphrefly-ts.d125.zero-byok-observation.v12" as const;
export const ROOT_EVAL_LIVE_CLAIM_SCHEMA = "graphrefly-ts.root-eval-live-claim.v15" as const;
export const ROOT_EVAL_LIVE_EVIDENCE_SCHEMA = "graphrefly-ts.root-eval-live-evidence.v18" as const;
export const ROOT_EVAL_LIVE_PRECLAIM_FAILURE_SCHEMA =
	"graphrefly-ts.root-eval-live-preclaim-failure.v15" as const;
export const ROOT_EVAL_LIVE_GENERATION_REF = "root-eval-live-2026-08-26-d125-v1" as const;
export const ROOT_EVAL_LIVE_CLAIM_REF = "root-eval-live-claim-2026-08-26-d125-v1" as const;
export const ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD = 6_000_000 as const;
export const ROOT_EVAL_LIVE_KEY_LIMIT_MICROUSD = 32_000_000 as const;
export const ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST =
	CURRENT_IMPLEMENTATION_MANIFEST_DIGEST;
export const ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST =
	ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT_DIGEST;
export const ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST =
	ROOT_EVAL_LIVE_QUALIFICATION.qualificationDigest;
export const ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST = ROOT_EVAL_LIVE_TASK_BINDING_DIGEST;
export const ROOT_EVAL_HISTORICAL_D85_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:67c7c1cdae92a696200ee740e20e1ffd77b10fd1e3def0bda4999db206bbdc37" as const;
export const ROOT_EVAL_HISTORICAL_D85_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:5aadc43434e7e8d568159f135c91e3cdca27c4a1e3c6573b953e0fd4e21286f8" as const;
export const ROOT_EVAL_HISTORICAL_D85_QUALIFICATION_DIGEST =
	"sha256:da6f3502314ca7fd0e68cd879ca7b8da5661c74e501b4c1d3f128dbe201eb9c7" as const;
export const ROOT_EVAL_HISTORICAL_D85_TASK_BINDING_DIGEST =
	"sha256:f020b4fdcb290a17ab7716fb6b432293c99c1da4d9d9489eceff1fa2de1901e8" as const;
export const ROOT_EVAL_D85_RETIREMENT_REF = "graphrefly-ts:D86" as const;

type RootEvalLiveAdmissionKind = "pricing" | "zero-byok" | "current-key";
interface RootEvalLiveAdmissionProvenance {
	readonly kind: RootEvalLiveAdmissionKind;
	readonly controlPlaneTransport: boolean;
	readonly trustedClock: boolean;
	readonly issuedAtMs: number;
	readonly credentialFingerprintDigest: string | null;
}

// Private-slot security provenance only: never domain state or lifecycle authority.
class RootEvalLiveAdmissionCapability<T extends object> {
	readonly #provenance: RootEvalLiveAdmissionProvenance;

	constructor(value: T, provenance: RootEvalLiveAdmissionProvenance) {
		Object.assign(this, value);
		this.#provenance = Object.freeze({ ...provenance });
		Object.freeze(this);
	}

	static provenance(value: unknown): RootEvalLiveAdmissionProvenance | undefined {
		try {
			return (value as RootEvalLiveAdmissionCapability<object>).#provenance;
		} catch {
			return undefined;
		}
	}
}
const ROOT_EVAL_LIVE_CONTROL_PLANE_FETCH = globalThis.fetch;

function credentialFingerprint(credential: RootEvalLiveCredential): string {
	return empiricalSha256(new TextEncoder().encode(credential.bearerToken));
}

function brandAdmission<T extends object>(
	value: T,
	provenance: RootEvalLiveAdmissionProvenance,
): T {
	return new RootEvalLiveAdmissionCapability(value, provenance) as unknown as T;
}

export interface RootEvalLiveCredential {
	readonly bearerToken: string;
	readonly bindingRef: "openrouter.local-eval-2";
	readonly bindingRevision: "2026-08-26.d125.v1";
}

export interface RootEvalLivePricingObservation {
	readonly sourceUrl: typeof ROOT_EVAL_LIVE_PRICING_SOURCE;
	readonly modelRef: "deepseek/deepseek-v4-flash-0731";
	readonly endpointModelRef: "deepseek/deepseek-v4-flash-20260731";
	readonly providerName: "Fireworks";
	readonly providerRef: "fireworks";
	readonly quantization: "unknown";
	readonly inputMicrousdPerMillionTokens: 220_000;
	readonly outputMicrousdPerMillionTokens: 660_000;
	readonly cacheReadMicrousdPerMillionTokens: 7_000;
	readonly zeroDataRetention: true;
	readonly promptTraining: false;
	readonly zdrSourceUrl: typeof ROOT_EVAL_LIVE_ZDR_SOURCE;
	readonly zdrResponseDigest: string;
	readonly observedAtMs: number;
	readonly officialResponseDigest: string;
	readonly observationDigest: string;
}

export interface RootEvalLiveZeroByokObservation {
	readonly workspaceSlug: "graph-re-fly";
	readonly keyName: "Local Eval 2";
	readonly byokCredentialCount: 0;
	readonly providerObservation: "Fireworks Not configured";
	readonly observedAtMs: number;
	readonly sourceArtifactDigest: string;
	readonly observationDigest: string;
}

export interface RootEvalLiveCurrentKeyAdmission {
	readonly limitMicrousd: 32_000_000;
	readonly remainingMicrousd: number;
	readonly usageMicrousd: number;
	readonly limitReset: "none";
	readonly isManagementKey: false;
	readonly admissionDigest: string;
}

export interface RootEvalLiveClaim {
	readonly schemaVersion: typeof ROOT_EVAL_LIVE_CLAIM_SCHEMA;
	readonly executionMode: "live" | "no-network-qualification";
	readonly claimRef: typeof ROOT_EVAL_LIVE_CLAIM_REF;
	readonly decisionRef: typeof ROOT_EVAL_LIVE_DECISION_REF;
	readonly generationRef: typeof ROOT_EVAL_LIVE_GENERATION_REF;
	readonly implementationCoordinate: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly taskBindingDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly credentialBindingDigest: string;
	readonly credentialFingerprintDigest: string;
	readonly currentKeyBeforeDigest: string;
	readonly recoveryEnvelope: Readonly<{
		readonly pricing: RootEvalLivePricingObservation;
		readonly zeroByok: RootEvalLiveZeroByokObservation;
		readonly currentKeyBefore: RootEvalLiveCurrentKeyAdmission;
	}>;
	readonly campaignHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface RootEvalLiveClaimCommit {
	readonly claim: RootEvalLiveClaim;
	readonly postCommitFailureDigest: string | null;
}

class RootEvalLiveClaimCommitCapability implements RootEvalLiveClaimCommit {
	readonly #committedAuthority = true;
	readonly #privateRoot: string;

	constructor(
		readonly claim: RootEvalLiveClaim,
		readonly postCommitFailureDigest: string | null,
		privateRoot: string,
	) {
		this.#privateRoot = privateRoot;
		Object.freeze(this);
	}

	static unwrap(value: unknown, privateRoot: string): RootEvalLiveClaimCommit | undefined {
		try {
			const capability = value as RootEvalLiveClaimCommitCapability;
			if (
				!capability.#committedAuthority ||
				capability.#privateRoot !== privateRoot ||
				capability.postCommitFailureDigest !== null
			)
				return undefined;
			return value as RootEvalLiveClaimCommitCapability;
		} catch {
			return undefined;
		}
	}
}

export interface RootEvalLiveEvidence {
	readonly schemaVersion: typeof ROOT_EVAL_LIVE_EVIDENCE_SCHEMA;
	readonly generationRef: typeof ROOT_EVAL_LIVE_GENERATION_REF;
	readonly disposition: "success" | "partial-failure";
	readonly claimDigest: string;
	readonly currentKeyBeforeDigest: string | null;
	readonly currentKeyAfterDigest: string | null;
	readonly billedUsageDeltaMicrousd: number | null;
	readonly billedRemainingDeltaMicrousd: number | null;
	readonly cleanupDisposition: "complete" | "failed";
	readonly implementationCoordinate: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly taskBindingDigest: string;
	readonly providerCalls: number;
	readonly graphResult: RootEvalLiveGraphEvidence | null;
	readonly partialGraphObservations: readonly ObserveEvent[];
	readonly latestGraphObservation: ObserveEvent | null;
	readonly admissionReport: RootEvalLiveAdmissionReport;
	readonly failureDigest: string | null;
	readonly technicalFailureCode: "caller-settlement-deadline-expired" | null;
	readonly efficacyClaim: "none" | "frozen-task-positive-differential";
	readonly causalAttribution: "frozen-task-memory-context-differential" | "undetermined";
	readonly evidenceDigest: string;
}

export interface RootEvalLiveGraphEvidence {
	readonly finding: EvalFinding;
	readonly observations: readonly ObserveEvent[];
	readonly peakConcurrentEffects: number;
	readonly executedAdmissionDigests: readonly string[];
}

export const ROOT_EVAL_LIVE_AUTHORITY_VIOLATION_CODES = Object.freeze([
	"authority.claim-shape-invalid",
	"authority.claim-digest-invalid",
	"authority.pricing-shape-invalid",
	"authority.pricing-digest-invalid",
	"authority.pricing-semantics-mismatch",
	"authority.zero-byok-shape-invalid",
	"authority.zero-byok-digest-invalid",
	"authority.zero-byok-semantics-mismatch",
	"authority.current-key-before-shape-invalid",
	"authority.current-key-before-digest-invalid",
	"authority.current-key-before-semantics-mismatch",
	"authority.current-key-after-shape-invalid",
	"authority.current-key-after-digest-invalid",
	"authority.current-key-after-semantics-mismatch",
	"authority.claim-pricing-binding-mismatch",
	"authority.claim-zero-byok-binding-mismatch",
	"authority.claim-schema-mismatch",
	"authority.claim-execution-mode-invalid",
	"authority.claim-ref-mismatch",
	"authority.claim-decision-mismatch",
	"authority.claim-generation-mismatch",
	"authority.claim-task-binding-mismatch",
	"authority.claim-campaign-cap-mismatch",
	"authority.claim-key-limit-mismatch",
	"authority.claim-implementation-coordinate-invalid",
	"authority.claim-implementation-coordinate-binding-mismatch",
	"authority.claim-implementation-manifest-mismatch",
	"authority.claim-qualification-artifact-mismatch",
	"authority.claim-qualification-mismatch",
	"authority.claim-credential-binding-mismatch",
	"authority.claim-current-key-before-binding-mismatch",
	"authority.claim-recovery-envelope-mismatch",
	"authority.current-key-limit-mismatch",
	"authority.current-key-remaining-below-cap",
	"authority.current-key-reconciliation-nonmonotonic",
	"authority.provider-call-count-invalid",
	"authority.result-and-failure-missing",
] as const);

export type RootEvalLiveAuthorityViolationCode =
	(typeof ROOT_EVAL_LIVE_AUTHORITY_VIOLATION_CODES)[number];

export class RootEvalLiveAuthorityAdmissionError extends TypeError {
	readonly violationCodes: readonly RootEvalLiveAuthorityViolationCode[];

	constructor(violationCodes: readonly RootEvalLiveAuthorityViolationCode[]) {
		super(`root eval live authority admission rejected: ${violationCodes.join(",")}`);
		this.name = "RootEvalLiveAuthorityAdmissionError";
		this.violationCodes = Object.freeze([...violationCodes]);
	}
}

export const ROOT_EVAL_LIVE_SUCCESS_VIOLATION_CODES = Object.freeze([
	"success.graph-shape-invalid",
	"success.current-key-before-missing",
	"success.failure-present",
	"success.cleanup-incomplete",
	"success.campaign-ref-mismatch",
	"success.replicate-count-mismatch",
	"success.completed-work-items-mismatch",
	"success.finding-mismatch",
	"success.pass-counts-invalid",
	"success.observations-empty",
	"success.terminal-observation-missing",
	"success.terminal-finding-mismatch",
	"success.terminal-stopping-reason-mismatch",
	"success.terminal-observation-order-invalid",
	"success.terminal-observation-state-mismatch",
	"success.peak-concurrency-below-one",
	"success.peak-concurrency-above-six",
	"success.admission-count-below-thirty",
	"success.admission-identities-duplicate",
	"success.finding-admitted-attempts-mismatch",
	"success.provider-outcome-reason-count-mismatch",
	"success.accounted-budget-above-cap",
	"success.provider-call-count-mismatch",
] as const);

export type RootEvalLiveSuccessViolationCode =
	(typeof ROOT_EVAL_LIVE_SUCCESS_VIOLATION_CODES)[number];

const ROOT_EVAL_CALLER_DISPOSITION_VIOLATION_CODES = Object.freeze([
	"success.current-key-before-missing",
	"success.failure-present",
	"success.cleanup-incomplete",
	"success.provider-call-count-mismatch",
] as const satisfies readonly RootEvalLiveSuccessViolationCode[]);

export interface RootEvalLiveRejectedGraphSummary {
	readonly campaignRef: string;
	readonly replicateCount: number | null;
	readonly completedWorkItems: number | null;
	readonly admittedAttempts: number | null;
	readonly stoppingReason: string;
	readonly finding: string;
	readonly accountedUpperBoundMicrousd: number | null;
	readonly providerReportedMicrousd: number | null;
	readonly pricingRoundingAllowanceMicrousd: number | null;
	readonly providerReportedLowerBoundMicrousd: number | null;
	readonly observedBilledMicrousd: number | null;
	readonly billingObservationCount: number | null;
	readonly billingStableIntervals: number | null;
	readonly reconciledBilledMicrousd: number | null;
	readonly billingDisposition: string;
	readonly passCounts: Readonly<Record<string, number | null>>;
	readonly providerOutcomeReasonCounts: EvalProviderOutcomeReasonCounts;
	readonly observationCount: number;
	readonly terminalObservation: Readonly<{
		readonly campaignRef: string;
		readonly stoppingReason: string;
		readonly finding: string;
	}> | null;
	readonly peakConcurrentEffects: number | null;
	readonly executedAdmissionCount: number;
	readonly executedAdmissionSetDigest: string;
	readonly providerCalls: number;
	readonly billedUsageDeltaMicrousd: number | null;
	readonly billedRemainingDeltaMicrousd: number | null;
}

export interface RootEvalLiveAdmissionReport {
	readonly status: "admitted" | "rejected" | "not-candidate";
	readonly violationCodes: readonly RootEvalLiveSuccessViolationCode[];
	readonly rejectedGraphSummary: RootEvalLiveRejectedGraphSummary | null;
}

export interface RootEvalLiveEvidenceInput {
	readonly claim: RootEvalLiveClaim;
	readonly currentKeyBefore: RootEvalLiveCurrentKeyAdmission | null;
	readonly currentKeyAfter: RootEvalLiveCurrentKeyAdmission | null;
	readonly pricing: RootEvalLivePricingObservation;
	readonly zeroByok: RootEvalLiveZeroByokObservation;
	readonly providerCalls: number;
	readonly graphResult: RootEvalRunResult | null;
	readonly partialGraphObservations: readonly ObserveEvent[];
	readonly failure: unknown | null;
	readonly cleanupDisposition: "complete" | "failed";
}

async function ensurePrivateRoot(path: string): Promise<string> {
	const privateRoot = resolve(path);
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	await chmod(privateRoot, 0o700);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("root eval live private root drifted");
	return privateRoot;
}

async function installExclusivePrivateFile(
	privateRoot: string,
	name: string,
	bytes: Uint8Array,
): Promise<string | null> {
	const target = join(privateRoot, name);
	const stage = join(privateRoot, `.${name}.stage-${randomUUID()}`);
	const handle = await open(
		stage,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	// A hard-link is the single atomic commit point: the complete fsynced bytes become
	// visible under an exclusive final name, or an existing disposition wins unchanged.
	try {
		await link(stage, target);
	} catch (error) {
		await rm(stage, { force: true }).catch(() => undefined);
		throw error;
	}
	const postCommitErrors: unknown[] = [];
	try {
		const directory = await open(privateRoot, constants.O_RDONLY | constants.O_DIRECTORY);
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
		const reader = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			if (!sameBytes(new Uint8Array(await reader.readFile()), bytes))
				throw new TypeError("root eval exclusive private file bytes drifted");
		} finally {
			await reader.close();
		}
	} catch (error) {
		postCommitErrors.push(error);
	}
	await rm(stage, { force: true }).catch((error: unknown) => postCommitErrors.push(error));
	return postCommitErrors.length === 0
		? null
		: empiricalStrictJsonDigest({
				kind: "root-eval-exclusive-file-post-commit-failure",
				errors: postCommitErrors.map((error) =>
					error instanceof Error ? error.message : String(error),
				),
			});
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${path} must be an object`);
	return value as Record<string, unknown>;
}

function nonnegative(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		throw new TypeError(`${path} must be a non-negative finite number`);
	return value;
}

function microusd(value: unknown, direction: "ceil" | "floor", path: string): number {
	const scaled = nonnegative(value, path) * 1_000_000;
	const converted = direction === "ceil" ? Math.ceil(scaled) : Math.floor(scaled);
	if (!Number.isSafeInteger(converted)) throw new TypeError(`${path} exceeded safe integer bounds`);
	return converted;
}

export async function readRootEvalPrivateFile(path: string, maxBytes: number): Promise<Uint8Array> {
	const resolved = resolve(path);
	const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.size < 1 ||
			stat.size > maxBytes ||
			(await realpath(resolved)) !== resolved
		)
			throw new TypeError("root eval private input identity failed");
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError("root eval private input changed during read");
		} finally {
			await secondHandle.close();
		}
		return first;
	} finally {
		await handle.close();
	}
}

export function parseRootEvalLiveCredential(bytes: Uint8Array): RootEvalLiveCredential {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	let token: string | null = null;
	for (const line of text.split(/\r?\n/u)) {
		const match = /^OPENROUTER_API_KEY=(.*)$/u.exec(line);
		if (match === null) continue;
		if (token !== null) throw new TypeError("root eval credential contains duplicate keys");
		const raw = (match[1] ?? "").trim();
		token =
			(raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
				? raw.slice(1, -1)
				: raw;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("root eval credential was unavailable");
	return Object.freeze({
		bearerToken: token,
		bindingRef: "openrouter.local-eval-2" as const,
		bindingRevision: "2026-08-26.d125.v1" as const,
	});
}

export interface RootEvalLivePrivateInputs {
	readonly credential: RootEvalLiveCredential;
	readonly zeroByok: RootEvalLiveZeroByokObservation;
}

export async function qualifyRootEvalLivePrivateInputs(input: {
	readonly credentialPath: string;
	readonly zeroByokPath: string;
	readonly nowMs?: number;
}): Promise<RootEvalLivePrivateInputs> {
	const credential = parseRootEvalLiveCredential(
		await readRootEvalPrivateFile(input.credentialPath, 16_384),
	);
	const zeroByok = admitRootEvalLiveZeroByok({
		bytes: await readRootEvalPrivateFile(input.zeroByokPath, 16_384),
		credential,
		nowMs: input.nowMs,
	});
	return Object.freeze({ credential, zeroByok });
}

export async function readRootEvalLivePricing(input: {
	readonly fetchImpl: typeof fetch;
	readonly nowMs?: number;
}): Promise<RootEvalLivePricingObservation> {
	const observedAtMs = input.nowMs ?? Date.now();
	const response = await input.fetchImpl(ROOT_EVAL_LIVE_PRICING_SOURCE, {
		method: "GET",
		redirect: "error",
		cache: "no-store",
		credentials: "omit",
		referrerPolicy: "no-referrer",
		headers: { accept: "application/json", "cache-control": "no-cache, no-store, max-age=0" },
		signal: AbortSignal.timeout(30_000),
	});
	if (
		response.status !== 200 ||
		response.redirected ||
		response.url !== ROOT_EVAL_LIVE_PRICING_SOURCE
	)
		throw new TypeError("root eval exact provider route was unavailable");
	const bytes = await readRootEvalBoundedResponseBytes(
		response,
		1_048_576,
		"root eval official pricing response",
	);
	if (bytes.byteLength < 1 || bytes.byteLength > 1_048_576)
		throw new TypeError("root eval official pricing response exceeded its byte bound");
	const root = object(
		parseRootEvalUniqueJson(bytes, "root eval official pricing response"),
		"pricing response",
	);
	const data = object(root.data, "pricing response.data");
	if (data.id !== "deepseek/deepseek-v4-flash-0731" || !Array.isArray(data.endpoints))
		throw new TypeError("root eval exact model route drifted");
	const matches = data.endpoints
		.map((entry) => object(entry, "pricing endpoint"))
		.filter(
			(endpoint) =>
				endpoint.provider_name === "Fireworks" &&
				endpoint.tag === "fireworks" &&
				endpoint.quantization === "unknown" &&
				endpoint.model_id === "deepseek/deepseek-v4-flash-0731" &&
				endpoint.name === "Fireworks | deepseek/deepseek-v4-flash-20260731",
		);
	if (matches.length !== 1) throw new TypeError("root eval exact Fireworks route was ambiguous");
	const endpoint = matches[0]!;
	if (
		!Array.isArray(endpoint.supported_parameters) ||
		!["max_tokens", "reasoning", "response_format", "structured_outputs"].every((item) =>
			(endpoint.supported_parameters as unknown[]).includes(item),
		)
	)
		throw new TypeError("root eval exact route omitted required parameters");
	const pricing = object(endpoint.pricing, "pricing endpoint.pricing");
	if (
		pricing.prompt !== "0.00000022" ||
		pricing.completion !== "0.00000066" ||
		pricing.input_cache_read !== "0.000000007"
	)
		throw new TypeError("root eval exact route pricing drifted");
	const zdrResponse = await input.fetchImpl(ROOT_EVAL_LIVE_ZDR_SOURCE, {
		method: "GET",
		redirect: "error",
		cache: "no-store",
		credentials: "omit",
		referrerPolicy: "no-referrer",
		headers: { accept: "application/json", "cache-control": "no-cache, no-store, max-age=0" },
		signal: AbortSignal.timeout(30_000),
	});
	if (
		zdrResponse.status !== 200 ||
		zdrResponse.redirected ||
		zdrResponse.url !== ROOT_EVAL_LIVE_ZDR_SOURCE
	)
		throw new TypeError("root eval exact provider ZDR registry was unavailable");
	const zdrBytes = await readRootEvalBoundedResponseBytes(
		zdrResponse,
		4 * 1_048_576,
		"root eval official ZDR response",
	);
	if (zdrBytes.byteLength < 1 || zdrBytes.byteLength > 4 * 1_048_576)
		throw new TypeError("root eval official ZDR response exceeded its byte bound");
	const zdrRoot = object(
		parseRootEvalUniqueJson(zdrBytes, "root eval official ZDR response"),
		"ZDR response",
	);
	if (!Array.isArray(zdrRoot.data)) throw new TypeError("root eval ZDR registry shape drifted");
	const zdrMatches = zdrRoot.data
		.map((entry) => object(entry, "ZDR endpoint"))
		.filter(
			(candidate) =>
				candidate.provider_name === "Fireworks" &&
				candidate.tag === "fireworks" &&
				candidate.model_id === "deepseek/deepseek-v4-flash-0731" &&
				candidate.name === "Fireworks | deepseek/deepseek-v4-flash-20260731",
		);
	if (zdrMatches.length !== 1)
		throw new TypeError("root eval exact Fireworks route was not uniquely ZDR-qualified");
	const material = strictSnapshot({
		sourceUrl: ROOT_EVAL_LIVE_PRICING_SOURCE,
		modelRef: "deepseek/deepseek-v4-flash-0731" as const,
		endpointModelRef: "deepseek/deepseek-v4-flash-20260731" as const,
		providerName: "Fireworks" as const,
		providerRef: "fireworks" as const,
		quantization: "unknown" as const,
		inputMicrousdPerMillionTokens: 220_000 as const,
		outputMicrousdPerMillionTokens: 660_000 as const,
		cacheReadMicrousdPerMillionTokens: 7_000 as const,
		zeroDataRetention: true as const,
		promptTraining: false as const,
		zdrSourceUrl: ROOT_EVAL_LIVE_ZDR_SOURCE,
		zdrResponseDigest: empiricalSha256(zdrBytes),
		observedAtMs,
		officialResponseDigest: empiricalSha256(bytes),
	});
	return brandAdmission(
		{ ...material, observationDigest: empiricalStrictJsonDigest(material) },
		{
			kind: "pricing",
			controlPlaneTransport: input.fetchImpl === ROOT_EVAL_LIVE_CONTROL_PLANE_FETCH,
			trustedClock: input.nowMs === undefined,
			issuedAtMs: observedAtMs,
			credentialFingerprintDigest: null,
		},
	);
}

export function admitRootEvalLiveZeroByok(input: {
	readonly bytes: Uint8Array;
	readonly credential: RootEvalLiveCredential;
	readonly nowMs?: number;
}): RootEvalLiveZeroByokObservation {
	const nowMs = input.nowMs ?? Date.now();
	if (input.bytes.byteLength < 1 || input.bytes.byteLength > 16_384)
		throw new TypeError("root eval zero-BYOK artifact exceeded its bound");
	const value = object(
		parseRootEvalUniqueJson(input.bytes, "root eval zero-BYOK artifact"),
		"zero-BYOK artifact",
	);
	const observedAtMs = Date.parse(String(value.observedAt));
	const visiblePrefix = value.keyVisiblePrefix;
	const visibleSuffix = value.keyVisibleSuffix;
	if (
		value.schemaVersion !== ROOT_EVAL_LIVE_ZERO_BYOK_SCHEMA ||
		value.decisionRef !== ROOT_EVAL_LIVE_DECISION_REF ||
		value.workspaceName !== "GraphReFly" ||
		value.workspaceSlug !== "graph-re-fly" ||
		value.keyName !== "Local Eval 2" ||
		value.byokCredentialCount !== 0 ||
		value.providerObservation !== "Fireworks Not configured" ||
		value.source !== "openrouter-browser-settings" ||
		value.guardrailId !== "2c97d3e1-b4cc-4246-95d7-33eb27fb65ab" ||
		value.guardrailName !== "B112 DeepSeek V4 Flash" ||
		value.guardrailDescription !==
			"Dedicated Local Eval 2 guardrail for the B112 DeepSeek V4 Flash 0731 Fireworks-only structured-proposal route." ||
		value.keyAssigned !== true ||
		value.restrictionMode !== "only-allow" ||
		value.paidEndpointTrainingAllowed !== false ||
		value.providerEligible !== true ||
		value.requestDataCollection !== "deny" ||
		value.requestZdrRequired !== true ||
		!Number.isSafeInteger(observedAtMs) ||
		Math.abs(nowMs - observedAtMs) > 3_600_000 ||
		typeof visiblePrefix !== "string" ||
		visiblePrefix.length < 8 ||
		visiblePrefix.length > 128 ||
		typeof visibleSuffix !== "string" ||
		visibleSuffix.length < 3 ||
		visibleSuffix.length > 128 ||
		visiblePrefix.length + visibleSuffix.length < 15 ||
		/\s/u.test(visiblePrefix + visibleSuffix) ||
		!input.credential.bearerToken.startsWith(visiblePrefix) ||
		!input.credential.bearerToken.endsWith(visibleSuffix) ||
		JSON.stringify(value.allowedModels) !== JSON.stringify(["deepseek/deepseek-v4-flash-0731"]) ||
		JSON.stringify(value.allowedProviders) !== JSON.stringify(["Fireworks"])
	)
		throw new TypeError("root eval zero-BYOK artifact failed same-credential admission");
	const material = strictSnapshot({
		workspaceSlug: "graph-re-fly" as const,
		keyName: "Local Eval 2" as const,
		byokCredentialCount: 0 as const,
		providerObservation: "Fireworks Not configured" as const,
		observedAtMs,
		sourceArtifactDigest: empiricalSha256(input.bytes),
	});
	return brandAdmission(
		{ ...material, observationDigest: empiricalStrictJsonDigest(material) },
		{
			kind: "zero-byok",
			controlPlaneTransport: true,
			trustedClock: input.nowMs === undefined,
			issuedAtMs: nowMs,
			credentialFingerprintDigest: credentialFingerprint(input.credential),
		},
	);
}

export async function readRootEvalLiveCurrentKey(input: {
	readonly fetchImpl: typeof fetch;
	readonly credential: RootEvalLiveCredential;
	readonly minimumRemainingMicrousd?: number;
	readonly nowMs?: number;
	readonly signal?: AbortSignal;
}): Promise<RootEvalLiveCurrentKeyAdmission> {
	const issuedAtMs = input.nowMs ?? Date.now();
	const response = await input.fetchImpl(ROOT_EVAL_LIVE_CURRENT_KEY_ENDPOINT, {
		method: "GET",
		headers: {
			authorization: `Bearer ${input.credential.bearerToken}`,
			accept: "application/json",
		},
		redirect: "error",
		cache: "no-store",
		credentials: "omit",
		referrerPolicy: "no-referrer",
		signal:
			input.signal === undefined
				? AbortSignal.timeout(30_000)
				: AbortSignal.any([AbortSignal.timeout(30_000), input.signal]),
	});
	if (response.status !== 200) throw new TypeError("root eval current-key admission was rejected");
	const bytes = await readRootEvalBoundedResponseBytes(
		response,
		16_384,
		"root eval current-key response",
	);
	if (bytes.byteLength < 1 || bytes.byteLength > 16_384)
		throw new TypeError("root eval current-key response exceeded its bound");
	const root = object(
		parseRootEvalUniqueJson(bytes, "root eval current-key response"),
		"current-key response",
	);
	const data = object(root.data, "current-key response.data");
	const limitMicrousd = microusd(data.limit, "floor", "current-key limit");
	const remainingMicrousd = microusd(data.limit_remaining, "floor", "current-key remaining");
	const usageMicrousd = microusd(data.usage, "ceil", "current-key usage");
	if (
		limitMicrousd !== ROOT_EVAL_LIVE_KEY_LIMIT_MICROUSD ||
		remainingMicrousd <
			(input.minimumRemainingMicrousd ?? ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD) ||
		remainingMicrousd > limitMicrousd ||
		usageMicrousd > limitMicrousd ||
		data.limit_reset !== null ||
		data.is_management_key !== false
	)
		throw new TypeError("root eval current-key metadata failed spend admission");
	const material = strictSnapshot({
		limitMicrousd: ROOT_EVAL_LIVE_KEY_LIMIT_MICROUSD,
		remainingMicrousd,
		usageMicrousd,
		limitReset: "none" as const,
		isManagementKey: false as const,
	});
	return brandAdmission(
		{ ...material, admissionDigest: empiricalStrictJsonDigest(material) },
		{
			kind: "current-key",
			controlPlaneTransport: input.fetchImpl === ROOT_EVAL_LIVE_CONTROL_PLANE_FETCH,
			trustedClock: input.nowMs === undefined,
			issuedAtMs,
			credentialFingerprintDigest: credentialFingerprint(input.credential),
		},
	);
}

export interface RootEvalLiveClaimInput {
	readonly privateRoot: string;
	readonly implementationCoordinate: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly taskBindingDigest: string;
	readonly pricing: RootEvalLivePricingObservation;
	readonly zeroByok: RootEvalLiveZeroByokObservation;
	readonly credential: RootEvalLiveCredential;
	readonly currentKeyBefore: RootEvalLiveCurrentKeyAdmission;
	readonly nowMs?: number;
}

async function acquireRootEvalLiveClaimInternal(
	input: RootEvalLiveClaimInput,
	qualificationOnly: boolean,
): Promise<RootEvalLiveClaimCommit> {
	const pricingProvenance = RootEvalLiveAdmissionCapability.provenance(input.pricing);
	const zeroByokProvenance = RootEvalLiveAdmissionCapability.provenance(input.zeroByok);
	const currentKeyProvenance = RootEvalLiveAdmissionCapability.provenance(input.currentKeyBefore);
	const fingerprint = credentialFingerprint(input.credential);
	const nowMs = qualificationOnly ? (input.nowMs ?? Date.now()) : Date.now();
	const preclaimChecks = [
		[
			"implementation-manifest",
			input.implementationManifestDigest === ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		],
		[
			"qualification-artifact",
			input.qualificationArtifactDigest === ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		],
		["qualification", input.qualificationDigest === ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST],
		["task-binding", input.taskBindingDigest === ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST],
		[
			"implementation-coordinate",
			/^worktree:[0-9a-f]{40}:sha256:[0-9a-f]{64}$/u.test(input.implementationCoordinate) &&
				input.implementationCoordinate.endsWith(
					`:${ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST}`,
				),
		],
		[
			"pricing-admission",
			hasExactBrandedAdmission(input.pricing, PRICING_KEYS, "pricing") &&
				validPricingSemantics(input.pricing) &&
				validatesOwnDigest(input.pricing, "observationDigest"),
		],
		[
			"zero-byok-admission",
			hasExactBrandedAdmission(input.zeroByok, ZERO_BYOK_KEYS, "zero-byok") &&
				validZeroByokSemantics(input.zeroByok) &&
				validatesOwnDigest(input.zeroByok, "observationDigest"),
		],
		[
			"current-key-admission",
			hasExactBrandedAdmission(input.currentKeyBefore, CURRENT_KEY_KEYS, "current-key") &&
				validCurrentKeySemantics(input.currentKeyBefore) &&
				validatesOwnDigest(input.currentKeyBefore, "admissionDigest") &&
				input.currentKeyBefore.remainingMicrousd >= ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD,
		],
		[
			"freshness",
			Math.abs(nowMs - input.pricing.observedAtMs) <= 3_600_000 &&
				Math.abs(nowMs - input.zeroByok.observedAtMs) <= 3_600_000 &&
				currentKeyProvenance !== undefined &&
				Math.abs(nowMs - currentKeyProvenance.issuedAtMs) <= 60_000,
		],
		[
			"authority-provenance",
			qualificationOnly ||
				(input.nowMs === undefined &&
					pricingProvenance?.controlPlaneTransport === true &&
					pricingProvenance.trustedClock &&
					zeroByokProvenance?.trustedClock === true &&
					currentKeyProvenance?.controlPlaneTransport === true &&
					currentKeyProvenance.trustedClock),
		],
		[
			"same-credential-provenance",
			zeroByokProvenance?.credentialFingerprintDigest === fingerprint &&
				currentKeyProvenance?.credentialFingerprintDigest === fingerprint,
		],
		[
			"credential-binding",
			input.credential.bindingRef === "openrouter.local-eval-2" &&
				input.credential.bindingRevision === "2026-08-26.d125.v1",
		],
	] as const;
	const preclaimViolations = preclaimChecks.filter(([, passed]) => !passed).map(([code]) => code);
	if (preclaimViolations.length > 0)
		throw new TypeError(
			`root eval D125 claim coordinates did not match the current closure: ${preclaimViolations.join(",")}`,
		);
	const privateRoot = await ensurePrivateRoot(input.privateRoot);
	const material = strictSnapshot({
		schemaVersion: ROOT_EVAL_LIVE_CLAIM_SCHEMA,
		executionMode: qualificationOnly ? ("no-network-qualification" as const) : ("live" as const),
		claimRef: ROOT_EVAL_LIVE_CLAIM_REF,
		decisionRef: ROOT_EVAL_LIVE_DECISION_REF,
		generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
		implementationCoordinate: input.implementationCoordinate,
		implementationManifestDigest: input.implementationManifestDigest,
		qualificationArtifactDigest: input.qualificationArtifactDigest,
		qualificationDigest: input.qualificationDigest,
		taskBindingDigest: input.taskBindingDigest,
		pricingObservationDigest: input.pricing.observationDigest,
		zeroByokObservationDigest: input.zeroByok.observationDigest,
		credentialBindingDigest: empiricalStrictJsonDigest({
			bindingRef: input.credential.bindingRef,
			bindingRevision: input.credential.bindingRevision,
		}),
		credentialFingerprintDigest: fingerprint,
		currentKeyBeforeDigest: input.currentKeyBefore.admissionDigest,
		recoveryEnvelope: strictSnapshot({
			pricing: { ...input.pricing },
			zeroByok: { ...input.zeroByok },
			currentKeyBefore: { ...input.currentKeyBefore },
		}),
		campaignHardCapMicrousd: ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD,
		localEvalNoResetLimitMicrousd: ROOT_EVAL_LIVE_KEY_LIMIT_MICROUSD,
	});
	const claim = Object.freeze({ ...material, claimDigest: empiricalStrictJsonDigest(material) });
	const postCommitFailureDigest = await installExclusivePrivateFile(
		privateRoot,
		`.${ROOT_EVAL_LIVE_GENERATION_REF}.disposition.v15.json`,
		strictJsonCodec.encode(claim),
	);
	return new RootEvalLiveClaimCommitCapability(claim, postCommitFailureDigest, privateRoot);
}

export async function acquireRootEvalLiveClaim(
	input: RootEvalLiveClaimInput,
): Promise<RootEvalLiveClaimCommit> {
	return await acquireRootEvalLiveClaimInternal(input, false);
}

export async function acquireRootEvalLiveClaimForNoNetworkQualification(
	input: RootEvalLiveClaimInput,
): Promise<RootEvalLiveClaimCommit> {
	const root = await realpath(input.privateRoot);
	const temporaryRoot = await realpath(tmpdir());
	if (
		!root.startsWith(`${temporaryRoot}/`) ||
		input.credential.bearerToken !== "sk-or-v1-a44-middle-credential-e06"
	)
		throw new TypeError("root eval qualification claim was not isolated synthetic authority");
	return await acquireRootEvalLiveClaimInternal(input, true);
}

export async function persistRootEvalLivePreclaimFailure(input: {
	readonly privateRoot: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly taskBindingDigest: string;
	readonly failure: unknown;
}): Promise<
	Readonly<{ readonly receiptDigest: string; readonly postCommitFailureDigest: string | null }>
> {
	if (
		input.implementationManifestDigest !== ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST ||
		input.qualificationArtifactDigest !== ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST ||
		input.qualificationDigest !== ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST ||
		input.taskBindingDigest !== ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST
	)
		throw new TypeError("root eval D125 preclaim coordinates did not match the current closure");
	const privateRoot = await ensurePrivateRoot(input.privateRoot);
	const material = strictSnapshot({
		schemaVersion: ROOT_EVAL_LIVE_PRECLAIM_FAILURE_SCHEMA,
		decisionRef: ROOT_EVAL_LIVE_DECISION_REF,
		generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
		implementationManifestDigest: input.implementationManifestDigest,
		qualificationArtifactDigest: input.qualificationArtifactDigest,
		qualificationDigest: input.qualificationDigest,
		taskBindingDigest: input.taskBindingDigest,
		providerCalls: 0 as const,
		chargedCallExecuted: false as const,
		failureDigest: empiricalStrictJsonDigest({
			kind: "root-eval-live-preclaim-failure",
			message: input.failure instanceof Error ? input.failure.message : String(input.failure),
		}),
	});
	const receipt = Object.freeze({
		...material,
		receiptDigest: empiricalStrictJsonDigest(material),
	});
	const postCommitFailureDigest = await installExclusivePrivateFile(
		privateRoot,
		`.${ROOT_EVAL_LIVE_GENERATION_REF}.disposition.v15.json`,
		strictJsonCodec.encode(receipt),
	);
	return Object.freeze({ receiptDigest: receipt.receiptDigest, postCommitFailureDigest });
}

export function reconcileRootEvalLiveSpend(
	before: RootEvalLiveCurrentKeyAdmission,
	after: RootEvalLiveCurrentKeyAdmission,
): Readonly<{ readonly usageDeltaMicrousd: number; readonly remainingDeltaMicrousd: number }> {
	if (
		before.limitMicrousd !== ROOT_EVAL_LIVE_KEY_LIMIT_MICROUSD ||
		after.limitMicrousd !== ROOT_EVAL_LIVE_KEY_LIMIT_MICROUSD ||
		after.usageMicrousd < before.usageMicrousd ||
		after.remainingMicrousd > before.remainingMicrousd
	)
		throw new TypeError("root eval current-key spend reconciliation was non-monotonic");
	const usageDeltaMicrousd = after.usageMicrousd - before.usageMicrousd;
	const remainingDeltaMicrousd = before.remainingMicrousd - after.remainingMicrousd;
	return Object.freeze({ usageDeltaMicrousd, remainingDeltaMicrousd });
}

function validatesOwnDigest<T extends Record<string, unknown>, K extends keyof T>(
	value: T,
	digestKey: K,
): boolean {
	const { [digestKey]: digest, ...material } = value;
	return isDigest(digest) && digest === empiricalStrictJsonDigest(material);
}

function isDigest(value: unknown): value is string {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

const ROOT_EVAL_ARMS = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

const ROOT_EVAL_MEMORY_PROVENANCE = Object.freeze({
	cold: "none",
	"relevant-applied": "relevant-applied",
	"proposal-only": "proposal-only",
	"admission-rejected": "admission-rejected",
	"irrelevant-applied": "irrelevant-applied",
	"wrong-scope-applied": "wrong-scope-applied",
} as const);

const ROOT_EVAL_SOLUTION_IDENTITIES = Object.freeze([
	"work-item-execution",
	"agentic-work-item-memory-application",
	"agentic-memory-record-use",
	"agentic-memory-retrieval",
] as const);

const CLAIM_KEYS = Object.freeze([
	"schemaVersion",
	"executionMode",
	"claimRef",
	"decisionRef",
	"generationRef",
	"implementationCoordinate",
	"implementationManifestDigest",
	"qualificationArtifactDigest",
	"qualificationDigest",
	"taskBindingDigest",
	"pricingObservationDigest",
	"zeroByokObservationDigest",
	"credentialBindingDigest",
	"credentialFingerprintDigest",
	"currentKeyBeforeDigest",
	"recoveryEnvelope",
	"campaignHardCapMicrousd",
	"localEvalNoResetLimitMicrousd",
	"claimDigest",
]);
const CLAIM_RECOVERY_ENVELOPE_KEYS = Object.freeze(["pricing", "zeroByok", "currentKeyBefore"]);
const PRICING_KEYS = Object.freeze([
	"sourceUrl",
	"modelRef",
	"endpointModelRef",
	"providerName",
	"providerRef",
	"quantization",
	"inputMicrousdPerMillionTokens",
	"outputMicrousdPerMillionTokens",
	"cacheReadMicrousdPerMillionTokens",
	"zeroDataRetention",
	"promptTraining",
	"zdrSourceUrl",
	"zdrResponseDigest",
	"observedAtMs",
	"officialResponseDigest",
	"observationDigest",
]);
const ZERO_BYOK_KEYS = Object.freeze([
	"workspaceSlug",
	"keyName",
	"byokCredentialCount",
	"providerObservation",
	"observedAtMs",
	"sourceArtifactDigest",
	"observationDigest",
]);
const CURRENT_KEY_KEYS = Object.freeze([
	"limitMicrousd",
	"remainingMicrousd",
	"usageMicrousd",
	"limitReset",
	"isManagementKey",
	"admissionDigest",
]);

export function recoverRootEvalLiveClaimAuthority(
	claim: RootEvalLiveClaim,
): RootEvalLiveClaim["recoveryEnvelope"] {
	const root = claim as unknown as Record<string, unknown>;
	const envelope = root.recoveryEnvelope;
	if (!hasExactPlainShape(envelope, CLAIM_RECOVERY_ENVELOPE_KEYS))
		throw new TypeError("root eval claim recovery envelope shape invalid");
	const recovery = envelope as Record<string, unknown>;
	const pricing = recovery.pricing as RootEvalLivePricingObservation;
	const zeroByok = recovery.zeroByok as RootEvalLiveZeroByokObservation;
	const currentKeyBefore = recovery.currentKeyBefore as RootEvalLiveCurrentKeyAdmission;
	if (
		!hasExactPlainShape(pricing, PRICING_KEYS) ||
		!validPricingSemantics(pricing) ||
		!validatesOwnDigest(pricing as unknown as Record<string, unknown>, "observationDigest") ||
		pricing.observationDigest !== root.pricingObservationDigest ||
		!hasExactPlainShape(zeroByok, ZERO_BYOK_KEYS) ||
		!validZeroByokSemantics(zeroByok) ||
		!validatesOwnDigest(zeroByok as unknown as Record<string, unknown>, "observationDigest") ||
		zeroByok.observationDigest !== root.zeroByokObservationDigest ||
		!hasExactPlainShape(currentKeyBefore, CURRENT_KEY_KEYS) ||
		!validCurrentKeySemantics(currentKeyBefore) ||
		!validatesOwnDigest(
			currentKeyBefore as unknown as Record<string, unknown>,
			"admissionDigest",
		) ||
		currentKeyBefore.admissionDigest !== root.currentKeyBeforeDigest
	)
		throw new TypeError("root eval claim recovery envelope authority mismatch");
	return strictSnapshot({ pricing, zeroByok, currentKeyBefore });
}

function hasExactBrandedAdmission(
	value: unknown,
	keys: readonly string[],
	kind: RootEvalLiveAdmissionKind,
): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	if (Object.getOwnPropertySymbols(candidate).length !== 0) return false;
	if (RootEvalLiveAdmissionCapability.provenance(candidate)?.kind !== kind) return false;
	const actual = Object.keys(candidate).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasExactPlainShape(
	value: unknown,
	keys: readonly string[],
): value is Record<string, unknown> {
	try {
		const symbols =
			value !== null && typeof value === "object" ? Object.getOwnPropertySymbols(value) : [];
		if (symbols.length !== 0) return false;
		const actual = record(
			RootEvalLiveAdmissionCapability.provenance(value) === undefined
				? value
				: { ...(value as Record<string, unknown>) },
			"root eval live authority envelope",
		);
		exactKeys(actual, keys, "root eval live authority envelope");
		return true;
	} catch {
		return false;
	}
}

function isNonnegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validPricingSemantics(value: Record<string, unknown>): boolean {
	return (
		value.sourceUrl === ROOT_EVAL_LIVE_PRICING_SOURCE &&
		value.modelRef === "deepseek/deepseek-v4-flash-0731" &&
		value.endpointModelRef === "deepseek/deepseek-v4-flash-20260731" &&
		value.providerName === "Fireworks" &&
		value.providerRef === "fireworks" &&
		value.quantization === "unknown" &&
		value.inputMicrousdPerMillionTokens === 220_000 &&
		value.outputMicrousdPerMillionTokens === 660_000 &&
		value.cacheReadMicrousdPerMillionTokens === 7_000 &&
		value.zeroDataRetention === true &&
		value.promptTraining === false &&
		value.zdrSourceUrl === ROOT_EVAL_LIVE_ZDR_SOURCE &&
		isDigest(value.zdrResponseDigest) &&
		isNonnegativeSafeInteger(value.observedAtMs) &&
		isDigest(value.officialResponseDigest)
	);
}

function validZeroByokSemantics(value: Record<string, unknown>): boolean {
	return (
		value.workspaceSlug === "graph-re-fly" &&
		value.keyName === "Local Eval 2" &&
		value.byokCredentialCount === 0 &&
		value.providerObservation === "Fireworks Not configured" &&
		isNonnegativeSafeInteger(value.observedAtMs) &&
		isDigest(value.sourceArtifactDigest)
	);
}

function validCurrentKeySemantics(value: Record<string, unknown>): boolean {
	return (
		value.limitMicrousd === ROOT_EVAL_LIVE_KEY_LIMIT_MICROUSD &&
		isNonnegativeSafeInteger(value.remainingMicrousd) &&
		value.remainingMicrousd <= ROOT_EVAL_LIVE_KEY_LIMIT_MICROUSD &&
		isNonnegativeSafeInteger(value.usageMicrousd) &&
		value.usageMicrousd <= ROOT_EVAL_LIVE_KEY_LIMIT_MICROUSD &&
		value.limitReset === "none" &&
		value.isManagementKey === false
	);
}

interface ParsedEvalFinding {
	readonly kind: "eval-efficacy-finding";
	readonly campaignRef: string;
	readonly replicateCount: number;
	readonly armOrder: readonly string[];
	readonly passCounts: Readonly<Record<(typeof ROOT_EVAL_ARMS)[number], number>>;
	readonly verificationDiagnostics: EvalVerificationDiagnostics;
	readonly completedWorkItems: number;
	readonly admittedAttempts: number;
	readonly providerCallCount: number;
	readonly activeReservedMicrousd: number;
	readonly providerReportedMicrousd: number;
	readonly pricingRoundingAllowanceMicrousd: number;
	readonly providerReportedLowerBoundMicrousd: number;
	readonly unreportedSettledUpperBoundMicrousd: number;
	readonly accountedUpperBoundMicrousd: number;
	readonly observedBilledMicrousd: number | null;
	readonly billingObservationCount: number;
	readonly billingStableIntervals: number;
	readonly reconciledBilledMicrousd: number;
	readonly billingDisposition: "reconciled" | "rejected";
	readonly providerOutcomeReasonCounts: EvalProviderOutcomeReasonCounts;
	readonly finding: "positive-differential" | "no-positive-differential";
	readonly stoppingReason: "campaign-complete";
}

function projectProviderOutcomeReasonCounts(
	value: unknown,
	label: string,
): EvalProviderOutcomeReasonCounts {
	const counts = record(value, label);
	exactKeys(counts, EVAL_PROVIDER_OUTCOME_REASON_CODES, label);
	return strictSnapshot(
		Object.fromEntries(
			EVAL_PROVIDER_OUTCOME_REASON_CODES.map((code) => [
				code,
				safeInteger(counts[code], `${label}.${code}`, { max: 60 }),
			]),
		),
	) as EvalProviderOutcomeReasonCounts;
}

function projectVerificationDiagnostics(
	value: unknown,
	label: string,
): EvalVerificationDiagnostics {
	const root = record(value, label);
	exactKeys(
		root,
		["kind", "armOrder", "stageCounts", "terminalReasonCounts", "completedWorkItems"],
		label,
	);
	literal(root.kind, "eval-verification-diagnostics", `${label}.kind`);
	const armOrder = array(root.armOrder, `${label}.armOrder`);
	if (
		armOrder.length !== ROOT_EVAL_ARMS.length ||
		armOrder.some((arm, index) => arm !== ROOT_EVAL_ARMS[index])
	)
		throw new TypeError(`${label} arm order invalid`);
	const rawStages = record(root.stageCounts, `${label}.stageCounts`);
	const rawReasons = record(root.terminalReasonCounts, `${label}.terminalReasonCounts`);
	exactKeys(rawStages, ROOT_EVAL_ARMS, `${label}.stageCounts`);
	exactKeys(rawReasons, ROOT_EVAL_ARMS, `${label}.terminalReasonCounts`);
	const stageCounts = {} as Record<(typeof ROOT_EVAL_ARMS)[number], EvalVerificationStageCounts>;
	const terminalReasonCounts = {} as Record<
		(typeof ROOT_EVAL_ARMS)[number],
		EvalVerificationReasonCounts
	>;
	let completedWorkItems = 0;
	for (const arm of ROOT_EVAL_ARMS) {
		const stages = record(rawStages[arm], `${label}.stageCounts.${arm}`);
		exactKeys(stages, EVAL_VERIFICATION_STAGE_KEYS, `${label}.stageCounts.${arm}`);
		const projectedStages = Object.fromEntries(
			EVAL_VERIFICATION_STAGE_KEYS.map((stage) => [
				stage,
				safeInteger(stages[stage], `${label}.stageCounts.${arm}.${stage}`, { max: 5 }),
			]),
		) as Record<(typeof EVAL_VERIFICATION_STAGE_KEYS)[number], number>;
		if (
			projectedStages.exactToolAdmitted > projectedStages.completedWorkItems ||
			projectedStages.scopedChange > projectedStages.exactToolAdmitted ||
			projectedStages.publicSemanticPassed > projectedStages.scopedChange ||
			projectedStages.hiddenVerifierPassed > projectedStages.publicSemanticPassed ||
			projectedStages.cleanupCompleted > projectedStages.completedWorkItems ||
			projectedStages.passed > projectedStages.hiddenVerifierPassed ||
			projectedStages.passed > projectedStages.cleanupCompleted
		)
			throw new TypeError(`${label} stage count ordering invalid for ${arm}`);
		stageCounts[arm] = strictSnapshot(projectedStages);

		const reasons = record(rawReasons[arm], `${label}.terminalReasonCounts.${arm}`);
		exactKeys(reasons, EVAL_VERIFICATION_TERMINAL_REASONS, `${label}.terminalReasonCounts.${arm}`);
		const projectedReasons = Object.fromEntries(
			EVAL_VERIFICATION_TERMINAL_REASONS.map((reason) => [
				reason,
				safeInteger(reasons[reason], `${label}.terminalReasonCounts.${arm}.${reason}`, {
					max: 5,
				}),
			]),
		) as Record<(typeof EVAL_VERIFICATION_TERMINAL_REASONS)[number], number>;
		const reasonTotal = EVAL_VERIFICATION_TERMINAL_REASONS.reduce(
			(total, reason) => total + projectedReasons[reason],
			0,
		);
		const cleanupCompletedFromReasons =
			projectedStages.completedWorkItems - projectedReasons["cleanup-incomplete"];
		const exactToolAfterCleanup = cleanupCompletedFromReasons - projectedReasons["provider-failed"];
		const scopedAfterCleanup =
			exactToolAfterCleanup -
			projectedReasons["exact-tool-failed"] -
			projectedReasons["no-change"] -
			projectedReasons["wrong-scope"];
		const publicSemanticAfterCleanup =
			scopedAfterCleanup - projectedReasons["public-semantic-failed"];
		const hiddenVerifierAfterCleanup =
			publicSemanticAfterCleanup - projectedReasons["hidden-verifier-failed"];
		const obscuredByCleanup = projectedReasons["cleanup-incomplete"];
		const exactToolObscuredByCleanup = projectedStages.exactToolAdmitted - exactToolAfterCleanup;
		const scopedChangeObscuredByCleanup = projectedStages.scopedChange - scopedAfterCleanup;
		const publicSemanticObscuredByCleanup =
			projectedStages.publicSemanticPassed - publicSemanticAfterCleanup;
		const hiddenVerifierObscuredByCleanup =
			projectedStages.hiddenVerifierPassed - hiddenVerifierAfterCleanup;
		if (
			reasonTotal !== projectedStages.completedWorkItems ||
			projectedReasons.passed !== projectedStages.passed ||
			projectedStages.cleanupCompleted !== cleanupCompletedFromReasons ||
			exactToolAfterCleanup < 0 ||
			exactToolObscuredByCleanup !== obscuredByCleanup ||
			scopedAfterCleanup < 0 ||
			scopedChangeObscuredByCleanup < 0 ||
			scopedChangeObscuredByCleanup > exactToolObscuredByCleanup ||
			publicSemanticAfterCleanup < 0 ||
			publicSemanticObscuredByCleanup < 0 ||
			publicSemanticObscuredByCleanup > scopedChangeObscuredByCleanup ||
			hiddenVerifierAfterCleanup < 0 ||
			hiddenVerifierObscuredByCleanup < 0 ||
			hiddenVerifierObscuredByCleanup > publicSemanticObscuredByCleanup
		)
			throw new TypeError(`${label} terminal reason conservation invalid for ${arm}`);
		terminalReasonCounts[arm] = strictSnapshot(projectedReasons);
		completedWorkItems += projectedStages.completedWorkItems;
	}
	if (
		safeInteger(root.completedWorkItems, `${label}.completedWorkItems`, { max: 30 }) !==
		completedWorkItems
	)
		throw new TypeError(`${label} completed Work Item total invalid`);
	return strictSnapshot({
		kind: "eval-verification-diagnostics" as const,
		armOrder: ROOT_EVAL_ARMS,
		stageCounts,
		terminalReasonCounts,
		completedWorkItems,
	});
}

interface ParsedEvalObservation {
	readonly event: ObserveEvent;
	readonly value: EvalObservation;
}

interface ParsedRootEvalRunResult {
	readonly finding: ParsedEvalFinding;
	readonly observations: readonly ParsedEvalObservation[];
	readonly peakConcurrentEffects: number;
	readonly executedAdmissionIds: readonly string[];
}

function projectFinding(value: unknown): ParsedEvalFinding {
	const root = record(value, "root eval result.finding");
	exactKeys(
		root,
		[
			"kind",
			"campaignRef",
			"replicateCount",
			"armOrder",
			"passCounts",
			"verificationDiagnostics",
			"completedWorkItems",
			"admittedAttempts",
			"providerCallCount",
			"activeReservedMicrousd",
			"providerReportedMicrousd",
			"pricingRoundingAllowanceMicrousd",
			"providerReportedLowerBoundMicrousd",
			"unreportedSettledUpperBoundMicrousd",
			"accountedUpperBoundMicrousd",
			"observedBilledMicrousd",
			"billingObservationCount",
			"billingStableIntervals",
			"reconciledBilledMicrousd",
			"billingDisposition",
			"providerOutcomeReasonCounts",
			"finding",
			"stoppingReason",
		],
		"root eval result.finding",
	);
	const armOrder = array(root.armOrder, "root eval result.finding.armOrder");
	if (armOrder.length !== ROOT_EVAL_ARMS.length)
		throw new TypeError("root eval result finding arm order length invalid");
	const projectedArms = armOrder.map((arm, index) =>
		oneOf(arm, ROOT_EVAL_ARMS, `root eval result.finding.armOrder[${index}]`),
	);
	const rawPassCounts = record(root.passCounts, "root eval result.finding.passCounts");
	exactKeys(rawPassCounts, ROOT_EVAL_ARMS, "root eval result.finding.passCounts");
	const passCounts = Object.fromEntries(
		ROOT_EVAL_ARMS.map((arm) => [
			arm,
			safeInteger(rawPassCounts[arm], `root eval result.finding.passCounts.${arm}`),
		]),
	) as Record<(typeof ROOT_EVAL_ARMS)[number], number>;
	const replicateCount = safeInteger(
		root.replicateCount,
		"root eval result.finding.replicateCount",
		{ max: 5 },
	);
	const completedWorkItems = safeInteger(
		root.completedWorkItems,
		"root eval result.finding.completedWorkItems",
		{ max: 30 },
	);
	const verificationDiagnostics = projectVerificationDiagnostics(
		root.verificationDiagnostics,
		"root eval result.finding.verificationDiagnostics",
	);
	return strictSnapshot({
		kind: literal(root.kind, "eval-efficacy-finding", "root eval result.finding.kind"),
		campaignRef: coordinate(root.campaignRef, "root eval result.finding.campaignRef"),
		replicateCount,
		armOrder: projectedArms,
		passCounts,
		verificationDiagnostics,
		completedWorkItems,
		admittedAttempts: safeInteger(
			root.admittedAttempts,
			"root eval result.finding.admittedAttempts",
		),
		providerCallCount: safeInteger(
			root.providerCallCount,
			"root eval result.finding.providerCallCount",
		),
		activeReservedMicrousd: safeInteger(
			root.activeReservedMicrousd,
			"root eval result.finding.activeReservedMicrousd",
		),
		providerReportedMicrousd: safeInteger(
			root.providerReportedMicrousd,
			"root eval result.finding.providerReportedMicrousd",
		),
		pricingRoundingAllowanceMicrousd: safeInteger(
			root.pricingRoundingAllowanceMicrousd,
			"root eval result.finding.pricingRoundingAllowanceMicrousd",
		),
		providerReportedLowerBoundMicrousd: safeInteger(
			root.providerReportedLowerBoundMicrousd,
			"root eval result.finding.providerReportedLowerBoundMicrousd",
		),
		unreportedSettledUpperBoundMicrousd: safeInteger(
			root.unreportedSettledUpperBoundMicrousd,
			"root eval result.finding.unreportedSettledUpperBoundMicrousd",
		),
		accountedUpperBoundMicrousd: safeInteger(
			root.accountedUpperBoundMicrousd,
			"root eval result.finding.accountedUpperBoundMicrousd",
		),
		observedBilledMicrousd:
			root.observedBilledMicrousd === null
				? null
				: safeInteger(
						root.observedBilledMicrousd,
						"root eval result.finding.observedBilledMicrousd",
					),
		billingObservationCount: safeInteger(
			root.billingObservationCount,
			"root eval result.finding.billingObservationCount",
			{ max: 8 },
		),
		billingStableIntervals: safeInteger(
			root.billingStableIntervals,
			"root eval result.finding.billingStableIntervals",
			{ max: 8 },
		),
		reconciledBilledMicrousd: safeInteger(
			root.reconciledBilledMicrousd,
			"root eval result.finding.reconciledBilledMicrousd",
		),
		billingDisposition: oneOf(
			root.billingDisposition,
			["reconciled", "rejected"] as const,
			"root eval result.finding.billingDisposition",
		),
		providerOutcomeReasonCounts: projectProviderOutcomeReasonCounts(
			root.providerOutcomeReasonCounts,
			"root eval result.finding.providerOutcomeReasonCounts",
		),
		finding: oneOf(
			root.finding,
			["positive-differential", "no-positive-differential"] as const,
			"root eval result.finding.finding",
		),
		stoppingReason: oneOf(
			root.stoppingReason,
			["campaign-complete"] as const,
			"root eval result.finding.stoppingReason",
		),
	});
}

function projectObservation(value: unknown, index: number): ParsedEvalObservation {
	const event = record(value, `root eval result.observations[${index}]`);
	exactKeys(event, ["path", "msg", "tier", "seq"], `root eval result.observations[${index}]`);
	literal(event.path, "eval/observation", `root eval result.observations[${index}].path`);
	literal(event.tier, 3, `root eval result.observations[${index}].tier`);
	const seq = safeInteger(event.seq, `root eval result.observations[${index}].seq`);
	const message = array(event.msg, `root eval result.observations[${index}].msg`);
	if (message.length !== 2) throw new TypeError("root eval observation message shape invalid");
	literal(message[0], "DATA", `root eval result.observations[${index}].msg[0]`);
	const raw = record(message[1], `root eval result.observations[${index}].msg[1]`);
	exactKeys(
		raw,
		[
			"kind",
			"topologyRevision",
			"solutionIdentities",
			"campaignRef",
			"replicate",
			"armOrder",
			"memoryProvenance",
			"verificationDiagnostics",
			"completedArms",
			"activeProviderEffects",
			"activeToolEffects",
			"activeRetryEffects",
			"activeBillingEffects",
			"activeAdmittedEffects",
			"admittedAttempts",
			"admittedRetryAttempts",
			"retryProposalCount",
			"pendingRetryProposalCount",
			"rejectedRetryProposalCount",
			"settledRetryAttemptCount",
			"providerCallCount",
			"activeReservedMicrousd",
			"providerReportedMicrousd",
			"pricingRoundingAllowanceMicrousd",
			"providerReportedLowerBoundMicrousd",
			"unreportedSettledUpperBoundMicrousd",
			"accountedUpperBoundMicrousd",
			"observedBilledMicrousd",
			"billingObservationCount",
			"billingStableIntervals",
			"reconciledBilledMicrousd",
			"billingDisposition",
			"providerOutcomeReasonCounts",
			"stoppingReason",
			"finding",
		],
		`root eval result.observations[${index}].msg[1]`,
	);
	const identities = array(
		raw.solutionIdentities,
		`root eval result.observations[${index}].solutionIdentities`,
	);
	if (
		identities.length !== ROOT_EVAL_SOLUTION_IDENTITIES.length ||
		identities.some(
			(identity, identityIndex) => identity !== ROOT_EVAL_SOLUTION_IDENTITIES[identityIndex],
		)
	)
		throw new TypeError("root eval observation solution identities invalid");
	const armOrder = array(raw.armOrder, `root eval result.observations[${index}].armOrder`);
	if (
		armOrder.length !== ROOT_EVAL_ARMS.length ||
		armOrder.some((arm, armIndex) => arm !== ROOT_EVAL_ARMS[armIndex])
	)
		throw new TypeError("root eval observation arm order invalid");
	const provenance = record(
		raw.memoryProvenance,
		`root eval result.observations[${index}].memoryProvenance`,
	);
	exactKeys(provenance, ROOT_EVAL_ARMS, `root eval result.observations[${index}].memoryProvenance`);
	for (const arm of ROOT_EVAL_ARMS)
		literal(
			provenance[arm],
			ROOT_EVAL_MEMORY_PROVENANCE[arm],
			`root eval result.observations[${index}].memoryProvenance.${arm}`,
		);
	const projected = strictSnapshot({
		kind: literal(raw.kind, "eval-observation", "root eval observation.kind"),
		topologyRevision: literal(
			raw.topologyRevision,
			ROOT_EVAL_TOPOLOGY_REVISION,
			"root eval observation.topologyRevision",
		),
		solutionIdentities: ROOT_EVAL_SOLUTION_IDENTITIES,
		campaignRef: literal(
			raw.campaignRef,
			ROOT_EVAL_LIVE_GENERATION_REF,
			"root eval observation.campaignRef",
		),
		replicate: safeInteger(raw.replicate, "root eval observation.replicate", { max: 5 }),
		armOrder: ROOT_EVAL_ARMS,
		memoryProvenance: ROOT_EVAL_MEMORY_PROVENANCE,
		verificationDiagnostics: projectVerificationDiagnostics(
			raw.verificationDiagnostics,
			`root eval result.observations[${index}].verificationDiagnostics`,
		),
		completedArms: safeInteger(raw.completedArms, "root eval observation.completedArms", {
			max: 6,
		}),
		activeProviderEffects: safeInteger(
			raw.activeProviderEffects,
			"root eval observation.activeProviderEffects",
			{
				max: 6,
			},
		),
		activeToolEffects: safeInteger(
			raw.activeToolEffects,
			"root eval observation.activeToolEffects",
			{ max: 6 },
		),
		activeRetryEffects: safeInteger(
			raw.activeRetryEffects,
			"root eval observation.activeRetryEffects",
			{ max: 6 },
		),
		activeBillingEffects: safeInteger(
			raw.activeBillingEffects,
			"root eval observation.activeBillingEffects",
			{ max: 1 },
		),
		activeAdmittedEffects: safeInteger(
			raw.activeAdmittedEffects,
			"root eval observation.activeAdmittedEffects",
			{ max: 6 },
		),
		admittedAttempts: safeInteger(raw.admittedAttempts, "root eval observation.admittedAttempts", {
			max: 60,
		}),
		admittedRetryAttempts: safeInteger(
			raw.admittedRetryAttempts,
			"root eval observation.admittedRetryAttempts",
			{ max: 30 },
		),
		retryProposalCount: safeInteger(
			raw.retryProposalCount,
			"root eval observation.retryProposalCount",
			{ max: 30 },
		),
		pendingRetryProposalCount: safeInteger(
			raw.pendingRetryProposalCount,
			"root eval observation.pendingRetryProposalCount",
			{ max: 30 },
		),
		rejectedRetryProposalCount: safeInteger(
			raw.rejectedRetryProposalCount,
			"root eval observation.rejectedRetryProposalCount",
			{ max: 30 },
		),
		settledRetryAttemptCount: safeInteger(
			raw.settledRetryAttemptCount,
			"root eval observation.settledRetryAttemptCount",
			{ max: 30 },
		),
		providerCallCount: safeInteger(
			raw.providerCallCount,
			"root eval observation.providerCallCount",
			{
				max: 60,
			},
		),
		activeReservedMicrousd: safeInteger(
			raw.activeReservedMicrousd,
			"root eval observation.activeReservedMicrousd",
		),
		providerReportedMicrousd: safeInteger(
			raw.providerReportedMicrousd,
			"root eval observation.providerReportedMicrousd",
		),
		pricingRoundingAllowanceMicrousd: safeInteger(
			raw.pricingRoundingAllowanceMicrousd,
			"root eval observation.pricingRoundingAllowanceMicrousd",
		),
		providerReportedLowerBoundMicrousd: safeInteger(
			raw.providerReportedLowerBoundMicrousd,
			"root eval observation.providerReportedLowerBoundMicrousd",
		),
		unreportedSettledUpperBoundMicrousd: safeInteger(
			raw.unreportedSettledUpperBoundMicrousd,
			"root eval observation.unreportedSettledUpperBoundMicrousd",
		),
		accountedUpperBoundMicrousd: safeInteger(
			raw.accountedUpperBoundMicrousd,
			"root eval observation.accountedUpperBoundMicrousd",
		),
		observedBilledMicrousd:
			raw.observedBilledMicrousd === null
				? null
				: safeInteger(raw.observedBilledMicrousd, "root eval observation.observedBilledMicrousd"),
		billingObservationCount: safeInteger(
			raw.billingObservationCount,
			"root eval observation.billingObservationCount",
			{ max: 8 },
		),
		billingStableIntervals: safeInteger(
			raw.billingStableIntervals,
			"root eval observation.billingStableIntervals",
			{ max: 8 },
		),
		reconciledBilledMicrousd:
			raw.reconciledBilledMicrousd === null
				? null
				: safeInteger(
						raw.reconciledBilledMicrousd,
						"root eval observation.reconciledBilledMicrousd",
					),
		billingDisposition: oneOf(
			raw.billingDisposition,
			["pending", "reconciled", "rejected"] as const,
			"root eval observation.billingDisposition",
		),
		providerOutcomeReasonCounts: projectProviderOutcomeReasonCounts(
			raw.providerOutcomeReasonCounts,
			"root eval observation.providerOutcomeReasonCounts",
		),
		stoppingReason: oneOf(
			raw.stoppingReason,
			["none", "campaign-complete", "budget-exhausted", "effect-failed"] as const,
			"root eval observation.stoppingReason",
		),
		finding: oneOf(
			raw.finding,
			["pending", "positive-differential", "no-positive-differential"] as const,
			"root eval observation.finding",
		),
	}) as EvalObservation;
	assertRootEvalObservationRuntimeShape(
		projected,
		`root eval result.observations[${index}].msg[1]`,
	);
	return Object.freeze({
		value: projected,
		event: strictSnapshot({
			path: "eval/observation",
			msg: ["DATA", projected],
			tier: 3,
			seq,
		}) as ObserveEvent,
	});
}

function expectedAdmissionIds(): ReadonlySet<string> {
	const ids = new Set<string>();
	for (let replicate = 1; replicate <= 5; replicate += 1)
		for (const arm of ROOT_EVAL_ARMS) {
			const workItemId = `${ROOT_EVAL_LIVE_GENERATION_REF}/replicate-${replicate}/${arm}`;
			const effectRunId = `effect-run:work-item:${workItemId}:effect-plan:1:${workItemId}/plan:provider-and-exact-tool`;
			for (const attempt of [1, 2] as const) ids.add(`${effectRunId}/attempt-${attempt}/admission`);
		}
	return ids;
}

const EXPECTED_ADMISSION_IDS = expectedAdmissionIds();

function projectRootEvalRunResult(value: unknown): ParsedRootEvalRunResult {
	const root = record(value, "root eval result");
	exactKeys(
		root,
		["finding", "observations", "peakConcurrentEffects", "executedAdmissionIds"],
		"root eval result",
	);
	const rawObservations = array(root.observations, "root eval result.observations");
	if (rawObservations.length > 512)
		throw new TypeError("root eval observations exceeded evidence bound");
	const rawIds = array(root.executedAdmissionIds, "root eval result.executedAdmissionIds");
	if (rawIds.length > 60)
		throw new TypeError("root eval admission identities exceeded evidence bound");
	const ids = rawIds.map((id, index) => {
		if (typeof id !== "string" || !EXPECTED_ADMISSION_IDS.has(id))
			throw new TypeError(`root eval admission identity ${index} invalid`);
		return id;
	});
	const finding = projectFinding(root.finding);
	const observations = rawObservations.map(projectObservation);
	const terminal = observations.at(-1)?.value;
	if (
		terminal !== undefined &&
		terminal.finding !== "pending" &&
		empiricalStrictJsonDigest(terminal.verificationDiagnostics) !==
			empiricalStrictJsonDigest(finding.verificationDiagnostics)
	)
		throw new TypeError("root eval terminal diagnostics drifted from finding");
	return Object.freeze({
		finding,
		observations: Object.freeze(observations),
		peakConcurrentEffects: safeInteger(
			root.peakConcurrentEffects,
			"root eval result.peakConcurrentEffects",
		),
		executedAdmissionIds: Object.freeze(ids),
	});
}

function projectPartialObservations(values: readonly ObserveEvent[]): readonly ObserveEvent[] {
	let source: readonly unknown[];
	try {
		source = array(values, "root eval partial observations").slice(-512);
	} catch {
		return Object.freeze([]);
	}
	const projected: ObserveEvent[] = [];
	for (const [index, value] of source.entries())
		try {
			projected.push(projectObservation(value, index).event);
		} catch {
			// Partial observations are diagnostic-only. Invalid runtime material is omitted,
			// never copied into durable evidence and never promoted to domain authority.
		}
	return Object.freeze(projected);
}

function projectLatestObservation(values: readonly ObserveEvent[]): ObserveEvent | null {
	let source: readonly unknown[];
	try {
		source = array(values, "root eval latest observation");
	} catch {
		return null;
	}
	for (let index = source.length - 1; index >= 0; index -= 1)
		try {
			return projectObservation(source[index], index).event;
		} catch {
			// Continue backwards to the latest valid Graph-native DATA observation.
		}
	return null;
}

function graphEvidence(graph: ParsedRootEvalRunResult): RootEvalLiveGraphEvidence {
	return strictSnapshot({
		finding: graph.finding,
		observations: graph.observations.map((observation) => observation.event),
		peakConcurrentEffects: graph.peakConcurrentEffects,
		executedAdmissionDigests: graph.executedAdmissionIds.map((id) => empiricalStrictJsonDigest(id)),
	}) as unknown as RootEvalLiveGraphEvidence;
}

export function evaluateRootEvalLiveAdmission(input: RootEvalLiveEvidenceInput): Readonly<{
	readonly admissionReport: RootEvalLiveAdmissionReport;
	readonly reconciliation: Readonly<{
		readonly usageDeltaMicrousd: number;
		readonly remainingDeltaMicrousd: number;
	}> | null;
	readonly projectedGraph: RootEvalLiveGraphEvidence | null;
}> {
	const claimShape = hasExactPlainShape(input.claim, CLAIM_KEYS);
	const pricingShape = hasExactPlainShape(input.pricing, PRICING_KEYS);
	const zeroByokShape = hasExactPlainShape(input.zeroByok, ZERO_BYOK_KEYS);
	const currentBeforeShape =
		input.currentKeyBefore === null || hasExactPlainShape(input.currentKeyBefore, CURRENT_KEY_KEYS);
	const currentAfterShape =
		input.currentKeyAfter === null || hasExactPlainShape(input.currentKeyAfter, CURRENT_KEY_KEYS);
	const claim = input.claim as unknown as Record<string, unknown>;
	const pricing = input.pricing as unknown as Record<string, unknown>;
	const zeroByok = input.zeroByok as unknown as Record<string, unknown>;
	const currentBefore = input.currentKeyBefore as unknown as Record<string, unknown> | null;
	const currentAfter = input.currentKeyAfter as unknown as Record<string, unknown> | null;
	let claimRecoveryValid = false;
	if (claimShape)
		try {
			recoverRootEvalLiveClaimAuthority(input.claim);
			claimRecoveryValid = true;
		} catch {
			claimRecoveryValid = false;
		}
	let reconciliation: Readonly<{
		readonly usageDeltaMicrousd: number;
		readonly remainingDeltaMicrousd: number;
	}> | null = null;
	let reconciliationValid = true;
	if (
		input.currentKeyBefore !== null &&
		input.currentKeyAfter !== null &&
		currentBeforeShape &&
		currentAfterShape &&
		validCurrentKeySemantics(currentBefore!) &&
		validCurrentKeySemantics(currentAfter!)
	)
		try {
			reconciliation = reconcileRootEvalLiveSpend(input.currentKeyBefore, input.currentKeyAfter);
		} catch {
			reconciliationValid = false;
		}

	const authorityChecks: ReadonlyArray<readonly [RootEvalLiveAuthorityViolationCode, boolean]> = [
		["authority.claim-shape-invalid", claimShape],
		["authority.claim-digest-invalid", claimShape && validatesOwnDigest(claim, "claimDigest")],
		["authority.pricing-shape-invalid", pricingShape],
		[
			"authority.pricing-digest-invalid",
			pricingShape && validatesOwnDigest(pricing, "observationDigest"),
		],
		["authority.pricing-semantics-mismatch", pricingShape && validPricingSemantics(pricing)],
		["authority.zero-byok-shape-invalid", zeroByokShape],
		[
			"authority.zero-byok-digest-invalid",
			zeroByokShape && validatesOwnDigest(zeroByok, "observationDigest"),
		],
		["authority.zero-byok-semantics-mismatch", zeroByokShape && validZeroByokSemantics(zeroByok)],
		["authority.current-key-before-shape-invalid", currentBeforeShape],
		[
			"authority.current-key-before-digest-invalid",
			input.currentKeyBefore === null ||
				(currentBeforeShape && validatesOwnDigest(currentBefore!, "admissionDigest")),
		],
		[
			"authority.current-key-before-semantics-mismatch",
			input.currentKeyBefore === null ||
				(currentBeforeShape && validCurrentKeySemantics(currentBefore!)),
		],
		["authority.current-key-after-shape-invalid", currentAfterShape],
		[
			"authority.current-key-after-digest-invalid",
			input.currentKeyAfter === null ||
				(currentAfterShape && validatesOwnDigest(currentAfter!, "admissionDigest")),
		],
		[
			"authority.current-key-after-semantics-mismatch",
			input.currentKeyAfter === null ||
				(currentAfterShape && validCurrentKeySemantics(currentAfter!)),
		],
		[
			"authority.claim-pricing-binding-mismatch",
			claimShape && pricingShape && claim.pricingObservationDigest === pricing.observationDigest,
		],
		[
			"authority.claim-zero-byok-binding-mismatch",
			claimShape && zeroByokShape && claim.zeroByokObservationDigest === zeroByok.observationDigest,
		],
		[
			"authority.claim-schema-mismatch",
			claimShape && claim.schemaVersion === ROOT_EVAL_LIVE_CLAIM_SCHEMA,
		],
		[
			"authority.claim-execution-mode-invalid",
			claimShape && ["live", "no-network-qualification"].includes(String(claim.executionMode)),
		],
		["authority.claim-ref-mismatch", claimShape && claim.claimRef === ROOT_EVAL_LIVE_CLAIM_REF],
		[
			"authority.claim-decision-mismatch",
			claimShape && claim.decisionRef === ROOT_EVAL_LIVE_DECISION_REF,
		],
		[
			"authority.claim-generation-mismatch",
			claimShape && claim.generationRef === ROOT_EVAL_LIVE_GENERATION_REF,
		],
		[
			"authority.claim-task-binding-mismatch",
			claimShape && claim.taskBindingDigest === ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
		],
		[
			"authority.claim-campaign-cap-mismatch",
			claimShape && claim.campaignHardCapMicrousd === ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD,
		],
		[
			"authority.claim-key-limit-mismatch",
			claimShape && claim.localEvalNoResetLimitMicrousd === ROOT_EVAL_LIVE_KEY_LIMIT_MICROUSD,
		],
		[
			"authority.claim-implementation-coordinate-invalid",
			claimShape &&
				typeof claim.implementationCoordinate === "string" &&
				/^worktree:[0-9a-f]{40}:sha256:[0-9a-f]{64}$/u.test(claim.implementationCoordinate),
		],
		[
			"authority.claim-implementation-coordinate-binding-mismatch",
			claimShape &&
				typeof claim.implementationCoordinate === "string" &&
				claim.implementationCoordinate.endsWith(
					`:${ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST}`,
				),
		],
		[
			"authority.claim-implementation-manifest-mismatch",
			claimShape &&
				claim.implementationManifestDigest === ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		],
		[
			"authority.claim-qualification-artifact-mismatch",
			claimShape &&
				claim.qualificationArtifactDigest === ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		],
		[
			"authority.claim-qualification-mismatch",
			claimShape && claim.qualificationDigest === ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
		],
		[
			"authority.claim-credential-binding-mismatch",
			claimShape &&
				claim.credentialBindingDigest ===
					empiricalStrictJsonDigest({
						bindingRef: "openrouter.local-eval-2",
						bindingRevision: "2026-08-26.d125.v1",
					}),
		],
		[
			"authority.claim-current-key-before-binding-mismatch",
			claimShape &&
				(input.currentKeyBefore === null ||
					claim.currentKeyBeforeDigest === input.currentKeyBefore.admissionDigest),
		],
		["authority.claim-recovery-envelope-mismatch", claimShape && claimRecoveryValid],
		[
			"authority.current-key-limit-mismatch",
			input.currentKeyBefore === null ||
				(currentBeforeShape &&
					validCurrentKeySemantics(currentBefore!) &&
					currentBefore!.limitMicrousd === claim.localEvalNoResetLimitMicrousd),
		],
		[
			"authority.current-key-remaining-below-cap",
			input.currentKeyBefore === null ||
				(currentBeforeShape &&
					validCurrentKeySemantics(currentBefore!) &&
					(currentBefore!.remainingMicrousd as number) >=
						(claim.campaignHardCapMicrousd as number)),
		],
		["authority.current-key-reconciliation-nonmonotonic", reconciliationValid],
		[
			"authority.provider-call-count-invalid",
			Number.isSafeInteger(input.providerCalls) && input.providerCalls >= 0,
		],
		["authority.result-and-failure-missing", input.graphResult !== null || input.failure !== null],
	];
	const authorityViolations = authorityChecks.filter(([, passed]) => !passed).map(([code]) => code);
	if (authorityViolations.length > 0)
		throw new RootEvalLiveAuthorityAdmissionError(authorityViolations);

	const graph = input.graphResult;
	if (graph === null)
		return Object.freeze({
			admissionReport: Object.freeze({
				status: "not-candidate" as const,
				violationCodes: Object.freeze([]),
				rejectedGraphSummary: null,
			}),
			reconciliation,
			projectedGraph: null,
		});

	let projected: ParsedRootEvalRunResult | null = null;
	try {
		projected = projectRootEvalRunResult(graph);
	} catch {
		return Object.freeze({
			admissionReport: Object.freeze({
				status: "rejected" as const,
				violationCodes: Object.freeze(["success.graph-shape-invalid"] as const),
				rejectedGraphSummary: null,
			}),
			reconciliation,
			projectedGraph: null,
		});
	}
	const finding = projected.finding;
	const passCountsValid =
		finding.armOrder.length === ROOT_EVAL_ARMS.length &&
		ROOT_EVAL_ARMS.every(
			(arm, index) =>
				finding.armOrder[index] === arm &&
				Number.isSafeInteger(finding.passCounts[arm]) &&
				finding.passCounts[arm] >= 0 &&
				finding.passCounts[arm] <= 5 &&
				finding.verificationDiagnostics.stageCounts[arm].passed === finding.passCounts[arm],
		);
	const computedFinding =
		finding.passCounts["relevant-applied"] >
		Math.max(
			finding.passCounts.cold,
			finding.passCounts["proposal-only"],
			finding.passCounts["admission-rejected"],
			finding.passCounts["irrelevant-applied"],
			finding.passCounts["wrong-scope-applied"],
		)
			? "positive-differential"
			: "no-positive-differential";
	const observationValues = projected.observations.map((observation) => observation.value);
	const terminalObservations = observationValues.filter((value) => value.finding !== "pending");
	const terminalObservation = terminalObservations.at(-1);
	const observationProgressValid = projected.observations.every((current, index) => {
		if (index === 0) return true;
		const previous = projected.observations[index - 1]!;
		if (
			current.event.seq <= previous.event.seq ||
			empiricalStrictJsonDigest(current.value) === empiricalStrictJsonDigest(previous.value)
		)
			return false;
		try {
			assertRootEvalObservationTransition(
				previous.value,
				current.value,
				"root eval live observation",
			);
			return true;
		} catch {
			return false;
		}
	});
	let observationSequenceValid = false;
	try {
		assertRootEvalObservationSequence(observationValues, "root eval live observation");
		observationSequenceValid = true;
	} catch {
		observationSequenceValid = false;
	}
	const terminalObservationOrderValid =
		terminalObservations.length === 1 &&
		terminalObservation !== undefined &&
		observationValues.at(-1) === terminalObservation &&
		observationProgressValid &&
		observationSequenceValid;
	const terminalObservationStateValid =
		terminalObservation !== undefined &&
		terminalObservation.replicate === 5 &&
		terminalObservation.completedArms === 6 &&
		terminalObservation.activeAdmittedEffects === 0 &&
		terminalObservation.admittedAttempts === finding.admittedAttempts &&
		terminalObservation.providerCallCount === finding.providerCallCount &&
		terminalObservation.activeReservedMicrousd === finding.activeReservedMicrousd &&
		terminalObservation.providerReportedMicrousd === finding.providerReportedMicrousd &&
		terminalObservation.pricingRoundingAllowanceMicrousd ===
			finding.pricingRoundingAllowanceMicrousd &&
		terminalObservation.providerReportedLowerBoundMicrousd ===
			finding.providerReportedLowerBoundMicrousd &&
		terminalObservation.unreportedSettledUpperBoundMicrousd ===
			finding.unreportedSettledUpperBoundMicrousd &&
		terminalObservation.accountedUpperBoundMicrousd === finding.accountedUpperBoundMicrousd &&
		terminalObservation.observedBilledMicrousd === finding.observedBilledMicrousd &&
		terminalObservation.billingObservationCount === finding.billingObservationCount &&
		terminalObservation.billingStableIntervals === finding.billingStableIntervals &&
		terminalObservation.reconciledBilledMicrousd === finding.reconciledBilledMicrousd &&
		terminalObservation.billingDisposition === finding.billingDisposition &&
		empiricalStrictJsonDigest(terminalObservation.verificationDiagnostics) ===
			empiricalStrictJsonDigest(finding.verificationDiagnostics);
	const providerOutcomeReasonCountTotal = EVAL_PROVIDER_OUTCOME_REASON_CODES.reduce(
		(total, code) => total + finding.providerOutcomeReasonCounts[code],
		0,
	);
	const providerOutcomeReasonCountsValid =
		providerOutcomeReasonCountTotal === finding.admittedAttempts &&
		terminalObservation !== undefined &&
		EVAL_PROVIDER_OUTCOME_REASON_CODES.every(
			(code) =>
				terminalObservation.providerOutcomeReasonCounts[code] ===
				finding.providerOutcomeReasonCounts[code],
		);
	const successChecks: Record<RootEvalLiveSuccessViolationCode, boolean> = {
		"success.graph-shape-invalid": true,
		"success.current-key-before-missing": input.currentKeyBefore !== null,
		"success.failure-present": input.failure === null,
		"success.cleanup-incomplete": input.cleanupDisposition === "complete",
		"success.campaign-ref-mismatch": finding.campaignRef === ROOT_EVAL_LIVE_GENERATION_REF,
		"success.replicate-count-mismatch": finding.replicateCount === 5,
		"success.completed-work-items-mismatch":
			finding.completedWorkItems === 30 &&
			finding.verificationDiagnostics.completedWorkItems === 30 &&
			ROOT_EVAL_ARMS.every(
				(arm) => finding.verificationDiagnostics.stageCounts[arm].completedWorkItems === 5,
			),
		"success.finding-mismatch": finding.finding === computedFinding,
		"success.pass-counts-invalid": passCountsValid,
		"success.observations-empty": projected.observations.length >= 1,
		"success.terminal-observation-missing": terminalObservations.length >= 1,
		"success.terminal-finding-mismatch": terminalObservation?.finding === finding.finding,
		"success.terminal-stopping-reason-mismatch":
			terminalObservation?.stoppingReason === finding.stoppingReason,
		"success.terminal-observation-order-invalid": terminalObservationOrderValid,
		"success.terminal-observation-state-mismatch": terminalObservationStateValid,
		"success.peak-concurrency-below-one": projected.peakConcurrentEffects >= 1,
		"success.peak-concurrency-above-six": projected.peakConcurrentEffects <= 6,
		"success.admission-count-below-thirty": projected.executedAdmissionIds.length >= 30,
		"success.admission-identities-duplicate":
			new Set(projected.executedAdmissionIds).size === projected.executedAdmissionIds.length,
		"success.finding-admitted-attempts-mismatch":
			finding.admittedAttempts === projected.executedAdmissionIds.length,
		"success.provider-outcome-reason-count-mismatch": providerOutcomeReasonCountsValid,
		"success.accounted-budget-above-cap":
			finding.accountedUpperBoundMicrousd <= input.claim.campaignHardCapMicrousd,
		"success.provider-call-count-mismatch": input.providerCalls === finding.providerCallCount,
	};
	const violationCodes = ROOT_EVAL_LIVE_SUCCESS_VIOLATION_CODES.filter(
		(code) => !successChecks[code],
	);
	const graphAdmitted = violationCodes.every((code) =>
		ROOT_EVAL_CALLER_DISPOSITION_VIOLATION_CODES.some((externalCode) => externalCode === code),
	);
	if (violationCodes.length === 0)
		return Object.freeze({
			admissionReport: Object.freeze({
				status: "admitted" as const,
				violationCodes: Object.freeze([]),
				rejectedGraphSummary: null,
			}),
			reconciliation,
			projectedGraph: graphEvidence(projected),
		});

	const rejectedGraphSummary = strictSnapshot({
		campaignRef:
			finding.campaignRef === ROOT_EVAL_LIVE_GENERATION_REF ? finding.campaignRef : "invalid",
		replicateCount: finding.replicateCount,
		completedWorkItems: finding.completedWorkItems,
		admittedAttempts: finding.admittedAttempts,
		stoppingReason: finding.stoppingReason,
		finding: finding.finding,
		accountedUpperBoundMicrousd: finding.accountedUpperBoundMicrousd,
		providerReportedMicrousd: finding.providerReportedMicrousd,
		pricingRoundingAllowanceMicrousd: finding.pricingRoundingAllowanceMicrousd,
		providerReportedLowerBoundMicrousd: finding.providerReportedLowerBoundMicrousd,
		observedBilledMicrousd: finding.observedBilledMicrousd,
		billingObservationCount: finding.billingObservationCount,
		billingStableIntervals: finding.billingStableIntervals,
		reconciledBilledMicrousd: finding.reconciledBilledMicrousd,
		billingDisposition: finding.billingDisposition,
		passCounts: strictSnapshot(
			Object.fromEntries(ROOT_EVAL_ARMS.map((arm) => [arm, finding.passCounts[arm]])),
		),
		providerOutcomeReasonCounts: finding.providerOutcomeReasonCounts,
		observationCount: projected.observations.length,
		terminalObservation:
			terminalObservation === undefined
				? null
				: strictSnapshot({
						campaignRef:
							terminalObservation.campaignRef === ROOT_EVAL_LIVE_GENERATION_REF
								? terminalObservation.campaignRef
								: "invalid",
						stoppingReason: terminalObservation.stoppingReason,
						finding: terminalObservation.finding,
					}),
		peakConcurrentEffects: projected.peakConcurrentEffects,
		executedAdmissionCount: projected.executedAdmissionIds.length,
		executedAdmissionSetDigest: empiricalStrictJsonDigest(
			projected.executedAdmissionIds.map((id) => empiricalStrictJsonDigest(id)).sort(),
		),
		providerCalls: input.providerCalls,
		billedUsageDeltaMicrousd: reconciliation?.usageDeltaMicrousd ?? null,
		billedRemainingDeltaMicrousd: reconciliation?.remainingDeltaMicrousd ?? null,
	}) as RootEvalLiveRejectedGraphSummary;
	return Object.freeze({
		admissionReport: Object.freeze({
			status: "rejected" as const,
			violationCodes: Object.freeze([...violationCodes]),
			rejectedGraphSummary,
		}),
		reconciliation,
		projectedGraph: graphAdmitted ? graphEvidence(projected) : null,
	});
}

export function constructRootEvalLiveEvidence(
	input: RootEvalLiveEvidenceInput,
): RootEvalLiveEvidence {
	const { admissionReport, reconciliation, projectedGraph } = evaluateRootEvalLiveAdmission(input);
	const admitted = admissionReport.status === "admitted";
	const graph = projectedGraph;
	const positive = admitted && graph?.finding.finding === "positive-differential";
	const technicalFailureCode =
		input.failure instanceof RootEvalCallerSettlementDeadlineExpired
			? ("caller-settlement-deadline-expired" as const)
			: null;
	const failureDigest =
		input.failure !== null
			? empiricalStrictJsonDigest({
					kind: "root-eval-live-failure",
					message: input.failure instanceof Error ? input.failure.message : String(input.failure),
				})
			: admissionReport.status === "rejected"
				? empiricalStrictJsonDigest({
						kind: "root-eval-live-admission-rejection",
						violationCodes: admissionReport.violationCodes,
						rejectedGraphSummary: admissionReport.rejectedGraphSummary,
					})
				: null;
	const material = strictSnapshot({
		schemaVersion: ROOT_EVAL_LIVE_EVIDENCE_SCHEMA,
		generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
		disposition: admitted ? ("success" as const) : ("partial-failure" as const),
		claimDigest: input.claim.claimDigest,
		currentKeyBeforeDigest: input.currentKeyBefore?.admissionDigest ?? null,
		currentKeyAfterDigest: input.currentKeyAfter?.admissionDigest ?? null,
		billedUsageDeltaMicrousd: reconciliation?.usageDeltaMicrousd ?? null,
		billedRemainingDeltaMicrousd: reconciliation?.remainingDeltaMicrousd ?? null,
		cleanupDisposition: input.cleanupDisposition,
		implementationCoordinate: input.claim.implementationCoordinate,
		implementationManifestDigest: input.claim.implementationManifestDigest,
		qualificationArtifactDigest: input.claim.qualificationArtifactDigest,
		qualificationDigest: input.claim.qualificationDigest,
		pricingObservationDigest: input.pricing.observationDigest,
		zeroByokObservationDigest: input.zeroByok.observationDigest,
		taskBindingDigest: input.claim.taskBindingDigest,
		providerCalls: input.providerCalls,
		graphResult: graph,
		partialGraphObservations: projectPartialObservations(input.partialGraphObservations),
		latestGraphObservation: projectLatestObservation(input.partialGraphObservations),
		admissionReport,
		failureDigest,
		technicalFailureCode,
		efficacyClaim: positive ? ("frozen-task-positive-differential" as const) : ("none" as const),
		causalAttribution: positive
			? ("frozen-task-memory-context-differential" as const)
			: ("undetermined" as const),
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

const EVIDENCE_KEYS = Object.freeze([
	"schemaVersion",
	"generationRef",
	"disposition",
	"claimDigest",
	"currentKeyBeforeDigest",
	"currentKeyAfterDigest",
	"billedUsageDeltaMicrousd",
	"billedRemainingDeltaMicrousd",
	"cleanupDisposition",
	"implementationCoordinate",
	"implementationManifestDigest",
	"qualificationArtifactDigest",
	"qualificationDigest",
	"pricingObservationDigest",
	"zeroByokObservationDigest",
	"taskBindingDigest",
	"providerCalls",
	"graphResult",
	"partialGraphObservations",
	"latestGraphObservation",
	"admissionReport",
	"failureDigest",
	"technicalFailureCode",
	"efficacyClaim",
	"causalAttribution",
	"evidenceDigest",
]);

function validateEvidenceGraph(value: unknown): RootEvalLiveGraphEvidence {
	const graph = record(value, "root eval live evidence.graphResult");
	exactKeys(
		graph,
		["finding", "observations", "peakConcurrentEffects", "executedAdmissionDigests"],
		"root eval live evidence.graphResult",
	);
	const finding = projectFinding(graph.finding);
	if (
		finding.campaignRef !== ROOT_EVAL_LIVE_GENERATION_REF ||
		finding.replicateCount !== 5 ||
		finding.completedWorkItems !== 30 ||
		finding.stoppingReason !== "campaign-complete" ||
		finding.armOrder.some((arm, index) => arm !== ROOT_EVAL_ARMS[index]) ||
		ROOT_EVAL_ARMS.some((arm) => finding.passCounts[arm] > 5) ||
		finding.accountedUpperBoundMicrousd > ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD ||
		finding.pricingRoundingAllowanceMicrousd > finding.providerReportedMicrousd ||
		finding.providerReportedLowerBoundMicrousd !==
			Math.max(0, finding.providerReportedMicrousd - finding.pricingRoundingAllowanceMicrousd)
	)
		throw new TypeError("root eval live evidence graph finding was not admitted");
	const computedFinding =
		finding.passCounts["relevant-applied"] >
		Math.max(
			finding.passCounts.cold,
			finding.passCounts["proposal-only"],
			finding.passCounts["admission-rejected"],
			finding.passCounts["irrelevant-applied"],
			finding.passCounts["wrong-scope-applied"],
		)
			? "positive-differential"
			: "no-positive-differential";
	if (finding.finding !== computedFinding)
		throw new TypeError("root eval live evidence graph finding conclusion drifted");
	const observations = array(
		graph.observations,
		"root eval live evidence.graphResult.observations",
	);
	if (observations.length < 1 || observations.length > 512)
		throw new TypeError("root eval live evidence graph observation count invalid");
	const projectedObservations = observations.map((event, index) =>
		projectObservation(event, index),
	);
	for (let index = 1; index < projectedObservations.length; index += 1) {
		const previous = projectedObservations[index - 1]!;
		const current = projectedObservations[index]!;
		if (
			current.event.seq <= previous.event.seq ||
			empiricalStrictJsonDigest(current.value) === empiricalStrictJsonDigest(previous.value)
		)
			throw new TypeError("root eval live evidence observation progress drifted");
		assertRootEvalObservationTransition(
			previous.value,
			current.value,
			"root eval live evidence observation",
		);
	}
	assertRootEvalObservationSequence(
		projectedObservations.map((observation) => observation.value),
		"root eval live evidence observation",
	);
	const terminals = projectedObservations.filter(
		(observation) => observation.value.finding !== "pending",
	);
	const terminal = terminals[0];
	if (
		terminals.length !== 1 ||
		terminal === undefined ||
		projectedObservations.at(-1) !== terminal ||
		terminal.value.finding !== finding.finding ||
		terminal.value.stoppingReason !== finding.stoppingReason ||
		terminal.value.replicate !== 5 ||
		terminal.value.completedArms !== 6 ||
		terminal.value.activeAdmittedEffects !== 0 ||
		terminal.value.admittedAttempts !== finding.admittedAttempts ||
		terminal.value.providerCallCount !== finding.providerCallCount ||
		terminal.value.activeReservedMicrousd !== finding.activeReservedMicrousd ||
		terminal.value.providerReportedMicrousd !== finding.providerReportedMicrousd ||
		terminal.value.pricingRoundingAllowanceMicrousd !== finding.pricingRoundingAllowanceMicrousd ||
		terminal.value.providerReportedLowerBoundMicrousd !==
			finding.providerReportedLowerBoundMicrousd ||
		terminal.value.unreportedSettledUpperBoundMicrousd !==
			finding.unreportedSettledUpperBoundMicrousd ||
		terminal.value.accountedUpperBoundMicrousd !== finding.accountedUpperBoundMicrousd ||
		empiricalStrictJsonDigest(terminal.value.verificationDiagnostics) !==
			empiricalStrictJsonDigest(finding.verificationDiagnostics) ||
		EVAL_PROVIDER_OUTCOME_REASON_CODES.reduce(
			(total, code) => total + finding.providerOutcomeReasonCounts[code],
			0,
		) !== finding.admittedAttempts ||
		EVAL_PROVIDER_OUTCOME_REASON_CODES.some(
			(code) =>
				terminal.value.providerOutcomeReasonCounts[code] !==
				finding.providerOutcomeReasonCounts[code],
		)
	)
		throw new TypeError("root eval live evidence terminal observation invalid");
	assertRootEvalFindingTerminalConsistency(finding as EvalFinding, terminal.value);
	const peak = safeInteger(
		graph.peakConcurrentEffects,
		"root eval live evidence.graphResult.peakConcurrentEffects",
		{ min: 1, max: 6 },
	);
	const rawDigests = array(
		graph.executedAdmissionDigests,
		"root eval live evidence.graphResult.executedAdmissionDigests",
	);
	if (rawDigests.length < 30 || rawDigests.length > 60)
		throw new TypeError("root eval live evidence admission digest count invalid");
	const admissionDigests = rawDigests.map((value, index) =>
		digest(value, `root eval live evidence.graphResult.executedAdmissionDigests[${index}]`),
	);
	if (new Set(admissionDigests).size !== admissionDigests.length)
		throw new TypeError("root eval live evidence admission digests duplicated");
	if (finding.admittedAttempts !== admissionDigests.length)
		throw new TypeError("root eval live evidence admitted attempt count drifted");
	return strictSnapshot({
		finding,
		observations: projectedObservations.map((observation) => observation.event),
		peakConcurrentEffects: peak,
		executedAdmissionDigests: admissionDigests,
	}) as unknown as RootEvalLiveGraphEvidence;
}

function validateAdmissionReport(value: unknown): RootEvalLiveAdmissionReport {
	const report = record(value, "root eval live evidence.admissionReport");
	exactKeys(
		report,
		["status", "violationCodes", "rejectedGraphSummary"],
		"root eval live evidence.admissionReport",
	);
	const status = oneOf(
		report.status,
		["admitted", "rejected", "not-candidate"] as const,
		"root eval live evidence.admissionReport.status",
	);
	const rawCodes = array(
		report.violationCodes,
		"root eval live evidence.admissionReport.violationCodes",
	);
	const codes = rawCodes.map((value, index) =>
		oneOf(
			value,
			ROOT_EVAL_LIVE_SUCCESS_VIOLATION_CODES,
			`root eval live evidence.admissionReport.violationCodes[${index}]`,
		),
	);
	const indexes = codes.map((code) => ROOT_EVAL_LIVE_SUCCESS_VIOLATION_CODES.indexOf(code));
	if (
		new Set(codes).size !== codes.length ||
		indexes.some((value, index) => index > 0 && value <= indexes[index - 1]!)
	)
		throw new TypeError("root eval live evidence violation ordering invalid");
	if ((status === "admitted" || status === "not-candidate") && codes.length !== 0)
		throw new TypeError("root eval live evidence non-rejected report had violations");
	if (status === "rejected" && codes.length < 1)
		throw new TypeError("root eval live evidence rejected report omitted violations");
	if (report.rejectedGraphSummary !== null) {
		const summary = record(
			report.rejectedGraphSummary,
			"root eval live evidence.admissionReport.rejectedGraphSummary",
		);
		exactKeys(
			summary,
			[
				"campaignRef",
				"replicateCount",
				"completedWorkItems",
				"admittedAttempts",
				"stoppingReason",
				"finding",
				"accountedUpperBoundMicrousd",
				"providerReportedMicrousd",
				"pricingRoundingAllowanceMicrousd",
				"providerReportedLowerBoundMicrousd",
				"observedBilledMicrousd",
				"billingObservationCount",
				"billingStableIntervals",
				"reconciledBilledMicrousd",
				"billingDisposition",
				"passCounts",
				"providerOutcomeReasonCounts",
				"observationCount",
				"terminalObservation",
				"peakConcurrentEffects",
				"executedAdmissionCount",
				"executedAdmissionSetDigest",
				"providerCalls",
				"billedUsageDeltaMicrousd",
				"billedRemainingDeltaMicrousd",
			],
			"root eval live evidence.admissionReport.rejectedGraphSummary",
		);
		coordinate(summary.campaignRef, "root eval live evidence rejected campaignRef");
		if (summary.campaignRef !== ROOT_EVAL_LIVE_GENERATION_REF && summary.campaignRef !== "invalid")
			throw new TypeError("root eval live evidence rejected campaignRef was not material-free");
		oneOf(
			summary.stoppingReason,
			["campaign-complete"] as const,
			"root eval live evidence rejected stoppingReason",
		);
		oneOf(
			summary.finding,
			["positive-differential", "no-positive-differential"] as const,
			"root eval live evidence rejected finding",
		);
		for (const key of [
			"replicateCount",
			"completedWorkItems",
			"admittedAttempts",
			"accountedUpperBoundMicrousd",
			"providerReportedMicrousd",
			"pricingRoundingAllowanceMicrousd",
			"providerReportedLowerBoundMicrousd",
			"observedBilledMicrousd",
			"billingObservationCount",
			"billingStableIntervals",
			"reconciledBilledMicrousd",
			"peakConcurrentEffects",
		] as const)
			if (summary[key] !== null)
				safeInteger(summary[key], `root eval live evidence rejected ${key}`);
		for (const key of ["observationCount", "executedAdmissionCount", "providerCalls"] as const)
			safeInteger(summary[key], `root eval live evidence rejected ${key}`);
		digest(summary.executedAdmissionSetDigest, "root eval live evidence rejected admission digest");
		const passCounts = record(summary.passCounts, "root eval live evidence rejected passCounts");
		exactKeys(passCounts, ROOT_EVAL_ARMS, "root eval live evidence rejected passCounts");
		for (const arm of ROOT_EVAL_ARMS)
			if (passCounts[arm] !== null)
				safeInteger(passCounts[arm], `root eval live evidence rejected passCounts.${arm}`);
		projectProviderOutcomeReasonCounts(
			summary.providerOutcomeReasonCounts,
			"root eval live evidence rejected providerOutcomeReasonCounts",
		);
		for (const key of ["billedUsageDeltaMicrousd", "billedRemainingDeltaMicrousd"] as const)
			if (summary[key] !== null)
				safeInteger(summary[key], `root eval live evidence rejected ${key}`);
		if (summary.terminalObservation !== null) {
			const terminal = record(
				summary.terminalObservation,
				"root eval live evidence rejected terminalObservation",
			);
			exactKeys(
				terminal,
				["campaignRef", "stoppingReason", "finding"],
				"root eval live evidence rejected terminalObservation",
			);
			if (
				(terminal.campaignRef !== ROOT_EVAL_LIVE_GENERATION_REF &&
					terminal.campaignRef !== "invalid") ||
				!(["none", "campaign-complete", "budget-exhausted", "effect-failed"] as const).includes(
					terminal.stoppingReason as never,
				) ||
				!(["pending", "positive-differential", "no-positive-differential"] as const).includes(
					terminal.finding as never,
				)
			)
				throw new TypeError("root eval live evidence rejected terminal observation invalid");
		}
		if (status !== "rejected")
			throw new TypeError("root eval live evidence summary belonged to non-rejected report");
	} else if (status === "rejected" && !codes.includes("success.graph-shape-invalid")) {
		throw new TypeError("root eval live evidence rejected report omitted safe summary");
	}
	return strictSnapshot({
		status,
		violationCodes: codes,
		rejectedGraphSummary: report.rejectedGraphSummary,
	}) as RootEvalLiveAdmissionReport;
}

function validateRootEvalLiveEvidenceForPersistence(value: RootEvalLiveEvidence): void {
	const evidence = record(value, "root eval live evidence");
	exactKeys(evidence, EVIDENCE_KEYS, "root eval live evidence");
	if (!validatesOwnDigest(evidence, "evidenceDigest"))
		throw new TypeError("root eval live evidence digest invalid");
	literal(
		evidence.schemaVersion,
		ROOT_EVAL_LIVE_EVIDENCE_SCHEMA,
		"root eval live evidence.schemaVersion",
	);
	literal(
		evidence.generationRef,
		ROOT_EVAL_LIVE_GENERATION_REF,
		"root eval live evidence.generationRef",
	);
	digest(evidence.claimDigest, "root eval live evidence.claimDigest");
	for (const key of ["currentKeyBeforeDigest", "currentKeyAfterDigest", "failureDigest"] as const)
		if (evidence[key] !== null) digest(evidence[key], `root eval live evidence.${key}`);
	for (const key of ["billedUsageDeltaMicrousd", "billedRemainingDeltaMicrousd"] as const)
		if (evidence[key] !== null) safeInteger(evidence[key], `root eval live evidence.${key}`);
	safeInteger(evidence.providerCalls, "root eval live evidence.providerCalls");
	literal(
		evidence.implementationManifestDigest,
		ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		"root eval live evidence.implementationManifestDigest",
	);
	literal(
		evidence.qualificationArtifactDigest,
		ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		"root eval live evidence.qualificationArtifactDigest",
	);
	literal(
		evidence.qualificationDigest,
		ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
		"root eval live evidence.qualificationDigest",
	);
	literal(
		evidence.taskBindingDigest,
		ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
		"root eval live evidence.taskBindingDigest",
	);
	digest(evidence.pricingObservationDigest, "root eval live evidence.pricingObservationDigest");
	digest(evidence.zeroByokObservationDigest, "root eval live evidence.zeroByokObservationDigest");
	if (
		typeof evidence.implementationCoordinate !== "string" ||
		!/^worktree:[0-9a-f]{40}:sha256:[0-9a-f]{64}$/u.test(evidence.implementationCoordinate) ||
		!evidence.implementationCoordinate.endsWith(
			`:${ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST}`,
		)
	)
		throw new TypeError("root eval live evidence implementation coordinate invalid");
	const report = validateAdmissionReport(evidence.admissionReport);
	const partial = projectPartialObservations(
		evidence.partialGraphObservations as readonly ObserveEvent[],
	);
	const latest =
		evidence.latestGraphObservation === null
			? null
			: projectObservation(evidence.latestGraphObservation, 0).event;
	if (
		empiricalStrictJsonDigest(partial) !==
		empiricalStrictJsonDigest(evidence.partialGraphObservations)
	)
		throw new TypeError("root eval live evidence partial observations were not projected");
	if (
		empiricalStrictJsonDigest(latest) !==
		empiricalStrictJsonDigest(projectLatestObservation(partial))
	)
		throw new TypeError("root eval live evidence latest observation drifted");
	if (
		evidence.technicalFailureCode !== null &&
		evidence.technicalFailureCode !== "caller-settlement-deadline-expired"
	)
		throw new TypeError("root eval live evidence technical failure code invalid");
	const disposition = oneOf(
		evidence.disposition,
		["success", "partial-failure"] as const,
		"root eval live evidence.disposition",
	);
	if (disposition === "success") {
		if (
			evidence.graphResult === null ||
			report.status !== "admitted" ||
			evidence.failureDigest !== null ||
			evidence.technicalFailureCode !== null
		)
			throw new TypeError("root eval live success evidence relationship invalid");
		const graph = validateEvidenceGraph(evidence.graphResult);
		if (empiricalStrictJsonDigest(partial) !== empiricalStrictJsonDigest(graph.observations))
			throw new TypeError(
				"root eval live success partial observations drifted from Graph result observations",
			);
		if (evidence.providerCalls !== graph.finding.providerCallCount)
			throw new TypeError("root eval live success provider count drifted");
		if (evidence.currentKeyBeforeDigest === null)
			throw new TypeError("root eval live success campaign admission snapshot missing");
		const positive = graph.finding.finding === "positive-differential";
		if (
			evidence.efficacyClaim !== (positive ? "frozen-task-positive-differential" : "none") ||
			evidence.causalAttribution !==
				(positive ? "frozen-task-memory-context-differential" : "undetermined") ||
			evidence.cleanupDisposition !== "complete"
		)
			throw new TypeError("root eval live success conclusion relationship invalid");
	} else {
		if (
			(report.status !== "rejected" && report.status !== "not-candidate") ||
			evidence.failureDigest === null
		)
			throw new TypeError("root eval live partial evidence relationship invalid");
		if (
			evidence.technicalFailureCode === "caller-settlement-deadline-expired" &&
			evidence.cleanupDisposition !== "complete"
		)
			throw new TypeError("root eval deadline evidence requires completed cleanup");
		if (evidence.graphResult === null) {
			if (evidence.efficacyClaim !== "none" || evidence.causalAttribution !== "undetermined")
				throw new TypeError("root eval live partial evidence relationship invalid");
		} else {
			if (report.status !== "rejected")
				throw new TypeError("root eval live partial Graph relationship invalid");
			validateEvidenceGraph(evidence.graphResult);
			if (evidence.efficacyClaim !== "none" || evidence.causalAttribution !== "undetermined")
				throw new TypeError("root eval live partial Graph conclusion relationship invalid");
		}
	}
}

function validateCurrentCommittedClaim(value: unknown): RootEvalLiveClaim {
	const claim = record(value, "root eval live committed claim");
	exactKeys(claim, CLAIM_KEYS, "root eval live committed claim");
	if (!validatesOwnDigest(claim, "claimDigest"))
		throw new TypeError("root eval live committed claim digest invalid");
	recoverRootEvalLiveClaimAuthority(claim as unknown as RootEvalLiveClaim);
	literal(
		claim.schemaVersion,
		ROOT_EVAL_LIVE_CLAIM_SCHEMA,
		"root eval live committed claim schema",
	);
	oneOf(
		claim.executionMode,
		["live", "no-network-qualification"] as const,
		"root eval live committed claim execution mode",
	);
	literal(claim.claimRef, ROOT_EVAL_LIVE_CLAIM_REF, "root eval live committed claim ref");
	literal(
		claim.decisionRef,
		ROOT_EVAL_LIVE_DECISION_REF,
		"root eval live committed claim decision",
	);
	literal(
		claim.generationRef,
		ROOT_EVAL_LIVE_GENERATION_REF,
		"root eval live committed claim generation",
	);
	literal(
		claim.implementationManifestDigest,
		ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		"root eval live committed claim implementation manifest",
	);
	literal(
		claim.qualificationArtifactDigest,
		ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		"root eval live committed claim qualification artifact",
	);
	literal(
		claim.qualificationDigest,
		ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
		"root eval live committed claim qualification",
	);
	literal(
		claim.taskBindingDigest,
		ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
		"root eval live committed claim task binding",
	);
	literal(
		claim.campaignHardCapMicrousd,
		ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD,
		"root eval live committed claim campaign cap",
	);
	literal(
		claim.localEvalNoResetLimitMicrousd,
		ROOT_EVAL_LIVE_KEY_LIMIT_MICROUSD,
		"root eval live committed claim key limit",
	);
	for (const key of [
		"pricingObservationDigest",
		"zeroByokObservationDigest",
		"credentialFingerprintDigest",
		"currentKeyBeforeDigest",
	] as const)
		digest(claim[key], `root eval live committed claim.${key}`);
	literal(
		claim.credentialBindingDigest,
		empiricalStrictJsonDigest({
			bindingRef: "openrouter.local-eval-2",
			bindingRevision: "2026-08-26.d125.v1",
		}),
		"root eval live committed claim credential binding",
	);
	if (
		typeof claim.implementationCoordinate !== "string" ||
		!/^worktree:[0-9a-f]{40}:sha256:[0-9a-f]{64}$/u.test(claim.implementationCoordinate) ||
		!claim.implementationCoordinate.endsWith(`:${ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST}`)
	)
		throw new TypeError("root eval live committed claim implementation coordinate invalid");
	return strictSnapshot(claim) as unknown as RootEvalLiveClaim;
}

export function assertRootEvalLiveClaimCommit(input: {
	readonly commit: RootEvalLiveClaimCommit;
	readonly privateRoot: string;
	readonly executionMode: RootEvalLiveClaim["executionMode"];
	readonly credentialFingerprintDigest: string;
}): RootEvalLiveClaim {
	const commit = RootEvalLiveClaimCommitCapability.unwrap(input.commit, resolve(input.privateRoot));
	if (commit === undefined)
		throw new TypeError("root eval live dispatch requires claim acquisition capability");
	const claim = validateCurrentCommittedClaim(commit.claim);
	if (
		claim.executionMode !== input.executionMode ||
		claim.credentialFingerprintDigest !== input.credentialFingerprintDigest
	)
		throw new TypeError("root eval live dispatch claim capability binding invalid");
	return claim;
}

function validateCommittedClaimForEvidence(
	value: unknown,
	evidence: RootEvalLiveEvidence,
): RootEvalLiveClaim {
	const claim = validateCurrentCommittedClaim(value);
	for (const [claimKey, evidenceKey] of [
		["claimDigest", "claimDigest"],
		["implementationCoordinate", "implementationCoordinate"],
		["implementationManifestDigest", "implementationManifestDigest"],
		["qualificationArtifactDigest", "qualificationArtifactDigest"],
		["qualificationDigest", "qualificationDigest"],
		["taskBindingDigest", "taskBindingDigest"],
		["pricingObservationDigest", "pricingObservationDigest"],
		["zeroByokObservationDigest", "zeroByokObservationDigest"],
		["currentKeyBeforeDigest", "currentKeyBeforeDigest"],
	] as const)
		if (claim[claimKey] !== evidence[evidenceKey])
			throw new TypeError(`root eval live evidence was not bound to committed claim ${claimKey}`);
	return claim;
}

async function verifyPersistedEvidencePostCommit(
	generationRoot: string,
	target: string,
	bytes: Uint8Array,
): Promise<string | null> {
	const postCommitErrors: unknown[] = [];
	const parentDirectory = await open(
		dirname(generationRoot),
		constants.O_RDONLY | constants.O_DIRECTORY,
	).catch((error: unknown) => {
		postCommitErrors.push(error);
		return null;
	});
	if (parentDirectory !== null)
		try {
			await parentDirectory.sync();
		} catch (error) {
			postCommitErrors.push(error);
		} finally {
			await parentDirectory.close();
		}
	try {
		const reader = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const persisted = new Uint8Array(await reader.readFile());
			if (!sameBytes(persisted, bytes)) throw new TypeError("root eval evidence bytes drifted");
		} finally {
			await reader.close();
		}
	} catch (error) {
		postCommitErrors.push(error);
	}
	return postCommitErrors.length === 0
		? null
		: empiricalStrictJsonDigest({
				kind: "root-eval-evidence-post-commit-failure",
				errors: postCommitErrors.map((error) =>
					error instanceof Error ? error.message : String(error),
				),
			});
}

export async function persistRootEvalLiveEvidence(input: {
	readonly privateRoot: string;
	readonly evidence: RootEvalLiveEvidence;
}): Promise<
	Readonly<{
		readonly artifactDigest: string;
		readonly receiptDigest: string;
		readonly postCommitFailureDigest: string | null;
	}>
> {
	// Snapshot before the first await. Validation, encoding, and receipts all use this
	// immutable value, closing caller-mutation TOCTOU across filesystem operations.
	const evidence = strictSnapshot(input.evidence) as RootEvalLiveEvidence;
	validateRootEvalLiveEvidenceForPersistence(evidence);
	if (!isAbsolute(input.privateRoot))
		throw new TypeError("root eval evidence root must be absolute");
	const privateRoot = resolve(input.privateRoot);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("root eval evidence root drifted");
	const dispositionPath = join(
		privateRoot,
		`.${ROOT_EVAL_LIVE_GENERATION_REF}.disposition.v15.json`,
	);
	const dispositionBytes = await readRootEvalPrivateFile(dispositionPath, 65_536).catch(() => {
		throw new TypeError("root eval evidence requires one committed D125 claim");
	});
	const committedClaim = strictJsonCodec.decode(dispositionBytes);
	if (!sameBytes(strictJsonCodec.encode(committedClaim), dispositionBytes))
		throw new TypeError("root eval committed claim bytes were not canonical");
	const validatedClaim = validateCommittedClaimForEvidence(committedClaim, evidence);
	if (validatedClaim.executionMode === "no-network-qualification") {
		const temporaryRoot = await realpath(tmpdir());
		if (
			!privateRoot.startsWith(`${temporaryRoot}/`) ||
			validatedClaim.credentialFingerprintDigest !==
				credentialFingerprint({
					bearerToken: "sk-or-v1-a44-middle-credential-e06",
					bindingRef: "openrouter.local-eval-2",
					bindingRevision: "2026-08-26.d125.v1",
				})
		)
			throw new TypeError("root eval qualification evidence escaped synthetic authority");
	}
	const bytes = strictJsonCodec.encode(evidence);
	const generationRoot = join(privateRoot, ROOT_EVAL_LIVE_GENERATION_REF);
	const target = join(generationRoot, "evidence.v18.json");
	const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		},
	);
	if (existing !== null) {
		try {
			if (!sameBytes(new Uint8Array(await existing.readFile()), bytes))
				throw new TypeError("root eval evidence generation already contains different bytes");
		} finally {
			await existing.close();
		}
		const artifactDigest = empiricalSha256(bytes);
		return Object.freeze({
			artifactDigest,
			receiptDigest: empiricalStrictJsonDigest({
				artifactDigest,
				evidenceDigest: evidence.evidenceDigest,
			}),
			postCommitFailureDigest: await verifyPersistedEvidencePostCommit(
				generationRoot,
				target,
				bytes,
			),
		});
	}
	const stagePrefix = `.${ROOT_EVAL_LIVE_GENERATION_REF}.stage-`;
	const stageRoot = join(privateRoot, `${stagePrefix}${randomUUID()}`);
	await mkdir(stageRoot, { mode: 0o700 });
	try {
		await chmod(stageRoot, 0o700);
		const stagedTarget = join(stageRoot, "evidence.v18.json");
		const writer = await open(
			stagedTarget,
			constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			await writer.writeFile(bytes);
			await writer.sync();
		} finally {
			await writer.close();
		}
		const stageDirectory = await open(stageRoot, constants.O_RDONLY | constants.O_DIRECTORY);
		try {
			await stageDirectory.sync();
		} finally {
			await stageDirectory.close();
		}
		await rename(stageRoot, generationRoot);
	} catch (error) {
		await rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
		if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
		const winner = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			if (!sameBytes(new Uint8Array(await winner.readFile()), bytes))
				throw new TypeError("root eval evidence generation already contains different bytes");
		} finally {
			await winner.close();
		}
		const artifactDigest = empiricalSha256(bytes);
		return Object.freeze({
			artifactDigest,
			receiptDigest: empiricalStrictJsonDigest({
				artifactDigest,
				evidenceDigest: evidence.evidenceDigest,
			}),
			postCommitFailureDigest: await verifyPersistedEvidencePostCommit(
				generationRoot,
				target,
				bytes,
			),
		});
	}
	const artifactDigest = empiricalSha256(bytes);
	return Object.freeze({
		artifactDigest,
		receiptDigest: empiricalStrictJsonDigest({
			artifactDigest,
			evidenceDigest: evidence.evidenceDigest,
		}),
		postCommitFailureDigest: await verifyPersistedEvidencePostCommit(generationRoot, target, bytes),
	});
}
