/**
 * WorkItem domain action intake, admission, and application facts (D239/D333-D343).
 *
 * This focused solution subpath keeps action mutation data-first: proposals and
 * admissions are visible facts, and application lowers only to append-only
 * WorkItem authoring facts plus status/issue/audit projections. It does not
 * mutate WorkItem projections directly, run executors, claim queues, or install
 * hidden schedulers.
 */

import { type Ctx, depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
import type { AgentRuntimeAuditRecord, SourceRef } from "../../orchestration/agent-runtime.js";
import type {
	WorkItemDomainActionAdmission,
	WorkItemDomainActionAdmissionDecision,
	WorkItemDomainActionProposal,
} from "../../orchestration/work-item-runtime.js";
import type { CapabilityAdmission, CapabilityAdmissionStatus } from "../capability-admission.js";
import {
	type AcceptanceCriterion,
	type VerificationPlan,
	validateAcceptanceCriteria,
	validateVerificationPlan,
	type WorkItemAuthoringFact,
	type WorkItemDraft,
	type WorkItemPatch,
	type WorkItemProjection,
} from "./scheduling.js";

export type {
	WorkItemDomainActionAdmission,
	WorkItemDomainActionAdmissionDecision,
	WorkItemDomainActionAdmissionPolicy,
	WorkItemDomainActionAdmissionViews,
	WorkItemDomainActionProposal,
	WorkItemDomainActionProposalSpec,
} from "../../orchestration/work-item-runtime.js";
export { workItemDomainActionAdmissionProjector } from "../../orchestration/work-item-runtime.js";

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
 * proposals to opaque capability ids without defining provider/security registry
 * semantics or protocol status vocabulary.
 */
export interface WorkItemDomainActionCapabilityGuardPolicy {
	readonly kind: "work-item-domain-action-capability-guard-policy";
	readonly policyId: string;
	readonly actionKinds?: readonly WorkItemDomainActionKind[];
	readonly capabilityIds: readonly string[];
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
	readonly capabilityIds?: readonly string[];
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

type IntakeFact =
	| { readonly kind: "proposal"; readonly value: WorkItemDomainActionProposal }
	| { readonly kind: "status"; readonly value: WorkItemDomainActionStatus }
	| { readonly kind: "issue"; readonly value: DataIssue }
	| { readonly kind: "audit"; readonly value: AgentRuntimeAuditRecord };

type ApplicationFact<T> =
	| { readonly kind: "authoring-fact"; readonly value: WorkItemAuthoringFact<T> }
	| { readonly kind: "application"; readonly value: WorkItemDomainActionApplication }
	| { readonly kind: "status"; readonly value: WorkItemDomainActionStatus }
	| { readonly kind: "issue"; readonly value: DataIssue }
	| { readonly kind: "audit"; readonly value: AgentRuntimeAuditRecord };

type CapabilityGuardFact =
	| { readonly kind: "decision"; readonly value: WorkItemDomainActionAdmissionDecision }
	| { readonly kind: "status"; readonly value: WorkItemDomainActionCapabilityGuardStatus }
	| { readonly kind: "issue"; readonly value: DataIssue }
	| { readonly kind: "audit"; readonly value: AgentRuntimeAuditRecord };

interface IntakeState {
	readonly proposals: Set<string>;
	statusSeq: number;
	auditSeq: number;
}

interface ApplicationState<T> {
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

interface CapabilityGuardState {
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

const patchFieldKeys = new Set([
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

export function workItemDomainActionProposal(
	proposalId: string,
	workItemId: string,
	actionKind: WorkItemDomainActionKind,
	opts: Omit<
		Partial<WorkItemDomainActionProposal>,
		"kind" | "proposalId" | "workItemId" | "actionKind"
	> = {},
): WorkItemDomainActionProposal {
	return {
		kind: "work-item-domain-action-proposal",
		proposalId,
		workItemId,
		actionKind,
		effectRunId: opts.effectRunId ?? `domain-action:${proposalId}:effect-run`,
		effectRunResultId: opts.effectRunResultId ?? `domain-action:${proposalId}:effect-run-result`,
		evidenceId: opts.evidenceId ?? `domain-action:${proposalId}:evidence`,
		policyId: opts.policyId ?? "domain-action-proposal",
		payload: opts.payload,
		reason: opts.reason,
		sourceRefs: opts.sourceRefs,
		proposedAtMs: opts.proposedAtMs,
		metadata: opts.metadata,
	};
}

export function workItemDomainActionProposalIntake<TPayload = unknown>(
	proposalId: string,
	workItemId: string,
	actionKind: WorkItemDomainActionKind,
	opts: Omit<
		Partial<WorkItemDomainActionProposalIntake<TPayload>>,
		"kind" | "proposalId" | "workItemId" | "actionKind"
	> = {},
): WorkItemDomainActionProposalIntake<TPayload> {
	return {
		kind: "work-item-domain-action-proposal-intake",
		proposalId,
		workItemId,
		actionKind,
		payload: opts.payload,
		reason: opts.reason,
		policyId: opts.policyId,
		effectRunId: opts.effectRunId,
		effectRunResultId: opts.effectRunResultId,
		evidenceId: opts.evidenceId,
		proposedAtMs: opts.proposedAtMs,
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

export function workItemDomainActionApplyPolicy(
	policyId: string,
	opts: Omit<Partial<WorkItemDomainActionApplyPolicy>, "kind" | "policyId"> = {},
): WorkItemDomainActionApplyPolicy {
	return {
		kind: "work-item-domain-action-apply-policy",
		policyId,
		actionKinds: opts.actionKinds,
		patch: opts.patch,
		spawn: opts.spawn,
		metadata: opts.metadata,
	};
}

export function workItemDomainActionProposalIntakeProjector(
	graph: Graph,
	opts: WorkItemDomainActionIntakeOptions,
): WorkItemDomainActionIntakeBundle {
	const name = opts.name ?? "workItemDomainActionIntake";
	const now = opts.now ?? Date.now;
	const runtime = graph.node<IntakeFact>(
		[opts.proposals],
		(ctx) => {
			const state = ctx.state.get<IntakeState>() ?? {
				proposals: new Set(),
				statusSeq: 0,
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) reduceProposalIntake(ctx, state, raw, now());
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemDomainActionProposalIntakeProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		proposals: project(
			graph,
			runtime,
			`${name}/proposals`,
			"workItemDomainActionProposals",
			(fact) => (fact.kind === "proposal" ? fact.value : undefined),
		),
		status: project(graph, runtime, `${name}/status`, "workItemDomainActionStatus", (fact) =>
			fact.kind === "status" ? fact.value : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "workItemDomainActionIssues", (fact) =>
			fact.kind === "issue" ? fact.value : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemDomainActionAudit", (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
}

export function workItemDomainActionApplicationProjector<TInput = unknown>(
	graph: Graph,
	opts: WorkItemDomainActionApplicationOptions<TInput>,
): WorkItemDomainActionApplicationBundle<TInput> {
	const name = opts.name ?? "workItemDomainActionApplication";
	const deps =
		opts.applyPolicies === undefined
			? [opts.proposals, opts.admissions, opts.workItems]
			: [opts.proposals, opts.admissions, opts.workItems, opts.applyPolicies];
	const runtime = graph.node<ApplicationFact<TInput>>(
		deps,
		(ctx) => {
			const state = ctx.state.get<ApplicationState<TInput>>() ?? {
				proposals: new Map(),
				admissions: new Map(),
				workItems: new Map(),
				policies: new Map(),
				appliedAdmissions: new Set(),
				emittedFactIds: new Set(),
				issueKeys: new Set(),
				statusSeq: 0,
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const proposal = raw as WorkItemDomainActionProposal;
				if (state.proposals.has(proposal.proposalId)) {
					emitApplicationIssue(
						ctx,
						state,
						`duplicate-proposal:${proposal.proposalId}`,
						"duplicate-suppressed",
						`Duplicate WorkItem domain action proposal '${proposal.proposalId}' suppressed`,
						proposal.workItemId,
						proposal.sourceRefs,
					);
					continue;
				}
				state.proposals.set(proposal.proposalId, proposal);
			}
			for (const raw of depBatch(ctx, 2) ?? []) {
				const workItem = raw as WorkItemProjection<TInput>;
				state.workItems.set(workItem.workItemId, workItem);
			}
			if (opts.applyPolicies !== undefined) {
				for (const raw of depBatch(ctx, 3) ?? []) {
					const policy = raw as WorkItemDomainActionApplyPolicy;
					state.policies.set(policy.policyId, policy);
				}
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const admission = raw as WorkItemDomainActionAdmission;
				if (state.admissions.has(admission.admissionId)) {
					emitApplicationIssue(
						ctx,
						state,
						`duplicate-admission:${admission.admissionId}`,
						"duplicate-suppressed",
						`Duplicate WorkItem domain action admission '${admission.admissionId}' suppressed`,
						admission.workItemId,
						admissionRefs(admission),
					);
					continue;
				}
				state.admissions.set(admission.admissionId, admission);
			}
			for (const admission of state.admissions.values()) applyAdmission(ctx, state, admission);
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemDomainActionApplicationProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		authoringFacts: project(
			graph,
			runtime,
			`${name}/authoringFacts`,
			"workItemDomainActionAuthoringFacts",
			(fact) => (fact.kind === "authoring-fact" ? fact.value : undefined),
		),
		applications: project(
			graph,
			runtime,
			`${name}/applications`,
			"workItemDomainActionApplications",
			(fact) => (fact.kind === "application" ? fact.value : undefined),
		),
		status: project(graph, runtime, `${name}/status`, "workItemDomainActionStatus", (fact) =>
			fact.kind === "status" ? fact.value : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "workItemDomainActionIssues", (fact) =>
			fact.kind === "issue" ? fact.value : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemDomainActionAudit", (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
}

/**
 * Connects CapabilityAdmission facts to WorkItem domain-action admission as a
 * product-owned guard (D357), without adding protocol/boundary vocabulary or
 * treating AutoPanel display affordances as hard security enforcement.
 */
export function workItemDomainActionCapabilityGuardProjector(
	graph: Graph,
	opts: WorkItemDomainActionCapabilityGuardOptions,
): WorkItemDomainActionCapabilityGuardBundle {
	const name = opts.name ?? "workItemDomainActionCapabilityGuard";
	const deps =
		opts.capabilityAdmissionStatus === undefined
			? [opts.proposals, opts.capabilityAdmissions, opts.guardPolicies]
			: [
					opts.proposals,
					opts.capabilityAdmissions,
					opts.guardPolicies,
					opts.capabilityAdmissionStatus,
				];
	const statusIndex = opts.capabilityAdmissionStatus === undefined ? -1 : 3;
	const now = opts.now ?? Date.now;
	const runtime = graph.node<CapabilityGuardFact>(
		deps,
		(ctx) => {
			const state: CapabilityGuardState = ctx.state.get<CapabilityGuardState>() ?? {
				proposals: new Map(),
				admissionsByCapability: new Map(),
				issueStatusesByCapability: new Map(),
				issueStatusesWithoutCapability: [],
				policies: new Map(),
				emittedProposalDecisions: new Set(),
				emittedStatusKeys: new Set(),
				issueKeys: new Set(),
				statusSeq: 0,
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 2) ?? []) {
				const policyIssue = capabilityGuardPolicyIssue(raw);
				if (policyIssue !== undefined) {
					emitCapabilityGuardIssue(
						ctx,
						state,
						`malformed-policy:${recordString(raw, "policyId") ?? "unknown"}`,
						policyIssue,
					);
					continue;
				}
				const policy = raw as WorkItemDomainActionCapabilityGuardPolicy;
				state.policies.set(policy.policyId, policy);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const admissionIssue = capabilityAdmissionIssue(raw);
				if (admissionIssue !== undefined) {
					emitCapabilityGuardIssue(
						ctx,
						state,
						`malformed-admission:${recordString(raw, "admissionId") ?? "unknown"}`,
						admissionIssue,
					);
					continue;
				}
				const admission = raw as CapabilityAdmission;
				const byCapability: CapabilityAdmission[] =
					state.admissionsByCapability.get(admission.capability.id) ?? [];
				if (!byCapability.some((item) => item.admissionId === admission.admissionId)) {
					state.admissionsByCapability.set(admission.capability.id, [...byCapability, admission]);
				}
			}
			if (statusIndex >= 0) {
				for (const raw of depBatch(ctx, statusIndex) ?? []) {
					const statusIssue = capabilityAdmissionStatusIssue(raw);
					if (statusIssue !== undefined) {
						emitCapabilityGuardIssue(
							ctx,
							state,
							`malformed-capability-status:${recordString(raw, "statusId") ?? "unknown"}`,
							statusIssue,
						);
						continue;
					}
					const status = raw as CapabilityAdmissionStatus;
					if (status.state !== "capability-admission-issue") continue;
					if (status.capabilityId !== undefined) {
						const statuses: CapabilityAdmissionStatus[] =
							state.issueStatusesByCapability.get(status.capabilityId) ?? [];
						if (!statuses.some((item) => item.statusId === status.statusId)) {
							state.issueStatusesByCapability.set(status.capabilityId, [...statuses, status]);
						}
					} else if (
						!state.issueStatusesWithoutCapability.some((item) => item.statusId === status.statusId)
					) {
						state.issueStatusesWithoutCapability.push(status);
					}
					for (const proposal of state.proposals.values())
						emitCapabilityStatusIssueForProposal(ctx, state, proposal, status);
				}
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				const proposalIssue = capabilityGuardProposalIssue(raw);
				if (proposalIssue !== undefined) {
					emitCapabilityGuardIssue(
						ctx,
						state,
						`malformed-proposal:${recordString(raw, "proposalId") ?? "unknown"}`,
						proposalIssue,
					);
					continue;
				}
				const proposal = raw as WorkItemDomainActionProposal;
				state.proposals.set(proposal.proposalId, proposal);
			}
			for (const proposal of state.proposals.values())
				evaluateCapabilityGuardProposal(ctx, state, proposal, now());
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemDomainActionCapabilityGuardProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		decisions: project(
			graph,
			runtime,
			`${name}/decisions`,
			"workItemDomainActionCapabilityGuardDecisions",
			(fact) => (fact.kind === "decision" ? fact.value : undefined),
		),
		status: project(
			graph,
			runtime,
			`${name}/status`,
			"workItemDomainActionCapabilityGuardStatus",
			(fact) => (fact.kind === "status" ? fact.value : undefined),
		),
		issues: project(
			graph,
			runtime,
			`${name}/issues`,
			"workItemDomainActionCapabilityGuardIssues",
			(fact) => (fact.kind === "issue" ? fact.value : undefined),
		),
		audit: project(
			graph,
			runtime,
			`${name}/audit`,
			"workItemDomainActionCapabilityGuardAudit",
			(fact) => (fact.kind === "audit" ? fact.value : undefined),
		),
	};
}

function evaluateCapabilityGuardProposal(
	ctx: Ctx,
	state: CapabilityGuardState,
	proposal: WorkItemDomainActionProposal,
	decidedAtMs: number,
): void {
	if (state.emittedProposalDecisions.has(proposal.proposalId)) return;
	const policy = selectCapabilityGuardPolicy(state, proposal);
	if (typeof policy === "string") {
		emitCapabilityGuardIssue(
			ctx,
			state,
			`policy:${proposal.proposalId}:${policy}`,
			dataIssue(policy, capabilityGuardPolicyMessage(policy, proposal), {
				subjectId: proposal.workItemId,
				refs: [ref("work-item-domain-action-proposal", proposal.proposalId)],
			}),
		);
		return;
	}
	for (const status of state.issueStatusesWithoutCapability)
		emitCapabilityStatusIssueForProposal(ctx, state, proposal, status);
	for (const capabilityId of policy.capabilityIds) {
		for (const status of state.issueStatusesByCapability.get(capabilityId) ?? [])
			emitCapabilityStatusIssueForProposal(ctx, state, proposal, status);
	}
	const admissions = policy.capabilityIds.map((capabilityId) =>
		latestCapabilityAdmission(state, capabilityId),
	);
	const missingCapabilityIds = policy.capabilityIds.filter(
		(_, index) => admissions[index] === undefined,
	);
	const deferredCapabilityIds = admissions
		.filter((admission): admission is CapabilityAdmission => admission !== undefined)
		.filter((admission) => admission.state === "deferred")
		.map((admission) => admission.capability.id);
	if (missingCapabilityIds.length > 0 || deferredCapabilityIds.length > 0) {
		emitCapabilityGuardStatusOnce(
			ctx,
			state,
			`deferred:${proposal.proposalId}:${policy.policyId}:missing=${missingCapabilityIds.join(",")}:deferred=${deferredCapabilityIds.join(",")}`,
			{
				state: "deferred",
				workItemId: proposal.workItemId,
				proposalId: proposal.proposalId,
				actionKind: proposal.actionKind,
				policyId: policy.policyId,
				capabilityIds: policy.capabilityIds,
				message: "WorkItem domain action is waiting for capability admission",
				sourceRefs: capabilityGuardRefs(proposal, policy, admissions),
				metadata: { missingCapabilityIds, deferredCapabilityIds },
			},
		);
		return;
	}
	const presentAdmissions = admissions.filter(
		(admission): admission is CapabilityAdmission => admission !== undefined,
	);
	const blocked = presentAdmissions.filter((admission) => admission.state === "blocked");
	const outcome: WorkItemDomainActionAdmissionDecision["outcome"] =
		blocked.length === 0 ? "admit" : "reject";
	const decision: WorkItemDomainActionAdmissionDecision = {
		kind: "work-item-domain-action-admission-decision",
		decisionId: `capability-guard:${proposal.proposalId}:decision`,
		admissionId: `capability-guard:${proposal.proposalId}:admission`,
		proposalId: proposal.proposalId,
		outcome,
		reason:
			blocked.length === 0
				? "Capability guard admitted required capabilities"
				: "Capability guard rejected blocked capabilities",
		decidedAtMs,
		sourceRefs: capabilityGuardRefs(proposal, policy, presentAdmissions),
		metadata: {
			capabilityGuardPolicyId: policy.policyId,
			capabilityIds: policy.capabilityIds,
			blockedCapabilityIds: blocked.map((admission) => admission.capability.id),
		},
	};
	state.emittedProposalDecisions.add(proposal.proposalId);
	emitCapabilityGuard(ctx, "decision", decision);
	emitCapabilityGuardStatus(ctx, state, {
		state: outcome === "admit" ? "admitted" : "rejected",
		workItemId: proposal.workItemId,
		proposalId: proposal.proposalId,
		actionKind: proposal.actionKind,
		policyId: policy.policyId,
		capabilityIds: policy.capabilityIds,
		admissionIds: presentAdmissions.map((admission) => admission.admissionId),
		sourceRefs: decision.sourceRefs,
		metadata: { decisionId: decision.decisionId, admissionId: decision.admissionId },
	});
}

function capabilityGuardProposalIssue(proposal: unknown): DataIssue | undefined {
	if (
		!isRecord(proposal) ||
		proposal.kind !== "work-item-domain-action-proposal" ||
		typeof proposal.proposalId !== "string" ||
		proposal.proposalId.length === 0 ||
		typeof proposal.workItemId !== "string" ||
		proposal.workItemId.length === 0 ||
		typeof proposal.actionKind !== "string" ||
		proposal.actionKind.length === 0
	) {
		return dataIssue(
			"malformed-work-item-domain-action-capability-guard-proposal",
			"WorkItem domain action capability guard requires valid proposal DATA facts",
			{ subjectId: recordString(proposal, "workItemId") },
		);
	}
	return undefined;
}

function capabilityGuardPolicyIssue(policy: unknown): DataIssue | undefined {
	if (
		!isRecord(policy) ||
		policy.kind !== "work-item-domain-action-capability-guard-policy" ||
		typeof policy.policyId !== "string" ||
		policy.policyId.length === 0 ||
		!Array.isArray(policy.capabilityIds) ||
		policy.capabilityIds.length === 0 ||
		!policy.capabilityIds.every((id) => typeof id === "string" && id.length > 0) ||
		(policy.actionKinds !== undefined &&
			(!Array.isArray(policy.actionKinds) ||
				!policy.actionKinds.every((kind) => typeof kind === "string" && kind.length > 0)))
	) {
		return dataIssue(
			"malformed-work-item-domain-action-capability-guard-policy",
			"WorkItem domain action capability guard policy requires policyId and opaque capabilityIds",
			{
				subjectId: recordString(policy, "policyId"),
			},
		);
	}
	return undefined;
}

function capabilityAdmissionIssue(admission: unknown): DataIssue | undefined {
	if (
		!isRecord(admission) ||
		admission.kind !== "capability-admission" ||
		typeof admission.admissionId !== "string" ||
		admission.admissionId.length === 0 ||
		typeof admission.proposalId !== "string" ||
		admission.proposalId.length === 0 ||
		typeof admission.subjectId !== "string" ||
		admission.subjectId.length === 0 ||
		!isRecord(admission.capability) ||
		typeof admission.capability.id !== "string" ||
		admission.capability.id.length === 0 ||
		typeof admission.capability.kind !== "string" ||
		admission.capability.kind.length === 0 ||
		!isCapabilityAdmissionState(admission.state) ||
		typeof admission.decisionId !== "string" ||
		admission.decisionId.length === 0
	) {
		return dataIssue(
			"malformed-capability-admission",
			"WorkItem domain action capability guard requires valid CapabilityAdmission DATA facts",
			{ subjectId: recordString(admission, "subjectId") },
		);
	}
	return undefined;
}

function capabilityAdmissionStatusIssue(status: unknown): DataIssue | undefined {
	if (
		!isRecord(status) ||
		status.kind !== "capability-admission-status" ||
		typeof status.statusId !== "string" ||
		status.statusId.length === 0 ||
		!isCapabilityAdmissionStatusState(status.state) ||
		(status.capabilityId !== undefined && typeof status.capabilityId !== "string")
	) {
		return dataIssue(
			"malformed-capability-admission-status",
			"WorkItem domain action capability guard requires valid CapabilityAdmissionStatus DATA facts",
			{ subjectId: recordString(status, "subjectId") },
		);
	}
	return undefined;
}

function isCapabilityAdmissionState(value: unknown): value is CapabilityAdmission["state"] {
	return value === "allowed" || value === "blocked" || value === "deferred";
}

function isCapabilityAdmissionStatusState(
	value: unknown,
): value is CapabilityAdmissionStatus["state"] {
	return (
		value === "capability-admission-allowed" ||
		value === "capability-admission-blocked" ||
		value === "capability-admission-deferred" ||
		value === "capability-admission-issue"
	);
}

function selectCapabilityGuardPolicy(
	state: CapabilityGuardState,
	proposal: WorkItemDomainActionProposal,
):
	| WorkItemDomainActionCapabilityGuardPolicy
	| "missing-policy"
	| "unknown-work-item-domain-action-capability-guard-policy"
	| "policy-mismatch" {
	const explicitId =
		stringMetadata(proposal.metadata, "capabilityGuardPolicyId") ??
		proposal.sourceRefs?.find(
			(sourceRef) => sourceRef.kind === "work-item-domain-action-capability-guard-policy",
		)?.id;
	if (explicitId !== undefined)
		return (
			state.policies.get(explicitId) ?? "unknown-work-item-domain-action-capability-guard-policy"
		);
	const matching = [...state.policies.values()].filter(
		(policy) =>
			policy.actionKinds === undefined || policy.actionKinds.includes(proposal.actionKind),
	);
	if (matching.length === 0) return "missing-policy";
	if (matching.length > 1) return "policy-mismatch";
	return matching[0];
}

function latestCapabilityAdmission(
	state: CapabilityGuardState,
	capabilityId: string,
): CapabilityAdmission | undefined {
	return state.admissionsByCapability.get(capabilityId)?.at(-1);
}

function emitCapabilityStatusIssueForProposal(
	ctx: Ctx,
	state: CapabilityGuardState,
	proposal: WorkItemDomainActionProposal,
	status: CapabilityAdmissionStatus,
): void {
	const policy = selectCapabilityGuardPolicy(state, proposal);
	if (typeof policy === "string") return;
	if (status.capabilityId !== undefined && !policy.capabilityIds.includes(status.capabilityId))
		return;
	const issue =
		status.issues?.[0] ??
		dataIssue(
			"capability-admission-status-issue",
			"Capability admission status reported an issue",
			{ subjectId: proposal.workItemId },
		);
	emitCapabilityGuardIssue(
		ctx,
		state,
		`capability-status:${proposal.proposalId}:${status.statusId}`,
		dataIssue(issue.code, issue.message, {
			subjectId: proposal.workItemId,
			refs: uniqueSourceRefs([
				...capabilityGuardRefs(proposal, policy),
				...(status.sourceRefs ?? []),
			]),
			metadata: {
				...(status.capabilityId === undefined ? {} : { capabilityId: status.capabilityId }),
				capabilityAdmissionStatusId: status.statusId,
			},
		}),
	);
}

function capabilityGuardPolicyMessage(
	code:
		| "missing-policy"
		| "unknown-work-item-domain-action-capability-guard-policy"
		| "policy-mismatch",
	proposal: WorkItemDomainActionProposal,
): string {
	if (code === "missing-policy")
		return `WorkItem domain action '${proposal.proposalId}' has no capability guard policy`;
	if (code === "unknown-work-item-domain-action-capability-guard-policy")
		return `WorkItem domain action '${proposal.proposalId}' references a missing capability guard policy`;
	return `WorkItem domain action '${proposal.proposalId}' matches multiple capability guard policies`;
}

function capabilityGuardRefs(
	proposal: WorkItemDomainActionProposal,
	policy: WorkItemDomainActionCapabilityGuardPolicy,
	admissions: readonly (CapabilityAdmission | undefined)[] = [],
): readonly SourceRef[] {
	return uniqueSourceRefs([
		ref("work-item", proposal.workItemId),
		ref("work-item-domain-action-proposal", proposal.proposalId),
		ref("work-item-domain-action-capability-guard-policy", policy.policyId),
		...admissions
			.filter((admission): admission is CapabilityAdmission => admission !== undefined)
			.flatMap((admission) => [
				ref("capability-admission", admission.admissionId),
				ref("capability-admission-proposal", admission.proposalId),
				ref("boundary-capability", capabilityBoundaryRefId(admission.capability)),
				...(admission.sourceRefs ?? []),
			]),
		...(proposal.sourceRefs ?? []),
	]);
}

function capabilityBoundaryRefId(capability: CapabilityAdmission["capability"]): string {
	return `${capability.kind}:${capability.id}`;
}

function emitCapabilityGuardStatus(
	ctx: Ctx,
	state: CapabilityGuardState,
	status: Omit<WorkItemDomainActionCapabilityGuardStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact: WorkItemDomainActionCapabilityGuardStatus = {
		kind: "work-item-domain-action-capability-guard-status",
		statusId: `work-item-domain-action-capability-guard-status:${state.statusSeq}`,
		...status,
	};
	emitCapabilityGuard(ctx, "status", statusFact);
	state.auditSeq += 1;
	emitCapabilityGuard(ctx, "audit", {
		id: `work-item-domain-action-capability-guard-status:${state.auditSeq}`,
		kind: "work-item-domain-action-capability-guard-status",
		subjectId: status.workItemId,
		message: status.message,
		sourceRefs: status.sourceRefs,
		metadata: {
			statusId: statusFact.statusId,
			state: status.state,
			proposalId: status.proposalId,
			policyId: status.policyId,
			...(status.metadata ?? {}),
		},
	});
}

function emitCapabilityGuardStatusOnce(
	ctx: Ctx,
	state: CapabilityGuardState,
	key: string,
	status: Omit<WorkItemDomainActionCapabilityGuardStatus, "kind" | "statusId">,
): void {
	if (state.emittedStatusKeys.has(key)) return;
	state.emittedStatusKeys.add(key);
	emitCapabilityGuardStatus(ctx, state, status);
}

function emitCapabilityGuardIssue(
	ctx: Ctx,
	state: CapabilityGuardState,
	key: string,
	issue: DataIssue,
): void {
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	emitCapabilityGuard(ctx, "issue", issue);
	emitCapabilityGuardStatus(ctx, state, {
		state: "issue",
		workItemId: issue.subjectId,
		issues: [issue],
		message: issue.message,
		metadata: { issueCode: issue.code },
	});
}

function emitCapabilityGuard<K extends CapabilityGuardFact["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<CapabilityGuardFact, { readonly kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value } as unknown as CapabilityGuardFact]]);
}

function reduceProposalIntake(
	ctx: Ctx,
	state: IntakeState,
	input: unknown,
	proposedAtMs: number,
): void {
	const proposal = normalizeProposal(input, proposedAtMs);
	if (typeof proposal === "string") {
		const issue = dataIssue("malformed-domain-action-proposal", proposal);
		emitIntake(ctx, "issue", issue);
		emitIntakeStatus(ctx, state, {
			state: "rejected",
			code: issue.code,
			message: issue.message,
		});
		return;
	}
	if (state.proposals.has(proposal.proposalId)) {
		emitIntakeStatus(ctx, state, {
			state: "duplicate",
			code: "duplicate-suppressed",
			workItemId: proposal.workItemId,
			proposalId: proposal.proposalId,
			actionKind: proposal.actionKind,
			message: `Duplicate WorkItem domain action proposal '${proposal.proposalId}' suppressed`,
		});
		return;
	}
	state.proposals.add(proposal.proposalId);
	emitIntake(ctx, "proposal", proposal);
	emitIntakeStatus(ctx, state, {
		state: "proposed",
		workItemId: proposal.workItemId,
		proposalId: proposal.proposalId,
		actionKind: proposal.actionKind,
		sourceRefs: proposal.sourceRefs,
	});
}

function normalizeProposal(
	input: unknown,
	proposedAtMs: number,
): WorkItemDomainActionProposal | string {
	if (!isRecord(input)) return "WorkItemDomainActionProposal intake must be an object";
	if (
		input.kind !== "work-item-domain-action-proposal" &&
		input.kind !== "work-item-domain-action-proposal-intake"
	)
		return "WorkItemDomainActionProposal intake has unsupported kind";
	if (typeof input.proposalId !== "string" || input.proposalId.trim() === "")
		return "WorkItemDomainActionProposal.proposalId is required";
	if (typeof input.workItemId !== "string" || input.workItemId.trim() === "")
		return "WorkItemDomainActionProposal.workItemId is required";
	if (typeof input.actionKind !== "string" || input.actionKind.trim() === "")
		return "WorkItemDomainActionProposal.actionKind is required";
	if (input.kind === "work-item-domain-action-proposal") {
		if (typeof input.effectRunId !== "string")
			return "WorkItemDomainActionProposal.effectRunId is required";
		if (typeof input.effectRunResultId !== "string")
			return "WorkItemDomainActionProposal.effectRunResultId is required";
		if (typeof input.evidenceId !== "string")
			return "WorkItemDomainActionProposal.evidenceId is required";
		if (typeof input.policyId !== "string")
			return "WorkItemDomainActionProposal.policyId is required";
		return input as unknown as WorkItemDomainActionProposal;
	}
	return workItemDomainActionProposal(
		input.proposalId,
		input.workItemId,
		input.actionKind as WorkItemDomainActionKind,
		{
			payload: input.payload,
			reason: typeof input.reason === "string" ? input.reason : undefined,
			policyId: typeof input.policyId === "string" ? input.policyId : undefined,
			effectRunId: typeof input.effectRunId === "string" ? input.effectRunId : undefined,
			effectRunResultId:
				typeof input.effectRunResultId === "string" ? input.effectRunResultId : undefined,
			evidenceId: typeof input.evidenceId === "string" ? input.evidenceId : undefined,
			proposedAtMs: typeof input.proposedAtMs === "number" ? input.proposedAtMs : proposedAtMs,
			sourceRefs: sourceRefs(input.sourceRefs),
			metadata: isRecord(input.metadata) ? input.metadata : undefined,
		},
	);
}

function applyAdmission<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	admission: WorkItemDomainActionAdmission,
): void {
	if (state.appliedAdmissions.has(admission.admissionId)) return;
	const proposal = state.proposals.get(admission.proposalId);
	if (proposal === undefined) {
		emitApplicationIssue(
			ctx,
			state,
			`missing-proposal:${admission.admissionId}:${admission.proposalId}`,
			"dangling-ref",
			`Admission '${admission.admissionId}' cannot apply without proposal '${admission.proposalId}'`,
			admission.workItemId,
			admissionRefs(admission),
		);
		return;
	}
	if (admission.state !== "admitted") {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplication(ctx, state, admission, proposal, admission.state, []);
		return;
	}
	const mismatch = admissionProposalMismatch(admission, proposal);
	if (mismatch !== undefined) {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplicationIssue(
			ctx,
			state,
			`admission-proposal-mismatch:${admission.admissionId}:${mismatch.field}`,
			"dangling-ref",
			mismatch.message,
			admission.workItemId,
			admissionRefs(admission, proposal),
			{
				field: mismatch.field,
				admissionValue: mismatch.admissionValue,
				proposalValue: mismatch.proposalValue,
			},
		);
		emitApplication(ctx, state, admission, proposal, "rejected", [], {
			code: "dangling-ref",
			message: mismatch.message,
		});
		return;
	}
	const workItem = state.workItems.get(admission.workItemId);
	if (workItem === undefined) {
		emitApplicationIssue(
			ctx,
			state,
			`missing-work-item:${admission.admissionId}:${admission.workItemId}`,
			"dangling-ref",
			`Admission '${admission.admissionId}' references unknown WorkItem '${admission.workItemId}'`,
			admission.workItemId,
			admissionRefs(admission, proposal),
		);
		return;
	}
	const metadataConflict = conflictingApplicationMetadata(proposal, admission);
	if (metadataConflict !== undefined) {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplicationIssue(
			ctx,
			state,
			`metadata-conflict:${admission.admissionId}:${metadataConflict.field}`,
			metadataConflict.code,
			metadataConflict.message,
			admission.workItemId,
			admissionRefs(admission, proposal),
			{
				field: metadataConflict.field,
				admissionValue: metadataConflict.admissionValue,
				proposalValue: metadataConflict.proposalValue,
			},
		);
		emitApplication(ctx, state, admission, proposal, "rejected", [], {
			code: metadataConflict.code,
			message: metadataConflict.message,
		});
		return;
	}
	const stale = staleRevision(proposal, admission, workItem);
	if (stale !== undefined) {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplicationIssue(
			ctx,
			state,
			`stale:${admission.admissionId}:${stale.kind}:${stale.expected}:${stale.current}`,
			stale.kind,
			`Admission '${admission.admissionId}' targets stale WorkItem revision`,
			admission.workItemId,
			admissionRefs(admission, proposal),
			{ expected: stale.expected, current: stale.current },
		);
		emitApplication(ctx, state, admission, proposal, "rejected", [], {
			code: stale.kind,
			message: "Stale WorkItem revision",
		});
		return;
	}
	const policyResult = selectApplyPolicy(state, proposal, admission);
	if (typeof policyResult === "string") {
		emitApplicationIssue(
			ctx,
			state,
			`policy:${admission.admissionId}:${policyResult}`,
			policyResult,
			applyPolicyMessage(policyResult, proposal, admission),
			admission.workItemId,
			admissionRefs(admission, proposal),
		);
		return;
	}
	const output = lowerAction(ctx, state, workItem, proposal, admission, policyResult);
	if (output === undefined) {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplication(ctx, state, admission, proposal, "rejected", [], {
			code: "invalid-action",
			message: "WorkItem domain action application rejected; see emitted issues",
			policyId: policyResult.policyId,
		});
		return;
	}
	const duplicateFactId = firstDuplicateFactId(state, output.facts);
	if (duplicateFactId !== undefined) {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplicationIssue(
			ctx,
			state,
			`duplicate-authoring-fact:${admission.admissionId}:${duplicateFactId}`,
			"duplicate-suppressed",
			`WorkItem domain action application '${admission.admissionId}' would duplicate authoring fact '${duplicateFactId}'`,
			admission.workItemId,
			admissionRefs(admission, proposal, policyResult),
			{ eventId: duplicateFactId },
		);
		emitApplication(ctx, state, admission, proposal, "duplicate", [], {
			code: "duplicate-suppressed",
			message: "Duplicate WorkItem authoring fact suppressed atomically",
			policyId: policyResult.policyId,
		});
		return;
	}
	state.appliedAdmissions.add(admission.admissionId);
	for (const fact of output.facts) claimFactId(state, fact.eventId);
	for (const fact of output.facts) emitApplicationFact(ctx, "authoring-fact", fact);
	emitApplication(ctx, state, admission, proposal, output.state, output.facts, {
		code: output.code,
		message: output.message,
		policyId: policyResult.policyId,
	});
}

function lowerAction<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	workItem: WorkItemProjection<T>,
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	policy: WorkItemDomainActionApplyPolicy,
):
	| {
			readonly state: WorkItemDomainActionApplication["state"];
			readonly facts: readonly WorkItemAuthoringFact<T>[];
			readonly code?: string;
			readonly message?: string;
	  }
	| undefined {
	if (!policyAllowsAction(policy, proposal.actionKind)) {
		emitApplicationIssue(
			ctx,
			state,
			`policy-action:${admission.admissionId}:${policy.policyId}:${proposal.actionKind}`,
			"policy-mismatch",
			`Apply policy '${policy.policyId}' does not allow actionKind '${proposal.actionKind}'`,
			proposal.workItemId,
			admissionRefs(admission, proposal, policy),
		);
		return { state: "policy-rejected", facts: [], code: "policy-mismatch" };
	}
	if (proposal.actionKind === "patch") {
		const lowered = lowerPatchAction(ctx, state, workItem, proposal, admission, policy);
		if (lowered === undefined) return undefined;
		return { state: "applied", facts: lowered };
	}
	if (proposal.actionKind === "mark-verified" || proposal.actionKind === "require-review") {
		return {
			state: "proposal-only",
			facts: [],
			code: "domain-fact-unimplemented",
			message: `Action '${proposal.actionKind}' recorded as visible application status only; no WorkItem domain mutation fact was emitted`,
		};
	}
	if (proposal.actionKind === "spawn-proposed" || proposal.actionKind === "spawn-child") {
		return lowerSpawnAction(ctx, state, proposal, admission, policy);
	}
	emitApplicationIssue(
		ctx,
		state,
		`unsupported-action:${admission.admissionId}:${proposal.actionKind}`,
		"unsupported-effect-kind",
		`Unsupported WorkItem domain actionKind '${proposal.actionKind}'`,
		proposal.workItemId,
		admissionRefs(admission, proposal, policy),
	);
	return { state: "rejected", facts: [], code: "unsupported-effect-kind" };
}

function lowerPatchAction<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	workItem: WorkItemProjection<T>,
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	policy: WorkItemDomainActionApplyPolicy,
): readonly WorkItemAuthoringFact<T>[] | undefined {
	const payload = normalizePatchPayload<T>(proposal.payload);
	if (typeof payload === "string") {
		emitApplicationIssue(
			ctx,
			state,
			`invalid-patch:${admission.admissionId}`,
			"invalid-patch",
			payload,
			proposal.workItemId,
			admissionRefs(admission, proposal, policy),
		);
		return undefined;
	}
	const splitPayload = splitDedicatedPatchFields(payload, workItem);
	const facts: WorkItemAuthoringFact<T>[] = [];
	if (splitPayload.patch !== undefined) {
		const invalid = invalidPatchKeys(splitPayload.patch, policy);
		if (invalid.length > 0) {
			emitApplicationIssue(
				ctx,
				state,
				`invalid-patch-fields:${admission.admissionId}:${invalid.join(",")}`,
				"invalid-patch",
				`Patch action uses unsupported fields: ${invalid.join(", ")}`,
				proposal.workItemId,
				admissionRefs(admission, proposal, policy),
				{ invalidFields: invalid },
			);
			return undefined;
		}
		facts.push({
			kind: "work-item-patched",
			eventId: splitPayload.eventId ?? `${admission.admissionId}:work-item-patched`,
			workItemId: workItem.workItemId,
			patch: splitPayload.patch,
			executionRelevantFields:
				splitPayload.executionRelevantFields ?? policy.patch?.executionRelevantFields,
			authorId: splitPayload.authorId,
			sourceRefs: actionSourceRefs(admission, proposal, policy),
			metadata: { ...(splitPayload.metadata ?? {}), actionKind: proposal.actionKind },
		});
	}
	if (splitPayload.acceptanceCriteria !== undefined) {
		if (!allowsAcceptanceCriteria(policy)) {
			emitApplicationIssue(
				ctx,
				state,
				`ac-policy:${admission.admissionId}`,
				"policy-mismatch",
				`Apply policy '${policy.policyId}' does not allow acceptance criteria changes`,
				proposal.workItemId,
				admissionRefs(admission, proposal, policy),
			);
			return undefined;
		}
		const issues = validateAcceptanceCriteria(splitPayload.acceptanceCriteria, {
			workItemId: workItem.workItemId,
		});
		if (issues.length > 0) {
			for (const item of issues) emitApplicationFact(ctx, "issue", item);
			emitApplicationStatus(ctx, state, {
				state: "rejected",
				code: issues[0]?.code,
				message: issues[0]?.message,
				workItemId: workItem.workItemId,
				proposalId: proposal.proposalId,
				admissionId: admission.admissionId,
				actionKind: proposal.actionKind,
				sourceRefs: admissionRefs(admission, proposal, policy),
			});
			return undefined;
		}
		facts.push({
			kind: "acceptance-criteria-changed",
			eventId: `${admission.admissionId}:acceptance-criteria-changed`,
			workItemId: workItem.workItemId,
			acceptanceCriteria: splitPayload.acceptanceCriteria,
			authorId: splitPayload.authorId,
			sourceRefs: actionSourceRefs(admission, proposal, policy),
			metadata: { ...(splitPayload.metadata ?? {}), actionKind: proposal.actionKind },
		});
	}
	if (splitPayload.verificationPlan !== undefined) {
		if (!allowsVerificationPlan(policy)) {
			emitApplicationIssue(
				ctx,
				state,
				`plan-policy:${admission.admissionId}`,
				"policy-mismatch",
				`Apply policy '${policy.policyId}' does not allow verification plan changes`,
				proposal.workItemId,
				admissionRefs(admission, proposal, policy),
			);
			return undefined;
		}
		const issues = validateVerificationPlan(
			splitPayload.verificationPlan,
			splitPayload.acceptanceCriteria ?? workItem.acceptanceCriteria ?? [],
			{ workItemId: workItem.workItemId },
		);
		if (issues.length > 0) {
			for (const item of issues) emitApplicationFact(ctx, "issue", item);
			emitApplicationStatus(ctx, state, {
				state: "rejected",
				code: issues[0]?.code,
				message: issues[0]?.message,
				workItemId: workItem.workItemId,
				proposalId: proposal.proposalId,
				admissionId: admission.admissionId,
				actionKind: proposal.actionKind,
				sourceRefs: admissionRefs(admission, proposal, policy),
			});
			return undefined;
		}
		facts.push({
			kind: "verification-plan-changed",
			eventId: `${admission.admissionId}:verification-plan-changed`,
			workItemId: workItem.workItemId,
			verificationPlan: splitPayload.verificationPlan,
			authorId: splitPayload.authorId,
			sourceRefs: actionSourceRefs(admission, proposal, policy),
			metadata: { ...(splitPayload.metadata ?? {}), actionKind: proposal.actionKind },
		});
	}
	if (facts.length === 0) {
		emitApplicationIssue(
			ctx,
			state,
			`empty-patch:${admission.admissionId}`,
			"invalid-patch",
			"Patch action payload did not contain patch, acceptanceCriteria, or verificationPlan",
			proposal.workItemId,
			admissionRefs(admission, proposal, policy),
		);
		return undefined;
	}
	return facts;
}

function lowerSpawnAction<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	policy: WorkItemDomainActionApplyPolicy,
): {
	readonly state: WorkItemDomainActionApplication["state"];
	readonly facts: readonly WorkItemAuthoringFact<T>[];
	readonly code?: string;
	readonly message?: string;
} {
	if (policy.spawn?.create !== true) {
		return {
			state: "proposal-only",
			facts: [],
			message: "Spawn action remains proposal/admission only without explicit create policy",
		};
	}
	emitApplicationIssue(
		ctx,
		state,
		`spawn-create-policy:${admission.admissionId}:${policy.policyId}`,
		"policy-mismatch",
		`Spawn create policy '${policy.policyId}' is incomplete: child creation requires an explicit create/link/idempotency policy surface`,
		proposal.workItemId,
		admissionRefs(admission, proposal, policy),
		{
			requires: ["linkParent", "idempotencyKey", "maxChildrenPerAdmission", "link-fact-vocabulary"],
		},
	);
	return {
		state: "proposal-only",
		facts: [],
		code: "policy-mismatch",
		message:
			"Spawn action remains proposal/admission only until explicit create/link policy is available",
	};
}

function normalizePatchPayload<T>(payload: unknown): WorkItemPatchActionPayload<T> | string {
	if (!isRecord(payload)) return "Patch action payload must be an object";
	if (
		"patch" in payload ||
		"acceptanceCriteria" in payload ||
		"verificationPlan" in payload ||
		"executionRelevantFields" in payload
	) {
		if ("patch" in payload && payload.patch !== undefined && !isRecord(payload.patch))
			return "Patch action payload.patch must be an object";
		if (
			"acceptanceCriteria" in payload &&
			payload.acceptanceCriteria !== undefined &&
			!Array.isArray(payload.acceptanceCriteria)
		)
			return "Patch action payload.acceptanceCriteria must be an array";
		if (
			"verificationPlan" in payload &&
			payload.verificationPlan !== undefined &&
			!isRecord(payload.verificationPlan)
		)
			return "Patch action payload.verificationPlan must be an object";
		const inlinePatch = inlinePatchFields<T>(payload);
		const explicitPatch = isRecord(payload.patch) ? (payload.patch as WorkItemPatch<T>) : undefined;
		const patch =
			explicitPatch === undefined
				? inlinePatch
				: ({ ...inlinePatch, ...explicitPatch } as WorkItemPatch<T>);
		return {
			...(payload as unknown as WorkItemPatchActionPayload<T>),
			patch: Object.keys(patch).length === 0 ? undefined : patch,
		};
	}
	return { patch: payload as WorkItemPatch<T> };
}

function inlinePatchFields<T>(payload: Record<string, unknown>): WorkItemPatch<T> {
	const patch: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload)) {
		if (key === "metadata") continue;
		if (patchFieldKeys.has(key)) patch[key] = value;
	}
	return patch as WorkItemPatch<T>;
}

function splitDedicatedPatchFields<T>(
	payload: WorkItemPatchActionPayload<T>,
	workItem: WorkItemProjection<T>,
): WorkItemPatchActionPayload<T> {
	if (!isRecord(payload.patch)) return payload;
	const patchRecord = payload.patch as Record<string, unknown>;
	const patch: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patchRecord)) {
		if (key === "acceptanceCriteria" || key === "verificationPlan" || key === "verificationSteps")
			continue;
		patch[key] = value;
	}
	const acceptanceCriteria =
		payload.acceptanceCriteria ??
		(Array.isArray(patchRecord.acceptanceCriteria)
			? (patchRecord.acceptanceCriteria as readonly AcceptanceCriterion[])
			: undefined);
	const verificationPlan =
		payload.verificationPlan ??
		(isRecord(patchRecord.verificationPlan)
			? (patchRecord.verificationPlan as unknown as VerificationPlan<T>)
			: Array.isArray(patchRecord.verificationSteps)
				? ({
						...(workItem.verificationPlan ?? { planId: "default" }),
						steps: patchRecord.verificationSteps,
					} as VerificationPlan<T>)
				: undefined);
	return {
		...payload,
		patch: Object.keys(patch).length === 0 ? undefined : (patch as WorkItemPatch<T>),
		acceptanceCriteria,
		verificationPlan,
	};
}

function invalidPatchKeys<T>(
	patch: WorkItemPatch<T>,
	policy: WorkItemDomainActionApplyPolicy,
): readonly string[] {
	const allowed = new Set(policy.patch?.allowedFields ?? Array.from(patchFieldKeys));
	return Object.keys(patch).filter((key) => !patchFieldKeys.has(key) || !allowed.has(key));
}

function allowsAcceptanceCriteria(policy: WorkItemDomainActionApplyPolicy): boolean {
	if (policy.patch?.allowAcceptanceCriteria === false) return false;
	const allowed = policy.patch?.allowedFields;
	return (
		allowed === undefined ||
		allowed.includes("acceptanceCriteria") ||
		policy.patch?.allowAcceptanceCriteria === true
	);
}

function allowsVerificationPlan(policy: WorkItemDomainActionApplyPolicy): boolean {
	if (policy.patch?.allowVerificationPlan === false) return false;
	const allowed = policy.patch?.allowedFields;
	return (
		allowed === undefined ||
		allowed.includes("verificationPlan") ||
		allowed.includes("verificationSteps") ||
		policy.patch?.allowVerificationPlan === true
	);
}

function selectApplyPolicy<T>(
	state: ApplicationState<T>,
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
):
	| WorkItemDomainActionApplyPolicy
	| "missing-policy"
	| "unknown-work-item-domain-action-apply-policy"
	| "policy-mismatch" {
	const explicitId = explicitApplyPolicyId(proposal, admission);
	if (explicitId !== undefined)
		return state.policies.get(explicitId) ?? "unknown-work-item-domain-action-apply-policy";
	const matching = Array.from(state.policies.values()).filter((policy) =>
		policyAllowsAction(policy, proposal.actionKind),
	);
	if (matching.length === 0) return "missing-policy";
	if (matching.length > 1) return "policy-mismatch";
	return matching[0];
}

function explicitApplyPolicyId(
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
): string | undefined {
	const metadataPolicy =
		stringMetadata(admission.metadata, "applyPolicyId") ??
		stringMetadata(proposal.metadata, "applyPolicyId");
	if (metadataPolicy !== undefined) return metadataPolicy;
	return [...(admission.sourceRefs ?? []), ...(proposal.sourceRefs ?? [])].find(
		(sourceRef) => sourceRef.kind === "work-item-domain-action-apply-policy",
	)?.id;
}

function policyAllowsAction(policy: WorkItemDomainActionApplyPolicy, actionKind: string): boolean {
	return policy.actionKinds === undefined || policy.actionKinds.includes(actionKind);
}

function admissionProposalMismatch(
	admission: WorkItemDomainActionAdmission,
	proposal: WorkItemDomainActionProposal,
):
	| {
			readonly field: "workItemId" | "actionKind";
			readonly admissionValue: string;
			readonly proposalValue: string;
			readonly message: string;
	  }
	| undefined {
	if (admission.workItemId !== proposal.workItemId)
		return {
			field: "workItemId",
			admissionValue: admission.workItemId,
			proposalValue: proposal.workItemId,
			message: `Admission '${admission.admissionId}' workItemId does not match proposal '${proposal.proposalId}'`,
		};
	if (admission.actionKind !== proposal.actionKind)
		return {
			field: "actionKind",
			admissionValue: admission.actionKind,
			proposalValue: proposal.actionKind,
			message: `Admission '${admission.admissionId}' actionKind does not match proposal '${proposal.proposalId}'`,
		};
	return undefined;
}

function conflictingApplicationMetadata(
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
):
	| {
			readonly field: "authoringRevision" | "executionInputRevision" | "applyPolicyId";
			readonly code: "stale-revision" | "stale-execution-input" | "policy-mismatch";
			readonly proposalValue: number | string;
			readonly admissionValue: number | string;
			readonly message: string;
	  }
	| undefined {
	const authoringRevision = conflictingMetadataNumber(proposal, admission, "authoringRevision");
	if (authoringRevision !== undefined)
		return {
			field: "authoringRevision",
			code: "stale-revision",
			...authoringRevision,
			message: `Admission '${admission.admissionId}' carries conflicting authoringRevision metadata`,
		};
	const executionInputRevision = conflictingMetadataNumber(
		proposal,
		admission,
		"executionInputRevision",
	);
	if (executionInputRevision !== undefined)
		return {
			field: "executionInputRevision",
			code: "stale-execution-input",
			...executionInputRevision,
			message: `Admission '${admission.admissionId}' carries conflicting executionInputRevision metadata`,
		};
	const applyPolicyId = conflictingMetadataString(proposal, admission, "applyPolicyId");
	if (applyPolicyId !== undefined)
		return {
			field: "applyPolicyId",
			code: "policy-mismatch",
			...applyPolicyId,
			message: `Admission '${admission.admissionId}' carries conflicting applyPolicyId metadata`,
		};
	return undefined;
}

function conflictingMetadataNumber(
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	key: string,
): { readonly proposalValue: number; readonly admissionValue: number } | undefined {
	const proposalValue = numberMetadata(proposal.metadata, key);
	const admissionValue = numberMetadata(admission.metadata, key);
	if (
		proposalValue === undefined ||
		admissionValue === undefined ||
		proposalValue === admissionValue
	)
		return undefined;
	return { proposalValue, admissionValue };
}

function conflictingMetadataString(
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	key: string,
): { readonly proposalValue: string; readonly admissionValue: string } | undefined {
	const proposalValue = stringMetadata(proposal.metadata, key);
	const admissionValue = stringMetadata(admission.metadata, key);
	if (
		proposalValue === undefined ||
		admissionValue === undefined ||
		proposalValue === admissionValue
	)
		return undefined;
	return { proposalValue, admissionValue };
}

function staleRevision<T>(
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	workItem: WorkItemProjection<T>,
):
	| { readonly kind: "stale-revision"; readonly expected: number; readonly current: number }
	| { readonly kind: "stale-execution-input"; readonly expected: number; readonly current: number }
	| undefined {
	const authoringRevision =
		numberMetadata(admission.metadata, "authoringRevision") ??
		numberMetadata(proposal.metadata, "authoringRevision");
	if (authoringRevision !== undefined && authoringRevision !== workItem.authoringRevision)
		return {
			kind: "stale-revision",
			expected: authoringRevision,
			current: workItem.authoringRevision,
		};
	const executionInputRevision =
		numberMetadata(admission.metadata, "executionInputRevision") ??
		numberMetadata(proposal.metadata, "executionInputRevision");
	if (
		executionInputRevision !== undefined &&
		executionInputRevision !== workItem.executionInputRevision
	)
		return {
			kind: "stale-execution-input",
			expected: executionInputRevision,
			current: workItem.executionInputRevision,
		};
	return undefined;
}

function applyPolicyMessage(
	code: "missing-policy" | "unknown-work-item-domain-action-apply-policy" | "policy-mismatch",
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
): string {
	if (code === "missing-policy")
		return `Admitted action '${admission.admissionId}' requires an explicit apply policy`;
	if (code === "unknown-work-item-domain-action-apply-policy")
		return `Admitted action '${admission.admissionId}' references a missing apply policy`;
	return `Admitted action '${proposal.proposalId}' matches multiple apply policies`;
}

function emitApplication<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	admission: WorkItemDomainActionAdmission,
	proposal: WorkItemDomainActionProposal,
	applicationState: WorkItemDomainActionApplication["state"],
	facts: readonly WorkItemAuthoringFact<T>[],
	opts: { readonly code?: string; readonly message?: string; readonly policyId?: string } = {},
): void {
	const producedFactIds = facts.map((fact) => fact.eventId);
	const application: WorkItemDomainActionApplication = {
		kind: "work-item-domain-action-application",
		applicationId: `${admission.admissionId}:application`,
		admissionId: admission.admissionId,
		proposalId: proposal.proposalId,
		workItemId: proposal.workItemId,
		actionKind: proposal.actionKind,
		state: applicationState,
		producedFactIds,
		reason: admission.reason ?? proposal.reason,
		sourceRefs: admissionRefs(admission, proposal),
		metadata: { policyId: opts.policyId, code: opts.code },
	};
	emitApplicationFact(ctx, "application", application);
	emitApplicationStatus(ctx, state, {
		state: applicationState,
		code: opts.code,
		message: opts.message,
		workItemId: proposal.workItemId,
		proposalId: proposal.proposalId,
		admissionId: admission.admissionId,
		actionKind: proposal.actionKind,
		sourceRefs: application.sourceRefs,
		metadata: { producedFactIds, policyId: opts.policyId },
	});
}

function emitApplicationIssue<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	key: string,
	code: string,
	message: string,
	workItemId?: string,
	sourceRefs?: readonly SourceRef[],
	metadata?: Record<string, unknown>,
): void {
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	const item = dataIssue(code, message, { subjectId: workItemId, refs: sourceRefs, metadata });
	emitApplicationFact(ctx, "issue", item);
	emitApplicationStatus(ctx, state, {
		state: code === "missing-policy" ? "missing-policy" : "rejected",
		code,
		message,
		workItemId,
		sourceRefs,
		metadata,
	});
}

function emitIntakeStatus(
	ctx: Ctx,
	state: IntakeState,
	status: Omit<WorkItemDomainActionStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact = {
		kind: "work-item-domain-action-status",
		statusId: `work-item-domain-action-intake-status:${state.statusSeq}`,
		...status,
	} satisfies WorkItemDomainActionStatus;
	emitIntake(ctx, "status", statusFact);
	emitIntakeAudit(ctx, state, "work-item-domain-action-intake-status", statusFact);
}

function emitApplicationStatus<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	status: Omit<WorkItemDomainActionStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact = {
		kind: "work-item-domain-action-status",
		statusId: `work-item-domain-action-application-status:${state.statusSeq}`,
		...status,
	} satisfies WorkItemDomainActionStatus;
	emitApplicationFact(ctx, "status", statusFact);
	emitApplicationAudit(ctx, state, "work-item-domain-action-application-status", statusFact);
}

function emitIntakeAudit(
	ctx: Ctx,
	state: IntakeState,
	kind: string,
	status: WorkItemDomainActionStatus,
): void {
	state.auditSeq += 1;
	emitIntake(ctx, "audit", auditRecord(kind, state.auditSeq, status));
}

function emitApplicationAudit<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	kind: string,
	status: WorkItemDomainActionStatus,
): void {
	state.auditSeq += 1;
	emitApplicationFact(ctx, "audit", auditRecord(kind, state.auditSeq, status));
}

function auditRecord(
	kind: string,
	seq: number,
	status: WorkItemDomainActionStatus,
): AgentRuntimeAuditRecord {
	return {
		id: `${kind}:${seq}`,
		kind,
		subjectId: status.workItemId,
		message: status.message,
		issueCode: status.code,
		sourceRefs: status.sourceRefs,
		metadata: {
			statusId: status.statusId,
			state: status.state,
			proposalId: status.proposalId,
			admissionId: status.admissionId,
			actionKind: status.actionKind,
			...(status.metadata ?? {}),
		},
	};
}

function emitIntake<K extends IntakeFact["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<IntakeFact, { kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value } as IntakeFact]]);
}

function emitApplicationFact<T, K extends ApplicationFact<T>["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<ApplicationFact<T>, { kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value } as ApplicationFact<T>]]);
}

function project<TFact, TSelected>(
	graph: Graph,
	runtime: Node<TFact>,
	name: string,
	factory: string,
	select: (fact: TFact) => TSelected | undefined,
): Node<TSelected> {
	return graph.node<TSelected>(
		[runtime],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const selected = select(raw as TFact);
				if (selected !== undefined) ctx.down([["DATA", selected]]);
			}
		},
		{ name, factory, partial: true, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function firstDuplicateFactId<T>(
	state: ApplicationState<T>,
	facts: readonly WorkItemAuthoringFact<T>[],
): string | undefined {
	const pending = new Set<string>();
	for (const fact of facts) {
		if (state.emittedFactIds.has(fact.eventId) || pending.has(fact.eventId)) return fact.eventId;
		pending.add(fact.eventId);
	}
	return undefined;
}

function claimFactId<T>(state: ApplicationState<T>, factId: string): boolean {
	if (state.emittedFactIds.has(factId)) return false;
	state.emittedFactIds.add(factId);
	return true;
}

function admissionRefs(
	admission: WorkItemDomainActionAdmission,
	proposal?: WorkItemDomainActionProposal,
	policy?: WorkItemDomainActionApplyPolicy,
): readonly SourceRef[] {
	return uniqueSourceRefs([
		ref("work-item-domain-action-admission", admission.admissionId),
		ref("work-item-domain-action-proposal", admission.proposalId),
		...(proposal === undefined
			? []
			: [
					ref("work-item", proposal.workItemId),
					ref("work-item-evidence", proposal.evidenceId),
					...(proposal.sourceRefs ?? []),
				]),
		...(policy === undefined ? [] : [ref("work-item-domain-action-apply-policy", policy.policyId)]),
		...(admission.sourceRefs ?? []),
	]);
}

function actionSourceRefs(
	admission: WorkItemDomainActionAdmission,
	proposal: WorkItemDomainActionProposal,
	policy: WorkItemDomainActionApplyPolicy,
): readonly SourceRef[] {
	return admissionRefs(admission, proposal, policy);
}

function dataIssue(
	code: string,
	message: string,
	opts: {
		readonly subjectId?: string;
		readonly refs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	} = {},
): DataIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: "error",
		source: "work-item-actions",
		subjectId: opts.subjectId,
		refs: opts.refs?.map((sourceRef) => `${sourceRef.kind}:${sourceRef.id}`),
		metadata: opts.metadata,
	};
}

function uniqueSourceRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
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

function sourceRefs(value: unknown): readonly SourceRef[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter(
		(item): item is SourceRef =>
			isRecord(item) && typeof item.kind === "string" && typeof item.id === "string",
	);
}

function numberMetadata(
	metadata: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const value = metadata?.[key];
	return typeof value === "number" ? value : undefined;
}

function stringMetadata(
	metadata: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = metadata?.[key];
	return typeof value === "string" ? value : undefined;
}

function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}

function recordString(value: unknown, key: string): string | undefined {
	return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}
