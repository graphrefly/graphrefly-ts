import { depBatch, depLatest } from "../../src/ctx/types.js";
import { combine } from "../../src/graph/combinators.js";
import { type Graph, graph } from "../../src/graph/graph.js";
import type { ObserveEvent } from "../../src/graph/inspect.js";
import type { Node } from "../../src/node/node.js";
import type { AgentRequestIssued, EffectRunResult } from "../../src/orchestration/agent-runtime.js";
import {
	type AgenticMemoryRecord,
	type AgenticMemoryRecordAdmissionPolicy,
	type AgenticMemoryRecordApplicationPolicy,
	type AgenticMemoryRecordUseDecision,
	type AgenticMemoryRecordUseRequest,
	agenticMemoryBundle,
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

export const ROOT_EVAL_TOPOLOGY_REVISION = "graphrefly-ts.root-eval-topology.v8" as const;
export const ROOT_EVAL_REPLICATE_COUNT = 5 as const;
export const ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS = 300_000 as const;
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

export interface EvalArmDispatch {
	readonly kind: "eval-arm-dispatch";
	readonly campaignRef: string;
	readonly replicate: number;
	readonly arm: HarnessArm;
	readonly armIndex: number;
	readonly workItemId: string;
	readonly memoryProvenance: EvalMemoryProvenance;
}

export interface EvalCampaignState {
	readonly kind: "eval-campaign-state";
	readonly campaignRef: string;
	readonly replicate: number;
	readonly replicateCount: number;
	readonly completedArms: number;
	readonly state: "running" | "stopped";
	readonly stoppingReason: "none" | "campaign-complete" | "budget-exhausted" | "effect-failed";
}

export interface EvalEffectProposal {
	readonly kind: "eval-effect-proposal";
	readonly proposalId: string;
	readonly effectRunId: string;
	readonly operationId: string;
	readonly workItemId: string;
	readonly replicate: number;
	readonly arm: HarnessArm;
	readonly attempt: 1 | 2;
	readonly reservationMicrousd: number;
	readonly timeoutMs: number;
	readonly maxOutputTokens: number;
	readonly reasoningEffort: "medium";
	readonly workItemPlanId: string;
	readonly workItemPlanDigest: string;
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
	readonly arm: HarnessArm;
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
	readonly arm: HarnessArm;
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
	readonly arm: HarnessArm;
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
	readonly arm: HarnessArm;
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
	readonly stoppingReason: "none" | "budget-exhausted";
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
	readonly replicate: number;
	readonly armOrder: typeof HARNESS_ARMS;
	readonly memoryProvenance: Readonly<Record<HarnessArm, EvalMemoryProvenance>>;
	readonly completedArms: number;
	readonly verificationDiagnostics: EvalVerificationDiagnostics;
	readonly activeProviderEffects: number;
	readonly activeToolEffects: number;
	readonly activeRetryEffects: number;
	readonly activeBillingEffects: number;
	readonly activeAdmittedEffects: number;
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
	readonly maxAttempts?: number;
	readonly maxCostMicrousd?: number;
	readonly reservationMicrousd?: number;
	readonly effectTimeoutMs?: number;
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
	readonly inputs: {
		readonly start: Node<{ readonly kind: "eval-campaign-start"; readonly campaignRef: string }>;
	};
	runAdmittedEffects(
		executor: (effect: EvalExecutableEffect) => Promise<EvalExecutorOutcome>,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): Promise<RootEvalRunResult>;
	readonly nodes: {
		readonly workItems: Node<WorkItemProjection<Record<string, unknown>>>;
		readonly memoryProvenance: Node<Readonly<Record<HarnessArm, EvalMemoryProvenance>>>;
		readonly providerProposals: Node<EvalEffectProposal>;
		readonly providerAdmissions: Node<EvalAdmittedEffect>;
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
}

interface AdmissionState {
	admittedKeys: Set<string>;
	settledAdmissionIds: Set<string>;
	active: Map<string, EvalAdmittedEffect>;
	pendingRetryProposals: Map<string, EvalEffectProposal>;
	retryProposalKeys: Set<string>;
	rejectedRetryProposalKeys: Set<string>;
	admittedAttempts: number;
	admittedRetryAttempts: number;
	settledRetryAttempts: number;
	providerCallCount: number;
	activeReservedMicrousd: number;
	providerReportedMicrousd: number;
	pricingRoundingAllowanceMicrousd: number;
	unreportedSettledUpperBoundMicrousd: number;
	providerOutcomeReasonCounts: Record<EvalProviderOutcomeReason, number>;
	stoppingReason: "none" | "budget-exhausted";
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

const ROOT_EVAL_SOLUTION_IDENTITIES = Object.freeze([
	"work-item-execution",
	"agentic-work-item-memory-application",
	"agentic-memory-record-use",
	"agentic-memory-retrieval",
] as const);

function workItemId(campaignRef: string, replicate: number, arm: HarnessArm): string {
	return `${campaignRef}/replicate-${replicate}/${arm}`;
}

function dispatchBatch(campaignRef: string, replicate: number): readonly EvalArmDispatch[] {
	return Object.freeze(
		HARNESS_ARMS.map((arm, armIndex) =>
			Object.freeze({
				kind: "eval-arm-dispatch" as const,
				campaignRef,
				replicate,
				arm,
				armIndex,
				workItemId: workItemId(campaignRef, replicate, arm),
				memoryProvenance: MEMORY_PROVENANCE[arm],
			}),
		),
	);
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
		"workItemId" | "workItemPlanId" | "workItemPlanDigest" | "timeoutMs"
	>,
	plan: EvalWorkItemPlanSnapshot,
): void {
	const member = plan.members[0];
	const limits = member?.limits;
	if (
		plan.workItemId !== proposal.workItemId ||
		plan.planId !== proposal.workItemPlanId ||
		plan.members.length !== 1 ||
		member?.memberId !== "provider-and-exact-tool" ||
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
					replicate: dispatch.replicate,
					arm: dispatch.arm,
				}),
			},
			tNs: BigInt(dispatch.replicate * 10 + dispatch.armIndex),
			confidence: 1,
			tags: relevant ? ["relevant", "eval-memory"] : ["irrelevant", "eval-memory"],
			sources: [dispatch.workItemId],
		},
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
			workItemId: dispatch.workItemId,
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material" as const,
				operation: "create" as const,
				operationVersion: 1 as const,
				record: memoryRecord(dispatch),
				sourceRefs: [{ kind: "eval-memory-provenance", id: dispatch.memoryProvenance }],
			},
			sourceRefs: [{ kind: "eval-arm", id: dispatch.arm }],
		}),
	]);
}

function memoryAdmissionPolicy(dispatch: EvalArmDispatch): AgenticMemoryRecordAdmissionPolicy {
	const defaultState =
		dispatch.arm === "proposal-only"
			? "needs-review"
			: dispatch.arm === "admission-rejected"
				? "rejected"
				: "admitted";
	return Object.freeze({
		kind: "agentic-memory-record-admission-policy",
		policyId: `${dispatch.workItemId}/memory-admission-policy`,
		defaultState,
	});
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

function dispatchFromWorkItem(item: WorkItemProjection<Record<string, unknown>>): EvalArmDispatch {
	const arm = item.customFields?.arm;
	const replicate = item.customFields?.replicate;
	const campaignRef = item.customFields?.campaignRef;
	if (
		typeof campaignRef !== "string" ||
		typeof replicate !== "number" ||
		typeof arm !== "string" ||
		!HARNESS_ARMS.includes(arm as HarnessArm)
	)
		throw new TypeError("memory WorkItem lost its eval provenance");
	const typedArm = arm as HarnessArm;
	return Object.freeze({
		kind: "eval-arm-dispatch",
		campaignRef,
		replicate,
		arm: typedArm,
		armIndex: HARNESS_ARMS.indexOf(typedArm),
		workItemId: item.workItemId,
		memoryProvenance: MEMORY_PROVENANCE[typedArm],
	});
}

function dispatchFromPolicyId(policyId: string, suffix: string): EvalArmDispatch {
	const id = policyId.endsWith(suffix) ? policyId.slice(0, -suffix.length) : "";
	const arm = armFromWorkItemId(id);
	const replicate = replicateFromWorkItemId(id);
	const marker = `/replicate-${replicate}/`;
	const campaignRef = id.slice(0, id.indexOf(marker));
	if (arm === undefined || replicate < 1 || campaignRef.length === 0)
		throw new TypeError("memory policy lost its eval provenance");
	return Object.freeze({
		kind: "eval-arm-dispatch",
		campaignRef,
		replicate,
		arm,
		armIndex: HARNESS_ARMS.indexOf(arm),
		workItemId: id,
		memoryProvenance: MEMORY_PROVENANCE[arm],
	});
}

function armFromWorkItemId(id: string): HarnessArm | undefined {
	return HARNESS_ARMS.find((arm) => id.endsWith(`/${arm}`));
}

function replicateFromWorkItemId(id: string): number {
	const match = /\/replicate-(\d+)\//.exec(id);
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
		outcome.attempt !== admission.attempt ||
		armFromWorkItemId(outcome.workItemId) !== outcome.arm ||
		replicateFromWorkItemId(outcome.workItemId) !== outcome.replicate ||
		typeof outcome.dispatchAttempted !== "boolean" ||
		!Number.isSafeInteger(outcome.costMicrousd) ||
		outcome.costMicrousd < 0 ||
		outcome.costMicrousd > admission.reservationMicrousd ||
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
		(outcome.status === "retryable") !==
			(outcome.reason === "http-429-retryable" || outcome.reason === "transport-retryable") ||
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
		outcome.attempt !== admission.attempt ||
		armFromWorkItemId(outcome.workItemId) !== outcome.arm ||
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
	replicate: number,
	replicateCount: number,
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
				replicate,
				replicateCount,
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
	"replicate",
	"armOrder",
	"memoryProvenance",
	"completedArms",
	"verificationDiagnostics",
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
		assertVerificationReasonStageConsistency(
			stages,
			reasons,
			ROOT_EVAL_REPLICATE_COUNT,
			`${label}.${arm}`,
		);
	}
	const completedWorkItems = safeInteger(root.completedWorkItems, `${label}.completedWorkItems`, {
		max: ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length,
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

export function assertRootEvalObservationRuntimeShape(
	observation: EvalObservation,
	label: string,
): void {
	const root = record(observation, label);
	exactKeys(root, ROOT_EVAL_OBSERVATION_KEYS, label);
	literal(root.kind, "eval-observation", `${label}.kind`);
	literal(root.topologyRevision, ROOT_EVAL_TOPOLOGY_REVISION, `${label}.topologyRevision`);
	coordinate(root.campaignRef, `${label}.campaignRef`);
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
	safeInteger(root.replicate, `${label}.replicate`, {
		min: 1,
		max: ROOT_EVAL_REPLICATE_COUNT,
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
	const admittedAttempts = safeInteger(root.admittedAttempts, `${label}.admittedAttempts`);
	const admittedRetryAttempts = safeInteger(
		root.admittedRetryAttempts,
		`${label}.admittedRetryAttempts`,
		{ max: ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length },
	);
	const retryProposalCount = safeInteger(root.retryProposalCount, `${label}.retryProposalCount`, {
		max: ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length,
	});
	const pendingRetryProposalCount = safeInteger(
		root.pendingRetryProposalCount,
		`${label}.pendingRetryProposalCount`,
		{ max: ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length },
	);
	const rejectedRetryProposalCount = safeInteger(
		root.rejectedRetryProposalCount,
		`${label}.rejectedRetryProposalCount`,
		{ max: ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length },
	);
	const settledRetryAttemptCount = safeInteger(
		root.settledRetryAttemptCount,
		`${label}.settledRetryAttemptCount`,
		{ max: ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length },
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
		root.finding !== "no-positive-differential"
	)
		throw new TypeError(`${label}.finding invalid`);
	assertVerificationDiagnosticsRuntimeShape(
		root.verificationDiagnostics as EvalVerificationDiagnostics,
		`${label}.verificationDiagnostics`,
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
		(root.billingDisposition !== "pending" ||
			root.observedBilledMicrousd !== null ||
			root.billingObservationCount !== 0 ||
			root.billingStableIntervals !== 0 ||
			root.reconciledBilledMicrousd !== null)
	)
		throw new TypeError(`${label} finding/billing lifecycle drifted`);
}

export function assertRootEvalObservationTransition(
	previous: EvalObservation,
	current: EvalObservation,
	label: string,
): void {
	if (
		current.replicate < previous.replicate ||
		current.replicate > previous.replicate + 1 ||
		(current.replicate === previous.replicate && current.completedArms < previous.completedArms) ||
		(current.replicate === previous.replicate + 1 &&
			(previous.completedArms !== HARNESS_ARMS.length || current.completedArms !== 1)) ||
		current.verificationDiagnostics.completedWorkItems <
			previous.verificationDiagnostics.completedWorkItems ||
		current.retryProposalCount < previous.retryProposalCount ||
		current.admittedRetryAttempts < previous.admittedRetryAttempts ||
		current.rejectedRetryProposalCount < previous.rejectedRetryProposalCount ||
		current.settledRetryAttemptCount < previous.settledRetryAttemptCount
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
		first.replicate !== 1 ||
		first.completedArms !== 0 ||
		first.verificationDiagnostics.completedWorkItems !== 0
	)
		throw new TypeError(`${label} initial campaign state was missing`);
	let terminalCount = 0;
	for (let index = 0; index < observations.length; index += 1) {
		const current = observations[index]!;
		const expectedCompletedWorkItems =
			(current.replicate - 1) * HARNESS_ARMS.length + current.completedArms;
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
	);
	for (const field of [
		"replicateCount",
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
			max: ROOT_EVAL_REPLICATE_COUNT,
		});
	if (
		finding.replicateCount !== ROOT_EVAL_REPLICATE_COUNT ||
		finding.armOrder.length !== HARNESS_ARMS.length ||
		finding.armOrder.some((arm, index) => arm !== HARNESS_ARMS[index]) ||
		finding.completedWorkItems !== ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length ||
		finding.verificationDiagnostics.completedWorkItems !== finding.completedWorkItems ||
		finding.verificationDiagnostics.armOrder.some((arm, index) => arm !== HARNESS_ARMS[index])
	)
		throw new TypeError("root eval finding structural diagnostics drifted");
	for (const arm of HARNESS_ARMS) {
		const stages = finding.verificationDiagnostics.stageCounts[arm];
		const reasons = finding.verificationDiagnostics.terminalReasonCounts[arm];
		assertVerificationReasonStageConsistency(stages, reasons, finding.replicateCount, arm);
		if (
			stages.completedWorkItems !== finding.replicateCount ||
			finding.passCounts[arm] !== stages.passed
		)
			throw new TypeError("root eval finding pass counts drifted from diagnostics");
	}
	const computedFinding =
		finding.passCounts["relevant-applied"] >
		Math.max(
			...HARNESS_ARMS.filter((arm) => arm !== "relevant-applied").map(
				(arm) => finding.passCounts[arm],
			),
		)
			? "positive-differential"
			: "no-positive-differential";
	if (finding.finding !== computedFinding)
		throw new TypeError("root eval finding conclusion drifted from pass counts");
	if (terminal === undefined) return;
	assertRootEvalObservationRuntimeShape(terminal, "root eval terminal observation");
	if (
		terminal.campaignRef !== finding.campaignRef ||
		terminal.replicate !== finding.replicateCount ||
		terminal.completedArms !== HARNESS_ARMS.length ||
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
	const replicateCount = ROOT_EVAL_REPLICATE_COUNT;
	const maxAttempts = options.maxAttempts ?? replicateCount * HARNESS_ARMS.length * 2;
	const maxCostMicrousd = options.maxCostMicrousd ?? 100_000;
	const reservationMicrousd = options.reservationMicrousd ?? 1_000;
	const effectTimeoutMs = options.effectTimeoutMs ?? ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS;
	if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)
		throw new TypeError("maxAttempts must be a positive safe integer");
	if (!Number.isSafeInteger(maxCostMicrousd) || maxCostMicrousd < 1)
		throw new TypeError("maxCostMicrousd must be a positive safe integer");
	if (!Number.isSafeInteger(reservationMicrousd) || reservationMicrousd < 1)
		throw new TypeError("reservationMicrousd must be a positive safe integer");
	if (!Number.isSafeInteger(effectTimeoutMs) || effectTimeoutMs < 1 || effectTimeoutMs > 300_000)
		throw new TypeError("effectTimeoutMs must be a bounded positive safe integer");
	if (options.profileInput === undefined)
		throw new TypeError("root eval requires a Graph-admitted exact profile input");
	const currentKeyBefore = validateCurrentKeySnapshot(options.currentKeyBefore);

	const owner = graph({ name: "eval/root" });
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
	const terminalProviderOutcomes = owner.node<EvalProviderOutcome>([], null, {
		name: "eval/provider/result-input",
		factory: "rootEvalTerminalProviderResultInput",
		meta: { materialPolicy: "digest-and-coordinate-only", acceptedStatus: "non-retryable" },
	});
	const retryableProviderOutcomes = owner.node<EvalProviderOutcome>([], null, {
		name: "eval/provider/retryable-result-input",
		factory: "rootEvalRetryableProviderResultInput",
		meta: { materialPolicy: "digest-and-coordinate-only", acceptedStatus: "retryable" },
	});
	const terminalProviderResultAdmissions = owner.node<EvalProviderOutcome>(
		[terminalProviderOutcomes],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (outcome.status === "retryable")
					throw new TypeError("terminal provider result input rejects a retryable outcome");
				ctx.down([["DATA", outcome]]);
			}
		},
		{
			name: "eval/provider/result-admission",
			factory: "rootEvalProviderResultAdmission",
			meta: {
				authority: "root-graph",
				maxAttemptsPerWorkItem: 2,
				callerAuthority: "submit-correlated-result-data-only",
			},
		},
	);
	const retryableProviderResultAdmissions = owner.node<EvalProviderOutcome>(
		[retryableProviderOutcomes],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (outcome.status !== "retryable")
					throw new TypeError("retryable provider result input requires retryable DATA");
				if (outcome.attempt !== 1)
					throw new TypeError("second eval attempt cannot request another retry");
				ctx.down([["DATA", outcome]]);
			}
		},
		{
			name: "eval/provider/retryable-result-admission",
			factory: "rootEvalRetryableProviderResultAdmission",
			meta: {
				authority: "root-graph",
				maxAttemptsPerWorkItem: 2,
				callerAuthority: "submit-correlated-result-data-only",
			},
		},
	);
	const allProviderResultAdmissions = owner.node<EvalProviderOutcome>(
		[terminalProviderResultAdmissions, retryableProviderResultAdmissions],
		(ctx) => {
			const outcomes = [...(depBatch(ctx, 0) ?? []), ...(depBatch(ctx, 1) ?? [])];
			if (outcomes.length > 0)
				ctx.down(outcomes.map((outcome) => ["DATA", outcome as EvalProviderOutcome] as const));
		},
		{
			name: "eval/provider/all-result-admissions",
			factory: "rootEvalAllProviderResultAdmissions",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: true,
			meta: { authority: "root-graph", resultIngresses: "closed-status-partition" },
		},
	);
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
	const providerOutcomeBatches = owner.node<EvalProviderOutcomeBatch>(
		[terminalProviderResultAdmissions, retryableProviderResultAdmissions],
		(ctx) => {
			const state = ctx.state.get<EvalProviderOutcomeBatchState>() ?? {
				attemptOne: new Map<number, Map<HarnessArm, EvalProviderOutcome>>(),
				attemptTwo: new Map<number, Map<HarnessArm, EvalProviderOutcome>>(),
				expectedAttemptTwo: new Map<number, number>(),
			};
			const emitted: EvalProviderOutcomeBatch[] = [];
			for (const raw of [...(depBatch(ctx, 0) ?? []), ...(depBatch(ctx, 1) ?? [])]) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				const byAttempt = outcome.attempt === 1 ? state.attemptOne : state.attemptTwo;
				const byArm =
					byAttempt.get(outcome.replicate) ?? new Map<HarnessArm, EvalProviderOutcome>();
				const prior = byArm.get(outcome.arm);
				if (prior !== undefined && prior.resultDigest !== outcome.resultDigest)
					throw new TypeError("provider outcome batch received contradictory arm replay");
				if (prior !== undefined) continue;
				byArm.set(outcome.arm, outcome);
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
	const toolOutcomes = owner.node<EvalEffectOutcome>([], null, {
		name: "eval/tool/result-input",
		factory: "rootEvalExactToolResultInput",
		meta: { materialPolicy: "digest-and-coordinate-only" },
	});
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
	const outcomes = owner.node<EvalEffectOutcome>(
		[terminalProviderResultAdmissions, toolOutcomes],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const provider = validateProviderOutcome(raw as EvalProviderOutcome);
				if (provider.status === "failed") ctx.down([["DATA", providerFailureOutcome(provider)]]);
			}
			for (const raw of depBatch(ctx, 1) ?? [])
				ctx.down([["DATA", validateOutcomeReceipt(raw as EvalEffectOutcome)]]);
		},
		{
			name: "eval/effect/terminal-outcomes",
			factory: "rootEvalTerminalOutcomes",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);

	const resultProjection = owner.node<EffectRunResult>(
		[outcomes],
		(ctx) => {
			const settled = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
				if (settled.has(outcome.admissionId)) continue;
				settled.add(outcome.admissionId);
				const result = finalResult(outcome);
				if (result !== undefined) ctx.down([["DATA", result]]);
			}
			ctx.state.set(settled);
		},
		{
			name: "eval/provider/reconciliation",
			factory: "rootEvalProviderReconciliation",
			meta: { correlation: "admissionId+effectRunId+attempt" },
		},
	);
	const toolResults = owner.node<EvalEffectOutcome>(
		[outcomes],
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

	const diff = owner.node<EvalDiffFact>(
		[toolResults],
		(ctx) => {
			const settled = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateOutcomeReceipt(raw as EvalEffectOutcome);
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
		{ name: "eval/verification/diff", factory: "rootEvalDiffVerification" },
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
		{ name: "eval/verification/public-semantic", factory: "rootEvalPublicSemanticVerification" },
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
		{ name: "eval/verification/hidden-verifier", factory: "rootEvalHiddenVerifier" },
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
		{ name: "eval/cleanup/completed", factory: "rootEvalCleanup" },
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
		[start, cleanup],
		(ctx) => {
			const state = ctx.state.get<CampaignControllerState>() ?? {
				started: false,
				replicate: 1,
				completedByReplicate: new Map<number, Set<HarnessArm>>(),
			};
			if (!state.started && (depBatch(ctx, 0)?.length ?? 0) > 0) {
				state.started = true;
				ctx.down([["DATA", dispatchBatch(campaignRef, 1)]]);
				emitCampaignState(ctx, campaignRef, 1, replicateCount, 0, "running", "none");
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const item = raw as EvalCleanupFact;
				const completed = state.completedByReplicate.get(item.replicate) ?? new Set<HarnessArm>();
				completed.add(item.arm);
				state.completedByReplicate.set(item.replicate, completed);
				emitCampaignState(
					ctx,
					campaignRef,
					item.replicate,
					replicateCount,
					completed.size,
					completed.size === HARNESS_ARMS.length && item.replicate === replicateCount
						? "stopped"
						: "running",
					completed.size === HARNESS_ARMS.length && item.replicate === replicateCount
						? "campaign-complete"
						: "none",
				);
				if (completed.size === HARNESS_ARMS.length && item.replicate < replicateCount) {
					state.replicate = item.replicate + 1;
					ctx.down([["DATA", dispatchBatch(campaignRef, state.replicate)]]);
				}
			}
			ctx.state.set(state);
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
			},
		},
	);

	const batches = owner.node<readonly EvalArmDispatch[]>(
		[campaign],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (Array.isArray(raw)) ctx.down([["DATA", raw]]);
			}
		},
		{ name: "eval/campaign/replicate-batches", factory: "rootEvalReplicateBatches" },
	);
	const campaignStates = owner.node<EvalCampaignState>(
		[campaign],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (!Array.isArray(raw) && (raw as EvalCampaignState).kind === "eval-campaign-state")
					ctx.down([["DATA", raw]]);
			}
		},
		{ name: "eval/campaign/state", factory: "rootEvalCampaignState" },
	);

	const workItems = owner.node<WorkItemProjection<Record<string, unknown>>>(
		[batches],
		(ctx) => {
			for (const batch of (depBatch(ctx, 0) ?? []) as readonly (readonly EvalArmDispatch[])[]) {
				for (const item of batch) ctx.down([["DATA", workItemFor(item)]]);
			}
		},
		{
			name: "eval/work-item/objective-data",
			factory: "rootEvalWorkItemData",
			meta: { solutionIdentity: "work-item", cardinality: "one-work-item-per-arm" },
		},
	);
	const memoryPolicy = owner.node<AgenticWorkItemMemoryMappingPolicy<MemoryPayload>>(
		[workItems],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const item = dispatchFromWorkItem(raw as WorkItemProjection<Record<string, unknown>>);
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "agentic-work-item-memory-mapping-policy" as const,
							policyId: `${item.workItemId}/memory-mapping-policy`,
							scoreRules: [],
						}),
					],
				]);
			}
		},
		{ name: "eval/memory/mapping-policy", factory: "rootEvalMemoryMappingPolicy" },
	);
	const admissionPolicy = owner.node<AgenticMemoryRecordAdmissionPolicy>(
		[memoryPolicy],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const policy = raw as AgenticWorkItemMemoryMappingPolicy<MemoryPayload>;
				ctx.down([
					[
						"DATA",
						memoryAdmissionPolicy(dispatchFromPolicyId(policy.policyId, "/memory-mapping-policy")),
					],
				]);
			}
		},
		{ name: "eval/memory/admission-policy", factory: "rootEvalMemoryAdmissionPolicy" },
	);
	const candidateFrames = owner.node<{
		readonly dispatch: EvalArmDispatch;
		readonly candidates: readonly AgenticWorkItemMemoryRecordCandidate<MemoryPayload>[];
	}>(
		[admissionPolicy],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const policy = raw as AgenticMemoryRecordAdmissionPolicy;
				const dispatch = dispatchFromPolicyId(policy.policyId, "/memory-admission-policy");
				ctx.down([["DATA", Object.freeze({ dispatch, candidates: memoryCandidate(dispatch) })]]);
			}
		},
		{ name: "eval/memory/candidate-frame", factory: "rootEvalMemoryCandidateFrame" },
	);
	const candidates = owner.node<readonly AgenticWorkItemMemoryRecordCandidate<MemoryPayload>[]>(
		[candidateFrames],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([
					[
						"DATA",
						(raw as { candidates: readonly AgenticWorkItemMemoryRecordCandidate<MemoryPayload>[] })
							.candidates,
					],
				]);
		},
		{ name: "eval/memory/candidates", factory: "rootEvalMemoryCandidates" },
	);
	const applicationPolicy = owner.state<AgenticMemoryRecordApplicationPolicy>(
		Object.freeze({
			kind: "agentic-memory-record-application-policy",
			policyId: "root-eval-memory-application-policy",
		}),
		{ name: "eval/memory/application-policy", factory: "rootEvalMemoryApplicationPolicy" },
	);
	const initialRecords = owner.state<readonly AgenticMemoryRecord<MemoryPayload>[]>([], {
		name: "eval/memory/initial-records",
		factory: "rootEvalInitialMemoryRecords",
	});
	const memoryApplication = agenticWorkItemMemoryApplicationRecipeBundle<
		Record<string, unknown>,
		MemoryPayload
	>(owner, {
		name: "eval/solution/agentic-work-item-memory-application",
		workItem: workItems,
		policy: memoryPolicy,
		candidates,
		records: initialRecords,
		admissionPolicy,
		applicationPolicy,
	});
	if (memoryApplication.records === undefined)
		throw new Error("real Agentic Memory application recipe failed closed");

	const memoryUseFrames = owner.node<{
		readonly request: AgenticMemoryRecordUseRequest;
		readonly decisions: readonly AgenticMemoryRecordUseDecision[];
	}>(
		[memoryApplication.records, candidateFrames],
		(ctx) => {
			const frame = depLatest(ctx, 1) as { readonly dispatch: EvalArmDispatch } | undefined;
			const dispatch = frame?.dispatch;
			if (dispatch === undefined) return;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const records = raw as readonly AgenticMemoryRecord<MemoryPayload>[];
				const request = memoryUseRequest(dispatch);
				const decisions = records.map((record) =>
					createAgenticMemoryRecordUseDecision(request, record, {
						decisionId: `${dispatch.workItemId}/memory-use/${record.id}`,
						state: record.scope?.projectId === "eval-project" ? "allowed" : "denied",
					}),
				);
				ctx.down([["DATA", Object.freeze({ request, decisions: Object.freeze(decisions) })]]);
			}
		},
		{
			name: "eval/memory/exposure-frame",
			factory: "rootEvalMemoryExposureFrame",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const memoryUseRequests = owner.node<AgenticMemoryRecordUseRequest>(
		[memoryUseFrames],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", (raw as { request: AgenticMemoryRecordUseRequest }).request]]);
		},
		{ name: "eval/memory/exposure-request", factory: "rootEvalMemoryExposureRequest" },
	);
	const memoryUseDecisions = owner.node<readonly AgenticMemoryRecordUseDecision[]>(
		[memoryUseFrames],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([
					["DATA", (raw as { decisions: readonly AgenticMemoryRecordUseDecision[] }).decisions],
				]);
		},
		{ name: "eval/memory/exposure-decisions", factory: "rootEvalMemoryExposureDecisions" },
	);
	const memoryExposure = agenticMemoryRecordUseGateBundle(owner, {
		name: "eval/solution/agentic-memory-exposure",
		records: memoryApplication.records,
		request: memoryUseRequests,
		decisions: memoryUseDecisions,
	});
	const memoryQuery = owner.state(
		{ tags: ["relevant"] },
		{
			name: "eval/memory/query",
			factory: "rootEvalMemoryQuery",
		},
	);
	const agenticMemory = agenticMemoryBundle(owner, {
		name: "eval/solution/agentic-memory",
		records: memoryExposure.allowedRecords,
		query: memoryQuery,
	});

	const memoryContexts = owner.node<{
		readonly dispatch: EvalArmDispatch;
		readonly exposedRecordIds: readonly string[];
		readonly bindings: readonly EvalMemoryBinding[];
		readonly contextDigest: string;
	}>(
		[candidateFrames, agenticMemory.ranked],
		(ctx) => {
			const emitted = ctx.state.get<Set<string>>() ?? new Set<string>();
			const frame = depLatest(ctx, 0) as
				| {
						readonly dispatch: EvalArmDispatch;
						readonly candidates: readonly AgenticWorkItemMemoryRecordCandidate<MemoryPayload>[];
				  }
				| undefined;
			const answer = depLatest(ctx, 1) as
				| {
						readonly results?: readonly {
							readonly id?: string;
							readonly payload?: MemoryPayload;
						}[];
				  }
				| undefined;
			if (frame === undefined || answer === undefined || emitted.has(frame.dispatch.workItemId))
				return;
			const ids = Object.freeze(
				(answer.results ?? []).flatMap((value) => (typeof value.id === "string" ? [value.id] : [])),
			);
			const bindings = Object.freeze(
				(answer.results ?? []).flatMap((value) =>
					value.payload !== undefined &&
					typeof value.payload.bindingRef === "string" &&
					isDigest(value.payload.digest)
						? [Object.freeze({ ...value.payload })]
						: [],
				),
			);
			if (
				frame.dispatch.arm === "relevant-applied" &&
				!ids.includes(`${frame.dispatch.workItemId}/memory-fragment`)
			)
				return;
			if (frame.dispatch.arm !== "relevant-applied" && ids.length > 0) return;
			if (bindings.length !== ids.length) return;
			emitted.add(frame.dispatch.workItemId);
			ctx.state.set(emitted);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						dispatch: frame.dispatch,
						exposedRecordIds: ids,
						bindings,
						contextDigest: empiricalStrictJsonDigest({
							kind: "eval-memory-context",
							replicate: frame.dispatch.replicate,
							arm: frame.dispatch.arm,
							exposedRecordIds: ids,
							bindings,
						}),
					}),
				],
			]);
		},
		{
			name: "eval/memory/context-for-work-item",
			factory: "rootEvalMemoryContextForWorkItem",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
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
		[execution.plan.admitted],
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
		},
	);

	const firstAttemptProposals = owner.node<EvalEffectProposal>(
		[execution.requests, admittedPlanAuthority, profileAdmission],
		(ctx) => {
			const admittedProfile = depLatest(ctx, 2) as RootEvalProfileAdmission | undefined;
			if (admittedProfile === undefined) return;
			const authority = depLatest(ctx, 1) as EvalWorkItemPlanAuthority | undefined;
			if (authority === undefined) return;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const request = raw as AgentRequestIssued<Record<string, unknown>>;
				const workItemRef = request.sourceRefs?.find((ref) => ref.kind === "work-item")?.id;
				if (workItemRef === undefined) continue;
				const arm = armFromWorkItemId(workItemRef);
				if (arm === undefined) continue;
				const plan = authority.plans[workItemRef];
				if (plan === undefined)
					throw new TypeError("provider proposal requires its Work Item plan DATA");
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
					arm,
					attempt: 1 as const,
					reservationMicrousd,
					timeoutMs,
					maxOutputTokens: admittedProfile.profile.mutationMaxOutputTokens,
					reasoningEffort: admittedProfile.profile.reasoningEffort,
					workItemPlanId: plan.planId,
					workItemPlanDigest,
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
			}
		},
		{
			name: "eval/provider/proposal",
			factory: "rootEvalProviderProposal",
			meta: { timeoutAuthority: "reads-work-item-plan-data" },
		},
	);
	type EvalRetryProposalFact = Readonly<{
		readonly kind: "eval-retry-proposal-fact";
		readonly providerOutcome: EvalProviderOutcome;
		readonly proposal: EvalEffectProposal;
	}>;
	type EvalRetryProposalBatch = Readonly<{
		readonly kind: "eval-retry-proposal-batch";
		readonly replicate: number;
		readonly batchSize: number;
		readonly complete: boolean;
		readonly facts: readonly EvalRetryProposalFact[];
	}>;
	const retryProposalFacts = owner.node<EvalRetryProposalBatch>(
		[retryDelayOutcomes],
		(ctx) => {
			const state = ctx.state.get<{
				readonly byReplicate: Map<number, Map<HarnessArm, EvalRetryProposalFact>>;
				readonly batchSizes: Map<number, number>;
			}>() ?? { byReplicate: new Map(), batchSizes: new Map() };
			const batches: EvalRetryProposalBatch[] = [];
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
					attempt: 2 as const,
					reservationMicrousd,
					timeoutMs: outcome.admission.timeoutMs,
					maxOutputTokens: outcome.admission.maxOutputTokens,
					reasoningEffort: outcome.admission.reasoningEffort,
					workItemPlanId: outcome.admission.workItemPlanId,
					workItemPlanDigest: outcome.admission.workItemPlanDigest,
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
				const byArm =
					state.byReplicate.get(outcome.replicate) ?? new Map<HarnessArm, EvalRetryProposalFact>();
				const prior = byArm.get(outcome.arm);
				if (prior !== undefined && prior.proposal.proposalId !== proposal.proposalId)
					throw new TypeError("retry proposal batch received contradictory arm replay");
				if (prior !== undefined) continue;
				const priorBatchSize = state.batchSizes.get(outcome.replicate);
				if (priorBatchSize !== undefined && priorBatchSize !== delay.admission.batchSize)
					throw new TypeError("retry proposal batch received contradictory cardinality");
				state.batchSizes.set(outcome.replicate, delay.admission.batchSize);
				byArm.set(outcome.arm, fact);
				state.byReplicate.set(outcome.replicate, byArm);
				const facts = Object.freeze(
					HARNESS_ARMS.flatMap((arm) => {
						const value = byArm.get(arm);
						return value === undefined ? [] : [value];
					}),
				);
				batches.push(
					Object.freeze({
						kind: "eval-retry-proposal-batch" as const,
						replicate: outcome.replicate,
						batchSize: delay.admission.batchSize,
						complete: facts.length === delay.admission.batchSize,
						facts,
					}),
				);
			}
			if (batches.length > 0) ctx.down(batches.map((batch) => ["DATA", batch] as const));
			ctx.state.set(state);
		},
		{ name: "eval/retry/proposal-fact", factory: "rootEvalRetryProposalFact" },
	);
	const retryProposals = owner.node<EvalEffectProposal>(
		[retryProposalFacts],
		(ctx) => {
			const emitted = ctx.state.get<Set<string>>() ?? new Set<string>();
			const batches = depBatch(ctx, 0) ?? [];
			const proposals = batches.flatMap((rawBatch) =>
				(rawBatch as EvalRetryProposalBatch).facts.flatMap((fact) => {
					if (emitted.has(fact.proposal.proposalId)) return [];
					emitted.add(fact.proposal.proposalId);
					return [fact.proposal];
				}),
			);
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
				const batch =
					byReplicate.get(proposal.replicate) ?? new Map<HarnessArm, EvalEffectProposal>();
				batch.set(proposal.arm, proposal);
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
		[providerOutcomeBatches],
		(ctx) => {
			const admitted = ctx.state.get<Set<string>>() ?? new Set<string>();
			const admissions: EvalRetryDelayEffect[] = [];
			for (const rawBatch of depBatch(ctx, 0) ?? []) {
				const batch = rawBatch as EvalProviderOutcomeBatch;
				if (batch.attempt !== 1 || !batch.complete) continue;
				const retryable = batch.outcomes.filter((outcome) => outcome.status === "retryable");
				for (const outcome of retryable) {
					if (outcome.status !== "retryable" || outcome.attempt !== 1) continue;
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
						attempt: 1 as const,
						batchSize: retryable.length,
						delayMs: outcome.retryAfterMs,
					});
					const admission = Object.freeze({
						...material,
						receiptDigest: retryDelayReceiptDigest(material),
					});
					admitted.add(executionId);
					admissions.push(admission);
				}
			}
			if (admissions.length > 0)
				ctx.down(admissions.map((admission) => ["DATA", admission] as const));
			ctx.state.set(admitted);
		},
		{ name: "eval/retry/delay-admission", factory: "rootEvalRetryDelayAdmission" },
	);
	type EvalActiveProviderEffects = Readonly<{
		readonly kind: "eval-active-provider-effects";
		readonly effects: readonly EvalAdmittedEffect[];
	}>;
	type AdmissionFact = EvalAdmittedEffect | EvalBudgetState | EvalActiveProviderEffects;
	const admissionFacts = owner.node<AdmissionFact>(
		[
			replicateProposalBatches,
			retryProposalFacts,
			terminalProviderResultAdmissions,
			retryableProviderResultAdmissions,
			admittedPlanAuthority,
		],
		(ctx) => {
			const state = ctx.state.get<AdmissionState>() ?? {
				admittedKeys: new Set<string>(),
				settledAdmissionIds: new Set<string>(),
				active: new Map<string, EvalAdmittedEffect>(),
				pendingRetryProposals: new Map<string, EvalEffectProposal>(),
				retryProposalKeys: new Set<string>(),
				rejectedRetryProposalKeys: new Set<string>(),
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
			const authority = depLatest(ctx, 4) as EvalWorkItemPlanAuthority | undefined;
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
				state.providerOutcomeReasonCounts[outcome.reason] += 1;
				if (outcome.attempt === 2) state.settledRetryAttempts += 1;
			};
			for (const dependencyIndex of [2, 3] as const)
				for (const raw of depBatch(ctx, dependencyIndex) ?? [])
					settleProviderOutcome(validateProviderOutcome(raw as EvalProviderOutcome));
			const admitProposal = (proposal: EvalEffectProposal): "admitted" | "pending" | "rejected" => {
				const plan = authority?.plans[proposal.workItemId];
				if (plan === undefined)
					throw new TypeError("provider admission requires its Work Item plan DATA");
				validateEvalEffectProposalAgainstWorkItemPlan(proposal, plan);
				const key = `${proposal.effectRunId}:${proposal.attempt}`;
				if (state.admittedKeys.has(key)) return "admitted";
				if (state.rejectedRetryProposalKeys.has(key)) return "rejected";
				if (state.stoppingReason === "budget-exhausted") {
					if (proposal.attempt === 2) state.rejectedRetryProposalKeys.add(key);
					return "rejected";
				}
				if (
					proposal.attempt === 2 &&
					!state.settledAdmissionIds.has(`${proposal.effectRunId}/attempt-1/admission`)
				)
					return "pending";
				if (state.active.size >= HARNESS_ARMS.length) return "pending";
				const cannotReserve =
					state.admittedAttempts >= maxAttempts ||
					state.providerReportedMicrousd +
						state.unreportedSettledUpperBoundMicrousd +
						state.activeReservedMicrousd +
						proposal.reservationMicrousd >
						maxCostMicrousd;
				if (cannotReserve) {
					state.stoppingReason = "budget-exhausted";
					if (proposal.attempt === 2) state.rejectedRetryProposalKeys.add(key);
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
			for (const rawBatch of depBatch(ctx, 0) ?? []) {
				for (const proposal of rawBatch as readonly EvalEffectProposal[]) admitProposal(proposal);
			}
			for (const rawBatch of depBatch(ctx, 1) ?? []) {
				const batch = rawBatch as EvalRetryProposalBatch;
				for (const fact of batch.facts) {
					const proposal = fact.proposal;
					const key = `${proposal.effectRunId}:${proposal.attempt}`;
					state.retryProposalKeys.add(key);
					if (!state.admittedKeys.has(key) && !state.rejectedRetryProposalKeys.has(key))
						state.pendingRetryProposals.set(key, proposal);
				}
			}
			for (const [key, proposal] of state.pendingRetryProposals) {
				const disposition = admitProposal(proposal);
				if (disposition !== "pending") state.pendingRetryProposals.delete(key);
			}
			if (
				state.retryProposalKeys.size !==
					state.pendingRetryProposals.size +
						state.admittedRetryAttempts +
						state.rejectedRetryProposalKeys.size ||
				state.settledRetryAttempts > state.admittedRetryAttempts
			)
				throw new TypeError("retry proposal conservation drifted");
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-budget-state" as const,
						admittedAttempts: state.admittedAttempts,
						admittedRetryAttempts: state.admittedRetryAttempts,
						retryProposalCount: state.retryProposalKeys.size,
						pendingRetryProposalCount: state.pendingRetryProposals.size,
						rejectedRetryProposalCount: state.rejectedRetryProposalKeys.size,
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
				maxConcurrentEffects: HARNESS_ARMS.length,
				reservation: "atomic-before-admission",
				retryProposalAuthority: "direct-dependency-with-graph-state-conservation",
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
		[terminalProviderResultAdmissions],
		(ctx) => {
			const admitted = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = validateProviderOutcome(raw as EvalProviderOutcome);
				if (outcome.status !== "tool-proposed" || outcome.toolProposal === null) continue;
				const toolAdmissionId = `${outcome.admissionId}/exact-tool`;
				if (admitted.has(toolAdmissionId)) continue;
				const proposal = outcome.toolProposal;
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
				admitted.add(toolAdmissionId);
				ctx.down([["DATA", admission]]);
			}
			ctx.state.set(admitted);
		},
		{
			name: "eval/tool/exact-admission",
			factory: "rootEvalExactToolAdmission",
			meta: { toolRef: "graphrefly.eval.exact-tool.v1", arguments: "graph-admitted" },
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
		[cleanup, budgets, billingObservationOutcomes, currentKeyBeforeState],
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
				state.completed.size === replicateCount * HARNESS_ARMS.length;
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
		toolOutcomes as unknown as Node<unknown>,
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

	const memoryProvenance = owner.state(MEMORY_PROVENANCE, {
		name: "eval/controls/memory-provenance",
		factory: "rootEvalMemoryProvenanceMatrix",
		meta: { treatment: "relevant-applied", controls: 5, armOrder: HARNESS_ARMS },
	});
	type EvalEfficacyState = Readonly<{
		readonly kind: "eval-efficacy-state";
		readonly diagnostics: EvalVerificationDiagnostics;
		readonly budget: EvalBudgetState;
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
		[efficacyStates, billingReconciliation, effectActivity],
		(ctx) => {
			const efficacyState = depLatest(ctx, 0) as EvalEfficacyState | undefined;
			const billing = depLatest(ctx, 1) as EvalBillingReconciliation | undefined;
			const activity = depLatest(ctx, 2) as EvalEffectActivitySnapshot | undefined;
			if (efficacyState === undefined || billing === undefined || activity === undefined) return;
			const { diagnostics, budget } = efficacyState;
			if (
				diagnostics.completedWorkItems !== replicateCount * HARNESS_ARMS.length ||
				budget.activeEffects !== 0 ||
				activity.activeAdmittedEffects !== 0 ||
				activity.budgetDigest !== empiricalStrictJsonDigest(budget)
			)
				return;
			const passCounts = Object.fromEntries(
				HARNESS_ARMS.map((arm) => [arm, diagnostics.stageCounts[arm].passed]),
			) as Record<HarnessArm, number>;
			const positiveDifferential =
				passCounts["relevant-applied"] >
				Math.max(
					...HARNESS_ARMS.filter((arm) => arm !== "relevant-applied").map((arm) => passCounts[arm]),
				);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-efficacy-finding" as const,
						campaignRef,
						replicateCount,
						armOrder: HARNESS_ARMS,
						passCounts: Object.freeze(passCounts),
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
						finding: positiveDifferential ? "positive-differential" : "no-positive-differential",
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
	];
	const observationInputs = owner.initNode(
		combine<EvalObservationInputs>(),
		[campaignStates, memoryProvenance, efficacyStates],
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
		terminalConsistencyBudgetDigest?: string | null;
		digest?: string;
		terminal: boolean;
	}
	const observation = owner.node<EvalObservation>(
		[observationEvents, effectActivity, terminalLifecycleConsistency],
		(ctx) => {
			const state = ctx.state.get<EvalObservationProjectionState>() ?? { terminal: false };
			const emit = () => {
				if (state.inputs === undefined || state.effectActivity === undefined) return;
				const [campaignState, provenance, efficacyState] = state.inputs;
				const { diagnostics } = efficacyState;
				const { budget } = state.effectActivity;
				const {
					activeProviderEffects,
					activeToolEffects,
					activeRetryEffects,
					activeBillingEffects,
					activeAdmittedEffects,
				} = state.effectActivity;
				const terminal =
					state.finding !== undefined &&
					activeAdmittedEffects === 0 &&
					state.terminalConsistencyBudgetDigest === state.effectActivity.budgetDigest;
				const terminalDiagnostics = terminal ? state.finding!.verificationDiagnostics : diagnostics;
				const value = strictSnapshot({
					kind: "eval-observation" as const,
					topologyRevision: ROOT_EVAL_TOPOLOGY_REVISION,
					solutionIdentities: ROOT_EVAL_SOLUTION_IDENTITIES,
					campaignRef,
					replicate: campaignState.replicate,
					armOrder: HARNESS_ARMS,
					memoryProvenance: provenance,
					completedArms: campaignState.completedArms,
					verificationDiagnostics: terminalDiagnostics,
					activeProviderEffects,
					activeToolEffects,
					activeRetryEffects,
					activeBillingEffects,
					activeAdmittedEffects,
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
					stoppingReason: terminal
						? state.finding!.stoppingReason
						: budget.stoppingReason !== "none"
							? budget.stoppingReason
							: campaignState.stoppingReason,
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
				emit();
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				state.effectActivity = raw as EvalEffectActivitySnapshot;
				emit();
			}
			for (const raw of depBatch(ctx, 2) ?? []) {
				state.terminalConsistencyBudgetDigest = (
					raw as { readonly budgetDigest: string | null }
				).budgetDigest;
				emit();
			}
			ctx.state.set(state);
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
	admissionFacts.subscribe(() => undefined);
	campaignActiveEffects.subscribe(() => undefined);
	toolActiveEffects.subscribe(() => undefined);
	retryActiveEffects.subscribe(() => undefined);
	billingActiveEffects.subscribe(() => undefined);
	observation.subscribe(() => undefined);
	findings.subscribe(() => undefined);

	let topology: RootEvalTopology;
	topology = Object.freeze({
		graph: owner,
		inputs: Object.freeze({ start }),
		runAdmittedEffects: (
			executor: (effect: EvalExecutableEffect) => Promise<EvalExecutorOutcome>,
			options: Readonly<{ readonly signal?: AbortSignal }> = {},
		) =>
			runRootEvalWithOutcomeInput(
				topology,
				[callerAdmittedEffects, callerToolEffects, callerRetryEffects, callerBillingEffects],
				terminalProviderResultAdmissions,
				retryableProviderResultAdmissions,
				terminalProviderOutcomes,
				retryableProviderOutcomes,
				toolOutcomes,
				retryDelayOutcomes,
				billingObservationOutcomes,
				executor,
				options.signal,
			),
		nodes: {
			workItems,
			memoryProvenance,
			providerProposals: proposals,
			providerAdmissions,
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
	retryableProviderResultAdmissions: Node<EvalProviderOutcome>,
	terminalProviderOutcomes: Node<EvalProviderOutcome>,
	retryableProviderOutcomes: Node<EvalProviderOutcome>,
	toolOutcomes: Node<EvalEffectOutcome>,
	retryDelayOutcomes: Node<EvalRetryDelayOutcome>,
	billingObservationOutcomes: Node<EvalBillingObservationOutcome>,
	executor: (effect: EvalExecutableEffect) => Promise<EvalExecutorOutcome>,
	signal?: AbortSignal,
): Promise<RootEvalRunResult> {
	const observationEvents: ObserveEvent[] = [];
	const executed = new Set<string>();
	const scheduled = new Set<string>();
	const inFlight = new Set<Promise<void>>();
	let activeProviderExecutions = 0;
	let peakConcurrentEffects = 0;
	let settled = false;
	let budgetExhausted = false;
	let latestBudget: EvalBudgetState | undefined;
	return new Promise<RootEvalRunResult>((resolve, reject) => {
		let finding: EvalFinding | undefined;
		let terminalObservation: EvalObservation | undefined;
		let stopEffects: () => void = () => undefined;
		let stopFinding: () => void = () => undefined;
		let stopObservation: () => void = () => undefined;
		let stopBudget: () => void = () => undefined;
		let stopTerminalProviderResultAdmission: () => void = () => undefined;
		let stopRetryableProviderResultAdmission: () => void = () => undefined;
		let stopAbortSignal: () => void = () => undefined;
		const stopSubscriptions = () => {
			stopEffects();
			stopFinding();
			stopObservation();
			stopBudget();
			stopTerminalProviderResultAdmission();
			stopRetryableProviderResultAdmission();
			stopAbortSignal();
		};
		const abort = (error: unknown) => {
			if (settled) return;
			settled = true;
			stopSubscriptions();
			void Promise.allSettled([...inFlight]).then(() => reject(error));
		};
		const maybeFinishBudgetStop = () => {
			if (!settled && budgetExhausted && latestBudget?.activeEffects === 0 && inFlight.size === 0)
				abort(new Error("root eval stopped: budget-exhausted"));
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
			if (budget.stoppingReason === "budget-exhausted") budgetExhausted = true;
			maybeFinishBudgetStop();
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
								if (validated.status === "retryable")
									retryableProviderOutcomes.down([["DATA", validated]]);
								else terminalProviderOutcomes.down([["DATA", validated]]);
							} else if (effect.kind === "eval-admitted-tool-effect") {
								const validated = Object.freeze(
									validateOutcomeReceipt(outcome as EvalEffectOutcome),
								);
								if (validated.admission !== effect)
									throw new TypeError("tool outcome lost its admitted receipt identity");
								toolOutcomes.down([["DATA", validated]]);
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
								toolOutcomes.down([
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
						maybeFinishBudgetStop();
					},
					() => {
						inFlight.delete(execution);
						maybeFinishBudgetStop();
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
					campaignRef: topology.graph.name ?? "eval/root",
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
	if (
		result.finding.stoppingReason !== "campaign-complete" ||
		result.finding.completedWorkItems !==
			result.finding.replicateCount * result.finding.armOrder.length
	)
		throw new Error("root eval persistence fails closed before a complete finding");
	if (
		result.finding.replicateCount !== ROOT_EVAL_REPLICATE_COUNT ||
		result.finding.armOrder.length !== HARNESS_ARMS.length ||
		!result.finding.armOrder.every((arm, index) => arm === HARNESS_ARMS[index]) ||
		result.executedAdmissionIds.length < ROOT_EVAL_REPLICATE_COUNT * HARNESS_ARMS.length ||
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
