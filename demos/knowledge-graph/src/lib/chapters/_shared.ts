// Shared helpers for the four chapters. Keeps the per-chapter source compact
// so the right-side code pane can quote them at full fidelity.

import type { Node } from "@graphrefly/graphrefly/core";
import { type KnowledgeGraphGraph, knowledgeGraph } from "@graphrefly/graphrefly/patterns/memory";
import type { Entity, Relation } from "../types.js";

export type DemoKG = KnowledgeGraphGraph<Entity, Relation>;

export type KGSnapshot = {
	entities: ReadonlyArray<Entity>;
	edges: ReadonlyArray<{ from: string; to: string; relation: Relation }>;
};

export function makeKG(name: string): DemoKG {
	return knowledgeGraph<Entity, Relation>(name);
}

/**
 * Read a coherent { entities, edges } snapshot from a knowledgeGraph()'s nodes.
 * Used by chapters/UI to render the visual KG. Reads `.cache` directly — fine
 * for one-shot reads; subscribe to `kg/entities` + `kg/edges` for reactive UI.
 */
export function readKGSnapshot(kg: DemoKG): KGSnapshot {
	const entities = kg.resolve("entities").cache as ReadonlyMap<string, Entity> | undefined;
	const edges = kg.resolve("edges").cache as
		| ReadonlyArray<{ from: string; to: string; relation: Relation; weight: number }>
		| undefined;
	return {
		entities: entities ? [...entities.values()] : [],
		edges: edges ? edges.map((e) => ({ from: e.from, to: e.to, relation: e.relation })) : [],
	};
}

/**
 * Apply a single extraction result to the KG. Skips relations whose endpoints
 * weren't included in the same extraction (LLMs occasionally emit dangling
 * references).
 */
export function applyExtractionToKG(
	kg: DemoKG,
	result: {
		entities: readonly Entity[];
		relations: readonly { from: string; to: string; relation: Relation }[];
	},
): void {
	const validIds = new Set(result.entities.map((e) => e.id));
	for (const e of result.entities) kg.upsertEntity(e.id, e);
	for (const r of result.relations) {
		if (!validIds.has(r.from) || !validIds.has(r.to)) continue;
		kg.link(r.from, r.to, r.relation);
	}
}

/** Cast a node's cache to the KGSnapshot shape, regardless of subscribe lifecycle. */
export function snapshotFromNodes(
	entitiesNode: Node<unknown>,
	edgesNode: Node<unknown>,
): KGSnapshot {
	const ents = (entitiesNode.cache as ReadonlyMap<string, Entity> | undefined) ?? new Map();
	const eds =
		(edgesNode.cache as
			| ReadonlyArray<{ from: string; to: string; relation: Relation; weight: number }>
			| undefined) ?? [];
	return {
		entities: [...ents.values()],
		edges: eds.map((e) => ({ from: e.from, to: e.to, relation: e.relation })),
	};
}
