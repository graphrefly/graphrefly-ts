/**
 * Default WorkItem execution composition (D685).
 *
 * The recipe lowers admitted WorkItem plan members into provider-neutral
 * AgentRequest facts. It deliberately does not execute requests or admit
 * EffectRunResult facts on the caller's behalf.
 */

import { depBatch } from "../../ctx/types.js";
import type { Graph } from "../../graph/graph.js";
import { compoundTupleKey } from "../../identity.js";
import type { Node } from "../../node/node.js";
import {
	type AgentRequestFact,
	type AgentRequestIssued,
	type AgentRequestKind,
	type AgentRequestLedgerBundle,
	type AgentRequestProposal,
	admitAgentRequestProposal,
	agentRequestLedgerViews,
	type EffectRun,
	type EffectRunResult,
	issueAgentRequest,
} from "../../orchestration/agent-runtime.js";
import {
	type WorkItemEffectRunBundle,
	type WorkItemSeed,
	workItemEffectRunProjector,
} from "../../orchestration/work-item-runtime.js";
import {
	type WorkItemEffectPlanPolicy,
	type WorkItemEffectPlanProjectorBundle,
	type WorkItemEffectPlanProposed,
	type WorkItemProjection,
	workItemEffectPlanProjector,
} from "./scheduling.js";

export interface WorkItemExecutionRecipeOptions<TInput = unknown> {
	readonly name?: string;
	readonly workItems: Node<WorkItemProjection<TInput>>;
	readonly workItemSeeds: Node<WorkItemSeed>;
	readonly effectPlanProposals: Node<WorkItemEffectPlanProposed<TInput>>;
	/** Caller-owned, already-admitted execution results. */
	readonly effectRunResults: Node<EffectRunResult>;
	readonly policy?: WorkItemEffectPlanPolicy;
	readonly requestKind?: AgentRequestKind;
	readonly now?: () => number;
}

export interface WorkItemExecutionRecipeBundle<TInput = unknown> {
	readonly plan: WorkItemEffectPlanProjectorBundle<TInput>;
	readonly effectRuns: WorkItemEffectRunBundle;
	readonly requestFacts: Node<AgentRequestFact<TInput>>;
	readonly requests: Node<AgentRequestIssued<TInput>>;
	readonly requestLedger: AgentRequestLedgerBundle;
}

/**
 * Composes the default WorkItemEffectPlan -> EffectRun -> AgentRequest path.
 *
 * Dependency admission remains inside `workItemEffectPlanProjector`. Every
 * projected EffectRun produces at most one deterministic request tuple. The
 * returned request is evidence for a caller-owned executor boundary; this
 * recipe contains no execution loop, scheduler, retry, timer or result
 * fabrication.
 *
 * @param graph - Graph that owns the composed projectors.
 * @param opts - Explicit WorkItem, plan, result, policy, and request options.
 * @returns Graph-visible plan, EffectRun, request-fact, issued-request, and ledger nodes.
 * @category solutions
 * @internal Candidate remains outside package exports until the D686 promotion gate passes.
 */
export function workItemExecutionRecipe<TInput = unknown>(
	graph: Graph,
	opts: WorkItemExecutionRecipeOptions<TInput>,
): WorkItemExecutionRecipeBundle<TInput> {
	const name = opts.name ?? "workItemExecution";
	const now = opts.now ?? Date.now;
	const requestKind = opts.requestKind ?? "executor";
	const plan = workItemEffectPlanProjector(graph, {
		name: `${name}/plan`,
		workItems: opts.workItems,
		proposals: opts.effectPlanProposals,
		effectRunResults: opts.effectRunResults,
		policy: opts.policy,
		now,
	});
	const effectRuns = workItemEffectRunProjector(graph, {
		name: `${name}/effectRuns`,
		workItems: opts.workItemSeeds,
		effectRequests: plan.effectRequests,
	});
	const requestFacts = graph.node<AgentRequestFact<TInput>>(
		[effectRuns.effectRuns],
		(ctx) => {
			const issuedEffectRunIds = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const run = raw as EffectRun<TInput>;
				if (issuedEffectRunIds.has(run.effectRunId)) continue;
				issuedEffectRunIds.add(run.effectRunId);
				const emittedAtMs = now();
				const proposalId = compoundTupleKey("work-item-execution-proposal", [run.effectRunId]);
				const requestId = compoundTupleKey("work-item-execution-request", [run.effectRunId]);
				const operationId = compoundTupleKey("work-item-execution-operation", [run.effectRunId]);
				const proposal: AgentRequestProposal<TInput> = {
					kind: "proposal",
					proposalId,
					effectRunId: run.effectRunId,
					agentRunId: run.agentRunId,
					requestKind,
					required: true,
					input: run.goal.input,
					payload: run.goal.input?.value,
					reason: "Default WorkItem effect execution",
					metadata: {
						recipe: "workItemExecutionRecipe",
						effectKind: run.metadata?.effectKind,
					},
				};
				const admission = admitAgentRequestProposal(proposal, {
					requestId,
					operationId,
					admittedAtMs: emittedAtMs,
					reason: "Default WorkItem mechanical admission",
					sourceRefs: run.sourceRefs,
					metadata: { recipe: "workItemExecutionRecipe" },
				});
				const issued = issueAgentRequest(proposal, admission, {
					issuedAtMs: emittedAtMs,
					sourceRefs: run.sourceRefs,
				});
				ctx.down([
					["DATA", proposal],
					["DATA", admission],
					["DATA", issued],
				]);
			}
			ctx.state.set(issuedEffectRunIds);
		},
		{
			name: `${name}/requestFacts`,
			factory: "workItemExecutionRequestFacts",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const requests = graph.node<AgentRequestIssued<TInput>>(
		[requestFacts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact<TInput>;
				if (fact.kind === "issued") ctx.down([["DATA", fact]]);
			}
		},
		{ name: `${name}/requests`, factory: "workItemExecutionRequests" },
	);
	const requestLedger = agentRequestLedgerViews(graph, requestFacts, {
		name: `${name}/requestLedger`,
	});
	return Object.freeze({ plan, effectRuns, requestFacts, requests, requestLedger });
}
