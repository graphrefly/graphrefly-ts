import { describe, expect, it } from "vitest";
import { toolProviderExecutionRecipe } from "../executors/tool-provider.js";
import type { ToolProviderAdapterBinding } from "../executors/tool-provider-runtime.js";
import { graph } from "../graph/graph.js";
import {
	type AgentRequestFact,
	type AgentRequestIssued,
	type ExecutorRoute,
	localBuiltinToolProviderCatalog,
	type ToolCallInput,
} from "../orchestration/agent-runtime.js";

describe("tool provider execution recipe (D283/D359-D362)", () => {
	it("composes policy, adapter input, runtime, and outcome view over caller-owned bindings", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "agentRequestFacts" });
		const routes = g.node<ExecutorRoute>([], null, { name: "executorRoutes" });
		const calls: readonly string[] = [];
		const binding: ToolProviderAdapterBinding = {
			providerId: "local-builtin",
			run(input, ctx) {
				calls.push(`${input.adapterInputId}:${ctx.attempt}`);
				return {
					kind: "result",
					result: {
						kind: "text",
						value: `ran ${input.toolName}`,
						summary: `ran ${input.toolName}`,
					},
					occurredAtMs: 123,
				};
			},
		};
		const recipe = toolProviderExecutionRecipe(g, {
			requestFacts,
			executorRoutes: [routes],
			catalogs: [localBuiltinToolProviderCatalog()],
			bindings: [binding],
			now: () => 123,
			outcomeViewPolicy: { maxSummaryChars: 64 },
		});
		const inputs = collectData(recipe.adapterInputs.inputs);
		const outcomes = collectData(recipe.outcomes);
		const views = collectData(recipe.outcomeViews.views);
		const issues = [
			...collectData(recipe.issues.policy),
			...collectData(recipe.issues.adapterInputs),
			...collectData(recipe.issues.runtime),
			...collectData(recipe.issues.outcomeViews),
		];

		routes.down([["DATA", route()]]);
		requestFacts.down([["DATA", request()]]);

		expect(inputs).toEqual([
			expect.objectContaining({
				kind: "tool-provider-adapter-input",
				status: "ready",
				providerId: "local-builtin",
				toolName: "date.now",
			}),
		]);
		expect(calls).toEqual([`${inputs[0]?.adapterInputId}:1`]);
		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "result",
				requestId: "request-1",
				result: expect.objectContaining({ summary: "ran date.now" }),
			}),
		]);
		expect(views).toEqual([
			expect.objectContaining({
				kind: "executor-outcome-view",
				audience: "agent-observation",
				requestId: "request-1",
				summary: "ran date.now",
			}),
		]);
		expect(issues).toEqual([]);
		expect(g.describe().nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "toolProviderExecution/catalogs",
					factory: "producer",
				}),
				expect.objectContaining({
					id: "toolProviderExecution/policy/runtime",
					factory: "toolProviderPolicyResolutionProjector",
				}),
				expect.objectContaining({
					id: "toolProviderExecution/adapterInput/runtime",
					factory: "toolProviderAdapterInputProjector",
				}),
				expect.objectContaining({
					id: "toolProviderExecution/runtime/runs/runtime",
					factory: "toolProviderAdapterRunProjector",
				}),
				expect.objectContaining({
					id: "toolProviderExecution/outcomeView/runtime",
					factory: "executorOutcomeViewProjector",
				}),
			]),
		);
		recipe.dispose();
	});
});

function request(): AgentRequestIssued {
	return {
		kind: "issued",
		requestId: "request-1",
		operationId: "op-1",
		effectRunId: "effect-run-1",
		requestKind: "executor",
		required: true,
		input: {
			inputId: "input-1",
			inputKind: "tool-call",
			value: {
				kind: "tool-call",
				toolName: "date.now",
				operation: "read",
			} satisfies ToolCallInput,
		},
	};
}

function route(): ExecutorRoute {
	return {
		kind: "executor-route",
		routeId: "route-1",
		requestId: "request-1",
		operationId: "op-1",
		executorId: "local-builtin:tool-executor",
		profileId: "local-builtin:tool-profile",
	};
}

function collectData<T>(node: {
	subscribe(sink: (msg: readonly [string, unknown?]) => void): unknown;
}): T[] {
	const out: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") out.push(msg[1] as T);
	});
	return out;
}
