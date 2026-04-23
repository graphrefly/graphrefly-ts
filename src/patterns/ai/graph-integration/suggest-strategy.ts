// ---------------------------------------------------------------------------
// suggestStrategy
// ---------------------------------------------------------------------------

import type { Actor } from "../../../core/actor.js";
import type { Graph } from "../../../graph/graph.js";
import { resolveToolHandlerResult } from "../_internal.js";
import type { ChatMessage, LLMAdapter, LLMResponse } from "../adapters/core/types.js";

/** A single operation in a strategy plan. */
export type StrategyOperation =
	| {
			readonly type: "add_node";
			readonly name: string;
			readonly nodeType: string;
			readonly meta?: Record<string, unknown>;
			readonly initial?: unknown;
	  }
	| { readonly type: "remove_node"; readonly name: string }
	| { readonly type: "connect"; readonly from: string; readonly to: string }
	| { readonly type: "disconnect"; readonly from: string; readonly to: string }
	| { readonly type: "set_value"; readonly name: string; readonly value: unknown }
	| {
			readonly type: "update_meta";
			readonly name: string;
			readonly key: string;
			readonly value: unknown;
	  };

/** Structured strategy plan returned by {@link suggestStrategy}. */
export type StrategyPlan = {
	readonly summary: string;
	readonly operations: readonly StrategyOperation[];
	readonly reasoning: string;
};

export type SuggestStrategyOptions = {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	actor?: Actor;
};

const SUGGEST_STRATEGY_SYSTEM_PROMPT = `You are a reactive graph optimizer for GraphReFly.

Given a graph's current structure (from describe()) and a problem statement, suggest topology and parameter changes to solve the problem.

Return ONLY valid JSON with this structure:
{
  "summary": "<one-line summary of the strategy>",
  "reasoning": "<explanation of why these changes help>",
  "operations": [
    { "type": "add_node", "name": "<name>", "nodeType": "state|derived|effect|producer|operator", "meta": {...}, "initial": <value> },
    { "type": "remove_node", "name": "<name>" },
    { "type": "connect", "from": "<source>", "to": "<target>" },
    { "type": "disconnect", "from": "<source>", "to": "<target>" },
    { "type": "set_value", "name": "<name>", "value": <new_value> },
    { "type": "update_meta", "name": "<name>", "key": "<meta_key>", "value": <new_value> }
  ]
}

Rules:
- Only suggest operations that reference existing nodes (for remove/disconnect/set_value/update_meta) or new nodes you define (for add_node).
- Keep changes minimal — prefer the smallest set of operations that solves the problem.
- Return ONLY valid JSON, no markdown fences or commentary.`;

/**
 * Ask an LLM to analyze a graph and suggest topology/parameter changes
 * to solve a stated problem.
 *
 * Returns a structured plan — does NOT auto-apply. The caller reviews
 * and selectively applies operations.
 *
 * @param graph - The graph to analyze.
 * @param problem - Natural-language problem statement.
 * @param adapter - LLM adapter for the analysis call.
 * @param opts - Model and actor options.
 * @returns A structured strategy plan.
 * @throws On invalid LLM output.
 */
export async function suggestStrategy(
	graph: Graph,
	problem: string,
	adapter: LLMAdapter,
	opts?: SuggestStrategyOptions,
): Promise<StrategyPlan> {
	const { expand: _, ...described } = graph.describe({ actor: opts?.actor, detail: "standard" });

	const messages: ChatMessage[] = [
		{ role: "system", content: SUGGEST_STRATEGY_SYSTEM_PROMPT },
		{
			role: "user",
			content: JSON.stringify({
				graph: described,
				problem,
			}),
		},
	];

	const rawResult = adapter.invoke(messages, {
		model: opts?.model,
		temperature: opts?.temperature ?? 0,
		maxTokens: opts?.maxTokens,
	});

	const response = (await resolveToolHandlerResult(rawResult)) as LLMResponse;
	let content = response.content.trim();

	if (content.startsWith("```")) {
		content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(`suggestStrategy: LLM response is not valid JSON: ${content.slice(0, 200)}`);
	}

	const plan = parsed as Record<string, unknown>;

	if (typeof plan.summary !== "string") {
		throw new Error("suggestStrategy: missing 'summary' in response");
	}
	if (typeof plan.reasoning !== "string") {
		throw new Error("suggestStrategy: missing 'reasoning' in response");
	}
	if (!Array.isArray(plan.operations)) {
		throw new Error("suggestStrategy: missing 'operations' array in response");
	}

	return {
		summary: plan.summary,
		reasoning: plan.reasoning,
		operations: plan.operations as readonly StrategyOperation[],
	};
}
