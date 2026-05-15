// ---------------------------------------------------------------------------
// agentMemory — sugar over the memoryWith* composers (Unit 7 B).
//
// Thin wiring: distill() builds the core store (when no tiers configured);
// optional capabilities delegate to the composer Graph subclasses in
// `memory-composers.ts`. Each composer is a self-contained
// `MemoryWithXxxGraph` that AgentMemoryGraph mounts on itself (Class B
// audit, 2026-04-30) — teardown cascades via `Graph.destroy()`.
//
// **Phase 12.D (2026-04-30):** Migrated from the `Object.assign(graph, ...)`
// factory pattern to `class extends Graph` (mirrors the
// `MemoryWith*Graph` precedent). Required by Phase 13.G `agent(spec)` —
// `AgentBundle.graph: AgentGraph<TIn, TOut>` consumers want `instanceof`
// narrowing on agent-memory subgraphs.
// ---------------------------------------------------------------------------

import { DATA, RESOLVED } from "@graphrefly/pure-ts/core/messages.js";
import { placeholderArgs } from "@graphrefly/pure-ts/core/meta.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { fromAny, fromTimer, type NodeInput, switchMap } from "@graphrefly/pure-ts/extra";
import { Graph, type GraphOptions } from "@graphrefly/pure-ts/graph/graph.js";
import {
	type DistillBundle,
	type DistillOptions,
	distill,
	type Extraction,
} from "../../../extra/composite.js";
import type { KnowledgeGraph, VectorIndexGraph } from "../../memory/index.js";
import type { LLMAdapter } from "../adapters/core/types.js";
import {
	type MemoryWithTiersGraph,
	memoryRetrieval,
	memoryWithKG,
	memoryWithTiers,
	memoryWithVectors,
} from "../memory/memory-composers.js";
import type { RetrievalEntry, RetrievalQuery } from "../memory/retrieval.js";
import type { MemoryTiersBundle, MemoryTiersOptions } from "../memory/tiers.js";
import { llmConsolidator, llmExtractor } from "../prompts/prompt-call.js";

export type AgentMemoryOptions<TMem = unknown> = {
	graph?: GraphOptions;
	/** LLM adapter for extraction and consolidation. */
	adapter?: LLMAdapter;
	/** System prompt for the extractor LLM. */
	extractPrompt?: string;
	/** Custom extractFn (overrides adapter + extractPrompt). */
	extractFn?: (raw: unknown, existing: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>;
	/** System prompt for the consolidation LLM. */
	consolidatePrompt?: string;
	/** Custom consolidateFn (overrides adapter + consolidatePrompt). */
	consolidateFn?: (entries: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>;
	/** Reactive trigger for consolidation (caller supplies e.g. `fromTimer`). */
	consolidateTrigger?: NodeInput<unknown>;
	/** Score function for budget packing (required). */
	score: (mem: TMem, context: unknown) => number;
	/** Cost function for budget packing (required). */
	cost: (mem: TMem) => number;
	/** Token budget for compact view (default 2000). */
	budget?: number;
	/** Context node for scoring. */
	context?: NodeInput<unknown>;
	/** Admission filter (default: admit all). */
	admissionFilter?: (candidate: unknown) => boolean;
	/** Vector index dimensions (> 0 enables vector index for retrieval). */
	vectorDimensions?: number;
	/**
	 * B12: optional accessor for an entry's hierarchical context breadcrumb
	 * (e.g. `["projects", "auth", "tokens"]`). When supplied alongside
	 * `contextWeight > 0`, retrieval applies a score boost for entries whose
	 * context shares a prefix with the query's `context`. Entries without
	 * a breadcrumb are scored flatly.
	 */
	contextOf?: (mem: TMem) => readonly string[] | undefined;
	/**
	 * B12: hierarchical context boost multiplier. Score is scaled by
	 * `(1 + contextWeight * sharedDepth / queryDepth)` when both the query
	 * and entry supply a `context`. Default: 0.
	 */
	contextWeight?: number;

	// --- In-factory composition (new) ---

	/** Extract embedding vector from a memory entry (enables vector index). */
	embedFn?: (mem: TMem) => readonly number[] | undefined;
	/** Enable knowledge graph for entity/relation tracking. */
	enableKnowledgeGraph?: boolean;
	/** Extract entities and relations from a memory entry. */
	entityFn?: (
		key: string,
		mem: TMem,
	) =>
		| {
				entities?: Array<{ id: string; value: unknown }>;
				relations?: Array<{ from: string; to: string; relation: string; weight?: number }>;
		  }
		| undefined;

	/** 3-tier storage configuration. Omit to use single-tier (existing behavior). */
	tiers?: MemoryTiersOptions<TMem>;

	/** Retrieval pipeline configuration. Requires vector index or knowledge graph. */
	retrieval?: {
		/** Max candidates from vector search (default 20). */
		topK?: number;
		/** KG expansion depth in hops (default 1). */
		graphDepth?: number;
	};

	/** Periodic reflection/consolidation configuration. */
	reflection?: {
		/** Interval in ms between consolidation runs (default 300_000 = 5 min). */
		interval?: number;
		/** Enable/disable periodic reflection (default true when consolidateFn is available). */
		enabled?: boolean;
	};
};

/**
 * Pre-wired agentic memory graph. Sugar over `distill` plus the
 * `memoryWithVectors` / `memoryWithKG` / `memoryWithTiers` / `memoryRetrieval`
 * composers. Power users who want a subset of capabilities can call those
 * composers directly; this class bundles them into one ergonomic Graph subclass.
 *
 * Mounts:
 * - `tiers/*`     — present when `opts.tiers` configured (replaces the
 *                   default distill bundle).
 * - `vectors/*`   — present when `opts.vectorDimensions > 0 && opts.embedFn`.
 * - `knowledge/*` — present when `opts.enableKnowledgeGraph`.
 * - `retrieval/*` — present when vectors or kg configured.
 *
 * When `opts.tiers` is omitted, `store` / `compact` / `size` are added as
 * top-level nodes on this graph (visible in `describe()` / `explain()`).
 */
export class AgentMemoryGraph<TMem = unknown> extends Graph {
	readonly distillBundle: DistillBundle<TMem>;
	readonly compact: Node<Array<{ key: string; value: TMem; score: number }>>;
	readonly size: Node<number>;
	/** Vector index bundle (null if not enabled). */
	readonly vectors: VectorIndexGraph<TMem> | null;
	/** Knowledge graph (null if not enabled). */
	readonly kg: KnowledgeGraph<unknown, string> | null;
	/** Memory tiers bundle (null if not configured). */
	readonly memoryTiers: MemoryTiersBundle<TMem> | null;
	/**
	 * The mounted `MemoryWithTiersGraph` subgraph (null when `opts.tiers` was
	 * omitted). Surfaces the inner graph for `describe()` / `explain()` walks
	 * and for callers that need direct access to the tiers subgraph (e.g.
	 * to register additional disposers or attach storage). Companion to
	 * `memoryTiers`, which carries only the bundle's reactive surface (B5e).
	 */
	readonly tiers: MemoryWithTiersGraph<unknown, TMem> | null;
	/**
	 * Reactive consumer API. Given a reactive `RetrievalQuery | null` source,
	 * returns a `Node` emitting the packed retrieval results. Composable with
	 * graph topology — subscribe it, chain it into `promptNode`, or switchMap
	 * over a user-input node.
	 *
	 * Each call mounts its own per-input subgraph at
	 * `retrieval::retrieve_${id}` (via `MemoryRetrievalGraph`); concurrent
	 * calls don't share state mirrors. One-shot consumers wrap with
	 * `awaitSettled(retrieveReactive(query))`.
	 *
	 * Null when no retrieval pipeline is configured.
	 *
	 * **QA F-9 (2026-04-30):** the prior `retrieval` / `retrievalTrace`
	 * shared state-node mirrors have been dropped. Use `retrieveReactive`
	 * for per-call reactive results; one-shot trace consumers should
	 * subscribe to the projection's upstream `result` derived directly
	 * via `view.target.resolve("retrieval::retrieve_${id}::result")`.
	 */
	readonly retrieveReactive:
		| ((queryInput: NodeInput<RetrievalQuery | null>) => Node<ReadonlyArray<RetrievalEntry<TMem>>>)
		| null;

	constructor(name: string, source: NodeInput<unknown>, opts: AgentMemoryOptions<TMem>) {
		super(name, opts.graph);

		// --- Extract function resolution ---
		// /qa A3 (2026-04-30): validate BEFORE tagFactory so an invalid-opts
		// throw doesn't leave a tagged-but-empty Graph instance behind.
		let rawExtractFn: (
			raw: unknown,
			existing: ReadonlyMap<string, TMem>,
		) => NodeInput<Extraction<TMem>>;
		if (opts.extractFn) {
			rawExtractFn = opts.extractFn;
		} else if (opts.adapter && opts.extractPrompt) {
			rawExtractFn = llmExtractor<unknown, TMem>(opts.extractPrompt, { adapter: opts.adapter });
		} else {
			throw new Error("agentMemory: provide either extractFn or adapter + extractPrompt");
		}

		// Tier 1.5.3 Phase 2.5 (DG1=B): tag the Graph with its constructing
		// factory so `describe()` exposes provenance. Opts contain non-JSON
		// fields (`adapter`, `extractFn`, `embedFn`, `score`, `cost`, `evict`,
		// callbacks, etc.) so route through `placeholderArgs` (DG2=ii).
		this.tagFactory("agentMemory", placeholderArgs(opts as unknown as Record<string, unknown>));
		// Tier 1.5.4 — distill's `extractFn` is now reactive (called once with
		// nodes). Adapt the AgentMemoryOptions callback shape via switchMap +
		// closure-mirror for `existing` (COMPOSITION-GUIDE §40 recipe).
		// QA F9: register the closure-mirror's unsub with the host graph so
		// `graph.destroy()` reclaims it — was previously leaked.
		//
		// **Phase 16 attempt (2026-04-29) reverted.** Tried `withLatestFrom(
		// rawNode, existingNode) + switchMap`; this is the WRONG migration per
		// COMPOSITION-GUIDE §28. **Phase 10.5 (same-day partial-flag flip on
		// `withLatestFrom`)** removes the initial-pair drop, but this site stays
		// on closure-mirror form pending Phase 11 restricted signatures. See
		// `archive/docs/SESSION-graph-narrow-waist.md` § "Status of existing
		// modifications" + § "Phase 10.5".
		const extractFn = (
			rawNode: Node<unknown>,
			existingNode: Node<ReadonlyMap<string, TMem>>,
		): NodeInput<Extraction<TMem>> => {
			let latestExisting: ReadonlyMap<string, TMem> =
				(existingNode.cache as ReadonlyMap<string, TMem> | undefined) ?? new Map();
			const unsubExisting = existingNode.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) latestExisting = m[1] as ReadonlyMap<string, TMem>;
				}
			});
			this.addDisposer(unsubExisting);
			return switchMap(rawNode, (raw) => {
				if (raw == null) return { upsert: [] };
				return rawExtractFn(raw, latestExisting);
			});
		};

		// --- Admission filter ---
		let filteredSource = source;
		if (opts.admissionFilter) {
			const srcNode = fromAny(source);
			const filter = opts.admissionFilter;
			filteredSource = node(
				[srcNode],
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					const raw = data[0];
					if (filter(raw)) {
						actions.emit(raw);
					} else {
						// EC1 (qa 2026-04-30): emitting `undefined` would violate spec §5.12
						// (undefined is the protocol SENTINEL — TopicGraph.publish even
						// throws on it). Downstream `batch.at(-1) : ctx.prevData[i]`
						// would also resolve `undefined` back to the prior accepted
						// value, leaking past-the-filter. Emit a tier-3 RESOLVED so the
						// wave settles cleanly without surfacing a stale DATA.
						actions.down([[RESOLVED]]);
					}
				},
				{ name: "admissionFilter", describeKind: "derived" },
			);
		}

		// --- Consolidation ---
		let consolidateFn:
			| ((entries: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>)
			| undefined;
		if (opts.consolidateFn) {
			consolidateFn = opts.consolidateFn;
		} else if (opts.adapter && opts.consolidatePrompt) {
			consolidateFn = llmConsolidator<TMem>(opts.consolidatePrompt, { adapter: opts.adapter });
		}

		// --- Reflection: default consolidateTrigger from fromTimer ---
		let consolidateTrigger = opts.consolidateTrigger;
		if (!consolidateTrigger && consolidateFn && opts.reflection?.enabled !== false) {
			const interval = opts.reflection?.interval ?? 300_000;
			consolidateTrigger = fromTimer(interval, { period: interval });
		}

		// --- Build distill bundle (the core) ---
		// Tier 4.1 B (2026-04-29): when tiers are configured, `memoryWithTiers`
		// is the construction site for the distill bundle so it can wire
		// `reactiveMap.retention` into the store at construction (no §7 cycle).
		// When tiers are NOT configured, agentMemory calls `distill` directly.
		const distillOpts: DistillOptions<TMem> = {
			score: opts.score,
			cost: opts.cost,
			budget: opts.budget ?? 2000,
			context: opts.context,
			consolidate: consolidateFn,
			consolidateTrigger,
		};

		let distillBundle: DistillBundle<TMem>;
		let memoryTiersBundle: MemoryTiersBundle<TMem> | null = null;
		let tiersSubgraph: MemoryWithTiersGraph<unknown, TMem> | null = null;
		if (opts.tiers) {
			const tiersGraph = memoryWithTiers<unknown, TMem>({
				// User customization first; canonical agent-memory-level overrides
				// last so they always win even if `MemoryTiersOptions` later adds
				// any of the same keys.
				...opts.tiers,
				name: "tiers",
				source: filteredSource,
				extractFn,
				score: opts.score,
				cost: opts.cost,
				...(opts.budget !== undefined ? { budget: opts.budget } : { budget: 2000 }),
				...(opts.context !== undefined ? { context: opts.context } : {}),
				...(consolidateFn !== undefined ? { consolidate: consolidateFn } : {}),
				...(consolidateTrigger !== undefined ? { consolidateTrigger } : {}),
			});
			this.mount("tiers", tiersGraph);
			distillBundle = tiersGraph.store;
			memoryTiersBundle = tiersGraph.tiers;
			tiersSubgraph = tiersGraph;
		} else {
			distillBundle = distill<unknown, TMem>(filteredSource, extractFn, distillOpts);
			this.add(distillBundle.store.entries, { name: "store" });
			this.add(distillBundle.compact, { name: "compact" });
			this.add(distillBundle.size, { name: "size" });
		}

		// --- Vector index (composer) ---
		let vectors: VectorIndexGraph<TMem> | null = null;
		if (opts.vectorDimensions && opts.vectorDimensions > 0 && opts.embedFn) {
			const vectorsGraph = memoryWithVectors<TMem>({
				name: "vectors",
				store: distillBundle,
				dimension: opts.vectorDimensions,
				embedFn: opts.embedFn,
			});
			this.mount("vectors", vectorsGraph);
			vectors = vectorsGraph.vectors;
		}

		// --- Knowledge graph (composer) ---
		let kg: KnowledgeGraph<unknown, string> | null = null;
		if (opts.enableKnowledgeGraph) {
			const kgGraph = memoryWithKG<TMem>({
				name: "knowledge",
				store: distillBundle,
				kgName: `${name}-kg`,
				mountPath: "knowledge-kg",
				...(opts.entityFn !== undefined ? { entityFn: opts.entityFn } : {}),
			});
			this.mount("knowledge", kgGraph);
			kg = kgGraph.kg;
		}

		// --- Retrieval pipeline (composer) ---
		let retrieveReactive:
			| ((
					queryInput: NodeInput<RetrievalQuery | null>,
			  ) => Node<ReadonlyArray<RetrievalEntry<TMem>>>)
			| null = null;

		if (vectors || kg) {
			const retrievalGraph = memoryRetrieval<TMem>({
				name: "retrieval",
				store: distillBundle,
				vectors,
				kg,
				score: opts.score,
				cost: opts.cost,
				...(opts.budget !== undefined ? { budget: opts.budget } : {}),
				...(opts.retrieval?.topK !== undefined ? { topK: opts.retrieval.topK } : {}),
				...(opts.retrieval?.graphDepth !== undefined
					? { graphDepth: opts.retrieval.graphDepth }
					: {}),
				...(opts.contextOf !== undefined ? { contextOf: opts.contextOf } : {}),
				...(opts.contextWeight !== undefined ? { contextWeight: opts.contextWeight } : {}),
				...(opts.context !== undefined ? { context: opts.context } : {}),
			});
			this.mount("retrieval", retrievalGraph);
			retrieveReactive = retrievalGraph.retrieveReactive.bind(retrievalGraph);
		}

		this.distillBundle = distillBundle;
		this.compact = distillBundle.compact;
		this.size = distillBundle.size;
		this.vectors = vectors;
		this.kg = kg;
		this.memoryTiers = memoryTiersBundle;
		this.tiers = tiersSubgraph;
		this.retrieveReactive = retrieveReactive;
	}
}

/**
 * Pre-wired agentic memory graph. Sugar over `distill` plus the
 * `memoryWithVectors` / `memoryWithKG` / `memoryWithTiers` / `memoryRetrieval`
 * composers. Power users who want a subset of capabilities can call those
 * composers directly; this factory bundles them into one ergonomic call.
 *
 * Returns an {@link AgentMemoryGraph} subclass instance — `instanceof
 * AgentMemoryGraph` narrows in callers (e.g. Phase 13.G `agent(spec)`).
 */
export function agentMemory<TMem = unknown>(
	name: string,
	source: NodeInput<unknown>,
	opts: AgentMemoryOptions<TMem>,
): AgentMemoryGraph<TMem> {
	return new AgentMemoryGraph<TMem>(name, source, opts);
}
