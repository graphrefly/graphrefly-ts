// ---------------------------------------------------------------------------
// agentMemory
// ---------------------------------------------------------------------------

import { batch } from "../../../core/batch.js";
import { monotonicNs } from "../../../core/clock.js";
import type { Node } from "../../../core/node.js";
import { derived, effect, state } from "../../../core/sugar.js";
import {
	type DistillBundle,
	type DistillOptions,
	distill,
	type Extraction,
} from "../../../extra/composite.js";
import { fromAny, fromTimer, type NodeInput } from "../../../extra/sources.js";
import type { StorageHandle } from "../../../extra/storage-core.js";
import { Graph, type GraphOptions } from "../../../graph/graph.js";
import {
	decay,
	type KnowledgeGraphGraph,
	knowledgeGraph,
	lightCollection,
	type VectorIndexBundle,
	type VectorSearchResult,
	vectorIndex,
} from "../../memory/index.js";
import { aiMeta } from "../_internal.js";
import type { LLMAdapter } from "../adapters/core/types.js";
import { llmConsolidator, llmExtractor } from "./llm-memory.js";
import type { RetrievalEntry, RetrievalQuery, RetrievalTrace } from "./retrieval.js";
import {
	DEFAULT_DECAY_RATE,
	type MemoryTier,
	type MemoryTiersBundle,
	type MemoryTiersOptions,
} from "./tiers.js";

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
	readonly vectors: VectorIndexBundle<TMem> | null;
	/** Knowledge graph (null if not enabled). */
	readonly kg: KnowledgeGraphGraph<unknown, string> | null;
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
 * Pre-wired agentic memory graph. Composes `distill()` with optional
 * `knowledgeGraph()`, `vectorIndex()`, `lightCollection()` (permanent tier),
 * `decay()`, and `attachStorage()` (archive tier). Supports 3D admission
 * scoring, a default retrieval pipeline, periodic reflection, and
 * retrieval observability traces.
 */

/** Extract the key→value map from a reactive_map snapshot. */
function extractStoreMap<TMem>(snapshot: unknown): ReadonlyMap<string, TMem> {
	if (snapshot instanceof Map) return snapshot as ReadonlyMap<string, TMem>;
	return new Map<string, TMem>();
}

export function agentMemory<TMem = unknown>(
	name: string,
	source: NodeInput<unknown>,
	opts: AgentMemoryOptions<TMem>,
): AgentMemoryGraph<TMem> {
	const graph = new Graph(name, opts.graph);
	const keepaliveSubs: Array<() => void> = [];

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
	const extractFn = (
		raw: unknown,
		existing: ReadonlyMap<string, TMem>,
	): NodeInput<Extraction<TMem>> => {
		if (raw == null) return { upsert: [] };
		return rawExtractFn(raw, existing);
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

	// --- Build distill bundle ---
	const distillOpts: DistillOptions<TMem> = {
		score: opts.score,
		cost: opts.cost,
		budget: opts.budget ?? 2000,
		context: opts.context,
		consolidate: consolidateFn,
		consolidateTrigger,
	};
	const distillBundle = distill<unknown, TMem>(filteredSource, extractFn, distillOpts);

	graph.add(distillBundle.store.entries, { name: "store" });
	graph.add(distillBundle.compact, { name: "compact" });
	graph.add(distillBundle.size, { name: "size" });

	// --- Vector index (optional) ---
	let vectors: VectorIndexBundle<TMem> | null = null;
	if (opts.vectorDimensions && opts.vectorDimensions > 0 && opts.embedFn) {
		vectors = vectorIndex<TMem>({ dimension: opts.vectorDimensions });
		graph.add(vectors.entries, { name: "vectorIndex" });
	}

	// --- Knowledge graph (optional) ---
	let kg: KnowledgeGraphGraph<unknown, string> | null = null;
	if (opts.enableKnowledgeGraph) {
		kg = knowledgeGraph<unknown, string>(`${name}-kg`);
		graph.mount("kg", kg);
	}

	// --- 3-tier storage (optional) ---
	let memoryTiersBundle: MemoryTiersBundle<TMem> | null = null;
	if (opts.tiers) {
		const tiersOpts = opts.tiers;
		const decayRate = tiersOpts.decayRate ?? DEFAULT_DECAY_RATE;
		const maxActive = tiersOpts.maxActive ?? 1000;
		const archiveThreshold = tiersOpts.archiveThreshold ?? 0.1;
		const permanentFilter = tiersOpts.permanentFilter ?? (() => false);

		// Permanent tier
		const permanent = lightCollection<TMem>({ name: "permanent" });
		graph.add(permanent.entries, { name: "permanent" });

		// Track which keys are permanent
		const permanentKeys = new Set<string>();

		const tierOf = (key: string): MemoryTier => {
			if (permanentKeys.has(key)) return "permanent";
			const storeMap = extractStoreMap<TMem>(distillBundle.store.entries.cache);
			if (storeMap.has(key)) return "active";
			return "archived";
		};

		const markPermanent = (key: string, value: TMem): void => {
			permanentKeys.add(key);
			permanent.upsert(key, value);
		};

		// Track entry creation times for accurate decay age calculation
		const entryCreatedAtNs = new Map<string, number>();

		// Post-extraction hook: classify into tiers and archive low-scored entries
		const storeNode = distillBundle.store.entries;
		const contextNode = opts.context ? fromAny(opts.context) : state<unknown>(null);
		const tierClassifier = effect([storeNode, contextNode], ([snapshot, ctx]) => {
			const storeMap = extractStoreMap<TMem>(snapshot);
			const nowNs = monotonicNs();
			const toArchive: string[] = [];
			const toPermanent: Array<{ key: string; value: TMem }> = [];

			for (const [key, mem] of storeMap) {
				// Track creation time for new entries
				if (!entryCreatedAtNs.has(key)) {
					entryCreatedAtNs.set(key, nowNs);
				}

				// Check permanent classification
				if (permanentFilter(key, mem)) {
					toPermanent.push({ key, value: mem });
					continue;
				}
				// Compute decayed score for active tier
				const baseScore = opts.score(mem, ctx);
				const createdNs = entryCreatedAtNs.get(key) ?? nowNs;
				const ageSeconds = Number(nowNs - createdNs) / 1e9;
				const decayed = decay(baseScore, ageSeconds, decayRate);
				if (decayed < archiveThreshold) {
					toArchive.push(key);
				}
			}

			// Clean up creation times for removed entries
			for (const key of entryCreatedAtNs.keys()) {
				if (!storeMap.has(key)) entryCreatedAtNs.delete(key);
			}

			// Move to permanent
			for (const { key, value } of toPermanent) {
				if (!permanentKeys.has(key)) {
					markPermanent(key, value);
				}
			}

			// Archive and evict from active (respect maxActive, excluding permanent keys)
			const activeCount = storeMap.size - permanentKeys.size;
			if (activeCount > maxActive) {
				const scored = [...storeMap.entries()]
					.filter(([k]) => !permanentKeys.has(k))
					.map(([k, m]) => ({ key: k, score: opts.score(m, ctx) }))
					.sort((a, b) => a.score - b.score);
				const excess = activeCount - maxActive;
				for (let i = 0; i < excess && i < scored.length; i++) {
					const sk = scored[i]!.key;
					if (!toArchive.includes(sk)) toArchive.push(sk);
				}
			}

			// Evict archived keys from active store
			if (toArchive.length > 0) {
				batch(() => {
					for (const key of toArchive) {
						distillBundle.store.delete(key);
					}
				});
			}
		});
		keepaliveSubs.push(tierClassifier.subscribe(() => undefined));

		// Archive checkpoint
		let archiveHandle: StorageHandle | null = null;
		if (tiersOpts.archiveTier) {
			archiveHandle = graph.attachStorage(
				[tiersOpts.archiveTier],
				tiersOpts.archiveStorageOptions ?? {},
			);
		}

		memoryTiersBundle = {
			permanent,
			activeEntries: storeNode,
			archiveHandle,
			tierOf,
			markPermanent,
		};
	}

	// --- Post-extraction hooks: vector + KG indexing ---
	if (vectors || kg) {
		const embedFn = opts.embedFn;
		const entityFn = opts.entityFn;
		const storeNode = distillBundle.store.entries;

		const indexer = effect([storeNode], ([snapshot]) => {
			const storeMap = extractStoreMap<TMem>(snapshot);
			for (const [key, mem] of storeMap) {
				// Vector indexing
				if (vectors && embedFn) {
					const vec = embedFn(mem);
					if (vec) vectors.upsert(key, vec, mem);
				}
				// Knowledge graph entity/relation extraction
				if (kg && entityFn) {
					const extracted = entityFn(key, mem);
					if (extracted) {
						for (const ent of extracted.entities ?? []) {
							kg.upsertEntity(ent.id, ent.value);
						}
						for (const rel of extracted.relations ?? []) {
							kg.link(rel.from, rel.to, rel.relation as string, rel.weight);
						}
					}
				}
			}
		});
		keepaliveSubs.push(indexer.subscribe(() => undefined));
	}

	// --- Retrieval pipeline (optional) ---
	let retrievalNode: Node<ReadonlyArray<RetrievalEntry<TMem>>> | null = null;
	let retrievalTraceNode: Node<RetrievalTrace<TMem> | null> | null = null;
	let retrieveFn: ((query: RetrievalQuery) => ReadonlyArray<RetrievalEntry<TMem>>) | null = null;
	let retrieveReactive:
		| ((queryInput: NodeInput<RetrievalQuery | null>) => Node<ReadonlyArray<RetrievalEntry<TMem>>>)
		| null = null;

	if (vectors || kg) {
		const topK = opts.retrieval?.topK ?? 20;
		const graphDepth = opts.retrieval?.graphDepth ?? 1;
		const budget = opts.budget ?? 2000;
		const costFn = opts.cost;
		const scoreFn = opts.score;
		const contextOfFn = opts.contextOf;
		const contextWeight = opts.contextWeight ?? 0;

		const contextNode = opts.context ? fromAny(opts.context) : state<unknown>(null);

		// B12: shared prefix depth between a query context and an entry context.
		// Returns 0 when either side is missing or no prefix is shared.
		const sharedPrefixDepth = (
			q: readonly string[] | undefined,
			e: readonly string[] | undefined,
		): number => {
			if (!q || !e) return 0;
			const n = Math.min(q.length, e.length);
			let i = 0;
			while (i < n && q[i] === e[i]) i++;
			return i;
		};

		// Core retrieval pipeline, reused by both the imperative `retrieve()`
		// and the reactive `retrieveReactive()` sibling.
		const runRetrieval = (
			storeMap: ReadonlyMap<string, TMem>,
			ctx: unknown,
			query: RetrievalQuery,
		): { packed: RetrievalEntry<TMem>[]; trace: RetrievalTrace<TMem> } => {
			const candidateMap = new Map<
				string,
				{ value: TMem; sources: Set<"vector" | "graph" | "store"> }
			>();

			let vectorCandidates: VectorSearchResult<TMem>[] = [];
			if (vectors && query.vector) {
				vectorCandidates = vectors.search(query.vector, topK) as VectorSearchResult<TMem>[];
				for (const vc of vectorCandidates) {
					const mem = storeMap.get(vc.id);
					if (mem) candidateMap.set(vc.id, { value: mem, sources: new Set(["vector"]) });
				}
			}

			const graphExpanded: string[] = [];
			if (kg) {
				const seedIds = [...(query.entityIds ?? []), ...[...candidateMap.keys()]];
				const visited = new Set<string>();
				let frontier = seedIds;
				for (let depth = 0; depth < graphDepth; depth++) {
					const nextFrontier: string[] = [];
					for (const id of frontier) {
						if (visited.has(id)) continue;
						visited.add(id);
						const related = kg.related(id);
						for (const edge of related) {
							const targetId = edge.to;
							if (!visited.has(targetId)) {
								nextFrontier.push(targetId);
								const mem = storeMap.get(targetId);
								if (mem) {
									const existing = candidateMap.get(targetId);
									if (existing) existing.sources.add("graph");
									else candidateMap.set(targetId, { value: mem, sources: new Set(["graph"]) });
									graphExpanded.push(targetId);
								}
							}
						}
					}
					frontier = nextFrontier;
				}
			}
			for (const [key, mem] of storeMap) {
				if (!candidateMap.has(key)) {
					candidateMap.set(key, { value: mem, sources: new Set(["store"]) });
				}
			}

			const qDepth = query.context?.length ?? 0;
			const ranked: RetrievalEntry<TMem>[] = [];
			for (const [key, { value, sources }] of candidateMap) {
				const entryContext = contextOfFn ? contextOfFn(value) : undefined;
				let score = scoreFn(value, ctx);
				// B12: hierarchical context boost.
				if (contextWeight > 0 && qDepth > 0) {
					const shared = sharedPrefixDepth(query.context, entryContext);
					if (shared > 0) score = score * (1 + (contextWeight * shared) / qDepth);
				}
				const entry: RetrievalEntry<TMem> = entryContext
					? { key, value, score, sources: [...sources], context: entryContext }
					: { key, value, score, sources: [...sources] };
				ranked.push(entry);
			}
			ranked.sort((a, b) => b.score - a.score);

			const packed: RetrievalEntry<TMem>[] = [];
			let usedBudget = 0;
			for (const entry of ranked) {
				const c = costFn(entry.value);
				if (usedBudget + c > budget && packed.length > 0) break;
				packed.push(entry);
				usedBudget += c;
			}

			const trace: RetrievalTrace<TMem> = {
				vectorCandidates,
				graphExpanded,
				ranked,
				packed,
			};
			return { packed, trace };
		};

		// Observer-facing state nodes. `retrieve()` writes both in a batch on every call.
		// (Option W from the 2026-04-12 P3 audit — retrieveFn is a sync consumer API that
		// reads store/context at call time, computes inline, and publishes results via
		// state writes. No derived, no queryInput, no closure side-channel.)
		//
		// QA-fix (Bonus dedup): packed array reference-identity equals isn't useful here
		// because `runRetrieval` allocates a new array per call. Compare element-wise
		// reference equality so subscribers don't wake up when the SAME entries land
		// in the SAME order (e.g. repeated identical queries from the reactive surface).
		const packedEquals = <T>(a: readonly T[], b: readonly T[]): boolean => {
			if (a === b) return true;
			if (a.length !== b.length) return false;
			for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
			return true;
		};
		const retrievalOutput = state<ReadonlyArray<RetrievalEntry<TMem>>>([], {
			name: "retrieval",
			describeKind: "state",
			meta: aiMeta("retrieval_pipeline"),
			equals: packedEquals,
		});
		graph.add(retrievalOutput, { name: "retrieval" });
		retrievalNode = retrievalOutput;

		const traceState = state<RetrievalTrace<TMem> | null>(null, {
			name: "retrievalTrace",
			describeKind: "state",
			meta: aiMeta("retrieval_trace"),
		});
		graph.add(traceState, { name: "retrievalTrace" });
		retrievalTraceNode = traceState;

		// Sync consumer API. Reads `store.entries.cache` and `contextNode.cache` at
		// call time — these are external-boundary reads, allowed per the foundation
		// redesign. **Do not call from inside a reactive fn body**: the cache reads
		// would become transitive P3 violations. See `retrieveReactive()` for a
		// reactive sibling that's safe to subscribe to from graph topology.
		retrieveFn = (query: RetrievalQuery): ReadonlyArray<RetrievalEntry<TMem>> => {
			const storeMap = extractStoreMap<TMem>(distillBundle.store.entries.cache);
			const { packed, trace } = runRetrieval(storeMap, contextNode.cache, query);
			batch(() => {
				retrievalOutput.emit(packed);
				traceState.emit(trace);
			});
			return packed;
		};

		// B20: reactive sibling. Subscribe-driven retrieval — when `queryNode`
		// emits a new `RetrievalQuery`, the returned node emits the packed
		// results. Composable with graph topology (e.g. `switchMap` on a user
		// input node, or chaining into a `promptNode`).
		//
		// **Unit 7 Q4 mirror (QA-revised):** the reactive recompute splits into
		// (a) a pure `result` derived computing `{packed, trace}`, (b) the
		// caller-facing `packed` projection, and (c) a co-mounted `mirror`
		// effect that writes the observability state nodes (`retrieval` +
		// `retrievalTrace`). Splitting the writes into a sibling effect keeps
		// the topology visible — `describe()` shows `mirror` as a real edge
		// from `result` instead of an invisible imperative emit hidden inside
		// a derived fn body. Matches §32 state-mirror, not §28 (which is
		// factory-time *reads*, not writes).
		const retrieveReactiveFn = (
			queryInput: NodeInput<RetrievalQuery | null>,
		): Node<ReadonlyArray<RetrievalEntry<TMem>>> => {
			const q = fromAny(queryInput);
			const result = derived<{
				packed: ReadonlyArray<RetrievalEntry<TMem>>;
				trace: RetrievalTrace<TMem> | null;
			}>(
				[distillBundle.store.entries, contextNode, q],
				([snapshot, ctx, query]) => {
					if (query == null) return { packed: [], trace: null };
					const storeMap = extractStoreMap<TMem>(snapshot);
					const { packed, trace } = runRetrieval(storeMap, ctx, query as RetrievalQuery);
					return { packed, trace };
				},
				{
					name: "retrievalReactive::result",
					describeKind: "derived",
					meta: aiMeta("retrieval_reactive_result"),
					initial: { packed: [] as ReadonlyArray<RetrievalEntry<TMem>>, trace: null },
				},
			);
			// Mirror effect — writes self-owned observability state. Visible
			// in `describe()` as a `result → mirror` edge; the underlying state
			// emits dedup via their `equals` (packedEquals + Object.is for trace).
			const mirror = effect([result], ([r]) => {
				const v = r as {
					packed: ReadonlyArray<RetrievalEntry<TMem>>;
					trace: RetrievalTrace<TMem> | null;
				};
				batch(() => {
					retrievalOutput.emit(v.packed);
					if (v.trace) traceState.emit(v.trace);
				});
			});
			keepaliveSubs.push(mirror.subscribe(() => undefined));
			// Caller-facing packed-only projection. Reference-equality dedup
			// matches `retrievalOutput`'s state contract.
			return derived<ReadonlyArray<RetrievalEntry<TMem>>>(
				[result],
				([r]) => (r as { packed: ReadonlyArray<RetrievalEntry<TMem>> }).packed,
				{
					name: "retrievalReactive",
					describeKind: "derived",
					meta: aiMeta("retrieval_reactive"),
					initial: [] as ReadonlyArray<RetrievalEntry<TMem>>,
					equals: packedEquals,
				},
			);
		};
		retrieveReactive = retrieveReactiveFn;
	}

	// --- Cleanup ---
	graph.addDisposer(() => {
		for (const unsub of keepaliveSubs) unsub();
		keepaliveSubs.length = 0;
	});

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
