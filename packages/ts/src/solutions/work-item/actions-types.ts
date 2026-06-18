import type { DataIssue } from "../../data/index.js";
import type { BoundaryCapabilityRef } from "../../inspection/boundary.js";
import type { Node } from "../../node/node.js";
import type { AgentRuntimeAuditRecord, SourceRef } from "../../orchestration/agent-runtime.js";
import type {
	WorkItemDomainActionAdmission,
	WorkItemDomainActionAdmissionDecision,
	WorkItemDomainActionProposal,
} from "../../orchestration/work-item-runtime.js";
import type { CapabilityAdmission, CapabilityAdmissionStatus } from "../capability-admission.js";
import type {
	AcceptanceCriterion,
	VerificationPlan,
	WorkItemAuthoringFact,
	WorkItemDraft,
	WorkItemPatch,
	WorkItemProjection,
} from "./scheduling.js";

export type {
	WorkItemDomainActionAdmission,
	WorkItemDomainActionAdmissionDecision,
	WorkItemDomainActionAdmissionPolicy,
	WorkItemDomainActionAdmissionViews,
	WorkItemDomainActionProposal,
	WorkItemDomainActionProposalSpec,
} from "../../orchestration/work-item-runtime.js";

export type WorkItemDomainActionKind =
	| "patch"
	| "mark-verified"
	| "require-review"
	| "spawn-proposed"
	| "spawn-child"
	| (string & {});

export interface WorkItemDomainActionProposalIntake<TPayload = unknown> {
	readonly kind: "work-item-domain-action-proposal-intake";
	readonly proposalId: string;
	readonly workItemId: string;
	readonly actionKind: WorkItemDomainActionKind;
	readonly payload?: TPayload;
	readonly reason?: string;
	readonly policyId?: string;
	readonly effectRunId?: string;
	readonly effectRunResultId?: string;
	readonly evidenceId?: string;
	readonly proposedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemDomainActionProposalInput<TPayload = unknown> =
	| WorkItemDomainActionProposal<TPayload>
	| WorkItemDomainActionProposalIntake<TPayload>
	| unknown;

export type WorkItemDomainActionStatusState =
	| "proposed"
	| "applied"
	| "rejected"
	| "deferred"
	| "duplicate"
	| "missing-policy"
	| "merged"
	| "policy-rejected"
	| "proposal-only";

export interface WorkItemDomainActionStatus {
	readonly kind: "work-item-domain-action-status";
	readonly statusId: string;
	readonly workItemId?: string;
	readonly proposalId?: string;
	readonly admissionId?: string;
	readonly actionKind?: string;
	readonly state: WorkItemDomainActionStatusState;
	readonly code?: string;
	readonly message?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemPatchActionPayload<TInput = unknown> {
	readonly patch?: WorkItemPatch<TInput>;
	readonly acceptanceCriteria?: readonly AcceptanceCriterion[];
	readonly verificationPlan?: VerificationPlan<TInput>;
	readonly executionRelevantFields?: readonly string[];
	readonly authorId?: string;
	readonly eventId?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemSpawnActionPayload<TInput = unknown> {
	readonly workItemId?: string;
	readonly childWorkItemId?: string;
	readonly draft?: WorkItemDraft<TInput>;
	readonly authorId?: string;
	readonly eventId?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemDomainActionApplyPolicy {
	readonly kind: "work-item-domain-action-apply-policy";
	readonly policyId: string;
	readonly actionKinds?: readonly WorkItemDomainActionKind[];
	readonly patch?: {
		readonly allowedFields?: readonly string[];
		readonly executionRelevantFields?: readonly string[];
		readonly allowAcceptanceCriteria?: boolean;
		readonly allowVerificationPlan?: boolean;
	};
	readonly spawn?: {
		readonly create?: boolean;
		readonly linkParent?: boolean;
		readonly idempotencyKey?: string;
		readonly maxChildrenPerAdmission?: number;
		readonly childWorkItemId?: string;
		readonly childIdPrefix?: string;
	};
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemDomainActionApplication {
	readonly kind: "work-item-domain-action-application";
	readonly applicationId: string;
	readonly admissionId: string;
	readonly proposalId: string;
	readonly workItemId: string;
	readonly actionKind: string;
	readonly state: Exclude<WorkItemDomainActionStatusState, "proposed">;
	readonly producedFactIds?: readonly string[];
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemDomainActionIntakeOptions {
	readonly name?: string;
	readonly proposals: Node<WorkItemDomainActionProposalInput>;
	readonly now?: () => number;
}

export interface WorkItemDomainActionIntakeBundle {
	readonly proposals: Node<WorkItemDomainActionProposal>;
	readonly status: Node<WorkItemDomainActionStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export interface WorkItemDomainActionApplicationOptions<TInput = unknown> {
	readonly name?: string;
	readonly proposals: Node<WorkItemDomainActionProposal>;
	readonly admissions: Node<WorkItemDomainActionAdmission>;
	readonly workItems: Node<WorkItemProjection<TInput>>;
	readonly applyPolicies?: Node<WorkItemDomainActionApplyPolicy>;
}

export interface WorkItemDomainActionApplicationBundle<TInput = unknown> {
	readonly authoringFacts: Node<WorkItemAuthoringFact<TInput>>;
	readonly applications: Node<WorkItemDomainActionApplication>;
	readonly status: Node<WorkItemDomainActionStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

/**
 * Product-owned command capability policy (D357): maps WorkItem domain action
 * proposals to explicit boundary capability refs and admission subjects without
 * defining provider/security registry semantics or protocol status vocabulary.
 */
export interface WorkItemDomainActionCapabilityGuardPolicy {
	readonly kind: "work-item-domain-action-capability-guard-policy";
	readonly policyId: string;
	readonly actionKinds?: readonly WorkItemDomainActionKind[];
	readonly capabilityRefs: readonly BoundaryCapabilityRef[];
	readonly admissionSubjectIds: readonly string[];
	readonly metadata?: Record<string, unknown>;
}

/**
 * Visible DATA status for the capability guard (D357). Missing or mismatched
 * capability facts remain product issues/status, not protocol ERROR messages.
 */
export interface WorkItemDomainActionCapabilityGuardStatus {
	readonly kind: "work-item-domain-action-capability-guard-status";
	readonly statusId: string;
	readonly state: "admitted" | "rejected" | "deferred" | "issue";
	readonly workItemId?: string;
	readonly proposalId?: string;
	readonly actionKind?: string;
	readonly policyId?: string;
	readonly capabilityRefs?: readonly BoundaryCapabilityRef[];
	readonly admissionSubjectIds?: readonly string[];
	readonly admissionIds?: readonly string[];
	readonly issues?: readonly DataIssue[];
	readonly message?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

/**
 * Inputs for the WorkItem domain-action capability guard. All dependencies are
 * ordinary solution/product DATA facts; the guard does not mutate WorkItems or
 * claim dispatch queues.
 */
export interface WorkItemDomainActionCapabilityGuardOptions {
	readonly name?: string;
	readonly proposals: Node<WorkItemDomainActionProposal>;
	readonly capabilityAdmissions: Node<CapabilityAdmission>;
	readonly guardPolicies: Node<WorkItemDomainActionCapabilityGuardPolicy>;
	readonly capabilityAdmissionStatus?: Node<CapabilityAdmissionStatus>;
	readonly now?: () => number;
}

/**
 * Output facts for product admission consumption. Decisions feed the existing
 * WorkItem domain-action admission path; status/issues/audit remain inspectable
 * product DATA.
 */
export interface WorkItemDomainActionCapabilityGuardBundle {
	readonly decisions: Node<WorkItemDomainActionAdmissionDecision>;
	readonly status: Node<WorkItemDomainActionCapabilityGuardStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type IntakeFact =
	| { readonly kind: "proposal"; readonly value: WorkItemDomainActionProposal }
	| { readonly kind: "status"; readonly value: WorkItemDomainActionStatus }
	| { readonly kind: "issue"; readonly value: DataIssue }
	| { readonly kind: "audit"; readonly value: AgentRuntimeAuditRecord };

export type ApplicationFact<T> =
	| { readonly kind: "authoring-fact"; readonly value: WorkItemAuthoringFact<T> }
	| { readonly kind: "application"; readonly value: WorkItemDomainActionApplication }
	| { readonly kind: "status"; readonly value: WorkItemDomainActionStatus }
	| { readonly kind: "issue"; readonly value: DataIssue }
	| { readonly kind: "audit"; readonly value: AgentRuntimeAuditRecord };

export type CapabilityGuardFact =
	| { readonly kind: "decision"; readonly value: WorkItemDomainActionAdmissionDecision }
	| { readonly kind: "status"; readonly value: WorkItemDomainActionCapabilityGuardStatus }
	| { readonly kind: "issue"; readonly value: DataIssue }
	| { readonly kind: "audit"; readonly value: AgentRuntimeAuditRecord };

export interface IntakeState {
	readonly proposals: Set<string>;
	statusSeq: number;
	auditSeq: number;
}

export interface ApplicationState<T> {
	readonly proposals: Map<string, WorkItemDomainActionProposal>;
	readonly admissions: Map<string, WorkItemDomainActionAdmission>;
	readonly workItems: Map<string, WorkItemProjection<T>>;
	readonly policies: Map<string, WorkItemDomainActionApplyPolicy>;
	readonly appliedAdmissions: Set<string>;
	readonly emittedFactIds: Set<string>;
	readonly issueKeys: Set<string>;
	statusSeq: number;
	auditSeq: number;
}

export interface CapabilityGuardState {
	readonly proposals: Map<string, WorkItemDomainActionProposal>;
	readonly admissionsByCapability: Map<string, CapabilityAdmission[]>;
	readonly issueStatusesByCapability: Map<string, CapabilityAdmissionStatus[]>;
	readonly issueStatusesWithoutCapability: CapabilityAdmissionStatus[];
	readonly policies: Map<string, WorkItemDomainActionCapabilityGuardPolicy>;
	readonly emittedProposalDecisions: Set<string>;
	readonly emittedStatusKeys: Set<string>;
	readonly issueKeys: Set<string>;
	statusSeq: number;
	auditSeq: number;
}

export const patchFieldKeys = new Set([
	"summary",
	"detail",
	"detailRefs",
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
