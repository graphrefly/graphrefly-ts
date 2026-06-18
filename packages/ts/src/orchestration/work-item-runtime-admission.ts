import { type Ctx, depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { AgentRuntimeAuditRecord } from "./agent-runtime.js";
import {
	emitWorkItemAdmissionIssue,
	emptyWorkItemDomainActionAdmissionState,
	forEachPolicyDepBatch,
	freezeWorkItemDomainActionAdmissionViews,
	projectRuntimeFact,
	workItemAdmissionDecisionRefs,
	workItemAdmissionProposalRefs,
} from "./work-item-runtime-shared.js";
import type {
	WorkItemDomainActionAdmission,
	WorkItemDomainActionAdmissionBundle,
	WorkItemDomainActionAdmissionDecision,
	WorkItemDomainActionAdmissionFact,
	WorkItemDomainActionAdmissionOutcome,
	WorkItemDomainActionAdmissionPolicy,
	WorkItemDomainActionAdmissionState,
	WorkItemDomainActionAdmissionStateInternal,
	WorkItemDomainActionAdmissionViews,
	WorkItemDomainActionAdmissionViewsState,
	WorkItemDomainActionProposal,
	WorkItemStatusRecord,
} from "./work-item-runtime-types.js";

export function workItemDomainActionAdmissionProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly proposals: Node<WorkItemDomainActionProposal>;
		readonly decisions: Node<WorkItemDomainActionAdmissionDecision>;
		readonly admissionPolicies?: readonly Node<WorkItemDomainActionAdmissionPolicy>[];
		readonly now?: () => number;
	},
): WorkItemDomainActionAdmissionBundle {
	const name = opts.name ?? "workItemDomainActionAdmissions";
	const policyDeps = opts.admissionPolicies ?? [];
	const policyStart = 2;
	const now = opts.now ?? Date.now;
	const runtime = graph.node<WorkItemDomainActionAdmissionFact>(
		[opts.proposals, opts.decisions, ...policyDeps],
		(ctx) => {
			const state =
				ctx.state.get<WorkItemDomainActionAdmissionStateInternal>() ??
				emptyWorkItemDomainActionAdmissionState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const proposal = raw as WorkItemDomainActionProposal;
				if (state.proposals.has(proposal.proposalId)) {
					emitWorkItemAdmissionIssue(
						ctx,
						state,
						`duplicate-admission-proposal:${proposal.proposalId}`,
						"duplicate-work-item-domain-action-proposal",
						`WorkItemDomainActionProposal '${proposal.proposalId}' was already seen by the admission projector`,
						proposal.workItemId,
						workItemAdmissionProposalRefs(proposal),
					);
					continue;
				}
				state.proposals.set(proposal.proposalId, proposal);
			}
			forEachPolicyDepBatch(ctx, policyStart, policyDeps.length, (raw) => {
				const policy = raw as WorkItemDomainActionAdmissionPolicy;
				state.policies.set(policy.policyId, policy);
			});
			for (const raw of depBatch(ctx, 1) ?? []) {
				const decision = raw as WorkItemDomainActionAdmissionDecision;
				if (state.decisions.has(decision.decisionId)) {
					emitWorkItemAdmissionIssue(
						ctx,
						state,
						`duplicate-admission-decision:${decision.decisionId}`,
						"duplicate-work-item-domain-action-admission-decision",
						`WorkItemDomainActionAdmissionDecision '${decision.decisionId}' was already seen by the admission projector`,
						decision.proposalId,
						workItemAdmissionDecisionRefs(decision),
					);
					continue;
				}
				state.decisions.set(decision.decisionId, decision);
			}
			evaluateWorkItemDomainActionAdmissions(ctx, state, now());
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "workItemDomainActionAdmissionProjector", partial: true },
	);
	return {
		admissions: projectRuntimeFact(
			graph,
			runtime,
			`${name}/admissions`,
			"workItemDomainActionAdmissions",
			(fact) => (fact.kind === "admission" ? fact.admission : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"workItemDomainActionAdmissionStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"workItemDomainActionAdmissionIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"workItemDomainActionAdmissionAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
		views: graph.node<WorkItemDomainActionAdmissionViews>(
			[runtime],
			(ctx) => {
				const state = ctx.state.get<WorkItemDomainActionAdmissionViewsState>() ?? {
					admissionsByProposal: new Map<string, WorkItemDomainActionAdmission>(),
					admissionsByWorkItem: new Map<string, WorkItemDomainActionAdmission[]>(),
					issues: [],
					audit: [],
				};
				for (const raw of depBatch(ctx, 0) ?? []) {
					const fact = raw as WorkItemDomainActionAdmissionFact;
					if (fact.kind === "admission") {
						const admission = fact.admission;
						state.admissionsByProposal.set(admission.proposalId, admission);
						const byWorkItem = state.admissionsByWorkItem.get(admission.workItemId) ?? [];
						byWorkItem.push(admission);
						state.admissionsByWorkItem.set(admission.workItemId, byWorkItem);
					} else if (fact.kind === "issue") state.issues.push(fact.issue);
					else if (fact.kind === "audit") state.audit.push(fact.audit);
				}
				ctx.state.set(state);
				ctx.down([["DATA", freezeWorkItemDomainActionAdmissionViews(state)]]);
			},
			{ name: `${name}/views`, factory: "workItemDomainActionAdmissionViews" },
		),
	};
}

function evaluateWorkItemDomainActionAdmissions(
	ctx: Ctx,
	state: WorkItemDomainActionAdmissionStateInternal,
	admittedAtMs: number,
): void {
	let emitted = true;
	let passes = 0;
	while (emitted && passes <= state.decisions.size) {
		emitted = false;
		passes += 1;
		for (const decision of state.decisions.values()) {
			if (state.terminalDecisionIds.has(decision.decisionId)) continue;
			emitted =
				evaluateWorkItemDomainActionAdmission(ctx, state, decision, admittedAtMs) || emitted;
		}
	}
}

function evaluateWorkItemDomainActionAdmission(
	ctx: Ctx,
	state: WorkItemDomainActionAdmissionStateInternal,
	decision: WorkItemDomainActionAdmissionDecision,
	admittedAtMs: number,
): boolean {
	const proposal = state.proposals.get(decision.proposalId);
	const proposalRefs = workItemAdmissionDecisionRefs(decision, proposal);
	const subjectId = proposal?.workItemId ?? decision.proposalId;
	if (proposal === undefined) {
		emitWorkItemAdmissionIssue(
			ctx,
			state,
			`missing-admission-proposal:${decision.decisionId}:${decision.proposalId}`,
			"missing-work-item-domain-action-admission-proposal",
			`WorkItemDomainActionAdmissionDecision '${decision.decisionId}' references missing proposal '${decision.proposalId}'`,
			subjectId,
			proposalRefs,
		);
		return false;
	}
	const staleProposalRef = (decision.sourceRefs ?? []).find(
		(sourceRef) =>
			sourceRef.kind === "work-item-domain-action-proposal" &&
			sourceRef.id !== decision.proposalId &&
			sourceRef.id !== decision.targetProposalId,
	);
	if (staleProposalRef !== undefined) {
		emitWorkItemAdmissionIssue(
			ctx,
			state,
			`stale-admission-proposal-ref:${decision.decisionId}:${staleProposalRef.id}`,
			"stale-work-item-domain-action-admission-proposal-ref",
			`WorkItemDomainActionAdmissionDecision '${decision.decisionId}' carries stale proposal ref '${staleProposalRef.id}'`,
			proposal.workItemId,
			proposalRefs,
		);
		state.terminalDecisionIds.add(decision.decisionId);
		return false;
	}
	const policy = admissionPolicyForDecision(state, decision);
	if (typeof policy === "string") {
		emitWorkItemAdmissionIssue(
			ctx,
			state,
			`${policy}:${decision.decisionId}:${decision.policyId ?? "missing"}`,
			policy,
			admissionPolicyIssueMessage(policy, decision),
			proposal.workItemId,
			proposalRefs,
		);
		if (policy === "stale-work-item-domain-action-admission-policy-ref")
			state.terminalDecisionIds.add(decision.decisionId);
		return false;
	}
	if (policy !== undefined) {
		const policyIssue = validateWorkItemAdmissionPolicy(policy, decision, proposal);
		if (policyIssue !== undefined) {
			emitWorkItemAdmissionIssue(
				ctx,
				state,
				`${policyIssue.code}:${decision.decisionId}:${policy.policyId}`,
				policyIssue.code,
				policyIssue.message,
				proposal.workItemId,
				workItemAdmissionDecisionRefs(decision, proposal, policy),
			);
			return false;
		}
	}
	const mergeIssue = validateWorkItemAdmissionMergeTarget(state, decision);
	if (mergeIssue !== undefined) {
		emitWorkItemAdmissionIssue(
			ctx,
			state,
			`${mergeIssue.code}:${decision.decisionId}:${decision.targetProposalId ?? ""}:${decision.targetAdmissionId ?? ""}`,
			mergeIssue.code,
			mergeIssue.message,
			proposal.workItemId,
			proposalRefs,
		);
		if (mergeIssue.code !== "unknown-work-item-domain-action-admission-merge-target")
			state.terminalDecisionIds.add(decision.decisionId);
		return false;
	}
	if (state.admissionsById.has(decision.admissionId)) {
		emitWorkItemAdmissionIssue(
			ctx,
			state,
			`duplicate-admission-id:${decision.admissionId}`,
			"duplicate-work-item-domain-action-admission",
			`WorkItemDomainActionAdmission '${decision.admissionId}' was already emitted`,
			proposal.workItemId,
			proposalRefs,
		);
		state.terminalDecisionIds.add(decision.decisionId);
		return false;
	}
	if (state.admissionsByProposal.has(decision.proposalId)) {
		emitWorkItemAdmissionIssue(
			ctx,
			state,
			`duplicate-admission-proposal-decision:${decision.proposalId}:${decision.decisionId}`,
			"duplicate-work-item-domain-action-admission-proposal",
			`WorkItemDomainActionProposal '${decision.proposalId}' already has an admission decision`,
			proposal.workItemId,
			proposalRefs,
		);
		state.terminalDecisionIds.add(decision.decisionId);
		return false;
	}
	const admissionState = admissionStateForOutcome(decision.outcome);
	if (admissionState === undefined) {
		emitWorkItemAdmissionIssue(
			ctx,
			state,
			`unsupported-admission-outcome:${decision.decisionId}:${String(decision.outcome)}`,
			"unsupported-work-item-domain-action-admission-outcome",
			`WorkItemDomainActionAdmissionDecision '${decision.decisionId}' uses unsupported outcome '${String(decision.outcome)}'`,
			proposal.workItemId,
			proposalRefs,
		);
		state.terminalDecisionIds.add(decision.decisionId);
		return false;
	}
	const admission: WorkItemDomainActionAdmission = {
		kind: "work-item-domain-action-admission",
		admissionId: decision.admissionId,
		proposalId: proposal.proposalId,
		workItemId: proposal.workItemId,
		actionKind: proposal.actionKind,
		state: admissionState,
		decisionId: decision.decisionId,
		policyId: decision.policyId,
		reason: decision.reason,
		targetProposalId: decision.targetProposalId,
		targetAdmissionId: decision.targetAdmissionId,
		sourceRefs: workItemAdmissionDecisionRefs(decision, proposal, policy),
		admittedAtMs: decision.decidedAtMs ?? admittedAtMs,
		metadata: {
			...(proposal.metadata ?? {}),
			...(policy?.metadata ?? {}),
			...(decision.metadata ?? {}),
		},
	};
	state.admissionsById.set(admission.admissionId, admission);
	state.admissionsByProposal.set(admission.proposalId, admission);
	state.terminalDecisionIds.add(decision.decisionId);
	state.statusSeq += 1;
	state.auditSeq += 1;
	const statusState = workItemAdmissionStatusState(admission.state);
	const status: WorkItemStatusRecord = {
		kind: "work-item-status",
		statusId: `${proposal.workItemId}:${statusState}:${state.statusSeq}`,
		workItemId: proposal.workItemId,
		state: statusState,
		sourceRefs: admission.sourceRefs,
		effectRunId: proposal.effectRunId,
		evidenceId: proposal.evidenceId,
		proposalId: proposal.proposalId,
		metadata: {
			actionKind: proposal.actionKind,
			admissionId: admission.admissionId,
			decisionId: decision.decisionId,
			policyId: decision.policyId,
		},
	};
	const audit: AgentRuntimeAuditRecord = {
		id: `${proposal.workItemId}:${statusState}:${state.auditSeq}`,
		kind: `work-item-domain-action-${admission.state}`,
		subjectId: proposal.workItemId,
		sourceRefs: admission.sourceRefs,
		metadata: {
			actionKind: proposal.actionKind,
			admissionId: admission.admissionId,
			decisionId: decision.decisionId,
			policyId: decision.policyId,
			proposalId: proposal.proposalId,
		},
	};
	ctx.down([
		["DATA", { kind: "admission", admission } satisfies WorkItemDomainActionAdmissionFact],
		["DATA", { kind: "status", status } satisfies WorkItemDomainActionAdmissionFact],
		["DATA", { kind: "audit", audit } satisfies WorkItemDomainActionAdmissionFact],
	]);
	return true;
}

function admissionPolicyForDecision(
	state: WorkItemDomainActionAdmissionStateInternal,
	decision: WorkItemDomainActionAdmissionDecision,
):
	| WorkItemDomainActionAdmissionPolicy
	| "missing-work-item-domain-action-admission-policy"
	| "stale-work-item-domain-action-admission-policy-ref"
	| undefined {
	if (decision.policyId === undefined) return undefined;
	const stalePolicyRef = (decision.sourceRefs ?? []).find(
		(sourceRef) =>
			sourceRef.kind === "work-item-domain-action-admission-policy" &&
			sourceRef.id !== decision.policyId,
	);
	if (stalePolicyRef !== undefined) return "stale-work-item-domain-action-admission-policy-ref";
	return (
		state.policies.get(decision.policyId) ?? "missing-work-item-domain-action-admission-policy"
	);
}

function admissionPolicyIssueMessage(
	code:
		| "missing-work-item-domain-action-admission-policy"
		| "stale-work-item-domain-action-admission-policy-ref",
	decision: WorkItemDomainActionAdmissionDecision,
): string {
	if (code === "missing-work-item-domain-action-admission-policy") {
		return `WorkItemDomainActionAdmissionPolicy '${decision.policyId}' was referenced for WorkItem action admission but not present`;
	}
	return `WorkItemDomainActionAdmissionDecision '${decision.decisionId}' carries a stale admission policy source ref`;
}

function validateWorkItemAdmissionPolicy(
	policy: WorkItemDomainActionAdmissionPolicy,
	decision: WorkItemDomainActionAdmissionDecision,
	proposal: WorkItemDomainActionProposal,
): { readonly code: string; readonly message: string } | undefined {
	if (policy.actionKinds !== undefined && !policy.actionKinds.includes(proposal.actionKind)) {
		return {
			code: "work-item-domain-action-admission-policy-mismatch",
			message: `WorkItemDomainActionAdmissionPolicy '${policy.policyId}' does not apply to actionKind '${proposal.actionKind}'`,
		};
	}
	if (policy.allowedOutcomes !== undefined && !policy.allowedOutcomes.includes(decision.outcome)) {
		return {
			code: "unsupported-work-item-domain-action-admission-outcome",
			message: `WorkItemDomainActionAdmissionPolicy '${policy.policyId}' does not allow outcome '${decision.outcome}'`,
		};
	}
	return undefined;
}

function validateWorkItemAdmissionMergeTarget(
	state: WorkItemDomainActionAdmissionStateInternal,
	decision: WorkItemDomainActionAdmissionDecision,
): { readonly code: string; readonly message: string } | undefined {
	const hasTargetProposal = decision.targetProposalId !== undefined;
	const hasTargetAdmission = decision.targetAdmissionId !== undefined;
	if (decision.outcome !== "merge") {
		if (hasTargetProposal || hasTargetAdmission) {
			return {
				code: "ambiguous-work-item-domain-action-admission-merge-target",
				message: `WorkItemDomainActionAdmissionDecision '${decision.decisionId}' carries a merge target for non-merge outcome '${decision.outcome}'`,
			};
		}
		return undefined;
	}
	if (hasTargetProposal === hasTargetAdmission) {
		return {
			code: "ambiguous-work-item-domain-action-admission-merge-target",
			message: `WorkItemDomainActionAdmissionDecision '${decision.decisionId}' must reference exactly one merge target`,
		};
	}
	if (decision.targetProposalId === decision.proposalId) {
		return {
			code: "ambiguous-work-item-domain-action-admission-merge-target",
			message: `WorkItemDomainActionAdmissionDecision '${decision.decisionId}' cannot merge a proposal into itself`,
		};
	}
	if (decision.targetProposalId !== undefined && !state.proposals.has(decision.targetProposalId)) {
		return {
			code: "unknown-work-item-domain-action-admission-merge-target",
			message: `WorkItemDomainActionAdmissionDecision '${decision.decisionId}' references unknown target proposal '${decision.targetProposalId}'`,
		};
	}
	if (
		decision.targetAdmissionId !== undefined &&
		!state.admissionsById.has(decision.targetAdmissionId)
	) {
		return {
			code: "unknown-work-item-domain-action-admission-merge-target",
			message: `WorkItemDomainActionAdmissionDecision '${decision.decisionId}' references unknown target admission '${decision.targetAdmissionId}'`,
		};
	}
	return undefined;
}

function admissionStateForOutcome(
	outcome: WorkItemDomainActionAdmissionOutcome,
): WorkItemDomainActionAdmissionState | undefined {
	if (outcome === "admit") return "admitted";
	if (outcome === "reject") return "rejected";
	if (outcome === "defer") return "deferred";
	if (outcome === "merge") return "merged";
	return undefined;
}

function workItemAdmissionStatusState(
	state: WorkItemDomainActionAdmissionState,
): WorkItemStatusRecord["state"] {
	if (state === "admitted") return "domain-action-admitted";
	if (state === "rejected") return "domain-action-rejected";
	if (state === "deferred") return "domain-action-deferred";
	return "domain-action-merged";
}
