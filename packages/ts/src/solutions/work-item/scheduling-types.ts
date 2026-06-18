import type { DataIssue } from "../../data/index.js";
import type { Node } from "../../node/node.js";
import type {
	AgentOutputEnvelope,
	AgentRuntimeAuditRecord,
	EffectRunGoal,
	EffectRunLimits,
	EffectRunResult,
	EffectRunResultStatus,
	SourceRef,
} from "../../orchestration/agent-runtime.js";
import type {
	WorkItemDomainActionProposal,
	WorkItemDomainActionProposalSpec,
	WorkItemEffectRequested,
	WorkItemEvidenceRecorded,
} from "../../orchestration/work-item-runtime.js";

export type WorkItemValidationIssueCode =
	| "malformed-draft"
	| "missing-required-field"
	| "invalid-patch"
	| "duplicate-id"
	| "dangling-ref"
	| "cyclic-dependency"
	| "unsupported-mode"
	| "unsupported-effect-kind"
	| "oversized-inline-data"
	| "policy-mismatch"
	| "missing-policy"
	| "stale-revision"
	| "stale-execution-input"
	| "blocked-prerequisite"
	| "verification-unplanned"
	| "manual-review-required"
	| "duplicate-suppressed"
	| "ambiguous-coverage"
	| "partial-coverage"
	| "unverifiable-output"
	| "unauthorized-author"
	| "unauthorized-target"
	| "invalid-schedule";

export type WorkItemValidationStatusState =
	| "projected"
	| "rejected"
	| "deferred"
	| "blocked"
	| "needs-human-review"
	| "stale"
	| "duplicate"
	| "request-emitted"
	| "result-recorded"
	| "domain-action-proposed";

export interface WorkItemValidationStatus {
	readonly kind: "work-item-validation-status";
	readonly statusId: string;
	readonly workItemId?: string;
	readonly state: WorkItemValidationStatusState;
	readonly code?: WorkItemValidationIssueCode;
	readonly revision?: number;
	readonly executionInputRevision?: number;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly stepId?: string;
	readonly criterionId?: string;
	readonly message?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface AcceptanceCriterion {
	readonly criterionId: string;
	readonly statement: string;
	readonly required?: boolean;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type VerificationStepMode = "auto" | "manual" | "hybrid";

export interface VerificationStep<TInput = unknown> {
	readonly stepId: string;
	readonly title?: string;
	readonly description?: string;
	readonly verifiesCriteriaIds?: readonly string[];
	readonly mode: VerificationStepMode;
	readonly effectKind?: string;
	readonly goal?: EffectRunGoal<TInput>;
	readonly input?: TInput;
	readonly contextRefs?: readonly SourceRef[];
	readonly requirements?: readonly string[];
	readonly capacityHints?: Record<string, unknown>;
	readonly dependsOnStepIds?: readonly string[];
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface VerificationPlan<TInput = unknown> {
	readonly planId: string;
	readonly planRevision?: string | number;
	readonly steps: readonly VerificationStep<TInput>[];
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemDraft<TInput = unknown> {
	readonly summary: string;
	readonly detail?: string;
	readonly detailRefs?: readonly SourceRef[];
	readonly acceptanceCriteria?: readonly AcceptanceCriterion[];
	readonly verificationPlan?: VerificationPlan<TInput>;
	readonly verificationSteps?: readonly VerificationStep<TInput>[];
	readonly kind?: string;
	readonly priority?: number;
	readonly tags?: readonly string[];
	readonly owner?: string;
	readonly assignee?: string;
	readonly deadlineMs?: number;
	readonly customFields?: Record<string, unknown>;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemPatch<TInput = unknown> = Partial<WorkItemDraft<TInput>>;

export interface WorkItemCreated<TInput = unknown> {
	readonly kind: "work-item-created";
	readonly eventId: string;
	readonly workItemId: string;
	readonly draft: WorkItemDraft<TInput>;
	readonly authorId?: string;
	readonly createdAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemPatched<TInput = unknown> {
	readonly kind: "work-item-patched";
	readonly eventId: string;
	readonly workItemId: string;
	readonly patch: WorkItemPatch<TInput>;
	readonly executionRelevantFields?: readonly string[];
	readonly authorId?: string;
	readonly patchedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AcceptanceCriteriaChanged {
	readonly kind: "acceptance-criteria-changed";
	readonly eventId: string;
	readonly workItemId: string;
	readonly acceptanceCriteria: readonly AcceptanceCriterion[];
	readonly authorId?: string;
	readonly changedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface VerificationPlanChanged<TInput = unknown> {
	readonly kind: "verification-plan-changed";
	readonly eventId: string;
	readonly workItemId: string;
	readonly verificationPlan: VerificationPlan<TInput>;
	readonly authorId?: string;
	readonly changedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemAuthoringFact<TInput = unknown> =
	| WorkItemCreated<TInput>
	| WorkItemPatched<TInput>
	| AcceptanceCriteriaChanged
	| VerificationPlanChanged<TInput>;

export interface WorkItemSpawnProposed<TInput = unknown> {
	readonly kind: "work-item-spawn-proposed";
	readonly proposalId: string;
	readonly parentWorkItemId?: string;
	readonly draft: WorkItemDraft<TInput>;
	readonly proposedBy?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemAuthoringInput<TInput = unknown> =
	| WorkItemAuthoringFact<TInput>
	| WorkItemSpawnProposed<TInput>;

export interface WorkItemProjection<TInput = unknown> extends WorkItemDraft<TInput> {
	readonly workItemId: string;
	readonly authoringRevision: number;
	readonly executionInputRevision: number;
	readonly lastEventId: string;
	readonly revisionSourceRefs?: readonly SourceRef[];
	readonly createdAtMs?: number;
	readonly updatedAtMs?: number;
}

export interface WorkItemPriorityAssessment {
	readonly kind: "work-item-priority-assessment";
	readonly assessmentId: string;
	readonly workItemId: string;
	readonly authoringRevision?: number;
	readonly executionInputRevision?: number;
	readonly priority?: number;
	readonly rank?: number;
	readonly reason?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemPlacementDecision {
	readonly kind: "work-item-placement-decision";
	readonly decisionId: string;
	readonly workItemId: string;
	readonly authoringRevision?: number;
	readonly executionInputRevision?: number;
	readonly laneId: string;
	readonly targetKind?: string;
	readonly reason?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemScheduleDecision {
	readonly kind: "work-item-schedule-decision";
	readonly decisionId: string;
	readonly workItemId: string;
	readonly authoringRevision?: number;
	readonly executionInputRevision?: number;
	readonly targetKind: "work-item-effect" | "work-queue" | "executor" | "status";
	readonly effectKind?: string;
	readonly notBeforeMs?: number;
	readonly deadlineMs?: number;
	readonly requirements?: readonly string[];
	readonly capacityHints?: Record<string, unknown>;
	readonly reason?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemDispatchIntent<TInput = unknown> {
	readonly kind: "work-item-dispatch-intent";
	readonly intentId: string;
	readonly workItemId: string;
	readonly authoringRevision?: number;
	readonly executionInputRevision: number;
	readonly targetKind:
		| "verification"
		| "approval"
		| "human-review"
		| "external-sync"
		| "spawn-review"
		| "background-evidence"
		| "executor";
	readonly effectKind?: string;
	readonly stepIds?: readonly string[];
	readonly acceptanceCriterionIds?: readonly string[];
	readonly goal?: EffectRunGoal<TInput>;
	readonly contextRefs?: readonly SourceRef[];
	readonly requirements?: readonly string[];
	readonly capacityHints?: Record<string, unknown>;
	readonly limits?: EffectRunLimits;
	readonly idempotencyKey?: string;
	readonly reason?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemAuthoringPolicy {
	readonly executionRelevantFields?: readonly string[];
}

export interface WorkItemAuthoringProjectorOptions<TInput = unknown> {
	readonly name?: string;
	readonly facts: Node<WorkItemAuthoringInput<TInput>>;
	readonly policy?: WorkItemAuthoringPolicy;
}

export interface WorkItemAuthoringProjectorBundle<TInput = unknown> {
	readonly workItems: Node<WorkItemProjection<TInput>>;
	readonly status: Node<WorkItemValidationStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export interface WorkItemVerificationLowererPolicy {
	readonly policyId?: string;
	readonly autoRun?: boolean;
	readonly allowedModes?: readonly VerificationStepMode[];
	readonly allowedEffectKinds?: readonly string[];
	readonly stalePolicy?: "cancel" | "reschedule" | "requeue" | "replacement-intent" | "review";
}

export interface WorkItemVerificationRequestLowererOptions<TInput = unknown> {
	readonly name?: string;
	readonly workItems: Node<WorkItemProjection<TInput>>;
	readonly dispatchIntents?: Node<WorkItemDispatchIntent<TInput>>;
	readonly verificationResults?: Node<VerificationResultRecorded>;
	readonly policy?: WorkItemVerificationLowererPolicy;
}

export interface WorkItemVerificationRequestLowererBundle<TInput = unknown> {
	readonly effectRequests: Node<WorkItemEffectRequested<TInput>>;
	readonly status: Node<WorkItemValidationStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type VerificationResultStatus =
	| "passed"
	| "failed"
	| "blocked"
	| "canceled"
	| "timeout"
	| "waived"
	| "unverifiable";

export interface VerificationResultRecorded {
	readonly kind: "verification-result-recorded";
	readonly resultId: string;
	readonly workItemId: string;
	readonly evidenceId: string;
	readonly effectRunId: string;
	readonly effectRunResultId: string;
	readonly executionInputRevision: number;
	readonly verificationStepIds: readonly string[];
	readonly acceptanceCriterionIds: readonly string[];
	readonly status: VerificationResultStatus;
	readonly output?: AgentOutputEnvelope;
	readonly error?: DataIssue;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly recordedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemVerificationMappingPolicy {
	readonly kind: "work-item-verification-mapping-policy";
	readonly policyId: string;
	readonly actionProposals?: readonly WorkItemDomainActionProposalSpec[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemVerificationResultMapperOptions<TInput = unknown> {
	readonly name?: string;
	readonly workItems: Node<WorkItemProjection<TInput>>;
	readonly evidence: Node<WorkItemEvidenceRecorded>;
	readonly policies?: Node<WorkItemVerificationMappingPolicy>;
}

export interface WorkItemVerificationResultMapperBundle {
	readonly results: Node<VerificationResultRecorded>;
	readonly proposals: Node<WorkItemDomainActionProposal>;
	readonly status: Node<WorkItemValidationStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type WorkItemEffectPlanJoinPolicy = "all-required" | "evidence-only";

export interface WorkItemEffectPlanMember<TInput = unknown> {
	readonly memberId: string;
	readonly effectKind: string;
	readonly goal: EffectRunGoal<TInput>;
	readonly required?: boolean;
	readonly dependsOnMemberIds?: readonly string[];
	readonly contextRefs?: readonly SourceRef[];
	readonly requirements?: readonly string[];
	readonly capacityHints?: Record<string, unknown>;
	readonly limits?: EffectRunLimits;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly idempotencyKey?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectPlanProposed<TInput = unknown> {
	readonly kind: "work-item-effect-plan-proposed";
	readonly planId: string;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly members: readonly WorkItemEffectPlanMember<TInput>[];
	readonly joinPolicy?: WorkItemEffectPlanJoinPolicy;
	readonly limits?: EffectRunLimits;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly proposedBy?: string;
	readonly proposedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectPlanSnapshot<TInput = unknown> {
	readonly planId: string;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly members: readonly WorkItemEffectPlanMember<TInput>[];
	readonly joinPolicy: WorkItemEffectPlanJoinPolicy;
	readonly limits?: EffectRunLimits;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectPlanAdmitted<TInput = unknown> {
	readonly kind: "work-item-effect-plan-admitted";
	readonly planId: string;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly plan: WorkItemEffectPlanSnapshot<TInput>;
	readonly sourceRefs?: readonly SourceRef[];
	readonly admittedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectPlanRejected {
	readonly kind: "work-item-effect-plan-rejected";
	readonly planId: string;
	readonly workItemId: string;
	readonly executionInputRevision?: number;
	readonly issues: readonly DataIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly rejectedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemEffectPlanMemberStatus =
	| "eligible"
	| "requested"
	| "blocked"
	| "deferred"
	| "evidence-recorded"
	| "completed"
	| "failed"
	| "duplicate"
	| "stale"
	| "rejected";

export interface WorkItemEffectPlanStatus {
	readonly kind: "work-item-effect-plan-status";
	readonly statusId: string;
	readonly workItemId: string;
	readonly planId: string;
	readonly executionInputRevision: number;
	readonly state: WorkItemEffectPlanMemberStatus;
	readonly planMemberId?: string;
	readonly requestId?: string;
	readonly effectRunId?: string;
	readonly evidenceId?: string;
	readonly effectRunResultId?: string;
	readonly issues?: readonly DataIssue[];
	readonly message?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemEffectPlanResultStatus = "succeeded" | "failed" | "evidence-only";

export interface WorkItemEffectPlanResult {
	readonly kind: "work-item-effect-plan-result";
	readonly resultId: string;
	readonly workItemId: string;
	readonly planId: string;
	readonly executionInputRevision: number;
	readonly status: WorkItemEffectPlanResultStatus;
	readonly memberResults: readonly {
		readonly planMemberId: string;
		readonly status: EffectRunResultStatus;
		readonly requestId?: string;
		readonly effectRunId?: string;
		readonly evidenceId?: string;
		readonly effectRunResultId?: string;
	}[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectPlanPolicy {
	readonly policyId?: string;
	readonly allowedEffectKinds?: readonly string[];
	readonly joinPolicy?: WorkItemEffectPlanJoinPolicy;
}

export interface WorkItemEffectPlanProjectorOptions<TInput = unknown> {
	readonly name?: string;
	readonly workItems: Node<WorkItemProjection<TInput>>;
	readonly proposals: Node<WorkItemEffectPlanProposed<TInput>>;
	readonly evidence?: Node<WorkItemEvidenceRecorded>;
	readonly effectRunResults?: Node<EffectRunResult>;
	readonly policy?: WorkItemEffectPlanPolicy;
	readonly now?: () => number;
}

export interface WorkItemEffectPlanProjectorBundle<TInput = unknown> {
	readonly admitted: Node<WorkItemEffectPlanAdmitted<TInput>>;
	readonly rejected: Node<WorkItemEffectPlanRejected>;
	readonly effectRequests: Node<WorkItemEffectRequested<TInput>>;
	readonly results: Node<WorkItemEffectPlanResult>;
	readonly status: Node<WorkItemEffectPlanStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type Fact<T> =
	| { readonly kind: "work-item"; readonly value: WorkItemProjection<T> }
	| { readonly kind: "request"; readonly value: WorkItemEffectRequested<T> }
	| { readonly kind: "result"; readonly value: VerificationResultRecorded }
	| { readonly kind: "proposal"; readonly value: WorkItemDomainActionProposal }
	| { readonly kind: "status"; readonly value: WorkItemValidationStatus }
	| { readonly kind: "issue"; readonly value: DataIssue }
	| { readonly kind: "audit"; readonly value: AgentRuntimeAuditRecord };

export type PlanFact<T> =
	| { readonly kind: "admitted"; readonly value: WorkItemEffectPlanAdmitted<T> }
	| { readonly kind: "rejected"; readonly value: WorkItemEffectPlanRejected }
	| { readonly kind: "request"; readonly value: WorkItemEffectRequested<T> }
	| { readonly kind: "result"; readonly value: WorkItemEffectPlanResult }
	| { readonly kind: "status"; readonly value: WorkItemEffectPlanStatus }
	| { readonly kind: "issue"; readonly value: DataIssue }
	| { readonly kind: "audit"; readonly value: AgentRuntimeAuditRecord };

export interface AuthoringState<T> {
	readonly workItems: Map<string, WorkItemProjection<T>>;
	readonly seenEvents: Set<string>;
	statusSeq: number;
	auditSeq: number;
}

export interface RequestState<T> {
	readonly workItems: Map<string, WorkItemProjection<T>>;
	readonly emittedKeys: Set<string>;
	readonly passedSteps: Map<string, Set<string>>;
	statusSeq: number;
	auditSeq: number;
}

export interface ResultState<T> {
	readonly workItems: Map<string, WorkItemProjection<T>>;
	readonly policies: Map<string, WorkItemVerificationMappingPolicy>;
	readonly evidenceById: Map<string, WorkItemEvidenceRecorded>;
	readonly resultEvidence: Set<string>;
	readonly proposalKeys: Set<string>;
	statusSeq: number;
	auditSeq: number;
}

export interface PlanMemberEvidence {
	readonly status: EffectRunResultStatus;
	readonly requestId?: string;
	readonly effectRunId?: string;
	readonly evidenceId?: string;
	readonly effectRunResultId?: string;
	readonly sourceRefs?: readonly SourceRef[];
}

export interface PlanState<T> {
	readonly workItems: Map<string, WorkItemProjection<T>>;
	readonly proposals: Map<string, WorkItemEffectPlanProposed<T>>;
	readonly admitted: Map<string, WorkItemEffectPlanAdmitted<T>>;
	readonly rejected: Set<string>;
	readonly emittedMemberKeys: Set<string>;
	readonly statusKeys: Set<string>;
	readonly resultKeys: Set<string>;
	readonly requestByEffectRun: Map<string, WorkItemEffectRequested<T>>;
	readonly requestByRequestId: Map<string, WorkItemEffectRequested<T>>;
	readonly memberEvidence: Map<string, PlanMemberEvidence>;
	readonly pendingEvidence: Map<string, WorkItemEvidenceRecorded>;
	readonly pendingResults: Map<string, EffectRunResult>;
	readonly unmatchedEvidence: Set<string>;
	readonly unmatchedResults: Set<string>;
	statusSeq: number;
	auditSeq: number;
}

export const executionRelevantDefaults = new Set([
	"detail",
	"detailRefs",
	"acceptanceCriteria",
	"verificationPlan",
	"verificationSteps",
	"dependencies",
]);

export const draftPatchKeys = new Set([
	"summary",
	"detail",
	"detailRefs",
	"acceptanceCriteria",
	"verificationPlan",
	"verificationSteps",
	"kind",
	"priority",
	"tags",
	"owner",
	"assignee",
	"deadlineMs",
	"customFields",
	"sourceRefs",
	"metadata",
]);
