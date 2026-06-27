/**
 * Knowledge-graph extraction — clean-slate Node example.
 *
 * Pre-parsed documents become graph-visible KnowledgeAssertion facts. The
 * semantic-memory reducer bundle materializes deterministic entity, relation,
 * topic, status, and error projections without owning LLM extraction, storage,
 * or an imperative graph mutation API.
 */

import { graph } from "@graphrefly/ts";
import {
	type KnowledgeAssertion,
	type KnowledgeGraphRelation,
	type KnowledgeGraphStatus,
	knowledgeGraphReducerBundle,
} from "@graphrefly/ts/patterns";

type Entity = { id: string; label: string; kind: string };
type Relation = "addresses" | "is_a" | "part_of" | "uses";
type Doc = {
	readonly id: string;
	readonly entities: readonly Entity[];
	readonly relations: readonly { from: string; to: string; relation: Relation }[];
};

const DOCS: readonly Doc[] = [
	{
		id: "doc-1",
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
		id: "doc-2",
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
		id: "doc-3",
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

function assertionsFromDocs(docs: readonly Doc[]): KnowledgeAssertion[] {
	const byId = new Map<string, Entity>();
	for (const doc of docs) {
		for (const entity of doc.entities) byId.set(entity.id, entity);
	}

	const assertions: KnowledgeAssertion[] = [];
	for (const doc of docs) {
		for (const entity of doc.entities) {
			assertions.push({
				id: `${doc.id}:label:${entity.id}`,
				subject: { id: entity.id, type: entity.kind },
				predicate: "label",
				object: { kind: "value", value: entity.label, valueType: "text" },
				confidence: 1,
				sources: [doc.id],
				provenance: "pre-parsed-demo-doc",
			});
		}
		for (const relation of doc.relations) {
			const subject = byId.get(relation.from);
			const object = byId.get(relation.to);
			if (subject === undefined || object === undefined) continue;
			assertions.push({
				id: `${doc.id}:${relation.from}:${relation.relation}:${relation.to}`,
				subject: { id: subject.id, type: subject.kind },
				predicate: relation.relation,
				object: { kind: "entity", id: object.id, type: object.kind },
				confidence: 0.9,
				sources: [doc.id],
				provenance: "pre-parsed-demo-doc",
			});
		}
	}
	return assertions;
}

function activate<T>(node: {
	subscribe: (sink: (message: readonly [string, unknown?]) => void) => () => void;
}): { readonly value: T; readonly unsubscribe: () => void } {
	let latest: T | undefined;
	const unsubscribe = node.subscribe(([type, value]) => {
		if (type === "DATA") latest = value as T;
	});
	if (latest === undefined) {
		unsubscribe();
		throw new Error("expected node to emit DATA on subscribe");
	}
	return { value: latest, unsubscribe };
}

const g = graph({ name: "knowledge-graph-example" });
const docs = g.state(DOCS, { name: "docs" });
const assertions = g.derived([docs], assertionsFromDocs, { name: "assertions" });
const policy = g.state(
	{ allowedPredicates: ["addresses", "is_a", "label", "part_of", "uses"] },
	{ name: "policy" },
);
const kg = knowledgeGraphReducerBundle(g, { name: "kg", assertions, policy });

const subscriptions: [
	{ readonly value: KnowledgeGraphStatus; readonly unsubscribe: () => void },
	{ readonly value: readonly { id: string; type?: string }[]; readonly unsubscribe: () => void },
	{ readonly value: readonly KnowledgeGraphRelation[]; readonly unsubscribe: () => void },
	{
		readonly value: readonly { predicate: string; assertionIds: readonly string[] }[];
		readonly unsubscribe: () => void;
	},
] = [] as never;
try {
	subscriptions.push(activate<KnowledgeGraphStatus>(kg.status));
	subscriptions.push(activate<readonly { id: string; type?: string }[]>(kg.entities));
	subscriptions.push(activate<readonly KnowledgeGraphRelation[]>(kg.relations));
	subscriptions.push(
		activate<readonly { predicate: string; assertionIds: readonly string[] }[]>(kg.topics),
	);
} catch (error) {
	for (const subscription of subscriptions) subscription.unsubscribe();
	throw error;
}
const [status, entities, relations, topics] = subscriptions.map(({ value }) => value) as [
	KnowledgeGraphStatus,
	readonly { id: string; type?: string }[],
	readonly KnowledgeGraphRelation[],
	readonly { predicate: string; assertionIds: readonly string[] }[],
];

console.log(`status: ${status.state}`);
console.log(`entities (${entities.length}):`);
for (const entity of entities) {
	console.log(`  ${entity.id}${entity.type === undefined ? "" : ` [${entity.type}]`}`);
}

console.log(`\nrelations (${relations.length}):`);
for (const relation of relations) {
	const object =
		relation.object.kind === "entity"
			? relation.object.id
			: `${relation.object.valueType ?? "value"}:${String(relation.object.value)}`;
	console.log(`  ${relation.subject.id} -${relation.predicate}-> ${object}`);
}

console.log(`\ntopics (${topics.length}):`);
for (const topic of topics) {
	console.log(`  ${topic.predicate}: ${topic.assertionIds.length}`);
}

console.log("\ncausal chain:");
for (const edge of g.describe({ explain: { from: "docs", to: "kg/relations" } }).edges) {
	console.log(`  ${edge.from} -> ${edge.to}`);
}

for (const subscription of subscriptions) subscription.unsubscribe();
