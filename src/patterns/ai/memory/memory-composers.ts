// ---------------------------------------------------------------------------
// memory composers — Unit 7 C-factoring (2026-04-23 doc decision).
//
// Each composer attaches one capability (vectors, KG, tiers, retrieval) to a
// `DistillBundle`. `agentMemory` continues to ship as the ergonomic sugar
// over the full pipeline; power users who want a subset call these factories
// directly. The composers are additive — they do not duplicate the wiring
// inside `agentMemory`; both surfaces are valid entry points.
//
// Closure-state promotion (`permanentKeys`, `entryCreatedAtNs` → reactive
// nodes) is tracked separately in `docs/optimizations.md`. Both surfaces
// share the same pre-Unit-7 closure shape today.
// ---------------------------------------------------------------------------

import { batch } from "../../../core/batch.js";
import { monotonicNs } from "../../../core/clock.js";
import type { Node } from "../../../core/node.js";
import { derived, effect, state } from "../../../core/sugar.js";
import type { DistillBundle } from "../../../extra/composite.js";
import { fromAny, type NodeInput } from "../../../extra/sources.js";
import type { StorageHandle } from "../../../extra/storage-core.js";
import { decay } from "../../../extra/utils/decay.js";
import type { Graph } from "../../../graph/graph.js";
import {
	cosineSimilarity,
	type KnowledgeEdge,
	type KnowledgeGraph,
	knowledgeGraph,
	lightCollection,
	type VectorIndexGraph,
	type VectorRecord,
	type VectorSearchResult,
	vectorIndex,
} from "../../memory/index.js";
import { aiMeta } from "../_internal.js";
import type { RetrievalEntry, RetrievalQuery, RetrievalTrace } from "./retrieval.js";
import {
	DEFAULT_DECAY_RATE,
	type MemoryTier,
	type MemoryTiersBundle,
	type MemoryTiersOptions,
} from "./tiers.js";

/** @internal — extract a reactive_map snapshot back to a typed Map. */
function extractStoreMap<TMem>(snapshot: unknown): ReadonlyMap<string, TMem> {
	if (snapshot instanceof Map) return snapshot as ReadonlyMap<string, TMem>;
	return new Map<string, TMem>();
}

// ---------------------------------------------------------------------------
// memoryWithVectors
// ---------------------------------------------------------------------------

export type MemoryWithVectorsOptions<TMem> = {
	/** Embedding dimension. Must match the `embedFn` output length. */
	dimension: number;
	/** Extract an embedding vector for a memory entry. */
	embedFn: (mem: TMem) => readonly number[] | undefined;
};

/**
 * Attach a vector index to a `DistillBundle`. Indexes every entry in the
 * store as it changes. Returns the `VectorIndexGraph` so retrieval can read
 * its `entries` and call `search()`.
 *
 * The indexer's keepalive is registered with `graph.addDisposer` so it tears
 * down on `graph.destroy()`. The returned `dispose()` is also available for
 * early release without destroying the parent graph.
 */
export function memoryWithVectors<TMem>(
	graph: Graph,
	store: DistillBundle<TMem>,
	opts: MemoryWithVectorsOptions<TMem>,
): { vectors: VectorIndexGraph<TMem>; dispose: () => void } {
	const vectors = vectorIndex<TMem>({ dimension: opts.dimension });
	graph.add(vectors.entries, { name: "vectorIndex" });
	const indexer = effect([store.store.entries], ([snapshot]) => {
		const storeMap = extractStoreMap<TMem>(snapshot);
		for (const [key, mem] of storeMap) {
			const vec = opts.embedFn(mem);
			if (vec) vectors.upsert(key, vec, mem);
		}
	});
	const unsub = indexer.subscribe(() => undefined);
	graph.addDisposer(unsub);
	return { vectors, dispose: () => unsub() };
}

// ---------------------------------------------------------------------------
// memoryWithKG
// ---------------------------------------------------------------------------

export type MemoryWithKGOptions<TMem> = {
	/**
	 * Mount path for the KG subgraph on the parent graph. Defaults to `name`.
	 * Pass a different value when the parent graph reserves a stable mount
	 * path (e.g. `agentMemory` mounts at `"kg"` regardless of outer name).
	 */
	mountPath?: string;
	/**
	 * Extract entities + relations for a memory entry. Omit to mount an empty
	 * KG without an indexer effect — caller upserts entities / relations
	 * directly on the returned `kg` handle.
	 */
	entityFn?: (
		key: string,
		mem: TMem,
	) =>
		| {
				entities?: Array<{ id: string; value: unknown }>;
				relations?: Array<{ from: string; to: string; relation: string; weight?: number }>;
		  }
		| undefined;
};

/**
 * Attach a knowledge graph alongside a `DistillBundle`. Inner graph is named
 * `${name}-kg`; mount path defaults to `name` but can be overridden via
 * `opts.mountPath` so a parent factory (e.g. `agentMemory`) can keep a stable
 * mount path independent of the inner graph's identity.
 *
 * If `opts.entityFn` is omitted, no indexer effect is wired — the empty KG is
 * mounted for manual `upsertEntity` / `link` use.
 *
 * Indexer keepalive (when present) is registered with `graph.addDisposer`;
 * explicit `dispose()` is also available.
 */
export function memoryWithKG<TMem>(
	graph: Graph,
	store: DistillBundle<TMem>,
	name: string,
	opts: MemoryWithKGOptions<TMem>,
): { kg: KnowledgeGraph<unknown, string>; dispose: () => void } {
	const mountPath = opts.mountPath ?? name;
	const kg = knowledgeGraph<unknown, string>(`${name}-kg`);
	graph.mount(mountPath, kg);
	if (!opts.entityFn) {
		return { kg, dispose: () => undefined };
	}
	const entityFn = opts.entityFn;
	const indexer = effect([store.store.entries], ([snapshot]) => {
		const storeMap = extractStoreMap<TMem>(snapshot);
		for (const [key, mem] of storeMap) {
			const extracted = entityFn(key, mem);
			if (!extracted) continue;
			for (const ent of extracted.entities ?? []) {
				kg.upsertEntity(ent.id, ent.value);
			}
			for (const rel of extracted.relations ?? []) {
				kg.link(rel.from, rel.to, rel.relation as string, rel.weight);
			}
		}
	});
	const unsub = indexer.subscribe(() => undefined);
	graph.addDisposer(unsub);
	return { kg, dispose: () => unsub() };
}

// ---------------------------------------------------------------------------
// memoryWithTiers
// ---------------------------------------------------------------------------

export type MemoryWithTiersOptions<TMem> = MemoryTiersOptions<TMem> & {
	/** Score function — same signature as `agentMemory.score`. */
	score: (mem: TMem, context: unknown) => number;
	/** Optional reactive context node (passed to `score`). */
	context?: NodeInput<unknown>;
};

/**
 * Attach 3-tier storage (active / archived / permanent) to a `DistillBundle`.
 * Wires a `tierClassifier` effect that:
 * - Promotes entries matching `permanentFilter` into the permanent tier.
 * - Archives entries whose decayed score falls below `archiveThreshold`.
 * - Caps the active tier at `maxActive`, evicting lowest-scored on overflow.
 *
 * **Closure state caveat (Unit 7 Q3 deferred):** `permanentKeys` +
 * `entryCreatedAtNs` are still closure-held for now; promotion to reactive
 * nodes is tracked in `docs/optimizations.md`.
 */
export function memoryWithTiers<TMem>(
	graph: Graph,
	store: DistillBundle<TMem>,
	opts: MemoryWithTiersOptions<TMem>,
): { tiers: MemoryTiersBundle<TMem>; dispose: () => void } {
	const decayRate = opts.decayRate ?? DEFAULT_DECAY_RATE;
	const maxActive = opts.maxActive ?? 1000;
	const archiveThreshold = opts.archiveThreshold ?? 0.1;
	const permanentFilter = opts.permanentFilter ?? (() => false);

	const permanent = lightCollection<TMem>({ name: "permanent" });
	graph.add(permanent.entries, { name: "permanent" });

	const permanentKeys = new Set<string>();
	const tierOf = (key: string): MemoryTier => {
		if (permanentKeys.has(key)) return "permanent";
		const m = extractStoreMap<TMem>(store.store.entries.cache);
		if (m.has(key)) return "active";
		return "archived";
	};
	const markPermanent = (key: string, value: TMem): void => {
		permanentKeys.add(key);
		permanent.upsert(key, value);
	};

	const entryCreatedAtNs = new Map<string, number>();
	const storeNode = store.store.entries;
	const contextNode = opts.context ? fromAny(opts.context) : state<unknown>(null);

	const tierClassifier = effect([storeNode, contextNode], ([snapshot, ctx]) => {
		const storeMap = extractStoreMap<TMem>(snapshot);
		const nowNs = monotonicNs();
		const toArchive: string[] = [];
		const toPermanent: Array<{ key: string; value: TMem }> = [];

		for (const [key, mem] of storeMap) {
			if (!entryCreatedAtNs.has(key)) entryCreatedAtNs.set(key, nowNs);
			if (permanentFilter(key, mem)) {
				toPermanent.push({ key, value: mem });
				continue;
			}
			const baseScore = opts.score(mem, ctx);
			const createdNs = entryCreatedAtNs.get(key) ?? nowNs;
			const ageSeconds = Number(nowNs - createdNs) / 1e9;
			const decayed = decay(baseScore, ageSeconds, decayRate);
			if (decayed < archiveThreshold) toArchive.push(key);
		}

		for (const key of entryCreatedAtNs.keys()) {
			if (!storeMap.has(key)) entryCreatedAtNs.delete(key);
		}

		for (const { key, value } of toPermanent) {
			if (!permanentKeys.has(key)) markPermanent(key, value);
		}

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

		if (toArchive.length > 0) {
			batch(() => {
				for (const key of toArchive) store.store.delete(key);
			});
		}
	});
	const unsub = tierClassifier.subscribe(() => undefined);

	let archiveHandle: StorageHandle | null = null;
	if (opts.archiveTier) {
		archiveHandle = graph.attachSnapshotStorage(
			[opts.archiveTier],
			opts.archiveStorageOptions ?? {},
		);
	}

	// Both teardowns wrapped in a single dispose. Registered with the graph so
	// `graph.destroy()` reclaims the storage handle / classifier subscription
	// even when the caller never invokes the returned `dispose()` directly.
	const dispose = (): void => {
		unsub();
		archiveHandle?.dispose();
	};
	graph.addDisposer(dispose);

	return {
		tiers: {
			permanent,
			activeEntries: storeNode,
			archiveHandle,
			tierOf,
			markPermanent,
		},
		dispose,
	};
}

// ---------------------------------------------------------------------------
// memoryRetrieval
// ---------------------------------------------------------------------------

export type MemoryRetrievalOptions<TMem> = {
	/** Score function (same shape as `agentMemory.score`). */
	score: (mem: TMem, context: unknown) => number;
	/** Cost function for budget packing. */
	cost: (mem: TMem) => number;
	/** Token / cost budget. Default 2000. */
	budget?: number;
	/** Top-K vector candidates. Default 20. */
	topK?: number;
	/** KG expansion depth in hops. Default 1. */
	graphDepth?: number;
	/** Hierarchical-context boost weight. Default 0. */
	contextWeight?: number;
	/** Hierarchical-context accessor for entries. */
	contextOf?: (mem: TMem) => readonly string[] | undefined;
	/** Optional reactive context node (passed to `score`). */
	context?: NodeInput<unknown>;
};

export type MemoryRetrievalBundle<TMem> = {
	/** State node mirroring the latest packed retrieval result. */
	readonly retrieval: Node<ReadonlyArray<RetrievalEntry<TMem>>>;
	/** State node mirroring the latest retrieval trace. */
	readonly retrievalTrace: Node<RetrievalTrace<TMem> | null>;
	/** Imperative consumer API — synchronous; reads cache at call time. */
	readonly retrieve: (query: RetrievalQuery) => ReadonlyArray<RetrievalEntry<TMem>>;
	/** Reactive sibling — chain into the graph. Mirrors observability state. */
	readonly retrieveReactive: (
		queryInput: NodeInput<RetrievalQuery | null>,
	) => Node<ReadonlyArray<RetrievalEntry<TMem>>>;
};

function sharedPrefixDepth(
	q: readonly string[] | undefined,
	e: readonly string[] | undefined,
): number {
	if (!q || !e) return 0;
	const n = Math.min(q.length, e.length);
	let i = 0;
	while (i < n && q[i] === e[i]) i++;
	return i;
}

/**
 * Build the retrieval pipeline (vector + KG + budget packing) over a
 * `DistillBundle` and optional `vectors` / `kg` bundles.
 *
 * Both consumer surfaces (`retrieve`, `retrieveReactive`) write to the same
 * `retrieval` + `retrievalTrace` state nodes — observers subscribed to those
 * see ALL queries regardless of which API issued them.
 */
export function memoryRetrieval<TMem>(
	graph: Graph,
	store: DistillBundle<TMem>,
	vectors: VectorIndexGraph<TMem> | null,
	kg: KnowledgeGraph<unknown, string> | null,
	opts: MemoryRetrievalOptions<TMem>,
): MemoryRetrievalBundle<TMem> {
	const topK = opts.topK ?? 20;
	const graphDepth = opts.graphDepth ?? 1;
	const budget = opts.budget ?? 2000;
	const contextWeight = opts.contextWeight ?? 0;
	const contextNode = opts.context ? fromAny(opts.context) : state<unknown>(null);

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
			// Wave A migrated `vectorIndex` to a reactive-only read API
			// (`searchNode`); inline the equivalent flat-cosine snapshot scan
			// here since `runRetrieval` is sync and `searchNode` is async-shaped.
			// `patterns/ai/memory/` is queued for its own audit per the Wave A
			// session doc § D.1.
			const q = query.vector;
			const snapshot = vectors.entries.cache as ReadonlyMap<string, VectorRecord<TMem>> | undefined;
			if (snapshot && snapshot.size > 0 && topK > 0) {
				const scored = [...snapshot.values()]
					.map(
						(row): VectorSearchResult<TMem> => ({
							id: row.id,
							score: cosineSimilarity(q, row.vector),
							...(row.meta !== undefined ? { meta: row.meta } : {}),
						}),
					)
					.sort((a, b) => b.score - a.score)
					.slice(0, topK);
				vectorCandidates = scored;
				for (const vc of vectorCandidates) {
					const mem = storeMap.get(vc.id);
					if (mem) candidateMap.set(vc.id, { value: mem, sources: new Set(["vector"]) });
				}
			}
		}

		const graphExpanded: string[] = [];
		if (kg) {
			// Wave A migrated `knowledgeGraph` to a reactive-only `relatedNode`
			// API; inline the equivalent adjacency-snapshot scan here for the
			// sync expansion. `adjacencyOut` / `adjacencyIn` are kept warm by
			// the kg's own internal keepalive disposers, so `.cache` is always
			// populated post-construction.
			const adjOut = kg.adjacencyOut.cache as
				| ReadonlyMap<string, readonly KnowledgeEdge<string>[]>
				| undefined;
			const adjIn = kg.adjacencyIn.cache as
				| ReadonlyMap<string, readonly KnowledgeEdge<string>[]>
				| undefined;
			const seedIds = [...(query.entityIds ?? []), ...[...candidateMap.keys()]];
			const visited = new Set<string>();
			let frontier = seedIds;
			for (let depth = 0; depth < graphDepth; depth++) {
				const nextFrontier: string[] = [];
				for (const id of frontier) {
					if (visited.has(id)) continue;
					visited.add(id);
					const outEdges = adjOut?.get(id) ?? [];
					const inEdges = adjIn?.get(id) ?? [];
					for (const edge of outEdges) {
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
					// Inbound edges: traverse to the `from` side. Match the
					// previous `kg.related(id)` semantics, which returned both
					// `from === id` and `to === id` matches.
					for (const edge of inEdges) {
						const targetId = edge.from;
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
			const entryContext = opts.contextOf ? opts.contextOf(value) : undefined;
			let score = opts.score(value, ctx);
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
			const c = opts.cost(entry.value);
			if (usedBudget + c > budget && packed.length > 0) break;
			packed.push(entry);
			usedBudget += c;
		}

		return { packed, trace: { vectorCandidates, graphExpanded, ranked, packed } };
	};

	// QA-fix: element-wise reference-equality dedup so subscribers don't wake
	// up when an identical packed array lands (runRetrieval allocates a new
	// outer array reference every call).
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

	const traceState = state<RetrievalTrace<TMem> | null>(null, {
		name: "retrievalTrace",
		describeKind: "state",
		meta: aiMeta("retrieval_trace"),
	});
	graph.add(traceState, { name: "retrievalTrace" });

	const retrieve = (query: RetrievalQuery): ReadonlyArray<RetrievalEntry<TMem>> => {
		const storeMap = extractStoreMap<TMem>(store.store.entries.cache);
		const { packed, trace } = runRetrieval(storeMap, contextNode.cache, query);
		batch(() => {
			retrievalOutput.emit(packed);
			traceState.emit(trace);
		});
		return packed;
	};

	// QA-fix (Group 1A): split the reactive recompute into a pure `result`
	// derived + a co-mounted `mirror` effect + a packed projection. The mirror
	// makes the writes to `retrievalOutput` / `traceState` topology-visible
	// (proper §32 state-mirror) instead of hidden inside a `derived` fn body
	// (which §28 doesn't actually sanction — §28 covers factory-time *reads*).
	const retrieveReactive = (
		queryInput: NodeInput<RetrievalQuery | null>,
	): Node<ReadonlyArray<RetrievalEntry<TMem>>> => {
		const q = fromAny(queryInput);
		const result = derived<{
			packed: ReadonlyArray<RetrievalEntry<TMem>>;
			trace: RetrievalTrace<TMem> | null;
		}>(
			[store.store.entries, contextNode, q],
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
		const unsub = mirror.subscribe(() => undefined);
		graph.addDisposer(unsub);
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

	return { retrieval: retrievalOutput, retrievalTrace: traceState, retrieve, retrieveReactive };
}
