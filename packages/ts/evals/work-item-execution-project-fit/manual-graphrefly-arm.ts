import { depBatch } from "../../src/ctx/types.js";
import { compoundTupleKey } from "../../src/identity.js";
import type {
	AgentRequestFact,
	AgentRequestIssued,
	AgentRequestProposal,
	EffectRun,
} from "../../src/orchestration/agent-runtime.js";
import {
	admitAgentRequestProposal,
	issueAgentRequest,
} from "../../src/orchestration/agent-runtime.js";
import { workItemEffectRunProjector } from "../../src/orchestration/work-item-runtime.js";
import { workItemEffectPlanProjector } from "../../src/solutions/work-item/scheduling.js";
import type { D686PathObservation, D686Scenario } from "./contracts.js";
import { runD686GraphArm } from "./graph-arm-harness.js";

export function runD686ManualGraphReFlyArm(scenario: D686Scenario): D686PathObservation {
	// D686_COORDINATOR:manual-graphrefly:dependency-rich-fan-out-fan-in:START
	// D686_COORDINATOR:manual-graphrefly:dependency-rich-fan-out-fan-in:END
	// D686_COORDINATOR:manual-graphrefly:failed-prerequisite-independent-branch-join:START
	// D686_COORDINATOR:manual-graphrefly:failed-prerequisite-independent-branch-join:END
	return runD686GraphArm("manual-graphrefly", scenario, (graph, sources) => {
		const plan = workItemEffectPlanProjector(graph, {
			name: "d686/manual/plan",
			workItems: sources.workItems,
			proposals: sources.proposals,
			effectRunResults: sources.admittedResults,
			policy: { allowedEffectKinds: ["d686-offline-effect"] },
			now: () => 0,
		});
		const effectRuns = workItemEffectRunProjector(graph, {
			name: "d686/manual/effectRuns",
			workItems: sources.workItemSeeds,
			effectRequests: plan.effectRequests,
		});
		const requestFacts = graph.node<AgentRequestFact<Record<string, unknown>>>(
			[effectRuns.effectRuns],
			(ctx) => {
				for (const raw of depBatch(ctx, 0) ?? []) {
					const run = raw as EffectRun<Record<string, unknown>>;
					const proposal: AgentRequestProposal<Record<string, unknown>> = {
						kind: "proposal",
						proposalId: compoundTupleKey("d686-manual-proposal", [run.effectRunId]),
						effectRunId: run.effectRunId,
						requestKind: "executor",
						required: true,
						input: run.goal.input,
						payload: run.goal.input?.value,
					};
					const admission = admitAgentRequestProposal(proposal, {
						requestId: compoundTupleKey("d686-manual-request", [run.effectRunId]),
						operationId: compoundTupleKey("d686-manual-operation", [run.effectRunId]),
						admittedAtMs: 0,
						sourceRefs: run.sourceRefs,
					});
					ctx.down([
						["DATA", proposal],
						["DATA", admission],
						["DATA", issueAgentRequest(proposal, admission, { issuedAtMs: 0 })],
					]);
				}
			},
			{ name: "d686/manual/requestFacts", factory: "d686ManualRequestFacts" },
		);
		const requests = graph.node<AgentRequestIssued<Record<string, unknown>>>(
			[requestFacts],
			(ctx) => {
				for (const raw of depBatch(ctx, 0) ?? []) {
					const fact = raw as AgentRequestFact<Record<string, unknown>>;
					if (fact.kind === "issued") ctx.down([["DATA", fact]]);
				}
			},
			{ name: "d686/manual/requests", factory: "d686ManualRequests" },
		);
		return { plan, effectRuns, requestFacts, requests };
	});
}
