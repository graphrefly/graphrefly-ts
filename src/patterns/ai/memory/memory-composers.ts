// ---------------------------------------------------------------------------
// memory composers — Unit 7 C-factoring (2026-04-23 doc decision).
//
// Each composer attaches one capability (vectors, KG, tiers, retrieval) to a
// `DistillBundle`. `agentMemory` continues to ship as the ergonomic sugar
// over the full pipeline; power users who want a subset call these factories
// directly.
//
// Class B audit (2026-04-30): the composers were migrated from
// bundle-returning factories to **Graph subclasses** so they participate in
// `describe()` / `destroy()` like every other Phase 4+ Graph (mirrors
// `AuditTrailGraph`, `PolicyGateGraph`, `CqrsGraph`). The factory functions
// remain as ergonomic constructors (`memoryWithVectors(opts) → MemoryWithVectorsGraph`).
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
import { type Node, node } from "../../../core/node.js";

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
import { fromAny, keepalive, type NodeInput } from "../../../extra/sources.js";
import type { StorageHandle } from "../../../extra/storage-core.js";
import { decay } from "../../../extra/utils/decay.js";
import { Graph, type GraphOptions } from "../../../graph/graph.js";
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
// `node([], { initial: undefined })` would stall a derived/effect's first-run gate.
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

export interface MemoryWithVectorsOptions<TMem> {
	/** Optional Graph identity — passed through to the underlying `Graph` ctor. */
	graph?: GraphOptions;
	/** Subgraph name. Default: `"memory-vectors"`. */
	name?: string;
	/** The substrate distill store to index. */
	store: DistillBundle<TMem>;
	/** Embedding dimension. Must match the `embedFn` output length. */
	dimension: number;
	/** Extract an embedding vector for a memory entry. */
	embedFn: (mem: TMem) => readonly number[] | undefined;
}

/**
 * Graph subclass that attaches a vector index to a `DistillBundle`. The inner
 * `VectorIndexGraph` is mounted at `"vectorIndex"`; an internal effect
 * subscribes to the substrate store and re-indexes on every change.
 *
 * Mirrors `AuditTrailGraph` / `PolicyGateGraph` shape — fully self-contained,
 * teardown via the Graph's `destroy()` cascade.
 */
export class MemoryWithVectorsGraph<TMem> extends Graph {
	readonly vectors: VectorIndexGraph<TMem>;
	private readonly _store: DistillBundle<TMem>;

	constructor(opts: MemoryWithVectorsOptions<TMem>) {
		super(opts.name ?? "memory-vectors", opts.graph);
		this._store = opts.store;
		this.vectors = vectorIndex<TMem>({ dimension: opts.dimension });
		this.mount("vectorIndex", this.vectors);

		const embedFn = opts.embedFn;
		const vectorsRef = this.vectors;

		// Indexer effect — subscribes to the substrate's store entries, upserts
		// vectors. Pure side-effect; restricted `effect` fn (no emit/down).
		// Cross-graph dep on `opts.store.store.entries` is fine — the substrate
		// is the upstream wired in by the parent factory.
		const indexer = node(
			[opts.store.store.entries],
			(batchData, _actions, ctx) => {
				const data = batchData.map((b, i) =>
					b != null && b.length > 0 ? b.at(-1) : ctx.prevData[i],
				);
				const storeMap =
					(data[0] as ReadonlyMap<string, TMem> | undefined) ?? new Map<string, TMem>();
				for (const [key, mem] of storeMap) {
					const vec = embedFn(mem);
					if (vec) vectorsRef.upsert(key, vec, mem);
				}
			},
			{ name: "indexer", describeKind: "effect" },
		);
		this.add(indexer, { name: "indexer" });
		this.addDisposer(keepalive(indexer));
	}
}

/**
 * Attach a vector index to a `DistillBundle`. Indexes every entry in the
 * store as it changes. Returns the `MemoryWithVectorsGraph` whose `vectors`
 * field exposes the underlying `VectorIndexGraph`.
 *
 * Teardown is handled by `Graph.destroy()` — typically inherited via
 * mounting the result on a parent graph (see `agentMemory`).
 */
export function memoryWithVectors<TMem>(
	opts: MemoryWithVectorsOptions<TMem>,
): MemoryWithVectorsGraph<TMem> {
	return new MemoryWithVectorsGraph<TMem>(opts);
}

// ---------------------------------------------------------------------------
// memoryWithKG
// ---------------------------------------------------------------------------

export interface MemoryWithKGOptions<TMem> {
	/** Optional Graph identity. */
	graph?: GraphOptions;
	/** Subgraph name. Default: `"memory-kg"`. */
	name?: string;
	/** The substrate distill store to index. */
	store: DistillBundle<TMem>;
	/** Inner KnowledgeGraph name. Default: `${name}-kg`. */
	kgName?: string;
	/**
	 * Mount path within this Graph for the KnowledgeGraph. Default:
	 * `"knowledge-kg"` (B5c — symmetric with the outer `knowledge` mount so
	 * describe paths render `knowledge::knowledge-kg::*`).
	 */
	mountPath?: string;
	/**
	 * Extract entities + relations for a memory entry. Omit to mount an empty
	 * KG without an indexer effect — caller upserts entities / relations
	 * directly on the `kg` field.
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
}

/**
 * Graph subclass that attaches a knowledge graph alongside a `DistillBundle`.
 * Mounts the inner `KnowledgeGraph` at `mountPath` (default `"knowledge-kg"`); when
 * `entityFn` is provided, an indexer effect populates entities/relations on
 * every store change.
 */
export class MemoryWithKGGraph<TMem> extends Graph {
	readonly kg: KnowledgeGraph<unknown, string>;

	constructor(opts: MemoryWithKGOptions<TMem>) {
		const name = opts.name ?? "memory-kg";
		super(name, opts.graph);
		const kgName = opts.kgName ?? `${name}-kg`;
		const mountPath = opts.mountPath ?? "knowledge-kg";
		this.kg = knowledgeGraph<unknown, string>(kgName);
		this.mount(mountPath, this.kg);

		if (!opts.entityFn) return;
		const entityFn = opts.entityFn;
		const kgRef = this.kg;
		const indexer = node(
			[opts.store.store.entries],
			(batchData, _actions, ctx) => {
				const data = batchData.map((b, i) =>
					b != null && b.length > 0 ? b.at(-1) : ctx.prevData[i],
				);
				const storeMap =
					(data[0] as ReadonlyMap<string, TMem> | undefined) ?? new Map<string, TMem>();
				for (const [key, mem] of storeMap) {
					const extracted = entityFn(key, mem);
					if (!extracted) continue;
					for (const ent of extracted.entities ?? []) {
						kgRef.upsertEntity(ent.id, ent.value);
					}
					for (const rel of extracted.relations ?? []) {
						kgRef.link(rel.from, rel.to, rel.relation, rel.weight);
					}
				}
			},
			{ name: "indexer", describeKind: "effect" },
		);
		this.add(indexer, { name: "indexer" });
		this.addDisposer(keepalive(indexer));
	}
}

/**
 * Attach a knowledge graph alongside a `DistillBundle`. Returns the
 * `MemoryWithKGGraph` whose `kg` field exposes the inner `KnowledgeGraph`.
 */
export function memoryWithKG<TMem>(opts: MemoryWithKGOptions<TMem>): MemoryWithKGGraph<TMem> {
	return new MemoryWithKGGraph<TMem>(opts);
}

// ---------------------------------------------------------------------------
// memoryWithTiers
// ---------------------------------------------------------------------------

/**
 * Full options for {@link memoryWithTiers} (Tier 4.1 B + 4.3 B refactor,
 * 2026-04-29). Combines tier-policy options with the distill-side options
 * needed to construct the underlying store — `memoryWithTiers` is the
 * **construction site** for the distill bundle so it can wire
 * `reactiveMap.retention` into the store at construction (eliminating the
 * §7 feedback cycle the previous `tierClassifier` effect carried).
 */
export type MemoryWithTiersOptions<TRaw, TMem> = MemoryTiersOptions<TMem> &
	Omit<DistillOptions<TMem>, "mapOptions" | "score" | "context"> & {
		/** Optional Graph identity. */
		graph?: GraphOptions;
		/** Subgraph name. Default: `"memory-tiers"`. */
		name?: string;
		/** Raw source feeding distill. */
		source: NodeInput<TRaw>;
		/** Reactive extraction wiring (same shape as `distill`). */
		extractFn: (
			raw: Node<TRaw>,
			existing: Node<ReadonlyMap<string, TMem>>,
		) => NodeInput<Extraction<TMem>>;
		/** Score function — same signature as `agentMemory.score`. */
		score: (mem: TMem, context: unknown) => number;
		/** Optional reactive context node (passed to `score`). */
		context?: NodeInput<unknown>;
	};

/**
 * Graph subclass attaching 3-tier storage (active / archived / permanent) to
 * a fresh distill store, wiring `reactiveMap.retention` at construction so
 * archival happens synchronously inside the substrate's mutation pipeline
 * (no §7 feedback cycle). Promotes `permanentKeys` and `entryCreatedAtNs` to
 * reactive maps registered on this graph (Tier 4.3 B — Unit 7 Q3) so
 * `describe()` / `explain()` can walk to "why was X archived?".
 *
 * Public-face fields:
 * - `store` — the distill bundle (construction site, exposed for downstream
 *   composers).
 * - `tiers` — tier classification + permanent promotion handles.
 * - `compact`, `size` — alias for `store.compact` / `store.size` (registered
 *   under their canonical names so `describe()` keys match `agentMemory`'s
 *   pre-migration layout).
 */
export class MemoryWithTiersGraph<TRaw, TMem> extends Graph {
	readonly store: DistillBundle<TMem>;
	readonly tiers: MemoryTiersBundle<TMem>;
	readonly compact: Node<Array<{ key: string; value: TMem; score: number }>>;
	readonly size: Node<number>;
	readonly permanent: ReturnType<typeof collection<TMem>>;
	readonly permanentKeys: ReactiveMapBundle<string, true>;
	readonly entryCreatedAtNs: ReactiveMapBundle<string, number>;

	constructor(opts: MemoryWithTiersOptions<TRaw, TMem>) {
		super(opts.name ?? "memory-tiers", opts.graph);

		const decayRate = opts.decayRate ?? DEFAULT_DECAY_RATE;
		const maxActive = opts.maxActive ?? 1000;
		const archiveThreshold = opts.archiveThreshold ?? 0.1;
		const permanentFilter = opts.permanentFilter ?? (() => false);

		// Tier 2.3 fold: `lightCollection` was merged into
		// `collection({ranked: false})`. The unified factory returns a Graph (not
		// a detached bundle), so it's mounted as a subgraph for `describe()`.
		this.permanent = collection<TMem>("permanent", { ranked: false });
		this.mount("permanent", this.permanent);

		// 4.3 B (Unit 7 Q3, 2026-04-29): closure-state promotion. `permanentKeys`
		// and `entryCreatedAtNs` are reactive maps registered on this graph so
		// `describe()` can walk to them and `explain()` can trace the inputs
		// that fed an archival decision.
		this.permanentKeys = reactiveMap<string, true>({ name: "permanentKeys" });
		this.add(this.permanentKeys.entries, { name: "permanentKeys" });
		this.entryCreatedAtNs = reactiveMap<string, number>({ name: "entryCreatedAtNs" });
		this.add(this.entryCreatedAtNs.entries, { name: "entryCreatedAtNs" });

		// Closure-mirror for ctx (§28 factory-time seed). `score(mem, ctx)` runs
		// inside `retention.score` which is invoked synchronously from store
		// mutations — no reactive dep on contextNode there. The mirror keeps
		// `latestCtx` current via subscribe.
		//
		// Topology visibility: the local-default branch registers the context
		// state node so it appears in `describe()`. The user-supplied-Node
		// branch deliberately leaves the node unregistered — `fromAny` returns
		// the caller's owned Node, which is owned by their graph; mounting it
		// here would corrupt cross-graph ownership.
		let contextNode: Node<unknown>;
		if (opts.context) {
			contextNode = fromAny(opts.context);
		} else {
			contextNode = node<unknown>([], { initial: null });
			this.add(contextNode, { name: "context" });
		}
		let latestCtx: unknown = contextNode.cache;
		const ctxUnsub = contextNode.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) latestCtx = m[1];
		});
		this.addDisposer(ctxUnsub);

		const permanentKeysRef = this.permanentKeys;
		const entryCreatedAtNsRef = this.entryCreatedAtNs;
		const score = opts.score;

		// Build retention. `score` runs synchronously inside store mutations.
		// Permanent matches return Infinity to bypass eviction.
		//
		// DS-13.5.F (2026-05-01): `score` is read-only against
		// `entryCreatedAtNs` — the first-write side-effect was extracted into
		// the `entryCreatedAtNs/sync` effect below. Race window for the very
		// first call on a new key is mitigated by the `?? nowNs` fallback
		// (yields ageSeconds = 0, i.e. fresh-decay), and the sync effect
		// populates the map after the wave settles so subsequent score calls
		// see the persisted timestamp.
		const retention: ReactiveMapRetention<string, TMem> = {
			score: (key, value) => {
				if (permanentFilter(key, value)) return Number.POSITIVE_INFINITY;
				if (permanentKeysRef.has(key)) return Number.POSITIVE_INFINITY;
				const nowNs = monotonicNs();
				const createdNs = entryCreatedAtNsRef.get(key) ?? nowNs;
				const ageSeconds = Number(nowNs - createdNs) / 1e9;
				return decay(score(value, latestCtx), ageSeconds, decayRate);
			},
			archiveThreshold,
			maxSize: maxActive,
		};

		// Construct distill with retention wired into mapOptions.
		this.store = distill<TRaw, TMem>(opts.source, opts.extractFn, {
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

		// Register the distill bundle's exposed nodes under their canonical
		// names so consumers (and `describe()`) see the same shape as the
		// pre-migration top-level surface on `agentMemory`.
		this.add(this.store.store.entries, { name: "store" });
		this.compact = this.store.compact;
		this.add(this.compact, { name: "compact" });
		this.size = this.store.size;
		this.add(this.size, { name: "size" });

		const storeRef = this.store;
		const tierOf = (key: string): MemoryTier => {
			if (permanentKeysRef.has(key)) return "permanent";
			const m =
				(storeRef.store.entries.cache as ReadonlyMap<string, TMem> | undefined) ??
				new Map<string, TMem>();
			if (m.has(key)) return "active";
			return "archived";
		};
		const permanentRef = this.permanent;
		const markPermanent = (key: string, value: TMem): void => {
			permanentKeysRef.set(key, true);
			permanentRef.upsert(key, value);
		};

		// DS-13.5.F (2026-05-01): first-write of `entryCreatedAtNs[key]` runs
		// here (extracted from `retention.score` to keep score pure). Reads
		// `store.store.entries`, writes `entryCreatedAtNs` — distinct nodes,
		// no §7 feedback cycle. Idempotent: re-emissions for already-tracked
		// keys skip via `entryCreatedAtNsRef.has(key)`.
		const syncCreatedAt = node(
			[this.store.store.entries],
			(batchData, _actions, ctx) => {
				const data = batchData.map((b, i) =>
					b != null && b.length > 0 ? b.at(-1) : ctx.prevData[i],
				);
				const map = (data[0] as ReadonlyMap<string, TMem> | undefined) ?? new Map<string, TMem>();
				const nowNs = monotonicNs();
				const toAdd: string[] = [];
				for (const key of map.keys()) {
					if (!entryCreatedAtNsRef.has(key)) toAdd.push(key);
				}
				if (toAdd.length > 0) {
					batch(() => {
						for (const key of toAdd) entryCreatedAtNsRef.set(key, nowNs);
					});
				}
			},
			{ name: "entryCreatedAtNs/sync", describeKind: "effect" },
		);
		this.add(syncCreatedAt, { name: "entryCreatedAtNs/sync" });
		this.addDisposer(keepalive(syncCreatedAt));

		// GC entryCreatedAtNs entries that no longer exist in the active store.
		// (Adds happen via the syncCreatedAt effect above; removals piggyback
		// on the store-snapshot subscriber here so the map stays in sync.)
		const entriesUnsub = this.store.store.entries.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				const map = m[1] as ReadonlyMap<string, TMem>;
				const created = entryCreatedAtNsRef.entries.cache as
					| ReadonlyMap<string, number>
					| undefined;
				if (created == null) continue;
				const toDelete: string[] = [];
				for (const key of created.keys()) {
					if (!map.has(key)) toDelete.push(key);
				}
				if (toDelete.length > 0) {
					batch(() => {
						for (const key of toDelete) entryCreatedAtNsRef.delete(key);
					});
				}
			}
		});
		this.addDisposer(entriesUnsub);

		// Permanent-promotion effect. Writes to `permanent` collection +
		// `permanentKeys` (NOT to the active store), so no §7 cycle: the effect's
		// dep is `store.store.entries`, but it doesn't write back to that node.
		const promoter = node(
			[this.store.store.entries],
			(batchData, _actions, ctx) => {
				const data = batchData.map((b, i) =>
					b != null && b.length > 0 ? b.at(-1) : ctx.prevData[i],
				);
				const map = (data[0] as ReadonlyMap<string, TMem> | undefined) ?? new Map<string, TMem>();
				for (const [key, mem] of map) {
					if (permanentKeysRef.has(key)) continue;
					if (permanentFilter(key, mem)) {
						batch(() => {
							markPermanent(key, mem);
						});
					}
				}
			},
			{ name: "promoter", describeKind: "effect" },
		);
		this.add(promoter, { name: "promoter" });
		this.addDisposer(keepalive(promoter));

		let archiveHandle: StorageHandle | null = null;
		if (opts.archiveTier) {
			archiveHandle = this.attachSnapshotStorage(
				[opts.archiveTier],
				opts.archiveStorageOptions ?? {},
			);
			this.addDisposer(() => archiveHandle?.dispose());
		}

		this.tiers = {
			permanent: this.permanent,
			activeEntries: this.store.store.entries,
			archiveHandle,
			tierOf,
			markPermanent,
		};
	}
}

/**
 * Attach 3-tier storage (active / archived / permanent) over a fresh distill
 * store. Returns a `MemoryWithTiersGraph` whose `store` and `tiers` fields
 * mirror the previous bundle shape.
 *
 * **API shape** (Class B audit, 2026-04-30 — breaking change vs.
 * pre-migration): the factory takes a single opts bag including `source`
 * and `extractFn`. The bundle is exposed as `result.store` for downstream
 * composers (vectors / KG / retrieval).
 *
 * - `permanentFilter`-matching entries score `Infinity` in retention →
 *   never archived. Independent permanent-promotion effect upserts them
 *   into the `permanent` collection.
 * - Below-threshold entries → retention archives synchronously.
 * - Over-`maxActive` entries → retention's `maxSize` evicts lowest-scored.
 */
export function memoryWithTiers<TRaw, TMem>(
	opts: MemoryWithTiersOptions<TRaw, TMem>,
): MemoryWithTiersGraph<TRaw, TMem> {
	return new MemoryWithTiersGraph<TRaw, TMem>(opts);
}

// ---------------------------------------------------------------------------
// memoryRetrieval
// ---------------------------------------------------------------------------

export interface MemoryRetrievalOptions<TMem> {
	/** Optional Graph identity. */
	graph?: GraphOptions;
	/** Subgraph name. Default: `"memory-retrieval"`. */
	name?: string;
	/** The substrate distill store. */
	store: DistillBundle<TMem>;
	/** Optional vector index for similarity search. */
	vectors?: VectorIndexGraph<TMem> | null;
	/** Optional knowledge graph for entity-relation expansion. */
	kg?: KnowledgeGraph<unknown, string> | null;
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
}

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

// QA-fix: element-wise reference-equality dedup so subscribers don't wake
// up when an identical packed array lands (runRetrieval allocates a new
// outer array reference every call).
const packedEquals = <T>(a: readonly T[], b: readonly T[]): boolean => {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
};

/**
 * Graph subclass that builds the retrieval pipeline (vector + KG + budget
 * packing) over a `DistillBundle` and optional vectors / kg substrates.
 *
 * **C1 rework (2026-04-30):** retrieval is reactive-only. Each
 * `retrieveReactive(input)` call constructs its own per-input subgraph
 * mounted at `retrieve_${id}` with named nodes `context`, `result`, and
 * `projection`. Subgraphs register their own scoped disposers so teardown
 * is local to the per-call mount.
 *
 * **QA F-9 (2026-04-30):** the shared `retrieval` / `retrievalTrace`
 * state-node mirrors are dropped — they were last-writer-wins under
 * concurrent `retrieveReactive(...)` calls. Consumers must subscribe to
 * the per-call `projection` node directly. One-shot consumers use
 * `awaitSettled(retrieveReactive(input))`.
 *
 * **QA F-6 (2026-04-30):** the per-call `result` derived declares
 * `vectors.entries` / `kg.adjacencyOut` / `kg.adjacencyIn` as deps when
 * configured, so a vector upsert / KG mutation re-runs retrieval even
 * when the query / context / store-snapshot are unchanged. Resolves the
 * §28 closure-mirror gap where these `.cache` reads were undeclared.
 */
export class MemoryRetrievalGraph<TMem> extends Graph {
	private readonly _store: DistillBundle<TMem>;
	private readonly _vectors: VectorIndexGraph<TMem> | null;
	private readonly _kg: KnowledgeGraph<unknown, string> | null;
	private readonly _opts: MemoryRetrievalOptions<TMem>;
	private readonly _contextNode: Node<unknown>;
	private readonly _topK: number;
	private readonly _graphDepth: number;
	private readonly _budget: number;
	private readonly _contextWeight: number;
	private _retrieveSeq = 0;

	constructor(opts: MemoryRetrievalOptions<TMem>) {
		super(opts.name ?? "memory-retrieval", opts.graph);

		this._store = opts.store;
		this._vectors = opts.vectors ?? null;
		this._kg = opts.kg ?? null;
		this._opts = opts;
		this._topK = opts.topK ?? 20;
		this._graphDepth = opts.graphDepth ?? 1;
		this._budget = opts.budget ?? 2000;
		this._contextWeight = opts.contextWeight ?? 0;
		// DS-13.5.C: synthesized branch (no `opts.context` supplied) registers
		// on this graph as `_context` so describe()/explain() can walk to it.
		// User-supplied branch stays unregistered — `fromAny` returns the
		// caller's owned Node, which is owned by their graph; mounting it
		// here would corrupt cross-graph ownership (mirrors MemoryWithTiers's
		// context-branch policy).
		if (opts.context) {
			this._contextNode = fromAny(opts.context);
		} else {
			this._contextNode = this.state<unknown>("_context", null);
		}
	}

	private _runRetrieval(
		storeMap: ReadonlyMap<string, TMem>,
		ctx: unknown,
		query: RetrievalQuery,
	): { packed: RetrievalEntry<TMem>[]; trace: RetrievalTrace<TMem> } {
		const opts = this._opts;
		const candidateMap = new Map<
			string,
			{ value: TMem; sources: Set<"vector" | "graph" | "store"> }
		>();

		let vectorCandidates: VectorSearchResult<TMem>[] = [];
		if (this._vectors && query.vector) {
			// Wave A migrated `vectorIndex` to a reactive-only read API
			// (`searchNode`); inline the equivalent flat-cosine snapshot scan
			// here since `_runRetrieval` is sync and `searchNode` is async-shaped.
			// `patterns/ai/memory/` is queued for its own audit per the Wave A
			// session doc § D.1.
			const q = query.vector;
			const snapshot = this._vectors.entries.cache as
				| ReadonlyMap<string, VectorRecord<TMem>>
				| undefined;
			if (snapshot && snapshot.size > 0 && this._topK > 0) {
				const scored = [...snapshot.values()]
					.map(
						(row): VectorSearchResult<TMem> => ({
							id: row.id,
							score: cosineSimilarity(q, row.vector),
							...(row.meta !== undefined ? { meta: row.meta } : {}),
						}),
					)
					.sort((a, b) => b.score - a.score)
					.slice(0, this._topK);
				vectorCandidates = scored;
				for (const vc of vectorCandidates) {
					const mem = storeMap.get(vc.id);
					if (mem) candidateMap.set(vc.id, { value: mem, sources: new Set(["vector"]) });
				}
			}
		}

		const graphExpanded: string[] = [];
		if (this._kg) {
			// Wave A migrated `knowledgeGraph` to a reactive-only `relatedNode`
			// API; inline the equivalent adjacency-snapshot scan here for the
			// sync expansion. `adjacencyOut` / `adjacencyIn` are kept warm by
			// the kg's own internal keepalive disposers, so `.cache` is always
			// populated post-construction.
			const adjOut = this._kg.adjacencyOut.cache as
				| ReadonlyMap<string, readonly KnowledgeEdge<string>[]>
				| undefined;
			const adjIn = this._kg.adjacencyIn.cache as
				| ReadonlyMap<string, readonly KnowledgeEdge<string>[]>
				| undefined;
			const seedIds = [...(query.entityIds ?? []), ...[...candidateMap.keys()]];
			const visited = new Set<string>();
			let frontier = seedIds;
			for (let depth = 0; depth < this._graphDepth; depth++) {
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
			if (this._contextWeight > 0 && qDepth > 0) {
				const shared = sharedPrefixDepth(query.context, entryContext);
				if (shared > 0) score = score * (1 + (this._contextWeight * shared) / qDepth);
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
			if (usedBudget + c > this._budget && packed.length > 0) break;
			packed.push(entry);
			usedBudget += c;
		}

		return { packed, trace: { vectorCandidates, graphExpanded, ranked, packed } };
	}

	/**
	 * Reactive consumer API — chain into the graph.
	 *
	 * Each call constructs its own per-input subgraph mounted at
	 * `retrieve_${id}` (auto-incrementing within this MemoryRetrievalGraph
	 * instance) with named nodes:
	 *
	 * - `context` — `fromAny(queryInput)` projection (so the input node is
	 *   visible to `describe()` even when callers pass a raw value).
	 * - `result` — pure derived `{ packed, trace }`.
	 * - `projection` — the packed-array node returned to the caller.
	 *
	 * `result` declares the substrate's `store.entries`, the optional
	 * `context` Node, the local `context` projection, and (when configured)
	 * `vectors.entries` / `kg.adjacencyOut` / `kg.adjacencyIn` as deps —
	 * so vector upserts and KG mutations re-trigger retrieval even when
	 * the input is unchanged.
	 *
	 * **Lifecycle contract (DS-13.5.C, 2026-05-01).** The per-call subgraph
	 * stays mounted while the returned `projection` has at least one
	 * subscriber. When the last subscriber unsubscribes, projection's
	 * `deactivate` cleanup hook fires (canonical "last unsubscribe" signal
	 * via the existing `NodeFnCleanup.deactivate` protocol), which calls
	 * `parent.remove(retrieve_${id})` and tears the per-call topology
	 * down via TEARDOWN cascade (post-DS-13.5.A Q16, COMPLETE auto-precedes).
	 *
	 * **Single-shot lifecycle.** This auto-unmount is keyed to the FIRST
	 * last-unsubscribe event — projection is non-resubscribable from the
	 * caller's perspective. Callers who need to subscribe / unsubscribe /
	 * re-subscribe should hold a long-lived subscription externally (e.g.
	 * `keepalive(projection)`) or call `retrieveReactive(...)` again to
	 * mount a fresh per-call subgraph.
	 *
	 * **Caller obligation.** Either subscribe to `projection` (and
	 * eventually unsubscribe to trigger cleanup) OR drop the returned
	 * reference without subscribing — in the no-subscribe case the
	 * subgraph is dormant (no compute fires) and a parent `destroy()`
	 * cascade reclaims it. Holding `projection` without subscribing AND
	 * without ever destroying the parent is the leak case the JSDoc above
	 * the C1 rework covers.
	 *
	 * One-shot callers use `awaitSettled(retrieveReactive(input))`.
	 */
	retrieveReactive(
		queryInput: NodeInput<RetrievalQuery | null>,
	): Node<ReadonlyArray<RetrievalEntry<TMem>>> {
		const id = ++this._retrieveSeq;
		const segment = `retrieve_${id}`;

		// Per-call subgraph — owns the wiring, the keepalive, and the
		// teardown. Mounted on `this` so it's visible in `describe()` and
		// reachable via `${parent}::retrieve_${id}::result` etc.
		const sub = new Graph(segment);

		// Wrap the input as a local pass-through so the per-call subgraph
		// shows the query source in `describe()` regardless of where the
		// caller's node lives in the broader topology. `fromAny` returns
		// the original Node when given a Node, otherwise wraps a
		// value/promise into a producer.
		//
		// DS-13.5.C: registered via `sub.derived(...)` (Graph helper) for
		// equals plumbing + automatic registration; replaces the prior raw
		// `node([inputNode], fn) + sub.add(...)` shape.
		const inputNode = fromAny(queryInput);
		const localContext = sub.derived<RetrievalQuery | null>(
			"context",
			[inputNode],
			(batchData, ctx) => {
				const data = batchData.map((b, i) =>
					b != null && b.length > 0 ? b.at(-1) : ctx.prevData[i],
				);
				return [(data[0] as RetrievalQuery | null) ?? null];
			},
			{
				meta: aiMeta("retrieval_query_input"),
				initial: null,
			},
		);

		// /qa F-6 (2026-04-30): declare vectors / kg substrate Node refs as
		// deps so vector upserts / KG mutations re-trigger retrieval even
		// when query / context / store snapshots are unchanged. The
		// `_runRetrieval` body reads `.cache` from these substrates; before
		// this fix those reads were undeclared §28 closure-mirrors.
		const resultDeps: (string | Node<unknown>)[] = [
			this._store.store.entries,
			this._contextNode,
			localContext,
		];
		if (this._vectors) resultDeps.push(this._vectors.entries as Node<unknown>);
		if (this._kg) {
			resultDeps.push(this._kg.adjacencyOut as Node<unknown>);
			resultDeps.push(this._kg.adjacencyIn as Node<unknown>);
		}

		// DS-13.5.C: migrated to `sub.derived(...)` for equals plumbing +
		// automatic registration.
		const result = sub.derived<{
			packed: ReadonlyArray<RetrievalEntry<TMem>>;
			trace: RetrievalTrace<TMem> | null;
		}>(
			"result",
			resultDeps,
			(batchData, ctx) => {
				const data = batchData.map((b, i) =>
					b != null && b.length > 0 ? b.at(-1) : ctx.prevData[i],
				);
				const query = data[2];
				if (query == null) {
					return [{ packed: [] as ReadonlyArray<RetrievalEntry<TMem>>, trace: null }];
				}
				const storeMap =
					(data[0] as ReadonlyMap<string, TMem> | undefined) ?? new Map<string, TMem>();
				const { packed, trace } = this._runRetrieval(storeMap, data[1], query as RetrievalQuery);
				return [{ packed, trace }];
			},
			{
				meta: aiMeta("retrieval_reactive_result"),
				initial: { packed: [] as ReadonlyArray<RetrievalEntry<TMem>>, trace: null },
			},
		);

		// DS-13.5.C: projection stays as raw `node()` (not `sub.derived`)
		// because the keepalive disposer is wired via the fn's
		// `NodeFnCleanup.deactivate` hook — projection's cleanup-on-last-
		// unsubscribe is what drives `parent.remove(segment)`. The Graph
		// `.derived()` helper drops the cleanup return, so the raw form
		// is required here. `equals: packedEquals` is preserved verbatim.
		const projection = node<ReadonlyArray<RetrievalEntry<TMem>>>(
			[result],
			(batchData, actions, ctx) => {
				const data = batchData.map((b, i) =>
					b != null && b.length > 0 ? b.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as { packed: ReadonlyArray<RetrievalEntry<TMem>> }).packed);
				return {
					deactivate: () => {
						// Auto-unmount on last unsubscribe (DS-13.5.C).
						// Idempotent: try/catch covers the case where the
						// segment was already removed (e.g. parent destroy
						// cascade ran first, or the caller called remove()
						// manually).
						try {
							this.remove(segment);
						} catch {
							/* best-effort cleanup */
						}
					},
				};
			},
			{
				name: "projection",
				describeKind: "derived",
				meta: aiMeta("retrieval_reactive"),
				initial: [] as ReadonlyArray<RetrievalEntry<TMem>>,
				equals: packedEquals,
			},
		);
		sub.add(projection, { name: "projection" });

		this.mount(segment, sub);
		return projection;
	}
}

/**
 * Build the retrieval pipeline (vector + KG + budget packing) over a
 * `DistillBundle` and optional `vectors` / `kg` substrates. Returns a
 * `MemoryRetrievalGraph` exposing `retrieval` / `retrievalTrace` reactive
 * state and the `retrieveReactive(input)` consumer method.
 */
export function memoryRetrieval<TMem>(
	opts: MemoryRetrievalOptions<TMem>,
): MemoryRetrievalGraph<TMem> {
	return new MemoryRetrievalGraph<TMem>(opts);
}
