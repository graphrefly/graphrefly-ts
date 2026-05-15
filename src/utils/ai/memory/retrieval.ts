// ---------------------------------------------------------------------------
// Retrieval Pipeline
// ---------------------------------------------------------------------------

import type { VectorSearchResult } from "../../memory/index.js";

export type RetrievalQuery = {
	readonly text?: string;
	readonly vector?: readonly number[];
	readonly entityIds?: readonly string[];
	/**
	 * Optional hierarchical context breadcrumb — e.g.
	 * `["projects", "auth", "tokens"]`. When both the query and a candidate
	 * entry supply a `context`, the retrieval pipeline applies a score boost
	 * proportional to `contextWeight` for entries whose context overlaps
	 * (shared prefix). Entries or queries without `context` are scored
	 * flatly (backward-compatible).
	 */
	readonly context?: readonly string[];
};

export type RetrievalPipelineOptions<TMem> = {
	/** Max candidates from vector search (default 20). */
	topK?: number;
	/** KG expansion depth in hops (default 1). */
	graphDepth?: number;
	/** Token budget for final packing (default 2000). */
	budget?: number;
	/** Cost function for budget packing. */
	cost: (mem: TMem) => number;
	/** Score function for ranking. */
	score: (mem: TMem, context: unknown) => number;
	/**
	 * Optional accessor: extracts the hierarchical context breadcrumb from a
	 * memory entry. Used with {@link RetrievalQuery.context} and
	 * `contextWeight` to boost entries whose context overlaps the query.
	 * Entries that don't expose context stay at flat behavior.
	 */
	contextOf?: (mem: TMem) => readonly string[] | undefined;
	/**
	 * Boost multiplier applied to a candidate's score when its `context`
	 * shares a prefix with the query's `context`. Score is multiplied by
	 * `(1 + contextWeight * sharedDepth / queryDepth)`. Default: 0 (no
	 * context boost).
	 */
	contextWeight?: number;
};

/** A single entry in the retrieval result, with causal trace metadata. */
export type RetrievalEntry<TMem> = {
	readonly key: string;
	readonly value: TMem;
	readonly score: number;
	readonly sources: ReadonlyArray<"vector" | "graph" | "store">;
	/**
	 * Hierarchical context breadcrumb for this entry, when
	 * `RetrievalPipelineOptions.contextOf` is supplied and returns a value.
	 */
	readonly context?: readonly string[];
};

/** Causal trace for a retrieval run. */
export type RetrievalTrace<TMem> = {
	readonly vectorCandidates: ReadonlyArray<VectorSearchResult<TMem>>;
	readonly graphExpanded: ReadonlyArray<string>;
	readonly ranked: ReadonlyArray<RetrievalEntry<TMem>>;
	readonly packed: ReadonlyArray<RetrievalEntry<TMem>>;
};
