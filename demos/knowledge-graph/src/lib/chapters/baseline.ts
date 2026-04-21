// Chapter 1 — "this is just a fancy Map so far".
//
// Pedagogical purpose: dispel the "knowledgeGraph() is Obsidian" misconception
// up front. Show the imperative API first so users understand the shape, then
// label it "static — no reactivity here." The next chapter is the contrast.

import type { NodeRegistry } from "@graphrefly/graphrefly/patterns/demo-shell";
import { type DemoKG, makeKG } from "./_shared.js";

export const BASELINE_SOURCE = `// 1. Create a knowledgeGraph() — it's a Graph with three named nodes
//    (entities, edges, adjacency) plus four imperative methods.
const kg = knowledgeGraph<Entity, Relation>("baseline");

// 2. Seed it with hand-written entities and links. This is what every
//    KG demo on the internet stops at. Looks like a fancy Map.
kg.upsertEntity("alignment", {
  id: "alignment", label: "AI Alignment", kind: "concept",
});
kg.upsertEntity("hitl", {
  id: "hitl", label: "Human-in-the-Loop", kind: "method",
});
kg.upsertEntity("brittleness", {
  id: "brittleness", label: "Value Brittleness", kind: "risk",
});

kg.link("hitl",         "brittleness", "addresses");
kg.link("alignment",    "brittleness", "contrasts_with");
kg.link("hitl",         "alignment",    "part_of");

// 3. Imperative query — for outside-the-graph code (event handlers, tool
//    results, REST handlers). Fine here. The next chapter is the *reactive*
//    consumer that you cannot build with a plain Map.
kg.related("hitl");           // → 2 edges
kg.related("hitl", "addresses"); // → 1 edge
`;

export type BaselineChapter = {
	id: "baseline";
	graph: DemoKG;
	kg: DemoKG;
	sourceCode: string;
	registry: NodeRegistry;
	reseed: () => void;
};

function seed(kg: DemoKG): void {
	kg.upsertEntity("alignment", { id: "alignment", label: "AI Alignment", kind: "concept" });
	kg.upsertEntity("hitl", { id: "hitl", label: "Human-in-the-Loop", kind: "method" });
	kg.upsertEntity("brittleness", { id: "brittleness", label: "Value Brittleness", kind: "risk" });
	kg.link("hitl", "brittleness", "addresses");
	kg.link("alignment", "brittleness", "contrasts_with");
	kg.link("hitl", "alignment", "part_of");
}

export function buildBaselineChapter(): BaselineChapter {
	const kg = makeKG("baseline");
	seed(kg);

	const registry: NodeRegistry = new Map([
		["entities", { codeLine: 7, visualSelector: "[data-kg-pane]" }],
		["edges", { codeLine: 17, visualSelector: "[data-kg-pane]" }],
		["adjacency", { codeLine: 17, visualSelector: "[data-kg-pane]" }],
	]);

	return {
		id: "baseline",
		graph: kg,
		kg,
		sourceCode: BASELINE_SOURCE,
		registry,
		reseed() {
			seed(kg);
		},
	};
}
