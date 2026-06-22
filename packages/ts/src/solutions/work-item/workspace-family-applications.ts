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
	type WorkspaceProposalRecorded,
	type WorkspaceProposalRecordedIssue,
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
		| "missing-outcome-detail"
		| "mismatched-outcome-detail"
		| "mismatched-outcome-status";
	readonly message: string;
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly outcomeRef?: WorkspaceProposalFamilyOutcomeRef;
	readonly sourceRefs: readonly SourceRef[];
}

export interface WorkspaceProposalFamilyApplicationReadModel {
	readonly kind: "workspace-proposal-family-application-read-model";
	readonly readModelId: string;
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly diagnostics: readonly WorkspaceProposalFamilyApplicationDiagnostic[];
	readonly repairReviewStatuses: readonly WorkspaceProposalRepairReviewStatus[];
	readonly outcomeIndexes: readonly WorkspaceProposalFamilyOutcomeIndexEntry[];
	readonly outcomeDetails: readonly WorkspaceProposalFamilyOutcomeDetail[];
	readonly displayDiagnostics: readonly WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic[];
	readonly page: {
		readonly offset: number;
		readonly limit: number;
		readonly totalOutcomeRefs: number;
		readonly returnedOutcomeRefs: number;
	};
}

export interface WorkspaceProposalFamilyApplicationReadModelProjectionInput {
	readonly diagnostics?: readonly WorkspaceProposalFamilyApplicationDiagnostic[];
	readonly repairReviewStatuses?: readonly WorkspaceProposalRepairReviewStatus[];
	readonly outcomeIndex?: readonly WorkspaceProposalFamilyOutcomeIndexEntry[];
	readonly outcomeStatuses?: readonly WorkspaceProposalFamilyOutcomeRecordStatus[];
	readonly outcomes?: readonly WorkspaceProposalFamilyOutcomeRecord[];
	readonly applicationId?: string;
	readonly proposalId?: string;
	readonly decisionId?: string;
	readonly idempotencyKey?: string;
	readonly proposalFamily?: WorkspaceProposalFamily;
	readonly offset?: number;
	readonly limit?: number;
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
}

export interface WorkspaceProposalFamilyApplicationReadModelProjectorBundle {
	readonly readModels: Node<WorkspaceProposalFamilyApplicationReadModel>;
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
	| { readonly kind: "diagnostic"; readonly value: WorkspaceProposalFamilyApplicationDiagnostic }
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
	readonly diagnostics: Map<string, WorkspaceProposalFamilyApplicationDiagnostic>;
	readonly outcomes: Map<string, WorkspaceProposalFamilyOutcomeRecord>;
	readonly emittedDiagnostics: Map<string, string>;
	readonly emittedRepairRequests: Map<string, string>;
	readonly emittedRepairStatuses: Map<string, string>;
	readonly emittedReadModels: Map<string, string>;
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
	const diagnostics = (input.diagnostics ?? []).filter((diagnostic) =>
		hasCompleteCoordinates ? coordinatesMatchExact(coordinates, diagnostic) : false,
	);
	const repairReviewStatuses = (input.repairReviewStatuses ?? []).filter((status) =>
		hasCompleteCoordinates ? coordinatesMatchExact(coordinates, status) : false,
	);
	const outcomeIndexes = (input.outcomeIndex ?? []).filter((entry) =>
		hasCompleteCoordinates ? coordinatesMatchExact(coordinates, entry) : false,
	);
	const allOutcomeRefs = outcomeIndexes.flatMap((entry) => entry.outcomeRefs);
	const offset = normalizePageOffset(input.offset);
	const limit = normalizePageLimit(input.limit);
	const pagedRefs = allOutcomeRefs.slice(offset, offset + limit);
	const outcomes = groupByOutcomeId(input.outcomes ?? []);
	const statuses = groupByOutcomeId(input.outcomeStatuses ?? []);
	const outcomeDetails: WorkspaceProposalFamilyOutcomeDetail[] = [];
	const displayDiagnostics: WorkspaceProposalFamilyApplicationReadModelDisplayDiagnostic[] = [];
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
	return {
		kind: "workspace-proposal-family-application-read-model",
		readModelId: `workspace-proposal-family-application-read-model:${stableStringify({
			...coordinates,
			offset,
			limit,
		})}`,
		...coordinates,
		diagnostics,
		repairReviewStatuses,
		outcomeIndexes,
		outcomeDetails,
		displayDiagnostics,
		page: {
			offset,
			limit,
			totalOutcomeRefs: allOutcomeRefs.length,
			returnedOutcomeRefs: pagedRefs.length,
		},
	};
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

function normalizePageOffset(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizePageLimit(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 50;
	return Math.min(100, Math.floor(value));
}

function readModelSignature(readModel: WorkspaceProposalFamilyApplicationReadModel): string {
	return stableStringify({
		diagnostics: readModel.diagnostics,
		repairReviewStatuses: readModel.repairReviewStatuses,
		outcomeIndexes: readModel.outcomeIndexes,
		outcomeDetails: readModel.outcomeDetails,
		displayDiagnostics: readModel.displayDiagnostics,
		page: readModel.page,
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
			state.repairStatuses.set(status.repairRequestId, status);
			return;
		}
		case "diagnostic": {
			const diagnostic = raw as WorkspaceProposalFamilyApplicationDiagnostic;
			state.diagnostics.set(diagnostic.diagnosticId, diagnostic);
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
			diagnostics: new Map(),
			outcomes: new Map(),
			emittedDiagnostics: new Map(),
			emittedRepairRequests: new Map(),
			emittedRepairStatuses: new Map(),
			emittedReadModels: new Map(),
		}
	);
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

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (!isRecord(value)) return JSON.stringify(value);
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
		.join(",")}}`;
}
