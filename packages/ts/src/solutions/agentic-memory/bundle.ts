import type { Graph } from "../../graph/graph.js";
import { memoryRetrievalBundle } from "../../patterns/semantic-memory-graph.js";
import {
	agenticMemoryContextProjection,
	agenticMemoryProjection,
	agenticMemoryRecordProjection,
} from "./projection.js";
import type { AgenticMemoryBundle, AgenticMemoryBundleOptions } from "./types.js";

/**
 * Creates a lower-level agentic memory projection/retrieval bundle.
 *
 * This bundle does not implement D643 record-use authorization. A governed
 * consumer must compose `agenticMemoryRecordUseGateBundle` first and pass only
 * its `allowedRecords` node as this bundle's `records` input, without a parallel
 * raw-record edge.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category solutions
 * @example
 * ```ts
 * import { agenticMemoryBundle } from "@graphrefly/ts/solutions/agentic-memory";
 * ```
 */
export function agenticMemoryBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryBundleOptions<T>,
): AgenticMemoryBundle<T> {
	const name = opts.name ?? "agenticMemory";
	const projection = agenticMemoryRecordProjection<T>(graph, opts.records, `${name}/projection`);
	const projectedRecords = agenticMemoryProjection(
		graph,
		projection,
		`${name}/records`,
		"agenticMemoryRecords",
		(fact) => fact.records,
	);
	const projectedFragments = agenticMemoryProjection(
		graph,
		projection,
		`${name}/fragments`,
		"agenticMemoryFragments",
		(fact) => fact.fragments,
	);
	const status = agenticMemoryProjection(
		graph,
		projection,
		`${name}/status`,
		"agenticMemoryStatus",
		(fact) => fact.status,
	);
	const errors = agenticMemoryProjection(
		graph,
		projection,
		`${name}/errors`,
		"agenticMemoryErrors",
		(fact) => fact.errors,
	);
	const retrieval = memoryRetrievalBundle<T>(graph, {
		name: `${name}/retrieval`,
		fragments: projectedFragments,
		query: opts.query,
	});
	const sources = agenticMemoryProjection(
		graph,
		projection,
		`${name}/sources`,
		"agenticMemorySources",
		(fact) =>
			Object.freeze(
				fact.fragments.map((fragment) =>
					Object.freeze({
						fragmentId: fragment.id,
						...(fact.metadataByFragmentId[fragment.id] === undefined
							? {}
							: { record: fact.metadataByFragmentId[fragment.id] }),
						sources: Object.freeze([...fragment.sources]),
						...(fragment.parentFragmentId === undefined
							? {}
							: { parentFragmentId: fragment.parentFragmentId }),
						...(fragment.provenance === undefined ? {} : { provenance: fragment.provenance }),
					}),
				),
			),
	);
	const context = agenticMemoryContextProjection(
		graph,
		projection,
		retrieval.snapshot,
		`${name}/context`,
	);

	return {
		input: { records: opts.records, query: opts.query },
		projection,
		retrieval,
		retrievalSnapshot: retrieval.snapshot,
		records: projectedRecords,
		fragments: projectedFragments,
		sources,
		indexed: retrieval.indexed,
		ranked: retrieval.ranked,
		context,
		status,
		errors,
		retrievalStatus: retrieval.status,
		retrievalErrors: retrieval.errors,
		cursor: retrieval.cursor,
	};
}

/**
 * D165 solution-level KG assertion projection.
 *
 * Records and explicit assertion drafts stay visible as declared deps. This
 * bundle validates references and shape, then emits DATA facts only; it does
 * not extract assertions, call LLMs, read/write storage, or mutate topology.
 */
