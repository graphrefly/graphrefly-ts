/**
 * Knowledge-graph extraction — Node-runnable mirror of the browser demo.
 *
 * Per SESSION-strategy-roadmap-demo-reprioritization.md: this example uses
 * pre-parsed documents (NOT a real LLM call) so it runs in CI / on a laptop
 * with no API key. The browser demo at `demos/knowledge-graph/` runs the same
 * pipeline against Chrome's built-in Gemini Nano.
 *
 * Pipeline:
 *
 *   fromArray(docs)          (source — pre-extracted entities + relations)
 *        │
 *        ▼
 *   apply-extraction         (effect — kg.upsertEntity / kg.link)
 *        │
 *        ▼
 *   kg/{entities,edges,adjacency}   (UI / consumers subscribe here)
 *        │
 *        ▼
 *   kg.explain("docs", "adjacency", { reactive: true })  (live causal chain)
 */

import { DATA, effect } from "@graphrefly/graphrefly/core";
import { fromIter } from "@graphrefly/graphrefly/extra/sources";
import { knowledgeGraph } from "@graphrefly/graphrefly/patterns/memory";

type Entity = { id: string; label: string; kind: string };
type Relation = "addresses" | "is_a" | "part_of" | "uses";
type Doc = {
	entities: Entity[];
	relations: Array<{ from: string; to: string; relation: Relation }>;
};

const DOCS: readonly Doc[] = [
	{
		entities: [
			{ id: "harness", label: "AI Harness Engineering", kind: "concept" },
			{ id: "alignment", label: "AI Alignment", kind: "concept" },
			{ id: "brittleness", label: "Value Brittleness", kind: "risk" },
		],
		relations: [
			{ from: "harness", to: "alignment", relation: "uses" },
			{ from: "alignment", to: "brittleness", relation: "addresses" },
		],
	},
	{
		entities: [
			{ id: "hitl", label: "Human-in-the-Loop", kind: "method" },
			{ id: "brittleness", label: "Value Brittleness", kind: "risk" },
			{ id: "harness", label: "AI Harness Engineering", kind: "concept" },
		],
		relations: [
			{ from: "hitl", to: "brittleness", relation: "addresses" },
			{ from: "hitl", to: "harness", relation: "part_of" },
		],
	},
	{
		entities: [
			{ id: "interpretability", label: "Mechanistic Interpretability", kind: "method" },
			{ id: "redteam", label: "Red Teaming", kind: "method" },
			{ id: "harness", label: "AI Harness Engineering", kind: "concept" },
		],
		relations: [
			{ from: "interpretability", to: "harness", relation: "part_of" },
			{ from: "redteam", to: "harness", relation: "part_of" },
		],
	},
];

const kg = knowledgeGraph<Entity, Relation>("paper-kg");

const docs = fromIter<Doc>(DOCS, { name: "docs" });
kg.add(docs, { name: "docs" });

const apply = effect(
	[docs],
	([doc]) => {
		const d = doc as Doc | undefined;
		if (!d) return;
		const ids = new Set(d.entities.map((e) => e.id));
		for (const e of d.entities) kg.upsertEntity(e.id, e);
		for (const r of d.relations) {
			if (!ids.has(r.from) || !ids.has(r.to)) continue;
			kg.link(r.from, r.to, r.relation);
		}
	},
	{ name: "apply-extraction" },
);
kg.add(apply, { name: "apply-extraction" });

// Live causal chain. Re-derives whenever any node along the path fires.
const explain = kg.explain("docs", "adjacency", { reactive: true });
explain.node.subscribe((msgs) => {
	for (const [type, value] of msgs) {
		if (type !== DATA) continue;
		const chain = value as { found: boolean; steps?: ReadonlyArray<{ path: string }> };
		if (!chain.found) continue;
		const path = chain.steps?.map((s) => s.path).join(" → ") ?? "";
		console.log(`explainPath: ${path}`);
	}
});

// Print final KG snapshot.
const entities = kg.resolve("entities").cache as ReadonlyMap<string, Entity>;
const edges = kg.resolve("edges").cache as
	| ReadonlyArray<{ from: string; to: string; relation: Relation }>
	| undefined;

console.log(`\nentities (${entities.size}):`);
for (const e of entities.values()) {
	console.log(`  ${e.id} [${e.kind}] — ${e.label}`);
}
console.log(`\nedges (${edges?.length ?? 0}):`);
for (const e of edges ?? []) {
	console.log(`  ${e.from} —${e.relation}→ ${e.to}`);
}

explain.dispose();
