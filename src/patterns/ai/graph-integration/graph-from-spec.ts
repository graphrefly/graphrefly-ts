// ---------------------------------------------------------------------------
// graphFromSpec
// ---------------------------------------------------------------------------

import type { Graph } from "../../../graph/graph.js";
import { compileSpec, type GraphSpec, type GraphSpecCatalog } from "../../graphspec/index.js";
import { resolveToolHandlerResult, stripFences } from "../_internal.js";
import type { ChatMessage, LLMAdapter, LLMResponse } from "../adapters/core/types.js";

export type GraphFromSpecOptions = {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Fn/source catalog for resolving named node factories from the LLM-generated spec. */
	catalog?: GraphSpecCatalog;
	/** Extra instructions appended to the system prompt. */
	systemPromptExtra?: string;
};

const GRAPH_FROM_SPEC_SYSTEM_PROMPT = `You are a graph architect for GraphReFly, a reactive graph protocol.

Given a natural-language description, produce a JSON graph specification with this structure:

{
  "name": "<graph_name>",
  "nodes": {
    "<node_name>": {
      "type": "state" | "derived" | "producer" | "effect" | "operator",
      "initial": <initial_value_for_state_nodes>,
      "deps": ["<dep_node_name>", ...],
      "meta": {
        "description": "<human-readable purpose>",
        "type": "string" | "number" | "boolean" | "integer" | "enum",
        "range": [min, max],
        "values": ["a", "b"],
        "format": "currency" | "percentage" | "status",
        "access": "human" | "llm" | "both" | "system",
        "unit": "<unit>",
        "tags": ["<tag>"]
      }
    }
  }
}

Rules:
- "state" nodes have no deps and hold user/LLM-writable values (knobs). Use "initial" for the starting value.
- "derived" nodes have deps and compute from them (pure, no side effects).
- "effect" nodes have deps but produce side effects (no return value).
- "producer" nodes have no deps but generate values asynchronously.
- "operator" nodes are parameterized transformations with deps.
- Use "deps" inside each node to declare dependencies — no separate "edges" array.
- meta.description is required for every node.
- Return ONLY valid JSON, no markdown fences or commentary.`;

/**
 * Ask an LLM to compose a Graph from a natural-language description.
 *
 * The LLM returns a JSON {@link GraphSpec} which is validated, catalog-expanded,
 * and instantiated via {@link compileSpec} (gains catalog validation, template
 * expansion, and feedback wiring that `Graph.fromSnapshot` bypasses).
 *
 * @param naturalLanguage - The problem/use-case description.
 * @param adapter - LLM adapter for the generation call.
 * @param opts - Model options and optional catalog for named node factories.
 * @returns A constructed Graph.
 * @throws On invalid LLM output, validation failure, or unresolvable deps.
 */
export async function graphFromSpec(
	naturalLanguage: string,
	adapter: LLMAdapter,
	opts?: GraphFromSpecOptions,
): Promise<Graph> {
	const systemPrompt = opts?.systemPromptExtra
		? `${GRAPH_FROM_SPEC_SYSTEM_PROMPT}\n\n${opts.systemPromptExtra}`
		: GRAPH_FROM_SPEC_SYSTEM_PROMPT;

	const messages: ChatMessage[] = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: naturalLanguage },
	];

	const rawResult = adapter.invoke(messages, {
		model: opts?.model,
		temperature: opts?.temperature ?? 0,
		maxTokens: opts?.maxTokens,
	});

	const response = (await resolveToolHandlerResult(rawResult)) as LLMResponse;
	let content = response.content.trim();

	// Strip markdown fences if present (handles trailing commentary after ```)
	if (content.startsWith("```")) {
		content = stripFences(content);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(`graphFromSpec: LLM response is not valid JSON: ${content.slice(0, 200)}`);
	}

	return compileSpec(parsed as GraphSpec, { catalog: opts?.catalog });
}
