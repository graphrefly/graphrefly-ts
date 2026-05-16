/**
 * DS-14.7 — Reactive Fact Store / Live Knowledge Graph (locked 2026-05-13).
 *
 * Static-topology agent-memory substrate that satisfies MEME L2 (cascade
 * invalidation) and L3 (obsolescence reasoning) plus Hassabis's
 * filter/consolidate/continual-learning frame, **without** materializing one
 * reactive node per fact. ~12 fixed operator nodes never grow regardless of how
 * many facts the store holds; facts live as columnar DATA inside an indexed
 * `state<FactStore>` (optionally sharded), and cascade is implemented as
 * bounded recursive message emission. Termination rests on a per-root
 * semantic contract — a fact only drives the cascade when it transitions to
 * obsolete (`validTo` set), and each obsolete root emits its cascade exactly
 * once across all waves — plus an empty-array fixpoint short-circuit. The
 * cascade is modeled as DATA arrays (NOT INVALIDATE messages), so spec §1.4's
 * idempotent-within-a-wave INVALIDATE guarantee does NOT govern this loop;
 * convergence is the per-root contract, not a spec §1.4 diamond-merge.
 *
 * Canonical design: `archive/docs/SESSION-DS-14.7-reactive-fact-store.md`
 * (9Q walk complete; Q9-open items 1–9 all resolved).
 *
 * Locked decisions baked in here:
 * - `cascadeMaxIterations` default **8**; overflow emits a per-batch summary
 *   `{ droppedCount, sample, rootFactId }` to `cascadeOverflow` (Q9-open-4).
 *   The overflow `sample` is capped at `OVERFLOW_SAMPLE_SIZE` (8),
 *   independent of `cascadeMaxIterations`.
 * - `shardBy` default hash-mod **4**; caller override; `dependentsIndex`
 *   unsharded for v1 (Q9-open-1).
 * - `MemoryFragment` adds `embedding? / parent_fragment_id? / provenance?`
 *   (Q9-open-3).
 * - `dependentsIndex` updates synchronous + atomic with `factStore` commit
 *   (Q9-open-2).
 * - Scoring contract `(fragment, storeReadHandle) => number` — read-only
 *   handle, no mutation exposure (Q9-open-5).
 * - Consolidator emits to a dedicated `consolidated` topic that the pattern
 *   default-wires back to `ingest`; caller can intercept (Q9-open-6).
 * - Query surface = structured `MemoryQuery` via the `query` topic (default);
 *   function-shaped is caller-side `derived` over `factStore` (Q9-open-7).
 * - Bi-temporal is pattern-layer only — no DS-14 envelope shape change
 *   (Q9-open-9); `simpleFactStore()` deferred to v1.1 (Q9-open-8 — NOT built).
 *
 * **Cascade cycle visibility.** `cascadeProcessor` stays synchronous (preserves
 * spec §1.4 batch-dedupe — LLM-driven dependency extraction lives UPSTREAM of
 * the cascade topic, never inside the recursion). Every cascade message carries
 * a `causalReason` field and the cycle nodes are tagged `meta.cycle:"cascade"`
 * so `describe()` / `explain()` surface the otherwise-invisible
 * `dependentsIndex` fn-body lookup.
 *
 * @module
 */

import { type Node, node, wallClockNs } from "@graphrefly/pure-ts/core";
import type { ReactiveLogBundle } from "@graphrefly/pure-ts/extra";
import { keepalive, reactiveLog } from "@graphrefly/pure-ts/extra";
import { Graph } from "@graphrefly/pure-ts/graph";
import { domainMeta } from "../../base/meta/domain-meta.js";
import {
	type BaseAuditRecord,
	bumpCursor,
	createAuditLog,
	registerCursor,
} from "../../base/mutation/index.js";

// ── Public types ─────────────────────────────────────────────────────────

/** Stable identity for a stored fact. */
export type FactId = string;

/** Shard partition key (string | number — any hashable scalar). */
export type ShardKey = string | number;

/**
 * A single stored memory fact. Pattern convention only — NOT a spec primitive
 * and NOT a DS-14 envelope field (bi-temporal stays pattern-layer per
 * Q9-open-9). Each field is a reactive lever (see design PART 2.3):
 * `validTo` set → cascade fires; `confidence < θ` → review; `sources` →
 * `dependentsIndex` edges feeding cascade.
 */
export interface MemoryFragment<T> {
	readonly id: FactId;
	readonly payload: T;
	/** Transaction time (when learned). `bigint` ns (e.g. `BigInt(monotonicNs())`). */
	readonly t_ns: bigint;
	/** Valid-time start. `undefined` = unbounded past. */
	readonly validFrom?: bigint;
	/** Valid-time end. Setting this is the MEME L3 obsolescence lever. */
	readonly validTo?: bigint;
	/** Confidence 0..1. Dropping below the review threshold emits a review. */
	readonly confidence: number;
	readonly tags: readonly string[];
	/** Dependency edges — fact IDs this fact is derived from / depends on. */
	readonly sources: readonly FactId[];
	/** Optional dense embedding (recipes use it for retrieval). */
	readonly embedding?: readonly number[];
	/** Version-chain pointer — consolidator emits successor fragments. */
	readonly parent_fragment_id?: FactId;
	/** Free-form provenance string for audit. */
	readonly provenance?: string;
}

/**
 * Columnar in-memory store. Held as DATA inside a `state<FactStore<T>>` node
 * (one per shard). `byId` is the authoritative map; the typed companions are
 * kept for the recipe layer (`bitemporal-query`, `influence-analysis`) — v1
 * stores fragments directly and lazily projects columns on demand.
 */
export interface FactStore<T> {
	readonly byId: ReadonlyMap<FactId, MemoryFragment<T>>;
}

/** Reverse dependency index: fact → IDs that depend on it. Unsharded (v1). */
export type DependentsIndex = ReadonlyMap<FactId, readonly FactId[]>;

/** Read-only projection passed to scoring policies (no mutation surface). */
export interface StoreReadHandle<T> {
	get(id: FactId): MemoryFragment<T> | undefined;
	has(id: FactId): boolean;
	readonly size: number;
	values(): IterableIterator<MemoryFragment<T>>;
}

export type ScoringPolicy<T> = (fragment: MemoryFragment<T>, store: StoreReadHandle<T>) => number;
export type DecayPolicy = (confidence: number, ageNs: bigint) => number;
export type AdmissionFilter<T> = (fragment: MemoryFragment<T>) => boolean;

/** Outcome / RL signal — write-back lever for continual learning. */
export interface OutcomeSignal {
	readonly factId: FactId;
	readonly reward: number;
}

/** Structured query (Q9-open-7 default surface). Serializable + inspectable. */
export interface MemoryQuery {
	/** Match any of these tags (OR). Omit for no tag filter. */
	readonly tags?: readonly string[];
	/** Bi-temporal "as of" — only facts valid at this instant. */
	readonly asOf?: bigint;
	/** Minimum confidence (inclusive). */
	readonly minConfidence?: number;
	/** Cap results (sorted by confidence desc, then t_ns desc). */
	readonly limit?: number;
}

export interface MemoryAnswer<T> {
	readonly query: MemoryQuery;
	readonly results: readonly MemoryFragment<T>[];
}

export type CascadeReason = "cascade" | "obsolete" | "manual";

/** A single cascade invalidation message flowing through the cascade cycle. */
export interface CascadeEvent {
	readonly factId: FactId;
	readonly rootFactId: FactId;
	readonly reason: CascadeReason;
	/**
	 * The triggering root fact's own `validTo`. Cascade-invalidated dependents
	 * inherit this (NOT a fresh wall-clock read), so the store is a
	 * deterministic rebuildable projection: replaying the same ingest stream
	 * yields byte-identical `validTo` on cascade-invalidated fragments. Each
	 * dependent inherits the `validTo` of the *nearest obsolete fact that
	 * drove its invalidation*: in a pure chain A→B→C where only A is
	 * explicitly obsoleted, B and C both inherit A's `validTo` (B has no own
	 * `validTo`, so when B becomes a cascade root the detector reads
	 * `B.validTo` === A's value). If an intermediate B is itself explicitly
	 * obsoleted with its *own* `validTo`, B's dependents inherit B's value,
	 * not A's — "stale from when its driving source was invalidated."
	 * Deterministic either way. Always defined: only obsolete facts
	 * (`validTo` set) drive the cascade as roots.
	 */
	readonly rootValidTo: bigint;
	/** Cascade recursion depth (1 = first wave). Bounded by `cascadeMaxIterations`. */
	readonly iteration: number;
	/**
	 * Human-readable causal chain — makes the `dependentsIndex` fn-body lookup
	 * visible in `explain()` output even though it is not a topology edge
	 * (design Q3 / COMPOSITION-GUIDE §24 mitigation).
	 */
	readonly causalReason: string;
}

/** Per-batch overflow summary (Q9-open-4 — never per-message). */
export interface CascadeOverflow {
	readonly droppedCount: number;
	readonly sample: readonly FactId[];
	readonly rootFactId: FactId;
}

export interface ReviewRequest {
	readonly factId: FactId;
	readonly confidence: number;
	readonly threshold: number;
}

export interface FactStoreAuditRecord extends BaseAuditRecord {
	readonly action: "ingest" | "invalidate" | "outcome" | "consolidate" | "overflow";
	readonly id?: FactId;
	readonly reason?: CascadeReason;
}

export interface ReactiveFactStoreConfig<T> {
	// ① Function hooks (no reactive policy needed).
	readonly extractDependencies: (f: MemoryFragment<T>) => readonly FactId[];
	/** Shard partition fn. Default: FNV-1a hash of `id` mod `shardCount`. */
	readonly shardBy?: (f: MemoryFragment<T>) => ShardKey;
	/** Shard count for the default hash-mod sharder. Default 4 (§3.2). */
	readonly shardCount?: number;

	// ② Node<Policy> hooks (reactive — policy itself can evolve).
	readonly scoring?: Node<ScoringPolicy<T>>;
	readonly decay?: Node<DecayPolicy>;
	readonly admissionFilter?: Node<AdmissionFilter<T>>;

	// ③ Topic inputs (caller wires upstream sources).
	readonly ingest: Node<MemoryFragment<T>>;
	readonly outcome?: Node<OutcomeSignal>;
	readonly query?: Node<MemoryQuery>;
	/**
	 * Consolidator trigger — a reactive timer/cron Node (e.g. `fromCron(...)`).
	 * When supplied, the `consolidated` node maps each tick to summarized
	 * fragments emitted on the `consolidated` topic and default-wired back to
	 * the internal ingest path.
	 */
	readonly consolidateTrigger?: Node<unknown>;
	/**
	 * Consolidation summarizer. Reads a store snapshot, returns successor
	 * fragments (typically with `parent_fragment_id` set). Default: no-op
	 * (emits nothing) so the cron tick is observable without forcing a policy.
	 */
	readonly consolidate?: (store: StoreReadHandle<T>) => readonly MemoryFragment<T>[];

	// Invariants.
	/** Cascade recursion cap (§3.1). Default 8. */
	readonly cascadeMaxIterations?: number;
	/** Confidence below which a {@link ReviewRequest} is emitted. Default 0.3. */
	readonly reviewThreshold?: number;

	// Persistence.
	/**
	 * Record every committed fragment (post-admission-filter, with full
	 * payload) into a replayable {@link ReactiveFactStoreGraph.ingestLog}.
	 * Default `false` (the log retains every fragment in memory — opt in only
	 * when you intend to persist + replay).
	 *
	 * Enables the canonical **rebuildable-projection** recipe: the store is a
	 * deterministic projection of its ingest stream (cascade `validTo` is
	 * derived from the triggering root, not wall-clock; consolidator successors
	 * are re-derived from replayed state, not logged — the projection is still
	 * deterministic), so persisting the ingest log and replaying it on restart
	 * reconstructs a byte-identical store. Pair with the BigInt-safe codec
	 * ({@link MemoryFragment} carries `bigint` time fields). The tier MUST be
	 * `mode:"append"` (the default) — `attachStorage` ships per-wave deltas, so
	 * an `"overwrite"` tier would truncate the log (and `attachStorage` now
	 * throws on one).
	 *
	 * **First run — persist:**
	 * ```ts
	 * import { reactiveFactStore } from "@graphrefly/graphrefly";
	 * import { appendLogStorage, bigintJsonCodecFor } from "@graphrefly/pure-ts/extra";
	 *
	 * const tier = appendLogStorage(backend, {
	 *   name: "facts-ingest",
	 *   codec: bigintJsonCodecFor<readonly MemoryFragment<Doc>[]>(),
	 * });
	 * const mem = reactiveFactStore<Doc>({ ingest, extractDependencies, recordIngest: true });
	 * mem.ingestLog!.attachStorage([tier]); // forwards every committed fragment
	 * ```
	 *
	 * **Restart — replay (rebuild the projection):** read the persisted entries
	 * and feed them through `config.ingest`. Replay is just the reactive input —
	 * there is no imperative restore primitive.
	 * ```ts
	 * const { entries } = await tier.loadEntries!();
	 * const mem = reactiveFactStore<Doc>({ ingest, extractDependencies });
	 * for (const f of entries) ingest.emit(f); // identical store rebuilt
	 * ```
	 *
	 * **Do NOT do both at once.** On restart, either replay through `ingest`
	 * (above) **or** rely on `attachStorage`'s auto-restore — never both:
	 * `attachStorage` restores the persisted entries into a fresh `ingestLog`,
	 * and a manual replay loop would then re-append + re-persist them (doubling
	 * the durable log every restart). If you want continued persistence on the
	 * rebuilt store, set `recordIngest:true` and call `attachStorage([tier])`
	 * **after** the replay loop completes (the log already holds the replayed
	 * fragments, so `attachStorage` ships no spurious deltas).
	 *
	 * **Memory:** the in-memory log is unbounded (every committed fragment is
	 * retained for the store's lifetime). For a long-lived high-volume store,
	 * `ingestLog.trimHead(n)` after a confirmed `tier.flush()` bounds it (the
	 * durable tier remains the full record).
	 */
	readonly recordIngest?: boolean;
}

export interface ReactiveFactStoreGraph<T> extends Graph {
	// ④ Topic outputs (caller subscribes for custom processing).
	/** Per-shard `state<FactStore<T>>` nodes (length = shard count). */
	readonly shards: readonly Node<FactStore<T>>[];
	/** Unified read view across all shards (derived). */
	readonly factStore: Node<FactStore<T>>;
	readonly dependentsIndex: Node<DependentsIndex>;
	readonly answer: Node<MemoryAnswer<T> | null>;
	readonly cascade: Node<readonly CascadeEvent[]>;
	readonly cascadeOverflow: Node<CascadeOverflow | null>;
	readonly review: Node<ReviewRequest | null>;
	readonly consolidated: Node<readonly MemoryFragment<T>[]>;
	readonly events: ReactiveLogBundle<FactStoreAuditRecord>;
	/**
	 * Payload-carrying, replayable log of every committed fragment. Present iff
	 * {@link ReactiveFactStoreConfig.recordIngest} is `true`. Unlike
	 * {@link ReactiveFactStoreGraph.events} (action-only audit), each entry is
	 * the full {@link MemoryFragment} — `attachStorage` it for a durable,
	 * replayable projection source (see `recordIngest` docs for the recipe).
	 */
	readonly ingestLog?: ReactiveLogBundle<MemoryFragment<T>>;
	/** Reactive read: a single fact by id (SENTINEL until the fact exists). */
	itemNode(id: FactId): Node<MemoryFragment<T> | undefined>;
}

// ── Constants ────────────────────────────────────────────────────────────

/**
 * Max number of dropped cascade-target ids included in a {@link CascadeOverflow}
 * `sample`. Deliberately decoupled from `cascadeMaxIterations` — it bounds the
 * diagnostic payload size, not the recursion budget.
 */
const OVERFLOW_SAMPLE_SIZE = 8;

// ── Helpers ──────────────────────────────────────────────────────────────

function factMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("memory", kind, extra);
}

/** Deterministic, universal-safe FNV-1a 32-bit string hash (no `node:crypto`). */
function fnv1a(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i += 1) {
		h ^= s.charCodeAt(i);
		// 32-bit FNV prime multiply via shifts (avoids BigInt / float drift).
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
	}
	return h >>> 0;
}

function makeReadHandle<T>(byId: ReadonlyMap<FactId, MemoryFragment<T>>): StoreReadHandle<T> {
	return {
		get: (id) => byId.get(id),
		has: (id) => byId.has(id),
		get size() {
			return byId.size;
		},
		values: () => byId.values(),
	};
}

/** Bi-temporal validity test: is `f` valid at instant `asOf`? */
function currentlyValid<T>(f: MemoryFragment<T>, asOf?: bigint): boolean {
	if (asOf === undefined) return f.validTo === undefined;
	if (f.validFrom !== undefined && asOf < f.validFrom) return false;
	if (f.validTo !== undefined && asOf >= f.validTo) return false;
	return true;
}

function lastOf<X>(batch: readonly unknown[] | undefined, prev: unknown): X | undefined {
	return batch != null && batch.length > 0 ? (batch.at(-1) as X) : (prev as X | undefined);
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Build a static-topology reactive fact store (DS-14.7 architecture C).
 *
 * Topology (~12 fixed nodes — never grows with fact count):
 *  - `shards[0..N]` — `state<FactStore<T>>` columnar stores (default 4 shards).
 *  - `factStore` — derived union read view across shards.
 *  - `dependentsIndex` — `state<DependentsIndex>` reverse-dep map, unsharded,
 *    updated synchronously + atomically with each commit (Q9-open-2).
 *  - `extractOp` — derived: ingest → admission-filtered fragment + dep edges.
 *  - `invalidationDetector` — derived: scans committed store for `validTo`-set
 *    / low-confidence facts, resolves dependents via `dependentsIndex`, emits
 *    cascade messages.
 *  - `cascade` — topic node carrying `CascadeEvent[]`.
 *  - `cascadeProcessor` — derived, **synchronous**, `meta.cycle:"cascade"`:
 *    dedupes by factId, writes invalidations back to shards, recurses until
 *    fixpoint OR `cascadeMaxIterations` → `cascadeOverflow`.
 *  - `cascadeOverflow` — per-batch overflow summary node.
 *  - `queryOp` / `answer` — structured `MemoryQuery` → results (SENTINEL-safe).
 *  - `outcomeProcessor` — outcome signal → confidence write-back.
 *  - `consolidated` — cron-tick → summarized fragments on the
 *    `consolidated` topic,
 *    default-wired back into the ingest path.
 *  - `review` — low-confidence proactive-verification requests.
 *
 * The cascade cycle (`invalidationDetector → cascade → cascadeProcessor →
 * shards → invalidationDetector`) is a real, bounded reactive cycle. Both
 * `invalidationDetector` and `cascadeProcessor` are tagged
 * `meta.cycle:"cascade"` and every cascade message carries `causalReason`, so
 * `describe()` / `explain()` surface the otherwise-invisible
 * `dependentsIndex` lookup (COMPOSITION-GUIDE §24).
 *
 * @category memory
 */
export function reactiveFactStore<T>(
	config: ReactiveFactStoreConfig<T>,
): ReactiveFactStoreGraph<T> {
	const shardCount = Math.max(1, config.shardCount ?? 4);
	const maxIterations = Math.max(1, config.cascadeMaxIterations ?? 8);
	const reviewThreshold = config.reviewThreshold ?? 0.3;
	const shardBy = config.shardBy ?? ((f: MemoryFragment<T>) => fnv1a(String(f.id)) % shardCount);

	// Cascade recursion depth counter. Reset to 0 on every external ingest
	// (a fresh root = a fresh cascade budget) and on a true fixpoint (detector
	// emits `[]`). Bounded by `maxIterations`; overflow stops the recursion.
	// This counter is a *backstop* for pathological cycles only — primary
	// termination is the per-root semantic contract below (F1/F5).
	let cascadeIteration = 0;

	// F1/F5 — per-root cascade dedupe across waves. A fact only enters the
	// cascade as a root when it transitions to obsolete (`validTo` set), and
	// a given obsolete root emits its cascade exactly ONCE across all waves.
	// `processedRoots` tracks root ids that have already emitted; a root
	// re-detected in a later wave WITHOUT a new obsolescence transition does
	// not re-emit. This bounds the loop by the finite set of newly-obsolete
	// roots per external change, independent of `cascadeIteration` resets
	// (which an ingest / consolidator wire-back would otherwise defeat).
	const processedRoots = new Set<FactId>();

	const graph = new Graph("reactive_fact_store") as ReactiveFactStoreGraph<T>;

	const events = createAuditLog<FactStoreAuditRecord>({
		name: "events",
		retainedLimit: 1024,
		graph,
	});
	const seqCursor = registerCursor(graph, "seq", 0);

	// Opt-in payload-carrying ingest log (rebuildable-projection source).
	// Fed from `ingestAudit` (every committed fragment, post-admission).
	const ingestLog: ReactiveLogBundle<MemoryFragment<T>> | undefined = config.recordIngest
		? reactiveLog<MemoryFragment<T>>([], { name: "ingest_log" })
		: undefined;
	if (ingestLog) graph.addDisposer(() => ingestLog.dispose());

	// ── shards: state<FactStore<T>> ──────────────────────────────────────
	const emptyStore = (): FactStore<T> => ({ byId: new Map() });
	const shards: Node<FactStore<T>>[] = [];
	for (let s = 0; s < shardCount; s += 1) {
		const shard = node<FactStore<T>>([], {
			initial: emptyStore(),
			name: `shard_${s}`,
			describeKind: "state",
			meta: factMeta("factstore", { shard: s }),
		});
		graph.add(shard, { name: `shard_${s}` });
		graph.addDisposer(keepalive(shard));
		shards.push(shard);
	}

	const shardIndexFor = (f: MemoryFragment<T>): number => {
		const key = shardBy(f);
		const n = typeof key === "number" ? key : fnv1a(String(key));
		const idx = ((n % shardCount) + shardCount) % shardCount;
		return idx;
	};

	// Resolve which shard a given id lives in by scanning current snapshots
	// (cascade write-backs reference ids without re-deriving the fragment).
	const findShardOf = (id: FactId): number => {
		for (let s = 0; s < shardCount; s += 1) {
			const fs = shards[s]!.cache as FactStore<T> | undefined;
			if (fs?.byId.has(id)) return s;
		}
		return -1;
	};

	const allFacts = (): Map<FactId, MemoryFragment<T>> => {
		const out = new Map<FactId, MemoryFragment<T>>();
		for (const sh of shards) {
			const fs = sh.cache as FactStore<T> | undefined;
			if (!fs) continue;
			for (const [k, v] of fs.byId) out.set(k, v);
		}
		return out;
	};

	const commitFragment = (f: MemoryFragment<T>): void => {
		const idx = shardIndexFor(f);
		const cur = (shards[idx]!.cache as FactStore<T> | undefined) ?? emptyStore();
		const next = new Map(cur.byId);
		next.set(f.id, f);
		shards[idx]!.emit({ byId: next });
	};

	const replaceFragment = (
		id: FactId,
		mut: (prev: MemoryFragment<T>) => MemoryFragment<T>,
	): boolean => {
		const idx = findShardOf(id);
		if (idx < 0) return false;
		const cur = shards[idx]!.cache as FactStore<T>;
		const prev = cur.byId.get(id);
		if (!prev) return false;
		const next = new Map(cur.byId);
		next.set(id, mut(prev));
		shards[idx]!.emit({ byId: next });
		return true;
	};

	// ── dependentsIndex: state<DependentsIndex>, unsharded ───────────────
	const dependentsIndex = node<DependentsIndex>([], {
		initial: new Map() as DependentsIndex,
		name: "dependents_index",
		describeKind: "state",
		meta: factMeta("factstore", { role: "dependents_index" }),
	});
	graph.add(dependentsIndex, { name: "dependents_index" });
	graph.addDisposer(keepalive(dependentsIndex));

	// Synchronous + atomic with the commit (Q9-open-2): add reverse edges
	// `source → [..., fact.id]` for every dependency the fragment declares.
	const indexFragment = (f: MemoryFragment<T>, deps: readonly FactId[]): void => {
		const cur = dependentsIndex.cache as DependentsIndex;
		const next = new Map<FactId, FactId[]>();
		for (const [k, v] of cur) next.set(k, [...v]);
		for (const src of deps) {
			const bucket = next.get(src) ?? [];
			if (!bucket.includes(f.id)) bucket.push(f.id);
			next.set(src, bucket);
		}
		dependentsIndex.emit(next as DependentsIndex);
	};

	// ── factStore: unified read view (derived union over shards) ─────────
	const factStore = node<FactStore<T>>(
		shards,
		(batchData, actions, ctx) => {
			void batchData;
			void ctx;
			actions.emit({ byId: allFacts() });
		},
		{
			name: "fact_store",
			describeKind: "derived",
			initial: emptyStore(),
			meta: factMeta("factstore", { role: "read_view" }),
			// F10a: `allFacts()` builds a fresh Map every detector retrigger.
			// Fragments are immutable (replaced wholesale on mutation), so a
			// same-size + per-key-identity check is a sound structural equality
			// that stops `factStore` (and its `review` dependent) from re-firing
			// every cascade wave when nothing actually changed.
			equals: (a: FactStore<T>, b: FactStore<T>) => {
				if (a === b) return true;
				if (a.byId.size !== b.byId.size) return false;
				for (const [k, v] of a.byId) {
					if (b.byId.get(k) !== v) return false;
				}
				return true;
			},
		},
	);
	graph.add(factStore, { name: "fact_store" });
	graph.addDisposer(keepalive(factStore));

	// ── extractOp: ingest → admission filter → commit + index ────────────
	const extractOp = node<MemoryFragment<T> | null>(
		config.admissionFilter ? [config.ingest, config.admissionFilter] : [config.ingest],
		(batchData, actions, ctx) => {
			const f = lastOf<MemoryFragment<T>>(batchData[0], ctx.prevData[0]);
			if (f == null) {
				actions.emit(null);
				return;
			}
			if (config.admissionFilter) {
				const filter = lastOf<AdmissionFilter<T>>(batchData[1], ctx.prevData[1]);
				if (filter && !filter(f)) {
					actions.emit(null);
					return;
				}
			}
			const deps = config.extractDependencies(f);
			// External ingest = a fresh cascade root → reset the depth budget.
			cascadeIteration = 0;
			// F1/F5: a (re-)ingested id is a fresh fact version. Clear it from
			// `processedRoots` so a NEW obsolescence transition on this id
			// (e.g. re-ingest with `validTo` set) re-drives the cascade exactly
			// once, rather than being permanently suppressed.
			processedRoots.delete(f.id);
			// Synchronous + atomic: commit fragment, then index its dep edges.
			commitFragment(f);
			indexFragment(f, deps);
			actions.emit(f);
		},
		{
			name: "extract_op",
			describeKind: "derived",
			meta: factMeta("extract"),
		},
	);
	graph.add(extractOp, { name: "extract_op" });
	graph.addDisposer(keepalive(extractOp));

	// ── invalidationDetector: store → cascade messages ───────────────────
	// F1/F5 per-root semantic contract: a fact drives the cascade as a root
	// ONLY when it is obsolete (`validTo` set). A low-confidence-but-still-live
	// fact (no `validTo`) does NOT by itself emit a cascade — it surfaces via
	// the `review` topic instead, so it cannot perpetually re-emit a cascade
	// every detector pass. Each obsolete root emits its cascade exactly once
	// across all waves (`processedRoots` dedupe): a root re-detected in a later
	// wave without a fresh obsolescence transition is skipped. Termination is
	// therefore bounded by the finite set of newly-obsolete roots per external
	// change — robust against `cascadeIteration` resets from ingest /
	// consolidator wire-back. The empty-array emit is the fixpoint
	// short-circuit; `cascadeMaxIterations` remains a backstop for pathological
	// LLM-extracted cycles (A→B→A) only.
	const invalidationDetector = node<readonly CascadeEvent[]>(
		[...shards],
		(batchData, actions, ctx) => {
			void batchData;
			void ctx;
			const facts = allFacts();
			const index = dependentsIndex.cache as DependentsIndex;
			const out: CascadeEvent[] = [];
			const seen = new Set<FactId>();
			for (const f of facts.values()) {
				// F1/F5(a): ONLY obsolete facts drive the cascade as roots. A
				// low-confidence-but-still-live fact is handled by `review`,
				// never by the cascade loop.
				const obsolete = f.validTo !== undefined;
				if (!obsolete) continue;
				// F1/F5(b): each obsolete root emits its cascade exactly once
				// across all waves. A root re-detected later (still obsolete,
				// no fresh transition) is skipped — convergence is independent
				// of `cascadeIteration` resets.
				if (processedRoots.has(f.id)) continue;
				const dependents = index.get(f.id) ?? [];
				for (const dep of dependents) {
					// F3: only cascade onto dependents that are still live. A
					// non-existent fact (phantom edge — `extractDependencies`
					// named an un-ingested FactId) is NOT a live dependent;
					// neither is a dependent already carrying `validTo`.
					const depFact = facts.get(dep);
					if (!depFact || depFact.validTo !== undefined) continue;
					const k = `${f.id}->${dep}`;
					if (seen.has(k)) continue;
					seen.add(k);
					out.push({
						factId: dep,
						rootFactId: f.id,
						reason: "obsolete",
						// `obsolete` guard above guarantees `f.validTo` is set.
						rootValidTo: f.validTo as bigint,
						iteration: cascadeIteration + 1,
						causalReason: `dependentsIndex[${f.id}] → ${dep} (obsolete: validTo set)`,
					});
				}
				// Mark the root processed once considered (whether or not it
				// had a still-live dependent) — it must not re-drive a later
				// wave without a fresh obsolescence transition.
				processedRoots.add(f.id);
			}
			if (out.length === 0) {
				// True fixpoint — reset the depth counter so the next external
				// root starts a fresh cascade budget.
				cascadeIteration = 0;
			}
			actions.emit(out);
		},
		{
			name: "invalidation_detector",
			describeKind: "derived",
			initial: [] as readonly CascadeEvent[],
			meta: factMeta("invalidation", { cycle: "cascade" }),
		},
	);
	graph.add(invalidationDetector, { name: "invalidation_detector" });
	graph.addDisposer(keepalive(invalidationDetector));

	// ── cascade topic node ───────────────────────────────────────────────
	const cascade = node<readonly CascadeEvent[]>(
		[invalidationDetector],
		(batchData, actions, ctx) => {
			const evts = lastOf<readonly CascadeEvent[]>(batchData[0], ctx.prevData[0]) ?? [];
			actions.emit(evts);
		},
		{
			name: "cascade",
			describeKind: "derived",
			initial: [] as readonly CascadeEvent[],
			meta: factMeta("cascade_topic", { cycle: "cascade" }),
		},
	);
	graph.add(cascade, { name: "cascade" });
	graph.addDisposer(keepalive(cascade));

	// ── cascadeOverflow (per-batch summary, Q9-open-4) ───────────────────
	const cascadeOverflow = node<CascadeOverflow | null>([], {
		initial: null,
		name: "cascade_overflow",
		describeKind: "state",
		meta: factMeta("cascade_overflow"),
	});
	graph.add(cascadeOverflow, { name: "cascade_overflow" });
	graph.addDisposer(keepalive(cascadeOverflow));

	// ── cascadeProcessor (SYNCHRONOUS, meta.cycle:"cascade") ─────────────
	// Per-wave dedupe by target factId, mark each dependent obsolete
	// (write-back → re-triggers invalidationDetector), bounded by
	// `cascadeMaxIterations`. NOTE: this is DATA-array dedupe, NOT spec §1.4
	// INVALIDATE idempotency — termination comes from the detector's
	// obsolete-only + per-root-once contract plus the empty-array fixpoint
	// short-circuit, not a spec §1.4 guarantee.
	const cascadeProcessor = node<readonly CascadeEvent[]>(
		[cascade],
		(batchData, actions, ctx) => {
			const evts = lastOf<readonly CascadeEvent[]>(batchData[0], ctx.prevData[0]) ?? [];
			if (evts.length === 0) {
				actions.emit([]);
				return;
			}
			// Dedupe by target factId (diamond-merge at message granularity).
			const byId = new Map<FactId, CascadeEvent>();
			for (const e of evts) if (!byId.has(e.factId)) byId.set(e.factId, e);

			cascadeIteration += 1;
			if (cascadeIteration > maxIterations) {
				// Cap hit (pathological dependency web / cycle). Emit a
				// per-batch overflow summary (Q9-open-4) and STOP the recursion
				// definitively: do NOT write back (no shard mutation → detector
				// does not re-fire) and settle the cascade topic with `[]` so
				// the cycle breaks. `cascadeIteration` stays above the cap until
				// the next external ingest resets it (via extractOp), so a
				// degenerate cycle cannot immediately re-enter.
				const sample = [...byId.keys()].slice(0, OVERFLOW_SAMPLE_SIZE);
				const rootFactId = evts[0]?.rootFactId ?? "";
				cascadeOverflow.emit({
					droppedCount: byId.size,
					sample,
					rootFactId,
				});
				events.append({
					action: "overflow",
					reason: "cascade",
					id: rootFactId,
					t_ns: wallClockNs(),
					seq: bumpCursor(seqCursor),
				});
				actions.emit([]);
				return;
			}

			// Write-back: mark each dependent obsolete iff not already. Each
			// shard `emit` re-triggers `invalidationDetector` (it deps on
			// `[...shards]`) — that IS the recursion edge. No separate trigger
			// node is needed; the detector's "still live" predicate plus the
			// empty-emit fixpoint reset terminate the cycle.
			// Deterministic: the dependent inherits the triggering root's own
			// `validTo` (NOT a fresh `monotonicNs()` read), so replaying the
			// same ingest stream yields byte-identical `validTo`. Transitive
			// chains inherit the original root's time.
			for (const [id, e] of byId) {
				replaceFragment(id, (prev) =>
					prev.validTo !== undefined ? prev : { ...prev, validTo: e.rootValidTo },
				);
			}
			actions.emit([...byId.values()]);
		},
		{
			name: "cascade_processor",
			describeKind: "derived",
			initial: [] as readonly CascadeEvent[],
			meta: factMeta("cascade_processor", { cycle: "cascade" }),
		},
	);
	graph.add(cascadeProcessor, { name: "cascade_processor" });
	graph.addDisposer(keepalive(cascadeProcessor));

	// ── review: low-confidence proactive verification ────────────────────
	const review = node<ReviewRequest | null>(
		[factStore],
		(batchData, actions, ctx) => {
			const fs = lastOf<FactStore<T>>(batchData[0], ctx.prevData[0]);
			if (fs == null) {
				actions.emit(null);
				return;
			}
			for (const f of fs.byId.values()) {
				if (f.confidence < reviewThreshold && f.validTo === undefined) {
					actions.emit({
						factId: f.id,
						confidence: f.confidence,
						threshold: reviewThreshold,
					});
					return;
				}
			}
			actions.emit(null);
		},
		{
			name: "review",
			describeKind: "derived",
			initial: null,
			meta: factMeta("review"),
			// F10a: dedupe on the requested factId (null === no request) so a
			// stable low-confidence fact does not re-emit a review every wave.
			equals: (a: ReviewRequest | null, b: ReviewRequest | null) =>
				(a?.factId ?? null) === (b?.factId ?? null),
		},
	);
	graph.add(review, { name: "review" });
	graph.addDisposer(keepalive(review));

	// ── outcomeProcessor: RL signal → confidence write-back ──────────────
	if (config.outcome) {
		const outcomeProcessor = node<OutcomeSignal | null>(
			config.scoring ? [config.outcome, config.scoring] : [config.outcome],
			(batchData, actions, ctx) => {
				const sig = lastOf<OutcomeSignal>(batchData[0], ctx.prevData[0]);
				if (sig == null) {
					actions.emit(null);
					return;
				}
				replaceFragment(sig.factId, (prev) => {
					let nextConf = prev.confidence;
					if (config.scoring) {
						const policy = lastOf<ScoringPolicy<T>>(batchData[1], ctx.prevData[1]);
						if (policy) {
							nextConf = policy(prev, makeReadHandle(allFacts()));
						}
					} else {
						nextConf = Math.max(0, Math.min(1, prev.confidence + sig.reward));
					}
					return { ...prev, confidence: nextConf };
				});
				actions.emit(sig);
			},
			{
				name: "outcome_processor",
				describeKind: "derived",
				initial: null,
				meta: factMeta("outcome"),
			},
		);
		graph.add(outcomeProcessor, { name: "outcome_processor" });
		graph.addDisposer(keepalive(outcomeProcessor));
	}

	// ── queryOp / answer (structured MemoryQuery, SENTINEL-safe) ─────────
	// Per COMPOSITION-GUIDE §3/§10: `answer` emits `null` while there has been
	// no query yet (SENTINEL on the query dep). Downstream consumers use the
	// `=== null` guard.
	const answer = node<MemoryAnswer<T> | null>(
		config.query ? [config.query, factStore] : [factStore],
		(batchData, actions, ctx) => {
			if (!config.query) {
				actions.emit(null);
				return;
			}
			const q = lastOf<MemoryQuery>(batchData[0], ctx.prevData[0]);
			const fs = lastOf<FactStore<T>>(batchData[1], ctx.prevData[1]);
			if (q == null) {
				// No query has been issued yet — null per the SENTINEL guard.
				actions.emit(null);
				return;
			}
			const store = fs ?? emptyStore();
			let results = [...store.byId.values()].filter((f) => {
				if (q.tags && q.tags.length > 0 && !q.tags.some((t) => f.tags.includes(t))) {
					return false;
				}
				if (q.minConfidence !== undefined && f.confidence < q.minConfidence) return false;
				if (!currentlyValid(f, q.asOf)) return false;
				return true;
			});
			results.sort((a, b) => b.confidence - a.confidence || Number(b.t_ns - a.t_ns));
			if (q.limit !== undefined) results = results.slice(0, Math.max(0, q.limit));
			actions.emit({ query: q, results });
		},
		{
			name: "answer",
			describeKind: "derived",
			initial: null,
			meta: factMeta("query", { role: "output" }),
		},
	);
	graph.add(answer, { name: "answer" });
	graph.addDisposer(keepalive(answer));

	// ── consolidator (cron-fed) → consolidated topic → wired back ────────
	const consolidated = node<readonly MemoryFragment<T>[]>(
		config.consolidateTrigger ? [config.consolidateTrigger] : [],
		(batchData, actions, ctx) => {
			void batchData;
			void ctx;
			if (!config.consolidateTrigger || !config.consolidate) {
				actions.emit([]);
				return;
			}
			const fragments = config.consolidate(makeReadHandle(allFacts()));
			// Default wire-back into the ingest path (Q9-open-6): the pattern
			// commits + indexes successor fragments; callers that need to gate
			// can subscribe to `consolidated` and intercept.
			for (const f of fragments) {
				const deps = config.extractDependencies(f);
				// F1/F5: wired-back successor is a fresh fact version — same
				// processedRoots reset as the ingest path so a later obsolescence
				// of this id can re-cascade exactly once.
				processedRoots.delete(f.id);
				commitFragment(f);
				indexFragment(f, deps);
				events.append({
					action: "consolidate",
					id: f.id,
					t_ns: wallClockNs(),
					seq: bumpCursor(seqCursor),
				});
			}
			actions.emit(fragments);
		},
		{
			name: "consolidated",
			describeKind: "derived",
			initial: [] as readonly MemoryFragment<T>[],
			meta: factMeta("consolidator"),
		},
	);
	graph.add(consolidated, { name: "consolidated" });
	graph.addDisposer(keepalive(consolidated));

	// ── ingest audit (records every committed fragment) ──────────────────
	const ingestAudit = node<MemoryFragment<T> | null>(
		[extractOp],
		(batchData, actions, ctx) => {
			const f = lastOf<MemoryFragment<T> | null>(batchData[0], ctx.prevData[0]);
			if (f != null) {
				events.append({
					action: "ingest",
					id: f.id,
					t_ns: wallClockNs(),
					seq: bumpCursor(seqCursor),
				});
				// Payload-carrying replay log (opt-in). Append the full
				// committed fragment so the store is a rebuildable projection.
				ingestLog?.append(f);
			}
			actions.emit(f ?? null);
		},
		{
			name: "_ingest_audit",
			describeKind: "derived",
			initial: null,
			meta: factMeta("audit"),
		},
	);
	graph.add(ingestAudit, { name: "_ingest_audit" });
	graph.addDisposer(keepalive(ingestAudit));

	// ── itemNode reactive read ───────────────────────────────────────────
	function itemNode(id: FactId): Node<MemoryFragment<T> | undefined> {
		return node<MemoryFragment<T> | undefined>(
			[factStore],
			(batchData, actions, ctx) => {
				const fs = lastOf<FactStore<T>>(batchData[0], ctx.prevData[0]);
				actions.emit(fs?.byId.get(id));
			},
			{
				name: `item_${id}`,
				describeKind: "derived",
				meta: factMeta("item"),
			},
		);
	}

	const out = Object.assign(graph, {
		shards: shards as readonly Node<FactStore<T>>[],
		factStore,
		dependentsIndex,
		answer,
		cascade,
		cascadeOverflow,
		review,
		consolidated,
		events,
		...(ingestLog ? { ingestLog } : {}),
		itemNode,
	}) as ReactiveFactStoreGraph<T>;
	return out;
}
