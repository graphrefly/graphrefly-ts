// ---------------------------------------------------------------------------
// graphFromSpec
// ---------------------------------------------------------------------------

import { Graph, type GraphPersistSnapshot } from "../../../graph/graph.js";
import { resolveToolHandlerResult, stripFences } from "../_internal.js";
import type { ChatMessage, LLMAdapter, LLMResponse } from "../adapters/core/types.js";
import { validateGraphDef } from "./validate-graph-def.js";

export type GraphFromSpecOptions = {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Callback to construct topology before values are applied (passed to `Graph.fromSnapshot`). */
	build?: (g: Graph) => void;
	/** Extra instructions appended to the system prompt. */
	systemPromptExtra?: string;
};

const GRAPH_FROM_SPEC_SYSTEM_PROMPT = `You are a graph architect for GraphReFly, a reactive graph protocol.

Given a natural-language description, produce a JSON graph definition with this structure:

{
  "name": "<graph_name>",
  "nodes": {
    "<node_name>": {
      "type": "state" | "derived" | "producer" | "operator" | "effect",
      "value": <initial_value_or_null>,
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
  },
  "edges": [
    { "from": "<source_node>", "to": "<target_node>" }
  ]
}

Rules:
- "state" nodes have no deps and hold user/LLM-writable values (knobs).
- "derived" nodes have deps and compute from them.
- "effect" nodes have deps but produce side effects (no return value).
- "producer" nodes have no deps but generate values asynchronously.
- Edges wire output of one node as input to another. They must match deps.
- meta.description is required for every node.
- Return ONLY valid JSON, no markdown fences or commentary.`;

/**
 * Ask an LLM to compose a Graph from a natural-language description.
 *
 * The LLM returns a JSON graph definition which is validated and then
 * constructed via `Graph.fromSnapshot()`.
 *
 * @param naturalLanguage - The problem/use-case description.
 * @param adapter - LLM adapter for the generation call.
 * @param opts - Model options and optional `build` callback for node factories.
 * @returns A constructed Graph.
 * @throws On invalid LLM output or validation failure.
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

	const validation = validateGraphDef(parsed);
	if (!validation.valid) {
		throw new Error(`graphFromSpec: invalid graph definition:\n${validation.errors.join("\n")}`);
	}

	const def = parsed as Record<string, unknown>;
	// Ensure version field is present for fromSnapshot envelope check
	if (def.version === undefined) def.version = 1;
	if (!Array.isArray(def.subgraphs)) def.subgraphs = [];
	return Graph.fromSnapshot(def as GraphPersistSnapshot, opts?.build);
}
