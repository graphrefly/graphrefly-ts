// ---------------------------------------------------------------------------
// graphFromSpec
// ---------------------------------------------------------------------------

import { COMPLETE, ERROR } from "@graphrefly/pure-ts/core";
import { type Node, node } from "@graphrefly/pure-ts/core";
import { fromAny, type NodeInput, switchMap } from "@graphrefly/pure-ts/extra";
import type { Graph } from "@graphrefly/pure-ts/graph";
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
	/**
	 * Optional AbortSignal forwarded to `adapter.invoke({ signal })`. Lets
	 * callers cancel the in-flight LLM call (e.g. when the reactive variant
	 * supersedes mid-flight). When the signal aborts, the underlying call
	 * propagates the abort and `graphFromSpec` rejects with the abort reason.
	 */
	signal?: AbortSignal;
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
		signal: opts?.signal,
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

/**
 * Reactive variant of {@link graphFromSpec}: re-invokes the LLM and
 * recompiles the graph whenever `input` emits a new natural-language
 * description. Useful inside the harness or refine loop when the spec text
 * itself is a reactive value (e.g. fed by a `node([], { initial: ... })` knob, a memory
 * snapshot, or an upstream `promptNode` output).
 *
 * **Supersede:** when the input changes mid-flight, switchMap tears the
 * inner producer down. The producer's cleanup aborts the in-flight LLM
 * call via an internal `AbortController` (threaded into `graphFromSpec`'s
 * new `signal` option) AND destroys any Graph that lands after cancel —
 * no token leak, no unreferenced compiled graphs. If the user's input
 * already changed by the time the LLM responds, the about-to-be-discarded
 * Graph is freed instead of orphaned.
 *
 * **Lifetime of the latest emitted Graph:** the caller owns each Graph
 * that actually reaches them. If you keep multiple historical values, call
 * `prev?.destroy()` before storing the new one.
 *
 * @param input - Reactive source of natural-language descriptions.
 * @param adapter - LLM adapter for the generation call.
 * @param opts - Model options and optional catalog for named node factories.
 * @returns `Node<Graph | null>` — emits the latest compiled graph, or `null`
 *           while the input is empty / unsettled.
 */
export function graphFromSpecReactive(
	input: NodeInput<string>,
	adapter: LLMAdapter,
	opts?: GraphFromSpecOptions,
): Node<Graph | null> {
	const inputNode = fromAny(input);
	return switchMap<string, Graph | null>(inputNode, (nl) => {
		if (!nl || typeof nl !== "string" || nl.trim().length === 0) {
			return node<Graph | null>([], { initial: null });
		}
		// Producer guarantees a single DATA + COMPLETE per upstream wave —
		// matches the `promptNode` shape (see Unit 1 review). On supersede,
		// switchMap tears down the producer; cleanup aborts the in-flight LLM
		// call AND destroys any Graph that lands post-abort (would otherwise
		// leak its mounted state nodes / storage handles until GC).
		return node<Graph | null>(
			(_data, actions) => {
				const controller = new AbortController();
				let cancelled = false;
				graphFromSpec(nl, adapter, { ...opts, signal: controller.signal })
					.then((g) => {
						if (cancelled) {
							g.destroy();
							return;
						}
						actions.emit(g);
						actions.down([[COMPLETE]]);
					})
					.catch((err) => {
						if (cancelled) return;
						actions.down([[ERROR, err]]);
					});
				return () => {
					cancelled = true;
					controller.abort();
				};
			},
			{ describeKind: "producer", ...{ name: "graphFromSpec::call" } },
		);
	});
}
