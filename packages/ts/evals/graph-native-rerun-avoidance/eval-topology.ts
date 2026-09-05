import { depBatch, depLatest } from "../../src/ctx/types.js";
import { type Graph, graph } from "../../src/graph/graph.js";
import type { ObserveEvent } from "../../src/graph/inspect.js";
import type { Node } from "../../src/node/node.js";
import { merge } from "../../src/operators/index.js";
import type { AgentRequestIssued, EffectRunResult } from "../../src/orchestration/agent-runtime.js";
import {
	type AdmissionHandoffCandidate,
	type AdmissionHandoffDecision,
	type AdmissionHandoffStatus,
	admissionHandoff,
} from "../../src/patterns/admission-handoff.js";
import {
	type AgenticMemoryRecord,
	type AgenticMemoryRecordAdmissionInput,
	type AgenticMemoryRecordApplicationInput,
	type AgenticMemoryRecordUseDecision,
	type AgenticMemoryRecordUseInput,
	type AgenticMemoryRecordUseRequest,
	agenticMemoryRecordAdmissionBundle,
	agenticMemoryRecordApplicationBundle,
	agenticMemoryRecordFrame,
	agenticMemoryRecordUseGateBundle,
	createAgenticMemoryRecordUseDecision,
	type StrictJsonValue,
} from "../../src/solutions/agentic-memory/index.js";
import type {
	AgenticWorkItemMemoryBridgeInput,
	AgenticWorkItemMemoryMappingPolicy,
	AgenticWorkItemMemoryRecordCandidate,
} from "../../src/solutions/agentic-work-item-memory/index.js";
import { agenticWorkItemMemoryBridgeBundle } from "../../src/solutions/agentic-work-item-memory/index.js";
import { type SolutionOccurrence, solutionOccurrenceJoin } from "../../src/solutions/occurrence.js";
import { workItemExecutionRecipe } from "../../src/solutions/work-item/execution.js";
import type {
	WorkItemEffectPlanProposed,
	WorkItemEffectPlanSnapshot,
	WorkItemProjection,
} from "../../src/solutions/work-item/scheduling.js";
import {
	array,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	CURRENT_ROOT_EVAL_PROVIDER_ROUTE,
	type CurrentRootEvalProviderRoute,
} from "./current-provider-route.js";
import { HARNESS_ARMS, type HarnessArm } from "./harness-campaign-policy.js";
import { CURRENT_IMPLEMENTATION_MANIFEST_DIGEST } from "./implementation-manifest.js";
import {
	CURRENT_PROFILE_ELIGIBILITY_SCHEMA,
	type CurrentProfileEligibility,
	createDeepSeekV4Flash0731FireworksStructuredProfileDefinition,
	createDeepSeekV4Flash0731TogetherStructuredProfileDefinition,
	createInjectedNoNetworkProfileQualification,
	deterministicProfileResolver,
	type HarnessEnhancementProfile,
	PROFILE_DECISION_REF,
	type ProfileResolution,
	type ProfileResolverInput,
	type ProviderBinding,
	type QualifiedProfileCatalogInput,
	validateCurrentProfileEligibility,
	validateHarnessEnhancementProfile,
	validateModelTarget,
	validateProfileQualification,
	validateProviderBinding,
} from "./model-harness-profile.js";
import { MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST } from "./model-harness-profile-qualification.js";
import {
	type EvalNonbillableCostEvidence,
	ROOT_EVAL_NONBILLABLE_POLICY,
	validateNonbillableCostEvidence,
} from "./provider-cost-evidence.js";
import { rootEvalQuietDataBoundary } from "./quiet-data-boundary.js";
import {
	ROOT_EVAL_DEVELOPMENT_TASK_SET_DIGEST,
	ROOT_EVAL_DEVELOPMENT_TASKS,
	ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES,
	type RootEvalTaskBinding,
	type RootEvalTaskDefinition,
	rootEvalTaskBindings,
} from "./root-eval-task.js";

export const ROOT_EVAL_TOPOLOGY_REVISION = "graphrefly-ts.root-eval-topology.v26" as const;

export type RootEvalOccurrenceLedgerEntry = Readonly<{
	readonly revision: number;
	readonly digest: string;
	readonly sourceRefsDigest: string;
}>;

/** Package-private D151 occurrence conservation used by the Eval solution boundaries. */
export function admitRootEvalOccurrence(
	ledger: Map<string, RootEvalOccurrenceLedgerEntry>,
	occurrence: Readonly<{
		readonly occurrenceId: string;
		readonly occurrenceRevision: number;
		readonly occurrenceDigest: string;
		readonly occurrenceSourceRefs: readonly Readonly<{
			readonly kind: string;
			readonly id: string;
		}>[];
	}>,
	maxOccurrences: number,
): "accepted" | "replay" {
	if (occurrence.occurrenceId.length === 0)
		throw new TypeError("root eval occurrence identity must be non-empty");
	if (!Number.isSafeInteger(occurrence.occurrenceRevision) || occurrence.occurrenceRevision < 1)
		throw new TypeError("root eval occurrence revision must be a positive safe integer");
	if (!/^sha256:[0-9a-f]{64}$/u.test(occurrence.occurrenceDigest))
		throw new TypeError("root eval occurrence digest must be canonical sha256");
	if (occurrence.occurrenceSourceRefs.length === 0)
		throw new TypeError("root eval occurrence requires visible source refs");
	const sourceRefsDigest = empiricalStrictJsonDigest(occurrence.occurrenceSourceRefs);
	const prior = ledger.get(occurrence.occurrenceId);
	if (prior !== undefined) {
		if (occurrence.occurrenceRevision < prior.revision)
			throw new TypeError("root eval occurrence replay used a stale revision");
		if (occurrence.occurrenceRevision === prior.revision) {
			if (
				occurrence.occurrenceDigest !== prior.digest ||
				sourceRefsDigest !== prior.sourceRefsDigest
			)
				throw new TypeError("root eval occurrence replay conflicted with prior DATA");
			return "replay";
		}
	}
	if (prior === undefined && ledger.size >= maxOccurrences)
		throw new TypeError("root eval occurrence retention exceeded its fixed bound");
	ledger.set(
		occurrence.occurrenceId,
		Object.freeze({
			revision: occurrence.occurrenceRevision,
			digest: occurrence.occurrenceDigest,
			sourceRefsDigest,
		}),
	);
	return "accepted";
}
export const ROOT_EVAL_REPLICATE_COUNT = 5 as const;
export const ROOT_EVAL_DEVELOPMENT_REPLICATE_COUNT = 5 as const;
export const ROOT_EVAL_PROVIDER_SETTLEMENT_BOUND_MS = 600_000 as const;
export const ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS = 300_000 as const;
export const ROOT_EVAL_INITIAL_PROVIDER_CAPACITY = 1 as const;
export const ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY = 1 as const;
export const ROOT_EVAL_PROVIDER_START_INTERVAL_MS = 30_000 as const;
export const ROOT_EVAL_MAX_PROVIDER_DISPATCHES_PER_WORK_ITEM = 5 as const;
export const ROOT_EVAL_MAX_CAPACITY_RETRIES = 3 as const;
export const ROOT_EVAL_MAX_AVAILABILITY_RETRIES = 1 as const;
export const ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS = 240_000 as const;
export const ROOT_EVAL_RETRY_SETTLEMENT_BOUND_MS = 241_000 as const;
export const ROOT_EVAL_TOOL_SETTLEMENT_BOUND_MS = 600_000 as const;
export const ROOT_EVAL_BILLING_SETTLEMENT_BOUND_MS = 256_000 as const;

export function rootEvalMaximumProviderAttempts(replicateCount: number): number {
	return (
		replicateCount * (HARNESS_ARMS.length + 1) * ROOT_EVAL_MAX_PROVIDER_DISPATCHES_PER_WORK_ITEM
	);
}

export function rootEvalMaximumRetryAttempts(replicateCount: number): number {
	return (
		replicateCount *
		(HARNESS_ARMS.length + 1) *
		(ROOT_EVAL_MAX_PROVIDER_DISPATCHES_PER_WORK_ITEM - 1)
	);
}

export interface EvalScheduleFeasibility {
	readonly kind: "eval-schedule-feasibility";
	readonly decisionRef: "graphrefly-ts:D158";
	readonly replicateCount: number;
	readonly sourceWorkItemCount: number;
	readonly targetWorkItemCount: number;
	readonly exactToolAttemptCount: number;
	readonly maximumProviderAttempts: number;
	readonly maximumRetryAttempts: number;
	readonly providerEffectLeaseMs: number;
	readonly providerSettlementBoundMs: typeof ROOT_EVAL_PROVIDER_SETTLEMENT_BOUND_MS;
	readonly providerStartIntervalMs: typeof ROOT_EVAL_PROVIDER_START_INTERVAL_MS;
	readonly retrySettlementBoundMs: typeof ROOT_EVAL_RETRY_SETTLEMENT_BOUND_MS;
	readonly exactToolSettlementBoundMs: typeof ROOT_EVAL_TOOL_SETTLEMENT_BOUND_MS;
	readonly billingSettlementBoundMs: typeof ROOT_EVAL_BILLING_SETTLEMENT_BOUND_MS;
	readonly maximumFinitePathMs: number;
	readonly state: "feasible";
}

export function rootEvalScheduleFeasibility(
	replicateCount: number,
	providerEffectLeaseMs: number = ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS,
): EvalScheduleFeasibility {
	if (!Number.isSafeInteger(replicateCount) || replicateCount < 1)
		throw new TypeError("root eval schedule requires a positive finite replicate count");
	if (
		!Number.isSafeInteger(providerEffectLeaseMs) ||
		providerEffectLeaseMs < 1 ||
		providerEffectLeaseMs > ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS
	)
		throw new TypeError("root eval schedule requires a bounded provider effect lease");
	const sourceWorkItemCount = replicateCount;
	const targetWorkItemCount = replicateCount * HARNESS_ARMS.length;
	const exactToolAttemptCount = sourceWorkItemCount + targetWorkItemCount;
	const maximumProviderAttempts = rootEvalMaximumProviderAttempts(replicateCount);
	const maximumRetryAttempts = rootEvalMaximumRetryAttempts(replicateCount);
	const maximumFinitePathMs =
		maximumProviderAttempts *
			(ROOT_EVAL_PROVIDER_SETTLEMENT_BOUND_MS + ROOT_EVAL_PROVIDER_START_INTERVAL_MS) +
		maximumRetryAttempts * ROOT_EVAL_RETRY_SETTLEMENT_BOUND_MS +
		exactToolAttemptCount * ROOT_EVAL_TOOL_SETTLEMENT_BOUND_MS +
		ROOT_EVAL_BILLING_SETTLEMENT_BOUND_MS;
	if (!Number.isSafeInteger(maximumFinitePathMs) || maximumFinitePathMs < 1)
		throw new TypeError("root eval schedule has no finite safe execution path");
	return Object.freeze({
		kind: "eval-schedule-feasibility",
		decisionRef: "graphrefly-ts:D158",
		replicateCount,
		sourceWorkItemCount,
		targetWorkItemCount,
		exactToolAttemptCount,
		maximumProviderAttempts,
		maximumRetryAttempts,
		providerEffectLeaseMs,
		providerSettlementBoundMs: ROOT_EVAL_PROVIDER_SETTLEMENT_BOUND_MS,
		providerStartIntervalMs: ROOT_EVAL_PROVIDER_START_INTERVAL_MS,
		retrySettlementBoundMs: ROOT_EVAL_RETRY_SETTLEMENT_BOUND_MS,
		exactToolSettlementBoundMs: ROOT_EVAL_TOOL_SETTLEMENT_BOUND_MS,
		billingSettlementBoundMs: ROOT_EVAL_BILLING_SETTLEMENT_BOUND_MS,
		maximumFinitePathMs,
		state: "feasible",
	});
}

export const ROOT_EVAL_CALLER_SAFETY_LEASE_MS =
	rootEvalScheduleFeasibility(ROOT_EVAL_REPLICATE_COUNT).maximumFinitePathMs;
export const ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE: EvalCurrentKeySnapshot = Object.freeze({
	kind: "eval-current-key-snapshot",
	keyBindingDigest: empiricalStrictJsonDigest("root-eval-no-network-key-binding"),
	admissionDigest: empiricalStrictJsonDigest("root-eval-no-network-key-before"),
	limitMicrousd: 32_000_000,
	remainingMicrousd: 12_000_000,
	usageMicrousd: 20_000_000,
	limitReset: "none",
	isManagementKey: false,
});

type MemoryPayload = {
	readonly bindingRef: string;
	readonly digest: string;
};

export type EvalMemoryBinding = Readonly<MemoryPayload>;

export type EvalMemoryProvenance =
	| "none"
	| "relevant-applied"
	| "proposal-only"
	| "admission-rejected"
	| "irrelevant-applied"
	| "wrong-scope-applied";

export type EvalCampaignPurpose = "qualification" | "development" | "confirmatory";
export type EvalBudgetPartition =
	| "no-network"
	| "development-usd-36"
	| "development-usd-40"
	| "development-usd-45"
	| "confirmatory-usd-6";

export interface EvalCampaignContract {
	readonly kind: "eval-campaign-contract";
	readonly executionGrantDigest: string;
	readonly campaignPurpose: EvalCampaignPurpose;
	readonly taskSetRef: string;
	readonly generationRef: string;
	readonly replicateCount: number;
	readonly heldOutSealDigest: string;
	readonly budgetPartition: EvalBudgetPartition;
	readonly partitionHardCapMicrousd: number;
	readonly partitionSpentBeforeMicrousd: number;
	readonly partitionLedgerDigest: string;
	readonly developmentQualificationStreakBefore: number;
}

export interface EvalDevelopmentQualificationState {
	readonly kind: "eval-development-qualification-state";
	readonly campaignPurpose: EvalCampaignPurpose;
	readonly generationRef: string;
	readonly status: "not-applicable" | "pending" | "qualified" | "reset";
	readonly generationQualified: boolean | null;
	readonly consecutiveQualifyingGenerations: number;
	readonly requiredConsecutiveGenerations: 2;
	readonly heldOutEligible: boolean;
}

export interface EvalArmDispatch {
	readonly kind: "eval-arm-dispatch";
	readonly campaignRef: string;
	readonly replicate: number;
	readonly arm: HarnessArm;
	readonly armIndex: number;
	readonly workItemId: string;
	readonly taskInstanceRef: string;
	readonly sourceWorkItemId: string;
	readonly sourceEvidenceDigest: string;
	readonly sourceInsightDigest: string;
	readonly memorySourceTaskInstanceRef: string;
	readonly memorySourceWorkItemId: string;
	readonly memorySourceEvidenceDigest: string;
	readonly memorySourceInsightDigest: string;
	readonly memoryProvenance: EvalMemoryProvenance;
	readonly candidateCatalogDigest: string;
	readonly candidateRefs: readonly [string, string];
}

interface EvalSourceWorkItemRequest {
	readonly kind: "eval-source-work-item-request";
	readonly campaignRef: string;
	readonly taskSetRef: string;
	readonly replicate: number;
	readonly taskInstanceRef: string;
	readonly sourceWorkItemId: string;
	readonly sourceEvidenceDigest: string;
	readonly sourceInsightDigest: string;
	readonly taskManifestDigest: string;
	readonly candidateCatalogDigest: string;
	readonly candidateRefs: readonly [string, string];
}

interface EvalSourceVerificationFact {
	readonly kind: "eval-source-work-item-verified";
	readonly request: EvalSourceWorkItemRequest;
	readonly sourceWorkItemId: string;
	readonly taskInstanceRef: string;
	readonly sourceEvidenceDigest: string;
	readonly sourceInsightDigest: string;
	readonly verified: true;
	readonly cleanupCompleted: true;
}

type EvalTechnicalFailureReason = Extract<
	EvalProviderOutcomeReason,
	| "http-capacity-exhausted"
	| "http-availability-exhausted"
	| "http-terminal"
	| "transport-failed"
	| "transport-availability-exhausted"
	| "response-route-invalid"
>;

interface EvalSourceTechnicalExclusionFact {
	readonly kind: "eval-source-work-item-technical-exclusion";
	readonly request: EvalSourceWorkItemRequest;
	readonly sourceWorkItemId: string;
	readonly replicate: number;
	readonly reason: EvalTechnicalFailureReason;
	readonly providerEffectSettled: true;
}

type EvalSourceTerminalFact = EvalSourceVerificationFact | EvalSourceTechnicalExclusionFact;

export interface EvalCampaignState {
	readonly kind: "eval-campaign-state";
	readonly executionGrantDigest: string;
	readonly campaignRef: string;
	readonly campaignPurpose: EvalCampaignPurpose;
	readonly taskSetRef: string;
	readonly generationRef: string;
	readonly replicate: number;
	readonly replicateCount: number;
	readonly heldOutSealDigest: string;
	readonly budgetPartition: EvalBudgetPartition;
	readonly partitionHardCapMicrousd: number;
	readonly partitionSpentBeforeMicrousd: number;
	readonly partitionLedgerDigest: string;
	readonly developmentQualificationStreakBefore: number;
	readonly sourceTechnicalExcludedReplicates: readonly number[];
	readonly completedArms: number;
	readonly state: "running" | "stopped";
	readonly stoppingReason:
		| "none"
		| "campaign-complete"
		| "budget-exhausted"
		| "progress-stalled"
		| "effect-failed";
}

export interface EvalProgressLeaseState {
	readonly kind: "eval-progress-lease-state";
	readonly campaignRef: string;
	readonly revision: number;
	readonly occurrenceDigest: string;
	readonly nextExpectedOccurrence: string;
	readonly leaseMs: number;
	readonly deadlineOffsetMs: number;
	readonly maximumFinitePathMs: number;
	readonly state: "active" | "complete" | "stopped" | "stalled";
	readonly stoppingReason: "none" | "campaign-complete" | "budget-exhausted" | "progress-stalled";
}

export interface EvalEffectProposal {
	readonly kind: "eval-effect-proposal";
	readonly proposalId: string;
	readonly effectRunId: string;
	readonly operationId: string;
	readonly workItemId: string;
	readonly replicate: number;
	readonly arm: HarnessArm | "source";
	readonly workItemRole: "source" | "target";
	readonly providerLogicalAttempt: 1;
	readonly dispatchOrdinal: number;
	readonly capacityRetryOrdinal: number;
	readonly availabilityRetryOrdinal: number;
	readonly reservationMicrousd: number;
	readonly timeoutMs: number;
	readonly maxOutputTokens: number;
	readonly reasoningEffort: "medium";
	readonly workItemPlanId: string;
	readonly workItemPlanDigest: string;
	readonly workItemPlanAuthority: EvalWorkItemPlanSnapshot;
	readonly profileResolutionDigest: string;
	readonly providerRef: string;
	readonly providerModelRef: string;
	readonly endpointProtocol: ProviderBinding["endpointProtocol"];
	readonly proposalEncoding: ProviderBinding["proposalEncoding"];
	readonly responseContractRevision: string;
	readonly request: AgentRequestIssued<Record<string, unknown>>;
}

export interface EvalAdmittedEffect extends Omit<EvalEffectProposal, "kind"> {
	readonly kind: "eval-admitted-effect";
	readonly admissionId: string;
	readonly executionId: string;
	readonly receiptDigest: string;
}

export const EVAL_PROVIDER_OUTCOME_REASON_CODES = Object.freeze([
	"tool-proposed",
	"http-capacity-retryable",
	"http-capacity-exhausted",
	"http-availability-retryable",
	"http-availability-exhausted",
	"http-terminal",
	"transport-failed",
	"transport-availability-retryable",
	"transport-availability-exhausted",
	"response-bounds-invalid",
	"response-json-invalid",
	"response-route-invalid",
	"response-usage-invalid",
	"response-choice-invalid",
	"response-output-truncated",
	"response-proposal-missing",
	"response-proposal-legacy-shape",
	"response-proposal-invalid",
	"response-proposal-arguments-invalid",
	"executor-failed",
] as const);

export const EVAL_PROVIDER_CONDITIONAL_AVAILABILITY_CODES = Object.freeze([
	"failed_dependency",
	"gateway_timeout",
	"internal_server_error",
	"provider_internal_error",
	"provider_overloaded",
	"request_timeout",
	"resource_locked",
	"server_error",
	"service_unavailable",
	"temporarily_unavailable",
	"upstream_error",
	"upstream_timeout",
] as const);

export type EvalProviderOutcomeReason = (typeof EVAL_PROVIDER_OUTCOME_REASON_CODES)[number];
export type EvalProviderOutcomeReasonCounts = Readonly<Record<EvalProviderOutcomeReason, number>>;

export function emptyEvalProviderOutcomeReasonCounts(): EvalProviderOutcomeReasonCounts {
	return Object.freeze(
		Object.fromEntries(EVAL_PROVIDER_OUTCOME_REASON_CODES.map((code) => [code, 0])),
	) as EvalProviderOutcomeReasonCounts;
}

export interface EvalProviderOutcome {
	readonly kind: "eval-provider-outcome";
	readonly admission: EvalAdmittedEffect;
	readonly admissionId: string;
	readonly executionId: string;
	readonly operationId: string;
	readonly effectRunId: string;
	readonly workItemId: string;
	readonly replicate: number;
	readonly arm: HarnessArm | "source";
	readonly workItemRole: "source" | "target";
	readonly providerLogicalAttempt: 1;
	readonly dispatchOrdinal: number;
	readonly capacityRetryOrdinal: number;
	readonly availabilityRetryOrdinal: number;
	readonly recoveryClass: "capacity" | "availability" | null;
	readonly status: "tool-proposed" | "failed" | "retryable";
	readonly reason: EvalProviderOutcomeReason;
	readonly dispatchAttempted: boolean;
	readonly dispatchElapsedMs: number;
	readonly providerResponseKind: "http" | "transport" | "none";
	readonly httpStatus: number | null;
	readonly providerErrorCode: string | null;
	readonly transportNoToolSideEffect: boolean;
	readonly costMicrousd: number;
	readonly costEvidence:
		| "provider-reported"
		| "reservation-upper-bound"
		| "policy-qualified-nonbillable";
	readonly nonbillableEvidence?: EvalNonbillableCostEvidence;
	readonly pricingRoundingAllowanceMicrousd: number;
	readonly elapsedMs: number;
	readonly resultDigest: string;
	readonly retryAfterMs: number;
	/** Graph-normalized response evidence, independent of whether this request may retry. */
	readonly responseRetryAfterMs?: number;
	readonly cleanupCompleted: boolean;
	readonly toolProposal: Readonly<{
		readonly toolRef: "graphrefly.eval.exact-candidate-tool.v2";
		readonly candidateRef: string;
		readonly candidateCatalogDigest: string;
		readonly argumentsDigest: string;
	}> | null;
}

export interface EvalAdmittedToolEffect {
	readonly kind: "eval-admitted-tool-effect";
	readonly executionId: string;
	readonly toolAdmissionId: string;
	readonly providerAdmission: EvalAdmittedEffect;
	readonly providerOutcome: EvalProviderOutcome;
	readonly effectRunId: string;
	readonly workItemId: string;
	readonly replicate: number;
	readonly arm: HarnessArm | "source";
	readonly workItemRole: "source" | "target";
	readonly providerLogicalAttempt: 1;
	readonly dispatchOrdinal: number;
	readonly capacityRetryOrdinal: number;
	readonly availabilityRetryOrdinal: number;
	readonly toolRef: "graphrefly.eval.exact-candidate-tool.v2";
	readonly candidateRef: string;
	readonly candidateCatalogDigest: string;
	readonly argumentsDigest: string;
	readonly receiptDigest: string;
}

export interface EvalRetryDelayEffect {
	readonly kind: "eval-admitted-retry-delay";
	readonly executionId: string;
	readonly providerOutcome: EvalProviderOutcome;
	readonly effectRunId: string;
	readonly workItemId: string;
	readonly replicate: number;
	readonly arm: HarnessArm | "source";
	readonly workItemRole: "source" | "target";
	readonly providerLogicalAttempt: 1;
	readonly dispatchOrdinal: number;
	readonly capacityRetryOrdinal: number;
	readonly availabilityRetryOrdinal: number;
	readonly recoveryClass: "capacity" | "availability";
	readonly batchSize: number;
	readonly delayMs: number;
	readonly receiptDigest: string;
}

export interface EvalRetryDelayOutcome {
	readonly kind: "eval-retry-delay-outcome";
	readonly admission: EvalRetryDelayEffect;
	readonly executionId: string;
	readonly elapsedMs: number;
	readonly status: "completed" | "failed";
	readonly resultDigest: string;
}

export interface EvalCurrentKeySnapshot {
	readonly kind: "eval-current-key-snapshot";
	readonly keyBindingDigest: string;
	readonly admissionDigest: string;
	readonly limitMicrousd: number;
	readonly remainingMicrousd: number;
	readonly usageMicrousd: number;
	readonly limitReset: "none";
	readonly isManagementKey: false;
}

export interface EvalBillingObservationProposal {
	readonly kind: "eval-billing-observation-proposal";
	readonly proposalId: string;
	readonly observation: number;
	readonly delayMs: number;
	readonly currentKeyBefore: EvalCurrentKeySnapshot;
	readonly providerCallCount: number;
	readonly providerReportedMicrousd: number;
	readonly pricingRoundingAllowanceMicrousd: number;
	readonly providerReportedLowerBoundMicrousd: number;
	readonly accountedUpperBoundMicrousd: number;
	readonly maxCostMicrousd: number;
}

export interface EvalBillingObservationEffect
	extends Omit<EvalBillingObservationProposal, "kind" | "proposalId"> {
	readonly kind: "eval-admitted-billing-observation";
	readonly proposalId: string;
	readonly executionId: string;
	readonly observation: number;
	readonly delayMs: number;
	readonly currentKeyBefore: EvalCurrentKeySnapshot;
	readonly providerCallCount: number;
	readonly providerReportedMicrousd: number;
	readonly pricingRoundingAllowanceMicrousd: number;
	readonly providerReportedLowerBoundMicrousd: number;
	readonly accountedUpperBoundMicrousd: number;
	readonly maxCostMicrousd: number;
	readonly receiptDigest: string;
}

export interface EvalBillingObservationOutcome {
	readonly kind: "eval-billing-observation-outcome";
	readonly admission: EvalBillingObservationEffect;
	readonly executionId: string;
	readonly observation: number;
	readonly status: "completed" | "failed";
	readonly currentKeyAfter: EvalCurrentKeySnapshot | null;
	readonly resultDigest: string;
}

export interface EvalBillingReconciliation {
	readonly kind: "eval-billing-reconciliation";
	readonly status: "reconciled" | "rejected";
	readonly reason:
		| "quiescent"
		| "observation-failed"
		| "identity-drift"
		| "non-monotonic"
		| "delta-mismatch"
		| "below-certified-provider-lower-bound"
		| "above-accounted-upper-bound"
		| "above-hard-cap"
		| "provider-calls-without-billed-delta"
		| "quiescence-exhausted";
	readonly observationCount: number;
	readonly stableIntervals: number;
	readonly providerReportedMicrousd: number;
	readonly pricingRoundingAllowanceMicrousd: number;
	readonly providerReportedLowerBoundMicrousd: number;
	readonly observedBilledMicrousd: number | null;
	readonly reconciledBilledMicrousd: number | null;
}

export type EvalExecutableEffect =
	| EvalAdmittedEffect
	| EvalAdmittedToolEffect
	| EvalRetryDelayEffect
	| EvalBillingObservationEffect;

export interface EvalEffectOutcome {
	readonly kind: "eval-effect-outcome";
	readonly admission: EvalAdmittedToolEffect | EvalAdmittedEffect;
	readonly executionId: string;
	readonly admissionId: string;
	readonly toolAdmissionId: string | null;
	readonly operationId: string;
	readonly argumentsDigest: string | null;
	readonly effectRunId: string;
	readonly workItemId: string;
	readonly replicate: number;
	readonly arm: HarnessArm | "source";
	readonly workItemRole: "source" | "target";
	readonly providerLogicalAttempt: 1;
	readonly dispatchOrdinal: number;
	readonly capacityRetryOrdinal: number;
	readonly availabilityRetryOrdinal: number;
	readonly status: "completed" | "failed";
	readonly costMicrousd: 0;
	readonly elapsedMs: number;
	readonly resultDigest: string;
	readonly evidence: {
		readonly expectedDigest: string;
		readonly actualDigest: string;
		readonly diff: "scoped-change" | "no-change" | "wrong-scope";
		readonly cleanupCompleted: boolean;
		readonly publicSemantic: "equivalent" | "different";
		readonly hiddenVerifier: "pass" | "fail";
	};
}

export type EvalExecutorOutcome =
	| EvalProviderOutcome
	| EvalEffectOutcome
	| EvalRetryDelayOutcome
	| EvalBillingObservationOutcome;

interface EvalDiffFact {
	readonly kind: "eval-diff-fact";
	readonly outcome: EvalEffectOutcome;
	readonly scopedChange: boolean;
}

interface EvalPublicSemanticFact {
	readonly kind: "eval-public-semantic-fact";
	readonly outcome: EvalEffectOutcome;
	readonly diffPassed: boolean;
	readonly publicSemanticPassed: boolean;
}

interface EvalHiddenVerifierFact {
	readonly kind: "eval-hidden-verifier-fact";
	readonly outcome: EvalEffectOutcome;
	readonly diffPassed: boolean;
	readonly publicSemanticPassed: boolean;
	readonly hiddenVerifierPassed: boolean;
	readonly passed: boolean;
}

export interface EvalBudgetState {
	readonly kind: "eval-budget-state";
	readonly executionGrantDigest: string;
	readonly policyQualifiedNonbillableCount: number;
	readonly admittedAttempts: number;
	readonly admittedRetryAttempts: number;
	readonly retryProposalCount: number;
	readonly pendingRetryProposalCount: number;
	readonly rejectedRetryProposalCount: number;
	readonly settledRetryAttemptCount: number;
	readonly providerCallCount: number;
	readonly activeEffects: number;
	readonly activeReservedMicrousd: number;
	readonly providerReportedMicrousd: number;
	readonly pricingRoundingAllowanceMicrousd: number;
	readonly unreportedSettledUpperBoundMicrousd: number;
	readonly accountedUpperBoundMicrousd: number;
	readonly providerOutcomeReasonCounts: EvalProviderOutcomeReasonCounts;
	readonly maxAttempts: number;
	readonly maxCostMicrousd: number;
	readonly stoppingReason: "none" | "budget-exhausted" | "progress-stalled";
}

export interface EvalProviderCapacityState {
	readonly kind: "eval-provider-capacity-state";
	readonly pacingRevision: number;
	readonly providerStartIntervalMs: number;
	readonly consecutiveUsableResponses: number;
	readonly mode: "paced-serial" | "cooldown";
	readonly initialMaxConcurrentEffects: typeof ROOT_EVAL_INITIAL_PROVIDER_CAPACITY;
	readonly maxConcurrentEffects:
		| typeof ROOT_EVAL_INITIAL_PROVIDER_CAPACITY
		| typeof ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY;
	readonly activeEffects: number;
	readonly proposalCount: number;
	readonly pendingProposalCount: number;
	readonly pendingFirstAttemptProposalCount: number;
	readonly pendingRetryProposalCount: number;
	readonly retryProposalCount: number;
	readonly admittedProposalCount: number;
	readonly admittedRetryProposalCount: number;
	readonly settledProposalCount: number;
	readonly settledRetryProposalCount: number;
	readonly rejectedProposalCount: number;
	readonly rejectedRetryProposalCount: number;
	readonly cooldownOutstandingReadinessCount: number;
	readonly rateLimitFeedbackCount: number;
}

interface EvalProviderAdmissionObservationCut {
	readonly kind: "eval-provider-admission-observation-cut";
	readonly revision: number;
	readonly budget: EvalBudgetState;
	readonly capacity: EvalProviderCapacityState;
	readonly activeProviderAdmissionIds: readonly string[];
}

function assertEvalProviderAdmissionObservationCut(cut: EvalProviderAdmissionObservationCut): void {
	const providerReasonTotal = EVAL_PROVIDER_OUTCOME_REASON_CODES.reduce(
		(total, reason) => total + cut.budget.providerOutcomeReasonCounts[reason],
		0,
	);
	if (
		new Set(cut.activeProviderAdmissionIds).size !== cut.activeProviderAdmissionIds.length ||
		JSON.stringify(cut.activeProviderAdmissionIds) !==
			JSON.stringify([...cut.activeProviderAdmissionIds].sort()) ||
		cut.capacity.activeEffects !== cut.activeProviderAdmissionIds.length ||
		cut.budget.activeEffects !== cut.activeProviderAdmissionIds.length ||
		cut.capacity.admittedProposalCount !== cut.budget.admittedAttempts ||
		cut.capacity.admittedRetryProposalCount !== cut.budget.admittedRetryAttempts ||
		cut.capacity.retryProposalCount !== cut.budget.retryProposalCount ||
		cut.capacity.pendingRetryProposalCount !== cut.budget.pendingRetryProposalCount ||
		cut.capacity.rejectedRetryProposalCount !== cut.budget.rejectedRetryProposalCount ||
		cut.capacity.settledRetryProposalCount !== cut.budget.settledRetryAttemptCount ||
		cut.capacity.settledProposalCount !== providerReasonTotal ||
		cut.capacity.proposalCount !==
			cut.capacity.pendingProposalCount +
				cut.capacity.admittedProposalCount +
				cut.capacity.rejectedProposalCount
	)
		throw new TypeError("eval provider admission observation cut was incoherent");
}

export interface EvalCleanupFact {
	readonly kind: "eval-cleanup-complete";
	readonly workItemId: string;
	readonly replicate: number;
	readonly arm: HarnessArm;
	readonly exactToolAdmitted: boolean;
	readonly scopedChange: boolean;
	readonly publicSemanticPassed: boolean;
	readonly hiddenVerifierPassed: boolean;
	readonly cleanupCompleted: boolean;
	readonly passed: boolean;
	readonly terminalReason: EvalVerificationTerminalReason;
	readonly resultDigest: string;
}

export const EVAL_VERIFICATION_STAGE_KEYS = Object.freeze([
	"completedWorkItems",
	"exactToolAdmitted",
	"scopedChange",
	"publicSemanticPassed",
	"hiddenVerifierPassed",
	"cleanupCompleted",
	"passed",
] as const);

export type EvalVerificationStage = (typeof EVAL_VERIFICATION_STAGE_KEYS)[number];

export const EVAL_VERIFICATION_TERMINAL_REASONS = Object.freeze([
	"cleanup-incomplete",
	"provider-failed",
	"exact-tool-failed",
	"no-change",
	"wrong-scope",
	"public-semantic-failed",
	"hidden-verifier-failed",
	"passed",
] as const);

export type EvalVerificationTerminalReason = (typeof EVAL_VERIFICATION_TERMINAL_REASONS)[number];

export type EvalVerificationStageCounts = Readonly<Record<EvalVerificationStage, number>>;
export type EvalVerificationReasonCounts = Readonly<Record<EvalVerificationTerminalReason, number>>;

export interface EvalVerificationDiagnostics {
	readonly kind: "eval-verification-diagnostics";
	readonly armOrder: typeof HARNESS_ARMS;
	readonly stageCounts: Readonly<Record<HarnessArm, EvalVerificationStageCounts>>;
	readonly terminalReasonCounts: Readonly<Record<HarnessArm, EvalVerificationReasonCounts>>;
	readonly completedWorkItems: number;
}

export interface EvalFinding {
	readonly kind: "eval-efficacy-finding";
	readonly campaignRef: string;
	readonly replicateCount: number;
	readonly armOrder: typeof HARNESS_ARMS;
	readonly passCounts: Readonly<Record<HarnessArm, number>>;
	readonly evaluableReplicates: number;
	readonly excludedTechnicalReplicates: readonly number[];
	readonly sourceTechnicalExcludedReplicates: readonly number[];
	readonly matchedRelevantOverColdWins: number;
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
	readonly finding:
		| "positive-differential"
		| "no-positive-differential"
		| "operationally-inconclusive";
	readonly stoppingReason: "campaign-complete";
}

export interface EvalObservation {
	readonly kind: "eval-observation";
	readonly topologyRevision: typeof ROOT_EVAL_TOPOLOGY_REVISION;
	readonly executionGrantDigest: string;
	readonly solutionIdentities: readonly [
		"work-item-execution",
		"agentic-work-item-memory-application",
		"agentic-memory-record-use",
		"agentic-memory-retrieval",
	];
	readonly campaignRef: string;
	readonly campaignPurpose: EvalCampaignPurpose;
	readonly taskSetRef: string;
	readonly generationRef: string;
	readonly replicate: number;
	readonly replicateCount: number;
	readonly heldOutSealDigest: string;
	readonly budgetPartition: EvalBudgetPartition;
	readonly partitionHardCapMicrousd: number;
	readonly partitionSpentBeforeMicrousd: number;
	readonly partitionLedgerDigest: string;
	readonly developmentQualification: EvalDevelopmentQualificationState;
	readonly armOrder: typeof HARNESS_ARMS;
	readonly memoryProvenance: Readonly<Record<HarnessArm, EvalMemoryProvenance>>;
	readonly evaluableReplicates: number | null;
	readonly excludedTechnicalReplicates: readonly number[];
	readonly sourceTechnicalExcludedReplicates: readonly number[];
	readonly matchedRelevantOverColdWins: number | null;
	readonly completedArms: number;
	readonly verificationDiagnostics: EvalVerificationDiagnostics;
	readonly activeProviderEffects: number;
	readonly activeToolEffects: number;
	readonly activeRetryEffects: number;
	readonly activeBillingEffects: number;
	readonly activeAdmittedEffects: number;
	readonly providerCapacity: EvalProviderCapacityState;
	readonly scheduleFeasibility: EvalScheduleFeasibility;
	readonly progressLease: EvalProgressLeaseState;
	readonly admittedAttempts: number;
	readonly admittedRetryAttempts: number;
	readonly retryProposalCount: number;
	readonly pendingRetryProposalCount: number;
	readonly rejectedRetryProposalCount: number;
	readonly settledRetryAttemptCount: number;
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
	readonly reconciledBilledMicrousd: number | null;
	readonly billingDisposition: "pending" | "reconciled" | "rejected";
	readonly providerOutcomeReasonCounts: EvalProviderOutcomeReasonCounts;
	readonly stoppingReason: string;
	readonly finding: EvalFinding["finding"] | "pending" | "not-evaluated";
}

export interface EvalEffectActivitySnapshot {
	readonly kind: "eval-effect-activity-snapshot";
	readonly revision: number;
	readonly budgetDigest: string;
	readonly budget: EvalBudgetState;
	readonly activeProviderAdmissionIds: readonly string[];
	readonly activeProviderEffects: number;
	readonly activeToolEffects: number;
	readonly activeRetryEffects: number;
	readonly activeBillingEffects: number;
	readonly activeAdmittedEffects: number;
	readonly cleanupComplete: boolean;
	readonly pendingToolAdmissions: number;
	readonly completedTargetWorkItems: number;
}

export interface EvalEffectClassActivitySnapshot {
	readonly kind: "eval-effect-class-activity-snapshot";
	readonly effectClass: "provider" | "exact-tool" | "retry-delay" | "billing-observation";
	readonly activeEffects: number;
	readonly activeExecutionIds: readonly string[];
	readonly admittedEffects: number;
	readonly settledEffects: number;
	readonly cleanupFailureCount: number;
	readonly completedTargetWorkItems: number;
}

export interface RootEvalTopologyOptions {
	readonly profileInput: QualifiedProfileCatalogInput;
	readonly currentKeyBefore: EvalCurrentKeySnapshot;
	readonly campaignRef?: string;
	readonly campaignPurpose?: EvalCampaignPurpose;
	readonly taskSetRef?: string;
	readonly taskManifestDigest?: string;
	readonly taskDefinitions?: readonly RootEvalTaskDefinition[];
	readonly taskBindings?: readonly RootEvalTaskBinding[];
	readonly generationRef?: string;
	readonly replicateCount?: number;
	readonly heldOutSealDigest?: string;
	readonly budgetPartition?: EvalBudgetPartition;
	readonly partitionHardCapMicrousd?: number;
	readonly partitionSpentBeforeMicrousd?: number;
	readonly partitionLedgerDigest?: string;
	readonly developmentQualificationStreakBefore?: number;
	readonly executionGrantDigest?: string;
	readonly maxAttempts?: number;
	readonly maxCostMicrousd?: number;
	readonly reservationMicrousd?: number;
	readonly effectTimeoutMs?: number;
	readonly sourceEffectTimeoutMs?: number;
	readonly providerPacingSetTimeout?: (
		callback: () => void,
		delayMs: number,
	) => ReturnType<typeof setTimeout>;
	readonly progressLeaseSetTimeout?: (
		callback: () => void,
		delayMs: number,
	) => ReturnType<typeof setTimeout>;
}

export interface RootEvalProfileAdmission {
	readonly kind: "root-eval-profile-admission";
	readonly eligibility: CurrentProfileEligibility;
	readonly resolution: Extract<ProfileResolution, { readonly status: "eligible" }>;
	readonly profile: HarnessEnhancementProfile;
	readonly binding: ProviderBinding;
}

export interface EvalObservationRejection {
	readonly kind: "eval-observation-rejected";
	readonly code: "canonical-observation-invalid" | "campaign-cleanup-failed";
	readonly campaignRef: string;
	readonly acceptedRevision: number;
}

/** One shared finite occurrence bound for the producer and durable evidence admission. */
export function rootEvalMaximumObservationOccurrences(replicateCount: number): number {
	return (
		rootEvalMaximumProviderAttempts(replicateCount) * 64 +
		replicateCount * HARNESS_ARMS.length * 64 +
		64
	);
}

export interface RootEvalTopology {
	readonly graph: Graph;
	readonly campaignRef: string;
	readonly campaignContract: EvalCampaignContract;
	readonly inputs: {
		readonly start: Node<{ readonly kind: "eval-campaign-start"; readonly campaignRef: string }>;
	};
	runAdmittedEffects(
		executor: (effect: EvalExecutableEffect) => Promise<EvalExecutorOutcome>,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): Promise<RootEvalRunOutcome>;
	readonly nodes: {
		readonly campaignContract: Node<EvalCampaignContract>;
		readonly currentProviderRoute: Node<CurrentRootEvalProviderRoute>;
		readonly workItems: Node<WorkItemProjection<Record<string, unknown>>>;
		readonly memoryProvenance: Node<Readonly<Record<HarnessArm, EvalMemoryProvenance>>>;
		readonly providerProposals: Node<EvalEffectProposal>;
		readonly providerAdmissions: Node<EvalAdmittedEffect>;
		readonly providerCapacity: Node<EvalProviderCapacityState>;
		readonly scheduleFeasibility: Node<EvalScheduleFeasibility>;
		readonly progressAdmissionLease: Node<EvalProgressLeaseState>;
		readonly progressLease: Node<EvalProgressLeaseState>;
		readonly campaignActiveEffects: Node<readonly EvalExecutableEffect[]>;
		readonly toolActiveEffects: Node<readonly EvalExecutableEffect[]>;
		readonly retryActiveEffects: Node<readonly EvalExecutableEffect[]>;
		readonly billingActiveEffects: Node<readonly EvalExecutableEffect[]>;
		readonly providerActivity: Node<EvalEffectClassActivitySnapshot>;
		readonly toolActivity: Node<EvalEffectClassActivitySnapshot>;
		readonly retryActivity: Node<EvalEffectClassActivitySnapshot>;
		readonly billingActivity: Node<EvalEffectClassActivitySnapshot>;
		readonly effectActivity: Node<EvalEffectActivitySnapshot>;
		readonly executorEffects: Node<EvalExecutableEffect>;
		readonly workItemResults: Node<EffectRunResult>;
		readonly cleanup: Node<EvalCleanupFact>;
		readonly verificationDiagnostics: Node<EvalVerificationDiagnostics>;
		readonly budgets: Node<EvalBudgetState>;
		readonly billingObservationAdmissions: Node<EvalBillingObservationEffect>;
		readonly billingReconciliation: Node<EvalBillingReconciliation>;
		readonly findings: Node<EvalFinding>;
		readonly campaignTerminal: Node<EvalCampaignTerminal>;
		readonly developmentQualification: Node<EvalDevelopmentQualificationState>;
		readonly terminalLifecycleConsistency: Node<{
			readonly kind: "eval-terminal-lifecycle-consistency";
			readonly status: "pending" | "consistent";
			readonly budgetDigest: string | null;
		}>;
		readonly observationRejections: Node<EvalObservationRejection>;
		readonly observation: Node<EvalObservation>;
	};
}

export interface RootEvalRunResult {
	readonly finding: EvalFinding;
	readonly observations: readonly ObserveEvent[];
	readonly peakConcurrentEffects: number;
	readonly executedAdmissionIds: readonly string[];
}

export interface EvalCampaignTerminal {
	readonly kind: "eval-campaign-terminal";
	readonly campaignRef: string;
	readonly status: "completed" | "stopped";
	readonly stoppingReason: "campaign-complete" | "budget-exhausted" | "progress-stalled";
	readonly finding: EvalFinding["finding"] | null;
	readonly observationDigest: string;
	readonly budgetDigest: string;
	readonly activityDigest: string;
	readonly observationRevision: number;
	readonly completedTargetWorkItems: number;
	readonly cleanupComplete: true;
}

export interface RootEvalStoppedResult extends Omit<RootEvalRunResult, "finding"> {
	readonly finding: null;
	readonly terminal: EvalCampaignTerminal;
}

export type RootEvalRunOutcome = RootEvalRunResult | RootEvalStoppedResult;

/** Consumers requiring a complete scientific finding must explicitly reject a normal stop. */
export function requireCompletedRootEval(result: RootEvalRunOutcome): RootEvalRunResult {
	if (result.finding === null)
		throw new Error(`root eval stopped: ${result.terminal.stoppingReason}`);
	return result;
}

export interface RootEvalPersistenceRecord {
	readonly format: "graphrefly.rootEvalResult";
	readonly version: 1;
	readonly recordId: string;
	readonly recordDigest: string;
	readonly topologyRevision: typeof ROOT_EVAL_TOPOLOGY_REVISION;
	readonly finding: EvalFinding;
	readonly executedAdmissionIds: readonly string[];
	readonly peakConcurrentEffects: number;
}

export interface RootEvalAtomicStore {
	read(key: string): Promise<RootEvalPersistenceRecord | undefined>;
	commitIfAbsent(key: string, record: RootEvalPersistenceRecord): Promise<"committed" | "exists">;
}

interface CampaignControllerState {
	started: boolean;
	replicate: number;
	completedByReplicate: Map<number, Set<HarnessArm>>;
	sourceTerminals: Map<number, EvalCampaignSourceTerminal>;
	dispatchedReplicates: Set<number>;
}

type EvalCampaignSourceTerminal =
	| Readonly<{
			state: "verified";
			sourceWorkItemId: string;
			request: EvalSourceWorkItemRequest;
	  }>
	| Readonly<{
			state: "technical-exclusion";
			sourceWorkItemId: string;
			replicate: number;
	  }>;

interface AdmissionState {
	policyQualifiedNonbillableCount: number;
	pacingRevision: number;
	providerStartIntervalMs: number;
	consecutiveUsableResponses: number;
	proposalKeys: Set<string>;
	proposalDigests: Map<string, string>;
	admittedKeys: Set<string>;
	settledAdmissionIds: Set<string>;
	active: Map<string, EvalAdmittedEffect>;
	pendingProposals: Map<string, EvalEffectProposal>;
	releasedProposalKeys: Set<string>;
	retryProposalKeys: Set<string>;
	rejectedProposalKeys: Set<string>;
	cooldownReadinessIds: Set<string>;
	capacityMode: "paced-serial" | "cooldown";
	maxConcurrentEffects:
		| typeof ROOT_EVAL_INITIAL_PROVIDER_CAPACITY
		| typeof ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY;
	rateLimitFeedbackCount: number;
	admittedAttempts: number;
	admittedRetryAttempts: number;
	settledRetryAttempts: number;
	providerCallCount: number;
	activeReservedMicrousd: number;
	providerReportedMicrousd: number;
	pricingRoundingAllowanceMicrousd: number;
	unreportedSettledUpperBoundMicrousd: number;
	providerOutcomeReasonCounts: Record<EvalProviderOutcomeReason, number>;
	stoppingReason: "none" | "budget-exhausted" | "progress-stalled";
	observationRevision: number;
	observationDigest?: string;
}

type EvalWorkItemPlanSnapshot = WorkItemEffectPlanSnapshot<Record<string, unknown>>;

interface EvalWorkItemPlanAuthority {
	readonly plans: Readonly<Record<string, EvalWorkItemPlanSnapshot>>;
}

function exactOne<T>(values: readonly T[], label: string): T {
	if (values.length !== 1) throw new TypeError(`root eval profile requires exactly one ${label}`);
	return values[0]!;
}

function admitProfileInsideRootGraph(
	input: QualifiedProfileCatalogInput,
	currentRoute: CurrentRootEvalProviderRoute,
): RootEvalProfileAdmission {
	if (
		empiricalStrictJsonDigest(currentRoute) !==
		empiricalStrictJsonDigest(CURRENT_ROOT_EVAL_PROVIDER_ROUTE)
	)
		throw new TypeError("root eval current provider route contract drifted");
	exactKeys(
		record(input, "root eval profile input"),
		[
			"bindings",
			"currentImplementationManifestDigest",
			"profiles",
			"qualifications",
			"requestedTargetRef",
			"targets",
		],
		"root eval profile input",
	);
	if (input.currentImplementationManifestDigest !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("root eval profile implementation manifest is not current");
	const target = validateModelTarget(exactOne(input.targets, "model target"));
	const profile = validateHarnessEnhancementProfile(
		exactOne(input.profiles, "enhancement profile"),
	);
	const binding = validateProviderBinding(exactOne(input.bindings, "provider binding"));
	const qualification = validateProfileQualification(
		exactOne(input.qualifications, "profile qualification"),
	);
	if (binding.providerRef !== "fireworks" && binding.providerRef !== "together")
		throw new TypeError(
			"root eval profile provider is not an exact no-network-qualified candidate",
		);
	if (
		binding.providerRef !== currentRoute.providerRef ||
		binding.providerModelRef !== currentRoute.modelRef
	)
		throw new TypeError(
			"root eval profile did not match the Graph-admitted current provider route",
		);
	const expected =
		binding.providerRef === "together"
			? createDeepSeekV4Flash0731TogetherStructuredProfileDefinition()
			: createDeepSeekV4Flash0731FireworksStructuredProfileDefinition();
	const expectedQualification = createInjectedNoNetworkProfileQualification({
		definition: expected,
		implementationManifestDigest: CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
	});
	if (
		target.targetDigest !== expected.target.targetDigest ||
		profile.profileDigest !== expected.profile.profileDigest ||
		binding.bindingDigest !== expected.binding.bindingDigest ||
		qualification.qualificationArtifactDigest !==
			MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST ||
		qualification.implementationManifestDigest !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.qualificationRef !== expectedQualification.qualificationRef ||
		qualification.qualificationDigest !== expectedQualification.qualificationDigest
	)
		throw new TypeError("root eval profile tuple is not the exact no-network-qualified tuple");
	const eligibilityMaterial = strictSnapshot({
		schemaVersion: CURRENT_PROFILE_ELIGIBILITY_SCHEMA,
		decisionRef: PROFILE_DECISION_REF,
		eligibilityRef: `current-profile-eligibility.${qualification.qualificationRef}.d76`,
		targetRef: target.targetRef,
		targetDigest: target.targetDigest,
		profileRef: profile.profileRef,
		profileDigest: profile.profileDigest,
		bindingRef: binding.bindingRef,
		bindingDigest: binding.bindingDigest,
		qualificationRef: qualification.qualificationRef,
		qualificationDigest: qualification.qualificationDigest,
		implementationManifestDigest: qualification.implementationManifestDigest,
		status: "eligible" as const,
		reasonCode: "root-graph-exact-profile-current",
	});
	const eligibility = validateCurrentProfileEligibility({
		...eligibilityMaterial,
		eligibilityDigest: empiricalStrictJsonDigest(eligibilityMaterial),
	});
	const resolverInput: ProfileResolverInput = Object.freeze({
		...input,
		currentEligibility: Object.freeze([eligibility]),
	});
	const resolution = deterministicProfileResolver.resolve(resolverInput);
	if (resolution.status !== "eligible")
		throw new TypeError(`root eval profile failed closed: ${resolution.failureCode}`);
	return Object.freeze({
		kind: "root-eval-profile-admission",
		eligibility,
		resolution,
		profile,
		binding,
	});
}

const MEMORY_PROVENANCE: Readonly<Record<HarnessArm, EvalMemoryProvenance>> = Object.freeze({
	cold: "none",
	"relevant-applied": "relevant-applied",
	"proposal-only": "proposal-only",
	"admission-rejected": "admission-rejected",
	"irrelevant-applied": "irrelevant-applied",
	"wrong-scope-applied": "wrong-scope-applied",
});

const TECHNICAL_FAILURE_REASONS = new Set<EvalProviderOutcomeReason>([
	"http-capacity-exhausted",
	"http-availability-exhausted",
	"http-terminal",
	"transport-failed",
	"transport-availability-exhausted",
	"response-route-invalid",
]);

const ROOT_EVAL_SOLUTION_IDENTITIES = Object.freeze([
	"work-item-execution",
	"agentic-work-item-memory-application",
	"agentic-memory-record-use",
	"agentic-memory-retrieval",
] as const);

function workItemId(campaignRef: string, replicate: number, arm: HarnessArm): string {
	return `${campaignRef}/replicate-${replicate}/${arm}`;
}

function sourceRequest(
	campaignRef: string,
	taskSetRef: string,
	taskManifestDigest: string,
	binding: RootEvalTaskBinding,
): EvalSourceWorkItemRequest {
	return Object.freeze({
		kind: "eval-source-work-item-request",
		campaignRef,
		taskSetRef,
		replicate: binding.replicate,
		taskInstanceRef: binding.taskInstanceRef,
		sourceWorkItemId: binding.sourceWorkItemId,
		sourceEvidenceDigest: binding.sourceEvidenceDigest,
		sourceInsightDigest: binding.sourceInsightDigest,
		taskManifestDigest,
		candidateCatalogDigest: binding.sourceCandidateCatalogDigest,
		candidateRefs: binding.sourceCandidateRefs,
	});
}

function dispatchBatch(
	campaignRef: string,
	request: EvalSourceWorkItemRequest,
	binding: RootEvalTaskBinding,
	provenance: Readonly<Record<HarnessArm, EvalMemoryProvenance>>,
): readonly EvalArmDispatch[] {
	return Object.freeze(
		HARNESS_ARMS.map((arm, armIndex) => {
			const irrelevant = arm === "irrelevant-applied";
			const targetCatalog = binding.targetCandidateCatalogs[arm];
			return Object.freeze({
				kind: "eval-arm-dispatch" as const,
				campaignRef,
				replicate: request.replicate,
				arm,
				armIndex,
				workItemId: workItemId(campaignRef, request.replicate, arm),
				taskInstanceRef: request.taskInstanceRef,
				sourceWorkItemId: request.sourceWorkItemId,
				sourceEvidenceDigest: request.sourceEvidenceDigest,
				sourceInsightDigest: request.sourceInsightDigest,
				memorySourceWorkItemId: irrelevant
					? binding.irrelevantSourceWorkItemId
					: request.sourceWorkItemId,
				memorySourceTaskInstanceRef: irrelevant
					? binding.irrelevantTaskInstanceRef
					: request.taskInstanceRef,
				memorySourceEvidenceDigest: irrelevant
					? binding.irrelevantSourceEvidenceDigest
					: request.sourceEvidenceDigest,
				memorySourceInsightDigest: irrelevant
					? binding.irrelevantSourceInsightDigest
					: request.sourceInsightDigest,
				memoryProvenance: provenance[arm],
				candidateCatalogDigest: targetCatalog.candidateCatalogDigest,
				candidateRefs: targetCatalog.candidateRefs,
			});
		}),
	);
}

function sourceWorkItemFor(
	request: EvalSourceWorkItemRequest,
): WorkItemProjection<Record<string, unknown>> {
	return Object.freeze({
		workItemId: request.sourceWorkItemId,
		summary: `Execute prior solution for transfer instance ${request.replicate}`,
		detailRefs: [{ kind: "eval-source-objective", id: `${request.sourceWorkItemId}/objective` }],
		acceptanceCriteria: [
			{
				criterionId: `${request.sourceWorkItemId}/verified-outcome`,
				statement:
					"Prior Work Item outcome and causal insight are verified before target execution",
			},
		],
		authoringRevision: 1,
		executionInputRevision: 1,
		lastEventId: `${request.sourceWorkItemId}/created`,
		revisionSourceRefs: [
			{ kind: "eval-task-instance", id: request.taskInstanceRef },
			{ kind: "eval-source-evidence", id: request.sourceEvidenceDigest },
		],
		customFields: {
			campaignRef: request.campaignRef,
			replicate: request.replicate,
			taskInstanceRef: request.taskInstanceRef,
			sourceEvidenceDigest: request.sourceEvidenceDigest,
			sourceInsightDigest: request.sourceInsightDigest,
			taskManifestDigest: request.taskManifestDigest,
			outcome: "pending",
			cleanupCompleted: false,
		},
		metadata: {
			topologyRevision: ROOT_EVAL_TOPOLOGY_REVISION,
			solutionIdentity: "work-item-execution",
			role: "causally-prior-source",
		},
	});
}

function verifiedSourceWorkItemFor(
	fact: EvalSourceVerificationFact,
): WorkItemProjection<Record<string, unknown>> {
	const pending = sourceWorkItemFor(fact.request);
	return Object.freeze({
		...pending,
		lastEventId: `${fact.sourceWorkItemId}/verified`,
		customFields: Object.freeze({
			...pending.customFields,
			outcome: "verified",
			cleanupCompleted: true,
			verificationResultDigest: fact.sourceEvidenceDigest,
		}),
	});
}

function sourcePlanFor(
	request: EvalSourceWorkItemRequest,
	effectTimeoutMs: number,
): WorkItemEffectPlanProposed<Record<string, unknown>> {
	return Object.freeze({
		kind: "work-item-effect-plan-proposed",
		planId: `${request.sourceWorkItemId}/plan`,
		workItemId: request.sourceWorkItemId,
		executionInputRevision: 1,
		joinPolicy: "all-required",
		proposedBy: "root-eval-source-topology",
		sourceRefs: [
			{ kind: "eval-task-instance", id: request.taskInstanceRef },
			{ kind: "eval-task-manifest", id: request.taskManifestDigest },
		],
		members: [
			{
				memberId: "source-provider-and-exact-tool",
				effectKind: "eval-provider-tool-effect",
				required: true,
				dependsOnMemberIds: [],
				goal: {
					kind: "eval-provider-tool-effect",
					input: {
						inputId: request.sourceWorkItemId,
						inputKind: "material-free-eval-source-binding",
						dataMode: "ref" as const,
						value: {
							bindingRef: `${request.sourceWorkItemId}/private-input`,
							digest: empiricalStrictJsonDigest({
								kind: "eval-private-source-input-binding",
								replicate: request.replicate,
								taskManifestDigest: request.taskManifestDigest,
							}),
							memoryProvenance: "none",
							memoryExposureCount: 0,
							memoryBindings: Object.freeze([]),
							memoryContextDigest: empiricalStrictJsonDigest({
								kind: "eval-source-memory-context",
								taskInstanceRef: request.taskInstanceRef,
								taskManifestDigest: request.taskManifestDigest,
							}),
							candidateCatalogDigest: request.candidateCatalogDigest,
							candidateRefs: request.candidateRefs,
						},
					},
				},
				limits: { maxRequests: 1, maxSteps: 1, timeoutMs: effectTimeoutMs },
				policyRefs: [{ kind: "eval-policy", id: ROOT_EVAL_TOPOLOGY_REVISION }],
				sourceRefs: [{ kind: "work-item", id: request.sourceWorkItemId }],
			},
		],
	});
}

function workItemFor(dispatch: EvalArmDispatch): WorkItemProjection<Record<string, unknown>> {
	return Object.freeze({
		workItemId: dispatch.workItemId,
		summary: `Evaluate ${dispatch.arm} memory provenance in replicate ${dispatch.replicate}`,
		detailRefs: [{ kind: "eval-objective", id: `${dispatch.workItemId}/objective` }],
		acceptanceCriteria: [
			{
				criterionId: `${dispatch.workItemId}/criterion`,
				statement: "Complete the admitted provider and exact-tool Work Item effect",
			},
		],
		authoringRevision: 1,
		executionInputRevision: 1,
		lastEventId: `${dispatch.workItemId}/created`,
		revisionSourceRefs: [
			{ kind: "eval-campaign", id: dispatch.campaignRef },
			{ kind: "eval-replicate", id: String(dispatch.replicate) },
			{ kind: "eval-arm", id: dispatch.arm },
		],
		customFields: {
			campaignRef: dispatch.campaignRef,
			replicate: dispatch.replicate,
			arm: dispatch.arm,
			armIndex: dispatch.armIndex,
			memoryProvenance: dispatch.memoryProvenance,
			taskInstanceRef: dispatch.taskInstanceRef,
			sourceWorkItemId: dispatch.sourceWorkItemId,
			sourceEvidenceDigest: dispatch.sourceEvidenceDigest,
			sourceInsightDigest: dispatch.sourceInsightDigest,
			memorySourceWorkItemId: dispatch.memorySourceWorkItemId,
			memorySourceTaskInstanceRef: dispatch.memorySourceTaskInstanceRef,
			memorySourceEvidenceDigest: dispatch.memorySourceEvidenceDigest,
			memorySourceInsightDigest: dispatch.memorySourceInsightDigest,
			candidateCatalogDigest: dispatch.candidateCatalogDigest,
			candidateRefs: dispatch.candidateRefs,
		},
		metadata: {
			topologyRevision: ROOT_EVAL_TOPOLOGY_REVISION,
			solutionIdentity: "work-item-execution",
		},
	});
}

function planFor(
	dispatch: EvalArmDispatch,
	memoryContext: {
		readonly exposedRecordIds: readonly string[];
		readonly bindings: readonly EvalMemoryBinding[];
		readonly contextDigest: string;
	},
	effectTimeoutMs: number,
): WorkItemEffectPlanProposed<Record<string, unknown>> {
	return Object.freeze({
		kind: "work-item-effect-plan-proposed",
		planId: `${dispatch.workItemId}/plan`,
		workItemId: dispatch.workItemId,
		executionInputRevision: 1,
		joinPolicy: "all-required",
		proposedBy: "root-eval-topology",
		sourceRefs: [{ kind: "eval-arm", id: dispatch.arm }],
		members: [
			{
				memberId: "provider-and-exact-tool",
				effectKind: "eval-provider-tool-effect",
				required: true,
				dependsOnMemberIds: [],
				goal: {
					kind: "eval-provider-tool-effect",
					input: {
						inputId: dispatch.workItemId,
						inputKind: "material-free-eval-binding",
						dataMode: "ref" as const,
						value: {
							bindingRef: `${dispatch.workItemId}/private-input`,
							digest: empiricalStrictJsonDigest({
								kind: "eval-private-input-binding",
								replicate: dispatch.replicate,
								arm: dispatch.arm,
							}),
							memoryProvenance: dispatch.memoryProvenance,
							memoryExposureCount: memoryContext.exposedRecordIds.length,
							memoryBindings: memoryContext.bindings,
							memoryContextDigest: memoryContext.contextDigest,
							candidateCatalogDigest: dispatch.candidateCatalogDigest,
							candidateRefs: dispatch.candidateRefs,
						},
					},
				},
				limits: { maxRequests: 1, maxSteps: 1, timeoutMs: effectTimeoutMs },
				policyRefs: [{ kind: "eval-policy", id: ROOT_EVAL_TOPOLOGY_REVISION }],
				sourceRefs: [{ kind: "work-item", id: dispatch.workItemId }],
			},
		],
	});
}

export function validateEvalEffectProposalAgainstWorkItemPlan(
	proposal: Pick<
		EvalEffectProposal,
		"workItemId" | "workItemRole" | "workItemPlanId" | "workItemPlanDigest" | "timeoutMs"
	>,
	plan: EvalWorkItemPlanSnapshot,
): void {
	const member = plan.members[0];
	const limits = member?.limits;
	if (
		plan.workItemId !== proposal.workItemId ||
		plan.planId !== proposal.workItemPlanId ||
		plan.members.length !== 1 ||
		member?.memberId !==
			(proposal.workItemRole === "source"
				? "source-provider-and-exact-tool"
				: "provider-and-exact-tool") ||
		member.effectKind !== "eval-provider-tool-effect" ||
		member.required !== true ||
		(member.dependsOnMemberIds?.length ?? 0) !== 0 ||
		limits === undefined ||
		limits.maxRequests !== 1 ||
		limits.maxSteps !== 1 ||
		!Number.isSafeInteger(limits.timeoutMs) ||
		limits.timeoutMs === undefined ||
		limits.timeoutMs < 1 ||
		limits.timeoutMs > 300_000 ||
		proposal.timeoutMs !== limits.timeoutMs ||
		proposal.workItemPlanDigest !== evalWorkItemPlanAuthorityDigest(plan)
	)
		throw new TypeError("provider proposal does not exactly match its Work Item plan authority");
}

export function evalWorkItemPlanAuthorityDigest(plan: EvalWorkItemPlanSnapshot): string {
	const canonicalize = (
		value: unknown,
		path: string,
		seen: Set<object>,
	): StrictJsonValue | undefined => {
		if (value === undefined) return undefined;
		if (value === null || typeof value === "string" || typeof value === "boolean") return value;
		if (typeof value === "number") {
			if (!Number.isFinite(value)) throw new TypeError(`${path} contained a non-finite number`);
			return value;
		}
		if (typeof value !== "object") throw new TypeError(`${path} was not strict JSON authority`);
		if (seen.has(value)) throw new TypeError(`${path} contained a cycle`);
		seen.add(value);
		try {
			const ownKeys = Reflect.ownKeys(value);
			if (ownKeys.some((key) => typeof key === "symbol"))
				throw new TypeError(`${path} contained symbol authority`);
			if (Array.isArray(value)) {
				const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
				const length = lengthDescriptor?.value;
				if (!Number.isSafeInteger(length) || length < 0 || ownKeys.length !== length + 1)
					throw new TypeError(`${path} was sparse or contained custom array authority`);
				const result: StrictJsonValue[] = [];
				for (let index = 0; index < length; index += 1) {
					const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
					if (
						descriptor === undefined ||
						descriptor.enumerable !== true ||
						!("value" in descriptor)
					)
						throw new TypeError(`${path}[${index}] had a non-data descriptor`);
					const canonical = canonicalize(descriptor.value, `${path}[${index}]`, seen);
					if (canonical === undefined) throw new TypeError(`${path}[${index}] contained undefined`);
					result.push(canonical);
				}
				return result;
			}
			const prototype = Object.getPrototypeOf(value);
			if (prototype !== Object.prototype && prototype !== null)
				throw new TypeError(`${path} was not a plain authority object`);
			const output: Record<string, StrictJsonValue> = {};
			for (const key of ownKeys as string[]) {
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor))
					throw new TypeError(`${path}.${key} had a non-data or non-enumerable descriptor`);
				const canonical = canonicalize(descriptor.value, `${path}.${key}`, seen);
				if (canonical !== undefined)
					Object.defineProperty(output, key, {
						value: canonical,
						enumerable: true,
						configurable: true,
						writable: true,
					});
			}
			return output;
		} finally {
			seen.delete(value);
		}
	};
	const canonicalPlan = canonicalize(plan, "Work Item admitted plan", new Set<object>());
	if (canonicalPlan === undefined)
		throw new TypeError("Work Item admitted plan authority was unavailable");
	return empiricalStrictJsonDigest({
		kind: "eval-work-item-admitted-plan-authority",
		plan: canonicalPlan,
	});
}

function memoryRecord(dispatch: EvalArmDispatch): AgenticMemoryRecord<MemoryPayload> {
	const relevant = dispatch.arm !== "irrelevant-applied";
	return Object.freeze({
		id: `${dispatch.workItemId}/memory-record`,
		kind: "semantic",
		persistenceLevel: "project",
		artifactKind: "insight",
		scope: {
			projectId: dispatch.arm === "wrong-scope-applied" ? "wrong-project" : "eval-project",
		},
		fragment: {
			id: `${dispatch.workItemId}/memory-fragment`,
			payload: {
				bindingRef: `${dispatch.workItemId}/private-memory`,
				digest: empiricalStrictJsonDigest({
					kind: "eval-private-memory-binding",
					taskInstanceRef: dispatch.memorySourceTaskInstanceRef,
					sourceWorkItemId: dispatch.memorySourceWorkItemId,
					sourceEvidenceDigest: dispatch.memorySourceEvidenceDigest,
					sourceInsightDigest: dispatch.memorySourceInsightDigest,
					arm: dispatch.arm,
				}),
			},
			tNs: BigInt(dispatch.replicate * 10 + dispatch.armIndex),
			confidence: 1,
			tags: relevant
				? ["relevant", "eval-memory", `occurrence:${dispatch.workItemId}`]
				: ["irrelevant", "eval-memory", `occurrence:${dispatch.workItemId}`],
			sources: [dispatch.memorySourceWorkItemId, dispatch.memorySourceEvidenceDigest],
		},
	});
}

function rejectedAdmissionReservation(
	dispatch: EvalArmDispatch,
): AgenticMemoryRecord<MemoryPayload> {
	const candidate = memoryRecord(dispatch);
	return Object.freeze({
		...candidate,
		scope: { projectId: "admission-reservation-only" },
		fragment: Object.freeze({
			...candidate.fragment,
			payload: Object.freeze({
				bindingRef: `${dispatch.workItemId}/rejected-reservation`,
				digest: empiricalStrictJsonDigest({
					kind: "eval-admission-rejection-reservation",
					taskInstanceRef: dispatch.taskInstanceRef,
				}),
			}),
			tags: Object.freeze(["admission-rejection-reservation"]),
		}),
	});
}

function memoryCandidate(
	dispatch: EvalArmDispatch,
): readonly AgenticWorkItemMemoryRecordCandidate<MemoryPayload>[] {
	if (dispatch.arm === "cold") return Object.freeze([]);
	return Object.freeze([
		Object.freeze({
			kind: "agentic-work-item-memory-record-candidate" as const,
			candidateId: `${dispatch.workItemId}/memory-candidate`,
			workItemId: dispatch.memorySourceWorkItemId,
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material" as const,
				operation: "create" as const,
				operationVersion: 1 as const,
				record: memoryRecord(dispatch),
				sourceRefs: [
					{ kind: "work-item", id: dispatch.memorySourceWorkItemId },
					{ kind: "eval-source-evidence", id: dispatch.memorySourceEvidenceDigest },
					{ kind: "eval-source-insight", id: dispatch.memorySourceInsightDigest },
					{ kind: "eval-memory-provenance", id: dispatch.memoryProvenance },
				],
			},
			sourceRefs: [
				{ kind: "work-item", id: dispatch.memorySourceWorkItemId },
				{ kind: "eval-arm", id: dispatch.arm },
			],
		}),
	]);
}

function memoryUseRequest(dispatch: EvalArmDispatch): AgenticMemoryRecordUseRequest {
	return Object.freeze({
		format: "graphrefly.agenticMemoryRecordUseRequest",
		version: 1,
		requestId: `${dispatch.workItemId}/memory-use`,
		subject: { kind: "work-item", id: dispatch.workItemId },
		purpose: { kind: "eval-arm", id: dispatch.arm },
		scope: { kind: "project", id: "eval-project" },
		sourceRevisions: [{ kind: "eval-topology", id: ROOT_EVAL_TOPOLOGY_REVISION, revision: "3" }],
		policyCoordinates: [
			{ kind: "memory-provenance", id: dispatch.memoryProvenance, revision: "1" },
		],
		authorityCoordinates: [{ kind: "root-eval-graph", id: dispatch.campaignRef, revision: "1" }],
	});
}

function armFromWorkItemId(id: string): HarnessArm | undefined {
	return HARNESS_ARMS.find((arm) => id.endsWith(`/${arm}`));
}

function executionCoordinateFromWorkItemId(id: string): Readonly<{
	readonly arm: HarnessArm | "source";
	readonly workItemRole: "source" | "target";
}> | null {
	if (id.endsWith("/source-work-item"))
		return Object.freeze({ arm: "source" as const, workItemRole: "source" as const });
	const arm = armFromWorkItemId(id);
	return arm === undefined ? null : Object.freeze({ arm, workItemRole: "target" as const });
}

function replicateFromWorkItemId(id: string): number {
	const match = /\/replicate-(\d+)\//.exec(id) ?? /\/instance-(\d+)\/source-work-item$/u.exec(id);
	return match === null ? 0 : Number(match[1]);
}

function safeOutput(outcome: EvalEffectOutcome) {
	return Object.freeze({
		kind: "eval-effect-output",
		value: Object.freeze({
			workItemId: outcome.workItemId,
			replicate: outcome.replicate,
			arm: outcome.arm,
			providerResultDigest: outcome.resultDigest,
			resultDigest: outcome.resultDigest,
		}),
	});
}

function isDigest(value: unknown): value is string {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function effectArgumentsDigest(input: {
	readonly toolRef: "graphrefly.eval.exact-candidate-tool.v2";
	readonly candidateRef: string;
	readonly candidateCatalogDigest: string;
}): string {
	return empiricalStrictJsonDigest({
		toolRef: input.toolRef,
		candidateRef: input.candidateRef,
		candidateCatalogDigest: input.candidateCatalogDigest,
	});
}

function withoutUndefined(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((entry) => withoutUndefined(entry));
	if (value !== null && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, entry]) => entry !== undefined)
				.map(([key, entry]) => [key, withoutUndefined(entry)]),
		);
	return value;
}

function admissionReceiptDigest(
	admission: Omit<EvalAdmittedEffect, "receiptDigest"> | EvalAdmittedEffect,
): string {
	const { receiptDigest: _receiptDigest, ...material } = admission as EvalAdmittedEffect;
	return empiricalStrictJsonDigest(withoutUndefined(material));
}

function toolAdmissionReceiptDigest(
	admission: Omit<EvalAdmittedToolEffect, "receiptDigest"> | EvalAdmittedToolEffect,
): string {
	const { receiptDigest: _receiptDigest, ...material } = admission as EvalAdmittedToolEffect;
	return empiricalStrictJsonDigest(withoutUndefined(material));
}

/** Package-private executor boundary: validate the complete Graph admission before any side effect. */
export function assertRootEvalToolAdmissionReceipt(
	effect: EvalAdmittedToolEffect,
): EvalAdmittedToolEffect {
	const providerOutcome = validateProviderOutcome(effect.providerOutcome);
	const proposal = providerOutcome.toolProposal;
	if (
		effect?.kind !== "eval-admitted-tool-effect" ||
		effect.receiptDigest !== toolAdmissionReceiptDigest(effect) ||
		effect.executionId !== effect.toolAdmissionId ||
		effect.toolAdmissionId !== `${providerOutcome.admissionId}/exact-tool` ||
		effect.providerAdmission.receiptDigest !== admissionReceiptDigest(effect.providerAdmission) ||
		effect.providerAdmission.receiptDigest !== providerOutcome.admission.receiptDigest ||
		effect.providerOutcome.executionId !== effect.providerAdmission.executionId ||
		effect.effectRunId !== providerOutcome.effectRunId ||
		effect.workItemId !== providerOutcome.workItemId ||
		effect.replicate !== providerOutcome.replicate ||
		effect.arm !== providerOutcome.arm ||
		effect.workItemRole !== providerOutcome.workItemRole ||
		effect.providerLogicalAttempt !== providerOutcome.providerLogicalAttempt ||
		effect.dispatchOrdinal !== providerOutcome.dispatchOrdinal ||
		effect.capacityRetryOrdinal !== providerOutcome.capacityRetryOrdinal ||
		effect.availabilityRetryOrdinal !== providerOutcome.availabilityRetryOrdinal ||
		proposal === null ||
		effect.toolRef !== proposal.toolRef ||
		effect.candidateRef !== proposal.candidateRef ||
		effect.candidateCatalogDigest !== proposal.candidateCatalogDigest ||
		effect.argumentsDigest !== proposal.argumentsDigest ||
		effect.argumentsDigest !== effectArgumentsDigest(effect) ||
		!effect.candidateRef.startsWith(`${effect.workItemId}/candidate-`)
	)
		throw new TypeError("exact tool effect did not carry one complete Graph admission receipt");
	return effect;
}

function retryDelayReceiptDigest(
	admission: Omit<EvalRetryDelayEffect, "receiptDigest"> | EvalRetryDelayEffect,
): string {
	const { receiptDigest: _receiptDigest, ...material } = admission as EvalRetryDelayEffect;
	return empiricalStrictJsonDigest(withoutUndefined(material));
}

function billingObservationReceiptDigest(
	admission: Omit<EvalBillingObservationEffect, "receiptDigest"> | EvalBillingObservationEffect,
): string {
	const { receiptDigest: _receiptDigest, ...material } = admission as EvalBillingObservationEffect;
	return empiricalStrictJsonDigest(withoutUndefined(material));
}

function validateCurrentKeySnapshot(snapshot: EvalCurrentKeySnapshot): EvalCurrentKeySnapshot {
	if (
		snapshot?.kind !== "eval-current-key-snapshot" ||
		!isDigest(snapshot.keyBindingDigest) ||
		!isDigest(snapshot.admissionDigest) ||
		!Number.isSafeInteger(snapshot.limitMicrousd) ||
		!Number.isSafeInteger(snapshot.remainingMicrousd) ||
		!Number.isSafeInteger(snapshot.usageMicrousd) ||
		snapshot.limitMicrousd < 1 ||
		snapshot.remainingMicrousd < 0 ||
		snapshot.usageMicrousd < 0 ||
		snapshot.remainingMicrousd + snapshot.usageMicrousd !== snapshot.limitMicrousd ||
		snapshot.limitReset !== "none" ||
		snapshot.isManagementKey !== false
	)
		throw new TypeError("eval current-key snapshot was invalid");
	return snapshot;
}

function validateBillingObservationOutcome(
	outcome: EvalBillingObservationOutcome,
): EvalBillingObservationOutcome {
	const admission = outcome.admission;
	if (
		outcome.kind !== "eval-billing-observation-outcome" ||
		admission?.kind !== "eval-admitted-billing-observation" ||
		outcome.executionId !== admission.executionId ||
		outcome.observation !== admission.observation ||
		admission.receiptDigest !== billingObservationReceiptDigest(admission) ||
		(outcome.status === "completed") !== (outcome.currentKeyAfter !== null) ||
		!isDigest(outcome.resultDigest)
	)
		throw new TypeError("billing observation outcome lost its Graph admission identity");
	if (outcome.currentKeyAfter !== null) validateCurrentKeySnapshot(outcome.currentKeyAfter);
	return outcome;
}

function validateProviderOutcomeShape(
	outcome: EvalProviderOutcome,
	mode: "candidate" | "canonical",
): EvalProviderOutcome {
	const admission = outcome.admission;
	const proposal = outcome.toolProposal;
	const requestPayload = admission?.request?.payload as
		| {
				readonly candidateCatalogDigest?: unknown;
				readonly candidateRefs?: unknown;
		  }
		| undefined;
	const admittedCandidateRefs = requestPayload?.candidateRefs;
	const admittedCandidateCatalogDigest = requestPayload?.candidateCatalogDigest;
	const coordinate = executionCoordinateFromWorkItemId(outcome.workItemId);
	const candidate = mode === "candidate";
	if (
		outcome.kind !== "eval-provider-outcome" ||
		admission?.kind !== "eval-admitted-effect" ||
		outcome.admissionId !== admission.admissionId ||
		outcome.executionId !== admission.executionId ||
		outcome.operationId !== admission.operationId ||
		admission.receiptDigest !== admissionReceiptDigest(admission) ||
		outcome.effectRunId !== admission.effectRunId ||
		outcome.workItemId !== admission.workItemId ||
		outcome.replicate !== admission.replicate ||
		outcome.arm !== admission.arm ||
		outcome.workItemRole !== admission.workItemRole ||
		outcome.providerLogicalAttempt !== admission.providerLogicalAttempt ||
		outcome.dispatchOrdinal !== admission.dispatchOrdinal ||
		outcome.capacityRetryOrdinal !== admission.capacityRetryOrdinal ||
		outcome.availabilityRetryOrdinal !== admission.availabilityRetryOrdinal ||
		outcome.providerLogicalAttempt !== 1 ||
		!isDigest(admittedCandidateCatalogDigest) ||
		!Array.isArray(admittedCandidateRefs) ||
		admittedCandidateRefs.length !== 2 ||
		admittedCandidateRefs.some(
			(candidateRef) =>
				typeof candidateRef !== "string" || candidateRef.length < 1 || candidateRef.length > 512,
		) ||
		admittedCandidateRefs[0] === admittedCandidateRefs[1] ||
		!Number.isSafeInteger(outcome.dispatchOrdinal) ||
		outcome.dispatchOrdinal < 1 ||
		outcome.dispatchOrdinal > ROOT_EVAL_MAX_PROVIDER_DISPATCHES_PER_WORK_ITEM ||
		!Number.isSafeInteger(outcome.capacityRetryOrdinal) ||
		outcome.capacityRetryOrdinal < 0 ||
		outcome.capacityRetryOrdinal > ROOT_EVAL_MAX_CAPACITY_RETRIES ||
		!Number.isSafeInteger(outcome.availabilityRetryOrdinal) ||
		outcome.availabilityRetryOrdinal < 0 ||
		outcome.availabilityRetryOrdinal > ROOT_EVAL_MAX_AVAILABILITY_RETRIES ||
		outcome.dispatchOrdinal !==
			1 + outcome.capacityRetryOrdinal + outcome.availabilityRetryOrdinal ||
		coordinate?.arm !== outcome.arm ||
		coordinate?.workItemRole !== outcome.workItemRole ||
		replicateFromWorkItemId(outcome.workItemId) !== outcome.replicate ||
		typeof outcome.dispatchAttempted !== "boolean" ||
		!Number.isSafeInteger(outcome.dispatchElapsedMs) ||
		outcome.dispatchElapsedMs < 0 ||
		outcome.dispatchElapsedMs > outcome.elapsedMs ||
		(!outcome.dispatchAttempted && outcome.dispatchElapsedMs !== 0) ||
		!(
			outcome.providerResponseKind === "http" ||
			outcome.providerResponseKind === "transport" ||
			outcome.providerResponseKind === "none"
		) ||
		(outcome.providerResponseKind === "http" &&
			(!Number.isSafeInteger(outcome.httpStatus) ||
				(outcome.httpStatus ?? 0) < 100 ||
				(outcome.httpStatus ?? 0) > 599)) ||
		(outcome.providerResponseKind !== "http" && outcome.httpStatus !== null) ||
		(outcome.providerErrorCode !== null &&
			(typeof outcome.providerErrorCode !== "string" ||
				outcome.providerErrorCode.length < 1 ||
				outcome.providerErrorCode.length > 128 ||
				outcome.providerErrorCode !== outcome.providerErrorCode.toLowerCase())) ||
		(outcome.providerResponseKind !== "http" && outcome.providerErrorCode !== null) ||
		typeof outcome.transportNoToolSideEffect !== "boolean" ||
		outcome.transportNoToolSideEffect !== (outcome.providerResponseKind === "transport") ||
		(outcome.providerResponseKind !== "none" && !outcome.dispatchAttempted) ||
		!Number.isSafeInteger(outcome.costMicrousd) ||
		outcome.costMicrousd < 0 ||
		(outcome.costEvidence === "reservation-upper-bound" &&
			outcome.costMicrousd > admission.reservationMicrousd) ||
		!(
			outcome.costEvidence === "provider-reported" ||
			outcome.costEvidence === "reservation-upper-bound" ||
			outcome.costEvidence === "policy-qualified-nonbillable"
		) ||
		!Number.isSafeInteger(outcome.pricingRoundingAllowanceMicrousd) ||
		outcome.pricingRoundingAllowanceMicrousd < 0 ||
		outcome.pricingRoundingAllowanceMicrousd > 3 ||
		outcome.pricingRoundingAllowanceMicrousd > outcome.costMicrousd ||
		(outcome.costEvidence === "reservation-upper-bound" &&
			outcome.pricingRoundingAllowanceMicrousd !== 0) ||
		!Number.isSafeInteger(admission.timeoutMs) ||
		admission.timeoutMs < 1 ||
		admission.timeoutMs > 300_000 ||
		!Number.isSafeInteger(outcome.elapsedMs) ||
		outcome.elapsedMs < 0 ||
		!Number.isSafeInteger(outcome.retryAfterMs) ||
		outcome.retryAfterMs < 0 ||
		outcome.retryAfterMs >
			(candidate
				? ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS + 1
				: ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS) ||
		(candidate
			? outcome.responseRetryAfterMs !== undefined
			: !Number.isSafeInteger(outcome.responseRetryAfterMs) ||
				(outcome.responseRetryAfterMs ?? -1) < 0 ||
				(outcome.responseRetryAfterMs ?? Infinity) >
					ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS + 1) ||
		typeof outcome.cleanupCompleted !== "boolean" ||
		!isDigest(outcome.resultDigest) ||
		!(
			outcome.status === "tool-proposed" ||
			outcome.status === "failed" ||
			outcome.status === "retryable"
		) ||
		!EVAL_PROVIDER_OUTCOME_REASON_CODES.includes(outcome.reason) ||
		(candidate &&
			(outcome.reason === "http-capacity-exhausted" ||
				outcome.reason === "http-availability-exhausted" ||
				outcome.reason === "transport-availability-exhausted")) ||
		(outcome.status === "tool-proposed") !== (outcome.reason === "tool-proposed") ||
		(outcome.status === "retryable") !==
			(outcome.reason === "http-capacity-retryable" ||
				outcome.reason === "http-availability-retryable" ||
				outcome.reason === "transport-availability-retryable") ||
		(outcome.recoveryClass === "capacity") !==
			(outcome.reason === "http-capacity-retryable" ||
				outcome.reason === "http-capacity-exhausted") ||
		(outcome.recoveryClass === "availability") !==
			(outcome.reason === "http-availability-retryable" ||
				outcome.reason === "http-availability-exhausted" ||
				outcome.reason === "transport-availability-retryable" ||
				outcome.reason === "transport-availability-exhausted") ||
		(outcome.recoveryClass === null) !==
			!(
				outcome.reason === "http-capacity-retryable" ||
				outcome.reason === "http-capacity-exhausted" ||
				outcome.reason === "http-availability-retryable" ||
				outcome.reason === "http-availability-exhausted" ||
				outcome.reason === "transport-availability-retryable" ||
				outcome.reason === "transport-availability-exhausted"
			) ||
		(outcome.status === "tool-proposed") !== (proposal !== null) ||
		(outcome.status !== "retryable" && outcome.retryAfterMs !== 0) ||
		(!candidate && outcome.status === "retryable" && outcome.retryAfterMs < 60_000) ||
		(!candidate &&
			outcome.reason === "http-capacity-retryable" &&
			outcome.capacityRetryOrdinal >= ROOT_EVAL_MAX_CAPACITY_RETRIES) ||
		(!candidate &&
			(outcome.reason === "http-availability-retryable" ||
				outcome.reason === "transport-availability-retryable") &&
			outcome.availabilityRetryOrdinal >= ROOT_EVAL_MAX_AVAILABILITY_RETRIES) ||
		(outcome.status === "tool-proposed" ? outcome.cleanupCompleted : !outcome.cleanupCompleted) ||
		(proposal !== null &&
			(proposal.toolRef !== "graphrefly.eval.exact-candidate-tool.v2" ||
				proposal.candidateRef.length < 1 ||
				proposal.candidateRef.length > 512 ||
				!isDigest(proposal.candidateCatalogDigest) ||
				!admittedCandidateRefs.includes(proposal.candidateRef) ||
				proposal.candidateCatalogDigest !== admittedCandidateCatalogDigest ||
				proposal.argumentsDigest !== effectArgumentsDigest(proposal)))
	)
		throw new TypeError(
			`provider outcome does not exactly match its Graph admission receipt (${String(outcome?.status)}/${String(outcome?.reason)}/dispatchOrdinal-${String(outcome?.dispatchOrdinal)})`,
		);
	if (outcome.costEvidence === "policy-qualified-nonbillable") {
		validateNonbillableCostEvidence(outcome.nonbillableEvidence, admission, outcome.resultDigest);
		if (
			outcome.providerResponseKind !== "http" ||
			outcome.httpStatus !== 429 ||
			!outcome.dispatchAttempted ||
			outcome.costMicrousd !== 0 ||
			outcome.pricingRoundingAllowanceMicrousd !== 0 ||
			outcome.toolProposal !== null ||
			admission.providerRef !== "fireworks" ||
			admission.providerModelRef !== "deepseek/deepseek-v4-flash-0731"
		)
			throw new TypeError("policy-qualified cost contradicted its provider outcome");
	} else if (outcome.nonbillableEvidence !== undefined) {
		throw new TypeError("nonbillable evidence cannot override reported or unknown cost");
	}
	return outcome;
}

function validateProviderOutcomeCandidate(outcome: EvalProviderOutcome): EvalProviderOutcome {
	return validateProviderOutcomeShape(outcome, "candidate");
}

function validateProviderOutcome(outcome: EvalProviderOutcome): EvalProviderOutcome {
	return validateProviderOutcomeShape(outcome, "canonical");
}

function normalizeProviderOutcomeCandidate(outcome: EvalProviderOutcome): EvalProviderOutcome {
	const input = validateProviderOutcomeCandidate(outcome);
	const candidate = Object.freeze({ ...input, responseRetryAfterMs: input.retryAfterMs });
	// D154: an adapter/instrumentation fault stays a fault even when an HTTP
	// response arrived. Preserve its independent cost and route-feedback evidence.
	if (candidate.reason === "executor-failed") return validateProviderOutcome(candidate);
	let derived = candidate;
	if (candidate.providerResponseKind === "transport") {
		derived = Object.freeze({
			...candidate,
			status: "retryable" as const,
			reason: "transport-availability-retryable" as const,
			recoveryClass: "availability" as const,
			retryAfterMs: candidate.retryAfterMs,
			toolProposal: null,
		});
	} else if (candidate.providerResponseKind === "http") {
		const status = candidate.httpStatus!;
		if (status === 429) {
			derived = Object.freeze({
				...candidate,
				status: "retryable" as const,
				reason: "http-capacity-retryable" as const,
				recoveryClass: "capacity" as const,
				toolProposal: null,
			});
		} else if (status < 200 || status >= 300) {
			const availability =
				[408, 425, 502, 503, 504, 520].includes(status) ||
				([409, 423, 424, 500].includes(status) &&
					(candidate.retryAfterMs > 0 ||
						(candidate.providerErrorCode !== null &&
							EVAL_PROVIDER_CONDITIONAL_AVAILABILITY_CODES.includes(
								candidate.providerErrorCode as (typeof EVAL_PROVIDER_CONDITIONAL_AVAILABILITY_CODES)[number],
							))));
			derived = Object.freeze({
				...candidate,
				status: availability ? ("retryable" as const) : ("failed" as const),
				reason: availability
					? ("http-availability-retryable" as const)
					: ("http-terminal" as const),
				recoveryClass: availability ? ("availability" as const) : null,
				retryAfterMs: availability ? candidate.retryAfterMs : 0,
				toolProposal: null,
			});
		} else if (candidate.status === "retryable" || candidate.recoveryClass !== null) {
			throw new TypeError("successful HTTP provider receipt claimed infrastructure recovery");
		}
	} else if (candidate.status === "retryable" || candidate.recoveryClass !== null) {
		throw new TypeError("pre-dispatch provider outcome claimed infrastructure recovery");
	}
	if (derived.status !== "retryable" || derived.recoveryClass === null)
		return validateProviderOutcome(derived);
	const overDelayEnvelope = derived.retryAfterMs > ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS;
	const exhausted =
		overDelayEnvelope ||
		(derived.recoveryClass === "capacity"
			? derived.capacityRetryOrdinal >= ROOT_EVAL_MAX_CAPACITY_RETRIES
			: derived.availabilityRetryOrdinal >= ROOT_EVAL_MAX_AVAILABILITY_RETRIES);
	if (exhausted) {
		const reason: EvalProviderOutcomeReason =
			derived.recoveryClass === "capacity"
				? "http-capacity-exhausted"
				: derived.reason === "transport-availability-retryable"
					? "transport-availability-exhausted"
					: "http-availability-exhausted";
		return validateProviderOutcome(
			Object.freeze({ ...derived, status: "failed" as const, reason, retryAfterMs: 0 }),
		);
	}
	const fallbackMs =
		derived.recoveryClass === "capacity"
			? ([60_000, 120_000, 240_000] as const)[derived.capacityRetryOrdinal]
			: 60_000;
	if (fallbackMs === undefined)
		throw new TypeError("provider recovery fallback was unavailable for its Graph coordinate");
	return validateProviderOutcome(
		Object.freeze({
			...derived,
			retryAfterMs: Math.max(fallbackMs, derived.retryAfterMs),
		}),
	);
}

function validateRetryDelayOutcome(outcome: EvalRetryDelayOutcome): EvalRetryDelayOutcome {
	const admission = outcome.admission;
	if (
		outcome.kind !== "eval-retry-delay-outcome" ||
		admission?.kind !== "eval-admitted-retry-delay" ||
		outcome.executionId !== admission.executionId ||
		admission.receiptDigest !== retryDelayReceiptDigest(admission) ||
		!Number.isSafeInteger(admission.batchSize) ||
		admission.batchSize < 1 ||
		admission.batchSize > HARNESS_ARMS.length ||
		!Number.isSafeInteger(outcome.elapsedMs) ||
		outcome.elapsedMs < admission.delayMs ||
		!isDigest(outcome.resultDigest) ||
		!(outcome.status === "completed" || outcome.status === "failed")
	)
		throw new TypeError("retry delay outcome does not match its Graph admission receipt");
	return outcome;
}

function validateOutcomeReceipt(outcome: EvalEffectOutcome): EvalEffectOutcome {
	const admission = outcome.admission;
	const coordinate = executionCoordinateFromWorkItemId(outcome.workItemId);
	if (
		outcome.kind !== "eval-effect-outcome" ||
		(admission?.kind !== "eval-admitted-tool-effect" &&
			admission?.kind !== "eval-admitted-effect") ||
		outcome.executionId !== admission.executionId ||
		outcome.admissionId !==
			(admission.kind === "eval-admitted-tool-effect"
				? admission.providerAdmission.admissionId
				: admission.admissionId) ||
		outcome.toolAdmissionId !==
			(admission.kind === "eval-admitted-tool-effect" ? admission.toolAdmissionId : null) ||
		outcome.operationId !==
			(admission.kind === "eval-admitted-tool-effect"
				? admission.providerAdmission.operationId
				: admission.operationId) ||
		outcome.argumentsDigest !==
			(admission.kind === "eval-admitted-tool-effect" ? admission.argumentsDigest : null) ||
		(admission.kind === "eval-admitted-tool-effect"
			? admission.receiptDigest !== toolAdmissionReceiptDigest(admission)
			: admission.receiptDigest !== admissionReceiptDigest(admission)) ||
		outcome.effectRunId !== admission.effectRunId ||
		outcome.workItemId !== admission.workItemId ||
		outcome.replicate !== admission.replicate ||
		outcome.arm !== admission.arm ||
		outcome.workItemRole !== admission.workItemRole ||
		outcome.providerLogicalAttempt !== admission.providerLogicalAttempt ||
		outcome.dispatchOrdinal !== admission.dispatchOrdinal ||
		outcome.capacityRetryOrdinal !== admission.capacityRetryOrdinal ||
		outcome.availabilityRetryOrdinal !== admission.availabilityRetryOrdinal ||
		coordinate?.arm !== outcome.arm ||
		coordinate?.workItemRole !== outcome.workItemRole ||
		replicateFromWorkItemId(outcome.workItemId) !== outcome.replicate ||
		!Number.isSafeInteger(outcome.costMicrousd) ||
		outcome.costMicrousd !== 0 ||
		!Number.isSafeInteger(outcome.elapsedMs) ||
		outcome.elapsedMs < 0 ||
		!isDigest(outcome.resultDigest) ||
		!isDigest(outcome.evidence?.expectedDigest) ||
		!isDigest(outcome.evidence.actualDigest) ||
		!(["scoped-change", "no-change", "wrong-scope"] as const).includes(outcome.evidence.diff) ||
		typeof outcome.evidence.cleanupCompleted !== "boolean" ||
		!(outcome.status === "completed" || outcome.status === "failed") ||
		!(["equivalent", "different"] as const).includes(outcome.evidence.publicSemantic) ||
		!(["pass", "fail"] as const).includes(outcome.evidence.hiddenVerifier)
	)
		throw new TypeError("eval outcome does not exactly match its Graph admission receipt");
	return outcome;
}

export function assertRootEvalOutcomeReceipt(outcome: EvalEffectOutcome): EvalEffectOutcome {
	return validateOutcomeReceipt(outcome);
}

function providerFailureOutcome(provider: EvalProviderOutcome): EvalEffectOutcome {
	validateProviderOutcome(provider);
	if (provider.status !== "failed") throw new TypeError("provider failure projection drifted");
	const digest = provider.resultDigest;
	return Object.freeze({
		kind: "eval-effect-outcome" as const,
		admission: provider.admission,
		executionId: provider.executionId,
		admissionId: provider.admissionId,
		toolAdmissionId: null,
		operationId: provider.operationId,
		argumentsDigest: null,
		effectRunId: provider.effectRunId,
		workItemId: provider.workItemId,
		replicate: provider.replicate,
		arm: provider.arm,
		workItemRole: provider.workItemRole,
		providerLogicalAttempt: provider.providerLogicalAttempt,
		dispatchOrdinal: provider.dispatchOrdinal,
		capacityRetryOrdinal: provider.capacityRetryOrdinal,
		availabilityRetryOrdinal: provider.availabilityRetryOrdinal,
		status: "failed" as const,
		costMicrousd: 0 as const,
		elapsedMs: provider.elapsedMs,
		resultDigest: digest,
		evidence: Object.freeze({
			expectedDigest: digest,
			actualDigest: digest,
			diff: "no-change" as const,
			cleanupCompleted: provider.cleanupCompleted,
			publicSemantic: "different" as const,
			hiddenVerifier: "fail" as const,
		}),
	});
}

function finalResult(outcome: EvalEffectOutcome): EffectRunResult | undefined {
	validateOutcomeReceipt(outcome);
	const common = {
		kind: "effect-run-result" as const,
		resultId: `${outcome.effectRunId}/result`,
		effectRunId: outcome.effectRunId,
		operationId: outcome.admissionId,
		completedAtMs: outcome.elapsedMs,
		sourceRefs: [
			{ kind: "work-item", id: outcome.workItemId },
			{ kind: "eval-admission", id: outcome.admissionId },
		],
		metadata: {
			replicate: outcome.replicate,
			arm: outcome.arm,
			resultDigest: outcome.resultDigest,
		},
	};
	return outcome.status === "completed"
		? Object.freeze({ ...common, status: "completed" as const, output: safeOutput(outcome) })
		: Object.freeze({
				...common,
				status: "failed" as const,
				error: {
					kind: "issue" as const,
					code: "injected-eval-effect-failed",
					message: "The admitted no-network eval effect failed.",
					severity: "error" as const,
				},
			});
}

function emitCampaignState(
	ctx: { down(messages: readonly (readonly ["DATA", unknown])[]): void },
	campaignRef: string,
	contract: EvalCampaignContract,
	replicate: number,
	sourceTechnicalExcludedReplicates: readonly number[],
	completedArms: number,
	state: EvalCampaignState["state"],
	stoppingReason: EvalCampaignState["stoppingReason"],
): void {
	ctx.down([
		[
			"DATA",
			Object.freeze({
				kind: "eval-campaign-state" as const,
				executionGrantDigest: contract.executionGrantDigest,
				campaignRef,
				campaignPurpose: contract.campaignPurpose,
				taskSetRef: contract.taskSetRef,
				generationRef: contract.generationRef,
				replicate,
				replicateCount: contract.replicateCount,
				heldOutSealDigest: contract.heldOutSealDigest,
				budgetPartition: contract.budgetPartition,
				partitionHardCapMicrousd: contract.partitionHardCapMicrousd,
				partitionSpentBeforeMicrousd: contract.partitionSpentBeforeMicrousd,
				partitionLedgerDigest: contract.partitionLedgerDigest,
				developmentQualificationStreakBefore: contract.developmentQualificationStreakBefore,
				sourceTechnicalExcludedReplicates: Object.freeze([...sourceTechnicalExcludedReplicates]),
				completedArms,
				state,
				stoppingReason,
			}),
		],
	]);
}

export function evalVerificationTerminalReason(
	outcome: EvalEffectOutcome,
): EvalVerificationTerminalReason {
	if (!outcome.evidence.cleanupCompleted) return "cleanup-incomplete";
	if (outcome.toolAdmissionId === null) return "provider-failed";
	if (outcome.status === "failed") return "exact-tool-failed";
	if (outcome.evidence.diff === "no-change") return "no-change";
	if (outcome.evidence.diff === "wrong-scope") return "wrong-scope";
	if (outcome.evidence.publicSemantic !== "equivalent") return "public-semantic-failed";
	if (outcome.evidence.hiddenVerifier !== "pass") return "hidden-verifier-failed";
	return "passed";
}

function emptyVerificationStageCounts(): Record<EvalVerificationStage, number> {
	return Object.fromEntries(EVAL_VERIFICATION_STAGE_KEYS.map((stage) => [stage, 0])) as Record<
		EvalVerificationStage,
		number
	>;
}

function emptyVerificationReasonCounts(): Record<EvalVerificationTerminalReason, number> {
	return Object.fromEntries(
		EVAL_VERIFICATION_TERMINAL_REASONS.map((reason) => [reason, 0]),
	) as Record<EvalVerificationTerminalReason, number>;
}

function verificationDiagnosticsSnapshot(
	completed: ReadonlyMap<string, EvalCleanupFact>,
): EvalVerificationDiagnostics {
	const stageCounts = Object.fromEntries(
		HARNESS_ARMS.map((arm) => [arm, emptyVerificationStageCounts()]),
	) as Record<HarnessArm, Record<EvalVerificationStage, number>>;
	const terminalReasonCounts = Object.fromEntries(
		HARNESS_ARMS.map((arm) => [arm, emptyVerificationReasonCounts()]),
	) as Record<HarnessArm, Record<EvalVerificationTerminalReason, number>>;
	for (const fact of completed.values()) {
		const stages = stageCounts[fact.arm];
		stages.completedWorkItems += 1;
		if (fact.exactToolAdmitted) stages.exactToolAdmitted += 1;
		if (fact.scopedChange) stages.scopedChange += 1;
		if (fact.publicSemanticPassed) stages.publicSemanticPassed += 1;
		if (fact.hiddenVerifierPassed) stages.hiddenVerifierPassed += 1;
		if (fact.cleanupCompleted) stages.cleanupCompleted += 1;
		if (fact.passed) stages.passed += 1;
		terminalReasonCounts[fact.arm][fact.terminalReason] += 1;
	}
	return strictSnapshot({
		kind: "eval-verification-diagnostics" as const,
		armOrder: HARNESS_ARMS,
		stageCounts,
		terminalReasonCounts,
		completedWorkItems: completed.size,
	});
}

function assertVerificationReasonStageConsistency(
	stages: EvalVerificationStageCounts,
	reasons: EvalVerificationReasonCounts,
	replicateCount: number,
	label: string,
): void {
	for (const stage of EVAL_VERIFICATION_STAGE_KEYS)
		if (!Number.isSafeInteger(stages[stage]) || stages[stage] < 0 || stages[stage] > replicateCount)
			throw new TypeError(`${label} verification stage count invalid`);
	for (const reason of EVAL_VERIFICATION_TERMINAL_REASONS)
		if (
			!Number.isSafeInteger(reasons[reason]) ||
			reasons[reason] < 0 ||
			reasons[reason] > replicateCount
		)
			throw new TypeError(`${label} verification reason count invalid`);
	if (
		stages.exactToolAdmitted > stages.completedWorkItems ||
		stages.scopedChange > stages.exactToolAdmitted ||
		stages.publicSemanticPassed > stages.scopedChange ||
		stages.hiddenVerifierPassed > stages.publicSemanticPassed ||
		stages.cleanupCompleted > stages.completedWorkItems ||
		stages.passed > stages.hiddenVerifierPassed ||
		stages.passed > stages.cleanupCompleted
	)
		throw new TypeError(`${label} verification stage ordering invalid`);
	const reasonTotal = EVAL_VERIFICATION_TERMINAL_REASONS.reduce(
		(total, reason) => total + reasons[reason],
		0,
	);
	const cleanupCompletedFromReasons = stages.completedWorkItems - reasons["cleanup-incomplete"];
	const exactToolAfterCleanup = cleanupCompletedFromReasons - reasons["provider-failed"];
	const scopedAfterCleanup =
		exactToolAfterCleanup -
		reasons["exact-tool-failed"] -
		reasons["no-change"] -
		reasons["wrong-scope"];
	const publicSemanticAfterCleanup = scopedAfterCleanup - reasons["public-semantic-failed"];
	const hiddenVerifierAfterCleanup = publicSemanticAfterCleanup - reasons["hidden-verifier-failed"];
	const obscuredByCleanup = reasons["cleanup-incomplete"];
	const exactToolObscuredByCleanup = stages.exactToolAdmitted - exactToolAfterCleanup;
	const scopedChangeObscuredByCleanup = stages.scopedChange - scopedAfterCleanup;
	const publicSemanticObscuredByCleanup = stages.publicSemanticPassed - publicSemanticAfterCleanup;
	const hiddenVerifierObscuredByCleanup = stages.hiddenVerifierPassed - hiddenVerifierAfterCleanup;
	if (
		reasonTotal !== stages.completedWorkItems ||
		reasons.passed !== stages.passed ||
		stages.cleanupCompleted !== cleanupCompletedFromReasons ||
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
		throw new TypeError(`${label} verification reason/stage matrix invalid`);
}

const ROOT_EVAL_FINDING_KEYS = Object.freeze([
	"kind",
	"campaignRef",
	"replicateCount",
	"armOrder",
	"passCounts",
	"evaluableReplicates",
	"excludedTechnicalReplicates",
	"sourceTechnicalExcludedReplicates",
	"matchedRelevantOverColdWins",
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
] as const);

const ROOT_EVAL_OBSERVATION_KEYS = Object.freeze([
	"kind",
	"topologyRevision",
	"executionGrantDigest",
	"solutionIdentities",
	"campaignRef",
	"campaignPurpose",
	"taskSetRef",
	"generationRef",
	"replicate",
	"replicateCount",
	"heldOutSealDigest",
	"budgetPartition",
	"partitionHardCapMicrousd",
	"partitionSpentBeforeMicrousd",
	"partitionLedgerDigest",
	"developmentQualification",
	"armOrder",
	"memoryProvenance",
	"evaluableReplicates",
	"excludedTechnicalReplicates",
	"sourceTechnicalExcludedReplicates",
	"matchedRelevantOverColdWins",
	"completedArms",
	"verificationDiagnostics",
	"activeProviderEffects",
	"activeToolEffects",
	"activeRetryEffects",
	"activeBillingEffects",
	"activeAdmittedEffects",
	"providerCapacity",
	"scheduleFeasibility",
	"progressLease",
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
] as const);

function assertExactOrderedRuntimeArray(
	value: unknown,
	expected: readonly string[],
	label: string,
): void {
	const actual = array(value, label);
	if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index]))
		throw new TypeError(`${label} order drifted`);
}

function assertVerificationDiagnosticsRuntimeShape(
	diagnostics: EvalVerificationDiagnostics,
	label: string,
	replicateCount: number,
): void {
	const root = record(diagnostics, label);
	exactKeys(
		root,
		["kind", "armOrder", "stageCounts", "terminalReasonCounts", "completedWorkItems"],
		label,
	);
	literal(root.kind, "eval-verification-diagnostics", `${label}.kind`);
	assertExactOrderedRuntimeArray(root.armOrder, HARNESS_ARMS, `${label}.armOrder`);
	const stagesByArm = record(root.stageCounts, `${label}.stageCounts`);
	const reasonsByArm = record(root.terminalReasonCounts, `${label}.terminalReasonCounts`);
	exactKeys(stagesByArm, HARNESS_ARMS, `${label}.stageCounts`);
	exactKeys(reasonsByArm, HARNESS_ARMS, `${label}.terminalReasonCounts`);
	for (const arm of HARNESS_ARMS) {
		const stages = record(
			stagesByArm[arm],
			`${label}.stageCounts.${arm}`,
		) as unknown as EvalVerificationStageCounts;
		const reasons = record(
			reasonsByArm[arm],
			`${label}.terminalReasonCounts.${arm}`,
		) as unknown as EvalVerificationReasonCounts;
		exactKeys(
			stages as unknown as Record<string, unknown>,
			EVAL_VERIFICATION_STAGE_KEYS,
			`${label}.stageCounts.${arm}`,
		);
		exactKeys(
			reasons as unknown as Record<string, unknown>,
			EVAL_VERIFICATION_TERMINAL_REASONS,
			`${label}.terminalReasonCounts.${arm}`,
		);
		assertVerificationReasonStageConsistency(stages, reasons, replicateCount, `${label}.${arm}`);
	}
	const completedWorkItems = safeInteger(root.completedWorkItems, `${label}.completedWorkItems`, {
		max: replicateCount * HARNESS_ARMS.length,
	});
	const summedCompletedWorkItems = HARNESS_ARMS.reduce(
		(total, arm) =>
			total +
			((stagesByArm[arm] as unknown as EvalVerificationStageCounts).completedWorkItems ?? 0),
		0,
	);
	if (summedCompletedWorkItems !== completedWorkItems)
		throw new TypeError(`${label} completed Work Item conservation drifted`);
}

function assertProviderOutcomeReasonCountsRuntimeShape(
	counts: EvalProviderOutcomeReasonCounts,
	label: string,
): number {
	const root = record(counts, label);
	exactKeys(root, EVAL_PROVIDER_OUTCOME_REASON_CODES, label);
	return EVAL_PROVIDER_OUTCOME_REASON_CODES.reduce(
		(total, reason) => total + safeInteger(root[reason], `${label}.${reason}`),
		0,
	);
}

function assertProviderCapacityRuntimeShape(
	capacity: EvalProviderCapacityState,
	label: string,
): void {
	const root = record(capacity, label);
	exactKeys(
		root,
		[
			"kind",
			"pacingRevision",
			"providerStartIntervalMs",
			"consecutiveUsableResponses",
			"mode",
			"initialMaxConcurrentEffects",
			"maxConcurrentEffects",
			"activeEffects",
			"proposalCount",
			"pendingProposalCount",
			"pendingFirstAttemptProposalCount",
			"pendingRetryProposalCount",
			"retryProposalCount",
			"admittedProposalCount",
			"admittedRetryProposalCount",
			"settledProposalCount",
			"settledRetryProposalCount",
			"rejectedProposalCount",
			"rejectedRetryProposalCount",
			"cooldownOutstandingReadinessCount",
			"rateLimitFeedbackCount",
		],
		label,
	);
	literal(root.kind, "eval-provider-capacity-state", `${label}.kind`);
	literal(
		root.initialMaxConcurrentEffects,
		ROOT_EVAL_INITIAL_PROVIDER_CAPACITY,
		`${label}.initialMaxConcurrentEffects`,
	);
	const mode = root.mode;
	if (mode !== "paced-serial" && mode !== "cooldown") throw new TypeError(`${label}.mode invalid`);
	const maxConcurrentEffects = safeInteger(
		root.maxConcurrentEffects,
		`${label}.maxConcurrentEffects`,
		{ min: ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY, max: ROOT_EVAL_INITIAL_PROVIDER_CAPACITY },
	);
	const activeEffects = safeInteger(root.activeEffects, `${label}.activeEffects`, {
		max: ROOT_EVAL_INITIAL_PROVIDER_CAPACITY,
	});
	const proposalCount = safeInteger(root.proposalCount, `${label}.proposalCount`);
	const pendingProposalCount = safeInteger(
		root.pendingProposalCount,
		`${label}.pendingProposalCount`,
	);
	const pendingFirstAttemptProposalCount = safeInteger(
		root.pendingFirstAttemptProposalCount,
		`${label}.pendingFirstAttemptProposalCount`,
	);
	const pendingRetryProposalCount = safeInteger(
		root.pendingRetryProposalCount,
		`${label}.pendingRetryProposalCount`,
	);
	const retryProposalCount = safeInteger(root.retryProposalCount, `${label}.retryProposalCount`);
	const admittedProposalCount = safeInteger(
		root.admittedProposalCount,
		`${label}.admittedProposalCount`,
	);
	const admittedRetryProposalCount = safeInteger(
		root.admittedRetryProposalCount,
		`${label}.admittedRetryProposalCount`,
	);
	const settledProposalCount = safeInteger(
		root.settledProposalCount,
		`${label}.settledProposalCount`,
	);
	const settledRetryProposalCount = safeInteger(
		root.settledRetryProposalCount,
		`${label}.settledRetryProposalCount`,
	);
	const rejectedProposalCount = safeInteger(
		root.rejectedProposalCount,
		`${label}.rejectedProposalCount`,
	);
	const rejectedRetryProposalCount = safeInteger(
		root.rejectedRetryProposalCount,
		`${label}.rejectedRetryProposalCount`,
	);
	const cooldownOutstandingReadinessCount = safeInteger(
		root.cooldownOutstandingReadinessCount,
		`${label}.cooldownOutstandingReadinessCount`,
	);
	safeInteger(root.rateLimitFeedbackCount, `${label}.rateLimitFeedbackCount`);
	safeInteger(root.pacingRevision, `${label}.pacingRevision`);
	safeInteger(root.consecutiveUsableResponses, `${label}.consecutiveUsableResponses`, { max: 2 });
	if (![30_000, 60_000, 120_000, 240_000].includes(root.providerStartIntervalMs as number))
		throw new TypeError(`${label} adaptive pacing interval invalid`);
	if (
		proposalCount !== pendingProposalCount + admittedProposalCount + rejectedProposalCount ||
		pendingProposalCount !== pendingFirstAttemptProposalCount + pendingRetryProposalCount ||
		retryProposalCount !==
			pendingRetryProposalCount + admittedRetryProposalCount + rejectedRetryProposalCount ||
		settledProposalCount > admittedProposalCount ||
		admittedRetryProposalCount > admittedProposalCount ||
		settledRetryProposalCount > admittedRetryProposalCount ||
		settledRetryProposalCount > settledProposalCount ||
		rejectedRetryProposalCount > rejectedProposalCount ||
		activeEffects !== admittedProposalCount - settledProposalCount ||
		(mode === "paced-serial" &&
			(maxConcurrentEffects !== ROOT_EVAL_INITIAL_PROVIDER_CAPACITY ||
				cooldownOutstandingReadinessCount !== 0)) ||
		(mode === "cooldown" &&
			(maxConcurrentEffects !== ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY ||
				cooldownOutstandingReadinessCount < 1)) ||
		maxConcurrentEffects !== ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY
	)
		throw new TypeError(`${label} provider capacity conservation drifted`);
}

function assertScheduleFeasibilityRuntimeShape(
	feasibility: EvalScheduleFeasibility,
	label: string,
): void {
	const root = record(feasibility, label);
	exactKeys(
		root,
		[
			"kind",
			"decisionRef",
			"replicateCount",
			"sourceWorkItemCount",
			"targetWorkItemCount",
			"exactToolAttemptCount",
			"maximumProviderAttempts",
			"maximumRetryAttempts",
			"providerEffectLeaseMs",
			"providerSettlementBoundMs",
			"providerStartIntervalMs",
			"retrySettlementBoundMs",
			"exactToolSettlementBoundMs",
			"billingSettlementBoundMs",
			"maximumFinitePathMs",
			"state",
		],
		label,
	);
	literal(root.kind, "eval-schedule-feasibility", `${label}.kind`);
	literal(root.decisionRef, "graphrefly-ts:D158", `${label}.decisionRef`);
	const replicateCount = safeInteger(root.replicateCount, `${label}.replicateCount`, { min: 1 });
	const providerEffectLeaseMs = safeInteger(
		root.providerEffectLeaseMs,
		`${label}.providerEffectLeaseMs`,
		{ min: 1, max: ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS },
	);
	const expected = rootEvalScheduleFeasibility(replicateCount, providerEffectLeaseMs);
	if (empiricalStrictJsonDigest(root) !== empiricalStrictJsonDigest(expected))
		throw new TypeError(`${label} was not mechanically derived from finite topology bounds`);
}

function assertProgressLeaseRuntimeShape(progress: EvalProgressLeaseState, label: string): void {
	const root = record(progress, label);
	exactKeys(
		root,
		[
			"kind",
			"campaignRef",
			"revision",
			"occurrenceDigest",
			"nextExpectedOccurrence",
			"leaseMs",
			"deadlineOffsetMs",
			"maximumFinitePathMs",
			"state",
			"stoppingReason",
		],
		label,
	);
	literal(root.kind, "eval-progress-lease-state", `${label}.kind`);
	coordinate(root.campaignRef, `${label}.campaignRef`);
	safeInteger(root.revision, `${label}.revision`, { min: 1 });
	digest(root.occurrenceDigest, `${label}.occurrenceDigest`);
	coordinate(root.nextExpectedOccurrence, `${label}.nextExpectedOccurrence`);
	const leaseMs = safeInteger(root.leaseMs, `${label}.leaseMs`, { min: 0 });
	const deadlineOffsetMs = safeInteger(root.deadlineOffsetMs, `${label}.deadlineOffsetMs`, {
		min: 0,
	});
	const maximumFinitePathMs = safeInteger(
		root.maximumFinitePathMs,
		`${label}.maximumFinitePathMs`,
		{ min: 1 },
	);
	if (leaseMs > maximumFinitePathMs || deadlineOffsetMs > maximumFinitePathMs)
		throw new TypeError(`${label} exceeded the finite schedule proof`);
	if (
		(root.state === "active" && root.stoppingReason !== "none") ||
		(root.state === "complete" && root.stoppingReason !== "campaign-complete") ||
		(root.state === "stopped" && root.stoppingReason !== "budget-exhausted") ||
		(root.state === "stalled" && root.stoppingReason !== "progress-stalled")
	)
		throw new TypeError(`${label} state and stopping reason drifted`);
}

export function assertRootEvalObservationRuntimeShape(
	observation: EvalObservation,
	label: string,
): void {
	const root = record(observation, label);
	exactKeys(root, ROOT_EVAL_OBSERVATION_KEYS, label);
	literal(root.kind, "eval-observation", `${label}.kind`);
	literal(root.topologyRevision, ROOT_EVAL_TOPOLOGY_REVISION, `${label}.topologyRevision`);
	if (!/^sha256:[0-9a-f]{64}$/u.test(String(root.executionGrantDigest)))
		throw new TypeError(`${label}.executionGrantDigest invalid`);
	coordinate(root.campaignRef, `${label}.campaignRef`);
	if (
		!(["qualification", "development", "confirmatory"] as const).includes(
			root.campaignPurpose as EvalCampaignPurpose,
		)
	)
		throw new TypeError(`${label}.campaignPurpose invalid`);
	coordinate(root.taskSetRef, `${label}.taskSetRef`);
	coordinate(root.generationRef, `${label}.generationRef`);
	if (!/^sha256:[0-9a-f]{64}$/u.test(String(root.heldOutSealDigest)))
		throw new TypeError(`${label}.heldOutSealDigest invalid`);
	if (
		!(
			[
				"no-network",
				"development-usd-36",
				"development-usd-40",
				"development-usd-45",
				"confirmatory-usd-6",
			] as const
		).includes(root.budgetPartition as EvalBudgetPartition)
	)
		throw new TypeError(`${label}.budgetPartition invalid`);
	const partitionHardCapMicrousd = safeInteger(
		root.partitionHardCapMicrousd,
		`${label}.partitionHardCapMicrousd`,
		{ min: 1 },
	);
	const partitionSpentBeforeMicrousd = safeInteger(
		root.partitionSpentBeforeMicrousd,
		`${label}.partitionSpentBeforeMicrousd`,
	);
	if (
		partitionSpentBeforeMicrousd >= partitionHardCapMicrousd ||
		!/^sha256:[0-9a-f]{64}$/u.test(String(root.partitionLedgerDigest))
	)
		throw new TypeError(`${label} partition ledger authority invalid`);
	const qualification = record(root.developmentQualification, `${label}.developmentQualification`);
	exactKeys(
		qualification,
		[
			"kind",
			"campaignPurpose",
			"generationRef",
			"status",
			"generationQualified",
			"consecutiveQualifyingGenerations",
			"requiredConsecutiveGenerations",
			"heldOutEligible",
		],
		`${label}.developmentQualification`,
	);
	literal(
		qualification.kind,
		"eval-development-qualification-state",
		`${label}.developmentQualification.kind`,
	);
	if (
		qualification.campaignPurpose !== root.campaignPurpose ||
		qualification.generationRef !== root.generationRef ||
		!(["not-applicable", "pending", "qualified", "reset"] as const).includes(
			qualification.status as EvalDevelopmentQualificationState["status"],
		) ||
		!([null, true, false] as const).includes(qualification.generationQualified as boolean | null) ||
		qualification.requiredConsecutiveGenerations !== 2 ||
		typeof qualification.heldOutEligible !== "boolean"
	)
		throw new TypeError(`${label} development qualification shape invalid`);
	const qualificationCount = safeInteger(
		qualification.consecutiveQualifyingGenerations,
		`${label}.developmentQualification.consecutiveQualifyingGenerations`,
		{ max: 2 },
	);
	if (
		(root.campaignPurpose === "development" && qualification.status === "not-applicable") ||
		(root.campaignPurpose !== "development" && qualification.status !== "not-applicable") ||
		(qualification.status === "pending" && qualification.generationQualified !== null) ||
		(qualification.status === "qualified" && qualification.generationQualified !== true) ||
		(qualification.status === "reset" && qualification.generationQualified !== false) ||
		qualification.heldOutEligible !== (qualificationCount === 2)
	)
		throw new TypeError(`${label} development qualification semantics invalid`);
	const replicateCount = safeInteger(root.replicateCount, `${label}.replicateCount`, {
		min: 1,
		max: ROOT_EVAL_REPLICATE_COUNT,
	});
	if (
		(root.campaignPurpose === "development" &&
			(replicateCount !== ROOT_EVAL_DEVELOPMENT_REPLICATE_COUNT ||
				(root.budgetPartition !== "development-usd-36" &&
					root.budgetPartition !== "development-usd-40" &&
					root.budgetPartition !== "development-usd-45"))) ||
		(root.campaignPurpose === "confirmatory" &&
			(replicateCount !== ROOT_EVAL_REPLICATE_COUNT ||
				root.budgetPartition !== "confirmatory-usd-6")) ||
		(root.campaignPurpose === "qualification" && root.budgetPartition !== "no-network")
	)
		throw new TypeError(`${label} campaign contract drifted`);
	assertExactOrderedRuntimeArray(
		root.solutionIdentities,
		ROOT_EVAL_SOLUTION_IDENTITIES,
		`${label}.solutionIdentities`,
	);
	assertExactOrderedRuntimeArray(root.armOrder, HARNESS_ARMS, `${label}.armOrder`);
	const provenance = record(root.memoryProvenance, `${label}.memoryProvenance`);
	exactKeys(provenance, HARNESS_ARMS, `${label}.memoryProvenance`);
	for (const arm of HARNESS_ARMS)
		literal(provenance[arm], MEMORY_PROVENANCE[arm], `${label}.memoryProvenance.${arm}`);
	const excludedTechnicalReplicates = array(
		root.excludedTechnicalReplicates,
		`${label}.excludedTechnicalReplicates`,
	).map((replicate, index) =>
		safeInteger(replicate, `${label}.excludedTechnicalReplicates[${index}]`, {
			min: 1,
			max: replicateCount,
		}),
	);
	if (
		new Set(excludedTechnicalReplicates).size !== excludedTechnicalReplicates.length ||
		excludedTechnicalReplicates.some(
			(replicate, index) => index > 0 && replicate <= excludedTechnicalReplicates[index - 1]!,
		)
	)
		throw new TypeError(`${label}.excludedTechnicalReplicates order drifted`);
	const sourceTechnicalExcludedReplicates = array(
		root.sourceTechnicalExcludedReplicates,
		`${label}.sourceTechnicalExcludedReplicates`,
	).map((replicate, index) =>
		safeInteger(replicate, `${label}.sourceTechnicalExcludedReplicates[${index}]`, {
			min: 1,
			max: replicateCount,
		}),
	);
	if (
		new Set(sourceTechnicalExcludedReplicates).size !== sourceTechnicalExcludedReplicates.length ||
		sourceTechnicalExcludedReplicates.some(
			(replicate, index) => index > 0 && replicate <= sourceTechnicalExcludedReplicates[index - 1]!,
		) ||
		sourceTechnicalExcludedReplicates.some(
			(replicate) => !excludedTechnicalReplicates.includes(replicate),
		)
	)
		throw new TypeError(`${label}.sourceTechnicalExcludedReplicates drifted`);
	const evaluableReplicates =
		root.evaluableReplicates === null
			? null
			: safeInteger(root.evaluableReplicates, `${label}.evaluableReplicates`, {
					max: replicateCount,
				});
	const matchedRelevantOverColdWins =
		root.matchedRelevantOverColdWins === null
			? null
			: safeInteger(root.matchedRelevantOverColdWins, `${label}.matchedRelevantOverColdWins`, {
					max: replicateCount,
				});
	safeInteger(root.replicate, `${label}.replicate`, {
		min: 1,
		max: replicateCount,
	});
	safeInteger(root.completedArms, `${label}.completedArms`, { max: HARNESS_ARMS.length });
	const activeProviderEffects = safeInteger(
		root.activeProviderEffects,
		`${label}.activeProviderEffects`,
		{ max: HARNESS_ARMS.length },
	);
	const activeToolEffects = safeInteger(root.activeToolEffects, `${label}.activeToolEffects`, {
		max: HARNESS_ARMS.length,
	});
	const activeRetryEffects = safeInteger(root.activeRetryEffects, `${label}.activeRetryEffects`, {
		max: HARNESS_ARMS.length,
	});
	const activeBillingEffects = safeInteger(
		root.activeBillingEffects,
		`${label}.activeBillingEffects`,
		{ max: 1 },
	);
	const activeAdmittedEffects = safeInteger(
		root.activeAdmittedEffects,
		`${label}.activeAdmittedEffects`,
		{ max: HARNESS_ARMS.length },
	);
	const providerCapacity = root.providerCapacity as EvalProviderCapacityState;
	assertProviderCapacityRuntimeShape(providerCapacity, `${label}.providerCapacity`);
	const scheduleFeasibility = root.scheduleFeasibility as EvalScheduleFeasibility;
	assertScheduleFeasibilityRuntimeShape(scheduleFeasibility, `${label}.scheduleFeasibility`);
	const progressLease = root.progressLease as EvalProgressLeaseState;
	assertProgressLeaseRuntimeShape(progressLease, `${label}.progressLease`);
	if (progressLease.maximumFinitePathMs !== scheduleFeasibility.maximumFinitePathMs)
		throw new TypeError(`${label} progress lease lost its schedule proof`);
	const maxProviderAttempts = rootEvalMaximumProviderAttempts(replicateCount);
	const admittedAttempts = safeInteger(root.admittedAttempts, `${label}.admittedAttempts`, {
		max: maxProviderAttempts,
	});
	const maxRetryAttempts = rootEvalMaximumRetryAttempts(replicateCount);
	const admittedRetryAttempts = safeInteger(
		root.admittedRetryAttempts,
		`${label}.admittedRetryAttempts`,
		{ max: maxRetryAttempts },
	);
	const retryProposalCount = safeInteger(root.retryProposalCount, `${label}.retryProposalCount`, {
		max: maxRetryAttempts,
	});
	const pendingRetryProposalCount = safeInteger(
		root.pendingRetryProposalCount,
		`${label}.pendingRetryProposalCount`,
		{ max: maxRetryAttempts },
	);
	const rejectedRetryProposalCount = safeInteger(
		root.rejectedRetryProposalCount,
		`${label}.rejectedRetryProposalCount`,
		{ max: maxRetryAttempts },
	);
	const settledRetryAttemptCount = safeInteger(
		root.settledRetryAttemptCount,
		`${label}.settledRetryAttemptCount`,
		{ max: maxRetryAttempts },
	);
	const providerCallCount = safeInteger(root.providerCallCount, `${label}.providerCallCount`, {
		max: maxProviderAttempts,
	});
	const activeReservedMicrousd = safeInteger(
		root.activeReservedMicrousd,
		`${label}.activeReservedMicrousd`,
	);
	const providerReportedMicrousd = safeInteger(
		root.providerReportedMicrousd,
		`${label}.providerReportedMicrousd`,
	);
	const pricingRoundingAllowanceMicrousd = safeInteger(
		root.pricingRoundingAllowanceMicrousd,
		`${label}.pricingRoundingAllowanceMicrousd`,
	);
	const providerReportedLowerBoundMicrousd = safeInteger(
		root.providerReportedLowerBoundMicrousd,
		`${label}.providerReportedLowerBoundMicrousd`,
	);
	const unreportedSettledUpperBoundMicrousd = safeInteger(
		root.unreportedSettledUpperBoundMicrousd,
		`${label}.unreportedSettledUpperBoundMicrousd`,
	);
	const accountedUpperBoundMicrousd = safeInteger(
		root.accountedUpperBoundMicrousd,
		`${label}.accountedUpperBoundMicrousd`,
	);
	const billingObservationCount = safeInteger(
		root.billingObservationCount,
		`${label}.billingObservationCount`,
	);
	const billingStableIntervals = safeInteger(
		root.billingStableIntervals,
		`${label}.billingStableIntervals`,
	);
	if (root.observedBilledMicrousd !== null)
		safeInteger(root.observedBilledMicrousd, `${label}.observedBilledMicrousd`);
	if (root.reconciledBilledMicrousd !== null)
		safeInteger(root.reconciledBilledMicrousd, `${label}.reconciledBilledMicrousd`);
	if (!["pending", "reconciled", "rejected"].includes(root.billingDisposition as string))
		throw new TypeError(`${label}.billingDisposition invalid`);
	if (
		root.finding !== "pending" &&
		root.finding !== "not-evaluated" &&
		root.finding !== "positive-differential" &&
		root.finding !== "no-positive-differential" &&
		root.finding !== "operationally-inconclusive"
	)
		throw new TypeError(`${label}.finding invalid`);
	assertVerificationDiagnosticsRuntimeShape(
		root.verificationDiagnostics as EvalVerificationDiagnostics,
		`${label}.verificationDiagnostics`,
		replicateCount,
	);
	const providerReasonTotal = assertProviderOutcomeReasonCountsRuntimeShape(
		root.providerOutcomeReasonCounts as EvalProviderOutcomeReasonCounts,
		`${label}.providerOutcomeReasonCounts`,
	);
	const retryableReasonTotal =
		(root.providerOutcomeReasonCounts as EvalProviderOutcomeReasonCounts)[
			"transport-availability-retryable"
		] +
		(root.providerOutcomeReasonCounts as EvalProviderOutcomeReasonCounts)[
			"http-capacity-retryable"
		] +
		(root.providerOutcomeReasonCounts as EvalProviderOutcomeReasonCounts)[
			"http-availability-retryable"
		];
	if (
		activeAdmittedEffects !==
			activeProviderEffects + activeToolEffects + activeRetryEffects + activeBillingEffects ||
		providerCapacity.activeEffects !== activeProviderEffects ||
		providerCapacity.admittedProposalCount !== admittedAttempts ||
		providerCapacity.settledProposalCount !== providerReasonTotal ||
		providerCapacity.pendingRetryProposalCount !== pendingRetryProposalCount ||
		providerCapacity.retryProposalCount !== retryProposalCount ||
		providerCapacity.admittedRetryProposalCount !== admittedRetryAttempts ||
		providerCapacity.settledRetryProposalCount !== settledRetryAttemptCount ||
		providerCapacity.rejectedRetryProposalCount !== rejectedRetryProposalCount ||
		activeProviderEffects !== admittedAttempts - providerReasonTotal ||
		activeRetryEffects !== retryableReasonTotal - retryProposalCount ||
		retryProposalCount !==
			pendingRetryProposalCount + admittedRetryAttempts + rejectedRetryProposalCount ||
		settledRetryAttemptCount > admittedRetryAttempts ||
		pricingRoundingAllowanceMicrousd > providerReportedMicrousd ||
		providerReportedLowerBoundMicrousd !==
			Math.max(0, providerReportedMicrousd - pricingRoundingAllowanceMicrousd) ||
		accountedUpperBoundMicrousd !==
			activeReservedMicrousd + providerReportedMicrousd + unreportedSettledUpperBoundMicrousd ||
		(accountedUpperBoundMicrousd > partitionHardCapMicrousd - partitionSpentBeforeMicrousd &&
			(root.stoppingReason !== "budget-exhausted" ||
				!["pending", "not-evaluated"].includes(root.finding as string))) ||
		(providerCapacity.mode === "cooldown" && retryableReasonTotal === 0) ||
		providerCallCount > admittedAttempts ||
		providerReasonTotal > admittedAttempts ||
		billingStableIntervals > billingObservationCount
	)
		throw new TypeError(
			`${label} budget, billing, or provider-reason arithmetic/conservation drifted`,
		);
	const pending = root.finding === "pending" || root.finding === "not-evaluated";
	if (
		root.finding === "not-evaluated" &&
		(!["budget-exhausted", "progress-stalled"].includes(root.stoppingReason as string) ||
			activeAdmittedEffects !== 0 ||
			activeReservedMicrousd !== 0)
	)
		throw new TypeError(`${label} incomplete terminal had active work or no stop reason`);
	if (
		pending &&
		(evaluableReplicates !== null ||
			excludedTechnicalReplicates.length !== sourceTechnicalExcludedReplicates.length ||
			matchedRelevantOverColdWins !== null ||
			root.billingDisposition !== "pending" ||
			root.observedBilledMicrousd !== null ||
			root.billingObservationCount !== 0 ||
			root.billingStableIntervals !== 0 ||
			root.reconciledBilledMicrousd !== null)
	)
		throw new TypeError(`${label} finding/billing lifecycle drifted`);
	if (
		!pending &&
		(evaluableReplicates !== replicateCount - excludedTechnicalReplicates.length ||
			matchedRelevantOverColdWins === null ||
			matchedRelevantOverColdWins > evaluableReplicates)
	)
		throw new TypeError(`${label} matched efficacy evidence drifted`);
}

export function assertRootEvalObservationTransition(
	previous: EvalObservation,
	current: EvalObservation,
	label: string,
): void {
	const newlyKnownSourceExclusionsAreMonotonic =
		previous.sourceTechnicalExcludedReplicates.every((replicate) =>
			current.sourceTechnicalExcludedReplicates.includes(replicate),
		) &&
		current.sourceTechnicalExcludedReplicates.every((replicate) =>
			current.excludedTechnicalReplicates.includes(replicate),
		);
	const skippedReplicatesAreSourceExcluded = Array.from(
		{ length: Math.max(0, current.replicate - previous.replicate - 1) },
		(_, index) => previous.replicate + index + 1,
	).every((replicate) => current.sourceTechnicalExcludedReplicates.includes(replicate));
	if (
		current.executionGrantDigest !== previous.executionGrantDigest ||
		current.campaignPurpose !== previous.campaignPurpose ||
		current.taskSetRef !== previous.taskSetRef ||
		current.generationRef !== previous.generationRef ||
		current.replicateCount !== previous.replicateCount ||
		current.heldOutSealDigest !== previous.heldOutSealDigest ||
		current.budgetPartition !== previous.budgetPartition ||
		current.partitionHardCapMicrousd !== previous.partitionHardCapMicrousd ||
		current.partitionSpentBeforeMicrousd !== previous.partitionSpentBeforeMicrousd ||
		current.partitionLedgerDigest !== previous.partitionLedgerDigest ||
		current.developmentQualification.campaignPurpose !==
			previous.developmentQualification.campaignPurpose ||
		current.developmentQualification.generationRef !==
			previous.developmentQualification.generationRef ||
		(previous.developmentQualification.status !== "pending" &&
			empiricalStrictJsonDigest(current.developmentQualification) !==
				empiricalStrictJsonDigest(previous.developmentQualification)) ||
		current.replicate < previous.replicate ||
		!newlyKnownSourceExclusionsAreMonotonic ||
		!skippedReplicatesAreSourceExcluded ||
		(current.replicate === previous.replicate && current.completedArms < previous.completedArms) ||
		(current.replicate > previous.replicate &&
			((previous.completedArms !== HARNESS_ARMS.length &&
				!current.sourceTechnicalExcludedReplicates.includes(previous.replicate)) ||
				current.completedArms > 1)) ||
		current.verificationDiagnostics.completedWorkItems <
			previous.verificationDiagnostics.completedWorkItems ||
		current.retryProposalCount < previous.retryProposalCount ||
		current.admittedRetryAttempts < previous.admittedRetryAttempts ||
		current.rejectedRetryProposalCount < previous.rejectedRetryProposalCount ||
		current.settledRetryAttemptCount < previous.settledRetryAttemptCount ||
		current.providerCapacity.proposalCount < previous.providerCapacity.proposalCount ||
		current.providerCapacity.admittedProposalCount <
			previous.providerCapacity.admittedProposalCount ||
		current.providerCapacity.settledProposalCount <
			previous.providerCapacity.settledProposalCount ||
		current.providerCapacity.rejectedProposalCount <
			previous.providerCapacity.rejectedProposalCount ||
		current.providerCapacity.rateLimitFeedbackCount <
			previous.providerCapacity.rateLimitFeedbackCount ||
		current.providerCapacity.maxConcurrentEffects >
			previous.providerCapacity.maxConcurrentEffects ||
		current.progressLease.revision < previous.progressLease.revision ||
		current.scheduleFeasibility.maximumFinitePathMs !==
			previous.scheduleFeasibility.maximumFinitePathMs
	)
		throw new TypeError(`${label} campaign progress regressed`);
	for (const arm of HARNESS_ARMS) {
		for (const stage of EVAL_VERIFICATION_STAGE_KEYS)
			if (
				current.verificationDiagnostics.stageCounts[arm][stage] <
				previous.verificationDiagnostics.stageCounts[arm][stage]
			)
				throw new TypeError(`${label} verification stage regressed`);
		for (const reason of EVAL_VERIFICATION_TERMINAL_REASONS)
			if (
				current.verificationDiagnostics.terminalReasonCounts[arm][reason] <
				previous.verificationDiagnostics.terminalReasonCounts[arm][reason]
			)
				throw new TypeError(`${label} verification reason regressed`);
	}
}

export function assertRootEvalObservationSequence(
	observations: readonly EvalObservation[],
	label: string,
): void {
	if (observations.length < 2) throw new TypeError(`${label} progress stream was truncated`);
	const first = observations[0]!;
	if (
		first.finding !== "pending" ||
		Array.from({ length: first.replicate - 1 }, (_, index) => index + 1).some(
			(replicate) => !first.sourceTechnicalExcludedReplicates.includes(replicate),
		) ||
		first.completedArms !== first.verificationDiagnostics.completedWorkItems ||
		first.verificationDiagnostics.completedWorkItems > 1
	)
		throw new TypeError(
			`${label} initial coherent campaign cut was missing: ${JSON.stringify({
				finding: first.finding,
				replicate: first.replicate,
				completedArms: first.completedArms,
				completedWorkItems: first.verificationDiagnostics.completedWorkItems,
			})}`,
		);
	let terminalCount = 0;
	for (let index = 0; index < observations.length; index += 1) {
		const current = observations[index]!;
		const sourceExclusionsBeforeCurrent = current.sourceTechnicalExcludedReplicates.filter(
			(replicate) => replicate < current.replicate,
		).length;
		const expectedCompletedWorkItems =
			(current.replicate - 1 - sourceExclusionsBeforeCurrent) * HARNESS_ARMS.length +
			current.completedArms;
		if (current.verificationDiagnostics.completedWorkItems !== expectedCompletedWorkItems)
			throw new TypeError(`${label} campaign/diagnostics progress binding drifted`);
		if (current.finding !== "pending") {
			terminalCount += 1;
			if (index !== observations.length - 1)
				throw new TypeError(`${label} terminal observation was not final`);
		}
		if (index === 0) continue;
		const previous = observations[index - 1]!;
		assertRootEvalObservationTransition(previous, current, label);
		const completedDelta =
			current.verificationDiagnostics.completedWorkItems -
			previous.verificationDiagnostics.completedWorkItems;
		if (completedDelta > 1) throw new TypeError(`${label} skipped Work Item progress`);
	}
	if (terminalCount !== 1) throw new TypeError(`${label} terminal observation cardinality drifted`);
}

export function assertRootEvalFindingTerminalConsistency(
	finding: EvalFinding,
	terminal?: EvalObservation,
): void {
	const findingRoot = record(finding, "root eval finding");
	exactKeys(findingRoot, ROOT_EVAL_FINDING_KEYS, "root eval finding");
	literal(findingRoot.kind, "eval-efficacy-finding", "root eval finding.kind");
	coordinate(findingRoot.campaignRef, "root eval finding.campaignRef");
	assertExactOrderedRuntimeArray(findingRoot.armOrder, HARNESS_ARMS, "root eval finding.armOrder");
	exactKeys(
		record(findingRoot.passCounts, "root eval finding.passCounts"),
		HARNESS_ARMS,
		"root eval finding.passCounts",
	);
	assertVerificationDiagnosticsRuntimeShape(
		finding.verificationDiagnostics,
		"root eval finding.verificationDiagnostics",
		finding.replicateCount,
	);
	for (const field of [
		"replicateCount",
		"evaluableReplicates",
		"matchedRelevantOverColdWins",
		"completedWorkItems",
		"admittedAttempts",
		"providerCallCount",
		"activeReservedMicrousd",
		"providerReportedMicrousd",
		"pricingRoundingAllowanceMicrousd",
		"providerReportedLowerBoundMicrousd",
		"unreportedSettledUpperBoundMicrousd",
		"accountedUpperBoundMicrousd",
		"billingObservationCount",
		"billingStableIntervals",
		"reconciledBilledMicrousd",
	] as const)
		safeInteger(findingRoot[field], `root eval finding.${field}`);
	const excludedTechnicalReplicates = array(
		findingRoot.excludedTechnicalReplicates,
		"root eval finding.excludedTechnicalReplicates",
	).map((replicate, index) =>
		safeInteger(replicate, `root eval finding.excludedTechnicalReplicates[${index}]`, {
			min: 1,
			max: finding.replicateCount,
		}),
	);
	const sourceTechnicalExcludedReplicates = array(
		findingRoot.sourceTechnicalExcludedReplicates,
		"root eval finding.sourceTechnicalExcludedReplicates",
	).map((replicate, index) =>
		safeInteger(replicate, `root eval finding.sourceTechnicalExcludedReplicates[${index}]`, {
			min: 1,
			max: finding.replicateCount,
		}),
	);
	if (
		new Set(excludedTechnicalReplicates).size !== excludedTechnicalReplicates.length ||
		excludedTechnicalReplicates.some(
			(replicate, index) => index > 0 && replicate <= excludedTechnicalReplicates[index - 1]!,
		) ||
		new Set(sourceTechnicalExcludedReplicates).size !== sourceTechnicalExcludedReplicates.length ||
		sourceTechnicalExcludedReplicates.some(
			(replicate, index) => index > 0 && replicate <= sourceTechnicalExcludedReplicates[index - 1]!,
		) ||
		sourceTechnicalExcludedReplicates.some(
			(replicate) => !excludedTechnicalReplicates.includes(replicate),
		) ||
		finding.evaluableReplicates !== finding.replicateCount - excludedTechnicalReplicates.length ||
		finding.matchedRelevantOverColdWins > finding.evaluableReplicates
	)
		throw new TypeError("root eval finding matched efficacy evidence drifted");
	if (finding.observedBilledMicrousd !== null)
		safeInteger(finding.observedBilledMicrousd, "root eval finding.observedBilledMicrousd");
	if (
		finding.activeReservedMicrousd !== 0 ||
		finding.pricingRoundingAllowanceMicrousd > finding.providerReportedMicrousd ||
		finding.providerReportedLowerBoundMicrousd !==
			Math.max(0, finding.providerReportedMicrousd - finding.pricingRoundingAllowanceMicrousd) ||
		finding.accountedUpperBoundMicrousd !==
			finding.activeReservedMicrousd +
				finding.providerReportedMicrousd +
				finding.unreportedSettledUpperBoundMicrousd ||
		finding.providerCallCount > finding.admittedAttempts ||
		finding.billingStableIntervals > finding.billingObservationCount
	)
		throw new TypeError("root eval finding budget or billing arithmetic drifted");
	if (
		(finding.billingDisposition === "reconciled" &&
			(finding.observedBilledMicrousd === null ||
				finding.reconciledBilledMicrousd !== finding.observedBilledMicrousd)) ||
		(finding.billingDisposition === "rejected" && finding.reconciledBilledMicrousd !== 0)
	)
		throw new TypeError("root eval finding billing disposition drifted");
	const providerReasonTotal = assertProviderOutcomeReasonCountsRuntimeShape(
		finding.providerOutcomeReasonCounts,
		"root eval finding.providerOutcomeReasonCounts",
	);
	if (providerReasonTotal !== finding.admittedAttempts)
		throw new TypeError("root eval finding provider outcome conservation drifted");
	if (finding.billingDisposition !== "reconciled" && finding.billingDisposition !== "rejected")
		throw new TypeError("root eval finding billing disposition invalid");
	literal(finding.stoppingReason, "campaign-complete", "root eval finding.stoppingReason");
	for (const arm of HARNESS_ARMS)
		safeInteger(finding.passCounts[arm], `root eval finding.passCounts.${arm}`, {
			max: finding.replicateCount,
		});
	if (
		!Number.isSafeInteger(finding.replicateCount) ||
		finding.replicateCount < 1 ||
		finding.replicateCount > ROOT_EVAL_REPLICATE_COUNT ||
		finding.armOrder.length !== HARNESS_ARMS.length ||
		finding.armOrder.some((arm, index) => arm !== HARNESS_ARMS[index]) ||
		finding.completedWorkItems !==
			(finding.replicateCount - sourceTechnicalExcludedReplicates.length) * HARNESS_ARMS.length ||
		finding.verificationDiagnostics.completedWorkItems !== finding.completedWorkItems ||
		finding.verificationDiagnostics.armOrder.some((arm, index) => arm !== HARNESS_ARMS[index])
	)
		throw new TypeError("root eval finding structural diagnostics drifted");
	for (const arm of HARNESS_ARMS) {
		const stages = finding.verificationDiagnostics.stageCounts[arm];
		const reasons = finding.verificationDiagnostics.terminalReasonCounts[arm];
		assertVerificationReasonStageConsistency(stages, reasons, finding.replicateCount, arm);
		if (
			stages.completedWorkItems !==
				finding.replicateCount - sourceTechnicalExcludedReplicates.length ||
			finding.passCounts[arm] > stages.passed ||
			finding.passCounts[arm] > finding.evaluableReplicates ||
			(excludedTechnicalReplicates.length === 0 && finding.passCounts[arm] !== stages.passed)
		)
			throw new TypeError("root eval finding pass counts drifted from diagnostics");
	}
	const controlMaximum = Math.max(
		...HARNESS_ARMS.filter((arm) => arm !== "relevant-applied").map(
			(arm) => finding.passCounts[arm],
		),
	);
	const allCleanupSettled = HARNESS_ARMS.every(
		(arm) =>
			finding.verificationDiagnostics.stageCounts[arm].cleanupCompleted ===
			finding.replicateCount - sourceTechnicalExcludedReplicates.length,
	);
	const computedFinding =
		finding.evaluableReplicates < 4
			? "operationally-inconclusive"
			: allCleanupSettled &&
					finding.passCounts["relevant-applied"] >= 3 &&
					finding.passCounts["relevant-applied"] - controlMaximum >= 2 &&
					finding.matchedRelevantOverColdWins >= 3
				? "positive-differential"
				: "no-positive-differential";
	if (finding.finding !== computedFinding)
		throw new TypeError("root eval finding conclusion drifted from pass counts");
	if (terminal === undefined) return;
	assertRootEvalObservationRuntimeShape(terminal, "root eval terminal observation");
	const lastExecutedReplicate = Array.from(
		{ length: finding.replicateCount },
		(_, index) => index + 1,
	)
		.filter((replicate) => !sourceTechnicalExcludedReplicates.includes(replicate))
		.at(-1);
	if (
		terminal.campaignRef !== finding.campaignRef ||
		terminal.replicateCount !== finding.replicateCount ||
		terminal.replicate !== (lastExecutedReplicate ?? finding.replicateCount) ||
		terminal.completedArms !== (lastExecutedReplicate === undefined ? 0 : HARNESS_ARMS.length) ||
		terminal.evaluableReplicates !== finding.evaluableReplicates ||
		terminal.matchedRelevantOverColdWins !== finding.matchedRelevantOverColdWins ||
		empiricalStrictJsonDigest(terminal.excludedTechnicalReplicates) !==
			empiricalStrictJsonDigest(finding.excludedTechnicalReplicates) ||
		empiricalStrictJsonDigest(terminal.sourceTechnicalExcludedReplicates) !==
			empiricalStrictJsonDigest(finding.sourceTechnicalExcludedReplicates) ||
		terminal.activeAdmittedEffects !== 0 ||
		terminal.finding !== finding.finding ||
		terminal.stoppingReason !== finding.stoppingReason ||
		terminal.admittedAttempts !== finding.admittedAttempts ||
		terminal.providerCallCount !== finding.providerCallCount ||
		terminal.activeReservedMicrousd !== finding.activeReservedMicrousd ||
		terminal.providerReportedMicrousd !== finding.providerReportedMicrousd ||
		terminal.pricingRoundingAllowanceMicrousd !== finding.pricingRoundingAllowanceMicrousd ||
		terminal.providerReportedLowerBoundMicrousd !== finding.providerReportedLowerBoundMicrousd ||
		terminal.unreportedSettledUpperBoundMicrousd !== finding.unreportedSettledUpperBoundMicrousd ||
		terminal.accountedUpperBoundMicrousd !== finding.accountedUpperBoundMicrousd ||
		terminal.observedBilledMicrousd !== finding.observedBilledMicrousd ||
		terminal.billingObservationCount !== finding.billingObservationCount ||
		terminal.billingStableIntervals !== finding.billingStableIntervals ||
		terminal.reconciledBilledMicrousd !== finding.reconciledBilledMicrousd ||
		terminal.billingDisposition !== finding.billingDisposition ||
		empiricalStrictJsonDigest(terminal.verificationDiagnostics) !==
			empiricalStrictJsonDigest(finding.verificationDiagnostics) ||
		empiricalStrictJsonDigest(terminal.providerOutcomeReasonCounts) !==
			empiricalStrictJsonDigest(finding.providerOutcomeReasonCounts)
	)
		throw new TypeError("root eval terminal observation drifted from finding");
}

export function createRootEvalTopology(options: RootEvalTopologyOptions): RootEvalTopology {
	const campaignRef = options.campaignRef ?? "graphrefly-efficacy-eval";
	const campaignPurpose = options.campaignPurpose ?? "qualification";
	const replicateCount = options.replicateCount ?? ROOT_EVAL_REPLICATE_COUNT;
	const taskSetRef = options.taskSetRef ?? ROOT_EVAL_DEVELOPMENT_TASKS[0]!.taskSetRef;
	const taskManifestDigest = options.taskManifestDigest ?? ROOT_EVAL_DEVELOPMENT_TASK_SET_DIGEST;
	const taskDefinitions = options.taskDefinitions ?? ROOT_EVAL_DEVELOPMENT_TASKS;
	const derivedTaskBindings = rootEvalTaskBindings(taskDefinitions, campaignRef);
	if (
		options.taskBindings !== undefined &&
		empiricalStrictJsonDigest(options.taskBindings) !==
			empiricalStrictJsonDigest(derivedTaskBindings)
	)
		throw new TypeError("root eval task bindings did not match the frozen candidate catalogs");
	const taskBindings = derivedTaskBindings;
	const generationRef = options.generationRef ?? campaignRef;
	const heldOutSealDigest =
		options.heldOutSealDigest ??
		empiricalStrictJsonDigest({ kind: "root-eval-no-held-out-material", campaignRef });
	const budgetPartition = options.budgetPartition ?? "no-network";
	const partitionHardCapMicrousd =
		options.partitionHardCapMicrousd ?? options.maxCostMicrousd ?? 100_000;
	const partitionSpentBeforeMicrousd = options.partitionSpentBeforeMicrousd ?? 0;
	const partitionLedgerDigest =
		options.partitionLedgerDigest ??
		empiricalStrictJsonDigest({
			kind: "root-eval-empty-partition-ledger",
			budgetPartition,
		});
	const developmentQualificationStreakBefore = options.developmentQualificationStreakBefore ?? 0;
	const executionGrantDigest =
		options.executionGrantDigest ??
		empiricalStrictJsonDigest({ kind: "root-eval-no-network-execution-grant" });
	if (
		(campaignPurpose === "development" &&
			(replicateCount !== ROOT_EVAL_DEVELOPMENT_REPLICATE_COUNT ||
				(budgetPartition !== "development-usd-36" &&
					budgetPartition !== "development-usd-40" &&
					budgetPartition !== "development-usd-45"))) ||
		(campaignPurpose === "confirmatory" &&
			(replicateCount !== ROOT_EVAL_REPLICATE_COUNT || budgetPartition !== "confirmatory-usd-6")) ||
		(campaignPurpose === "qualification" && budgetPartition !== "no-network")
	)
		throw new TypeError(
			"root eval campaign purpose, replicate count, and budget partition drifted",
		);
	coordinate(taskSetRef, "root eval taskSetRef");
	if (!/^sha256:[0-9a-f]{64}$/u.test(taskManifestDigest))
		throw new TypeError("root eval task manifest digest was invalid");
	if (
		taskBindings.length !== replicateCount ||
		taskBindings.some(
			(binding, index) =>
				binding.replicate !== index + 1 ||
				binding.taskInstanceRef !== `${taskSetRef}/instance-${index + 1}` ||
				binding.sourceWorkItemId !== `${binding.taskInstanceRef}/source-work-item` ||
				binding.irrelevantTaskInstanceRef !==
					taskBindings[ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES[index]! - 1]?.taskInstanceRef ||
				binding.irrelevantSourceWorkItemId !==
					`${binding.irrelevantTaskInstanceRef}/source-work-item` ||
				![
					binding.sourceEvidenceDigest,
					binding.sourceInsightDigest,
					binding.irrelevantSourceEvidenceDigest,
					binding.irrelevantSourceInsightDigest,
				].every((value) => /^sha256:[0-9a-f]{64}$/u.test(value)) ||
				!/^sha256:[0-9a-f]{64}$/u.test(binding.sourceCandidateCatalogDigest) ||
				binding.sourceCandidateRefs.length !== 2 ||
				new Set(binding.sourceCandidateRefs).size !== 2 ||
				binding.sourceCandidateRefs.some(
					(candidateRef) => !candidateRef.startsWith(`${binding.sourceWorkItemId}/candidate-`),
				) ||
				Object.keys(binding.targetCandidateCatalogs).length !== HARNESS_ARMS.length ||
				HARNESS_ARMS.some((arm) => {
					const catalog = binding.targetCandidateCatalogs[arm];
					const expectedWorkItemId = workItemId(campaignRef, binding.replicate, arm);
					return (
						catalog?.workItemId !== expectedWorkItemId ||
						!/^sha256:[0-9a-f]{64}$/u.test(catalog.candidateCatalogDigest) ||
						catalog.candidateRefs.length !== 2 ||
						new Set(catalog.candidateRefs).size !== 2 ||
						catalog.candidateRefs.some(
							(candidateRef) => !candidateRef.startsWith(`${expectedWorkItemId}/candidate-`),
						)
					);
				}),
		) ||
		new Set(taskBindings.map((binding) => binding.taskInstanceRef)).size !== replicateCount
	)
		throw new TypeError("root eval task bindings failed closed");
	coordinate(generationRef, "root eval generationRef");
	if (!/^sha256:[0-9a-f]{64}$/u.test(heldOutSealDigest))
		throw new TypeError("root eval held-out seal digest was invalid");
	if (!/^sha256:[0-9a-f]{64}$/u.test(partitionLedgerDigest))
		throw new TypeError("root eval partition ledger digest was invalid");
	if (!/^sha256:[0-9a-f]{64}$/u.test(executionGrantDigest))
		throw new TypeError("root eval execution grant digest was invalid");
	if (
		!Number.isSafeInteger(partitionHardCapMicrousd) ||
		partitionHardCapMicrousd < 1 ||
		!Number.isSafeInteger(partitionSpentBeforeMicrousd) ||
		partitionSpentBeforeMicrousd < 0 ||
		partitionSpentBeforeMicrousd >= partitionHardCapMicrousd
	)
		throw new TypeError("root eval partition budget authority was invalid or exhausted");
	if (
		!Number.isSafeInteger(developmentQualificationStreakBefore) ||
		developmentQualificationStreakBefore < 0 ||
		developmentQualificationStreakBefore > 2 ||
		(campaignPurpose === "confirmatory" && developmentQualificationStreakBefore !== 2) ||
		(campaignPurpose === "qualification" && developmentQualificationStreakBefore !== 0)
	)
		throw new TypeError("root eval development qualification authority was invalid");
	const campaignContractValue: EvalCampaignContract = Object.freeze({
		kind: "eval-campaign-contract",
		executionGrantDigest,
		campaignPurpose,
		taskSetRef,
		generationRef,
		replicateCount,
		heldOutSealDigest,
		budgetPartition,
		partitionHardCapMicrousd,
		partitionSpentBeforeMicrousd,
		partitionLedgerDigest,
		developmentQualificationStreakBefore,
	});
	const maxAttempts = options.maxAttempts ?? rootEvalMaximumProviderAttempts(replicateCount);
	const maxCostMicrousd =
		options.maxCostMicrousd ?? partitionHardCapMicrousd - partitionSpentBeforeMicrousd;
	const reservationMicrousd = options.reservationMicrousd ?? 1_000;
	const effectTimeoutMs = options.effectTimeoutMs ?? ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS;
	const sourceEffectTimeoutMs = options.sourceEffectTimeoutMs ?? effectTimeoutMs;
	const providerPacingSetTimeout = options.providerPacingSetTimeout ?? setTimeout;
	const progressLeaseSetTimeout = options.progressLeaseSetTimeout ?? setTimeout;
	if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)
		throw new TypeError("maxAttempts must be a positive safe integer");
	if (maxAttempts > rootEvalMaximumProviderAttempts(replicateCount))
		throw new TypeError("maxAttempts exceeded the root eval topology capacity");
	if (!Number.isSafeInteger(maxCostMicrousd) || maxCostMicrousd < 1)
		throw new TypeError("maxCostMicrousd must be a positive safe integer");
	if (maxCostMicrousd > partitionHardCapMicrousd - partitionSpentBeforeMicrousd)
		throw new TypeError("maxCostMicrousd exceeded the Graph-visible partition remainder");
	if (!Number.isSafeInteger(reservationMicrousd) || reservationMicrousd < 1)
		throw new TypeError("reservationMicrousd must be a positive safe integer");
	if (
		!Number.isSafeInteger(effectTimeoutMs) ||
		effectTimeoutMs < 1 ||
		effectTimeoutMs > ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS
	)
		throw new TypeError("effectTimeoutMs must be a bounded positive safe integer");
	if (
		!Number.isSafeInteger(sourceEffectTimeoutMs) ||
		sourceEffectTimeoutMs < 1 ||
		sourceEffectTimeoutMs > ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS
	)
		throw new TypeError("sourceEffectTimeoutMs must be a bounded positive safe integer");
	const scheduleFeasibilityValue = rootEvalScheduleFeasibility(
		replicateCount,
		Math.max(effectTimeoutMs, sourceEffectTimeoutMs),
	);
	if (options.profileInput === undefined)
		throw new TypeError("root eval requires a Graph-admitted exact profile input");
	const currentKeyBefore = validateCurrentKeySnapshot(options.currentKeyBefore);

	const owner = graph({ name: "eval/root" });
	const boundaryReleases: (() => void)[] = [];
	const campaignContract = owner.state(campaignContractValue, {
		name: "eval/campaign/contract",
		factory: "rootEvalCampaignContract",
		meta: {
			materialFree: true,
			authority: "campaign-input",
			campaignPurpose,
			taskSetRef,
			generationRef,
			replicateCount,
			heldOutSealDigest,
			budgetPartition,
			partitionHardCapMicrousd,
			partitionSpentBeforeMicrousd,
			partitionLedgerDigest,
			developmentQualificationStreakBefore,
			executionGrantDigest,
			decisionRefs: [
				"graphrefly-ts:D145",
				"graphrefly-ts:D151",
				"graphrefly-ts:D152",
				"graphrefly-ts:D156",
				"graphrefly-ts:D158",
				"graphrefly-ts:D159",
			],
		},
	});
	const taskBindingAuthority = owner.state(Object.freeze(taskBindings), {
		name: "eval/campaign/task-bindings",
		factory: "rootEvalTaskBindingAuthority",
		meta: {
			materialFree: true,
			authority: "sealed-task-manifest-and-occurrence-candidate-catalog",
			taskManifestDigest,
			candidateContract: "two-opaque-refs-per-source-and-target-occurrence",
		},
	});
	const memoryProvenance = owner.state(MEMORY_PROVENANCE, {
		name: "eval/controls/memory-provenance",
		factory: "rootEvalMemoryProvenanceMatrix",
		meta: { treatment: "relevant-applied", controls: 5, armOrder: HARNESS_ARMS },
	});
	const currentKeyBeforeState = owner.state(currentKeyBefore, {
		name: "eval/billing/current-key-before",
		factory: "rootEvalCurrentKeyBefore",
		meta: { materialFree: true, authority: "campaign-input" },
	});
	const profileCatalog = owner.state(options.profileInput, {
		name: "eval/profile/qualified-catalog",
		factory: "rootEvalQualifiedProfileCatalog",
		meta: { decisionRefs: ["graphrefly-ts:D72", "graphrefly-ts:D74"] },
	});
	const currentProviderRoute = owner.state(CURRENT_ROOT_EVAL_PROVIDER_ROUTE, {
		name: "eval/provider/current-route-contract",
		factory: "rootEvalCurrentProviderRouteContract",
		meta: {
			materialFree: true,
			authority: "single-current-package-route",
			decisionRef: "graphrefly-ts:D158",
			providerRef: CURRENT_ROOT_EVAL_PROVIDER_ROUTE.providerRef,
			providerName: CURRENT_ROOT_EVAL_PROVIDER_ROUTE.providerName,
			modelRef: CURRENT_ROOT_EVAL_PROVIDER_ROUTE.modelRef,
			endpointModelRef: CURRENT_ROOT_EVAL_PROVIDER_ROUTE.endpointModelRef,
			fallback: false,
		},
	});
	const profileAdmission = owner.node<RootEvalProfileAdmission>(
		[profileCatalog, currentProviderRoute],
		(ctx) => {
			const route = depLatest(ctx, 1) as CurrentRootEvalProviderRoute | undefined;
			if (route === undefined) return;
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([
					["DATA", admitProfileInsideRootGraph(raw as QualifiedProfileCatalogInput, route)],
				]);
		},
		{
			name: "eval/profile/graph-admission",
			factory: "rootEvalCurrentProfileAdmission",
			meta: { authority: "root-graph", fallback: false },
		},
	);
	const start = owner.node<{ readonly kind: "eval-campaign-start"; readonly campaignRef: string }>(
		[],
		null,
		{
			name: "eval/campaign/start",
			factory: "rootEvalCampaignStart",
			meta: {
				topologyRevision: ROOT_EVAL_TOPOLOGY_REVISION,
				replicateCount,
				armOrder: HARNESS_ARMS,
			},
		},
	);
	const scheduleFeasibility = owner.node<EvalScheduleFeasibility>(
		[start],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const campaignStart = raw as {
					readonly kind: "eval-campaign-start";
					readonly campaignRef: string;
				};
				if (campaignStart.campaignRef !== campaignRef)
					throw new TypeError("eval schedule campaign identity drifted");
				const feasibility = scheduleFeasibilityValue;
				const prior = ctx.state.get<EvalScheduleFeasibility>();
				if (prior !== undefined) {
					if (empiricalStrictJsonDigest(prior) !== empiricalStrictJsonDigest(feasibility))
						throw new TypeError("eval schedule feasibility replay drifted");
					continue;
				}
				ctx.state.set(feasibility);
				ctx.down([["DATA", feasibility]]);
			}
		},
		{
			name: "eval/time/schedule-feasibility",
			factory: "rootEvalScheduleFeasibility",
			meta: {
				materialFree: true,
				authority: "root-graph",
				decisionRef: "graphrefly-ts:D158",
				proof: "campaign-cardinality-times-finite-boundary-leases",
			},
		},
	);
	const providerOutcomeInput = owner.node<EvalProviderOutcome>([], null, {
		name: "eval/provider/result-input",
		factory: "rootEvalProviderResultInput",
		meta: {
			materialPolicy: "digest-and-coordinate-only",
			acceptedStatuses: ["tool-proposed", "failed", "retryable"],
			authority: "single-canonical-provider-result-ingress",
		},
	});
	const allProviderResultAdmissions = owner.node<EvalProviderOutcome>(
		[providerOutcomeInput],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = normalizeProviderOutcomeCandidate(raw as EvalProviderOutcome);
				if (!(["tool-proposed", "failed", "retryable"] as const).includes(outcome.status))
					throw new TypeError("canonical provider result input received an unknown status");
				ctx.down([["DATA", outcome]]);
			}
		},
		{
			name: "eval/provider/all-result-admissions",
			factory: "rootEvalAllProviderResultAdmissions",
			meta: {
				authority: "root-graph",
				maxDispatchesPerWorkItem: ROOT_EVAL_MAX_PROVIDER_DISPATCHES_PER_WORK_ITEM,
				callerAuthority: "submit-correlated-provider-fact-only",
				recoveryAuthority: "graph-normalizes-candidate-and-enforces-bounds",
				resultIngresses: "single-canonical-status-union",
			},
		},
	);
	const providerCostSettlements = owner.node<EvalProviderOutcome>(
		[allProviderResultAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", validateProviderOutcome(raw as EvalProviderOutcome)]]);
		},
		{
			name: "eval/provider/cost-settlements",
			factory: "rootEvalProviderCostSettlements",
			meta: {
				materialFreeDescribe: true,
				payloadPolicy: "private-admitted-outcome",
				policyRef: ROOT_EVAL_NONBILLABLE_POLICY,
				authority: "exact-admission-bound-cost-evidence",
				reportedCostPrecedence: true,
			},
		},
	);
	type EvalProviderStartSpacingReadiness = Readonly<{
		readonly kind: "eval-provider-start-spacing-readiness";
		readonly pacingRevision: number;
		readonly providerStartIntervalMs: number;
		readonly consecutiveUsableResponses: number;
		readonly admissionId: string;
		readonly effectRunId: string;
		readonly dispatchOrdinal: number;
		readonly status: EvalProviderOutcome["status"];
		readonly dispatchAttempted: boolean;
		readonly dispatchElapsedMs: number;
		readonly remainingPacingDelayMs: number;
	}>;
	const providerStartSpacingReadiness = owner.node<EvalProviderStartSpacingReadiness>(
		[allProviderResultAdmissions],
		(ctx) => {
			const state = ctx.state.get<{
				revision: number;
				intervalMs: number;
				successes: number;
				seen: Map<string, string>;
			}>() ?? {
				revision: 0,
				intervalMs: ROOT_EVAL_PROVIDER_START_INTERVAL_MS,
				successes: 0,
				seen: new Map<string, string>(),
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				const digest = empiricalStrictJsonDigest(withoutUndefined(outcome));
				const previous = state.seen.get(outcome.admissionId);
				if (previous !== undefined) {
					if (previous !== digest) throw new TypeError("adaptive pacing outcome replay conflicted");
					continue;
				}
				if (state.seen.size >= rootEvalMaximumProviderAttempts(replicateCount))
					throw new TypeError("adaptive pacing retention exceeded");
				state.seen.set(outcome.admissionId, digest);
				state.revision += 1;
				if (outcome.httpStatus === 429 && outcome.dispatchAttempted) {
					state.intervalMs = Math.min(240_000, state.intervalMs * 2);
					state.successes = 0;
				} else if (outcome.status === "tool-proposed") {
					state.successes += 1;
					if (state.successes === 3) {
						state.intervalMs = Math.max(ROOT_EVAL_PROVIDER_START_INTERVAL_MS, state.intervalMs / 2);
						state.successes = 0;
					}
				} else state.successes = 0;
				ctx.state.set(state);
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-provider-start-spacing-readiness" as const,
							pacingRevision: state.revision,
							providerStartIntervalMs: state.intervalMs,
							consecutiveUsableResponses: state.successes,
							admissionId: outcome.admissionId,
							effectRunId: outcome.effectRunId,
							dispatchOrdinal: outcome.dispatchOrdinal,
							status: outcome.status,
							dispatchAttempted: outcome.dispatchAttempted,
							dispatchElapsedMs: outcome.dispatchElapsedMs,
							// D154: Retry-After starts at response receipt, while interval spacing
							// starts at dispatch. Request exhaustion must not erase route cooldown.
							// The route never turns an over-envelope value into an unbounded wait.
							// Its finite readiness ceiling remains part of schedule feasibility.
							remainingPacingDelayMs: outcome.dispatchAttempted
								? Math.min(
										ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS,
										Math.max(
											0,
											state.intervalMs - outcome.dispatchElapsedMs,
											outcome.responseRetryAfterMs!,
										),
									)
								: 0,
						}),
					],
				]);
			}
		},
		{
			name: "eval/provider/start-spacing-readiness",
			factory: "rootEvalProviderStartSpacingReadiness",
			meta: {
				policy: "D154/30-60-120-240/three-usable-success-recovery",
				stateScope: "campaign-route-across-work-items-and-replicates",
				materialFree: true,
				domainAuthority: "root-graph",
				providerStartIntervalMs: ROOT_EVAL_PROVIDER_START_INTERVAL_MS,
				inputEvidence: "canonical-provider-outcome.dispatchElapsedMs",
			},
		},
	);
	const resultStatusPullIds = Object.freeze({
		terminal: Symbol("eval/provider/result-admission"),
		failed: Symbol("eval/provider/failed-result-admission"),
		retryable: Symbol("eval/provider/retryable-result-admission"),
	});
	const terminalProviderResultAdmissions = owner.node<EvalProviderOutcome>(
		[allProviderResultAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (outcome.status === "tool-proposed") ctx.down([["DATA", outcome]]);
			}
		},
		{
			name: "eval/provider/result-admission",
			factory: "rootEvalProviderResultAdmission",
			pullId: resultStatusPullIds.terminal,
			pausable: "resumeAll",
			meta: { authority: "canonical-status-demux", acceptedStatus: "tool-proposed" },
		},
	);
	const failedProviderResultAdmissions = owner.node<EvalProviderOutcome>(
		[allProviderResultAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (outcome.status === "failed") ctx.down([["DATA", outcome]]);
			}
		},
		{
			name: "eval/provider/failed-result-admission",
			factory: "rootEvalFailedProviderResultAdmission",
			pullId: resultStatusPullIds.failed,
			pausable: "resumeAll",
			meta: { authority: "canonical-status-demux", acceptedStatus: "failed" },
		},
	);
	const retryableProviderResultAdmissions = owner.node<EvalProviderOutcome>(
		[allProviderResultAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (outcome.status === "retryable") ctx.down([["DATA", outcome]]);
			}
		},
		{
			name: "eval/provider/retryable-result-admission",
			factory: "rootEvalRetryableProviderResultAdmission",
			pullId: resultStatusPullIds.retryable,
			pausable: "resumeAll",
			meta: {
				authority: "canonical-status-demux",
				acceptedStatus: "retryable",
				maxDispatchesPerWorkItem: ROOT_EVAL_MAX_PROVIDER_DISPATCHES_PER_WORK_ITEM,
			},
		},
	);

	const resultStatusReleaseEvents = owner.initNode(
		merge<EvalProviderOutcome>(),
		[
			allProviderResultAdmissions,
			terminalProviderResultAdmissions,
			failedProviderResultAdmissions,
			retryableProviderResultAdmissions,
		],
		{ name: "eval/provider/result-status-release-events" },
	);
	const resultStatusReleaseController = owner.node(
		[resultStatusReleaseEvents],
		(ctx) => {
			const seen = ctx.state.get<Set<string>>() ?? new Set<string>();
			const statuses = new Set<EvalProviderOutcome["status"]>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = validateProviderOutcome(raw as EvalProviderOutcome);
				if (seen.has(value.admissionId)) continue;
				if (seen.size >= rootEvalMaximumProviderAttempts(replicateCount))
					throw new TypeError("result release bound exceeded");
				seen.add(value.admissionId);
				statuses.add(value.status);
			}
			ctx.state.set(seen);
			if (statuses.has("tool-proposed"))
				ctx.upNext([["PULL", { pullId: resultStatusPullIds.terminal }]]);
			if (statuses.has("failed")) ctx.upNext([["PULL", { pullId: resultStatusPullIds.failed }]]);
			if (statuses.has("retryable"))
				ctx.upNext([["PULL", { pullId: resultStatusPullIds.retryable }]]);
		},
		{
			name: "eval/provider/result-status-release-controller",
			factory: "rootEvalProviderResultStatusReleaseController",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { role: "quiet-provider-result-status-demux" },
		},
	);
	boundaryReleases.push(
		owner.retain(resultStatusReleaseController, {
			reason: "eval provider result status release",
		}),
	);
	type EvalProviderOutcomeBatch = Readonly<{
		readonly kind: "eval-provider-outcome-batch";
		readonly replicate: number;
		readonly dispatchOrdinal: number;
		readonly complete: boolean;
		readonly outcomes: readonly EvalProviderOutcome[];
	}>;
	interface EvalProviderOutcomeBatchState {
		readonly outcomesByDispatch: Map<number, Map<number, Map<HarnessArm, EvalProviderOutcome>>>;
		readonly lastEmittedDigests: Map<string, string>;
	}
	const resultBatchEvents = owner.initNode(
		merge<EvalProviderOutcome>(),
		[
			terminalProviderResultAdmissions,
			failedProviderResultAdmissions,
			retryableProviderResultAdmissions,
		],
		{ name: "eval/provider/result-batch-events" },
	);
	owner.node<EvalProviderOutcomeBatch>(
		[resultBatchEvents],
		(ctx) => {
			const state = ctx.state.get<EvalProviderOutcomeBatchState>() ?? {
				outcomesByDispatch: new Map<number, Map<number, Map<HarnessArm, EvalProviderOutcome>>>(),
				lastEmittedDigests: new Map<string, string>(),
			};
			const emitted: EvalProviderOutcomeBatch[] = [];
			const touchedReplicates = new Set<number>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (outcome.workItemRole === "source") continue;
				const byReplicate =
					state.outcomesByDispatch.get(outcome.dispatchOrdinal) ??
					new Map<number, Map<HarnessArm, EvalProviderOutcome>>();
				const byArm =
					byReplicate.get(outcome.replicate) ?? new Map<HarnessArm, EvalProviderOutcome>();
				const arm = outcome.arm as HarnessArm;
				const prior = byArm.get(arm);
				if (prior !== undefined && prior.resultDigest !== outcome.resultDigest)
					throw new TypeError("provider outcome batch received contradictory arm replay");
				if (prior !== undefined) continue;
				byArm.set(arm, outcome);
				byReplicate.set(outcome.replicate, byArm);
				state.outcomesByDispatch.set(outcome.dispatchOrdinal, byReplicate);
				touchedReplicates.add(outcome.replicate);
			}
			for (const replicate of touchedReplicates) {
				let precedingComplete = true;
				let expectedCount: number = HARNESS_ARMS.length;
				for (
					let dispatchOrdinal = 1;
					dispatchOrdinal <= ROOT_EVAL_MAX_PROVIDER_DISPATCHES_PER_WORK_ITEM;
					dispatchOrdinal += 1
				) {
					const byArm = state.outcomesByDispatch.get(dispatchOrdinal)?.get(replicate);
					if (byArm === undefined) {
						precedingComplete = false;
						expectedCount = 0;
						continue;
					}
					if (precedingComplete && byArm.size > expectedCount)
						throw new TypeError("provider outcome batch exceeded its retry cardinality");
					const outcomes = Object.freeze(
						HARNESS_ARMS.flatMap((arm) => {
							const value = byArm.get(arm);
							return value === undefined ? [] : [value];
						}),
					);
					const complete: boolean = precedingComplete && byArm.size === expectedCount;
					const batch = Object.freeze({
						kind: "eval-provider-outcome-batch" as const,
						replicate,
						dispatchOrdinal,
						complete,
						outcomes,
					});
					const batchKey = `${replicate}:${dispatchOrdinal}`;
					const batchDigest = empiricalStrictJsonDigest(withoutUndefined(batch));
					if (state.lastEmittedDigests.get(batchKey) !== batchDigest) {
						state.lastEmittedDigests.set(batchKey, batchDigest);
						emitted.push(batch);
					}
					precedingComplete = complete;
					expectedCount = outcomes.filter((value) => value.status === "retryable").length;
				}
			}
			if (emitted.length > 0) ctx.down(emitted.map((batch) => ["DATA", batch] as const));
			ctx.state.set(state);
		},
		{
			name: "eval/provider/result-batches",
			factory: "rootEvalProviderOutcomeBatches",
			completeWhenDepsComplete: false,
			errorWhenDepsError: true,
			meta: { canonicalArmOrder: HARNESS_ARMS, retryCardinalityAuthority: true },
		},
	);
	const targetToolOutcomes = owner.node<EvalEffectOutcome>([], null, {
		name: "eval/tool/result-input",
		factory: "rootEvalExactToolResultInput",
		meta: { materialPolicy: "digest-and-coordinate-only", workItemRole: "target" },
	});
	const sourceToolOutcomes = owner.node<EvalEffectOutcome>([], null, {
		name: "eval/source-work-item/tool-result-input",
		factory: "rootEvalSourceExactToolResultInput",
		meta: { materialPolicy: "digest-and-coordinate-only", workItemRole: "source" },
	});

	const allToolOutcomes = owner.initNode(
		merge<EvalEffectOutcome>(),
		[sourceToolOutcomes, targetToolOutcomes],
		{ name: "eval/tool/all-result-inputs" },
	);
	const retryDelayOutcomes = owner.node<EvalRetryDelayOutcome>([], null, {
		name: "eval/retry/delay-result-input",
		factory: "rootEvalRetryDelayResultInput",
		meta: { materialPolicy: "digest-and-coordinate-only" },
	});
	const billingObservationOutcomes = owner.node<EvalBillingObservationOutcome>([], null, {
		name: "eval/billing/observation-result-input",
		factory: "rootEvalBillingObservationResultInput",
		meta: { materialPolicy: "bounded-coordinate-only" },
	});

	const targetTerminalPullId = Symbol("target/terminal-outcome");
	const targetTerminalInputs = owner.initNode(
		merge<EvalProviderOutcome | EvalEffectOutcome>(),
		[failedProviderResultAdmissions, targetToolOutcomes],
		{ name: "eval/effect/terminal-outcomes/inputs" },
	);
	const targetOutcomes = owner.node<EvalEffectOutcome>(
		[targetTerminalInputs],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if ((raw as { kind: string }).kind !== "eval-provider-outcome") continue;
				const provider = validateProviderOutcome(raw as EvalProviderOutcome);
				if (provider.status === "failed" && provider.workItemRole === "target") {
					ctx.down([["DATA", providerFailureOutcome(provider)]]);
				}
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				if ((raw as { kind: string }).kind === "eval-provider-outcome") continue;
				ctx.down([["DATA", validateOutcomeReceipt(raw as EvalEffectOutcome)]]);
			}
		},
		{
			name: "eval/effect/terminal-outcomes",
			factory: "rootEvalTerminalOutcomes",
			pullId: targetTerminalPullId,
			pausable: "resumeAll",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);

	const targetTerminalReleases = owner.initNode(
		merge<unknown>(),
		[targetTerminalInputs, targetOutcomes],
		{ name: "eval/effect/terminal-outcomes/release-events" },
	);
	const targetTerminalReleaseController = owner.node(
		[targetTerminalReleases],
		(ctx) => {
			const seen = ctx.state.get<Set<string>>() ?? new Set<string>();
			let fresh = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = raw as EvalProviderOutcome | EvalEffectOutcome;
				if (value.workItemRole !== "target" || seen.has(value.executionId)) continue;
				if (seen.size >= rootEvalMaximumProviderAttempts(replicateCount))
					throw new TypeError("terminal outcome release exceeded its occurrence bound");
				seen.add(value.executionId);
				fresh = true;
			}
			ctx.state.set(seen);
			if (fresh) ctx.upNext([["PULL", { pullId: targetTerminalPullId }]]);
		},
		{
			name: "eval/effect/terminal-outcomes/release-controller",
			factory: "rootEvalTerminalOutcomeReleaseController",
		},
	);
	boundaryReleases.push(
		owner.retain(targetTerminalReleaseController, {
			reason: "only actual target terminal DATA opens its downstream lifecycle",
		}),
	);
	type EvalSourceTerminalInput =
		| Readonly<{
				readonly kind: "eval-source-provider-failure-input";
				readonly provider: EvalProviderOutcome;
				readonly outcome: EvalEffectOutcome;
		  }>
		| Readonly<{
				readonly kind: "eval-source-tool-outcome-input";
				readonly outcome: EvalEffectOutcome;
		  }>;

	const sourceTerminalPullId = Symbol("source/terminal-outcome");
	const sourceTerminalInputs = owner.initNode(
		merge<EvalProviderOutcome | EvalEffectOutcome>(),
		[failedProviderResultAdmissions, sourceToolOutcomes],
		{ name: "eval/source-work-item/terminal-outcomes/inputs" },
	);
	const sourceOutcomes = owner.node<EvalSourceTerminalInput>(
		[sourceTerminalInputs],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if ((raw as { kind: string }).kind !== "eval-provider-outcome") continue;
				const provider = validateProviderOutcome(raw as EvalProviderOutcome);
				if (provider.status === "failed" && provider.workItemRole === "source") {
					ctx.down([
						[
							"DATA",
							Object.freeze({
								kind: "eval-source-provider-failure-input" as const,
								provider,
								outcome: providerFailureOutcome(provider),
							}),
						],
					]);
				}
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				if ((raw as { kind: string }).kind === "eval-provider-outcome") continue;
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
				ctx.down([
					["DATA", Object.freeze({ kind: "eval-source-tool-outcome-input" as const, outcome })],
				]);
			}
		},
		{
			name: "eval/source-work-item/terminal-outcomes",
			factory: "rootEvalSourceTerminalOutcomes",
			pullId: sourceTerminalPullId,
			pausable: "resumeAll",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);

	const sourceTerminalReleases = owner.initNode(
		merge<unknown>(),
		[sourceTerminalInputs, sourceOutcomes],
		{ name: "eval/source-work-item/terminal-outcomes/release-events" },
	);
	const sourceTerminalReleaseController = owner.node(
		[sourceTerminalReleases],
		(ctx) => {
			const seen = ctx.state.get<Set<string>>() ?? new Set<string>();
			let fresh = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = raw as EvalProviderOutcome | EvalEffectOutcome;
				if (value.workItemRole !== "source" || seen.has(value.executionId)) continue;
				if (seen.size >= rootEvalMaximumProviderAttempts(replicateCount))
					throw new TypeError("terminal outcome release exceeded its occurrence bound");
				seen.add(value.executionId);
				fresh = true;
			}
			ctx.state.set(seen);
			if (fresh) ctx.upNext([["PULL", { pullId: sourceTerminalPullId }]]);
		},
		{
			name: "eval/source-work-item/terminal-outcomes/release-controller",
			factory: "rootEvalTerminalOutcomeReleaseController",
		},
	);
	boundaryReleases.push(
		owner.retain(sourceTerminalReleaseController, {
			reason: "only actual source terminal DATA opens its downstream lifecycle",
		}),
	);

	const resultProjection = owner.node<EffectRunResult>(
		[targetOutcomes],
		(ctx) => {
			const settled = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
				if (settled.has(outcome.admissionId)) continue;
				settled.add(outcome.admissionId);
				const result = finalResult(outcome);
				if (result !== undefined) {
					ctx.down([["DATA", result]]);
				}
			}
			ctx.state.set(settled);
		},
		{
			name: "eval/provider/reconciliation",
			factory: "rootEvalProviderReconciliation",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { correlation: "admissionId+effectRunId+dispatchOrdinal" },
		},
	);
	const sourceResultProjection = owner.node<EffectRunResult>(
		[sourceOutcomes],
		(ctx) => {
			const settled = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateOutcomeReceipt((raw as EvalSourceTerminalInput).outcome);
				if (settled.has(outcome.admissionId)) continue;
				settled.add(outcome.admissionId);
				const result = finalResult(outcome);
				if (result !== undefined) {
					ctx.down([["DATA", result]]);
				}
			}
			ctx.state.set(settled);
		},
		{
			name: "eval/source-work-item/reconciliation",
			factory: "rootEvalSourceWorkItemReconciliation",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { correlation: "admissionId+effectRunId+dispatchOrdinal", workItemRole: "source" },
		},
	);
	const sourceRequestAuthority = owner.node<readonly EvalSourceWorkItemRequest[]>(
		[taskBindingAuthority, campaignContract],
		(ctx) => {
			const bindings = depLatest(ctx, 0) as readonly RootEvalTaskBinding[] | undefined;
			const contract = depLatest(ctx, 1) as EvalCampaignContract | undefined;
			if (bindings === undefined || contract === undefined) return;
			ctx.down([
				[
					"DATA",
					Object.freeze(
						bindings.map((binding) =>
							sourceRequest(campaignRef, contract.taskSetRef, taskManifestDigest, binding),
						),
					),
				],
			]);
		},
		{
			name: "eval/source-work-item/request-authority",
			factory: "rootEvalSourceWorkItemRequestAuthority",
			meta: { authority: "sealed-task-manifest", taskManifestDigest },
		},
	);
	const sourceSchedule = owner.node<EvalSourceWorkItemRequest>(
		[start, sourceRequestAuthority, campaignContract],
		(ctx) => {
			if (ctx.state.get<boolean>() === true) return;
			const requests = depLatest(ctx, 1) as readonly EvalSourceWorkItemRequest[] | undefined;
			const contract = depLatest(ctx, 2) as EvalCampaignContract | undefined;
			if ((depBatch(ctx, 0)?.length ?? 0) === 0 || requests === undefined || contract === undefined)
				return;
			if (contract.taskSetRef !== taskSetRef || requests.length !== contract.replicateCount)
				throw new TypeError("source schedule lost its Graph campaign authority");
			ctx.state.set(true);
			ctx.down(requests.map((request) => ["DATA", request] as const));
		},
		{
			name: "eval/source-work-item/schedule",
			factory: "rootEvalSourceWorkItemSchedule",
			meta: {
				authority: "five-real-source-work-items-before-targets",
				taskManifestDigest,
				occurrenceDelivery: "one-bounded-five-occurrence-data-wave",
			},
		},
	);
	const sourceWorkItems = owner.node<WorkItemProjection<Record<string, unknown>>>(
		[sourceSchedule],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", sourceWorkItemFor(raw as EvalSourceWorkItemRequest)]]);
		},
		{
			name: "eval/source-work-item/objective-data",
			factory: "rootEvalSourceWorkItemData",
			meta: { solutionIdentity: "work-item", role: "causally-prior-source" },
		},
	);
	const sourceEffectPlans = owner.node<WorkItemEffectPlanProposed<Record<string, unknown>>>(
		[sourceSchedule, profileAdmission],
		(ctx) => {
			if (depLatest(ctx, 1) === undefined) return;
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([
					["DATA", sourcePlanFor(raw as EvalSourceWorkItemRequest, sourceEffectTimeoutMs)],
				]);
		},
		{
			name: "eval/source-work-item/attempt-resource-plan",
			factory: "rootEvalSourceWorkItemPlan",
			meta: { sourceBeforeMemory: true, timeoutAuthority: "work-item-effect-plan" },
		},
	);
	const sourceExecution = workItemExecutionRecipe(owner, {
		name: "eval/solution/source-work-item-execution",
		workItems: sourceWorkItems,
		effectPlanProposals: sourceEffectPlans,
		effectRunResults: sourceResultProjection,
		now: () => 0,
	});
	const _toolResults = owner.node<EvalEffectOutcome>(
		[sourceToolOutcomes],
		(ctx) => {
			const settled = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
				if (settled.has(outcome.admissionId)) continue;
				settled.add(outcome.admissionId);
				ctx.down([["DATA", outcome]]);
			}
			ctx.state.set(settled);
		},
		{ name: "eval/tool/result", factory: "rootEvalExactToolResult" },
	);
	const sourceVerificationCandidate = owner.node<EvalSourceTerminalFact>(
		[sourceRequestAuthority, sourceOutcomes],
		(ctx) => {
			const requests = new Map(
				((depLatest(ctx, 0) as readonly EvalSourceWorkItemRequest[] | undefined) ?? []).map(
					(request) => [request.sourceWorkItemId, request] as const,
				),
			);
			for (const raw of depBatch(ctx, 1) ?? []) {
				const input = raw as EvalSourceTerminalInput;
				const outcome = validateOutcomeReceipt(input.outcome);
				if (outcome.workItemRole !== "source") continue;
				const request = requests.get(outcome.workItemId);
				if (request === undefined)
					throw new TypeError("source Work Item result lacked its Graph request DATA");
				if (input.kind === "eval-source-provider-failure-input") {
					if (!TECHNICAL_FAILURE_REASONS.has(input.provider.reason))
						throw new TypeError("source Work Item non-technical failure failed closed");
					ctx.down([
						[
							"DATA",
							Object.freeze({
								kind: "eval-source-work-item-technical-exclusion" as const,
								request,
								sourceWorkItemId: request.sourceWorkItemId,
								replicate: request.replicate,
								reason: input.provider.reason as EvalTechnicalFailureReason,
								providerEffectSettled: true as const,
							}),
						],
					]);
					continue;
				}
				if (
					outcome.arm !== "source" ||
					outcome.status !== "completed" ||
					outcome.evidence.diff !== "scoped-change" ||
					outcome.evidence.publicSemantic !== "equivalent" ||
					outcome.evidence.hiddenVerifier !== "pass" ||
					outcome.evidence.cleanupCompleted !== true ||
					outcome.evidence.expectedDigest !== request.sourceEvidenceDigest
				)
					throw new TypeError("source Work Item verification failed closed");
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-source-work-item-verified" as const,
							request,
							sourceWorkItemId: request.sourceWorkItemId,
							taskInstanceRef: request.taskInstanceRef,
							sourceEvidenceDigest: request.sourceEvidenceDigest,
							sourceInsightDigest: request.sourceInsightDigest,
							verified: true as const,
							cleanupCompleted: true as const,
						}),
					],
				]);
			}
		},
		{
			name: "eval/source-work-item/outcome-evidence-verification/candidate",
			factory: "rootEvalSourceWorkItemVerificationCandidate",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				failClosed: true,
				materialFree: true,
				cleanupRequired: true,
				independentExecutorReceiptRequired: true,
			},
		},
	);

	const sourceVerificationBoundary = rootEvalQuietDataBoundary<EvalSourceTerminalFact>(
		owner,
		sourceVerificationCandidate,
		{
			name: "eval/source-work-item/outcome-evidence-verification",
			factory: "rootEvalSourceWorkItemVerification",
			maxOccurrences: replicateCount,
			key: (value) => value.sourceWorkItemId,
			meta: { materialFree: true, completeDomainOccurrence: true },
		},
	);
	const sourceVerification = sourceVerificationBoundary.output;
	boundaryReleases.push(sourceVerificationBoundary.release);
	const sourceTerminalCandidates = owner.node<AdmissionHandoffCandidate<EvalSourceTerminalFact>>(
		[sourceVerification],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as EvalSourceTerminalFact;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "admission-handoff-candidate" as const,
							candidateId: fact.sourceWorkItemId,
							candidateFingerprint: empiricalStrictJsonDigest(fact),
							value: fact,
						}),
					],
				]);
			}
		},
		{
			name: "eval/source-work-item/memory-handoff-candidate",
			factory: "rootEvalSourceMemoryHandoffCandidate",
			meta: { role: "work-item-terminal-candidate", materialFree: true },
		},
	);
	const sourceTerminalDecisions = owner.node<
		AdmissionHandoffDecision<{ readonly terminalKind: EvalSourceTerminalFact["kind"] }>
	>(
		[sourceVerification],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as EvalSourceTerminalFact;
				const state =
					fact.kind === "eval-source-work-item-verified"
						? ("admitted" as const)
						: ("rejected" as const);
				const reason = Object.freeze({ terminalKind: fact.kind });
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "admission-handoff-decision" as const,
							decisionId: `${fact.sourceWorkItemId}/memory-handoff-terminal`,
							decisionFingerprint: empiricalStrictJsonDigest({
								candidateFingerprint: empiricalStrictJsonDigest(fact),
								state,
								reason,
							}),
							candidateId: fact.sourceWorkItemId,
							candidateFingerprint: empiricalStrictJsonDigest(fact),
							state,
							reason,
						}),
					],
				]);
			}
		},
		{
			name: "eval/source-work-item/memory-handoff-decision",
			factory: "rootEvalSourceMemoryHandoffDecision",
			meta: { role: "source-verification-admission", failClosed: true, materialFree: true },
		},
	);
	const sourceMemoryHandoff = admissionHandoff(owner, {
		name: "eval/source-work-item/memory-handoff",
		candidates: sourceTerminalCandidates,
		decisions: sourceTerminalDecisions,
		maxPending: ROOT_EVAL_REPLICATE_COUNT,
		maxRecent: ROOT_EVAL_REPLICATE_COUNT * 2,
	});
	const verifiedSourceWorkItems = owner.node<WorkItemProjection<Record<string, unknown>>>(
		[sourceMemoryHandoff.accepted],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = (raw as { readonly value: EvalSourceTerminalFact }).value;
				if (fact.kind !== "eval-source-work-item-verified")
					throw new TypeError("admission handoff accepted an unverified source terminal");
				ctx.down([["DATA", verifiedSourceWorkItemFor(fact)]]);
			}
		},
		{
			name: "eval/source-work-item/verified-solution",
			factory: "rootEvalVerifiedSourceWorkItem",
			meta: { source: "real-work-item-execution-result" },
		},
	);

	const diff = owner.node<EvalDiffFact>(
		[targetOutcomes],
		(ctx) => {
			const settled = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
				if (outcome.workItemRole === "source") continue;
				if (settled.has(outcome.admissionId)) continue;
				settled.add(outcome.admissionId);
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-diff-fact" as const,
							outcome,
							scopedChange:
								outcome.status === "completed" && outcome.evidence.diff === "scoped-change",
						}),
					],
				]);
			}
			ctx.state.set(settled);
		},
		{
			name: "eval/verification/diff",
			factory: "rootEvalDiffVerification",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const publicSemantic = owner.node<EvalPublicSemanticFact>(
		[diff],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as EvalDiffFact;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-public-semantic-fact" as const,
							outcome: fact.outcome,
							diffPassed: fact.scopedChange,
							publicSemanticPassed:
								fact.scopedChange && fact.outcome.evidence.publicSemantic === "equivalent",
						}),
					],
				]);
			}
		},
		{
			name: "eval/verification/public-semantic",
			factory: "rootEvalPublicSemanticVerification",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const hiddenVerifier = owner.node<EvalHiddenVerifierFact>(
		[publicSemantic],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as EvalPublicSemanticFact;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-hidden-verifier-fact" as const,
							outcome: fact.outcome,
							diffPassed: fact.diffPassed,
							publicSemanticPassed: fact.publicSemanticPassed,
							hiddenVerifierPassed:
								fact.publicSemanticPassed && fact.outcome.evidence.hiddenVerifier === "pass",
							passed: fact.publicSemanticPassed && fact.outcome.evidence.hiddenVerifier === "pass",
						}),
					],
				]);
			}
		},
		{
			name: "eval/verification/hidden-verifier",
			factory: "rootEvalHiddenVerifier",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const cleanup = owner.node<EvalCleanupFact>(
		[hiddenVerifier],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as EvalHiddenVerifierFact;
				const workItemRef = fact.outcome.workItemId;
				const arm = armFromWorkItemId(workItemRef);
				if (arm === undefined) continue;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-cleanup-complete" as const,
							workItemId: workItemRef,
							replicate: replicateFromWorkItemId(workItemRef),
							arm,
							exactToolAdmitted: fact.outcome.toolAdmissionId !== null,
							scopedChange: fact.diffPassed,
							publicSemanticPassed: fact.publicSemanticPassed,
							hiddenVerifierPassed: fact.hiddenVerifierPassed,
							cleanupCompleted: fact.outcome.evidence.cleanupCompleted,
							passed: fact.passed && fact.outcome.evidence.cleanupCompleted,
							terminalReason: evalVerificationTerminalReason(fact.outcome),
							resultDigest: fact.outcome.resultDigest,
						}),
					],
				]);
			}
		},
		{
			name: "eval/cleanup/completed",
			factory: "rootEvalCleanup",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);

	const verificationDiagnosticsEvents = owner.initNode(merge<unknown>(), [start, cleanup], {
		name: "eval/verification/diagnostic-events",
	});
	const verificationDiagnostics = owner.node<EvalVerificationDiagnostics>(
		[verificationDiagnosticsEvents],
		(ctx) => {
			const completed = ctx.state.get<Map<string, EvalCleanupFact>>() ?? new Map();
			const snapshots: EvalVerificationDiagnostics[] = [];
			if (
				(depBatch(ctx, 0) ?? []).some(
					(raw) => (raw as { kind: string }).kind === "eval-campaign-start",
				)
			)
				snapshots.push(verificationDiagnosticsSnapshot(completed));
			for (const raw of depBatch(ctx, 0) ?? []) {
				if ((raw as { kind: string }).kind !== "eval-cleanup-complete") continue;
				const fact = raw as EvalCleanupFact;
				const previous = completed.get(fact.workItemId);
				if (previous !== undefined) {
					if (empiricalStrictJsonDigest(previous) !== empiricalStrictJsonDigest(fact))
						throw new TypeError("eval verification diagnostics observed contradictory cleanup");
					continue;
				}
				completed.set(fact.workItemId, fact);
				snapshots.push(verificationDiagnosticsSnapshot(completed));
			}
			ctx.state.set(completed);
			if (snapshots.length > 0) ctx.down(snapshots.map((snapshot) => ["DATA", snapshot]));
		},
		{
			name: "eval/verification/diagnostics",
			factory: "rootEvalVerificationDiagnostics",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				domainAuthority: "graph-state",
				materialFree: true,
				terminalReasonPrecedence: EVAL_VERIFICATION_TERMINAL_REASONS,
			},
		},
	);

	type CampaignConfiguration = Readonly<{
		kind: "eval-campaign-configuration";
		contract: EvalCampaignContract;
		bindings: readonly RootEvalTaskBinding[];
		provenance: Readonly<Record<HarnessArm, EvalMemoryProvenance>>;
		requests: readonly EvalSourceWorkItemRequest[];
	}>;
	const campaignConfiguration = owner.node<CampaignConfiguration>(
		[campaignContract, taskBindingAuthority, memoryProvenance, sourceRequestAuthority],
		(ctx) => {
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-campaign-configuration" as const,
						contract: depLatest(ctx, 0) as EvalCampaignContract,
						bindings: depLatest(ctx, 1) as readonly RootEvalTaskBinding[],
						provenance: depLatest(ctx, 2) as Readonly<Record<HarnessArm, EvalMemoryProvenance>>,
						requests: depLatest(ctx, 3) as readonly EvalSourceWorkItemRequest[],
					}),
				],
			]);
		},
		{ name: "eval/campaign/sealed-configuration", factory: "rootEvalCampaignConfiguration" },
	);
	const campaignEvents = owner.initNode(
		merge<unknown>(),
		[campaignConfiguration, cleanup, sourceMemoryHandoff.status],
		{ name: "eval/campaign/controller-events" },
	);
	const campaign = owner.node<readonly EvalArmDispatch[] | EvalCampaignState>(
		[campaignEvents],
		(ctx) => {
			const state = ctx.state.get<
				CampaignControllerState & { configuration?: CampaignConfiguration }
			>() ?? {
				started: false,
				replicate: 1,
				completedByReplicate: new Map<number, Set<HarnessArm>>(),
				sourceTerminals: new Map<number, EvalCampaignSourceTerminal>(),
				dispatchedReplicates: new Set<number>(),
			};
			const events = depBatch(ctx, 0) ?? [];
			for (const raw of events)
				if ((raw as { kind: string }).kind === "eval-campaign-configuration") {
					const configuration = raw as CampaignConfiguration;
					if (
						state.configuration !== undefined &&
						empiricalStrictJsonDigest(state.configuration) !==
							empiricalStrictJsonDigest(configuration)
					)
						throw new TypeError("sealed campaign configuration drifted");
					state.configuration = configuration;
				}
			const { contract, bindings, provenance, requests } = state.configuration ?? {};
			if (
				contract === undefined ||
				bindings === undefined ||
				provenance === undefined ||
				requests === undefined
			) {
				if (events.some((raw) => (raw as { kind: string }).kind !== "eval-campaign-configuration"))
					throw new TypeError("campaign event preceded sealed configuration");
				ctx.state.set(state);
				return;
			}
			const sourceTerminalByWorkItemId = () =>
				new Map(
					[...state.sourceTerminals.values()].map((fact) => [fact.sourceWorkItemId, fact] as const),
				);
			const requiredSourceTerminals = (replicate: number) => {
				const binding = bindings[replicate - 1];
				if (binding === undefined) return undefined;
				const byWorkItemId = sourceTerminalByWorkItemId();
				return Object.freeze([
					byWorkItemId.get(binding.sourceWorkItemId),
					byWorkItemId.get(binding.irrelevantSourceWorkItemId),
				] as const);
			};
			const sourceExclusions = () =>
				Object.freeze(
					bindings
						.filter((binding) =>
							requiredSourceTerminals(binding.replicate)?.some(
								(fact) => fact?.state === "technical-exclusion",
							),
						)
						.map((binding) => binding.replicate)
						.sort((left, right) => left - right),
				);
			const nextEligibleReplicate = (after: number) => {
				for (let candidate = after + 1; candidate <= contract.replicateCount; candidate += 1) {
					if (requiredSourceTerminals(candidate)?.every((fact) => fact?.state === "verified"))
						return candidate;
				}
				return undefined;
			};
			const emitReplicate = (replicate: number) => {
				if (replicate > contract.replicateCount || state.dispatchedReplicates.has(replicate))
					return;
				const fact = state.sourceTerminals.get(replicate);
				const binding = bindings[replicate - 1];
				if (
					fact?.state !== "verified" ||
					binding === undefined ||
					!requiredSourceTerminals(replicate)?.every((required) => required?.state === "verified")
				)
					return;
				state.dispatchedReplicates.add(replicate);
				state.replicate = replicate;
				ctx.down([["DATA", dispatchBatch(campaignRef, fact.request, binding, provenance)]]);
			};
			for (const raw of events) {
				if ((raw as { kind: string }).kind !== "admission-handoff-status") continue;
				const status = raw as AdmissionHandoffStatus;
				if (status.state !== "accepted" && status.state !== "rejected") continue;
				const request = requests.find(
					(candidate) => candidate.sourceWorkItemId === status.candidateId,
				);
				if (request === undefined)
					throw new TypeError("source handoff terminal status lacked a sealed request");
				state.sourceTerminals.set(
					request.replicate,
					status.state === "accepted"
						? Object.freeze({
								state: "verified" as const,
								sourceWorkItemId: request.sourceWorkItemId,
								request,
							})
						: Object.freeze({
								state: "technical-exclusion" as const,
								sourceWorkItemId: request.sourceWorkItemId,
								replicate: request.replicate,
							}),
				);
			}
			if (state.sourceTerminals.size === contract.replicateCount && !state.started) {
				state.started = true;
				const first = nextEligibleReplicate(0);
				if (first === undefined) {
					emitCampaignState(
						ctx,
						campaignRef,
						contract,
						contract.replicateCount,
						sourceExclusions(),
						0,
						"stopped",
						"campaign-complete",
					);
				} else {
					emitCampaignState(
						ctx,
						campaignRef,
						contract,
						first,
						sourceExclusions(),
						0,
						"running",
						"none",
					);
					emitReplicate(first);
				}
			}
			for (const raw of events) {
				if ((raw as { kind: string }).kind !== "eval-cleanup-complete") continue;
				const item = raw as EvalCleanupFact;
				const completed = state.completedByReplicate.get(item.replicate) ?? new Set<HarnessArm>();
				completed.add(item.arm);
				state.completedByReplicate.set(item.replicate, completed);
				const next =
					completed.size === HARNESS_ARMS.length
						? nextEligibleReplicate(item.replicate)
						: undefined;
				if (next !== undefined) emitReplicate(next);
				const stopped = completed.size === HARNESS_ARMS.length && next === undefined;
				emitCampaignState(
					ctx,
					campaignRef,
					contract,
					item.replicate,
					sourceExclusions(),
					completed.size,
					stopped ? "stopped" : "running",
					stopped ? "campaign-complete" : "none",
				);
			}
			ctx.state.set(state);
		},
		{
			name: "eval/campaign/replicate-controller",
			factory: "rootEvalReplicateController",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				replicates: replicateCount,
				armsPerReplicate: HARNESS_ARMS.length,
				parallelism: "six-admitted-effects-per-replicate",
				campaignPurpose,
				taskSetRef,
				generationRef,
				heldOutSealDigest,
				budgetPartition,
				sourceFailurePolicy: "fail-closed-dependency-closure",
				adaptiveRetryMayRebind: false,
			},
		},
	);

	const batchPullId = Symbol("eval/campaign/replicate-batches");
	const batches = owner.node<readonly EvalArmDispatch[]>(
		[campaign],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (Array.isArray(raw)) ctx.down([["DATA", raw]]);
			}
		},
		{
			name: "eval/campaign/replicate-batches",
			factory: "rootEvalReplicateBatches",
			pullId: batchPullId,
			pausable: "resumeAll",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { role: "quiet-campaign-batch-boundary" },
		},
	);

	const batchReleaseControllerEvents = owner.initNode(merge<unknown>(), [campaign, batches], {
		name: "eval/campaign/replicate-batch-release-events",
	});
	const batchReleaseController = owner.node(
		[batchReleaseControllerEvents],

		(ctx) => {
			const seen = ctx.state.get<Set<string>>() ?? new Set<string>();
			let fresh = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (!(Array.isArray(raw) && raw.length > 0)) continue;
				const key = (raw as readonly EvalArmDispatch[])[0]!.replicate.toString();
				if (seen.has(key)) continue;
				if (seen.size >= replicateCount) throw new TypeError("release occurrence bound exceeded");
				seen.add(key);
				fresh = true;
			}
			ctx.state.set(seen);
			if (fresh) ctx.upNext([["PULL", { pullId: batchPullId }]]);
		},
		{
			name: "eval/campaign/replicate-batch-release-controller",
			factory: "rootEvalReplicateBatchReleaseController",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { role: "campaign-batch-release" },
		},
	);
	boundaryReleases.push(
		owner.retain(batchReleaseController, { reason: "eval campaign replicate batch release" }),
	);
	const campaignStateEvents = owner.initNode(
		merge<unknown>(),
		[campaign, start, campaignContract],
		{ name: "eval/campaign/state-events" },
	);
	const campaignStates = owner.node<EvalCampaignState>(
		[campaignStateEvents],
		(ctx) => {
			const state = ctx.state.get<{ announced: boolean; contract?: EvalCampaignContract }>() ?? {
				announced: false,
			};
			const events = depBatch(ctx, 0) ?? [];
			for (const raw of events)
				if ((raw as { kind?: string }).kind === "eval-campaign-contract")
					state.contract = raw as EvalCampaignContract;
			const announced = state.announced;
			if (
				!announced &&
				events.some((raw) => (raw as { kind?: string }).kind === "eval-campaign-start")
			) {
				const contract = state.contract;
				if (contract === undefined)
					throw new TypeError("eval campaign start lost its Graph contract authority");
				emitCampaignState(ctx, campaignRef, contract, 1, [], 0, "running", "none");
				state.announced = true;
			}
			for (const raw of events) {
				if (!Array.isArray(raw) && (raw as EvalCampaignState).kind === "eval-campaign-state") {
					ctx.down([["DATA", raw]]);
				}
			}
			ctx.state.set(state);
		},
		{
			name: "eval/campaign/state",
			factory: "rootEvalCampaignState",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				materialFree: true,
				authority: "campaign-start-and-replicate-controller",
				preSourceState: "running-with-zero-completed-arms",
			},
		},
	);

	const workItems = owner.node<WorkItemProjection<Record<string, unknown>>>(
		[batches],
		(ctx) => {
			for (const batch of (depBatch(ctx, 0) ?? []) as readonly (readonly EvalArmDispatch[])[]) {
				for (const item of batch) {
					ctx.down([["DATA", workItemFor(item)]]);
				}
			}
		},
		{
			name: "eval/work-item/objective-data",
			factory: "rootEvalWorkItemData",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { solutionIdentity: "work-item", cardinality: "one-work-item-per-arm" },
		},
	);
	type EvalMemoryBatchFrame = Readonly<{
		readonly relevantSourceWorkItem: WorkItemProjection<Record<string, unknown>>;
		readonly irrelevantSourceWorkItem: WorkItemProjection<Record<string, unknown>>;
		readonly dispatches: readonly EvalArmDispatch[];
		readonly initialRecords: readonly AgenticMemoryRecord<MemoryPayload>[];
	}>;
	type EvalMemoryBridgeFrame = Readonly<{
		readonly occurrenceId: string;
		readonly occurrenceRevision: 1;
		readonly occurrenceDigest: string;
		readonly occurrenceSourceRefs: readonly Readonly<{
			readonly kind: string;
			readonly id: string;
		}>[];
		readonly sourceWorkItem: WorkItemProjection<Record<string, unknown>>;
		readonly mappingPolicy: AgenticWorkItemMemoryMappingPolicy<MemoryPayload>;
		readonly candidates: readonly AgenticWorkItemMemoryRecordCandidate<MemoryPayload>[];
		readonly initialRecords: readonly AgenticMemoryRecord<MemoryPayload>[];
	}>;
	type EvalMemoryUseFrame = Readonly<{
		readonly occurrenceId: string;
		readonly occurrenceRevision: 1;
		readonly occurrenceDigest: string;
		readonly occurrenceSourceRefs: readonly Readonly<{
			readonly kind: string;
			readonly id: string;
		}>[];
		readonly dispatch: EvalArmDispatch;
		readonly records: readonly AgenticMemoryRecord<MemoryPayload>[];
		readonly request: AgenticMemoryRecordUseRequest;
		readonly decisions: readonly AgenticMemoryRecordUseDecision[];
	}>;
	type EvalMemoryContextFrame = Readonly<{
		readonly dispatch: EvalArmDispatch;
		readonly exposedRecordIds: readonly string[];
		readonly bindings: readonly EvalMemoryBinding[];
		readonly contextDigest: string;
	}>;
	type EvalMemoryBatchAdmissionReason = Readonly<{
		readonly relevantSourceWorkItem: WorkItemProjection<Record<string, unknown>>;
		readonly irrelevantSourceWorkItem: WorkItemProjection<Record<string, unknown>>;
	}>;
	const memoryBatchCandidates = owner.node<AdmissionHandoffCandidate<readonly EvalArmDispatch[]>>(
		[batches],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const dispatches = raw as readonly EvalArmDispatch[];
				const replicate = dispatches[0]?.replicate;
				if (replicate === undefined) throw new TypeError("memory batch candidate was empty");
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "admission-handoff-candidate" as const,
							candidateId: `memory-batch/${replicate}`,
							candidateFingerprint: empiricalStrictJsonDigest(dispatches),
							value: dispatches,
						}),
					],
				]);
			}
		},
		{
			name: "eval/memory/six-arm-batch-candidate",
			factory: "rootEvalMemoryBatchHandoffCandidate",
			meta: { cardinality: "one-candidate-per-replicate", arms: HARNESS_ARMS.length },
		},
	);
	const memoryBatchDecisionEvents = owner.initNode(
		merge<unknown>(),
		[verifiedSourceWorkItems, batches],
		{ name: "eval/memory/source-readiness-events" },
	);
	const memoryBatchDecisions = owner.node<AdmissionHandoffDecision<EvalMemoryBatchAdmissionReason>>(
		[memoryBatchDecisionEvents],
		(ctx) => {
			const state = ctx.state.get<{
				sources: Map<string, WorkItemProjection<Record<string, unknown>>>;
				pending: Map<number, readonly EvalArmDispatch[]>;
				emitted: Set<number>;
			}>() ?? {
				sources: new Map<string, WorkItemProjection<Record<string, unknown>>>(),
				pending: new Map<number, readonly EvalArmDispatch[]>(),
				emitted: new Set<number>(),
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (Array.isArray(raw)) continue;
				const source = raw as WorkItemProjection<Record<string, unknown>>;
				state.sources.set(source.workItemId, source);
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (!Array.isArray(raw)) continue;
				const dispatches = raw as readonly EvalArmDispatch[];
				const replicate = dispatches[0]?.replicate;
				if (replicate === undefined) throw new TypeError("memory admission batch was empty");
				state.pending.set(replicate, dispatches);
			}
			for (const [replicate, dispatches] of state.pending) {
				if (state.emitted.has(replicate)) continue;
				if (dispatches.length !== HARNESS_ARMS.length)
					throw new TypeError("memory batch lost its six target Work Items");
				const relevant = dispatches.find((dispatch) => dispatch.arm === "relevant-applied");
				const irrelevant = dispatches.find((dispatch) => dispatch.arm === "irrelevant-applied");
				if (relevant === undefined || irrelevant === undefined)
					throw new TypeError("memory batch lost treatment or irrelevant control");
				const relevantSourceWorkItem = state.sources.get(relevant.memorySourceWorkItemId);
				const irrelevantSourceWorkItem = state.sources.get(irrelevant.memorySourceWorkItemId);
				if (relevantSourceWorkItem === undefined || irrelevantSourceWorkItem === undefined)
					continue;
				const reason = Object.freeze({ relevantSourceWorkItem, irrelevantSourceWorkItem });
				const candidateFingerprint = empiricalStrictJsonDigest(dispatches);
				state.emitted.add(replicate);
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "admission-handoff-decision" as const,
							decisionId: `memory-batch/${replicate}/source-readiness`,
							decisionFingerprint: empiricalStrictJsonDigest({
								candidateFingerprint,
								relevantSourceWorkItemId: relevantSourceWorkItem.workItemId,
								irrelevantSourceWorkItemId: irrelevantSourceWorkItem.workItemId,
							}),
							candidateId: `memory-batch/${replicate}`,
							candidateFingerprint,
							state: "admitted" as const,
							reason,
						}),
					],
				]);
			}
			ctx.state.set(state);
		},
		{
			name: "eval/memory/six-arm-source-readiness-decision",
			factory: "rootEvalMemoryBatchSourceReadinessDecision",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				role: "source-readiness-admission-authority",
				correlation: "replicate/relevant-source/irrelevant-source",
			},
		},
	);
	const memoryBatchHandoff = admissionHandoff(owner, {
		name: "eval/memory/six-arm-source-readiness-handoff",
		candidates: memoryBatchCandidates,
		decisions: memoryBatchDecisions,
		maxPending: ROOT_EVAL_REPLICATE_COUNT,
		maxRecent: ROOT_EVAL_REPLICATE_COUNT * 2,
	});
	const memoryBatchFrames = owner.node<EvalMemoryBatchFrame>(
		[memoryBatchHandoff.accepted],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const accepted = raw as {
					readonly value: readonly EvalArmDispatch[];
					readonly reason?: EvalMemoryBatchAdmissionReason;
				};
				const dispatches = accepted.value;
				const reason = accepted.reason;
				if (reason === undefined)
					throw new TypeError("memory batch admission lacked source readiness evidence");
				const rejected = dispatches.find((dispatch) => dispatch.arm === "admission-rejected");
				if (rejected === undefined) throw new TypeError("memory batch lost rejection control");
				ctx.down([
					[
						"DATA",
						Object.freeze({
							relevantSourceWorkItem: reason.relevantSourceWorkItem,
							irrelevantSourceWorkItem: reason.irrelevantSourceWorkItem,
							dispatches,
							initialRecords: Object.freeze([rejectedAdmissionReservation(rejected)]),
						}),
					],
				]);
			}
		},
		{
			name: "eval/memory/correlated-six-arm-data",
			factory: "rootEvalCorrelatedMemoryBatch",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				lifecycleCardinality: "one-fixed-lifecycle",
				dataCardinality: "six-arms",
				correlation: "task-instance/source-work-item/target-work-item",
			},
		},
	);
	const memoryBridgeFrames = owner.node<EvalMemoryBridgeFrame>(
		[memoryBatchFrames],
		(ctx) => {
			const observed =
				ctx.state.get<Map<string, RootEvalOccurrenceLedgerEntry>>() ??
				new Map<string, RootEvalOccurrenceLedgerEntry>();
			const outputs: EvalMemoryBridgeFrame[] = [];
			for (const raw of depBatch(ctx, 0) ?? []) {
				const frame = raw as EvalMemoryBatchFrame;
				const replicate = frame.dispatches[0]?.replicate;
				if (replicate === undefined) throw new TypeError("memory bridge occurrence lost replicate");
				const irrelevant = frame.dispatches.find(
					(dispatch) => dispatch.arm === "irrelevant-applied",
				);
				if (irrelevant === undefined) throw new TypeError("memory bridge lost irrelevant DATA");
				const relevantCandidates = Object.freeze(
					frame.dispatches
						.filter((dispatch) => dispatch.arm !== "irrelevant-applied")
						.flatMap((dispatch) => memoryCandidate(dispatch)),
				);
				const irrelevantCandidates = memoryCandidate(irrelevant);
				const values = [
					["relevant", frame.relevantSourceWorkItem, relevantCandidates],
					["irrelevant", frame.irrelevantSourceWorkItem, irrelevantCandidates],
				] as const;
				for (const [role, sourceWorkItem, candidates] of values) {
					const occurrenceId = `${campaignRef}/replicate-${replicate}/memory-source/${role}`;
					const occurrenceMaterial = Object.freeze({
						occurrenceId,
						occurrenceRevision: 1 as const,
						sourceWorkItem,
						mappingPolicy: Object.freeze({
							kind: "agentic-work-item-memory-mapping-policy" as const,
							policyId: `${frame.dispatches[0]!.workItemId}/memory-mapping-policy/${role}`,
							scoreRules: [],
						}),
						candidates,
						initialRecords: frame.initialRecords,
						occurrenceSourceRefs: Object.freeze([
							Object.freeze({ kind: "eval-campaign", id: campaignRef }),
							Object.freeze({ kind: "work-item", id: sourceWorkItem.workItemId }),
						]),
					});
					const occurrenceDigest = empiricalStrictJsonDigest({
						kind: "eval-memory-bridge-occurrence",
						occurrenceId,
						occurrenceRevision: 1,
						sourceWorkItemId: sourceWorkItem.workItemId,
						mappingPolicyId: occurrenceMaterial.mappingPolicy.policyId,
						candidates: candidates.map((candidate) => ({
							candidateId: candidate.candidateId,
							recordId: candidate.candidateMaterial.record.id,
							bindingDigest: candidate.candidateMaterial.record.fragment.payload.digest,
						})),
						sourceRefs: occurrenceMaterial.occurrenceSourceRefs,
					});
					const occurrence = Object.freeze({ ...occurrenceMaterial, occurrenceDigest });
					if (
						admitRootEvalOccurrence(observed, occurrence, ROOT_EVAL_REPLICATE_COUNT * 2) ===
						"accepted"
					)
						outputs.push(occurrence);
				}
			}
			ctx.state.set(observed);
			if (outputs.length > 0) ctx.down(outputs.map((output) => ["DATA", output]));
		},
		{
			name: "eval/memory/source-record-data",
			factory: "rootEvalMemorySourceRecordData",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				lifecycleCardinality: "one",
				recordSources: ["relevant", "irrelevant"],
				occurrenceIdentity: "scope-local-id/revision/digest/source-refs",
				batching: "bounded-many-per-wave",
			},
		},
	);
	type EvalMemoryBridgeSolutionInput = AgenticWorkItemMemoryBridgeInput<
		Record<string, unknown>,
		MemoryPayload
	> &
		Readonly<{ readonly initialRecords: readonly AgenticMemoryRecord<MemoryPayload>[] }>;
	const memoryBridgeOccurrences = owner.node<SolutionOccurrence<EvalMemoryBridgeSolutionInput>>(
		[memoryBridgeFrames],
		(ctx) => {
			const outputs = (depBatch(ctx, 0) ?? []).map((raw) => {
				const frame = raw as EvalMemoryBridgeFrame;
				return Object.freeze({
					occurrenceId: frame.occurrenceId,
					occurrenceRevision: frame.occurrenceRevision,
					occurrenceDigest: frame.occurrenceDigest,
					occurrenceSourceRefs: frame.occurrenceSourceRefs,
					value: Object.freeze({
						workItem: frame.sourceWorkItem,
						policy: frame.mappingPolicy,
						candidates: frame.candidates,
						initialRecords: frame.initialRecords,
					}),
				});
			});
			if (outputs.length > 0) ctx.down(outputs.map((output) => ["DATA", output]));
		},
		{
			name: "eval/memory/bridge-occurrence-input",
			factory: "rootEvalMemoryBridgeOccurrenceInput",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const memoryBridgeSolution = agenticWorkItemMemoryBridgeBundle<
		Record<string, unknown>,
		MemoryPayload
	>(owner, {
		name: "eval/solution/agentic-work-item-memory-bridge",
		occurrences: memoryBridgeOccurrences,
		maxOccurrences: ROOT_EVAL_REPLICATE_COUNT * 2,
	});
	const memoryBridgeCorrelated = solutionOccurrenceJoin(
		owner,
		memoryBridgeOccurrences,
		memoryBridgeSolution.projection,
		{
			name: "eval/memory/bridge-result-context",
			factory: "rootEvalMemoryBridgeResultContext",
			maxOccurrences: ROOT_EVAL_REPLICATE_COUNT * 2,
			project: (input, result) => Object.freeze({ input, result }),
		},
	);
	const memoryAdmissionInputs = owner.node<
		SolutionOccurrence<AgenticMemoryRecordAdmissionInput<MemoryPayload>>
	>(
		[memoryBridgeCorrelated],
		(ctx) => {
			const outputs: SolutionOccurrence<AgenticMemoryRecordAdmissionInput<MemoryPayload>>[] = [];
			for (const raw of depBatch(ctx, 0) ?? []) {
				const occurrence = raw as typeof memoryBridgeCorrelated extends Node<infer T> ? T : never;
				const proposals = occurrence.value.result.proposals.filter(
					(proposal) =>
						!proposal.candidateMaterial.record.id.includes("/proposal-only/memory-record"),
				);
				const value = Object.freeze({
					records: occurrence.value.input.initialRecords,
					proposals: Object.freeze(proposals),
					policy: Object.freeze({
						kind: "agentic-memory-record-admission-policy" as const,
						policyId: "root-eval-memory-admission-policy",
						defaultState: "admitted" as const,
						rejectDuplicateRecordIds: true,
					}),
				});
				outputs.push(
					Object.freeze({
						...occurrence,
						occurrenceDigest: empiricalStrictJsonDigest({
							kind: "eval-memory-admission-occurrence",
							occurrenceId: occurrence.occurrenceId,
							proposalIds: proposals.map((proposal) => proposal.proposalId),
							policyId: value.policy.policyId,
						}),
						value,
					}),
				);
			}
			if (outputs.length > 0) ctx.down(outputs.map((output) => ["DATA", output]));
		},
		{
			name: "eval/memory/admission-occurrence-input",
			factory: "rootEvalMemoryAdmissionOccurrenceInput",
			meta: { proposalOnlyRemainsProposalOnly: true },
		},
	);
	const memoryAdmission = agenticMemoryRecordAdmissionBundle<MemoryPayload>(owner, {
		name: "eval/solution/agentic-memory-admission",
		occurrences: memoryAdmissionInputs,
		maxOccurrences: ROOT_EVAL_REPLICATE_COUNT * 2,
	});
	const memoryAdmissionCorrelated = solutionOccurrenceJoin(
		owner,
		memoryAdmissionInputs,
		memoryAdmission.projection,
		{
			name: "eval/memory/admission-result-context",
			factory: "rootEvalMemoryAdmissionResultContext",
			maxOccurrences: ROOT_EVAL_REPLICATE_COUNT * 2,
			project: (input, snapshot) => Object.freeze({ input, snapshot }),
		},
	);
	const memoryApplicationInputs = owner.node<
		SolutionOccurrence<AgenticMemoryRecordApplicationInput<MemoryPayload>>
	>(
		[memoryAdmissionCorrelated],
		(ctx) => {
			const outputs = (depBatch(ctx, 0) ?? []).map((raw) => {
				const occurrence = raw as typeof memoryAdmissionCorrelated extends Node<infer T>
					? T
					: never;
				const value = Object.freeze({
					records: occurrence.value.input.records,
					admissions: occurrence.value.snapshot.admissions,
					policy: Object.freeze({
						kind: "agentic-memory-record-application-policy" as const,
						policyId: "root-eval-memory-application-policy",
					}),
				});
				return Object.freeze({
					...occurrence,
					occurrenceDigest: empiricalStrictJsonDigest({
						kind: "eval-memory-application-occurrence",
						occurrenceId: occurrence.occurrenceId,
						admissionIds: value.admissions.map((admission) => admission.admissionId),
						policyId: value.policy.policyId,
					}),
					value,
				});
			});
			if (outputs.length > 0) ctx.down(outputs.map((output) => ["DATA", output]));
		},
		{
			name: "eval/memory/application-occurrence-input",
			factory: "rootEvalMemoryApplicationOccurrenceInput",
		},
	);
	const memoryApplication = agenticMemoryRecordApplicationBundle<MemoryPayload>(owner, {
		name: "eval/solution/agentic-memory-application",
		occurrences: memoryApplicationInputs,
		maxOccurrences: ROOT_EVAL_REPLICATE_COUNT * 2,
	});
	const appliedMemoryRecordState = owner.node<readonly AgenticMemoryRecord<MemoryPayload>[]>(
		[memoryApplication.records],
		(ctx) => {
			const records =
				ctx.state.get<Map<string, AgenticMemoryRecord<MemoryPayload>>>() ??
				new Map<string, AgenticMemoryRecord<MemoryPayload>>();
			let changed = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const occurrence = raw as typeof memoryApplication.records extends Node<infer T>
					? T
					: never;
				for (const record of occurrence.value) {
					const prior = records.get(record.id);
					if (prior !== undefined) {
						if (
							empiricalStrictJsonDigest(agenticMemoryRecordFrame(prior)) !==
							empiricalStrictJsonDigest(agenticMemoryRecordFrame(record))
						)
							throw new TypeError("applied memory record replay conflicted with prior DATA");
						continue;
					}
					records.set(record.id, record);
					changed = true;
				}
			}
			ctx.state.set(records);
			if (changed) ctx.down([["DATA", Object.freeze([...records.values()])]]);
		},
		{
			name: "eval/memory/applied-record-state",
			factory: "rootEvalAppliedMemoryRecordState",
			meta: { authority: "real-agentic-memory-application-output", cumulative: true },
		},
	);

	const memoryUseEvents = owner.initNode(
		merge<readonly AgenticMemoryRecord<MemoryPayload>[] | EvalMemoryBatchFrame>(),
		[appliedMemoryRecordState, memoryBatchFrames],
		{ name: "eval/memory/exposure-events" },
	);
	const memoryUseFramesCandidate = owner.node<EvalMemoryUseFrame>(
		[memoryUseEvents],
		(ctx) => {
			type MemoryUseRuntime = {
				records: Map<string, AgenticMemoryRecord<MemoryPayload>>;
				batches: Map<number, EvalMemoryBatchFrame>;
				observed: Map<string, RootEvalOccurrenceLedgerEntry>;
			};
			const runtime = ctx.state.get<MemoryUseRuntime>() ?? {
				records: new Map<string, AgenticMemoryRecord<MemoryPayload>>(),
				batches: new Map<number, EvalMemoryBatchFrame>(),
				observed: new Map<string, RootEvalOccurrenceLedgerEntry>(),
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (!Array.isArray(raw)) continue;
				const records = raw as readonly AgenticMemoryRecord<MemoryPayload>[];
				for (const record of records) {
					const prior = runtime.records.get(record.id);
					if (
						prior !== undefined &&
						empiricalStrictJsonDigest(agenticMemoryRecordFrame(prior)) !==
							empiricalStrictJsonDigest(agenticMemoryRecordFrame(record))
					)
						throw new TypeError("memory use record replay conflicted with prior DATA");
					runtime.records.set(record.id, record);
				}
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (Array.isArray(raw)) continue;
				const frame = raw as EvalMemoryBatchFrame;
				const replicate = frame.dispatches[0]?.replicate;
				if (replicate === undefined) throw new TypeError("memory use occurrence lost replicate");
				const prior = runtime.batches.get(replicate);
				if (
					prior !== undefined &&
					empiricalStrictJsonDigest(prior) !== empiricalStrictJsonDigest(frame)
				)
					throw new TypeError("memory use replicate frame replay conflicted with prior DATA");
				runtime.batches.set(replicate, frame);
			}
			const outputs: EvalMemoryUseFrame[] = [];
			for (const [, frame] of [...runtime.batches].sort(([left], [right]) => left - right)) {
				const requiredAppliedIds = frame.dispatches
					.filter((dispatch) =>
						["relevant-applied", "irrelevant-applied", "wrong-scope-applied"].includes(
							dispatch.arm,
						),
					)
					.map((dispatch) => `${dispatch.workItemId}/memory-record`);
				if (requiredAppliedIds.every((id) => runtime.records.has(id))) {
					const frameRecordIds = new Set([
						...requiredAppliedIds,
						...frame.initialRecords.map((record) => record.id),
					]);
					const records = [...runtime.records.values()]
						.filter((record) => frameRecordIds.has(record.id))
						.sort((left, right) => left.id.localeCompare(right.id));
					for (const arm of HARNESS_ARMS) {
						const dispatch = frame.dispatches.find((value) => value.arm === arm)!;
						const expectedRecordId = `${dispatch.workItemId}/memory-record`;
						const request = memoryUseRequest(dispatch);
						const occurrenceId = request.requestId;
						const decisions = records.map((memory) =>
							createAgenticMemoryRecordUseDecision(request, memory, {
								decisionId: `${dispatch.workItemId}/memory-use/${memory.id}`,
								state:
									memory.id === expectedRecordId && memory.scope?.projectId === "eval-project"
										? "allowed"
										: "denied",
							}),
						);
						const occurrenceMaterial = Object.freeze({
							occurrenceId,
							occurrenceRevision: 1 as const,
							occurrenceSourceRefs: Object.freeze([
								Object.freeze({ kind: "eval-campaign", id: campaignRef }),
								Object.freeze({ kind: "work-item", id: dispatch.workItemId }),
							]),
							dispatch,
							records: Object.freeze(records),
							request,
							decisions: Object.freeze(decisions),
						});
						const occurrenceDigest = empiricalStrictJsonDigest({
							kind: "eval-memory-use-occurrence",
							occurrenceId,
							occurrenceRevision: 1,
							dispatch: {
								workItemId: dispatch.workItemId,
								arm: dispatch.arm,
								replicate: dispatch.replicate,
							},
							records: records.map((record) => agenticMemoryRecordFrame(record)),
							request,
							decisions,
							sourceRefs: occurrenceMaterial.occurrenceSourceRefs,
						});
						const occurrence = Object.freeze({ ...occurrenceMaterial, occurrenceDigest });
						if (
							admitRootEvalOccurrence(
								runtime.observed,
								occurrence,
								ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length,
							) === "accepted"
						)
							outputs.push(occurrence);
					}
				}
			}
			if (runtime.batches.size > ROOT_EVAL_REPLICATE_COUNT)
				throw new TypeError("memory use replicate retention exceeded its fixed bound");
			ctx.state.set(runtime);
			if (outputs.length > 0) ctx.down(outputs.map((output) => ["DATA", output]));
		},
		{
			name: "eval/memory/exposure-frame/candidate",
			factory: "rootEvalMemoryExposureFrameCandidate",
			meta: {
				armOrder: HARNESS_ARMS,
				lifecycleCardinality: "one",
				occurrenceIdentity: "request-id/revision/digest/source-refs",
				batching: "bounded-many-per-wave",
			},
		},
	);

	const memoryUseFramesBoundary = rootEvalQuietDataBoundary<EvalMemoryUseFrame>(
		owner,
		memoryUseFramesCandidate,
		{
			name: "eval/memory/exposure-frame",
			factory: "rootEvalMemoryExposureFrame",
			maxOccurrences: replicateCount * HARNESS_ARMS.length,
			key: (value) => `${value.occurrenceId}:${value.occurrenceRevision}`,
			fingerprint: (value) => value.occurrenceDigest,
			meta: { materialFree: true, completeDomainOccurrence: true },
		},
	);
	const memoryUseFrames = memoryUseFramesBoundary.output;
	boundaryReleases.push(memoryUseFramesBoundary.release);
	type EvalMemoryUseSolutionInput = AgenticMemoryRecordUseInput<MemoryPayload> &
		Readonly<{ readonly dispatch: EvalArmDispatch }>;
	const memoryUseOccurrenceInputs = owner.node<SolutionOccurrence<EvalMemoryUseSolutionInput>>(
		[memoryUseFrames],
		(ctx) => {
			const outputs = (depBatch(ctx, 0) ?? []).map((raw) => {
				const frame = raw as EvalMemoryUseFrame;
				return Object.freeze({
					occurrenceId: frame.occurrenceId,
					occurrenceRevision: frame.occurrenceRevision,
					occurrenceDigest: frame.occurrenceDigest,
					occurrenceSourceRefs: frame.occurrenceSourceRefs,
					value: Object.freeze({
						dispatch: frame.dispatch,
						records: frame.records,
						request: frame.request,
						decisions: frame.decisions,
					}),
				});
			});
			if (outputs.length > 0) ctx.down(outputs.map((output) => ["DATA", output]));
		},
		{
			name: "eval/memory/exposure-occurrence-input",
			factory: "rootEvalMemoryExposureOccurrenceInput",
		},
	);
	const memoryExposure = agenticMemoryRecordUseGateBundle<MemoryPayload>(owner, {
		name: "eval/solution/agentic-memory",
		occurrences: memoryUseOccurrenceInputs,
		maxOccurrences: ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length,
	});
	const memoryUseDispatches = owner.node<SolutionOccurrence<EvalArmDispatch>>(
		[memoryUseOccurrenceInputs],
		(ctx) => {
			const outputs = (depBatch(ctx, 0) ?? []).map((raw) => {
				const input = raw as SolutionOccurrence<EvalMemoryUseSolutionInput>;
				return ["DATA", Object.freeze({ ...input, value: input.value.dispatch })] as const;
			});
			if (outputs.length > 0) ctx.down(outputs);
		},
		{ name: "eval/memory/use-dispatch", factory: "rootEvalMemoryUseDispatch" },
	);
	const memoryContexts = owner.node<EvalMemoryContextFrame>(
		[memoryExposure.allowedRecords, memoryUseDispatches],
		(ctx) => {
			// Join by exact occurrence, never by a latest request or by delivery order.
			type Allowed = SolutionOccurrence<readonly AgenticMemoryRecord<MemoryPayload>[]>;
			const pending = ctx.state.get<{
				inputs: Map<string, SolutionOccurrence<EvalArmDispatch>>;
				allowed: Map<string, Allowed>;
			}>() ?? {
				inputs: new Map<string, SolutionOccurrence<EvalArmDispatch>>(),
				allowed: new Map<string, Allowed>(),
			};
			for (const raw of depBatch(ctx, 1) ?? []) {
				const input = raw as SolutionOccurrence<EvalArmDispatch>;
				pending.inputs.set(JSON.stringify([input.occurrenceId, input.occurrenceRevision]), input);
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				const allowed = raw as Allowed;
				pending.allowed.set(
					JSON.stringify([allowed.occurrenceId, allowed.occurrenceRevision]),
					allowed,
				);
			}
			if (
				pending.inputs.size > ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length ||
				pending.allowed.size > ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length
			)
				throw new Error("memory use correlation exceeded its bound");
			const outputs: EvalMemoryContextFrame[] = [];
			for (const [id, occurrence] of pending.allowed) {
				const input = pending.inputs.get(id);
				if (input === undefined) continue;
				if (
					input.occurrenceRevision !== occurrence.occurrenceRevision ||
					input.occurrenceDigest !== occurrence.occurrenceDigest ||
					empiricalStrictJsonDigest(input.occurrenceSourceRefs) !==
						empiricalStrictJsonDigest(occurrence.occurrenceSourceRefs)
				)
					throw new Error("memory use authorization occurrence mismatch");
				pending.inputs.delete(id);
				pending.allowed.delete(id);
				const dispatch = input.value;
				const exposed =
					dispatch.arm === "relevant-applied" || dispatch.arm === "irrelevant-applied";
				const records = exposed
					? occurrence.value.filter((value) => value.id === `${dispatch.workItemId}/memory-record`)
					: [];
				if (exposed && records.length !== 1) continue;
				const ids = Object.freeze(records.map((value) => value.fragment.id as string));
				const bindings = Object.freeze(
					records.flatMap((value) =>
						value.fragment.payload !== undefined &&
						typeof value.fragment.payload.bindingRef === "string" &&
						isDigest(value.fragment.payload.digest)
							? [Object.freeze({ ...value.fragment.payload })]
							: [],
					),
				);
				if (bindings.length !== ids.length) continue;
				outputs.push(
					Object.freeze({
						dispatch,
						exposedRecordIds: ids,
						bindings,
						contextDigest: empiricalStrictJsonDigest({
							kind: "eval-memory-context",
							taskInstanceRef: dispatch.taskInstanceRef,
							sourceWorkItemId: dispatch.memorySourceWorkItemId,
							sourceEvidenceDigest: dispatch.memorySourceEvidenceDigest,
							sourceInsightDigest: dispatch.memorySourceInsightDigest,
							arm: dispatch.arm,
							exposedRecordIds: ids,
							bindings,
						}),
					}),
				);
			}
			ctx.state.set(pending);
			if (outputs.length > 0) ctx.down(outputs.map((output) => ["DATA", output]));
		},
		{
			name: "eval/memory/context-for-work-item",
			factory: "rootEvalMemoryContextForWorkItem",
			meta: { lifecycleCardinality: "one", dataCardinality: "six-arms" },
		},
	);
	const effectPlans = owner.node<WorkItemEffectPlanProposed<Record<string, unknown>>>(
		[memoryContexts, profileAdmission],
		(ctx) => {
			const admittedProfile = depLatest(ctx, 1) as RootEvalProfileAdmission | undefined;
			if (admittedProfile === undefined) return;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const item = raw as {
					readonly dispatch: EvalArmDispatch;
					readonly exposedRecordIds: readonly string[];
					readonly bindings: readonly EvalMemoryBinding[];
					readonly contextDigest: string;
				};
				const plan = planFor(item.dispatch, item, effectTimeoutMs);
				ctx.down([
					[
						"DATA",
						Object.freeze({
							...plan,
							metadata: {
								profileResolutionDigest: admittedProfile.resolution.resolutionDigest,
								providerRef: admittedProfile.resolution.providerRef,
							},
						}),
					],
				]);
			}
		},
		{
			name: "eval/work-item/attempt-resource-plan",
			factory: "rootEvalWorkItemPlan",
			meta: { timeoutAuthority: "work-item-effect-plan", effectTimeoutMs },
		},
	);

	const execution = workItemExecutionRecipe(owner, {
		name: "eval/solution/work-item-execution",
		workItems,
		effectPlanProposals: effectPlans,
		effectRunResults: resultProjection,
		now: () => 0,
	});
	const admittedPlanEvents = owner.initNode(
		merge<unknown>(),
		[sourceExecution.plan.admitted, execution.plan.admitted],
		{ name: "eval/work-item/admitted-plan-events" },
	);
	const admittedPlanAuthority = owner.node<EvalWorkItemPlanAuthority>(
		[admittedPlanEvents],
		(ctx) => {
			const plans =
				ctx.state.get<Map<string, EvalWorkItemPlanSnapshot>>() ??
				new Map<string, EvalWorkItemPlanSnapshot>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const admitted = raw as {
					readonly workItemId: string;
					readonly plan: EvalWorkItemPlanSnapshot;
				};
				plans.set(admitted.workItemId, admitted.plan);
			}
			ctx.state.set(plans);
			ctx.down([["DATA", Object.freeze({ plans: Object.freeze(Object.fromEntries(plans)) })]]);
		},
		{
			name: "eval/work-item/admitted-plan-authority",
			factory: "rootEvalWorkItemAdmittedPlanAuthority",
			meta: { authority: "work-item-solution-admitted-plan-snapshot" },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const firstProposalEvents = owner.initNode(
		merge<unknown>(),
		[sourceExecution.requests, execution.requests, admittedPlanAuthority, profileAdmission],
		{ name: "eval/provider/first-proposal-events" },
	);
	const firstAttemptProposalCandidates = owner.node<EvalEffectProposal>(
		[firstProposalEvents],
		(ctx) => {
			type FirstProposalState = {
				pending: Map<string, AgentRequestIssued<Record<string, unknown>>>;
				authority?: EvalWorkItemPlanAuthority;
				profile?: RootEvalProfileAdmission;
				seen: Map<string, string>;
			};
			const state: FirstProposalState = ctx.state.get<FirstProposalState>() ?? {
				pending: new Map(),
				seen: new Map(),
			};
			const pending = state.pending;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as { kind?: string; plans?: unknown };
				if (event.kind === "root-eval-profile-admission")
					state.profile = raw as RootEvalProfileAdmission;
				else if (event.plans !== undefined) state.authority = raw as EvalWorkItemPlanAuthority;
				else if (event.kind === "issued") {
					const request = raw as AgentRequestIssued<Record<string, unknown>>;
					const digest = empiricalStrictJsonDigest(withoutUndefined(request));
					const previous = state.seen.get(request.requestId);
					if (previous !== undefined) {
						if (previous !== digest) throw new TypeError("issued request identity drifted");
						continue;
					}
					if (state.seen.size >= replicateCount * (HARNESS_ARMS.length + 1))
						throw new TypeError("issued request bound exceeded");
					state.seen.set(request.requestId, digest);
					pending.set(request.requestId, request);
				} else throw new TypeError("unknown first provider proposal event");
			}
			ctx.state.set(state);
			const admittedProfile = state.profile,
				authority = state.authority;
			if (admittedProfile === undefined || authority === undefined) return;
			for (const [requestId, request] of [...pending]) {
				const workItemRef = request.sourceRefs?.find((ref) => ref.kind === "work-item")?.id;
				if (workItemRef === undefined) continue;
				const coordinate = executionCoordinateFromWorkItemId(workItemRef);
				if (coordinate === null) continue;
				const plan = authority.plans[workItemRef];
				if (plan === undefined) continue;
				const member = plan.members[0];
				if (member === undefined)
					throw new TypeError("provider proposal requires one Work Item effect member");
				const timeoutMs = member.limits?.timeoutMs;
				if (!Number.isSafeInteger(timeoutMs) || timeoutMs === undefined)
					throw new TypeError("provider proposal requires its Work Item timeout authority");
				const workItemPlanDigest = evalWorkItemPlanAuthorityDigest(plan);
				const proposal = Object.freeze({
					kind: "eval-effect-proposal" as const,
					proposalId: `${request.effectRunId}/dispatchOrdinal-1/proposal`,
					effectRunId: request.effectRunId,
					operationId: request.operationId,
					workItemId: workItemRef,
					replicate: replicateFromWorkItemId(workItemRef),
					arm: coordinate.arm,
					workItemRole: coordinate.workItemRole,
					providerLogicalAttempt: 1 as const,
					dispatchOrdinal: 1 as const,
					capacityRetryOrdinal: 0,
					availabilityRetryOrdinal: 0,
					reservationMicrousd,
					timeoutMs,
					maxOutputTokens: admittedProfile.profile.mutationMaxOutputTokens,
					reasoningEffort: admittedProfile.profile.reasoningEffort,
					workItemPlanId: plan.planId,
					workItemPlanDigest,
					workItemPlanAuthority: plan,
					profileResolutionDigest: admittedProfile.resolution.resolutionDigest,
					providerRef: admittedProfile.binding.providerRef,
					providerModelRef: admittedProfile.binding.providerModelRef,
					endpointProtocol: admittedProfile.binding.endpointProtocol,
					proposalEncoding: admittedProfile.binding.proposalEncoding,
					responseContractRevision: admittedProfile.binding.responseContractRevision,
					request,
				});
				validateEvalEffectProposalAgainstWorkItemPlan(proposal, plan);
				ctx.down([["DATA", proposal]]);
				pending.delete(requestId);
			}
		},
		{
			name: "eval/provider/proposal-candidate",
			factory: "rootEvalProviderProposalCandidate",
			meta: { timeoutAuthority: "reads-work-item-plan-data", role: "admitted-plan-candidate" },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const firstAttemptProposalPullId = Symbol("eval/provider/proposal");
	const firstAttemptProposals = owner.node<EvalEffectProposal>(
		[firstAttemptProposalCandidates],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", raw]]);
		},
		{
			name: "eval/provider/proposal",
			factory: "rootEvalProviderProposal",
			pullId: firstAttemptProposalPullId,
			pausable: "resumeAll",
			meta: { role: "quiet-admitted-plan-proposal-boundary" },
		},
	);

	const firstAttemptProposalReleaseControllerEvents = owner.initNode(
		merge<unknown>(),
		[firstAttemptProposalCandidates, firstAttemptProposals],
		{ name: "eval/provider/proposal-release-events" },
	);
	const firstAttemptProposalReleaseController = owner.node(
		[firstAttemptProposalReleaseControllerEvents],

		(ctx) => {
			const seen = ctx.state.get<Set<string>>() ?? new Set<string>();
			let fresh = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const key = (raw as EvalEffectProposal).proposalId;
				if (seen.has(key)) continue;
				if (seen.size >= rootEvalMaximumProviderAttempts(replicateCount))
					throw new TypeError("release occurrence bound exceeded");
				seen.add(key);
				fresh = true;
			}
			ctx.state.set(seen);
			if (fresh) ctx.upNext([["PULL", { pullId: firstAttemptProposalPullId }]]);
		},
		{
			name: "eval/provider/proposal-release-controller",
			factory: "rootEvalProviderProposalReleaseController",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { role: "admitted-plan-proposal-release" },
		},
	);
	boundaryReleases.push(
		owner.retain(firstAttemptProposalReleaseController, {
			reason: "eval admitted Work Item plan proposal release",
		}),
	);
	type EvalRetryProposalFact = Readonly<{
		readonly kind: "eval-retry-proposal-fact";
		readonly providerOutcome: EvalProviderOutcome;
		readonly proposal: EvalEffectProposal;
	}>;
	const retryProposalFacts = owner.node<EvalRetryProposalFact>(
		[retryDelayOutcomes],
		(ctx) => {
			const emitted = ctx.state.get<Map<string, string>>() ?? new Map<string, string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const delay = validateRetryDelayOutcome(raw as EvalRetryDelayOutcome);
				if (delay.status !== "completed") throw new Error("root eval retry delay failed closed");
				const outcome = validateProviderOutcome(delay.admission.providerOutcome);
				if (outcome.status !== "retryable" || outcome.recoveryClass === null) continue;
				const request = outcome.admission.request;
				const dispatchOrdinal = outcome.dispatchOrdinal + 1;
				const capacityRetryOrdinal =
					outcome.capacityRetryOrdinal + (outcome.recoveryClass === "capacity" ? 1 : 0);
				const availabilityRetryOrdinal =
					outcome.availabilityRetryOrdinal + (outcome.recoveryClass === "availability" ? 1 : 0);
				const proposal = Object.freeze({
					kind: "eval-effect-proposal" as const,
					proposalId: `${outcome.effectRunId}/dispatch-${dispatchOrdinal}/proposal`,
					effectRunId: outcome.effectRunId,
					operationId: outcome.admission.operationId,
					workItemId: outcome.workItemId,
					replicate: outcome.replicate,
					arm: outcome.arm,
					workItemRole: outcome.workItemRole,
					providerLogicalAttempt: outcome.providerLogicalAttempt,
					dispatchOrdinal,
					capacityRetryOrdinal,
					availabilityRetryOrdinal,
					reservationMicrousd,
					timeoutMs: outcome.admission.timeoutMs,
					maxOutputTokens: outcome.admission.maxOutputTokens,
					reasoningEffort: outcome.admission.reasoningEffort,
					workItemPlanId: outcome.admission.workItemPlanId,
					workItemPlanDigest: outcome.admission.workItemPlanDigest,
					workItemPlanAuthority: outcome.admission.workItemPlanAuthority,
					profileResolutionDigest: outcome.admission.profileResolutionDigest,
					providerRef: outcome.admission.providerRef,
					providerModelRef: outcome.admission.providerModelRef,
					endpointProtocol: outcome.admission.endpointProtocol,
					proposalEncoding: outcome.admission.proposalEncoding,
					responseContractRevision: outcome.admission.responseContractRevision,
					request,
				});
				const fact = Object.freeze({
					kind: "eval-retry-proposal-fact" as const,
					providerOutcome: outcome,
					proposal,
				});
				const prior = emitted.get(proposal.proposalId);
				const digest = empiricalStrictJsonDigest(withoutUndefined(fact));
				if (prior !== undefined && prior !== digest)
					throw new TypeError("retry proposal fact received contradictory replay");
				if (prior !== undefined) continue;
				emitted.set(proposal.proposalId, digest);
				ctx.down([["DATA", fact]]);
			}
			ctx.state.set(emitted);
		},
		{
			name: "eval/retry/proposal-fact",
			factory: "rootEvalRetryProposalFact",
			meta: { readinessAuthority: "one-correlated-delay-outcome-per-retry" },
		},
	);
	const retryProposals = owner.node<EvalEffectProposal>(
		[retryProposalFacts],
		(ctx) => {
			const emitted = ctx.state.get<Set<string>>() ?? new Set<string>();
			const proposals = (depBatch(ctx, 0) ?? []).flatMap((raw) => {
				const fact = raw as EvalRetryProposalFact;
				if (emitted.has(fact.proposal.proposalId)) return [];
				emitted.add(fact.proposal.proposalId);
				return [fact.proposal];
			});
			if (proposals.length > 0) ctx.down(proposals.map((proposal) => ["DATA", proposal] as const));
			ctx.state.set(emitted);
		},
		{ name: "eval/retry/proposal", factory: "rootEvalRetryProposal" },
	);
	const replicateProposalBatches = owner.node<readonly EvalEffectProposal[]>(
		[firstAttemptProposals],
		(ctx) => {
			const byReplicate =
				ctx.state.get<Map<number, Map<HarnessArm, EvalEffectProposal>>>() ??
				new Map<number, Map<HarnessArm, EvalEffectProposal>>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const proposal = raw as EvalEffectProposal;
				if (proposal.workItemRole === "source") {
					ctx.down([["DATA", Object.freeze([proposal])]]);
					continue;
				}
				const batch =
					byReplicate.get(proposal.replicate) ?? new Map<HarnessArm, EvalEffectProposal>();
				batch.set(proposal.arm as HarnessArm, proposal);
				byReplicate.set(proposal.replicate, batch);
				if (batch.size === HARNESS_ARMS.length) {
					ctx.down([["DATA", Object.freeze(HARNESS_ARMS.map((arm) => batch.get(arm)!))]]);
				}
			}
			ctx.state.set(byReplicate);
		},
		{
			name: "eval/provider/replicate-proposal-batches",
			factory: "rootEvalReplicateProposalBatches",
			meta: { canonicalArmOrder: HARNESS_ARMS, admissionBarrier: "six-work-items" },
		},
	);

	const proposalsEvents = owner.initNode(
		merge<unknown>(),
		[replicateProposalBatches, retryProposals],
		{ name: "eval/provider/proposal-events" },
	);
	const proposals = owner.node<EvalEffectProposal>(
		[proposalsEvents],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const values = Array.isArray(raw) ? raw : [raw];
				if (values.length > 0) ctx.down(values.map((value) => ["DATA", value]));
			}
		},
		{
			name: "eval/provider/proposals",
			factory: "rootEvalProviderProposals",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);

	type EvalPacingClockFact = Readonly<{
		kind: "eval-provider-pacing-clock";
		phase: "idle" | "scheduled" | "ready" | "replayed" | "stopped";
		readiness: EvalProviderStartSpacingReadiness | null;
	}>;
	const pacingClock = owner.node<EvalPacingClockFact>(
		[providerStartSpacingReadiness],
		(ctx) => {
			const state = ctx.state.get<{
				timer: ReturnType<typeof setTimeout> | undefined;
				cancelled: boolean;
				sequence: number;
				seen: Map<string, string>;
			}>() ?? { timer: undefined, cancelled: false, sequence: 0, seen: new Map<string, string>() };
			ctx.state.set(state);
			const emit = (
				phase: EvalPacingClockFact["phase"],
				readiness: EvalProviderStartSpacingReadiness | null,
			) =>
				ctx.down([
					[
						"DATA",
						Object.freeze({ kind: "eval-provider-pacing-clock" as const, phase, readiness }),
					],
				]);
			const cancel = () => {
				state.cancelled = true;
				state.sequence += 1;
				if (state.timer !== undefined) clearTimeout(state.timer);
				state.timer = undefined;
			};
			ctx.onDeactivation(cancel);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as EvalProviderStartSpacingReadiness;
				if (state.cancelled) {
					emit("stopped", null);
					continue;
				}
				const digest = empiricalStrictJsonDigest(event);
				const prior = state.seen.get(event.admissionId);
				if (prior !== undefined) {
					if (prior !== digest)
						throw new TypeError("pacing clock received conflicting admission replay");
					emit("replayed", event);
					continue;
				}
				if (state.seen.size >= rootEvalMaximumProviderAttempts(replicateCount))
					throw new TypeError("pacing clock exceeded its fixed admission bound");
				if (state.timer !== undefined)
					throw new TypeError("pacing clock cannot replace an outstanding schedule");
				state.seen.set(event.admissionId, digest);
				const sequence = ++state.sequence;
				emit("scheduled", event);
				if (event.remainingPacingDelayMs === 0) {
					emit("ready", event);
					continue;
				}
				let firedSynchronously = false;
				const timer = providerPacingSetTimeout(() => {
					firedSynchronously = true;
					if (state.cancelled || state.sequence !== sequence) return;
					state.timer = undefined;
					// External time is evidence only. Proposal selection remains in the sync reducer.
					emit("ready", event);
				}, event.remainingPacingDelayMs);
				if (!firedSynchronously && !state.cancelled) {
					state.timer = timer;
					(timer as { unref?: () => void }).unref?.();
				}
			}
		},
		{
			name: "eval/provider/pacing-clock",
			factory: "rootEvalProviderPacingClock",
			pool: "async",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				materialFree: true,
				authority: "external-clock-evidence-only",
				cancellation: "progress-stalled-or-deactivation",
			},
		},
	);
	const pacingEvents = owner.initNode(
		merge<EvalEffectProposal | EvalPacingClockFact | EvalRetryDelayOutcome>(),
		[proposals, pacingClock, retryDelayOutcomes],
		{ name: "eval/provider/pacing-events" },
	);
	type EvalProviderPacingState = {
		activeProposalKey: string | null;
		waitingClockKey: string | null;
		waitingClockRevision: number;
		pacingReady: boolean;
		stopped: boolean;
		pending: Map<string, EvalEffectProposal>;
		seen: Map<string, string>;
		expectedRecoveryEffectRunId: string | null;
	};
	type EvalPacedProposalRelease = Readonly<{
		kind: "eval-paced-proposal-release";
		proposal: EvalEffectProposal;
	}>;
	const pacedProviderProposals = owner.node<EvalPacedProposalRelease>(
		[pacingEvents],
		(ctx) => {
			const state = ctx.state.get<EvalProviderPacingState>() ?? {
				activeProposalKey: null,
				waitingClockKey: null,
				waitingClockRevision: 0,
				pacingReady: true,
				stopped: false,
				pending: new Map<string, EvalEffectProposal>(),
				seen: new Map<string, string>(),
				expectedRecoveryEffectRunId: null,
			};
			ctx.state.set(state);
			const keyOf = (proposal: { effectRunId: string; dispatchOrdinal: number }) =>
				`${proposal.effectRunId}:${proposal.dispatchOrdinal}`;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as EvalEffectProposal | EvalPacingClockFact | EvalRetryDelayOutcome;
				if (event.kind === "eval-effect-proposal") {
					const key = keyOf(event);
					const digest = empiricalStrictJsonDigest(withoutUndefined(event));
					const prior = state.seen.get(key);
					if (prior !== undefined && prior !== digest)
						throw new TypeError("provider pacing received contradictory proposal replay");
					if (prior === undefined) {
						if (state.seen.size >= rootEvalMaximumProviderAttempts(replicateCount))
							throw new TypeError("provider pacing exceeded its fixed proposal bound");
						state.seen.set(key, digest);
						if (!state.stopped) state.pending.set(key, event);
					}
				} else if (event.kind === "eval-retry-delay-outcome") {
					if (validateRetryDelayOutcome(event).status !== "completed")
						throw new TypeError("provider pacing readiness failed");
				} else if (event.phase === "stopped") {
					state.stopped = true;
					state.pending.clear();
				} else if (event.phase === "scheduled") {
					const readiness = event.readiness!;
					const key = keyOf(readiness);
					if (state.activeProposalKey !== key)
						throw new TypeError("provider pacing outcome did not settle its active proposal");
					state.activeProposalKey = null;
					state.waitingClockKey = key;
					if (readiness.pacingRevision <= state.waitingClockRevision)
						throw new TypeError("pacing schedule revision did not advance");
					state.waitingClockRevision = readiness.pacingRevision;
					state.pacingReady = false;
					if (readiness.status === "retryable")
						state.expectedRecoveryEffectRunId = readiness.effectRunId;
				} else if (event.phase === "ready") {
					if (
						state.waitingClockKey !== keyOf(event.readiness!) ||
						state.waitingClockRevision !== event.readiness!.pacingRevision
					)
						throw new TypeError("provider pacing clock did not match its scheduled occurrence");
					state.waitingClockKey = null;
					state.pacingReady = true;
				}
			}
			if (state.stopped || !state.pacingReady || state.activeProposalKey !== null) return;
			let candidates = [...state.pending.values()];
			if (state.expectedRecoveryEffectRunId !== null) {
				candidates = candidates.filter(
					(proposal) => proposal.effectRunId === state.expectedRecoveryEffectRunId,
				);
				if (candidates.length === 0) return;
			}
			candidates.sort((left, right) => {
				if (left.workItemRole !== right.workItemRole)
					return left.workItemRole === "source" ? -1 : 1;
				if (left.replicate !== right.replicate) return left.replicate - right.replicate;
				const armOrder =
					HARNESS_ARMS.indexOf(left.arm as HarnessArm) -
					HARNESS_ARMS.indexOf(right.arm as HarnessArm);
				if (armOrder !== 0) return armOrder;
				return left.dispatchOrdinal - right.dispatchOrdinal;
			});
			const proposal = candidates[0];
			if (proposal === undefined) return;
			const key = keyOf(proposal);
			state.pending.delete(key);
			state.activeProposalKey = key;
			state.expectedRecoveryEffectRunId = null;
			state.pacingReady = false;

			ctx.down([
				["DATA", Object.freeze({ kind: "eval-paced-proposal-release" as const, proposal })],
			]);
		},
		{
			name: "eval/provider/paced-proposal-release",
			factory: "rootEvalProviderPacedProposalRelease",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				materialFree: true,
				domainAuthority: "root-graph",
				maxConcurrentEffects: 1,
				providerStartIntervalMs: ROOT_EVAL_PROVIDER_START_INTERVAL_MS,
				startEvidence: "provider-outcome.dispatchElapsedMs",
				readinessAuthority: "graph-computes-remaining-start-spacing",
				callerAuthority: "none",
			},
		},
	);

	const progressAdmissionEvents = owner.initNode(
		merge<unknown>(),
		[
			scheduleFeasibility,
			start,
			campaignStates,
			providerCostSettlements,
			retryDelayOutcomes,
			targetToolOutcomes,
			sourceToolOutcomes,
			cleanup,
			billingObservationOutcomes,
		],
		{ name: "eval/time/progress-admission-events" },
	);
	type EvalProgressAdmissionLeaseRuntimeState = {
		revision: number;
		seen: Set<string>;
		timer: ReturnType<typeof setTimeout> | undefined;
		sequence: number;
		current?: EvalProgressLeaseState;
		terminal: boolean;
		deactivated: boolean;
	};
	const progressAdmissionLease = owner.node<EvalProgressLeaseState>(
		[progressAdmissionEvents],
		(ctx) => {
			const state = ctx.state.get<EvalProgressAdmissionLeaseRuntimeState>() ?? {
				revision: 0,
				seen: new Set<string>(),
				timer: undefined,
				sequence: 0,
				terminal: false,
				deactivated: false,
			};
			ctx.state.set(state);
			const clearCurrentTimer = () => {
				state.sequence += 1;
				if (state.timer !== undefined) clearTimeout(state.timer);
				state.timer = undefined;
			};
			ctx.onDeactivation(() => {
				state.deactivated = true;
				clearCurrentTimer();
			});
			const emit = (value: EvalProgressLeaseState) => {
				assertProgressLeaseRuntimeShape(value, "admission progress lease");
				ctx.down([["DATA", value]]);
			};
			const expectationFor = (
				raw: unknown,
			): Readonly<{
				nextExpectedOccurrence: string;
				leaseMs: number;
				deadlineOffsetMs: number;
			}> => {
				const event = raw as { readonly kind?: string };
				const providerLease = Math.max(effectTimeoutMs, sourceEffectTimeoutMs);
				if (event.kind === "eval-schedule-feasibility")
					return {
						nextExpectedOccurrence: "campaign-start",
						leaseMs: providerLease,
						deadlineOffsetMs: providerLease,
					};
				if (event.kind === "eval-campaign-start")
					return {
						nextExpectedOccurrence: "source-provider-admission",
						leaseMs: ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS + providerLease,
						deadlineOffsetMs: ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS + providerLease,
					};
				if (event.kind === "eval-campaign-state")
					return {
						nextExpectedOccurrence: "next-provider-admission-or-campaign-terminal",
						leaseMs: ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS + providerLease,
						deadlineOffsetMs: ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS + providerLease,
					};
				if (event.kind === "eval-provider-outcome") {
					const outcome = raw as EvalProviderOutcome;
					if (outcome.status === "retryable") {
						const readinessMs = Math.max(outcome.retryAfterMs, outcome.responseRetryAfterMs ?? 0);
						const deadlineOffsetMs = readinessMs + providerLease;
						return {
							nextExpectedOccurrence: `retry-outcome:${empiricalStrictJsonDigest(
								outcome.admissionId,
							)}`,
							leaseMs: deadlineOffsetMs,
							deadlineOffsetMs,
						};
					}
					return {
						nextExpectedOccurrence: `tool-or-terminal-result:${empiricalStrictJsonDigest(
							outcome.workItemId,
						)}`,
						leaseMs: ROOT_EVAL_TOOL_SETTLEMENT_BOUND_MS,
						deadlineOffsetMs: ROOT_EVAL_TOOL_SETTLEMENT_BOUND_MS,
					};
				}
				if (event.kind === "eval-retry-delay-outcome")
					return {
						nextExpectedOccurrence: `provider-outcome:${empiricalStrictJsonDigest(
							(raw as EvalRetryDelayOutcome).executionId,
						)}`,
						leaseMs: ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS + providerLease,
						deadlineOffsetMs: ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS + providerLease,
					};
				if (event.kind === "eval-effect-outcome")
					return {
						nextExpectedOccurrence: "cleanup",
						leaseMs: ROOT_EVAL_TOOL_SETTLEMENT_BOUND_MS,
						deadlineOffsetMs: ROOT_EVAL_TOOL_SETTLEMENT_BOUND_MS,
					};
				if (event.kind === "eval-cleanup-complete")
					return {
						nextExpectedOccurrence: "next-work-item-or-billing",
						leaseMs: ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS + providerLease,
						deadlineOffsetMs: ROOT_EVAL_MAX_INFRASTRUCTURE_RETRY_DELAY_MS + providerLease,
					};
				if (event.kind === "eval-billing-observation-outcome")
					return {
						nextExpectedOccurrence: "billing-reconciliation-or-finding",
						leaseMs: ROOT_EVAL_BILLING_SETTLEMENT_BOUND_MS,
						deadlineOffsetMs: ROOT_EVAL_BILLING_SETTLEMENT_BOUND_MS,
					};
				throw new TypeError("progress lease received an unknown occurrence kind");
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (state.deactivated) continue;
				if (state.terminal) {
					if (state.current === undefined)
						throw new TypeError("terminal progress lease lost its Graph state");
					// The async timer boundary must settle every later causal wave. Re-emit
					// the same terminal occurrence as an exact replay; a manual RESOLVED
					// would turn business liveness into protocol-authoring user code.
					emit(state.current);
					continue;
				}
				const occurrenceDigest = empiricalStrictJsonDigest(withoutUndefined(raw));
				if (state.seen.has(occurrenceDigest)) {
					if (state.current === undefined)
						throw new TypeError("progress occurrence replay preceded Graph progress state");
					emit(state.current);
					continue;
				}
				if (state.seen.size >= rootEvalMaximumObservationOccurrences(replicateCount))
					throw new TypeError("progress occurrence retention exceeded its finite bound");
				state.seen.add(occurrenceDigest);
				clearCurrentTimer();
				state.revision += 1;
				const expectation = expectationFor(raw);
				const value = Object.freeze({
					kind: "eval-progress-lease-state" as const,
					campaignRef,
					revision: state.revision,
					occurrenceDigest,
					...expectation,
					maximumFinitePathMs: scheduleFeasibilityValue.maximumFinitePathMs,
					state: "active" as const,
					stoppingReason: "none" as const,
				});
				state.current = value;
				emit(value);
				const scheduledRevision = state.revision;
				const scheduledSequence = state.sequence;
				let firedSynchronously = false;
				const timer = progressLeaseSetTimeout(() => {
					firedSynchronously = true;
					if (
						state.deactivated ||
						state.terminal ||
						state.sequence !== scheduledSequence ||
						state.revision !== scheduledRevision
					)
						return;
					state.timer = undefined;
					state.terminal = true;
					state.revision += 1;
					const stalled = Object.freeze({
						kind: "eval-progress-lease-state" as const,
						campaignRef,
						revision: state.revision,
						occurrenceDigest: empiricalStrictJsonDigest({
							kind: "eval-progress-stalled",
							scheduledRevision,
							nextExpectedOccurrence: expectation.nextExpectedOccurrence,
						}),
						nextExpectedOccurrence: expectation.nextExpectedOccurrence,
						leaseMs: 0,
						deadlineOffsetMs: 0,
						maximumFinitePathMs: scheduleFeasibilityValue.maximumFinitePathMs,
						state: "stalled" as const,
						stoppingReason: "progress-stalled" as const,
					});
					state.current = stalled;
					emit(stalled);
				}, expectation.deadlineOffsetMs);
				if (!firedSynchronously && !state.deactivated && !state.terminal) {
					state.timer = timer;
					(timer as { unref?: () => void }).unref?.();
				}
			}
			ctx.state.set(state);
		},
		{
			name: "eval/time/progress-admission-lease",
			factory: "rootEvalOccurrenceAwareAdmissionProgressLease",
			pool: "async",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				materialFree: true,
				authority: "graph-occurrence-revision-and-finite-boundary-lease",
				admissionAuthority: true,
				legalCooldownExtendsDeadline: true,
				staleRevisionMayStopOrRelease: false,
				callerStoppingAuthority: "none",
				decisionRef: "graphrefly-ts:D158",
			},
		},
	);
	const retryAdmissionPullId = Symbol("eval/retry-admission");
	const retryDelayAdmissions = owner.node<EvalRetryDelayEffect>(
		[retryableProviderResultAdmissions, progressAdmissionLease],
		(ctx) => {
			const state = ctx.state.get<{
				admitted: Set<string>;
				progress?: EvalProgressLeaseState;
			}>() ?? { admitted: new Set<string>() };
			for (const raw of depBatch(ctx, 1) ?? []) {
				const progress = raw as EvalProgressLeaseState;
				if (state.progress !== undefined && progress.revision < state.progress.revision)
					throw new TypeError("retry admission received a stale progress revision");
				state.progress = progress;
			}
			if (state.progress === undefined)
				throw new TypeError("retry admission lacked Graph progress authority");
			const admissions: EvalRetryDelayEffect[] = [];
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (outcome.status !== "retryable" || outcome.recoveryClass === null) continue;
				const executionId = `${outcome.admissionId}/retry-delay`;
				if (state.admitted.has(executionId) || state.progress.state !== "active") continue;
				const material = Object.freeze({
					kind: "eval-admitted-retry-delay" as const,
					executionId,
					providerOutcome: outcome,
					effectRunId: outcome.effectRunId,
					workItemId: outcome.workItemId,
					replicate: outcome.replicate,
					arm: outcome.arm,
					workItemRole: outcome.workItemRole,
					providerLogicalAttempt: outcome.providerLogicalAttempt,
					dispatchOrdinal: outcome.dispatchOrdinal,
					capacityRetryOrdinal: outcome.capacityRetryOrdinal,
					availabilityRetryOrdinal: outcome.availabilityRetryOrdinal,
					recoveryClass: outcome.recoveryClass,
					batchSize: 1,
					delayMs: outcome.retryAfterMs,
				});
				const admission = Object.freeze({
					...material,
					receiptDigest: retryDelayReceiptDigest(material),
				});
				state.admitted.add(executionId);
				admissions.push(admission);
			}
			if (admissions.length > 0)
				ctx.down(admissions.map((admission) => ["DATA", admission] as const));
			ctx.state.set(state);
		},
		{
			name: "eval/retry/delay-admission",
			factory: "rootEvalRetryDelayAdmission",
			pullId: retryAdmissionPullId,
			pausable: "resumeAll",
			meta: { admission: "per-correlated-retryable-result", batchBarrier: false },
		},
	);

	const retryAdmissionReleaseEvents = owner.initNode(
		merge<unknown>(),
		[retryableProviderResultAdmissions, retryDelayAdmissions],
		{ name: "eval/retry/admission-release-events" },
	);
	const retryAdmissionRelease = owner.node(
		[retryAdmissionReleaseEvents],
		(ctx) => {
			const seen = ctx.state.get<Set<string>>() ?? new Set<string>();
			let fresh = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = raw as EvalProviderOutcome;
				if (value.kind !== "eval-provider-outcome" || seen.has(value.admissionId)) continue;
				seen.add(value.admissionId);
				fresh = true;
			}
			ctx.state.set(seen);
			if (fresh) ctx.upNext([["PULL", { pullId: retryAdmissionPullId }]]);
		},
		{
			name: "eval/retry/admission-release-controller",
			factory: "rootEvalRetryAdmissionReleaseController",
		},
	);
	boundaryReleases.push(
		owner.retain(retryAdmissionRelease, {
			reason: "only correlated retryable DATA opens retry lifecycle",
		}),
	);
	type EvalSourceStageObservationContext = Readonly<{
		readonly campaignRef: string;
		readonly campaignContract: EvalCampaignContract;
		readonly memoryProvenance: typeof MEMORY_PROVENANCE;
	}>;
	const sourceStageObservationContext = owner.state(
		Object.freeze({
			campaignRef,
			campaignContract: campaignContractValue,
			memoryProvenance: MEMORY_PROVENANCE,
		}),
		{
			name: "eval/observation/source-stage-context",
			factory: "rootEvalSourceStageObservationContext",
			meta: {
				materialFree: true,
				authority: "immutable-campaign-observation-context",
			},
		},
	);
	type EvalBudgetSettledProviderOutcome = Readonly<{
		readonly kind: "eval-budget-settled-provider-outcome";
		readonly outcome: EvalProviderOutcome;
		readonly budget: EvalBudgetState;
	}>;
	type AdmissionFact =
		| EvalAdmittedEffect
		| EvalProviderAdmissionObservationCut
		| EvalBudgetSettledProviderOutcome;
	const admissionEvents = owner.initNode(
		merge<unknown>(),
		[
			replicateProposalBatches,
			retryProposals,
			pacedProviderProposals,
			providerCostSettlements,
			providerStartSpacingReadiness,
			retryDelayOutcomes,
			scheduleFeasibility,
			profileAdmission,
			progressAdmissionLease,
		],
		{ name: "eval/provider/admission-events" },
	);
	const admissionFacts = owner.node<AdmissionFact>(
		[admissionEvents],
		(ctx) => {
			const newlySettledProviderOutcomes: EvalProviderOutcome[] = [];
			const state = ctx.state.get<
				AdmissionState & {
					feasibility?: EvalScheduleFeasibility;
					profile?: RootEvalProfileAdmission;
					progress?: EvalProgressLeaseState;
				}
			>() ?? {
				proposalKeys: new Set<string>(),
				proposalDigests: new Map<string, string>(),
				admittedKeys: new Set<string>(),
				settledAdmissionIds: new Set<string>(),
				active: new Map<string, EvalAdmittedEffect>(),
				pendingProposals: new Map<string, EvalEffectProposal>(),
				releasedProposalKeys: new Set<string>(),
				retryProposalKeys: new Set<string>(),
				rejectedProposalKeys: new Set<string>(),
				cooldownReadinessIds: new Set<string>(),
				capacityMode: "paced-serial" as const,
				pacingRevision: 0,
				providerStartIntervalMs: ROOT_EVAL_PROVIDER_START_INTERVAL_MS,
				consecutiveUsableResponses: 0,
				maxConcurrentEffects: ROOT_EVAL_INITIAL_PROVIDER_CAPACITY,
				rateLimitFeedbackCount: 0,
				admittedAttempts: 0,
				admittedRetryAttempts: 0,
				settledRetryAttempts: 0,
				providerCallCount: 0,
				activeReservedMicrousd: 0,
				providerReportedMicrousd: 0,
				policyQualifiedNonbillableCount: 0,
				pricingRoundingAllowanceMicrousd: 0,
				unreportedSettledUpperBoundMicrousd: 0,
				providerOutcomeReasonCounts: { ...emptyEvalProviderOutcomeReasonCounts() },
				stoppingReason: "none" as const,
				observationRevision: 0,
			};

			const events = depBatch(ctx, 0) ?? [];
			for (const raw of events) {
				const kind = (raw as { kind: string }).kind;
				if (kind === "eval-schedule-feasibility")
					state.feasibility = raw as EvalScheduleFeasibility;
				else if (kind === "eval-provider-start-spacing-readiness") {
					if (state.stoppingReason !== "none") continue;
					const spacing = raw as EvalProviderStartSpacingReadiness;
					if (spacing.pacingRevision < state.pacingRevision)
						throw new TypeError("stale adaptive pacing revision");
					state.pacingRevision = spacing.pacingRevision;
					state.providerStartIntervalMs = spacing.providerStartIntervalMs;
					state.consecutiveUsableResponses = spacing.consecutiveUsableResponses;
				} else if (kind === "root-eval-profile-admission")
					state.profile = raw as RootEvalProfileAdmission;
				else if (kind === "eval-progress-lease-state") {
					const progress = raw as EvalProgressLeaseState;
					if (state.progress !== undefined && progress.revision < state.progress.revision)
						throw new TypeError("provider admission received a stale progress revision");
					state.progress = progress;
					if (progress.state === "stalled") state.stoppingReason = "progress-stalled";
				}
			}
			const settleProviderOutcome = (outcome: EvalProviderOutcome): boolean => {
				const active = state.active.get(outcome.admissionId);
				if (active === undefined || state.settledAdmissionIds.has(outcome.admissionId))
					return false;
				if (
					outcome.admission !== active ||
					outcome.admission.admissionId !== active.admissionId ||
					outcome.admission.effectRunId !== active.effectRunId ||
					outcome.admission.workItemId !== active.workItemId ||
					outcome.admission.receiptDigest !== active.receiptDigest ||
					outcome.admission.request.requestId !== active.request.requestId
				)
					throw new TypeError("eval outcome is not correlated to the active Graph admission");
				state.settledAdmissionIds.add(outcome.admissionId);
				state.active.delete(outcome.admissionId);
				state.activeReservedMicrousd -= active.reservationMicrousd;
				if (outcome.dispatchAttempted) state.providerCallCount += 1;
				if (outcome.costEvidence === "provider-reported") {
					state.providerReportedMicrousd += outcome.costMicrousd;
					state.pricingRoundingAllowanceMicrousd += outcome.pricingRoundingAllowanceMicrousd;
				} else if (outcome.costEvidence === "policy-qualified-nonbillable") {
					state.policyQualifiedNonbillableCount += 1;
				} else state.unreportedSettledUpperBoundMicrousd += outcome.costMicrousd;
				if (
					state.providerReportedMicrousd +
						state.unreportedSettledUpperBoundMicrousd +
						state.activeReservedMicrousd >
					maxCostMicrousd
				)
					state.stoppingReason = "budget-exhausted";
				state.providerOutcomeReasonCounts[outcome.reason] += 1;
				if (outcome.dispatchOrdinal > 1) state.settledRetryAttempts += 1;
				if (
					outcome.reason === "http-capacity-retryable" ||
					outcome.reason === "http-capacity-exhausted"
				) {
					const profile = state.profile;
					if (profile === undefined)
						throw new TypeError("rate-limit feedback lost its Graph profile authority");
					if (
						active.providerRef !== profile.binding.providerRef ||
						active.providerModelRef !== profile.binding.providerModelRef ||
						active.endpointProtocol !== profile.binding.endpointProtocol ||
						active.proposalEncoding !== profile.binding.proposalEncoding ||
						active.responseContractRevision !== profile.binding.responseContractRevision
					)
						throw new TypeError(
							"rate-limit feedback is not attributed to the exact admitted route",
						);
					if (outcome.status === "retryable") {
						state.cooldownReadinessIds.add(`${outcome.admissionId}/retry-delay`);
						state.capacityMode = "cooldown";
					}
					state.rateLimitFeedbackCount += 1;
				}
				if (outcome.status === "retryable" && outcome.recoveryClass === "availability") {
					state.cooldownReadinessIds.add(`${outcome.admissionId}/retry-delay`);
					state.capacityMode = "cooldown";
				}
				return true;
			};
			for (const raw of events) {
				if ((raw as { kind: string }).kind !== "eval-provider-outcome") continue;
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (settleProviderOutcome(outcome)) newlySettledProviderOutcomes.push(outcome);
			}
			for (const raw of events) {
				if ((raw as { kind: string }).kind !== "eval-retry-delay-outcome") continue;
				const readiness = validateRetryDelayOutcome(raw as EvalRetryDelayOutcome);
				if (readiness.status !== "completed")
					throw new TypeError("provider cooldown readiness failed closed");
				state.cooldownReadinessIds.delete(readiness.executionId);
			}
			if (state.capacityMode === "cooldown" && state.cooldownReadinessIds.size === 0)
				state.capacityMode = "paced-serial";
			const newlyAdmitted: EvalAdmittedEffect[] = [];
			const admitProposal = (proposal: EvalEffectProposal): "admitted" | "pending" | "rejected" => {
				if (state.feasibility?.state !== "feasible")
					throw new TypeError("provider admission lacked a finite Graph schedule proof");
				if (state.progress === undefined)
					throw new TypeError("provider admission lacked Graph progress authority");
				const plan = proposal.workItemPlanAuthority;
				validateEvalEffectProposalAgainstWorkItemPlan(proposal, plan);
				const key = `${proposal.effectRunId}:${proposal.dispatchOrdinal}`;
				if (state.admittedKeys.has(key)) return "admitted";
				if (state.rejectedProposalKeys.has(key)) return "rejected";
				if (state.stoppingReason !== "none") {
					state.rejectedProposalKeys.add(key);
					return "rejected";
				}
				if (!state.releasedProposalKeys.has(key)) return "pending";
				if (
					proposal.dispatchOrdinal > 1 &&
					!state.settledAdmissionIds.has(
						`${proposal.effectRunId}/dispatch-${proposal.dispatchOrdinal - 1}/admission`,
					)
				)
					return "pending";
				if (state.capacityMode === "cooldown" || state.active.size >= state.maxConcurrentEffects)
					return "pending";
				const cannotReserve =
					state.admittedAttempts >= maxAttempts ||
					state.providerReportedMicrousd +
						state.unreportedSettledUpperBoundMicrousd +
						state.activeReservedMicrousd +
						proposal.reservationMicrousd >
						maxCostMicrousd;
				if (cannotReserve) {
					state.stoppingReason = "budget-exhausted";
					state.rejectedProposalKeys.add(key);
					return "rejected";
				}
				const admissionId = `${proposal.effectRunId}/dispatch-${proposal.dispatchOrdinal}/admission`;
				const admittedMaterial = Object.freeze({
					...proposal,
					kind: "eval-admitted-effect" as const,
					admissionId,
					executionId: admissionId,
				});
				const admitted = Object.freeze({
					...admittedMaterial,
					receiptDigest: admissionReceiptDigest(admittedMaterial),
				});
				state.admittedKeys.add(key);
				state.releasedProposalKeys.delete(key);
				state.active.set(admissionId, admitted);
				state.admittedAttempts += 1;
				if (proposal.dispatchOrdinal > 1) state.admittedRetryAttempts += 1;
				state.activeReservedMicrousd += proposal.reservationMicrousd;
				newlyAdmitted.push(admitted);
				return "admitted";
			};
			const registerProposal = (proposal: EvalEffectProposal) => {
				const key = `${proposal.effectRunId}:${proposal.dispatchOrdinal}`;
				const digest = empiricalStrictJsonDigest(withoutUndefined(proposal));
				const priorDigest = state.proposalDigests.get(key);
				if (priorDigest !== undefined && priorDigest !== digest)
					throw new TypeError("provider proposal received contradictory replay");
				if (priorDigest !== undefined) return;
				state.proposalKeys.add(key);
				state.proposalDigests.set(key, digest);
				if (proposal.dispatchOrdinal > 1) state.retryProposalKeys.add(key);
				state.pendingProposals.set(key, proposal);
			};
			for (const raw of events) {
				if (Array.isArray(raw)) {
					for (const proposal of raw as readonly EvalEffectProposal[]) registerProposal(proposal);
				} else if ((raw as { kind: string }).kind === "eval-effect-proposal")
					registerProposal(raw as EvalEffectProposal);
			}
			for (const raw of events) {
				if ((raw as { kind: string }).kind !== "eval-paced-proposal-release") continue;
				const proposal = (raw as EvalPacedProposalRelease).proposal;
				registerProposal(proposal);
				state.releasedProposalKeys.add(`${proposal.effectRunId}:${proposal.dispatchOrdinal}`);
			}
			const pending = [...state.pendingProposals.entries()].sort(([, left], [, right]) => {
				if (left.workItemRole !== right.workItemRole)
					return left.workItemRole === "source" ? -1 : 1;
				if (left.replicate !== right.replicate) return left.replicate - right.replicate;
				const armOrder =
					HARNESS_ARMS.indexOf(left.arm as HarnessArm) -
					HARNESS_ARMS.indexOf(right.arm as HarnessArm);
				if (armOrder !== 0) return armOrder;
				return left.dispatchOrdinal - right.dispatchOrdinal;
			});
			for (const [key, proposal] of pending) {
				const disposition = admitProposal(proposal);
				if (disposition !== "pending") state.pendingProposals.delete(key);
			}
			if (state.stoppingReason !== "none") {
				for (const key of state.pendingProposals.keys()) state.rejectedProposalKeys.add(key);
				state.pendingProposals.clear();
			}
			if (
				state.retryProposalKeys.size !==
					[...state.pendingProposals.keys()].filter((key) => state.retryProposalKeys.has(key))
						.length +
						state.admittedRetryAttempts +
						[...state.rejectedProposalKeys].filter((key) => state.retryProposalKeys.has(key))
							.length ||
				state.proposalKeys.size !==
					state.pendingProposals.size + state.admittedKeys.size + state.rejectedProposalKeys.size ||
				state.settledRetryAttempts > state.admittedRetryAttempts
			)
				throw new TypeError("provider proposal conservation drifted");
			const budgetSnapshot: EvalBudgetState = Object.freeze({
				kind: "eval-budget-state" as const,
				executionGrantDigest,
				policyQualifiedNonbillableCount: state.policyQualifiedNonbillableCount,
				admittedAttempts: state.admittedAttempts,
				admittedRetryAttempts: state.admittedRetryAttempts,
				retryProposalCount: state.retryProposalKeys.size,
				pendingRetryProposalCount: [...state.pendingProposals.keys()].filter((key) =>
					state.retryProposalKeys.has(key),
				).length,
				rejectedRetryProposalCount: [...state.rejectedProposalKeys].filter((key) =>
					state.retryProposalKeys.has(key),
				).length,
				settledRetryAttemptCount: state.settledRetryAttempts,
				providerCallCount: state.providerCallCount,
				activeEffects: state.active.size,
				activeReservedMicrousd: state.activeReservedMicrousd,
				providerReportedMicrousd: state.providerReportedMicrousd,
				pricingRoundingAllowanceMicrousd: state.pricingRoundingAllowanceMicrousd,
				unreportedSettledUpperBoundMicrousd: state.unreportedSettledUpperBoundMicrousd,
				accountedUpperBoundMicrousd:
					state.activeReservedMicrousd +
					state.providerReportedMicrousd +
					state.unreportedSettledUpperBoundMicrousd,
				providerOutcomeReasonCounts: Object.freeze({
					...state.providerOutcomeReasonCounts,
				}),
				maxAttempts,
				maxCostMicrousd,
				stoppingReason: state.stoppingReason,
			});
			const capacitySnapshot: EvalProviderCapacityState = Object.freeze({
				kind: "eval-provider-capacity-state" as const,
				pacingRevision: state.pacingRevision,
				providerStartIntervalMs: state.providerStartIntervalMs,
				consecutiveUsableResponses: state.consecutiveUsableResponses,
				mode: state.capacityMode,
				initialMaxConcurrentEffects: ROOT_EVAL_INITIAL_PROVIDER_CAPACITY,
				maxConcurrentEffects: state.maxConcurrentEffects,
				activeEffects: state.active.size,
				proposalCount: state.proposalKeys.size,
				pendingProposalCount: state.pendingProposals.size,
				pendingFirstAttemptProposalCount: [...state.pendingProposals.values()].filter(
					(proposal) => proposal.dispatchOrdinal === 1,
				).length,
				pendingRetryProposalCount: [...state.pendingProposals.values()].filter(
					(proposal) => proposal.dispatchOrdinal > 1,
				).length,
				retryProposalCount: state.retryProposalKeys.size,
				admittedProposalCount: state.admittedKeys.size,
				admittedRetryProposalCount: state.admittedRetryAttempts,
				settledProposalCount: state.settledAdmissionIds.size,
				settledRetryProposalCount: state.settledRetryAttempts,
				rejectedProposalCount: state.rejectedProposalKeys.size,
				rejectedRetryProposalCount: [...state.rejectedProposalKeys].filter((key) =>
					state.retryProposalKeys.has(key),
				).length,
				cooldownOutstandingReadinessCount: state.cooldownReadinessIds.size,
				rateLimitFeedbackCount: state.rateLimitFeedbackCount,
			});

			const observationDigest = empiricalStrictJsonDigest({
				budget: budgetSnapshot,
				capacity: capacitySnapshot,
				activeProviderAdmissionIds: [...state.active.keys()].sort(),
			});
			if (state.observationDigest === observationDigest) {
				if (newlyAdmitted.length > 0 || newlySettledProviderOutcomes.length > 0)
					throw new TypeError("provider accounting changed without an observation coordinate");
				ctx.state.set(state);
				return;
			}
			state.observationDigest = observationDigest;
			state.observationRevision += 1;
			const observationCut = Object.freeze({
				kind: "eval-provider-admission-observation-cut" as const,
				revision: state.observationRevision,
				budget: budgetSnapshot,
				capacity: capacitySnapshot,
				activeProviderAdmissionIds: Object.freeze([...state.active.keys()].sort()),
			});
			assertEvalProviderAdmissionObservationCut(observationCut);
			ctx.state.set(state);
			ctx.down([
				...newlyAdmitted.map((admitted) => ["DATA", admitted] as const),
				["DATA", observationCut],
				...newlySettledProviderOutcomes.map(
					(outcome) =>
						[
							"DATA",
							Object.freeze({
								kind: "eval-budget-settled-provider-outcome" as const,
								outcome,
								budget: budgetSnapshot,
							}),
						] as const,
				),
			]);
		},
		{
			name: "eval/provider/graph-admission-and-budget",
			factory: "rootEvalProviderGraphAdmission",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				capacityPolicy: "paced-serial",
				atomicAdmissionObservationCut: true,
				preEmissionValidated: true,
				initialMaxConcurrentEffects: ROOT_EVAL_INITIAL_PROVIDER_CAPACITY,
				rateLimitedMaxConcurrentEffects: ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY,
				cooldownReadiness: "exact-correlated-retry-delay-outcome",
				proposalOrder: "replicate-fixed-arm-dispatch",
				providerStartIntervalMs: ROOT_EVAL_PROVIDER_START_INTERVAL_MS,
				reservation: "atomic-before-admission",
				proposalAuthority: "direct-dependency-with-graph-state-conservation",
				timeoutAuthority: "copied-from-work-item-plan",
				maxOutputTokens: 16_384,
				reasoningEffort: "medium",
			},
		},
	);
	const providerAdmissionObservationCuts = owner.node<EvalProviderAdmissionObservationCut>(
		[admissionFacts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AdmissionFact;
				if (fact.kind === "eval-provider-admission-observation-cut") ctx.down([["DATA", fact]]);
			}
		},
		{
			name: "eval/provider/admission-observation-cut",
			factory: "rootEvalProviderAdmissionObservationCut",
			meta: {
				materialFree: true,
				domainAuthority: "graph-state",
				atomicFields: Object.freeze(["budget", "capacity", "activeProviderAdmissionIds"]),
			},
		},
	);
	const providerAdmissions = owner.node<EvalAdmittedEffect>(
		[admissionFacts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if ((raw as AdmissionFact).kind === "eval-admitted-effect") ctx.down([["DATA", raw]]);
			}
		},
		{ name: "eval/provider/admissions", factory: "rootEvalProviderAdmissions" },
	);
	const providerCapacity = owner.node<EvalProviderCapacityState>(
		[providerAdmissionObservationCuts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", (raw as EvalProviderAdmissionObservationCut).capacity]]);
		},
		{
			name: "eval/provider/adaptive-capacity-state",
			factory: "rootEvalAdaptiveProviderCapacityState",
			meta: { materialFree: true, domainAuthority: "graph-state", rebound: false },
		},
	);
	const budgets = owner.node<EvalBudgetState>(
		[providerAdmissionObservationCuts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", (raw as EvalProviderAdmissionObservationCut).budget]]);
		},
		{ name: "eval/budget/state", factory: "rootEvalBudgetState" },
	);
	const budgetSettledProviderOutcomes = owner.node<EvalBudgetSettledProviderOutcome>(
		[admissionFacts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AdmissionFact;
				if (fact.kind === "eval-budget-settled-provider-outcome") ctx.down([["DATA", fact]]);
			}
		},
		{
			name: "eval/provider/budget-settled-outcomes",
			factory: "rootEvalBudgetSettledProviderOutcomes",
			meta: { authority: "provider-outcome-after-budget-settlement" },
		},
	);
	const toolAdmissionEvents = owner.initNode(
		merge<unknown>(),
		[budgetSettledProviderOutcomes, sourceToolOutcomes, taskBindingAuthority, budgets],
		{ name: "eval/tool/admission-events" },
	);
	const toolAdmissions = owner.node<EvalAdmittedToolEffect>(
		[toolAdmissionEvents],
		(ctx) => {
			const state = ctx.state.get<{
				admitted: Set<string>;
				bindings?: readonly RootEvalTaskBinding[];
				budget?: EvalBudgetState;
				sourceOutcomes: Map<string, EvalProviderOutcome>;
				sourceProviderSettled: Set<string>;
				sourceSettled: Set<string>;
			}>() ?? {
				admitted: new Set<string>(),
				sourceOutcomes: new Map<string, EvalProviderOutcome>(),
				sourceProviderSettled: new Set<string>(),
				sourceSettled: new Set<string>(),
			};
			const events = depBatch(ctx, 0) ?? [];
			for (const raw of events) {
				if (Array.isArray(raw)) state.bindings = raw as readonly RootEvalTaskBinding[];
				else if ((raw as { kind?: string }).kind === "eval-budget-state")
					state.budget = raw as EvalBudgetState;
			}
			ctx.state.set(state);
			const graphTaskBindings = state.bindings;
			if (graphTaskBindings === undefined) {
				if (events.some((raw) => !Array.isArray(raw)))
					throw new TypeError("tool event preceded task bindings");
				return;
			}
			const candidates: EvalProviderOutcome[] = [];
			for (const raw of events) {
				if ((raw as { kind?: string }).kind !== "eval-effect-outcome") continue;
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
				if (outcome.workItemRole === "source") state.sourceSettled.add(outcome.workItemId);
			}
			for (const raw of events) {
				if ((raw as { kind?: string }).kind !== "eval-budget-settled-provider-outcome") continue;
				const outcome = validateProviderOutcome((raw as EvalBudgetSettledProviderOutcome).outcome);
				if (outcome.workItemRole === "source") {
					state.sourceProviderSettled.add(outcome.workItemId);
					if (outcome.status === "tool-proposed" && outcome.toolProposal !== null)
						state.sourceOutcomes.set(outcome.workItemId, outcome);
					continue;
				}
				if (outcome.status === "tool-proposed" && outcome.toolProposal !== null)
					candidates.push(outcome);
			}
			// A stopped provider cohort cannot fill its original all-source barrier.
			// Already admitted source proposals still own workspaces and must drain.
			if (
				state.sourceProviderSettled.size === replicateCount ||
				(state.budget?.stoppingReason !== undefined &&
					state.budget.stoppingReason !== "none" &&
					state.budget.activeEffects === 0)
			) {
				const sourceToolActive = graphTaskBindings.some(
					(binding) =>
						state.sourceOutcomes.has(binding.sourceWorkItemId) &&
						state.admitted.has(
							`${state.sourceOutcomes.get(binding.sourceWorkItemId)!.admissionId}/exact-tool`,
						) &&
						!state.sourceSettled.has(binding.sourceWorkItemId),
				);
				if (!sourceToolActive) {
					const next = graphTaskBindings.find(
						(binding) =>
							state.sourceOutcomes.has(binding.sourceWorkItemId) &&
							!state.admitted.has(
								`${state.sourceOutcomes.get(binding.sourceWorkItemId)!.admissionId}/exact-tool`,
							),
					);
					if (next !== undefined)
						candidates.unshift(state.sourceOutcomes.get(next.sourceWorkItemId)!);
				}
			}
			for (const outcome of candidates) {
				const toolAdmissionId = `${outcome.admissionId}/exact-tool`;
				if (state.admitted.has(toolAdmissionId)) continue;
				const proposal = outcome.toolProposal;
				if (proposal === null) continue;
				const binding = graphTaskBindings.find(
					(candidate) => candidate.replicate === outcome.replicate,
				);
				if (binding === undefined)
					throw new TypeError("tool proposal did not bind a known task occurrence");
				const targetCatalog =
					outcome.workItemRole === "target"
						? binding.targetCandidateCatalogs[outcome.arm as HarnessArm]
						: undefined;
				const candidateRefs =
					outcome.workItemRole === "source"
						? binding.sourceCandidateRefs
						: targetCatalog?.candidateRefs;
				const candidateCatalogDigest =
					outcome.workItemRole === "source"
						? binding.sourceCandidateCatalogDigest
						: targetCatalog?.candidateCatalogDigest;
				if (
					candidateRefs === undefined ||
					!candidateRefs.includes(proposal.candidateRef) ||
					proposal.candidateCatalogDigest !== candidateCatalogDigest ||
					(outcome.workItemRole === "source"
						? outcome.workItemId !== binding.sourceWorkItemId
						: targetCatalog?.workItemId !== outcome.workItemId)
				)
					throw new TypeError("tool proposal did not match its occurrence-bound candidate catalog");
				const material = Object.freeze({
					kind: "eval-admitted-tool-effect" as const,
					executionId: toolAdmissionId,
					toolAdmissionId,
					providerAdmission: outcome.admission,
					providerOutcome: outcome,
					effectRunId: outcome.effectRunId,
					workItemId: outcome.workItemId,
					replicate: outcome.replicate,
					arm: outcome.arm,
					workItemRole: outcome.workItemRole,
					providerLogicalAttempt: outcome.providerLogicalAttempt,
					dispatchOrdinal: outcome.dispatchOrdinal,
					capacityRetryOrdinal: outcome.capacityRetryOrdinal,
					availabilityRetryOrdinal: outcome.availabilityRetryOrdinal,
					toolRef: proposal.toolRef,
					candidateRef: proposal.candidateRef,
					candidateCatalogDigest: proposal.candidateCatalogDigest,
					argumentsDigest: proposal.argumentsDigest,
				});
				const admission = Object.freeze({
					...material,
					receiptDigest: toolAdmissionReceiptDigest(material),
				});
				state.admitted.add(toolAdmissionId);
				ctx.down([["DATA", admission]]);
			}
			ctx.state.set(state);
		},
		{
			name: "eval/tool/exact-admission",
			factory: "rootEvalExactToolAdmission",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				toolRef: "graphrefly.eval.exact-candidate-tool.v2",
				arguments: "occurrence-bound-candidate-ref-and-catalog-digest",
				sourceBarrier: "all-five-provider-outcomes-before-source-tools",
				sourceBudgetBarrier: "all-five-provider-budget-settlements-before-source-tools",
				stoppedSourceDrain: "settled-admitted-source-tools-without-unstarted-siblings",
				sourceToolCapacity: 1,
			},
		},
	);
	const providerExecutorEffects = owner.initNode(
		merge<EvalAdmittedEffect>(),
		[providerAdmissions],
		{
			name: "eval/executor/current-provider-effect",
			meta: { role: "caller-executes-current-admitted-provider-effect-only" },
		},
	);
	const candidateProposalObservations = owner.node(
		[budgetSettledProviderOutcomes],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const settled = raw as EvalBudgetSettledProviderOutcome;
				const outcome = validateProviderOutcome(settled.outcome);
				if (outcome.toolProposal === null) continue;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-candidate-causality-observation" as const,
							stage: "provider-proposal" as const,
							workItemId: outcome.workItemId,
							replicate: outcome.replicate,
							arm: outcome.arm,
							workItemRole: outcome.workItemRole,
							providerAdmissionReceiptDigest: outcome.admission.receiptDigest,
							candidateRef: outcome.toolProposal.candidateRef,
							candidateCatalogDigest: outcome.toolProposal.candidateCatalogDigest,
							argumentsDigest: outcome.toolProposal.argumentsDigest,
							resultDigest: outcome.resultDigest,
						}),
					],
				]);
			}
		},
		{
			name: "eval/observation/candidate-provider-proposal",
			factory: "rootEvalCandidateProviderProposalObservation",
			meta: { materialFree: true, stage: "provider-proposal" },
		},
	);
	const candidateAdmissionObservations = owner.node(
		[toolAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const admission = raw as EvalAdmittedToolEffect;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-candidate-causality-observation" as const,
							stage: "tool-admission" as const,
							workItemId: admission.workItemId,
							replicate: admission.replicate,
							arm: admission.arm,
							workItemRole: admission.workItemRole,
							providerAdmissionReceiptDigest: admission.providerAdmission.receiptDigest,
							toolAdmissionReceiptDigest: admission.receiptDigest,
							candidateRef: admission.candidateRef,
							candidateCatalogDigest: admission.candidateCatalogDigest,
							argumentsDigest: admission.argumentsDigest,
						}),
					],
				]);
			}
		},
		{
			name: "eval/observation/candidate-tool-admission",
			factory: "rootEvalCandidateToolAdmissionObservation",
			meta: { materialFree: true, stage: "tool-admission" },
		},
	);
	const candidateResultObservations = owner.node(
		[_toolResults],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
				if (outcome.admission.kind !== "eval-admitted-tool-effect")
					throw new TypeError("exact tool result lost its Graph tool admission receipt");
				const admission = assertRootEvalToolAdmissionReceipt(outcome.admission);
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-candidate-causality-observation" as const,
							stage: "tool-result" as const,
							workItemId: outcome.workItemId,
							replicate: outcome.replicate,
							arm: outcome.arm,
							workItemRole: outcome.workItemRole,
							providerAdmissionReceiptDigest: admission.providerAdmission.receiptDigest,
							toolAdmissionReceiptDigest: admission.receiptDigest,
							candidateRef: admission.candidateRef,
							candidateCatalogDigest: admission.candidateCatalogDigest,
							argumentsDigest: outcome.argumentsDigest,
							resultDigest: outcome.resultDigest,
							diff: outcome.evidence.diff,
							publicSemantic: outcome.evidence.publicSemantic,
							hiddenVerifier: outcome.evidence.hiddenVerifier,
							cleanupCompleted: outcome.evidence.cleanupCompleted,
						}),
					],
				]);
			}
		},
		{
			name: "eval/observation/candidate-tool-result",
			factory: "rootEvalCandidateToolResultObservation",
			meta: { materialFree: true, stage: "tool-result" },
		},
	);
	void candidateProposalObservations;
	void candidateAdmissionObservations;
	void candidateResultObservations;
	const toolExecutorEffects = owner.initNode(merge<EvalAdmittedToolEffect>(), [toolAdmissions], {
		name: "eval/executor/current-tool-effect",
		meta: { role: "caller-executes-current-admitted-tool-effect-only" },
	});
	const retryDelayExecutorEffects = owner.initNode(
		merge<EvalRetryDelayEffect>(),
		[retryDelayAdmissions],
		{
			name: "eval/executor/current-retry-delay",
			meta: { role: "caller-executes-current-admitted-retry-delay-only" },
		},
	);
	type EvalBillingPending = Readonly<{
		readonly kind: "eval-billing-pending";
		readonly observation: number;
		readonly outstanding: boolean;
	}>;
	type BillingFact =
		| EvalBillingPending
		| EvalBillingObservationProposal
		| EvalBillingReconciliation;
	interface BillingState {
		readonly completed: Map<string, EvalCleanupFact>;
		started: boolean;
		outstanding: boolean;
		finalized: boolean;
		observation: number;
		observedChange: boolean;
		stableIntervals: number;
		previous: EvalCurrentKeySnapshot | null;
	}
	const billingFactEvents = owner.initNode(
		merge<unknown>(),
		[cleanup, budgets, billingObservationOutcomes, currentKeyBeforeState, campaignStates],
		{ name: "eval/billing/fact-events" },
	);
	const billingFacts = owner.node<BillingFact>(
		[billingFactEvents],
		(ctx) => {
			let emitted = false;
			const state = ctx.state.get<
				BillingState & {
					before?: EvalCurrentKeySnapshot;
					budget?: EvalBudgetState;
					campaignState?: EvalCampaignState;
				}
			>() ?? {
				completed: new Map<string, EvalCleanupFact>(),
				started: false,
				outstanding: false,
				finalized: false,
				observation: 0,
				observedChange: false,
				stableIntervals: 0,
				previous: null,
			};

			const events = depBatch(ctx, 0) ?? [];
			for (const raw of events) {
				const kind = (raw as { kind: string }).kind;
				if (kind === "eval-cleanup-complete") {
					const fact = raw as EvalCleanupFact;
					state.completed.set(fact.workItemId, fact);
				} else if (kind === "eval-current-key-snapshot") {
					if (
						state.before !== undefined &&
						state.before.admissionDigest !== (raw as EvalCurrentKeySnapshot).admissionDigest
					)
						throw new TypeError("billing baseline drifted");
					state.before = raw as EvalCurrentKeySnapshot;
				} else if (kind === "eval-budget-state") state.budget = raw as EvalBudgetState;
				else if (kind === "eval-campaign-state") state.campaignState = raw as EvalCampaignState;
			}
			const { before, budget, campaignState } = state;
			const emitFinal = (
				status: EvalBillingReconciliation["status"],
				reason: EvalBillingReconciliation["reason"],
				observedBilledMicrousd: number | null,
				reconciledBilledMicrousd: number | null,
			) => {
				if (budget === undefined)
					throw new TypeError("billing reconciliation requires current Graph budget DATA");
				if (budget.pricingRoundingAllowanceMicrousd > budget.providerReportedMicrousd)
					throw new TypeError("billing rounding certificate exceeded provider-priced cost");
				const providerReportedLowerBoundMicrousd = Math.max(
					0,
					budget.providerReportedMicrousd - budget.pricingRoundingAllowanceMicrousd,
				);
				state.finalized = true;
				state.outstanding = false;
				emitted = true;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-billing-reconciliation" as const,
							status,
							reason,
							observationCount: state.observation,
							stableIntervals: state.stableIntervals,
							providerReportedMicrousd: budget.providerReportedMicrousd,
							pricingRoundingAllowanceMicrousd: budget.pricingRoundingAllowanceMicrousd,
							providerReportedLowerBoundMicrousd,
							observedBilledMicrousd,
							reconciledBilledMicrousd,
						}),
					],
				]);
			};
			for (const raw of events) {
				if ((raw as { kind: string }).kind !== "eval-billing-observation-outcome") continue;
				if (state.finalized || before === undefined || budget === undefined) continue;
				const outcome = validateBillingObservationOutcome(raw as EvalBillingObservationOutcome);
				if (!state.outstanding || outcome.observation !== state.observation)
					throw new TypeError("billing observation was not the current Graph admission");
				state.outstanding = false;
				if (outcome.status === "failed" || outcome.currentKeyAfter === null) {
					emitFinal("rejected", "observation-failed", null, null);
					continue;
				}
				const after = outcome.currentKeyAfter;
				if (
					after.keyBindingDigest !== before.keyBindingDigest ||
					after.limitMicrousd !== before.limitMicrousd ||
					after.limitReset !== before.limitReset ||
					after.isManagementKey !== before.isManagementKey
				) {
					emitFinal("rejected", "identity-drift", null, null);
					continue;
				}
				if (
					after.usageMicrousd < before.usageMicrousd ||
					after.remainingMicrousd > before.remainingMicrousd ||
					(state.previous !== null &&
						(after.usageMicrousd < state.previous.usageMicrousd ||
							after.remainingMicrousd > state.previous.remainingMicrousd))
				) {
					emitFinal("rejected", "non-monotonic", null, null);
					continue;
				}
				const usageDelta = after.usageMicrousd - before.usageMicrousd;
				const remainingDelta = before.remainingMicrousd - after.remainingMicrousd;
				if (usageDelta !== remainingDelta) {
					emitFinal("rejected", "delta-mismatch", null, null);
					continue;
				}
				if (usageDelta > budget.maxCostMicrousd) {
					emitFinal("rejected", "above-hard-cap", usageDelta, null);
					continue;
				}
				if (usageDelta > budget.accountedUpperBoundMicrousd) {
					emitFinal("rejected", "above-accounted-upper-bound", usageDelta, null);
					continue;
				}
				if (usageDelta > 0 || budget.providerCallCount === 0) state.observedChange = true;
				state.stableIntervals =
					state.previous !== null &&
					after.usageMicrousd === state.previous.usageMicrousd &&
					after.remainingMicrousd === state.previous.remainingMicrousd
						? state.stableIntervals + 1
						: 0;
				state.previous = after;
				if (state.observedChange && state.stableIntervals >= 3) {
					const providerReportedLowerBoundMicrousd = Math.max(
						0,
						budget.providerReportedMicrousd - budget.pricingRoundingAllowanceMicrousd,
					);
					if (usageDelta < providerReportedLowerBoundMicrousd)
						emitFinal("rejected", "below-certified-provider-lower-bound", usageDelta, null);
					else emitFinal("reconciled", "quiescent", usageDelta, usageDelta);
					continue;
				}
				if (state.observation >= 8) {
					const providerReportedLowerBoundMicrousd = Math.max(
						0,
						budget.providerReportedMicrousd - budget.pricingRoundingAllowanceMicrousd,
					);
					emitFinal(
						"rejected",
						budget.providerCallCount > 0 && usageDelta === 0
							? "provider-calls-without-billed-delta"
							: usageDelta < providerReportedLowerBoundMicrousd
								? "below-certified-provider-lower-bound"
								: "quiescence-exhausted",
						usageDelta,
						null,
					);
				}
			}
			const ready =
				before !== undefined &&
				budget !== undefined &&
				budget.activeEffects === 0 &&
				campaignState?.state === "stopped" &&
				campaignState.stoppingReason === "campaign-complete" &&
				state.completed.size ===
					(replicateCount - campaignState.sourceTechnicalExcludedReplicates.length) *
						HARNESS_ARMS.length;
			if (ready && !state.finalized && !state.outstanding) {
				state.started = true;
				state.outstanding = true;
				state.observation += 1;
				emitted = true;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-billing-observation-proposal" as const,
							proposalId: `${campaignRef}/billing/observation-${state.observation}/proposal`,
							observation: state.observation,
							delayMs: state.observation === 1 ? 0 : 2_000,
							currentKeyBefore: before,
							providerCallCount: budget.providerCallCount,
							providerReportedMicrousd: budget.providerReportedMicrousd,
							pricingRoundingAllowanceMicrousd: budget.pricingRoundingAllowanceMicrousd,
							providerReportedLowerBoundMicrousd: Math.max(
								0,
								budget.providerReportedMicrousd - budget.pricingRoundingAllowanceMicrousd,
							),
							accountedUpperBoundMicrousd: budget.accountedUpperBoundMicrousd,
							maxCostMicrousd: budget.maxCostMicrousd,
						}),
					],
				]);
			}
			if (!emitted)
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-billing-pending" as const,
							observation: state.observation,
							outstanding: state.outstanding,
						}),
					],
				]);
			ctx.state.set(state);
		},
		{
			name: "eval/billing/observation-proposal-and-stopping",
			factory: "rootEvalBillingObservationProposalAndStopping",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { maxObservations: 8, stableIntervals: 3, retryAuthority: "root-graph" },
		},
	);
	const billingObservationProposals = owner.node<EvalBillingObservationProposal>(
		[billingFacts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				if ((raw as BillingFact).kind === "eval-billing-observation-proposal") {
					ctx.down([["DATA", raw]]);
				}
		},
		{
			name: "eval/billing/observation-proposals",
			factory: "rootEvalBillingObservationProposals",
		},
	);
	const billingAdmissionPullId = Symbol("eval/billing-admission");
	const billingObservationAdmissions = owner.node<EvalBillingObservationEffect>(
		[billingObservationProposals, currentKeyBeforeState],
		(ctx) => {
			const admitted = ctx.state.get<Set<string>>() ?? new Set<string>();
			const before = depLatest(ctx, 1) as EvalCurrentKeySnapshot | undefined;
			if (before === undefined) return;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const proposal = raw as EvalBillingObservationProposal;
				if (proposal.currentKeyBefore !== before)
					throw new TypeError("billing observation proposal lost current-key Graph DATA");
				const executionId = `${campaignRef}/billing/observation-${proposal.observation}/admission`;
				if (admitted.has(executionId)) continue;
				const material = Object.freeze({
					...proposal,
					kind: "eval-admitted-billing-observation" as const,
					executionId,
				});
				const admission = Object.freeze({
					...material,
					receiptDigest: billingObservationReceiptDigest(material),
				});
				admitted.add(executionId);
				ctx.down([["DATA", admission]]);
			}
			ctx.state.set(admitted);
		},
		{
			name: "eval/billing/observation-admission",
			factory: "rootEvalBillingObservationAdmission",
			pullId: billingAdmissionPullId,
			pausable: "resumeAll",
			meta: { authority: "root-graph", callerAuthority: "execute-current-effect-only" },
		},
	);
	const billingAdmissionReleaseEvents = owner.initNode(
		merge<unknown>(),
		[billingObservationProposals, billingObservationAdmissions],
		{ name: "eval/billing/admission-release-events" },
	);
	const billingAdmissionRelease = owner.node(
		[billingAdmissionReleaseEvents],
		(ctx) => {
			const seen = ctx.state.get<Set<string>>() ?? new Set<string>();
			let fresh = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = raw as EvalBillingObservationProposal;
				if (value.kind !== "eval-billing-observation-proposal" || seen.has(value.proposalId))
					continue;
				seen.add(value.proposalId);
				fresh = true;
			}
			ctx.state.set(seen);
			if (fresh) ctx.upNext([["PULL", { pullId: billingAdmissionPullId }]]);
		},
		{
			name: "eval/billing/admission-release-controller",
			factory: "rootEvalBillingAdmissionReleaseController",
		},
	);
	boundaryReleases.push(
		owner.retain(billingAdmissionRelease, {
			reason: "only a billing proposal opens its effect lifecycle",
		}),
	);
	const billingExecutorEffects = owner.initNode(
		merge<EvalBillingObservationEffect>(),
		[billingObservationAdmissions],
		{
			name: "eval/executor/current-billing-observation",
			meta: { role: "caller-executes-current-admitted-billing-observation-only" },
		},
	);
	const billingReconciliation = owner.node<EvalBillingReconciliation>(
		[billingFacts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				if ((raw as BillingFact).kind === "eval-billing-reconciliation") {
					ctx.down([["DATA", raw]]);
				}
		},
		{
			name: "eval/billing/reconciliation",
			factory: "rootEvalBillingReconciliation",
			meta: {
				materialFree: true,
				terminalAuditDependency: true,
				efficacyAuthority: false,
			},
		},
	);
	type EvalEffectLifecycleSnapshot = Readonly<{
		readonly kind: "eval-effect-lifecycle-snapshot";
		readonly active: readonly EvalExecutableEffect[];
		readonly admitted: readonly EvalExecutableEffect[];
		readonly admittedEffects: number;
		readonly settledEffects: number;
		readonly cleanupFailureCount: number;
		readonly completedTargetWorkItems: number;
	}>;
	interface EvalEffectLifecycleState {
		readonly active: Map<string, EvalExecutableEffect>;
		readonly settled: Map<string, string>;
		cleanupFailureCount: number;
		completedTargetWorkItems: number;
	}
	const settleLifecycleEffect = (
		state: EvalEffectLifecycleState,
		validated: Readonly<{
			readonly executionId: string;
			readonly resultDigest: string;
			readonly admission: EvalExecutableEffect;
		}>,
	): boolean => {
		const priorDigest = state.settled.get(validated.executionId);
		if (priorDigest !== undefined) {
			if (priorDigest !== validated.resultDigest)
				throw new TypeError("effect lifecycle received contradictory settlement");
			return false;
		}
		const active = state.active.get(validated.executionId);
		if (active === undefined || validated.admission !== active)
			throw new TypeError("effect lifecycle settlement lacked its active Graph admission");
		state.active.delete(validated.executionId);
		state.settled.set(validated.executionId, validated.resultDigest);
		return true;
	};
	const admitLifecycleEffects = (
		state: EvalEffectLifecycleState,
		rawEffects: readonly unknown[],
	): readonly EvalExecutableEffect[] => {
		const admitted: EvalExecutableEffect[] = [];
		for (const raw of rawEffects) {
			const effect = raw as EvalExecutableEffect;
			if (state.settled.has(effect.executionId)) continue;
			const prior = state.active.get(effect.executionId);
			if (
				prior !== undefined &&
				empiricalStrictJsonDigest(prior) !== empiricalStrictJsonDigest(effect)
			)
				throw new TypeError("effect lifecycle received contradictory Graph admission");
			if (prior === undefined) {
				state.active.set(effect.executionId, effect);
				admitted.push(effect);
			}
		}
		return admitted;
	};

	// These are alternative lifecycle events, not a latest-value join. Tag each
	// lane before the built-in merge; no call-site partial override is needed.
	const createEffectLifecycle = (
		source: Node<unknown>,
		outcomeSource: Node<unknown>,
		validateOutcome: (raw: unknown) => Readonly<{
			executionId: string;
			resultDigest: string;
			admission: EvalExecutableEffect;
			cleanupFailed?: boolean;
			completedTargetWorkItem?: boolean;
		}>,
		name: string,
		factory: string,
		effectClass: string,
	) => {
		const events = owner.initNode(merge<unknown>(), [source, outcomeSource, start], {
			name: `${name}/events`,
		});
		return owner.node<EvalEffectLifecycleSnapshot>(
			[events],
			(ctx) => {
				const prior = ctx.state.get<EvalEffectLifecycleState>();
				const state = prior ?? {
					active: new Map<string, EvalExecutableEffect>(),
					settled: new Map<string, string>(),
					cleanupFailureCount: 0,
					completedTargetWorkItems: 0,
				};
				const admitted: EvalExecutableEffect[] = [];
				let changed = prior === undefined;
				for (const raw of depBatch(ctx, 0) ?? []) {
					const kind = (raw as { kind: string }).kind;
					if (kind.startsWith("eval-admitted-")) {
						const newAdmissions = admitLifecycleEffects(state, [raw]);
						admitted.push(...newAdmissions);
						changed = newAdmissions.length > 0 || changed;
					} else if (kind !== "eval-campaign-start") {
						const outcome = validateOutcome(raw);
						if (settleLifecycleEffect(state, outcome)) {
							if (outcome.cleanupFailed) state.cleanupFailureCount += 1;
							if (outcome.completedTargetWorkItem) state.completedTargetWorkItems += 1;
							changed = true;
						}
					}
				}
				ctx.state.set(state);
				if (!changed) return;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-effect-lifecycle-snapshot" as const,
							active: Object.freeze([...state.active.values()]),
							admitted: Object.freeze(admitted),
							admittedEffects: state.active.size + state.settled.size,
							settledEffects: state.settled.size,
							cleanupFailureCount: state.cleanupFailureCount,
							completedTargetWorkItems: state.completedTargetWorkItems,
						}),
					],
				]);
			},
			{
				name,
				factory,
				completeWhenDepsComplete: false,
				errorWhenDepsError: false,
				meta: { domainAuthority: "graph-state", effectClass },
			},
		);
	};
	const providerEffectLifecycles = createEffectLifecycle(
		providerExecutorEffects,
		allProviderResultAdmissions,
		(raw) => {
			const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
			return {
				...outcome,
				cleanupFailed: outcome.status !== "tool-proposed" && !outcome.cleanupCompleted,
				completedTargetWorkItem: outcome.workItemRole === "target" && outcome.status === "failed",
			};
		},
		"eval/executor/provider-effect-lifecycle-registry",
		"rootEvalEffectLifecycleRegistry",
		"provider",
	);
	const retryEffectLifecycles = createEffectLifecycle(
		retryDelayExecutorEffects as unknown as Node<unknown>,
		retryDelayOutcomes as unknown as Node<unknown>,
		(raw) => validateRetryDelayOutcome(raw as EvalRetryDelayOutcome),
		"eval/executor/retry-effect-lifecycle-registry",
		"rootEvalRetryEffectLifecycleRegistry",
		"retry-delay",
	);
	const toolEffectLifecycles = createEffectLifecycle(
		toolExecutorEffects as unknown as Node<unknown>,
		allToolOutcomes as unknown as Node<unknown>,
		(raw) => {
			const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
			return {
				...outcome,
				cleanupFailed: !outcome.evidence.cleanupCompleted,
				completedTargetWorkItem: outcome.admission.workItemRole === "target",
			};
		},
		"eval/executor/tool-effect-lifecycle-registry",
		"rootEvalToolEffectLifecycleRegistry",
		"exact-tool",
	);
	const billingEffectLifecycles = createEffectLifecycle(
		billingExecutorEffects as unknown as Node<unknown>,
		billingObservationOutcomes as unknown as Node<unknown>,
		(raw) => validateBillingObservationOutcome(raw as EvalBillingObservationOutcome),
		"eval/executor/billing-effect-lifecycle-registry",
		"rootEvalBillingEffectLifecycleRegistry",
		"billing-observation",
	);
	const activeEffectsByKind = (
		source: Node<EvalEffectLifecycleSnapshot>,
		kind: EvalExecutableEffect["kind"],
		name: string,
		factory: string,
	) =>
		owner.node<readonly EvalExecutableEffect[]>(
			[source],
			(ctx) => {
				for (const raw of depBatch(ctx, 0) ?? []) {
					ctx.down([
						[
							"DATA",
							Object.freeze(
								(raw as EvalEffectLifecycleSnapshot).active.filter(
									(effect) => effect.kind === kind,
								),
							),
						],
					]);
				}
			},
			{ name, factory, meta: { authority: "effect-lifecycle-registry", effectClass: kind } },
		);
	const campaignActiveEffects = activeEffectsByKind(
		providerEffectLifecycles,
		"eval-admitted-effect",
		"eval/executor/active-provider-effects",
		"rootEvalAllActiveEffects",
	);
	const toolActiveEffects = activeEffectsByKind(
		toolEffectLifecycles,
		"eval-admitted-tool-effect",
		"eval/executor/active-tool-effects",
		"rootEvalActiveToolEffects",
	);
	const retryActiveEffects = activeEffectsByKind(
		retryEffectLifecycles,
		"eval-admitted-retry-delay",
		"eval/executor/active-retry-effects",
		"rootEvalActiveRetryEffects",
	);
	const billingActiveEffects = activeEffectsByKind(
		billingEffectLifecycles,
		"eval-admitted-billing-observation",
		"eval/executor/active-billing-effects",
		"rootEvalActiveBillingEffects",
	);
	const activityCount = (
		source: Node<EvalEffectLifecycleSnapshot>,
		effectClass: EvalEffectClassActivitySnapshot["effectClass"],
		name: string,
		factory: string,
	) =>
		owner.node<EvalEffectClassActivitySnapshot>(
			[source],
			(ctx) => {
				for (const raw of depBatch(ctx, 0) ?? []) {
					const snapshot = raw as EvalEffectLifecycleSnapshot;
					ctx.down([
						[
							"DATA",
							Object.freeze({
								kind: "eval-effect-class-activity-snapshot" as const,
								effectClass,
								activeEffects: snapshot.active.length,
								activeExecutionIds: Object.freeze(
									snapshot.active.map((effect) => effect.executionId).sort(),
								),
								admittedEffects: snapshot.admittedEffects,
								settledEffects: snapshot.settledEffects,
								cleanupFailureCount: snapshot.cleanupFailureCount,
								completedTargetWorkItems: snapshot.completedTargetWorkItems,
							}),
						],
					]);
				}
			},
			{
				name,
				factory,
				meta: {
					materialFree: true,
					authority: "read-only-lifecycle-count",
					effectClass,
				},
			},
		);
	const providerActivity = activityCount(
		providerEffectLifecycles,
		"provider",
		"eval/observation/provider-effect-activity",
		"rootEvalProviderEffectActivity",
	);
	const toolActivity = activityCount(
		toolEffectLifecycles,
		"exact-tool",
		"eval/observation/tool-effect-activity",
		"rootEvalToolEffectActivity",
	);
	const retryActivity = activityCount(
		retryEffectLifecycles,
		"retry-delay",
		"eval/observation/retry-effect-activity",
		"rootEvalRetryEffectActivity",
	);
	const billingActivity = activityCount(
		billingEffectLifecycles,
		"billing-observation",
		"eval/observation/billing-effect-activity",
		"rootEvalBillingEffectActivity",
	);
	const effectActivity = owner.node<EvalEffectActivitySnapshot>(
		[providerActivity, toolActivity, retryActivity, billingActivity, budgets],
		(ctx) => {
			const provider = depLatest(ctx, 0) as EvalEffectClassActivitySnapshot;
			const tool = depLatest(ctx, 1) as EvalEffectClassActivitySnapshot;
			const retry = depLatest(ctx, 2) as EvalEffectClassActivitySnapshot;
			const billing = depLatest(ctx, 3) as EvalEffectClassActivitySnapshot;
			const activeProviderEffects = provider.activeEffects;
			const activeToolEffects = tool.activeEffects;
			const activeRetryEffects = retry.activeEffects;
			const activeBillingEffects = billing.activeEffects;
			const budget = depLatest(ctx, 4) as EvalBudgetState;
			const providerReasonTotal = EVAL_PROVIDER_OUTCOME_REASON_CODES.reduce(
				(total, reason) => total + budget.providerOutcomeReasonCounts[reason],
				0,
			);
			const retryableReasonTotal =
				budget.providerOutcomeReasonCounts["transport-availability-retryable"] +
				budget.providerOutcomeReasonCounts["http-capacity-retryable"] +
				budget.providerOutcomeReasonCounts["http-availability-retryable"];
			const activeAdmittedEffects =
				activeProviderEffects + activeToolEffects + activeRetryEffects + activeBillingEffects;
			const lifecycleConserved = (activity: EvalEffectClassActivitySnapshot) =>
				activity.activeEffects === activity.admittedEffects - activity.settledEffects;
			if (
				![provider, tool, retry, billing].every(lifecycleConserved) ||
				activeProviderEffects !== budget.activeEffects ||
				provider.admittedEffects !== budget.admittedAttempts ||
				provider.settledEffects !== providerReasonTotal ||
				tool.admittedEffects > budget.providerOutcomeReasonCounts["tool-proposed"] ||
				retry.admittedEffects !== retryableReasonTotal ||
				retry.settledEffects !== budget.retryProposalCount ||
				activeAdmittedEffects > HARNESS_ARMS.length ||
				(activeBillingEffects > 0 && activeAdmittedEffects !== activeBillingEffects)
			) {
				return;
			}

			const causeDigest = empiricalStrictJsonDigest({ provider, tool, retry, billing, budget });
			const prior = ctx.state.get<{ revision: number; causeDigest: string }>();
			if (prior?.causeDigest === causeDigest) return;
			const revision = (prior?.revision ?? 0) + 1;
			ctx.state.set({ revision, causeDigest });
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-effect-activity-snapshot" as const,
						revision,
						budgetDigest: empiricalStrictJsonDigest(budget),
						budget,
						activeProviderAdmissionIds: provider.activeExecutionIds,
						activeProviderEffects,
						activeToolEffects,
						activeRetryEffects,
						activeBillingEffects,
						activeAdmittedEffects,
						cleanupComplete: provider.cleanupFailureCount === 0 && tool.cleanupFailureCount === 0,
						pendingToolAdmissions:
							budget.providerOutcomeReasonCounts["tool-proposed"] - tool.admittedEffects,
						completedTargetWorkItems:
							provider.completedTargetWorkItems + tool.completedTargetWorkItems,
					}),
				],
			]);
		},
		{
			name: "eval/observation/effect-activity",
			factory: "rootEvalEffectActivityTimeline",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				materialFree: true,
				authority: "stable-cut-of-existing-lifecycle-and-budget-authorities",
				budgetEpochBound: true,
				providerAdmissionIdentityBound: true,
			},
		},
	);
	const admittedEffectsByKind = (
		source: Node<EvalEffectLifecycleSnapshot>,
		kind: EvalExecutableEffect["kind"],
		name: string,
		factory: string,
	) =>
		owner.node<EvalExecutableEffect>(
			[source],
			(ctx) => {
				for (const raw of depBatch(ctx, 0) ?? [])
					for (const effect of (raw as EvalEffectLifecycleSnapshot).admitted)
						if (effect.kind === kind) ctx.down([["DATA", effect]]);
			},
			{ name, factory, meta: { callerAuthority: "execute-current-active-admitted-effect-only" } },
		);
	const callerAdmittedEffects = admittedEffectsByKind(
		providerEffectLifecycles,
		"eval-admitted-effect",
		"eval/executor/caller-admitted-effect",
		"rootEvalCallerAdmittedEffectGate",
	);
	const callerToolEffects = admittedEffectsByKind(
		toolEffectLifecycles,
		"eval-admitted-tool-effect",
		"eval/executor/caller-admitted-tool-effect",
		"rootEvalCallerAdmittedToolEffectGate",
	);
	const callerRetryEffects = admittedEffectsByKind(
		retryEffectLifecycles,
		"eval-admitted-retry-delay",
		"eval/executor/caller-admitted-retry-effect",
		"rootEvalCallerAdmittedRetryEffectGate",
	);
	const callerBillingEffects = admittedEffectsByKind(
		billingEffectLifecycles,
		"eval-admitted-billing-observation",
		"eval/executor/caller-admitted-billing-effect",
		"rootEvalCallerAdmittedBillingEffectGate",
	);

	type EvalMatchedEvidence = Readonly<{
		readonly kind: "eval-matched-evidence";
		readonly cleanupFacts: readonly EvalCleanupFact[];
		readonly providerReasons: Readonly<Record<string, EvalProviderOutcomeReason>>;
		readonly verifiedSourceReplicates: readonly number[];
		readonly sourceTechnicalExclusions: readonly EvalSourceTechnicalExclusionFact[];
	}>;
	const matchedEvidenceEvents = owner.initNode(
		merge<unknown>(),
		[
			cleanup,
			allProviderResultAdmissions,
			sourceMemoryHandoff.status,
			sourceRequestAuthority,
			start,
		],
		{ name: "eval/findings/matched-evidence-events" },
	);
	const matchedEvidence = owner.node<EvalMatchedEvidence>(
		[matchedEvidenceEvents],
		(ctx) => {
			const state = ctx.state.get<{
				cleanup: Map<string, EvalCleanupFact>;
				providerReasons: Map<string, EvalProviderOutcomeReason>;
				verifiedSources: Set<number>;
				sourceTechnicalExclusions: Map<number, EvalSourceTechnicalExclusionFact>;
				requests: Map<string, EvalSourceWorkItemRequest>;
				pendingStatuses: Map<string, AdmissionHandoffStatus>;
			}>() ?? {
				cleanup: new Map<string, EvalCleanupFact>(),
				providerReasons: new Map<string, EvalProviderOutcomeReason>(),
				verifiedSources: new Set<number>(),
				sourceTechnicalExclusions: new Map<number, EvalSourceTechnicalExclusionFact>(),
				requests: new Map<string, EvalSourceWorkItemRequest>(),
				pendingStatuses: new Map<string, AdmissionHandoffStatus>(),
			};

			const events = depBatch(ctx, 0) ?? [];
			let changed = false;
			for (const raw of events) {
				if (Array.isArray(raw)) {
					for (const request of raw as readonly EvalSourceWorkItemRequest[])
						state.requests.set(request.sourceWorkItemId, request);
					continue;
				}
				const event = raw as { kind: string };
				if (event.kind === "eval-campaign-start") changed = true;
				else if (event.kind === "eval-cleanup-complete") {
					const fact = raw as EvalCleanupFact;
					const previous = state.cleanup.get(fact.workItemId);
					if (
						previous !== undefined &&
						empiricalStrictJsonDigest(previous) !== empiricalStrictJsonDigest(fact)
					)
						throw new TypeError("matched cleanup replay conflicted");
					state.cleanup.set(fact.workItemId, fact);
					changed = true;
				} else if (event.kind === "eval-provider-outcome") {
					const outcome = raw as EvalProviderOutcome;
					state.providerReasons.set(outcome.workItemId, outcome.reason);
					changed = true;
				} else if (event.kind === "admission-handoff-status") {
					const status = raw as AdmissionHandoffStatus;
					if (
						(status.state === "accepted" || status.state === "rejected") &&
						status.candidateId !== undefined
					)
						state.pendingStatuses.set(status.candidateId, status);
				} else throw new TypeError("matched evidence received an unknown event");
			}
			if (
				state.requests.size > replicateCount ||
				state.pendingStatuses.size > replicateCount ||
				state.cleanup.size > replicateCount * HARNESS_ARMS.length
			)
				throw new TypeError("matched evidence exceeded its campaign bound");
			for (const [candidateId, status] of state.pendingStatuses) {
				const request = state.requests.get(candidateId);
				if (request === undefined || !state.providerReasons.has(candidateId)) continue;
				if (status.state === "accepted") state.verifiedSources.add(request.replicate);
				else {
					const reason = state.providerReasons.get(request.sourceWorkItemId);
					if (reason === undefined || !TECHNICAL_FAILURE_REASONS.has(reason))
						throw new TypeError("matched evidence source rejection lacked a technical outcome");
					state.sourceTechnicalExclusions.set(
						request.replicate,
						Object.freeze({
							kind: "eval-source-work-item-technical-exclusion" as const,
							request,
							sourceWorkItemId: request.sourceWorkItemId,
							replicate: request.replicate,
							reason: reason as EvalTechnicalFailureReason,
							providerEffectSettled: true as const,
						}),
					);
				}
				changed = true;
				state.pendingStatuses.delete(candidateId);
			}
			ctx.state.set(state);
			if (changed)
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-matched-evidence" as const,
							cleanupFacts: Object.freeze([...state.cleanup.values()]),
							providerReasons: Object.freeze(Object.fromEntries(state.providerReasons)),
							verifiedSourceReplicates: Object.freeze([...state.verifiedSources].sort()),
							sourceTechnicalExclusions: Object.freeze(
								[...state.sourceTechnicalExclusions.values()].sort(
									(left, right) => left.replicate - right.replicate,
								),
							),
						}),
					],
				]);
		},
		{
			name: "eval/findings/matched-source-target-evidence",
			factory: "rootEvalMatchedSourceTargetEvidence",
			meta: { materialFree: true, domainAuthority: "graph-state" },
		},
	);
	type EvalEfficacyState = Readonly<{
		readonly kind: "eval-efficacy-state";
		readonly diagnostics: EvalVerificationDiagnostics;
		readonly budget: EvalBudgetState;
		readonly campaignState: EvalCampaignState;
		readonly finding: EvalFinding | null;
	}>;
	const efficacyStates = owner.node<EvalEfficacyState>(
		[verificationDiagnostics, budgets, campaignStates, billingFacts],
		(ctx) => {
			const diagnostics = depLatest(ctx, 0) as EvalVerificationDiagnostics | undefined;
			const budget = depLatest(ctx, 1) as EvalBudgetState | undefined;
			const campaignState = depLatest(ctx, 2) as EvalCampaignState | undefined;
			const billingFact = depLatest(ctx, 3) as BillingFact | undefined;
			if (
				diagnostics === undefined ||
				budget === undefined ||
				campaignState === undefined ||
				billingFact === undefined
			)
				return;
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-efficacy-state" as const,
						diagnostics,
						budget,
						campaignState,
						finding: null,
					}),
				],
			]);
		},
		{
			name: "eval/findings/efficacy-state",
			factory: "rootEvalEfficacyState",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				semanticAuthority: "verification-diagnostics-stage-counts",
				billingAuditAffectsConclusion: false,
			},
		},
	);
	const findingsCandidate = owner.node<EvalFinding>(
		[efficacyStates, billingReconciliation, effectActivity, matchedEvidence],
		(ctx) => {
			const efficacyState = depLatest(ctx, 0) as EvalEfficacyState | undefined;
			const billing = depLatest(ctx, 1) as EvalBillingReconciliation | undefined;
			const activity = depLatest(ctx, 2) as EvalEffectActivitySnapshot | undefined;
			const evidence = depLatest(ctx, 3) as EvalMatchedEvidence | undefined;
			if (
				efficacyState === undefined ||
				billing === undefined ||
				activity === undefined ||
				evidence === undefined
			)
				return;
			const { diagnostics, budget, campaignState } = efficacyState;
			const sourceTechnicalExcludedReplicates = campaignState.sourceTechnicalExcludedReplicates;
			const executedTargetReplicates = replicateCount - sourceTechnicalExcludedReplicates.length;
			if (
				diagnostics.completedWorkItems !== executedTargetReplicates * HARNESS_ARMS.length ||
				budget.activeEffects !== 0 ||
				activity.activeAdmittedEffects !== 0 ||
				activity.budgetDigest !== empiricalStrictJsonDigest(budget)
			)
				return;
			if (
				evidence.cleanupFacts.length !== executedTargetReplicates * HARNESS_ARMS.length ||
				evidence.verifiedSourceReplicates.length + evidence.sourceTechnicalExclusions.length !==
					replicateCount
			)
				return;
			const excludedTechnicalReplicates = Object.freeze(
				Array.from(
					new Set([
						...sourceTechnicalExcludedReplicates,
						...Array.from({ length: replicateCount }, (_, index) => index + 1).filter((replicate) =>
							evidence.cleanupFacts.some(
								(fact) =>
									fact.replicate === replicate &&
									TECHNICAL_FAILURE_REASONS.has(evidence.providerReasons[fact.workItemId]!),
							),
						),
					]),
				).sort((left, right) => left - right),
			);
			const excluded = new Set(excludedTechnicalReplicates);
			const evaluableFacts = evidence.cleanupFacts.filter((fact) => !excluded.has(fact.replicate));
			const evaluableReplicates = replicateCount - excluded.size;
			const passCounts = Object.fromEntries(
				HARNESS_ARMS.map((arm) => [
					arm,
					evaluableFacts.filter((fact) => fact.arm === arm && fact.passed).length,
				]),
			) as Record<HarnessArm, number>;
			const matchedRelevantOverColdWins = Array.from(
				{ length: replicateCount },
				(_, index) => index + 1,
			).filter((replicate) => {
				if (excluded.has(replicate)) return false;
				const relevant = evaluableFacts.find(
					(fact) => fact.replicate === replicate && fact.arm === "relevant-applied",
				);
				const cold = evaluableFacts.find(
					(fact) => fact.replicate === replicate && fact.arm === "cold",
				);
				return relevant?.passed === true && cold?.passed === false;
			}).length;
			const controlMaximum = Math.max(
				...HARNESS_ARMS.filter((arm) => arm !== "relevant-applied").map((arm) => passCounts[arm]),
			);
			const allCleanupSettled = evidence.cleanupFacts.every((fact) => fact.cleanupCompleted);
			const positiveDifferential =
				allCleanupSettled &&
				evaluableReplicates >= 4 &&
				passCounts["relevant-applied"] >= 3 &&
				passCounts["relevant-applied"] - controlMaximum >= 2 &&
				matchedRelevantOverColdWins >= 3;
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-efficacy-finding" as const,
						campaignRef,
						replicateCount,
						armOrder: HARNESS_ARMS,
						passCounts: Object.freeze(passCounts),
						evaluableReplicates,
						excludedTechnicalReplicates,
						sourceTechnicalExcludedReplicates,
						matchedRelevantOverColdWins,
						verificationDiagnostics: diagnostics,
						completedWorkItems: diagnostics.completedWorkItems,
						admittedAttempts: budget.admittedAttempts,
						providerCallCount: budget.providerCallCount,
						activeReservedMicrousd: budget.activeReservedMicrousd,
						providerReportedMicrousd: budget.providerReportedMicrousd,
						pricingRoundingAllowanceMicrousd: billing.pricingRoundingAllowanceMicrousd,
						providerReportedLowerBoundMicrousd: billing.providerReportedLowerBoundMicrousd,
						unreportedSettledUpperBoundMicrousd: budget.unreportedSettledUpperBoundMicrousd,
						accountedUpperBoundMicrousd: budget.accountedUpperBoundMicrousd,
						observedBilledMicrousd: billing.observedBilledMicrousd,
						billingObservationCount: billing.observationCount,
						billingStableIntervals: billing.stableIntervals,
						reconciledBilledMicrousd: billing.reconciledBilledMicrousd ?? 0,
						billingDisposition: billing.status,
						providerOutcomeReasonCounts: budget.providerOutcomeReasonCounts,
						finding:
							evaluableReplicates < 4
								? ("operationally-inconclusive" as const)
								: positiveDifferential
									? ("positive-differential" as const)
									: ("no-positive-differential" as const),
						stoppingReason: "campaign-complete" as const,
					}),
				],
			]);
		},
		{
			name: "eval/findings/efficacy/candidate",
			factory: "rootEvalEfficacyFindingCandidate",
			meta: {
				billingAuditAffectsConclusion: false,
				semanticAuthority: "verification-diagnostics-stage-counts",
			},
		},
	);

	const findingsBoundary = rootEvalQuietDataBoundary<EvalFinding>(owner, findingsCandidate, {
		name: "eval/findings/efficacy",
		factory: "rootEvalEfficacyFinding",
		maxOccurrences: 1,
		key: (value) => value.campaignRef,
		meta: {
			materialFree: true,
			completeDomainOccurrence: true,
			billingAuditAffectsConclusion: false,
			semanticAuthority: "verification-diagnostics-stage-counts",
		},
	});
	const findings = findingsBoundary.output;
	boundaryReleases.push(findingsBoundary.release);

	const developmentQualificationEvents = owner.initNode(
		merge<unknown>(),
		[campaignContract, findings],
		{ name: "eval/development/qualification-events" },
	);
	const developmentQualification = owner.node<EvalDevelopmentQualificationState>(
		[developmentQualificationEvents],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if ((raw as { kind: string }).kind !== "eval-campaign-contract") continue;
				const contract = raw as EvalCampaignContract;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-development-qualification-state" as const,
							campaignPurpose: contract.campaignPurpose,
							generationRef: contract.generationRef,
							status:
								contract.campaignPurpose === "development"
									? ("pending" as const)
									: ("not-applicable" as const),
							generationQualified: null,
							consecutiveQualifyingGenerations: contract.developmentQualificationStreakBefore,
							requiredConsecutiveGenerations: 2 as const,
							heldOutEligible:
								contract.campaignPurpose === "confirmatory" &&
								contract.developmentQualificationStreakBefore === 2,
						}),
					],
				]);
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				if ((raw as { kind: string }).kind !== "eval-efficacy-finding") continue;
				if (campaignPurpose !== "development") continue;
				const finding = raw as EvalFinding;
				const relevant = finding.verificationDiagnostics.stageCounts["relevant-applied"];
				const executedTargetReplicates =
					replicateCount - finding.sourceTechnicalExcludedReplicates.length;
				const generationQualified =
					finding.completedWorkItems === executedTargetReplicates * HARNESS_ARMS.length &&
					HARNESS_ARMS.every(
						(arm) =>
							finding.verificationDiagnostics.stageCounts[arm].cleanupCompleted ===
							executedTargetReplicates,
					) &&
					relevant.publicSemanticPassed >= 3 &&
					relevant.hiddenVerifierPassed >= 3 &&
					finding.finding === "positive-differential";
				const consecutiveQualifyingGenerations = generationQualified
					? Math.min(2, developmentQualificationStreakBefore + 1)
					: 0;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-development-qualification-state" as const,
							campaignPurpose,
							generationRef,
							status: generationQualified ? ("qualified" as const) : ("reset" as const),
							generationQualified,
							consecutiveQualifyingGenerations,
							requiredConsecutiveGenerations: 2 as const,
							heldOutEligible: consecutiveQualifyingGenerations === 2,
						}),
					],
				]);
			}
		},
		{
			name: "eval/development/qualification",
			factory: "rootEvalDevelopmentQualification",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				materialFree: true,
				authority: "d152-mechanism-two-consecutive-development-generations-under-d145-threshold",
				requiredConsecutiveGenerations: 2,
			},
		},
	);

	const progressTerminalEvents = owner.initNode(
		merge<unknown>(),
		[progressAdmissionLease, providerAdmissions, findings, budgets],
		{ name: "eval/time/progress-terminal-events" },
	);
	const progressLease = owner.node<EvalProgressLeaseState>(
		[progressTerminalEvents],
		(ctx) => {
			const state = ctx.state.get<{
				current?: EvalProgressLeaseState;
				revision: number;
				seen: Set<string>;
				terminal: boolean;
			}>() ?? { revision: 0, seen: new Set<string>(), terminal: false };
			const emit = (value: EvalProgressLeaseState) => {
				assertProgressLeaseRuntimeShape(value, "progress lease");
				ctx.down([["DATA", value]]);
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as { readonly kind?: string };
				const eventDigest = empiricalStrictJsonDigest(withoutUndefined(raw));
				if (state.seen.has(eventDigest)) {
					if (state.current === undefined)
						throw new TypeError("progress projection replay preceded Graph progress state");
					emit(state.current);
					continue;
				}
				if (state.seen.size >= rootEvalMaximumObservationOccurrences(replicateCount))
					throw new TypeError("progress projection retention exceeded its finite bound");
				state.seen.add(eventDigest);
				if (state.terminal) {
					if (state.current === undefined)
						throw new TypeError("terminal progress projection lost its Graph state");
					emit(state.current);
					continue;
				}
				if (event.kind === "eval-progress-lease-state") {
					const progress = raw as EvalProgressLeaseState;
					state.revision += 1;
					const value = Object.freeze({ ...progress, revision: state.revision });
					state.current = value;
					state.terminal = value.state === "stalled";
					emit(value);
					continue;
				}
				if (event.kind === "eval-admitted-effect") {
					const admission = raw as EvalAdmittedEffect;
					state.revision += 1;
					const value = Object.freeze({
						kind: "eval-progress-lease-state" as const,
						campaignRef,
						revision: state.revision,
						occurrenceDigest: eventDigest,
						nextExpectedOccurrence: `provider-outcome:${empiricalStrictJsonDigest(
							admission.admissionId,
						)}`,
						leaseMs: admission.timeoutMs,
						deadlineOffsetMs: admission.timeoutMs,
						maximumFinitePathMs: scheduleFeasibilityValue.maximumFinitePathMs,
						state: "active" as const,
						stoppingReason: "none" as const,
					});
					state.current = value;
					emit(value);
					continue;
				}
				if (
					event.kind === "eval-budget-state" &&
					(raw as EvalBudgetState).stoppingReason === "none"
				)
					continue;
				const current = state.current;
				if (current === undefined)
					throw new TypeError("progress terminal event preceded Graph progress authority");
				let nextExpectedOccurrence: string;
				let lifecycleState: EvalProgressLeaseState["state"];
				let stoppingReason: EvalProgressLeaseState["stoppingReason"];
				if (event.kind === "eval-efficacy-finding") {
					nextExpectedOccurrence = "campaign-complete";
					lifecycleState = "complete";
					stoppingReason = "campaign-complete";
				} else if (
					event.kind === "eval-budget-state" &&
					(raw as EvalBudgetState).stoppingReason === "budget-exhausted"
				) {
					nextExpectedOccurrence = "campaign-budget-stop";
					lifecycleState = "stopped";
					stoppingReason = "budget-exhausted";
				} else continue;
				const value = Object.freeze({
					kind: "eval-progress-lease-state" as const,
					campaignRef,
					revision: state.revision + 1,
					occurrenceDigest: eventDigest,
					nextExpectedOccurrence,
					leaseMs: 0,
					deadlineOffsetMs: 0,
					maximumFinitePathMs: scheduleFeasibilityValue.maximumFinitePathMs,
					state: lifecycleState,
					stoppingReason,
				});
				state.revision += 1;
				state.current = value;
				state.terminal = true;
				emit(value);
			}
			ctx.state.set(state);
		},
		{
			name: "eval/time/progress-lease",
			factory: "rootEvalOccurrenceAwareProgressProjection",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				materialFree: true,
				authority: "graph-occurrence-progress-terminal-projection",
				legalCooldownExtendsDeadline: true,
				staleRevisionMayStopOrRelease: false,
				callerStoppingAuthority: "none",
				decisionRef: "graphrefly-ts:D158",
			},
		},
	);

	type ObservationInputs = {
		context: EvalSourceStageObservationContext;
		admission: EvalProviderAdmissionObservationCut;
		activity: EvalEffectActivitySnapshot;
		campaign: EvalCampaignState;
		diagnostics: EvalVerificationDiagnostics;
		qualification: EvalDevelopmentQualificationState;
		finding: EvalFinding;
		feasibility: EvalScheduleFeasibility;
		progress: EvalProgressLeaseState;
	};
	type ObservationInputKey = keyof ObservationInputs;
	type ObservationArrival = {
		[K in ObservationInputKey]: Readonly<{
			source: K;
			revision: number;
			digest: string;
			value: ObservationInputs[K];
		}>;
	}[ObservationInputKey];
	const observationSources: { [K in ObservationInputKey]: Node<ObservationInputs[K]> } = {
		context: sourceStageObservationContext,
		admission: providerAdmissionObservationCuts,
		activity: effectActivity,
		campaign: campaignStates,
		diagnostics: verificationDiagnostics,
		qualification: developmentQualification,
		finding: findings,
		feasibility: scheduleFeasibility,
		progress: progressLease,
	};
	const observationBound = rootEvalMaximumObservationOccurrences(replicateCount);
	const observationArrivals = owner.initNode(
		merge<readonly ObservationArrival[]>(),
		Object.entries(observationSources).map(([source, input]) =>
			owner.node<readonly ObservationArrival[]>(
				[input],
				(ctx) => {
					const prior = ctx.state.get<{ revision: number; seen: Set<string> }>() ?? {
						revision: 0,
						seen: new Set<string>(),
					};
					const batch: ObservationArrival[] = [];
					for (const value of depBatch(ctx, 0) ?? []) {
						const digest = empiricalStrictJsonDigest(value);
						if (prior.seen.has(digest)) continue;
						if (prior.seen.size >= observationBound)
							throw new TypeError("observation input retention bound exceeded");
						prior.seen.add(digest);
						prior.revision += 1;
						batch.push(
							Object.freeze({
								source,
								revision: prior.revision,
								digest,
								value,
							}) as ObservationArrival,
						);
					}
					ctx.state.set(prior);
					if (batch.length > 0) ctx.down([["DATA", Object.freeze(batch)]]);
				},
				{
					name: `eval/observation/input/${source}`,
					factory: "rootEvalObservationOccurrenceInput",
					meta: { materialFree: true, source, correlation: "source-local-revision/content-digest" },
				},
			),
		),
		{
			name: "eval/observation/arrivals",
			meta: {
				materialFree: true,
				delivery: "direct-typed-occurrence-fan-in",
				startupOrderAuthority: "none",
			},
		},
	);
	interface CanonicalObservationState {
		streams: Map<ObservationInputKey, { revision: number; receipts: Map<number, string> }>;
		context?: EvalSourceStageObservationContext;
		admission?: EvalProviderAdmissionObservationCut;
		admissionRevisions: Map<number, string>;
		activityRevisions: Map<number, string>;
		activities: Map<string, EvalEffectActivitySnapshot>;
		campaigns: Map<string, EvalCampaignState>;
		diagnostics: Map<number, EvalVerificationDiagnostics>;
		campaign?: EvalCampaignState;
		qualification?: EvalDevelopmentQualificationState;
		finding?: EvalFinding;
		feasibility?: EvalScheduleFeasibility;
		progress?: EvalProgressLeaseState;
		previous?: EvalObservation;
		digest?: string;
		revision: number;
		failed: boolean;
		terminal: boolean;
	}
	const observationOccurrences = owner.node<
		SolutionOccurrence<EvalObservation> | EvalObservationRejection
	>(
		[observationArrivals],
		(ctx) => {
			const state: CanonicalObservationState = ctx.state.get<CanonicalObservationState>() ?? {
				streams: new Map(),
				activities: new Map(),
				campaigns: new Map(),
				diagnostics: new Map(),
				admissionRevisions: new Map(),
				activityRevisions: new Map(),
				revision: 0,
				failed: false,
				terminal: false,
			};
			if (state.failed) return;
			const outputs: (SolutionOccurrence<EvalObservation> | EvalObservationRejection)[] = [];
			const publish = (
				campaignState: EvalCampaignState,
				diagnostics: EvalVerificationDiagnostics,
				terminal: boolean,
			) => {
				const context = state.context!;
				const { budget, capacity } = state.admission!;
				const activity = state.activities.get(empiricalStrictJsonDigest(budget))!;
				const {
					activeProviderEffects,
					activeToolEffects,
					activeRetryEffects,
					activeBillingEffects,
					activeAdmittedEffects,
				} = activity;
				const finding = state.finding;
				const stopped =
					!terminal &&
					budget.stoppingReason !== "none" &&
					state.progress?.state !== "active" &&
					(budget.stoppingReason === "progress-stalled" || capacity.rejectedProposalCount > 0) &&
					capacity.pendingProposalCount === 0 &&
					(budget.stoppingReason === "progress-stalled" ||
						campaignState.stoppingReason !== "campaign-complete") &&
					(campaignState.stoppingReason !== "campaign-complete" ||
						(state.finding !== undefined &&
							state.qualification !== undefined &&
							(campaignPurpose !== "development" || state.qualification.status !== "pending"))) &&
					activeAdmittedEffects === 0 &&
					budget.activeReservedMicrousd === 0 &&
					activity.cleanupComplete &&
					activity.pendingToolAdmissions === 0 &&
					activity.completedTargetWorkItems === diagnostics.completedWorkItems &&
					state.campaigns.size <= 1;
				const provenance = context.memoryProvenance;
				const contract = context.campaignContract;
				const qualification: EvalDevelopmentQualificationState = terminal
					? state.qualification!
					: Object.freeze({
							kind: "eval-development-qualification-state",
							campaignPurpose: contract.campaignPurpose,
							generationRef: contract.generationRef,
							status: contract.campaignPurpose === "development" ? "pending" : "not-applicable",
							generationQualified: null,
							consecutiveQualifyingGenerations: contract.developmentQualificationStreakBefore,
							requiredConsecutiveGenerations: 2,
							heldOutEligible:
								contract.campaignPurpose === "confirmatory" &&
								contract.developmentQualificationStreakBefore === 2,
						});
				const terminalDiagnostics = terminal ? finding!.verificationDiagnostics : diagnostics;
				const feasibility = state.feasibility!;
				const progress = state.progress!;
				const stoppingReason = terminal ? finding!.stoppingReason : budget.stoppingReason;
				const value = strictSnapshot({
					kind: "eval-observation" as const,
					topologyRevision: ROOT_EVAL_TOPOLOGY_REVISION,
					executionGrantDigest: contract.executionGrantDigest,
					solutionIdentities: ROOT_EVAL_SOLUTION_IDENTITIES,
					campaignRef,
					campaignPurpose: campaignState.campaignPurpose,
					taskSetRef: campaignState.taskSetRef,
					generationRef: campaignState.generationRef,
					replicate: campaignState.replicate,
					replicateCount: campaignState.replicateCount,
					heldOutSealDigest: campaignState.heldOutSealDigest,
					budgetPartition: campaignState.budgetPartition,
					partitionHardCapMicrousd: campaignState.partitionHardCapMicrousd,
					partitionSpentBeforeMicrousd: campaignState.partitionSpentBeforeMicrousd,
					partitionLedgerDigest: campaignState.partitionLedgerDigest,
					developmentQualification: qualification,
					armOrder: HARNESS_ARMS,
					memoryProvenance: provenance,
					evaluableReplicates: terminal ? finding!.evaluableReplicates : null,
					excludedTechnicalReplicates: terminal
						? finding!.excludedTechnicalReplicates
						: campaignState.sourceTechnicalExcludedReplicates,
					sourceTechnicalExcludedReplicates: campaignState.sourceTechnicalExcludedReplicates,
					matchedRelevantOverColdWins: terminal ? finding!.matchedRelevantOverColdWins : null,
					completedArms: campaignState.completedArms,
					verificationDiagnostics: terminalDiagnostics,
					activeProviderEffects,
					activeToolEffects,
					activeRetryEffects,
					activeBillingEffects,
					activeAdmittedEffects,
					providerCapacity: capacity,
					scheduleFeasibility: feasibility,
					progressLease: progress,
					admittedAttempts: terminal ? finding!.admittedAttempts : budget.admittedAttempts,
					admittedRetryAttempts: budget.admittedRetryAttempts,
					retryProposalCount: budget.retryProposalCount,
					pendingRetryProposalCount: budget.pendingRetryProposalCount,
					rejectedRetryProposalCount: budget.rejectedRetryProposalCount,
					settledRetryAttemptCount: budget.settledRetryAttemptCount,
					providerCallCount: terminal ? finding!.providerCallCount : budget.providerCallCount,
					activeReservedMicrousd: terminal
						? finding!.activeReservedMicrousd
						: budget.activeReservedMicrousd,
					providerReportedMicrousd: terminal
						? finding!.providerReportedMicrousd
						: budget.providerReportedMicrousd,
					pricingRoundingAllowanceMicrousd: terminal
						? finding!.pricingRoundingAllowanceMicrousd
						: budget.pricingRoundingAllowanceMicrousd,
					providerReportedLowerBoundMicrousd: terminal
						? finding!.providerReportedLowerBoundMicrousd
						: Math.max(
								0,
								budget.providerReportedMicrousd - budget.pricingRoundingAllowanceMicrousd,
							),
					unreportedSettledUpperBoundMicrousd: terminal
						? finding!.unreportedSettledUpperBoundMicrousd
						: budget.unreportedSettledUpperBoundMicrousd,
					accountedUpperBoundMicrousd: terminal
						? finding!.accountedUpperBoundMicrousd
						: budget.accountedUpperBoundMicrousd,
					observedBilledMicrousd: terminal ? finding!.observedBilledMicrousd : null,
					billingObservationCount: terminal ? finding!.billingObservationCount : 0,
					billingStableIntervals: terminal ? finding!.billingStableIntervals : 0,
					reconciledBilledMicrousd: terminal ? finding!.reconciledBilledMicrousd : null,
					billingDisposition: terminal ? finding!.billingDisposition : ("pending" as const),
					providerOutcomeReasonCounts: terminal
						? finding!.providerOutcomeReasonCounts
						: budget.providerOutcomeReasonCounts,
					stoppingReason,
					finding: terminal
						? finding!.finding
						: stopped
							? ("not-evaluated" as const)
							: ("pending" as const),
				});
				const digest = empiricalStrictJsonDigest(value);
				if (state.digest === digest) return;
				if (state.terminal) throw new TypeError("observation changed after terminal");
				assertRootEvalObservationRuntimeShape(value, "canonical observation");
				if (state.previous !== undefined)
					assertRootEvalObservationTransition(state.previous, value, "canonical observation");
				if (terminal) assertRootEvalFindingTerminalConsistency(finding!, value);
				state.revision += 1;
				if (state.revision > observationBound) throw new TypeError("observation bound exceeded");
				state.digest = digest;
				state.previous = value;
				state.terminal = terminal || stopped;
				outputs.push(
					Object.freeze({
						occurrenceId: `${campaignRef}/observation`,
						occurrenceRevision: state.revision,
						occurrenceDigest: digest,
						occurrenceSourceRefs: Object.freeze(
							[
								{ kind: "provider-admission-cut", id: String(state.admission!.revision) },
								{ kind: "budget", id: empiricalStrictJsonDigest(budget) },
								{ kind: "effect-activity", id: empiricalStrictJsonDigest(activity) },
								{ kind: "campaign-progress", id: empiricalStrictJsonDigest(campaignState) },
								{
									kind: "verification-progress",
									id: empiricalStrictJsonDigest(terminalDiagnostics),
								},
								...(terminal
									? [{ kind: "efficacy-finding", id: empiricalStrictJsonDigest(finding) }]
									: []),
							].map((ref) => Object.freeze(ref)),
						),
						value,
					}),
				);
			};
			const emitCoherent = () => {
				const cut = state.admission;
				if (!state.context || !cut || !state.feasibility || !state.progress) return;
				const activity = state.activities.get(empiricalStrictJsonDigest(cut.budget));
				if (
					!activity ||
					JSON.stringify(activity.activeProviderAdmissionIds) !==
						JSON.stringify(cut.activeProviderAdmissionIds) ||
					activity.activeRetryEffects !== cut.capacity.cooldownOutstandingReadinessCount
				)
					return;
				// Domain coordinates select the diagnostic snapshot. A newer wave never substitutes
				if (
					cut.budget.stoppingReason !== "none" &&
					activity.activeAdmittedEffects === 0 &&
					activity.pendingToolAdmissions === 0 &&
					!activity.cleanupComplete
				) {
					state.failed = true;
					outputs.push(
						Object.freeze({
							kind: "eval-observation-rejected",
							code: "campaign-cleanup-failed",
							campaignRef,
							acceptedRevision: state.revision,
						}),
					);
					return;
				}
				// for the missing coordinate. Every pending campaign occurrence is retained in order.
				const pending = [...state.campaigns.entries()].sort(
					([, a], [, b]) => a.replicate - b.replicate || a.completedArms - b.completedArms,
				);
				for (const [key, campaign] of pending) {
					const completed =
						(campaign.replicate -
							1 -
							campaign.sourceTechnicalExcludedReplicates.filter(
								(replicate) => replicate < campaign.replicate,
							).length) *
							HARNESS_ARMS.length +
						campaign.completedArms;
					const diagnostics = state.diagnostics.get(completed);
					if (!diagnostics) break;
					publish(campaign, diagnostics, false);
					state.campaign = campaign;
					state.campaigns.delete(key);
				}
				const campaign = state.campaign;
				if (!campaign) return;
				const completed =
					(campaign.replicate -
						1 -
						campaign.sourceTechnicalExcludedReplicates.filter(
							(replicate) => replicate < campaign.replicate,
						).length) *
						HARNESS_ARMS.length +
					campaign.completedArms;
				const diagnostics = state.diagnostics.get(completed);
				if (!diagnostics) return;
				const terminal =
					state.finding !== undefined &&
					state.campaigns.size === 0 &&
					state.finding.completedWorkItems === completed &&
					state.finding.admittedAttempts === cut.budget.admittedAttempts &&
					state.qualification !== undefined &&
					(campaignPurpose !== "development" || state.qualification.status !== "pending") &&
					state.progress?.state === "complete" &&
					activity.activeAdmittedEffects === 0;
				publish(campaign, diagnostics, terminal);
			};
			try {
				for (const batch of depBatch(ctx, 0) ?? [])
					for (const event of batch as readonly ObservationArrival[]) {
						if (event.digest !== empiricalStrictJsonDigest(event.value))
							throw new TypeError("observation source digest drift");
						const prior = state.streams.get(event.source);
						const receipt = prior?.receipts.get(event.revision);
						if (receipt !== undefined) {
							if (receipt !== event.digest)
								throw new TypeError("observation source replay conflict");
							continue;
						}
						const expectedRevision = (prior?.revision ?? 0) + 1;
						if (event.revision !== expectedRevision || event.revision > observationBound)
							throw new TypeError(
								`observation source revision drift (${event.source}: expected ${expectedRevision}, received ${event.revision})`,
							);
						const receipts = prior?.receipts ?? new Map<number, string>();
						receipts.set(event.revision, event.digest);
						state.streams.set(event.source, { revision: event.revision, receipts });
						switch (event.source) {
							case "context":
								if (state.context && empiricalStrictJsonDigest(state.context) !== event.digest)
									throw new TypeError("immutable observation context drift");
								state.context = event.value;
								break;
							case "admission": {
								assertEvalProviderAdmissionObservationCut(event.value);
								const known = state.admissionRevisions.get(event.value.revision);
								if (known !== undefined) {
									if (known !== event.digest)
										throw new TypeError("admission occurrence replay conflict");
									continue;
								}
								if (event.value.revision !== (state.admission?.revision ?? 0) + 1)
									throw new TypeError("admission occurrence revision drift");
								state.admissionRevisions.set(event.value.revision, event.digest);
								state.admission = event.value;
								break;
							}

							case "activity": {
								const known = state.activityRevisions.get(event.value.revision);
								if (known !== undefined) {
									if (known !== event.digest)
										throw new TypeError("activity occurrence replay conflict");
									continue;
								}
								if (event.value.revision !== state.activityRevisions.size + 1)
									throw new TypeError("activity occurrence revision drift");
								state.activityRevisions.set(event.value.revision, event.digest);
								state.activities.set(event.value.budgetDigest, event.value);
								break;
							}
							case "campaign":
								state.campaigns.set(empiricalStrictJsonDigest(event.value), event.value);
								break;
							case "diagnostics":
								state.diagnostics.set(event.value.completedWorkItems, event.value);
								break;
							case "qualification":
								state.qualification = event.value;
								break;
							case "finding":
								state.finding = event.value;
								break;
							case "feasibility":
								if (
									state.feasibility &&
									empiricalStrictJsonDigest(state.feasibility) !== event.digest
								)
									throw new TypeError("schedule feasibility drift");
								state.feasibility = event.value;
								break;
							case "progress":
								if (state.progress && event.value.revision !== state.progress.revision + 1)
									throw new TypeError("progress lease revision drift");
								state.progress = event.value;
								break;
						}
						if (
							state.activities.size > observationBound ||
							state.campaigns.size > replicateCount * (HARNESS_ARMS.length + 3) ||
							state.diagnostics.size > replicateCount * HARNESS_ARMS.length + 1
						)
							throw new TypeError("observation retention bound exceeded");
						emitCoherent();
					}
			} catch {
				// An invalid read-only view cannot interrupt the admitted outcome/budget wave.
				// Caller sees an explicit rejection and drains already-admitted work.
				state.failed = true;
				outputs.push(
					Object.freeze({
						kind: "eval-observation-rejected",
						code: "canonical-observation-invalid",
						campaignRef,
						acceptedRevision: state.revision,
					}),
				);
			}
			ctx.state.set(state);
			if (outputs.length > 0) ctx.down(outputs.map((value) => ["DATA", value]));
		},
		{
			name: "eval/observation/canonical-state",
			factory: "rootEvalCanonicalObservation",
			completeWhenDepsComplete: false,
			meta: {
				materialFree: true,
				authority: "read-only-exact-coherent-cut",
				correlation: "admission-budget-digest/provider-identities/campaign-completed-coordinate",
				retentionBound: observationBound,
				sanitizer: false,
			},
		},
	);
	const observationRejections = owner.node<EvalObservationRejection>(
		[observationOccurrences],
		(ctx) => {
			const rejected = (depBatch(ctx, 0) ?? []).filter(
				(raw) => "kind" in (raw as object),
			) as EvalObservationRejection[];
			if (rejected.length > 0) ctx.down(rejected.map((value) => ["DATA", value]));
		},
		{ name: "eval/observation/rejections", factory: "rootEvalObservationRejections" },
	);
	const observation = owner.node<EvalObservation>(
		[observationOccurrences],
		(ctx) => {
			const accepted = (depBatch(ctx, 0) ?? []).filter(
				(raw) => !("kind" in (raw as object)),
			) as SolutionOccurrence<EvalObservation>[];
			if (accepted.length > 0) ctx.down(accepted.map((value) => ["DATA", value.value]));
		},
		{
			name: "eval/observation",
			factory: "rootEvalGraphNativeObservation",
			completeWhenDepsComplete: false,
			meta: {
				materialFree: true,
				sanitizer: false,
				authority: "canonical-occurrence-value-projection",
			},
		},
	);
	const terminalLifecycleConsistency = owner.node<{
		readonly kind: "eval-terminal-lifecycle-consistency";
		readonly status: "pending" | "consistent";
		readonly budgetDigest: string | null;
	}>(
		[observationOccurrences],
		(ctx) => {
			const values = (depBatch(ctx, 0) ?? []).filter(
				(raw) => !("kind" in (raw as object)),
			) as SolutionOccurrence<EvalObservation>[];
			if (values.length > 0)
				ctx.down(
					values.map((occurrence) => [
						"DATA",
						Object.freeze({
							kind: "eval-terminal-lifecycle-consistency" as const,
							status:
								occurrence.value.finding === "pending"
									? ("pending" as const)
									: ("consistent" as const),
							budgetDigest:
								occurrence.value.finding === "pending"
									? null
									: occurrence.occurrenceSourceRefs.find((ref) => ref.kind === "budget")!.id,
						}),
					]),
				);
		},
		{
			name: "eval/observation/terminal-lifecycle-consistency",
			factory: "rootEvalTerminalLifecycleConsistency",
			meta: { materialFree: true, failClosed: true, authority: "validated-canonical-terminal-cut" },
		},
	);

	const campaignTerminal = owner.node<EvalCampaignTerminal>(
		[observationOccurrences],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if ("kind" in (raw as object)) continue;
				const occurrence = raw as SolutionOccurrence<EvalObservation>;
				const value = occurrence.value;
				if (value.finding === "pending" || value.activeAdmittedEffects !== 0) continue;
				const stopped = value.finding === "not-evaluated";
				if (
					HARNESS_ARMS.some(
						(arm) =>
							value.verificationDiagnostics.stageCounts[arm].cleanupCompleted !==
							value.verificationDiagnostics.stageCounts[arm].completedWorkItems,
					)
				)
					continue;
				const terminal: EvalCampaignTerminal = Object.freeze({
					kind: "eval-campaign-terminal",
					campaignRef,
					status: stopped ? "stopped" : "completed",
					stoppingReason: value.stoppingReason as EvalCampaignTerminal["stoppingReason"],
					finding: stopped ? null : (value.finding as EvalFinding["finding"]),
					observationDigest: occurrence.occurrenceDigest,
					budgetDigest: occurrence.occurrenceSourceRefs.find((ref) => ref.kind === "budget")!.id,
					activityDigest: occurrence.occurrenceSourceRefs.find(
						(ref) => ref.kind === "effect-activity",
					)!.id,
					observationRevision: occurrence.occurrenceRevision,
					completedTargetWorkItems: value.verificationDiagnostics.completedWorkItems,
					cleanupComplete: true,
				});
				const digest = empiricalStrictJsonDigest(terminal);
				const previous = ctx.state.get<string>();
				if (previous !== undefined) {
					if (previous !== digest)
						throw new TypeError("campaign terminal changed after settlement");
					continue;
				}
				ctx.state.set(digest);
				ctx.down([["DATA", terminal]]);
			}
		},
		{
			name: "eval/campaign/terminal",
			factory: "rootEvalCampaignTerminal",
			meta: {
				materialFree: true,
				authority: "coherent-graph-campaign-stop",
				stoppedEfficacy: "none",
				cleanupRequired: true,
			},
		},
	);

	// Keep every real solution branch active before the initial state propagates.
	const keepaliveStops = [
		admissionFacts.subscribe(() => undefined),
		campaignActiveEffects.subscribe(() => undefined),
		toolActiveEffects.subscribe(() => undefined),
		retryActiveEffects.subscribe(() => undefined),
		billingActiveEffects.subscribe(() => undefined),
		observation.subscribe(() => undefined),
		campaignTerminal.subscribe(() => undefined),
		findings.subscribe(() => undefined),
		observationRejections.subscribe(() => undefined),
	];
	let keepalivesReleased = false;
	const releaseKeepalives = () => {
		if (keepalivesReleased) return;
		keepalivesReleased = true;
		for (const stop of keepaliveStops) stop();
		for (const release of boundaryReleases) release();
		sourceMemoryHandoff.release();
		memoryBatchHandoff.release();
	};

	let topology: RootEvalTopology;
	topology = Object.freeze({
		graph: owner,
		campaignRef,
		campaignContract: campaignContractValue,
		inputs: Object.freeze({ start }),
		runAdmittedEffects: (
			executor: (effect: EvalExecutableEffect) => Promise<EvalExecutorOutcome>,
			options: Readonly<{ readonly signal?: AbortSignal }> = {},
		) =>
			runRootEvalWithOutcomeInput(
				topology,
				[callerAdmittedEffects, callerToolEffects, callerRetryEffects, callerBillingEffects],
				terminalProviderResultAdmissions,
				failedProviderResultAdmissions,
				retryableProviderResultAdmissions,
				providerOutcomeInput,
				sourceToolOutcomes,
				targetToolOutcomes,
				retryDelayOutcomes,
				billingObservationOutcomes,
				executor,
				options.signal,
				releaseKeepalives,
			),
		nodes: {
			campaignContract,
			currentProviderRoute,
			workItems,
			memoryProvenance,
			providerProposals: proposals,
			providerAdmissions,
			providerCapacity,
			scheduleFeasibility,
			progressAdmissionLease,
			progressLease,
			campaignActiveEffects,
			toolActiveEffects,
			retryActiveEffects,
			billingActiveEffects,
			providerActivity,
			toolActivity,
			retryActivity,
			billingActivity,
			effectActivity,
			executorEffects: callerAdmittedEffects,
			workItemResults: resultProjection,
			cleanup,
			verificationDiagnostics,
			budgets,
			billingObservationAdmissions,
			billingReconciliation,
			findings,
			campaignTerminal,
			developmentQualification,
			terminalLifecycleConsistency,
			observationRejections,
			observation,
		},
	});
	return topology;
}

export async function runRootEval(
	topology: RootEvalTopology,
	executor: (effect: EvalExecutableEffect) => Promise<EvalExecutorOutcome>,
	options: Readonly<{ readonly signal?: AbortSignal }> = {},
): Promise<RootEvalRunOutcome> {
	return topology.runAdmittedEffects(executor, options);
}

async function runRootEvalWithOutcomeInput(
	topology: RootEvalTopology,
	executionNodes: readonly Node<unknown>[],
	terminalProviderResultAdmissions: Node<EvalProviderOutcome>,
	failedProviderResultAdmissions: Node<EvalProviderOutcome>,
	retryableProviderResultAdmissions: Node<EvalProviderOutcome>,
	providerOutcomeInput: Node<EvalProviderOutcome>,
	sourceToolOutcomes: Node<EvalEffectOutcome>,
	targetToolOutcomes: Node<EvalEffectOutcome>,
	retryDelayOutcomes: Node<EvalRetryDelayOutcome>,
	billingObservationOutcomes: Node<EvalBillingObservationOutcome>,
	executor: (effect: EvalExecutableEffect) => Promise<EvalExecutorOutcome>,
	signal?: AbortSignal,
	releaseKeepalives: () => void = () => undefined,
): Promise<RootEvalRunOutcome> {
	const observationEvents: ObserveEvent[] = [];
	const executed = new Set<string>();
	const scheduled = new Set<string>();
	const inFlight = new Set<Promise<void>>();
	let activeProviderExecutions = 0;
	let peakConcurrentEffects = 0;
	let settled = false;
	let acceptingNewEffects = true;
	let pendingFailure: unknown | undefined;
	let graphTerminal: EvalCampaignTerminal | undefined;
	let latestObservation: EvalObservation | undefined;
	return new Promise<RootEvalRunOutcome>((resolve, reject) => {
		let finding: EvalFinding | undefined;
		let terminalObservation: EvalObservation | undefined;
		let stopEffects: () => void = () => undefined;
		let stopFinding: () => void = () => undefined;
		let stopObservation: () => void = () => undefined;
		let stopObservationRejections: () => void = () => undefined;
		let stopTerminal: () => void = () => undefined;
		let stopTerminalLifecycleConsistency: () => void = () => undefined;
		let stopTerminalProviderResultAdmission: () => void = () => undefined;
		let stopFailedProviderResultAdmission: () => void = () => undefined;
		let stopRetryableProviderResultAdmission: () => void = () => undefined;
		let stopAbortSignal: () => void = () => undefined;
		const stopSubscriptions = () => {
			stopEffects();
			stopFinding();
			stopObservation();
			stopObservationRejections();
			stopTerminal();
			stopTerminalLifecycleConsistency();
			stopTerminalProviderResultAdmission();
			stopFailedProviderResultAdmission();
			stopRetryableProviderResultAdmission();
			stopAbortSignal();
			releaseKeepalives();
		};
		const finishFailureAfterDrain = () => {
			if (settled || pendingFailure === undefined || inFlight.size !== 0) return;
			settled = true;
			stopSubscriptions();
			reject(pendingFailure);
		};
		const abort = (error: unknown) => {
			if (settled) return;
			pendingFailure ??= error;
			if (acceptingNewEffects) {
				acceptingNewEffects = false;
				stopEffects();
				stopEffects = () => undefined;
			}
			finishFailureAfterDrain();
		};
		const maybeFinishGraphStop = () => {
			if (
				!settled &&
				pendingFailure === undefined &&
				graphTerminal?.status === "stopped" &&
				latestObservation !== undefined &&
				empiricalStrictJsonDigest(latestObservation) === graphTerminal.observationDigest &&
				inFlight.size === 0
			) {
				settled = true;
				stopSubscriptions();
				resolve(
					Object.freeze({
						finding: null,
						terminal: graphTerminal,
						observations: Object.freeze([...observationEvents]),
						peakConcurrentEffects,
						executedAdmissionIds: Object.freeze([...executed].sort()),
					}),
				);
			}
		};
		const finish = (observation: EvalObservation) => {
			if (
				settled ||
				pendingFailure !== undefined ||
				finding === undefined ||
				observation.finding === "pending"
			)
				return;
			try {
				assertRootEvalFindingTerminalConsistency(finding, observation);
			} catch {
				// The observation dependency may deliver its terminal DATA before the
				// caller's independent finding subscriber receives that same wave. Wait
				// for the correlated finding instead of assembling two different cuts.
				return;
			}
			// A fully synchronous executor can publish the terminal Graph occurrence
			// from inside its own tracked Promise. Never await an in-flight set that
			// contains the current settlement Promise; retain the terminal candidate
			// and commit only after the normal deletion callback observes quiescence.
			if (inFlight.size !== 0) return;
			settled = true;
			stopSubscriptions();
			const result = Object.freeze({
				finding,
				observations: Object.freeze([...observationEvents]),
				peakConcurrentEffects,
				executedAdmissionIds: Object.freeze([...executed].sort()),
			});
			resolve(result);
		};
		stopObservationRejections = topology.nodes.observationRejections.subscribe((message) => {
			if (message[0] === "DATA")
				abort(
					new Error(
						`root eval canonical observation rejected: ${(message[1] as EvalObservationRejection).code}; admitted work drained`,
					),
				);
		});
		stopObservation = topology.graph.observe("eval/observation").subscribe((event) => {
			if (event.msg[0] === "ERROR") {
				abort(
					event.msg[1] instanceof Error
						? event.msg[1]
						: new Error("root eval observation Graph path failed"),
				);
				return;
			}
			const value = materialFreeObservationValue(event);
			if (value !== undefined) {
				// RootEvalRunResult is the durable-evidence projection, not a transcript of every
				// protocol envelope emitted by the observation node. Keep only Graph-native DATA
				// observations here; callers that need the raw START/DIRTY/DATA stream subscribe
				// directly to graph.observe().
				observationEvents.push(event);
				latestObservation = value;
				if (value.finding !== "pending") terminalObservation = value;
				finish(value);
				maybeFinishGraphStop();
			}
		});
		stopFinding = topology.nodes.findings.subscribe((message) => {
			if (settled) return;
			if (message[0] === "ERROR") {
				abort(
					message[1] instanceof Error
						? message[1]
						: new Error("root eval finding Graph path failed"),
				);
				return;
			}
			if (message[0] !== "DATA") return;
			finding = message[1] as EvalFinding;
			if (terminalObservation !== undefined) finish(terminalObservation);
		});
		stopTerminal = topology.nodes.campaignTerminal.subscribe((message) => {
			if (settled) return;
			if (message[0] === "ERROR") {
				abort(
					message[1] instanceof Error
						? message[1]
						: new Error("root eval budget Graph path failed"),
				);
				return;
			}
			if (message[0] !== "DATA") return;
			graphTerminal = message[1] as EvalCampaignTerminal;
			maybeFinishGraphStop();
		});
		stopTerminalLifecycleConsistency = topology.nodes.terminalLifecycleConsistency.subscribe(
			(message) => {
				if (message[0] !== "ERROR" || settled) return;
				abort(
					message[1] instanceof Error
						? message[1]
						: new Error("root eval terminal lifecycle consistency path failed"),
				);
			},
		);
		const abortProviderAdmissionError = (message: readonly unknown[]) => {
			if (message[0] !== "ERROR" || settled) return;
			abort(
				message[1] instanceof Error
					? message[1]
					: new Error("root eval provider result Graph admission failed"),
			);
		};
		stopTerminalProviderResultAdmission = terminalProviderResultAdmissions.subscribe(
			abortProviderAdmissionError,
		);
		stopFailedProviderResultAdmission = failedProviderResultAdmissions.subscribe(
			abortProviderAdmissionError,
		);
		stopRetryableProviderResultAdmission = retryableProviderResultAdmissions.subscribe(
			abortProviderAdmissionError,
		);
		const scheduleEffects = (effects: readonly EvalExecutableEffect[]) => {
			if (settled || !acceptingNewEffects) return;
			for (const effect of effects) {
				if (scheduled.has(effect.executionId)) continue;
				scheduled.add(effect.executionId);
				if (effect.kind === "eval-admitted-effect") {
					executed.add(effect.admissionId);
					activeProviderExecutions += 1;
					peakConcurrentEffects = Math.max(peakConcurrentEffects, activeProviderExecutions);
				}
				const execution = (async () => {
					let providerExecutionCounted = effect.kind === "eval-admitted-effect";
					try {
						// Mechanical caller cancellation checkpoint. This does not split a domain
						// occurrence: the admitted effect and all causal coordinates remain unchanged.
						await Promise.resolve();
						if (settled || !acceptingNewEffects) return;
						const outcome = await executor(effect);
						if (settled) return;
						try {
							if (effect.kind === "eval-admitted-effect") {
								const validated = Object.freeze(
									validateProviderOutcomeCandidate(outcome as EvalProviderOutcome),
								);
								if (validated.admission !== effect)
									throw new TypeError("provider outcome lost its admitted receipt identity");
								activeProviderExecutions -= 1;
								providerExecutionCounted = false;
								providerOutcomeInput.down([["DATA", validated]]);
							} else if (effect.kind === "eval-admitted-tool-effect") {
								const validated = Object.freeze(
									validateOutcomeReceipt(outcome as EvalEffectOutcome),
								);
								if (validated.admission !== effect)
									throw new TypeError("tool outcome lost its admitted receipt identity");
								if (validated.workItemRole === "source")
									sourceToolOutcomes.down([["DATA", validated]]);
								else targetToolOutcomes.down([["DATA", validated]]);
							} else if (effect.kind === "eval-admitted-retry-delay") {
								const validated = Object.freeze(
									validateRetryDelayOutcome(outcome as EvalRetryDelayOutcome),
								);
								if (validated.admission !== effect)
									throw new TypeError("retry delay outcome lost its admitted receipt identity");
								retryDelayOutcomes.down([["DATA", validated]]);
							} else {
								const validated = Object.freeze(
									validateBillingObservationOutcome(outcome as EvalBillingObservationOutcome),
								);
								if (validated.admission !== effect)
									throw new TypeError("billing observation lost its admitted receipt identity");
								billingObservationOutcomes.down([["DATA", validated]]);
							}
						} catch (error) {
							abort(error);
						}
					} catch (error: unknown) {
						if (settled) return;
						if (effect.kind === "eval-admitted-effect") {
							activeProviderExecutions -= 1;
							providerExecutionCounted = false;
							abort(error);
							return;
						}
						const resultDigest = empiricalStrictJsonDigest({
							kind: "executor-failure",
							executionId: effect.executionId,
							error: error instanceof Error ? error.message : String(error),
						});
						try {
							if (effect.kind === "eval-admitted-tool-effect") {
								(effect.workItemRole === "source" ? sourceToolOutcomes : targetToolOutcomes).down([
									[
										"DATA",
										Object.freeze({
											kind: "eval-effect-outcome" as const,
											admission: effect,
											executionId: effect.executionId,
											admissionId: effect.providerAdmission.admissionId,
											toolAdmissionId: effect.toolAdmissionId,
											operationId: effect.providerAdmission.operationId,
											argumentsDigest: effect.argumentsDigest,
											effectRunId: effect.effectRunId,
											workItemId: effect.workItemId,
											workItemRole: effect.workItemRole,
											replicate: effect.replicate,
											arm: effect.arm,
											providerLogicalAttempt: effect.providerLogicalAttempt,
											dispatchOrdinal: effect.dispatchOrdinal,
											capacityRetryOrdinal: effect.capacityRetryOrdinal,
											availabilityRetryOrdinal: effect.availabilityRetryOrdinal,
											status: "failed" as const,
											costMicrousd: 0 as const,
											elapsedMs: 0,
											resultDigest,
											evidence: Object.freeze({
												expectedDigest: resultDigest,
												actualDigest: resultDigest,
												diff: "no-change" as const,
												cleanupCompleted: false,
												publicSemantic: "different" as const,
												hiddenVerifier: "fail" as const,
											}),
										}),
									],
								]);
							} else if (effect.kind === "eval-admitted-retry-delay") abort(error);
							else
								billingObservationOutcomes.down([
									[
										"DATA",
										Object.freeze({
											kind: "eval-billing-observation-outcome" as const,
											admission: effect,
											executionId: effect.executionId,
											observation: effect.observation,
											status: "failed" as const,
											currentKeyAfter: null,
											resultDigest,
										}),
									],
								]);
						} catch (deliveryError) {
							abort(deliveryError);
						}
					} finally {
						if (providerExecutionCounted) activeProviderExecutions -= 1;
					}
				})();
				inFlight.add(execution);
				void execution.then(
					() => {
						inFlight.delete(execution);
						if (terminalObservation !== undefined) finish(terminalObservation);
						maybeFinishGraphStop();
						finishFailureAfterDrain();
					},
					() => {
						inFlight.delete(execution);
						if (terminalObservation !== undefined) finish(terminalObservation);
						maybeFinishGraphStop();
						finishFailureAfterDrain();
					},
				);
			}
		};
		const executionStops = executionNodes.map((node) =>
			(node as Node<EvalExecutableEffect>).subscribe((message) => {
				if (message[0] === "ERROR") {
					abort(
						message[1] instanceof Error
							? message[1]
							: new Error("root eval admitted-effect gate failed"),
					);
					return;
				}
				if (message[0] === "DATA") scheduleEffects([message[1] as EvalExecutableEffect]);
			}),
		);
		stopEffects = () => {
			for (const stop of executionStops) stop();
		};
		const onAbort = () =>
			abort(signal?.reason ?? new Error("root eval caller cancelled execution"));
		signal?.addEventListener("abort", onAbort, { once: true });
		stopAbortSignal = () => signal?.removeEventListener("abort", onAbort);
		if (signal?.aborted) {
			onAbort();
			return;
		}
		topology.inputs.start.down([
			[
				"DATA",
				Object.freeze({
					kind: "eval-campaign-start" as const,
					campaignRef: topology.campaignRef,
				}),
			],
		]);
	});
}

export async function persistRootEvalRunAtomically(
	store: RootEvalAtomicStore,
	result: RootEvalRunResult,
): Promise<RootEvalPersistenceRecord> {
	let previousSeq = -1;
	let previousObservationDigest: string | undefined;
	const observationValues = result.observations.map((event, index) => {
		const label = `root eval observations[${index}]`;
		const envelope = record(event, label);
		exactKeys(envelope, ["path", "msg", "tier", "seq"], label);
		literal(envelope.path, "eval/observation", `${label}.path`);
		literal(envelope.tier, 3, `${label}.tier`);
		const seq = safeInteger(envelope.seq, `${label}.seq`);
		if (seq <= previousSeq) throw new TypeError("root eval observation sequence drifted");
		previousSeq = seq;
		const message = array(envelope.msg, `${label}.msg`);
		if (message.length !== 2) throw new TypeError(`${label}.msg shape drifted`);
		literal(message[0], "DATA", `${label}.msg[0]`);
		const value = message[1] as EvalObservation;
		assertRootEvalObservationRuntimeShape(value, `${label}.msg[1]`);
		const digest = empiricalStrictJsonDigest(value);
		if (previousObservationDigest === digest)
			throw new TypeError(
				`root eval observation distinctness drifted at ${index - 1} and ${index}`,
			);
		previousObservationDigest = digest;
		return value;
	});
	assertRootEvalObservationSequence(observationValues, "root eval observation");
	const terminalObservations = observationValues.filter((value) => value.finding !== "pending");
	const terminal = terminalObservations[0];
	if (
		terminalObservations.length !== 1 ||
		terminal === undefined ||
		observationValues.at(-1) !== terminal
	)
		throw new Error("root eval persistence rejects a missing or non-final terminal observation");
	assertRootEvalFindingTerminalConsistency(result.finding, terminal);
	const executedTargetReplicateCount =
		result.finding.replicateCount - result.finding.sourceTechnicalExcludedReplicates.length;
	if (
		result.finding.stoppingReason !== "campaign-complete" ||
		result.finding.completedWorkItems !==
			executedTargetReplicateCount * result.finding.armOrder.length
	)
		throw new Error("root eval persistence fails closed before a complete finding");
	if (
		result.finding.replicateCount < 1 ||
		result.finding.replicateCount > ROOT_EVAL_REPLICATE_COUNT ||
		result.finding.armOrder.length !== HARNESS_ARMS.length ||
		!result.finding.armOrder.every((arm, index) => arm === HARNESS_ARMS[index]) ||
		result.executedAdmissionIds.length < executedTargetReplicateCount * HARNESS_ARMS.length ||
		new Set(result.executedAdmissionIds).size !== result.executedAdmissionIds.length
	)
		throw new Error("root eval persistence rejects structural or replay drift");
	const recordId = `${ROOT_EVAL_TOPOLOGY_REVISION}/${result.finding.campaignRef}`;
	const material = strictSnapshot({
		format: "graphrefly.rootEvalResult" as const,
		version: 1 as const,
		recordId,
		topologyRevision: ROOT_EVAL_TOPOLOGY_REVISION,
		finding: result.finding,
		executedAdmissionIds: [...result.executedAdmissionIds],
		peakConcurrentEffects: result.peakConcurrentEffects,
	});
	const persistenceRecord = strictSnapshot({
		...material,
		recordDigest: empiricalStrictJsonDigest(material as never),
	}) as RootEvalPersistenceRecord;
	const validateStored = (stored: RootEvalPersistenceRecord | undefined, reason: string) => {
		if (stored === undefined) throw new Error(reason);
		const { recordDigest, ...storedMaterial } = stored;
		if (
			empiricalStrictJsonDigest(storedMaterial) !== recordDigest ||
			recordDigest !== persistenceRecord.recordDigest
		)
			throw new Error(reason);
		return strictSnapshot(stored) as RootEvalPersistenceRecord;
	};
	const existing = await store.read(recordId);
	if (existing !== undefined) {
		return validateStored(
			existing,
			"root eval persistence detected state drift for the replay key",
		);
	}
	const status = await store.commitIfAbsent(recordId, persistenceRecord);
	if (status === "exists") {
		const raced = await store.read(recordId);
		return validateStored(raced, "root eval persistence detected an atomic commit race or drift");
	}
	return persistenceRecord;
}

export function materialFreeObservationValue(event: ObserveEvent): EvalObservation | undefined {
	return event.path === "eval/observation" && event.msg[0] === "DATA"
		? (event.msg[1] as EvalObservation)
		: undefined;
}

export function isStrictJsonValue(value: MemoryPayload): value is MemoryPayload & StrictJsonValue {
	return typeof value.bindingRef === "string" && typeof value.digest === "string";
}
