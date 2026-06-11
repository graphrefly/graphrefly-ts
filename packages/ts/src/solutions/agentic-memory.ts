/**
 * Thin agentic-memory solution surface.
 *
 * D125 places vertical application kits under solutions, while D158 keeps
 * semantic-memory retrieval/ranking in horizontal patterns. This v0 bundle
 * composes those lower layers into graph-visible facts only: no agent runtime,
 * hidden scheduler, storage restore/hydration, LLM loop, or protocol behavior.
 */

import { depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { FactId, MemoryAnswer, MemoryFragment } from "../patterns/semantic-memory.js";
import {
	type MemoryRetrievalBundle,
	type MemoryRetrievalCursor,
	type MemoryRetrievalError,
	type MemoryRetrievalIndex,
	type MemoryRetrievalQuery,
	type MemoryRetrievalSnapshot,
	type MemoryRetrievalStatus,
	memoryRetrievalBundle,
} from "../patterns/semantic-memory-graph.js";

/** Source/provenance projection for a valid memory fragment. */
export interface AgenticMemorySourceProjection {
	readonly fragmentId: FactId;
	readonly sources: readonly FactId[];
	readonly parentFragmentId?: FactId;
	readonly provenance?: string;
}

/** A context-ready item derived from ranked memory retrieval results. */
export interface AgenticMemoryContextEntry<T = unknown> {
	readonly fragmentId: FactId;
	readonly payload: T;
	readonly confidence: number;
	readonly tags: readonly string[];
	readonly sources: readonly FactId[];
	readonly fragment: MemoryFragment<T>;
}

export type AgenticMemoryContextState = "ready" | "empty" | "partial" | "error";

/**
 * Context-ready ranked memory output for callers such as prompt builders.
 *
 * This is still only a DATA fact. It does not extract, summarize, reflect, run
 * tools, or choose an autonomous action.
 */
export interface AgenticMemoryContext<T = unknown> {
	readonly state: AgenticMemoryContextState;
	readonly query: MemoryRetrievalQuery;
	readonly entries: readonly AgenticMemoryContextEntry<T>[];
	readonly cursor: MemoryRetrievalCursor;
	readonly errors: readonly MemoryRetrievalError[];
	readonly contextReady: boolean;
}

export interface AgenticMemoryBundle<T = unknown> {
	readonly input: {
		readonly fragments: Node<readonly unknown[]>;
		readonly query: Node<MemoryRetrievalQuery>;
	};
	readonly retrieval: MemoryRetrievalBundle<T>;
	readonly retrievalSnapshot: Node<MemoryRetrievalSnapshot<T>>;
	readonly fragments: Node<readonly MemoryFragment<T>[]>;
	readonly sources: Node<readonly AgenticMemorySourceProjection[]>;
	readonly indexed: Node<MemoryRetrievalIndex<T>>;
	readonly ranked: Node<MemoryAnswer<T>>;
	readonly context: Node<AgenticMemoryContext<T>>;
	readonly status: Node<MemoryRetrievalStatus>;
	readonly errors: Node<readonly MemoryRetrievalError[]>;
	readonly cursor: Node<MemoryRetrievalCursor>;
}

export interface AgenticMemoryBundleOptions {
	readonly name?: string;
	/** Explicit fragment input. Persistence, if needed, composes D161 outside this v0 bundle. */
	readonly fragments: Node<readonly unknown[]>;
	/** Explicit retrieval query input. */
	readonly query: Node<MemoryRetrievalQuery>;
}

/**
 * Compose graph-visible semantic-memory retrieval into an agentic-memory v0 bundle.
 *
 * The returned nodes are ordinary graph nodes with declared deps and DATA facts.
 * Invalid fragments, duplicate ids, and invalid queries stay graph-visible via
 * the reused retrieval status/errors projections.
 */
export function agenticMemoryBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryBundleOptions,
): AgenticMemoryBundle<T> {
	const name = opts.name ?? "agenticMemory";
	const retrieval = memoryRetrievalBundle<T>(graph, {
		name: `${name}/retrieval`,
		fragments: opts.fragments,
		query: opts.query,
	});
	const sources = agenticMemoryProjection(
		graph,
		retrieval.snapshot,
		`${name}/sources`,
		"agenticMemorySources",
		(fact) =>
			Object.freeze(
				fact.fragments.map((fragment) =>
					Object.freeze({
						fragmentId: fragment.id,
						sources: Object.freeze([...fragment.sources]),
						...(fragment.parentFragmentId === undefined
							? {}
							: { parentFragmentId: fragment.parentFragmentId }),
						...(fragment.provenance === undefined ? {} : { provenance: fragment.provenance }),
					}),
				),
			),
	);
	const context = agenticMemoryProjection(
		graph,
		retrieval.snapshot,
		`${name}/context`,
		"agenticMemoryContext",
		(fact) => contextFromSnapshot(fact),
	);

	return {
		input: retrieval.input,
		retrieval,
		retrievalSnapshot: retrieval.snapshot,
		fragments: retrieval.fragments,
		sources,
		indexed: retrieval.indexed,
		ranked: retrieval.ranked,
		context,
		status: retrieval.status,
		errors: retrieval.errors,
		cursor: retrieval.cursor,
	};
}

function agenticMemoryProjection<TFact, T>(
	graph: Graph,
	snapshot: Node<MemoryRetrievalSnapshot<T>>,
	name: string,
	factory: string,
	select: (fact: MemoryRetrievalSnapshot<T>) => TFact,
): Node<TFact> {
	return graph.node<TFact>(
		[snapshot],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				ctx.down([["DATA", select(raw as MemoryRetrievalSnapshot<T>)]]);
			}
		},
		{
			name,
			factory,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function contextFromSnapshot<T>(fact: MemoryRetrievalSnapshot<T>): AgenticMemoryContext<T> {
	const entries = fact.ranked.results.map((fragment) =>
		Object.freeze({
			fragmentId: fragment.id,
			payload: fragment.payload,
			confidence: fragment.confidence,
			tags: fragment.tags,
			sources: fragment.sources,
			fragment,
		}),
	);
	const hasContext = entries.length > 0;
	return Object.freeze({
		state: fact.status.state,
		query: fact.ranked.query,
		entries: Object.freeze(entries),
		cursor: fact.cursor,
		errors: fact.errors,
		contextReady: hasContext && (fact.status.state === "ready" || fact.status.state === "partial"),
	});
}
