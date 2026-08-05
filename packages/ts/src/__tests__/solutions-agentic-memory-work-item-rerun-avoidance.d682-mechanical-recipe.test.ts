import { describe, expect, it } from "vitest";
import {
	createD682EffectRunCompletionAdmission,
	createD682ExecutionQualifiedMechanicalRecipe,
	createD682SerialEffectPlanProposal,
	D682_MECHANICAL_MAX_ACTIONS,
	D682_MECHANICAL_MAX_CANONICAL_ACTION_BYTES,
	D682_MECHANICAL_RECIPE_REVISION,
	type D682EffectRunCompletionV1,
} from "../../evals/empirical-memory-rerun-avoidance/execution-qualified-mechanical-recipe.js";
import { graph } from "../graph/graph.js";
import type {
	AgentDecision,
	AgentRequestFact,
	AgentRequestIssued,
	AgentRequestStatusChanged,
	EffectRunResult,
} from "../orchestration/agent-runtime.js";
import { effectRunCompletionProjector } from "../orchestration/agent-runtime.js";
import type { WorkItemSeed } from "../orchestration/work-item-runtime.js";
import type {
	WorkItemEffectPlanProposed,
	WorkItemProjection,
} from "../solutions/work-item/scheduling.js";

function collectData<T>(node: {
	subscribe(sink: (msg: readonly [string, unknown?]) => void): unknown;
}): T[] {
	const out: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") out.push(msg[1] as T);
	});
	return out;
}

function setupRecipe() {
	const g = graph();
	const workItems = g.node<WorkItemProjection<Record<string, unknown>>>([], null, {
		name: "d682-work-items",
	});
	const workItemSeeds = g.node<WorkItemSeed>([], null, { name: "d682-work-item-seeds" });
	const proposals = g.node<WorkItemEffectPlanProposed<Record<string, unknown>>>([], null, {
		name: "d682-proposals",
	});
	const effectRunCompletions = g.node<D682EffectRunCompletionV1>([], null, {
		name: "d682-completions",
	});
	const requestStatuses = g.node<AgentRequestStatusChanged>([], null, {
		name: "d682-request-statuses",
	});
	const decisions = g.node<AgentDecision>([], null, { name: "d682-decisions" });
	const effectKinds = ["read", "replace", "diff", "command", "final"] as const;
	const completionAdmission = createD682EffectRunCompletionAdmission();
	const recipe = createD682ExecutionQualifiedMechanicalRecipe(g, {
		workItems,
		workItemSeeds,
		proposals,
		effectRunCompletions,
		completionAdmission,
		allowedEffectKinds: effectKinds,
	});
	const completion = effectRunCompletionProjector(g, {
		effectRuns: recipe.effectRuns.effectRuns,
		requestFacts: [recipe.requestFacts],
		requestStatuses: [requestStatuses],
		decisions: [decisions],
		now: () => 0,
	});
	const completedResults = collectData<EffectRunResult>(completion.results);
	return {
		workItems,
		workItemSeeds,
		proposals,
		effectRunCompletions,
		requestStatuses,
		decisions,
		effectKinds,
		recipe,
		completion,
		completedResults,
	};
}

function seedRecipe(
	setup: ReturnType<typeof setupRecipe>,
	proposal: WorkItemEffectPlanProposed<Record<string, unknown>>,
): void {
	const projection: WorkItemProjection<Record<string, unknown>> = {
		workItemId: "wi-d682",
		summary: "Exercise the bounded mutation path",
		authoringRevision: 1,
		executionInputRevision: 1,
		lastEventId: "event-d682-1",
	};
	const seed: WorkItemSeed = {
		kind: "work-item",
		workItemId: projection.workItemId,
		summary: projection.summary,
	};
	setup.workItemSeeds.down([["DATA", seed]]);
	setup.workItems.down([["DATA", projection]]);
	setup.proposals.down([["DATA", proposal]]);
}

function completed(request: AgentRequestIssued, ordinal: number): EffectRunResult {
	return {
		kind: "effect-run-result",
		resultId: `d682-result-${ordinal}`,
		status: "completed",
		effectRunId: request.effectRunId,
		operationId: request.operationId,
		sourceRefs: [{ kind: "agent-request", id: request.requestId }],
		output: { kind: "d682-mechanical-action-result", value: { ok: true, ordinal } },
		completedAtMs: ordinal,
	};
}

function completeThroughLifecycle(
	setup: ReturnType<typeof setupRecipe>,
	request: AgentRequestIssued,
	ordinal: number,
): void {
	setup.requestStatuses.down([
		[
			"DATA",
			{
				kind: "status",
				requestId: request.requestId,
				operationId: request.operationId,
				effectRunId: request.effectRunId,
				status: "completed",
			},
		],
	]);
	setup.decisions.down([
		[
			"DATA",
			{
				kind: "final",
				decisionId: `d682-decision-${ordinal}`,
				effectRunId: request.effectRunId,
				agentRunId: request.agentRunId ?? "d682-agent-run",
				source: {
					requestId: request.requestId,
					operationId: request.operationId,
					outcomeId: `d682-outcome-${ordinal}`,
				},
				output: { kind: "d682-mechanical-action-result", value: { ok: true, ordinal } },
			},
		],
	]);
	const result = setup.completedResults.at(-1);
	if (result === undefined || result.effectRunId !== request.effectRunId) {
		throw new TypeError("D682 completion projector did not emit the expected bound result");
	}
	setup.effectRunCompletions.down([
		[
			"DATA",
			{
				kind: "d682-effect-run-completion",
				issuedRequest: request,
				decisionId: `d682-decision-${ordinal}`,
				outcomeId: `d682-outcome-${ordinal}`,
				result,
			},
		],
	]);
}

describe("B112 D682 package-private execution-qualified mechanical recipe", () => {
	it("issues exactly one dependency-eligible request at a time through the full mutation path", () => {
		const setup = setupRecipe();
		const issued = collectData<AgentRequestIssued>(setup.recipe.agentRequests);
		const requestFacts = collectData<AgentRequestFact>(setup.recipe.requestFacts);
		const resultIssues = collectData(setup.recipe.resultIssues);
		const rejected = collectData(setup.recipe.plan.rejected);
		const issues = collectData(setup.recipe.plan.issues);
		const proposal = createD682SerialEffectPlanProposal({
			planId: "plan-d682",
			workItemId: "wi-d682",
			executionInputRevision: 1,
			actions: setup.effectKinds.map((effectKind) => ({
				memberId: effectKind,
				effectKind,
				input: { action: effectKind },
			})),
		});

		seedRecipe(setup, proposal);
		expect(rejected).toEqual([]);
		expect(issues).toEqual([]);
		expect(issued).toHaveLength(1);

		for (const [index, effectKind] of setup.effectKinds.entries()) {
			const request = issued[index];
			expect(request).toMatchObject({
				kind: "issued",
				requestKind: "executor",
				required: true,
				input: { inputKind: effectKind, value: { action: effectKind } },
				payload: { action: effectKind },
				metadata: {
					recipeRevision: D682_MECHANICAL_RECIPE_REVISION,
					effectKind,
				},
			});
			expect(request?.sourceRefs).toEqual(
				expect.arrayContaining([expect.objectContaining({ kind: "work-item", id: "wi-d682" })]),
			);
			if (index === 0) {
				setup.effectRunCompletions.down([
					[
						"DATA",
						{
							kind: "d682-effect-run-completion",
							issuedRequest: request!,
							decisionId: "d682-substituted-decision",
							outcomeId: "d682-substituted-outcome",
							result: {
								...completed(request!, 0),
								resultId: "d682-substituted-result",
								operationId: `${request!.operationId}:substituted`,
							},
						},
					],
				]);
				expect(issued).toHaveLength(1);
				expect(resultIssues).toEqual([
					expect.objectContaining({ code: "d682-effect-run-result-operation-mismatch" }),
				]);
				setup.requestStatuses.down([
					[
						"DATA",
						{
							kind: "status",
							requestId: request!.requestId,
							operationId: `${request!.operationId}:substituted`,
							effectRunId: request!.effectRunId,
							status: "completed",
						},
					],
				]);
				expect(issued).toHaveLength(1);
			}
			completeThroughLifecycle(setup, request!, index + 1);
			expect(issued).toHaveLength(index === setup.effectKinds.length - 1 ? 5 : index + 2);
		}

		expect(issued.map((request) => request.input?.inputKind)).toEqual(setup.effectKinds);
		expect(new Set(issued.map((request) => request.effectRunId)).size).toBe(5);
		expect(requestFacts.map((fact) => fact.kind)).toEqual(
			setup.effectKinds.flatMap(() => ["proposal", "admitted", "issued"]),
		);
	});

	it("rejects a cyclic dependency bypass before issuing any AgentRequest", () => {
		const setup = setupRecipe();
		const issued = collectData<AgentRequestIssued>(setup.recipe.agentRequests);
		const rejected = collectData(setup.recipe.plan.rejected);
		const proposalIssues = collectData(setup.recipe.proposalIssues);
		const valid = createD682SerialEffectPlanProposal({
			planId: "plan-d682-cycle",
			workItemId: "wi-d682",
			executionInputRevision: 1,
			actions: [
				{ memberId: "a", effectKind: "read", input: {} },
				{ memberId: "b", effectKind: "replace", input: {} },
			],
		});
		const proposal: WorkItemEffectPlanProposed<Record<string, unknown>> = {
			...valid,
			members: [
				{ ...valid.members[0]!, dependsOnMemberIds: ["b"] },
				{ ...valid.members[1]!, dependsOnMemberIds: ["a"] },
			],
		};

		seedRecipe(setup, proposal);
		expect(issued).toEqual([]);
		expect(rejected).toEqual([]);
		expect(proposalIssues).toEqual([
			expect.objectContaining({ code: "d682-effect-plan-proposal-not-serial" }),
		]);
	});

	it("bounds the mechanical action catalog and its canonical input material", () => {
		const mutableInput = { value: "before" };
		const snapshotted = createD682SerialEffectPlanProposal({
			planId: "plan-d682-snapshot",
			workItemId: "wi-d682",
			executionInputRevision: 1,
			actions: [{ memberId: "read", effectKind: "read", input: mutableInput }],
		});
		mutableInput.value = "after";
		expect(snapshotted.members[0]?.goal.input?.value).toEqual({ value: "before" });
		expect(Object.isFrozen(snapshotted.members[0]?.goal.input?.value)).toBe(true);
		const actions = Array.from({ length: D682_MECHANICAL_MAX_ACTIONS }, (_, index) => ({
			memberId: `member-${index}`,
			effectKind: "read",
			input: { index },
		}));
		expect(
			createD682SerialEffectPlanProposal({
				planId: "plan-d682-bound",
				workItemId: "wi-d682",
				executionInputRevision: 1,
				actions,
			}).members,
		).toHaveLength(D682_MECHANICAL_MAX_ACTIONS);
		expect(() =>
			createD682SerialEffectPlanProposal({
				planId: "plan-d682-over-bound",
				workItemId: "wi-d682",
				executionInputRevision: 1,
				actions: [...actions, { memberId: "member-over", effectKind: "read", input: {} }],
			}),
		).toThrow(/1\.\.16/);
		expect(() =>
			createD682SerialEffectPlanProposal({
				planId: "plan-d682-byte-over-bound",
				workItemId: "wi-d682",
				executionInputRevision: 1,
				actions: [
					{
						memberId: "member-byte-over",
						effectKind: "read",
						input: { value: "x".repeat(D682_MECHANICAL_MAX_CANONICAL_ACTION_BYTES) },
					},
				],
			}),
		).toThrow(/canonical byte bound/);
	});

	it("rejects direct proposal bypasses and substituted completion evidence", () => {
		const setup = setupRecipe();
		const issued = collectData<AgentRequestIssued>(setup.recipe.agentRequests);
		const proposalIssues = collectData(setup.recipe.proposalIssues);
		const resultIssues = collectData(setup.recipe.resultIssues);
		const planResults = collectData(setup.recipe.plan.results);
		const valid = createD682SerialEffectPlanProposal({
			planId: "plan-d682-direct-admission",
			workItemId: "wi-d682",
			executionInputRevision: 1,
			actions: [{ memberId: "read", effectKind: "read", input: { action: "read" } }],
		});
		const overBound = {
			...valid,
			members: Array.from({ length: D682_MECHANICAL_MAX_ACTIONS + 1 }, (_, index) => ({
				...valid.members[0],
				memberId: `read-${index}`,
				dependsOnMemberIds: index === 0 ? [] : [`read-${index - 1}`],
			})),
		};
		seedRecipe(setup, overBound);
		expect(issued).toEqual([]);
		expect(proposalIssues).toEqual([
			expect.objectContaining({ code: "d682-effect-plan-proposal-shape-invalid" }),
		]);

		setup.proposals.down([["DATA", valid]]);
		expect(issued).toHaveLength(1);
		const request = issued[0]!;
		setup.requestStatuses.down([
			[
				"DATA",
				{
					kind: "status",
					requestId: request.requestId,
					operationId: request.operationId,
					effectRunId: request.effectRunId,
					status: "completed",
				},
			],
		]);
		setup.decisions.down([
			[
				"DATA",
				{
					kind: "final",
					decisionId: "d682-real-decision",
					effectRunId: request.effectRunId,
					agentRunId: request.agentRunId ?? "d682-agent-run",
					source: {
						requestId: request.requestId,
						operationId: request.operationId,
						outcomeId: "d682-real-outcome",
					},
					output: { kind: "d682-mechanical-action-result", value: { ok: true } },
				},
			],
		]);
		const result = setup.completedResults.at(-1)!;
		setup.effectRunCompletions.down([
			[
				"DATA",
				{
					kind: "d682-effect-run-completion",
					issuedRequest: request,
					decisionId: "d682-substituted-decision",
					outcomeId: "d682-real-outcome",
					result,
				},
			],
		]);
		expect(resultIssues.at(-1)).toEqual(
			expect.objectContaining({ code: "d682-effect-run-result-completion-evidence-mismatch" }),
		);
		setup.effectRunCompletions.down([
			[
				"DATA",
				{
					kind: "d682-effect-run-completion",
					issuedRequest: JSON.parse(JSON.stringify(request)) as AgentRequestIssued,
					decisionId: "d682-real-decision",
					outcomeId: "d682-real-outcome",
					result,
				},
			],
		]);
		expect(resultIssues.at(-1)).toEqual(
			expect.objectContaining({ code: "d682-effect-run-result-unissued-request" }),
		);
		expect(planResults).toEqual([]);
		setup.effectRunCompletions.down([
			[
				"DATA",
				{
					kind: "d682-effect-run-completion",
					issuedRequest: request,
					decisionId: "d682-real-decision",
					outcomeId: "d682-real-outcome",
					result,
				},
			],
		]);
		expect(planResults).toEqual([expect.objectContaining({ status: "succeeded" })]);
		setup.effectRunCompletions.down([["DATA", null as never]]);
		expect(resultIssues.at(-1)).toEqual(
			expect.objectContaining({ code: "d682-effect-run-result-malformed" }),
		);
	});

	it("rechecks action bytes at recipe admission instead of trusting the proposal helper", () => {
		const setup = setupRecipe();
		const proposalIssues = collectData(setup.recipe.proposalIssues);
		const proposal = createD682SerialEffectPlanProposal({
			planId: "plan-d682-action-recheck",
			workItemId: "wi-d682",
			executionInputRevision: 1,
			actions: [{ memberId: "read", effectKind: "read", input: { value: "bounded" } }],
		});
		const bypass = {
			...proposal,
			members: [
				{
					...proposal.members[0]!,
					goal: {
						...proposal.members[0]!.goal,
						input: {
							...proposal.members[0]!.goal.input!,
							value: { value: "x".repeat(D682_MECHANICAL_MAX_CANONICAL_ACTION_BYTES) },
						},
					},
				},
			],
		};
		seedRecipe(setup, bypass);
		expect(proposalIssues).toEqual([
			expect.objectContaining({ code: "d682-effect-plan-action-byte-bound-exceeded" }),
		]);
	});
});
