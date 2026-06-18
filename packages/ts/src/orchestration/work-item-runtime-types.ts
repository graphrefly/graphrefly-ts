import type { DataIssue } from "../data/index.js";
import type { Node } from "../node/node.js";
import type {
	AgentNeed,
	AgentOutputEnvelope,
	AgentRuntimeAuditRecord,
	EffectRun,
	EffectRunGoal,
	EffectRunLimits,
	EffectRunResult,
	EffectRunResultStatus,
	SourceRef,
} from "./agent-runtime.js";

export interface WorkItemSeed {
	readonly kind: "work-item";
	readonly workItemId: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly workItemKind?: string;
	readonly summary?: string;
	readonly detailRef?: string;
	readonly lifecycleStatus?: string;
	readonly issues?: readonly DataIssue[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectRequested<TInput = unknown> {
	readonly kind: "work-item-effect-requested";
	readonly requestId: string;
	readonly workItemId: string;
	readonly effectRunId: string;
	readonly effectKind: string;
	readonly executionInputRevision?: number;
	readonly planId?: string;
	readonly planMemberId?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly goal: EffectRunGoal<TInput>;
	readonly agentRunId?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly limits?: EffectRunLimits;
	readonly createdBy?: string;
	readonly createdAtMs?: number;
	readonly idempotencyKey?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEvidenceRecorded {
	readonly kind: "work-item-evidence-recorded";
	readonly evidenceId: string;
	readonly workItemId: string;
	readonly requestId?: string;
	readonly effectRunId: string;
	readonly effectRunResultId: string;
	readonly executionInputRevision?: number;
	readonly planId?: string;
	readonly planMemberId?: string;
	readonly status: EffectRunResultStatus;
	readonly sourceRefs?: readonly SourceRef[];
	readonly output?: AgentOutputEnvelope;
	readonly error?: DataIssue;
	readonly needs?: readonly AgentNeed[];
	readonly reason?: string;
	readonly timeoutMs?: number;
	readonly issues?: readonly DataIssue[];
	readonly auditRefs?: readonly string[];
	readonly recordedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemDomainActionProposalPayloadFrom = "evidence" | "effect-run-result" | "output";

export interface WorkItemDomainActionProposalSpec<TPayload = unknown> {
	readonly actionKind: string;
	readonly behavior?: "propose";
	readonly statuses?: readonly EffectRunResultStatus[];
	readonly outputKinds?: readonly string[];
	readonly payloadFrom?: WorkItemDomainActionProposalPayloadFrom;
	readonly payload?: TPayload;
	readonly reason?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemDomainActionProposal<TPayload = unknown> {
	readonly kind: "work-item-domain-action-proposal";
	readonly proposalId: string;
	readonly workItemId: string;
	readonly actionKind: string;
	readonly effectRunId: string;
	readonly effectRunResultId: string;
	readonly evidenceId: string;
	readonly policyId: string;
	readonly payload?: TPayload;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly proposedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemDomainActionAdmissionOutcome = "admit" | "reject" | "defer" | "merge";
export type WorkItemDomainActionAdmissionState = "admitted" | "rejected" | "deferred" | "merged";

export interface WorkItemDomainActionAdmissionPolicy {
	readonly kind: "work-item-domain-action-admission-policy";
	readonly policyId: string;
	readonly actionKinds?: readonly string[];
	readonly allowedOutcomes?: readonly WorkItemDomainActionAdmissionOutcome[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemDomainActionAdmissionDecision {
	readonly kind: "work-item-domain-action-admission-decision";
	readonly decisionId: string;
	readonly admissionId: string;
	readonly proposalId: string;
	readonly outcome: WorkItemDomainActionAdmissionOutcome;
	readonly policyId?: string;
	readonly reason?: string;
	readonly targetProposalId?: string;
	readonly targetAdmissionId?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly decidedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemDomainActionAdmission {
	readonly kind: "work-item-domain-action-admission";
	readonly admissionId: string;
	readonly proposalId: string;
	readonly workItemId: string;
	readonly actionKind: string;
	readonly state: WorkItemDomainActionAdmissionState;
	readonly decisionId: string;
	readonly policyId?: string;
	readonly reason?: string;
	readonly targetProposalId?: string;
	readonly targetAdmissionId?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly admittedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectMappingPolicy {
	readonly kind: "work-item-effect-mapping-policy";
	readonly policyId: string;
	readonly effectKinds?: readonly string[];
	readonly evidence?: {
		readonly behavior?: "record";
	};
	readonly actionProposals?: readonly WorkItemDomainActionProposalSpec[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemStatusRecord {
	readonly kind: "work-item-status";
	readonly statusId: string;
	readonly workItemId: string;
	readonly state:
		| "effect-request-pending"
		| "effect-run-seeded"
		| "evidence-recorded"
		| "domain-action-proposed"
		| "domain-action-admitted"
		| "domain-action-rejected"
		| "domain-action-deferred"
		| "domain-action-merged"
		| "mapping-issue";
	readonly sourceRefs?: readonly SourceRef[];
	readonly effectRunId?: string;
	readonly requestId?: string;
	readonly evidenceId?: string;
	readonly proposalId?: string;
	readonly issues?: readonly DataIssue[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectRequestViews {
	readonly pendingEffectRequests: readonly WorkItemEffectRequested[];
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgentRuntimeAuditRecord[];
}

export interface WorkItemEvidenceViews {
	readonly evidenceByWorkItem: ReadonlyMap<string, readonly WorkItemEvidenceRecorded[]>;
	readonly latestEvidenceByEffectRun: ReadonlyMap<string, WorkItemEvidenceRecorded>;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgentRuntimeAuditRecord[];
	readonly pendingEffectRequests: readonly WorkItemEffectRequested[];
}

export interface WorkItemDomainActionProposalViews {
	readonly proposalsByWorkItem: ReadonlyMap<string, readonly WorkItemDomainActionProposal[]>;
	readonly proposalsByEvidence: ReadonlyMap<string, readonly WorkItemDomainActionProposal[]>;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgentRuntimeAuditRecord[];
}

export interface WorkItemDomainActionAdmissionViews {
	readonly admissionsByProposal: ReadonlyMap<string, WorkItemDomainActionAdmission>;
	readonly admissionsByWorkItem: ReadonlyMap<string, readonly WorkItemDomainActionAdmission[]>;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgentRuntimeAuditRecord[];
}

export interface WorkItemEffectRunBundle {
	readonly effectRuns: Node<EffectRun>;
	readonly status: Node<WorkItemStatusRecord>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly views: Node<WorkItemEffectRequestViews>;
}

export interface WorkItemEvidenceMapperBundle {
	readonly evidence: Node<WorkItemEvidenceRecorded>;
	readonly status: Node<WorkItemStatusRecord>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly views: Node<WorkItemEvidenceViews>;
}

export interface WorkItemDomainActionProposalBundle {
	readonly proposals: Node<WorkItemDomainActionProposal>;
	readonly status: Node<WorkItemStatusRecord>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly views: Node<WorkItemDomainActionProposalViews>;
}

export interface WorkItemDomainActionAdmissionBundle {
	readonly admissions: Node<WorkItemDomainActionAdmission>;
	readonly status: Node<WorkItemStatusRecord>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly views: Node<WorkItemDomainActionAdmissionViews>;
}

export type WorkItemEffectRunFact =
	| { readonly kind: "effect-run"; readonly effectRun: EffectRun }
	| { readonly kind: "status"; readonly status: WorkItemStatusRecord }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

export type WorkItemEvidenceMapperFact =
	| { readonly kind: "evidence"; readonly evidence: WorkItemEvidenceRecorded }
	| { readonly kind: "status"; readonly status: WorkItemStatusRecord }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

export type WorkItemDomainActionProposalFact =
	| { readonly kind: "proposal"; readonly proposal: WorkItemDomainActionProposal }
	| { readonly kind: "status"; readonly status: WorkItemStatusRecord }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

export type WorkItemDomainActionAdmissionFact =
	| { readonly kind: "admission"; readonly admission: WorkItemDomainActionAdmission }
	| { readonly kind: "status"; readonly status: WorkItemStatusRecord }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

export interface WorkItemEffectRunState {
	workItems: Map<string, WorkItemSeed>;
	requests: Map<string, WorkItemEffectRequested>;
	effectRunsByRequest: Map<string, string>;
	seededEffectRunIds: Set<string>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
	issueKeys: Set<string>;
	statusSeq: number;
	issueSeq: number;
	auditSeq: number;
}

export interface WorkItemEvidenceState {
	workItems: Map<string, WorkItemSeed>;
	effectRuns: Map<string, EffectRun>;
	effectRunWorkItems: Map<string, string>;
	evidenceByWorkItem: Map<string, WorkItemEvidenceRecorded[]>;
	latestEvidenceByEffectRun: Map<string, WorkItemEvidenceRecorded>;
	pendingEffectRequests: Map<string, WorkItemEffectRequested>;
	requestsByEffectRun: Map<string, WorkItemEffectRequested>;
	ambiguousRequestsByEffectRun: Map<string, WorkItemEffectRequested[]>;
	policies: Map<string, WorkItemEffectMappingPolicy>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
	issueKeys: Set<string>;
	statusSeq: number;
	issueSeq: number;
	auditSeq: number;
}

export interface WorkItemDomainActionProposalState {
	workItems: Map<string, WorkItemSeed>;
	evidence: Map<string, WorkItemEvidenceRecorded>;
	results: Map<string, EffectRunResult>;
	policies: Map<string, WorkItemEffectMappingPolicy>;
	proposedKeys: Set<string>;
	issueKeys: Set<string>;
	statusSeq: number;
	issueSeq: number;
	auditSeq: number;
}

export interface WorkItemDomainActionAdmissionStateInternal {
	proposals: Map<string, WorkItemDomainActionProposal>;
	policies: Map<string, WorkItemDomainActionAdmissionPolicy>;
	decisions: Map<string, WorkItemDomainActionAdmissionDecision>;
	admissionsById: Map<string, WorkItemDomainActionAdmission>;
	admissionsByProposal: Map<string, WorkItemDomainActionAdmission>;
	terminalDecisionIds: Set<string>;
	issueKeys: Set<string>;
	statusSeq: number;
	issueSeq: number;
	auditSeq: number;
}

export interface WorkItemEffectRunViewsState {
	pendingEffectRequests: Map<string, WorkItemEffectRequested>;
	settledRequestIds: Set<string>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
}

export interface WorkItemEvidenceViewsState {
	evidenceByWorkItem: Map<string, WorkItemEvidenceRecorded[]>;
	latestEvidenceByEffectRun: Map<string, WorkItemEvidenceRecorded>;
	pendingEffectRequests: Map<string, WorkItemEffectRequested>;
	settledEffectRunIds: Set<string>;
	settledRequestIds: Set<string>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
}

export interface WorkItemDomainActionProposalViewsState {
	proposalsByWorkItem: Map<string, WorkItemDomainActionProposal[]>;
	proposalsByEvidence: Map<string, WorkItemDomainActionProposal[]>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
}

export interface WorkItemDomainActionAdmissionViewsState {
	admissionsByProposal: Map<string, WorkItemDomainActionAdmission>;
	admissionsByWorkItem: Map<string, WorkItemDomainActionAdmission[]>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
}

export interface WorkItemMappingPolicyContext {
	readonly policyRefs: readonly SourceRef[];
	readonly effectKind?: string;
}
