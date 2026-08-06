import { depBatch } from "../../src/core/index.js";
import type {
	AgentRequestFact,
	AgentRequestIssued,
	AgentRequestProposal,
	EffectRun,
} from "../../src/orchestration/index.js";
import {
	admitAgentRequestProposal,
	agentRequestLedgerViews,
	effectRun,
	issueAgentRequest,
} from "../../src/orchestration/index.js";
import { workItemEffectPlanProjector } from "../../src/solutions/work-item/scheduling.js";
import type { D687ArmBundle, D687ArmComposer, D687Input, D687WorkItemSeed } from "./contracts.js";

interface D687PublicEffectRequest {
	readonly requestId: string;
	readonly workItemId: string;
	readonly effectRunId: string;
	readonly effectKind: string;
	readonly required?: boolean;
	readonly agentRunId?: string;
	readonly goal: EffectRun<D687Input>["goal"];
	readonly sourceRefs?: EffectRun["sourceRefs"];
	readonly policyRefs?: EffectRun["policyRefs"];
	readonly limits?: EffectRun["limits"];
	readonly createdBy?: string;
	readonly createdAtMs?: number;
	readonly idempotencyKey?: string;
	readonly metadata?: Record<string, unknown>;
}

function publicManualTupleKey(prefix: string, parts: readonly string[]): string {
	return `${prefix}:${JSON.stringify(parts)}`;
}

export const composeD687ManualArm: D687ArmComposer = (graph, sources): D687ArmBundle => {
	const workItemSeeds = graph.node<D687WorkItemSeed>(
		[sources.workItems],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const workItem = raw as {
					readonly workItemId: string;
					readonly summary: string;
					readonly authoringRevision: number;
					readonly executionInputRevision: number;
					readonly lastEventId: string;
					readonly revisionSourceRefs?: readonly { readonly kind: string; readonly id: string }[];
				};
				ctx.down([
					[
						"DATA",
						{
							kind: "work-item",
							workItemId: workItem.workItemId,
							summary: workItem.summary,
							sourceRefs: workItem.revisionSourceRefs,
							metadata: {
								authoringRevision: workItem.authoringRevision,
								executionInputRevision: workItem.executionInputRevision,
								lastEventId: workItem.lastEventId,
							},
						},
					],
				]);
			}
		},
		{ name: "d687/manual/workItemSeeds", factory: "workItemSeedProjector" },
	);
	const plan = workItemEffectPlanProjector(graph, {
		name: "d687/manual/plan",
		workItems: sources.workItems,
		proposals: sources.proposals,
		effectRunResults: sources.admittedResults,
		now: () => 0,
	});
	const effectRunFacts = graph.node<EffectRun>(
		[workItemSeeds, plan.effectRequests],
		(ctx) => {
			const state = ctx.state.get<{
				readonly workItemIds: Set<string>;
				readonly effectRunIds: Set<string>;
			}>() ?? { workItemIds: new Set<string>(), effectRunIds: new Set<string>() };
			for (const raw of depBatch(ctx, 0) ?? []) {
				state.workItemIds.add((raw as D687WorkItemSeed).workItemId);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const request = raw as D687PublicEffectRequest;
				if (
					!state.workItemIds.has(request.workItemId) ||
					state.effectRunIds.has(request.effectRunId)
				)
					continue;
				state.effectRunIds.add(request.effectRunId);
				ctx.down([
					[
						"DATA",
						effectRun({
							effectRunId: request.effectRunId,
							agentRunId: request.agentRunId,
							required: request.required,
							subjectRefs: [{ kind: "work-item", id: request.workItemId }],
							goal: request.goal,
							sourceRefs: [
								{ kind: "work-item", id: request.workItemId },
								{ kind: "work-item-effect-request", id: request.requestId },
								...(request.sourceRefs ?? []),
							],
							policyRefs: request.policyRefs,
							limits: request.limits,
							createdBy: request.createdBy,
							createdAtMs: request.createdAtMs,
							metadata: {
								...(request.metadata ?? {}),
								effectKind: request.effectKind,
								idempotencyKey: request.idempotencyKey,
							},
						}),
					],
				]);
			}
			ctx.state.set(state);
		},
		{ name: "d687/manual/effectRuns/effectRuns", factory: "workItemEffectRuns" },
	);
	const effectRuns = { effectRuns: effectRunFacts };
	const requestFacts = graph.node<AgentRequestFact<D687Input>>(
		[effectRuns.effectRuns],
		(ctx) => {
			const issuedEffectRunIds = ctx.state.get<Set<string>>() ?? new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const run = raw as EffectRun<D687Input>;
				if (issuedEffectRunIds.has(run.effectRunId)) continue;
				issuedEffectRunIds.add(run.effectRunId);
				const proposal: AgentRequestProposal<D687Input> = {
					kind: "proposal",
					proposalId: publicManualTupleKey("work-item-execution-proposal", [run.effectRunId]),
					effectRunId: run.effectRunId,
					agentRunId: run.agentRunId,
					requestKind: "executor",
					required: run.required,
					input: run.goal.input,
					payload: run.goal.input?.value,
					reason: "Default WorkItem effect execution",
					metadata: {
						recipe: "workItemExecutionRecipe",
						effectKind: run.metadata?.effectKind,
					},
				};
				const admission = admitAgentRequestProposal(proposal, {
					requestId: publicManualTupleKey("work-item-execution-request", [run.effectRunId]),
					operationId: publicManualTupleKey("work-item-execution-operation", [run.effectRunId]),
					admittedAtMs: 0,
					reason: "Default WorkItem mechanical admission",
					sourceRefs: run.sourceRefs,
					metadata: { recipe: "workItemExecutionRecipe" },
				});
				const issued = issueAgentRequest(proposal, admission, {
					issuedAtMs: 0,
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
			name: "d687/manual/requestFacts",
			factory: "workItemExecutionRequestFacts",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const requests = graph.node<AgentRequestIssued<D687Input>>(
		[requestFacts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact<D687Input>;
				if (fact.kind === "issued") ctx.down([["DATA", fact]]);
			}
		},
		{ name: "d687/manual/requests", factory: "workItemExecutionRequests" },
	);
	const requestLedger = agentRequestLedgerViews(graph, requestFacts, {
		name: "d687/manual/requestLedger",
	});
	return { workItemSeeds, plan, effectRuns, requestFacts, requests, requestLedger };
};
