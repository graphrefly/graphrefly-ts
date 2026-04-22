// Chapter 3 — Inspect & Trace.
//
// Reuses the reactive pipeline from chapter 2 and adds two introspection
// surfaces:
//
// 1. `describe()` — the topology mermaid that's already rendering in the
//    side pane. We just point at it and explain what users are looking at.
// 2. `reactiveExplainPath` — a live causal chain from `paper-text` to
//    `adjacency`. Bumps whenever any node in between fires. This is the
//    answer to "why did this entity end up here?" — homepage pain point 02.

import type { Node } from "@graphrefly/graphrefly/core";
import type { CausalChain } from "@graphrefly/graphrefly/graph";
import type { LLMAdapter } from "@graphrefly/graphrefly/patterns/ai";
import { reactiveExplainPath } from "@graphrefly/graphrefly/patterns/audit";
import type { NodeRegistry } from "@graphrefly/graphrefly/patterns/demo-shell";
import { buildReactiveChapter, type ReactiveChapter } from "./reactive.js";

export const INSPECT_SOURCE = `// Same pipeline as chapter 2 — paper → paragraphs → extraction → kg.
// Now we ask the topology two questions, both reactively.

// Q1: "what does this graph look like?" — describe() returns a snapshot.
//     The right-side mermaid is just describe({ format: "mermaid" }).
const snapshot = kg.describe({ detail: "standard" });

// Q2: "what shaped the current paragraph?" — reactiveExplainPath()
//     returns a Node<CausalChain> that re-derives whenever any node along
//     the path fires. Subscribe to it, render the chain.
//
//     Trace stops at named nodes wired by user code. promptNode + the
//     apply-extraction effect involve internal/imperative bridges, so the
//     KG writes downstream are not statically traceable from here.
const explain = reactiveExplainPath(kg, "paper-text", "current-paragraph");

explain.node.subscribe(() => {
  const chain = explain.node.cache;
  // chain.steps[i] is { path, kind, depPaths, ... }
  console.log(chain.text);
});
`;

export type InspectChapter = Omit<ReactiveChapter, "id"> & {
	id: "inspect";
	explain: Node<CausalChain>;
	disposeExplain: () => void;
};

export function buildInspectChapter(adapter: LLMAdapter, initialPaperText: string): InspectChapter {
	const base = buildReactiveChapter(adapter, initialPaperText);

	const explainHandle = reactiveExplainPath(base.kg, "paper-text", "current-paragraph", {
		name: "explain-paper-to-current",
		maxDepth: 12,
	});
	base.kg.add(explainHandle.node, { name: "explain-paper-to-current" });

	const registry: NodeRegistry = new Map(base.registry);
	registry.set("explain-paper-to-current", {
		codeLine: 14,
		visualSelector: "[data-explain-chain]",
	});

	return {
		...base,
		id: "inspect",
		sourceCode: INSPECT_SOURCE,
		registry,
		explain: explainHandle.node,
		disposeExplain: explainHandle.dispose,
	};
}
