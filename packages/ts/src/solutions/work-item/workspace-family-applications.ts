import { type Ctx, depBatch } from "../../ctx/types.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
import type { SourceRef } from "../../orchestration/agent-runtime.js";
import type { WorkItemDomainActionApplication } from "./actions-types.js";
import { immutableClone, project } from "./scheduling-shared.js";
import type {
	WorkItemAuthoringFact,
	WorkItemCreated,
	WorkItemDraft,
	WorkItemProjection,
} from "./scheduling-types.js";
import { validateWorkItemDraft } from "./scheduling-validation.js";
import type {
	RequiredInputGate,
	RequiredInputRequest,
	RequiredInputResponseApplied,
	RequiredInputResponseProposed,
	WorkItemLinked,
	WorkItemLinkProjection,
	WorkItemUnlinked,
} from "./workspace-model.js";
import {
	projectWorkspaceProposalApplicationStatus,
	validateWorkspaceProposalApplicationEnvelope,
	type WorkspaceProposalAdmissionDecision,
	type WorkspaceProposalApplicationFamilyRef,
	type WorkspaceProposalApplicationRecorded,
	type WorkspaceProposalApplicationResult,
	type WorkspaceProposalApplicationState,
	type WorkspaceProposalApplicationStatus,
	type WorkspaceProposalAuditMaterial,
	type WorkspaceProposalFamily,
	type WorkspaceProposalReadyRequest,
	type WorkspaceProposalRecorded,
	type WorkspaceProposalRecordedIssue,
	type WorkspaceProposalTargetRef,
	workspaceProposalApplicationFamilyRef,
	workspaceProposalDataOnlyIssues,
} from "./workspace-proposals.js";

export interface WorkspaceProposalRequiredInputResponseApplicationOptions {
	readonly applicationId: string;
	readonly gate: RequiredInputGate;
	readonly request?: RequiredInputRequest;
	readonly appliedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalRequiredInputResponseApplicationResult<TValue = unknown>
	extends WorkspaceProposalApplicationResult {
	readonly applied?: RequiredInputResponseApplied<TValue>;
}

export interface WorkspaceProposalRequiredInputResponseApplicationContext {
	readonly kind: "workspace-proposal-required-input-response-application-context";
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId?: string;
	readonly gateId?: string;
	readonly requestId?: string;
	readonly appliedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRequiredInputResponseApplicationProjectorOptions<
	TValue = unknown,
> {
	readonly name?: string;
	readonly records: Node<WorkspaceProposalRecorded<RequiredInputResponseProposed<TValue>>>;
	readonly decisions: Node<WorkspaceProposalAdmissionDecision>;
	readonly contexts: Node<WorkspaceProposalRequiredInputResponseApplicationContext>;
	readonly gates: Node<RequiredInputGate>;
	readonly requests?: Node<RequiredInputRequest>;
}

export interface WorkspaceProposalRequiredInputResponseApplicationProjectorBundle<
	TValue = unknown,
> {
	readonly applied: Node<RequiredInputResponseApplied<TValue>>;
	readonly status: Node<WorkspaceProposalApplicationStatus>;
	readonly recorded: Node<WorkspaceProposalApplicationRecorded>;
	readonly issues: Node<WorkspaceProposalRecordedIssue>;
	readonly audit: Node<WorkspaceProposalFamilyApplicationAuditRecord>;
}

export interface WorkspaceProposalWorkItemSpawnApplicationOptions<TInput = unknown> {
	readonly applicationId: string;
	readonly existingWorkItems?: readonly WorkItemProjection<TInput>[];
	readonly linkParent?: boolean;
	readonly createdAtMs?: number;
	readonly linkedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalWorkItemSpawnApplicationResult<TInput = unknown>
	extends WorkspaceProposalApplicationResult {
	readonly created?: WorkItemCreated<TInput>;
	readonly linked?: WorkItemLinked;
}

export interface WorkspaceProposalWorkItemSpawnApplicationContext {
	readonly kind: "workspace-proposal-work-item-spawn-application-context";
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId?: string;
	readonly linkParent?: boolean;
	readonly createdAtMs?: number;
	readonly linkedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalWorkItemSpawnApplicationProjectorOptions<TInput = unknown> {
	readonly name?: string;
	readonly records: Node<
		WorkspaceProposalRecorded<{
			readonly kind: "work-item-spawn-proposed";
			readonly proposedWorkItemId?: string;
			readonly parentWorkItemId?: string;
			readonly draft: WorkItemDraft<TInput>;
			readonly proposedBy?: string;
			readonly idempotencyKey?: string;
			readonly sourceRefs?: readonly SourceRef[];
			readonly metadata?: Record<string, unknown>;
		}>
	>;
	readonly decisions: Node<WorkspaceProposalAdmissionDecision>;
	readonly contexts: Node<WorkspaceProposalWorkItemSpawnApplicationContext>;
	readonly workItems?: Node<WorkItemProjection<TInput>>;
}

export interface WorkspaceProposalWorkItemSpawnApplicationProjectorBundle<TInput = unknown> {
	readonly created: Node<WorkItemCreated<TInput>>;
	readonly linked: Node<WorkItemLinked>;
	readonly status: Node<WorkspaceProposalApplicationStatus>;
	readonly recorded: Node<WorkspaceProposalApplicationRecorded>;
	readonly issues: Node<WorkspaceProposalRecordedIssue>;
	readonly audit: Node<WorkspaceProposalFamilyApplicationAuditRecord>;
}

export interface WorkItemLinkProposalDraft {
	readonly kind: "work-item-link-proposal";
	readonly action?: "link" | "unlink";
	readonly eventId?: string;
	readonly linkId: string;
	readonly fromWorkItemId?: string;
	readonly toWorkItemId?: string;
	readonly linkKind?: string;
	readonly direction?: WorkItemLinked["direction"];
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalWorkItemLinkApplicationOptions<TInput = unknown> {
	readonly applicationId: string;
	readonly workItems?: readonly WorkItemProjection<TInput>[];
	readonly links?: readonly WorkItemLinkProjection[];
	readonly linkedAtMs?: number;
	readonly unlinkedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalWorkItemLinkApplicationResult
	extends WorkspaceProposalApplicationResult {
	readonly linked?: WorkItemLinked;
	readonly unlinked?: WorkItemUnlinked;
}

export interface WorkspaceProposalWorkItemLinkApplicationContext {
	readonly kind: "workspace-proposal-work-item-link-application-context";
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId?: string;
	readonly linkedAtMs?: number;
	readonly unlinkedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalWorkItemLinkApplicationProjectorOptions<TInput = unknown> {
	readonly name?: string;
	readonly records: Node<WorkspaceProposalRecorded<WorkItemLinkProposalDraft>>;
	readonly decisions: Node<WorkspaceProposalAdmissionDecision>;
	readonly contexts: Node<WorkspaceProposalWorkItemLinkApplicationContext>;
	readonly workItems?: Node<WorkItemProjection<TInput>>;
	readonly links?: Node<WorkItemLinkProjection>;
}

export interface WorkspaceProposalWorkItemLinkApplicationProjectorBundle {
	readonly linked: Node<WorkItemLinked>;
	readonly unlinked: Node<WorkItemUnlinked>;
	readonly status: Node<WorkspaceProposalApplicationStatus>;
	readonly recorded: Node<WorkspaceProposalApplicationRecorded>;
	readonly issues: Node<WorkspaceProposalRecordedIssue>;
	readonly audit: Node<WorkspaceProposalFamilyApplicationAuditRecord>;
}

export interface WorkspaceProposalDomainActionApplicationStatusOptions {
	readonly applicationId: string;
	readonly emittedFacts: readonly WorkItemAuthoringFact[];
	readonly domainApplication?: WorkItemDomainActionApplication;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalDomainActionApplicationContext {
	readonly kind: "workspace-proposal-domain-action-application-context";
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId?: string;
	readonly domainApplicationId?: string;
	readonly emittedFactIds?: readonly string[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalDomainActionApplicationProjectorOptions {
	readonly name?: string;
	readonly records: Node<WorkspaceProposalRecorded>;
	readonly decisions: Node<WorkspaceProposalAdmissionDecision>;
	readonly contexts: Node<WorkspaceProposalDomainActionApplicationContext>;
	readonly emittedFacts: Node<WorkItemAuthoringFact>;
	readonly domainApplications?: Node<WorkItemDomainActionApplication>;
}

export interface WorkspaceProposalDomainActionApplicationProjectorBundle {
	readonly status: Node<WorkspaceProposalApplicationStatus>;
	readonly recorded: Node<WorkspaceProposalApplicationRecorded>;
	readonly issues: Node<WorkspaceProposalRecordedIssue>;
	readonly audit: Node<WorkspaceProposalFamilyApplicationAuditRecord>;
}

export interface WorkspaceProposalFamilyApplicationAuditRecord {
	readonly kind: "workspace-proposal-family-application-audit";
	readonly auditId: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId?: string;
	readonly proposalFamily: string;
	readonly state: WorkspaceProposalApplicationState;
	readonly emittedFactRefs: readonly WorkspaceProposalApplicationFamilyRef[];
	readonly code?: string;
	readonly issues?: readonly WorkspaceProposalRecordedIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export type WorkspaceProposalFamilyOutcomeRecordState =
	| "recorded"
	| "not-recorded"
	| "pending"
	| "partial"
	| "repair-needed"
	| "idempotency-conflict";

export type WorkspaceProposalFamilyOutcomeRecord =
	| WorkspaceProposalRequiredInputResponseOutcomeRecorded
	| WorkspaceProposalWorkItemSpawnOutcomeRecorded
	| WorkspaceProposalWorkItemLinkOutcomeRecorded
	| WorkspaceProposalDomainActionOutcomeRecorded;

export interface WorkspaceProposalFamilyOutcomeRef {
	readonly kind: "workspace-proposal-family-outcome-ref";
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly outcomeKind: WorkspaceProposalFamilyOutcomeRecord["kind"];
	readonly outcomeId: string;
	readonly sourceRefs: readonly SourceRef[];
}

export interface WorkspaceProposalFamilyOutcomeRecordStatus {
	readonly kind: "workspace-proposal-family-outcome-record-status";
	readonly outcomeId: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly state: WorkspaceProposalFamilyOutcomeRecordState;
	readonly code?: string;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly outcomeRefs: readonly WorkspaceProposalFamilyOutcomeRef[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalFamilyOutcomeRecordResult<
	TOutcome extends WorkspaceProposalFamilyOutcomeRecord,
> {
	readonly outcome?: TOutcome;
	readonly status: WorkspaceProposalFamilyOutcomeRecordStatus;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
}

export interface WorkspaceProposalFamilyEvidenceHorizon {
	readonly kind: "workspace-proposal-family-evidence-horizon";
	readonly horizonId: string;
	readonly applicationId: string;
	readonly state: "open" | "closed";
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalFamilyCompletionPolicy {
	readonly kind: "workspace-proposal-family-completion-policy";
	readonly policyId: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly domainActionCompletion?: "single-action" | "multi-step-partial";
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRequiredInputResponseOutcomeOptions {
	readonly outcomeId: string;
	readonly requiredInputRequestId?: string;
	readonly responseRef?: SourceRef;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly horizon?: WorkspaceProposalFamilyEvidenceHorizon;
	readonly policy?: WorkspaceProposalFamilyCompletionPolicy;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalWorkItemSpawnOutcomeOptions {
	readonly outcomeId: string;
	readonly workItemRef?: SourceRef;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly horizon?: WorkspaceProposalFamilyEvidenceHorizon;
	readonly policy?: WorkspaceProposalFamilyCompletionPolicy;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalWorkItemLinkOutcomeOptions {
	readonly outcomeId: string;
	readonly linkRef?: SourceRef;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly horizon?: WorkspaceProposalFamilyEvidenceHorizon;
	readonly policy?: WorkspaceProposalFamilyCompletionPolicy;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalDomainActionOutcomeOptions {
	readonly outcomeId: string;
	readonly actionRef?: SourceRef;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly horizon?: WorkspaceProposalFamilyEvidenceHorizon;
	readonly policy?: WorkspaceProposalFamilyCompletionPolicy;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRequiredInputResponseOutcomeRecorded {
	readonly kind: "workspace-proposal-required-input-response-outcome-recorded";
	readonly outcomeId: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: "required-input-response";
	readonly requiredInputRequestId: string;
	readonly responseRef: SourceRef;
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalWorkItemSpawnOutcomeRecorded {
	readonly kind: "workspace-proposal-work-item-spawn-outcome-recorded";
	readonly outcomeId: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: "work-item-spawn";
	readonly workItemRef: SourceRef;
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalWorkItemLinkOutcomeRecorded {
	readonly kind: "workspace-proposal-work-item-link-outcome-recorded";
	readonly outcomeId: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: "work-item-link";
	readonly linkRef: SourceRef;
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalDomainActionOutcomeRecorded {
	readonly kind: "workspace-proposal-domain-action-outcome-recorded";
	readonly outcomeId: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: "work-item-domain-action";
	readonly actionRef: SourceRef;
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalFamilyOutcomeIndexEntry {
	readonly kind: "workspace-proposal-family-outcome-index-entry";
	readonly indexKey: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly state: "recorded" | "idempotency-conflict";
	readonly outcomeRefs: readonly WorkspaceProposalFamilyOutcomeRef[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
}

export interface WorkspaceProposalRepairReviewRequest {
	readonly kind: "workspace-proposal-repair-review-request";
	readonly repairRequestId: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly code: string;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly subjectRefs?: readonly SourceRef[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export type WorkspaceProposalRepairReviewDecisionIntent =
	| "acknowledged"
	| "resolved"
	| "withdrawn"
	| "superseded";

export type WorkspaceProposalRepairReviewLifecycleState =
	| "open"
	| "acknowledged"
	| "resolved"
	| "withdrawn"
	| "superseded"
	| "conflict";

export type WorkspaceProposalRepairReviewProofKind =
	| "human-decision"
	| "family-outcome-status"
	| "family-outcome-index"
	| "application-status"
	| "application-recorded";

export interface WorkspaceProposalRepairReviewDecision {
	readonly kind: "workspace-proposal-repair-review-decision";
	readonly reviewDecisionId: string;
	readonly repairRequestId: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly intent: WorkspaceProposalRepairReviewDecisionIntent;
	readonly reviewerRef?: SourceRef;
	readonly actorRef?: SourceRef;
	readonly capabilityRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly reason?: string;
	readonly code?: string;
	readonly resolvesRefs?: readonly SourceRef[];
	readonly supersedesRefs?: readonly SourceRef[];
	readonly decidedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRepairReviewStatus {
	readonly kind: "workspace-proposal-repair-review-status";
	readonly repairRequestId: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly state: WorkspaceProposalRepairReviewLifecycleState;
	readonly code?: string;
	readonly proofKind?: WorkspaceProposalRepairReviewProofKind;
	readonly proofRefs: readonly SourceRef[];
	readonly decisions: readonly WorkspaceProposalRepairReviewDecision[];
	readonly conflicts: readonly WorkspaceProposalRepairReviewDecision[];
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

/** D438/D434 diagnostic classes for Workspace family application view material. */
export type WorkspaceProposalFamilyApplicationDiagnosticClass =
	| "missing-durable-handoff"
	| "missing-family-material"
	| "idempotency-conflict"
	| "malformed-family-material";

/**
 * Human-visible Workspace diagnostic view material.
 *
 * This is projection-only: it does not create proposal, admission, application,
 * family truth, outcome, or repair authority (D438/D434/D437).
 */
export interface WorkspaceProposalFamilyApplicationDiagnostic {
	readonly kind: "workspace-proposal-family-application-diagnostic";
	readonly diagnosticId: string;
	readonly classification: WorkspaceProposalFamilyApplicationDiagnosticClass;
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly code: string;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

/** Existing material consumed by the family application diagnostic projector. */
export interface WorkspaceProposalFamilyApplicationDiagnosticProjectionInput {
	readonly issues?: readonly WorkspaceProposalRecordedIssue[];
	readonly audit?: readonly WorkspaceProposalFamilyApplicationAuditRecord[];
	readonly applicationStatuses?: readonly WorkspaceProposalApplicationStatus[];
	readonly outcomeStatuses?: readonly WorkspaceProposalFamilyOutcomeRecordStatus[];
	readonly outcomeIndex?: readonly WorkspaceProposalFamilyOutcomeIndexEntry[];
}

/** Graph inputs for the family application diagnostic projector. */
export interface WorkspaceProposalFamilyApplicationDiagnosticProjectorOptions {
	readonly name?: string;
	readonly issues?: Node<WorkspaceProposalRecordedIssue>;
	readonly audit?: Node<WorkspaceProposalFamilyApplicationAuditRecord>;
	readonly applicationStatuses?: Node<WorkspaceProposalApplicationStatus>;
	readonly outcomeStatuses?: Node<WorkspaceProposalFamilyOutcomeRecordStatus>;
	readonly outcomeIndex?: Node<WorkspaceProposalFamilyOutcomeIndexEntry>;
}

/** Graph-visible diagnostic projection output. */
export interface WorkspaceProposalFamilyApplicationDiagnosticProjectorBundle {
	readonly diagnostics: Node<WorkspaceProposalFamilyApplicationDiagnostic>;
}

/** Existing durable status/outcome/index material eligible for repair review lowering. */
export interface WorkspaceProposalRepairReviewProjectionInput {
	readonly applicationStatuses?: readonly WorkspaceProposalApplicationStatus[];
	readonly outcomeStatuses?: readonly WorkspaceProposalFamilyOutcomeRecordStatus[];
	readonly outcomeIndex?: readonly WorkspaceProposalFamilyOutcomeIndexEntry[];
}

/** Graph inputs for human-visible repair review request projection. */
export interface WorkspaceProposalRepairReviewProjectorOptions {
	readonly name?: string;
	readonly applicationStatuses?: Node<WorkspaceProposalApplicationStatus>;
	readonly outcomeStatuses?: Node<WorkspaceProposalFamilyOutcomeRecordStatus>;
	readonly outcomeIndex?: Node<WorkspaceProposalFamilyOutcomeIndexEntry>;
}

/** Graph-visible human review requests; requests do not authorize remutation. */
export interface WorkspaceProposalRepairReviewProjectorBundle {
	readonly requests: Node<WorkspaceProposalRepairReviewRequest>;
}

export interface WorkspaceProposalRepairReviewStatusProjectionInput {
	readonly requests?: readonly WorkspaceProposalRepairReviewRequest[];
	readonly decisions?: readonly WorkspaceProposalRepairReviewDecision[];
	readonly applicationStatuses?: readonly WorkspaceProposalApplicationStatus[];
	readonly applicationRecorded?: readonly WorkspaceProposalApplicationRecorded[];
	readonly outcomeStatuses?: readonly WorkspaceProposalFamilyOutcomeRecordStatus[];
	readonly outcomeIndex?: readonly WorkspaceProposalFamilyOutcomeIndexEntry[];
}

export interface WorkspaceProposalRepairReviewStatusProjectorOptions {
	readonly name?: string;
	readonly requests: Node<WorkspaceProposalRepairReviewRequest>;
	readonly decisions?: Node<WorkspaceProposalRepairReviewDecision>;
	readonly applicationStatuses?: Node<WorkspaceProposalApplicationStatus>;
	readonly applicationRecorded?: Node<WorkspaceProposalApplicationRecorded>;
	readonly outcomeStatuses?: Node<WorkspaceProposalFamilyOutcomeRecordStatus>;
	readonly outcomeIndex?: Node<WorkspaceProposalFamilyOutcomeIndexEntry>;
}

export interface WorkspaceProposalRepairReviewStatusProjectorBundle {
	readonly statuses: Node<WorkspaceProposalRepairReviewStatus>;
}

export type WorkspaceProposalRepairReviewDecisionRecordingStatus = "recorded" | "blocked";

export interface WorkspaceProposalRepairReviewExpectedCurrentState {
	readonly state?: WorkspaceProposalRepairReviewLifecycleState;
	readonly code?: string;
	readonly proofKind?: WorkspaceProposalRepairReviewProofKind;
	readonly proofRefs?: readonly SourceRef[];
}

export interface WorkspaceProposalRepairReviewDecisionRecordingOptions {
	readonly reviewDecisionId?: string;
	readonly intent?: WorkspaceProposalRepairReviewDecisionIntent;
	readonly reviewerRef?: SourceRef;
	readonly actorRef?: SourceRef;
	readonly capabilityRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly reason?: string;
	readonly code?: string;
	readonly resolvesRefs?: readonly SourceRef[];
	readonly supersedesRefs?: readonly SourceRef[];
	readonly decidedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
	readonly currentStatus?: WorkspaceProposalRepairReviewStatus;
	readonly expectedCurrentState?: WorkspaceProposalRepairReviewExpectedCurrentState;
}

export interface WorkspaceProposalRepairReviewDecisionRecordingInput {
	readonly kind: "workspace-proposal-repair-review-decision-recording-input";
	readonly repairRequestId: string;
	readonly reviewDecisionId: string;
	readonly intent: WorkspaceProposalRepairReviewDecisionIntent;
	readonly reviewerRef?: SourceRef;
	readonly actorRef?: SourceRef;
	readonly capabilityRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly reason?: string;
	readonly code?: string;
	readonly resolvesRefs?: readonly SourceRef[];
	readonly supersedesRefs?: readonly SourceRef[];
	readonly decidedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
	readonly expectedCurrentState?: WorkspaceProposalRepairReviewExpectedCurrentState;
}

export interface WorkspaceProposalRepairReviewDecisionRecordingResult {
	readonly kind: "workspace-proposal-repair-review-decision-recording-result";
	readonly status: WorkspaceProposalRepairReviewDecisionRecordingStatus;
	readonly decision?: WorkspaceProposalRepairReviewDecision;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly sourceRefs: readonly SourceRef[];
}

export interface WorkspaceProposalRepairReviewDecisionRecordingProjectionInput {
	readonly requests?: readonly WorkspaceProposalRepairReviewRequest[];
	readonly recordingInputs?: readonly WorkspaceProposalRepairReviewDecisionRecordingInput[];
	readonly statuses?: readonly WorkspaceProposalRepairReviewStatus[];
}

export interface WorkspaceProposalRepairReviewDecisionRecordingProjectorOptions {
	readonly name?: string;
	readonly requests: Node<WorkspaceProposalRepairReviewRequest>;
	readonly recordingInputs: Node<WorkspaceProposalRepairReviewDecisionRecordingInput>;
	readonly statuses?: Node<WorkspaceProposalRepairReviewStatus>;
}

export interface WorkspaceProposalRepairReviewDecisionRecordingProjectorBundle {
	readonly results: Node<WorkspaceProposalRepairReviewDecisionRecordingResult>;
	readonly decisions: Node<WorkspaceProposalRepairReviewDecision>;
	readonly issues: Node<WorkspaceProposalRecordedIssue>;
}

export interface WorkspaceProposalFamilyOutcomeDetail {
	readonly kind: "workspace-proposal-family-outcome-detail";
	readonly outcomeRef: WorkspaceProposalFamilyOutcomeRef;
	readonly outcome?: WorkspaceProposalFamilyOutcomeRecord;
	readonly status?: WorkspaceProposalFamilyOutcomeRecordStatus;
}

export interface WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic {
	readonly kind: "workspace-proposal-family-application-read-model-display-diagnostic";
	readonly diagnosticId: string;
	readonly code:
		| "incomplete-read-model-query"
		| "malformed-read-model-query"
		| "malformed-read-model-presentation-options"
		| "malformed-outcome-detail-supply-request"
		| "malformed-supplied-outcome-detail"
		| "missing-supplied-outcome-detail"
		| "mismatched-supplied-outcome-detail"
		| "missing-outcome-detail"
		| "mismatched-outcome-detail"
		| "mismatched-outcome-status";
	readonly message: string;
	readonly queryId?: string;
	readonly viewId?: string;
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly outcomeRef?: WorkspaceProposalFamilyOutcomeRef;
	readonly sourceRefs: readonly SourceRef[];
}

export type WorkspaceProposalFamilyApplicationReadModelSortField =
	| "outcome-id"
	| "outcome-kind"
	| "diagnostic-code"
	| "repair-state"
	| "recorded-at-ms";

export type WorkspaceProposalFamilyApplicationReadModelSortDirection = "asc" | "desc";

export interface WorkspaceProposalFamilyApplicationReadModelSortOption {
	readonly field: WorkspaceProposalFamilyApplicationReadModelSortField;
	readonly direction: WorkspaceProposalFamilyApplicationReadModelSortDirection;
}

export type WorkspaceProposalFamilyApplicationReadModelGroupField =
	| "outcome-kind"
	| "repair-state"
	| "diagnostic-code";

export type WorkspaceProposalFamilyApplicationReadModelSearchField =
	| "outcome-id"
	| "outcome-kind"
	| "diagnostic-code"
	| "diagnostic-message"
	| "repair-state";

export interface WorkspaceProposalFamilyApplicationReadModelSearchOptions {
	readonly text?: string;
	readonly fields?: readonly WorkspaceProposalFamilyApplicationReadModelSearchField[];
}

export interface WorkspaceProposalFamilyApplicationReadModelNormalizedSearch {
	readonly text: string;
	readonly fields: readonly WorkspaceProposalFamilyApplicationReadModelSearchField[];
}

export interface WorkspaceProposalFamilyApplicationReadModelDisplayGroup {
	readonly kind: "workspace-proposal-family-application-read-model-display-group";
	readonly field: WorkspaceProposalFamilyApplicationReadModelGroupField;
	readonly value: string;
	readonly outcomeRefs: readonly WorkspaceProposalFamilyOutcomeRef[];
	readonly count: number;
}

export interface WorkspaceProposalFamilyApplicationReadModel {
	readonly kind: "workspace-proposal-family-application-read-model";
	readonly readModelId: string;
	readonly queryId?: string;
	readonly viewId?: string;
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly filters?: WorkspaceProposalFamilyApplicationReadModelNormalizedFilters;
	readonly sort?: readonly WorkspaceProposalFamilyApplicationReadModelSortOption[];
	readonly groupBy?: readonly WorkspaceProposalFamilyApplicationReadModelGroupField[];
	readonly search?: WorkspaceProposalFamilyApplicationReadModelNormalizedSearch;
	readonly diagnostics: readonly WorkspaceProposalFamilyApplicationDiagnostic[];
	readonly repairReviewStatuses: readonly WorkspaceProposalRepairReviewStatus[];
	readonly outcomeIndexes: readonly WorkspaceProposalFamilyOutcomeIndexEntry[];
	readonly outcomeDetails: readonly WorkspaceProposalFamilyOutcomeDetail[];
	readonly displayGroups: readonly WorkspaceProposalFamilyApplicationReadModelDisplayGroup[];
	readonly displayDiagnostics: readonly WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic[];
	readonly page: {
		readonly offset: number;
		readonly limit: number;
		readonly totalOutcomeRefs: number;
		readonly returnedOutcomeRefs: number;
	};
}

export interface WorkspaceProposalFamilyApplicationReadModelPage {
	readonly offset?: number;
	readonly limit?: number;
}

export interface WorkspaceProposalFamilyApplicationReadModelFilters {
	readonly outcomeIds?: readonly string[];
	readonly outcomeKinds?: readonly WorkspaceProposalFamilyOutcomeRecord["kind"][];
	readonly diagnosticCodes?: readonly string[];
	readonly repairStates?: readonly WorkspaceProposalRepairReviewLifecycleState[];
}

export interface WorkspaceProposalFamilyApplicationReadModelNormalizedFilters {
	readonly outcomeIds: readonly string[];
	readonly outcomeKinds: readonly WorkspaceProposalFamilyOutcomeRecord["kind"][];
	readonly diagnosticCodes: readonly string[];
	readonly repairStates: readonly WorkspaceProposalRepairReviewLifecycleState[];
}

export interface WorkspaceProposalFamilyApplicationReadModelQuery {
	readonly kind: "workspace-proposal-family-application-read-model-query";
	readonly queryId: string;
	readonly viewId?: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly page?: WorkspaceProposalFamilyApplicationReadModelPage;
	readonly filters?: WorkspaceProposalFamilyApplicationReadModelFilters;
	readonly sort?: readonly WorkspaceProposalFamilyApplicationReadModelSortOption[];
	readonly groupBy?: readonly WorkspaceProposalFamilyApplicationReadModelGroupField[];
	readonly search?: WorkspaceProposalFamilyApplicationReadModelSearchOptions;
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalFamilyApplicationReadModelProjectionInput {
	readonly diagnostics?: readonly WorkspaceProposalFamilyApplicationDiagnostic[];
	readonly repairReviewStatuses?: readonly WorkspaceProposalRepairReviewStatus[];
	readonly outcomeIndex?: readonly WorkspaceProposalFamilyOutcomeIndexEntry[];
	readonly outcomeStatuses?: readonly WorkspaceProposalFamilyOutcomeRecordStatus[];
	readonly outcomes?: readonly WorkspaceProposalFamilyOutcomeRecord[];
	readonly queryId?: string;
	readonly viewId?: string;
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly offset?: number;
	readonly limit?: number;
	readonly filters?: WorkspaceProposalFamilyApplicationReadModelFilters;
	readonly sort?: readonly WorkspaceProposalFamilyApplicationReadModelSortOption[];
	readonly groupBy?: readonly WorkspaceProposalFamilyApplicationReadModelGroupField[];
	readonly search?: WorkspaceProposalFamilyApplicationReadModelSearchOptions;
	readonly displayDiagnostics?: readonly WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic[];
}

export interface WorkspaceProposalFamilyApplicationReadModelProjectorOptions {
	readonly name?: string;
	readonly diagnostics?: Node<WorkspaceProposalFamilyApplicationDiagnostic>;
	readonly repairReviewStatuses?: Node<WorkspaceProposalRepairReviewStatus>;
	readonly outcomeIndex?: Node<WorkspaceProposalFamilyOutcomeIndexEntry>;
	readonly outcomeStatuses?: Node<WorkspaceProposalFamilyOutcomeRecordStatus>;
	readonly outcomes?: Node<WorkspaceProposalFamilyOutcomeRecord>;
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly offset?: number;
	readonly limit?: number;
	readonly sort?: readonly WorkspaceProposalFamilyApplicationReadModelSortOption[];
	readonly groupBy?: readonly WorkspaceProposalFamilyApplicationReadModelGroupField[];
	readonly search?: WorkspaceProposalFamilyApplicationReadModelSearchOptions;
}

export interface WorkspaceProposalFamilyApplicationReadModelsProjectionInput {
	readonly queries?: readonly WorkspaceProposalFamilyApplicationReadModelQuery[];
	readonly diagnostics?: readonly WorkspaceProposalFamilyApplicationDiagnostic[];
	readonly repairReviewStatuses?: readonly WorkspaceProposalRepairReviewStatus[];
	readonly outcomeIndex?: readonly WorkspaceProposalFamilyOutcomeIndexEntry[];
	readonly outcomeStatuses?: readonly WorkspaceProposalFamilyOutcomeRecordStatus[];
	readonly outcomes?: readonly WorkspaceProposalFamilyOutcomeRecord[];
}

export interface WorkspaceProposalFamilyApplicationReadModelsProjectorOptions {
	readonly name?: string;
	readonly queries: Node<WorkspaceProposalFamilyApplicationReadModelQuery>;
	readonly diagnostics?: Node<WorkspaceProposalFamilyApplicationDiagnostic>;
	readonly repairReviewStatuses?: Node<WorkspaceProposalRepairReviewStatus>;
	readonly outcomeIndex?: Node<WorkspaceProposalFamilyOutcomeIndexEntry>;
	readonly outcomeStatuses?: Node<WorkspaceProposalFamilyOutcomeRecordStatus>;
	readonly outcomes?: Node<WorkspaceProposalFamilyOutcomeRecord>;
}

export interface WorkspaceProposalFamilyApplicationReadModelProjectorBundle {
	readonly readModels: Node<WorkspaceProposalFamilyApplicationReadModel>;
}

export interface WorkspaceProposalFamilyOutcomeDetailSupplyRequest {
	readonly kind: "workspace-proposal-family-outcome-detail-supply-request";
	readonly supplyRequestId: string;
	readonly viewId?: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly requestedOutcomeRefs: readonly WorkspaceProposalFamilyOutcomeRef[];
	readonly page?: WorkspaceProposalFamilyApplicationReadModelPage;
	readonly filters?: WorkspaceProposalFamilyApplicationReadModelFilters;
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalFamilyOutcomeDetailSupplyResult {
	readonly kind: "workspace-proposal-family-outcome-detail-supply-result";
	readonly supplyRequestId?: string;
	readonly viewId?: string;
	readonly currentViewId: string;
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly suppliedOutcomeFacts: readonly WorkspaceProposalFamilyOutcomeRecord[];
	readonly missingRefs: readonly WorkspaceProposalFamilyOutcomeRef[];
	readonly mismatchedRefs: readonly WorkspaceProposalFamilyOutcomeRef[];
	readonly displayDiagnostics: readonly WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic[];
	readonly page: { readonly offset: number; readonly limit: number };
	readonly filters: WorkspaceProposalFamilyApplicationReadModelNormalizedFilters;
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalFamilyOutcomeDetailSupplyProjectionInput {
	readonly requests?: readonly WorkspaceProposalFamilyOutcomeDetailSupplyRequest[];
	readonly suppliedOutcomes?: readonly WorkspaceProposalFamilyOutcomeRecord[];
}

export interface WorkspaceProposalFamilyOutcomeDetailSupplyProjectorOptions {
	readonly name?: string;
	readonly requests: Node<WorkspaceProposalFamilyOutcomeDetailSupplyRequest>;
	readonly suppliedOutcomes: Node<WorkspaceProposalFamilyOutcomeRecord>;
}

export interface WorkspaceProposalFamilyOutcomeDetailSupplyProjectorBundle {
	readonly results: Node<WorkspaceProposalFamilyOutcomeDetailSupplyResult>;
}

export type WorkspaceProposalRepairActionKind =
	| "acknowledge-review"
	| "withdraw-review"
	| "mark-human-resolved"
	| "supersede-review"
	| "open-successor-proposal-flow";

export type WorkspaceProposalRepairActionDescriptorDisabledCode =
	| "repair-review-already-acknowledged"
	| "repair-review-conflict"
	| "repair-review-terminal";

export interface WorkspaceProposalRepairActionDescriptor {
	readonly kind: "workspace-proposal-repair-action-descriptor";
	readonly descriptorId: string;
	readonly repairRequestId: string;
	readonly repairState: WorkspaceProposalRepairReviewLifecycleState;
	readonly repairStatusRef?: SourceRef;
	readonly actionKind: WorkspaceProposalRepairActionKind;
	readonly enabled: boolean;
	readonly disabledCode?: WorkspaceProposalRepairActionDescriptorDisabledCode;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRepairActionDescriptorProjectionInput {
	readonly requests?: readonly WorkspaceProposalRepairReviewRequest[];
	readonly statuses?: readonly WorkspaceProposalRepairReviewStatus[];
}

export interface WorkspaceProposalRepairActionDescriptorProjectorOptions {
	readonly name?: string;
	readonly requests: Node<WorkspaceProposalRepairReviewRequest>;
	readonly statuses?: Node<WorkspaceProposalRepairReviewStatus>;
}

export interface WorkspaceProposalRepairActionDescriptorProjectorBundle {
	readonly descriptors: Node<WorkspaceProposalRepairActionDescriptor>;
}

export interface WorkspaceProposalRepairActionIntent {
	readonly kind: "workspace-proposal-repair-action-intent";
	readonly intentId: string;
	readonly descriptorId: string;
	readonly repairRequestId: string;
	readonly actionKind: WorkspaceProposalRepairActionKind;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly reviewerRef?: SourceRef;
	readonly actorRef?: SourceRef;
	readonly capabilityRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
	readonly expectedCurrentState?: WorkspaceProposalRepairReviewExpectedCurrentState;
}

export type WorkspaceProposalRepairActionIntentValidationStatus = "accepted" | "blocked";

export interface WorkspaceProposalRepairActionIntentValidationOptions {
	readonly descriptor?: WorkspaceProposalRepairActionDescriptor;
	readonly request?: WorkspaceProposalRepairReviewRequest;
	readonly currentStatus?: WorkspaceProposalRepairReviewStatus;
	readonly expectedCurrentState?: WorkspaceProposalRepairReviewExpectedCurrentState;
	readonly capabilityRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly policyStatus?: "allowed" | "blocked" | "missing" | "unknown";
	readonly policyIssues?: readonly WorkspaceProposalRecordedIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalRepairActionIntentValidationResult {
	readonly kind: "workspace-proposal-repair-action-intent-validation-result";
	readonly status: WorkspaceProposalRepairActionIntentValidationStatus;
	readonly intentId?: string;
	readonly descriptorId?: string;
	readonly repairRequestId?: string;
	readonly actionKind?: WorkspaceProposalRepairActionKind;
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly intent?: WorkspaceProposalRepairActionIntent;
}

export type WorkspaceProposalRepairActionDisplayPolicyAssessment =
	| "not-evaluated"
	| "no-known-blocker"
	| "known-blocker"
	| "needs-review"
	| "unknown";

export interface WorkspaceProposalRepairActionDisplayPolicyAdvisoryIssue {
	readonly kind: string;
	readonly message: string;
	readonly severity?: "info" | "warning" | "error";
	readonly ref?: SourceRef;
	readonly metadata?: Record<string, unknown>;
}

/**
 * D468 display-only policy advisory. This DTO is intentionally joinable by
 * repair action coordinates but is never permission proof for intake.
 */
export interface WorkspaceProposalRepairActionDisplayPolicyAdvisory {
	readonly kind: "workspace-proposal-repair-action-display-policy-advisory";
	readonly authority: "display-only-advisory";
	readonly descriptorId: string;
	readonly repairRequestId: string;
	readonly actionKind: WorkspaceProposalRepairActionKind;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly displayAssessment: WorkspaceProposalRepairActionDisplayPolicyAssessment;
	readonly policyEvidenceRefs?: readonly SourceRef[];
	readonly capabilityEvidenceRefs?: readonly SourceRef[];
	readonly advisoryIssues?: readonly WorkspaceProposalRepairActionDisplayPolicyAdvisoryIssue[];
	readonly displayCode?: string;
	readonly displayMessage?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRepairActionDisplayPolicyAdvisoryValidationResult {
	readonly kind: "workspace-proposal-repair-action-display-policy-advisory-validation-result";
	readonly status: "accepted" | "blocked";
	readonly descriptorId?: string;
	readonly repairRequestId?: string;
	readonly actionKind?: WorkspaceProposalRepairActionKind;
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly advisory?: WorkspaceProposalRepairActionDisplayPolicyAdvisory;
}

export interface WorkspaceProposalRepairActionDisplayPolicyAdvisoryValidationOptions {
	readonly descriptor?: WorkspaceProposalRepairActionDescriptor;
	readonly request?: WorkspaceProposalRepairReviewRequest;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalRepairActionDisplayPolicyAdvisoryProjectorOptions {
	readonly name?: string;
	readonly descriptors: Node<WorkspaceProposalRepairActionDescriptor>;
	readonly requests: Node<WorkspaceProposalRepairReviewRequest>;
	readonly displayAssessment?: WorkspaceProposalRepairActionDisplayPolicyAssessment;
	readonly policyEvidenceRefs?: readonly SourceRef[];
	readonly capabilityEvidenceRefs?: readonly SourceRef[];
	readonly advisoryIssues?: readonly WorkspaceProposalRepairActionDisplayPolicyAdvisoryIssue[];
	readonly displayCode?: string;
	readonly displayMessage?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRepairActionDisplayPolicyAdvisoryProjectorBundle {
	readonly advisories: Node<WorkspaceProposalRepairActionDisplayPolicyAdvisory>;
}

export interface WorkspaceProposalRepairReviewDecisionRecordingInputPreparationOptions {
	readonly reviewDecisionId?: string;
	readonly reviewerRef?: SourceRef;
	readonly actorRef?: SourceRef;
	readonly capabilityRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly reason?: string;
	readonly code?: string;
	readonly resolvesRefs?: readonly SourceRef[];
	readonly supersedesRefs?: readonly SourceRef[];
	readonly decidedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRepairReviewDecisionRecordingInputPreparationResult {
	readonly kind: "workspace-proposal-repair-review-decision-recording-input-preparation-result";
	readonly status: "prepared" | "blocked";
	readonly recordingInput?: WorkspaceProposalRepairReviewDecisionRecordingInput;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalRepairActionIntentProjectorOptions {
	readonly name?: string;
	readonly intents: Node<WorkspaceProposalRepairActionIntent>;
	readonly descriptors: Node<WorkspaceProposalRepairActionDescriptor>;
	readonly requests: Node<WorkspaceProposalRepairReviewRequest>;
	readonly statuses?: Node<WorkspaceProposalRepairReviewStatus>;
	readonly capabilityRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly policyStatus?: "allowed" | "blocked" | "missing" | "unknown";
}

export interface WorkspaceProposalRepairActionIntentProjectorBundle {
	readonly results: Node<WorkspaceProposalRepairActionIntentValidationResult>;
}

export interface WorkspaceProposalRepairSuccessorProposalIntakePreviewOptions {
	readonly previewId?: string;
	readonly currentStatus?: WorkspaceProposalRepairReviewStatus;
	readonly expectedCurrentState?: WorkspaceProposalRepairReviewExpectedCurrentState;
	readonly capabilityRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly policyStatus?: "allowed" | "blocked" | "missing" | "unknown";
	readonly policyIssues?: readonly WorkspaceProposalRecordedIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly contextRefs?: readonly SourceRef[];
	readonly suggestedFamily?: WorkspaceProposalFamily;
	readonly suggestedLoweringKind?: string;
	readonly reason?: string;
	readonly code?: string;
	readonly suggestedDraftPatch?: Record<string, unknown>;
	readonly maxSuggestedDraftPatchBytes?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRepairSuccessorProposalIntakePreview {
	readonly kind: "workspace-proposal-repair-successor-proposal-intake-preview";
	readonly previewId: string;
	readonly status: "proposal-context-ready" | "blocked";
	readonly intentId: string;
	readonly actionIntentId?: string;
	readonly descriptorId: string;
	readonly repairRequestId: string;
	readonly actionKind: "open-successor-proposal-flow";
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly suggestedFamily?: WorkspaceProposalFamily;
	readonly suggestedLoweringKind?: string;
	readonly targetRefs: readonly SourceRef[];
	readonly contextRefs: readonly SourceRef[];
	readonly reason?: string;
	readonly code?: string;
	readonly suggestedDraftPatch?: Record<string, unknown>;
	readonly diagnostics: readonly WorkspaceProposalRecordedIssue[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationInput<
	TDraft = unknown,
> {
	readonly kind: "workspace-proposal-repair-successor-proposal-ready-request-preparation-input";
	readonly preparationId: string;
	readonly previewId: string;
	readonly intent: WorkspaceProposalRepairActionIntent;
	readonly descriptor: WorkspaceProposalRepairActionDescriptor;
	readonly request: WorkspaceProposalRepairReviewRequest;
	readonly intentValidation: WorkspaceProposalRepairActionIntentValidationResult;
	readonly currentStatus?: WorkspaceProposalRepairReviewStatus;
	readonly expectedCurrentState?: WorkspaceProposalRepairReviewExpectedCurrentState;
	readonly successorProposalId: string;
	readonly intakeRequestId: string;
	readonly successorIdempotencyKey: string;
	readonly workspaceId: string;
	readonly actorRef: SourceRef;
	readonly capabilityRefs: readonly SourceRef[];
	readonly policyRefs: readonly SourceRef[];
	readonly projectionBundleRefs: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit: WorkspaceProposalAuditMaterial;
	readonly targetRefs: readonly WorkspaceProposalTargetRef[];
	readonly successorProposalFamily: WorkspaceProposalFamily;
	readonly successorLoweringKind: string;
	readonly draft?: TDraft;
	readonly draftRefs?: readonly SourceRef[];
	readonly finalDraftSourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationResult<
	TDraft = unknown,
> {
	readonly kind: "workspace-proposal-repair-successor-proposal-ready-request-preparation-result";
	readonly status: "prepared" | "blocked";
	readonly preparationId?: string;
	readonly previewId?: string;
	readonly repairRequestId?: string;
	readonly descriptorId?: string;
	readonly intentId?: string;
	readonly readyRequest?: WorkspaceProposalReadyRequest<TDraft>;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationProjectorOptions<
	TDraft = unknown,
> {
	readonly name?: string;
	readonly previews: Node<WorkspaceProposalRepairSuccessorProposalIntakePreview>;
	readonly preparationInputs: Node<
		WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationInput<TDraft>
	>;
}

export interface WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationProjectorBundle<
	TDraft = unknown,
> {
	readonly results: Node<
		WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationResult<TDraft>
	>;
	readonly readyRequests: Node<WorkspaceProposalReadyRequest<TDraft>>;
	readonly issues: Node<WorkspaceProposalRecordedIssue>;
}

export interface WorkspaceProposalRepairSuccessorProposalIntakePreviewProjectorOptions {
	readonly name?: string;
	readonly intents: Node<WorkspaceProposalRepairActionIntent>;
	readonly descriptors: Node<WorkspaceProposalRepairActionDescriptor>;
	readonly requests: Node<WorkspaceProposalRepairReviewRequest>;
	readonly statuses?: Node<WorkspaceProposalRepairReviewStatus>;
	readonly capabilityRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly policyStatus?: "allowed" | "blocked" | "missing" | "unknown";
	readonly maxSuggestedDraftPatchBytes?: number;
}

export interface WorkspaceProposalRepairSuccessorProposalIntakePreviewProjectorBundle {
	readonly previews: Node<WorkspaceProposalRepairSuccessorProposalIntakePreview>;
}

type WorkspaceProposalFamilyApplicationRuntimeFact<TInput = unknown, TValue = unknown> =
	| {
			readonly kind: "required-input-response-applied";
			readonly value: RequiredInputResponseApplied<TValue>;
	  }
	| { readonly kind: "work-item-created"; readonly value: WorkItemCreated<TInput> }
	| { readonly kind: "work-item-linked"; readonly value: WorkItemLinked }
	| { readonly kind: "work-item-unlinked"; readonly value: WorkItemUnlinked }
	| { readonly kind: "status"; readonly value: WorkspaceProposalApplicationStatus }
	| { readonly kind: "recorded"; readonly value: WorkspaceProposalApplicationRecorded }
	| { readonly kind: "issue"; readonly value: WorkspaceProposalRecordedIssue }
	| { readonly kind: "audit"; readonly value: WorkspaceProposalFamilyApplicationAuditRecord };

type WorkspaceProposalFamilyApplicationDiagnosticInputFact =
	| { readonly kind: "issue"; readonly value: WorkspaceProposalRecordedIssue }
	| { readonly kind: "audit"; readonly value: WorkspaceProposalFamilyApplicationAuditRecord }
	| { readonly kind: "application-status"; readonly value: WorkspaceProposalApplicationStatus }
	| { readonly kind: "application-recorded"; readonly value: WorkspaceProposalApplicationRecorded }
	| {
			readonly kind: "outcome-status";
			readonly value: WorkspaceProposalFamilyOutcomeRecordStatus;
	  }
	| { readonly kind: "outcome-index"; readonly value: WorkspaceProposalFamilyOutcomeIndexEntry }
	| { readonly kind: "repair-request"; readonly value: WorkspaceProposalRepairReviewRequest }
	| { readonly kind: "repair-decision"; readonly value: WorkspaceProposalRepairReviewDecision }
	| { readonly kind: "repair-status"; readonly value: WorkspaceProposalRepairReviewStatus }
	| {
			readonly kind: "repair-decision-recording-input";
			readonly value: WorkspaceProposalRepairReviewDecisionRecordingInput;
	  }
	| { readonly kind: "diagnostic"; readonly value: WorkspaceProposalFamilyApplicationDiagnostic }
	| {
			readonly kind: "read-model-query";
			readonly value: WorkspaceProposalFamilyApplicationReadModelQuery;
	  }
	| { readonly kind: "outcome"; readonly value: WorkspaceProposalFamilyOutcomeRecord };

interface WorkspaceProposalFamilyApplicationProjectionState {
	readonly issues: Map<string, WorkspaceProposalRecordedIssue>;
	readonly audit: Map<string, WorkspaceProposalFamilyApplicationAuditRecord>;
	readonly applicationStatuses: Map<string, WorkspaceProposalApplicationStatus>;
	readonly applicationRecorded: Map<string, WorkspaceProposalApplicationRecorded>;
	readonly outcomeStatuses: Map<string, WorkspaceProposalFamilyOutcomeRecordStatus>;
	readonly outcomeIndex: Map<string, WorkspaceProposalFamilyOutcomeIndexEntry>;
	readonly repairRequests: Map<string, WorkspaceProposalRepairReviewRequest>;
	readonly repairDecisions: Map<string, WorkspaceProposalRepairReviewDecision>;
	readonly repairStatuses: Map<string, WorkspaceProposalRepairReviewStatus>;
	readonly repairDecisionRecordingInputs: Map<
		string,
		WorkspaceProposalRepairReviewDecisionRecordingInput
	>;
	readonly diagnostics: Map<string, WorkspaceProposalFamilyApplicationDiagnostic>;
	readonly readModelQueries: Map<string, WorkspaceProposalFamilyApplicationReadModelQuery>;
	readonly outcomes: Map<string, WorkspaceProposalFamilyOutcomeRecord>;
	readonly emittedDiagnostics: Map<string, string>;
	readonly emittedRepairRequests: Map<string, string>;
	readonly emittedRepairStatuses: Map<string, string>;
	readonly emittedRepairDecisionRecordings: Map<string, string>;
	readonly emittedReadModels: Map<string, string>;
	readonly emittedRepairActionDescriptors: Map<string, string>;
}

interface WorkspaceProposalFamilyProjectorState<TInput = unknown, TDraft = unknown> {
	readonly records: Map<string, WorkspaceProposalRecorded<TDraft>>;
	readonly decisionsByProposal: Map<string, WorkspaceProposalAdmissionDecision>;
	readonly decisionsById: Map<string, WorkspaceProposalAdmissionDecision>;
	readonly contexts: Map<
		string,
		{
			readonly applicationId: string;
			readonly proposalId: string;
			readonly decisionId?: string;
			readonly sourceRefs?: readonly SourceRef[];
			readonly audit?: WorkspaceProposalAuditMaterial;
		}
	>;
	readonly gates: Map<string, RequiredInputGate>;
	readonly requests: Map<string, RequiredInputRequest>;
	readonly workItems: Map<string, WorkItemProjection<TInput>>;
	readonly links: Map<string, WorkItemLinkProjection>;
	readonly emittedDomainFacts: Map<string, WorkItemAuthoringFact>;
	readonly domainApplications: Map<string, WorkItemDomainActionApplication>;
	readonly applicationRefs: Map<string, WorkspaceProposalApplicationReplayEntry>;
	readonly factOwners: Map<string, string>;
	readonly durableHandoffDiagnostics: Set<string>;
}

interface WorkspaceProposalApplicationReplayEntry {
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly emittedFactRefs: readonly WorkspaceProposalApplicationFamilyRef[];
}

export function workspaceProposalRequiredInputResponseApplicationProjector<TValue = unknown>(
	graph: Graph,
	opts: WorkspaceProposalRequiredInputResponseApplicationProjectorOptions<TValue>,
): WorkspaceProposalRequiredInputResponseApplicationProjectorBundle<TValue> {
	const name = opts.name ?? "workspaceProposalRequiredInputResponseApplication";
	const deps =
		opts.requests === undefined
			? [opts.records, opts.decisions, opts.contexts, opts.gates]
			: [opts.records, opts.decisions, opts.contexts, opts.gates, opts.requests];
	const runtime = graph.node<WorkspaceProposalFamilyApplicationRuntimeFact<unknown, TValue>>(
		deps,
		(ctx) => {
			const state = familyProjectorState<unknown, RequiredInputResponseProposed<TValue>>(ctx);
			ingestRecords(ctx, state, 0);
			ingestDecisions(ctx, state, 1);
			ingestContexts(ctx, state, 2);
			for (const raw of depBatch(ctx, 3) ?? []) {
				const gate = raw as RequiredInputGate;
				state.gates.set(gate.gateId, gate);
				state.gates.set(`${gate.requestId}:${gate.workItemId}`, gate);
			}
			if (opts.requests !== undefined) {
				for (const raw of depBatch(ctx, 4) ?? []) {
					const request = raw as RequiredInputRequest;
					state.requests.set(request.requestId, request);
					state.requests.set(`${request.requestId}:${request.workItemId}`, request);
				}
			}
			for (const context of state.contexts.values()) {
				const record = state.records.get(context.proposalId);
				const decision = decisionForContext(state, context);
				if (record === undefined || decision === undefined) {
					emitMissingDurableHandoffDiagnostics(ctx, state, context, "required-input-response");
					continue;
				}
				const draft = record.draft;
				const draftShapeIssues = requiredInputDraftShapeIssues(record, draft);
				if (draftShapeIssues.length > 0) {
					emitApplicationResult(
						ctx,
						state,
						projectWorkspaceProposalApplicationStatus(record, decision, {
							applicationId: context.applicationId,
							familyIssues: draftShapeIssues,
							sourceRefs: context.sourceRefs,
							audit: context.audit,
						}),
						[],
					);
					continue;
				}
				const gate =
					requiredInputContextGate(
						state,
						context as WorkspaceProposalRequiredInputResponseApplicationContext,
						draft,
					) ?? undefined;
				if (gate === undefined) {
					emitApplicationResult(
						ctx,
						state,
						missingFamilyMaterialResult(record, decision, context, "missing-required-input-gate"),
						[],
					);
					continue;
				}
				const request =
					requiredInputContextRequest(
						state,
						context as WorkspaceProposalRequiredInputResponseApplicationContext,
						draft,
					) ?? undefined;
				const result = projectWorkspaceProposalRequiredInputResponseApplication(record, decision, {
					applicationId: context.applicationId,
					gate,
					request,
					appliedAtMs: (context as WorkspaceProposalRequiredInputResponseApplicationContext)
						.appliedAtMs,
					sourceRefs: context.sourceRefs,
					audit: context.audit,
				});
				emitApplicationResult(
					ctx,
					state,
					result,
					result.applied === undefined ? [] : [result.applied],
				);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalRequiredInputResponseApplicationProjector"),
	);
	return familyBundle(graph, runtime, name, {
		applied: "required-input-response-applied",
	}) as unknown as WorkspaceProposalRequiredInputResponseApplicationProjectorBundle<TValue>;
}

export function workspaceProposalWorkItemSpawnApplicationProjector<TInput = unknown>(
	graph: Graph,
	opts: WorkspaceProposalWorkItemSpawnApplicationProjectorOptions<TInput>,
): WorkspaceProposalWorkItemSpawnApplicationProjectorBundle<TInput> {
	const name = opts.name ?? "workspaceProposalWorkItemSpawnApplication";
	const deps =
		opts.workItems === undefined
			? [opts.records, opts.decisions, opts.contexts]
			: [opts.records, opts.decisions, opts.contexts, opts.workItems];
	const runtime = graph.node<WorkspaceProposalFamilyApplicationRuntimeFact<TInput>>(
		deps,
		(ctx) => {
			const state = familyProjectorState<
				TInput,
				{
					readonly kind: "work-item-spawn-proposed";
					readonly proposedWorkItemId?: string;
					readonly parentWorkItemId?: string;
					readonly draft: WorkItemDraft<TInput>;
					readonly proposedBy?: string;
					readonly idempotencyKey?: string;
					readonly sourceRefs?: readonly SourceRef[];
					readonly metadata?: Record<string, unknown>;
				}
			>(ctx);
			ingestRecords(ctx, state, 0);
			ingestDecisions(ctx, state, 1);
			ingestContexts(ctx, state, 2);
			if (opts.workItems !== undefined) ingestWorkItems(ctx, state, 3);
			for (const context of state.contexts.values()) {
				const record = state.records.get(context.proposalId);
				const decision = decisionForContext(state, context);
				if (record === undefined || decision === undefined) {
					emitMissingDurableHandoffDiagnostics(ctx, state, context, "work-item-spawn");
					continue;
				}
				const spawnContext = context as WorkspaceProposalWorkItemSpawnApplicationContext;
				const result = projectWorkspaceProposalWorkItemSpawnApplication(record, decision, {
					applicationId: context.applicationId,
					existingWorkItems: [...state.workItems.values()],
					linkParent: spawnContext.linkParent,
					createdAtMs: spawnContext.createdAtMs,
					linkedAtMs: spawnContext.linkedAtMs,
					sourceRefs: context.sourceRefs,
					audit: context.audit,
				});
				emitApplicationResult(
					ctx,
					state,
					result,
					[result.created, result.linked].filter((item) => item !== undefined),
				);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalWorkItemSpawnApplicationProjector"),
	);
	return familyBundle(graph, runtime, name, {
		created: "work-item-created",
		linked: "work-item-linked",
	}) as unknown as WorkspaceProposalWorkItemSpawnApplicationProjectorBundle<TInput>;
}

export function workspaceProposalWorkItemLinkApplicationProjector<TInput = unknown>(
	graph: Graph,
	opts: WorkspaceProposalWorkItemLinkApplicationProjectorOptions<TInput>,
): WorkspaceProposalWorkItemLinkApplicationProjectorBundle {
	const name = opts.name ?? "workspaceProposalWorkItemLinkApplication";
	const deps: Node<unknown>[] = [
		opts.records as Node<unknown>,
		opts.decisions as Node<unknown>,
		opts.contexts as Node<unknown>,
	];
	if (opts.workItems !== undefined) deps.push(opts.workItems);
	if (opts.links !== undefined) deps.push(opts.links);
	const workItemsDep = opts.workItems === undefined ? undefined : 3;
	const linksDep = opts.links === undefined ? undefined : opts.workItems === undefined ? 3 : 4;
	const runtime = graph.node<WorkspaceProposalFamilyApplicationRuntimeFact<TInput>>(
		deps,
		(ctx) => {
			const state = familyProjectorState<TInput, WorkItemLinkProposalDraft>(ctx);
			ingestRecords(ctx, state, 0);
			ingestDecisions(ctx, state, 1);
			ingestContexts(ctx, state, 2);
			if (workItemsDep !== undefined) ingestWorkItems(ctx, state, workItemsDep);
			if (linksDep !== undefined) {
				for (const raw of depBatch(ctx, linksDep) ?? []) {
					const link = raw as WorkItemLinkProjection;
					state.links.set(link.linkId, link);
				}
			}
			for (const context of state.contexts.values()) {
				const record = state.records.get(context.proposalId);
				const decision = decisionForContext(state, context);
				if (record === undefined || decision === undefined) {
					emitMissingDurableHandoffDiagnostics(ctx, state, context, "work-item-link");
					continue;
				}
				const linkContext = context as WorkspaceProposalWorkItemLinkApplicationContext;
				const result = projectWorkspaceProposalWorkItemLinkApplication(record, decision, {
					applicationId: context.applicationId,
					workItems: [...state.workItems.values()],
					links: [...state.links.values()],
					linkedAtMs: linkContext.linkedAtMs,
					unlinkedAtMs: linkContext.unlinkedAtMs,
					sourceRefs: context.sourceRefs,
					audit: context.audit,
				});
				emitApplicationResult(
					ctx,
					state,
					result,
					[result.linked, result.unlinked].filter((item) => item !== undefined),
				);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalWorkItemLinkApplicationProjector"),
	);
	return familyBundle(graph, runtime, name, {
		linked: "work-item-linked",
		unlinked: "work-item-unlinked",
	}) as unknown as WorkspaceProposalWorkItemLinkApplicationProjectorBundle;
}

export function workspaceProposalDomainActionApplicationProjector(
	graph: Graph,
	opts: WorkspaceProposalDomainActionApplicationProjectorOptions,
): WorkspaceProposalDomainActionApplicationProjectorBundle {
	const name = opts.name ?? "workspaceProposalDomainActionApplication";
	const deps =
		opts.domainApplications === undefined
			? [opts.records, opts.decisions, opts.contexts, opts.emittedFacts]
			: [opts.records, opts.decisions, opts.contexts, opts.emittedFacts, opts.domainApplications];
	const runtime = graph.node<WorkspaceProposalFamilyApplicationRuntimeFact>(
		deps,
		(ctx) => {
			const state = familyProjectorState(ctx);
			ingestRecords(ctx, state, 0);
			ingestDecisions(ctx, state, 1);
			ingestContexts(ctx, state, 2);
			for (const raw of depBatch(ctx, 3) ?? []) {
				const fact = raw as WorkItemAuthoringFact;
				state.emittedDomainFacts.set(fact.eventId, fact);
			}
			if (opts.domainApplications !== undefined) {
				for (const raw of depBatch(ctx, 4) ?? []) {
					const application = raw as WorkItemDomainActionApplication;
					state.domainApplications.set(application.applicationId, application);
				}
			}
			for (const context of state.contexts.values()) {
				const record = state.records.get(context.proposalId);
				const decision = decisionForContext(state, context);
				if (record === undefined || decision === undefined) {
					emitMissingDurableHandoffDiagnostics(ctx, state, context, "work-item-domain-action");
					continue;
				}
				const domainContext = context as WorkspaceProposalDomainActionApplicationContext;
				const selectedDomainFacts = selectDomainFacts(state, domainContext);
				const domainApplication =
					domainContext.domainApplicationId === undefined
						? undefined
						: state.domainApplications.get(domainContext.domainApplicationId);
				if (
					selectedDomainFacts.missingFactIds.length > 0 ||
					(selectedDomainFacts.facts.length === 0 && domainApplication === undefined)
				) {
					emitApplicationResult(
						ctx,
						state,
						missingFamilyMaterialResult(record, decision, context, "missing-domain-action-facts"),
						[],
					);
					continue;
				}
				const result = projectWorkspaceProposalDomainActionApplicationStatus(record, decision, {
					applicationId: context.applicationId,
					emittedFacts: selectedDomainFacts.facts,
					domainApplication,
					sourceRefs: context.sourceRefs,
					audit: context.audit,
				});
				emitApplicationResult(ctx, state, result, []);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalDomainActionApplicationProjector"),
	);
	return familyBundle(
		graph,
		runtime,
		name,
		{},
	) as unknown as WorkspaceProposalDomainActionApplicationProjectorBundle;
}

export function recordWorkspaceProposalRequiredInputResponseOutcome(
	status: WorkspaceProposalApplicationStatus,
	options: WorkspaceProposalRequiredInputResponseOutcomeOptions,
): WorkspaceProposalFamilyOutcomeRecordResult<WorkspaceProposalRequiredInputResponseOutcomeRecorded> {
	return recordFamilyOutcome(status, "required-input-response", options, () => {
		const requiredInputRequestId = options.requiredInputRequestId;
		const responseRef = options.responseRef;
		const issues = [
			...nonBlankFieldIssue(status, requiredInputRequestId, "requiredInputRequestId"),
			...sourceRefFieldIssue(status, responseRef, "responseRef"),
		];
		if (
			issues.length > 0 ||
			typeof requiredInputRequestId !== "string" ||
			!isSourceRef(responseRef)
		) {
			return { issues };
		}
		return {
			issues,
			outcome: {
				kind: "workspace-proposal-required-input-response-outcome-recorded",
				...familyOutcomeCoordinates(status, options),
				proposalFamily: "required-input-response",
				requiredInputRequestId,
				responseRef,
			},
		};
	});
}

export function recordWorkspaceProposalWorkItemSpawnOutcome(
	status: WorkspaceProposalApplicationStatus,
	options: WorkspaceProposalWorkItemSpawnOutcomeOptions,
): WorkspaceProposalFamilyOutcomeRecordResult<WorkspaceProposalWorkItemSpawnOutcomeRecorded> {
	return recordFamilyOutcome(status, "work-item-spawn", options, () => {
		const workItemRef = options.workItemRef;
		const issues = sourceRefFieldIssue(status, workItemRef, "workItemRef");
		if (issues.length > 0 || !isSourceRef(workItemRef)) return { issues };
		return {
			issues,
			outcome: {
				kind: "workspace-proposal-work-item-spawn-outcome-recorded",
				...familyOutcomeCoordinates(status, options),
				proposalFamily: "work-item-spawn",
				workItemRef,
			},
		};
	});
}

export function recordWorkspaceProposalWorkItemLinkOutcome(
	status: WorkspaceProposalApplicationStatus,
	options: WorkspaceProposalWorkItemLinkOutcomeOptions,
): WorkspaceProposalFamilyOutcomeRecordResult<WorkspaceProposalWorkItemLinkOutcomeRecorded> {
	return recordFamilyOutcome(status, "work-item-link", options, () => {
		const linkRef = options.linkRef;
		const issues = sourceRefFieldIssue(status, linkRef, "linkRef");
		if (issues.length > 0 || !isSourceRef(linkRef)) return { issues };
		return {
			issues,
			outcome: {
				kind: "workspace-proposal-work-item-link-outcome-recorded",
				...familyOutcomeCoordinates(status, options),
				proposalFamily: "work-item-link",
				linkRef,
			},
		};
	});
}

export function recordWorkspaceProposalDomainActionOutcome(
	status: WorkspaceProposalApplicationStatus,
	options: WorkspaceProposalDomainActionOutcomeOptions,
): WorkspaceProposalFamilyOutcomeRecordResult<WorkspaceProposalDomainActionOutcomeRecorded> {
	return recordFamilyOutcome(status, "work-item-domain-action", options, () => {
		const multiStepPartial = options.policy?.domainActionCompletion === "multi-step-partial";
		if (options.actionRef === undefined) {
			return {
				issues: multiStepPartial ? [] : sourceRefFieldIssue(status, options.actionRef, "actionRef"),
				partial: true,
			};
		}
		const issues = sourceRefFieldIssue(status, options.actionRef, "actionRef");
		if (issues.length > 0) return { issues, partial: true };
		return {
			issues,
			outcome: {
				kind: "workspace-proposal-domain-action-outcome-recorded",
				...familyOutcomeCoordinates(status, options),
				proposalFamily: "work-item-domain-action",
				actionRef: options.actionRef,
			},
		};
	});
}

export function workspaceProposalFamilyOutcomeRef(
	outcome: WorkspaceProposalFamilyOutcomeRecord,
): WorkspaceProposalFamilyOutcomeRef {
	return {
		kind: "workspace-proposal-family-outcome-ref",
		applicationId: outcome.applicationId,
		proposalId: outcome.proposalId,
		decisionId: outcome.decisionId,
		idempotencyKey: outcome.idempotencyKey,
		proposalFamily: outcome.proposalFamily,
		outcomeKind: outcome.kind,
		outcomeId: outcome.outcomeId,
		sourceRefs: immutableClone(outcome.sourceRefs),
	};
}

export function projectWorkspaceProposalFamilyOutcomeIndex(
	outcomes: readonly WorkspaceProposalFamilyOutcomeRecord[],
): readonly WorkspaceProposalFamilyOutcomeIndexEntry[] {
	const groups = new Map<string, WorkspaceProposalFamilyOutcomeRecord[]>();
	for (const outcome of outcomes) {
		const key = familyOutcomeIndexKey(outcome);
		groups.set(key, [...(groups.get(key) ?? []), outcome]);
	}
	return [...groups.entries()].map(([indexKey, entries]) => {
		const first = entries[0];
		const refs = entries.map(workspaceProposalFamilyOutcomeRef);
		const uniqueSignatures = new Set(entries.map(familyOutcomeSignature));
		const conflict = uniqueSignatures.size > 1;
		const issues = conflict
			? [
					familyOutcomeIssue(
						first,
						"idempotency-conflict",
						"Workspace proposal family outcome replay conflicts with prior outcome refs",
					),
				]
			: [];
		return {
			kind: "workspace-proposal-family-outcome-index-entry",
			indexKey,
			applicationId: first.applicationId,
			proposalId: first.proposalId,
			decisionId: first.decisionId,
			idempotencyKey: first.idempotencyKey,
			proposalFamily: first.proposalFamily,
			state: conflict ? "idempotency-conflict" : "recorded",
			outcomeRefs: conflict ? [] : [refs[0]],
			sourceRefs: uniqueRefs(entries.flatMap((entry) => entry.sourceRefs)),
			audit: first.audit,
			issues,
		} satisfies WorkspaceProposalFamilyOutcomeIndexEntry;
	});
}

/**
 * Projects D438/D434/D437 diagnostic view material from existing graph facts only.
 *
 * Missing durable handoff issues remain diagnostic-only and never synthesize
 * application status, family truth, outcome, or repair review authority.
 */
export function projectWorkspaceProposalFamilyApplicationDiagnostics(
	input: WorkspaceProposalFamilyApplicationDiagnosticProjectionInput,
): readonly WorkspaceProposalFamilyApplicationDiagnostic[] {
	const diagnostics = new Map<string, WorkspaceProposalFamilyApplicationDiagnostic>();
	for (const issue of input.issues ?? []) {
		const classification = diagnosticClassForIssue(issue);
		if (classification === undefined) continue;
		upsertDiagnostic(diagnostics, diagnosticFromIssue(issue, classification));
	}
	for (const audit of input.audit ?? []) {
		if (audit.code === "missing-durable-handoff") {
			upsertDiagnostic(diagnostics, diagnosticFromAudit(audit, "missing-durable-handoff"));
		}
	}
	for (const status of input.applicationStatuses ?? []) {
		const classification = diagnosticClassForApplicationStatus(status);
		if (classification === undefined) continue;
		upsertDiagnostic(diagnostics, diagnosticFromApplicationStatus(status, classification));
	}
	for (const status of input.outcomeStatuses ?? []) {
		const classification = diagnosticClassForOutcomeStatus(status);
		if (classification === undefined) continue;
		upsertDiagnostic(diagnostics, diagnosticFromOutcomeStatus(status, classification));
	}
	for (const entry of input.outcomeIndex ?? []) {
		if (entry.state !== "idempotency-conflict") continue;
		upsertDiagnostic(diagnostics, diagnosticFromOutcomeIndex(entry));
	}
	return [...diagnostics.values()];
}

/** Graph-visible variant of `projectWorkspaceProposalFamilyApplicationDiagnostics`. */
export function workspaceProposalFamilyApplicationDiagnosticProjector(
	graph: Graph,
	opts: WorkspaceProposalFamilyApplicationDiagnosticProjectorOptions,
): WorkspaceProposalFamilyApplicationDiagnosticProjectorBundle {
	const name = opts.name ?? "workspaceProposalFamilyApplicationDiagnostic";
	const { deps, depKinds } = diagnosticProjectionDeps(opts);
	const runtime = graph.node<
		| { readonly kind: "diagnostic"; readonly value: WorkspaceProposalFamilyApplicationDiagnostic }
		| undefined
	>(
		deps,
		(ctx) => {
			const state = familyProjectionState(ctx);
			ingestDiagnosticInputFacts(ctx, state, depKinds);
			for (const diagnostic of projectWorkspaceProposalFamilyApplicationDiagnostics({
				issues: [...state.issues.values()],
				audit: [...state.audit.values()],
				applicationStatuses: [...state.applicationStatuses.values()],
				outcomeStatuses: [...state.outcomeStatuses.values()],
				outcomeIndex: [...state.outcomeIndex.values()],
			})) {
				const signature = diagnosticSignature(diagnostic);
				if (state.emittedDiagnostics.get(diagnostic.diagnosticId) === signature) continue;
				state.emittedDiagnostics.set(diagnostic.diagnosticId, signature);
				ctx.down([["DATA", { kind: "diagnostic", value: diagnostic }]]);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalFamilyApplicationDiagnosticProjector"),
	);
	return {
		diagnostics: project(graph, runtime, `${name}/diagnostics`, `${name}Diagnostics`, (fact) =>
			fact?.kind === "diagnostic" ? fact.value : undefined,
		),
	};
}

/**
 * Lowers durable repair-needed or idempotency-conflict material to human review.
 *
 * The lowerer requires durable application coordinates and never emits retry,
 * remutation, family facts, or proposal/admission/application truth.
 */
export function projectWorkspaceProposalRepairReviewRequests(
	input: WorkspaceProposalRepairReviewProjectionInput,
): readonly WorkspaceProposalRepairReviewRequest[] {
	const applicationStatuses = new Map(
		(input.applicationStatuses ?? []).map((status) => [status.applicationId, status]),
	);
	const requests = new Map<string, WorkspaceProposalRepairReviewRequest>();
	for (const status of applicationStatuses.values()) {
		if (!repairReviewState(status.state)) continue;
		if (!repairReviewClassification(diagnosticClassForApplicationStatus(status))) continue;
		upsertRepairRequest(requests, repairRequestFromApplicationStatus(status));
	}
	for (const status of input.outcomeStatuses ?? []) {
		if (!repairReviewState(status.state)) continue;
		const applicationStatus = applicationStatuses.get(status.applicationId);
		if (applicationStatus === undefined) continue;
		if (!sameApplicationCoordinates(applicationStatus, status)) continue;
		if (!repairReviewClassification(diagnosticClassForOutcomeStatus(status))) continue;
		upsertRepairRequest(requests, repairRequestFromOutcomeStatus(status, applicationStatus));
	}
	for (const entry of input.outcomeIndex ?? []) {
		if (entry.state !== "idempotency-conflict") continue;
		const applicationStatus = applicationStatuses.get(entry.applicationId);
		if (applicationStatus === undefined) continue;
		if (!sameApplicationCoordinates(applicationStatus, entry)) continue;
		upsertRepairRequest(requests, repairRequestFromOutcomeIndex(entry, applicationStatus));
	}
	return [...requests.values()];
}

/** Graph-visible variant of `projectWorkspaceProposalRepairReviewRequests`. */
export function workspaceProposalRepairReviewProjector(
	graph: Graph,
	opts: WorkspaceProposalRepairReviewProjectorOptions,
): WorkspaceProposalRepairReviewProjectorBundle {
	const name = opts.name ?? "workspaceProposalRepairReview";
	const { deps, depKinds } = repairReviewProjectionDeps(opts);
	const runtime = graph.node<
		| {
				readonly kind: "repair-review-request";
				readonly value: WorkspaceProposalRepairReviewRequest;
		  }
		| undefined
	>(
		deps,
		(ctx) => {
			const state = familyProjectionState(ctx);
			ingestDiagnosticInputFacts(ctx, state, depKinds);
			for (const request of projectWorkspaceProposalRepairReviewRequests({
				applicationStatuses: [...state.applicationStatuses.values()],
				outcomeStatuses: [...state.outcomeStatuses.values()],
				outcomeIndex: [...state.outcomeIndex.values()],
			})) {
				const signature = repairRequestSignature(request);
				if (state.emittedRepairRequests.get(request.repairRequestId) === signature) continue;
				state.emittedRepairRequests.set(request.repairRequestId, signature);
				ctx.down([["DATA", { kind: "repair-review-request", value: request }]]);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalRepairReviewProjector"),
	);
	return {
		requests: project(graph, runtime, `${name}/requests`, `${name}Requests`, (fact) =>
			fact?.kind === "repair-review-request" ? fact.value : undefined,
		),
	};
}

export function projectWorkspaceProposalRepairReviewStatuses(
	input: WorkspaceProposalRepairReviewStatusProjectionInput,
): readonly WorkspaceProposalRepairReviewStatus[] {
	return (input.requests ?? []).map((request) =>
		projectWorkspaceProposalRepairReviewStatus(request, {
			decisions: input.decisions ?? [],
			applicationStatuses: input.applicationStatuses ?? [],
			applicationRecorded: input.applicationRecorded ?? [],
			outcomeStatuses: input.outcomeStatuses ?? [],
			outcomeIndex: input.outcomeIndex ?? [],
		}),
	);
}

export function recordWorkspaceProposalRepairReviewDecision(
	request: WorkspaceProposalRepairReviewRequest,
	options: WorkspaceProposalRepairReviewDecisionRecordingOptions,
): WorkspaceProposalRepairReviewDecisionRecordingResult {
	const issues = repairReviewDecisionRecordingIssues(request, options);
	if (issues.length > 0) {
		return {
			kind: "workspace-proposal-repair-review-decision-recording-result",
			status: "blocked",
			issues,
			sourceRefs: [],
		};
	}
	const sourceRefs = immutableClone(
		uniqueRefs([
			...options.sourceRefs!.filter(repairReviewDecisionSourceRefIsValid),
			...(repairReviewDecisionSourceRefIsValid(options.reviewerRef) ? [options.reviewerRef] : []),
			...(repairReviewDecisionSourceRefIsValid(options.actorRef) ? [options.actorRef] : []),
			...(Array.isArray(options.capabilityRefs)
				? options.capabilityRefs.filter(repairReviewDecisionSourceRefIsValid)
				: []),
			...(Array.isArray(options.policyRefs)
				? options.policyRefs.filter(repairReviewDecisionSourceRefIsValid)
				: []),
		]),
	);
	const decision: WorkspaceProposalRepairReviewDecision = {
		kind: "workspace-proposal-repair-review-decision",
		reviewDecisionId: options.reviewDecisionId!,
		repairRequestId: request.repairRequestId,
		applicationId: request.applicationId,
		proposalId: request.proposalId,
		decisionId: request.decisionId,
		idempotencyKey: request.idempotencyKey,
		proposalFamily: request.proposalFamily,
		intent: options.intent!,
		...(options.reviewerRef === undefined
			? {}
			: { reviewerRef: immutableClone(options.reviewerRef) }),
		...(options.actorRef === undefined ? {} : { actorRef: immutableClone(options.actorRef) }),
		...(options.capabilityRefs === undefined
			? {}
			: { capabilityRefs: immutableClone(options.capabilityRefs) }),
		...(options.policyRefs === undefined ? {} : { policyRefs: immutableClone(options.policyRefs) }),
		...(options.reason === undefined ? {} : { reason: options.reason }),
		...(options.code === undefined ? {} : { code: options.code }),
		...(options.resolvesRefs === undefined
			? {}
			: { resolvesRefs: immutableClone(options.resolvesRefs) }),
		...(options.supersedesRefs === undefined
			? {}
			: { supersedesRefs: immutableClone(options.supersedesRefs) }),
		...(options.decidedAtMs === undefined ? {} : { decidedAtMs: options.decidedAtMs }),
		...(sourceRefs.length === 0 ? {} : { sourceRefs }),
		...(options.audit === undefined ? {} : { audit: immutableClone(options.audit) }),
		...(options.metadata === undefined ? {} : { metadata: immutableClone(options.metadata) }),
	};
	return {
		kind: "workspace-proposal-repair-review-decision-recording-result",
		status: "recorded",
		decision,
		issues: [],
		audit: decision.audit,
		sourceRefs: immutableClone(sourceRefs),
	};
}

export function projectWorkspaceProposalRepairReviewDecisionRecordings(
	input: WorkspaceProposalRepairReviewDecisionRecordingProjectionInput,
): readonly WorkspaceProposalRepairReviewDecisionRecordingResult[] {
	const requests = new Map<string, WorkspaceProposalRepairReviewRequest>();
	for (const request of input.requests ?? []) requests.set(request.repairRequestId, request);
	const statuses = new Map<string, WorkspaceProposalRepairReviewStatus>();
	for (const status of input.statuses ?? [])
		statuses.set(repairReviewStatusProjectionKey(status), status);
	const groupedInputs = new Map<
		string,
		{
			readonly input: WorkspaceProposalRepairReviewDecisionRecordingInput;
			readonly signature: string;
			readonly conflict: boolean;
		}
	>();
	for (const recordingInput of input.recordingInputs ?? []) {
		const key = recordingInput.reviewDecisionId;
		const signature = repairReviewDecisionRecordingInputSignature(recordingInput);
		const existing = groupedInputs.get(key);
		if (existing === undefined) {
			groupedInputs.set(key, { input: recordingInput, signature, conflict: false });
			continue;
		}
		if (existing.signature !== signature) {
			groupedInputs.set(key, { ...existing, conflict: true });
		}
	}
	const results: WorkspaceProposalRepairReviewDecisionRecordingResult[] = [];
	for (const entry of groupedInputs.values()) {
		const request = requests.get(entry.input.repairRequestId);
		if (entry.conflict) {
			results.push(
				blockedRepairReviewDecisionRecordingResult(entry.input, request, [
					repairReviewDecisionRecordingInputIssue(
						"conflicting-repair-review-decision-recording-input",
						"Repair-review decision recording inputs conflict for the same reviewDecisionId.",
						entry.input,
						request,
					),
				]),
			);
			continue;
		}
		if (entry.input.kind !== "workspace-proposal-repair-review-decision-recording-input") {
			results.push(
				blockedRepairReviewDecisionRecordingResult(entry.input, request, [
					repairReviewDecisionRecordingInputIssue(
						"malformed-recording-options",
						"Repair-review decision recording projector requires typed recording input material.",
						entry.input,
						request,
					),
				]),
			);
			continue;
		}
		if (request === undefined) {
			results.push(
				blockedRepairReviewDecisionRecordingResult(entry.input, undefined, [
					repairReviewDecisionRecordingInputIssue(
						"missing-repair-review-request",
						"Repair-review decision recording input requires a matching repair-review request.",
						entry.input,
						undefined,
					),
				]),
			);
			continue;
		}
		const currentStatus = statuses.get(repairReviewStatusProjectionKeyFromRequest(request));
		results.push(
			recordWorkspaceProposalRepairReviewDecision(request, {
				reviewDecisionId: entry.input.reviewDecisionId,
				intent: entry.input.intent,
				reviewerRef: entry.input.reviewerRef,
				actorRef: entry.input.actorRef,
				capabilityRefs: entry.input.capabilityRefs,
				policyRefs: entry.input.policyRefs,
				sourceRefs: entry.input.sourceRefs,
				audit: entry.input.audit,
				reason: entry.input.reason,
				code: entry.input.code,
				resolvesRefs: entry.input.resolvesRefs,
				supersedesRefs: entry.input.supersedesRefs,
				decidedAtMs: entry.input.decidedAtMs,
				metadata: entry.input.metadata,
				currentStatus,
				expectedCurrentState: entry.input.expectedCurrentState,
			}),
		);
	}
	return results;
}

/** Graph-visible variant of `projectWorkspaceProposalRepairReviewDecisionRecordings`. */
export function workspaceProposalRepairReviewDecisionRecordingProjector(
	graph: Graph,
	opts: WorkspaceProposalRepairReviewDecisionRecordingProjectorOptions,
): WorkspaceProposalRepairReviewDecisionRecordingProjectorBundle {
	const name = opts.name ?? "workspaceProposalRepairReviewDecisionRecording";
	const { deps, depKinds } = repairReviewDecisionRecordingProjectionDeps(opts);
	const runtime = graph.node<
		| {
				readonly kind: "repair-decision-recording-result";
				readonly value: WorkspaceProposalRepairReviewDecisionRecordingResult;
		  }
		| {
				readonly kind: "repair-decision";
				readonly value: WorkspaceProposalRepairReviewDecision;
		  }
		| { readonly kind: "issue"; readonly value: WorkspaceProposalRecordedIssue }
		| undefined
	>(
		deps,
		(ctx) => {
			const state = familyProjectionState(ctx);
			ingestDiagnosticInputFacts(ctx, state, depKinds);
			for (const result of projectWorkspaceProposalRepairReviewDecisionRecordings({
				requests: [...state.repairRequests.values()],
				recordingInputs: [...state.repairDecisionRecordingInputs.values()],
				statuses: [...state.repairStatuses.values()],
			})) {
				const emissionKey = repairReviewDecisionRecordingResultKey(result);
				const signature = stableStringify(result);
				if (state.emittedRepairDecisionRecordings.get(emissionKey) === signature) continue;
				state.emittedRepairDecisionRecordings.set(emissionKey, signature);
				ctx.down([["DATA", { kind: "repair-decision-recording-result", value: result }]]);
				for (const issue of result.issues) {
					ctx.down([["DATA", { kind: "issue", value: issue }]]);
				}
				if (result.decision !== undefined) {
					ctx.down([["DATA", { kind: "repair-decision", value: result.decision }]]);
				}
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalRepairReviewDecisionRecordingProjector"),
	);
	return {
		results: project(graph, runtime, `${name}/results`, `${name}Results`, (fact) =>
			fact?.kind === "repair-decision-recording-result" ? fact.value : undefined,
		),
		decisions: project(graph, runtime, `${name}/decisions`, `${name}Decisions`, (fact) =>
			fact?.kind === "repair-decision" ? fact.value : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, `${name}Issues`, (fact) =>
			fact?.kind === "issue" ? fact.value : undefined,
		),
	};
}

/** Graph-visible variant of `projectWorkspaceProposalRepairReviewStatuses`. */
export function workspaceProposalRepairReviewStatusProjector(
	graph: Graph,
	opts: WorkspaceProposalRepairReviewStatusProjectorOptions,
): WorkspaceProposalRepairReviewStatusProjectorBundle {
	const name = opts.name ?? "workspaceProposalRepairReviewStatus";
	const { deps, depKinds } = repairReviewStatusProjectionDeps(opts);
	const runtime = graph.node<
		| {
				readonly kind: "repair-review-status";
				readonly value: WorkspaceProposalRepairReviewStatus;
		  }
		| undefined
	>(
		deps,
		(ctx) => {
			const state = familyProjectionState(ctx);
			ingestDiagnosticInputFacts(ctx, state, depKinds);
			for (const status of projectWorkspaceProposalRepairReviewStatuses({
				requests: [...state.repairRequests.values()],
				decisions: [...state.repairDecisions.values()],
				applicationStatuses: [...state.applicationStatuses.values()],
				applicationRecorded: [...state.applicationRecorded.values()],
				outcomeStatuses: [...state.outcomeStatuses.values()],
				outcomeIndex: [...state.outcomeIndex.values()],
			})) {
				const signature = repairReviewStatusSignature(status);
				if (state.emittedRepairStatuses.get(status.repairRequestId) === signature) continue;
				state.emittedRepairStatuses.set(status.repairRequestId, signature);
				ctx.down([["DATA", { kind: "repair-review-status", value: status }]]);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalRepairReviewStatusProjector"),
	);
	return {
		statuses: project(graph, runtime, `${name}/statuses`, `${name}Statuses`, (fact) =>
			fact?.kind === "repair-review-status" ? fact.value : undefined,
		),
	};
}

export function projectWorkspaceProposalFamilyApplicationReadModel(
	input: WorkspaceProposalFamilyApplicationReadModelProjectionInput,
): WorkspaceProposalFamilyApplicationReadModel {
	const coordinates = readModelCoordinates(input);
	const hasCompleteCoordinates = readModelCoordinatesComplete(coordinates);
	const filters = normalizeReadModelFilters(input.filters).filters;
	const presentation = normalizeReadModelPresentationOptions(
		input.sort,
		input.groupBy,
		input.search,
	);
	const diagnostics = (input.diagnostics ?? []).filter((diagnostic) =>
		hasCompleteCoordinates
			? coordinatesMatchExact(coordinates, diagnostic) &&
				matchesOptionalSet(filters.diagnosticCodes, diagnostic.code)
			: false,
	);
	const repairReviewStatuses = (input.repairReviewStatuses ?? []).filter((status) =>
		hasCompleteCoordinates
			? coordinatesMatchExact(coordinates, status) &&
				matchesOptionalSet(filters.repairStates, status.state)
			: false,
	);
	const outcomeIndexes = (input.outcomeIndex ?? [])
		.filter((entry) => (hasCompleteCoordinates ? coordinatesMatchExact(coordinates, entry) : false))
		.map((entry) => filterOutcomeIndexEntry(entry, filters))
		.filter((entry) => entry.outcomeRefs.length > 0 || entry.state === "idempotency-conflict");
	const outcomes = groupByOutcomeId(input.outcomes ?? []);
	const statuses = groupByOutcomeId(input.outcomeStatuses ?? []);
	const allOutcomeRefs = sortReadModelOutcomeRefs(
		outcomeIndexes
			.flatMap((entry) => entry.outcomeRefs)
			.filter((ref) =>
				readModelSearchMatches(ref, presentation.search, diagnostics, repairReviewStatuses),
			),
		presentation.sort,
		diagnostics,
		repairReviewStatuses,
		outcomes,
		statuses,
	);
	const offset = normalizePageOffset(input.offset);
	const limit = normalizePageLimit(input.limit);
	const pagedRefs = allOutcomeRefs.slice(offset, offset + limit);
	const outcomeDetails: WorkspaceProposalFamilyOutcomeDetail[] = [];
	const displayDiagnostics: WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic[] = [
		...(input.displayDiagnostics ?? []),
		...presentation.diagnostics,
	];
	for (const outcomeRef of pagedRefs) {
		const outcomeCandidates = outcomes.get(outcomeRef.outcomeId) ?? [];
		const statusCandidates = statuses.get(outcomeRef.outcomeId) ?? [];
		const outcome = outcomeCandidates.find((candidate) =>
			sameOutcomeRefCoordinates(outcomeRef, candidate),
		);
		const status = statusCandidates.find((candidate) =>
			sameOutcomeRefCoordinates(outcomeRef, candidate),
		);
		if (outcome === undefined && outcomeCandidates.length === 0) {
			displayDiagnostics.push(readModelDisplayDiagnostic("missing-outcome-detail", outcomeRef));
		} else if (outcome === undefined) {
			displayDiagnostics.push(readModelDisplayDiagnostic("mismatched-outcome-detail", outcomeRef));
		}
		if (status === undefined && statusCandidates.length > 0) {
			displayDiagnostics.push(readModelDisplayDiagnostic("mismatched-outcome-status", outcomeRef));
		}
		outcomeDetails.push({
			kind: "workspace-proposal-family-outcome-detail",
			outcomeRef,
			...(outcome !== undefined ? { outcome } : {}),
			...(status !== undefined ? { status } : {}),
		});
	}
	const displayGroups = readModelDisplayGroups(
		pagedRefs,
		presentation.groupBy,
		diagnostics,
		repairReviewStatuses,
	);
	return {
		kind: "workspace-proposal-family-application-read-model",
		readModelId: `workspace-proposal-family-application-read-model:${stableStringify({
			queryId: stringField(input.queryId),
			viewId: stringField(input.viewId),
			...coordinates,
			offset,
			limit,
			filters,
			sort: presentation.sort,
			groupBy: presentation.groupBy,
			search: presentation.search,
		})}`,
		...(stringField(input.queryId) === undefined ? {} : { queryId: stringField(input.queryId) }),
		...(stringField(input.viewId) === undefined ? {} : { viewId: stringField(input.viewId) }),
		...coordinates,
		filters,
		sort: presentation.sort,
		groupBy: presentation.groupBy,
		search: presentation.search,
		diagnostics,
		repairReviewStatuses,
		outcomeIndexes,
		outcomeDetails,
		displayGroups,
		displayDiagnostics,
		page: {
			offset,
			limit,
			totalOutcomeRefs: allOutcomeRefs.length,
			returnedOutcomeRefs: pagedRefs.length,
		},
	};
}

export function projectWorkspaceProposalFamilyApplicationReadModels(
	input: WorkspaceProposalFamilyApplicationReadModelsProjectionInput,
): readonly WorkspaceProposalFamilyApplicationReadModel[] {
	const currentQueries = new Map<string, WorkspaceProposalFamilyApplicationReadModelQuery>();
	for (const query of input.queries ?? []) {
		currentQueries.set(readModelQueryProjectionKey(query), query);
	}
	return [...currentQueries.values()].map((query) => {
		const normalized = normalizeReadModelQuery(query);
		if (!normalized.complete || normalized.malformed) {
			return projectWorkspaceProposalFamilyApplicationReadModel({
				queryId: normalized.queryId,
				viewId: normalized.viewId,
				offset: normalized.page.offset,
				limit: normalized.page.limit,
				filters: normalized.filters,
				sort: normalized.sort,
				groupBy: normalized.groupBy,
				search: normalized.search,
				displayDiagnostics: [
					readModelQueryDisplayDiagnostic(
						normalized.malformed ? "malformed-read-model-query" : "incomplete-read-model-query",
						normalized,
					),
				],
			});
		}
		return projectWorkspaceProposalFamilyApplicationReadModel({
			diagnostics: input.diagnostics,
			repairReviewStatuses: input.repairReviewStatuses,
			outcomeIndex: input.outcomeIndex,
			outcomeStatuses: input.outcomeStatuses,
			outcomes: input.outcomes,
			queryId: normalized.queryId,
			viewId: normalized.viewId,
			applicationId: normalized.coordinates.applicationId,
			proposalId: normalized.coordinates.proposalId,
			decisionId: normalized.coordinates.decisionId,
			idempotencyKey: normalized.coordinates.idempotencyKey,
			proposalFamily: normalized.coordinates.proposalFamily,
			offset: normalized.page.offset,
			limit: normalized.page.limit,
			filters: normalized.filters,
			sort: normalized.sort,
			groupBy: normalized.groupBy,
			search: normalized.search,
		});
	});
}

/** Graph-visible variant of `projectWorkspaceProposalFamilyApplicationReadModel`. */
export function workspaceProposalFamilyApplicationReadModelProjector(
	graph: Graph,
	opts: WorkspaceProposalFamilyApplicationReadModelProjectorOptions,
): WorkspaceProposalFamilyApplicationReadModelProjectorBundle {
	const name = opts.name ?? "workspaceProposalFamilyApplicationReadModel";
	const { deps, depKinds } = readModelProjectionDeps(opts);
	const runtime = graph.node<
		| {
				readonly kind: "read-model";
				readonly value: WorkspaceProposalFamilyApplicationReadModel;
		  }
		| undefined
	>(
		deps,
		(ctx) => {
			const state = familyProjectionState(ctx);
			ingestDiagnosticInputFacts(ctx, state, depKinds);
			const readModel = projectWorkspaceProposalFamilyApplicationReadModel({
				diagnostics: [...state.diagnostics.values()],
				repairReviewStatuses: [...state.repairStatuses.values()],
				outcomeIndex: [...state.outcomeIndex.values()],
				outcomeStatuses: [...state.outcomeStatuses.values()],
				outcomes: [...state.outcomes.values()],
				applicationId: opts.applicationId,
				proposalId: opts.proposalId,
				decisionId: opts.decisionId,
				idempotencyKey: opts.idempotencyKey,
				proposalFamily: opts.proposalFamily,
				offset: opts.offset,
				limit: opts.limit,
				sort: opts.sort,
				groupBy: opts.groupBy,
				search: opts.search,
			});
			const signature = readModelSignature(readModel);
			if (state.emittedReadModels.get(readModel.readModelId) !== signature) {
				state.emittedReadModels.set(readModel.readModelId, signature);
				ctx.down([["DATA", { kind: "read-model", value: readModel }]]);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalFamilyApplicationReadModelProjector"),
	);
	return {
		readModels: project(graph, runtime, `${name}/readModels`, `${name}ReadModels`, (fact) =>
			fact?.kind === "read-model" ? fact.value : undefined,
		),
	};
}

/** Graph-visible query-driven variant of `projectWorkspaceProposalFamilyApplicationReadModels`. */
export function workspaceProposalFamilyApplicationReadModelsProjector(
	graph: Graph,
	opts: WorkspaceProposalFamilyApplicationReadModelsProjectorOptions,
): WorkspaceProposalFamilyApplicationReadModelProjectorBundle {
	const name = opts.name ?? "workspaceProposalFamilyApplicationReadModels";
	const { deps, depKinds } = readModelsProjectionDeps(opts);
	const runtime = graph.node<
		| {
				readonly kind: "read-model";
				readonly value: WorkspaceProposalFamilyApplicationReadModel;
		  }
		| undefined
	>(
		deps,
		(ctx) => {
			const state = familyProjectionState(ctx);
			ingestDiagnosticInputFacts(ctx, state, depKinds);
			for (const readModel of projectWorkspaceProposalFamilyApplicationReadModels({
				queries: [...state.readModelQueries.values()],
				diagnostics: [...state.diagnostics.values()],
				repairReviewStatuses: [...state.repairStatuses.values()],
				outcomeIndex: [...state.outcomeIndex.values()],
				outcomeStatuses: [...state.outcomeStatuses.values()],
				outcomes: [...state.outcomes.values()],
			})) {
				const signature = readModelEmissionSignature(readModel);
				if (state.emittedReadModels.get(readModelCurrentViewKey(readModel)) === signature) {
					continue;
				}
				state.emittedReadModels.set(readModelCurrentViewKey(readModel), signature);
				ctx.down([["DATA", { kind: "read-model", value: readModel }]]);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalFamilyApplicationReadModelsProjector"),
	);
	return {
		readModels: project(graph, runtime, `${name}/readModels`, `${name}ReadModels`, (fact) =>
			fact?.kind === "read-model" ? fact.value : undefined,
		),
	};
}

export function projectWorkspaceProposalFamilyOutcomeDetailSupplyResults(
	input: WorkspaceProposalFamilyOutcomeDetailSupplyProjectionInput,
): readonly WorkspaceProposalFamilyOutcomeDetailSupplyResult[] {
	const suppliedByOutcomeId = groupByOutcomeId(input.suppliedOutcomes ?? []);
	return [...currentSupplyRequests(input.requests ?? []).values()].map((request) =>
		projectWorkspaceProposalFamilyOutcomeDetailSupplyResult(request, suppliedByOutcomeId),
	);
}

export function projectWorkspaceProposalFamilyOutcomeDetailSupplyResult(
	request: WorkspaceProposalFamilyOutcomeDetailSupplyRequest | unknown,
	suppliedOutcomes:
		| readonly WorkspaceProposalFamilyOutcomeRecord[]
		| ReadonlyMap<string, readonly WorkspaceProposalFamilyOutcomeRecord[]> = [],
): WorkspaceProposalFamilyOutcomeDetailSupplyResult {
	const issues = outcomeDetailSupplyRequestIssues(request);
	const requestRecord = isRecord(request) ? request : {};
	const requestAudit = safeWorkspaceProposalAudit(requestRecord.audit);
	const boundarySafeRequestAudit =
		requestAudit === undefined ||
		!workspaceProposalBoundarySourceRefsAreSafe(requestAudit.sourceRefs)
			? undefined
			: requestAudit;
	const sourceRefs = repairActionSourceRefs([
		...safeBoundarySourceRefs(requestRecord.sourceRefs),
		...(boundarySafeRequestAudit?.sourceRefs ?? []),
	]);
	const pageRecord = isRecord(requestRecord.page) ? requestRecord.page : {};
	const filters = normalizeReadModelFilters(
		isRecord(requestRecord.filters)
			? (requestRecord.filters as WorkspaceProposalFamilyApplicationReadModelFilters)
			: undefined,
	).filters;
	const currentViewId =
		stringField(requestRecord.viewId) ?? stringField(requestRecord.supplyRequestId) ?? "unknown";
	const coordinates = {
		applicationId: stringField(requestRecord.applicationId),
		proposalId: stringField(requestRecord.proposalId),
		decisionId: stringField(requestRecord.decisionId),
		idempotencyKey: stringField(requestRecord.idempotencyKey),
		proposalFamily: stringField(requestRecord.proposalFamily) as
			| WorkspaceProposalFamily
			| undefined,
	};
	if (issues.length > 0 || !isOutcomeDetailSupplyRequestMaterial(request)) {
		return {
			kind: "workspace-proposal-family-outcome-detail-supply-result",
			...(stringField(requestRecord.supplyRequestId) === undefined
				? {}
				: { supplyRequestId: stringField(requestRecord.supplyRequestId) }),
			...(stringField(requestRecord.viewId) === undefined
				? {}
				: { viewId: stringField(requestRecord.viewId) }),
			currentViewId,
			...coordinates,
			suppliedOutcomeFacts: [],
			missingRefs: [],
			mismatchedRefs: [],
			displayDiagnostics: [
				outcomeDetailSupplyDiagnostic(
					"malformed-outcome-detail-supply-request",
					"Workspace proposal family outcome detail supply request is malformed",
					undefined,
					coordinates,
					sourceRefs,
				),
			],
			page: {
				offset: normalizePageOffset(pageRecord.offset),
				limit: normalizePageLimit(pageRecord.limit),
			},
			filters,
			sourceRefs,
			...(boundarySafeRequestAudit === undefined ? {} : { audit: boundarySafeRequestAudit }),
		};
	}
	const suppliedMap: ReadonlyMap<string, readonly WorkspaceProposalFamilyOutcomeRecord[]> =
		Array.isArray(suppliedOutcomes)
			? groupByOutcomeId<WorkspaceProposalFamilyOutcomeRecord>(
					suppliedOutcomes as readonly WorkspaceProposalFamilyOutcomeRecord[],
				)
			: (suppliedOutcomes as ReadonlyMap<string, readonly WorkspaceProposalFamilyOutcomeRecord[]>);
	const offset = normalizePageOffset(request.page?.offset);
	const limit = normalizePageLimit(request.page?.limit);
	const pagedRequestRefs = request.requestedOutcomeRefs.slice(offset, offset + limit);
	const pagedRefs = pagedRequestRefs.filter((ref) =>
		supplyRequestRefMatches(request, ref, filters),
	);
	const suppliedOutcomeFacts: WorkspaceProposalFamilyOutcomeRecord[] = [];
	const missingRefs: WorkspaceProposalFamilyOutcomeRef[] = [];
	const mismatchedRefs: WorkspaceProposalFamilyOutcomeRef[] = [];
	const displayDiagnostics: WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic[] = [];
	for (const ref of pagedRefs) {
		const candidates = suppliedMap.get(ref.outcomeId) ?? [];
		const match = candidates.find((candidate) => sameOutcomeRefCoordinates(ref, candidate));
		if (match !== undefined) {
			const dataOnlyIssues = workspaceProposalDataOnlyIssues(match, "suppliedOutcomeDetail");
			if (dataOnlyIssues.length === 0 && outcomeDetailSupplyOutcomeBoundaryRefsAreSafe(match)) {
				suppliedOutcomeFacts.push(match);
			} else {
				mismatchedRefs.push(ref);
				displayDiagnostics.push(
					outcomeDetailSupplyDiagnostic(
						"malformed-supplied-outcome-detail",
						"Workspace proposal family supplied outcome detail is not data-only material",
						ref,
						request,
						request.sourceRefs,
					),
				);
			}
			continue;
		}
		if (candidates.length === 0) {
			missingRefs.push(ref);
			displayDiagnostics.push(
				outcomeDetailSupplyDiagnostic(
					"missing-supplied-outcome-detail",
					"Workspace proposal family outcome detail supply did not include a requested ref",
					ref,
					request,
					request.sourceRefs,
				),
			);
		} else {
			mismatchedRefs.push(ref);
			displayDiagnostics.push(
				outcomeDetailSupplyDiagnostic(
					"mismatched-supplied-outcome-detail",
					"Workspace proposal family outcome detail supply mismatches a requested ref",
					ref,
					request,
					request.sourceRefs,
				),
			);
		}
	}
	for (const ref of pagedRequestRefs) {
		if (sameSupplyRequestCoordinates(request, ref)) continue;
		mismatchedRefs.push(ref);
		displayDiagnostics.push(
			outcomeDetailSupplyDiagnostic(
				"mismatched-supplied-outcome-detail",
				"Workspace proposal family outcome detail request ref mismatches supply coordinates",
				ref,
				request,
				request.sourceRefs,
			),
		);
	}
	return {
		kind: "workspace-proposal-family-outcome-detail-supply-result",
		supplyRequestId: request.supplyRequestId,
		...(request.viewId === undefined ? {} : { viewId: request.viewId }),
		currentViewId: request.viewId ?? request.supplyRequestId,
		applicationId: request.applicationId,
		proposalId: request.proposalId,
		decisionId: request.decisionId,
		idempotencyKey: request.idempotencyKey,
		proposalFamily: request.proposalFamily,
		suppliedOutcomeFacts: dedupeOutcomes(suppliedOutcomeFacts),
		missingRefs,
		mismatchedRefs,
		displayDiagnostics,
		page: {
			offset,
			limit,
		},
		filters,
		sourceRefs: repairActionSourceRefs([
			...request.sourceRefs,
			...(request.audit?.sourceRefs ?? []),
		]),
		...(request.audit === undefined ? {} : { audit: immutableClone(request.audit) }),
	};
}

export function workspaceProposalFamilyOutcomeDetailSupplyProjector(
	graph: Graph,
	opts: WorkspaceProposalFamilyOutcomeDetailSupplyProjectorOptions,
): WorkspaceProposalFamilyOutcomeDetailSupplyProjectorBundle {
	const name = opts.name ?? "workspaceProposalFamilyOutcomeDetailSupply";
	const runtime = graph.node<
		| {
				readonly kind: "outcome-detail-supply-result";
				readonly value: WorkspaceProposalFamilyOutcomeDetailSupplyResult;
		  }
		| undefined
	>(
		[opts.requests, opts.suppliedOutcomes],
		(ctx) => {
			const state = ctx.state.get<{
				readonly requests: Map<string, WorkspaceProposalFamilyOutcomeDetailSupplyRequest>;
				readonly suppliedOutcomes: Map<string, WorkspaceProposalFamilyOutcomeRecord>;
				readonly emittedResults: Map<string, string>;
			}>() ?? {
				requests: new Map(),
				suppliedOutcomes: new Map(),
				emittedResults: new Map(),
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const request = raw as WorkspaceProposalFamilyOutcomeDetailSupplyRequest;
				state.requests.set(outcomeDetailSupplyRequestProjectionKey(request), request);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const outcome = raw as WorkspaceProposalFamilyOutcomeRecord;
				if (isOutcomeDetailSupplyOutcomeRecordShape(outcome)) {
					state.suppliedOutcomes.set(outcomeProjectionKey(outcome), outcome);
				}
			}
			for (const result of projectWorkspaceProposalFamilyOutcomeDetailSupplyResults({
				requests: [...state.requests.values()],
				suppliedOutcomes: [...state.suppliedOutcomes.values()],
			})) {
				const signature = stableStringify(result);
				if (state.emittedResults.get(result.currentViewId) === signature) continue;
				state.emittedResults.set(result.currentViewId, signature);
				ctx.down([["DATA", { kind: "outcome-detail-supply-result", value: result }]]);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalFamilyOutcomeDetailSupplyProjector"),
	);
	return {
		results: project(graph, runtime, `${name}/results`, `${name}Results`, (fact) =>
			fact?.kind === "outcome-detail-supply-result" ? fact.value : undefined,
		),
	};
}

export function projectWorkspaceProposalRepairActionDescriptors(
	input: WorkspaceProposalRepairActionDescriptorProjectionInput,
): readonly WorkspaceProposalRepairActionDescriptor[] {
	const descriptors: WorkspaceProposalRepairActionDescriptor[] = [];
	for (const request of input.requests ?? []) {
		const status = matchingRepairReviewStatus(request, input.statuses ?? []);
		const state = status?.state ?? "open";
		for (const actionKind of repairActionKinds) {
			descriptors.push(repairActionDescriptor(request, status, actionKind, state));
		}
	}
	return descriptors;
}

export function workspaceProposalRepairActionDescriptorProjector(
	graph: Graph,
	opts: WorkspaceProposalRepairActionDescriptorProjectorOptions,
): WorkspaceProposalRepairActionDescriptorProjectorBundle {
	const name = opts.name ?? "workspaceProposalRepairActionDescriptor";
	const deps =
		opts.statuses === undefined ? [opts.requests as Node<unknown>] : [opts.requests, opts.statuses];
	const depKinds: readonly WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][] =
		opts.statuses === undefined ? ["repair-request"] : ["repair-request", "repair-status"];
	const runtime = graph.node<
		| {
				readonly kind: "repair-action-descriptor";
				readonly value: WorkspaceProposalRepairActionDescriptor;
		  }
		| undefined
	>(
		deps,
		(ctx) => {
			const state = familyProjectionState(ctx);
			ingestDiagnosticInputFacts(ctx, state, depKinds);
			for (const descriptor of projectWorkspaceProposalRepairActionDescriptors({
				requests: [...state.repairRequests.values()],
				statuses: [...state.repairStatuses.values()],
			})) {
				const signature = repairActionDescriptorSignature(descriptor);
				if (state.emittedRepairActionDescriptors.get(descriptor.descriptorId) === signature) {
					continue;
				}
				state.emittedRepairActionDescriptors.set(descriptor.descriptorId, signature);
				ctx.down([["DATA", { kind: "repair-action-descriptor", value: descriptor }]]);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalRepairActionDescriptorProjector"),
	);
	return {
		descriptors: project(graph, runtime, `${name}/descriptors`, `${name}Descriptors`, (fact) =>
			fact?.kind === "repair-action-descriptor" ? fact.value : undefined,
		),
	};
}

export function validateWorkspaceProposalRepairActionIntent(
	intent: WorkspaceProposalRepairActionIntent | unknown,
	optionsOrDescriptor:
		| WorkspaceProposalRepairActionIntentValidationOptions
		| WorkspaceProposalRepairActionDescriptor
		| undefined = {},
	request?: WorkspaceProposalRepairReviewRequest,
	currentStatus?: WorkspaceProposalRepairReviewStatus,
): WorkspaceProposalRepairActionIntentValidationResult {
	const options = repairActionValidationOptions(optionsOrDescriptor, request, currentStatus);
	const issues = repairActionIntentIssues(intent, options);
	const accepted = issues.length === 0 && isRepairActionIntentMaterial(intent);
	const normalized = accepted
		? immutableClone(intent as WorkspaceProposalRepairActionIntent)
		: undefined;
	const record = isRecord(intent) ? intent : {};
	const sourceRefs = repairActionSourceRefs([
		...(isRepairActionIntentMaterial(intent) ? (intent.sourceRefs ?? []) : []),
		...(options.sourceRefs ?? []),
		...(safeWorkspaceProposalAudit(options.audit)?.sourceRefs ?? []),
	]);
	const audit =
		safeWorkspaceProposalAudit(options.audit) ??
		(accepted ? safeWorkspaceProposalAudit(normalized?.audit) : undefined);
	return {
		kind: "workspace-proposal-repair-action-intent-validation-result",
		status: accepted ? "accepted" : "blocked",
		...(normalized !== undefined
			? {}
			: {
					intentId: stringField(record.intentId),
					descriptorId: stringField(record.descriptorId),
					repairRequestId: stringField(record.repairRequestId),
					actionKind: repairActionKinds.includes(
						record.actionKind as WorkspaceProposalRepairActionKind,
					)
						? (record.actionKind as WorkspaceProposalRepairActionKind)
						: undefined,
					applicationId: stringField(record.applicationId),
					proposalId: stringField(record.proposalId),
					decisionId: stringField(record.decisionId),
					idempotencyKey: stringField(record.idempotencyKey),
					proposalFamily: stringField(record.proposalFamily) as WorkspaceProposalFamily | undefined,
				}),
		...(normalized === undefined
			? {}
			: {
					intentId: normalized.intentId,
					descriptorId: normalized.descriptorId,
					repairRequestId: normalized.repairRequestId,
					actionKind: normalized.actionKind,
					applicationId: normalized.applicationId,
					proposalId: normalized.proposalId,
					decisionId: normalized.decisionId,
					idempotencyKey: normalized.idempotencyKey,
					proposalFamily: normalized.proposalFamily,
					...(accepted ? { intent: normalized } : {}),
				}),
		issues,
		sourceRefs,
		...(audit === undefined ? {} : { audit }),
	};
}

export function prepareWorkspaceProposalRepairReviewDecisionRecordingInput(
	intent: WorkspaceProposalRepairActionIntent | unknown,
	optionsOrDescriptor:
		| (WorkspaceProposalRepairActionIntentValidationOptions &
				WorkspaceProposalRepairReviewDecisionRecordingInputPreparationOptions)
		| WorkspaceProposalRepairActionDescriptor
		| undefined,
	request?: WorkspaceProposalRepairReviewRequest,
	currentStatus?: WorkspaceProposalRepairReviewStatus,
	preparationOptions?: WorkspaceProposalRepairReviewDecisionRecordingInputPreparationOptions,
): WorkspaceProposalRepairReviewDecisionRecordingInputPreparationResult {
	const options =
		preparationOptions === undefined
			? ((optionsOrDescriptor ?? {}) as WorkspaceProposalRepairActionIntentValidationOptions &
					WorkspaceProposalRepairReviewDecisionRecordingInputPreparationOptions)
			: {
					...preparationOptions,
					...repairActionValidationOptions(optionsOrDescriptor, request, currentStatus),
				};
	const validation = validateWorkspaceProposalRepairActionIntent(intent, options);
	const issues: WorkspaceProposalRecordedIssue[] = [...validation.issues];
	const safeAudit = safeWorkspaceProposalAudit(options.audit);
	const sourceRefs = repairActionSourceRefs([
		...(options.sourceRefs ?? []),
		...(safeAudit?.sourceRefs ?? []),
	]);
	if (validation.intent === undefined || options.request === undefined) {
		return {
			kind: "workspace-proposal-repair-review-decision-recording-input-preparation-result",
			status: "blocked",
			issues: dedupeRepairActionIssues(issues),
			sourceRefs,
			...(safeAudit === undefined ? {} : { audit: safeAudit }),
		};
	}
	const decisionIntent = repairActionDecisionIntent(validation.intent.actionKind);
	if (decisionIntent === undefined) {
		issues.push(
			repairActionIntentIssue(
				"unsupported-repair-action-intent",
				"Successor proposal actions do not lower to repair-review decision recording input.",
				validation.intent,
				options.request,
			),
		);
	}
	const recordingOptions: WorkspaceProposalRepairReviewDecisionRecordingOptions = {
		reviewDecisionId: options.reviewDecisionId,
		intent: decisionIntent,
		reviewerRef: options.reviewerRef ?? validation.intent.reviewerRef,
		actorRef: options.actorRef ?? validation.intent.actorRef,
		capabilityRefs: options.capabilityRefs,
		policyRefs: options.policyRefs,
		sourceRefs: options.sourceRefs,
		audit: options.audit,
		reason: options.reason,
		code: options.code,
		resolvesRefs: options.resolvesRefs,
		supersedesRefs: options.supersedesRefs,
		decidedAtMs: options.decidedAtMs,
		metadata: {
			...(options.metadata ?? {}),
			repairActionIntentId: validation.intent.intentId,
			repairActionDescriptorId: validation.intent.descriptorId,
			repairActionKind: validation.intent.actionKind,
		},
		currentStatus: options.currentStatus,
		expectedCurrentState: options.expectedCurrentState ?? validation.intent.expectedCurrentState,
	};
	if (decisionIntent !== undefined) {
		issues.push(...repairReviewDecisionRecordingIssues(options.request, recordingOptions));
	}
	if (issues.length > 0 || decisionIntent === undefined) {
		return {
			kind: "workspace-proposal-repair-review-decision-recording-input-preparation-result",
			status: "blocked",
			issues: dedupeRepairActionIssues(issues),
			sourceRefs,
			...(safeAudit === undefined ? {} : { audit: safeAudit }),
		};
	}
	const metadata = recordingOptions.metadata ?? {};
	const recordingInput: WorkspaceProposalRepairReviewDecisionRecordingInput = {
		kind: "workspace-proposal-repair-review-decision-recording-input",
		repairRequestId: options.request.repairRequestId,
		reviewDecisionId: options.reviewDecisionId!,
		intent: decisionIntent,
		...(recordingOptions.reviewerRef === undefined
			? {}
			: { reviewerRef: immutableClone(recordingOptions.reviewerRef) }),
		...(recordingOptions.actorRef === undefined
			? {}
			: { actorRef: immutableClone(recordingOptions.actorRef) }),
		...(recordingOptions.capabilityRefs === undefined
			? {}
			: { capabilityRefs: immutableClone(recordingOptions.capabilityRefs) }),
		...(recordingOptions.policyRefs === undefined
			? {}
			: { policyRefs: immutableClone(recordingOptions.policyRefs) }),
		...(recordingOptions.sourceRefs === undefined
			? {}
			: { sourceRefs: immutableClone(recordingOptions.sourceRefs) }),
		audit: immutableClone(options.audit),
		...(options.reason === undefined ? {} : { reason: options.reason }),
		...(options.code === undefined ? {} : { code: options.code }),
		...(options.resolvesRefs === undefined
			? {}
			: { resolvesRefs: immutableClone(options.resolvesRefs) }),
		...(options.supersedesRefs === undefined
			? {}
			: { supersedesRefs: immutableClone(options.supersedesRefs) }),
		...(options.decidedAtMs === undefined ? {} : { decidedAtMs: options.decidedAtMs }),
		...(Object.keys(metadata).length === 0 ? {} : { metadata: immutableClone(metadata) }),
		...(recordingOptions.expectedCurrentState === undefined
			? {}
			: { expectedCurrentState: immutableClone(recordingOptions.expectedCurrentState) }),
	};
	return {
		kind: "workspace-proposal-repair-review-decision-recording-input-preparation-result",
		status: "prepared",
		recordingInput,
		issues: [],
		sourceRefs: recordingInput.sourceRefs ?? [],
		audit: recordingInput.audit,
	};
}

export function projectWorkspaceProposalRepairSuccessorProposalIntakePreview(
	intent: WorkspaceProposalRepairActionIntent | unknown,
	options: WorkspaceProposalRepairActionIntentValidationOptions &
		WorkspaceProposalRepairSuccessorProposalIntakePreviewOptions = {},
): WorkspaceProposalRepairSuccessorProposalIntakePreview {
	const validation = validateWorkspaceProposalRepairActionIntent(intent, options);
	const normalized = validation.intent;
	const diagnostics: WorkspaceProposalRecordedIssue[] = [...validation.issues];
	if (normalized === undefined) {
		return blockedRepairSuccessorPreview(intent, diagnostics, options);
	}
	if (normalized.actionKind !== "open-successor-proposal-flow") {
		diagnostics.push(
			repairActionIntentIssue(
				"unsupported-repair-action-intent",
				"Only open-successor-proposal-flow lowers to successor proposal intake preview.",
				normalized,
				options.request,
			),
		);
	}
	diagnostics.push(...repairActionSuggestedDraftPatchIssues(normalized, options));
	diagnostics.push(...repairActionPreviewMetadataIssues(normalized, options));
	const targetRefs = repairActionSourceRefs([
		...(options.request === undefined
			? []
			: [
					{ kind: "workspace-proposal-repair-review-request", id: options.request.repairRequestId },
				]),
		...(options.request === undefined ? [] : repairReviewSubjectRefs(options.request)),
	]);
	const contextRefs = repairActionSourceRefs([
		...targetRefs,
		...(options.currentStatus === undefined
			? []
			: [
					{
						kind: "workspace-proposal-repair-review-status",
						id: options.currentStatus.repairRequestId,
					},
				]),
		...(options.contextRefs ?? []),
	]);
	const sourceRefs = repairActionSourceRefs([
		...(normalized.sourceRefs ?? []),
		...(options.descriptor?.sourceRefs ?? []),
		...(options.request?.sourceRefs ?? []),
		...(options.sourceRefs ?? []),
		...(safeWorkspaceProposalAudit(options.audit)?.sourceRefs ?? []),
	]);
	const previewAudit =
		safeWorkspaceProposalAudit(options.audit) ?? safeWorkspaceProposalAudit(normalized.audit);
	const previewId =
		options.previewId ??
		`workspace-proposal-repair-successor-preview:${stableStringify({
			intentId: normalized.intentId,
			descriptorId: normalized.descriptorId,
			repairRequestId: normalized.repairRequestId,
		})}`;
	return {
		kind: "workspace-proposal-repair-successor-proposal-intake-preview",
		previewId,
		status: diagnostics.length === 0 ? "proposal-context-ready" : "blocked",
		intentId: normalized.intentId,
		actionIntentId: normalized.intentId,
		descriptorId: normalized.descriptorId,
		repairRequestId: normalized.repairRequestId,
		actionKind: "open-successor-proposal-flow",
		applicationId: normalized.applicationId,
		proposalId: normalized.proposalId,
		decisionId: normalized.decisionId,
		idempotencyKey: normalized.idempotencyKey,
		proposalFamily: normalized.proposalFamily,
		suggestedFamily: options.suggestedFamily ?? normalized.proposalFamily,
		...(options.suggestedLoweringKind === undefined
			? {}
			: { suggestedLoweringKind: options.suggestedLoweringKind }),
		targetRefs,
		contextRefs,
		...(options.reason === undefined ? {} : { reason: options.reason }),
		code: options.code ?? options.request?.code,
		...(options.suggestedDraftPatch === undefined
			? {}
			: diagnostics.length === 0
				? { suggestedDraftPatch: immutableClone(options.suggestedDraftPatch) }
				: {}),
		diagnostics: dedupeRepairActionIssues(diagnostics),
		sourceRefs,
		...(previewAudit === undefined ? {} : { audit: previewAudit }),
		...(options.metadata === undefined || diagnostics.length > 0
			? {}
			: { metadata: immutableClone(options.metadata) }),
	};
}

export function previewWorkspaceProposalRepairSuccessorProposalIntake(
	intentOrRequest:
		| WorkspaceProposalRepairActionIntent
		| WorkspaceProposalRepairReviewRequest
		| undefined,
	optionsOrStatus?:
		| (WorkspaceProposalRepairActionIntentValidationOptions &
				WorkspaceProposalRepairSuccessorProposalIntakePreviewOptions)
		| WorkspaceProposalRepairReviewStatus,
	intent?: WorkspaceProposalRepairActionIntent | unknown,
	options: WorkspaceProposalRepairSuccessorProposalIntakePreviewOptions = {},
): WorkspaceProposalRepairSuccessorProposalIntakePreview {
	if (isRepairActionIntentMaterial(intentOrRequest)) {
		return projectWorkspaceProposalRepairSuccessorProposalIntakePreview(
			intentOrRequest,
			(optionsOrStatus ?? {}) as WorkspaceProposalRepairActionIntentValidationOptions &
				WorkspaceProposalRepairSuccessorProposalIntakePreviewOptions,
		);
	}
	const inlineOptions = isRepairReviewStatusMaterial(optionsOrStatus)
		? {}
		: ((optionsOrStatus ?? {}) as WorkspaceProposalRepairActionIntentValidationOptions &
				WorkspaceProposalRepairSuccessorProposalIntakePreviewOptions);
	return projectWorkspaceProposalRepairSuccessorProposalIntakePreview(intent, {
		...inlineOptions,
		...options,
		request: intentOrRequest,
		currentStatus: isRepairReviewStatusMaterial(optionsOrStatus)
			? optionsOrStatus
			: (options.currentStatus ?? inlineOptions.currentStatus),
		expectedCurrentState:
			options.expectedCurrentState ??
			inlineOptions.expectedCurrentState ??
			(isRepairActionIntentMaterial(intent) ? intent.expectedCurrentState : undefined),
	});
}

export function validateWorkspaceProposalRepairActionDisplayPolicyAdvisory(
	advisory: WorkspaceProposalRepairActionDisplayPolicyAdvisory | unknown,
	options: WorkspaceProposalRepairActionDisplayPolicyAdvisoryValidationOptions = {},
): WorkspaceProposalRepairActionDisplayPolicyAdvisoryValidationResult {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	const record = isRecord(advisory) ? advisory : {};
	const safeAudit = safeWorkspaceProposalAudit(record.audit ?? options.audit);
	const boundarySafeAudit =
		safeAudit === undefined || !workspaceProposalBoundarySourceRefsAreSafe(safeAudit.sourceRefs)
			? undefined
			: safeAudit;
	const sourceRefs = repairActionSourceRefs([
		...(Array.isArray(record.sourceRefs) ? (record.sourceRefs as SourceRef[]) : []),
		...(options.sourceRefs ?? []),
		...(boundarySafeAudit?.sourceRefs ?? []),
	]);
	if (!isRepairActionDisplayPolicyAdvisoryMaterial(advisory)) {
		issues.push(
			repairActionIntentIssue(
				"malformed-repair-action-display-policy-advisory",
				"Repair action display policy advisory requires typed display-only data material.",
				record,
				options.request,
			),
		);
	} else {
		for (const [label, value] of [
			["repairActionDisplayPolicyAdvisory", advisory],
			["repairActionDisplayPolicyAdvisoryOptions", options],
		] as const) {
			for (const entry of workspaceProposalDataOnlyIssues(value, label)) {
				issues.push(
					repairActionIssueFromDataOnly(
						entry,
						repairActionIssueIntentFallback(advisory),
						options.request,
					),
				);
			}
		}
		if (repairActionAdvisoryHasPermissionProofMaterial(advisory)) {
			issues.push(
				repairActionIntentIssue(
					"forbidden-repair-action-permission-proof-vocabulary",
					"Repair action display policy advisory must not use permission-proof vocabulary.",
					advisory,
					options.request,
				),
			);
		}
		if (
			!workspaceProposalBoundarySourceRefsAreSafe(advisory.policyEvidenceRefs) ||
			!workspaceProposalBoundarySourceRefsAreSafe(advisory.capabilityEvidenceRefs) ||
			!workspaceProposalBoundarySourceRefsAreSafe(advisory.sourceRefs) ||
			(advisory.audit !== undefined &&
				!workspaceProposalBoundarySourceRefsAreSafe(advisory.audit.sourceRefs))
		) {
			issues.push(
				repairActionIntentIssue(
					"forbidden-runtime-material",
					"Repair action display policy advisory refs must not carry runtime/provider/storage/query/client/file/network material.",
					advisory,
					options.request,
				),
			);
		}
		if (
			isRecord(advisory.metadata) &&
			workspaceProposalBoundaryMetadataSize(advisory.metadata) >
				workspaceProposalRepairAdvisoryMetadataMaxBytes
		) {
			issues.push(
				repairActionIntentIssue(
					"malformed-metadata",
					"Repair action display policy advisory metadata exceeds the bounded display limit.",
					advisory,
					options.request,
				),
			);
		}
		if (
			options.descriptor !== undefined &&
			(advisory.descriptorId !== options.descriptor.descriptorId ||
				advisory.repairRequestId !== options.descriptor.repairRequestId ||
				advisory.actionKind !== options.descriptor.actionKind ||
				!repairActionCoordinatesMatchDescriptor(advisory, options.descriptor))
		) {
			issues.push(
				repairActionIntentIssue(
					"repair-action-advisory-coordinate-mismatch",
					"Repair action display policy advisory must match descriptor coordinates.",
					advisory,
					options.request,
				),
			);
		}
		if (
			options.request !== undefined &&
			(advisory.repairRequestId !== options.request.repairRequestId ||
				!repairReviewCoordinatesMatch(options.request, advisory))
		) {
			issues.push(
				repairActionIntentIssue(
					"repair-action-advisory-coordinate-mismatch",
					"Repair action display policy advisory must match repair-review request coordinates.",
					advisory,
					options.request,
				),
			);
		}
	}
	const accepted = isRepairActionDisplayPolicyAdvisoryMaterial(advisory) && issues.length === 0;
	return {
		kind: "workspace-proposal-repair-action-display-policy-advisory-validation-result",
		status: accepted ? "accepted" : "blocked",
		...(stringField(record.descriptorId) === undefined
			? {}
			: { descriptorId: stringField(record.descriptorId) }),
		...(stringField(record.repairRequestId) === undefined
			? {}
			: { repairRequestId: stringField(record.repairRequestId) }),
		...(repairActionKinds.includes(record.actionKind as WorkspaceProposalRepairActionKind)
			? { actionKind: record.actionKind as WorkspaceProposalRepairActionKind }
			: {}),
		...(stringField(record.applicationId) === undefined
			? {}
			: { applicationId: stringField(record.applicationId) }),
		...(stringField(record.proposalId) === undefined
			? {}
			: { proposalId: stringField(record.proposalId) }),
		...(stringField(record.decisionId) === undefined
			? {}
			: { decisionId: stringField(record.decisionId) }),
		...(stringField(record.idempotencyKey) === undefined
			? {}
			: { idempotencyKey: stringField(record.idempotencyKey) }),
		...(stringField(record.proposalFamily) === undefined
			? {}
			: { proposalFamily: stringField(record.proposalFamily) as WorkspaceProposalFamily }),
		issues: dedupeRepairActionIssues(issues),
		sourceRefs,
		...(boundarySafeAudit === undefined ? {} : { audit: boundarySafeAudit }),
		...(accepted ? { advisory: immutableClone(advisory) } : {}),
	};
}

export function projectWorkspaceProposalRepairActionDisplayPolicyAdvisory(
	descriptor: WorkspaceProposalRepairActionDescriptor,
	request: WorkspaceProposalRepairReviewRequest,
	options: Omit<
		WorkspaceProposalRepairActionDisplayPolicyAdvisoryProjectorOptions,
		"name" | "descriptors" | "requests"
	> = {},
): WorkspaceProposalRepairActionDisplayPolicyAdvisory {
	const policyEvidenceRefs = safeAdvisorySourceRefs(options.policyEvidenceRefs);
	const capabilityEvidenceRefs = safeAdvisorySourceRefs(options.capabilityEvidenceRefs);
	const advisoryIssues = safeAdvisoryIssues(options.advisoryIssues);
	const displayCode = safeAdvisoryText(options.displayCode);
	const displayMessage = safeAdvisoryText(options.displayMessage);
	const sourceRefs = safeAdvisorySourceRefs(options.sourceRefs);
	const audit = safeAdvisoryAudit(options.audit);
	const metadata = safeAdvisoryMetadata(options.metadata);
	return {
		kind: "workspace-proposal-repair-action-display-policy-advisory",
		authority: "display-only-advisory",
		descriptorId: descriptor.descriptorId,
		repairRequestId: request.repairRequestId,
		actionKind: descriptor.actionKind,
		applicationId: request.applicationId,
		proposalId: request.proposalId,
		decisionId: request.decisionId,
		idempotencyKey: request.idempotencyKey,
		proposalFamily: request.proposalFamily,
		displayAssessment: options.displayAssessment ?? "not-evaluated",
		...(policyEvidenceRefs.length === 0 ? {} : { policyEvidenceRefs }),
		...(capabilityEvidenceRefs.length === 0 ? {} : { capabilityEvidenceRefs }),
		...(advisoryIssues.length === 0 ? {} : { advisoryIssues }),
		...(displayCode === undefined ? {} : { displayCode }),
		...(displayMessage === undefined ? {} : { displayMessage }),
		sourceRefs: repairActionSourceRefs([
			...descriptor.sourceRefs,
			...request.sourceRefs,
			...sourceRefs,
			...(audit?.sourceRefs ?? []),
		]),
		...(audit === undefined ? {} : { audit }),
		...(metadata === undefined ? {} : { metadata }),
	};
}

export function workspaceProposalRepairActionDisplayPolicyAdvisoryProjector(
	graph: Graph,
	opts: WorkspaceProposalRepairActionDisplayPolicyAdvisoryProjectorOptions,
): WorkspaceProposalRepairActionDisplayPolicyAdvisoryProjectorBundle {
	const name = opts.name ?? "workspaceProposalRepairActionDisplayPolicyAdvisory";
	const runtime = graph.node<
		| {
				readonly kind: "repair-action-display-policy-advisory";
				readonly value: WorkspaceProposalRepairActionDisplayPolicyAdvisory;
		  }
		| undefined
	>(
		[opts.descriptors, opts.requests],
		(ctx) => {
			const state = ctx.state.get<{
				readonly descriptors: Map<string, WorkspaceProposalRepairActionDescriptor>;
				readonly requests: Map<string, WorkspaceProposalRepairReviewRequest>;
				readonly emittedAdvisories: Map<string, string>;
			}>() ?? {
				descriptors: new Map(),
				requests: new Map(),
				emittedAdvisories: new Map(),
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const descriptor = raw as WorkspaceProposalRepairActionDescriptor;
				state.descriptors.set(descriptor.descriptorId, descriptor);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const request = raw as WorkspaceProposalRepairReviewRequest;
				state.requests.set(request.repairRequestId, request);
			}
			for (const descriptor of state.descriptors.values()) {
				const request = state.requests.get(descriptor.repairRequestId);
				if (request === undefined || !repairReviewCoordinatesMatch(request, descriptor)) continue;
				if (
					repairActionAdvisoryHasPermissionProofMaterial({
						policyEvidenceRefs: opts.policyEvidenceRefs,
						capabilityEvidenceRefs: opts.capabilityEvidenceRefs,
						advisoryIssues: opts.advisoryIssues,
						displayCode: opts.displayCode,
						displayMessage: opts.displayMessage,
						sourceRefs: opts.sourceRefs,
						audit: opts.audit,
						metadata: opts.metadata,
					})
				) {
					continue;
				}
				const advisory = projectWorkspaceProposalRepairActionDisplayPolicyAdvisory(
					descriptor,
					request,
					{
						displayAssessment: opts.displayAssessment,
						policyEvidenceRefs: opts.policyEvidenceRefs,
						capabilityEvidenceRefs: opts.capabilityEvidenceRefs,
						advisoryIssues: opts.advisoryIssues,
						displayCode: opts.displayCode,
						displayMessage: opts.displayMessage,
						sourceRefs: opts.sourceRefs,
						audit: opts.audit,
						metadata: opts.metadata,
					},
				);
				const validation = validateWorkspaceProposalRepairActionDisplayPolicyAdvisory(advisory, {
					descriptor,
					request,
				});
				if (validation.status !== "accepted" || validation.advisory === undefined) continue;
				const signature = stableStringify(advisory);
				const key = stableStringify({
					descriptorId: advisory.descriptorId,
					repairRequestId: advisory.repairRequestId,
					actionKind: advisory.actionKind,
				});
				if (state.emittedAdvisories.get(key) === signature) continue;
				state.emittedAdvisories.set(key, signature);
				ctx.down([["DATA", { kind: "repair-action-display-policy-advisory", value: advisory }]]);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalRepairActionDisplayPolicyAdvisoryProjector"),
	);
	return {
		advisories: project(graph, runtime, `${name}/advisories`, `${name}Advisories`, (fact) =>
			fact?.kind === "repair-action-display-policy-advisory" ? fact.value : undefined,
		),
	};
}

export function prepareWorkspaceProposalRepairSuccessorProposalReadyRequest<TDraft = unknown>(
	preview: WorkspaceProposalRepairSuccessorProposalIntakePreview | unknown,
	input: WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationInput<TDraft> | unknown,
): WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationResult<TDraft> {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	const previewRecord = isRecord(preview) ? preview : {};
	const inputRecord = isRecord(input) ? input : {};
	const validationRecord = isRecord(inputRecord.intentValidation)
		? inputRecord.intentValidation
		: {};
	const validationAudit = safeWorkspaceProposalAudit(validationRecord.audit);
	const boundarySafeValidationAudit =
		validationAudit === undefined ||
		!workspaceProposalBoundarySourceRefsAreSafe(validationAudit.sourceRefs)
			? undefined
			: validationAudit;
	const safeAudit = safeWorkspaceProposalAudit(inputRecord.audit);
	const boundarySafeAudit =
		safeAudit === undefined || !workspaceProposalBoundarySourceRefsAreSafe(safeAudit.sourceRefs)
			? undefined
			: safeAudit;
	const sourceRefs = repairActionSourceRefs([
		...(Array.isArray(previewRecord.sourceRefs) ? (previewRecord.sourceRefs as SourceRef[]) : []),
		...(Array.isArray(inputRecord.sourceRefs) ? (inputRecord.sourceRefs as SourceRef[]) : []),
		...(Array.isArray(inputRecord.finalDraftSourceRefs)
			? (inputRecord.finalDraftSourceRefs as SourceRef[])
			: []),
		...(Array.isArray(validationRecord.sourceRefs)
			? (validationRecord.sourceRefs as SourceRef[])
			: []),
		...(boundarySafeValidationAudit?.sourceRefs ?? []),
		...(boundarySafeAudit?.sourceRefs ?? []),
	]);
	if (!isRepairSuccessorPreviewMaterial(preview)) {
		issues.push(
			repairActionIntentIssue(
				"malformed-repair-successor-preview",
				"Repair successor ready-request preparation requires a typed successor preview.",
				preview,
				undefined,
			),
		);
	}
	if (!isRepairSuccessorReadyRequestPreparationInput(input)) {
		issues.push(
			repairActionIntentIssue(
				"malformed-repair-successor-preparation-input",
				"Repair successor ready-request preparation requires explicit typed preparation input.",
				input,
				undefined,
			),
		);
	}
	for (const [label, value] of [
		["repairSuccessorPreview", preview],
		["repairSuccessorReadyRequestPreparationInput", input],
	] as const) {
		for (const entry of workspaceProposalDataOnlyIssues(value, label)) {
			issues.push(
				repairActionIssueFromDataOnly(
					entry,
					repairActionIssueIntentFallback(input),
					isRepairSuccessorReadyRequestPreparationInput(input) ? input.request : undefined,
				),
			);
		}
	}
	if (isRepairSuccessorPreviewMaterial(preview) && preview.status !== "proposal-context-ready") {
		issues.push(
			repairActionIntentIssue(
				"repair-successor-preview-not-ready",
				"Repair successor preview must be proposal-context-ready before ready-request preparation.",
				preview,
				undefined,
			),
		);
	}
	if (
		isRepairSuccessorPreviewMaterial(preview) &&
		isRepairSuccessorReadyRequestPreparationInput(input)
	) {
		if (
			input.previewId !== preview.previewId ||
			input.intent.intentId !== preview.intentId ||
			input.descriptor.descriptorId !== preview.descriptorId ||
			input.request.repairRequestId !== preview.repairRequestId ||
			input.intent.actionKind !== "open-successor-proposal-flow" ||
			input.descriptor.actionKind !== "open-successor-proposal-flow" ||
			!repairActionPreviewCoordinatesMatchInput(preview, input) ||
			!repairActionIntentValidationMatchesPreparationInput(input.intentValidation, input)
		) {
			issues.push(
				repairActionIntentIssue(
					"repair-successor-preparation-coordinate-mismatch",
					"Repair successor preparation input must match preview, intent, descriptor, and repair request coordinates.",
					input.intent,
					input.request,
				),
			);
		}
		if (input.intentValidation.status !== "accepted" || input.intentValidation.issues.length > 0) {
			issues.push(
				repairActionIntentIssue(
					"blocked-repair-action-intent-validation",
					"Repair successor preparation requires an accepted repair action intent validation result.",
					input.intent,
					input.request,
				),
			);
		}
		if (!workspaceProposalTargetRefsAreValid(input.targetRefs)) {
			issues.push(
				repairActionIntentIssue(
					"malformed-repair-successor-preparation-input",
					"Repair successor ready-request preparation requires bounded target refs.",
					input.intent,
					input.request,
				),
			);
		}
		if (input.draft === undefined && !nonEmptySourceRefs(input.draftRefs)) {
			issues.push(
				repairActionIntentIssue(
					"missing-draft-material",
					"Repair successor ready-request preparation requires final draft material or draft refs.",
					input.intent,
					input.request,
				),
			);
		}
		if (
			(input.draft !== undefined || input.draftRefs !== undefined) &&
			!nonEmptySourceRefs(input.finalDraftSourceRefs)
		) {
			issues.push(
				repairActionIntentIssue(
					"missing-final-draft-source",
					"Repair successor final draft material requires explicit final draft source refs.",
					input.intent,
					input.request,
				),
			);
		}
		if (repairSuccessorPreparationMetadataHasTruthMaterial(input.metadata)) {
			issues.push(
				repairActionIntentIssue(
					"malformed-repair-successor-preparation-input",
					"Repair successor ready-request preparation metadata must not carry admission/application/recorded truth material.",
					input.intent,
					input.request,
				),
			);
		}
		if (boundarySafeAudit === undefined) {
			issues.push(
				repairActionIntentIssue(
					"missing-audit",
					"Repair successor ready-request preparation requires data-only audit material.",
					input.intent,
					input.request,
				),
			);
		}
	}
	const cleanIssues = dedupeRepairActionIssues(issues);
	const blockedPreviewId =
		stringField(previewRecord.previewId) ?? stringField(inputRecord.previewId);
	const blockedRepairRequestId =
		stringField(previewRecord.repairRequestId) ?? stringField(inputRecord.repairRequestId);
	if (
		cleanIssues.length > 0 ||
		!isRepairSuccessorPreviewMaterial(preview) ||
		!isRepairSuccessorReadyRequestPreparationInput(input) ||
		boundarySafeAudit === undefined
	) {
		return {
			kind: "workspace-proposal-repair-successor-proposal-ready-request-preparation-result",
			status: "blocked",
			...(stringField(inputRecord.preparationId) === undefined
				? {}
				: { preparationId: stringField(inputRecord.preparationId) }),
			...(blockedPreviewId === undefined ? {} : { previewId: blockedPreviewId }),
			...(blockedRepairRequestId === undefined ? {} : { repairRequestId: blockedRepairRequestId }),
			...(stringField(previewRecord.descriptorId) === undefined
				? {}
				: { descriptorId: stringField(previewRecord.descriptorId) }),
			...(stringField(previewRecord.intentId) === undefined
				? {}
				: { intentId: stringField(previewRecord.intentId) }),
			issues: cleanIssues,
			sourceRefs,
			...(boundarySafeAudit === undefined ? {} : { audit: boundarySafeAudit }),
		};
	}
	const readyRequest = immutableClone<WorkspaceProposalReadyRequest<TDraft>>({
		kind: "workspace-proposal-ready-request",
		proposalId: input.successorProposalId,
		intakeRequestId: input.intakeRequestId,
		idempotencyKey: input.successorIdempotencyKey,
		workspaceId: input.workspaceId,
		proposalFamily: input.successorProposalFamily,
		loweringKind: input.successorLoweringKind,
		...(input.draft === undefined ? {} : { draft: immutableClone(input.draft) as TDraft }),
		...(input.draftRefs === undefined ? {} : { draftRefs: immutableClone(input.draftRefs) }),
		targetRefs: immutableClone(input.targetRefs),
		actorRef: immutableClone(input.actorRef),
		capabilityRefs: immutableClone(input.capabilityRefs),
		policyRefs: immutableClone(input.policyRefs),
		projectionBundleRefs: immutableClone(input.projectionBundleRefs),
		sourceRefs,
		audit: boundarySafeAudit,
		metadata: immutableClone({
			...(input.metadata ?? {}),
			repairSuccessorPreviewId: preview.previewId,
			repairActionIntentId: input.intent.intentId,
			repairActionDescriptorId: input.descriptor.descriptorId,
			repairRequestId: input.request.repairRequestId,
			repairActionKind: input.intent.actionKind,
			predecessorProposalId: preview.proposalId,
			predecessorDecisionId: preview.decisionId,
			predecessorIdempotencyKey: preview.idempotencyKey,
			predecessorProposalFamily: preview.proposalFamily,
		}),
	});
	return {
		kind: "workspace-proposal-repair-successor-proposal-ready-request-preparation-result",
		status: "prepared",
		preparationId: input.preparationId,
		previewId: preview.previewId,
		repairRequestId: preview.repairRequestId,
		descriptorId: preview.descriptorId,
		intentId: preview.intentId,
		readyRequest,
		issues: [],
		sourceRefs,
		audit: boundarySafeAudit,
	};
}

export function workspaceProposalRepairActionIntentProjector(
	graph: Graph,
	opts: WorkspaceProposalRepairActionIntentProjectorOptions,
): WorkspaceProposalRepairActionIntentProjectorBundle {
	const name = opts.name ?? "workspaceProposalRepairActionIntent";
	const deps =
		opts.statuses === undefined
			? [opts.intents, opts.descriptors, opts.requests]
			: [opts.intents, opts.descriptors, opts.requests, opts.statuses];
	const runtime = graph.node<
		| {
				readonly kind: "repair-action-intent-validation-result";
				readonly value: WorkspaceProposalRepairActionIntentValidationResult;
		  }
		| undefined
	>(
		deps,
		(ctx) => {
			const state = repairActionIntentGraphState(ctx);
			ingestRepairActionIntentGraphFacts(ctx, state, opts.statuses !== undefined);
			for (const entry of state.intents.values()) {
				if (entry.conflict) {
					const result = conflictingRepairActionIntentValidationResult(entry.intent);
					const signature = stableStringify(result);
					if (state.emittedResults.get(entry.intent.intentId) === signature) continue;
					state.emittedResults.set(entry.intent.intentId, signature);
					ctx.down([["DATA", { kind: "repair-action-intent-validation-result", value: result }]]);
					continue;
				}
				const intent = entry.intent;
				const request = state.requests.get(intent.repairRequestId);
				const result = validateWorkspaceProposalRepairActionIntent(intent, {
					descriptor: state.descriptors.get(intent.descriptorId),
					request,
					currentStatus:
						request === undefined
							? undefined
							: state.statuses.get(repairReviewStatusProjectionKeyFromRequest(request)),
					expectedCurrentState: intent.expectedCurrentState,
					capabilityRefs: opts.capabilityRefs,
					policyRefs: opts.policyRefs,
					policyStatus: opts.policyStatus,
				});
				const signature = stableStringify(result);
				if (state.emittedResults.get(intent.intentId) === signature) continue;
				state.emittedResults.set(intent.intentId, signature);
				ctx.down([["DATA", { kind: "repair-action-intent-validation-result", value: result }]]);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalRepairActionIntentProjector"),
	);
	return {
		results: project(graph, runtime, `${name}/results`, `${name}Results`, (fact) =>
			fact?.kind === "repair-action-intent-validation-result" ? fact.value : undefined,
		),
	};
}

export function workspaceProposalRepairSuccessorProposalIntakePreviewProjector(
	graph: Graph,
	opts: WorkspaceProposalRepairSuccessorProposalIntakePreviewProjectorOptions,
): WorkspaceProposalRepairSuccessorProposalIntakePreviewProjectorBundle {
	const name = opts.name ?? "workspaceProposalRepairSuccessorProposalIntakePreview";
	const deps =
		opts.statuses === undefined
			? [opts.intents, opts.descriptors, opts.requests]
			: [opts.intents, opts.descriptors, opts.requests, opts.statuses];
	const runtime = graph.node<
		| {
				readonly kind: "successor-proposal-intake-preview";
				readonly value: WorkspaceProposalRepairSuccessorProposalIntakePreview;
		  }
		| undefined
	>(
		deps,
		(ctx) => {
			const state = repairActionIntentGraphState(ctx);
			ingestRepairActionIntentGraphFacts(ctx, state, opts.statuses !== undefined);
			for (const entry of state.intents.values()) {
				if (entry.intent.actionKind !== "open-successor-proposal-flow") continue;
				const intent = entry.intent;
				if (entry.conflict) {
					const preview = blockedRepairSuccessorPreview(
						intent,
						[conflictingRepairActionIntentIssue(intent)],
						{},
					);
					const signature = stableStringify(preview);
					if (state.emittedPreviews.get(preview.previewId) === signature) continue;
					state.emittedPreviews.set(preview.previewId, signature);
					ctx.down([["DATA", { kind: "successor-proposal-intake-preview", value: preview }]]);
					continue;
				}
				const request = state.requests.get(intent.repairRequestId);
				const preview = projectWorkspaceProposalRepairSuccessorProposalIntakePreview(intent, {
					descriptor: state.descriptors.get(intent.descriptorId),
					request,
					currentStatus:
						request === undefined
							? undefined
							: state.statuses.get(repairReviewStatusProjectionKeyFromRequest(request)),
					expectedCurrentState: intent.expectedCurrentState,
					capabilityRefs: opts.capabilityRefs,
					policyRefs: opts.policyRefs,
					policyStatus: opts.policyStatus,
					maxSuggestedDraftPatchBytes: opts.maxSuggestedDraftPatchBytes,
				});
				const signature = stableStringify(preview);
				if (state.emittedPreviews.get(preview.previewId) === signature) continue;
				state.emittedPreviews.set(preview.previewId, signature);
				ctx.down([["DATA", { kind: "successor-proposal-intake-preview", value: preview }]]);
			}
			ctx.state.set(state);
		},
		runtimeOptions(name, "workspaceProposalRepairSuccessorProposalIntakePreviewProjector"),
	);
	return {
		previews: project(graph, runtime, `${name}/previews`, `${name}Previews`, (fact) =>
			fact?.kind === "successor-proposal-intake-preview" ? fact.value : undefined,
		),
	};
}

export function workspaceProposalRepairSuccessorProposalReadyRequestPreparationProjector<
	TDraft = unknown,
>(
	graph: Graph,
	opts: WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationProjectorOptions<TDraft>,
): WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationProjectorBundle<TDraft> {
	const name = opts.name ?? "workspaceProposalRepairSuccessorProposalReadyRequestPreparation";
	const runtime = graph.node<
		| {
				readonly kind: "successor-ready-request-preparation-result";
				readonly value: WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationResult<TDraft>;
		  }
		| {
				readonly kind: "successor-ready-request";
				readonly value: WorkspaceProposalReadyRequest<TDraft>;
		  }
		| {
				readonly kind: "issue";
				readonly value: WorkspaceProposalRecordedIssue;
		  }
		| undefined
	>(
		[opts.previews, opts.preparationInputs],
		(ctx) => {
			const state = repairSuccessorPreparationGraphState<TDraft>(ctx);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const preview = raw as WorkspaceProposalRepairSuccessorProposalIntakePreview;
				state.previews.set(preview.previewId, preview);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const input =
					raw as WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationInput<TDraft>;
				state.inputs.set(input.preparationId, input);
			}
			for (const input of state.inputs.values()) {
				const preview = state.previews.get(input.previewId);
				let result: WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationResult<TDraft> =
					prepareWorkspaceProposalRepairSuccessorProposalReadyRequest<TDraft>(preview, input);
				const preparedReadyRequest = state.preparedReadyRequests.get(input.preparationId);
				if (preparedReadyRequest !== undefined) {
					const preparedSignature = stableStringify(preparedReadyRequest);
					const resultReadySignature =
						result.readyRequest === undefined ? undefined : stableStringify(result.readyRequest);
					if (resultReadySignature !== preparedSignature) {
						const issue = repairActionIntentIssue(
							"repair-successor-preparation-already-prepared",
							"Repair successor ready-request preparation is immutable after its first prepared ready request.",
							input.intent,
							input.request,
						);
						const { readyRequest: _readyRequest, ...blockedResult } = result;
						result = {
							...blockedResult,
							status: "blocked",
							issues: dedupeRepairActionIssues([...result.issues, issue]),
						};
					}
				} else if (result.readyRequest !== undefined) {
					state.preparedReadyRequests.set(
						input.preparationId,
						immutableClone(result.readyRequest) as WorkspaceProposalReadyRequest<TDraft>,
					);
				}
				const signature = stableStringify(result);
				if (state.emittedResults.get(input.preparationId) === signature) continue;
				state.emittedResults.set(input.preparationId, signature);
				ctx.down([["DATA", { kind: "successor-ready-request-preparation-result", value: result }]]);
				for (const issue of result.issues) {
					ctx.down([["DATA", { kind: "issue", value: issue }]]);
				}
				if (result.readyRequest !== undefined) {
					ctx.down([["DATA", { kind: "successor-ready-request", value: result.readyRequest }]]);
				}
			}
			ctx.state.set(state);
		},
		runtimeOptions(
			name,
			"workspaceProposalRepairSuccessorProposalReadyRequestPreparationProjector",
		),
	);
	return {
		results: project(graph, runtime, `${name}/results`, `${name}Results`, (fact) =>
			fact?.kind === "successor-ready-request-preparation-result" ? fact.value : undefined,
		),
		readyRequests: project(
			graph,
			runtime,
			`${name}/readyRequests`,
			`${name}ReadyRequests`,
			(fact) => (fact?.kind === "successor-ready-request" ? fact.value : undefined),
		),
		issues: project(graph, runtime, `${name}/issues`, `${name}Issues`, (fact) =>
			fact?.kind === "issue" ? fact.value : undefined,
		),
	};
}

interface RepairReviewStatusProjectionContext {
	readonly decisions: readonly WorkspaceProposalRepairReviewDecision[];
	readonly applicationStatuses: readonly WorkspaceProposalApplicationStatus[];
	readonly applicationRecorded: readonly WorkspaceProposalApplicationRecorded[];
	readonly outcomeStatuses: readonly WorkspaceProposalFamilyOutcomeRecordStatus[];
	readonly outcomeIndex: readonly WorkspaceProposalFamilyOutcomeIndexEntry[];
}

interface RepairReviewDurableProof {
	readonly state: "resolved" | "superseded";
	readonly code: string;
	readonly proofKind: Exclude<WorkspaceProposalRepairReviewProofKind, "human-decision">;
	readonly proofRefs: readonly SourceRef[];
	readonly sourceRefs: readonly SourceRef[];
}

function projectWorkspaceProposalRepairReviewStatus(
	request: WorkspaceProposalRepairReviewRequest,
	context: RepairReviewStatusProjectionContext,
): WorkspaceProposalRepairReviewStatus {
	const decisions = dedupeRepairReviewDecisions(
		context.decisions.filter((decision) => repairReviewDecisionMatchesRequest(decision, request)),
	);
	const terminalDecisions = decisions.filter((decision) => decision.intent !== "acknowledged");
	const activeTerminalDecisions = terminalDecisions.filter(
		(decision) =>
			!terminalDecisions.some((candidate) => repairReviewDecisionSupersedes(candidate, decision)),
	);
	if (activeTerminalDecisions.length > 1) {
		const issue = repairReviewStatusIssue(
			request,
			"conflicting-repair-review-decisions",
			"Workspace proposal repair review decisions conflict",
			activeTerminalDecisions,
		);
		return repairReviewStatus(request, "conflict", {
			code: issue.code,
			decisions,
			conflicts: activeTerminalDecisions,
			issues: [issue],
			sourceRefs: uniqueRefs([
				...request.sourceRefs,
				...activeTerminalDecisions.flatMap((decision) => decision.sourceRefs ?? []),
			]),
		});
	}
	const terminalDecision = activeTerminalDecisions[0];
	if (terminalDecision !== undefined) {
		return repairReviewStatus(request, terminalDecision.intent, {
			code: terminalDecision.code ?? terminalDecision.intent,
			proofKind: "human-decision",
			proofRefs: [repairReviewDecisionSourceRef(terminalDecision)],
			decisions,
			sourceRefs: uniqueRefs([...request.sourceRefs, ...(terminalDecision.sourceRefs ?? [])]),
			audit: terminalDecision.audit ?? request.audit,
			metadata: terminalDecision.metadata,
		});
	}
	const durableProof = repairReviewDurableProof(request, context);
	if (durableProof !== undefined) {
		return repairReviewStatus(request, durableProof.state, {
			code: durableProof.code,
			proofKind: durableProof.proofKind,
			proofRefs: durableProof.proofRefs,
			decisions,
			sourceRefs: uniqueRefs([...request.sourceRefs, ...durableProof.sourceRefs]),
		});
	}
	const acknowledgedDecision = decisions.find((decision) => decision.intent === "acknowledged");
	if (acknowledgedDecision !== undefined) {
		return repairReviewStatus(request, "acknowledged", {
			code: acknowledgedDecision.code ?? "acknowledged",
			proofKind: "human-decision",
			proofRefs: [repairReviewDecisionSourceRef(acknowledgedDecision)],
			decisions,
			sourceRefs: uniqueRefs([...request.sourceRefs, ...(acknowledgedDecision.sourceRefs ?? [])]),
			audit: acknowledgedDecision.audit ?? request.audit,
			metadata: acknowledgedDecision.metadata,
		});
	}
	return repairReviewStatus(request, "open", {
		code: "open",
		decisions,
		sourceRefs: request.sourceRefs,
		audit: request.audit,
	});
}

function repairReviewStatus(
	request: WorkspaceProposalRepairReviewRequest,
	state: WorkspaceProposalRepairReviewLifecycleState,
	options: {
		readonly code?: string;
		readonly proofKind?: WorkspaceProposalRepairReviewProofKind;
		readonly proofRefs?: readonly SourceRef[];
		readonly decisions?: readonly WorkspaceProposalRepairReviewDecision[];
		readonly conflicts?: readonly WorkspaceProposalRepairReviewDecision[];
		readonly issues?: readonly WorkspaceProposalRecordedIssue[];
		readonly sourceRefs?: readonly SourceRef[];
		readonly audit?: WorkspaceProposalAuditMaterial;
		readonly metadata?: Record<string, unknown>;
	} = {},
): WorkspaceProposalRepairReviewStatus {
	return {
		kind: "workspace-proposal-repair-review-status",
		repairRequestId: request.repairRequestId,
		applicationId: request.applicationId,
		proposalId: request.proposalId,
		decisionId: request.decisionId,
		idempotencyKey: request.idempotencyKey,
		proposalFamily: request.proposalFamily,
		state,
		code: options.code,
		proofKind: options.proofKind,
		proofRefs: options.proofRefs ?? [],
		decisions: immutableClone(options.decisions ?? []),
		conflicts: immutableClone(options.conflicts ?? []),
		issues: options.issues ?? [],
		sourceRefs: uniqueRefs(options.sourceRefs ?? request.sourceRefs),
		audit: options.audit ?? request.audit,
		metadata: options.metadata,
	};
}

function repairReviewDurableProof(
	request: WorkspaceProposalRepairReviewRequest,
	context: RepairReviewStatusProjectionContext,
): RepairReviewDurableProof | undefined {
	for (const status of context.outcomeStatuses) {
		if (
			status.state === "recorded" &&
			status.outcomeRefs.length > 0 &&
			repairReviewCoordinatesMatch(request, status) &&
			repairRequestAllowsProof(
				request,
				"workspace-proposal-family-outcome-record-status",
				status.outcomeId,
			) &&
			status.outcomeRefs.some((ref) => sameOutcomeRefCoordinates(ref, status))
		) {
			return {
				state: "resolved",
				code: status.code ?? "family-outcome-recorded",
				proofKind: "family-outcome-status",
				proofRefs: [
					{ kind: "workspace-proposal-family-outcome-record-status", id: status.outcomeId },
				],
				sourceRefs: status.sourceRefs,
			};
		}
	}
	for (const entry of context.outcomeIndex) {
		if (
			entry.state === "recorded" &&
			entry.outcomeRefs.length > 0 &&
			repairReviewCoordinatesMatch(request, entry) &&
			repairRequestAllowsProof(
				request,
				"workspace-proposal-family-outcome-index-entry",
				entry.indexKey,
			) &&
			entry.outcomeRefs.some((ref) => sameOutcomeRefCoordinates(ref, entry))
		) {
			return {
				state: "resolved",
				code: "family-outcome-index-recorded",
				proofKind: "family-outcome-index",
				proofRefs: [{ kind: "workspace-proposal-family-outcome-index-entry", id: entry.indexKey }],
				sourceRefs: entry.sourceRefs,
			};
		}
	}
	const applicationStatus = context.applicationStatuses.find((status) =>
		repairReviewCoordinatesMatch(request, status),
	);
	const recorded = context.applicationRecorded.find(
		(record) =>
			applicationStatus !== undefined &&
			applicationRecordedMatchesStatus(record, applicationStatus),
	);
	if (
		recorded !== undefined &&
		applicationStatus !== undefined &&
		applicationRecordedMatchesStatus(recorded, applicationStatus) &&
		repairReviewCoordinatesMatch(request, applicationStatus) &&
		repairRequestAllowsProof(
			request,
			"workspace-proposal-application-status",
			applicationStatus.applicationId,
		) &&
		applicationStatusResolvesRepairReview(applicationStatus)
	) {
		return {
			state: "resolved",
			code: "application-recorded",
			proofKind: "application-recorded",
			proofRefs: [
				{ kind: "workspace-proposal-application-recorded", id: recorded.applicationRecordId },
				{ kind: "workspace-proposal-application-status", id: applicationStatus.applicationId },
			],
			sourceRefs: uniqueRefs([...recorded.sourceRefs, ...applicationStatus.sourceRefs]),
		};
	}
	if (
		applicationStatus !== undefined &&
		repairReviewCoordinatesMatch(request, applicationStatus) &&
		repairRequestAllowsProof(
			request,
			"workspace-proposal-application-status",
			applicationStatus.applicationId,
		) &&
		applicationStatusResolvesRepairReview(applicationStatus)
	) {
		return {
			state: "resolved",
			code: applicationStatus.code ?? "application-status-recorded",
			proofKind: "application-status",
			proofRefs: [
				{ kind: "workspace-proposal-application-status", id: applicationStatus.applicationId },
			],
			sourceRefs: applicationStatus.sourceRefs,
		};
	}
	return undefined;
}

function repairRequestAllowsProof(
	request: WorkspaceProposalRepairReviewRequest,
	kind: string,
	id: string,
): boolean {
	const subjectRefs = request.subjectRefs ?? [];
	const outcomeSubjectRefs = subjectRefs.filter(
		(ref) =>
			ref.kind === "workspace-proposal-family-outcome-record-status" ||
			ref.kind === "workspace-proposal-family-outcome-index-entry",
	);
	return (
		outcomeSubjectRefs.length === 0 ||
		outcomeSubjectRefs.some((ref) => ref.kind === kind && ref.id === id)
	);
}

function applicationStatusResolvesRepairReview(
	status: WorkspaceProposalApplicationStatus,
): boolean {
	return (
		(status.state === "applied" || status.state === "recorded") &&
		status.emittedFactRefs.some((ref) => ref.proposalFamily === status.proposalFamily)
	);
}

function applicationRecordedMatchesStatus(
	recorded: WorkspaceProposalApplicationRecorded,
	status: WorkspaceProposalApplicationStatus,
): boolean {
	return (
		recorded.applicationId === status.applicationId &&
		recorded.proposalId === status.proposalId &&
		recorded.decisionId === status.decisionId &&
		recorded.emittedFactRefs.length > 0 &&
		recorded.emittedFactRefs.every((ref) =>
			status.emittedFactRefs.some(
				(statusRef) =>
					statusRef.proposalFamily === ref.proposalFamily &&
					statusRef.factKind === ref.factKind &&
					statusRef.factId === ref.factId,
			),
		)
	);
}

function repairReviewDecisionMatchesRequest(
	decision: WorkspaceProposalRepairReviewDecision,
	request: WorkspaceProposalRepairReviewRequest,
): boolean {
	return (
		decision.kind === "workspace-proposal-repair-review-decision" &&
		!blank(decision.reviewDecisionId) &&
		decision.repairRequestId === request.repairRequestId &&
		repairReviewCoordinatesMatch(request, decision) &&
		(decision.intent === "acknowledged" ||
			decision.intent === "resolved" ||
			decision.intent === "withdrawn" ||
			decision.intent === "superseded")
	);
}

function repairReviewCoordinatesMatch(
	request: WorkspaceProposalRepairReviewRequest,
	material: {
		readonly applicationId: string;
		readonly proposalId: string;
		readonly decisionId: string;
		readonly idempotencyKey: string;
		readonly proposalFamily: WorkspaceProposalFamily;
	},
): boolean {
	return (
		request.applicationId === material.applicationId &&
		request.proposalId === material.proposalId &&
		request.decisionId === material.decisionId &&
		request.idempotencyKey === material.idempotencyKey &&
		request.proposalFamily === material.proposalFamily
	);
}

function repairReviewDecisionSupersedes(
	candidate: WorkspaceProposalRepairReviewDecision,
	decision: WorkspaceProposalRepairReviewDecision,
): boolean {
	return (candidate.supersedesRefs ?? []).some(
		(ref) =>
			ref.kind === "workspace-proposal-repair-review-decision" &&
			ref.id === decision.reviewDecisionId,
	);
}

function dedupeRepairReviewDecisions(
	decisions: readonly WorkspaceProposalRepairReviewDecision[],
): readonly WorkspaceProposalRepairReviewDecision[] {
	const out = new Map<string, WorkspaceProposalRepairReviewDecision>();
	for (const decision of decisions) out.set(decision.reviewDecisionId, decision);
	return [...out.values()];
}

function repairReviewDecisionSourceRef(decision: WorkspaceProposalRepairReviewDecision): SourceRef {
	return { kind: "workspace-proposal-repair-review-decision", id: decision.reviewDecisionId };
}

function repairReviewStatusIssue(
	request: WorkspaceProposalRepairReviewRequest,
	code: string,
	message: string,
	decisions: readonly WorkspaceProposalRepairReviewDecision[],
): WorkspaceProposalRecordedIssue {
	return {
		kind: "issue",
		source: "workspace-proposal",
		severity: "error",
		code,
		message,
		subjectId: request.proposalId,
		refs: [
			`workspace-proposal-repair-review-request:${request.repairRequestId}`,
			...decisions.map(
				(decision) => `workspace-proposal-repair-review-decision:${decision.reviewDecisionId}`,
			),
		],
		metadata: {
			applicationId: request.applicationId,
			proposalId: request.proposalId,
			decisionId: request.decisionId,
			idempotencyKey: request.idempotencyKey,
			proposalFamily: request.proposalFamily,
		},
	};
}

function repairReviewStatusSignature(status: WorkspaceProposalRepairReviewStatus): string {
	return stableStringify({
		state: status.state,
		code: status.code,
		proofKind: status.proofKind,
		proofRefs: status.proofRefs,
		decisions: status.decisions,
		conflicts: status.conflicts,
		issues: status.issues,
		sourceRefs: status.sourceRefs,
		audit: status.audit,
		metadata: status.metadata,
	});
}

const repairActionKinds = [
	"acknowledge-review",
	"withdraw-review",
	"mark-human-resolved",
	"supersede-review",
	"open-successor-proposal-flow",
] as const satisfies readonly WorkspaceProposalRepairActionKind[];

function repairActionDescriptor(
	request: WorkspaceProposalRepairReviewRequest,
	status: WorkspaceProposalRepairReviewStatus | undefined,
	actionKind: WorkspaceProposalRepairActionKind,
	state: WorkspaceProposalRepairReviewLifecycleState,
): WorkspaceProposalRepairActionDescriptor {
	const disabledCode = repairActionDisabledCode(actionKind, state);
	const repairStatusRef =
		status === undefined
			? undefined
			: { kind: "workspace-proposal-repair-review-status", id: status.repairRequestId };
	const audit = repairActionDescriptorAudit(status?.audit ?? request.audit);
	return {
		kind: "workspace-proposal-repair-action-descriptor",
		descriptorId: `workspace-proposal-repair-action-descriptor:${stableStringify({
			repairRequestId: request.repairRequestId,
			actionKind,
		})}`,
		repairRequestId: request.repairRequestId,
		repairState: state,
		...(repairStatusRef === undefined ? {} : { repairStatusRef }),
		actionKind,
		enabled: disabledCode === undefined,
		...(disabledCode === undefined ? {} : { disabledCode }),
		applicationId: request.applicationId,
		proposalId: request.proposalId,
		decisionId: request.decisionId,
		idempotencyKey: request.idempotencyKey,
		proposalFamily: request.proposalFamily,
		sourceRefs: repairActionDescriptorSourceRefs([
			...request.sourceRefs,
			...(status?.sourceRefs ?? []),
			...(repairStatusRef === undefined ? [] : [repairStatusRef]),
		]),
		...(audit === undefined ? {} : { audit }),
		metadata: {
			repairRequestId: request.repairRequestId,
			repairState: state,
			route: repairActionRoute(actionKind),
		},
	};
}

function matchingRepairReviewStatus(
	request: WorkspaceProposalRepairReviewRequest,
	statuses: readonly WorkspaceProposalRepairReviewStatus[],
): WorkspaceProposalRepairReviewStatus | undefined {
	for (let index = statuses.length - 1; index >= 0; index -= 1) {
		const status = statuses[index];
		if (
			status !== undefined &&
			status.repairRequestId === request.repairRequestId &&
			repairReviewCoordinatesMatch(request, status)
		) {
			return status;
		}
	}
	return undefined;
}

function repairActionDescriptorSourceRefs(values: readonly SourceRef[]): readonly SourceRef[] {
	return uniqueRefs(
		values.filter(
			(value) =>
				isSourceRef(value) &&
				workspaceProposalDataOnlyIssues(value, "repairActionDescriptorSourceRef").length === 0,
		),
	);
}

function repairActionDescriptorAudit(
	audit: WorkspaceProposalAuditMaterial | undefined,
): WorkspaceProposalAuditMaterial | undefined {
	if (!isWorkspaceProposalAuditMaterial(audit)) return undefined;
	const sourceRefs = repairActionDescriptorSourceRefs(audit.sourceRefs ?? []);
	const { sourceRefs: _sourceRefs, ...rest } = audit;
	return sourceRefs.length === 0 ? rest : { ...rest, sourceRefs };
}

function repairActionDisabledCode(
	actionKind: WorkspaceProposalRepairActionKind,
	state: WorkspaceProposalRepairReviewLifecycleState,
): WorkspaceProposalRepairActionDescriptorDisabledCode | undefined {
	if (state === "conflict") return "repair-review-conflict";
	if (state === "resolved" || state === "withdrawn" || state === "superseded") {
		return "repair-review-terminal";
	}
	if (state === "acknowledged" && actionKind === "acknowledge-review") {
		return "repair-review-already-acknowledged";
	}
	return undefined;
}

function repairActionRoute(
	actionKind: WorkspaceProposalRepairActionKind,
): "repair-review-decision-intake" | "successor-proposal-intake-preview" {
	return actionKind === "open-successor-proposal-flow"
		? "successor-proposal-intake-preview"
		: "repair-review-decision-intake";
}

function repairActionDecisionIntent(
	actionKind: WorkspaceProposalRepairActionKind,
): WorkspaceProposalRepairReviewDecisionIntent | undefined {
	switch (actionKind) {
		case "acknowledge-review":
			return "acknowledged";
		case "withdraw-review":
			return "withdrawn";
		case "mark-human-resolved":
			return "resolved";
		case "supersede-review":
			return "superseded";
		case "open-successor-proposal-flow":
			return undefined;
	}
}

function repairActionIntentIssues(
	intent: WorkspaceProposalRepairActionIntent | unknown,
	options: WorkspaceProposalRepairActionIntentValidationOptions,
): readonly WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	const request = options.request;
	const descriptor = options.descriptor;
	const currentStatus = options.currentStatus;
	if (!isRepairActionIntentMaterial(intent)) {
		return [
			repairActionIntentIssue(
				"malformed-repair-action-intent",
				"Repair action intent requires typed data-only material.",
				intent,
				request,
			),
		];
	}
	const actionIntent = intent;
	for (const [label, value] of [
		["repairActionIntent", actionIntent],
		["repairActionDescriptor", descriptor],
		["repairReviewRequest", request],
		["repairReviewStatus", currentStatus],
		["repairActionIntentValidationOptions", options],
	] as const) {
		if (value === undefined) continue;
		for (const issue of workspaceProposalDataOnlyIssues(value, label)) {
			issues.push(repairActionIssueFromDataOnly(issue, actionIntent, request));
		}
	}
	for (const [field, value] of [
		["intentId", actionIntent.intentId],
		["descriptorId", actionIntent.descriptorId],
		["repairRequestId", actionIntent.repairRequestId],
		["applicationId", actionIntent.applicationId],
		["proposalId", actionIntent.proposalId],
		["decisionId", actionIntent.decisionId],
		["idempotencyKey", actionIntent.idempotencyKey],
		["proposalFamily", actionIntent.proposalFamily],
	] as const) {
		if (blank(value)) {
			issues.push(
				repairActionIntentIssue(
					"malformed-repair-action-intent",
					`Repair action intent requires ${field}.`,
					intent,
					request,
				),
			);
		}
	}
	if (!repairActionKinds.includes(actionIntent.actionKind)) {
		issues.push(
			repairActionIntentIssue(
				"unsupported-repair-action-intent",
				"Repair action intent requires a supported actionKind.",
				intent,
				request,
			),
		);
	}
	if (request === undefined) {
		issues.push(
			repairActionIntentIssue(
				"missing-repair-review-request",
				"Repair action intent requires a matching repair-review request.",
				intent,
				request,
			),
		);
	} else if (!isRepairReviewRequestMaterial(request)) {
		issues.push(
			repairActionIntentIssue(
				"malformed-repair-review-request",
				"Repair action intent requires typed repair-review request material.",
				intent,
				request,
			),
		);
	} else if (
		actionIntent.repairRequestId !== request.repairRequestId ||
		!repairReviewCoordinatesMatch(request, actionIntent)
	) {
		issues.push(
			repairActionIntentIssue(
				"repair-action-intent-coordinate-mismatch",
				"Repair action intent coordinates must match the repair-review request.",
				intent,
				request,
			),
		);
	}
	if (descriptor === undefined) {
		issues.push(
			repairActionIntentIssue(
				"missing-repair-action-descriptor",
				"Repair action intent requires matching repair action descriptor material.",
				intent,
				request,
			),
		);
	} else if (!isRepairActionDescriptorMaterial(descriptor)) {
		issues.push(
			repairActionIntentIssue(
				"malformed-repair-action-descriptor",
				"Repair action intent requires typed repair action descriptor material.",
				intent,
				request,
			),
		);
	} else {
		if (
			actionIntent.descriptorId !== descriptor.descriptorId ||
			actionIntent.repairRequestId !== descriptor.repairRequestId ||
			actionIntent.actionKind !== descriptor.actionKind ||
			!coordinatesMatchExact(actionIntent, descriptor)
		) {
			issues.push(
				repairActionIntentIssue(
					"repair-action-intent-descriptor-mismatch",
					"Repair action intent must match descriptor id, request, action, and coordinates.",
					intent,
					request,
				),
			);
		}
		if (!descriptor.enabled) {
			issues.push(
				repairActionIntentIssue(
					"repair-action-lifecycle-disabled",
					"Repair action descriptor is disabled by lifecycle state.",
					intent,
					request,
				),
			);
		}
	}
	const expectedCurrentState: WorkspaceProposalRepairReviewExpectedCurrentState | undefined =
		options.expectedCurrentState ?? actionIntent.expectedCurrentState;
	if (currentStatus !== undefined) {
		if (request === undefined || !repairReviewCoordinatesMatch(request, currentStatus)) {
			issues.push(
				repairActionIntentIssue(
					"current-status-coordinate-mismatch",
					"Repair action current status guard must match the repair-review request.",
					intent,
					request,
				),
			);
		} else if (
			expectedCurrentState !== undefined &&
			!repairReviewExpectedStateMatchesStatus(expectedCurrentState, currentStatus)
		) {
			issues.push(
				repairActionIntentIssue(
					"stale-repair-review-state",
					"Repair action current status no longer matches the expected guard state.",
					intent,
					request,
				),
			);
		}
	} else if (expectedCurrentState !== undefined) {
		issues.push(
			repairActionIntentIssue(
				"stale-repair-review-state",
				"Repair action expected current state guard requires current status material.",
				intent,
				request,
			),
		);
	}
	if (actionIntent.reviewerRef === undefined && actionIntent.actorRef === undefined) {
		issues.push(
			repairActionIntentIssue(
				"missing-repair-action-authority-material",
				"Repair action intent requires reviewer or actor ref material.",
				intent,
				request,
			),
		);
	}
	if (
		(options.capabilityRefs !== undefined &&
			(!Array.isArray(options.capabilityRefs) || options.capabilityRefs.length === 0)) ||
		(options.policyRefs !== undefined &&
			(!Array.isArray(options.policyRefs) || options.policyRefs.length === 0))
	) {
		issues.push(
			repairActionIntentIssue(
				"missing-repair-action-policy-material",
				"Repair action intent validation requires non-empty supplied capability or policy refs when present.",
				intent,
				request,
			),
		);
	}
	if (options.capabilityRefs === undefined && options.policyRefs === undefined) {
		issues.push(
			repairActionIntentIssue(
				"missing-repair-action-policy-material",
				"Repair action intent validation requires explicit intake policy or capability material.",
				intent,
				request,
			),
		);
	}
	for (const [field, refs] of [
		["capabilityRefs", actionIntent.capabilityRefs],
		["policyRefs", actionIntent.policyRefs],
		["sourceRefs", actionIntent.sourceRefs],
		["validationCapabilityRefs", options.capabilityRefs],
		["validationPolicyRefs", options.policyRefs],
		["validationSourceRefs", options.sourceRefs],
	] as const) {
		if (refs !== undefined && !repairReviewDecisionSourceRefsAreValid(refs)) {
			issues.push(
				repairActionIntentIssue(
					"malformed-ref",
					`Repair action intent ${field} must be a dense array of data-only refs.`,
					intent,
					request,
				),
			);
		}
	}
	for (const [field, value] of [
		["reviewerRef", actionIntent.reviewerRef],
		["actorRef", actionIntent.actorRef],
	] as const) {
		if (value !== undefined && !repairReviewDecisionSourceRefIsValid(value)) {
			issues.push(
				repairActionIntentIssue(
					"malformed-ref",
					`Repair action intent ${field} must be a data-only ref.`,
					intent,
					request,
				),
			);
		}
	}
	if (actionIntent.audit !== undefined && !isWorkspaceProposalAuditMaterial(actionIntent.audit)) {
		issues.push(
			repairActionIntentIssue(
				"malformed-audit",
				"Repair action intent audit material must be data-only audit material.",
				intent,
				request,
			),
		);
	}
	if (actionIntent.metadata !== undefined && !isRecord(actionIntent.metadata)) {
		issues.push(
			repairActionIntentIssue(
				"malformed-metadata",
				"Repair action intent metadata must be bounded object material.",
				intent,
				request,
			),
		);
	}
	if (options.policyStatus !== undefined && options.policyStatus !== "allowed") {
		issues.push(
			repairActionIntentIssue(
				options.policyStatus === "blocked"
					? "blocked-repair-action-policy"
					: "missing-repair-action-policy",
				"Repair action policy/capability validation failed closed at intake.",
				intent,
				request,
			),
		);
	}
	issues.push(
		...(options.policyIssues ?? []).map((issue) =>
			repairActionIssueFromDataOnly(issue, actionIntent, request),
		),
	);
	return dedupeRepairActionIssues(issues);
}

function repairActionSourceRefs(values: readonly SourceRef[]): readonly SourceRef[] {
	return immutableClone(
		uniqueRefs(
			values.filter(
				(ref) =>
					repairReviewDecisionSourceRefIsValid(ref) && workspaceProposalBoundaryRefIsSafe(ref),
			),
		),
	);
}

function repairActionValidationOptions(
	optionsOrDescriptor:
		| WorkspaceProposalRepairActionIntentValidationOptions
		| WorkspaceProposalRepairActionDescriptor
		| undefined,
	request: WorkspaceProposalRepairReviewRequest | undefined,
	currentStatus: WorkspaceProposalRepairReviewStatus | undefined,
): WorkspaceProposalRepairActionIntentValidationOptions {
	if (optionsOrDescriptor === undefined || isRepairActionDescriptorMaterial(optionsOrDescriptor)) {
		return { descriptor: optionsOrDescriptor, request, currentStatus };
	}
	return optionsOrDescriptor;
}

function isRepairActionIntentMaterial(
	value: unknown,
): value is WorkspaceProposalRepairActionIntent {
	return isRecord(value) && value.kind === "workspace-proposal-repair-action-intent";
}

function isRepairActionDescriptorMaterial(
	value: unknown,
): value is WorkspaceProposalRepairActionDescriptor {
	return (
		isRecord(value) &&
		value.kind === "workspace-proposal-repair-action-descriptor" &&
		nonBlankString(value.descriptorId) &&
		nonBlankString(value.repairRequestId) &&
		repairActionKinds.includes(value.actionKind as WorkspaceProposalRepairActionKind) &&
		typeof value.enabled === "boolean" &&
		nonBlankString(value.applicationId) &&
		nonBlankString(value.proposalId) &&
		nonBlankString(value.decisionId) &&
		nonBlankString(value.idempotencyKey) &&
		nonBlankString(value.proposalFamily)
	);
}

function isRepairReviewRequestMaterial(
	value: unknown,
): value is WorkspaceProposalRepairReviewRequest {
	return (
		isRecord(value) &&
		value.kind === "workspace-proposal-repair-review-request" &&
		nonBlankString(value.repairRequestId) &&
		nonBlankString(value.applicationId) &&
		nonBlankString(value.proposalId) &&
		nonBlankString(value.decisionId) &&
		nonBlankString(value.idempotencyKey) &&
		nonBlankString(value.proposalFamily)
	);
}

function isRepairActionIntentValidationResultMaterial(
	value: unknown,
): value is WorkspaceProposalRepairActionIntentValidationResult {
	return (
		isRecord(value) &&
		value.kind === "workspace-proposal-repair-action-intent-validation-result" &&
		(value.status === "accepted" || value.status === "blocked") &&
		(value.intentId === undefined || nonBlankString(value.intentId)) &&
		(value.descriptorId === undefined || nonBlankString(value.descriptorId)) &&
		(value.repairRequestId === undefined || nonBlankString(value.repairRequestId)) &&
		(value.actionKind === undefined ||
			repairActionKinds.includes(value.actionKind as WorkspaceProposalRepairActionKind)) &&
		(value.applicationId === undefined || nonBlankString(value.applicationId)) &&
		(value.proposalId === undefined || nonBlankString(value.proposalId)) &&
		(value.decisionId === undefined || nonBlankString(value.decisionId)) &&
		(value.idempotencyKey === undefined || nonBlankString(value.idempotencyKey)) &&
		(value.proposalFamily === undefined || nonBlankString(value.proposalFamily)) &&
		Array.isArray(value.issues) &&
		nonEmptySourceRefs(value.sourceRefs) &&
		workspaceProposalBoundarySourceRefsAreSafe(value.sourceRefs) &&
		(value.audit === undefined ||
			(isWorkspaceProposalAuditMaterial(value.audit) &&
				workspaceProposalBoundarySourceRefsAreSafe(value.audit.sourceRefs))) &&
		(value.intent === undefined || isRepairActionIntentMaterial(value.intent))
	);
}

const repairActionDisplayPolicyAssessments = [
	"not-evaluated",
	"no-known-blocker",
	"known-blocker",
	"needs-review",
	"unknown",
] as const satisfies readonly WorkspaceProposalRepairActionDisplayPolicyAssessment[];

function isRepairActionDisplayPolicyAdvisoryMaterial(
	value: unknown,
): value is WorkspaceProposalRepairActionDisplayPolicyAdvisory {
	if (!isRecord(value)) return false;
	return (
		value.kind === "workspace-proposal-repair-action-display-policy-advisory" &&
		value.authority === "display-only-advisory" &&
		nonBlankString(value.descriptorId) &&
		nonBlankString(value.repairRequestId) &&
		repairActionKinds.includes(value.actionKind as WorkspaceProposalRepairActionKind) &&
		nonBlankString(value.applicationId) &&
		nonBlankString(value.proposalId) &&
		nonBlankString(value.decisionId) &&
		nonBlankString(value.idempotencyKey) &&
		nonBlankString(value.proposalFamily) &&
		repairActionDisplayPolicyAssessments.includes(
			value.displayAssessment as WorkspaceProposalRepairActionDisplayPolicyAssessment,
		) &&
		(value.policyEvidenceRefs === undefined ||
			(nonEmptySourceRefs(value.policyEvidenceRefs) &&
				workspaceProposalBoundarySourceRefsAreSafe(value.policyEvidenceRefs))) &&
		(value.capabilityEvidenceRefs === undefined ||
			(nonEmptySourceRefs(value.capabilityEvidenceRefs) &&
				workspaceProposalBoundarySourceRefsAreSafe(value.capabilityEvidenceRefs))) &&
		(value.sourceRefs === undefined ||
			(nonEmptySourceRefs(value.sourceRefs) &&
				workspaceProposalBoundarySourceRefsAreSafe(value.sourceRefs))) &&
		(value.audit === undefined ||
			(isWorkspaceProposalAuditMaterial(value.audit) &&
				workspaceProposalBoundarySourceRefsAreSafe(value.audit.sourceRefs))) &&
		(value.advisoryIssues === undefined ||
			(Array.isArray(value.advisoryIssues) &&
				value.advisoryIssues.length <= 25 &&
				value.advisoryIssues.every(isRepairActionDisplayAdvisoryIssue))) &&
		(value.displayCode === undefined || typeof value.displayCode === "string") &&
		(value.displayMessage === undefined || typeof value.displayMessage === "string")
	);
}

function isRepairActionDisplayAdvisoryIssue(
	value: unknown,
): value is WorkspaceProposalRepairActionDisplayPolicyAdvisoryIssue {
	return (
		isRecord(value) &&
		nonBlankString(value.kind) &&
		typeof value.message === "string" &&
		(value.severity === undefined ||
			value.severity === "info" ||
			value.severity === "warning" ||
			value.severity === "error") &&
		(value.ref === undefined ||
			(isSourceRef(value.ref) && workspaceProposalBoundaryRefIsSafe(value.ref))) &&
		(value.metadata === undefined || isRecord(value.metadata))
	);
}

function repairActionAdvisoryHasPermissionProofMaterial(value: unknown): boolean {
	const forbidden = new Set(["allowed", "permitted", "authorized", "cansubmit"]);
	const seen = new WeakSet<object>();
	const visit = (entry: unknown): boolean => {
		if (typeof entry === "string") {
			const normalized = entry.toLowerCase().replace(/[-_\s]/g, "");
			return [...forbidden].some((token) => normalized.includes(token));
		}
		if (Array.isArray(entry)) return entry.some(visit);
		if (!isRecord(entry)) return false;
		if (seen.has(entry)) return false;
		seen.add(entry);
		for (const [key, child] of Object.entries(entry)) {
			const normalized = key.toLowerCase().replace(/[-_\s]/g, "");
			if (forbidden.has(normalized)) return true;
			if (visit(child)) return true;
		}
		return false;
	};
	return visit(value);
}

const workspaceProposalBoundaryRefForbiddenTokens = new Set([
	"adapter",
	"callback",
	"client",
	"credential",
	"credentials",
	"cursor",
	"file",
	"handle",
	"network",
	"provider",
	"query",
	"runtime",
	"secret",
	"storage",
]);

function workspaceProposalBoundaryTextHasForbiddenToken(text: string): boolean {
	const tokens = text
		.replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/u)
		.filter((token) => token.length > 0);
	return tokens.some((token) => workspaceProposalBoundaryRefForbiddenTokens.has(token));
}

function workspaceProposalBoundaryRefIsSafe(ref: SourceRef | WorkspaceProposalTargetRef): boolean {
	return (
		!workspaceProposalBoundaryTextHasForbiddenToken(ref.kind) &&
		!workspaceProposalBoundaryTextHasForbiddenToken(ref.id)
	);
}

function workspaceProposalBoundarySourceRefsAreSafe(
	value: readonly SourceRef[] | undefined,
): boolean {
	return value === undefined || value.every(workspaceProposalBoundaryRefIsSafe);
}

function safeBoundarySourceRefs(value: unknown): readonly SourceRef[] {
	if (!Array.isArray(value)) return [];
	return repairActionSourceRefs(
		value.filter(
			(ref): ref is SourceRef => isSourceRef(ref) && workspaceProposalBoundaryRefIsSafe(ref),
		),
	);
}

function workspaceProposalBoundaryMetadataSize(value: Record<string, unknown>): number {
	try {
		return new TextEncoder().encode(stableStringify(value)).byteLength;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

const workspaceProposalRepairAdvisoryMetadataMaxBytes = 4096;

function safeAdvisoryText(value: string | undefined): string | undefined {
	if (value === undefined || repairActionAdvisoryHasPermissionProofMaterial(value))
		return undefined;
	return value;
}

function safeAdvisorySourceRefs(value: readonly SourceRef[] | undefined): readonly SourceRef[] {
	if (value === undefined) return [];
	return repairActionSourceRefs(
		value.filter(
			(ref) =>
				isSourceRef(ref) &&
				workspaceProposalBoundaryRefIsSafe(ref) &&
				!repairActionAdvisoryHasPermissionProofMaterial(ref),
		),
	);
}

function safeAdvisoryIssues(
	value: readonly WorkspaceProposalRepairActionDisplayPolicyAdvisoryIssue[] | undefined,
): readonly WorkspaceProposalRepairActionDisplayPolicyAdvisoryIssue[] {
	if (value === undefined) return [];
	return immutableClone(
		value.filter(
			(issue) =>
				isRepairActionDisplayAdvisoryIssue(issue) &&
				workspaceProposalDataOnlyIssues(issue, "repairActionDisplayPolicyAdvisoryIssue").length ===
					0 &&
				!repairActionAdvisoryHasPermissionProofMaterial(issue),
		),
	);
}

function safeAdvisoryAudit(
	value: WorkspaceProposalAuditMaterial | undefined,
): WorkspaceProposalAuditMaterial | undefined {
	const audit = safeWorkspaceProposalAudit(value);
	if (
		audit === undefined ||
		repairActionAdvisoryHasPermissionProofMaterial(audit) ||
		!workspaceProposalBoundarySourceRefsAreSafe(audit.sourceRefs)
	) {
		return undefined;
	}
	return audit;
}

function safeAdvisoryMetadata(
	value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (
		value === undefined ||
		workspaceProposalDataOnlyIssues(value, "repairActionDisplayPolicyAdvisoryMetadata").length >
			0 ||
		repairActionAdvisoryHasPermissionProofMaterial(value) ||
		workspaceProposalBoundaryMetadataSize(value) > workspaceProposalRepairAdvisoryMetadataMaxBytes
	) {
		return undefined;
	}
	return immutableClone(value);
}

function repairActionCoordinatesMatchDescriptor(
	material: {
		readonly applicationId: string;
		readonly proposalId: string;
		readonly decisionId: string;
		readonly idempotencyKey: string;
		readonly proposalFamily: WorkspaceProposalFamily;
	},
	descriptor: WorkspaceProposalRepairActionDescriptor,
): boolean {
	return (
		material.applicationId === descriptor.applicationId &&
		material.proposalId === descriptor.proposalId &&
		material.decisionId === descriptor.decisionId &&
		material.idempotencyKey === descriptor.idempotencyKey &&
		material.proposalFamily === descriptor.proposalFamily
	);
}

function isRepairSuccessorPreviewMaterial(
	value: unknown,
): value is WorkspaceProposalRepairSuccessorProposalIntakePreview {
	return (
		isRecord(value) &&
		value.kind === "workspace-proposal-repair-successor-proposal-intake-preview" &&
		nonBlankString(value.previewId) &&
		(value.status === "proposal-context-ready" || value.status === "blocked") &&
		nonBlankString(value.intentId) &&
		nonBlankString(value.descriptorId) &&
		nonBlankString(value.repairRequestId) &&
		value.actionKind === "open-successor-proposal-flow" &&
		nonBlankString(value.applicationId) &&
		nonBlankString(value.proposalId) &&
		nonBlankString(value.decisionId) &&
		nonBlankString(value.idempotencyKey) &&
		nonBlankString(value.proposalFamily) &&
		nonEmptySourceRefs(value.targetRefs) &&
		workspaceProposalBoundarySourceRefsAreSafe(value.targetRefs) &&
		nonEmptySourceRefs(value.contextRefs) &&
		workspaceProposalBoundarySourceRefsAreSafe(value.contextRefs) &&
		Array.isArray(value.diagnostics) &&
		nonEmptySourceRefs(value.sourceRefs) &&
		workspaceProposalBoundarySourceRefsAreSafe(value.sourceRefs) &&
		(value.audit === undefined ||
			(isWorkspaceProposalAuditMaterial(value.audit) &&
				workspaceProposalBoundarySourceRefsAreSafe(value.audit.sourceRefs)))
	);
}

function isRepairSuccessorReadyRequestPreparationInput<TDraft>(
	value: unknown,
): value is WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationInput<TDraft> {
	if (!isRecord(value)) return false;
	return (
		value.kind === "workspace-proposal-repair-successor-proposal-ready-request-preparation-input" &&
		nonBlankString(value.preparationId) &&
		nonBlankString(value.previewId) &&
		isRepairActionIntentMaterial(value.intent) &&
		isRepairActionDescriptorMaterial(value.descriptor) &&
		isRepairReviewRequestMaterial(value.request) &&
		isRepairActionIntentValidationResultMaterial(value.intentValidation) &&
		(value.currentStatus === undefined || isRepairReviewStatusMaterial(value.currentStatus)) &&
		nonBlankString(value.successorProposalId) &&
		nonBlankString(value.intakeRequestId) &&
		nonBlankString(value.successorIdempotencyKey) &&
		nonBlankString(value.workspaceId) &&
		isSourceRef(value.actorRef) &&
		workspaceProposalBoundaryRefIsSafe(value.actorRef) &&
		nonEmptySourceRefs(value.capabilityRefs) &&
		workspaceProposalBoundarySourceRefsAreSafe(value.capabilityRefs) &&
		nonEmptySourceRefs(value.policyRefs) &&
		workspaceProposalBoundarySourceRefsAreSafe(value.policyRefs) &&
		nonEmptySourceRefs(value.projectionBundleRefs) &&
		workspaceProposalBoundarySourceRefsAreSafe(value.projectionBundleRefs) &&
		(value.sourceRefs === undefined ||
			(nonEmptySourceRefs(value.sourceRefs) &&
				workspaceProposalBoundarySourceRefsAreSafe(value.sourceRefs))) &&
		isWorkspaceProposalAuditMaterial(value.audit) &&
		workspaceProposalBoundarySourceRefsAreSafe(value.audit.sourceRefs) &&
		workspaceProposalTargetRefsAreValid(value.targetRefs) &&
		nonBlankString(value.successorProposalFamily) &&
		nonBlankString(value.successorLoweringKind) &&
		(value.draftRefs === undefined ||
			(nonEmptySourceRefs(value.draftRefs) &&
				workspaceProposalBoundarySourceRefsAreSafe(value.draftRefs))) &&
		(value.finalDraftSourceRefs === undefined ||
			(nonEmptySourceRefs(value.finalDraftSourceRefs) &&
				workspaceProposalBoundarySourceRefsAreSafe(value.finalDraftSourceRefs))) &&
		(value.metadata === undefined || isRecord(value.metadata))
	);
}

function repairSuccessorPreparationMetadataHasTruthMaterial(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const forbidden = new Set([
		"admissionid",
		"applicationstate",
		"applicationstatus",
		"emittedfactrefs",
		"proposalrecorded",
		"recordedproposal",
		"successoradmissionid",
		"workspaceproposalrecorded",
	]);
	const seen = new WeakSet<object>();
	const visit = (entry: unknown): boolean => {
		if (Array.isArray(entry)) return entry.some(visit);
		if (!isRecord(entry)) return false;
		if (seen.has(entry)) return false;
		seen.add(entry);
		for (const [key, child] of Object.entries(entry)) {
			if (forbidden.has(key.toLowerCase().replace(/[-_\s]/g, ""))) return true;
			if (visit(child)) return true;
		}
		return false;
	};
	return visit(value);
}

function repairActionPreviewCoordinatesMatchInput<TDraft>(
	preview: WorkspaceProposalRepairSuccessorProposalIntakePreview,
	input: WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationInput<TDraft>,
): boolean {
	return (
		preview.applicationId === input.intent.applicationId &&
		preview.proposalId === input.intent.proposalId &&
		preview.decisionId === input.intent.decisionId &&
		preview.idempotencyKey === input.intent.idempotencyKey &&
		preview.proposalFamily === input.intent.proposalFamily &&
		repairReviewCoordinatesMatch(input.request, input.intent) &&
		repairActionCoordinatesMatchDescriptor(input.intent, input.descriptor)
	);
}

function repairActionIntentValidationMatchesPreparationInput<TDraft>(
	validation: WorkspaceProposalRepairActionIntentValidationResult,
	input: WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationInput<TDraft>,
): boolean {
	return (
		validation.intentId === input.intent.intentId &&
		validation.descriptorId === input.descriptor.descriptorId &&
		validation.repairRequestId === input.request.repairRequestId &&
		validation.actionKind === input.intent.actionKind &&
		validation.applicationId === input.request.applicationId &&
		validation.proposalId === input.request.proposalId &&
		validation.decisionId === input.request.decisionId &&
		validation.idempotencyKey === input.request.idempotencyKey &&
		validation.proposalFamily === input.request.proposalFamily &&
		(validation.intent === undefined ||
			stableStringify(validation.intent) === stableStringify(input.intent))
	);
}

function nonEmptySourceRefs(value: unknown): value is readonly SourceRef[] {
	return Array.isArray(value) && value.length > 0 && value.every(isSourceRef);
}

function workspaceProposalTargetRefsAreValid(
	value: unknown,
): value is readonly WorkspaceProposalTargetRef[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every(
			(ref) =>
				isRecord(ref) &&
				nonBlankString(ref.kind) &&
				nonBlankString(ref.id) &&
				workspaceProposalBoundaryRefIsSafe(ref as unknown as WorkspaceProposalTargetRef) &&
				workspaceProposalDataOnlyIssues(ref, "repairSuccessorTargetRef").length === 0,
		)
	);
}

function repairActionIssueIntentFallback(value: unknown): WorkspaceProposalRepairActionIntent {
	if (isRepairSuccessorReadyRequestPreparationInput(value)) return value.intent;
	if (isRepairActionIntentMaterial(value)) return value;
	return {
		kind: "workspace-proposal-repair-action-intent",
		intentId: stringField(isRecord(value) ? value.intentId : undefined) ?? "unknown",
		descriptorId: stringField(isRecord(value) ? value.descriptorId : undefined) ?? "unknown",
		repairRequestId: stringField(isRecord(value) ? value.repairRequestId : undefined) ?? "unknown",
		actionKind: "open-successor-proposal-flow",
		applicationId: stringField(isRecord(value) ? value.applicationId : undefined) ?? "unknown",
		proposalId: stringField(isRecord(value) ? value.proposalId : undefined) ?? "unknown",
		decisionId: stringField(isRecord(value) ? value.decisionId : undefined) ?? "unknown",
		idempotencyKey: stringField(isRecord(value) ? value.idempotencyKey : undefined) ?? "unknown",
		proposalFamily:
			(stringField(
				isRecord(value) ? value.proposalFamily : undefined,
			) as WorkspaceProposalFamily) ?? "unknown",
	};
}

function isOutcomeDetailSupplyRequestMaterial(
	value: unknown,
): value is WorkspaceProposalFamilyOutcomeDetailSupplyRequest {
	return (
		isRecord(value) &&
		value.kind === "workspace-proposal-family-outcome-detail-supply-request" &&
		nonBlankString(value.supplyRequestId) &&
		nonBlankString(value.applicationId) &&
		nonBlankString(value.proposalId) &&
		nonBlankString(value.decisionId) &&
		nonBlankString(value.idempotencyKey) &&
		nonBlankString(value.proposalFamily) &&
		Array.isArray(value.requestedOutcomeRefs) &&
		value.requestedOutcomeRefs.length > 0 &&
		value.requestedOutcomeRefs.every(isOutcomeDetailSupplyRequestedRefMaterial) &&
		repairReviewDecisionSourceRefsAreValid(value.sourceRefs) &&
		workspaceProposalBoundarySourceRefsAreSafe(value.sourceRefs) &&
		(value.audit === undefined ||
			(isWorkspaceProposalAuditMaterial(value.audit) &&
				workspaceProposalBoundarySourceRefsAreSafe(value.audit.sourceRefs))) &&
		(value.metadata === undefined || isRecord(value.metadata))
	);
}

function isOutcomeDetailSupplyRequestedRefMaterial(
	value: unknown,
): value is WorkspaceProposalFamilyOutcomeRef {
	return (
		isRecord(value) &&
		value.kind === "workspace-proposal-family-outcome-ref" &&
		nonBlankString(value.outcomeId) &&
		workspaceProposalFamilyOutcomeKinds.includes(
			value.outcomeKind as WorkspaceProposalFamilyOutcomeRecord["kind"],
		) &&
		nonBlankString(value.applicationId) &&
		nonBlankString(value.proposalId) &&
		nonBlankString(value.decisionId) &&
		nonBlankString(value.idempotencyKey) &&
		nonBlankString(value.proposalFamily) &&
		(value.sourceRefs === undefined ||
			(repairReviewDecisionSourceRefsAreValid(value.sourceRefs) &&
				workspaceProposalBoundarySourceRefsAreSafe(value.sourceRefs)))
	);
}

function outcomeDetailSupplyRequestIssues(
	request: WorkspaceProposalFamilyOutcomeDetailSupplyRequest | unknown,
): readonly WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	const record = isRecord(request) ? request : {};
	for (const issue of workspaceProposalDataOnlyIssues(request, "outcomeDetailSupplyRequest")) {
		issues.push({ ...issue, subjectId: issue.subjectId ?? stringField(record.proposalId) });
	}
	if (!isRecord(request)) {
		issues.push(
			repairActionIntentIssue(
				"malformed-outcome-detail-supply-request",
				"Outcome detail supply request requires typed object material.",
				{},
				undefined,
			),
		);
		return issues;
	}
	for (const field of [
		"supplyRequestId",
		"applicationId",
		"proposalId",
		"decisionId",
		"idempotencyKey",
		"proposalFamily",
	] as const) {
		if (blank(record[field])) {
			issues.push(
				repairActionIntentIssue(
					"malformed-outcome-detail-supply-request",
					`Outcome detail supply request requires ${field}.`,
					{ proposalId: record.proposalId },
					undefined,
				),
			);
		}
	}
	if (!Array.isArray(record.requestedOutcomeRefs) || record.requestedOutcomeRefs.length === 0) {
		issues.push(
			repairActionIntentIssue(
				"malformed-outcome-detail-supply-request",
				"Outcome detail supply request requires requested outcome refs.",
				{ proposalId: record.proposalId },
				undefined,
			),
		);
	} else if (!record.requestedOutcomeRefs.every(isOutcomeDetailSupplyRequestedRefMaterial)) {
		issues.push(
			repairActionIntentIssue(
				"malformed-outcome-detail-supply-request",
				"Outcome detail supply request refs must carry full thin outcome coordinates.",
				{ proposalId: record.proposalId },
				undefined,
			),
		);
	}
	if (
		!repairReviewDecisionSourceRefsAreValid(record.sourceRefs) ||
		!workspaceProposalBoundarySourceRefsAreSafe(
			record.sourceRefs as readonly SourceRef[] | undefined,
		)
	) {
		issues.push(
			repairActionIntentIssue(
				"malformed-outcome-detail-supply-request",
				"Outcome detail supply request requires data-only boundary-safe source refs.",
				{ proposalId: record.proposalId },
				undefined,
			),
		);
	}
	const auditRecord = record.audit;
	if (
		isRecord(auditRecord) &&
		(!isWorkspaceProposalAuditMaterial(auditRecord) ||
			!workspaceProposalBoundarySourceRefsAreSafe(
				(auditRecord as { readonly sourceRefs?: readonly SourceRef[] }).sourceRefs,
			))
	) {
		issues.push(
			repairActionIntentIssue(
				"malformed-outcome-detail-supply-request",
				"Outcome detail supply request audit must be data-only boundary-safe material.",
				{ proposalId: record.proposalId },
				undefined,
			),
		);
	}
	return dedupeRepairActionIssues(issues);
}

function isOutcomeDetailSupplyOutcomeRecordShape(
	value: unknown,
): value is WorkspaceProposalFamilyOutcomeRecord {
	return (
		isRecord(value) &&
		workspaceProposalFamilyOutcomeKinds.includes(
			value.kind as WorkspaceProposalFamilyOutcomeRecord["kind"],
		) &&
		nonBlankString(value.outcomeId) &&
		nonBlankString(value.applicationId) &&
		nonBlankString(value.proposalId) &&
		nonBlankString(value.decisionId) &&
		nonBlankString(value.idempotencyKey) &&
		nonBlankString(value.proposalFamily) &&
		Array.isArray(value.sourceRefs)
	);
}

function outcomeDetailSupplyOutcomeBoundaryRefsAreSafe(
	outcome: WorkspaceProposalFamilyOutcomeRecord,
): boolean {
	const familyRef =
		outcome.kind === "workspace-proposal-required-input-response-outcome-recorded"
			? outcome.responseRef
			: outcome.kind === "workspace-proposal-work-item-spawn-outcome-recorded"
				? outcome.workItemRef
				: outcome.kind === "workspace-proposal-work-item-link-outcome-recorded"
					? outcome.linkRef
					: outcome.actionRef;
	return (
		workspaceProposalBoundarySourceRefsAreSafe(outcome.sourceRefs) &&
		(outcome.audit === undefined ||
			workspaceProposalBoundarySourceRefsAreSafe(outcome.audit.sourceRefs)) &&
		workspaceProposalBoundaryRefIsSafe(familyRef)
	);
}

function currentSupplyRequests(
	requests: readonly WorkspaceProposalFamilyOutcomeDetailSupplyRequest[],
): ReadonlyMap<string, WorkspaceProposalFamilyOutcomeDetailSupplyRequest> {
	const out = new Map<string, WorkspaceProposalFamilyOutcomeDetailSupplyRequest>();
	for (const request of requests)
		out.set(outcomeDetailSupplyRequestProjectionKey(request), request);
	return out;
}

function outcomeDetailSupplyRequestProjectionKey(
	request: WorkspaceProposalFamilyOutcomeDetailSupplyRequest,
): string {
	return stableStringify({
		currentViewId:
			stringField((request as { readonly viewId?: unknown }).viewId) ??
			stringField((request as { readonly supplyRequestId?: unknown }).supplyRequestId),
	});
}

function sameSupplyRequestCoordinates(
	request: WorkspaceProposalFamilyOutcomeDetailSupplyRequest,
	ref: WorkspaceProposalFamilyOutcomeRef,
): boolean {
	return (
		request.applicationId === ref.applicationId &&
		request.proposalId === ref.proposalId &&
		request.decisionId === ref.decisionId &&
		request.idempotencyKey === ref.idempotencyKey &&
		request.proposalFamily === ref.proposalFamily
	);
}

function supplyRequestRefMatches(
	request: WorkspaceProposalFamilyOutcomeDetailSupplyRequest,
	ref: WorkspaceProposalFamilyOutcomeRef,
	filters: WorkspaceProposalFamilyApplicationReadModelNormalizedFilters,
): boolean {
	return (
		sameSupplyRequestCoordinates(request, ref) &&
		matchesOptionalSet(filters.outcomeIds, ref.outcomeId) &&
		matchesOptionalSet(filters.outcomeKinds, ref.outcomeKind)
	);
}

function outcomeDetailSupplyDiagnostic(
	code:
		| "malformed-outcome-detail-supply-request"
		| "malformed-supplied-outcome-detail"
		| "missing-supplied-outcome-detail"
		| "mismatched-supplied-outcome-detail",
	message: string,
	outcomeRef: WorkspaceProposalFamilyOutcomeRef | undefined,
	coordinates: {
		readonly applicationId?: string;
		readonly proposalId?: string;
		readonly decisionId?: string;
		readonly idempotencyKey?: string;
		readonly proposalFamily?: WorkspaceProposalFamily;
	},
	sourceRefs: readonly SourceRef[],
): WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic {
	return {
		kind: "workspace-proposal-family-application-read-model-display-diagnostic",
		diagnosticId: `workspace-proposal-family-application-read-model-display-diagnostic:${stableStringify(
			{ code, outcomeRef, coordinates },
		)}`,
		code,
		message,
		...coordinates,
		...(outcomeRef === undefined ? {} : { outcomeRef }),
		sourceRefs: repairActionSourceRefs(sourceRefs),
	};
}

function dedupeOutcomes(
	outcomes: readonly WorkspaceProposalFamilyOutcomeRecord[],
): readonly WorkspaceProposalFamilyOutcomeRecord[] {
	const out = new Map<string, WorkspaceProposalFamilyOutcomeRecord>();
	for (const outcome of outcomes) out.set(outcomeProjectionKey(outcome), outcome);
	return [...out.values()];
}

function dedupeRepairActionIssues(
	issues: readonly WorkspaceProposalRecordedIssue[],
): readonly WorkspaceProposalRecordedIssue[] {
	const out = new Map<string, WorkspaceProposalRecordedIssue>();
	for (const issue of issues) out.set(stableStringify(issue), issue);
	return [...out.values()];
}

function blockedRepairSuccessorPreview(
	intent: WorkspaceProposalRepairActionIntent | unknown,
	diagnostics: readonly WorkspaceProposalRecordedIssue[],
	options: WorkspaceProposalRepairSuccessorProposalIntakePreviewOptions,
): WorkspaceProposalRepairSuccessorProposalIntakePreview {
	const record = isRecord(intent) ? intent : {};
	return {
		kind: "workspace-proposal-repair-successor-proposal-intake-preview",
		previewId:
			options.previewId ??
			`workspace-proposal-repair-successor-preview:blocked:${stringField(record.intentId) ?? "unknown"}`,
		status: "blocked",
		intentId: stringField(record.intentId) ?? "",
		actionIntentId: stringField(record.intentId) ?? "",
		descriptorId: stringField(record.descriptorId) ?? "",
		repairRequestId: stringField(record.repairRequestId) ?? "",
		actionKind: "open-successor-proposal-flow",
		applicationId: stringField(record.applicationId) ?? "",
		proposalId: stringField(record.proposalId) ?? "",
		decisionId: stringField(record.decisionId) ?? "",
		idempotencyKey: stringField(record.idempotencyKey) ?? "",
		proposalFamily: (stringField(record.proposalFamily) ?? "") as WorkspaceProposalFamily,
		targetRefs: [],
		contextRefs: [],
		diagnostics: dedupeRepairActionIssues(diagnostics),
		sourceRefs: repairActionSourceRefs([
			...(options.sourceRefs ?? []),
			...(safeWorkspaceProposalAudit(options.audit)?.sourceRefs ?? []),
		]),
		...(safeWorkspaceProposalAudit(options.audit) === undefined
			? {}
			: { audit: safeWorkspaceProposalAudit(options.audit) }),
	};
}

function repairActionSuggestedDraftPatchIssues(
	intent: WorkspaceProposalRepairActionIntent,
	options: WorkspaceProposalRepairSuccessorProposalIntakePreviewOptions,
): readonly WorkspaceProposalRecordedIssue[] {
	if (options.suggestedDraftPatch === undefined) return [];
	const issues = workspaceProposalDataOnlyIssues(
		options.suggestedDraftPatch,
		"repairSuccessorProposalSuggestedDraftPatch",
	).map((issue) => repairActionIssueFromDataOnly(issue, intent, undefined));
	if (issues.length > 0) return issues;
	const maxBytes = options.maxSuggestedDraftPatchBytes ?? 16 * 1024;
	if (
		new TextEncoder().encode(stableStringify(options.suggestedDraftPatch)).byteLength > maxBytes
	) {
		return [
			...issues,
			repairActionIntentIssue(
				"suggested-draft-patch-too-large",
				"Repair successor proposal suggested draft patch exceeds the bounded preview limit.",
				intent,
				undefined,
			),
		];
	}
	return [...issues, ...repairActionReservedPreviewKeyIssues(intent, options.suggestedDraftPatch)];
}

function repairActionPreviewMetadataIssues(
	intent: WorkspaceProposalRepairActionIntent,
	options: WorkspaceProposalRepairSuccessorProposalIntakePreviewOptions,
): readonly WorkspaceProposalRecordedIssue[] {
	if (options.metadata === undefined) return [];
	const issues = workspaceProposalDataOnlyIssues(
		options.metadata,
		"repairSuccessorProposalMetadata",
	).map((issue) => repairActionIssueFromDataOnly(issue, intent, undefined));
	if (issues.length > 0) return issues;
	return [...issues, ...repairActionReservedPreviewKeyIssues(intent, options.metadata)];
}

function repairActionReservedPreviewKeyIssues(
	intent: WorkspaceProposalRepairActionIntent,
	value: unknown,
): readonly WorkspaceProposalRecordedIssue[] {
	const reserved = new Set([
		"successorProposalId",
		"successorAdmissionId",
		"successorApplicationId",
		"admissionId",
		"applicationId",
		"proposalId",
		"proposalRecorded",
		"admissionDecision",
		"applicationStatus",
	]);
	const issues: WorkspaceProposalRecordedIssue[] = [];
	const visit = (entry: unknown): void => {
		if (Array.isArray(entry)) {
			for (const item of entry) visit(item);
			return;
		}
		if (!isRecord(entry)) return;
		for (const [key, child] of Object.entries(entry)) {
			if (reserved.has(key) || repairActionPreviewKeyCarriesTruth(key)) {
				issues.push(
					repairActionIntentIssue(
						"forbidden-successor-truth-material",
						"Repair successor proposal preview must not carry proposal/admission/application truth identifiers.",
						intent,
						undefined,
					),
				);
			}
			visit(child);
		}
	};
	visit(value);
	return dedupeRepairActionIssues(issues);
}

function repairActionPreviewKeyCarriesTruth(key: string): boolean {
	const normalized = key
		.replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-");
	const tokens = normalized.split("-").filter((token) => token.length > 0);
	const hasTruthDomain = tokens.some((token) =>
		["proposal", "admission", "application", "successor"].includes(token),
	);
	const hasTruthHandle = tokens.some((token) =>
		[
			"id",
			"ids",
			"ref",
			"refs",
			"record",
			"recorded",
			"decision",
			"status",
			"truth",
			"fact",
		].includes(token),
	);
	return hasTruthDomain && hasTruthHandle;
}

function repairActionIntentIssue(
	code: string,
	message: string,
	intent: Partial<WorkspaceProposalRepairActionIntent> | unknown,
	request: WorkspaceProposalRepairReviewRequest | undefined,
): WorkspaceProposalRecordedIssue {
	const intentRecord = isRecord(intent) ? intent : {};
	return {
		kind: "issue",
		source: "workspace-proposal",
		severity: "error",
		code,
		message,
		subjectId: request?.proposalId ?? stringField(intentRecord.proposalId),
		refs: [
			...(stringField(intentRecord.intentId) === undefined
				? []
				: [`workspace-proposal-repair-action-intent:${stringField(intentRecord.intentId)}`]),
			...(request === undefined
				? []
				: [`workspace-proposal-repair-review-request:${request.repairRequestId}`]),
		],
	};
}

function repairActionIssueFromDataOnly(
	issue: WorkspaceProposalRecordedIssue,
	intent: WorkspaceProposalRepairActionIntent,
	request: WorkspaceProposalRepairReviewRequest | undefined,
): WorkspaceProposalRecordedIssue {
	return {
		...issue,
		subjectId: issue.subjectId ?? request?.proposalId ?? intent.proposalId,
		refs: issue.refs ?? [
			`workspace-proposal-repair-action-intent:${intent.intentId}`,
			...(request === undefined
				? []
				: [`workspace-proposal-repair-review-request:${request.repairRequestId}`]),
		],
	};
}

function repairReviewSubjectRefs(
	request: WorkspaceProposalRepairReviewRequest,
): readonly SourceRef[] {
	return (request.subjectRefs ?? []).filter(repairReviewDecisionSourceRefIsValid);
}

function repairActionDescriptorSignature(
	descriptor: WorkspaceProposalRepairActionDescriptor,
): string {
	return stableStringify(descriptor);
}

function repairActionIntentSignature(intent: WorkspaceProposalRepairActionIntent): string {
	return stableStringify({
		kind: intent.kind,
		intentId: intent.intentId,
		descriptorId: intent.descriptorId,
		repairRequestId: intent.repairRequestId,
		actionKind: intent.actionKind,
		applicationId: intent.applicationId,
		proposalId: intent.proposalId,
		decisionId: intent.decisionId,
		idempotencyKey: intent.idempotencyKey,
		proposalFamily: intent.proposalFamily,
		reviewerRef: intent.reviewerRef,
		actorRef: intent.actorRef,
		capabilityRefs: intent.capabilityRefs,
		policyRefs: intent.policyRefs,
		sourceRefs: intent.sourceRefs,
		audit: intent.audit,
		metadata: intent.metadata,
		expectedCurrentState: intent.expectedCurrentState,
	});
}

function repairReviewDecisionRecordingInputSignature(
	input: WorkspaceProposalRepairReviewDecisionRecordingInput,
): string {
	return stableStringify({
		kind: input.kind,
		repairRequestId: input.repairRequestId,
		reviewDecisionId: input.reviewDecisionId,
		intent: input.intent,
		reviewerRef: input.reviewerRef,
		actorRef: input.actorRef,
		capabilityRefs: input.capabilityRefs,
		policyRefs: input.policyRefs,
		sourceRefs: input.sourceRefs,
		audit: input.audit,
		reason: input.reason,
		code: input.code,
		resolvesRefs: input.resolvesRefs,
		supersedesRefs: input.supersedesRefs,
		decidedAtMs: input.decidedAtMs,
		metadata: input.metadata,
		expectedCurrentState: input.expectedCurrentState,
	});
}

function repairReviewDecisionRecordingResultKey(
	result: WorkspaceProposalRepairReviewDecisionRecordingResult,
): string {
	return stableStringify(result);
}

function blockedRepairReviewDecisionRecordingResult(
	input: WorkspaceProposalRepairReviewDecisionRecordingInput,
	request: WorkspaceProposalRepairReviewRequest | undefined,
	issues: readonly WorkspaceProposalRecordedIssue[],
): WorkspaceProposalRepairReviewDecisionRecordingResult {
	const audit =
		safeWorkspaceProposalAudit(input.audit) ?? safeWorkspaceProposalAudit(request?.audit);
	return {
		kind: "workspace-proposal-repair-review-decision-recording-result",
		status: "blocked",
		decision: undefined,
		issues: [...dedupeRecordingIssues(issues)],
		sourceRefs: repairActionSourceRefs(input.sourceRefs ?? []),
		...(audit === undefined ? {} : { audit }),
	};
}

function conflictingRepairActionIntentValidationResult(
	intent: WorkspaceProposalRepairActionIntent,
): WorkspaceProposalRepairActionIntentValidationResult {
	const audit = safeWorkspaceProposalAudit(intent.audit);
	return {
		kind: "workspace-proposal-repair-action-intent-validation-result",
		status: "blocked",
		intentId: intent.intentId,
		descriptorId: intent.descriptorId,
		repairRequestId: intent.repairRequestId,
		actionKind: intent.actionKind,
		applicationId: intent.applicationId,
		proposalId: intent.proposalId,
		decisionId: intent.decisionId,
		idempotencyKey: intent.idempotencyKey,
		proposalFamily: intent.proposalFamily,
		issues: [conflictingRepairActionIntentIssue(intent)],
		sourceRefs: repairActionSourceRefs(intent.sourceRefs ?? []),
		...(audit === undefined ? {} : { audit }),
	};
}

function conflictingRepairActionIntentIssue(
	intent: WorkspaceProposalRepairActionIntent,
): WorkspaceProposalRecordedIssue {
	return repairActionIntentIssue(
		"conflicting-repair-action-intent",
		"Repair action intent facts conflict for the same intentId.",
		intent,
		undefined,
	);
}

function repairReviewDecisionRecordingInputIssue(
	code: string,
	message: string,
	input: WorkspaceProposalRepairReviewDecisionRecordingInput,
	request: WorkspaceProposalRepairReviewRequest | undefined,
): WorkspaceProposalRecordedIssue {
	return {
		kind: "issue",
		source: "workspace-proposal",
		severity: "error",
		code,
		message,
		subjectId: request?.proposalId,
		refs: [
			...(blank(input.reviewDecisionId)
				? []
				: [`workspace-proposal-repair-review-decision:${input.reviewDecisionId}`]),
			...(request === undefined
				? [`workspace-proposal-repair-review-request:${input.repairRequestId}`]
				: [`workspace-proposal-repair-review-request:${request.repairRequestId}`]),
		],
	};
}

function repairReviewDecisionRecordingIssues(
	request: WorkspaceProposalRepairReviewRequest,
	options: WorkspaceProposalRepairReviewDecisionRecordingOptions | undefined,
): WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	if (!isRecord(request) || request.kind !== "workspace-proposal-repair-review-request") {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"malformed-repair-review-request",
				"Repair-review decision recording requires an existing repair-review request.",
				undefined,
			),
		);
		return issues;
	}
	if (!isRecord(options)) {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"malformed-recording-options",
				"Repair-review decision recording requires data-only options material.",
				request,
			),
		);
		return issues;
	}
	const requestDataOnlyIssues = workspaceProposalDataOnlyIssues(request, "repairReviewRequest");
	for (const entry of requestDataOnlyIssues) {
		issues.push(repairReviewDecisionIssueFromDataOnly(entry, request));
	}
	const optionDataOnlyIssues = workspaceProposalDataOnlyIssues(
		options,
		"repairReviewDecisionOptions",
	);
	for (const entry of optionDataOnlyIssues) {
		issues.push(repairReviewDecisionIssueFromDataOnly(entry, request));
	}
	if (requestDataOnlyIssues.length > 0 || optionDataOnlyIssues.length > 0) {
		return [...dedupeRecordingIssues(issues)];
	}
	for (const [field, value] of [
		["repairRequestId", request.repairRequestId],
		["applicationId", request.applicationId],
		["proposalId", request.proposalId],
		["decisionId", request.decisionId],
		["idempotencyKey", request.idempotencyKey],
		["proposalFamily", request.proposalFamily],
	] as const) {
		if (blank(value)) {
			issues.push(
				repairReviewDecisionRecordingIssue(
					"malformed-repair-review-request",
					`Repair-review request requires ${field}.`,
					request,
				),
			);
		}
	}
	if (blank(options.reviewDecisionId)) {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"missing-review-decision-id",
				"Repair-review decision recording requires a Workspace-supplied reviewDecisionId.",
				request,
			),
		);
	}
	if (!repairReviewDecisionIntentIsKnown(options.intent)) {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"unsupported-repair-review-intent",
				"Repair-review decision recording requires a supported lifecycle intent.",
				request,
			),
		);
	}
	if (options.reviewerRef === undefined && options.actorRef === undefined) {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"missing-review-authority-material",
				"Repair-review decision recording requires reviewer or actor ref material.",
				request,
			),
		);
	}
	if (
		(!Array.isArray(options.capabilityRefs) || options.capabilityRefs.length === 0) &&
		(!Array.isArray(options.policyRefs) || options.policyRefs.length === 0)
	) {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"missing-review-authority-material",
				"Repair-review decision recording requires explicit capability or policy material.",
				request,
			),
		);
	}
	if (!Array.isArray(options.sourceRefs) || options.sourceRefs.length === 0) {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"missing-review-audit-material",
				"Repair-review decision recording requires explicit source refs.",
				request,
			),
		);
	}
	if (options.audit === undefined) {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"missing-review-audit-material",
				"Repair-review decision recording requires explicit audit material.",
				request,
			),
		);
	}
	if (blank(options.reason) && blank(options.code)) {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"missing-review-audit-material",
				"Repair-review decision recording requires reason or code material.",
				request,
			),
		);
	}
	for (const field of [
		"repairRequestId",
		"applicationId",
		"proposalId",
		"decisionId",
		"idempotencyKey",
		"proposalFamily",
	] as const) {
		if (Object.hasOwn(options, field)) {
			issues.push(
				repairReviewDecisionRecordingIssue(
					"coordinate-override-forbidden",
					"Repair-review decision recording copies coordinates from the request.",
					request,
				),
			);
			break;
		}
	}
	for (const [field, value] of [
		["reviewerRef", options.reviewerRef],
		["actorRef", options.actorRef],
	] as const) {
		if (value !== undefined && !repairReviewDecisionSourceRefIsValid(value)) {
			issues.push(
				repairReviewDecisionRecordingIssue(
					"malformed-ref",
					`Repair-review decision ${field} must be a data-only source ref.`,
					request,
				),
			);
		}
	}
	for (const [field, refs] of [
		["capabilityRefs", options.capabilityRefs],
		["policyRefs", options.policyRefs],
		["sourceRefs", options.sourceRefs],
		["resolvesRefs", options.resolvesRefs],
		["supersedesRefs", options.supersedesRefs],
	] as const) {
		if (refs !== undefined && !repairReviewDecisionSourceRefsAreValid(refs)) {
			issues.push(
				repairReviewDecisionRecordingIssue(
					"malformed-ref",
					`Repair-review decision ${field} must be a dense array of data-only refs.`,
					request,
				),
			);
		}
	}
	if (options.audit !== undefined && !isWorkspaceProposalAuditMaterial(options.audit)) {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"malformed-audit",
				"Repair-review decision audit material must be data-only audit material.",
				request,
			),
		);
	}
	if (options.metadata !== undefined && !isRecord(options.metadata)) {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"malformed-metadata",
				"Repair-review decision metadata must be data-only object material.",
				request,
			),
		);
	}
	if (
		options.decidedAtMs !== undefined &&
		(typeof options.decidedAtMs !== "number" || !Number.isFinite(options.decidedAtMs))
	) {
		issues.push(
			repairReviewDecisionRecordingIssue(
				"malformed-decision-time",
				"Repair-review decision time must be a finite number when supplied.",
				request,
			),
		);
	}
	if (options.currentStatus !== undefined) {
		if (
			!isRepairReviewStatusMaterial(options.currentStatus) ||
			!repairReviewCoordinatesMatch(request, options.currentStatus)
		) {
			issues.push(
				repairReviewDecisionRecordingIssue(
					"current-status-coordinate-mismatch",
					"Repair-review current status guard must match the request coordinates.",
					request,
				),
			);
		}
	}
	if (options.expectedCurrentState !== undefined) {
		if (!isRecord(options.expectedCurrentState)) {
			issues.push(
				repairReviewDecisionRecordingIssue(
					"stale-repair-review-state",
					"Repair-review expected current state guard must be data-only state material.",
					request,
				),
			);
		} else if (options.currentStatus === undefined) {
			issues.push(
				repairReviewDecisionRecordingIssue(
					"stale-repair-review-state",
					"Repair-review expected current state guard requires current status material.",
					request,
				),
			);
		} else if (
			isRepairReviewStatusMaterial(options.currentStatus) &&
			repairReviewCoordinatesMatch(request, options.currentStatus) &&
			!repairReviewExpectedStateMatchesStatus(options.expectedCurrentState, options.currentStatus)
		) {
			issues.push(
				repairReviewDecisionRecordingIssue(
					"stale-repair-review-state",
					"Repair-review current status no longer matches the expected guard state.",
					request,
				),
			);
		}
	}
	return [...dedupeRecordingIssues(issues)];
}

function repairReviewDecisionIntentIsKnown(
	intent: unknown,
): intent is WorkspaceProposalRepairReviewDecisionIntent {
	return (
		intent === "acknowledged" ||
		intent === "resolved" ||
		intent === "withdrawn" ||
		intent === "superseded"
	);
}

function repairReviewDecisionSourceRefIsValid(value: unknown): value is SourceRef {
	return (
		isSourceRef(value) &&
		workspaceProposalDataOnlyIssues(value, "repairReviewDecisionRef").length === 0
	);
}

function repairReviewDecisionSourceRefsAreValid(value: unknown): value is readonly SourceRef[] {
	return (
		Array.isArray(value) &&
		isDenseArray(value) &&
		value.every((entry) => repairReviewDecisionSourceRefIsValid(entry))
	);
}

function isRepairReviewStatusMaterial(
	value: unknown,
): value is WorkspaceProposalRepairReviewStatus {
	return (
		isRecord(value) &&
		value.kind === "workspace-proposal-repair-review-status" &&
		nonBlankString(value.repairRequestId) &&
		nonBlankString(value.applicationId) &&
		nonBlankString(value.proposalId) &&
		nonBlankString(value.decisionId) &&
		nonBlankString(value.idempotencyKey) &&
		nonBlankString(value.proposalFamily) &&
		(value.state === "open" ||
			value.state === "acknowledged" ||
			value.state === "resolved" ||
			value.state === "withdrawn" ||
			value.state === "superseded" ||
			value.state === "conflict") &&
		Array.isArray(value.proofRefs) &&
		Array.isArray(value.decisions) &&
		Array.isArray(value.conflicts) &&
		Array.isArray(value.issues) &&
		Array.isArray(value.sourceRefs)
	);
}

function isWorkspaceProposalAuditMaterial(value: unknown): value is WorkspaceProposalAuditMaterial {
	if (!isRecord(value)) return false;
	return (
		(value.auditId === undefined || typeof value.auditId === "string") &&
		(value.actorId === undefined || typeof value.actorId === "string") &&
		(value.recordedAtMs === undefined ||
			(typeof value.recordedAtMs === "number" && Number.isFinite(value.recordedAtMs))) &&
		(value.reason === undefined || typeof value.reason === "string") &&
		(value.sourceRefs === undefined || repairReviewDecisionSourceRefsAreValid(value.sourceRefs)) &&
		(value.metadata === undefined || isRecord(value.metadata)) &&
		workspaceProposalDataOnlyIssues(value, "repairReviewDecisionAudit").length === 0
	);
}

function safeWorkspaceProposalAudit(value: unknown): WorkspaceProposalAuditMaterial | undefined {
	try {
		return isWorkspaceProposalAuditMaterial(value)
			? immutableClone(value as WorkspaceProposalAuditMaterial)
			: undefined;
	} catch {
		return undefined;
	}
}

function repairReviewExpectedStateMatchesStatus(
	expected: WorkspaceProposalRepairReviewExpectedCurrentState,
	status: WorkspaceProposalRepairReviewStatus,
): boolean {
	if (expected.state !== undefined && expected.state !== status.state) return false;
	if (expected.code !== undefined && expected.code !== status.code) return false;
	if (expected.proofKind !== undefined && expected.proofKind !== status.proofKind) return false;
	if (
		expected.proofRefs !== undefined &&
		(!repairReviewDecisionSourceRefsAreValid(expected.proofRefs) ||
			stableStringify(expected.proofRefs) !== stableStringify(status.proofRefs))
	) {
		return false;
	}
	return true;
}

function repairReviewDecisionIssueFromDataOnly(
	issue: WorkspaceProposalRecordedIssue,
	request: WorkspaceProposalRepairReviewRequest,
): WorkspaceProposalRecordedIssue {
	return {
		...issue,
		subjectId: issue.subjectId ?? request.proposalId,
		refs: issue.refs ?? [`workspace-proposal-repair-review-request:${request.repairRequestId}`],
	};
}

function repairReviewDecisionRecordingIssue(
	code: string,
	message: string,
	request: WorkspaceProposalRepairReviewRequest | undefined,
): WorkspaceProposalRecordedIssue {
	return {
		kind: "issue",
		source: "workspace-proposal",
		severity: "error",
		code,
		message,
		...(request === undefined ? {} : { subjectId: request.proposalId }),
		refs:
			request === undefined
				? []
				: [`workspace-proposal-repair-review-request:${request.repairRequestId}`],
	};
}

function dedupeRecordingIssues(
	issues: readonly WorkspaceProposalRecordedIssue[],
): readonly WorkspaceProposalRecordedIssue[] {
	const out = new Map<string, WorkspaceProposalRecordedIssue>();
	for (const issue of issues) out.set(stableStringify(issue), issue);
	return [...out.values()];
}

function readModelCoordinates(input: WorkspaceProposalFamilyApplicationReadModelProjectionInput): {
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
} {
	return {
		applicationId: stringField(input.applicationId),
		proposalId: stringField(input.proposalId),
		decisionId: stringField(input.decisionId),
		idempotencyKey: stringField(input.idempotencyKey),
		proposalFamily: stringField(input.proposalFamily) as WorkspaceProposalFamily | undefined,
	};
}

function readModelCoordinatesComplete(coordinates: {
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
}): coordinates is {
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly proposalFamily: WorkspaceProposalFamily;
} {
	return (
		coordinates.applicationId !== undefined &&
		coordinates.proposalId !== undefined &&
		coordinates.decisionId !== undefined &&
		coordinates.idempotencyKey !== undefined &&
		coordinates.proposalFamily !== undefined
	);
}

function coordinatesMatchExact(
	expected: {
		readonly applicationId: string;
		readonly proposalId: string;
		readonly decisionId: string;
		readonly idempotencyKey: string;
		readonly proposalFamily: WorkspaceProposalFamily;
	},
	material: {
		readonly applicationId?: string;
		readonly proposalId?: string;
		readonly decisionId?: string;
		readonly idempotencyKey?: string;
		readonly proposalFamily?: WorkspaceProposalFamily;
	},
): boolean {
	return (
		material.applicationId === expected.applicationId &&
		material.proposalId === expected.proposalId &&
		material.decisionId === expected.decisionId &&
		material.idempotencyKey === expected.idempotencyKey &&
		material.proposalFamily === expected.proposalFamily
	);
}

function sameOutcomeRefCoordinates(
	ref: WorkspaceProposalFamilyOutcomeRef,
	material:
		| WorkspaceProposalFamilyOutcomeRecord
		| WorkspaceProposalFamilyOutcomeRecordStatus
		| WorkspaceProposalFamilyOutcomeIndexEntry,
): boolean {
	const coordinatesMatch =
		ref.applicationId === material.applicationId &&
		ref.proposalId === material.proposalId &&
		ref.decisionId === material.decisionId &&
		ref.idempotencyKey === material.idempotencyKey &&
		ref.proposalFamily === material.proposalFamily;
	if (!coordinatesMatch) return false;
	if (material.kind === "workspace-proposal-family-outcome-index-entry") {
		return material.outcomeRefs.some(
			(entry) => entry.outcomeId === ref.outcomeId && entry.outcomeKind === ref.outcomeKind,
		);
	}
	if (material.kind === "workspace-proposal-family-outcome-record-status") {
		return (
			material.outcomeId === ref.outcomeId &&
			material.outcomeRefs.some(
				(entry) => entry.outcomeId === ref.outcomeId && entry.outcomeKind === ref.outcomeKind,
			)
		);
	}
	return material.outcomeId === ref.outcomeId && material.kind === ref.outcomeKind;
}

function groupByOutcomeId<T extends { readonly outcomeId: string }>(
	items: readonly T[],
): ReadonlyMap<string, readonly T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items)
		groups.set(item.outcomeId, [...(groups.get(item.outcomeId) ?? []), item]);
	return groups;
}

function readModelDisplayDiagnostic(
	code: WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic["code"],
	outcomeRef: WorkspaceProposalFamilyOutcomeRef,
): WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic {
	const message =
		code === "missing-outcome-detail"
			? "Workspace proposal family outcome detail was not supplied"
			: code === "mismatched-outcome-detail"
				? "Workspace proposal family outcome detail mismatches its thin ref"
				: "Workspace proposal family outcome status mismatches its thin ref";
	return {
		kind: "workspace-proposal-family-application-read-model-display-diagnostic",
		diagnosticId: `workspace-proposal-family-application-read-model-display-diagnostic:${stableStringify(
			{
				code,
				outcomeRef,
			},
		)}`,
		code,
		message,
		applicationId: outcomeRef.applicationId,
		proposalId: outcomeRef.proposalId,
		decisionId: outcomeRef.decisionId,
		idempotencyKey: outcomeRef.idempotencyKey,
		proposalFamily: outcomeRef.proposalFamily,
		outcomeRef,
		sourceRefs: outcomeRef.sourceRefs,
	};
}

interface NormalizedReadModelQuery {
	readonly complete: boolean;
	readonly malformed: boolean;
	readonly queryId?: string;
	readonly viewId?: string;
	readonly coordinates: {
		readonly applicationId?: string;
		readonly proposalId?: string;
		readonly decisionId?: string;
		readonly idempotencyKey?: string;
		readonly proposalFamily?: WorkspaceProposalFamily;
	};
	readonly page: {
		readonly offset: number;
		readonly limit: number;
	};
	readonly filters: WorkspaceProposalFamilyApplicationReadModelNormalizedFilters;
	readonly sort: readonly WorkspaceProposalFamilyApplicationReadModelSortOption[];
	readonly groupBy: readonly WorkspaceProposalFamilyApplicationReadModelGroupField[];
	readonly search: WorkspaceProposalFamilyApplicationReadModelNormalizedSearch;
	readonly sourceRefs: readonly SourceRef[];
}

interface NormalizedReadModelFilterResult {
	readonly filters: WorkspaceProposalFamilyApplicationReadModelNormalizedFilters;
	readonly malformed: boolean;
}

function normalizeReadModelQuery(
	query: WorkspaceProposalFamilyApplicationReadModelQuery,
): NormalizedReadModelQuery {
	const queryRecord: Record<string, unknown> = isRecord(query) ? query : {};
	const sourceRefResult = readModelQuerySourceRefs(queryRecord.sourceRefs);
	const auditSourceRefResult = readModelQuerySourceRefs(
		isRecord(queryRecord.audit) ? queryRecord.audit.sourceRefs : undefined,
	);
	const dataOnlyIssues = workspaceProposalDataOnlyIssues(query, "readModelQuery");
	const coordinates = {
		applicationId: stringField(queryRecord.applicationId),
		proposalId: stringField(queryRecord.proposalId),
		decisionId: stringField(queryRecord.decisionId),
		idempotencyKey: stringField(queryRecord.idempotencyKey),
		proposalFamily: stringField(queryRecord.proposalFamily) as WorkspaceProposalFamily | undefined,
	};
	const page = isRecord(queryRecord.page) ? queryRecord.page : {};
	const kind = stringField(queryRecord.kind);
	const queryId = stringField(queryRecord.queryId);
	const filterResult = normalizeReadModelFilters(
		isRecord(queryRecord.filters) ? queryRecord.filters : undefined,
	);
	const presentation = normalizeReadModelPresentationOptions(
		queryRecord.sort,
		queryRecord.groupBy,
		isRecord(queryRecord.search) ? queryRecord.search : queryRecord.search,
	);
	const complete =
		queryId !== undefined &&
		readModelCoordinatesComplete(coordinates) &&
		kind === "workspace-proposal-family-application-read-model-query";
	const malformed =
		kind !== "workspace-proposal-family-application-read-model-query" ||
		queryId === undefined ||
		(queryRecord.sourceRefs !== undefined && !Array.isArray(queryRecord.sourceRefs)) ||
		sourceRefResult.malformed ||
		auditSourceRefResult.malformed ||
		filterResult.malformed ||
		presentation.malformed ||
		dataOnlyIssues.length > 0;
	return {
		complete,
		malformed,
		queryId,
		viewId: stringField(queryRecord.viewId),
		coordinates,
		page: {
			offset: normalizePageOffset(page.offset),
			limit: normalizePageLimit(page.limit),
		},
		filters: filterResult.filters,
		sort: presentation.sort,
		groupBy: presentation.groupBy,
		search: presentation.search,
		sourceRefs: uniqueRefs([...sourceRefResult.refs, ...auditSourceRefResult.refs]),
	};
}

function readModelQueryDisplayDiagnostic(
	code: "incomplete-read-model-query" | "malformed-read-model-query",
	normalized: NormalizedReadModelQuery,
): WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic {
	return {
		kind: "workspace-proposal-family-application-read-model-display-diagnostic",
		diagnosticId: `workspace-proposal-family-application-read-model-display-diagnostic:${stableStringify(
			{
				code,
				queryId: normalized.queryId,
				viewId: normalized.viewId,
				coordinates: normalized.coordinates,
				page: normalized.page,
				filters: normalized.filters,
				sort: normalized.sort,
				groupBy: normalized.groupBy,
				search: normalized.search,
			},
		)}`,
		code,
		message:
			code === "malformed-read-model-query"
				? "Workspace proposal family read-model query is malformed"
				: "Workspace proposal family read-model query is incomplete",
		...(normalized.queryId === undefined ? {} : { queryId: normalized.queryId }),
		...(normalized.viewId === undefined ? {} : { viewId: normalized.viewId }),
		...normalized.coordinates,
		sourceRefs: normalized.sourceRefs,
	};
}

function readModelQuerySourceRefs(value: unknown): {
	readonly refs: readonly SourceRef[];
	readonly malformed: boolean;
} {
	if (value === undefined) return { refs: [], malformed: false };
	if (!Array.isArray(value)) return { refs: [], malformed: true };
	const refs: SourceRef[] = [];
	let malformed = false;
	for (const entry of value) {
		if (!isSourceRef(entry) || workspaceProposalDataOnlyIssues(entry, "sourceRef").length > 0) {
			malformed = true;
			continue;
		}
		refs.push(entry);
	}
	return { refs: uniqueRefs(refs), malformed };
}

function normalizeReadModelFilters(
	filters: WorkspaceProposalFamilyApplicationReadModelFilters | undefined,
): NormalizedReadModelFilterResult {
	const outcomeKinds = normalizeClosedStringFilter(
		filters?.outcomeKinds,
		workspaceProposalFamilyOutcomeKinds,
	);
	const repairStates = normalizeClosedStringFilter(
		filters?.repairStates,
		workspaceProposalRepairReviewLifecycleStates,
	);
	return {
		filters: {
			outcomeIds: normalizeStringFilter(filters?.outcomeIds),
			outcomeKinds: outcomeKinds.values,
			diagnosticCodes: normalizeStringFilter(filters?.diagnosticCodes),
			repairStates: repairStates.values,
		},
		malformed: outcomeKinds.malformed || repairStates.malformed,
	};
}

interface NormalizedReadModelPresentationResult {
	readonly sort: readonly WorkspaceProposalFamilyApplicationReadModelSortOption[];
	readonly groupBy: readonly WorkspaceProposalFamilyApplicationReadModelGroupField[];
	readonly search: WorkspaceProposalFamilyApplicationReadModelNormalizedSearch;
	readonly diagnostics: readonly WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic[];
	readonly malformed: boolean;
}

function normalizeReadModelPresentationOptions(
	sort: unknown,
	groupBy: unknown,
	search: unknown,
): NormalizedReadModelPresentationResult {
	const sortResult = normalizeReadModelSort(sort);
	const groupResult = normalizeClosedStringFilter(
		Array.isArray(groupBy) ? groupBy : groupBy === undefined ? undefined : [groupBy],
		readModelGroupFields,
	);
	const searchResult = normalizeReadModelSearch(search);
	const malformed =
		sortResult.malformed ||
		groupResult.malformed ||
		searchResult.malformed ||
		(sort !== undefined && !Array.isArray(sort)) ||
		(groupBy !== undefined && !Array.isArray(groupBy));
	const diagnostics = malformed
		? [readModelPresentationDiagnostic(sortResult.sort, groupResult.values, searchResult.search)]
		: [];
	return {
		sort: sortResult.sort,
		groupBy: groupResult.values,
		search: searchResult.search,
		diagnostics,
		malformed,
	};
}

function normalizeReadModelSort(sort: unknown): {
	readonly sort: readonly WorkspaceProposalFamilyApplicationReadModelSortOption[];
	readonly malformed: boolean;
} {
	if (sort === undefined) return { sort: [], malformed: false };
	if (!Array.isArray(sort)) return { sort: [], malformed: true };
	const allowedFields = new Set<string>(readModelSortFields);
	const allowedDirections = new Set<string>(["asc", "desc"]);
	const byField = new Map<
		WorkspaceProposalFamilyApplicationReadModelSortField,
		WorkspaceProposalFamilyApplicationReadModelSortDirection
	>();
	let malformed = false;
	for (const entry of sort) {
		if (!isRecord(entry)) {
			malformed = true;
			continue;
		}
		const field = stringField(entry.field);
		const direction = stringField(entry.direction);
		if (
			field === undefined ||
			direction === undefined ||
			!allowedFields.has(field) ||
			!allowedDirections.has(direction)
		) {
			malformed = true;
			continue;
		}
		byField.set(
			field as WorkspaceProposalFamilyApplicationReadModelSortField,
			direction as WorkspaceProposalFamilyApplicationReadModelSortDirection,
		);
	}
	return {
		sort: [...byField.entries()].map(([field, direction]) => ({ field, direction })),
		malformed,
	};
}

function normalizeReadModelSearch(search: unknown): {
	readonly search: WorkspaceProposalFamilyApplicationReadModelNormalizedSearch;
	readonly malformed: boolean;
} {
	if (search === undefined) return { search: { text: "", fields: [] }, malformed: false };
	if (!isRecord(search)) return { search: { text: "", fields: [] }, malformed: true };
	const fieldResult = normalizeClosedStringFilter(
		Array.isArray(search.fields) ? search.fields : undefined,
		readModelSearchFields,
	);
	return {
		search: {
			text: boundedSearchText(search.text),
			fields: fieldResult.values.length === 0 ? [...readModelSearchFields] : fieldResult.values,
		},
		malformed:
			fieldResult.malformed ||
			(search.fields !== undefined && !Array.isArray(search.fields)) ||
			(search.text !== undefined && typeof search.text !== "string"),
	};
}

function boundedSearchText(value: unknown): string {
	return typeof value === "string" ? value.trim().slice(0, 128) : "";
}

function readModelPresentationDiagnostic(
	sort: readonly WorkspaceProposalFamilyApplicationReadModelSortOption[],
	groupBy: readonly WorkspaceProposalFamilyApplicationReadModelGroupField[],
	search: WorkspaceProposalFamilyApplicationReadModelNormalizedSearch,
): WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic {
	return {
		kind: "workspace-proposal-family-application-read-model-display-diagnostic",
		diagnosticId: `workspace-proposal-family-application-read-model-display-diagnostic:${stableStringify(
			{
				code: "malformed-read-model-presentation-options",
				sort,
				groupBy,
				search,
			},
		)}`,
		code: "malformed-read-model-presentation-options",
		message: "Workspace proposal family read-model presentation options are malformed",
		sourceRefs: [],
	};
}

function normalizeStringFilter(values: readonly unknown[] | undefined): readonly string[] {
	if (!Array.isArray(values)) return [];
	return [...new Set(values.map(stringField).filter((value) => value !== undefined))].sort();
}

function normalizeClosedStringFilter<T extends string>(
	values: readonly unknown[] | undefined,
	allowedValues: readonly T[],
): { readonly values: readonly T[]; readonly malformed: boolean } {
	if (!Array.isArray(values)) return { values: [], malformed: false };
	const allowed = new Set<string>(allowedValues);
	const normalized = normalizeStringFilter(values);
	return {
		values: normalized.filter((value): value is T => allowed.has(value)),
		malformed: normalized.some((value) => !allowed.has(value)),
	};
}

const workspaceProposalFamilyOutcomeKinds = [
	"workspace-proposal-required-input-response-outcome-recorded",
	"workspace-proposal-work-item-spawn-outcome-recorded",
	"workspace-proposal-work-item-link-outcome-recorded",
	"workspace-proposal-domain-action-outcome-recorded",
] as const satisfies readonly WorkspaceProposalFamilyOutcomeRecord["kind"][];

const workspaceProposalRepairReviewLifecycleStates = [
	"open",
	"acknowledged",
	"resolved",
	"withdrawn",
	"superseded",
	"conflict",
] as const satisfies readonly WorkspaceProposalRepairReviewLifecycleState[];

const readModelSortFields = [
	"diagnostic-code",
	"outcome-id",
	"outcome-kind",
	"recorded-at-ms",
	"repair-state",
] as const satisfies readonly WorkspaceProposalFamilyApplicationReadModelSortField[];

const readModelGroupFields = [
	"diagnostic-code",
	"outcome-kind",
	"repair-state",
] as const satisfies readonly WorkspaceProposalFamilyApplicationReadModelGroupField[];

const readModelSearchFields = [
	"diagnostic-code",
	"diagnostic-message",
	"outcome-id",
	"outcome-kind",
	"repair-state",
] as const satisfies readonly WorkspaceProposalFamilyApplicationReadModelSearchField[];

function matchesOptionalSet<T extends string>(values: readonly T[], value: T): boolean {
	return values.length === 0 || values.includes(value);
}

function filterOutcomeIndexEntry(
	entry: WorkspaceProposalFamilyOutcomeIndexEntry,
	filters: WorkspaceProposalFamilyApplicationReadModelNormalizedFilters,
): WorkspaceProposalFamilyOutcomeIndexEntry {
	if (filters.outcomeIds.length === 0 && filters.outcomeKinds.length === 0) return entry;
	const outcomeRefs = entry.outcomeRefs.filter(
		(ref) =>
			matchesOptionalSet(filters.outcomeIds, ref.outcomeId) &&
			matchesOptionalSet(filters.outcomeKinds, ref.outcomeKind),
	);
	return {
		...entry,
		outcomeRefs,
	};
}

function readModelSearchMatches(
	ref: WorkspaceProposalFamilyOutcomeRef,
	search: WorkspaceProposalFamilyApplicationReadModelNormalizedSearch,
	diagnostics: readonly WorkspaceProposalFamilyApplicationDiagnostic[],
	repairReviewStatuses: readonly WorkspaceProposalRepairReviewStatus[],
): boolean {
	if (search.text === "") return true;
	const text = search.text.toLowerCase();
	const haystack: string[] = [];
	const fields = new Set(search.fields);
	if (fields.has("outcome-id")) haystack.push(ref.outcomeId);
	if (fields.has("outcome-kind")) haystack.push(ref.outcomeKind);
	if (fields.has("diagnostic-code") || fields.has("diagnostic-message")) {
		for (const diagnostic of diagnostics) {
			if (!coordinatesMatchExact(ref, diagnostic)) continue;
			if (fields.has("diagnostic-code")) haystack.push(diagnostic.code);
			if (fields.has("diagnostic-message")) {
				for (const issue of diagnostic.issues) haystack.push(issue.message);
			}
		}
	}
	if (fields.has("repair-state")) {
		for (const status of repairReviewStatuses) {
			if (coordinatesMatchExact(ref, status)) haystack.push(status.state);
		}
	}
	return haystack.some((value) => value.toLowerCase().includes(text));
}

function sortReadModelOutcomeRefs(
	refs: readonly WorkspaceProposalFamilyOutcomeRef[],
	sort: readonly WorkspaceProposalFamilyApplicationReadModelSortOption[],
	diagnostics: readonly WorkspaceProposalFamilyApplicationDiagnostic[],
	repairReviewStatuses: readonly WorkspaceProposalRepairReviewStatus[],
	outcomes: ReadonlyMap<string, readonly WorkspaceProposalFamilyOutcomeRecord[]>,
	statuses: ReadonlyMap<string, readonly WorkspaceProposalFamilyOutcomeRecordStatus[]>,
): readonly WorkspaceProposalFamilyOutcomeRef[] {
	if (sort.length === 0) return refs;
	return [...refs].sort((left, right) => {
		for (const option of sort) {
			const compared = compareReadModelSortValue(
				readModelSortValue(
					left,
					option.field,
					diagnostics,
					repairReviewStatuses,
					outcomes,
					statuses,
				),
				readModelSortValue(
					right,
					option.field,
					diagnostics,
					repairReviewStatuses,
					outcomes,
					statuses,
				),
			);
			if (compared !== 0) return option.direction === "asc" ? compared : -compared;
		}
		return compareReadModelSortValue(left.outcomeId, right.outcomeId);
	});
}

function readModelSortValue(
	ref: WorkspaceProposalFamilyOutcomeRef,
	field: WorkspaceProposalFamilyApplicationReadModelSortField,
	diagnostics: readonly WorkspaceProposalFamilyApplicationDiagnostic[],
	repairReviewStatuses: readonly WorkspaceProposalRepairReviewStatus[],
	outcomes: ReadonlyMap<string, readonly WorkspaceProposalFamilyOutcomeRecord[]>,
	statuses: ReadonlyMap<string, readonly WorkspaceProposalFamilyOutcomeRecordStatus[]>,
): string | number {
	switch (field) {
		case "outcome-id":
			return ref.outcomeId;
		case "outcome-kind":
			return ref.outcomeKind;
		case "diagnostic-code":
			return diagnostics.find((diagnostic) => coordinatesMatchExact(ref, diagnostic))?.code ?? "";
		case "repair-state":
			return repairReviewStatuses.find((status) => coordinatesMatchExact(ref, status))?.state ?? "";
		case "recorded-at-ms": {
			const outcome = (outcomes.get(ref.outcomeId) ?? []).find((entry) =>
				sameOutcomeRefCoordinates(ref, entry),
			);
			const status = (statuses.get(ref.outcomeId) ?? []).find((entry) =>
				sameOutcomeRefCoordinates(ref, entry),
			);
			return outcome?.audit?.recordedAtMs ?? status?.audit?.recordedAtMs ?? 0;
		}
	}
}

function compareReadModelSortValue(left: string | number, right: string | number): number {
	if (typeof left === "number" && typeof right === "number") return left - right;
	const leftString = String(left);
	const rightString = String(right);
	if (leftString < rightString) return -1;
	if (leftString > rightString) return 1;
	return 0;
}

function readModelDisplayGroups(
	refs: readonly WorkspaceProposalFamilyOutcomeRef[],
	groupBy: readonly WorkspaceProposalFamilyApplicationReadModelGroupField[],
	diagnostics: readonly WorkspaceProposalFamilyApplicationDiagnostic[],
	repairReviewStatuses: readonly WorkspaceProposalRepairReviewStatus[],
): readonly WorkspaceProposalFamilyApplicationReadModelDisplayGroup[] {
	const groups: WorkspaceProposalFamilyApplicationReadModelDisplayGroup[] = [];
	for (const field of groupBy) {
		const byValue = new Map<string, WorkspaceProposalFamilyOutcomeRef[]>();
		for (const ref of refs) {
			for (const value of readModelGroupValues(ref, field, diagnostics, repairReviewStatuses)) {
				byValue.set(value, [...(byValue.get(value) ?? []), ref]);
			}
		}
		for (const [value, outcomeRefs] of [...byValue.entries()].sort(([left], [right]) =>
			compareReadModelSortValue(left, right),
		)) {
			groups.push({
				kind: "workspace-proposal-family-application-read-model-display-group",
				field,
				value,
				outcomeRefs,
				count: outcomeRefs.length,
			});
		}
	}
	return groups;
}

function readModelGroupValues(
	ref: WorkspaceProposalFamilyOutcomeRef,
	field: WorkspaceProposalFamilyApplicationReadModelGroupField,
	diagnostics: readonly WorkspaceProposalFamilyApplicationDiagnostic[],
	repairReviewStatuses: readonly WorkspaceProposalRepairReviewStatus[],
): readonly string[] {
	switch (field) {
		case "outcome-kind":
			return [ref.outcomeKind];
		case "repair-state":
			return uniqueStrings(
				repairReviewStatuses
					.filter((status) => coordinatesMatchExact(ref, status))
					.map((status) => status.state),
			);
		case "diagnostic-code":
			return uniqueStrings(
				diagnostics
					.filter((diagnostic) => coordinatesMatchExact(ref, diagnostic))
					.map((diagnostic) => diagnostic.code),
			);
	}
}

function normalizePageOffset(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizePageLimit(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 50;
	return Math.min(100, Math.floor(value));
}

function readModelSignature(readModel: WorkspaceProposalFamilyApplicationReadModel): string {
	return stableStringify({
		queryId: readModel.queryId,
		viewId: readModel.viewId,
		filters: readModel.filters,
		diagnostics: readModel.diagnostics,
		repairReviewStatuses: readModel.repairReviewStatuses,
		outcomeIndexes: readModel.outcomeIndexes,
		outcomeDetails: readModel.outcomeDetails,
		displayDiagnostics: readModel.displayDiagnostics,
		page: readModel.page,
	});
}

function readModelCurrentViewKey(readModel: WorkspaceProposalFamilyApplicationReadModel): string {
	return stableStringify({
		currentViewId: readModel.viewId ?? readModel.queryId ?? readModel.readModelId,
	});
}

function readModelEmissionSignature(
	readModel: WorkspaceProposalFamilyApplicationReadModel,
): string {
	return stableStringify({
		readModelId: readModel.readModelId,
		signature: readModelSignature(readModel),
	});
}

function diagnosticClassForIssue(
	issue: WorkspaceProposalRecordedIssue,
): WorkspaceProposalFamilyApplicationDiagnosticClass | undefined {
	switch (issue.code) {
		case "missing-workspace-proposal-recorded":
		case "missing-workspace-proposal-admission-decision":
			return "missing-durable-handoff";
		case "idempotency-conflict":
			return "idempotency-conflict";
		case "missing-required-input-gate":
		case "missing-domain-action-facts":
		case "missing-family-application-ref":
		case "application-not-recordable":
		case "application-status-has-issues":
		case "missing-required-field":
			return "missing-family-material";
		case "malformed-family-draft":
		case "malformed-family-context":
		case "malformed-family-evidence-horizon":
		case "malformed-family-completion-policy":
		case "malformed-application-status":
		case "forbidden-runtime-material":
			return "malformed-family-material";
		default:
			return undefined;
	}
}

function diagnosticClassForApplicationStatus(
	status: WorkspaceProposalApplicationStatus,
): WorkspaceProposalFamilyApplicationDiagnosticClass | undefined {
	if (status.state === "idempotency-conflict") return "idempotency-conflict";
	const issueClass = firstDiagnosticClass(status.issues);
	if (status.state === "repair-needed") return issueClass ?? "missing-family-material";
	return issueClass === "missing-durable-handoff" ? undefined : issueClass;
}

function diagnosticClassForOutcomeStatus(
	status: WorkspaceProposalFamilyOutcomeRecordStatus,
): WorkspaceProposalFamilyApplicationDiagnosticClass | undefined {
	if (status.state === "idempotency-conflict") return "idempotency-conflict";
	if (status.state === "repair-needed" || status.state === "pending") {
		const issueClass = firstDiagnosticClass(status.issues);
		return issueClass ?? "missing-family-material";
	}
	return firstDiagnosticClass(status.issues);
}

function firstDiagnosticClass(
	issues: readonly WorkspaceProposalRecordedIssue[],
): WorkspaceProposalFamilyApplicationDiagnosticClass | undefined {
	for (const issue of issues) {
		const classification = diagnosticClassForIssue(issue);
		if (classification !== undefined) return classification;
	}
	return undefined;
}

function diagnosticFromIssue(
	issue: WorkspaceProposalRecordedIssue,
	classification: WorkspaceProposalFamilyApplicationDiagnosticClass,
): WorkspaceProposalFamilyApplicationDiagnostic {
	const metadata = isRecord(issue.metadata) ? issue.metadata : {};
	const applicationId = stringField(metadata.applicationId);
	const proposalId = stringField(metadata.proposalId) ?? issue.subjectId;
	const decisionId = stringField(metadata.decisionId);
	return {
		kind: "workspace-proposal-family-application-diagnostic",
		diagnosticId: diagnosticId({
			classification,
			code: issue.code,
			applicationId,
			proposalId,
			decisionId,
			refs: issue.refs,
		}),
		classification,
		applicationId,
		proposalId,
		decisionId,
		code: issue.code,
		issues: [issue],
		sourceRefs: [],
		metadata: { refs: issue.refs },
	};
}

function diagnosticFromAudit(
	audit: WorkspaceProposalFamilyApplicationAuditRecord,
	classification: WorkspaceProposalFamilyApplicationDiagnosticClass,
): WorkspaceProposalFamilyApplicationDiagnostic {
	const code = audit.code ?? classification;
	return {
		kind: "workspace-proposal-family-application-diagnostic",
		diagnosticId: diagnosticId({
			classification,
			code,
			applicationId: audit.applicationId,
			proposalId: audit.proposalId,
			decisionId: audit.decisionId,
			proposalFamily: audit.proposalFamily,
		}),
		classification,
		applicationId: audit.applicationId,
		proposalId: audit.proposalId,
		decisionId: audit.decisionId,
		proposalFamily: audit.proposalFamily,
		code,
		issues: audit.issues ?? [],
		sourceRefs: audit.sourceRefs ?? [],
		audit: audit.audit,
		metadata: audit.metadata,
	};
}

function diagnosticFromApplicationStatus(
	status: WorkspaceProposalApplicationStatus,
	classification: WorkspaceProposalFamilyApplicationDiagnosticClass,
): WorkspaceProposalFamilyApplicationDiagnostic {
	const code = status.code ?? status.issues[0]?.code ?? status.state;
	return {
		kind: "workspace-proposal-family-application-diagnostic",
		diagnosticId: diagnosticId({
			classification,
			code,
			applicationId: status.applicationId,
			proposalId: status.proposalId,
			decisionId: status.decisionId,
			idempotencyKey: status.idempotencyKey,
			proposalFamily: status.proposalFamily,
		}),
		classification,
		applicationId: status.applicationId,
		proposalId: status.proposalId,
		decisionId: status.decisionId,
		idempotencyKey: status.idempotencyKey,
		proposalFamily: status.proposalFamily,
		code,
		issues: status.issues,
		sourceRefs: status.sourceRefs,
		audit: status.audit,
		metadata: status.metadata,
	};
}

function diagnosticFromOutcomeStatus(
	status: WorkspaceProposalFamilyOutcomeRecordStatus,
	classification: WorkspaceProposalFamilyApplicationDiagnosticClass,
): WorkspaceProposalFamilyApplicationDiagnostic {
	const code = status.code ?? status.issues[0]?.code ?? status.state;
	return {
		kind: "workspace-proposal-family-application-diagnostic",
		diagnosticId: diagnosticId({
			classification,
			code,
			applicationId: status.applicationId,
			proposalId: status.proposalId,
			decisionId: status.decisionId,
			idempotencyKey: status.idempotencyKey,
			proposalFamily: status.proposalFamily,
			outcomeId: status.outcomeId,
		}),
		classification,
		applicationId: status.applicationId,
		proposalId: status.proposalId,
		decisionId: status.decisionId,
		idempotencyKey: status.idempotencyKey,
		proposalFamily: status.proposalFamily,
		code,
		issues: status.issues,
		sourceRefs: status.sourceRefs,
		audit: status.audit,
		metadata: status.metadata,
	};
}

function diagnosticFromOutcomeIndex(
	entry: WorkspaceProposalFamilyOutcomeIndexEntry,
): WorkspaceProposalFamilyApplicationDiagnostic {
	const code = entry.issues[0]?.code ?? "idempotency-conflict";
	return {
		kind: "workspace-proposal-family-application-diagnostic",
		diagnosticId: diagnosticId({
			classification: "idempotency-conflict",
			code,
			applicationId: entry.applicationId,
			proposalId: entry.proposalId,
			decisionId: entry.decisionId,
			idempotencyKey: entry.idempotencyKey,
			proposalFamily: entry.proposalFamily,
			indexKey: entry.indexKey,
		}),
		classification: "idempotency-conflict",
		applicationId: entry.applicationId,
		proposalId: entry.proposalId,
		decisionId: entry.decisionId,
		idempotencyKey: entry.idempotencyKey,
		proposalFamily: entry.proposalFamily,
		code,
		issues: entry.issues,
		sourceRefs: entry.sourceRefs,
		audit: entry.audit,
		metadata: { indexKey: entry.indexKey },
	};
}

function upsertDiagnostic(
	diagnostics: Map<string, WorkspaceProposalFamilyApplicationDiagnostic>,
	diagnostic: WorkspaceProposalFamilyApplicationDiagnostic,
): void {
	const existing = diagnostics.get(diagnostic.diagnosticId);
	if (existing === undefined) {
		diagnostics.set(diagnostic.diagnosticId, diagnostic);
		return;
	}
	diagnostics.set(diagnostic.diagnosticId, {
		...existing,
		issues: uniqueIssues([...existing.issues, ...diagnostic.issues]),
		sourceRefs: uniqueRefs([...existing.sourceRefs, ...diagnostic.sourceRefs]),
		audit: existing.audit ?? diagnostic.audit,
		metadata: { ...(diagnostic.metadata ?? {}), ...(existing.metadata ?? {}) },
	});
}

function diagnosticId(parts: Record<string, unknown>): string {
	return `workspace-proposal-family-application-diagnostic:${stableStringify(parts)}`;
}

function repairReviewState(
	state: WorkspaceProposalApplicationState | WorkspaceProposalFamilyOutcomeRecordState,
): boolean {
	return state === "repair-needed" || state === "idempotency-conflict";
}

function repairReviewClassification(
	classification: WorkspaceProposalFamilyApplicationDiagnosticClass | undefined,
): boolean {
	return classification === "missing-family-material" || classification === "idempotency-conflict";
}

function diagnosticSignature(diagnostic: WorkspaceProposalFamilyApplicationDiagnostic): string {
	return stableStringify({
		code: diagnostic.code,
		issues: diagnostic.issues,
		sourceRefs: diagnostic.sourceRefs,
		audit: diagnostic.audit,
		metadata: diagnostic.metadata,
	});
}

function repairRequestSignature(request: WorkspaceProposalRepairReviewRequest): string {
	return stableStringify({
		code: request.code,
		issues: request.issues,
		subjectRefs: request.subjectRefs ?? [],
		sourceRefs: request.sourceRefs,
		audit: request.audit,
	});
}

function sameApplicationCoordinates(
	status: WorkspaceProposalApplicationStatus,
	material: WorkspaceProposalFamilyOutcomeRecordStatus | WorkspaceProposalFamilyOutcomeIndexEntry,
): boolean {
	return (
		status.applicationId === material.applicationId &&
		status.proposalId === material.proposalId &&
		status.decisionId === material.decisionId &&
		status.idempotencyKey === material.idempotencyKey &&
		status.proposalFamily === material.proposalFamily
	);
}

function repairRequestFromApplicationStatus(
	status: WorkspaceProposalApplicationStatus,
): WorkspaceProposalRepairReviewRequest {
	const code = status.code ?? status.issues[0]?.code ?? status.state;
	return {
		kind: "workspace-proposal-repair-review-request",
		repairRequestId: repairRequestId(status, code),
		applicationId: status.applicationId,
		proposalId: status.proposalId,
		decisionId: status.decisionId,
		idempotencyKey: status.idempotencyKey,
		proposalFamily: status.proposalFamily,
		code,
		issues: status.issues,
		subjectRefs: [{ kind: "workspace-proposal-application-status", id: status.applicationId }],
		sourceRefs: status.sourceRefs,
		audit: status.audit,
	};
}

function repairRequestFromOutcomeStatus(
	status: WorkspaceProposalFamilyOutcomeRecordStatus,
	applicationStatus: WorkspaceProposalApplicationStatus,
): WorkspaceProposalRepairReviewRequest {
	const code = status.code ?? status.issues[0]?.code ?? status.state;
	return {
		kind: "workspace-proposal-repair-review-request",
		repairRequestId: repairRequestId(status, code, status.outcomeId),
		applicationId: status.applicationId,
		proposalId: status.proposalId,
		decisionId: status.decisionId,
		idempotencyKey: status.idempotencyKey,
		proposalFamily: status.proposalFamily,
		code,
		issues: status.issues,
		subjectRefs: [
			{ kind: "workspace-proposal-family-outcome-record-status", id: status.outcomeId },
		],
		sourceRefs: uniqueRefs([
			{ kind: "workspace-proposal-application-status", id: applicationStatus.applicationId },
			...status.sourceRefs,
		]),
		audit: status.audit ?? applicationStatus.audit,
	};
}

function repairRequestFromOutcomeIndex(
	entry: WorkspaceProposalFamilyOutcomeIndexEntry,
	applicationStatus: WorkspaceProposalApplicationStatus,
): WorkspaceProposalRepairReviewRequest {
	const code = entry.issues[0]?.code ?? "idempotency-conflict";
	return {
		kind: "workspace-proposal-repair-review-request",
		repairRequestId: repairRequestId(entry, code, entry.indexKey),
		applicationId: entry.applicationId,
		proposalId: entry.proposalId,
		decisionId: entry.decisionId,
		idempotencyKey: entry.idempotencyKey,
		proposalFamily: entry.proposalFamily,
		code,
		issues: entry.issues,
		subjectRefs: [{ kind: "workspace-proposal-family-outcome-index-entry", id: entry.indexKey }],
		sourceRefs: uniqueRefs([
			{ kind: "workspace-proposal-application-status", id: applicationStatus.applicationId },
			...entry.sourceRefs,
		]),
		audit: entry.audit ?? applicationStatus.audit,
	};
}

function upsertRepairRequest(
	requests: Map<string, WorkspaceProposalRepairReviewRequest>,
	request: WorkspaceProposalRepairReviewRequest,
): void {
	const existing = requests.get(request.repairRequestId);
	if (existing === undefined) {
		requests.set(request.repairRequestId, request);
		return;
	}
	requests.set(request.repairRequestId, {
		...existing,
		issues: uniqueIssues([...existing.issues, ...request.issues]),
		sourceRefs: uniqueRefs([...existing.sourceRefs, ...request.sourceRefs]),
		audit: existing.audit ?? request.audit,
	});
}

function repairRequestId(
	coordinates: Pick<
		WorkspaceProposalRepairReviewRequest,
		"applicationId" | "proposalId" | "decisionId" | "idempotencyKey" | "proposalFamily"
	>,
	code: string,
	extra?: string,
): string {
	return `workspace-proposal-repair-review:${stableStringify({
		applicationId: coordinates.applicationId,
		proposalId: coordinates.proposalId,
		decisionId: coordinates.decisionId,
		idempotencyKey: coordinates.idempotencyKey,
		proposalFamily: coordinates.proposalFamily,
		code,
		extra,
	})}`;
}

function diagnosticProjectionDeps(
	opts: WorkspaceProposalFamilyApplicationDiagnosticProjectorOptions,
): {
	readonly deps: readonly Node<unknown>[];
	readonly depKinds: readonly WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][];
} {
	const deps: Node<unknown>[] = [];
	const depKinds: WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][] = [];
	pushProjectionDep(deps, depKinds, opts.issues, "issue");
	pushProjectionDep(deps, depKinds, opts.audit, "audit");
	pushProjectionDep(deps, depKinds, opts.applicationStatuses, "application-status");
	pushProjectionDep(deps, depKinds, opts.outcomeStatuses, "outcome-status");
	pushProjectionDep(deps, depKinds, opts.outcomeIndex, "outcome-index");
	return { deps, depKinds };
}

function repairReviewProjectionDeps(opts: WorkspaceProposalRepairReviewProjectorOptions): {
	readonly deps: readonly Node<unknown>[];
	readonly depKinds: readonly WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][];
} {
	const deps: Node<unknown>[] = [];
	const depKinds: WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][] = [];
	pushProjectionDep(deps, depKinds, opts.applicationStatuses, "application-status");
	pushProjectionDep(deps, depKinds, opts.outcomeStatuses, "outcome-status");
	pushProjectionDep(deps, depKinds, opts.outcomeIndex, "outcome-index");
	return { deps, depKinds };
}

function repairReviewStatusProjectionDeps(
	opts: WorkspaceProposalRepairReviewStatusProjectorOptions,
): {
	readonly deps: readonly Node<unknown>[];
	readonly depKinds: readonly WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][];
} {
	const deps: Node<unknown>[] = [];
	const depKinds: WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][] = [];
	pushProjectionDep(deps, depKinds, opts.requests, "repair-request");
	pushProjectionDep(deps, depKinds, opts.decisions, "repair-decision");
	pushProjectionDep(deps, depKinds, opts.applicationStatuses, "application-status");
	pushProjectionDep(deps, depKinds, opts.applicationRecorded, "application-recorded");
	pushProjectionDep(deps, depKinds, opts.outcomeStatuses, "outcome-status");
	pushProjectionDep(deps, depKinds, opts.outcomeIndex, "outcome-index");
	return { deps, depKinds };
}

function repairReviewDecisionRecordingProjectionDeps(
	opts: WorkspaceProposalRepairReviewDecisionRecordingProjectorOptions,
): {
	readonly deps: readonly Node<unknown>[];
	readonly depKinds: readonly WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][];
} {
	const deps: Node<unknown>[] = [];
	const depKinds: WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][] = [];
	pushProjectionDep(deps, depKinds, opts.requests, "repair-request");
	pushProjectionDep(deps, depKinds, opts.recordingInputs, "repair-decision-recording-input");
	pushProjectionDep(deps, depKinds, opts.statuses, "repair-status");
	return { deps, depKinds };
}

function readModelProjectionDeps(
	opts: WorkspaceProposalFamilyApplicationReadModelProjectorOptions,
): {
	readonly deps: readonly Node<unknown>[];
	readonly depKinds: readonly WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][];
} {
	const deps: Node<unknown>[] = [];
	const depKinds: WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][] = [];
	pushProjectionDep(deps, depKinds, opts.diagnostics, "diagnostic");
	pushProjectionDep(deps, depKinds, opts.repairReviewStatuses, "repair-status");
	pushProjectionDep(deps, depKinds, opts.outcomeIndex, "outcome-index");
	pushProjectionDep(deps, depKinds, opts.outcomeStatuses, "outcome-status");
	pushProjectionDep(deps, depKinds, opts.outcomes, "outcome");
	return { deps, depKinds };
}

function readModelsProjectionDeps(
	opts: WorkspaceProposalFamilyApplicationReadModelsProjectorOptions,
): {
	readonly deps: readonly Node<unknown>[];
	readonly depKinds: readonly WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][];
} {
	const deps: Node<unknown>[] = [];
	const depKinds: WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][] = [];
	pushProjectionDep(deps, depKinds, opts.queries, "read-model-query");
	pushProjectionDep(deps, depKinds, opts.diagnostics, "diagnostic");
	pushProjectionDep(deps, depKinds, opts.repairReviewStatuses, "repair-status");
	pushProjectionDep(deps, depKinds, opts.outcomeIndex, "outcome-index");
	pushProjectionDep(deps, depKinds, opts.outcomeStatuses, "outcome-status");
	pushProjectionDep(deps, depKinds, opts.outcomes, "outcome");
	return { deps, depKinds };
}

function pushProjectionDep(
	deps: Node<unknown>[],
	depKinds: WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][],
	node: Node<unknown> | undefined,
	kind: WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"],
): void {
	if (node === undefined) return;
	deps.push(node);
	depKinds.push(kind);
}

function ingestDiagnosticInputFacts(
	ctx: Ctx,
	state: WorkspaceProposalFamilyApplicationProjectionState,
	depKinds: readonly WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"][],
): void {
	for (let index = 0; index < depKinds.length; index += 1) {
		for (const raw of depBatch(ctx, index) ?? []) {
			ingestDiagnosticInputFact(state, depKinds[index], raw);
		}
	}
}

function ingestDiagnosticInputFact(
	state: WorkspaceProposalFamilyApplicationProjectionState,
	kind: WorkspaceProposalFamilyApplicationDiagnosticInputFact["kind"],
	raw: unknown,
): void {
	switch (kind) {
		case "issue": {
			const issue = raw as WorkspaceProposalRecordedIssue;
			state.issues.set(issueKey(issue), issue);
			return;
		}
		case "audit": {
			const audit = raw as WorkspaceProposalFamilyApplicationAuditRecord;
			state.audit.set(audit.auditId, audit);
			return;
		}
		case "application-status": {
			const status = raw as WorkspaceProposalApplicationStatus;
			state.applicationStatuses.set(applicationStatusProjectionKey(status), status);
			return;
		}
		case "application-recorded": {
			const record = raw as WorkspaceProposalApplicationRecorded;
			state.applicationRecorded.set(applicationRecordedProjectionKey(record), record);
			return;
		}
		case "outcome-status": {
			const status = raw as WorkspaceProposalFamilyOutcomeRecordStatus;
			state.outcomeStatuses.set(outcomeStatusProjectionKey(status), status);
			return;
		}
		case "outcome-index": {
			const entry = raw as WorkspaceProposalFamilyOutcomeIndexEntry;
			state.outcomeIndex.set(outcomeIndexProjectionKey(entry), entry);
			return;
		}
		case "repair-request": {
			const request = raw as WorkspaceProposalRepairReviewRequest;
			state.repairRequests.set(request.repairRequestId, request);
			return;
		}
		case "repair-decision": {
			const decision = raw as WorkspaceProposalRepairReviewDecision;
			state.repairDecisions.set(decision.reviewDecisionId, decision);
			return;
		}
		case "repair-status": {
			const status = raw as WorkspaceProposalRepairReviewStatus;
			state.repairStatuses.set(repairReviewStatusProjectionKey(status), status);
			return;
		}
		case "repair-decision-recording-input": {
			const input = raw as WorkspaceProposalRepairReviewDecisionRecordingInput;
			state.repairDecisionRecordingInputs.set(repairReviewDecisionRecordingInputKey(input), input);
			return;
		}
		case "diagnostic": {
			const diagnostic = raw as WorkspaceProposalFamilyApplicationDiagnostic;
			state.diagnostics.set(diagnostic.diagnosticId, diagnostic);
			return;
		}
		case "read-model-query": {
			const query = raw as WorkspaceProposalFamilyApplicationReadModelQuery;
			state.readModelQueries.set(readModelQueryProjectionKey(query), query);
			return;
		}
		case "outcome": {
			const outcome = raw as WorkspaceProposalFamilyOutcomeRecord;
			state.outcomes.set(outcomeProjectionKey(outcome), outcome);
		}
	}
}

function familyProjectionState(ctx: Ctx): WorkspaceProposalFamilyApplicationProjectionState {
	return (
		ctx.state.get<WorkspaceProposalFamilyApplicationProjectionState>() ?? {
			issues: new Map(),
			audit: new Map(),
			applicationStatuses: new Map(),
			applicationRecorded: new Map(),
			outcomeStatuses: new Map(),
			outcomeIndex: new Map(),
			repairRequests: new Map(),
			repairDecisions: new Map(),
			repairStatuses: new Map(),
			repairDecisionRecordingInputs: new Map(),
			diagnostics: new Map(),
			readModelQueries: new Map(),
			outcomes: new Map(),
			emittedDiagnostics: new Map(),
			emittedRepairRequests: new Map(),
			emittedRepairStatuses: new Map(),
			emittedRepairDecisionRecordings: new Map(),
			emittedReadModels: new Map(),
			emittedRepairActionDescriptors: new Map(),
		}
	);
}

interface WorkspaceProposalRepairActionIntentGraphState {
	readonly intents: Map<
		string,
		{
			readonly intent: WorkspaceProposalRepairActionIntent;
			readonly signature: string;
			readonly conflict: boolean;
		}
	>;
	readonly descriptors: Map<string, WorkspaceProposalRepairActionDescriptor>;
	readonly requests: Map<string, WorkspaceProposalRepairReviewRequest>;
	readonly statuses: Map<string, WorkspaceProposalRepairReviewStatus>;
	readonly emittedResults: Map<string, string>;
	readonly emittedPreviews: Map<string, string>;
}

interface WorkspaceProposalRepairSuccessorReadyRequestPreparationGraphState<TDraft = unknown> {
	readonly previews: Map<string, WorkspaceProposalRepairSuccessorProposalIntakePreview>;
	readonly inputs: Map<
		string,
		WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationInput<TDraft>
	>;
	readonly emittedResults: Map<string, string>;
	readonly preparedReadyRequests: Map<string, WorkspaceProposalReadyRequest<TDraft>>;
}

function repairActionIntentGraphState(ctx: Ctx): WorkspaceProposalRepairActionIntentGraphState {
	return (
		ctx.state.get<WorkspaceProposalRepairActionIntentGraphState>() ?? {
			intents: new Map(),
			descriptors: new Map(),
			requests: new Map(),
			statuses: new Map(),
			emittedResults: new Map(),
			emittedPreviews: new Map(),
		}
	);
}

function repairSuccessorPreparationGraphState<TDraft>(
	ctx: Ctx,
): WorkspaceProposalRepairSuccessorReadyRequestPreparationGraphState<TDraft> {
	return (
		ctx.state.get<WorkspaceProposalRepairSuccessorReadyRequestPreparationGraphState<TDraft>>() ?? {
			previews: new Map(),
			inputs: new Map(),
			emittedResults: new Map(),
			preparedReadyRequests: new Map(),
		}
	);
}

function ingestRepairActionIntentGraphFacts(
	ctx: Ctx,
	state: WorkspaceProposalRepairActionIntentGraphState,
	hasStatuses: boolean,
): void {
	for (const raw of depBatch(ctx, 0) ?? []) {
		const intent = raw as WorkspaceProposalRepairActionIntent;
		const signature = repairActionIntentSignature(intent);
		const existing = state.intents.get(intent.intentId);
		if (existing === undefined) {
			state.intents.set(intent.intentId, { intent, signature, conflict: false });
		} else if (existing.signature !== signature) {
			state.intents.set(intent.intentId, { ...existing, conflict: true });
		}
	}
	for (const raw of depBatch(ctx, 1) ?? []) {
		const descriptor = raw as WorkspaceProposalRepairActionDescriptor;
		state.descriptors.set(descriptor.descriptorId, descriptor);
	}
	for (const raw of depBatch(ctx, 2) ?? []) {
		const request = raw as WorkspaceProposalRepairReviewRequest;
		state.requests.set(request.repairRequestId, request);
	}
	if (!hasStatuses) return;
	for (const raw of depBatch(ctx, 3) ?? []) {
		const status = raw as WorkspaceProposalRepairReviewStatus;
		state.statuses.set(repairReviewStatusProjectionKey(status), status);
	}
}

function uniqueIssues(
	issues: readonly WorkspaceProposalRecordedIssue[],
): readonly WorkspaceProposalRecordedIssue[] {
	const seen = new Set<string>();
	const out: WorkspaceProposalRecordedIssue[] = [];
	for (const issue of issues) {
		const key = issueKey(issue);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(issue);
	}
	return out;
}

function issueKey(issue: WorkspaceProposalRecordedIssue): string {
	return stableStringify({
		code: issue.code,
		subjectId: issue.subjectId,
		refs: issue.refs,
		metadata: issue.metadata,
		message: issue.message,
	});
}

function applicationStatusProjectionKey(status: WorkspaceProposalApplicationStatus): string {
	return stableStringify({
		kind: status.kind,
		applicationId: status.applicationId,
		proposalId: status.proposalId,
		decisionId: status.decisionId,
		idempotencyKey: status.idempotencyKey,
		proposalFamily: status.proposalFamily,
	});
}

function applicationRecordedProjectionKey(record: WorkspaceProposalApplicationRecorded): string {
	return stableStringify({
		kind: record.kind,
		applicationRecordId: record.applicationRecordId,
		applicationId: record.applicationId,
		proposalId: record.proposalId,
		decisionId: record.decisionId,
	});
}

function outcomeStatusProjectionKey(status: WorkspaceProposalFamilyOutcomeRecordStatus): string {
	return stableStringify({
		kind: status.kind,
		outcomeId: status.outcomeId,
		applicationId: status.applicationId,
		proposalId: status.proposalId,
		decisionId: status.decisionId,
		idempotencyKey: status.idempotencyKey,
		proposalFamily: status.proposalFamily,
	});
}

function outcomeIndexProjectionKey(entry: WorkspaceProposalFamilyOutcomeIndexEntry): string {
	return stableStringify({
		kind: entry.kind,
		indexKey: entry.indexKey,
		applicationId: entry.applicationId,
		proposalId: entry.proposalId,
		decisionId: entry.decisionId,
		idempotencyKey: entry.idempotencyKey,
		proposalFamily: entry.proposalFamily,
	});
}

function outcomeProjectionKey(outcome: WorkspaceProposalFamilyOutcomeRecord): string {
	return stableStringify({
		ref: workspaceProposalFamilyOutcomeRef(outcome),
	});
}

function repairReviewStatusProjectionKey(status: WorkspaceProposalRepairReviewStatus): string {
	return stableStringify({
		repairRequestId: status.repairRequestId,
		applicationId: status.applicationId,
		proposalId: status.proposalId,
		decisionId: status.decisionId,
		idempotencyKey: status.idempotencyKey,
		proposalFamily: status.proposalFamily,
	});
}

function repairReviewStatusProjectionKeyFromRequest(
	request: WorkspaceProposalRepairReviewRequest,
): string {
	return stableStringify({
		repairRequestId: request.repairRequestId,
		applicationId: request.applicationId,
		proposalId: request.proposalId,
		decisionId: request.decisionId,
		idempotencyKey: request.idempotencyKey,
		proposalFamily: request.proposalFamily,
	});
}

function repairReviewDecisionRecordingInputKey(
	input: WorkspaceProposalRepairReviewDecisionRecordingInput,
): string {
	return stableStringify({
		reviewDecisionId: stringField(
			(input as { readonly reviewDecisionId?: unknown }).reviewDecisionId,
		),
		signature: repairReviewDecisionRecordingInputSignature(input),
	});
}

function readModelQueryProjectionKey(
	query: WorkspaceProposalFamilyApplicationReadModelQuery,
): string {
	const queryId = stringField((query as { readonly queryId?: unknown }).queryId);
	const viewId = stringField((query as { readonly viewId?: unknown }).viewId);
	return stableStringify({
		currentViewId: viewId ?? queryId,
	});
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function projectWorkspaceProposalRequiredInputResponseApplication<TValue = unknown>(
	record: WorkspaceProposalRecorded<RequiredInputResponseProposed<TValue>>,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalRequiredInputResponseApplicationOptions,
): WorkspaceProposalRequiredInputResponseApplicationResult<TValue> {
	const envelopeIssues = validateWorkspaceProposalApplicationEnvelope(record, decision, {
		expectedFamily: "required-input-response",
	});
	const familyIssues = familySpecificEnvelopeIssues(envelopeIssues);
	const draft = record.draft;
	const sourceRefs = applicationSourceRefs(
		record,
		decision,
		options.applicationId,
		options.sourceRefs,
		options.audit,
	);
	const contextIssues = dataOnlyFamilyIssues(record, "requiredInputApplicationOptions", options);
	const draftIssues = requiredInputDraftIssues(record, draft, options.gate, options.request);
	const idIssues = applicationIdIssues(record, options.applicationId);
	const issues = [...familyIssues, ...contextIssues, ...idIssues, ...draftIssues];
	const applied =
		envelopeIssues.length === 0 &&
		contextIssues.length === 0 &&
		idIssues.length === 0 &&
		draftIssues.length === 0 &&
		draft !== undefined
			? ({
					kind: "required-input-response-applied",
					applicationId: options.applicationId,
					admissionId: decision.decisionId,
					proposalId: record.proposalId,
					requestId: draft.requestId,
					workItemId: draft.workItemId,
					value: draft.value,
					summary: draft.summary,
					sourceRefs,
					evidenceRefs: draft.evidenceRefs,
					artifactRefs: draft.artifactRefs,
					appliedAtMs: options.appliedAtMs,
					metadata: familyMetadata(record, decision, options.audit, draft.metadata),
				} satisfies RequiredInputResponseApplied<TValue>)
			: undefined;
	const emittedFactRefs =
		applied === undefined
			? []
			: [workspaceProposalApplicationFamilyRef(record.proposalFamily, applied, { sourceRefs })];
	const result = projectWorkspaceProposalApplicationStatus(record, decision, {
		applicationId: options.applicationId,
		emittedFactRefs,
		familyIssues: issues,
		sourceRefs,
		audit: options.audit,
	});
	return { ...result, applied };
}

export function projectWorkspaceProposalWorkItemSpawnApplication<TInput = unknown>(
	record: WorkspaceProposalRecorded<{
		readonly kind: "work-item-spawn-proposed";
		readonly proposedWorkItemId?: string;
		readonly parentWorkItemId?: string;
		readonly draft: WorkItemDraft<TInput>;
		readonly proposedBy?: string;
		readonly idempotencyKey?: string;
		readonly sourceRefs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	}>,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalWorkItemSpawnApplicationOptions<TInput>,
): WorkspaceProposalWorkItemSpawnApplicationResult<TInput> {
	const envelopeIssues = validateWorkspaceProposalApplicationEnvelope(record, decision, {
		expectedFamily: "work-item-spawn",
	});
	const familyIssues = familySpecificEnvelopeIssues(envelopeIssues);
	const draft = record.draft;
	const sourceRefs = applicationSourceRefs(
		record,
		decision,
		options.applicationId,
		options.sourceRefs,
		options.audit,
	);
	const contextIssues = dataOnlyFamilyIssues(record, "workItemSpawnApplicationOptions", options);
	const childWorkItemId =
		typeof draft?.proposedWorkItemId === "string" ? draft.proposedWorkItemId : "";
	const draftIssues = spawnDraftIssues(record, draft, childWorkItemId, options.existingWorkItems);
	const idIssues = applicationIdIssues(record, options.applicationId);
	const issues = [...familyIssues, ...contextIssues, ...idIssues, ...draftIssues];
	const created =
		envelopeIssues.length === 0 &&
		contextIssues.length === 0 &&
		idIssues.length === 0 &&
		draftIssues.length === 0 &&
		draft !== undefined
			? ({
					kind: "work-item-created",
					eventId: `${options.applicationId}:work-item-created:${childWorkItemId}`,
					workItemId: childWorkItemId,
					draft: draft.draft,
					authorId: draft.proposedBy,
					createdAtMs: options.createdAtMs,
					sourceRefs,
					metadata: {
						...(draft.metadata ?? {}),
						...familyMetadata(record, decision, options.audit, {
							idempotencyKey: draft.idempotencyKey ?? record.idempotencyKey,
						}),
					},
				} satisfies WorkItemCreated<TInput>)
			: undefined;
	const linked =
		created !== undefined &&
		draft !== undefined &&
		options.linkParent === true &&
		typeof draft.parentWorkItemId === "string" &&
		draft.parentWorkItemId.trim() !== ""
			? ({
					kind: "work-item-linked",
					eventId: `${options.applicationId}:work-item-linked:${draft.parentWorkItemId}:${childWorkItemId}`,
					linkId: `${draft.parentWorkItemId}:spawned-from:${childWorkItemId}`,
					fromWorkItemId: childWorkItemId,
					toWorkItemId: draft.parentWorkItemId,
					linkKind: "spawned-from",
					direction: "directed",
					sourceRefs,
					linkedAtMs: options.linkedAtMs,
					idempotencyKey: `${record.idempotencyKey}:spawned-from`,
					metadata: familyMetadata(record, decision, options.audit),
				} satisfies WorkItemLinked)
			: undefined;
	const emittedFactRefs: WorkspaceProposalApplicationFamilyRef[] = [];
	if (created !== undefined) {
		emittedFactRefs.push(
			workspaceProposalApplicationFamilyRef(record.proposalFamily, created, { sourceRefs }),
		);
	}
	if (linked !== undefined) {
		emittedFactRefs.push(
			workspaceProposalApplicationFamilyRef(record.proposalFamily, linked, { sourceRefs }),
		);
	}
	const result = projectWorkspaceProposalApplicationStatus(record, decision, {
		applicationId: options.applicationId,
		emittedFactRefs,
		familyIssues: issues,
		sourceRefs,
		audit: options.audit,
	});
	return { ...result, created, linked };
}

export function projectWorkspaceProposalWorkItemLinkApplication<TInput = unknown>(
	record: WorkspaceProposalRecorded<WorkItemLinkProposalDraft>,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalWorkItemLinkApplicationOptions<TInput>,
): WorkspaceProposalWorkItemLinkApplicationResult {
	const envelopeIssues = validateWorkspaceProposalApplicationEnvelope(record, decision, {
		expectedFamily: "work-item-link",
	});
	const familyIssues = familySpecificEnvelopeIssues(envelopeIssues);
	const draft = record.draft;
	const sourceRefs = applicationSourceRefs(
		record,
		decision,
		options.applicationId,
		options.sourceRefs,
		options.audit,
	);
	const contextIssues = dataOnlyFamilyIssues(record, "workItemLinkApplicationOptions", options);
	const draftIssues = linkDraftIssues(record, draft, options.workItems, options.links);
	const idIssues = applicationIdIssues(record, options.applicationId);
	const issues = [...familyIssues, ...contextIssues, ...idIssues, ...draftIssues];
	const action = draft?.action ?? "link";
	const linked =
		envelopeIssues.length === 0 &&
		contextIssues.length === 0 &&
		idIssues.length === 0 &&
		draftIssues.length === 0 &&
		draft !== undefined &&
		action === "link"
			? ({
					kind: "work-item-linked",
					eventId: draft.eventId ?? `${options.applicationId}:work-item-linked:${draft.linkId}`,
					linkId: draft.linkId,
					fromWorkItemId: draft.fromWorkItemId ?? "",
					toWorkItemId: draft.toWorkItemId ?? "",
					linkKind: draft.linkKind ?? "",
					direction: draft.direction ?? "directed",
					sourceRefs,
					linkedAtMs: options.linkedAtMs,
					idempotencyKey: record.idempotencyKey,
					metadata: familyMetadata(record, decision, options.audit, draft.metadata),
				} satisfies WorkItemLinked)
			: undefined;
	const unlinked =
		envelopeIssues.length === 0 &&
		contextIssues.length === 0 &&
		idIssues.length === 0 &&
		draftIssues.length === 0 &&
		draft !== undefined &&
		action === "unlink"
			? ({
					kind: "work-item-unlinked",
					eventId: draft.eventId ?? `${options.applicationId}:work-item-unlinked:${draft.linkId}`,
					linkId: draft.linkId,
					reason: draft.reason,
					sourceRefs,
					unlinkedAtMs: options.unlinkedAtMs,
					metadata: familyMetadata(record, decision, options.audit, draft.metadata),
				} satisfies WorkItemUnlinked)
			: undefined;
	const emittedFactRefs: WorkspaceProposalApplicationFamilyRef[] = [];
	if (linked !== undefined) {
		emittedFactRefs.push(
			workspaceProposalApplicationFamilyRef(record.proposalFamily, linked, { sourceRefs }),
		);
	}
	if (unlinked !== undefined) {
		emittedFactRefs.push(
			workspaceProposalApplicationFamilyRef(record.proposalFamily, unlinked, { sourceRefs }),
		);
	}
	const result = projectWorkspaceProposalApplicationStatus(record, decision, {
		applicationId: options.applicationId,
		emittedFactRefs,
		familyIssues: issues,
		sourceRefs,
		audit: options.audit,
	});
	return { ...result, linked, unlinked };
}

export function projectWorkspaceProposalDomainActionApplicationStatus(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalDomainActionApplicationStatusOptions,
): WorkspaceProposalApplicationResult {
	const envelopeIssues = validateWorkspaceProposalApplicationEnvelope(record, decision, {
		expectedFamily: "work-item-domain-action",
	});
	const familyIssues = familySpecificEnvelopeIssues(envelopeIssues);
	const sourceRefs = applicationSourceRefs(
		record,
		decision,
		options.applicationId,
		options.sourceRefs,
		options.audit,
	);
	const contextIssues = dataOnlyFamilyIssues(record, "domainActionApplicationOptions", options);
	const idIssues = applicationIdIssues(record, options.applicationId);
	const provenanceIssues =
		envelopeIssues.length === 0 && contextIssues.length === 0 && idIssues.length === 0
			? domainActionProvenanceIssues(record, decision, options)
			: [];
	const emittedFactRefs =
		envelopeIssues.length === 0 &&
		contextIssues.length === 0 &&
		idIssues.length === 0 &&
		provenanceIssues.length === 0
			? options.emittedFacts.map((fact) =>
					workspaceProposalApplicationFamilyRef(record.proposalFamily, fact, { sourceRefs }),
				)
			: [];
	const applicationRef =
		envelopeIssues.length === 0 &&
		contextIssues.length === 0 &&
		idIssues.length === 0 &&
		provenanceIssues.length === 0 &&
		options.domainApplication !== undefined
			? workspaceProposalApplicationFamilyRef(record.proposalFamily, options.domainApplication, {
					sourceRefs,
				})
			: undefined;
	return projectWorkspaceProposalApplicationStatus(record, decision, {
		applicationId: options.applicationId,
		emittedFactRefs:
			applicationRef === undefined ? emittedFactRefs : [...emittedFactRefs, applicationRef],
		familyIssues: [...familyIssues, ...contextIssues, ...idIssues, ...provenanceIssues],
		sourceRefs,
		audit: options.audit,
	});
}

function applicationIdIssues(
	record: WorkspaceProposalRecorded,
	applicationId: string,
): readonly WorkspaceProposalRecordedIssue[] {
	return blank(applicationId)
		? [
				familyIssue(
					"missing-application-id",
					"Workspace proposal application requires applicationId",
					record,
				),
			]
		: [];
}

function domainActionProvenanceIssues(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalDomainActionApplicationStatusOptions,
): readonly WorkspaceProposalRecordedIssue[] {
	const requiredRefs = [
		{ kind: "workspace-proposal-recorded", id: record.proposalId },
		{ kind: "workspace-proposal-admission-decision", id: decision.decisionId },
		{ kind: "workspace-proposal-application-status", id: options.applicationId },
	] as const;
	const issues: WorkspaceProposalRecordedIssue[] = [];
	const checkRefs = (
		label: string,
		id: string,
		sourceRefs: readonly SourceRef[] | undefined,
		metadata: Record<string, unknown> | undefined,
	): void => {
		for (const required of requiredRefs) {
			if (
				sourceRefs?.some(
					(sourceRef) => sourceRef.kind === required.kind && sourceRef.id === required.id,
				)
			) {
				continue;
			}
			issues.push(
				familyIssue(
					"missing-family-application-provenance",
					`${label} '${id}' must carry D430 Workspace proposal application provenance`,
					record,
				),
			);
			return;
		}
		if (metadata?.applicationIdempotencyKey !== record.idempotencyKey) {
			issues.push(
				familyIssue(
					"missing-family-application-provenance",
					`${label} '${id}' must carry D430 idempotency provenance`,
					record,
				),
			);
		}
	};
	for (const fact of options.emittedFacts) {
		checkRefs("WorkItem domain action fact", fact.eventId, fact.sourceRefs, fact.metadata);
	}
	if (options.domainApplication !== undefined) {
		checkRefs(
			"WorkItem domain action application",
			options.domainApplication.applicationId,
			options.domainApplication.sourceRefs,
			options.domainApplication.metadata,
		);
	}
	return issues;
}

type WorkspaceProposalFamilyOutcomeOptions =
	| WorkspaceProposalRequiredInputResponseOutcomeOptions
	| WorkspaceProposalWorkItemSpawnOutcomeOptions
	| WorkspaceProposalWorkItemLinkOutcomeOptions
	| WorkspaceProposalDomainActionOutcomeOptions;

interface FamilyOutcomeBuilderResult<TOutcome extends WorkspaceProposalFamilyOutcomeRecord> {
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly outcome?: Omit<TOutcome, "sourceRefs" | "audit" | "metadata">;
	readonly partial?: boolean;
}

function recordFamilyOutcome<TOutcome extends WorkspaceProposalFamilyOutcomeRecord>(
	status: WorkspaceProposalApplicationStatus,
	expectedFamily: WorkspaceProposalFamily,
	options: WorkspaceProposalFamilyOutcomeOptions,
	build: () => FamilyOutcomeBuilderResult<TOutcome>,
): WorkspaceProposalFamilyOutcomeRecordResult<TOutcome> {
	const baseIssues = familyOutcomeBaseIssues(status, expectedFamily, options);
	const built = baseIssues.length === 0 ? build() : { issues: [] };
	const issues = [...baseIssues, ...built.issues];
	const sourceRefs = familyOutcomeSourceRefs(status, options);
	const outcome =
		issues.length === 0 && built.outcome !== undefined
			? ({
					...built.outcome,
					sourceRefs,
					audit: options.audit ?? status.audit,
					metadata: options.metadata,
				} as TOutcome)
			: undefined;
	const outcomeRefs = outcome === undefined ? [] : [workspaceProposalFamilyOutcomeRef(outcome)];
	return {
		outcome,
		status: {
			kind: "workspace-proposal-family-outcome-record-status",
			outcomeId: options.outcomeId,
			applicationId: status.applicationId,
			proposalId: status.proposalId,
			decisionId: status.decisionId,
			idempotencyKey: status.idempotencyKey,
			proposalFamily: status.proposalFamily,
			state:
				baseIssues.length > 0
					? "not-recorded"
					: familyOutcomeRecordState(issues, built.partial === true, outcome, options.horizon),
			code: issues[0]?.code,
			issues,
			outcomeRefs,
			sourceRefs,
			audit: options.audit ?? status.audit,
			metadata: options.metadata,
		},
		issues,
	};
}

function familyOutcomeBaseIssues(
	status: WorkspaceProposalApplicationStatus,
	expectedFamily: WorkspaceProposalFamily,
	options: WorkspaceProposalFamilyOutcomeOptions,
): readonly WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	issues.push(...familyOutcomeDataOnlyIssues(status, "familyOutcomeApplicationStatus", status));
	issues.push(...familyOutcomeDataOnlyIssues(status, "familyOutcomeOptions", options));
	if (status.kind !== "workspace-proposal-application-status") {
		issues.push(
			familyOutcomeIssue(
				status,
				"malformed-application-status",
				"Workspace family outcome requires application status material",
			),
		);
	}
	if (status.state !== "applied" && status.state !== "recorded") {
		issues.push(
			familyOutcomeIssue(
				status,
				"application-not-recordable",
				"Workspace family outcome requires applied application status",
			),
		);
	}
	if (status.issues.length > 0) {
		issues.push(
			familyOutcomeIssue(
				status,
				"application-status-has-issues",
				"Workspace family outcome requires issue-free application status",
			),
		);
	}
	if (status.proposalFamily !== expectedFamily) {
		issues.push(
			familyOutcomeIssue(
				status,
				"unexpected-proposal-family",
				`Workspace family outcome expected '${expectedFamily}' application status`,
			),
		);
	}
	if (blank(options.outcomeId)) {
		issues.push(
			familyOutcomeIssue(status, "missing-required-field", "Family outcome requires outcomeId"),
		);
	}
	if (!status.emittedFactRefs.some((ref) => ref.proposalFamily === expectedFamily)) {
		issues.push(
			familyOutcomeIssue(
				status,
				"missing-family-application-ref",
				"Family outcome requires matching family application refs",
			),
		);
	}
	if (options.horizon !== undefined) {
		if (options.horizon.kind !== "workspace-proposal-family-evidence-horizon") {
			issues.push(
				familyOutcomeIssue(
					status,
					"malformed-family-evidence-horizon",
					"Evidence horizon is malformed",
				),
			);
		}
		if (options.horizon.applicationId !== status.applicationId) {
			issues.push(
				familyOutcomeIssue(
					status,
					"proposal-target-mismatch",
					"Evidence horizon applicationId does not match application status",
				),
			);
		}
	}
	if (options.policy !== undefined) {
		if (options.policy.kind !== "workspace-proposal-family-completion-policy") {
			issues.push(
				familyOutcomeIssue(
					status,
					"malformed-family-completion-policy",
					"Completion policy is malformed",
				),
			);
		}
		if (
			options.policy.proposalFamily !== undefined &&
			options.policy.proposalFamily !== expectedFamily
		) {
			issues.push(
				familyOutcomeIssue(
					status,
					"unexpected-proposal-family",
					"Completion policy proposalFamily does not match family outcome",
				),
			);
		}
	}
	return issues;
}

function familyOutcomeRecordState(
	issues: readonly WorkspaceProposalRecordedIssue[],
	partial: boolean,
	outcome: WorkspaceProposalFamilyOutcomeRecord | undefined,
	horizon: WorkspaceProposalFamilyEvidenceHorizon | undefined,
): WorkspaceProposalFamilyOutcomeRecordState {
	if (outcome !== undefined) return "recorded";
	if (partial && issues.length === 0) return "partial";
	if (issues.length === 0) return "not-recorded";
	return horizon?.state === "closed" ? "repair-needed" : "pending";
}

function familyOutcomeCoordinates(
	status: WorkspaceProposalApplicationStatus,
	options: WorkspaceProposalFamilyOutcomeOptions,
) {
	return {
		outcomeId: options.outcomeId,
		applicationId: status.applicationId,
		proposalId: status.proposalId,
		decisionId: status.decisionId,
		idempotencyKey: status.idempotencyKey,
	};
}

function familyOutcomeSourceRefs(
	status: WorkspaceProposalApplicationStatus,
	options: WorkspaceProposalFamilyOutcomeOptions,
): readonly SourceRef[] {
	return uniqueRefs([
		{ kind: "workspace-proposal-application-status", id: status.applicationId },
		...status.sourceRefs,
		...(options.sourceRefs ?? []),
		...(options.horizon?.sourceRefs ?? []),
		...(options.policy?.sourceRefs ?? []),
		...(options.audit?.sourceRefs ?? []),
	]);
}

function nonBlankFieldIssue(
	status: WorkspaceProposalApplicationStatus,
	value: unknown,
	field: string,
): readonly WorkspaceProposalRecordedIssue[] {
	return blank(value)
		? [familyOutcomeIssue(status, "missing-required-field", `Family outcome requires ${field}`)]
		: [];
}

function sourceRefFieldIssue(
	status: WorkspaceProposalApplicationStatus,
	value: unknown,
	field: string,
): readonly WorkspaceProposalRecordedIssue[] {
	return isSourceRef(value)
		? []
		: [familyOutcomeIssue(status, "missing-required-field", `Family outcome requires ${field}`)];
}

function isSourceRef(value: unknown): value is SourceRef {
	return isRecord(value) && nonBlankString(value.kind) && nonBlankString(value.id);
}

function familyOutcomeDataOnlyIssues(
	status: WorkspaceProposalApplicationStatus,
	label: string,
	value: unknown,
): readonly WorkspaceProposalRecordedIssue[] {
	return workspaceProposalDataOnlyIssues(value, label).map((entry) => ({
		...entry,
		subjectId: entry.subjectId ?? status.proposalId,
		refs: entry.refs ?? familyOutcomeIssueRefs(status),
	}));
}

function familyOutcomeIssue(
	subject:
		| WorkspaceProposalApplicationStatus
		| WorkspaceProposalFamilyOutcomeRecord
		| Pick<
				WorkspaceProposalFamilyOutcomeRecord,
				"applicationId" | "proposalId" | "decisionId" | "idempotencyKey" | "sourceRefs"
		  >,
	code: string,
	message: string,
): WorkspaceProposalRecordedIssue {
	return {
		kind: "issue",
		source: "workspace-proposal",
		severity: "error",
		code,
		message,
		subjectId: subject.proposalId,
		refs: familyOutcomeIssueRefs(subject),
	};
}

function familyOutcomeIssueRefs(
	subject:
		| WorkspaceProposalApplicationStatus
		| WorkspaceProposalFamilyOutcomeRecord
		| Pick<
				WorkspaceProposalFamilyOutcomeRecord,
				"applicationId" | "proposalId" | "decisionId" | "idempotencyKey" | "sourceRefs"
		  >,
): readonly string[] {
	return [
		`workspace-proposal-application-status:${subject.applicationId}`,
		`workspace-proposal-recorded:${subject.proposalId}`,
		`workspace-proposal-admission-decision:${subject.decisionId}`,
		...subject.sourceRefs.map((sourceRef) => `${sourceRef.kind}:${sourceRef.id}`),
	];
}

function familyOutcomeIndexKey(outcome: WorkspaceProposalFamilyOutcomeRecord): string {
	return `${outcome.applicationId}:${outcome.idempotencyKey}`;
}

function familyOutcomeSignature(outcome: WorkspaceProposalFamilyOutcomeRecord): string {
	return stableStringify({
		ref: workspaceProposalFamilyOutcomeRef(outcome),
		result: familyOutcomeResultSignatureMaterial(outcome),
	});
}

function familyOutcomeResultSignatureMaterial(
	outcome: WorkspaceProposalFamilyOutcomeRecord,
): unknown {
	switch (outcome.kind) {
		case "workspace-proposal-required-input-response-outcome-recorded":
			return {
				requiredInputRequestId: outcome.requiredInputRequestId,
				responseRef: outcome.responseRef,
			};
		case "workspace-proposal-work-item-spawn-outcome-recorded":
			return { workItemRef: outcome.workItemRef };
		case "workspace-proposal-work-item-link-outcome-recorded":
			return { linkRef: outcome.linkRef };
		case "workspace-proposal-domain-action-outcome-recorded":
			return { actionRef: outcome.actionRef };
	}
}

function dataOnlyFamilyIssues(
	record: WorkspaceProposalRecorded,
	label: string,
	value: unknown,
): readonly WorkspaceProposalRecordedIssue[] {
	return workspaceProposalDataOnlyIssues(value, label).map((entry) => ({
		...entry,
		subjectId: entry.subjectId ?? record.proposalId,
		refs: entry.refs ?? recordRefs(record),
	}));
}

function familySpecificEnvelopeIssues(
	issues: readonly WorkspaceProposalRecordedIssue[],
): readonly WorkspaceProposalRecordedIssue[] {
	return issues.filter((entry) => entry.code === "unexpected-proposal-family");
}

function requiredInputDraftIssues<TValue>(
	record: WorkspaceProposalRecorded,
	draft: RequiredInputResponseProposed<TValue> | undefined,
	gate: RequiredInputGate,
	request: RequiredInputRequest | undefined,
): readonly WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [
		...requiredInputDraftShapeIssues(record, draft),
	];
	if (issues.length > 0) return issues;
	const responseDraft = draft as RequiredInputResponseProposed<TValue>;
	if (gate.kind !== "required-input-gate") {
		issues.push(
			familyIssue("malformed-family-context", "Required Input gate is malformed", record),
		);
		return issues;
	}
	if (gate.status !== "requested" && gate.status !== "response-proposed") {
		issues.push(familyIssue("stale-target-ref", "Required Input gate is not open", record));
	}
	if (gate.requestId !== responseDraft.requestId || gate.workItemId !== responseDraft.workItemId) {
		issues.push(
			familyIssue(
				"proposal-target-mismatch",
				"Required Input response does not match gate target",
				record,
			),
		);
	}
	if (
		request !== undefined &&
		(request.requestId !== responseDraft.requestId ||
			request.workItemId !== responseDraft.workItemId)
	) {
		issues.push(
			familyIssue(
				"proposal-target-mismatch",
				"Required Input response does not match request target",
				record,
			),
		);
	}
	return issues;
}

function requiredInputDraftShapeIssues<TValue>(
	record: WorkspaceProposalRecorded,
	draft: RequiredInputResponseProposed<TValue> | undefined,
): readonly WorkspaceProposalRecordedIssue[] {
	return !isRecord(draft) || draft.kind !== "required-input-response-proposed"
		? [familyIssue("malformed-family-draft", "Required Input response draft is malformed", record)]
		: [];
}

function spawnDraftIssues<TInput>(
	record: WorkspaceProposalRecorded,
	draft:
		| {
				readonly kind: "work-item-spawn-proposed";
				readonly proposedWorkItemId?: string;
				readonly draft: WorkItemDraft<TInput>;
		  }
		| undefined,
	childWorkItemId: string,
	existingWorkItems: readonly WorkItemProjection<TInput>[] | undefined,
): readonly WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	if (!isRecord(draft) || draft.kind !== "work-item-spawn-proposed") {
		issues.push(familyIssue("malformed-family-draft", "WorkItem spawn draft is malformed", record));
		return issues;
	}
	if (childWorkItemId.trim() === "") {
		issues.push(
			familyIssue("missing-required-field", "WorkItem spawn requires proposedWorkItemId", record),
		);
		return issues;
	}
	if (existingWorkItems?.some((item) => item.workItemId === childWorkItemId) === true) {
		issues.push(
			familyIssue("duplicate-id", `WorkItem '${childWorkItemId}' already exists`, record),
		);
	}
	for (const issue of validateWorkItemDraft(draft.draft, { workItemId: childWorkItemId })) {
		issues.push({
			kind: "issue",
			source: "workspace-proposal",
			severity: "error",
			code: issue.code,
			message: issue.message,
			subjectId: record.proposalId,
			refs: recordRefs(record),
		});
	}
	return issues;
}

function linkDraftIssues<TInput>(
	record: WorkspaceProposalRecorded,
	draft: WorkItemLinkProposalDraft | undefined,
	workItems: readonly WorkItemProjection<TInput>[] | undefined,
	links: readonly WorkItemLinkProjection[] | undefined,
): readonly WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	if (!isRecord(draft) || draft.kind !== "work-item-link-proposal") {
		issues.push(familyIssue("malformed-family-draft", "WorkItem link draft is malformed", record));
		return issues;
	}
	if (!nonBlankString(draft.linkId)) {
		issues.push(
			familyIssue("missing-required-field", "WorkItem link proposal requires linkId", record),
		);
		return issues;
	}
	if (draft.action !== undefined && draft.action !== "link" && draft.action !== "unlink") {
		issues.push(
			familyIssue(
				"unsupported-family-action",
				"WorkItem link proposal action must be link or unlink",
				record,
			),
		);
		return issues;
	}
	if ((draft.action ?? "link") === "unlink") {
		const existing = links?.find((link) => link.linkId === draft.linkId);
		if (existing === undefined || !existing.active) {
			issues.push(
				familyIssue("unknown-target-ref", "WorkItem unlink references no active link", record),
			);
		}
		return issues;
	}
	if (blank(draft.fromWorkItemId) || blank(draft.toWorkItemId) || blank(draft.linkKind)) {
		issues.push(
			familyIssue(
				"missing-required-field",
				"WorkItem link proposal requires fromWorkItemId, toWorkItemId, and linkKind",
				record,
			),
		);
		return issues;
	}
	if (
		workItems !== undefined &&
		(!workItems.some((item) => item.workItemId === draft.fromWorkItemId) ||
			!workItems.some((item) => item.workItemId === draft.toWorkItemId))
	) {
		issues.push(
			familyIssue(
				"unknown-target-ref",
				"WorkItem link proposal references unknown WorkItem",
				record,
			),
		);
	}
	return issues;
}

function familyIssue(
	code: string,
	message: string,
	record: WorkspaceProposalRecorded,
): WorkspaceProposalRecordedIssue {
	return {
		kind: "issue",
		source: "workspace-proposal",
		severity: "error",
		code,
		message,
		subjectId: record.proposalId,
		refs: recordRefs(record),
	};
}

function familyMetadata(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	audit: WorkspaceProposalAuditMaterial | undefined,
	metadata: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		...metadata,
		applicationProposalId: record.proposalId,
		applicationDecisionId: decision.decisionId,
		applicationIntakeRequestId: record.intakeRequestId,
		applicationIdempotencyKey: record.idempotencyKey,
		applicationPolicyRefs: record.policyRefs,
		applicationAudit: audit ?? record.audit ?? decision.audit,
	};
}

function applicationSourceRefs(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	applicationId: string,
	sourceRefs: readonly SourceRef[] | undefined,
	audit: WorkspaceProposalAuditMaterial | undefined,
): readonly SourceRef[] {
	return uniqueRefs([
		{ kind: "workspace-proposal-recorded", id: record.proposalId },
		{ kind: "workspace-proposal-admission-decision", id: decision.decisionId },
		{ kind: "workspace-proposal-application-status", id: applicationId },
		...record.sourceRefs,
		...decision.sourceRefs,
		...(record.audit?.sourceRefs ?? []),
		...(decision.audit?.sourceRefs ?? []),
		...(audit?.sourceRefs ?? []),
		...(sourceRefs ?? []),
	]);
}

function uniqueRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
	const seen = new Set<string>();
	const out: SourceRef[] = [];
	for (const sourceRef of sourceRefs) {
		const key = `${sourceRef.kind}:${sourceRef.id}:${JSON.stringify(sourceRef.metadata ?? {})}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(sourceRef);
	}
	return out;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort();
}

function recordRefs(record: WorkspaceProposalRecorded): readonly string[] {
	return [
		`workspace-proposal-recorded:${record.proposalId}`,
		`workspace-proposal-intake-request:${record.intakeRequestId}`,
		...record.sourceRefs.map((sourceRef) => `${sourceRef.kind}:${sourceRef.id}`),
	];
}

function blank(value: unknown): value is undefined | null | "" {
	return typeof value !== "string" || value.trim() === "";
}

function nonBlankString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function isDenseArray(value: readonly unknown[]): boolean {
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) return false;
	}
	return true;
}

function familyProjectorState<TInput, TDraft>(
	ctx: Ctx,
): WorkspaceProposalFamilyProjectorState<TInput, TDraft> {
	return (
		ctx.state.get<WorkspaceProposalFamilyProjectorState<TInput, TDraft>>() ?? {
			records: new Map(),
			decisionsByProposal: new Map(),
			decisionsById: new Map(),
			contexts: new Map(),
			gates: new Map(),
			requests: new Map(),
			workItems: new Map(),
			links: new Map(),
			emittedDomainFacts: new Map(),
			domainApplications: new Map(),
			applicationRefs: new Map(),
			factOwners: new Map(),
			durableHandoffDiagnostics: new Set(),
		}
	);
}

function runtimeOptions(name: string, factory: string) {
	return {
		name: `${name}/runtime`,
		factory,
		partial: true,
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	};
}

function familyBundle(
	graph: Graph,
	runtime: Node<WorkspaceProposalFamilyApplicationRuntimeFact>,
	name: string,
	familyOutputs: Partial<Record<"applied" | "created" | "linked" | "unlinked", string>>,
): Record<string, Node<unknown>> {
	const out: Record<string, Node<unknown>> = {
		status: project(graph, runtime, `${name}/status`, `${name}Status`, (fact) =>
			fact.kind === "status" ? fact.value : undefined,
		),
		recorded: project(graph, runtime, `${name}/recorded`, `${name}Recorded`, (fact) =>
			fact.kind === "recorded" ? fact.value : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, `${name}Issues`, (fact) =>
			fact.kind === "issue" ? fact.value : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, `${name}Audit`, (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
	for (const [key, kind] of Object.entries(familyOutputs)) {
		out[key] = project(graph, runtime, `${name}/${key}`, `${name}${capitalize(key)}`, (fact) =>
			fact.kind === kind ? fact.value : undefined,
		);
	}
	return out;
}

function ingestRecords<TInput, TDraft>(
	ctx: Ctx,
	state: WorkspaceProposalFamilyProjectorState<TInput, TDraft>,
	depIndex: number,
): void {
	for (const raw of depBatch(ctx, depIndex) ?? []) {
		const record = raw as WorkspaceProposalRecorded<TDraft>;
		state.records.set(record.proposalId, record);
	}
}

function ingestDecisions<TInput, TDraft>(
	ctx: Ctx,
	state: WorkspaceProposalFamilyProjectorState<TInput, TDraft>,
	depIndex: number,
): void {
	for (const raw of depBatch(ctx, depIndex) ?? []) {
		const decision = raw as WorkspaceProposalAdmissionDecision;
		state.decisionsByProposal.set(decision.proposalId, decision);
		state.decisionsById.set(decision.decisionId, decision);
	}
}

function ingestContexts<TInput, TDraft>(
	ctx: Ctx,
	state: WorkspaceProposalFamilyProjectorState<TInput, TDraft>,
	depIndex: number,
): void {
	for (const raw of depBatch(ctx, depIndex) ?? []) {
		const context = raw as WorkspaceProposalFamilyProjectorState<
			TInput,
			TDraft
		>["contexts"] extends Map<string, infer TContext>
			? TContext
			: never;
		state.contexts.set(context.applicationId, context);
	}
}

function ingestWorkItems<TInput, TDraft>(
	ctx: Ctx,
	state: WorkspaceProposalFamilyProjectorState<TInput, TDraft>,
	depIndex: number,
): void {
	for (const raw of depBatch(ctx, depIndex) ?? []) {
		const workItem = raw as WorkItemProjection<TInput>;
		state.workItems.set(workItem.workItemId, workItem);
	}
}

function decisionForContext<TInput, TDraft>(
	state: WorkspaceProposalFamilyProjectorState<TInput, TDraft>,
	context: { readonly proposalId: string; readonly decisionId?: string },
): WorkspaceProposalAdmissionDecision | undefined {
	return context.decisionId === undefined
		? state.decisionsByProposal.get(context.proposalId)
		: state.decisionsById.get(context.decisionId);
}

function requiredInputContextGate<TValue>(
	state: WorkspaceProposalFamilyProjectorState<unknown, RequiredInputResponseProposed<TValue>>,
	context: WorkspaceProposalRequiredInputResponseApplicationContext,
	draft: RequiredInputResponseProposed<TValue> | undefined,
): RequiredInputGate | undefined {
	if (context.gateId !== undefined) return state.gates.get(context.gateId);
	const requestId = context.requestId ?? draft?.requestId;
	const workItemId = draft?.workItemId;
	return requestId === undefined || workItemId === undefined
		? undefined
		: state.gates.get(`${requestId}:${workItemId}`);
}

function requiredInputContextRequest<TValue>(
	state: WorkspaceProposalFamilyProjectorState<unknown, RequiredInputResponseProposed<TValue>>,
	context: WorkspaceProposalRequiredInputResponseApplicationContext,
	draft: RequiredInputResponseProposed<TValue> | undefined,
): RequiredInputRequest | undefined {
	const requestId = context.requestId ?? draft?.requestId;
	const workItemId = draft?.workItemId;
	if (requestId === undefined) return undefined;
	return workItemId === undefined
		? state.requests.get(requestId)
		: (state.requests.get(`${requestId}:${workItemId}`) ?? state.requests.get(requestId));
}

function selectDomainFacts(
	state: WorkspaceProposalFamilyProjectorState,
	context: WorkspaceProposalDomainActionApplicationContext,
): {
	readonly facts: readonly WorkItemAuthoringFact[];
	readonly missingFactIds: readonly string[];
} {
	if (context.emittedFactIds !== undefined) {
		const facts: WorkItemAuthoringFact[] = [];
		const missingFactIds: string[] = [];
		for (const factId of context.emittedFactIds) {
			const fact = state.emittedDomainFacts.get(factId);
			if (fact === undefined) missingFactIds.push(factId);
			else facts.push(fact);
		}
		return { facts, missingFactIds };
	}
	return {
		facts: [...state.emittedDomainFacts.values()].filter((fact) =>
			fact.sourceRefs?.some(
				(sourceRef) =>
					sourceRef.kind === "workspace-proposal-application-status" &&
					sourceRef.id === context.applicationId,
			),
		),
		missingFactIds: [],
	};
}

function emitApplicationResult<TInput, TDraft>(
	ctx: Ctx,
	state: WorkspaceProposalFamilyProjectorState<TInput, TDraft>,
	result: WorkspaceProposalApplicationResult,
	familyFacts: readonly WorkspaceProposalEmittableFamilyFact[],
): void {
	if (result.status.state === "applied") {
		const priorRefs = state.applicationRefs.get(result.status.applicationId);
		if (priorRefs !== undefined) {
			if (!sameReplayEntry(priorRefs, result)) {
				emitApplicationStatusFacts(
					ctx,
					idempotencyConflictResult(result, "application-replay-provenance-conflict"),
					"conflict",
				);
				return;
			}
			if (
				refsSignature(priorRefs.emittedFactRefs) === refsSignature(result.status.emittedFactRefs)
			) {
				emitApplicationStatusFacts(ctx, result, "re-referenced");
				return;
			}
			emitApplicationStatusFacts(
				ctx,
				idempotencyConflictResult(result, "application-replay-conflict"),
				"conflict",
			);
			return;
		}
		const duplicateOwner = firstConflictingFactOwner(state, result);
		if (duplicateOwner !== undefined) {
			emitApplicationStatusFacts(
				ctx,
				idempotencyConflictResult(result, `family-fact-owned-by:${duplicateOwner}`),
				"conflict",
			);
			return;
		}
		for (const ref of result.status.emittedFactRefs) {
			state.factOwners.set(factKey(ref), result.status.applicationId);
		}
		state.applicationRefs.set(result.status.applicationId, replayEntry(result));
		for (const fact of familyFacts) emitFamilyFact(ctx, fact);
	}
	emitApplicationStatusFacts(ctx, result);
}

function emitApplicationStatusFacts(
	ctx: Ctx,
	result: WorkspaceProposalApplicationResult,
	replayState?: "re-referenced" | "conflict",
): void {
	emitRuntime(ctx, "status", result.status);
	if (result.recorded !== undefined) emitRuntime(ctx, "recorded", result.recorded);
	for (const issue of result.issues) emitRuntime(ctx, "issue", issue);
	emitRuntime(ctx, "audit", {
		kind: "workspace-proposal-family-application-audit",
		auditId: `${result.status.applicationId}:${result.status.state}:audit`,
		applicationId: result.status.applicationId,
		proposalId: result.status.proposalId,
		decisionId: result.status.decisionId,
		proposalFamily: result.status.proposalFamily,
		state: result.status.state,
		emittedFactRefs: result.status.emittedFactRefs,
		sourceRefs: result.status.sourceRefs,
		audit: result.status.audit,
		metadata: replayState === undefined ? undefined : { replayState },
	});
}

function emitMissingDurableHandoffDiagnostics<TInput, TDraft>(
	ctx: Ctx,
	state: WorkspaceProposalFamilyProjectorState<TInput, TDraft>,
	context: {
		readonly applicationId: string;
		readonly proposalId: string;
		readonly decisionId?: string;
		readonly sourceRefs?: readonly SourceRef[];
		readonly audit?: WorkspaceProposalAuditMaterial;
	},
	proposalFamily: WorkspaceProposalFamily,
): void {
	const record = state.records.get(context.proposalId);
	const decision = decisionForContext(state, context);
	const issues: WorkspaceProposalRecordedIssue[] = [];
	if (record === undefined) {
		issues.push(
			missingDurableHandoffIssue(
				context,
				"missing-workspace-proposal-recorded",
				"Workspace family application context references a missing durable proposal record",
			),
		);
	}
	if (decision === undefined) {
		issues.push(
			missingDurableHandoffIssue(
				context,
				"missing-workspace-proposal-admission-decision",
				"Workspace family application context references a missing durable admission decision",
			),
		);
	}
	const newIssues = issues.filter((issue) => {
		const key = durableHandoffDiagnosticKey(context, issue.code);
		if (state.durableHandoffDiagnostics.has(key)) return false;
		state.durableHandoffDiagnostics.add(key);
		return true;
	});
	if (newIssues.length === 0) return;
	for (const issue of newIssues) emitRuntime(ctx, "issue", issue);
	emitRuntime(ctx, "audit", {
		kind: "workspace-proposal-family-application-audit",
		auditId: `${context.applicationId}:missing-durable-handoff:audit`,
		applicationId: context.applicationId,
		proposalId: context.proposalId,
		decisionId: context.decisionId,
		proposalFamily,
		state: "pending",
		code: "missing-durable-handoff",
		issues: newIssues,
		emittedFactRefs: [],
		sourceRefs: missingDurableHandoffSourceRefs(context),
		audit: context.audit,
		metadata: {
			diagnostic: "missing-durable-handoff",
			missingRecord: record === undefined,
			missingDecision: decision === undefined,
		},
	});
}

function missingDurableHandoffIssue(
	context: {
		readonly applicationId: string;
		readonly proposalId: string;
		readonly decisionId?: string;
		readonly sourceRefs?: readonly SourceRef[];
	},
	code: string,
	message: string,
): WorkspaceProposalRecordedIssue {
	return {
		kind: "issue",
		source: "workspace-proposal",
		severity: "error",
		code,
		message,
		subjectId: context.proposalId,
		refs: missingDurableHandoffRefs(context),
		metadata: {
			applicationId: context.applicationId,
			proposalId: context.proposalId,
			...(context.decisionId === undefined ? {} : { decisionId: context.decisionId }),
		},
	};
}

function durableHandoffDiagnosticKey(
	context: {
		readonly applicationId: string;
		readonly proposalId: string;
		readonly decisionId?: string;
	},
	code: string,
): string {
	return `${context.applicationId}:${context.proposalId}:${context.decisionId ?? "<by-proposal>"}:${code}`;
}

function missingDurableHandoffRefs(context: {
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId?: string;
	readonly sourceRefs?: readonly SourceRef[];
}): readonly string[] {
	return [
		`workspace-proposal-application-context:${context.applicationId}`,
		`workspace-proposal-recorded:${context.proposalId}`,
		...(context.decisionId === undefined
			? []
			: [`workspace-proposal-admission-decision:${context.decisionId}`]),
		...(context.sourceRefs ?? []).map((sourceRef) => `${sourceRef.kind}:${sourceRef.id}`),
	];
}

function missingDurableHandoffSourceRefs(context: {
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId?: string;
	readonly sourceRefs?: readonly SourceRef[];
}): readonly SourceRef[] {
	return uniqueRefs([
		{ kind: "workspace-proposal-application-context", id: context.applicationId },
		{ kind: "workspace-proposal-recorded", id: context.proposalId },
		...(context.decisionId === undefined
			? []
			: [{ kind: "workspace-proposal-admission-decision", id: context.decisionId }]),
		...(context.sourceRefs ?? []),
	]);
}

function emitFamilyFact(ctx: Ctx, fact: WorkspaceProposalEmittableFamilyFact): void {
	emitRuntime(ctx, fact.kind, fact);
}

function emitRuntime<K extends WorkspaceProposalFamilyApplicationRuntimeFact["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<WorkspaceProposalFamilyApplicationRuntimeFact, { readonly kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value }]]);
}

type WorkspaceProposalEmittableFamilyFact =
	| RequiredInputResponseApplied
	| WorkItemCreated
	| WorkItemLinked
	| WorkItemUnlinked;

function missingFamilyMaterialResult(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	context: {
		readonly applicationId: string;
		readonly sourceRefs?: readonly SourceRef[];
		readonly audit?: WorkspaceProposalAuditMaterial;
	},
	code: string,
): WorkspaceProposalApplicationResult {
	const generic = projectWorkspaceProposalApplicationStatus(record, decision, {
		applicationId: context.applicationId,
		sourceRefs: context.sourceRefs,
		audit: context.audit,
	});
	if (generic.status.state === "blocked") return generic;
	return projectWorkspaceProposalApplicationStatus(record, decision, {
		applicationId: context.applicationId,
		familyIssues: [
			familyIssue(code, "Workspace proposal family application material is missing", record),
		],
		state: "repair-needed",
		code,
		sourceRefs: context.sourceRefs,
		audit: context.audit,
	});
}

function idempotencyConflictResult(
	result: WorkspaceProposalApplicationResult,
	reason: string,
): WorkspaceProposalApplicationResult {
	const issue: WorkspaceProposalRecordedIssue = {
		kind: "issue",
		source: "workspace-proposal",
		severity: "error",
		code: "idempotency-conflict",
		message: "Workspace proposal family application replay conflicts with prior emitted facts",
		subjectId: result.status.proposalId,
		refs: result.status.sourceRefs.map((sourceRef) => `${sourceRef.kind}:${sourceRef.id}`),
		metadata: { reason },
	};
	return {
		status: {
			...result.status,
			state: "idempotency-conflict",
			code: "idempotency-conflict",
			issues: [issue],
			emittedFactRefs: [],
		},
		issues: [issue],
	};
}

function replayEntry(
	result: WorkspaceProposalApplicationResult,
): WorkspaceProposalApplicationReplayEntry {
	return {
		proposalId: result.status.proposalId,
		decisionId: result.status.decisionId,
		idempotencyKey: result.status.idempotencyKey,
		emittedFactRefs: immutableClone(result.status.emittedFactRefs),
	};
}

function sameReplayEntry(
	entry: WorkspaceProposalApplicationReplayEntry,
	result: WorkspaceProposalApplicationResult,
): boolean {
	return (
		entry.proposalId === result.status.proposalId &&
		entry.decisionId === result.status.decisionId &&
		entry.idempotencyKey === result.status.idempotencyKey
	);
}

function firstConflictingFactOwner<TInput, TDraft>(
	state: WorkspaceProposalFamilyProjectorState<TInput, TDraft>,
	result: WorkspaceProposalApplicationResult,
): string | undefined {
	for (const ref of result.status.emittedFactRefs) {
		const owner = state.factOwners.get(factKey(ref));
		if (owner !== undefined && owner !== result.status.applicationId) return owner;
	}
	return undefined;
}

function refsSignature(refs: readonly WorkspaceProposalApplicationFamilyRef[]): string {
	return stableStringify(
		refs.map((ref) => ({
			proposalFamily: ref.proposalFamily,
			factKind: ref.factKind,
			factId: ref.factId,
			sourceRefs: ref.sourceRefs ?? [],
		})),
	);
}

function factKey(ref: WorkspaceProposalApplicationFamilyRef): string {
	return `${ref.proposalFamily}:${ref.factKind}:${ref.factId}`;
}

function capitalize(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function stableStringify(value: unknown, stack: WeakSet<object> = new WeakSet()): string {
	if (typeof value === "object" && value !== null) {
		if (stack.has(value)) return JSON.stringify("[Circular]");
		stack.add(value);
	}
	try {
		if (Array.isArray(value))
			return `[${value.map((entry) => stableStringify(entry, stack)).join(",")}]`;
		if (!isRecord(value)) return JSON.stringify(value);
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], stack)}`)
			.join(",")}}`;
	} finally {
		if (typeof value === "object" && value !== null) stack.delete(value);
	}
}
