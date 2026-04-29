// ---------------------------------------------------------------------------
// agentMemory — sugar over the memoryWith* composers (Unit 7 B).
//
// Thin wiring: distill() builds the core store; optional capabilities delegate
// to the composers in `memory-composers.ts`. Every composer registers its own
// keepalives + disposers on the Graph, so `agentMemory` just passes the graph
// through and exposes the composed bundles on the public `AgentMemoryGraph`.
// ---------------------------------------------------------------------------

import { DATA } from "../../../core/messages.js";
import { placeholderArgs } from "../../../core/meta.js";
import type { Node } from "../../../core/node.js";
import { derived } from "../../../core/sugar.js";
import {
	type DistillBundle,
	type DistillOptions,
	distill,
	type Extraction,
} from "../../../extra/composite.js";
import { switchMap } from "../../../extra/operators.js";
import { fromAny, fromTimer, type NodeInput } from "../../../extra/sources.js";
import { Graph, type GraphOptions } from "../../../graph/graph.js";
import type { KnowledgeGraph, VectorIndexGraph } from "../../memory/index.js";
import type { LLMAdapter } from "../adapters/core/types.js";
import {
	memoryRetrieval,
	memoryWithKG,
	memoryWithTiers,
	memoryWithVectors,
} from "../memory/memory-composers.js";
import type { RetrievalEntry, RetrievalQuery, RetrievalTrace } from "../memory/retrieval.js";
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

export type AgentMemoryGraph<TMem = unknown> = Graph & {
	readonly distillBundle: DistillBundle<TMem>;
	readonly compact: Node<Array<{ key: string; value: TMem; score: number }>>;
	readonly size: Node<number>;
	/** Vector index bundle (null if not enabled). */
	readonly vectors: VectorIndexGraph<TMem> | null;
	/** Knowledge graph (null if not enabled). */
	readonly kg: KnowledgeGraph<unknown, string> | null;
	/** Memory tiers bundle (null if not configured). */
	readonly memoryTiers: MemoryTiersBundle<TMem> | null;
	/** Retrieval result node (null if no retrieval pipeline configured). */
	readonly retrieval: Node<ReadonlyArray<RetrievalEntry<TMem>>> | null;
	/** Latest retrieval trace for observability (null if no retrieval pipeline). */
	readonly retrievalTrace: Node<RetrievalTrace<TMem> | null> | null;
	/**
	 * Execute a retrieval query (null if no retrieval pipeline).
	 *
	 * **Synchronous consumer API** — returns the result immediately and batch-writes
	 * `retrieval` and `retrievalTrace` state nodes for observers. Reads the store
	 * snapshot and context value **at call time** (external-boundary read).
	 *
	 * **Do not call from inside a reactive fn body** (derived fn, subscribe callback,
	 * effect body). The cache reads would become transitive protocol violations and
	 * may observe wave-progressive rather than wave-final state.
	 *
	 * **Caller-batch caveat:** if invoked inside a caller's `batch(() => ...)` alongside
	 * upstream store mutations, the store snapshot reflects what has been committed to
	 * `store.entries.cache` at call time. State-backed stores update cache synchronously
	 * so batched inserts are visible; derived-backed store transforms may defer. If you
	 * need fresh state after batched mutations, call `retrieve` after the batch returns.
	 */
	readonly retrieve: ((query: RetrievalQuery) => ReadonlyArray<RetrievalEntry<TMem>>) | null;
	/**
	 * Reactive sibling of {@link retrieve}. Given a reactive
	 * `RetrievalQuery | null` source, returns a `Node` emitting the packed
	 * retrieval results. Composable with graph topology — subscribe it,
	 * chain it into `promptNode`, or switchMap over a user-input node.
	 * Null when no retrieval pipeline is configured.
	 */
	readonly retrieveReactive:
		| ((queryInput: NodeInput<RetrievalQuery | null>) => Node<ReadonlyArray<RetrievalEntry<TMem>>>)
		| null;
};

/**
 * Pre-wired agentic memory graph. Sugar over `distill` plus the
 * `memoryWithVectors` / `memoryWithKG` / `memoryWithTiers` / `memoryRetrieval`
 * composers. Power users who want a subset of capabilities can call those
 * composers directly; this factory bundles them into one ergonomic call.
 */
export function agentMemory<TMem = unknown>(
	name: string,
	source: NodeInput<unknown>,
	opts: AgentMemoryOptions<TMem>,
): AgentMemoryGraph<TMem> {
	const graph = new Graph(name, opts.graph);
	// Tier 1.5.3 Phase 2.5 (DG1=B): tag the Graph with its constructing
	// factory so `describe()` exposes provenance. Opts contain non-JSON
	// fields (`adapter`, `extractFn`, `embedFn`, `score`, `cost`, `evict`,
	// callbacks, etc.) so route through `placeholderArgs` (DG2=ii).
	graph.tagFactory("agentMemory", placeholderArgs(opts as unknown as Record<string, unknown>));

	// --- Extract function resolution ---
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
	// Tier 1.5.4 — distill's `extractFn` is now reactive (called once with
	// nodes). Adapt the AgentMemoryOptions callback shape via switchMap +
	// closure-mirror for `existing` (COMPOSITION-GUIDE §40 recipe).
	// QA F9: register the closure-mirror's unsub with the host graph so
	// `graph.destroy()` reclaims it — was previously leaked.
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
		graph.addDisposer(unsubExisting);
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
		filteredSource = derived(
			[srcNode],
			([raw]) => {
				if (filter(raw)) return raw;
				return undefined;
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
	if (opts.tiers) {
		const result = memoryWithTiers<unknown, TMem>(graph, filteredSource, extractFn, {
			...opts.tiers,
			score: opts.score,
			cost: opts.cost,
			...(opts.budget !== undefined ? { budget: opts.budget } : { budget: 2000 }),
			...(opts.context !== undefined ? { context: opts.context } : {}),
			...(consolidateFn !== undefined ? { consolidate: consolidateFn } : {}),
			...(consolidateTrigger !== undefined ? { consolidateTrigger } : {}),
		});
		distillBundle = result.store;
		memoryTiersBundle = result.tiers;
	} else {
		distillBundle = distill<unknown, TMem>(filteredSource, extractFn, distillOpts);
	}

	graph.add(distillBundle.store.entries, { name: "store" });
	graph.add(distillBundle.compact, { name: "compact" });
	graph.add(distillBundle.size, { name: "size" });

	// --- Vector index (composer) ---
	let vectors: VectorIndexGraph<TMem> | null = null;
	if (opts.vectorDimensions && opts.vectorDimensions > 0 && opts.embedFn) {
		vectors = memoryWithVectors(graph, distillBundle, {
			dimension: opts.vectorDimensions,
			embedFn: opts.embedFn,
		}).vectors;
	}

	// --- Knowledge graph (composer; inner name "${name}-kg", mounted at "kg") ---
	let kg: KnowledgeGraph<unknown, string> | null = null;
	if (opts.enableKnowledgeGraph) {
		kg = memoryWithKG(graph, distillBundle, name, {
			mountPath: "kg",
			entityFn: opts.entityFn,
		}).kg;
	}

	// --- Retrieval pipeline (composer) ---
	let retrievalNode: Node<ReadonlyArray<RetrievalEntry<TMem>>> | null = null;
	let retrievalTraceNode: Node<RetrievalTrace<TMem> | null> | null = null;
	let retrieveFn: ((query: RetrievalQuery) => ReadonlyArray<RetrievalEntry<TMem>>) | null = null;
	let retrieveReactive:
		| ((queryInput: NodeInput<RetrievalQuery | null>) => Node<ReadonlyArray<RetrievalEntry<TMem>>>)
		| null = null;

	if (vectors || kg) {
		const bundle = memoryRetrieval<TMem>(graph, distillBundle, vectors, kg, {
			score: opts.score,
			cost: opts.cost,
			budget: opts.budget,
			topK: opts.retrieval?.topK,
			graphDepth: opts.retrieval?.graphDepth,
			contextOf: opts.contextOf,
			contextWeight: opts.contextWeight,
			context: opts.context,
		});
		retrievalNode = bundle.retrieval;
		retrievalTraceNode = bundle.retrievalTrace;
		retrieveFn = bundle.retrieve;
		retrieveReactive = bundle.retrieveReactive;
	}

	// Tier 5.1 (deferred 2026-04-29): the `Object.assign(graph, {...})`
	// pattern is preserved here because there are no `instanceof
	// AgentMemoryGraph` consumers in-tree and migrating to a real
	// `class extends Graph` would require moving the factory body into a
	// constructor (substantial, low-ROI). When a future consumer needs
	// `instanceof` narrowing, port to a class — the property shape (above)
	// is already prototype-friendly.
	return Object.assign(graph, {
		distillBundle,
		compact: distillBundle.compact,
		size: distillBundle.size,
		vectors,
		kg,
		memoryTiers: memoryTiersBundle,
		retrieval: retrievalNode,
		retrievalTrace: retrievalTraceNode,
		retrieve: retrieveFn,
		retrieveReactive,
	}) as AgentMemoryGraph<TMem>;
}
