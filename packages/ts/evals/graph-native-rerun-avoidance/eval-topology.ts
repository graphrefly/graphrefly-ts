import { depBatch, depLatest } from "../../src/ctx/types.js";
import { combine } from "../../src/graph/combinators.js";
import { type Graph, graph } from "../../src/graph/graph.js";
import type { ObserveEvent } from "../../src/graph/inspect.js";
import type { Node } from "../../src/node/node.js";
import type { AgentRequestIssued, EffectRunResult } from "../../src/orchestration/agent-runtime.js";
import {
	type ScheduledReadinessClock,
	type ScheduledReadinessRequested,
	scheduledReadinessProjector,
} from "../../src/orchestration/scheduled-readiness.js";
import {
	type AdmissionHandoffCandidate,
	type AdmissionHandoffDecision,
	type AdmissionHandoffStatus,
	admissionHandoff,
} from "../../src/patterns/admission-handoff.js";
import {
	type AgenticMemoryRecord,
	type AgenticMemoryRecordAdmissionPolicy,
	type AgenticMemoryRecordApplicationPolicy,
	type AgenticMemoryRecordUseDecision,
	type AgenticMemoryRecordUseRequest,
	agenticMemoryBundle,
	agenticMemoryRecordAdmissionBundle,
	agenticMemoryRecordApplicationBundle,
	agenticMemoryRecordUseGateBundle,
	createAgenticMemoryRecordUseDecision,
	type StrictJsonValue,
} from "../../src/solutions/agentic-memory/index.js";
import type {
	AgenticWorkItemMemoryMappingPolicy,
	AgenticWorkItemMemoryRecordCandidate,
} from "../../src/solutions/agentic-work-item-memory/index.js";
import { agenticWorkItemMemoryApplicationRecipeBundle } from "../../src/solutions/agentic-work-item-memory-application/index.js";
import { workItemExecutionRecipe } from "../../src/solutions/work-item/execution.js";
import type {
	WorkItemEffectPlanProposed,
	WorkItemEffectPlanSnapshot,
	WorkItemProjection,
} from "../../src/solutions/work-item/scheduling.js";
import {
	array,
	coordinate,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import { HARNESS_ARMS, type HarnessArm } from "./harness-campaign-policy.js";
import { CURRENT_IMPLEMENTATION_MANIFEST_DIGEST } from "./implementation-manifest.js";
import {
	CURRENT_PROFILE_ELIGIBILITY_SCHEMA,
	type CurrentProfileEligibility,
	createDeepSeekV4Flash0731FireworksStructuredProfileDefinition,
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
	ROOT_EVAL_DEVELOPMENT_TASK_SET_DIGEST,
	ROOT_EVAL_DEVELOPMENT_TASKS,
	ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES,
	type RootEvalTaskBinding,
	rootEvalTaskBindings,
} from "./root-eval-task.js";

export const ROOT_EVAL_TOPOLOGY_REVISION = "graphrefly-ts.root-eval-topology.v13" as const;
export const ROOT_EVAL_REPLICATE_COUNT = 5 as const;
export const ROOT_EVAL_DEVELOPMENT_REPLICATE_COUNT = 5 as const;
export const ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS = 300_000 as const;
export const ROOT_EVAL_INITIAL_PROVIDER_CAPACITY = 2 as const;
export const ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY = 1 as const;
export const ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS = 4_500_000 as const;
export const ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS = 1_800_000 as const;
export const ROOT_EVAL_CALLER_SAFETY_LEASE_MS = 6_300_000 as const;
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
export type EvalBudgetPartition = "no-network" | "development-usd-6" | "confirmatory-usd-6";

export interface EvalCampaignContract {
	readonly kind: "eval-campaign-contract";
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
	"http-failed" | "transport-failed" | "response-route-invalid"
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
		| "elapsed-budget-exhausted"
		| "effect-failed";
}

export interface EvalElapsedBudgetState {
	readonly kind: "eval-elapsed-budget-state";
	readonly scheduleId: string;
	readonly limitMs: typeof ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS;
	readonly drainReserveMs: typeof ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS;
	readonly callerSafetyLeaseMs: typeof ROOT_EVAL_CALLER_SAFETY_LEASE_MS;
	readonly state: "armed" | "exhausted";
	readonly nowMs: 0 | typeof ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS;
	readonly stoppingReason: "none" | "elapsed-budget-exhausted";
}

interface EvalElapsedBudgetTimerTick {
	readonly kind: "eval-elapsed-budget-timer-tick";
	readonly campaignRef: string;
	readonly nowMs: typeof ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS;
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
	readonly attempt: 1 | 2;
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
	"http-failed",
	"http-429-retryable",
	"transport-failed",
	"transport-retryable",
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
	readonly attempt: 1 | 2;
	readonly status: "tool-proposed" | "failed" | "retryable";
	readonly reason: EvalProviderOutcomeReason;
	readonly dispatchAttempted: boolean;
	readonly costMicrousd: number;
	readonly costEvidence: "provider-reported" | "reservation-upper-bound";
	readonly pricingRoundingAllowanceMicrousd: number;
	readonly elapsedMs: number;
	readonly resultDigest: string;
	readonly retryAfterMs: number;
	readonly cleanupCompleted: boolean;
	readonly toolProposal: Readonly<{
		readonly toolRef: "graphrefly.eval.exact-tool.v1";
		readonly path: string;
		readonly oldText: string;
		readonly newText: string;
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
	readonly attempt: 1 | 2;
	readonly toolRef: "graphrefly.eval.exact-tool.v1";
	readonly path: string;
	readonly oldText: string;
	readonly newText: string;
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
	readonly attempt: 1;
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
	readonly attempt: 1 | 2;
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
	readonly stoppingReason: "none" | "budget-exhausted" | "elapsed-budget-exhausted";
}

export interface EvalProviderCapacityState {
	readonly kind: "eval-provider-capacity-state";
	readonly mode: "initial-parallel" | "cooldown" | "rate-limited-serial";
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
	readonly elapsedBudget: EvalElapsedBudgetState;
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
	readonly finding: EvalFinding["finding"] | "pending";
}

export interface EvalEffectActivitySnapshot {
	readonly kind: "eval-effect-activity-snapshot";
	readonly budgetDigest: string;
	readonly budget: EvalBudgetState;
	readonly activeProviderEffects: number;
	readonly activeToolEffects: number;
	readonly activeRetryEffects: number;
	readonly activeBillingEffects: number;
	readonly activeAdmittedEffects: number;
}

export interface EvalEffectClassActivitySnapshot {
	readonly kind: "eval-effect-class-activity-snapshot";
	readonly effectClass: "provider" | "exact-tool" | "retry-delay" | "billing-observation";
	readonly activeEffects: number;
	readonly admittedEffects: number;
	readonly settledEffects: number;
}

export interface RootEvalTopologyOptions {
	readonly profileInput: QualifiedProfileCatalogInput;
	readonly currentKeyBefore: EvalCurrentKeySnapshot;
	readonly campaignRef?: string;
	readonly campaignPurpose?: EvalCampaignPurpose;
	readonly taskSetRef?: string;
	readonly taskManifestDigest?: string;
	readonly taskBindings?: readonly RootEvalTaskBinding[];
	readonly generationRef?: string;
	readonly replicateCount?: number;
	readonly heldOutSealDigest?: string;
	readonly budgetPartition?: EvalBudgetPartition;
	readonly partitionHardCapMicrousd?: number;
	readonly partitionSpentBeforeMicrousd?: number;
	readonly partitionLedgerDigest?: string;
	readonly developmentQualificationStreakBefore?: number;
	readonly maxAttempts?: number;
	readonly maxCostMicrousd?: number;
	readonly reservationMicrousd?: number;
	readonly effectTimeoutMs?: number;
	readonly sourceEffectTimeoutMs?: number;
}

export interface RootEvalProfileAdmission {
	readonly kind: "root-eval-profile-admission";
	readonly eligibility: CurrentProfileEligibility;
	readonly resolution: Extract<ProfileResolution, { readonly status: "eligible" }>;
	readonly profile: HarnessEnhancementProfile;
	readonly binding: ProviderBinding;
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
	): Promise<RootEvalRunResult>;
	readonly nodes: {
		readonly campaignContract: Node<EvalCampaignContract>;
		readonly workItems: Node<WorkItemProjection<Record<string, unknown>>>;
		readonly memoryProvenance: Node<Readonly<Record<HarnessArm, EvalMemoryProvenance>>>;
		readonly providerProposals: Node<EvalEffectProposal>;
		readonly providerAdmissions: Node<EvalAdmittedEffect>;
		readonly providerCapacity: Node<EvalProviderCapacityState>;
		readonly elapsedBudgetTimerSource: Node<EvalElapsedBudgetTimerTick>;
		readonly elapsedBudget: Node<EvalElapsedBudgetState>;
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
		readonly developmentQualification: Node<EvalDevelopmentQualificationState>;
		readonly terminalLifecycleConsistency: Node<{
			readonly kind: "eval-terminal-lifecycle-consistency";
			readonly status: "pending" | "consistent";
			readonly budgetDigest: string | null;
		}>;
		readonly observation: Node<EvalObservation>;
	};
}

export interface RootEvalRunResult {
	readonly finding: EvalFinding;
	readonly observations: readonly ObserveEvent[];
	readonly peakConcurrentEffects: number;
	readonly executedAdmissionIds: readonly string[];
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
	proposalKeys: Set<string>;
	proposalDigests: Map<string, string>;
	admittedKeys: Set<string>;
	settledAdmissionIds: Set<string>;
	active: Map<string, EvalAdmittedEffect>;
	pendingProposals: Map<string, EvalEffectProposal>;
	retryProposalKeys: Set<string>;
	rejectedProposalKeys: Set<string>;
	cooldownReadinessIds: Set<string>;
	capacityMode: "initial-parallel" | "cooldown" | "rate-limited-serial";
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
	stoppingReason: "none" | "budget-exhausted" | "elapsed-budget-exhausted";
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
): RootEvalProfileAdmission {
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
	const expected = createDeepSeekV4Flash0731FireworksStructuredProfileDefinition();
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
	"http-failed",
	"transport-failed",
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
			tags: relevant ? ["relevant", "eval-memory"] : ["irrelevant", "eval-memory"],
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
	readonly toolRef: "graphrefly.eval.exact-tool.v1";
	readonly path: string;
	readonly oldText: string;
	readonly newText: string;
}): string {
	return empiricalStrictJsonDigest({
		toolRef: input.toolRef,
		path: input.path,
		oldText: input.oldText,
		newText: input.newText,
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

function validateProviderOutcome(outcome: EvalProviderOutcome): EvalProviderOutcome {
	const admission = outcome.admission;
	const proposal = outcome.toolProposal;
	const coordinate = executionCoordinateFromWorkItemId(outcome.workItemId);
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
		outcome.attempt !== admission.attempt ||
		coordinate?.arm !== outcome.arm ||
		coordinate?.workItemRole !== outcome.workItemRole ||
		replicateFromWorkItemId(outcome.workItemId) !== outcome.replicate ||
		typeof outcome.dispatchAttempted !== "boolean" ||
		!Number.isSafeInteger(outcome.costMicrousd) ||
		outcome.costMicrousd < 0 ||
		(outcome.costEvidence === "reservation-upper-bound" &&
			outcome.costMicrousd > admission.reservationMicrousd) ||
		!(
			outcome.costEvidence === "provider-reported" ||
			outcome.costEvidence === "reservation-upper-bound"
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
		outcome.retryAfterMs > 120_000 ||
		typeof outcome.cleanupCompleted !== "boolean" ||
		!isDigest(outcome.resultDigest) ||
		!(
			outcome.status === "tool-proposed" ||
			outcome.status === "failed" ||
			outcome.status === "retryable"
		) ||
		!EVAL_PROVIDER_OUTCOME_REASON_CODES.includes(outcome.reason) ||
		(outcome.status === "tool-proposed") !== (outcome.reason === "tool-proposed") ||
		(outcome.status === "retryable") !== (outcome.reason === "http-429-retryable") ||
		(outcome.status === "tool-proposed") !== (proposal !== null) ||
		(outcome.status === "retryable") !== outcome.retryAfterMs > 0 ||
		(outcome.status === "tool-proposed" ? outcome.cleanupCompleted : !outcome.cleanupCompleted) ||
		(proposal !== null &&
			(proposal.toolRef !== "graphrefly.eval.exact-tool.v1" ||
				proposal.path.length < 1 ||
				proposal.oldText.length < 1 ||
				proposal.oldText.length > 32_768 ||
				proposal.newText.length > 32_768 ||
				proposal.argumentsDigest !== effectArgumentsDigest(proposal)))
	)
		throw new TypeError(
			`provider outcome does not exactly match its Graph admission receipt (${String(outcome?.status)}/${String(outcome?.reason)}/attempt-${String(outcome?.attempt)})`,
		);
	return outcome;
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
		outcome.attempt !== admission.attempt ||
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
		attempt: provider.attempt,
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
	"elapsedBudget",
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
	if (mode !== "initial-parallel" && mode !== "cooldown" && mode !== "rate-limited-serial")
		throw new TypeError(`${label}.mode invalid`);
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
	const rateLimitFeedbackCount = safeInteger(
		root.rateLimitFeedbackCount,
		`${label}.rateLimitFeedbackCount`,
	);
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
		(mode === "initial-parallel" &&
			(maxConcurrentEffects !== ROOT_EVAL_INITIAL_PROVIDER_CAPACITY ||
				rateLimitFeedbackCount !== 0 ||
				cooldownOutstandingReadinessCount !== 0)) ||
		(mode === "cooldown" &&
			(maxConcurrentEffects !== ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY ||
				rateLimitFeedbackCount < 1 ||
				cooldownOutstandingReadinessCount < 1)) ||
		(mode === "rate-limited-serial" &&
			(maxConcurrentEffects !== ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY ||
				rateLimitFeedbackCount < 1 ||
				cooldownOutstandingReadinessCount !== 0))
	)
		throw new TypeError(`${label} provider capacity conservation drifted`);
}

function assertElapsedBudgetRuntimeShape(elapsed: EvalElapsedBudgetState, label: string): void {
	const root = record(elapsed, label);
	exactKeys(
		root,
		[
			"kind",
			"scheduleId",
			"limitMs",
			"drainReserveMs",
			"callerSafetyLeaseMs",
			"state",
			"nowMs",
			"stoppingReason",
		],
		label,
	);
	literal(root.kind, "eval-elapsed-budget-state", `${label}.kind`);
	coordinate(root.scheduleId, `${label}.scheduleId`);
	literal(root.limitMs, ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS, `${label}.limitMs`);
	literal(root.drainReserveMs, ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS, `${label}.drainReserveMs`);
	literal(
		root.callerSafetyLeaseMs,
		ROOT_EVAL_CALLER_SAFETY_LEASE_MS,
		`${label}.callerSafetyLeaseMs`,
	);
	if (root.state === "armed") {
		literal(root.nowMs, 0, `${label}.nowMs`);
		literal(root.stoppingReason, "none", `${label}.stoppingReason`);
	} else if (root.state === "exhausted") {
		literal(root.nowMs, ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS, `${label}.nowMs`);
		literal(root.stoppingReason, "elapsed-budget-exhausted", `${label}.stoppingReason`);
	} else throw new TypeError(`${label}.state invalid`);
}

export function assertRootEvalObservationRuntimeShape(
	observation: EvalObservation,
	label: string,
): void {
	const root = record(observation, label);
	exactKeys(root, ROOT_EVAL_OBSERVATION_KEYS, label);
	literal(root.kind, "eval-observation", `${label}.kind`);
	literal(root.topologyRevision, ROOT_EVAL_TOPOLOGY_REVISION, `${label}.topologyRevision`);
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
		!(["no-network", "development-usd-6", "confirmatory-usd-6"] as const).includes(
			root.budgetPartition as EvalBudgetPartition,
		)
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
				root.budgetPartition !== "development-usd-6")) ||
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
	const elapsedBudget = root.elapsedBudget as EvalElapsedBudgetState;
	assertElapsedBudgetRuntimeShape(elapsedBudget, `${label}.elapsedBudget`);
	if (
		(root.stoppingReason === "elapsed-budget-exhausted") !==
		(elapsedBudget.state === "exhausted")
	)
		throw new TypeError(`${label} elapsed stopping state drifted`);
	const admittedAttempts = safeInteger(root.admittedAttempts, `${label}.admittedAttempts`);
	const admittedRetryAttempts = safeInteger(
		root.admittedRetryAttempts,
		`${label}.admittedRetryAttempts`,
		{ max: replicateCount * HARNESS_ARMS.length },
	);
	const retryProposalCount = safeInteger(root.retryProposalCount, `${label}.retryProposalCount`, {
		max: replicateCount * HARNESS_ARMS.length,
	});
	const pendingRetryProposalCount = safeInteger(
		root.pendingRetryProposalCount,
		`${label}.pendingRetryProposalCount`,
		{ max: replicateCount * HARNESS_ARMS.length },
	);
	const rejectedRetryProposalCount = safeInteger(
		root.rejectedRetryProposalCount,
		`${label}.rejectedRetryProposalCount`,
		{ max: replicateCount * HARNESS_ARMS.length },
	);
	const settledRetryAttemptCount = safeInteger(
		root.settledRetryAttemptCount,
		`${label}.settledRetryAttemptCount`,
		{ max: replicateCount * HARNESS_ARMS.length },
	);
	const providerCallCount = safeInteger(root.providerCallCount, `${label}.providerCallCount`);
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
		(root.providerOutcomeReasonCounts as EvalProviderOutcomeReasonCounts)["transport-retryable"] +
		(root.providerOutcomeReasonCounts as EvalProviderOutcomeReasonCounts)["http-429-retryable"];
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
		activeRetryEffects !== retryableReasonTotal - admittedRetryAttempts ||
		retryProposalCount !==
			pendingRetryProposalCount + admittedRetryAttempts + rejectedRetryProposalCount ||
		settledRetryAttemptCount > admittedRetryAttempts ||
		pricingRoundingAllowanceMicrousd > providerReportedMicrousd ||
		providerReportedLowerBoundMicrousd !==
			Math.max(0, providerReportedMicrousd - pricingRoundingAllowanceMicrousd) ||
		accountedUpperBoundMicrousd !==
			activeReservedMicrousd + providerReportedMicrousd + unreportedSettledUpperBoundMicrousd ||
		accountedUpperBoundMicrousd > partitionHardCapMicrousd - partitionSpentBeforeMicrousd ||
		providerCallCount > admittedAttempts ||
		providerReasonTotal > admittedAttempts ||
		billingStableIntervals > billingObservationCount
	)
		throw new TypeError(
			`${label} budget, billing, or provider-reason arithmetic/conservation drifted`,
		);
	const pending = root.finding === "pending";
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
			(previous.completedArms !== HARNESS_ARMS.length || current.completedArms > 1)) ||
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
		(previous.elapsedBudget.state === "exhausted" && current.elapsedBudget.state !== "exhausted")
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
	const taskBindings = options.taskBindings ?? rootEvalTaskBindings(ROOT_EVAL_DEVELOPMENT_TASKS);
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
	if (
		(campaignPurpose === "development" &&
			(replicateCount !== ROOT_EVAL_DEVELOPMENT_REPLICATE_COUNT ||
				budgetPartition !== "development-usd-6")) ||
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
				].every((value) => /^sha256:[0-9a-f]{64}$/u.test(value)),
		) ||
		new Set(taskBindings.map((binding) => binding.taskInstanceRef)).size !== replicateCount
	)
		throw new TypeError("root eval task bindings failed closed");
	coordinate(generationRef, "root eval generationRef");
	if (!/^sha256:[0-9a-f]{64}$/u.test(heldOutSealDigest))
		throw new TypeError("root eval held-out seal digest was invalid");
	if (!/^sha256:[0-9a-f]{64}$/u.test(partitionLedgerDigest))
		throw new TypeError("root eval partition ledger digest was invalid");
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
	const maxAttempts = options.maxAttempts ?? replicateCount * (HARNESS_ARMS.length + 1) * 2;
	const maxCostMicrousd =
		options.maxCostMicrousd ?? partitionHardCapMicrousd - partitionSpentBeforeMicrousd;
	const reservationMicrousd = options.reservationMicrousd ?? 1_000;
	const effectTimeoutMs = options.effectTimeoutMs ?? ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS;
	const sourceEffectTimeoutMs = options.sourceEffectTimeoutMs ?? effectTimeoutMs;
	if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)
		throw new TypeError("maxAttempts must be a positive safe integer");
	if (!Number.isSafeInteger(maxCostMicrousd) || maxCostMicrousd < 1)
		throw new TypeError("maxCostMicrousd must be a positive safe integer");
	if (maxCostMicrousd > partitionHardCapMicrousd - partitionSpentBeforeMicrousd)
		throw new TypeError("maxCostMicrousd exceeded the Graph-visible partition remainder");
	if (!Number.isSafeInteger(reservationMicrousd) || reservationMicrousd < 1)
		throw new TypeError("reservationMicrousd must be a positive safe integer");
	if (!Number.isSafeInteger(effectTimeoutMs) || effectTimeoutMs < 1 || effectTimeoutMs > 300_000)
		throw new TypeError("effectTimeoutMs must be a bounded positive safe integer");
	if (
		!Number.isSafeInteger(sourceEffectTimeoutMs) ||
		sourceEffectTimeoutMs < 1 ||
		sourceEffectTimeoutMs > 300_000
	)
		throw new TypeError("sourceEffectTimeoutMs must be a bounded positive safe integer");
	if (options.profileInput === undefined)
		throw new TypeError("root eval requires a Graph-admitted exact profile input");
	const currentKeyBefore = validateCurrentKeySnapshot(options.currentKeyBefore);

	const owner = graph({ name: "eval/root" });
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
			decisionRefs: ["graphrefly-ts:D145"],
		},
	});
	const taskBindingAuthority = owner.state(Object.freeze(taskBindings), {
		name: "eval/campaign/task-bindings",
		factory: "rootEvalTaskBindingAuthority",
		meta: { materialFree: true, authority: "sealed-task-manifest", taskManifestDigest },
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
	const profileAdmission = owner.node<RootEvalProfileAdmission>(
		[profileCatalog],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", admitProfileInsideRootGraph(raw as QualifiedProfileCatalogInput)]]);
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
	const elapsedBudgetScheduleId = `${campaignRef}/elapsed-admission-budget`;
	const elapsedBudgetSchedules = owner.node<ScheduledReadinessRequested>(
		[start],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const campaignStart = raw as {
					readonly kind: "eval-campaign-start";
					readonly campaignRef: string;
				};
				if (campaignStart.campaignRef !== campaignRef)
					throw new TypeError("eval elapsed schedule campaign identity drifted");
				const scheduledCampaignRef = ctx.state.get<string>();
				if (scheduledCampaignRef !== undefined) {
					if (scheduledCampaignRef !== campaignStart.campaignRef)
						throw new TypeError("eval elapsed schedule replay identity drifted");
					ctx.down([["RESOLVED"]]);
					continue;
				}
				ctx.state.set(campaignStart.campaignRef);
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "scheduled-readiness-requested" as const,
							scheduleId: elapsedBudgetScheduleId,
							subjectRefs: Object.freeze([
								Object.freeze({ kind: "eval-campaign", id: campaignStart.campaignRef }),
							]),
							readyAtMs: ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
							deadlineMs: ROOT_EVAL_CALLER_SAFETY_LEASE_MS,
							reason: "elapsed-budget-exhausted",
							policyRefs: Object.freeze([
								Object.freeze({ kind: "decision", id: "graphrefly-ts:D129" }),
							]),
							sourceRefs: Object.freeze([
								Object.freeze({ kind: "eval-campaign-start", id: campaignStart.campaignRef }),
							]),
							metadata: Object.freeze({
								limitMs: ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
								drainReserveMs: ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS,
								callerSafetyLeaseMs: ROOT_EVAL_CALLER_SAFETY_LEASE_MS,
							}),
						}),
					],
				]);
			}
		},
		{
			name: "eval/time/elapsed-budget/schedule",
			factory: "rootEvalElapsedBudgetSchedule",
			meta: { materialFree: true, authority: "root-graph" },
		},
	);
	const elapsedBudgetTimerSource = owner.node<EvalElapsedBudgetTimerTick>(
		[start],
		(ctx) => {
			type ElapsedBudgetTimerRuntime = {
				active: boolean;
				fired: boolean;
				timer: ReturnType<typeof setTimeout> | undefined;
			};
			const runtime = ctx.state.get<ElapsedBudgetTimerRuntime>();
			if (runtime !== undefined) {
				ctx.onDeactivation(() => {
					runtime.active = false;
					if (runtime.timer !== undefined) clearTimeout(runtime.timer);
					runtime.timer = undefined;
				});
				ctx.down([["RESOLVED"]]);
				return;
			}
			const campaignStart = (depBatch(ctx, 0) ?? [])[0] as
				| { readonly kind: "eval-campaign-start"; readonly campaignRef: string }
				| undefined;
			if (campaignStart === undefined) {
				ctx.down([["RESOLVED"]]);
				return;
			}
			if (campaignStart.campaignRef !== campaignRef)
				throw new TypeError("eval elapsed timer campaign identity drifted");
			const armedRuntime: ElapsedBudgetTimerRuntime = {
				active: true,
				fired: false,
				timer: undefined,
			};
			ctx.state.set(armedRuntime);
			const timer = setTimeout(() => {
				if (!armedRuntime.active || armedRuntime.fired) return;
				armedRuntime.fired = true;
				armedRuntime.timer = undefined;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-elapsed-budget-timer-tick" as const,
							campaignRef: campaignStart.campaignRef,
							nowMs: ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
						}),
					],
				]);
			}, ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS);
			armedRuntime.timer = timer;
			(timer as { unref?: () => void }).unref?.();
			ctx.onDeactivation(() => {
				armedRuntime.active = false;
				if (armedRuntime.timer !== undefined) clearTimeout(armedRuntime.timer);
				armedRuntime.timer = undefined;
			});
			ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/time/elapsed-budget/timer-source",
			factory: "rootEvalCampaignElapsedTimerSource",
			pool: "async",
			pausable: false,
			meta: {
				materialFree: true,
				authority: "root-graph-async-source-boundary",
				armedBy: "eval/campaign/start",
				delayMs: ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
				startWaveSettlement: "immediate-resolved",
				boundaryEmission: "new-external-data-wave",
				asyncPool: true,
				pausable: false,
				decisionRefs: ["graphrefly-ts:D129", "graphrefly-ts:D131"],
			},
		},
	);
	const elapsedBudgetClocks = owner.node<ScheduledReadinessClock>(
		[elapsedBudgetTimerSource],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const tick = raw as {
					readonly kind: "eval-elapsed-budget-timer-tick";
					readonly campaignRef: string;
					readonly nowMs: 0 | typeof ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS;
				};
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "scheduled-readiness-clock" as const,
							clockId: `${tick.campaignRef}/elapsed-admission-clock`,
							nowMs: tick.nowMs,
							sourceRefs: Object.freeze([
								Object.freeze({
									kind: "eval-elapsed-clock",
									id: `${tick.campaignRef}/elapsed-admission-clock`,
								}),
							]),
							metadata: Object.freeze({
								relativeTo: "eval/campaign/start",
								elapsedMs: tick.nowMs,
							}),
						}),
					],
				]);
			}
		},
		{
			name: "eval/time/elapsed-budget/clock",
			factory: "rootEvalElapsedBudgetClock",
			partial: true,
			meta: { materialFree: true, authority: "root-graph-timer-source" },
		},
	);
	const elapsedReadiness = scheduledReadinessProjector(owner, {
		name: "eval/time/elapsed-budget/readiness",
		schedules: [elapsedBudgetSchedules],
		clocks: [elapsedBudgetClocks],
	});
	const elapsedBudget = owner.node<EvalElapsedBudgetState>(
		[elapsedBudgetSchedules, elapsedReadiness.ready],
		(ctx) => {
			let state = ctx.state.get<EvalElapsedBudgetState>();
			if ((depBatch(ctx, 0)?.length ?? 0) > 0 && state === undefined) {
				state = Object.freeze({
					kind: "eval-elapsed-budget-state" as const,
					scheduleId: elapsedBudgetScheduleId,
					limitMs: ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
					drainReserveMs: ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS,
					callerSafetyLeaseMs: ROOT_EVAL_CALLER_SAFETY_LEASE_MS,
					state: "armed" as const,
					nowMs: 0 as const,
					stoppingReason: "none" as const,
				});
				ctx.state.set(state);
				ctx.down([["DATA", state]]);
			}
			if ((depBatch(ctx, 1)?.length ?? 0) > 0 && state?.state !== "exhausted") {
				state = Object.freeze({
					kind: "eval-elapsed-budget-state" as const,
					scheduleId: elapsedBudgetScheduleId,
					limitMs: ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
					drainReserveMs: ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS,
					callerSafetyLeaseMs: ROOT_EVAL_CALLER_SAFETY_LEASE_MS,
					state: "exhausted" as const,
					nowMs: ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
					stoppingReason: "elapsed-budget-exhausted" as const,
				});
				ctx.state.set(state);
				ctx.down([["DATA", state]]);
			}
		},
		{
			name: "eval/time/elapsed-budget/state",
			factory: "rootEvalElapsedBudgetState",
			partial: true,
			meta: {
				materialFree: true,
				domainAuthority: "root-graph",
				callerAuthority: "none",
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
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (!(["tool-proposed", "failed", "retryable"] as const).includes(outcome.status))
					throw new TypeError("canonical provider result input received an unknown status");
				if (outcome.status === "retryable" && outcome.attempt !== 1)
					throw new TypeError("second eval attempt cannot request another retry");
				ctx.down([["DATA", outcome]]);
			}
		},
		{
			name: "eval/provider/all-result-admissions",
			factory: "rootEvalAllProviderResultAdmissions",
			meta: {
				authority: "root-graph",
				maxAttemptsPerWorkItem: 2,
				callerAuthority: "submit-correlated-result-data-only",
				resultIngresses: "single-canonical-status-union",
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
				maxAttemptsPerWorkItem: 2,
			},
		},
	);
	const resultStatusReleaseController = owner.node(
		[
			allProviderResultAdmissions,
			terminalProviderResultAdmissions,
			failedProviderResultAdmissions,
			retryableProviderResultAdmissions,
		],
		(ctx) => {
			const statuses = new Set(
				(depBatch(ctx, 0) ?? []).map(
					(raw) => validateProviderOutcome(raw as EvalProviderOutcome).status,
				),
			);
			if (statuses.has("tool-proposed"))
				ctx.upNext([["PULL", { pullId: resultStatusPullIds.terminal }]], 1);
			if (statuses.has("failed")) ctx.upNext([["PULL", { pullId: resultStatusPullIds.failed }]], 2);
			if (statuses.has("retryable"))
				ctx.upNext([["PULL", { pullId: resultStatusPullIds.retryable }]], 3);
		},
		{
			name: "eval/provider/result-status-release-controller",
			factory: "rootEvalProviderResultStatusReleaseController",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { role: "quiet-provider-result-status-demux" },
		},
	);
	owner.retain(resultStatusReleaseController, {
		reason: "eval provider result status release",
	});
	type EvalProviderOutcomeBatch = Readonly<{
		readonly kind: "eval-provider-outcome-batch";
		readonly replicate: number;
		readonly attempt: 1 | 2;
		readonly complete: boolean;
		readonly outcomes: readonly EvalProviderOutcome[];
	}>;
	interface EvalProviderOutcomeBatchState {
		readonly attemptOne: Map<number, Map<HarnessArm, EvalProviderOutcome>>;
		readonly attemptTwo: Map<number, Map<HarnessArm, EvalProviderOutcome>>;
		readonly expectedAttemptTwo: Map<number, number>;
	}
	owner.node<EvalProviderOutcomeBatch>(
		[
			terminalProviderResultAdmissions,
			failedProviderResultAdmissions,
			retryableProviderResultAdmissions,
		],
		(ctx) => {
			const state = ctx.state.get<EvalProviderOutcomeBatchState>() ?? {
				attemptOne: new Map<number, Map<HarnessArm, EvalProviderOutcome>>(),
				attemptTwo: new Map<number, Map<HarnessArm, EvalProviderOutcome>>(),
				expectedAttemptTwo: new Map<number, number>(),
			};
			const emitted: EvalProviderOutcomeBatch[] = [];
			for (const raw of [
				...(depBatch(ctx, 0) ?? []),
				...(depBatch(ctx, 1) ?? []),
				...(depBatch(ctx, 2) ?? []),
			]) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (outcome.workItemRole === "source") continue;
				const byAttempt = outcome.attempt === 1 ? state.attemptOne : state.attemptTwo;
				const byArm =
					byAttempt.get(outcome.replicate) ?? new Map<HarnessArm, EvalProviderOutcome>();
				const arm = outcome.arm as HarnessArm;
				const prior = byArm.get(arm);
				if (prior !== undefined && prior.resultDigest !== outcome.resultDigest)
					throw new TypeError("provider outcome batch received contradictory arm replay");
				if (prior !== undefined) continue;
				byArm.set(arm, outcome);
				byAttempt.set(outcome.replicate, byArm);
				if (outcome.attempt === 1) {
					const outcomes = Object.freeze(
						HARNESS_ARMS.flatMap((arm) => {
							const value = byArm.get(arm);
							return value === undefined ? [] : [value];
						}),
					);
					const complete = byArm.size === HARNESS_ARMS.length;
					if (complete) {
						state.expectedAttemptTwo.set(
							outcome.replicate,
							outcomes.filter((value) => value.status === "retryable").length,
						);
					}
					emitted.push(
						Object.freeze({
							kind: "eval-provider-outcome-batch" as const,
							replicate: outcome.replicate,
							attempt: 1 as const,
							complete,
							outcomes,
						}),
					);
				}
				if (outcome.attempt === 2) {
					const expected = state.expectedAttemptTwo.get(outcome.replicate);
					if (expected === undefined)
						throw new TypeError("attempt-two provider outcome preceded its attempt-one batch");
					if (byArm.size <= expected) {
						const outcomes = Object.freeze(
							HARNESS_ARMS.flatMap((arm) => {
								const value = byArm.get(arm);
								return value === undefined ? [] : [value];
							}),
						);
						emitted.push(
							Object.freeze({
								kind: "eval-provider-outcome-batch" as const,
								replicate: outcome.replicate,
								attempt: 2 as const,
								complete: byArm.size === expected,
								outcomes,
							}),
						);
					}
				}
			}
			if (emitted.length > 0) ctx.down(emitted.map((batch) => ["DATA", batch] as const));
			else ctx.down([["RESOLVED"]]);
			ctx.state.set(state);
		},
		{
			name: "eval/provider/result-batches",
			factory: "rootEvalProviderOutcomeBatches",
			partial: true,
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
	const allToolOutcomes = owner.node<EvalEffectOutcome>(
		[sourceToolOutcomes, targetToolOutcomes],
		(ctx) => {
			for (const dependencyIndex of [0, 1] as const)
				for (const raw of depBatch(ctx, dependencyIndex) ?? []) ctx.down([["DATA", raw]]);
		},
		{
			name: "eval/tool/all-result-inputs",
			factory: "rootEvalAllExactToolResults",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
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
	const targetOutcomes = owner.node<EvalEffectOutcome>(
		[failedProviderResultAdmissions, targetToolOutcomes],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const provider = validateProviderOutcome(raw as EvalProviderOutcome);
				if (provider.status === "failed" && provider.workItemRole === "target") {
					emitted = true;
					ctx.down([["DATA", providerFailureOutcome(provider)]]);
				}
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				emitted = true;
				ctx.down([["DATA", validateOutcomeReceipt(raw as EvalEffectOutcome)]]);
			}
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/effect/terminal-outcomes",
			factory: "rootEvalTerminalOutcomes",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
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
	const sourceOutcomes = owner.node<EvalSourceTerminalInput>(
		[failedProviderResultAdmissions, sourceToolOutcomes],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const provider = validateProviderOutcome(raw as EvalProviderOutcome);
				if (provider.status === "failed" && provider.workItemRole === "source") {
					emitted = true;
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
			for (const raw of depBatch(ctx, 1) ?? []) {
				emitted = true;
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
				ctx.down([
					["DATA", Object.freeze({ kind: "eval-source-tool-outcome-input" as const, outcome })],
				]);
			}
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/source-work-item/terminal-outcomes",
			factory: "rootEvalSourceTerminalOutcomes",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);

	const resultProjection = owner.node<EffectRunResult>(
		[targetOutcomes],
		(ctx) => {
			let emitted = false;
			const settled = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
				if (settled.has(outcome.admissionId)) continue;
				settled.add(outcome.admissionId);
				const result = finalResult(outcome);
				if (result !== undefined) {
					emitted = true;
					ctx.down([["DATA", result]]);
				}
			}
			ctx.state.set(settled);
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/provider/reconciliation",
			factory: "rootEvalProviderReconciliation",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { correlation: "admissionId+effectRunId+attempt" },
		},
	);
	const sourceResultProjection = owner.node<EffectRunResult>(
		[sourceOutcomes],
		(ctx) => {
			let emitted = false;
			const settled = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateOutcomeReceipt((raw as EvalSourceTerminalInput).outcome);
				if (settled.has(outcome.admissionId)) continue;
				settled.add(outcome.admissionId);
				const result = finalResult(outcome);
				if (result !== undefined) {
					emitted = true;
					ctx.down([["DATA", result]]);
				}
			}
			ctx.state.set(settled);
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/source-work-item/reconciliation",
			factory: "rootEvalSourceWorkItemReconciliation",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { correlation: "admissionId+effectRunId+attempt", workItemRole: "source" },
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
			type SourceScheduleRuntime = {
				active: boolean;
				emitted: boolean;
				timer: ReturnType<typeof setTimeout> | undefined;
			};
			const prior = ctx.state.get<SourceScheduleRuntime>();
			if (prior !== undefined) {
				ctx.onDeactivation(() => {
					prior.active = false;
					if (prior.timer !== undefined) clearTimeout(prior.timer);
					prior.timer = undefined;
				});
				ctx.down([["RESOLVED"]]);
				return;
			}
			const requests = depLatest(ctx, 1) as readonly EvalSourceWorkItemRequest[] | undefined;
			const contract = depLatest(ctx, 2) as EvalCampaignContract | undefined;
			if (
				(depBatch(ctx, 0)?.length ?? 0) === 0 ||
				requests === undefined ||
				contract === undefined
			) {
				ctx.down([["RESOLVED"]]);
				return;
			}
			if (contract.taskSetRef !== taskSetRef || requests.length !== contract.replicateCount)
				throw new TypeError("source schedule lost its Graph campaign authority");
			const runtime: SourceScheduleRuntime = {
				active: true,
				emitted: false,
				timer: undefined,
			};
			ctx.state.set(runtime);
			runtime.timer = setTimeout(() => {
				if (!runtime.active || runtime.emitted) return;
				runtime.emitted = true;
				runtime.timer = undefined;
				ctx.down(requests.map((request) => ["DATA", request] as const));
			}, 0);
			ctx.onDeactivation(() => {
				runtime.active = false;
				if (runtime.timer !== undefined) clearTimeout(runtime.timer);
				runtime.timer = undefined;
			});
			ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/source-work-item/schedule",
			factory: "rootEvalSourceWorkItemSchedule",
			pool: "async",
			pausable: false,
			meta: {
				authority: "five-real-source-work-items-before-targets",
				taskManifestDigest,
				startWaveSettlement: "immediate-resolved",
				boundaryEmission: "new-external-data-wave",
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
	const sourceVerification = owner.node<EvalSourceTerminalFact>(
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
			name: "eval/source-work-item/outcome-evidence-verification",
			factory: "rootEvalSourceWorkItemVerification",
			partial: true,
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
			let emitted = false;
			const settled = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
				if (outcome.workItemRole === "source") continue;
				if (settled.has(outcome.admissionId)) continue;
				settled.add(outcome.admissionId);
				emitted = true;
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
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/verification/diff",
			factory: "rootEvalDiffVerification",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const publicSemantic = owner.node<EvalPublicSemanticFact>(
		[diff],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as EvalDiffFact;
				emitted = true;
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
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/verification/public-semantic",
			factory: "rootEvalPublicSemanticVerification",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const hiddenVerifier = owner.node<EvalHiddenVerifierFact>(
		[publicSemantic],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as EvalPublicSemanticFact;
				emitted = true;
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
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/verification/hidden-verifier",
			factory: "rootEvalHiddenVerifier",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const cleanup = owner.node<EvalCleanupFact>(
		[hiddenVerifier],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as EvalHiddenVerifierFact;
				const workItemRef = fact.outcome.workItemId;
				const arm = armFromWorkItemId(workItemRef);
				if (arm === undefined) continue;
				emitted = true;
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
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/cleanup/completed",
			factory: "rootEvalCleanup",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const verificationDiagnostics = owner.node<EvalVerificationDiagnostics>(
		[start, cleanup],
		(ctx) => {
			const completed = ctx.state.get<Map<string, EvalCleanupFact>>() ?? new Map();
			let changed = false;
			for (const raw of depBatch(ctx, 1) ?? []) {
				const fact = raw as EvalCleanupFact;
				const previous = completed.get(fact.workItemId);
				if (previous !== undefined) {
					if (empiricalStrictJsonDigest(previous) !== empiricalStrictJsonDigest(fact))
						throw new TypeError("eval verification diagnostics observed contradictory cleanup");
					continue;
				}
				completed.set(fact.workItemId, fact);
				changed = true;
			}
			ctx.state.set(completed);
			if (changed || (depBatch(ctx, 0)?.length ?? 0) > 0)
				ctx.down([["DATA", verificationDiagnosticsSnapshot(completed)]]);
			else ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/verification/diagnostics",
			factory: "rootEvalVerificationDiagnostics",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				domainAuthority: "graph-state",
				materialFree: true,
				terminalReasonPrecedence: EVAL_VERIFICATION_TERMINAL_REASONS,
			},
		},
	);
	const campaign = owner.node<readonly EvalArmDispatch[] | EvalCampaignState>(
		[
			cleanup,
			sourceMemoryHandoff.status,
			sourceRequestAuthority,
			campaignContract,
			taskBindingAuthority,
			memoryProvenance,
		],
		(ctx) => {
			let emitted = false;
			const contract = depLatest(ctx, 3) as EvalCampaignContract | undefined;
			const bindings = depLatest(ctx, 4) as readonly RootEvalTaskBinding[] | undefined;
			const provenance = depLatest(ctx, 5) as
				| Readonly<Record<HarnessArm, EvalMemoryProvenance>>
				| undefined;
			if (contract === undefined || bindings === undefined || provenance === undefined) return;
			const state = ctx.state.get<CampaignControllerState>() ?? {
				started: false,
				replicate: 1,
				completedByReplicate: new Map<number, Set<HarnessArm>>(),
				sourceTerminals: new Map<number, EvalCampaignSourceTerminal>(),
				dispatchedReplicates: new Set<number>(),
			};
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
				emitted = true;
				ctx.down([["DATA", dispatchBatch(campaignRef, fact.request, binding, provenance)]]);
			};
			const requests = depLatest(ctx, 2) as readonly EvalSourceWorkItemRequest[] | undefined;
			if (requests === undefined) return;
			for (const raw of depBatch(ctx, 1) ?? []) {
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
					emitted = true;
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
					emitted = true;
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
			for (const raw of depBatch(ctx, 0) ?? []) {
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
				emitted = true;
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
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/campaign/replicate-controller",
			factory: "rootEvalReplicateController",
			partial: true,
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
	const batchReleaseController = owner.node(
		[campaign, batches],
		(ctx) => {
			if ((depBatch(ctx, 0) ?? []).some((raw) => Array.isArray(raw)))
				ctx.upNext([["PULL", { pullId: batchPullId }]], 1);
		},
		{
			name: "eval/campaign/replicate-batch-release-controller",
			factory: "rootEvalReplicateBatchReleaseController",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { role: "campaign-batch-release" },
		},
	);
	owner.retain(batchReleaseController, { reason: "eval campaign replicate batch release" });
	const campaignStates = owner.node<EvalCampaignState>(
		[campaign],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (!Array.isArray(raw) && (raw as EvalCampaignState).kind === "eval-campaign-state") {
					emitted = true;
					ctx.down([["DATA", raw]]);
				}
			}
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/campaign/state",
			factory: "rootEvalCampaignState",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);

	const workItems = owner.node<WorkItemProjection<Record<string, unknown>>>(
		[batches],
		(ctx) => {
			let emitted = false;
			for (const batch of (depBatch(ctx, 0) ?? []) as readonly (readonly EvalArmDispatch[])[]) {
				for (const item of batch) {
					emitted = true;
					ctx.down([["DATA", workItemFor(item)]]);
				}
			}
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/work-item/objective-data",
			factory: "rootEvalWorkItemData",
			partial: true,
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
		readonly sourceWorkItem: WorkItemProjection<Record<string, unknown>>;
		readonly mappingPolicy: AgenticWorkItemMemoryMappingPolicy<MemoryPayload>;
		readonly candidates: readonly AgenticWorkItemMemoryRecordCandidate<MemoryPayload>[];
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
	const memoryBatchDecisions = owner.node<AdmissionHandoffDecision<EvalMemoryBatchAdmissionReason>>(
		[verifiedSourceWorkItems, batches],
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
				const source = raw as WorkItemProjection<Record<string, unknown>>;
				state.sources.set(source.workItemId, source);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
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
			partial: true,
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
			type MemoryBridgeRuntime = {
				active: boolean;
				scheduledReplicates: Set<number>;
				timers: Set<ReturnType<typeof setTimeout>>;
			};
			const runtime = ctx.state.get<MemoryBridgeRuntime>() ?? {
				active: true,
				scheduledReplicates: new Set<number>(),
				timers: new Set<ReturnType<typeof setTimeout>>(),
			};
			ctx.state.set(runtime);
			ctx.onDeactivation(() => {
				runtime.active = false;
				for (const timer of runtime.timers) clearTimeout(timer);
				runtime.timers.clear();
			});
			for (const raw of depBatch(ctx, 0) ?? []) {
				const frame = raw as EvalMemoryBatchFrame;
				const replicate = frame.dispatches[0]?.replicate;
				if (replicate === undefined || runtime.scheduledReplicates.has(replicate)) continue;
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
				const frames = [
					["relevant", frame.relevantSourceWorkItem, relevantCandidates],
					["irrelevant", frame.irrelevantSourceWorkItem, irrelevantCandidates],
				] as const;
				runtime.scheduledReplicates.add(replicate);
				const emitFrame = (index: number) => {
					const tuple = frames[index];
					if (tuple === undefined) return;
					const [role, sourceWorkItem, candidates] = tuple;
					const timer = setTimeout(() => {
						runtime.timers.delete(timer);
						if (!runtime.active) return;
						ctx.down([
							[
								"DATA",
								Object.freeze({
									sourceWorkItem,
									mappingPolicy: Object.freeze({
										kind: "agentic-work-item-memory-mapping-policy" as const,
										policyId: `${frame.dispatches[0]!.workItemId}/memory-mapping-policy/${role}`,
										scoreRules: [],
									}),
									candidates,
								}),
							],
						]);
						emitFrame(index + 1);
					}, 0);
					runtime.timers.add(timer);
				};
				emitFrame(0);
			}
			ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/memory/source-record-data",
			factory: "rootEvalMemorySourceRecordData",
			pool: "async",
			pausable: false,
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				lifecycleCardinality: "one",
				recordSources: ["relevant", "irrelevant"],
				dataWaveOrder: ["relevant", "irrelevant"],
				startWaveSettlement: "immediate-resolved",
			},
		},
	);
	const memoryBridgeWorkItems = owner.node<WorkItemProjection<Record<string, unknown>>>(
		[memoryBridgeFrames],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				emitted = true;
				ctx.down([["DATA", (raw as EvalMemoryBridgeFrame).sourceWorkItem]]);
			}
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/memory/source-work-item-data",
			factory: "rootEvalMemorySourceWorkItemData",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const memoryMappingPolicy = owner.node<AgenticWorkItemMemoryMappingPolicy<MemoryPayload>>(
		[memoryBridgeFrames],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				emitted = true;
				ctx.down([["DATA", (raw as EvalMemoryBridgeFrame).mappingPolicy]]);
			}
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/memory/mapping-policy",
			factory: "rootEvalMemoryMappingPolicy",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const memoryCandidates = owner.node<
		readonly AgenticWorkItemMemoryRecordCandidate<MemoryPayload>[]
	>(
		[memoryBridgeFrames],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				emitted = true;
				ctx.down([["DATA", (raw as EvalMemoryBridgeFrame).candidates]]);
			}
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/memory/candidates",
			factory: "rootEvalMemoryCandidates",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const memoryInitialRecords = owner.node<readonly AgenticMemoryRecord<MemoryPayload>[]>(
		[memoryBatchFrames],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				emitted = true;
				ctx.down([["DATA", (raw as EvalMemoryBatchFrame).initialRecords]]);
			}
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/memory/initial-records",
			factory: "rootEvalInitialMemoryRecords",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const memoryBridgeRecipe = agenticWorkItemMemoryApplicationRecipeBundle<
		Record<string, unknown>,
		MemoryPayload
	>(owner, {
		name: "eval/solution/agentic-work-item-memory-application",
		workItem: memoryBridgeWorkItems,
		policy: memoryMappingPolicy,
		candidates: memoryCandidates,
	});
	const proposalsForAdmission = owner.node<
		typeof memoryBridgeRecipe.proposals extends Node<infer T> ? T : never
	>(
		[memoryBridgeRecipe.proposals],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (!Array.isArray(raw)) throw new TypeError("memory proposal batch was not DATA");
				ctx.down([
					[
						"DATA",
						Object.freeze(
							raw.filter(
								(proposal) =>
									!(
										proposal as { candidateMaterial?: { record?: { id?: string } } }
									).candidateMaterial?.record?.id?.includes("/proposal-only/memory-record"),
							),
						),
					],
				]);
			}
		},
		{
			name: "eval/memory/proposal-admission-boundary",
			factory: "rootEvalMemoryProposalAdmissionBoundary",
			meta: { proposalOnlyRemainsProposalOnly: true },
		},
	);
	const memoryAdmissionPolicy = owner.state<AgenticMemoryRecordAdmissionPolicy>(
		Object.freeze({
			kind: "agentic-memory-record-admission-policy",
			policyId: "root-eval-memory-admission-policy",
			defaultState: "admitted",
			rejectDuplicateRecordIds: true,
		}),
		{ name: "eval/memory/admission-policy", factory: "rootEvalMemoryAdmissionPolicy" },
	);
	const memoryAdmission = agenticMemoryRecordAdmissionBundle<MemoryPayload>(owner, {
		name: "eval/solution/agentic-memory-admission",
		records: memoryInitialRecords,
		proposals: proposalsForAdmission,
		policy: memoryAdmissionPolicy,
	});
	const memoryApplicationPolicy = owner.state<AgenticMemoryRecordApplicationPolicy>(
		Object.freeze({
			kind: "agentic-memory-record-application-policy",
			policyId: "root-eval-memory-application-policy",
		}),
		{ name: "eval/memory/application-policy", factory: "rootEvalMemoryApplicationPolicy" },
	);
	const memoryApplication = agenticMemoryRecordApplicationBundle<MemoryPayload>(owner, {
		name: "eval/solution/agentic-memory-application",
		records: memoryInitialRecords,
		admissions: memoryAdmission.admissions,
		policy: memoryApplicationPolicy,
	});
	const appliedMemoryRecordState = owner.node<readonly AgenticMemoryRecord<MemoryPayload>[]>(
		[memoryApplication.records],
		(ctx) => {
			const records =
				ctx.state.get<Map<string, AgenticMemoryRecord<MemoryPayload>>>() ??
				new Map<string, AgenticMemoryRecord<MemoryPayload>>();
			let changed = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				for (const record of raw as readonly AgenticMemoryRecord<MemoryPayload>[]) {
					const prior = records.get(record.id);
					if (prior !== undefined) continue;
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
	const memoryUseFrames = owner.node<{
		readonly dispatch: EvalArmDispatch;
		readonly request: AgenticMemoryRecordUseRequest;
		readonly decisions: readonly AgenticMemoryRecordUseDecision[];
	}>(
		[appliedMemoryRecordState, memoryBatchFrames],
		(ctx) => {
			const frame = depLatest(ctx, 1) as EvalMemoryBatchFrame | undefined;
			type MemoryUseRuntime = {
				active: boolean;
				records: Map<string, AgenticMemoryRecord<MemoryPayload>>;
				scheduledReplicates: Set<number>;
				timers: Set<ReturnType<typeof setTimeout>>;
			};
			const runtime = ctx.state.get<MemoryUseRuntime>() ?? {
				active: true,
				records: new Map<string, AgenticMemoryRecord<MemoryPayload>>(),
				scheduledReplicates: new Set<number>(),
				timers: new Set<ReturnType<typeof setTimeout>>(),
			};
			ctx.state.set(runtime);
			ctx.onDeactivation(() => {
				runtime.active = false;
				for (const timer of runtime.timers) clearTimeout(timer);
				runtime.timers.clear();
			});
			for (const raw of depBatch(ctx, 0) ?? []) {
				const records = raw as readonly AgenticMemoryRecord<MemoryPayload>[];
				for (const record of records) runtime.records.set(record.id, record);
			}
			if (frame !== undefined) {
				const replicate = frame.dispatches[0]?.replicate;
				const requiredAppliedIds = frame.dispatches
					.filter((dispatch) =>
						["relevant-applied", "irrelevant-applied", "wrong-scope-applied"].includes(
							dispatch.arm,
						),
					)
					.map((dispatch) => `${dispatch.workItemId}/memory-record`);
				if (
					replicate !== undefined &&
					!runtime.scheduledReplicates.has(replicate) &&
					requiredAppliedIds.every((id) => runtime.records.has(id))
				) {
					runtime.scheduledReplicates.add(replicate);
					const records = [...runtime.records.values()];
					const frames = HARNESS_ARMS.map((arm) => {
						const dispatch = frame.dispatches.find((value) => value.arm === arm)!;
						const expectedRecordId = `${dispatch.workItemId}/memory-record`;
						const request = memoryUseRequest(dispatch);
						const decisions = records.map((memory) =>
							createAgenticMemoryRecordUseDecision(request, memory, {
								decisionId: `${dispatch.workItemId}/memory-use/${memory.id}`,
								state:
									memory.id === expectedRecordId && memory.scope?.projectId === "eval-project"
										? "allowed"
										: "denied",
							}),
						);
						return Object.freeze({ dispatch, request, decisions: Object.freeze(decisions) });
					});
					const emitFrame = (index: number) => {
						const value = frames[index];
						if (value === undefined) return;
						const timer = setTimeout(() => {
							runtime.timers.delete(timer);
							if (!runtime.active) return;
							ctx.down([["DATA", value]]);
							emitFrame(index + 1);
						}, 0);
						runtime.timers.add(timer);
					};
					emitFrame(0);
				}
			}
			ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/memory/exposure-frame",
			factory: "rootEvalMemoryExposureFrame",
			pool: "async",
			pausable: false,
			meta: { dataWaveOrder: HARNESS_ARMS, lifecycleCardinality: "one" },
		},
	);
	const memoryUseRequests = owner.node<AgenticMemoryRecordUseRequest>(
		[memoryUseFrames],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", (raw as { readonly request: AgenticMemoryRecordUseRequest }).request]]);
		},
		{ name: "eval/memory/exposure-request", factory: "rootEvalMemoryExposureRequest" },
	);
	const memoryUseDecisions = owner.node<readonly AgenticMemoryRecordUseDecision[]>(
		[memoryUseFrames],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([
					[
						"DATA",
						(raw as { readonly decisions: readonly AgenticMemoryRecordUseDecision[] }).decisions,
					],
				]);
		},
		{ name: "eval/memory/exposure-decisions", factory: "rootEvalMemoryExposureDecisions" },
	);
	const memoryExposure = agenticMemoryRecordUseGateBundle(owner, {
		name: "eval/solution/agentic-memory-exposure",
		records: appliedMemoryRecordState,
		request: memoryUseRequests,
		decisions: memoryUseDecisions,
	});
	const memoryQuery = owner.node<{ readonly tags: readonly string[] }>(
		[memoryUseFrames],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const dispatch = (raw as { readonly dispatch: EvalArmDispatch }).dispatch;
				ctx.down([
					[
						"DATA",
						Object.freeze({
							tags: Object.freeze([
								dispatch.arm === "irrelevant-applied" ? "irrelevant" : "relevant",
							]),
						}),
					],
				]);
			}
		},
		{ name: "eval/memory/query", factory: "rootEvalMemoryQuery" },
	);
	const agenticMemory = agenticMemoryBundle(owner, {
		name: "eval/solution/agentic-memory",
		records: memoryExposure.allowedRecords,
		query: memoryQuery,
	});
	const memoryContexts = owner.node<EvalMemoryContextFrame>(
		[memoryUseFrames, agenticMemory.ranked],
		(ctx) => {
			const frame = depLatest(ctx, 0) as { readonly dispatch: EvalArmDispatch } | undefined;
			const answer = depLatest(ctx, 1) as
				| {
						readonly results?: readonly {
							readonly id?: string;
							readonly payload?: MemoryPayload;
						}[];
				  }
				| undefined;
			if (frame === undefined || answer === undefined) return;
			const emitted = ctx.state.get<Set<string>>() ?? new Set<string>();
			const dispatch = frame.dispatch;
			if (!emitted.has(dispatch.workItemId)) {
				const exposed =
					dispatch.arm === "relevant-applied" || dispatch.arm === "irrelevant-applied";
				const results = exposed
					? (answer.results ?? []).filter(
							(value) => value.id === `${dispatch.workItemId}/memory-fragment`,
						)
					: [];
				if (exposed && results.length !== 1) return;
				const ids = Object.freeze(results.map((value) => value.id as string));
				const bindings = Object.freeze(
					results.flatMap((value) =>
						value.payload !== undefined &&
						typeof value.payload.bindingRef === "string" &&
						isDigest(value.payload.digest)
							? [Object.freeze({ ...value.payload })]
							: [],
					),
				);
				if (bindings.length !== ids.length) return;
				emitted.add(dispatch.workItemId);
				ctx.down([
					[
						"DATA",
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
					],
				]);
			}
			ctx.state.set(emitted);
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
	const admittedPlanAuthority = owner.node<EvalWorkItemPlanAuthority>(
		[sourceExecution.plan.admitted, execution.plan.admitted],
		(ctx) => {
			const plans =
				ctx.state.get<Map<string, EvalWorkItemPlanSnapshot>>() ??
				new Map<string, EvalWorkItemPlanSnapshot>();
			for (const dependencyIndex of [0, 1] as const)
				for (const raw of depBatch(ctx, dependencyIndex) ?? []) {
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
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const firstAttemptProposalCandidates = owner.node<EvalEffectProposal>(
		[sourceExecution.requests, execution.requests, admittedPlanAuthority, profileAdmission],
		(ctx) => {
			const pending =
				ctx.state.get<Map<string, AgentRequestIssued<Record<string, unknown>>>>() ??
				new Map<string, AgentRequestIssued<Record<string, unknown>>>();
			for (const dependencyIndex of [0, 1] as const)
				for (const raw of depBatch(ctx, dependencyIndex) ?? []) {
					const request = raw as AgentRequestIssued<Record<string, unknown>>;
					pending.set(request.requestId, request);
				}
			ctx.state.set(pending);
			const admittedProfile = depLatest(ctx, 3) as RootEvalProfileAdmission | undefined;
			if (admittedProfile === undefined) return;
			const authority = depLatest(ctx, 2) as EvalWorkItemPlanAuthority | undefined;
			if (authority === undefined) return;
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
					proposalId: `${request.effectRunId}/attempt-1/proposal`,
					effectRunId: request.effectRunId,
					operationId: request.operationId,
					workItemId: workItemRef,
					replicate: replicateFromWorkItemId(workItemRef),
					arm: coordinate.arm,
					workItemRole: coordinate.workItemRole,
					attempt: 1 as const,
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
			partial: true,
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
	const firstAttemptProposalReleaseController = owner.node(
		[firstAttemptProposalCandidates, firstAttemptProposals],
		(ctx) => {
			if ((depBatch(ctx, 0)?.length ?? 0) > 0)
				ctx.upNext([["PULL", { pullId: firstAttemptProposalPullId }]], 1);
		},
		{
			name: "eval/provider/proposal-release-controller",
			factory: "rootEvalProviderProposalReleaseController",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { role: "admitted-plan-proposal-release" },
		},
	);
	owner.retain(firstAttemptProposalReleaseController, {
		reason: "eval admitted Work Item plan proposal release",
	});
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
				if (outcome.status !== "retryable" || outcome.attempt !== 1) continue;
				const request = Object.freeze({
					...outcome.admission.request,
					requestId: `${outcome.effectRunId}/retry-request`,
					proposalId: `${outcome.effectRunId}/retry-proposal`,
					operationId: `${outcome.effectRunId}/retry-operation`,
					issuedAtMs: outcome.elapsedMs,
				});
				const proposal = Object.freeze({
					kind: "eval-effect-proposal" as const,
					proposalId: `${outcome.effectRunId}/attempt-2/proposal`,
					effectRunId: outcome.effectRunId,
					operationId: request.operationId,
					workItemId: outcome.workItemId,
					replicate: outcome.replicate,
					arm: outcome.arm,
					workItemRole: outcome.workItemRole,
					attempt: 2 as const,
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
	const proposals = owner.node<EvalEffectProposal>(
		[replicateProposalBatches, retryProposals],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				for (const proposal of raw as readonly EvalEffectProposal[]) ctx.down([["DATA", proposal]]);
			for (const raw of depBatch(ctx, 1) ?? []) ctx.down([["DATA", raw]]);
		},
		{
			name: "eval/provider/proposals",
			factory: "rootEvalProviderProposals",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const retryDelayAdmissions = owner.node<EvalRetryDelayEffect>(
		[retryableProviderResultAdmissions, elapsedBudget],
		(ctx) => {
			const admitted = ctx.state.get<Set<string>>() ?? new Set<string>();
			const admissions: EvalRetryDelayEffect[] = [];
			const elapsed = depLatest(ctx, 1) as EvalElapsedBudgetState | undefined;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (outcome.status !== "retryable" || outcome.attempt !== 1) continue;
				if (elapsed?.state === "exhausted") continue;
				const executionId = `${outcome.admissionId}/retry-delay`;
				if (admitted.has(executionId)) continue;
				const material = Object.freeze({
					kind: "eval-admitted-retry-delay" as const,
					executionId,
					providerOutcome: outcome,
					effectRunId: outcome.effectRunId,
					workItemId: outcome.workItemId,
					replicate: outcome.replicate,
					arm: outcome.arm,
					workItemRole: outcome.workItemRole,
					attempt: 1 as const,
					batchSize: 1,
					delayMs: outcome.retryAfterMs,
				});
				const admission = Object.freeze({
					...material,
					receiptDigest: retryDelayReceiptDigest(material),
				});
				admitted.add(executionId);
				admissions.push(admission);
			}
			if (admissions.length > 0)
				ctx.down(admissions.map((admission) => ["DATA", admission] as const));
			ctx.state.set(admitted);
		},
		{
			name: "eval/retry/delay-admission",
			factory: "rootEvalRetryDelayAdmission",
			partial: true,
			meta: { admission: "per-correlated-retryable-result", batchBarrier: false },
		},
	);
	type EvalActiveProviderEffects = Readonly<{
		readonly kind: "eval-active-provider-effects";
		readonly effects: readonly EvalAdmittedEffect[];
	}>;
	type AdmissionFact =
		| EvalAdmittedEffect
		| EvalBudgetState
		| EvalActiveProviderEffects
		| EvalProviderCapacityState;
	const admissionFacts = owner.node<AdmissionFact>(
		[
			replicateProposalBatches,
			retryProposalFacts,
			allProviderResultAdmissions,
			retryDelayOutcomes,
			elapsedBudget,
			profileAdmission,
		],
		(ctx) => {
			const state = ctx.state.get<AdmissionState>() ?? {
				proposalKeys: new Set<string>(),
				proposalDigests: new Map<string, string>(),
				admittedKeys: new Set<string>(),
				settledAdmissionIds: new Set<string>(),
				active: new Map<string, EvalAdmittedEffect>(),
				pendingProposals: new Map<string, EvalEffectProposal>(),
				retryProposalKeys: new Set<string>(),
				rejectedProposalKeys: new Set<string>(),
				cooldownReadinessIds: new Set<string>(),
				capacityMode: "initial-parallel" as const,
				maxConcurrentEffects: ROOT_EVAL_INITIAL_PROVIDER_CAPACITY,
				rateLimitFeedbackCount: 0,
				admittedAttempts: 0,
				admittedRetryAttempts: 0,
				settledRetryAttempts: 0,
				providerCallCount: 0,
				activeReservedMicrousd: 0,
				providerReportedMicrousd: 0,
				pricingRoundingAllowanceMicrousd: 0,
				unreportedSettledUpperBoundMicrousd: 0,
				providerOutcomeReasonCounts: { ...emptyEvalProviderOutcomeReasonCounts() },
				stoppingReason: "none" as const,
			};
			const elapsed = depLatest(ctx, 4) as EvalElapsedBudgetState | undefined;
			if (elapsed?.state === "exhausted" && state.stoppingReason === "none")
				state.stoppingReason = "elapsed-budget-exhausted";
			const settleProviderOutcome = (outcome: EvalProviderOutcome) => {
				const active = state.active.get(outcome.admissionId);
				if (active === undefined || state.settledAdmissionIds.has(outcome.admissionId)) return;
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
				} else state.unreportedSettledUpperBoundMicrousd += outcome.costMicrousd;
				if (
					state.providerReportedMicrousd +
						state.unreportedSettledUpperBoundMicrousd +
						state.activeReservedMicrousd >
					maxCostMicrousd
				)
					state.stoppingReason = "budget-exhausted";
				state.providerOutcomeReasonCounts[outcome.reason] += 1;
				if (outcome.attempt === 2) state.settledRetryAttempts += 1;
				if (outcome.reason === "http-429-retryable") {
					const profile = depLatest(ctx, 5) as RootEvalProfileAdmission | undefined;
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
					state.cooldownReadinessIds.add(`${outcome.admissionId}/retry-delay`);
					state.capacityMode = "cooldown";
					state.maxConcurrentEffects = ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY;
					state.rateLimitFeedbackCount += 1;
				}
			};
			for (const raw of depBatch(ctx, 2) ?? [])
				settleProviderOutcome(validateProviderOutcome(raw as EvalProviderOutcome));
			for (const raw of depBatch(ctx, 3) ?? []) {
				const readiness = validateRetryDelayOutcome(raw as EvalRetryDelayOutcome);
				if (readiness.status !== "completed")
					throw new TypeError("provider cooldown readiness failed closed");
				state.cooldownReadinessIds.delete(readiness.executionId);
			}
			if (state.capacityMode === "cooldown" && state.cooldownReadinessIds.size === 0)
				state.capacityMode = "rate-limited-serial";
			const admitProposal = (proposal: EvalEffectProposal): "admitted" | "pending" | "rejected" => {
				const plan = proposal.workItemPlanAuthority;
				validateEvalEffectProposalAgainstWorkItemPlan(proposal, plan);
				const key = `${proposal.effectRunId}:${proposal.attempt}`;
				if (state.admittedKeys.has(key)) return "admitted";
				if (state.rejectedProposalKeys.has(key)) return "rejected";
				if (state.stoppingReason !== "none") {
					state.rejectedProposalKeys.add(key);
					return "rejected";
				}
				if (
					proposal.attempt === 2 &&
					!state.settledAdmissionIds.has(`${proposal.effectRunId}/attempt-1/admission`)
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
				const admissionId = `${proposal.effectRunId}/attempt-${proposal.attempt}/admission`;
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
				state.active.set(admissionId, admitted);
				state.admittedAttempts += 1;
				if (proposal.attempt === 2) state.admittedRetryAttempts += 1;
				state.activeReservedMicrousd += proposal.reservationMicrousd;
				ctx.down([["DATA", admitted]]);
				return "admitted";
			};
			const registerProposal = (proposal: EvalEffectProposal) => {
				const key = `${proposal.effectRunId}:${proposal.attempt}`;
				const digest = empiricalStrictJsonDigest(withoutUndefined(proposal));
				const priorDigest = state.proposalDigests.get(key);
				if (priorDigest !== undefined && priorDigest !== digest)
					throw new TypeError("provider proposal received contradictory replay");
				if (priorDigest !== undefined) return;
				state.proposalKeys.add(key);
				state.proposalDigests.set(key, digest);
				if (proposal.attempt === 2) state.retryProposalKeys.add(key);
				state.pendingProposals.set(key, proposal);
			};
			for (const rawBatch of depBatch(ctx, 0) ?? []) {
				for (const proposal of rawBatch as readonly EvalEffectProposal[])
					registerProposal(proposal);
			}
			for (const raw of depBatch(ctx, 1) ?? [])
				registerProposal((raw as EvalRetryProposalFact).proposal);
			const pending = [...state.pendingProposals.entries()].sort(([, left], [, right]) => {
				if (left.workItemRole !== right.workItemRole)
					return left.workItemRole === "source" ? -1 : 1;
				if (left.replicate !== right.replicate) return left.replicate - right.replicate;
				const armOrder =
					HARNESS_ARMS.indexOf(left.arm as HarnessArm) -
					HARNESS_ARMS.indexOf(right.arm as HarnessArm);
				if (armOrder !== 0) return armOrder;
				return left.attempt - right.attempt;
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
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-budget-state" as const,
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
					}),
				],
			]);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-provider-capacity-state" as const,
						mode: state.capacityMode,
						initialMaxConcurrentEffects: ROOT_EVAL_INITIAL_PROVIDER_CAPACITY,
						maxConcurrentEffects: state.maxConcurrentEffects,
						activeEffects: state.active.size,
						proposalCount: state.proposalKeys.size,
						pendingProposalCount: state.pendingProposals.size,
						pendingFirstAttemptProposalCount: [...state.pendingProposals.values()].filter(
							(proposal) => proposal.attempt === 1,
						).length,
						pendingRetryProposalCount: [...state.pendingProposals.values()].filter(
							(proposal) => proposal.attempt === 2,
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
					}),
				],
			]);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-active-provider-effects" as const,
						effects: Object.freeze([...state.active.values()]),
					}),
				],
			]);
			ctx.state.set(state);
		},
		{
			name: "eval/provider/graph-admission-and-budget",
			factory: "rootEvalProviderGraphAdmission",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				capacityPolicy: "adaptive-downshift-only",
				initialMaxConcurrentEffects: ROOT_EVAL_INITIAL_PROVIDER_CAPACITY,
				rateLimitedMaxConcurrentEffects: ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY,
				cooldownReadiness: "exact-correlated-retry-delay-outcome",
				proposalOrder: "replicate-fixed-arm-attempt",
				reservation: "atomic-before-admission",
				proposalAuthority: "direct-dependency-with-graph-state-conservation",
				timeoutAuthority: "copied-from-work-item-plan",
				maxOutputTokens: 16_384,
				reasoningEffort: "medium",
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
		[admissionFacts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if ((raw as AdmissionFact).kind === "eval-provider-capacity-state")
					ctx.down([["DATA", raw]]);
			}
		},
		{
			name: "eval/provider/adaptive-capacity-state",
			factory: "rootEvalAdaptiveProviderCapacityState",
			meta: { materialFree: true, domainAuthority: "graph-state", rebound: false },
		},
	);
	const budgets = owner.node<EvalBudgetState>(
		[admissionFacts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if ((raw as AdmissionFact).kind === "eval-budget-state") ctx.down([["DATA", raw]]);
			}
		},
		{ name: "eval/budget/state", factory: "rootEvalBudgetState" },
	);
	const toolAdmissions = owner.node<EvalAdmittedToolEffect>(
		[
			terminalProviderResultAdmissions,
			failedProviderResultAdmissions,
			sourceToolOutcomes,
			taskBindingAuthority,
		],
		(ctx) => {
			const graphTaskBindings = depLatest(ctx, 3) as readonly RootEvalTaskBinding[] | undefined;
			if (graphTaskBindings === undefined) return;
			let emitted = false;
			const state = ctx.state.get<{
				admitted: Set<string>;
				sourceOutcomes: Map<string, EvalProviderOutcome>;
				sourceProviderSettled: Set<string>;
				sourceSettled: Set<string>;
			}>() ?? {
				admitted: new Set<string>(),
				sourceOutcomes: new Map<string, EvalProviderOutcome>(),
				sourceProviderSettled: new Set<string>(),
				sourceSettled: new Set<string>(),
			};
			const candidates: EvalProviderOutcome[] = [];
			for (const raw of depBatch(ctx, 2) ?? []) {
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
				if (outcome.workItemRole === "source") state.sourceSettled.add(outcome.workItemId);
			}
			for (const dependencyIndex of [0, 1] as const) {
				for (const raw of depBatch(ctx, dependencyIndex) ?? []) {
					const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
					if (outcome.workItemRole === "source") {
						state.sourceProviderSettled.add(outcome.workItemId);
						if (outcome.status === "tool-proposed" && outcome.toolProposal !== null)
							state.sourceOutcomes.set(outcome.workItemId, outcome);
						continue;
					}
					if (outcome.status === "tool-proposed" && outcome.toolProposal !== null)
						candidates.push(outcome);
				}
			}
			if (state.sourceProviderSettled.size === replicateCount) {
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
					attempt: outcome.attempt,
					toolRef: proposal.toolRef,
					path: proposal.path,
					oldText: proposal.oldText,
					newText: proposal.newText,
					argumentsDigest: proposal.argumentsDigest,
				});
				const admission = Object.freeze({
					...material,
					receiptDigest: toolAdmissionReceiptDigest(material),
				});
				state.admitted.add(toolAdmissionId);
				emitted = true;
				ctx.down([["DATA", admission]]);
			}
			if (!emitted) ctx.down([["RESOLVED"]]);
			ctx.state.set(state);
		},
		{
			name: "eval/tool/exact-admission",
			factory: "rootEvalExactToolAdmission",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				toolRef: "graphrefly.eval.exact-tool.v1",
				arguments: "graph-admitted",
				sourceBarrier: "all-five-provider-outcomes-before-source-tools",
				sourceToolCapacity: 1,
			},
		},
	);
	const providerExecutorEffects = owner.node<EvalAdmittedEffect>(
		[providerAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", raw]]);
		},
		{
			name: "eval/executor/current-provider-effect",
			factory: "rootEvalProviderExecutorBoundary",
			partial: true,
		},
	);
	const toolExecutorEffects = owner.node<EvalAdmittedToolEffect>(
		[toolAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", raw]]);
		},
		{
			name: "eval/executor/current-tool-effect",
			factory: "rootEvalToolExecutorBoundary",
			partial: true,
		},
	);
	const retryDelayExecutorEffects = owner.node<EvalRetryDelayEffect>(
		[retryDelayAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", raw]]);
		},
		{
			name: "eval/executor/current-retry-delay",
			factory: "rootEvalRetryDelayExecutorBoundary",
			partial: true,
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
	const billingFacts = owner.node<BillingFact>(
		[cleanup, budgets, billingObservationOutcomes, currentKeyBeforeState, campaignStates],
		(ctx) => {
			let emitted = false;
			const state = ctx.state.get<BillingState>() ?? {
				completed: new Map<string, EvalCleanupFact>(),
				started: false,
				outstanding: false,
				finalized: false,
				observation: 0,
				observedChange: false,
				stableIntervals: 0,
				previous: null,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as EvalCleanupFact;
				state.completed.set(fact.workItemId, fact);
			}
			const before = depLatest(ctx, 3) as EvalCurrentKeySnapshot | undefined;
			const budget = depLatest(ctx, 1) as EvalBudgetState | undefined;
			const campaignState = depLatest(ctx, 4) as EvalCampaignState | undefined;
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
			for (const raw of depBatch(ctx, 2) ?? []) {
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
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: { maxObservations: 8, stableIntervals: 3, retryAuthority: "root-graph" },
		},
	);
	const billingObservationProposals = owner.node<EvalBillingObservationProposal>(
		[billingFacts],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? [])
				if ((raw as BillingFact).kind === "eval-billing-observation-proposal") {
					emitted = true;
					ctx.down([["DATA", raw]]);
				}
			if (!emitted) ctx.down([["RESOLVED"]]);
		},
		{
			name: "eval/billing/observation-proposals",
			factory: "rootEvalBillingObservationProposals",
		},
	);
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
			partial: true,
			meta: { authority: "root-graph", callerAuthority: "execute-current-effect-only" },
		},
	);
	const billingExecutorEffects = owner.node<EvalBillingObservationEffect>(
		[billingObservationAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", raw]]);
		},
		{
			name: "eval/executor/current-billing-observation",
			factory: "rootEvalBillingObservationExecutorBoundary",
			partial: true,
		},
	);
	const billingReconciliation = owner.node<EvalBillingReconciliation>(
		[billingFacts],
		(ctx) => {
			let emitted = false;
			for (const raw of depBatch(ctx, 0) ?? [])
				if ((raw as BillingFact).kind === "eval-billing-reconciliation") {
					emitted = true;
					ctx.down([["DATA", raw]]);
				}
			if (!emitted) ctx.down([["RESOLVED"]]);
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
	}>;
	interface EvalEffectLifecycleState {
		readonly active: Map<string, EvalExecutableEffect>;
		readonly settled: Map<string, string>;
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
	const providerEffectLifecycles = owner.node<EvalEffectLifecycleSnapshot>(
		[providerExecutorEffects, allProviderResultAdmissions, start],
		(ctx) => {
			const state = ctx.state.get<EvalEffectLifecycleState>() ?? {
				active: new Map<string, EvalExecutableEffect>(),
				settled: new Map<string, string>(),
			};
			const admitted = admitLifecycleEffects(state, depBatch(ctx, 0) ?? []);
			for (const raw of depBatch(ctx, 1) ?? [])
				settleLifecycleEffect(state, validateProviderOutcome(raw as EvalProviderOutcome));
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-effect-lifecycle-snapshot" as const,
						active: Object.freeze([...state.active.values()]),
						admitted: Object.freeze(admitted),
						admittedEffects: state.active.size + state.settled.size,
						settledEffects: state.settled.size,
					}),
				],
			]);
		},
		{
			name: "eval/executor/provider-effect-lifecycle-registry",
			factory: "rootEvalEffectLifecycleRegistry",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				domainAuthority: "graph-state",
				effectClass: "provider",
			},
		},
	);
	const createEffectLifecycle = (
		source: Node<unknown>,
		outcomeSource: Node<unknown>,
		validateOutcome: (raw: unknown) => Readonly<{
			readonly executionId: string;
			readonly resultDigest: string;
			readonly admission: EvalExecutableEffect;
		}>,
		name: string,
		factory: string,
		effectClass: string,
	) =>
		owner.node<EvalEffectLifecycleSnapshot>(
			[source, outcomeSource, start],
			(ctx) => {
				const state = ctx.state.get<EvalEffectLifecycleState>() ?? {
					active: new Map<string, EvalExecutableEffect>(),
					settled: new Map<string, string>(),
				};
				const admitted = admitLifecycleEffects(state, depBatch(ctx, 0) ?? []);
				for (const raw of depBatch(ctx, 1) ?? [])
					settleLifecycleEffect(state, validateOutcome(raw));
				ctx.state.set(state);
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-effect-lifecycle-snapshot" as const,
							active: Object.freeze([...state.active.values()]),
							admitted: Object.freeze(admitted),
							admittedEffects: state.active.size + state.settled.size,
							settledEffects: state.settled.size,
						}),
					],
				]);
			},
			{
				name,
				factory,
				partial: true,
				completeWhenDepsComplete: false,
				errorWhenDepsError: false,
				meta: { domainAuthority: "graph-state", effectClass },
			},
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
		(raw) => validateOutcomeReceipt(raw as EvalEffectOutcome),
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
								admittedEffects: snapshot.admittedEffects,
								settledEffects: snapshot.settledEffects,
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
				budget.providerOutcomeReasonCounts["transport-retryable"] +
				budget.providerOutcomeReasonCounts["http-429-retryable"];
			const activeAdmittedEffects =
				activeProviderEffects + activeToolEffects + activeRetryEffects + activeBillingEffects;
			const lifecycleConserved = (activity: EvalEffectClassActivitySnapshot) =>
				activity.activeEffects === activity.admittedEffects - activity.settledEffects;
			if (
				![provider, tool, retry, billing].every(lifecycleConserved) ||
				activeProviderEffects !== budget.activeEffects ||
				provider.admittedEffects !== budget.admittedAttempts ||
				provider.settledEffects !== providerReasonTotal ||
				retry.admittedEffects !== retryableReasonTotal ||
				retry.settledEffects !== budget.admittedRetryAttempts ||
				activeAdmittedEffects > HARNESS_ARMS.length ||
				(activeBillingEffects > 0 && activeAdmittedEffects !== activeBillingEffects)
			) {
				ctx.down([["RESOLVED"]]);
				return;
			}
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-effect-activity-snapshot" as const,
						budgetDigest: empiricalStrictJsonDigest(budget),
						budget,
						activeProviderEffects,
						activeToolEffects,
						activeRetryEffects,
						activeBillingEffects,
						activeAdmittedEffects,
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
	const matchedEvidence = owner.node<EvalMatchedEvidence>(
		[
			cleanup,
			allProviderResultAdmissions,
			sourceMemoryHandoff.status,
			sourceRequestAuthority,
			start,
		],
		(ctx) => {
			const state = ctx.state.get<{
				cleanup: Map<string, EvalCleanupFact>;
				providerReasons: Map<string, EvalProviderOutcomeReason>;
				verifiedSources: Set<number>;
				sourceTechnicalExclusions: Map<number, EvalSourceTechnicalExclusionFact>;
			}>() ?? {
				cleanup: new Map<string, EvalCleanupFact>(),
				providerReasons: new Map<string, EvalProviderOutcomeReason>(),
				verifiedSources: new Set<number>(),
				sourceTechnicalExclusions: new Map<number, EvalSourceTechnicalExclusionFact>(),
			};
			let changed = (depBatch(ctx, 4)?.length ?? 0) > 0;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as EvalCleanupFact;
				state.cleanup.set(fact.workItemId, fact);
				changed = true;
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const outcome = raw as EvalProviderOutcome;
				state.providerReasons.set(outcome.workItemId, outcome.reason);
				changed = true;
			}
			for (const raw of depBatch(ctx, 2) ?? []) {
				const status = raw as AdmissionHandoffStatus;
				if (status.state !== "accepted" && status.state !== "rejected") continue;
				const requests = depLatest(ctx, 3) as readonly EvalSourceWorkItemRequest[] | undefined;
				const request = requests?.find(
					(candidate) => candidate.sourceWorkItemId === status.candidateId,
				);
				if (request === undefined)
					throw new TypeError("matched evidence source status lacked a sealed request");
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
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				semanticAuthority: "verification-diagnostics-stage-counts",
				billingAuditAffectsConclusion: false,
			},
		},
	);
	const findings = owner.node<EvalFinding>(
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
			name: "eval/findings/efficacy",
			factory: "rootEvalEfficacyFinding",
			partial: true,
			meta: {
				billingAuditAffectsConclusion: false,
				semanticAuthority: "verification-diagnostics-stage-counts",
			},
		},
	);
	const developmentQualification = owner.node<EvalDevelopmentQualificationState>(
		[campaignContract, findings],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
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
			for (const raw of depBatch(ctx, 1) ?? []) {
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
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				materialFree: true,
				authority: "d145-two-consecutive-five-replicate-development-generations",
				requiredConsecutiveGenerations: 2,
			},
		},
	);
	const terminalLifecycleConsistency = owner.node<{
		readonly kind: "eval-terminal-lifecycle-consistency";
		readonly status: "pending" | "consistent";
		readonly budgetDigest: string | null;
	}>(
		[findings, effectActivity, budgets, start],
		(ctx) => {
			const finding = depLatest(ctx, 0) as EvalFinding | undefined;
			if (finding === undefined) {
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "eval-terminal-lifecycle-consistency" as const,
							status: "pending" as const,
							budgetDigest: null,
						}),
					],
				]);
				return;
			}
			const activity = depLatest(ctx, 1) as EvalEffectActivitySnapshot;
			const budget = depLatest(ctx, 2) as EvalBudgetState;
			const providerReasonTotal = EVAL_PROVIDER_OUTCOME_REASON_CODES.reduce(
				(total, reason) => total + budget.providerOutcomeReasonCounts[reason],
				0,
			);
			const retryableReasonTotal =
				budget.providerOutcomeReasonCounts["transport-retryable"] +
				budget.providerOutcomeReasonCounts["http-429-retryable"];
			if (
				activity.activeAdmittedEffects !== 0 ||
				budget.activeEffects !== 0 ||
				activity.budgetDigest !== empiricalStrictJsonDigest(budget) ||
				budget.admittedAttempts !== providerReasonTotal ||
				budget.admittedRetryAttempts !== retryableReasonTotal ||
				budget.pendingRetryProposalCount !== 0 ||
				budget.rejectedRetryProposalCount !== 0 ||
				budget.retryProposalCount !== budget.admittedRetryAttempts ||
				budget.settledRetryAttemptCount !== budget.admittedRetryAttempts ||
				finding.admittedAttempts !== budget.admittedAttempts
			)
				throw new TypeError("root eval terminal lifecycle consistency drifted");
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-terminal-lifecycle-consistency" as const,
						status: "consistent" as const,
						budgetDigest: empiricalStrictJsonDigest(budget),
					}),
				],
			]);
		},
		{
			name: "eval/observation/terminal-lifecycle-consistency",
			factory: "rootEvalTerminalLifecycleConsistency",
			partial: true,
			completeWhenDepsComplete: false,
			meta: {
				materialFree: true,
				failClosed: true,
				authority: "terminal-stable-cut-verifier",
			},
		},
	);

	type EvalObservationInputs = readonly [
		EvalCampaignState,
		typeof MEMORY_PROVENANCE,
		EvalEfficacyState,
		EvalDevelopmentQualificationState,
	];
	const observationInputs = owner.initNode(
		combine<EvalObservationInputs>(),
		[campaignStates, memoryProvenance, efficacyStates, developmentQualification],
		{
			name: "eval/observation/inputs",
			meta: { materialFree: true, authority: "graph-native-combine" },
		},
	);
	const observationEvents = owner.node<EvalObservationInputs | EvalFinding>(
		[observationInputs, findings],
		(ctx) => {
			for (let index = 0; index < 2; index += 1)
				for (const raw of depBatch(ctx, index) ?? []) ctx.down([["DATA", raw]]);
		},
		{
			name: "eval/observation/events",
			factory: "rootEvalObservationEvents",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				materialFree: true,
				authority: "progress-or-terminal-finding",
			},
		},
	);
	interface EvalObservationProjectionState {
		inputs?: EvalObservationInputs;
		finding?: EvalFinding;
		effectActivity?: EvalEffectActivitySnapshot;
		providerCapacity?: EvalProviderCapacityState;
		elapsedBudget?: EvalElapsedBudgetState;
		terminalConsistencyBudgetDigest?: string | null;
		digest?: string;
		terminal: boolean;
	}
	const observation = owner.node<EvalObservation>(
		[
			observationEvents,
			effectActivity,
			terminalLifecycleConsistency,
			providerCapacity,
			elapsedBudget,
		],
		(ctx) => {
			const state = ctx.state.get<EvalObservationProjectionState>() ?? { terminal: false };
			const emit = () => {
				if (
					state.inputs === undefined ||
					state.effectActivity === undefined ||
					state.providerCapacity === undefined ||
					state.elapsedBudget === undefined
				)
					return;
				const [campaignState, provenance, efficacyState, qualification] = state.inputs;
				const { diagnostics } = efficacyState;
				const { budget } = state.effectActivity;
				const {
					activeProviderEffects,
					activeToolEffects,
					activeRetryEffects,
					activeBillingEffects,
					activeAdmittedEffects,
				} = state.effectActivity;
				const providerReasonTotal = EVAL_PROVIDER_OUTCOME_REASON_CODES.reduce(
					(total, reason) => total + budget.providerOutcomeReasonCounts[reason],
					0,
				);
				if (
					state.providerCapacity.activeEffects !== activeProviderEffects ||
					state.providerCapacity.admittedProposalCount !== budget.admittedAttempts ||
					state.providerCapacity.settledProposalCount !== providerReasonTotal ||
					state.providerCapacity.pendingRetryProposalCount !== budget.pendingRetryProposalCount ||
					state.providerCapacity.retryProposalCount !== budget.retryProposalCount ||
					state.providerCapacity.admittedRetryProposalCount !== budget.admittedRetryAttempts ||
					state.providerCapacity.settledRetryProposalCount !== budget.settledRetryAttemptCount ||
					state.providerCapacity.rejectedRetryProposalCount !== budget.rejectedRetryProposalCount
				)
					return;
				const terminal =
					state.finding !== undefined &&
					(campaignPurpose !== "development" || qualification.status !== "pending") &&
					activeAdmittedEffects === 0 &&
					state.terminalConsistencyBudgetDigest === state.effectActivity.budgetDigest;
				const terminalDiagnostics = terminal ? state.finding!.verificationDiagnostics : diagnostics;
				const stoppingReason = terminal
					? state.finding!.stoppingReason
					: budget.stoppingReason !== "none"
						? budget.stoppingReason
						: campaignState.stoppingReason;
				if (
					(stoppingReason === "elapsed-budget-exhausted") !==
					(state.elapsedBudget.state === "exhausted")
				)
					return;
				const value = strictSnapshot({
					kind: "eval-observation" as const,
					topologyRevision: ROOT_EVAL_TOPOLOGY_REVISION,
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
					evaluableReplicates: terminal ? state.finding!.evaluableReplicates : null,
					excludedTechnicalReplicates: terminal
						? state.finding!.excludedTechnicalReplicates
						: campaignState.sourceTechnicalExcludedReplicates,
					sourceTechnicalExcludedReplicates: campaignState.sourceTechnicalExcludedReplicates,
					matchedRelevantOverColdWins: terminal ? state.finding!.matchedRelevantOverColdWins : null,
					completedArms: campaignState.completedArms,
					verificationDiagnostics: terminalDiagnostics,
					activeProviderEffects,
					activeToolEffects,
					activeRetryEffects,
					activeBillingEffects,
					activeAdmittedEffects,
					providerCapacity: state.providerCapacity,
					elapsedBudget: state.elapsedBudget,
					admittedAttempts: terminal ? state.finding!.admittedAttempts : budget.admittedAttempts,
					admittedRetryAttempts: budget.admittedRetryAttempts,
					retryProposalCount: budget.retryProposalCount,
					pendingRetryProposalCount: budget.pendingRetryProposalCount,
					rejectedRetryProposalCount: budget.rejectedRetryProposalCount,
					settledRetryAttemptCount: budget.settledRetryAttemptCount,
					providerCallCount: terminal ? state.finding!.providerCallCount : budget.providerCallCount,
					activeReservedMicrousd: terminal
						? state.finding!.activeReservedMicrousd
						: budget.activeReservedMicrousd,
					providerReportedMicrousd: terminal
						? state.finding!.providerReportedMicrousd
						: budget.providerReportedMicrousd,
					pricingRoundingAllowanceMicrousd: terminal
						? state.finding!.pricingRoundingAllowanceMicrousd
						: budget.pricingRoundingAllowanceMicrousd,
					providerReportedLowerBoundMicrousd: terminal
						? state.finding!.providerReportedLowerBoundMicrousd
						: Math.max(
								0,
								budget.providerReportedMicrousd - budget.pricingRoundingAllowanceMicrousd,
							),
					unreportedSettledUpperBoundMicrousd: terminal
						? state.finding!.unreportedSettledUpperBoundMicrousd
						: budget.unreportedSettledUpperBoundMicrousd,
					accountedUpperBoundMicrousd: terminal
						? state.finding!.accountedUpperBoundMicrousd
						: budget.accountedUpperBoundMicrousd,
					observedBilledMicrousd: terminal ? state.finding!.observedBilledMicrousd : null,
					billingObservationCount: terminal ? state.finding!.billingObservationCount : 0,
					billingStableIntervals: terminal ? state.finding!.billingStableIntervals : 0,
					reconciledBilledMicrousd: terminal ? state.finding!.reconciledBilledMicrousd : null,
					billingDisposition: terminal ? state.finding!.billingDisposition : ("pending" as const),
					providerOutcomeReasonCounts: terminal
						? state.finding!.providerOutcomeReasonCounts
						: budget.providerOutcomeReasonCounts,
					stoppingReason,
					finding: terminal ? state.finding!.finding : ("pending" as const),
				});
				const digest = empiricalStrictJsonDigest(value);
				if (state.digest === digest) return;
				if (state.terminal)
					throw new TypeError("eval observation changed after its terminal finding");
				state.digest = digest;
				state.terminal = terminal;
				ctx.down([["DATA", value]]);
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (Array.isArray(raw)) state.inputs = raw as unknown as EvalObservationInputs;
				else state.finding = raw as EvalFinding;
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				state.effectActivity = raw as EvalEffectActivitySnapshot;
			}
			for (const raw of depBatch(ctx, 2) ?? []) {
				state.terminalConsistencyBudgetDigest = (
					raw as { readonly budgetDigest: string | null }
				).budgetDigest;
			}
			for (const raw of depBatch(ctx, 3) ?? []) {
				state.providerCapacity = raw as EvalProviderCapacityState;
			}
			for (const raw of depBatch(ctx, 4) ?? []) {
				state.elapsedBudget = raw as EvalElapsedBudgetState;
			}
			ctx.state.set(state);
			emit();
		},
		{
			name: "eval/observation",
			factory: "rootEvalGraphNativeObservation",
			partial: true,
			completeWhenDepsComplete: false,
			meta: {
				materialFree: true,
				sanitizer: false,
				authority: "read-only-projection",
				distinct: true,
				billingAuditAffectsConclusion: false,
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
		findings.subscribe(() => undefined),
	];
	let keepalivesReleased = false;
	const releaseKeepalives = () => {
		if (keepalivesReleased) return;
		keepalivesReleased = true;
		for (const stop of keepaliveStops) stop();
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
			workItems,
			memoryProvenance,
			providerProposals: proposals,
			providerAdmissions,
			providerCapacity,
			elapsedBudgetTimerSource,
			elapsedBudget,
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
			developmentQualification,
			terminalLifecycleConsistency,
			observation,
		},
	});
	return topology;
}

export async function runRootEval(
	topology: RootEvalTopology,
	executor: (effect: EvalExecutableEffect) => Promise<EvalExecutorOutcome>,
	options: Readonly<{ readonly signal?: AbortSignal }> = {},
): Promise<RootEvalRunResult> {
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
): Promise<RootEvalRunResult> {
	const observationEvents: ObserveEvent[] = [];
	const executed = new Set<string>();
	const scheduled = new Set<string>();
	const inFlight = new Set<Promise<void>>();
	let activeProviderExecutions = 0;
	let peakConcurrentEffects = 0;
	let settled = false;
	let graphStopReason: EvalBudgetState["stoppingReason"] = "none";
	let latestBudget: EvalBudgetState | undefined;
	return new Promise<RootEvalRunResult>((resolve, reject) => {
		let finding: EvalFinding | undefined;
		let terminalObservation: EvalObservation | undefined;
		let stopEffects: () => void = () => undefined;
		let stopFinding: () => void = () => undefined;
		let stopObservation: () => void = () => undefined;
		let stopBudget: () => void = () => undefined;
		let stopTerminalProviderResultAdmission: () => void = () => undefined;
		let stopFailedProviderResultAdmission: () => void = () => undefined;
		let stopRetryableProviderResultAdmission: () => void = () => undefined;
		let stopAbortSignal: () => void = () => undefined;
		const stopSubscriptions = () => {
			stopEffects();
			stopFinding();
			stopObservation();
			stopBudget();
			stopTerminalProviderResultAdmission();
			stopFailedProviderResultAdmission();
			stopRetryableProviderResultAdmission();
			stopAbortSignal();
			releaseKeepalives();
		};
		const abort = (error: unknown) => {
			if (settled) return;
			settled = true;
			stopSubscriptions();
			void Promise.allSettled([...inFlight]).then(() => reject(error));
		};
		const maybeFinishGraphStop = () => {
			if (
				!settled &&
				graphStopReason !== "none" &&
				latestBudget?.activeEffects === 0 &&
				inFlight.size === 0
			)
				abort(new Error(`root eval stopped: ${graphStopReason}`));
		};
		const finish = (observation: EvalObservation) => {
			if (settled || finding === undefined || observation.finding === "pending") return;
			settled = true;
			stopSubscriptions();
			const result = Object.freeze({
				finding,
				observations: Object.freeze([...observationEvents]),
				peakConcurrentEffects,
				executedAdmissionIds: Object.freeze([...executed].sort()),
			});
			void Promise.allSettled([...inFlight]).then(() => resolve(result));
		};
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
				if (value.finding !== "pending") terminalObservation = value;
				finish(value);
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
		stopBudget = topology.nodes.budgets.subscribe((message) => {
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
			const budget = message[1] as EvalBudgetState;
			latestBudget = budget;
			if (budget.stoppingReason !== "none") graphStopReason = budget.stoppingReason;
			maybeFinishGraphStop();
		});
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
			if (settled) return;
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
						await new Promise<void>((releaseExecutionTurn) => setTimeout(releaseExecutionTurn, 0));
						const outcome = await executor(effect);
						if (settled) return;
						try {
							if (effect.kind === "eval-admitted-effect") {
								const validated = Object.freeze(
									validateProviderOutcome(outcome as EvalProviderOutcome),
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
											attempt: effect.attempt,
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
						maybeFinishGraphStop();
					},
					() => {
						inFlight.delete(execution);
						maybeFinishGraphStop();
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
