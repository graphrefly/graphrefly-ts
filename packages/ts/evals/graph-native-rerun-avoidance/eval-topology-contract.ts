import type { DescribeSnapshot } from "../../src/graph/describe.js";
import {
	ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS,
	ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
	ROOT_EVAL_INITIAL_PROVIDER_CAPACITY,
	ROOT_EVAL_PROVIDER_START_INTERVAL_MS,
	ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY,
} from "./eval-topology.js";
import { HARNESS_ARMS } from "./harness-campaign-policy.js";

export const ROOT_EVAL_REQUIRED_NODES = Object.freeze({
	"eval/provider/cost-settlements": "rootEvalProviderCostSettlements",
	"eval/campaign/terminal": "rootEvalCampaignTerminal",
	"eval/observation/input/context/released": "rootEvalObservationSnapshotRelease",
	"eval/observation/input/context/release-events": "merge",
	"eval/observation/input/context/release-controller":
		"rootEvalObservationSnapshotReleaseController",
	"eval/observation/input/admission/released": "rootEvalObservationSnapshotRelease",
	"eval/observation/input/admission/release-events": "merge",
	"eval/observation/input/admission/release-controller":
		"rootEvalObservationSnapshotReleaseController",
	"eval/observation/input/activity/released": "rootEvalObservationSnapshotRelease",
	"eval/observation/input/activity/release-events": "merge",
	"eval/observation/input/activity/release-controller":
		"rootEvalObservationSnapshotReleaseController",
	"eval/observation/input/campaign/released": "rootEvalObservationSnapshotRelease",
	"eval/observation/input/campaign/release-events": "merge",
	"eval/observation/input/campaign/release-controller":
		"rootEvalObservationSnapshotReleaseController",
	"eval/observation/input/diagnostics/released": "rootEvalObservationSnapshotRelease",
	"eval/observation/input/diagnostics/release-events": "merge",
	"eval/observation/input/diagnostics/release-controller":
		"rootEvalObservationSnapshotReleaseController",
	"eval/observation/input/qualification/released": "rootEvalObservationSnapshotRelease",
	"eval/observation/input/qualification/release-events": "merge",
	"eval/observation/input/qualification/release-controller":
		"rootEvalObservationSnapshotReleaseController",
	"eval/observation/input/finding/released": "rootEvalObservationSnapshotRelease",
	"eval/observation/input/finding/release-events": "merge",
	"eval/observation/input/finding/release-controller":
		"rootEvalObservationSnapshotReleaseController",
	"eval/observation/input/elapsed/released": "rootEvalObservationSnapshotRelease",
	"eval/observation/input/elapsed/release-events": "merge",
	"eval/observation/input/elapsed/release-controller":
		"rootEvalObservationSnapshotReleaseController",
	"eval/observation/input/context": "rootEvalObservationOccurrenceInput",
	"eval/observation/input/admission": "rootEvalObservationOccurrenceInput",
	"eval/observation/input/activity": "rootEvalObservationOccurrenceInput",
	"eval/observation/input/campaign": "rootEvalObservationOccurrenceInput",
	"eval/observation/input/diagnostics": "rootEvalObservationOccurrenceInput",
	"eval/observation/input/qualification": "rootEvalObservationOccurrenceInput",
	"eval/observation/input/finding": "rootEvalObservationOccurrenceInput",
	"eval/observation/input/elapsed": "rootEvalObservationOccurrenceInput",
	"eval/observation/arrivals": "merge",
	"eval/observation/canonical-state": "rootEvalCanonicalObservation",
	"eval/observation/rejections": "rootEvalObservationRejections",
	"eval/memory/admission-result-context/left": "solutionOccurrenceJoinLeft",
	"eval/memory/admission-result-context/right": "solutionOccurrenceJoinRight",
	"eval/memory/admission-result-context/arrivals": "merge",
	"eval/memory/bridge-result-context/left": "solutionOccurrenceJoinLeft",
	"eval/memory/bridge-result-context/right": "solutionOccurrenceJoinRight",
	"eval/memory/bridge-result-context/arrivals": "merge",
	"eval/solution/agentic-work-item-memory-bridge/scoreSignals":
		"agenticWorkItemMemoryBridgeScoreSignals",
	"eval/solution/agentic-work-item-memory-bridge/proposals": "agenticWorkItemMemoryBridgeProposals",
	"eval/solution/agentic-work-item-memory-bridge/status": "agenticWorkItemMemoryBridgeStatus",
	"eval/solution/agentic-work-item-memory-bridge/issues": "agenticWorkItemMemoryBridgeIssues",
	"eval/solution/agentic-work-item-memory-bridge/audit": "agenticWorkItemMemoryBridgeAudit",
	"eval/solution/agentic-work-item-memory-bridge/cursor": "agenticWorkItemMemoryBridgeCursor",
	"eval/solution/agentic-memory-admission/admissions": "agenticMemoryRecordAdmissionAdmissions",
	"eval/solution/agentic-memory-admission/admitted":
		"agenticMemoryRecordAdmissionAdmissionsAdmitted",
	"eval/solution/agentic-memory-admission/rejected":
		"agenticMemoryRecordAdmissionAdmissionsRejected",
	"eval/solution/agentic-memory-admission/needsReview":
		"agenticMemoryRecordAdmissionAdmissionsNeedsReview",
	"eval/solution/agentic-memory-admission/status": "agenticMemoryRecordAdmissionStatus",
	"eval/solution/agentic-memory-admission/issues": "agenticMemoryRecordAdmissionIssues",
	"eval/solution/agentic-memory-admission/audit": "agenticMemoryRecordAdmissionAudit",
	"eval/solution/agentic-memory-admission/cursor": "agenticMemoryRecordAdmissionCursor",
	"eval/solution/agentic-memory-application/records": "agenticMemoryRecordApplicationRecords",
	"eval/solution/agentic-memory-application/appliedRecords":
		"agenticMemoryRecordApplicationAppliedRecords",
	"eval/solution/agentic-memory-application/applicationDecisions":
		"agenticMemoryRecordApplicationDecisions",
	"eval/solution/agentic-memory-application/status": "agenticMemoryRecordApplicationStatus",
	"eval/solution/agentic-memory-application/operationStatuses":
		"agenticMemoryRecordApplicationOperationStatuses",
	"eval/solution/agentic-memory-application/issues": "agenticMemoryRecordApplicationIssues",
	"eval/solution/agentic-memory-application/audit": "agenticMemoryRecordApplicationAudit",
	"eval/solution/agentic-memory-application/cursor": "agenticMemoryRecordApplicationCursor",
	"eval/memory/bridge-result-context/matched": "solutionOccurrenceMatched",
	"eval/memory/bridge-result-context/released": "solutionOccurrenceQuietPort",
	"eval/memory/bridge-result-context/release-events": "merge",
	"eval/memory/bridge-result-context/release-controller": "solutionOccurrenceReleaseController",
	"eval/memory/bridge-result-context": "rootEvalMemoryBridgeResultContext",
	"eval/memory/admission-result-context/matched": "solutionOccurrenceMatched",
	"eval/memory/admission-result-context/released": "solutionOccurrenceQuietPort",
	"eval/memory/admission-result-context/release-events": "merge",
	"eval/memory/admission-result-context/release-controller": "solutionOccurrenceReleaseController",
	"eval/memory/admission-result-context": "rootEvalMemoryAdmissionResultContext",
	"eval/campaign/contract": "state",
	"eval/campaign/task-bindings": "state",
	"eval/billing/current-key-before": "state",
	"eval/profile/qualified-catalog": "state",
	"eval/profile/graph-admission": "rootEvalCurrentProfileAdmission",
	"eval/time/elapsed-budget/schedule": "rootEvalElapsedBudgetSchedule",
	"eval/time/elapsed-budget/timer-source": "rootEvalCampaignElapsedTimerSource",
	"eval/time/elapsed-budget/clock-release-events": "merge",
	"eval/time/elapsed-budget/clock-release-controller": "rootEvalElapsedClockReleaseController",
	"eval/time/elapsed-budget/clock": "rootEvalElapsedBudgetClock",
	"eval/time/elapsed-budget/readiness/runtime": "scheduledReadinessProjector",
	"eval/time/elapsed-budget/readiness/ready": "scheduledReadinessReady",
	"eval/time/elapsed-budget/events": "merge",
	"eval/time/elapsed-budget/state": "rootEvalElapsedBudgetState",
	"eval/campaign/sealed-configuration": "rootEvalCampaignConfiguration",
	"eval/campaign/controller-events": "merge",
	"eval/campaign/state-events": "merge",
	"eval/campaign/state": "rootEvalCampaignState",
	"eval/campaign/replicate-controller": "rootEvalReplicateController",
	"eval/source-work-item/schedule": "rootEvalSourceWorkItemSchedule",
	"eval/source-work-item/request-authority": "rootEvalSourceWorkItemRequestAuthority",
	"eval/source-work-item/objective-data": "rootEvalSourceWorkItemData",
	"eval/source-work-item/attempt-resource-plan": "rootEvalSourceWorkItemPlan",
	"eval/solution/source-work-item-execution/workItemSeeds": "workItemSeedProjector",
	"eval/solution/source-work-item-execution/plan/runtime": "workItemEffectPlanProjector",
	"eval/solution/source-work-item-execution/effectRuns/runtime": "workItemEffectRunProjector",
	"eval/solution/source-work-item-execution/requestFacts": "workItemExecutionRequestFacts",
	"eval/source-work-item/tool-result-input": "rootEvalSourceExactToolResultInput",
	"eval/source-work-item/terminal-outcomes/inputs": "merge",
	"eval/source-work-item/terminal-outcomes/release-events": "merge",
	"eval/source-work-item/terminal-outcomes/release-controller":
		"rootEvalTerminalOutcomeReleaseController",
	"eval/source-work-item/terminal-outcomes": "rootEvalSourceTerminalOutcomes",
	"eval/source-work-item/reconciliation": "rootEvalSourceWorkItemReconciliation",
	"eval/source-work-item/verified-solution": "rootEvalVerifiedSourceWorkItem",
	"eval/source-work-item/outcome-evidence-verification/validated": "rootEvalQuietDataValidated",
	"eval/source-work-item/outcome-evidence-verification/released": "rootEvalQuietDataPort",
	"eval/source-work-item/outcome-evidence-verification/candidate":
		"rootEvalSourceWorkItemVerificationCandidate",
	"eval/source-work-item/outcome-evidence-verification/release-events": "merge",
	"eval/source-work-item/outcome-evidence-verification/release-controller":
		"rootEvalQuietDataReleaseController",
	"eval/source-work-item/outcome-evidence-verification": "rootEvalSourceWorkItemVerification",
	"eval/source-work-item/memory-handoff-candidate": "rootEvalSourceMemoryHandoffCandidate",
	"eval/source-work-item/memory-handoff-decision": "rootEvalSourceMemoryHandoffDecision",
	"eval/source-work-item/memory-handoff/correlation": "admissionHandoffCorrelation",
	"eval/source-work-item/memory-handoff/admitted": "admissionHandoffAdmitted",
	"eval/source-work-item/memory-handoff/accepted": "admissionHandoffAccepted",
	"eval/source-work-item/memory-handoff/release-controller": "admissionHandoffReleaseController",
	"eval/source-work-item/memory-handoff/rejected": "admissionHandoffRejected",
	"eval/source-work-item/memory-handoff/status": "admissionHandoffStatus",
	"eval/source-work-item/memory-handoff/issues": "admissionHandoffIssues",
	"eval/source-work-item/memory-handoff/cursor": "admissionHandoffCursor",
	"eval/work-item/objective-data": "rootEvalWorkItemData",
	"eval/work-item/attempt-resource-plan": "rootEvalWorkItemPlan",
	"eval/solution/work-item-execution/workItemSeeds": "workItemSeedProjector",
	"eval/solution/work-item-execution/plan/runtime": "workItemEffectPlanProjector",
	"eval/work-item/admitted-plan-events": "merge",
	"eval/work-item/admitted-plan-authority": "rootEvalWorkItemAdmittedPlanAuthority",
	"eval/solution/work-item-execution/effectRuns/runtime": "workItemEffectRunProjector",
	"eval/solution/work-item-execution/requestFacts": "workItemExecutionRequestFacts",
	"eval/memory/bridge-occurrence-input": "rootEvalMemoryBridgeOccurrenceInput",
	"eval/solution/agentic-work-item-memory-bridge/projection": "agenticWorkItemMemoryBridge",
	"eval/memory/six-arm-batch-candidate": "rootEvalMemoryBatchHandoffCandidate",
	"eval/memory/source-readiness-events": "merge",
	"eval/memory/six-arm-source-readiness-decision": "rootEvalMemoryBatchSourceReadinessDecision",
	"eval/memory/six-arm-source-readiness-handoff/correlation": "admissionHandoffCorrelation",
	"eval/memory/six-arm-source-readiness-handoff/admitted": "admissionHandoffAdmitted",
	"eval/memory/six-arm-source-readiness-handoff/accepted": "admissionHandoffAccepted",
	"eval/memory/six-arm-source-readiness-handoff/release-controller":
		"admissionHandoffReleaseController",
	"eval/memory/six-arm-source-readiness-handoff/rejected": "admissionHandoffRejected",
	"eval/memory/six-arm-source-readiness-handoff/status": "admissionHandoffStatus",
	"eval/memory/six-arm-source-readiness-handoff/issues": "admissionHandoffIssues",
	"eval/memory/six-arm-source-readiness-handoff/cursor": "admissionHandoffCursor",
	"eval/memory/correlated-six-arm-data": "rootEvalCorrelatedMemoryBatch",
	"eval/memory/source-record-data": "rootEvalMemorySourceRecordData",
	"eval/memory/admission-occurrence-input": "rootEvalMemoryAdmissionOccurrenceInput",
	"eval/solution/agentic-memory-admission/projection": "agenticMemoryRecordAdmission",
	"eval/memory/application-occurrence-input": "rootEvalMemoryApplicationOccurrenceInput",
	"eval/solution/agentic-memory-application/projection": "agenticMemoryRecordApplication",
	"eval/memory/applied-record-state": "rootEvalAppliedMemoryRecordState",
	"eval/memory/exposure-events": "merge",
	"eval/memory/exposure-frame/validated": "rootEvalQuietDataValidated",
	"eval/memory/exposure-frame/released": "rootEvalQuietDataPort",
	"eval/memory/exposure-frame/candidate": "rootEvalMemoryExposureFrameCandidate",
	"eval/memory/exposure-frame/release-events": "merge",
	"eval/memory/exposure-frame/release-controller": "rootEvalQuietDataReleaseController",
	"eval/memory/exposure-frame": "rootEvalMemoryExposureFrame",
	"eval/memory/exposure-occurrence-input": "rootEvalMemoryExposureOccurrenceInput",
	"eval/memory/use-dispatch": "rootEvalMemoryUseDispatch",
	"eval/solution/agentic-memory/snapshot": "agenticMemoryRecordUseGate",
	"eval/solution/agentic-memory/cursor": "agenticMemoryRecordUseCursor",
	"eval/solution/agentic-memory/audit": "agenticMemoryRecordUseAudit",
	"eval/solution/agentic-memory/issues": "agenticMemoryRecordUseIssues",
	"eval/solution/agentic-memory/status": "agenticMemoryRecordUseStatus",
	"eval/solution/agentic-memory/exclusions": "agenticMemoryRecordUseExclusions",
	"eval/solution/agentic-memory/allowedRecords": "agenticMemoryRecordUseAllowedRecords",
	"eval/memory/context-for-work-item": "rootEvalMemoryContextForWorkItem",
	"eval/campaign/replicate-batches": "rootEvalReplicateBatches",
	"eval/campaign/replicate-batch-release-events": "merge",
	"eval/campaign/replicate-batch-release-controller": "rootEvalReplicateBatchReleaseController",
	"eval/provider/first-proposal-events": "merge",
	"eval/provider/proposal-candidate": "rootEvalProviderProposalCandidate",
	"eval/provider/proposal": "rootEvalProviderProposal",
	"eval/provider/proposal-release-events": "merge",
	"eval/provider/proposal-release-controller": "rootEvalProviderProposalReleaseController",
	"eval/provider/replicate-proposal-batches": "rootEvalReplicateProposalBatches",
	"eval/provider/paced-proposal-release": "rootEvalProviderPacedProposalRelease",
	"eval/provider/pacing-clock-inputs": "merge",
	"eval/provider/pacing-clock": "rootEvalProviderPacingClock",
	"eval/provider/pacing-events": "merge",
	"eval/provider/start-spacing-readiness": "rootEvalProviderStartSpacingReadiness",
	"eval/provider/admission-events": "merge",
	"eval/provider/graph-admission-and-budget": "rootEvalProviderGraphAdmission",
	"eval/provider/admission-observation-cut": "rootEvalProviderAdmissionObservationCut",
	"eval/provider/adaptive-capacity-state": "rootEvalAdaptiveProviderCapacityState",
	"eval/provider/result-input": "rootEvalProviderResultInput",
	"eval/provider/result-admission": "rootEvalProviderResultAdmission",
	"eval/provider/failed-result-admission": "rootEvalFailedProviderResultAdmission",
	"eval/provider/retryable-result-admission": "rootEvalRetryableProviderResultAdmission",
	"eval/provider/result-status-release-events": "merge",
	"eval/provider/result-status-release-controller": "rootEvalProviderResultStatusReleaseController",
	"eval/provider/all-result-admissions": "rootEvalAllProviderResultAdmissions",
	"eval/provider/result-batch-events": "merge",
	"eval/provider/result-batches": "rootEvalProviderOutcomeBatches",
	"eval/provider/reconciliation": "rootEvalProviderReconciliation",
	"eval/provider/budget-settled-outcomes": "rootEvalBudgetSettledProviderOutcomes",
	"eval/tool/admission-events": "merge",
	"eval/tool/exact-admission": "rootEvalExactToolAdmission",
	"eval/retry/admission-release-events": "merge",
	"eval/retry/admission-release-controller": "rootEvalRetryAdmissionReleaseController",
	"eval/retry/delay-admission": "rootEvalRetryDelayAdmission",
	"eval/executor/current-provider-effect": "merge",
	"eval/executor/current-tool-effect": "merge",
	"eval/tool/all-result-inputs": "merge",
	"eval/executor/current-retry-delay": "merge",
	"eval/billing/observation-result-input": "rootEvalBillingObservationResultInput",
	"eval/billing/fact-events": "merge",
	"eval/billing/observation-proposal-and-stopping": "rootEvalBillingObservationProposalAndStopping",
	"eval/billing/observation-proposals": "rootEvalBillingObservationProposals",
	"eval/billing/admission-release-events": "merge",
	"eval/billing/admission-release-controller": "rootEvalBillingAdmissionReleaseController",
	"eval/billing/observation-admission": "rootEvalBillingObservationAdmission",
	"eval/executor/current-billing-observation": "merge",
	"eval/billing/reconciliation": "rootEvalBillingReconciliation",
	"eval/executor/provider-effect-lifecycle-registry/events": "merge",
	"eval/executor/provider-effect-lifecycle-registry": "rootEvalEffectLifecycleRegistry",
	"eval/executor/retry-effect-lifecycle-registry/events": "merge",
	"eval/executor/retry-effect-lifecycle-registry": "rootEvalRetryEffectLifecycleRegistry",
	"eval/executor/tool-effect-lifecycle-registry/events": "merge",
	"eval/executor/tool-effect-lifecycle-registry": "rootEvalToolEffectLifecycleRegistry",
	"eval/executor/billing-effect-lifecycle-registry/events": "merge",
	"eval/executor/billing-effect-lifecycle-registry": "rootEvalBillingEffectLifecycleRegistry",
	"eval/executor/active-provider-effects": "rootEvalAllActiveEffects",
	"eval/executor/active-tool-effects": "rootEvalActiveToolEffects",
	"eval/executor/active-retry-effects": "rootEvalActiveRetryEffects",
	"eval/executor/active-billing-effects": "rootEvalActiveBillingEffects",
	"eval/observation/provider-effect-activity": "rootEvalProviderEffectActivity",
	"eval/observation/tool-effect-activity": "rootEvalToolEffectActivity",
	"eval/observation/retry-effect-activity": "rootEvalRetryEffectActivity",
	"eval/observation/billing-effect-activity": "rootEvalBillingEffectActivity",
	"eval/observation/effect-activity": "rootEvalEffectActivityTimeline",
	"eval/observation/candidate-provider-proposal": "rootEvalCandidateProviderProposalObservation",
	"eval/observation/candidate-tool-admission": "rootEvalCandidateToolAdmissionObservation",
	"eval/observation/candidate-tool-result": "rootEvalCandidateToolResultObservation",
	"eval/executor/caller-admitted-effect": "rootEvalCallerAdmittedEffectGate",
	"eval/executor/caller-admitted-tool-effect": "rootEvalCallerAdmittedToolEffectGate",
	"eval/executor/caller-admitted-retry-effect": "rootEvalCallerAdmittedRetryEffectGate",
	"eval/executor/caller-admitted-billing-effect": "rootEvalCallerAdmittedBillingEffectGate",
	"eval/tool/result": "rootEvalExactToolResult",
	"eval/verification/diff": "rootEvalDiffVerification",
	"eval/verification/public-semantic": "rootEvalPublicSemanticVerification",
	"eval/verification/hidden-verifier": "rootEvalHiddenVerifier",
	"eval/cleanup/completed": "rootEvalCleanup",
	"eval/verification/diagnostic-events": "merge",
	"eval/verification/diagnostics": "rootEvalVerificationDiagnostics",
	"eval/budget/state": "rootEvalBudgetState",
	"eval/retry/proposal": "rootEvalRetryProposal",
	"eval/retry/proposal-fact": "rootEvalRetryProposalFact",
	"eval/findings/efficacy-state": "rootEvalEfficacyState",
	"eval/findings/matched-evidence-events": "merge",
	"eval/findings/matched-source-target-evidence": "rootEvalMatchedSourceTargetEvidence",
	"eval/findings/efficacy/validated": "rootEvalQuietDataValidated",
	"eval/findings/efficacy/released": "rootEvalQuietDataPort",
	"eval/findings/efficacy/candidate": "rootEvalEfficacyFindingCandidate",
	"eval/findings/efficacy/release-events": "merge",
	"eval/findings/efficacy/release-controller": "rootEvalQuietDataReleaseController",
	"eval/findings/efficacy": "rootEvalEfficacyFinding",
	"eval/development/qualification-events": "merge",
	"eval/development/qualification": "rootEvalDevelopmentQualification",
	"eval/observation/terminal-lifecycle-consistency": "rootEvalTerminalLifecycleConsistency",
	"eval/controls/memory-provenance": "state",
	"eval/observation/source-stage-context": "state",
	"eval/observation": "rootEvalGraphNativeObservation",
} as const);

export const ROOT_EVAL_CRITICAL_EDGES = Object.freeze([
	["eval/observation/source-stage-context", "eval/observation/input/context"],
	["eval/observation/input/context", "eval/observation/input/context/released"],
	["eval/observation/input/context", "eval/observation/input/context/release-events"],
	["eval/observation/input/context/released", "eval/observation/input/context/release-events"],
	[
		"eval/observation/input/context/release-events",
		"eval/observation/input/context/release-controller",
	],
	["eval/observation/input/context/released", "eval/observation/arrivals"],
	["eval/provider/admission-observation-cut", "eval/observation/input/admission"],
	["eval/observation/input/admission", "eval/observation/input/admission/released"],
	["eval/observation/input/admission", "eval/observation/input/admission/release-events"],
	["eval/observation/input/admission/released", "eval/observation/input/admission/release-events"],
	[
		"eval/observation/input/admission/release-events",
		"eval/observation/input/admission/release-controller",
	],
	["eval/observation/input/admission/released", "eval/observation/arrivals"],
	["eval/observation/effect-activity", "eval/observation/input/activity"],
	["eval/observation/input/activity", "eval/observation/input/activity/released"],
	["eval/observation/input/activity", "eval/observation/input/activity/release-events"],
	["eval/observation/input/activity/released", "eval/observation/input/activity/release-events"],
	[
		"eval/observation/input/activity/release-events",
		"eval/observation/input/activity/release-controller",
	],
	["eval/observation/input/activity/released", "eval/observation/arrivals"],
	["eval/campaign/state", "eval/observation/input/campaign"],
	["eval/observation/input/campaign", "eval/observation/input/campaign/released"],
	["eval/observation/input/campaign", "eval/observation/input/campaign/release-events"],
	["eval/observation/input/campaign/released", "eval/observation/input/campaign/release-events"],
	[
		"eval/observation/input/campaign/release-events",
		"eval/observation/input/campaign/release-controller",
	],
	["eval/observation/input/campaign/released", "eval/observation/arrivals"],
	["eval/verification/diagnostics", "eval/observation/input/diagnostics"],
	["eval/observation/input/diagnostics", "eval/observation/input/diagnostics/released"],
	["eval/observation/input/diagnostics", "eval/observation/input/diagnostics/release-events"],
	[
		"eval/observation/input/diagnostics/released",
		"eval/observation/input/diagnostics/release-events",
	],
	[
		"eval/observation/input/diagnostics/release-events",
		"eval/observation/input/diagnostics/release-controller",
	],
	["eval/observation/input/diagnostics/released", "eval/observation/arrivals"],
	["eval/development/qualification", "eval/observation/input/qualification"],
	["eval/observation/input/qualification", "eval/observation/input/qualification/released"],
	["eval/observation/input/qualification", "eval/observation/input/qualification/release-events"],
	[
		"eval/observation/input/qualification/released",
		"eval/observation/input/qualification/release-events",
	],
	[
		"eval/observation/input/qualification/release-events",
		"eval/observation/input/qualification/release-controller",
	],
	["eval/observation/input/qualification/released", "eval/observation/arrivals"],
	["eval/findings/efficacy", "eval/observation/input/finding"],
	["eval/observation/input/finding", "eval/observation/input/finding/released"],
	["eval/observation/input/finding", "eval/observation/input/finding/release-events"],
	["eval/observation/input/finding/released", "eval/observation/input/finding/release-events"],
	[
		"eval/observation/input/finding/release-events",
		"eval/observation/input/finding/release-controller",
	],
	["eval/observation/input/finding/released", "eval/observation/arrivals"],
	["eval/time/elapsed-budget/state", "eval/observation/input/elapsed"],
	["eval/observation/input/elapsed", "eval/observation/input/elapsed/released"],
	["eval/observation/input/elapsed", "eval/observation/input/elapsed/release-events"],
	["eval/observation/input/elapsed/released", "eval/observation/input/elapsed/release-events"],
	[
		"eval/observation/input/elapsed/release-events",
		"eval/observation/input/elapsed/release-controller",
	],
	["eval/observation/input/elapsed/released", "eval/observation/arrivals"],
	["eval/observation/arrivals", "eval/observation/canonical-state"],
	["eval/observation/canonical-state", "eval/observation"],
	["eval/observation/canonical-state", "eval/observation/rejections"],
	["eval/observation/canonical-state", "eval/observation/terminal-lifecycle-consistency"],
	["eval/observation/canonical-state", "eval/campaign/terminal"],
	["eval/solution/agentic-memory/snapshot", "eval/solution/agentic-memory/allowedRecords"],
	["eval/solution/agentic-memory/snapshot", "eval/solution/agentic-memory/exclusions"],
	["eval/solution/agentic-memory/snapshot", "eval/solution/agentic-memory/status"],
	["eval/solution/agentic-memory/snapshot", "eval/solution/agentic-memory/issues"],
	["eval/solution/agentic-memory/snapshot", "eval/solution/agentic-memory/audit"],
	["eval/solution/agentic-memory/snapshot", "eval/solution/agentic-memory/cursor"],
	["eval/profile/qualified-catalog", "eval/profile/graph-admission"],
	["eval/source-work-item/terminal-outcomes/inputs", "eval/source-work-item/terminal-outcomes"],
	[
		"eval/source-work-item/terminal-outcomes/inputs",
		"eval/source-work-item/terminal-outcomes/release-events",
	],
	[
		"eval/source-work-item/terminal-outcomes",
		"eval/source-work-item/terminal-outcomes/release-events",
	],
	[
		"eval/source-work-item/terminal-outcomes/release-events",
		"eval/source-work-item/terminal-outcomes/release-controller",
	],
	["eval/memory/bridge-result-context/matched", "eval/memory/bridge-result-context/released"],
	["eval/memory/bridge-result-context/released", "eval/memory/bridge-result-context"],
	["eval/memory/bridge-result-context/matched", "eval/memory/bridge-result-context/release-events"],
	["eval/memory/bridge-result-context", "eval/memory/bridge-result-context/release-events"],
	[
		"eval/memory/bridge-result-context/release-events",
		"eval/memory/bridge-result-context/release-controller",
	],
	["eval/memory/admission-result-context/matched", "eval/memory/admission-result-context/released"],
	["eval/memory/admission-result-context/released", "eval/memory/admission-result-context"],
	[
		"eval/memory/admission-result-context/matched",
		"eval/memory/admission-result-context/release-events",
	],
	["eval/memory/admission-result-context", "eval/memory/admission-result-context/release-events"],
	[
		"eval/memory/admission-result-context/release-events",
		"eval/memory/admission-result-context/release-controller",
	],
	["eval/memory/exposure-events", "eval/memory/exposure-frame/candidate"],
	[
		"eval/source-work-item/outcome-evidence-verification/candidate",
		"eval/source-work-item/outcome-evidence-verification/validated",
	],
	[
		"eval/source-work-item/outcome-evidence-verification/validated",
		"eval/source-work-item/outcome-evidence-verification/released",
	],
	[
		"eval/source-work-item/outcome-evidence-verification/released",
		"eval/source-work-item/outcome-evidence-verification",
	],
	[
		"eval/source-work-item/outcome-evidence-verification/validated",
		"eval/source-work-item/outcome-evidence-verification/release-events",
	],
	[
		"eval/source-work-item/outcome-evidence-verification",
		"eval/source-work-item/outcome-evidence-verification/release-events",
	],
	[
		"eval/source-work-item/outcome-evidence-verification/release-events",
		"eval/source-work-item/outcome-evidence-verification/release-controller",
	],
	["eval/memory/exposure-frame/candidate", "eval/memory/exposure-frame/validated"],
	["eval/memory/exposure-frame/validated", "eval/memory/exposure-frame/released"],
	["eval/memory/exposure-frame/released", "eval/memory/exposure-frame"],
	["eval/memory/exposure-frame/validated", "eval/memory/exposure-frame/release-events"],
	["eval/memory/exposure-frame", "eval/memory/exposure-frame/release-events"],
	["eval/memory/exposure-frame/release-events", "eval/memory/exposure-frame/release-controller"],
	["eval/findings/efficacy/candidate", "eval/findings/efficacy/validated"],
	["eval/findings/efficacy/validated", "eval/findings/efficacy/released"],
	["eval/findings/efficacy/released", "eval/findings/efficacy"],
	["eval/findings/efficacy/validated", "eval/findings/efficacy/release-events"],
	["eval/findings/efficacy", "eval/findings/efficacy/release-events"],
	["eval/findings/efficacy/release-events", "eval/findings/efficacy/release-controller"],
	["eval/provider/result-status-release-events", "eval/provider/result-status-release-controller"],
	[
		"eval/campaign/replicate-batch-release-events",
		"eval/campaign/replicate-batch-release-controller",
	],
	["eval/provider/proposal-release-events", "eval/provider/proposal-release-controller"],
	["eval/development/qualification-events", "eval/development/qualification"],
	["eval/provider/proposal-events", "eval/provider/proposals"],
	["eval/verification/diagnostic-events", "eval/verification/diagnostics"],
	["eval/time/elapsed-budget/events", "eval/time/elapsed-budget/state"],
	["eval/memory/source-readiness-events", "eval/memory/six-arm-source-readiness-decision"],
	["eval/work-item/admitted-plan-events", "eval/work-item/admitted-plan-authority"],
	["eval/provider/first-proposal-events", "eval/provider/proposal-candidate"],
	["eval/tool/admission-events", "eval/tool/exact-admission"],
	["eval/provider/budget-settled-outcomes", "eval/observation/candidate-provider-proposal"],
	["eval/tool/exact-admission", "eval/observation/candidate-tool-admission"],
	["eval/tool/result", "eval/observation/candidate-tool-result"],
	["eval/provider/admission-events", "eval/provider/graph-admission-and-budget"],
	["eval/campaign/start", "eval/time/elapsed-budget/schedule"],
	["eval/campaign/start", "eval/time/elapsed-budget/timer-source"],

	["eval/time/elapsed-budget/timer-source", "eval/time/elapsed-budget/clock"],
	["eval/time/elapsed-budget/timer-source", "eval/time/elapsed-budget/clock-release-events"],
	["eval/time/elapsed-budget/clock", "eval/time/elapsed-budget/clock-release-events"],
	[
		"eval/time/elapsed-budget/clock-release-events",
		"eval/time/elapsed-budget/clock-release-controller",
	],
	["eval/time/elapsed-budget/schedule", "eval/time/elapsed-budget/readiness/runtime"],
	["eval/time/elapsed-budget/clock", "eval/time/elapsed-budget/readiness/runtime"],
	["eval/time/elapsed-budget/readiness/runtime", "eval/time/elapsed-budget/readiness/ready"],
	["eval/time/elapsed-budget/schedule", "eval/time/elapsed-budget/events"],
	["eval/time/elapsed-budget/readiness/ready", "eval/time/elapsed-budget/events"],
	["eval/cleanup/completed", "eval/campaign/controller-events"],
	["eval/campaign/task-bindings", "eval/source-work-item/request-authority"],
	["eval/campaign/contract", "eval/source-work-item/request-authority"],
	["eval/campaign/start", "eval/source-work-item/schedule"],
	["eval/source-work-item/request-authority", "eval/source-work-item/schedule"],
	["eval/campaign/contract", "eval/source-work-item/schedule"],
	["eval/source-work-item/schedule", "eval/source-work-item/objective-data"],
	["eval/source-work-item/schedule", "eval/source-work-item/attempt-resource-plan"],
	[
		"eval/source-work-item/objective-data",
		"eval/solution/source-work-item-execution/workItemSeeds",
	],
	[
		"eval/source-work-item/attempt-resource-plan",
		"eval/solution/source-work-item-execution/plan/runtime",
	],
	[
		"eval/solution/source-work-item-execution/plan/effectRequests",
		"eval/solution/source-work-item-execution/effectRuns/runtime",
	],
	[
		"eval/solution/source-work-item-execution/effectRuns/effectRuns",
		"eval/solution/source-work-item-execution/requestFacts",
	],
	[
		"eval/source-work-item/request-authority",
		"eval/source-work-item/outcome-evidence-verification/candidate",
	],
	[
		"eval/source-work-item/terminal-outcomes",
		"eval/source-work-item/outcome-evidence-verification/candidate",
	],
	[
		"eval/source-work-item/outcome-evidence-verification",
		"eval/source-work-item/memory-handoff-candidate",
	],
	[
		"eval/source-work-item/outcome-evidence-verification",
		"eval/source-work-item/memory-handoff-decision",
	],
	[
		"eval/source-work-item/memory-handoff-candidate",
		"eval/source-work-item/memory-handoff/correlation",
	],
	[
		"eval/source-work-item/memory-handoff-decision",
		"eval/source-work-item/memory-handoff/correlation",
	],
	[
		"eval/source-work-item/memory-handoff/correlation",
		"eval/source-work-item/memory-handoff/admitted",
	],
	[
		"eval/source-work-item/memory-handoff/correlation",
		"eval/source-work-item/memory-handoff/rejected",
	],
	[
		"eval/source-work-item/memory-handoff/correlation",
		"eval/source-work-item/memory-handoff/status",
	],
	[
		"eval/source-work-item/memory-handoff/correlation",
		"eval/source-work-item/memory-handoff/issues",
	],
	[
		"eval/source-work-item/memory-handoff/correlation",
		"eval/source-work-item/memory-handoff/cursor",
	],
	[
		"eval/source-work-item/memory-handoff/admitted",
		"eval/source-work-item/memory-handoff/accepted",
	],
	[
		"eval/source-work-item/memory-handoff/admitted",
		"eval/source-work-item/memory-handoff/release-controller",
	],
	[
		"eval/source-work-item/memory-handoff/accepted",
		"eval/source-work-item/memory-handoff/release-controller",
	],
	["eval/source-work-item/memory-handoff/accepted", "eval/source-work-item/verified-solution"],
	["eval/source-work-item/memory-handoff/status", "eval/campaign/controller-events"],
	["eval/source-work-item/request-authority", "eval/campaign/sealed-configuration"],
	["eval/campaign/contract", "eval/campaign/sealed-configuration"],
	["eval/campaign/task-bindings", "eval/campaign/sealed-configuration"],
	["eval/controls/memory-provenance", "eval/campaign/sealed-configuration"],
	["eval/campaign/sealed-configuration", "eval/campaign/controller-events"],
	["eval/campaign/controller-events", "eval/campaign/replicate-controller"],
	["eval/campaign/replicate-controller", "eval/campaign/state-events"],
	["eval/campaign/start", "eval/campaign/state-events"],
	["eval/campaign/contract", "eval/campaign/state-events"],
	["eval/campaign/state-events", "eval/campaign/state"],
	["eval/billing/fact-events", "eval/billing/observation-proposal-and-stopping"],

	["eval/campaign/replicate-controller", "eval/campaign/replicate-batches"],
	["eval/campaign/replicate-batches", "eval/work-item/objective-data"],
	["eval/campaign/replicate-batches", "eval/memory/six-arm-batch-candidate"],
	["eval/source-work-item/verified-solution", "eval/memory/source-readiness-events"],
	["eval/campaign/replicate-batches", "eval/memory/source-readiness-events"],
	[
		"eval/memory/six-arm-batch-candidate",
		"eval/memory/six-arm-source-readiness-handoff/correlation",
	],
	[
		"eval/memory/six-arm-source-readiness-decision",
		"eval/memory/six-arm-source-readiness-handoff/correlation",
	],
	[
		"eval/memory/six-arm-source-readiness-handoff/correlation",
		"eval/memory/six-arm-source-readiness-handoff/admitted",
	],
	[
		"eval/memory/six-arm-source-readiness-handoff/admitted",
		"eval/memory/six-arm-source-readiness-handoff/accepted",
	],
	[
		"eval/memory/six-arm-source-readiness-handoff/admitted",
		"eval/memory/six-arm-source-readiness-handoff/release-controller",
	],
	[
		"eval/memory/six-arm-source-readiness-handoff/accepted",
		"eval/memory/six-arm-source-readiness-handoff/release-controller",
	],
	[
		"eval/memory/six-arm-source-readiness-handoff/correlation",
		"eval/memory/six-arm-source-readiness-handoff/rejected",
	],
	[
		"eval/memory/six-arm-source-readiness-handoff/correlation",
		"eval/memory/six-arm-source-readiness-handoff/status",
	],
	[
		"eval/memory/six-arm-source-readiness-handoff/correlation",
		"eval/memory/six-arm-source-readiness-handoff/issues",
	],
	[
		"eval/memory/six-arm-source-readiness-handoff/correlation",
		"eval/memory/six-arm-source-readiness-handoff/cursor",
	],
	["eval/memory/six-arm-source-readiness-handoff/accepted", "eval/memory/correlated-six-arm-data"],
	["eval/memory/correlated-six-arm-data", "eval/memory/source-record-data"],
	["eval/work-item/objective-data", "eval/solution/work-item-execution/workItemSeeds"],
	["eval/work-item/attempt-resource-plan", "eval/solution/work-item-execution/plan/runtime"],
	[
		"eval/solution/work-item-execution/plan/effectRequests",
		"eval/solution/work-item-execution/effectRuns/runtime",
	],
	[
		"eval/solution/work-item-execution/effectRuns/effectRuns",
		"eval/solution/work-item-execution/requestFacts",
	],
	[
		"eval/solution/agentic-work-item-memory-bridge/projection",
		"eval/solution/agentic-work-item-memory-bridge/scoreSignals",
	],
	[
		"eval/solution/agentic-work-item-memory-bridge/projection",
		"eval/solution/agentic-work-item-memory-bridge/proposals",
	],
	[
		"eval/solution/agentic-work-item-memory-bridge/projection",
		"eval/solution/agentic-work-item-memory-bridge/status",
	],
	[
		"eval/solution/agentic-work-item-memory-bridge/projection",
		"eval/solution/agentic-work-item-memory-bridge/issues",
	],
	[
		"eval/solution/agentic-work-item-memory-bridge/projection",
		"eval/solution/agentic-work-item-memory-bridge/audit",
	],
	[
		"eval/solution/agentic-work-item-memory-bridge/projection",
		"eval/solution/agentic-work-item-memory-bridge/cursor",
	],
	[
		"eval/solution/agentic-memory-admission/projection",
		"eval/solution/agentic-memory-admission/admissions",
	],
	[
		"eval/solution/agentic-memory-admission/projection",
		"eval/solution/agentic-memory-admission/admitted",
	],
	[
		"eval/solution/agentic-memory-admission/projection",
		"eval/solution/agentic-memory-admission/rejected",
	],
	[
		"eval/solution/agentic-memory-admission/projection",
		"eval/solution/agentic-memory-admission/needsReview",
	],
	[
		"eval/solution/agentic-memory-admission/projection",
		"eval/solution/agentic-memory-admission/status",
	],
	[
		"eval/solution/agentic-memory-admission/projection",
		"eval/solution/agentic-memory-admission/issues",
	],
	[
		"eval/solution/agentic-memory-admission/projection",
		"eval/solution/agentic-memory-admission/audit",
	],
	[
		"eval/solution/agentic-memory-admission/projection",
		"eval/solution/agentic-memory-admission/cursor",
	],
	[
		"eval/solution/agentic-memory-application/projection",
		"eval/solution/agentic-memory-application/records",
	],
	[
		"eval/solution/agentic-memory-application/projection",
		"eval/solution/agentic-memory-application/appliedRecords",
	],
	[
		"eval/solution/agentic-memory-application/projection",
		"eval/solution/agentic-memory-application/applicationDecisions",
	],
	[
		"eval/solution/agentic-memory-application/projection",
		"eval/solution/agentic-memory-application/status",
	],
	[
		"eval/solution/agentic-memory-application/projection",
		"eval/solution/agentic-memory-application/operationStatuses",
	],
	[
		"eval/solution/agentic-memory-application/projection",
		"eval/solution/agentic-memory-application/issues",
	],
	[
		"eval/solution/agentic-memory-application/projection",
		"eval/solution/agentic-memory-application/audit",
	],
	[
		"eval/solution/agentic-memory-application/projection",
		"eval/solution/agentic-memory-application/cursor",
	],
	["eval/memory/bridge-result-context/arrivals", "eval/memory/bridge-result-context/matched"],
	["eval/memory/admission-result-context/arrivals", "eval/memory/admission-result-context/matched"],
	["eval/memory/source-record-data", "eval/memory/bridge-occurrence-input"],
	[
		"eval/memory/bridge-occurrence-input",
		"eval/solution/agentic-work-item-memory-bridge/projection",
	],
	[
		"eval/solution/agentic-work-item-memory-bridge/projection",
		"eval/memory/bridge-result-context/right",
	],
	["eval/memory/bridge-result-context/right", "eval/memory/bridge-result-context/arrivals"],
	["eval/memory/bridge-occurrence-input", "eval/memory/bridge-result-context/left"],
	["eval/memory/bridge-result-context/left", "eval/memory/bridge-result-context/arrivals"],
	["eval/memory/bridge-result-context", "eval/memory/admission-occurrence-input"],
	["eval/memory/admission-occurrence-input", "eval/solution/agentic-memory-admission/projection"],
	[
		"eval/solution/agentic-memory-admission/projection",
		"eval/memory/admission-result-context/right",
	],
	["eval/memory/admission-result-context/right", "eval/memory/admission-result-context/arrivals"],
	["eval/memory/admission-occurrence-input", "eval/memory/admission-result-context/left"],
	["eval/memory/admission-result-context/left", "eval/memory/admission-result-context/arrivals"],
	["eval/memory/admission-result-context", "eval/memory/application-occurrence-input"],
	[
		"eval/memory/application-occurrence-input",
		"eval/solution/agentic-memory-application/projection",
	],
	["eval/solution/agentic-memory-application/records", "eval/memory/applied-record-state"],
	["eval/memory/applied-record-state", "eval/memory/exposure-events"],
	["eval/memory/correlated-six-arm-data", "eval/memory/exposure-events"],
	["eval/memory/exposure-frame", "eval/memory/exposure-occurrence-input"],
	["eval/memory/exposure-occurrence-input", "eval/solution/agentic-memory/snapshot"],
	["eval/solution/agentic-memory/allowedRecords", "eval/memory/context-for-work-item"],
	["eval/memory/exposure-occurrence-input", "eval/memory/use-dispatch"],
	["eval/memory/use-dispatch", "eval/memory/context-for-work-item"],
	["eval/campaign/replicate-controller", "eval/campaign/replicate-batch-release-events"],
	["eval/campaign/replicate-batches", "eval/campaign/replicate-batch-release-events"],
	["eval/solution/source-work-item-execution/requests", "eval/provider/first-proposal-events"],
	["eval/solution/work-item-execution/requests", "eval/provider/first-proposal-events"],
	["eval/solution/work-item-execution/plan/admitted", "eval/work-item/admitted-plan-events"],
	["eval/work-item/admitted-plan-authority", "eval/provider/first-proposal-events"],
	["eval/profile/graph-admission", "eval/provider/first-proposal-events"],
	["eval/provider/proposal-candidate", "eval/provider/proposal"],
	["eval/provider/proposal-candidate", "eval/provider/proposal-release-events"],
	["eval/provider/proposal", "eval/provider/proposal-release-events"],
	["eval/time/elapsed-budget/state", "eval/provider/admission-events"],
	["eval/profile/graph-admission", "eval/provider/admission-events"],
	["eval/provider/proposal", "eval/provider/replicate-proposal-batches"],
	["eval/provider/replicate-proposal-batches", "eval/provider/proposal-events"],
	["eval/retry/proposal", "eval/provider/proposal-events"],
	["eval/provider/all-result-admissions", "eval/provider/start-spacing-readiness"],
	["eval/provider/proposals", "eval/provider/admission-events"],

	["eval/provider/start-spacing-readiness", "eval/provider/pacing-clock-inputs"],
	["eval/time/elapsed-budget/state", "eval/provider/pacing-clock-inputs"],
	["eval/provider/pacing-clock-inputs", "eval/provider/pacing-clock"],
	["eval/provider/pacing-clock", "eval/provider/pacing-events"],
	["eval/provider/proposals", "eval/provider/pacing-events"],
	["eval/retry/delay-result-input", "eval/provider/pacing-events"],
	["eval/provider/pacing-events", "eval/provider/paced-proposal-release"],
	["eval/provider/paced-proposal-release", "eval/provider/admission-events"],
	["eval/provider/result-input", "eval/provider/all-result-admissions"],
	["eval/provider/all-result-admissions", "eval/provider/result-admission"],
	["eval/provider/all-result-admissions", "eval/provider/failed-result-admission"],
	["eval/provider/all-result-admissions", "eval/provider/retryable-result-admission"],
	["eval/provider/all-result-admissions", "eval/provider/result-status-release-events"],
	["eval/provider/result-batch-events", "eval/provider/result-batches"],
	["eval/provider/result-admission", "eval/provider/result-status-release-events"],
	["eval/provider/failed-result-admission", "eval/provider/result-status-release-events"],
	["eval/provider/retryable-result-admission", "eval/provider/result-status-release-events"],
	["eval/provider/result-admission", "eval/provider/result-batch-events"],
	["eval/provider/failed-result-admission", "eval/provider/result-batch-events"],
	["eval/provider/retryable-result-admission", "eval/provider/result-batch-events"],
	["eval/provider/all-result-admissions", "eval/provider/cost-settlements"],
	["eval/provider/cost-settlements", "eval/provider/admission-events"],
	["eval/provider/start-spacing-readiness", "eval/provider/admission-events"],
	["eval/retry/delay-result-input", "eval/provider/admission-events"],
	["eval/provider/graph-admission-and-budget", "eval/provider/admissions"],
	["eval/provider/graph-admission-and-budget", "eval/provider/admission-observation-cut"],
	["eval/provider/admission-observation-cut", "eval/provider/adaptive-capacity-state"],
	["eval/provider/admission-observation-cut", "eval/budget/state"],
	["eval/provider/admissions", "eval/executor/current-provider-effect"],
	["eval/source-work-item/tool-result-input", "eval/tool/admission-events"],
	["eval/campaign/task-bindings", "eval/tool/admission-events"],
	["eval/budget/state", "eval/tool/admission-events"],
	["eval/tool/exact-admission", "eval/executor/current-tool-effect"],
	["eval/provider/retryable-result-admission", "eval/retry/delay-admission"],
	["eval/time/elapsed-budget/state", "eval/retry/delay-admission"],
	["eval/provider/retryable-result-admission", "eval/retry/admission-release-events"],
	["eval/retry/delay-admission", "eval/retry/admission-release-events"],
	["eval/retry/admission-release-events", "eval/retry/admission-release-controller"],
	["eval/retry/delay-admission", "eval/executor/current-retry-delay"],
	["eval/cleanup/completed", "eval/billing/fact-events"],
	["eval/budget/state", "eval/billing/fact-events"],
	["eval/billing/observation-result-input", "eval/billing/fact-events"],
	["eval/billing/current-key-before", "eval/billing/fact-events"],
	["eval/campaign/state", "eval/billing/fact-events"],
	["eval/billing/observation-proposal-and-stopping", "eval/billing/observation-proposals"],
	["eval/billing/observation-proposals", "eval/billing/observation-admission"],
	["eval/billing/current-key-before", "eval/billing/observation-admission"],
	["eval/billing/observation-proposals", "eval/billing/admission-release-events"],
	["eval/billing/observation-admission", "eval/billing/admission-release-events"],
	["eval/billing/admission-release-events", "eval/billing/admission-release-controller"],
	["eval/billing/observation-admission", "eval/executor/current-billing-observation"],
	["eval/billing/observation-proposal-and-stopping", "eval/billing/reconciliation"],
	["eval/retry/delay-result-input", "eval/retry/proposal-fact"],
	["eval/retry/proposal-fact", "eval/retry/proposal"],
	[
		"eval/executor/current-provider-effect",
		"eval/executor/provider-effect-lifecycle-registry/events",
	],
	[
		"eval/provider/all-result-admissions",
		"eval/executor/provider-effect-lifecycle-registry/events",
	],
	["eval/campaign/start", "eval/executor/provider-effect-lifecycle-registry/events"],
	[
		"eval/executor/provider-effect-lifecycle-registry/events",
		"eval/executor/provider-effect-lifecycle-registry",
	],
	["eval/executor/current-retry-delay", "eval/executor/retry-effect-lifecycle-registry/events"],
	["eval/retry/delay-result-input", "eval/executor/retry-effect-lifecycle-registry/events"],
	["eval/campaign/start", "eval/executor/retry-effect-lifecycle-registry/events"],
	[
		"eval/executor/retry-effect-lifecycle-registry/events",
		"eval/executor/retry-effect-lifecycle-registry",
	],
	["eval/executor/current-tool-effect", "eval/executor/tool-effect-lifecycle-registry/events"],
	["eval/tool/all-result-inputs", "eval/executor/tool-effect-lifecycle-registry/events"],
	["eval/campaign/start", "eval/executor/tool-effect-lifecycle-registry/events"],
	[
		"eval/executor/tool-effect-lifecycle-registry/events",
		"eval/executor/tool-effect-lifecycle-registry",
	],
	[
		"eval/executor/current-billing-observation",
		"eval/executor/billing-effect-lifecycle-registry/events",
	],
	[
		"eval/billing/observation-result-input",
		"eval/executor/billing-effect-lifecycle-registry/events",
	],
	["eval/campaign/start", "eval/executor/billing-effect-lifecycle-registry/events"],
	[
		"eval/executor/billing-effect-lifecycle-registry/events",
		"eval/executor/billing-effect-lifecycle-registry",
	],
	["eval/executor/provider-effect-lifecycle-registry", "eval/executor/active-provider-effects"],
	["eval/executor/tool-effect-lifecycle-registry", "eval/executor/active-tool-effects"],
	["eval/executor/retry-effect-lifecycle-registry", "eval/executor/active-retry-effects"],
	["eval/executor/billing-effect-lifecycle-registry", "eval/executor/active-billing-effects"],
	["eval/executor/provider-effect-lifecycle-registry", "eval/observation/provider-effect-activity"],
	["eval/executor/tool-effect-lifecycle-registry", "eval/observation/tool-effect-activity"],
	["eval/executor/retry-effect-lifecycle-registry", "eval/observation/retry-effect-activity"],
	["eval/executor/billing-effect-lifecycle-registry", "eval/observation/billing-effect-activity"],
	["eval/observation/provider-effect-activity", "eval/observation/effect-activity"],
	["eval/observation/tool-effect-activity", "eval/observation/effect-activity"],
	["eval/observation/retry-effect-activity", "eval/observation/effect-activity"],
	["eval/observation/billing-effect-activity", "eval/observation/effect-activity"],
	["eval/budget/state", "eval/observation/effect-activity"],
	["eval/executor/provider-effect-lifecycle-registry", "eval/executor/caller-admitted-effect"],
	["eval/executor/tool-effect-lifecycle-registry", "eval/executor/caller-admitted-tool-effect"],
	["eval/executor/retry-effect-lifecycle-registry", "eval/executor/caller-admitted-retry-effect"],
	[
		"eval/executor/billing-effect-lifecycle-registry",
		"eval/executor/caller-admitted-billing-effect",
	],
	["eval/provider/failed-result-admission", "eval/effect/terminal-outcomes/inputs"],
	["eval/tool/result-input", "eval/effect/terminal-outcomes/inputs"],
	["eval/effect/terminal-outcomes/inputs", "eval/effect/terminal-outcomes"],
	["eval/effect/terminal-outcomes/inputs", "eval/effect/terminal-outcomes/release-events"],
	["eval/effect/terminal-outcomes", "eval/effect/terminal-outcomes/release-events"],
	[
		"eval/effect/terminal-outcomes/release-events",
		"eval/effect/terminal-outcomes/release-controller",
	],
	["eval/effect/terminal-outcomes", "eval/provider/reconciliation"],
	["eval/source-work-item/tool-result-input", "eval/tool/result"],
	["eval/effect/terminal-outcomes", "eval/verification/diff"],
	["eval/provider/reconciliation", "eval/solution/work-item-execution/plan/runtime"],
	["eval/provider/graph-admission-and-budget", "eval/provider/budget-settled-outcomes"],

	["eval/provider/budget-settled-outcomes", "eval/tool/admission-events"],
	["eval/verification/diff", "eval/verification/public-semantic"],
	["eval/verification/public-semantic", "eval/verification/hidden-verifier"],
	["eval/verification/hidden-verifier", "eval/cleanup/completed"],
	["eval/campaign/start", "eval/verification/diagnostic-events"],
	["eval/cleanup/completed", "eval/verification/diagnostic-events"],
	["eval/verification/diagnostics", "eval/findings/efficacy-state"],
	["eval/budget/state", "eval/findings/efficacy-state"],
	["eval/campaign/state", "eval/findings/efficacy-state"],
	["eval/billing/observation-proposal-and-stopping", "eval/findings/efficacy-state"],
	["eval/findings/efficacy-state", "eval/findings/efficacy/candidate"],
	["eval/billing/reconciliation", "eval/findings/efficacy/candidate"],
	["eval/observation/effect-activity", "eval/findings/efficacy/candidate"],
	["eval/cleanup/completed", "eval/findings/matched-evidence-events"],
	["eval/provider/all-result-admissions", "eval/findings/matched-evidence-events"],
	["eval/source-work-item/memory-handoff/status", "eval/findings/matched-evidence-events"],
	["eval/source-work-item/request-authority", "eval/findings/matched-evidence-events"],
	["eval/campaign/start", "eval/findings/matched-evidence-events"],
	["eval/findings/matched-evidence-events", "eval/findings/matched-source-target-evidence"],
	["eval/findings/matched-source-target-evidence", "eval/findings/efficacy/candidate"],
	["eval/campaign/contract", "eval/development/qualification-events"],
	["eval/findings/efficacy", "eval/development/qualification-events"],

	["eval/memory/context-for-work-item", "eval/work-item/attempt-resource-plan"],
	["eval/profile/graph-admission", "eval/work-item/attempt-resource-plan"],
] as const);

export interface RootEvalTopologyContractReport {
	readonly rootGraphs: 1;
	readonly mounts: 0;
	readonly requiredNodes: number;
	readonly criticalEdges: number;
	readonly memoryLifecycleCardinality: 1;
	readonly armOrder: typeof HARNESS_ARMS;
	readonly treatment: "relevant-applied";
	readonly controls: readonly [
		"cold",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	];
}

function sameArmOrder(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.length === HARNESS_ARMS.length &&
		value.every((arm, index) => arm === HARNESS_ARMS[index])
	);
}

export function assertRootEvalTopologyContract(
	snapshot: DescribeSnapshot,
): RootEvalTopologyContractReport {
	if (snapshot.name !== "eval/root")
		throw new Error("topology contract: root graph identity missing");
	if ((snapshot.subgraphs?.length ?? 0) !== 0)
		throw new Error("topology contract: hidden or mounted Graph detected");
	const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
	if (nodes.size !== snapshot.nodes.length)
		throw new Error("topology contract: duplicate node identity");
	for (const [id, factory] of Object.entries(ROOT_EVAL_REQUIRED_NODES)) {
		const node = nodes.get(id);
		if (node === undefined) throw new Error(`topology contract: missing node '${id}'`);
		if (node.factory !== factory)
			throw new Error(`topology contract: solution identity drift at '${id}'`);
	}
	const edges = new Set(snapshot.edges.map((edge) => `${edge.from}\n${edge.to}`));
	for (const [from, to] of ROOT_EVAL_CRITICAL_EDGES) {
		if (!nodes.has(from) || !nodes.has(to))
			throw new Error(`topology contract: missing critical node endpoint '${from}' -> '${to}'`);
		if (!edges.has(`${from}\n${to}`))
			throw new Error(`topology contract: missing critical edge '${from}' -> '${to}'`);
	}
	const start = nodes.get("eval/campaign/start");
	if (!sameArmOrder(start?.meta?.armOrder))
		throw new Error("topology contract: six-arm canonical order drift");
	if (start?.meta?.replicateCount !== 5)
		throw new Error("topology contract: five-replicate campaign drift");
	const replicateController = nodes.get("eval/campaign/replicate-controller");
	if (
		replicateController?.meta?.sourceFailurePolicy !== "fail-closed-dependency-closure" ||
		replicateController.meta.adaptiveRetryMayRebind !== false
	)
		throw new Error("topology contract: sealed source fail-closed policy drift");
	const elapsedTimer = nodes.get("eval/time/elapsed-budget/timer-source");
	if (
		elapsedTimer?.meta?.delayMs !== ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS ||
		elapsedTimer.meta.startWaveSettlement !== "immediate-resolved" ||
		elapsedTimer.meta.boundaryEmission !== "new-external-data-wave" ||
		elapsedTimer.meta.asyncPool !== true ||
		elapsedTimer.meta.pausable !== false ||
		!Array.isArray(elapsedTimer.meta.decisionRefs) ||
		!elapsedTimer.meta.decisionRefs.includes("graphrefly-ts:D131")
	)
		throw new Error("topology contract: elapsed timer-source semantics drift");
	const provenance = nodes.get("eval/controls/memory-provenance");
	if (provenance?.meta?.treatment !== "relevant-applied" || provenance.meta.controls !== 5)
		throw new Error("topology contract: treatment/control identity drift");
	const correlatedMemory = nodes.get("eval/memory/correlated-six-arm-data");
	if (
		correlatedMemory?.meta?.lifecycleCardinality !== "one-fixed-lifecycle" ||
		correlatedMemory.meta.dataCardinality !== "six-arms" ||
		correlatedMemory.meta.correlation !== "task-instance/source-work-item/target-work-item"
	)
		throw new Error("topology contract: one-lifecycle six-DATA memory cardinality drift");
	for (const factory of [
		"agenticWorkItemMemoryBridge",
		"agenticMemoryRecordAdmission",
		"agenticMemoryRecordApplication",
		"agenticMemoryRecordUseGate",
	] as const)
		if (snapshot.nodes.filter((node) => node.factory === factory).length !== 1)
			throw new Error(`topology contract: fixed memory lifecycle duplicated at '${factory}'`);
	const workItemPlan = nodes.get("eval/work-item/attempt-resource-plan");
	const contextDependencies = snapshot.edges
		.filter((edge) => edge.to === "eval/memory/context-for-work-item")
		.map((edge) => edge.from)
		.sort();
	if (
		JSON.stringify(contextDependencies) !==
		JSON.stringify(
			["eval/memory/use-dispatch", "eval/solution/agentic-memory/allowedRecords"].sort(),
		)
	)
		throw new Error("topology contract: governed memory context raw-record bypass");
	if (
		workItemPlan?.meta?.timeoutAuthority !== "work-item-effect-plan" ||
		workItemPlan.meta.effectTimeoutMs !== ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS
	)
		throw new Error("topology contract: Work Item effect timeout authority drift");
	const providerAdmission = nodes.get("eval/provider/graph-admission-and-budget");
	const providerProposal = nodes.get("eval/provider/proposal-candidate");
	if (providerProposal?.meta?.timeoutAuthority !== "reads-work-item-plan-data")
		throw new Error("topology contract: provider proposal timeout dependency drift");
	if (providerAdmission?.meta?.timeoutAuthority !== "copied-from-work-item-plan")
		throw new Error("topology contract: provider timeout admission drift");
	const exactToolAdmission = nodes.get("eval/tool/exact-admission");
	if (
		exactToolAdmission?.meta?.sourceBarrier !== "all-five-provider-outcomes-before-source-tools" ||
		exactToolAdmission.meta.sourceBudgetBarrier !==
			"all-five-provider-budget-settlements-before-source-tools" ||
		exactToolAdmission.meta.sourceToolCapacity !== 1 ||
		exactToolAdmission.meta.stoppedSourceDrain !==
			"settled-admitted-source-tools-without-unstarted-siblings"
	)
		throw new Error("topology contract: source exact-tool capacity/barrier drift");
	const providerPacing = nodes.get("eval/provider/paced-proposal-release");
	const providerStartSpacing = nodes.get("eval/provider/start-spacing-readiness");
	if (
		providerStartSpacing?.meta?.materialFree !== true ||
		providerStartSpacing.meta.domainAuthority !== "root-graph" ||
		providerStartSpacing.meta.providerStartIntervalMs !== ROOT_EVAL_PROVIDER_START_INTERVAL_MS ||
		providerStartSpacing.meta.inputEvidence !== "canonical-provider-outcome.dispatchElapsedMs" ||
		providerStartSpacing.meta.policy !== "D154/30-60-120-240/three-usable-success-recovery" ||
		providerStartSpacing.meta.stateScope !== "campaign-route-across-work-items-and-replicates"
	)
		throw new Error("topology contract: provider start-spacing readiness drift");
	if (
		providerPacing?.meta?.domainAuthority !== "root-graph" ||
		providerPacing.meta.materialFree !== true ||
		providerPacing.meta.maxConcurrentEffects !== 1 ||
		providerPacing.meta.providerStartIntervalMs !== ROOT_EVAL_PROVIDER_START_INTERVAL_MS ||
		providerPacing.meta.startEvidence !== "provider-outcome.dispatchElapsedMs" ||
		providerPacing.meta.readinessAuthority !== "graph-computes-remaining-start-spacing" ||
		providerPacing.meta.callerAuthority !== "none"
	)
		throw new Error("topology contract: provider pacing policy drift");
	if (
		providerAdmission.meta?.capacityPolicy !== "paced-serial" ||
		providerAdmission.meta.initialMaxConcurrentEffects !== ROOT_EVAL_INITIAL_PROVIDER_CAPACITY ||
		providerAdmission.meta.rateLimitedMaxConcurrentEffects !==
			ROOT_EVAL_RATE_LIMITED_PROVIDER_CAPACITY ||
		providerAdmission.meta.cooldownReadiness !== "exact-correlated-retry-delay-outcome" ||
		providerAdmission.meta.proposalOrder !== "replicate-fixed-arm-dispatch" ||
		providerAdmission.meta.providerStartIntervalMs !== ROOT_EVAL_PROVIDER_START_INTERVAL_MS
	)
		throw new Error("topology contract: adaptive provider capacity policy drift");
	const providerCapacity = nodes.get("eval/provider/adaptive-capacity-state");
	const providerAdmissionObservationCut = nodes.get("eval/provider/admission-observation-cut");
	if (
		providerAdmission?.meta?.atomicAdmissionObservationCut !== true ||
		providerAdmission.meta.preEmissionValidated !== true ||
		providerAdmissionObservationCut?.meta?.domainAuthority !== "graph-state" ||
		providerAdmissionObservationCut.meta.materialFree !== true ||
		JSON.stringify(providerAdmissionObservationCut.meta.atomicFields) !==
			JSON.stringify(["budget", "capacity", "activeProviderAdmissionIds"]) ||
		providerCapacity?.meta?.domainAuthority !== "graph-state" ||
		providerCapacity.meta.materialFree !== true ||
		providerCapacity.meta.rebound !== false
	)
		throw new Error("topology contract: adaptive provider capacity state drift");
	const observation = nodes.get("eval/observation");
	const canonical = nodes.get("eval/observation/canonical-state");
	if (
		observation?.meta?.materialFree !== true ||
		observation.meta.sanitizer !== false ||
		observation.meta.authority !== "canonical-occurrence-value-projection" ||
		canonical?.meta?.authority !== "read-only-exact-coherent-cut" ||
		canonical.meta.materialFree !== true ||
		canonical.meta.sanitizer !== false ||
		canonical.meta.correlation !==
			"admission-budget-digest/provider-identities/campaign-completed-coordinate" ||
		!Number.isSafeInteger(canonical.meta.retentionBound) ||
		Number(canonical.meta.retentionBound) < 1 ||
		snapshot.edges.some(
			(edge) =>
				edge.from.startsWith("eval/observation/") &&
				edge.to === "eval/provider/graph-admission-and-budget",
		)
	)
		throw new Error("topology contract: raw observation policy drift");
	if (snapshot.nodes.filter((node) => node.id === "eval/observation").length !== 1)
		throw new Error("topology contract: canonical observation identity drift");
	const diagnostics = nodes.get("eval/verification/diagnostics");
	if (
		diagnostics?.meta?.domainAuthority !== "graph-state" ||
		diagnostics.meta.materialFree !== true
	)
		throw new Error("topology contract: verification diagnostics authority drift");
	const raw = JSON.stringify(snapshot);
	for (const forbidden of [
		"api_key",
		"authorization",
		"provider body",
		"tool arguments",
		"private-marker",
	])
		if (raw.toLowerCase().includes(forbidden))
			throw new Error(`topology contract: raw material leaked through '${forbidden}'`);
	return Object.freeze({
		rootGraphs: 1,
		mounts: 0,
		requiredNodes: Object.keys(ROOT_EVAL_REQUIRED_NODES).length,
		criticalEdges: ROOT_EVAL_CRITICAL_EDGES.length,
		memoryLifecycleCardinality: 1,
		armOrder: HARNESS_ARMS,
		treatment: "relevant-applied",
		controls: [
			"cold",
			"proposal-only",
			"admission-rejected",
			"irrelevant-applied",
			"wrong-scope-applied",
		] as const,
	});
}
