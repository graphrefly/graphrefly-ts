import { type Ctx, depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { AgentRuntimeAuditRecord, EffectRunResult } from "./agent-runtime.js";
import {
	effectKindFromMetadata,
	emitWorkItemActionProposalIssue,
	emptyWorkItemDomainActionProposalState,
	forEachPolicyDepBatch,
	freezeWorkItemDomainActionProposalViews,
	policyAppliesToRequest,
	projectRuntimeFact,
	referencedWorkItemMappingPolicyIds,
	resultReason,
	workItemActionProposalPayload,
	workItemActionProposalRefs,
	workItemEvidenceOnlyRefs,
	workItemIdForEffectRunResult,
	workItemResultRefs,
} from "./work-item-runtime-shared.js";
import type {
	WorkItemDomainActionProposal,
	WorkItemDomainActionProposalBundle,
	WorkItemDomainActionProposalFact,
	WorkItemDomainActionProposalSpec,
	WorkItemDomainActionProposalState,
	WorkItemDomainActionProposalViews,
	WorkItemDomainActionProposalViewsState,
	WorkItemEffectMappingPolicy,
	WorkItemEvidenceRecorded,
	WorkItemSeed,
	WorkItemStatusRecord,
} from "./work-item-runtime-types.js";

export function workItemDomainActionProposalProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly workItems: Node<WorkItemSeed>;
		readonly evidence: Node<WorkItemEvidenceRecorded>;
		readonly effectRunResults: Node<EffectRunResult>;
		readonly mappingPolicies: readonly Node<WorkItemEffectMappingPolicy>[];
		readonly now?: () => number;
	},
): WorkItemDomainActionProposalBundle {
	const name = opts.name ?? "workItemDomainActionProposals";
	const now = opts.now ?? Date.now;
	const policyStart = 3;
	const runtime = graph.node<WorkItemDomainActionProposalFact>(
		[opts.workItems, opts.evidence, opts.effectRunResults, ...opts.mappingPolicies],
		(ctx) => {
			const state =
				ctx.state.get<WorkItemDomainActionProposalState>() ??
				emptyWorkItemDomainActionProposalState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const workItem = raw as WorkItemSeed;
				state.workItems.set(workItem.workItemId, workItem);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const evidence = raw as WorkItemEvidenceRecorded;
				if (state.evidence.has(evidence.evidenceId)) {
					emitWorkItemActionProposalIssue(
						ctx,
						state,
						`duplicate-action-proposal-evidence:${evidence.evidenceId}`,
						"duplicate-work-item-action-proposal-evidence",
						`WorkItemEvidenceRecorded '${evidence.evidenceId}' was already seen by the action proposal projector`,
						evidence.workItemId,
						workItemEvidenceOnlyRefs(evidence),
					);
					continue;
				}
				state.evidence.set(evidence.evidenceId, evidence);
			}
			for (const raw of depBatch(ctx, 2) ?? []) {
				const result = raw as EffectRunResult;
				if (state.results.has(result.resultId)) {
					emitWorkItemActionProposalIssue(
						ctx,
						state,
						`duplicate-action-proposal-result:${result.resultId}`,
						"duplicate-work-item-action-proposal-result",
						`EffectRunResult '${result.resultId}' was already seen by the action proposal projector`,
						workItemIdForEffectRunResult(state, result),
						workItemResultRefs(result),
					);
					continue;
				}
				state.results.set(result.resultId, result);
			}
			forEachPolicyDepBatch(ctx, policyStart, opts.mappingPolicies.length, (raw) => {
				const policy = raw as WorkItemEffectMappingPolicy;
				state.policies.set(policy.policyId, policy);
			});
			evaluateWorkItemDomainActionProposals(ctx, state, now());
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "workItemDomainActionProposalProjector", partial: true },
	);
	return {
		proposals: projectRuntimeFact(
			graph,
			runtime,
			`${name}/proposals`,
			"workItemDomainActionProposals",
			(fact) => (fact.kind === "proposal" ? fact.proposal : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"workItemDomainActionProposalStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"workItemDomainActionProposalIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"workItemDomainActionProposalAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
		views: graph.node<WorkItemDomainActionProposalViews>(
			[runtime],
			(ctx) => {
				const state = ctx.state.get<WorkItemDomainActionProposalViewsState>() ?? {
					proposalsByWorkItem: new Map<string, WorkItemDomainActionProposal[]>(),
					proposalsByEvidence: new Map<string, WorkItemDomainActionProposal[]>(),
					issues: [],
					audit: [],
				};
				for (const raw of depBatch(ctx, 0) ?? []) {
					const fact = raw as WorkItemDomainActionProposalFact;
					if (fact.kind === "proposal") {
						const proposal = fact.proposal;
						const byWorkItem = state.proposalsByWorkItem.get(proposal.workItemId) ?? [];
						byWorkItem.push(proposal);
						state.proposalsByWorkItem.set(proposal.workItemId, byWorkItem);
						const byEvidence = state.proposalsByEvidence.get(proposal.evidenceId) ?? [];
						byEvidence.push(proposal);
						state.proposalsByEvidence.set(proposal.evidenceId, byEvidence);
					} else if (fact.kind === "issue") state.issues.push(fact.issue);
					else if (fact.kind === "audit") state.audit.push(fact.audit);
				}
				ctx.state.set(state);
				ctx.down([["DATA", freezeWorkItemDomainActionProposalViews(state)]]);
			},
			{ name: `${name}/views`, factory: "workItemDomainActionProposalViews" },
		),
	};
}

function evaluateWorkItemDomainActionProposals(
	ctx: Ctx,
	state: WorkItemDomainActionProposalState,
	proposedAtMs: number,
): void {
	for (const evidence of state.evidence.values()) {
		const result = state.results.get(evidence.effectRunResultId);
		if (result === undefined) {
			emitWorkItemActionProposalIssue(
				ctx,
				state,
				`missing-action-proposal-result:${evidence.evidenceId}:${evidence.effectRunResultId}`,
				"missing-work-item-action-proposal-result",
				`WorkItemEvidenceRecorded '${evidence.evidenceId}' references missing EffectRunResult '${evidence.effectRunResultId}'`,
				evidence.workItemId,
				workItemEvidenceOnlyRefs(evidence),
			);
			continue;
		}
		if (result.effectRunId !== evidence.effectRunId || result.status !== evidence.status) {
			emitWorkItemActionProposalIssue(
				ctx,
				state,
				`stale-action-proposal-result:${evidence.evidenceId}:${result.resultId}`,
				"stale-work-item-action-proposal-result",
				`WorkItemEvidenceRecorded '${evidence.evidenceId}' does not match EffectRunResult '${result.resultId}'`,
				evidence.workItemId,
				workItemActionProposalRefs(evidence, result),
			);
			continue;
		}
		if (!state.workItems.has(evidence.workItemId)) {
			emitWorkItemActionProposalIssue(
				ctx,
				state,
				`unknown-action-proposal-work-item:${evidence.evidenceId}`,
				"unknown-work-item-action-proposal-target",
				`WorkItemEvidenceRecorded '${evidence.evidenceId}' references unseeded WorkItem '${evidence.workItemId}'`,
				evidence.workItemId,
				workItemActionProposalRefs(evidence, result),
			);
			continue;
		}
		const policyIds = referencedWorkItemMappingPolicyIds(evidence);
		for (const policyId of policyIds) {
			const policy = state.policies.get(policyId);
			if (policy === undefined) {
				emitWorkItemActionProposalIssue(
					ctx,
					state,
					`missing-action-proposal-policy:${evidence.evidenceId}:${policyId}`,
					"missing-work-item-action-proposal-policy",
					`WorkItemEffectMappingPolicy '${policyId}' was referenced for WorkItem action proposals but not present`,
					evidence.workItemId,
					workItemActionProposalRefs(evidence, result),
				);
				continue;
			}
			const effectKind =
				effectKindFromMetadata(evidence.metadata) ?? effectKindFromMetadata(result.metadata);
			if (!policyAppliesToRequest(policy, effectKind)) {
				emitWorkItemActionProposalIssue(
					ctx,
					state,
					`action-proposal-policy-mismatch:${evidence.evidenceId}:${policy.policyId}`,
					"work-item-action-proposal-policy-mismatch",
					`WorkItemEffectMappingPolicy '${policy.policyId}' does not apply to effectKind '${effectKind ?? "unknown"}'`,
					evidence.workItemId,
					workItemActionProposalRefs(evidence, result, policy),
				);
				continue;
			}
			for (const [index, spec] of (policy.actionProposals ?? []).entries()) {
				emitWorkItemDomainActionProposal(
					ctx,
					state,
					evidence,
					result,
					policy,
					spec,
					index,
					proposedAtMs,
				);
			}
		}
	}
}

function emitWorkItemDomainActionProposal(
	ctx: Ctx,
	state: WorkItemDomainActionProposalState,
	evidence: WorkItemEvidenceRecorded,
	result: EffectRunResult,
	policy: WorkItemEffectMappingPolicy,
	spec: WorkItemDomainActionProposalSpec,
	index: number,
	proposedAtMs: number,
): void {
	const key = `${evidence.evidenceId}:${policy.policyId}:${index}:${spec.actionKind}`;
	if (state.proposedKeys.has(key)) return;
	if (spec.behavior !== undefined && spec.behavior !== "propose") {
		emitWorkItemActionProposalIssue(
			ctx,
			state,
			`unsupported-action-proposal-behavior:${key}`,
			"unsupported-work-item-action-proposal-behavior",
			`WorkItemEffectMappingPolicy '${policy.policyId}' uses unsupported action proposal behavior '${spec.behavior}'`,
			evidence.workItemId,
			workItemActionProposalRefs(evidence, result, policy),
		);
		return;
	}
	if (spec.actionKind.length === 0) {
		emitWorkItemActionProposalIssue(
			ctx,
			state,
			`malformed-action-proposal:${key}`,
			"malformed-work-item-action-proposal",
			`WorkItemEffectMappingPolicy '${policy.policyId}' has an empty actionKind`,
			evidence.workItemId,
			workItemActionProposalRefs(evidence, result, policy),
		);
		return;
	}
	if (spec.statuses !== undefined && !spec.statuses.includes(evidence.status)) return;
	const outputKind = evidence.output?.kind;
	if (
		spec.outputKinds !== undefined &&
		(outputKind === undefined || !spec.outputKinds.includes(outputKind))
	)
		return;
	state.proposedKeys.add(key);
	state.statusSeq += 1;
	state.auditSeq += 1;
	const proposal: WorkItemDomainActionProposal = {
		kind: "work-item-domain-action-proposal",
		proposalId: `${evidence.workItemId}:${evidence.effectRunId}:${evidence.effectRunResultId}:${policy.policyId}:${index}:${spec.actionKind}`,
		workItemId: evidence.workItemId,
		actionKind: spec.actionKind,
		effectRunId: evidence.effectRunId,
		effectRunResultId: evidence.effectRunResultId,
		evidenceId: evidence.evidenceId,
		policyId: policy.policyId,
		payload: workItemActionProposalPayload(spec, evidence, result),
		reason: spec.reason ?? evidence.reason ?? resultReason(result),
		sourceRefs: workItemActionProposalRefs(evidence, result, policy),
		proposedAtMs,
		metadata: {
			...(policy.metadata ?? {}),
			...(spec.metadata ?? {}),
			resultStatus: evidence.status,
		},
	};
	const status: WorkItemStatusRecord = {
		kind: "work-item-status",
		statusId: `${evidence.workItemId}:domain-action-proposed:${state.statusSeq}`,
		workItemId: evidence.workItemId,
		state: "domain-action-proposed",
		sourceRefs: proposal.sourceRefs,
		effectRunId: evidence.effectRunId,
		evidenceId: evidence.evidenceId,
		proposalId: proposal.proposalId,
		metadata: { actionKind: spec.actionKind, policyId: policy.policyId },
	};
	const audit: AgentRuntimeAuditRecord = {
		id: `${evidence.workItemId}:domain-action-proposed:${state.auditSeq}`,
		kind: "work-item-domain-action-proposed",
		subjectId: evidence.workItemId,
		sourceRefs: proposal.sourceRefs,
		metadata: {
			actionKind: spec.actionKind,
			effectRunId: evidence.effectRunId,
			effectRunResultId: evidence.effectRunResultId,
			evidenceId: evidence.evidenceId,
			policyId: policy.policyId,
			proposalId: proposal.proposalId,
		},
	};
	ctx.down([
		["DATA", { kind: "proposal", proposal } satisfies WorkItemDomainActionProposalFact],
		["DATA", { kind: "status", status } satisfies WorkItemDomainActionProposalFact],
		["DATA", { kind: "audit", audit } satisfies WorkItemDomainActionProposalFact],
	]);
}
