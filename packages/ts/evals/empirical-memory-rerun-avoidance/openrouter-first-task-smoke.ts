import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	CLOSED_ACTOR_TOOL_REFS,
	type ClosedContinuationModelTurnPortV1,
	type ClosedMutationFirstContinuationModelTurnPortV1,
	type ClosedMutationFirstContinuationV1,
	type ClosedTaskProfileHostRetryCapabilityV1,
	type ClosedTaskProfileHostRunInputV1,
	type ClosedTaskProfileHostRunOutcomeV3,
	runClosedTaskProfileHost,
} from "./closed-task-profile-host.js";
import {
	assertD710UntypedHttp429RetryRoute,
	type D710UntypedHttp429RetryPolicyV1,
	d710UntypedHttp429RetryDelayMs,
	validateD710UntypedHttp429RetryPolicy,
} from "./d710-untyped-http-429-retry-policy.js";
import {
	D712_APPROVAL_REF,
	D712_APPROVAL_REVISION,
	D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
} from "./d712-pricing-schedule.js";
import {
	type D716ArmCompletionFact,
	type D716GraphNativeCoordinationEvidenceV1,
	type D716GraphNativeSixArmCoordinatorV1,
	d716IndependentWarmReflection,
	isConstructedD716GraphNativeSixArmCoordinator,
	recordD716GraphNativeArmCompletion,
	snapshotD716GraphNativeCoordination,
	takeNextD716GraphNativeArmRequest,
} from "./d716-graph-native-live-coordinator.js";
import {
	consumeD717GraphNativeLiveProviderCapability,
	type D717GraphNativeLiveProviderCapabilityV1,
} from "./d717-graph-native-live-capability.js";
import {
	beginD719GraphNativeBudgetArm,
	type D719BudgetLimitsFactV1,
	type D719BudgetStateFactV1,
	type D719GraphNativeBudgetEvidenceV1,
	type D719GraphNativeEvalAuthorityV1,
	d719GraphNativeBudgetStoppedReasonForArm,
	decideD719GraphNativeBudget,
	endD719GraphNativeBudgetArm,
	isConstructedD719GraphNativeEvalAuthorityForCoordinator,
	snapshotD719GraphNativeBudgetEvidence,
} from "./d719-graph-native-eval-authority.js";
import {
	type B112CalibrationEmpiricalRunInputV4,
	type B112CalibrationEmpiricalRunnerV4,
	createB112CalibrationBlockPreparationFailure,
	createB112CalibrationEmpiricalBlockResult,
	createB112CalibrationTrialBlockIdentity,
} from "./empirical-calibration.js";
import {
	createEmpiricalCalibrationTrialBlockObservation,
	createEmpiricalCampaignScorecard,
	createEmpiricalTrialBlockObservation,
	type EmpiricalCalibrationTrialBlockObservationV4,
	type EmpiricalCampaignScorecardV3,
	type EmpiricalSmokeCostLedgerV1,
	type EmpiricalTrialBlockObservationV3,
} from "./empirical-smoke-evidence.js";
import type { EmpiricalExactPrivateNeedleProtectionExecutorV1 } from "./exact-private-needle-protection.js";
import {
	B112_MATCHED_BLOCK_MEMORY_REVISION,
	type D691HistoricalReflectionCapabilityV1,
	prepareB112MatchedBlockReflection,
	prepareConstructedD691HistoricalReflection,
} from "./matched-block-memory.js";
import {
	EMPIRICAL_MODEL_EXECUTION_SCHEMAS,
	type EmpiricalModelTurnEvidenceRefV1,
	type EmpiricalModelTurnOutcomeV1,
	type EmpiricalModelTurnPortV1,
	type EmpiricalModelTurnRequestV1,
	executeEmpiricalProtection,
	validateEmpiricalModelTurnRequest,
} from "./model-execution.js";
import {
	createOpenRouterResponsesEmpiricalBinding,
	OPENROUTER_RESPONSES_ISSUE_CODES,
	type OpenRouterResponsesByteTransportV1,
	type OpenRouterResponsesCredentialCapabilityV1,
	type OpenRouterResponsesMonotonicMeasurementV1,
	type OpenRouterResponsesTransportAdmissionV1,
} from "./openrouter-responses-model-turn.js";
import {
	calculateOpenRouterCostMicrousd,
	OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
	OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
	OPENROUTER_FIRST_SMOKE_STANDARD_PRICING_MAX_INPUT_TOKENS,
	OPENROUTER_GLM_5_2_DEEPINFRA_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_GLM_5_2_DEEPINFRA_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_GLM_5_2_DEEPINFRA_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_GLM_5_2_DEEPINFRA_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_GLM_5_2_DEEPINFRA_PRICING_REVISION,
	OPENROUTER_GLM_5_2_DEEPINFRA_PRICING_SOURCE,
	OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_GLM_5_2_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_GLM_5_2_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_GLM_5_2_PRICING_REVISION,
	OPENROUTER_GLM_5_2_PRICING_SOURCE,
	OPENROUTER_GLM_5_2_REQUEST_MODEL,
	OPENROUTER_OFFICIAL_PRICING_REVISION,
	OPENROUTER_OFFICIAL_PRICING_SOURCE,
	OPENROUTER_PROVIDER_USAGE_REVISION,
	OPENROUTER_RESPONSES_ADAPTER_REVISION,
	OPENROUTER_RESPONSES_BINDING_REVISION,
	OPENROUTER_RESPONSES_ENDPOINT,
	OPENROUTER_RESPONSES_ENDPOINT_REVISION,
	type OpenRouterRouteQualificationV1,
} from "./openrouter-route-qualification.js";
import {
	type PersistedPrivateSmokeGenerationV3,
	persistPrivateSmokeGeneration,
} from "./private-smoke-persistence.js";

export const OPENROUTER_API_KEY_ENVIRONMENT_NAME = "OPENROUTER_API_KEY";
export const B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION =
	"b112-first-task-smoke-single-observation.v1";
export const B112_SMOKE_BUDGET_ISSUE_CODE = "smoke-budget-exhausted";
export const B112_SMOKE_ADMISSION_REJECTION_SCHEMA = "b112-smoke-admission-rejection.v1";
export const B112_SMOKE_ADMISSION_REJECTION_REASONS = Object.freeze({
	pendingReservation: "pending-reservation",
	requestLimit: "request-limit",
	stepLimit: "step-limit",
	canonicalRequestBytes: "canonical-request-bytes",
	inputTokenReservation: "input-token-reservation",
	outputTokenReservation: "output-token-reservation",
	costReservation: "cost-reservation",
} as const);

const B112_CALIBRATION_ELAPSED_ADMISSION_REJECTION_REASON = "elapsed-budget";

type B112SmokeAdmissionRejectionReason =
	| (typeof B112_SMOKE_ADMISSION_REJECTION_REASONS)[keyof typeof B112_SMOKE_ADMISSION_REJECTION_REASONS]
	| typeof B112_CALIBRATION_ELAPSED_ADMISSION_REJECTION_REASON;

export interface B112SmokeAdmissionRejectionV1 {
	readonly schemaVersion: typeof B112_SMOKE_ADMISSION_REJECTION_SCHEMA;
	readonly requestRef: string;
	readonly reasons: readonly B112SmokeAdmissionRejectionReason[];
	readonly requests: number;
	readonly maxRequests: number;
	readonly maxStepsPerRun: number;
	readonly wireRequestBytes: number;
	readonly maxCanonicalRequestBytes: number;
	readonly reservedInputTokens: number;
	readonly prospectiveInputTokens: number;
	readonly maxInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly prospectiveOutputTokens: number;
	readonly maxOutputTokens: number;
	readonly reservedCostMicrousd: number;
	readonly prospectiveCostMicrousd: number;
	readonly maxSmokeSpendMicrousd: number;
}

export interface OpenRouterFirstTaskSmokeResultV3 {
	readonly observation: EmpiricalTrialBlockObservationV3;
	readonly scorecard: EmpiricalCampaignScorecardV3;
	readonly persistence: PersistedPrivateSmokeGenerationV3;
	/**
	 * Bounded operator diagnostic only. It is intentionally excluded from the
	 * observation, scorecard, and private persisted generation.
	 */
	readonly admissionRejection: B112SmokeAdmissionRejectionV1 | null;
}

export interface OpenRouterContinuationInvocationFactV1 {
	readonly trialStage: EmpiricalModelTurnRequestV1["trialStage"];
	readonly stepIndex: number;
	readonly attemptOrdinal: number;
	readonly requestDigest: string;
	readonly continuationDigest: string;
	readonly requiredDisposition: "tool-intents" | "final-allowed";
	readonly providerRequestCount: number;
}

export interface OpenRouterMutationFirstInvocationFactV1 {
	readonly trialStage: EmpiricalModelTurnRequestV1["trialStage"];
	readonly stepIndex: number;
	readonly attemptOrdinal: number;
	readonly requestDigest: string;
	readonly continuationDigest: string;
	readonly staleResultReceiptDigest: string;
	readonly requiredFirstToolRef: ClosedMutationFirstContinuationV1["requiredFirstToolRef"];
	readonly providerRequestCount: number;
}

export type OpenRouterMatchedTrialBlockResultV4 =
	| {
			readonly profile: "smoke";
			readonly observation: EmpiricalTrialBlockObservationV3;
			readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
			readonly admissionRejection: B112SmokeAdmissionRejectionV1 | null;
			readonly continuationInvocations?: readonly OpenRouterContinuationInvocationFactV1[];
			readonly mutationFirstInvocations?: readonly OpenRouterMutationFirstInvocationFactV1[];
			readonly graphNativeCoordination?: D716GraphNativeCoordinationEvidenceV1;
			readonly graphNativeLiveProviderQualificationDigest?: string;
			readonly graphNativeBudgetEvidence?: D719GraphNativeBudgetEvidenceV1;
	  }
	| {
			readonly profile: "calibration";
			readonly observation: EmpiricalCalibrationTrialBlockObservationV4;
			readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
			readonly admissionRejection: B112SmokeAdmissionRejectionV1 | null;
			readonly continuationInvocations?: readonly OpenRouterContinuationInvocationFactV1[];
			readonly mutationFirstInvocations?: readonly OpenRouterMutationFirstInvocationFactV1[];
			readonly graphNativeCoordination?: D716GraphNativeCoordinationEvidenceV1;
			readonly graphNativeLiveProviderQualificationDigest?: string;
			readonly graphNativeBudgetEvidence?: D719GraphNativeBudgetEvidenceV1;
	  };

/** Package-private canonical union for nested matched warm-arm issues. */
export function canonicalMatchedWarmBranchIssueCodes(
	...groups: readonly (readonly string[])[]
): readonly string[] {
	return Object.freeze([...new Set(groups.flat())].sort());
}

function assertQualifiedSmokeRoute(
	route: OpenRouterRouteQualificationV1,
	reasoningEffort: string | null,
	toolsChoice: string,
): void {
	const qualifiedTuple =
		(route.requestModel === OPENROUTER_FIRST_SMOKE_REQUEST_MODEL &&
			reasoningEffort === "medium" &&
			route.endpoint === OPENROUTER_RESPONSES_ENDPOINT &&
			route.endpointRevision === OPENROUTER_RESPONSES_ENDPOINT_REVISION &&
			route.adapterRevision === OPENROUTER_RESPONSES_ADAPTER_REVISION &&
			route.bindingRevision === OPENROUTER_RESPONSES_BINDING_REVISION &&
			route.downstreamProviderSlug === OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG &&
			route.downstreamProviderName === OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME &&
			route.pricing.sourceUrl === OPENROUTER_OFFICIAL_PRICING_SOURCE &&
			route.pricing.pricingRevision === OPENROUTER_OFFICIAL_PRICING_REVISION &&
			route.pricing.inputMicrousdPerMillionTokens === 6_250_000 &&
			route.pricing.outputMicrousdPerMillionTokens === 30_000_000 &&
			route.budget.maxCanonicalRequestBytes * route.budget.inputTokensPerCanonicalByteUpperBound +
				route.budget.fixedInputTokenOverheadPerRequest <=
				OPENROUTER_FIRST_SMOKE_STANDARD_PRICING_MAX_INPUT_TOKENS) ||
		(route.requestModel === OPENROUTER_GLM_5_2_REQUEST_MODEL &&
			reasoningEffort === "high" &&
			toolsChoice === "required" &&
			route.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT &&
			route.endpointRevision === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION &&
			route.adapterRevision === OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION &&
			route.bindingRevision === OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION &&
			route.downstreamProviderSlug === OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG &&
			route.downstreamProviderName === OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME &&
			route.pricing.sourceUrl === OPENROUTER_GLM_5_2_PRICING_SOURCE &&
			route.pricing.pricingRevision === OPENROUTER_GLM_5_2_PRICING_REVISION &&
			route.pricing.inputMicrousdPerMillionTokens ===
				OPENROUTER_GLM_5_2_INPUT_MICROUSD_PER_MILLION_TOKENS &&
			route.pricing.outputMicrousdPerMillionTokens ===
				OPENROUTER_GLM_5_2_OUTPUT_MICROUSD_PER_MILLION_TOKENS) ||
		(route.requestModel === OPENROUTER_GLM_5_2_REQUEST_MODEL &&
			reasoningEffort === "high" &&
			toolsChoice === "required" &&
			route.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT &&
			route.endpointRevision === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION &&
			route.adapterRevision === OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION &&
			route.bindingRevision === OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION &&
			route.downstreamProviderSlug === OPENROUTER_GLM_5_2_DEEPINFRA_DOWNSTREAM_PROVIDER_SLUG &&
			route.downstreamProviderName === OPENROUTER_GLM_5_2_DEEPINFRA_DOWNSTREAM_PROVIDER_NAME &&
			route.pricing.sourceUrl === OPENROUTER_GLM_5_2_DEEPINFRA_PRICING_SOURCE &&
			route.pricing.pricingRevision === OPENROUTER_GLM_5_2_DEEPINFRA_PRICING_REVISION &&
			route.pricing.inputMicrousdPerMillionTokens ===
				OPENROUTER_GLM_5_2_DEEPINFRA_INPUT_MICROUSD_PER_MILLION_TOKENS &&
			route.pricing.outputMicrousdPerMillionTokens ===
				OPENROUTER_GLM_5_2_DEEPINFRA_OUTPUT_MICROUSD_PER_MILLION_TOKENS) ||
		(route.requestModel === OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL &&
			reasoningEffort === "high" &&
			toolsChoice === "required" &&
			route.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT &&
			route.endpointRevision === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION &&
			route.adapterRevision === OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION &&
			route.bindingRevision === OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION &&
			route.downstreamProviderSlug === OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG &&
			route.downstreamProviderName === OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME &&
			route.pricing.sourceUrl === OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE &&
			((route.pricing.pricingRevision === OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION &&
				route.pricing.inputMicrousdPerMillionTokens ===
					OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS &&
				route.pricing.outputMicrousdPerMillionTokens ===
					OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS) ||
				(((route.budget.approvalRef === D712_APPROVAL_REF &&
					route.budget.approvalRevision === D712_APPROVAL_REVISION) ||
					(route.budget.approvalRef === "decision.D713" &&
						route.budget.approvalRevision === "decision.D713.2026-08-10.v1")) &&
					route.pricing.pricingRevision === D712_DEEPSEEK_V4_FLASH_PRICING_REVISION &&
					route.pricing.inputMicrousdPerMillionTokens ===
						D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS &&
					route.pricing.outputMicrousdPerMillionTokens ===
						D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS)));
	if (!qualifiedTuple || route.usageRevision !== OPENROUTER_PROVIDER_USAGE_REVISION) {
		throw new TypeError("B112 smoke route does not match its frozen exact route and pricing");
	}
	if (route.dispatchMode === "live-approved") {
		const liveCoordinates = [
			route.qualificationRef,
			route.qualificationRevision,
			route.budget.approvalRef,
			route.budget.approvalRevision,
			route.keySpendLimit.qualificationRef,
			route.keySpendLimit.qualificationRevision,
			route.sharedCapacityQualification.qualificationRef,
			route.sharedCapacityQualification.qualificationRevision,
			route.sharedCapacityQualification.workspaceRef,
			route.sharedCapacityQualification.workspaceRevision,
		];
		if (liveCoordinates.some((value) => /pending|placeholder|simulated/i.test(value))) {
			throw new TypeError("live B112 route still contains unapproved qualification coordinates");
		}
	}
}

/**
 * Outermost operator-only loader. The caller supplies an environment snapshot;
 * neither the model-turn binding nor transport can discover ambient state.
 */
export function createOpenRouterCredentialCapabilityFromOperatorEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
	routeQualification: OpenRouterRouteQualificationV1,
): OpenRouterResponsesCredentialCapabilityV1 {
	if (routeQualification.dispatchMode !== "live-approved") {
		throw new TypeError("OpenRouter credential construction requires a live-approved route");
	}
	const bearerToken = environment[OPENROUTER_API_KEY_ENVIRONMENT_NAME];
	if (typeof bearerToken !== "string" || bearerToken.length < 16 || bearerToken.length > 4_096) {
		throw new TypeError(`operator environment must provide ${OPENROUTER_API_KEY_ENVIRONMENT_NAME}`);
	}
	return Object.freeze({
		credentialBindingRef: routeQualification.sharedCapacityQualification.credentialBindingRef,
		credentialBindingRevision:
			routeQualification.sharedCapacityQualification.credentialBindingRevision,
		bearerToken,
	});
}

interface MutableSmokeBudget {
	requests: number;
	readonly currentRunRequestRefs: Set<string>;
	lastAdmission: {
		readonly requestRef: string;
		readonly wireRequestBytes: number;
		readonly maxOutputTokens: number;
	} | null;
	reservedInputTokens: number;
	reservedOutputTokens: number;
	reservedCostMicrousd: number;
	pendingReservedInputTokens: number;
	pendingReservedOutputTokens: number;
	pendingReservedCostMicrousd: number;
	unknownProviderUsageRequests: number;
	providerCostMicrousd: number;
	latencyMs: number;
	exhausted: boolean;
	admissionRejection: B112SmokeAdmissionRejectionV1 | null;
}

export interface OpenRouterFirstTaskRetryWaitCapabilityV1 {
	wait(input: { readonly delayMs: number; readonly signal: AbortSignal }): Promise<void>;
}

const B112_OPENROUTER_MAX_ATTEMPTS_PER_TURN = 3;
const B112_OPENROUTER_RETRY_FALLBACK_MS = Object.freeze([5_000, 10_000] as const);
const B112_OPENROUTER_REQUEST_SOCKET_ISSUE_CODES = Object.freeze([
	"openrouter-transport-cause:und-err-socket",
	"openrouter-transport-phase:request",
	"openrouter-unavailable-transport",
] as const);

function isExactRequestSocketFailure(issueCodes: readonly string[]): boolean {
	return (
		issueCodes.length === B112_OPENROUTER_REQUEST_SOCKET_ISSUE_CODES.length &&
		B112_OPENROUTER_REQUEST_SOCKET_ISSUE_CODES.every((issueCode) => issueCodes.includes(issueCode))
	);
}

function retryAfterMsFromIssues(issueCodes: readonly string[]): number | null {
	const prefix = "openrouter-retry-after-ms:";
	const encoded = issueCodes.find((issueCode) => issueCode.startsWith(prefix));
	if (encoded === undefined) return null;
	const value = Number(encoded.slice(prefix.length));
	return Number.isSafeInteger(value) && value >= 1 && value <= 600_000 ? value : null;
}

function createOpenRouterRetryCapability(
	route: OpenRouterRouteQualificationV1,
	ceilings: MatchedBlockBudgetCeilings,
	ledger: MutableSmokeBudget,
	waitCapability: OpenRouterFirstTaskRetryWaitCapabilityV1,
	monotonicMeasurement: OpenRouterResponsesMonotonicMeasurementV1,
	blockStartedAtMs: number,
	runStartedAtMs: number,
	maxRunElapsedMs: number,
	untypedHttp429RetryPolicy: D710UntypedHttp429RetryPolicyV1 | null,
	graphNativeEvalAuthority: D719GraphNativeEvalAuthorityV1 | null,
): ClosedTaskProfileHostRetryCapabilityV1 {
	if (untypedHttp429RetryPolicy !== null) {
		assertD710UntypedHttp429RetryRoute(untypedHttp429RetryPolicy, route);
	}
	const waitDescriptor = Object.getOwnPropertyDescriptor(waitCapability, "wait");
	if (
		waitDescriptor === undefined ||
		"get" in waitDescriptor ||
		"set" in waitDescriptor ||
		typeof waitDescriptor.value !== "function"
	) {
		throw new TypeError("B112 retry wait must be an explicit own function capability");
	}
	const wait = waitDescriptor.value as OpenRouterFirstTaskRetryWaitCapabilityV1["wait"];
	const readMsDescriptor = Object.getOwnPropertyDescriptor(monotonicMeasurement, "readMs");
	if (
		readMsDescriptor === undefined ||
		"get" in readMsDescriptor ||
		"set" in readMsDescriptor ||
		typeof readMsDescriptor.value !== "function"
	) {
		throw new TypeError("B112 monotonic measurement must be an explicit own function capability");
	}
	const readMs = readMsDescriptor.value as OpenRouterResponsesMonotonicMeasurementV1["readMs"];
	let lastMonotonicMs = Math.max(blockStartedAtMs, runStartedAtMs);
	const readMonotonicMs = (): number => {
		const current = safeInteger(readMs(), "smoke.monotonicMs", { min: 0 });
		if (current < lastMonotonicMs) {
			throw new TypeError("B112 monotonic measurement moved backwards");
		}
		lastMonotonicMs = current;
		return current;
	};
	const remainingElapsedMs = (): number => {
		const current = readMonotonicMs();
		return Math.max(
			0,
			Math.min(
				ceilings.maxLatencyMs - (current - blockStartedAtMs),
				maxRunElapsedMs - (current - runStartedAtMs),
				ceilings.maxLatencyMs - ledger.latencyMs,
			),
		);
	};
	let d710RetryConsumed = false;
	return Object.freeze({
		maxAttemptsPerTurn: B112_OPENROUTER_MAX_ATTEMPTS_PER_TURN,
		retryDelayMs(outcome: EmpiricalModelTurnOutcomeV1, attemptOrdinal: number): number | null {
			if (outcome.status !== "non-evaluable") return null;
			if (attemptOrdinal === 1) d710RetryConsumed = false;
			if (d710RetryConsumed) return null;
			const untyped429Delay =
				untypedHttp429RetryPolicy === null
					? null
					: d710UntypedHttp429RetryDelayMs(outcome, attemptOrdinal);
			if (untyped429Delay !== null) {
				d710RetryConsumed = true;
				return untyped429Delay;
			}
			const retryableRequestSocket =
				attemptOrdinal === 1 && isExactRequestSocketFailure(outcome.issueCodes);
			const retryable429 =
				outcome.issueCodes.includes("openrouter-http-status:429") &&
				outcome.issueCodes.includes("openrouter-error-type:rate_limit_exceeded");
			const retryable503 =
				outcome.issueCodes.includes("openrouter-http-status:503") &&
				outcome.issueCodes.includes("openrouter-error-type:provider_overloaded");
			if (!retryableRequestSocket && !retryable429 && !retryable503) return null;
			const fallback =
				B112_OPENROUTER_RETRY_FALLBACK_MS[
					Math.min(attemptOrdinal - 1, B112_OPENROUTER_RETRY_FALLBACK_MS.length - 1)
				];
			if (fallback === undefined) throw new TypeError("B112 retry fallback is incomplete");
			return Math.max(fallback, retryAfterMsFromIssues(outcome.issueCodes) ?? 0);
		},
		retryAdmissionIssueCodes(): readonly string[] {
			const lastAdmission = ledger.lastAdmission;
			if (lastAdmission === null) {
				throw new TypeError("B112 retry has no exact prior transport admission");
			}
			const evaluation = evaluateSmokeTransportAdmission(
				route,
				ceilings,
				ledger,
				lastAdmission,
				graphNativeEvalAuthority,
				"retry-admission",
			);
			if (evaluation.reasons.length === 0) return [];
			recordSmokeAdmissionRejection(route, ceilings, ledger, lastAdmission, evaluation);
			return [B112_SMOKE_BUDGET_ISSUE_CODE];
		},
		remainingElapsedMs,
		async wait(input: { readonly delayMs: number; readonly signal: AbortSignal }): Promise<number> {
			const startedAtMs = readMonotonicMs();
			await wait({ delayMs: input.delayMs, signal: input.signal });
			const elapsedMs = readMonotonicMs() - startedAtMs;
			if (elapsedMs < input.delayMs) {
				throw new TypeError("B112 retry wait completed before its scheduled floor");
			}
			ledger.latencyMs += elapsedMs;
			if (graphNativeEvalAuthority !== null) {
				const requestRef = ledger.lastAdmission?.requestRef;
				if (requestRef === undefined) {
					throw new TypeError("D719 retry wait omitted its admitted request");
				}
				const decision = decideD719GraphNativeBudget(graphNativeEvalAuthority, {
					kind: "retry-wait",
					requestRef,
					waitedMs: elapsedMs,
					state: d719BudgetStateFact(ledger, requestRef),
					limits: d719BudgetLimitsFact(route, ceilings),
				});
				if (decision.exhausted) ledger.exhausted = true;
			}
			return elapsedMs;
		},
	});
}

function budgetExhaustedOutcome(
	request: EmpiricalModelTurnRequestV1,
	protectionExecutor: ClosedTaskProfileHostRunInputV1["protectionExecutor"],
	usage: EmpiricalModelTurnOutcomeV1["usage"] = {
		source: request.usageSource,
		inputTokens: null,
		outputTokens: null,
		totalTokens: null,
		providerCostMicrousd: null,
		requests: 0,
		hostInputBytes: 0,
		hostOutputBytes: 0,
	},
	latencyMs = 0,
	evidenceRefs: readonly EmpiricalModelTurnEvidenceRefV1[] = [],
): EmpiricalModelTurnOutcomeV1 {
	const issueCodes = [B112_SMOKE_BUDGET_ISSUE_CODE];
	const protectedSubject = strictJsonCodec.decode(
		strictJsonCodec.encode({
			evidenceRefs,
			issueCodes,
			structuredOutput: null,
			toolIntents: [],
		}),
	) as StrictJsonValue;
	const protectionReceipt = executeEmpiricalProtection(protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "model-egress",
		subject: protectedSubject,
	}).receipt;
	return strictSnapshot({
		schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.outcome,
		requestRef: request.requestRef,
		requestDigest: empiricalStrictJsonDigest(request),
		configurationRef: request.configurationRef,
		configurationDigest: request.configurationDigest,
		role: request.role,
		status: "non-evaluable" as const,
		finishReason: null,
		outputSchemaDigest: request.outputSchema.schemaDigest,
		structuredOutput: null,
		structuredOutputDigest: null,
		toolIntents: [],
		usage,
		latencyMs,
		issueCodes,
		evidenceRefs,
		protectionReceipt,
	});
}

function createBudgetedModelTurnPort(
	delegate: EmpiricalModelTurnPortV1,
	route: OpenRouterRouteQualificationV1,
	ceilings: MatchedBlockBudgetCeilings,
	protectionExecutor: ClosedTaskProfileHostRunInputV1["protectionExecutor"],
	ledger: MutableSmokeBudget,
	graphNativeEvalAuthority: D719GraphNativeEvalAuthorityV1 | null,
): EmpiricalModelTurnPortV1 {
	return Object.freeze({
		async invoke(request: EmpiricalModelTurnRequestV1, signal: AbortSignal) {
			const outcome = await delegate.invoke(request, signal);
			return observeBudgetedModelTurnOutcome(
				request,
				outcome,
				route,
				ceilings,
				protectionExecutor,
				ledger,
				graphNativeEvalAuthority,
			);
		},
	});
}

function createBudgetedContinuationModelTurnPort(
	delegate: ClosedContinuationModelTurnPortV1,
	route: OpenRouterRouteQualificationV1,
	ceilings: MatchedBlockBudgetCeilings,
	protectionExecutor: ClosedTaskProfileHostRunInputV1["protectionExecutor"],
	ledger: MutableSmokeBudget,
	invocations: OpenRouterContinuationInvocationFactV1[],
	graphNativeEvalAuthority: D719GraphNativeEvalAuthorityV1 | null,
): ClosedContinuationModelTurnPortV1 {
	const attemptOrdinals = new Map<string, number>();
	return Object.freeze({
		async invoke(
			request: EmpiricalModelTurnRequestV1,
			continuation: Parameters<ClosedContinuationModelTurnPortV1["invoke"]>[1],
			signal: AbortSignal,
		) {
			if (invocations.length >= route.budget.maxRequests) {
				throw new TypeError("OpenRouter continuation invocation evidence bound exhausted");
			}
			const requestDigest = empiricalStrictJsonDigest(request);
			const attemptKey = `${request.trialStage}\u0000${request.stepIndex}\u0000${requestDigest}`;
			const attemptOrdinal = (attemptOrdinals.get(attemptKey) ?? 0) + 1;
			attemptOrdinals.set(attemptKey, attemptOrdinal);
			const outcome = await delegate.invoke(request, continuation, signal);
			invocations.push(
				strictSnapshot({
					trialStage: request.trialStage,
					stepIndex: request.stepIndex,
					attemptOrdinal,
					requestDigest,
					continuationDigest: empiricalStrictJsonDigest(continuation),
					requiredDisposition: continuation.requiredDisposition,
					providerRequestCount: outcome.usage.requests,
				}),
			);
			return observeBudgetedModelTurnOutcome(
				request,
				outcome,
				route,
				ceilings,
				protectionExecutor,
				ledger,
				graphNativeEvalAuthority,
			);
		},
	});
}

function createBudgetedMutationFirstContinuationModelTurnPort(
	delegate: ClosedMutationFirstContinuationModelTurnPortV1,
	route: OpenRouterRouteQualificationV1,
	ceilings: MatchedBlockBudgetCeilings,
	protectionExecutor: ClosedTaskProfileHostRunInputV1["protectionExecutor"],
	ledger: MutableSmokeBudget,
	invocations: OpenRouterMutationFirstInvocationFactV1[],
	graphNativeEvalAuthority: D719GraphNativeEvalAuthorityV1 | null,
): ClosedMutationFirstContinuationModelTurnPortV1 {
	const attemptOrdinals = new Map<string, number>();
	return Object.freeze({
		async invoke(
			request: EmpiricalModelTurnRequestV1,
			continuation: Parameters<ClosedMutationFirstContinuationModelTurnPortV1["invoke"]>[1],
			signal: AbortSignal,
		) {
			if (invocations.length >= route.budget.maxRequests) {
				throw new TypeError("OpenRouter mutation-first invocation evidence bound exhausted");
			}
			const requestDigest = empiricalStrictJsonDigest(request);
			const attemptKey = `${request.trialStage}\u0000${request.stepIndex}\u0000${requestDigest}`;
			const attemptOrdinal = (attemptOrdinals.get(attemptKey) ?? 0) + 1;
			attemptOrdinals.set(attemptKey, attemptOrdinal);
			const outcome = await delegate.invoke(request, continuation, signal);
			invocations.push(
				strictSnapshot({
					trialStage: request.trialStage,
					stepIndex: request.stepIndex,
					attemptOrdinal,
					requestDigest,
					continuationDigest: empiricalStrictJsonDigest(continuation),
					staleResultReceiptDigest: continuation.staleResultReceiptDigest,
					requiredFirstToolRef: continuation.requiredFirstToolRef,
					providerRequestCount: outcome.usage.requests,
				}),
			);
			return observeBudgetedModelTurnOutcome(
				request,
				outcome,
				route,
				ceilings,
				protectionExecutor,
				ledger,
				graphNativeEvalAuthority,
			);
		},
	});
}

function observeBudgetedModelTurnOutcome(
	request: EmpiricalModelTurnRequestV1,
	outcome: EmpiricalModelTurnOutcomeV1,
	route: OpenRouterRouteQualificationV1,
	ceilings: MatchedBlockBudgetCeilings,
	protectionExecutor: ClosedTaskProfileHostRunInputV1["protectionExecutor"],
	ledger: MutableSmokeBudget,
	graphNativeEvalAuthority: D719GraphNativeEvalAuthorityV1 | null,
): EmpiricalModelTurnOutcomeV1 {
	if (
		ledger.exhausted &&
		outcome.issueCodes.includes(OPENROUTER_RESPONSES_ISSUE_CODES.transportAdmissionRejected)
	) {
		return budgetExhaustedOutcome(request, protectionExecutor);
	}
	const hasPendingReservation =
		ledger.pendingReservedInputTokens > 0 || ledger.pendingReservedOutputTokens > 0;
	if (
		hasPendingReservation &&
		outcome.usage.inputTokens !== null &&
		outcome.usage.outputTokens !== null &&
		outcome.usage.providerCostMicrousd !== null
	) {
		ledger.reservedInputTokens =
			ledger.reservedInputTokens - ledger.pendingReservedInputTokens + outcome.usage.inputTokens;
		ledger.reservedOutputTokens =
			ledger.reservedOutputTokens - ledger.pendingReservedOutputTokens + outcome.usage.outputTokens;
		ledger.reservedCostMicrousd =
			ledger.reservedCostMicrousd -
			ledger.pendingReservedCostMicrousd +
			outcome.usage.providerCostMicrousd;
		ledger.providerCostMicrousd += outcome.usage.providerCostMicrousd;
	} else if (hasPendingReservation) {
		ledger.unknownProviderUsageRequests += 1;
	}
	ledger.pendingReservedInputTokens = 0;
	ledger.pendingReservedOutputTokens = 0;
	ledger.pendingReservedCostMicrousd = 0;
	ledger.latencyMs += outcome.latencyMs;
	const graphDecision =
		graphNativeEvalAuthority === null
			? null
			: decideD719GraphNativeBudget(graphNativeEvalAuthority, {
					kind: "outcome-reconciliation",
					requestRef: request.requestRef,
					state: d719BudgetStateFact(ledger, request.requestRef),
					limits: d719BudgetLimitsFact(route, ceilings),
				});
	const exhausted =
		graphDecision?.exhausted ??
		(ledger.latencyMs > ceilings.maxLatencyMs ||
			ledger.reservedInputTokens > route.budget.maxInputTokens ||
			ledger.reservedOutputTokens > route.budget.maxOutputTokens ||
			ledger.reservedCostMicrousd > ceilings.maxCostMicrousd);
	if (exhausted) {
		ledger.exhausted = true;
		return budgetExhaustedOutcome(
			request,
			protectionExecutor,
			outcome.usage,
			outcome.latencyMs,
			outcome.evidenceRefs,
		);
	}
	return outcome;
}

function createSmokeTransportAdmission(
	route: OpenRouterRouteQualificationV1,
	ceilings: MatchedBlockBudgetCeilings,
	ledger: MutableSmokeBudget,
	graphNativeEvalAuthority: D719GraphNativeEvalAuthorityV1 | null,
): OpenRouterResponsesTransportAdmissionV1 {
	return Object.freeze({
		admit(input: Parameters<OpenRouterResponsesTransportAdmissionV1["admit"]>[0]) {
			const admission = {
				requestRef: input.requestRef,
				wireRequestBytes: safeInteger(input.wireRequestBytes, "smoke.wireRequestBytes", {
					min: 1,
				}),
				maxOutputTokens: safeInteger(input.maxOutputTokens, "smoke.maxOutputTokens", {
					min: 1,
				}),
			};
			const evaluation = evaluateSmokeTransportAdmission(
				route,
				ceilings,
				ledger,
				admission,
				graphNativeEvalAuthority,
			);
			if (evaluation.reasons.length > 0) {
				recordSmokeAdmissionRejection(route, ceilings, ledger, admission, evaluation);
				return false;
			}
			ledger.requests += 1;
			ledger.currentRunRequestRefs.add(admission.requestRef);
			ledger.lastAdmission = Object.freeze(admission);
			ledger.reservedInputTokens = evaluation.prospectiveInputTokens;
			ledger.reservedOutputTokens = evaluation.prospectiveOutputTokens;
			ledger.reservedCostMicrousd = evaluation.prospectiveCostMicrousd;
			ledger.pendingReservedInputTokens = evaluation.reservedInputTokens;
			ledger.pendingReservedOutputTokens = admission.maxOutputTokens;
			ledger.pendingReservedCostMicrousd = evaluation.reservedCostMicrousd;
			return true;
		},
	});
}

interface SmokeTransportAdmissionInput {
	readonly requestRef: string;
	readonly wireRequestBytes: number;
	readonly maxOutputTokens: number;
}

interface MatchedBlockBudgetCeilings {
	readonly maxRequests: number;
	readonly maxCostMicrousd: number;
	readonly maxLatencyMs: number;
	readonly enforceElapsedAdmission: boolean;
}

function d719BudgetStateFact(
	ledger: MutableSmokeBudget,
	requestRef: string,
): D719BudgetStateFactV1 {
	return Object.freeze({
		requests: ledger.requests,
		currentRunRequestCount: ledger.currentRunRequestRefs.size,
		requestAlreadySeen: ledger.currentRunRequestRefs.has(requestRef),
		pendingReservation:
			ledger.pendingReservedInputTokens > 0 || ledger.pendingReservedOutputTokens > 0,
		reservedInputTokens: ledger.reservedInputTokens,
		reservedOutputTokens: ledger.reservedOutputTokens,
		reservedCostMicrousd: ledger.reservedCostMicrousd,
		latencyMs: ledger.latencyMs,
	});
}

function d719BudgetLimitsFact(
	route: OpenRouterRouteQualificationV1,
	ceilings: MatchedBlockBudgetCeilings,
): D719BudgetLimitsFactV1 {
	return Object.freeze({
		maxRequests: ceilings.maxRequests,
		maxStepsPerRun: route.budget.maxStepsPerRun,
		maxCanonicalRequestBytes: route.budget.maxCanonicalRequestBytes,
		maxInputTokens: route.budget.maxInputTokens,
		maxOutputTokens: route.budget.maxOutputTokens,
		maxCostMicrousd: ceilings.maxCostMicrousd,
		maxLatencyMs: ceilings.maxLatencyMs,
		enforceElapsedAdmission: ceilings.enforceElapsedAdmission,
	});
}

interface SmokeTransportAdmissionEvaluation {
	readonly reasons: readonly B112SmokeAdmissionRejectionReason[];
	readonly reservedInputTokens: number;
	readonly reservedCostMicrousd: number;
	readonly prospectiveInputTokens: number;
	readonly prospectiveOutputTokens: number;
	readonly prospectiveCostMicrousd: number;
}

function evaluateSmokeTransportAdmission(
	route: OpenRouterRouteQualificationV1,
	ceilings: MatchedBlockBudgetCeilings,
	ledger: MutableSmokeBudget,
	input: SmokeTransportAdmissionInput,
	graphNativeEvalAuthority: D719GraphNativeEvalAuthorityV1 | null = null,
	decisionKind: "transport-admission" | "retry-admission" = "transport-admission",
): SmokeTransportAdmissionEvaluation {
	const reservedInputTokens =
		input.wireRequestBytes * route.budget.inputTokensPerCanonicalByteUpperBound +
		route.budget.fixedInputTokenOverheadPerRequest;
	const prospectiveInputTokens = ledger.reservedInputTokens + reservedInputTokens;
	const prospectiveOutputTokens = ledger.reservedOutputTokens + input.maxOutputTokens;
	const reservedCostMicrousd = calculateOpenRouterCostMicrousd(
		reservedInputTokens,
		input.maxOutputTokens,
		route.pricing,
	);
	const prospectiveCostMicrousd = ledger.reservedCostMicrousd + reservedCostMicrousd;
	if (graphNativeEvalAuthority !== null) {
		const decision = decideD719GraphNativeBudget(graphNativeEvalAuthority, {
			kind: decisionKind,
			requestRef: input.requestRef,
			wireRequestBytes: input.wireRequestBytes,
			maxOutputTokens: input.maxOutputTokens,
			reservedInputTokens,
			reservedCostMicrousd,
			prospectiveInputTokens,
			prospectiveOutputTokens,
			prospectiveCostMicrousd,
			state: d719BudgetStateFact(ledger, input.requestRef),
			limits: d719BudgetLimitsFact(route, ceilings),
		});
		return Object.freeze({
			reasons: decision.reasons as readonly B112SmokeAdmissionRejectionReason[],
			reservedInputTokens,
			reservedCostMicrousd,
			prospectiveInputTokens,
			prospectiveOutputTokens,
			prospectiveCostMicrousd,
		});
	}
	const reasons: B112SmokeAdmissionRejectionReason[] = [];
	if (ledger.pendingReservedInputTokens > 0 || ledger.pendingReservedOutputTokens > 0) {
		reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.pendingReservation);
	}
	if (ledger.requests >= ceilings.maxRequests) {
		reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.requestLimit);
	}
	if (
		!ledger.currentRunRequestRefs.has(input.requestRef) &&
		ledger.currentRunRequestRefs.size >= route.budget.maxStepsPerRun
	) {
		reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.stepLimit);
	}
	if (input.wireRequestBytes > route.budget.maxCanonicalRequestBytes) {
		reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.canonicalRequestBytes);
	}
	if (prospectiveInputTokens > route.budget.maxInputTokens) {
		reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.inputTokenReservation);
	}
	if (prospectiveOutputTokens > route.budget.maxOutputTokens) {
		reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.outputTokenReservation);
	}
	if (prospectiveCostMicrousd > ceilings.maxCostMicrousd) {
		reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.costReservation);
	}
	if (ceilings.enforceElapsedAdmission && ledger.latencyMs >= ceilings.maxLatencyMs) {
		reasons.push(B112_CALIBRATION_ELAPSED_ADMISSION_REJECTION_REASON);
	}
	return Object.freeze({
		reasons: Object.freeze(reasons),
		reservedInputTokens,
		reservedCostMicrousd,
		prospectiveInputTokens,
		prospectiveOutputTokens,
		prospectiveCostMicrousd,
	});
}

function recordSmokeAdmissionRejection(
	route: OpenRouterRouteQualificationV1,
	ceilings: MatchedBlockBudgetCeilings,
	ledger: MutableSmokeBudget,
	input: SmokeTransportAdmissionInput,
	evaluation: SmokeTransportAdmissionEvaluation,
): void {
	ledger.exhausted = true;
	ledger.admissionRejection = strictSnapshot({
		schemaVersion: B112_SMOKE_ADMISSION_REJECTION_SCHEMA,
		requestRef: input.requestRef,
		reasons: evaluation.reasons,
		requests: ledger.requests,
		maxRequests: ceilings.maxRequests,
		maxStepsPerRun: route.budget.maxStepsPerRun,
		wireRequestBytes: input.wireRequestBytes,
		maxCanonicalRequestBytes: route.budget.maxCanonicalRequestBytes,
		reservedInputTokens: ledger.reservedInputTokens,
		prospectiveInputTokens: evaluation.prospectiveInputTokens,
		maxInputTokens: route.budget.maxInputTokens,
		reservedOutputTokens: ledger.reservedOutputTokens,
		prospectiveOutputTokens: evaluation.prospectiveOutputTokens,
		maxOutputTokens: route.budget.maxOutputTokens,
		reservedCostMicrousd: ledger.reservedCostMicrousd,
		prospectiveCostMicrousd: evaluation.prospectiveCostMicrousd,
		maxSmokeSpendMicrousd: ceilings.maxCostMicrousd,
	});
}

interface SmokeBudgetSnapshot {
	readonly requests: number;
	readonly reservedInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly reservedCostMicrousd: number;
	readonly providerCostMicrousd: number;
	readonly unknownProviderUsageRequests: number;
	readonly latencyMs: number;
}

function smokeBudgetSnapshot(ledger: MutableSmokeBudget): SmokeBudgetSnapshot {
	return Object.freeze({
		requests: ledger.requests,
		reservedInputTokens: ledger.reservedInputTokens,
		reservedOutputTokens: ledger.reservedOutputTokens,
		reservedCostMicrousd: ledger.reservedCostMicrousd,
		providerCostMicrousd: ledger.providerCostMicrousd,
		unknownProviderUsageRequests: ledger.unknownProviderUsageRequests,
		latencyMs: ledger.latencyMs,
	});
}

function runCostLedger(
	before: SmokeBudgetSnapshot,
	after: SmokeBudgetSnapshot,
	executionClass: "simulated-contract" | "live-provider",
): EmpiricalSmokeCostLedgerV1 {
	const requests = after.requests - before.requests;
	const reservedInputTokens = after.reservedInputTokens - before.reservedInputTokens;
	const reservedOutputTokens = after.reservedOutputTokens - before.reservedOutputTokens;
	const providerCostMicrousd = after.providerCostMicrousd - before.providerCostMicrousd;
	const reservedCostMicrousd = after.reservedCostMicrousd - before.reservedCostMicrousd;
	const providerUsageKnown =
		requests > 0 && after.unknownProviderUsageRequests === before.unknownProviderUsageRequests;
	return Object.freeze({
		costBasis:
			executionClass === "simulated-contract"
				? "simulated-contract"
				: providerUsageKnown
					? "provider-usage"
					: "conservative-reservation",
		reservedInputTokens,
		reservedOutputTokens,
		costMicrousd:
			executionClass === "simulated-contract"
				? 0
				: providerUsageKnown
					? providerCostMicrousd
					: reservedCostMicrousd,
	});
}

function createPerRunSignal(
	signal: AbortSignal,
	maxElapsedMs: number,
): {
	readonly signal: AbortSignal;
	readonly elapsedSignal: AbortSignal;
} {
	const elapsedSignal = AbortSignal.timeout(maxElapsedMs);
	return Object.freeze({ signal: AbortSignal.any([signal, elapsedSignal]), elapsedSignal });
}

function createWarmInitialRequest(input: {
	readonly cold: EmpiricalModelTurnRequestV1;
	readonly runIndex: number;
	readonly branchKind: NonNullable<
		ReturnType<typeof prepareB112MatchedBlockReflection>["branches"][number]
	>["branchKind"];
	readonly actorMemoryContext: {
		readonly recordDigest: string;
		readonly text: string;
	} | null;
	readonly protectionExecutor: ClosedTaskProfileHostRunInputV1["protectionExecutor"];
	readonly host: Omit<
		ClosedTaskProfileHostRunInputV1,
		"modelTurnPort" | "protectionExecutor" | "signal"
	>;
}): EmpiricalModelTurnRequestV1 {
	const baseInput = input.cold.structuredInput;
	if (baseInput === null || typeof baseInput !== "object" || Array.isArray(baseInput)) {
		throw new TypeError("B112 matched warm input requires the frozen structured object input");
	}
	const structuredInput = strictSnapshot({
		...baseInput,
		...(input.actorMemoryContext === null
			? {}
			: {
					memoryContext: {
						kind: "agentic-memory-context",
						revision: B112_MATCHED_BLOCK_MEMORY_REVISION,
						recordDigest: input.actorMemoryContext.recordDigest,
						text: input.actorMemoryContext.text,
					},
				}),
	});
	const inputProtectionReceipt = executeEmpiricalProtection(input.protectionExecutor, {
		policyRef: input.cold.protectionPolicyRef,
		policyRevision: input.cold.protectionPolicyRevision,
		stage: "source-ingress",
		subject: structuredInput,
	}).receipt;
	return validateEmpiricalModelTurnRequest(
		{
			...input.cold,
			requestRef: `b112-first-task-live-smoke-run-${input.runIndex}-request-1`,
			trialStage: input.branchKind,
			stepIndex: 0,
			structuredInput,
			structuredInputDigest: empiricalStrictJsonDigest(structuredInput),
			inputProtectionReceipt,
			priorToolResults: [],
		},
		input.host.frozen,
		input.host.qualificationReport,
	);
}

const D716_INSPECTION_TOOL_REFS = new Set<string>([
	CLOSED_ACTOR_TOOL_REFS.readFile,
	CLOSED_ACTOR_TOOL_REFS.searchLiteral,
	CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
]);

function d716CompletionFact(input: {
	readonly request: ReturnType<typeof takeNextD716GraphNativeArmRequest>;
	readonly outcome: ClosedTaskProfileHostRunOutcomeV3 | null;
	readonly costLedger: EmpiricalSmokeCostLedgerV1 | null;
	readonly stoppedReason: D716ArmCompletionFact["stoppedReason"];
	readonly classifyD717HostBudgetExhaustion: boolean;
}): D716ArmCompletionFact {
	const coordinates = input.request.input?.value;
	if (coordinates === undefined || coordinates.authority !== "D716") {
		throw new TypeError("D716 issued request omitted exact graph coordinates");
	}
	const actionTrace = input.outcome?.actionTrace ?? [];
	let lastMutationIndex = -1;
	for (let index = 0; index < actionTrace.length; index += 1) {
		if (actionTrace[index]?.toolRef === CLOSED_ACTOR_TOOL_REFS.replaceExact) {
			lastMutationIndex = index;
		}
	}
	const diffAfterLatestMutation =
		lastMutationIndex >= 0 &&
		actionTrace
			.slice(lastMutationIndex + 1)
			.some((action) => action.toolRef === CLOSED_ACTOR_TOOL_REFS.workspaceDiff);
	const focusedValidationAttempted =
		diffAfterLatestMutation &&
		actionTrace
			.slice(lastMutationIndex + 1)
			.some((action) => action.toolRef === CLOSED_ACTOR_TOOL_REFS.runCommand);
	const hiddenVerifierAttempted = input.outcome?.verifierVerdict !== null && input.outcome !== null;
	const stoppedReason =
		input.stoppedReason === null &&
		input.classifyD717HostBudgetExhaustion &&
		input.outcome?.issueCodes.some((issueCode) => issueCode.endsWith("-budget-exhausted"))
			? ("budget-exhausted" as const)
			: input.stoppedReason;
	return strictSnapshot({
		arm: coordinates.arm,
		sequence: coordinates.sequence,
		workItemId: `d716-arm-${coordinates.arm}`,
		executionInputRevision: coordinates.sequence + 1,
		issuedRequestDigest: empiricalStrictJsonDigest(input.request),
		traceComplete: input.outcome?.cleanupSucceeded ?? true,
		inspectionObserved: actionTrace.some((action) => D716_INSPECTION_TOOL_REFS.has(action.toolRef)),
		contentChangingMutationObserved: lastMutationIndex >= 0,
		nonEmptyDiffAfterLatestMutation: diffAfterLatestMutation,
		focusedValidationAttempted,
		focusedValidationPassed: hiddenVerifierAttempted,
		hiddenVerifierAttempted,
		hiddenVerifierPassed: input.outcome?.verifierVerdict === "passed",
		requests: input.outcome?.remoteRequests ?? 0,
		costMicrousd: input.costLedger?.costMicrousd ?? 0,
		elapsedMs:
			(input.outcome?.turnEvidence.reduce((sum, turn) => sum + turn.latencyMs, 0) ?? 0) +
			(input.outcome?.retryWaitMs ?? 0),
		stoppedReason,
	});
}

export interface OpenRouterFirstTaskWarmHostFactoryInputV1 {
	readonly initialRequest: EmpiricalModelTurnRequestV1;
	readonly signal: AbortSignal;
}

export type OpenRouterFirstTaskWarmHostFactoryV1 = (
	input: OpenRouterFirstTaskWarmHostFactoryInputV1,
) => Promise<ClosedTaskProfileHostRunInputV1["materialization"]>;

export interface OpenRouterMatchedTrialBlockInputV4 {
	readonly host: Omit<
		ClosedTaskProfileHostRunInputV1,
		"modelTurnPort" | "protectionExecutor" | "signal"
	>;
	readonly routeQualification: OpenRouterRouteQualificationV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly monotonicMeasurement: OpenRouterResponsesMonotonicMeasurementV1;
	readonly executionClass: "simulated-contract" | "live-provider";
	readonly signal: AbortSignal;
	readonly retryWait: OpenRouterFirstTaskRetryWaitCapabilityV1;
	readonly prepareWarmHost?: OpenRouterFirstTaskWarmHostFactoryV1;
	readonly historicalReflectionCapability?: D691HistoricalReflectionCapabilityV1;
	readonly untypedHttp429RetryPolicy?: D710UntypedHttp429RetryPolicyV1;
	readonly graphNativeSixArmCoordinator?: D716GraphNativeSixArmCoordinatorV1;
	readonly graphNativeLiveProviderCapability?: D717GraphNativeLiveProviderCapabilityV1;
	readonly graphNativeEvalAuthority?: D719GraphNativeEvalAuthorityV1;
	readonly blockIndex?: 1 | 2 | 3;
	readonly remainingBudget?: B112CalibrationEmpiricalRunInputV4["remainingBudget"];
}

/**
 * Executes one exact frozen matched trial block. Smoke remains first-task-only;
 * calibration additionally binds the scheduled task's one-based block index.
 */
export async function runOpenRouterMatchedTrialBlock(
	inputValue: OpenRouterMatchedTrialBlockInputV4,
): Promise<OpenRouterMatchedTrialBlockResultV4> {
	const request = record(inputValue, "matchedBlock.input");
	const optionalKeys = [
		"blockIndex",
		"graphNativeEvalAuthority",
		"graphNativeLiveProviderCapability",
		"graphNativeSixArmCoordinator",
		"historicalReflectionCapability",
		"prepareWarmHost",
		"remainingBudget",
		"untypedHttp429RetryPolicy",
	].filter((key) => Object.hasOwn(request, key));
	exactKeys(
		request,
		[
			"credential",
			"executionClass",
			"host",
			"monotonicMeasurement",
			"retryWait",
			"routeQualification",
			"signal",
			"transport",
			...optionalKeys,
		],
		"matchedBlock.input",
	);
	const hostRecord = record(request.host, "matchedBlock.input.host");
	if (Object.hasOwn(hostRecord, "continuationModelTurnPort")) {
		throw new TypeError("OpenRouter matched-block runner owns the continuation model-turn port");
	}
	if (Object.hasOwn(hostRecord, "mutationFirstContinuationModelTurnPort")) {
		throw new TypeError(
			"OpenRouter matched-block runner owns the mutation-first continuation model-turn port",
		);
	}
	const noProgressPolicyDescriptor = Object.getOwnPropertyDescriptor(
		hostRecord,
		"noProgressContinuationPolicy",
	);
	if (
		noProgressPolicyDescriptor !== undefined &&
		(!noProgressPolicyDescriptor.enumerable || !("value" in noProgressPolicyDescriptor))
	) {
		throw new TypeError(
			"OpenRouter matched-block no-progress policy must be an own enumerable data property",
		);
	}
	const hasNoProgressContinuationPolicy = noProgressPolicyDescriptor?.value !== undefined;
	const staleRecoveryPolicyDescriptor = Object.getOwnPropertyDescriptor(
		hostRecord,
		"staleResultRecoveryPolicy",
	);
	if (
		staleRecoveryPolicyDescriptor !== undefined &&
		(!staleRecoveryPolicyDescriptor.enumerable || !("value" in staleRecoveryPolicyDescriptor))
	) {
		throw new TypeError(
			"OpenRouter matched-block stale-result recovery policy must be an own enumerable data property",
		);
	}
	const hasStaleResultRecoveryPolicy = staleRecoveryPolicyDescriptor?.value !== undefined;
	const untypedRetryPolicyDescriptor = Object.getOwnPropertyDescriptor(
		request,
		"untypedHttp429RetryPolicy",
	);
	if (
		untypedRetryPolicyDescriptor !== undefined &&
		(!untypedRetryPolicyDescriptor.enumerable || !("value" in untypedRetryPolicyDescriptor))
	) {
		throw new TypeError(
			"OpenRouter matched-block D710 retry policy must be an own enumerable data property",
		);
	}
	const untypedHttp429RetryPolicy =
		untypedRetryPolicyDescriptor === undefined
			? null
			: validateD710UntypedHttp429RetryPolicy(untypedRetryPolicyDescriptor.value);
	const input = request as unknown as OpenRouterMatchedTrialBlockInputV4;
	const graphCoordinatorDescriptor = Object.getOwnPropertyDescriptor(
		request,
		"graphNativeSixArmCoordinator",
	);
	if (
		graphCoordinatorDescriptor !== undefined &&
		(!graphCoordinatorDescriptor.enumerable || !("value" in graphCoordinatorDescriptor))
	) {
		throw new TypeError(
			"OpenRouter matched-block D716 coordinator must be an own enumerable data property",
		);
	}
	const graphNativeSixArmCoordinator = graphCoordinatorDescriptor?.value;
	if (
		graphNativeSixArmCoordinator !== undefined &&
		!isConstructedD716GraphNativeSixArmCoordinator(graphNativeSixArmCoordinator)
	) {
		throw new TypeError("OpenRouter matched-block D716 coordinator is not constructed");
	}
	const graphEvalAuthorityDescriptor = Object.getOwnPropertyDescriptor(
		request,
		"graphNativeEvalAuthority",
	);
	if (
		graphEvalAuthorityDescriptor !== undefined &&
		(!graphEvalAuthorityDescriptor.enumerable || !("value" in graphEvalAuthorityDescriptor))
	) {
		throw new TypeError(
			"OpenRouter matched-block D719 authority must be an own enumerable data property",
		);
	}
	const graphNativeEvalAuthority = graphEvalAuthorityDescriptor?.value;
	if (
		graphNativeEvalAuthority !== undefined &&
		(graphNativeSixArmCoordinator === undefined ||
			!isConstructedD719GraphNativeEvalAuthorityForCoordinator(
				graphNativeEvalAuthority,
				graphNativeSixArmCoordinator,
			))
	) {
		throw new TypeError(
			"OpenRouter matched-block D719 authority does not bind the D716 coordinator",
		);
	}
	const graphLiveCapabilityDescriptor = Object.getOwnPropertyDescriptor(
		request,
		"graphNativeLiveProviderCapability",
	);
	if (
		graphLiveCapabilityDescriptor !== undefined &&
		(!graphLiveCapabilityDescriptor.enumerable || !("value" in graphLiveCapabilityDescriptor))
	) {
		throw new TypeError(
			"OpenRouter matched-block D717 capability must be an own enumerable data property",
		);
	}
	if (graphNativeSixArmCoordinator !== undefined && input.prepareWarmHost === undefined) {
		throw new TypeError("D716 Graph-native integration requires warm materialization");
	}
	let graphNativeLiveProviderQualificationDigest: string | undefined;
	if (graphNativeSixArmCoordinator === undefined) {
		if (graphLiveCapabilityDescriptor !== undefined) {
			throw new TypeError("D717 live capability requires the D716 Graph coordinator");
		}
	} else if (input.executionClass === "live-provider") {
		if (graphLiveCapabilityDescriptor === undefined) {
			throw new TypeError("D717 live-provider Graph integration requires its exact capability");
		}
		graphNativeLiveProviderQualificationDigest = consumeD717GraphNativeLiveProviderCapability(
			graphLiveCapabilityDescriptor.value,
			graphNativeSixArmCoordinator,
		).d716QualificationDigest;
	} else if (graphLiveCapabilityDescriptor !== undefined) {
		throw new TypeError("D717 live capability cannot enter simulated-contract execution");
	}
	const historicalReflectionCapability = input.historicalReflectionCapability;
	if (historicalReflectionCapability !== undefined && input.prepareWarmHost === undefined) {
		throw new TypeError("D691 historical reflection requires a warm host factory");
	}
	const trialPlan = input.host.frozen.manifest.trialPlan;
	if (
		input.host.initialRequest.trialStage !== "cold" ||
		(trialPlan.profile === "smoke" &&
			(input.host.initialRequest.taskRef !== trialPlan.activeTaskRefs[0] ||
				input.blockIndex !== undefined ||
				input.remainingBudget !== undefined)) ||
		(trialPlan.profile === "calibration" &&
			(!trialPlan.activeTaskRefs.includes(input.host.initialRequest.taskRef) ||
				input.blockIndex === undefined ||
				input.remainingBudget === undefined)) ||
		(trialPlan.profile !== "smoke" && trialPlan.profile !== "calibration")
	) {
		throw new TypeError("OpenRouter matched-block runner received invalid frozen coordinates");
	}
	if (
		(input.executionClass === "live-provider") !==
		(input.routeQualification.dispatchMode === "live-approved")
	) {
		throw new TypeError("OpenRouter smoke execution class does not match route dispatch approval");
	}
	const selectedConfiguration = input.host.frozen.manifest.modelConfigurations.find(
		(configuration) =>
			configuration.configurationRef === input.host.initialRequest.configurationRef,
	);
	if (selectedConfiguration === undefined) {
		throw new TypeError("OpenRouter smoke configuration is not frozen");
	}
	assertQualifiedSmokeRoute(
		input.routeQualification,
		selectedConfiguration.settings.reasoning.effort,
		selectedConfiguration.settings.tools.choice,
	);
	if (
		input.routeQualification.campaignRef !== input.host.frozen.manifest.campaignRef ||
		input.routeQualification.manifestDigest !== input.host.frozen.manifestDigest ||
		input.routeQualification.trialBlockRef !== input.host.initialRequest.trialBlockRef ||
		input.routeQualification.trialBlockDigest !== input.host.initialRequest.trialBlockDigest
	) {
		throw new TypeError("OpenRouter smoke route does not qualify this frozen trial block");
	}
	if (trialPlan.profile === "calibration") {
		const expectedTrialBlock = createB112CalibrationTrialBlockIdentity(
			input.host.frozen,
			input.host.initialRequest.taskRef,
			input.blockIndex as 1 | 2 | 3,
		);
		if (
			input.host.initialRequest.trialBlockRef !== expectedTrialBlock.trialBlockRef ||
			input.host.initialRequest.trialBlockDigest !== expectedTrialBlock.trialBlockDigest
		) {
			throw new TypeError("OpenRouter calibration block identity is not its exact scheduled slot");
		}
	}
	const manifestBudgets = input.host.frozen.manifest.budgets;
	if (
		input.routeQualification.budget.maxRequests >
			Math.min(manifestBudgets.campaign.maxRequests, manifestBudgets.taskModel.maxRequests) ||
		input.routeQualification.budget.maxStepsPerRun >
			Math.min(manifestBudgets.agentRun.maxSteps, manifestBudgets.agentRun.maxRequests) ||
		input.routeQualification.budget.maxSmokeSpendMicrousd >
			Math.min(
				manifestBudgets.campaign.maxCostMicrousd,
				manifestBudgets.taskModel.maxCostMicrousd,
			) ||
		input.routeQualification.budget.maxLatencyMs > manifestBudgets.campaign.maxElapsedMs
	) {
		throw new TypeError("OpenRouter route budget exceeds the frozen D652 host budget");
	}
	safeInteger(input.routeQualification.budget.maxLatencyMs, "smoke.maxLatencyMs", {
		min: 1,
	});
	const remainingBudget = input.remainingBudget;
	const requiresAggregateElapsedBoundary =
		historicalReflectionCapability !== undefined || graphNativeSixArmCoordinator !== undefined;
	const ceilings: MatchedBlockBudgetCeilings = Object.freeze({
		enforceElapsedAdmission: remainingBudget !== undefined || requiresAggregateElapsedBoundary,
		maxRequests:
			remainingBudget === undefined
				? input.routeQualification.budget.maxRequests
				: Math.min(
						input.routeQualification.budget.maxRequests,
						safeInteger(remainingBudget.campaignRequests, "calibration.campaignRequests"),
						safeInteger(remainingBudget.taskRequests, "calibration.taskRequests"),
					),
		maxCostMicrousd:
			remainingBudget === undefined
				? input.routeQualification.budget.maxSmokeSpendMicrousd
				: Math.min(
						input.routeQualification.budget.maxSmokeSpendMicrousd,
						safeInteger(remainingBudget.campaignCostMicrousd, "calibration.campaignCostMicrousd"),
						safeInteger(remainingBudget.taskCostMicrousd, "calibration.taskCostMicrousd"),
					),
		maxLatencyMs:
			remainingBudget === undefined
				? input.routeQualification.budget.maxLatencyMs
				: Math.min(
						input.routeQualification.budget.maxLatencyMs,
						safeInteger(remainingBudget.campaignElapsedMs, "calibration.campaignElapsedMs"),
					),
	});
	const aggregateElapsedSignal = requiresAggregateElapsedBoundary
		? AbortSignal.timeout(ceilings.maxLatencyMs)
		: null;
	const blockSignal =
		aggregateElapsedSignal === null
			? input.signal
			: AbortSignal.any([input.signal, aggregateElapsedSignal]);
	const ledger: MutableSmokeBudget = {
		requests: 0,
		currentRunRequestRefs: new Set<string>(),
		lastAdmission: null,
		reservedInputTokens: 0,
		reservedOutputTokens: 0,
		reservedCostMicrousd: 0,
		pendingReservedInputTokens: 0,
		pendingReservedOutputTokens: 0,
		pendingReservedCostMicrousd: 0,
		unknownProviderUsageRequests: 0,
		providerCostMicrousd: 0,
		latencyMs: 0,
		exhausted: false,
		admissionRejection: null,
	};
	const binding = createOpenRouterResponsesEmpiricalBinding({
		frozen: input.host.frozen,
		qualificationReport: input.host.qualificationReport,
		configurationRef: input.host.initialRequest.configurationRef,
		routeQualification: input.routeQualification,
		credential: input.credential,
		transport: input.transport,
		transportAdmission: createSmokeTransportAdmission(
			input.routeQualification,
			ceilings,
			ledger,
			graphNativeEvalAuthority ?? null,
		),
		monotonicMeasurement: input.monotonicMeasurement,
	});
	const route = Object.freeze({
		qualification: input.routeQualification,
		qualificationDigest: binding.routeQualificationDigest,
	});
	const warmBranches: {
		readonly branchKind: (typeof input.host.frozen.manifest.trialPlan.branchOrder)[number];
		readonly lifecycle: NonNullable<typeof reflection>["branches"][number]["lifecycle"] | null;
		readonly run: {
			readonly runRef: string;
			readonly hostOutcome: Awaited<ReturnType<typeof runClosedTaskProfileHost>>;
			readonly costLedger: EmpiricalSmokeCostLedgerV1;
		} | null;
		readonly issueCodes: readonly string[];
	}[] = [];
	const rawReadBlockMonotonicMs = input.monotonicMeasurement.readMs.bind(
		input.monotonicMeasurement,
	);
	const blockStartedAtMs = safeInteger(rawReadBlockMonotonicMs(), "smoke.blockStartedAtMs", {
		min: 0,
	});
	let lastBlockMonotonicMs = blockStartedAtMs;
	const readBlockMonotonicMs = (): number => {
		const current = safeInteger(rawReadBlockMonotonicMs(), "smoke.blockMonotonicMs", {
			min: lastBlockMonotonicMs,
		});
		lastBlockMonotonicMs = current;
		return current;
	};
	const markBlockElapsedExhausted = (deadlineSignalAborted = false): boolean => {
		if (!ceilings.enforceElapsedAdmission) return false;
		const measuredElapsedMs = readBlockMonotonicMs() - blockStartedAtMs;
		const graphDecision =
			graphNativeEvalAuthority === undefined
				? null
				: decideD719GraphNativeBudget(graphNativeEvalAuthority, {
						kind: "elapsed-check",
						requestRef: "block",
						measuredElapsedMs,
						deadlineSignalAborted,
						state: d719BudgetStateFact(ledger, "block"),
						limits: d719BudgetLimitsFact(input.routeQualification, ceilings),
					});
		if (
			!(
				graphDecision?.exhausted ??
				(deadlineSignalAborted || measuredElapsedMs >= ceilings.maxLatencyMs)
			)
		)
			return false;
		ledger.exhausted = true;
		return true;
	};
	const markAggregateElapsedExhausted = (): boolean => {
		return markBlockElapsedExhausted(aggregateElapsedSignal?.aborted ?? false);
	};
	const continuationInvocations: OpenRouterContinuationInvocationFactV1[] = [];
	const mutationFirstInvocations: OpenRouterMutationFirstInvocationFactV1[] = [];
	const d716ColdRequest =
		graphNativeSixArmCoordinator === undefined
			? null
			: takeNextD716GraphNativeArmRequest(graphNativeSixArmCoordinator);
	if (d716ColdRequest !== null && d716ColdRequest.input?.value?.arm !== "cold") {
		throw new TypeError("D716 graph must issue cold as the first arm");
	}
	if (graphNativeEvalAuthority !== undefined && d716ColdRequest !== null) {
		beginD719GraphNativeBudgetArm(graphNativeEvalAuthority, d716ColdRequest);
	}
	ledger.currentRunRequestRefs.clear();
	const coldBudgetBefore = smokeBudgetSnapshot(ledger);
	const coldRunStartedAtMs = safeInteger(readBlockMonotonicMs(), "smoke.coldRunStartedAtMs", {
		min: blockStartedAtMs,
	});
	const coldSignal = createPerRunSignal(
		blockSignal,
		!requiresAggregateElapsedBoundary
			? manifestBudgets.agentRun.maxElapsedMs
			: Math.max(
					1,
					Math.min(
						manifestBudgets.agentRun.maxElapsedMs,
						ceilings.maxLatencyMs - (coldRunStartedAtMs - blockStartedAtMs),
					),
				),
	);
	const outcome = await runClosedTaskProfileHost({
		...input.host,
		modelTurnPort: createBudgetedModelTurnPort(
			binding.modelTurnPort,
			input.routeQualification,
			ceilings,
			binding.protectionExecutor,
			ledger,
			graphNativeEvalAuthority ?? null,
		),
		...(hasNoProgressContinuationPolicy
			? {
					continuationModelTurnPort: createBudgetedContinuationModelTurnPort(
						binding.continuationModelTurnPort,
						input.routeQualification,
						ceilings,
						binding.protectionExecutor,
						ledger,
						continuationInvocations,
						graphNativeEvalAuthority ?? null,
					),
				}
			: {}),
		...(hasStaleResultRecoveryPolicy
			? {
					mutationFirstContinuationModelTurnPort:
						createBudgetedMutationFirstContinuationModelTurnPort(
							binding.mutationFirstContinuationModelTurnPort,
							input.routeQualification,
							ceilings,
							binding.protectionExecutor,
							ledger,
							mutationFirstInvocations,
							graphNativeEvalAuthority ?? null,
						),
				}
			: {}),
		protectionExecutor: binding.protectionExecutor,
		retry: createOpenRouterRetryCapability(
			input.routeQualification,
			ceilings,
			ledger,
			input.retryWait,
			input.monotonicMeasurement,
			blockStartedAtMs,
			coldRunStartedAtMs,
			manifestBudgets.agentRun.maxElapsedMs,
			untypedHttp429RetryPolicy,
			graphNativeEvalAuthority ?? null,
		),
		agentRunElapsedSignal: coldSignal.elapsedSignal,
		signal: coldSignal.signal,
	});
	const coldBudgetAfter = smokeBudgetSnapshot(ledger);
	const coldCostLedger = runCostLedger(coldBudgetBefore, coldBudgetAfter, input.executionClass);
	const coldElapsedExhausted = markBlockElapsedExhausted();
	if (graphNativeSixArmCoordinator !== undefined && d716ColdRequest !== null) {
		recordD716GraphNativeArmCompletion(
			graphNativeSixArmCoordinator,
			d716CompletionFact({
				request: d716ColdRequest,
				outcome,
				costLedger: coldCostLedger,
				stoppedReason:
					(graphNativeEvalAuthority === undefined
						? null
						: d719GraphNativeBudgetStoppedReasonForArm(graphNativeEvalAuthority, "cold")) ??
					(coldElapsedExhausted
						? "budget-exhausted"
						: outcome.cleanupSucceeded
							? null
							: "workspace-cleanup-failed"),
				classifyD717HostBudgetExhaustion: graphNativeLiveProviderQualificationDigest !== undefined,
			}),
		);
		if (graphNativeEvalAuthority !== undefined) {
			endD719GraphNativeBudgetArm(graphNativeEvalAuthority, "cold");
		}
	}
	const rerunEligible = outcome.status === "completed" && outcome.verifierVerdict === "failed";
	const reflection =
		graphNativeSixArmCoordinator !== undefined
			? d716IndependentWarmReflection(graphNativeSixArmCoordinator)
			: rerunEligible && input.prepareWarmHost !== undefined
				? historicalReflectionCapability === undefined
					? prepareB112MatchedBlockReflection({
							coldRequest: input.host.initialRequest,
							coldOutcome: outcome,
						})
					: prepareConstructedD691HistoricalReflection(historicalReflectionCapability, {
							coldRequest: input.host.initialRequest,
							coldOutcome: outcome,
						})
				: null;
	const createObservation = () => {
		const observationInput = {
			frozen: input.host.frozen,
			route,
			cold: {
				runRef: "cold",
				hostOutcome: outcome,
				costLedger: coldCostLedger,
			},
			...(reflection === null
				? {}
				: {
						reflection: {
							evidenceDigest: reflection.evidenceDigest,
							candidateRecordDigests: reflection.candidateRecordDigests,
							issueCodes: reflection.issueCodes,
						},
						warmBranches,
					}),
			executionClass: input.executionClass,
			trialBlockRef: input.host.initialRequest.trialBlockRef,
			trialBlockDigest: input.host.initialRequest.trialBlockDigest,
		};
		return trialPlan.profile === "smoke"
			? createEmpiricalTrialBlockObservation(observationInput)
			: createEmpiricalCalibrationTrialBlockObservation({
					...observationInput,
					taskRef: input.host.initialRequest.taskRef,
					blockIndex: input.blockIndex as 1 | 2 | 3,
				});
	};
	let warmPreparationFailed = false;
	if (reflection !== null && input.prepareWarmHost !== undefined) {
		for (let index = 0; index < reflection.branches.length; index += 1) {
			const branch = reflection.branches[index];
			if (branch === undefined) throw new TypeError("B112 warm branch order is incomplete");
			const d716WarmRequest =
				graphNativeSixArmCoordinator === undefined
					? null
					: takeNextD716GraphNativeArmRequest(graphNativeSixArmCoordinator);
			if (d716WarmRequest !== null && d716WarmRequest.input?.value?.arm !== branch.branchKind) {
				throw new TypeError("D716 graph-issued warm arm order drifted");
			}
			if (graphNativeEvalAuthority !== undefined && d716WarmRequest !== null) {
				beginD719GraphNativeBudgetArm(graphNativeEvalAuthority, d716WarmRequest);
			}
			const completeD716WarmArm = (
				hostOutcome: ClosedTaskProfileHostRunOutcomeV3 | null,
				costLedger: EmpiricalSmokeCostLedgerV1 | null,
				stoppedReason: D716ArmCompletionFact["stoppedReason"],
			) => {
				if (graphNativeSixArmCoordinator === undefined || d716WarmRequest === null) return;
				recordD716GraphNativeArmCompletion(
					graphNativeSixArmCoordinator,
					d716CompletionFact({
						request: d716WarmRequest,
						outcome: hostOutcome,
						costLedger,
						stoppedReason:
							(graphNativeEvalAuthority === undefined
								? null
								: d719GraphNativeBudgetStoppedReasonForArm(
										graphNativeEvalAuthority,
										branch.branchKind,
									)) ?? stoppedReason,
						classifyD717HostBudgetExhaustion:
							graphNativeLiveProviderQualificationDigest !== undefined,
					}),
				);
				if (graphNativeEvalAuthority !== undefined) {
					endD719GraphNativeBudgetArm(graphNativeEvalAuthority, branch.branchKind);
				}
			};
			if (input.signal.aborted) {
				if (graphNativeSixArmCoordinator !== undefined) {
					warmBranches.push({
						branchKind: branch.branchKind,
						lifecycle: null,
						run: null,
						issueCodes: ["host-cancelled", "warm-branch-not-attempted"].sort(),
					});
					completeD716WarmArm(null, null, "cancelled");
					continue;
				}
				throw new DOMException("B112 matched block cancelled between serial arms", "AbortError");
			}
			markBlockElapsedExhausted();
			if (ledger.exhausted) {
				warmBranches.push({
					branchKind: branch.branchKind,
					lifecycle: null,
					run: null,
					issueCodes: [B112_SMOKE_BUDGET_ISSUE_CODE, "warm-branch-not-attempted"].sort(),
				});
				completeD716WarmArm(null, null, "budget-exhausted");
				continue;
			}
			if (warmPreparationFailed) {
				warmBranches.push({
					branchKind: branch.branchKind,
					lifecycle: null,
					run: null,
					issueCodes: ["warm-branch-not-attempted", "warm-host-preparation-failed"].sort(),
				});
				completeD716WarmArm(null, null, "warm-preparation-failed");
				continue;
			}
			const initialRequest = createWarmInitialRequest({
				cold: input.host.initialRequest,
				runIndex: index + 2,
				branchKind: branch.branchKind,
				actorMemoryContext: branch.actorMemoryContext,
				protectionExecutor: binding.protectionExecutor,
				host: input.host,
			});
			let warmMaterialization: Awaited<ReturnType<OpenRouterFirstTaskWarmHostFactoryV1>>;
			try {
				warmMaterialization = await input.prepareWarmHost({
					initialRequest,
					signal: blockSignal,
				});
			} catch {
				if (input.signal.aborted) {
					if (graphNativeSixArmCoordinator !== undefined) {
						warmBranches.push({
							branchKind: branch.branchKind,
							lifecycle: null,
							run: null,
							issueCodes: ["host-cancelled", "warm-branch-not-attempted"].sort(),
						});
						completeD716WarmArm(null, null, "cancelled");
						continue;
					}
					throw new DOMException(
						"B112 matched block cancelled during warm preparation",
						"AbortError",
					);
				}
				if (markAggregateElapsedExhausted()) {
					ledger.exhausted = true;
				} else {
					warmPreparationFailed = true;
				}
				warmBranches.push({
					branchKind: branch.branchKind,
					lifecycle: null,
					run: null,
					issueCodes: ["warm-branch-not-attempted", "warm-host-preparation-failed"].sort(),
				});
				completeD716WarmArm(
					null,
					null,
					ledger.exhausted ? "budget-exhausted" : "warm-preparation-failed",
				);
				continue;
			}
			if (markAggregateElapsedExhausted()) {
				let cleanupSucceeded = true;
				try {
					await warmMaterialization.cleanup();
				} catch {
					cleanupSucceeded = false;
				}
				warmBranches.push({
					branchKind: branch.branchKind,
					lifecycle: null,
					run: null,
					issueCodes: [
						B112_SMOKE_BUDGET_ISSUE_CODE,
						"warm-branch-not-attempted",
						...(cleanupSucceeded ? [] : ["workspace-cleanup-failed"]),
					].sort(),
				});
				completeD716WarmArm(
					null,
					null,
					cleanupSucceeded ? "budget-exhausted" : "workspace-cleanup-failed",
				);
				continue;
			}
			let hostOwnsMaterialization = false;
			let rawWarmOutcome: ClosedTaskProfileHostRunOutcomeV3;
			let budgetBefore: SmokeBudgetSnapshot;
			try {
				const warmRunStartedAtMs = safeInteger(readBlockMonotonicMs(), "smoke.warmRunStartedAtMs", {
					min: blockStartedAtMs,
				});
				const remainingAggregateMs = Math.max(
					1,
					ceilings.maxLatencyMs - (warmRunStartedAtMs - blockStartedAtMs),
				);
				const warmSignal = createPerRunSignal(
					blockSignal,
					!requiresAggregateElapsedBoundary
						? manifestBudgets.agentRun.maxElapsedMs
						: Math.min(manifestBudgets.agentRun.maxElapsedMs, remainingAggregateMs),
				);
				ledger.currentRunRequestRefs.clear();
				budgetBefore = smokeBudgetSnapshot(ledger);
				hostOwnsMaterialization = true;
				rawWarmOutcome = await runClosedTaskProfileHost({
					...input.host,
					initialRequest,
					materialization: warmMaterialization,
					modelTurnPort: createBudgetedModelTurnPort(
						binding.modelTurnPort,
						input.routeQualification,
						ceilings,
						binding.protectionExecutor,
						ledger,
						graphNativeEvalAuthority ?? null,
					),
					...(hasNoProgressContinuationPolicy
						? {
								continuationModelTurnPort: createBudgetedContinuationModelTurnPort(
									binding.continuationModelTurnPort,
									input.routeQualification,
									ceilings,
									binding.protectionExecutor,
									ledger,
									continuationInvocations,
									graphNativeEvalAuthority ?? null,
								),
							}
						: {}),
					...(hasStaleResultRecoveryPolicy
						? {
								mutationFirstContinuationModelTurnPort:
									createBudgetedMutationFirstContinuationModelTurnPort(
										binding.mutationFirstContinuationModelTurnPort,
										input.routeQualification,
										ceilings,
										binding.protectionExecutor,
										ledger,
										mutationFirstInvocations,
										graphNativeEvalAuthority ?? null,
									),
							}
						: {}),
					protectionExecutor: binding.protectionExecutor,
					retry: createOpenRouterRetryCapability(
						input.routeQualification,
						ceilings,
						ledger,
						input.retryWait,
						input.monotonicMeasurement,
						blockStartedAtMs,
						warmRunStartedAtMs,
						manifestBudgets.agentRun.maxElapsedMs,
						untypedHttp429RetryPolicy,
						graphNativeEvalAuthority ?? null,
					),
					agentRunElapsedSignal: warmSignal.elapsedSignal,
					signal: warmSignal.signal,
				});
			} catch (error) {
				if (!hostOwnsMaterialization) {
					try {
						await warmMaterialization.cleanup();
					} catch {
						throw new TypeError("B112 warm workspace cleanup failed before host handoff");
					}
				}
				throw error;
			}
			const budgetAfter = smokeBudgetSnapshot(ledger);
			const elapsedAfterRun = markAggregateElapsedExhausted();
			const warmOutcome = elapsedAfterRun
				? strictSnapshot({
						...rawWarmOutcome,
						status: "non-evaluable" as const,
						finalOutput: null,
						finalOutputDigest: null,
						verifierVerdict: null,
						verifierEvidenceRefs: [],
						issueCodes: Array.from(
							new Set([...rawWarmOutcome.issueCodes, B112_SMOKE_BUDGET_ISSUE_CODE]),
						).sort(),
					})
				: rawWarmOutcome;
			warmBranches.push({
				branchKind: branch.branchKind,
				lifecycle: branch.lifecycle,
				run: {
					runRef: `warm-${index + 1}`,
					hostOutcome: warmOutcome,
					costLedger: runCostLedger(budgetBefore, budgetAfter, input.executionClass),
				},
				issueCodes: canonicalMatchedWarmBranchIssueCodes(
					branch.lifecycle.issueCodes,
					warmOutcome.issueCodes,
				),
			});
			completeD716WarmArm(
				warmOutcome,
				runCostLedger(budgetBefore, budgetAfter, input.executionClass),
				elapsedAfterRun
					? "budget-exhausted"
					: warmOutcome.cleanupSucceeded
						? null
						: "workspace-cleanup-failed",
			);
		}
	}
	const observation = createObservation();
	const graphNativeBudgetEvidence =
		graphNativeEvalAuthority === undefined
			? undefined
			: snapshotD719GraphNativeBudgetEvidence(graphNativeEvalAuthority);
	if (graphNativeBudgetEvidence !== undefined) {
		const admittedTransportRequests = graphNativeBudgetEvidence.decisions.filter(
			(decision) => decision.kind === "transport-admission" && decision.admitted,
		).length;
		if (observation.result.attempts !== admittedTransportRequests) {
			throw new TypeError(
				"D719 legacy observation request count is not the mechanical Graph projection",
			);
		}
		const lastRejectedAdmission = Array.from(graphNativeBudgetEvidence.decisions)
			.reverse()
			.find(
				(decision) =>
					(decision.kind === "transport-admission" || decision.kind === "retry-admission") &&
					!decision.admitted,
			);
		if (
			(lastRejectedAdmission === undefined) !== (ledger.admissionRejection === null) ||
			(lastRejectedAdmission !== undefined &&
				ledger.admissionRejection !== null &&
				lastRejectedAdmission.reasons.join("|") !== ledger.admissionRejection.reasons.join("|"))
		) {
			throw new TypeError("D719 legacy admission rejection is not the mechanical Graph projection");
		}
	}
	return Object.freeze({
		profile: trialPlan.profile,
		observation,
		protectionExecutor: binding.protectionExecutor,
		admissionRejection: ledger.admissionRejection,
		...(hasNoProgressContinuationPolicy
			? { continuationInvocations: strictSnapshot(continuationInvocations) }
			: {}),
		...(hasStaleResultRecoveryPolicy
			? { mutationFirstInvocations: strictSnapshot(mutationFirstInvocations) }
			: {}),
		...(graphNativeSixArmCoordinator === undefined
			? {}
			: {
					graphNativeCoordination: snapshotD716GraphNativeCoordination(
						graphNativeSixArmCoordinator,
					),
					...(graphNativeLiveProviderQualificationDigest === undefined
						? {}
						: { graphNativeLiveProviderQualificationDigest }),
				}),
		...(graphNativeBudgetEvidence === undefined ? {} : { graphNativeBudgetEvidence }),
	}) as OpenRouterMatchedTrialBlockResultV4;
}

export type OpenRouterCalibrationPreparedTrialBlockV4 = Omit<
	OpenRouterMatchedTrialBlockInputV4,
	"blockIndex" | "remainingBudget" | "signal"
>;

export type OpenRouterCalibrationTrialBlockFactoryV4 = (
	input: B112CalibrationEmpiricalRunInputV4,
) => Promise<OpenRouterCalibrationPreparedTrialBlockV4>;

type CalibrationBudgetScope = "block" | "task" | "campaign";

function stricterCalibrationBudgetScope(
	left: CalibrationBudgetScope,
	right: CalibrationBudgetScope,
): CalibrationBudgetScope {
	const rank = { block: 0, task: 1, campaign: 2 } as const;
	return rank[left] >= rank[right] ? left : right;
}

function minimumRequestScope(
	blockLimit: number,
	remaining: B112CalibrationEmpiricalRunInputV4["remainingBudget"],
): CalibrationBudgetScope {
	if (
		remaining.campaignRequests <= remaining.taskRequests &&
		remaining.campaignRequests <= blockLimit
	) {
		return "campaign";
	}
	if (remaining.taskRequests <= blockLimit) return "task";
	return "block";
}

function minimumCostScope(
	blockLimit: number,
	remaining: B112CalibrationEmpiricalRunInputV4["remainingBudget"],
): CalibrationBudgetScope {
	if (
		remaining.campaignCostMicrousd <= remaining.taskCostMicrousd &&
		remaining.campaignCostMicrousd <= blockLimit
	) {
		return "campaign";
	}
	if (remaining.taskCostMicrousd <= blockLimit) return "task";
	return "block";
}

/** Scheduler-owned scope classification; provider/model output cannot select it. */
export function classifyOpenRouterCalibrationBudgetExhaustionScope(input: {
	readonly observation: EmpiricalCalibrationTrialBlockObservationV4;
	readonly admissionRejection: B112SmokeAdmissionRejectionV1 | null;
	readonly remainingBudget: B112CalibrationEmpiricalRunInputV4["remainingBudget"];
	readonly blockBudget: {
		readonly maxRequests: number;
		readonly maxSmokeSpendMicrousd: number;
		readonly maxLatencyMs: number;
	};
}): "none" | CalibrationBudgetScope {
	const hasBudgetIssue = input.observation.issueCodes.some(
		(issueCode) =>
			issueCode.endsWith("-budget-exhausted") || issueCode === B112_SMOKE_BUDGET_ISSUE_CODE,
	);
	if (!hasBudgetIssue) return "none";
	const result = input.observation.result;
	if (
		result.requests >= input.remainingBudget.campaignRequests ||
		result.costMicrousd >= input.remainingBudget.campaignCostMicrousd ||
		result.latencyMs >= input.remainingBudget.campaignElapsedMs
	) {
		return "campaign";
	}
	if (
		result.requests >= input.remainingBudget.taskRequests ||
		result.costMicrousd >= input.remainingBudget.taskCostMicrousd
	) {
		return "task";
	}
	const rejection = input.admissionRejection;
	if (rejection === null) return "block";
	let scope: CalibrationBudgetScope = "block";
	for (const reason of rejection.reasons) {
		if (reason === B112_SMOKE_ADMISSION_REJECTION_REASONS.requestLimit) {
			scope = stricterCalibrationBudgetScope(
				scope,
				minimumRequestScope(input.blockBudget.maxRequests, input.remainingBudget),
			);
		} else if (reason === B112_SMOKE_ADMISSION_REJECTION_REASONS.costReservation) {
			scope = stricterCalibrationBudgetScope(
				scope,
				minimumCostScope(input.blockBudget.maxSmokeSpendMicrousd, input.remainingBudget),
			);
		} else if (reason === B112_CALIBRATION_ELAPSED_ADMISSION_REJECTION_REASON) {
			scope = stricterCalibrationBudgetScope(
				scope,
				input.remainingBudget.campaignElapsedMs <= input.blockBudget.maxLatencyMs
					? "campaign"
					: "block",
			);
		}
	}
	return scope;
}

/**
 * Mechanical package-private bridge from the D677 serial scheduler to the
 * same authoritative matched-block path used by smoke. Remaining campaign
 * and task ceilings are supplied to transport admission before any request.
 */
export function createOpenRouterCalibrationEmpiricalRunner(
	prepareTrialBlock: OpenRouterCalibrationTrialBlockFactoryV4,
): B112CalibrationEmpiricalRunnerV4 {
	if (typeof prepareTrialBlock !== "function") {
		throw new TypeError("OpenRouter calibration requires an explicit trial-block factory");
	}
	return async (scheduled) => {
		const blockIndex = scheduled.blockIndex;
		const remainingBudget = strictSnapshot(scheduled.remainingBudget);
		const signal = scheduled.signal;
		const taskRef = scheduled.task.taskRef;
		const trialBlockRef = scheduled.trialBlockRef;
		const trialBlockDigest = scheduled.trialBlockDigest;
		let preparedValue: unknown;
		try {
			preparedValue = await prepareTrialBlock(scheduled);
		} catch (error) {
			if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
				throw error;
			}
			return createB112CalibrationBlockPreparationFailure(trialBlockRef, trialBlockDigest);
		}
		const prepared = record(
			preparedValue,
			"calibration.preparedTrialBlock",
		) as unknown as OpenRouterCalibrationPreparedTrialBlockV4;
		if (
			prepared.host.initialRequest.trialBlockRef !== trialBlockRef ||
			prepared.host.initialRequest.trialBlockDigest !== trialBlockDigest ||
			prepared.host.initialRequest.taskRef !== taskRef
		) {
			throw new TypeError("OpenRouter calibration factory substituted scheduled coordinates");
		}
		const matched = await runOpenRouterMatchedTrialBlock({
			...prepared,
			blockIndex,
			remainingBudget,
			signal,
		});
		if (matched.profile !== "calibration") {
			throw new TypeError("OpenRouter calibration bridge produced non-calibration evidence");
		}
		const budgetExhaustionScope = classifyOpenRouterCalibrationBudgetExhaustionScope({
			observation: matched.observation,
			admissionRejection: matched.admissionRejection,
			remainingBudget,
			blockBudget: prepared.routeQualification.budget,
		});
		const costAdmissionRejection =
			(budgetExhaustionScope === "task" || budgetExhaustionScope === "campaign") &&
			matched.admissionRejection?.reasons.includes(
				B112_SMOKE_ADMISSION_REJECTION_REASONS.costReservation,
			)
				? matched.admissionRejection
				: null;
		return createB112CalibrationEmpiricalBlockResult({
			observation: matched.observation,
			budgetExhaustionScope,
			costAdmissionRejection,
		});
	};
}

/**
 * Executes exactly the preregistered first task as one cold attempted smoke
 * block, then emits the historical v3 scorecard and atomic generation.
 */
export async function runOpenRouterFirstTaskSmoke(
	inputValue: OpenRouterMatchedTrialBlockInputV4 & {
		readonly privateRoot: string;
		readonly generationRef: string;
	},
): Promise<OpenRouterFirstTaskSmokeResultV3> {
	const input = record(
		inputValue,
		"firstTaskSmoke.input",
	) as unknown as OpenRouterMatchedTrialBlockInputV4 & {
		readonly privateRoot: string;
		readonly generationRef: string;
	};
	if (input.host.frozen.manifest.trialPlan.profile !== "smoke" || input.blockIndex !== undefined) {
		throw new TypeError("OpenRouter first-task smoke wrapper requires the frozen smoke profile");
	}
	const { generationRef, privateRoot, ...matchedInput } = input;
	const matched = await runOpenRouterMatchedTrialBlock(matchedInput);
	if (matched.profile !== "smoke") {
		throw new TypeError("OpenRouter first-task smoke produced a non-smoke observation");
	}
	const observation = matched.observation;
	const scorecard = createEmpiricalCampaignScorecard(
		observation,
		B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION,
	);
	const persistence = await persistPrivateSmokeGeneration({
		privateRoot,
		generationRef,
		observation,
		scorecard,
		protectionExecutor: matched.protectionExecutor,
	});
	return Object.freeze({
		observation,
		scorecard,
		persistence,
		admissionRejection: matched.admissionRejection,
	});
}
