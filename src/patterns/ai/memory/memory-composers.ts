// ---------------------------------------------------------------------------
// memory composers — Unit 7 C-factoring (2026-04-23 doc decision).
//
// Each composer attaches one capability (vectors, KG, tiers, retrieval) to a
// `DistillBundle`. `agentMemory` continues to ship as the ergonomic sugar
// over the full pipeline; power users who want a subset call these factories
// directly. The composers are additive — they do not duplicate the wiring
// inside `agentMemory`; both surfaces are valid entry points.
//
// Tier 4.1 B + 4.3 B (2026-04-29): `memoryWithTiers` is the construction site
// for the distill bundle when tiers are configured (`reactiveMap.retention`
// wired at construction eliminates the §7 feedback cycle the prior
// `tierClassifier` effect carried). `permanentKeys` and `entryCreatedAtNs`
// are reactive maps mounted on the graph (not closure state) so
// `describe()`/`explain()` can walk to the inputs that fed an archival
// decision.
// ---------------------------------------------------------------------------

import { batch } from "../../../core/batch.js";
import { monotonicNs } from "../../../core/clock.js";
import { DATA } from "../../../core/messages.js";
import type { Node } from "../../../core/node.js";
import { derived, effect, state } from "../../../core/sugar.js";
import {
	type DistillBundle,
	type DistillOptions,
	distill,
	type Extraction,
} from "../../../extra/composite.js";
import {
	type ReactiveMapBundle,
	type ReactiveMapRetention,
	reactiveMap,
} from "../../../extra/reactive-map.js";
import { fromAny, type NodeInput } from "../../../extra/sources.js";
import type { StorageHandle } from "../../../extra/storage-core.js";
import { decay } from "../../../extra/utils/decay.js";
import type { Graph } from "../../../graph/graph.js";
import {
	collection,
	cosineSimilarity,
	type KnowledgeEdge,
	type KnowledgeGraph,
	knowledgeGraph,
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

// Tier 4.7 (Wave AM Unit 5 carry): the pre-rebuild defensive `extractStoreMap`
// helper (runtime `instanceof Map` check before casting) was deleted in favor
// of a typed `as` cast at each callsite. The upstream `ReactiveMapBundle`
// always emits a real Map on the live emit path; non-Map snapshots only
// surface on `Graph.restore` from a codec that round-tripped Map → JSON →
// plain object (handled in `extra/composite.ts:mapFromSnapshot` for distill
// internals). Empty map is the canonical "no entries yet" value —
// `state(undefined)` would stall a derived/effect's first-run gate.
//
// qa F3 (deferred): the typed cast lies if upstream contract ever breaks
// (e.g. `entries` emits a non-Map non-undefined value). Failure mode is a
// TypeError at iteration instead of a silent empty-map fallback —
// deliberate trade-off, surfacing real upstream-contract violations beats
// hiding them. Upstream-narrowing follow-up filed in `docs/optimizations.md`
// under "Tier 4.7 follow-up — narrow `ReactiveMapBundle.entries` callback typing".

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
		const storeMap = (snapshot as ReadonlyMap<string, TMem> | undefined) ?? new Map<string, TMem>();
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
		const storeMap = (snapshot as ReadonlyMap<string, TMem> | undefined) ?? new Map<string, TMem>();
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

/**
 * Full options for {@link memoryWithTiers} (Tier 4.1 B + 4.3 B refactor,
 * 2026-04-29). Combines tier-policy options with the distill-side options
 * needed to construct the underlying store — `memoryWithTiers` is now the
 * **construction site** for the distill bundle so it can wire
 * `reactiveMap.retention` into the store at construction (eliminating the
 * §7 feedback cycle the previous `tierClassifier` effect carried).
 *
 * The retention config built internally maps tier policy to the substrate:
 * - `archiveThreshold` → `retention.archiveThreshold`
 * - `maxActive` → `retention.maxSize`
 * - per-entry `decay(score(mem, ctx), age, decayRate)` → `retention.score`
 *   (capturing `latestCtx` + `entryCreatedAtNs` via closure-mirror; permanent
 *   entries score `Infinity` to bypass eviction).
 */
export type MemoryWithTiersOptions<TMem> = MemoryTiersOptions<TMem> &
	Omit<DistillOptions<TMem>, "mapOptions" | "score" | "context"> & {
		/** Score function — same signature as `agentMemory.score`. */
		score: (mem: TMem, context: unknown) => number;
		/** Optional reactive context node (passed to `score`). */
		context?: NodeInput<unknown>;
	};

/**
 * Attach 3-tier storage (active / archived / permanent) to a fresh distill
 * store, wiring `reactiveMap.retention` at construction so archival happens
 * synchronously inside the substrate's mutation pipeline (no §7 feedback
 * cycle). Promotes `permanentKeys` and `entryCreatedAtNs` to reactive maps
 * mounted on the graph (Tier 4.3 B — Unit 7 Q3) so `describe()`/`explain()`
 * can walk to "why was X archived?".
 *
 * **API shape** (Tier 4.1 B, 2026-04-29 — breaking change vs. pre-refactor):
 * `memoryWithTiers` constructs the distill bundle internally rather than
 * accepting a pre-built one. Callers pass `(graph, source, extractFn,
 * opts)`. The bundle is exposed as `result.store` for downstream composers
 * (vectors / KG / retrieval).
 *
 * - `permanentFilter`-matching entries score `Infinity` in retention →
 *   never archived. Independent permanent-promotion effect upserts them
 *   into the `permanent` collection.
 * - Below-threshold entries → retention archives synchronously.
 * - Over-`maxActive` entries → retention's `maxSize` evicts lowest-scored.
 */
export function memoryWithTiers<TRaw, TMem>(
	graph: Graph,
	source: NodeInput<TRaw>,
	extractFn: (
		raw: Node<TRaw>,
		existing: Node<ReadonlyMap<string, TMem>>,
	) => NodeInput<Extraction<TMem>>,
	opts: MemoryWithTiersOptions<TMem>,
): { store: DistillBundle<TMem>; tiers: MemoryTiersBundle<TMem>; dispose: () => void } {
	const decayRate = opts.decayRate ?? DEFAULT_DECAY_RATE;
	const maxActive = opts.maxActive ?? 1000;
	const archiveThreshold = opts.archiveThreshold ?? 0.1;
	const permanentFilter = opts.permanentFilter ?? (() => false);

	// Tier 2.3 fold: `lightCollection` was merged into
	// `collection({ranked: false})`. The unified factory returns a Graph (not
	// a detached bundle), so the prior `graph.add(permanent.entries, ...)`
	// line is replaced with `graph.mount("permanent", permanent)` to surface
	// the inner state in `describe()`.
	const permanent = collection<TMem>("permanent", { ranked: false });
	graph.mount("permanent", permanent);

	// 4.3 B (Unit 7 Q3, 2026-04-29): closure-state promotion. `permanentKeys`
	// and `entryCreatedAtNs` are now reactive maps mounted on the graph, so
	// `describe()` can walk to them and `explain()` can trace the inputs that
	// fed an archival decision.
	const permanentKeys: ReactiveMapBundle<string, true> = reactiveMap<string, true>({
		name: "permanentKeys",
	});
	graph.add(permanentKeys.entries, { name: "permanentKeys" });
	const entryCreatedAtNs: ReactiveMapBundle<string, number> = reactiveMap<string, number>({
		name: "entryCreatedAtNs",
	});
	graph.add(entryCreatedAtNs.entries, { name: "entryCreatedAtNs" });

	// Closure-mirror for ctx (§28 factory-time seed). `score(mem, ctx)` runs
	// inside `retention.score` which is invoked synchronously from store
	// mutations — no reactive dep on contextNode there. The mirror keeps
	// `latestCtx` current via subscribe.
	const contextNode = opts.context ? fromAny(opts.context) : state<unknown>(null);
	let latestCtx: unknown = contextNode.cache;
	const ctxUnsub = contextNode.subscribe((msgs) => {
		for (const m of msgs) if (m[0] === DATA) latestCtx = m[1];
	});

	// Build retention. `score` runs synchronously inside store mutations.
	// Permanent matches return Infinity to bypass eviction. New entries have
	// their creation time recorded inline (the entryCreatedAtNs subscriber
	// below maintains the GC-on-removal half).
	const retention: ReactiveMapRetention<string, TMem> = {
		score: (key, value) => {
			if (permanentFilter(key, value)) return Number.POSITIVE_INFINITY;
			if (permanentKeys.has(key)) return Number.POSITIVE_INFINITY;
			const nowNs = monotonicNs();
			let createdNs = entryCreatedAtNs.get(key);
			if (createdNs === undefined) {
				createdNs = nowNs;
				entryCreatedAtNs.set(key, nowNs);
			}
			const ageSeconds = Number(nowNs - createdNs) / 1e9;
			return decay(opts.score(value, latestCtx), ageSeconds, decayRate);
		},
		archiveThreshold,
		maxSize: maxActive,
	};

	// Construct distill with retention wired into mapOptions. The distill
	// bundle exposed via `result.store` is the same one downstream composers
	// (vectors / KG / retrieval) consume.
	const store = distill<TRaw, TMem>(source, extractFn, {
		score: opts.score,
		cost: opts.cost,
		...(opts.budget !== undefined ? { budget: opts.budget } : {}),
		...(opts.evict !== undefined ? { evict: opts.evict } : {}),
		...(opts.consolidate !== undefined ? { consolidate: opts.consolidate } : {}),
		...(opts.consolidateTrigger !== undefined
			? { consolidateTrigger: opts.consolidateTrigger }
			: {}),
		...(opts.context !== undefined ? { context: opts.context } : {}),
		mapOptions: { retention },
	});

	const tierOf = (key: string): MemoryTier => {
		if (permanentKeys.has(key)) return "permanent";
		const m =
			(store.store.entries.cache as ReadonlyMap<string, TMem> | undefined) ??
			new Map<string, TMem>();
		if (m.has(key)) return "active";
		return "archived";
	};
	const markPermanent = (key: string, value: TMem): void => {
		permanentKeys.set(key, true);
		permanent.upsert(key, value);
	};

	// GC entryCreatedAtNs entries that no longer exist in the active store.
	// (Adds happen inline inside retention.score; removals piggyback on the
	// store-snapshot subscriber here so the map stays in sync.)
	const entriesUnsub = store.store.entries.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] !== DATA) continue;
			const map = m[1] as ReadonlyMap<string, TMem>;
			const created = entryCreatedAtNs.entries.cache as ReadonlyMap<string, number> | undefined;
			if (created == null) continue;
			const toDelete: string[] = [];
			for (const key of created.keys()) {
				if (!map.has(key)) toDelete.push(key);
			}
			if (toDelete.length > 0) {
				batch(() => {
					for (const key of toDelete) entryCreatedAtNs.delete(key);
				});
			}
		}
	});

	// Permanent-promotion effect. Writes to `permanent` collection +
	// `permanentKeys` (NOT to the active store), so no §7 cycle: the effect's
	// dep is `store.store.entries`, but it doesn't write back to that node.
	const promoter = effect([store.store.entries], ([snapshot]) => {
		const map = (snapshot as ReadonlyMap<string, TMem> | undefined) ?? new Map<string, TMem>();
		for (const [key, mem] of map) {
			if (permanentKeys.has(key)) continue;
			if (permanentFilter(key, mem)) {
				batch(() => {
					markPermanent(key, mem);
				});
			}
		}
	});
	const promoteUnsub = promoter.subscribe(() => undefined);

	let archiveHandle: StorageHandle | null = null;
	if (opts.archiveTier) {
		archiveHandle = graph.attachSnapshotStorage(
			[opts.archiveTier],
			opts.archiveStorageOptions ?? {},
		);
	}

	const dispose = (): void => {
		promoteUnsub();
		entriesUnsub();
		ctxUnsub();
		archiveHandle?.dispose();
	};
	graph.addDisposer(dispose);

	return {
		store,
		tiers: {
			permanent,
			activeEntries: store.store.entries,
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
		const storeMap =
			(store.store.entries.cache as ReadonlyMap<string, TMem> | undefined) ??
			new Map<string, TMem>();
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
				const storeMap =
					(snapshot as ReadonlyMap<string, TMem> | undefined) ?? new Map<string, TMem>();
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
