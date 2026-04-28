/**
 * Memory patterns (roadmap §4.3) — public-face Phase-4 primitives audited under
 * `archive/docs/SESSION-public-face-blocks-review.md` (Wave A, locked 2026-04-25).
 *
 * Four primitives (the pure `decay` helper was promoted to `extra/utils/decay.ts`
 * per Tier 2.2 and is no longer re-exported here):
 * - {@link lightCollection} — Map + LRU eviction + audit log; non-Graph bundle.
 * - {@link collection} / {@link CollectionGraph} — scored memory store with live
 *   decay-ranking via reactive timer dep.
 * - {@link vectorIndex} / {@link VectorIndexGraph} — reactive vector store with
 *   optional HNSW backend, retention, and reactive {@link VectorIndexGraph.searchNode}.
 * - {@link knowledgeGraph} / {@link KnowledgeGraph} — entities + typed edges with
 *   symmetric adjacency indexes and reactive {@link KnowledgeGraph.relatedNode}.
 *
 * **No imperative reads.** Per the API-style policy locked 2026-04-25, public-face
 * primitives expose reactive reads only — `itemNode` / `hasNode` / `searchNode` /
 * `relatedNode`. One-shot snapshots use `node.cache` after `awaitSettled`, or
 * `firstValueFrom(node)`.
 *
 * **Audit logs.** Every imperative mutation (`upsert / remove / clear / link /
 * unlink / rescore / reindex`) is wrapped via {@link lightMutation} and appends a
 * typed record to a public `events` log on the bundle / graph.
 *
 * @module
 */

import { monotonicNs, wallClockNs } from "../../core/clock.js";
import { type Node, NodeImpl } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
import { domainMeta } from "../../extra/meta.js";
import {
	type BaseAuditRecord,
	bumpCursor,
	createAuditLog,
	lightMutation,
	registerCursor,
} from "../../extra/mutation/index.js";
import type { ReactiveLogBundle } from "../../extra/reactive-log.js";
import { reactiveMap } from "../../extra/reactive-map.js";
import { fromTimer, keepalive } from "../../extra/sources.js";
import { decay } from "../../extra/utils/decay.js";
import { Graph } from "../../graph/graph.js";

// ── Shared helpers ───────────────────────────────────────────────────────

const NS_PER_SEC = 1_000_000_000;

function memoryMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("memory", kind, extra);
}

/**
 * Coerce a value-or-Node argument into a `Node<T>`. Pass-through if already a
 * Node; otherwise wraps in `state(value, {name})`. Used by reactive read
 * factories (`itemNode` / `searchNode` / `relatedNode`) so callers can supply
 * a static value without manually creating a state node.
 *
 * Heuristic: anything that is a `NodeImpl` instance is a Node; everything else
 * is treated as a raw value to wrap.
 */
function toNode<T>(v: T | Node<T>, name?: string): Node<T> {
	if (v instanceof NodeImpl) return v as Node<T>;
	return state<T>(v as T, name ? { name } : undefined);
}

function ageSeconds(now: number, lastNs: number): number {
	return (now - lastNs) / NS_PER_SEC;
}

// `decay` was promoted to `extra/utils/decay.ts` per Tier 2.2 — it is no longer
// re-exported from this module. Import from `@graphrefly/graphrefly/extra` (or
// `../../extra/utils/decay.js` internally) instead.

/**
 * Cosine similarity over `(a, b)`. When lengths differ, the shorter is
 * implicitly zero-padded to the longer length. Returns `0` if either vector
 * has zero norm. Public utility — used by {@link VectorIndexGraph.searchNode}
 * and exposed for downstream consumers (e.g. `patterns/ai/memory/`) that need
 * the same scoring at the boundary.
 *
 * **Numeric guards.** Returns `0` for non-finite results (overflow producing
 * `Infinity`/`NaN` from very-large vectors, or `NaN` propagating from any
 * `NaN`/`Infinity` component). Without this guard, downstream sort
 * comparators would order NaN-scored rows arbitrarily.
 *
 * **Depth.** This is a per-call computation; no internal caching. For very
 * large indexes (>10k) consider precomputing norms or using HNSW.
 *
 * @category memory
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
	const n = Math.max(a.length, b.length);
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < n; i += 1) {
		const av = a[i] ?? 0;
		const bv = b[i] ?? 0;
		dot += av * bv;
		na += av * av;
		nb += bv * bv;
	}
	if (na === 0 || nb === 0) return 0;
	const score = dot / Math.sqrt(na * nb);
	return Number.isFinite(score) ? score : 0;
}

/**
 * Equality predicate for {@link VectorIndexGraph.searchNode} results. Compares
 * `id` AND `score` AND `meta` reference per position so that score-only changes
 * (re-upsert with new vector keeping the same top-K order) propagate to
 * downstream subscribers. The previous id-only comparator silently dropped
 * those updates.
 */
function searchResultsEqual<TMeta>(
	a: readonly VectorSearchResult<TMeta>[] | undefined,
	b: readonly VectorSearchResult<TMeta>[] | undefined,
): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		const x = a[i]!;
		const y = b[i]!;
		if (x.id !== y.id || x.score !== y.score || x.meta !== y.meta) return false;
	}
	return true;
}

// ── Common types ─────────────────────────────────────────────────────────

/** Public alias for the `Node | value` shape accepted by reactive read factories. */
export type NodeOrValue<T> = T | Node<T>;

// ── Unit 2: lightCollection ──────────────────────────────────────────────

export type LightCollectionEntry<T> = {
	readonly id: string;
	readonly value: T;
	readonly createdAtNs: number;
	readonly lastAccessNs: number;
};

export type LightCollectionOptions = {
	name?: string;
	maxSize?: number;
};

export interface LightCollectionAuditRecord extends BaseAuditRecord {
	readonly action: "upsert" | "remove" | "clear";
	readonly id?: string;
}

export type LightCollectionBundle<T> = {
	readonly entries: Node<ReadonlyMap<string, LightCollectionEntry<T>>>;
	readonly events: ReactiveLogBundle<LightCollectionAuditRecord>;
	upsert: (id: string, value: T) => void;
	remove: (id: string) => void;
	clear: () => void;
	itemNode: (id: NodeOrValue<string>) => Node<LightCollectionEntry<T> | undefined>;
	hasNode: (id: NodeOrValue<string>) => Node<boolean>;
};

/**
 * Reactive Map of {@link LightCollectionEntry} with native LRU eviction by
 * `maxSize`. Backed by `reactiveMap` so iteration order, snapshot delivery,
 * and copy-on-write semantics match the rest of the data-structure tier.
 *
 * **No-Graph composition.** `bundle.entries` is a detached `state()` — mount
 * manually with `parent.add(bundle.entries)` for `describe()` / `lens.flow`
 * coverage.
 *
 * **`createdAtNs` preservation.** Re-upserting an existing id keeps the
 * original `createdAtNs`; only `lastAccessNs` advances. Eviction is purely
 * LRU-by-`lastAccessNs` (newest wins) via `reactiveMap`'s native `maxSize`.
 *
 * **No imperative reads.** Per the no-imperative-reads policy: subscribe to
 * `entries` for the live snapshot, or use `itemNode(id)` / `hasNode(id)` for
 * single-key reactive reads. For one-shot snapshots use `firstValueFrom` or
 * `node.cache` after `awaitSettled`.
 *
 * **Audit log freeze contract.** Mutations are wrapped via `lightMutation`,
 * which deep-freezes args at entry by default (per the Audit 2 framework).
 * That means the `value` you pass to `upsert(id, value)` is frozen by the
 * time it lands in `LightCollectionEntry.value`. If you store mutable
 * payloads and need them mutable post-upsert, opt out via `lightMutation`'s
 * `freeze: false` (currently internal — not exposed on the bundle; if you
 * hit this, file in `docs/optimizations.md`).
 *
 * **Audit no-op records.** Mutations record an audit entry even when the
 * impl was a no-op (`remove(id)` for a missing id, `clear()` on empty store).
 * The framework records attempts, not state changes — this is intentional
 * (see `_internal/imperative-audit.ts` rationale). Audit consumers that
 * reconstruct state by replaying records can ignore no-op redundant entries
 * without losing correctness.
 *
 * @category memory
 */
export function lightCollection<T>(opts: LightCollectionOptions = {}): LightCollectionBundle<T> {
	const maxSize = opts.maxSize;
	if (maxSize !== undefined && maxSize < 1) {
		throw new RangeError("lightCollection: maxSize must be >= 1");
	}

	const inner = reactiveMap<string, LightCollectionEntry<T>>({
		name: opts.name,
		...(maxSize !== undefined ? { maxSize } : {}),
	});
	const entries = inner.entries;

	// Audit log (unmounted — bundle is detached). Activate `withLatest` lazily
	// so callers can read `events.lastValue` without explicit setup.
	const events = createAuditLog<LightCollectionAuditRecord>({
		name: opts.name ? `${opts.name}_events` : "events",
		retainedLimit: 1024,
	});

	const upsertImpl = (id: string, value: T): void => {
		const now = monotonicNs();
		// Read prior `createdAtNs` from the snapshot Node — pure read, no LRU
		// touch and no version-counter advance. (`inner.get(id)` would also
		// preserve `version` but DOES touch the LRU position via the
		// internal `_touchLru` step, so it would re-order the entry to the
		// MRU end before we re-set it. Reading the snapshot avoids that
		// redundant reorder.)
		const prev = entries.cache?.get(id);
		inner.set(id, {
			id,
			value,
			createdAtNs: prev?.createdAtNs ?? now,
			lastAccessNs: now,
		});
	};
	const removeImpl = (id: string): void => {
		if (!inner.has(id)) return;
		inner.delete(id);
	};
	const clearImpl = (): void => {
		if (inner.size === 0) return;
		inner.clear();
	};

	const upsert = lightMutation(upsertImpl, {
		audit: events,
		onSuccess: ([id], _r, m) => ({ action: "upsert" as const, id, t_ns: m.t_ns }),
		onFailure: (_args, _err, m) => ({
			action: "upsert" as const,
			t_ns: m.t_ns,
			handlerVersion: { id: "lightCollection.upsert", version: 1 },
		}),
	});
	const remove = lightMutation(removeImpl, {
		audit: events,
		onSuccess: ([id], _r, m) => ({ action: "remove" as const, id, t_ns: m.t_ns }),
	});
	const clear = lightMutation(clearImpl, {
		audit: events,
		onSuccess: (_args, _r, m) => ({ action: "clear" as const, t_ns: m.t_ns }),
	});

	function itemNode(id: NodeOrValue<string>): Node<LightCollectionEntry<T> | undefined> {
		const idN = toNode(id, "id");
		return derived(
			[entries, idN],
			([snap, key]) => {
				const map = snap as ReadonlyMap<string, LightCollectionEntry<T>> | undefined;
				return map?.get(key as string);
			},
			{
				describeKind: "derived",
				meta: memoryMeta("light_collection_item"),
			},
		);
	}

	function hasNode(id: NodeOrValue<string>): Node<boolean> {
		const idN = toNode(id, "id");
		return derived(
			[entries, idN],
			([snap, key]) => {
				const map = snap as ReadonlyMap<string, LightCollectionEntry<T>> | undefined;
				return map?.has(key as string) ?? false;
			},
			{
				describeKind: "derived",
				meta: memoryMeta("light_collection_has"),
			},
		);
	}

	return {
		entries,
		events,
		upsert,
		remove,
		clear,
		itemNode,
		hasNode,
	};
}

// ── Unit 3: collection ───────────────────────────────────────────────────

export type CollectionEntry<T> = LightCollectionEntry<T> & {
	readonly baseScore: number;
};

export type RankedCollectionEntry<T> = CollectionEntry<T> & {
	readonly score: number;
};

export type CollectionScoreFn<T> = (value: T) => number;

export type CollectionOptions<T> = {
	maxSize?: number;
	/**
	 * Produces a base score at insert/update time. Static fn or a reactive
	 * `Node<(value: T) => number>` — when supplied as a Node, `ranked` re-derives
	 * whenever the score fn changes, but `baseScore` on each entry is only
	 * recomputed via {@link CollectionGraph.rescore}. Default `() => 1`.
	 */
	score?: CollectionScoreFn<T> | Node<CollectionScoreFn<T>>;
	/**
	 * Exponential decay rate per second. `0` disables decay (default). When
	 * positive, `ranked` becomes fully reactive on time via a `fromTimer` source
	 * (cadence auto-derived from `decayRate` unless overridden via
	 * `refreshIntervalMs`). Half-life: `ratePerSecond = Math.LN2 / halfLifeSeconds`.
	 */
	decayRate?: number;
	/** Minimum score floor after decay. Default `0`. */
	minScore?: number;
	/**
	 * Override for the `ranked` refresh tick cadence (milliseconds). When
	 * unset and `decayRate > 0`, defaults to `1000 * Math.LN2 / (10 * decayRate)`
	 * — roughly one tick per 10% of the half-life (~10% staleness budget).
	 */
	refreshIntervalMs?: number;
};

export interface CollectionAuditRecord extends BaseAuditRecord {
	readonly action: "upsert" | "remove" | "clear" | "rescore";
	readonly id?: string;
}

export type CollectionGraph<T> = Graph & {
	readonly events: ReactiveLogBundle<CollectionAuditRecord>;
	readonly items: Node<ReadonlyMap<string, CollectionEntry<T>>>;
	readonly ranked: Node<readonly RankedCollectionEntry<T>[]>;
	readonly size: Node<number>;
	upsert: (id: string, value: T, opts?: { score?: number }) => void;
	remove: (id: string) => void;
	clear: () => void;
	/**
	 * Recompute every entry's `baseScore` via the latest score fn. O(N). Useful
	 * when a reactive `score` Node has emitted a new fn and the caller wants
	 * existing entries re-scored without an explicit re-upsert.
	 */
	rescore: () => void;
	itemNode: (id: NodeOrValue<string>) => Node<CollectionEntry<T> | undefined>;
};

function rankedEqual<T>(
	a: readonly RankedCollectionEntry<T>[] | undefined,
	b: readonly RankedCollectionEntry<T>[] | undefined,
): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		const x = a[i]!;
		const y = b[i]!;
		// Compare value reference too — if `upsert(id, newValue)` runs and
		// `score(newValue) === score(oldValue)` AND timestamps coincide
		// (rare on platforms where consecutive `monotonicNs()` calls in the
		// same microtask collide), the prior comparator suppressed the
		// emission and consumers reading `entry.value` saw stale data.
		// Value identity catches it cheaply (`value !== value` only on NaN
		// payloads, which behave correctly here).
		if (
			x.id !== y.id ||
			x.score !== y.score ||
			x.lastAccessNs !== y.lastAccessNs ||
			x.value !== y.value
		)
			return false;
	}
	return true;
}

/**
 * Scored memory store with live decay-aware ranking.
 *
 * Topology (mounted on the returned graph):
 *  - `items` — `reactiveMap<id, CollectionEntry<T>>` (with `retention` configured
 *    for score-based eviction when `maxSize` is set).
 *  - `ranked` — `Node<readonly RankedCollectionEntry<T>[]>`, sorted by live
 *    decayed score. **Lazy** — does NOT compute until subscribed (no internal
 *    keepalive). Use `keepalive(coll.ranked)` for eager activation.
 *  - `size` — `Node<number>`, count of entries.
 *  - `_refreshTick` — `fromTimer`-driven `monotonicNs()` source, mounted only
 *    when `decayRate > 0`. Drives `ranked`'s time-dependent re-derivation.
 *  - `_seq` — sequence cursor for the audit log.
 *  - `events` — bounded reactive log of every mutation.
 *
 * **Time as a reactive dep.** When `decayRate > 0`, `ranked`'s deps are
 * `[items, refreshTick]` — the tick payload IS `monotonicNs()`, so the fn is
 * pure of deps and dry-run-reproducible with a mocked clock.
 *
 * **Lazy timer.** With no subscriber to `ranked`, the timer source does not
 * fire — the activation chain is downstream-driven. To keep the timer warm
 * without consuming results, register `graph.addDisposer(keepalive(coll.ranked))`.
 *
 * **Eviction at write-time.** Score-based retention runs on every successful
 * `upsert / remove / clear` (it is mutation-driven, not tick-driven). The
 * retention scorer reads `monotonicNs()` to compute decayed scores at eviction
 * time — this is a deliberate impurity vs. `ReactiveMapRetention.score`'s
 * "pure of `(key, value)`" docstring: write-time is the right moment to evict
 * stale-by-decay entries.
 *
 * **No imperative reads.** Subscribe to `items` / `ranked` for live snapshots,
 * or use `itemNode(id)` for single-key reactive reads.
 *
 * **`rescore` ordering caveat.** `rescore()` reads `items.entries.cache`
 * (the post-emission snapshot) and writes via `setMany`. When called
 * stand-alone it sees the latest committed state. When wrapped inside a
 * user-level `batch(() => { coll.upsert(...); coll.rescore(); })`, the
 * `cache` snapshot reflects state BEFORE the batch — so a just-staged
 * upsert is invisible to the rescore scan. If you need rescore to include
 * the staged upsert, either call `rescore()` after the batch settles or
 * pass the new `baseScore` directly via `upsert(id, value, { score })`.
 *
 * **Audit no-op records.** Like `lightCollection`, mutations record audit
 * entries even when the impl was a no-op (e.g., `rescore()` on an empty
 * store). Intentional — the framework records attempts.
 *
 * @category memory
 */
export function collection<T>(name: string, opts: CollectionOptions<T> = {}): CollectionGraph<T> {
	const maxSize = opts.maxSize;
	const decayRate = opts.decayRate ?? 0;
	const minScore = opts.minScore ?? 0;
	if (maxSize !== undefined && maxSize < 1) {
		throw new RangeError("collection: maxSize must be >= 1");
	}

	// Resolve score fn — supports static fn or reactive Node<fn>.
	const scoreFnDefault: CollectionScoreFn<T> = () => 1;
	const scoreInput = opts.score ?? scoreFnDefault;
	const scoreNode: Node<CollectionScoreFn<T>> | undefined =
		scoreInput instanceof NodeImpl ? (scoreInput as Node<CollectionScoreFn<T>>) : undefined;
	const readScoreFn = (): CollectionScoreFn<T> => {
		if (scoreNode) return scoreNode.cache ?? scoreFnDefault;
		return scoreInput as CollectionScoreFn<T>;
	};

	const graph = new Graph(name);

	// Score-based retention scorer for `reactiveMap`. `monotonicNs()` reads the
	// central clock at eviction time — see "Eviction at write-time" in the
	// factory JSDoc for why this deliberately violates the "pure of (key, value)"
	// docstring on `ReactiveMapRetention.score`.
	const retentionScore = (_k: string, v: CollectionEntry<T>): number =>
		decay(v.baseScore, ageSeconds(monotonicNs(), v.lastAccessNs), decayRate, minScore);

	const items = reactiveMap<string, CollectionEntry<T>>({
		name: "items",
		...(maxSize !== undefined ? { retention: { score: retentionScore, maxSize } } : {}),
	});

	graph.add(items.entries, { name: "items" });

	// Refresh tick — only mounted when decay is configured. Tick payload is
	// `monotonicNs()`, so `ranked`'s fn is pure-of-deps and dry-run-reproducible.
	let refreshTick: Node<number> | undefined;
	if (decayRate > 0) {
		const intervalMs = opts.refreshIntervalMs ?? Math.max(1, (1000 * Math.LN2) / (10 * decayRate));
		const tickCounter = fromTimer(intervalMs, { period: intervalMs });
		// Map each tick to the wall-clock `monotonicNs` — the tick payload IS
		// the time stamp downstream consumers use. Reading the central clock
		// inside this fn is sanctioned: this derived's purpose is to publish
		// "now" reactively (cf. spec §5.11 — central timer), and downstream
		// `ranked` reads it from its dep array, never from the clock directly.
		//
		// `initial: monotonicNs()` seeds the cache with construction-time
		// `now` so push-on-subscribe delivers DATA to `ranked` before the
		// first tick fires — without this, `ranked` would stall in pending
		// status until ~`refreshIntervalMs` after first activation, and a
		// caller reading `ranked.cache` immediately after `upsert` would see
		// `undefined`.
		refreshTick = derived([tickCounter], () => monotonicNs(), {
			name: "refresh_tick_ns",
			describeKind: "derived",
			initial: monotonicNs(),
			meta: memoryMeta("clock"),
		});
		graph.add(refreshTick, { name: "refresh_tick_ns" });
	}

	// `ranked` derived — pure of (items, refreshTick?, scoreNode?).
	const rankedDeps: Node<unknown>[] = [items.entries];
	if (refreshTick) rankedDeps.push(refreshTick);
	if (scoreNode) rankedDeps.push(scoreNode);
	const ranked = derived(
		rankedDeps,
		(values) => {
			const snapshot = values[0] as ReadonlyMap<string, CollectionEntry<T>> | undefined;
			let now: number;
			if (refreshTick) {
				const tickValue = values[1] as number | undefined;
				now = typeof tickValue === "number" ? tickValue : monotonicNs();
			} else {
				now = monotonicNs();
			}
			if (!snapshot || snapshot.size === 0) return [] as readonly RankedCollectionEntry<T>[];
			const out: RankedCollectionEntry<T>[] = [];
			for (const entry of snapshot.values()) {
				out.push({
					...entry,
					score: decay(entry.baseScore, ageSeconds(now, entry.lastAccessNs), decayRate, minScore),
				});
			}
			out.sort((a, b) => b.score - a.score || b.lastAccessNs - a.lastAccessNs);
			return out as readonly RankedCollectionEntry<T>[];
		},
		{
			name: "ranked",
			describeKind: "derived",
			equals: rankedEqual,
			meta: memoryMeta("ranked"),
		},
	) as Node<readonly RankedCollectionEntry<T>[]>;
	graph.add(ranked, { name: "ranked" });

	const size = derived(
		[items.entries],
		([snapshot]) => ((snapshot ?? new Map()) as ReadonlyMap<string, CollectionEntry<T>>).size,
		{
			name: "size",
			describeKind: "derived",
			initial: 0,
			meta: memoryMeta("size"),
		},
	);
	graph.add(size, { name: "size" });
	// Keepalive only on `size` (cheap; pure of items). `ranked` is intentionally
	// lazy so the refresh timer doesn't fire when nothing consumes the ranking.
	graph.addDisposer(keepalive(size));

	// Audit log + seq cursor.
	const events = createAuditLog<CollectionAuditRecord>({
		name: "events",
		retainedLimit: 1024,
		graph,
	});
	const seqCursor = registerCursor(graph, "seq", 0);

	const upsertImpl = (id: string, value: T, _opts?: { score?: number }): void => {
		const now = monotonicNs();
		const prev = items.get(id);
		const baseScore = _opts?.score ?? readScoreFn()(value);
		items.set(id, {
			id,
			value,
			baseScore,
			createdAtNs: prev?.createdAtNs ?? now,
			lastAccessNs: now,
		});
	};
	const removeImpl = (id: string): void => {
		if (!items.has(id)) return;
		items.delete(id);
	};
	const clearImpl = (): void => {
		if (items.size === 0) return;
		items.clear();
	};
	const rescoreImpl = (): void => {
		const fn = readScoreFn();
		const snapshot = items.entries.cache as ReadonlyMap<string, CollectionEntry<T>> | undefined;
		if (!snapshot || snapshot.size === 0) return;
		const updates: Array<[string, CollectionEntry<T>]> = [];
		for (const entry of snapshot.values()) {
			updates.push([entry.id, { ...entry, baseScore: fn(entry.value) }]);
		}
		items.setMany(updates);
	};

	const upsert = lightMutation(upsertImpl, {
		audit: events,
		seq: seqCursor,
		onSuccess: ([id], _r, m) => ({ action: "upsert" as const, id, t_ns: m.t_ns, seq: m.seq }),
	});
	const remove = lightMutation(removeImpl, {
		audit: events,
		seq: seqCursor,
		onSuccess: ([id], _r, m) => ({ action: "remove" as const, id, t_ns: m.t_ns, seq: m.seq }),
	});
	const clear = lightMutation(clearImpl, {
		audit: events,
		seq: seqCursor,
		onSuccess: (_args, _r, m) => ({ action: "clear" as const, t_ns: m.t_ns, seq: m.seq }),
	});
	const rescore = lightMutation(rescoreImpl, {
		audit: events,
		seq: seqCursor,
		onSuccess: (_args, _r, m) => ({ action: "rescore" as const, t_ns: m.t_ns, seq: m.seq }),
	});

	function itemNode(id: NodeOrValue<string>): Node<CollectionEntry<T> | undefined> {
		const idN = toNode(id, "id");
		return derived(
			[items.entries, idN],
			([snap, key]) => {
				const map = snap as ReadonlyMap<string, CollectionEntry<T>> | undefined;
				return map?.get(key as string);
			},
			{
				describeKind: "derived",
				meta: memoryMeta("collection_item"),
			},
		);
	}

	const out = Object.assign(graph, {
		events,
		items: items.entries,
		ranked,
		size,
		upsert,
		remove,
		clear,
		rescore,
		itemNode,
	}) as CollectionGraph<T>;
	return out;
}

// ── Unit 4: vectorIndex ──────────────────────────────────────────────────

export type VectorBackend = "flat" | "hnsw";

export type VectorRecord<TMeta> = {
	readonly id: string;
	readonly vector: readonly number[];
	readonly meta?: TMeta;
	/** Wall-clock-monotonic timestamp at last upsert; used for the default LRU retention. */
	readonly upsertedAtNs: number;
};

export type VectorSearchResult<TMeta> = {
	readonly id: string;
	readonly score: number;
	readonly meta?: TMeta;
};

export type HnswAdapter<TMeta> = {
	upsert: (id: string, vector: readonly number[], meta?: TMeta) => void;
	remove: (id: string) => void;
	clear: () => void;
	search: (query: readonly number[], k: number) => ReadonlyArray<VectorSearchResult<TMeta>>;
	/** Optional adapter teardown. Called from `graph.destroy()` via `addDisposer`. */
	dispose?: () => void;
};

export type VectorIndexOptions<TMeta> = {
	name?: string;
	backend?: VectorBackend;
	dimension?: number;
	/**
	 * Strict-dimension default. When `true` (default) AND `dimension` is unset,
	 * mixed-length upserts throw `RangeError`. Set `false` to opt into the
	 * lenient zero-padding behavior of {@link VectorIndexGraph.searchNode}.
	 */
	strictDimension?: boolean;
	/** Optional dependency seam for HNSW. */
	hnswFactory?: () => HnswAdapter<TMeta>;
	/** Maximum live entries (LRU-by-upsert-time when set; user-overridable via `retentionScore`). */
	maxSize?: number;
	/** Custom retention scorer. Higher score = kept. Defaults to `r => r.upsertedAtNs`. */
	retentionScore?: (record: VectorRecord<TMeta>) => number;
};

export interface VectorIndexAuditRecord extends BaseAuditRecord {
	readonly action: "upsert" | "remove" | "clear" | "reindex" | "evict";
	readonly id?: string;
}

export type VectorIndexGraph<TMeta> = Graph & {
	readonly backend: VectorBackend;
	readonly events: ReactiveLogBundle<VectorIndexAuditRecord>;
	readonly entries: Node<ReadonlyMap<string, VectorRecord<TMeta>>>;
	upsert: (id: string, vector: readonly number[], meta?: TMeta) => void;
	remove: (id: string) => void;
	clear: () => void;
	/** Re-push every live entry into the optional HNSW adapter. No-op for `flat`. */
	reindex: () => void;
	/**
	 * Reactive top-K search. Re-derives whenever entries / query / k change.
	 * Lazy. Use `firstValueFrom(searchNode(...))` for one-shot reads.
	 */
	searchNode: (
		query: Node<readonly number[]>,
		k?: NodeOrValue<number>,
	) => Node<readonly VectorSearchResult<TMeta>[]>;
};

/**
 * Reactive vector store with optional HNSW backend.
 *
 * **Storage on `reactiveMap`.** `entries` is a `reactiveMap<id, VectorRecord<TMeta>>`
 * with optional score-based retention (`maxSize` + LRU-by-`upsertedAtNs` by
 * default; user can supply a custom `retentionScore`). On retention eviction,
 * the HNSW adapter (if configured) is also notified via `adapter.remove(id)`.
 *
 * **Reactive search.** `searchNode(queryNode, k)` returns a `Node<readonly
 * VectorSearchResult<TMeta>[]>` that re-derives on entries / query / k change.
 * Lazy — only computes when subscribed. Imperative `search()` is intentionally
 * not exposed (no-imperative-reads policy). Use `firstValueFrom(searchNode(...))`
 * for one-shot reads.
 *
 * **Strict dimension.** Default `strictDimension: true` — if `dimension` is
 * unset and an upsert produces a vector of a different length than the first
 * upserted, throws `RangeError`. Pass `strictDimension: false` to opt into
 * the lenient zero-padding fallback (the previous default).
 *
 * **Adapter lifecycle.** When the HNSW adapter exposes a `dispose()` method,
 * it is bound to the graph's teardown via `addDisposer`. When retention
 * evicts an entry, `adapter.remove(id)` is invoked synchronously inside the
 * retention `onArchive` callback.
 *
 * **Cosine zero-pad.** The flat backend uses cosine similarity over the
 * pairwise max-length zero-pad. Mixing dimensions silently degrades scores
 * unless strict mode catches it at upsert time. For embedding-model vectors,
 * L2-normalize at the source — `vectorIndex` does not normalize.
 *
 * @category memory
 */
export function vectorIndex<TMeta>(opts: VectorIndexOptions<TMeta> = {}): VectorIndexGraph<TMeta> {
	const backend = opts.backend ?? "flat";
	const dimension = opts.dimension;
	const strictDimension = opts.strictDimension ?? true;
	const maxSize = opts.maxSize;
	const userRetentionScore = opts.retentionScore;

	let hnsw: HnswAdapter<TMeta> | undefined;
	if (backend === "hnsw") {
		hnsw = opts.hnswFactory?.();
		if (!hnsw) {
			throw new Error(
				'vectorIndex backend "hnsw" requires an optional dependency adapter; install your HNSW package and provide `hnswFactory`.',
			);
		}
	}

	const graph = new Graph(opts.name ?? "vector_index");

	// Track an inferred dimension when the user didn't lock it but strict mode
	// is on — first upsert sets it; subsequent mismatches throw.
	let inferredDimension: number | undefined;
	function assertDimension(vector: readonly number[]): void {
		if (dimension !== undefined) {
			if (vector.length !== dimension) {
				throw new RangeError(
					`vector dimension mismatch: expected ${dimension}, got ${vector.length}`,
				);
			}
			return;
		}
		if (!strictDimension) return;
		if (inferredDimension === undefined) {
			inferredDimension = vector.length;
			return;
		}
		if (vector.length !== inferredDimension) {
			throw new RangeError(
				`vector dimension mismatch: inferred ${inferredDimension} from first upsert, got ${vector.length}. ` +
					`Pass \`strictDimension: false\` to opt into zero-pad behavior, or set an explicit \`dimension\`.`,
			);
		}
	}

	const baseRetentionScore = userRetentionScore ?? ((r: VectorRecord<TMeta>) => r.upsertedAtNs);
	// `clearInProgress` lets us short-circuit the per-entry `onArchive` →
	// `hnsw.remove(id)` cascade when the user calls `clearImpl()`. Retention
	// fires `onArchive` for every evicted entry; followed by an explicit
	// `hnsw.clear()` we'd double-touch the adapter. Inside `clearImpl` we
	// flip this flag, then call `hnsw.clear()` once at the end. (G fix.)
	let clearInProgress = false;

	// `clearAuditPending` defers the per-entry `evict` audit emission when a
	// `clear()` is in flight — those evictions are reported as a single
	// `clear` action, not a flurry of `evict` records.
	const events = createAuditLog<VectorIndexAuditRecord>({
		name: "events",
		retainedLimit: 1024,
		graph,
	});
	const seqCursor = registerCursor(graph, "seq", 0);

	const entries = reactiveMap<string, VectorRecord<TMeta>>({
		name: "entries",
		...(maxSize !== undefined
			? {
					retention: {
						score: (_k, v) => baseRetentionScore(v),
						maxSize,
						onArchive: (key) => {
							if (clearInProgress) return;
							if (backend === "hnsw") hnsw!.remove(key);
							// E1: surface retention-driven evictions in the audit log
							// so replay consumers can reconstruct the live snapshot
							// from `events` alone. `seq` is bumped via the cursor;
							// the `t_ns` matches `wallClockNs()` for consistency
							// with `lightMutation`'s record stamping.
							events.append({
								action: "evict" as const,
								id: key,
								t_ns: wallClockNs(),
								seq: bumpCursor(seqCursor),
							});
						},
					},
				}
			: {}),
	});
	graph.add(entries.entries, { name: "entries" });
	// F1: keep `entries` warm so downstream consumers reading
	// `vectors.entries.cache` (e.g. `patterns/ai/memory/runRetrieval`) don't
	// rely on an external subscriber to activate the node. State nodes are
	// ROM and retain `.cache` regardless of subscribers — this `keepalive`
	// is defense-in-depth and matches the kg's adjacency keepalive pattern.
	graph.addDisposer(keepalive(entries.entries));

	// HNSW dispose runs BEFORE state-node teardown via standard disposer
	// ordering (disposers drain first, then `[[TEARDOWN]]` propagates per
	// `Graph.destroy()`). This is the right ordering: free the adapter's
	// native resources before the reactive layer tears down.
	if (hnsw?.dispose) {
		const disposeAdapter = hnsw.dispose.bind(hnsw);
		graph.addDisposer(() => disposeAdapter());
	}

	const upsertImpl = (id: string, vector: readonly number[], meta?: TMeta): void => {
		assertDimension(vector);
		// B1: mutate HNSW first so a throw aborts the reactive write. With
		// the prior order (entries.set then hnsw.upsert), an adapter throw
		// would leave entries holding a row HNSW didn't index. Now: HNSW
		// commits first; if it throws, entries is untouched and audit log
		// records the failure.
		if (backend === "hnsw") hnsw!.upsert(id, vector, meta);
		// Defensive copies: vector via `[...vector]`; meta via shallow spread
		// when it's a non-null object (Array.isArray covered first since arrays
		// are objects). Primitives, `null`, functions etc. pass through
		// unchanged. Documented depth limitation: nested objects in `meta` are
		// shared by reference.
		const copiedMeta: TMeta | undefined = (() => {
			if (meta === undefined) return undefined;
			if (meta === null || typeof meta !== "object") return meta;
			return Array.isArray(meta) ? ([...meta] as unknown as TMeta) : ({ ...meta } as TMeta);
		})();
		const record: VectorRecord<TMeta> = {
			id,
			vector: [...vector],
			...(copiedMeta !== undefined ? { meta: copiedMeta } : {}),
			upsertedAtNs: monotonicNs(),
		};
		entries.set(id, record);
	};
	const removeImpl = (id: string): void => {
		if (!entries.has(id)) return;
		// B1: HNSW first, then entries.
		if (backend === "hnsw") hnsw!.remove(id);
		entries.delete(id);
	};
	const clearImpl = (): void => {
		if (entries.size === 0) return;
		// B1 + G: mark the clear-in-progress flag so retention `onArchive`
		// suppresses per-entry HNSW removes AND per-entry `evict` audit
		// records. Then call `entries.clear()` (drains the backend through
		// retention archival without side effects), and finally call
		// `hnsw.clear()` once. Reset `inferredDimension` so a fresh start
		// re-infers from the next upsert.
		clearInProgress = true;
		try {
			entries.clear();
			if (backend === "hnsw") hnsw!.clear();
		} finally {
			clearInProgress = false;
		}
		inferredDimension = undefined;
	};
	const reindexImpl = (): void => {
		if (backend !== "hnsw") return;
		const snapshot = entries.entries.cache as ReadonlyMap<string, VectorRecord<TMeta>> | undefined;
		if (!snapshot) return;
		hnsw!.clear();
		for (const r of snapshot.values()) {
			hnsw!.upsert(r.id, r.vector, r.meta);
		}
	};

	// `freeze: false` for `upsert` — deep-freezing a 768-dim vector is a
	// measurable hot-path tax, and the wrapper does its own defensive copy
	// (`vector: [...vector]`) before persisting. See §B.2 of the audit lock.
	const upsert = lightMutation(upsertImpl, {
		audit: events,
		freeze: false,
		seq: seqCursor,
		onSuccess: ([id], _r, m) => ({ action: "upsert" as const, id, t_ns: m.t_ns, seq: m.seq }),
	});
	const remove = lightMutation(removeImpl, {
		audit: events,
		seq: seqCursor,
		onSuccess: ([id], _r, m) => ({ action: "remove" as const, id, t_ns: m.t_ns, seq: m.seq }),
	});
	const clear = lightMutation(clearImpl, {
		audit: events,
		seq: seqCursor,
		onSuccess: (_args, _r, m) => ({ action: "clear" as const, t_ns: m.t_ns, seq: m.seq }),
	});
	const reindex = lightMutation(reindexImpl, {
		audit: events,
		seq: seqCursor,
		onSuccess: (_args, _r, m) => ({ action: "reindex" as const, t_ns: m.t_ns, seq: m.seq }),
	});

	function searchNode(
		query: Node<readonly number[]>,
		k: NodeOrValue<number> = 5,
	): Node<readonly VectorSearchResult<TMeta>[]> {
		const kN = toNode<number>(k, "k");
		return derived(
			[entries.entries, query, kN],
			(values) => {
				const snapshot = values[0] as ReadonlyMap<string, VectorRecord<TMeta>> | undefined;
				const q = values[1] as readonly number[] | undefined;
				const kRaw = values[2] as number;
				// Auto-fix: `Math.max(0, Math.floor(k))` — `| 0` is a 32-bit
				// signed truncation that collapses Infinity to 0 and wraps
				// values > 2^31. Use a proper floor with a non-negative floor.
				const kVal = Number.isFinite(kRaw) ? Math.max(0, Math.floor(kRaw)) : 0;
				if (!snapshot || snapshot.size === 0 || kVal <= 0) {
					return [] as readonly VectorSearchResult<TMeta>[];
				}
				// Auto-fix: defensive guard for unset / empty query — earlier
				// the fn would TypeError on `q.length` reading `undefined`,
				// or compute meaningless all-zero scores against an empty
				// vector. With strict-dimension OR an explicit `dimension`,
				// also reject mismatched-length queries (the imperative path
				// used to throw; reactive deriveds shouldn't throw, so
				// degrade to empty results).
				if (q == null || q.length === 0) {
					return [] as readonly VectorSearchResult<TMeta>[];
				}
				const expectedDim = dimension ?? (strictDimension ? inferredDimension : undefined);
				if (expectedDim !== undefined && q.length !== expectedDim) {
					return [] as readonly VectorSearchResult<TMeta>[];
				}
				if (backend === "hnsw") {
					// Defensive copy of the adapter's return — HNSW libs
					// sometimes hand back internal buffers; downstream
					// subscribers must not be able to corrupt adapter state.
					const adapterResults = hnsw!.search(q, kVal);
					return [...adapterResults] as readonly VectorSearchResult<TMeta>[];
				}
				const ranked = [...snapshot.values()]
					.map((row) => {
						const result: VectorSearchResult<TMeta> = {
							id: row.id,
							score: cosineSimilarity(q, row.vector),
							...(row.meta !== undefined ? { meta: row.meta } : {}),
						};
						return result;
					})
					.sort((a, b) => b.score - a.score)
					.slice(0, kVal);
				return ranked as readonly VectorSearchResult<TMeta>[];
			},
			{
				describeKind: "derived",
				// A1: include `score` in equality. The previous id-only
				// comparator suppressed re-emissions when the same set of
				// IDs/order had different scores (re-upsert with new
				// vector; query change preserving ranking order).
				equals: (a, b) => searchResultsEqual(a, b),
				meta: memoryMeta("vector_search"),
			},
		) as Node<readonly VectorSearchResult<TMeta>[]>;
	}

	const out = Object.assign(graph, {
		backend,
		events,
		entries: entries.entries,
		upsert,
		remove,
		clear,
		reindex,
		searchNode,
	}) as VectorIndexGraph<TMeta>;
	return out;
}

// ── Unit 5: knowledgeGraph ───────────────────────────────────────────────

export type KnowledgeEdge<TRelation extends string = string> = {
	readonly from: string;
	readonly to: string;
	readonly relation: TRelation;
	readonly weight: number;
};

export type KnowledgeGraphOptions = {
	/** Cap on entity count (LRU-by-upsert-time when set). */
	entitiesMaxSize?: number;
	/** Cap on edge count (LRU-by-upsert-time when set). */
	edgesMaxSize?: number;
	/**
	 * Orphan-entity garbage collection. `"keep"` (default) leaves entities
	 * untouched when their last edge is unlinked; `"remove"` deletes the
	 * entity post-`unlink` if no edges reference it.
	 */
	orphanGC?: "keep" | "remove";
};

export interface KnowledgeGraphAuditRecord extends BaseAuditRecord {
	readonly action: "upsertEntity" | "removeEntity" | "link" | "unlink" | "orphanRemove";
	readonly id?: string;
	readonly from?: string;
	readonly to?: string;
	readonly relation?: string;
	/** Edge weight at the time of the `link`. Omitted for non-edge actions. */
	readonly weight?: number;
}

export type KnowledgeGraph<TEntity, TRelation extends string = string> = Graph & {
	readonly events: ReactiveLogBundle<KnowledgeGraphAuditRecord>;
	readonly entities: Node<ReadonlyMap<string, TEntity>>;
	readonly edges: Node<ReadonlyMap<string, KnowledgeEdge<TRelation>>>;
	readonly adjacencyOut: Node<ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]>>;
	readonly adjacencyIn: Node<ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]>>;
	readonly entityCount: Node<number>;
	readonly edgeCount: Node<number>;
	upsertEntity: (id: string, value: TEntity) => void;
	removeEntity: (id: string) => void;
	link: (from: string, to: string, relation: TRelation, weight?: number) => void;
	unlink: (from: string, to: string, relation?: TRelation) => void;
	relatedNode: (
		id: NodeOrValue<string>,
		relation?: NodeOrValue<TRelation>,
	) => Node<readonly KnowledgeEdge<TRelation>[]>;
};

const TRIPLE_SEP = " ";
function tripleKey(from: string, to: string, relation: string): string {
	return `${from}${TRIPLE_SEP}${to}${TRIPLE_SEP}${relation}`;
}

function buildAdjacency<TRelation extends string>(
	edges: ReadonlyMap<string, KnowledgeEdge<TRelation>> | undefined,
	side: "from" | "to",
): ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]> {
	if (!edges || edges.size === 0) return new Map();
	const buckets = new Map<string, KnowledgeEdge<TRelation>[]>();
	for (const edge of edges.values()) {
		const key = side === "from" ? edge.from : edge.to;
		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = [];
			buckets.set(key, bucket);
		}
		bucket.push(edge);
	}
	const out = new Map<string, readonly KnowledgeEdge<TRelation>[]>();
	for (const [key, bucket] of buckets) out.set(key, Object.freeze(bucket));
	return out;
}

function adjacencyEqual<TRelation extends string>(
	a: ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]> | undefined,
	b: ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]> | undefined,
): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (a.size !== b.size) return false;
	for (const [k, av] of a) {
		const bv = b.get(k);
		if (!bv || av.length !== bv.length) return false;
		for (let i = 0; i < av.length; i += 1) {
			const ae = av[i]!;
			const be = bv[i]!;
			if (
				ae.from !== be.from ||
				ae.to !== be.to ||
				ae.relation !== be.relation ||
				ae.weight !== be.weight
			)
				return false;
		}
	}
	return true;
}

/**
 * Reactive knowledge graph: entities + typed edges + symmetric adjacency.
 *
 * Topology (mounted on the returned graph):
 *  - `entities` — `reactiveMap<id, TEntity>` (optional `entitiesMaxSize` LRU).
 *  - `edges` — `reactiveMap<tripleKey, KnowledgeEdge<TRelation>>` keyed by
 *    `${from} ${to} ${relation}` (optional `edgesMaxSize` LRU).
 *    Entity IDs / relations must NOT contain ` `.
 *  - `adjacencyOut` — `Node<ReadonlyMap<from, readonly edge[]>>`. **Full O(E)
 *    rebuild on every `link` / `unlink` mutation.** (Prior JSDoc claim of
 *    "O(E) build" referred to a single rebuild — the per-mutation cost is
 *    O(E), not O(1) amortized. For very large graphs with frequent edge
 *    churn, consider batching via `reactiveMap.setMany`.)
 *  - `adjacencyIn` — `Node<ReadonlyMap<to, readonly edge[]>>`. Same O(E) per
 *    mutation rebuild characteristic.
 *  - `entityCount` / `edgeCount` — observability deriveds.
 *  - `events` — bounded reactive audit log.
 *
 * **`link()` semantics.** Calling `link(a, b, rel, w)` twice with different
 * weights replaces the weight on the existing edge (keyed by the triple).
 * `unlink` then `link` re-creates the edge (and bumps `lastUpsertNs` for
 * retention purposes).
 *
 * **Edge weight convention.** Higher weight = stronger relation. Default `1`.
 *
 * **Orphan GC.** `orphanGC: "remove"` deletes an entity from `entities` after
 * an `unlink` that empties its adjacency on both sides. Default `"keep"`.
 *
 * **No imperative reads.** Use `relatedNode(id, relation?)` for reactive reads.
 *
 * @category memory
 */
export function knowledgeGraph<TEntity, TRelation extends string = string>(
	name: string,
	opts: KnowledgeGraphOptions = {},
): KnowledgeGraph<TEntity, TRelation> {
	const orphanGC = opts.orphanGC ?? "keep";
	if (opts.entitiesMaxSize !== undefined && opts.entitiesMaxSize < 1) {
		throw new RangeError("knowledgeGraph: entitiesMaxSize must be >= 1");
	}
	if (opts.edgesMaxSize !== undefined && opts.edgesMaxSize < 1) {
		throw new RangeError("knowledgeGraph: edgesMaxSize must be >= 1");
	}

	const graph = new Graph(name);

	const entitiesMap = reactiveMap<string, TEntity>({
		name: "entities",
		...(opts.entitiesMaxSize !== undefined ? { maxSize: opts.entitiesMaxSize } : {}),
	});
	const edgesMap = reactiveMap<string, KnowledgeEdge<TRelation>>({
		name: "edges",
		...(opts.edgesMaxSize !== undefined ? { maxSize: opts.edgesMaxSize } : {}),
	});
	graph.add(entitiesMap.entries, { name: "entities" });
	graph.add(edgesMap.entries, { name: "edges" });

	const adjacencyOut = derived(
		[edgesMap.entries],
		([snapshot]) =>
			buildAdjacency<TRelation>(
				snapshot as ReadonlyMap<string, KnowledgeEdge<TRelation>> | undefined,
				"from",
			),
		{
			name: "adjacencyOut",
			describeKind: "derived",
			initial: new Map() as ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]>,
			equals: adjacencyEqual,
			meta: memoryMeta("adjacency_out"),
		},
	) as Node<ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]>>;
	const adjacencyIn = derived(
		[edgesMap.entries],
		([snapshot]) =>
			buildAdjacency<TRelation>(
				snapshot as ReadonlyMap<string, KnowledgeEdge<TRelation>> | undefined,
				"to",
			),
		{
			name: "adjacencyIn",
			describeKind: "derived",
			initial: new Map() as ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]>,
			equals: adjacencyEqual,
			meta: memoryMeta("adjacency_in"),
		},
	) as Node<ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]>>;
	graph.add(adjacencyOut, { name: "adjacencyOut" });
	graph.add(adjacencyIn, { name: "adjacencyIn" });
	graph.addDisposer(keepalive(adjacencyOut));
	graph.addDisposer(keepalive(adjacencyIn));

	const entityCount = derived(
		[entitiesMap.entries],
		([m]) => ((m ?? new Map()) as ReadonlyMap<string, TEntity>).size,
		{ name: "entityCount", describeKind: "derived", initial: 0, meta: memoryMeta("entity_count") },
	);
	const edgeCount = derived(
		[edgesMap.entries],
		([m]) => ((m ?? new Map()) as ReadonlyMap<string, KnowledgeEdge<TRelation>>).size,
		{ name: "edgeCount", describeKind: "derived", initial: 0, meta: memoryMeta("edge_count") },
	);
	graph.add(entityCount, { name: "entityCount" });
	graph.add(edgeCount, { name: "edgeCount" });
	graph.addDisposer(keepalive(entityCount));
	graph.addDisposer(keepalive(edgeCount));

	const events = createAuditLog<KnowledgeGraphAuditRecord>({
		name: "events",
		retainedLimit: 1024,
		graph,
	});
	const seqCursor = registerCursor(graph, "seq", 0);

	/**
	 * O(1) orphan check via the kept-warm `adjacency*` deriveds. Reading
	 * `adjacencyOut.cache` / `adjacencyIn.cache` is safe here because both
	 * are activated via `addDisposer(keepalive(...))` at construction time
	 * (a derived's RAM cache only persists with at least one subscriber, and
	 * the keepalive registers exactly that). The previous implementation
	 * scanned `edgesMap.entries.cache` post-`deleteMany`, which depended on
	 * the (sync) snapshot-emit timing of `reactiveMap` — fragile. The
	 * `adjacency*.cache` approach is both faster (O(1) vs O(E) per check)
	 * and timing-robust because the reactiveMap snapshot has already
	 * propagated through the derived chain by the time we read.
	 */
	function entityHasReferences(id: string): boolean {
		const out = adjacencyOut.cache as
			| ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]>
			| undefined;
		const inb = adjacencyIn.cache as
			| ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]>
			| undefined;
		if ((out?.get(id)?.length ?? 0) > 0) return true;
		if ((inb?.get(id)?.length ?? 0) > 0) return true;
		return false;
	}

	/**
	 * Apply orphan GC to a list of candidate entity ids. Used by both
	 * {@link unlinkImpl} (post-edge-removal) and {@link removeEntityImpl}
	 * (post-cascade) so semantics are consistent. Each removed entity
	 * records a separate `orphanRemove` audit entry with its own monotonic
	 * `seq` value (D1 fix — the previous bare `events.append(...)` skipped
	 * the cursor advance, leaving gaps in the audit replay sequence).
	 */
	function applyOrphanGC(candidates: readonly string[]): void {
		if (orphanGC !== "remove") return;
		for (const candidate of candidates) {
			if (!entitiesMap.has(candidate)) continue;
			if (entityHasReferences(candidate)) continue;
			entitiesMap.delete(candidate);
			events.append({
				action: "orphanRemove" as const,
				id: candidate,
				t_ns: wallClockNs(),
				seq: bumpCursor(seqCursor),
			});
		}
	}

	const upsertEntityImpl = (id: string, value: TEntity): void => {
		entitiesMap.set(id, value);
	};
	const removeEntityImpl = (id: string): void => {
		const snapshot = edgesMap.entries.cache as
			| ReadonlyMap<string, KnowledgeEdge<TRelation>>
			| undefined;
		// Collect both the edge-keys to drop AND the entity ids those edges
		// reference (other than `id` itself) — the latter become orphan-GC
		// candidates after the cascade. (C1 fix — the previous impl only
		// applied orphan GC inside `unlink`, so cascading entity removal
		// could leave dangling orphans.)
		const cascadedNeighbors = new Set<string>();
		if (snapshot) {
			const toDrop: string[] = [];
			for (const [key, edge] of snapshot) {
				if (edge.from === id || edge.to === id) {
					toDrop.push(key);
					if (edge.from !== id) cascadedNeighbors.add(edge.from);
					if (edge.to !== id) cascadedNeighbors.add(edge.to);
				}
			}
			if (toDrop.length > 0) edgesMap.deleteMany(toDrop);
		}
		if (entitiesMap.has(id)) entitiesMap.delete(id);
		applyOrphanGC([...cascadedNeighbors]);
	};
	const linkImpl = (from: string, to: string, relation: TRelation, weight = 1): void => {
		edgesMap.set(tripleKey(from, to, relation), { from, to, relation, weight });
	};
	const unlinkImpl = (from: string, to: string, relation?: TRelation): void => {
		if (relation !== undefined) {
			edgesMap.delete(tripleKey(from, to, relation));
		} else {
			const snapshot = edgesMap.entries.cache as
				| ReadonlyMap<string, KnowledgeEdge<TRelation>>
				| undefined;
			if (!snapshot) return;
			const toDrop: string[] = [];
			for (const [key, edge] of snapshot) {
				if (edge.from === from && edge.to === to) toDrop.push(key);
			}
			if (toDrop.length > 0) edgesMap.deleteMany(toDrop);
		}
		applyOrphanGC([from, to]);
	};

	const upsertEntity = lightMutation(upsertEntityImpl, {
		audit: events,
		seq: seqCursor,
		onSuccess: ([id], _r, m) => ({ action: "upsertEntity" as const, id, t_ns: m.t_ns, seq: m.seq }),
	});
	const removeEntity = lightMutation(removeEntityImpl, {
		audit: events,
		seq: seqCursor,
		onSuccess: ([id], _r, m) => ({ action: "removeEntity" as const, id, t_ns: m.t_ns, seq: m.seq }),
	});
	const link = lightMutation(linkImpl, {
		audit: events,
		seq: seqCursor,
		onSuccess: ([from, to, relation, weight], _r, m) => ({
			action: "link" as const,
			from,
			to,
			relation: relation as string,
			weight: weight ?? 1,
			t_ns: m.t_ns,
			seq: m.seq,
		}),
	});
	const unlink = lightMutation(unlinkImpl, {
		audit: events,
		seq: seqCursor,
		onSuccess: ([from, to, relation], _r, m) => ({
			action: "unlink" as const,
			from,
			to,
			...(relation !== undefined ? { relation: relation as string } : {}),
			t_ns: m.t_ns,
			seq: m.seq,
		}),
	});

	function relatedNode(
		id: NodeOrValue<string>,
		relation?: NodeOrValue<TRelation>,
	): Node<readonly KnowledgeEdge<TRelation>[]> {
		const idN = toNode(id, "id");
		// `relation` is OPTIONAL. We deliberately do NOT include it as a dep
		// when omitted — `state(undefined)` would be a SENTINEL and the
		// derived's first-run gate would never open. Callers pass a Node
		// when they want reactive filtering; pass a value to lock the
		// filter; omit to disable filtering.
		const relN = relation !== undefined ? toNode(relation, "relation") : undefined;
		const deps: Node<unknown>[] = relN
			? [adjacencyOut, adjacencyIn, idN, relN]
			: [adjacencyOut, adjacencyIn, idN];
		return derived(
			deps,
			(values) => {
				const out = values[0] as ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]>;
				const inb = values[1] as ReadonlyMap<string, readonly KnowledgeEdge<TRelation>[]>;
				const key = values[2] as string;
				const rel = relN ? (values[3] as TRelation | undefined) : undefined;
				const outE = out.get(key) ?? [];
				const inE = inb.get(key) ?? [];
				// Concatenate, then dedupe by triple key (a self-loop would appear in both).
				const seen = new Set<string>();
				const acc: KnowledgeEdge<TRelation>[] = [];
				for (const edge of outE) {
					const k = tripleKey(edge.from, edge.to, edge.relation);
					if (seen.has(k)) continue;
					if (rel !== undefined && edge.relation !== rel) continue;
					seen.add(k);
					acc.push(edge);
				}
				for (const edge of inE) {
					const k = tripleKey(edge.from, edge.to, edge.relation);
					if (seen.has(k)) continue;
					if (rel !== undefined && edge.relation !== rel) continue;
					seen.add(k);
					acc.push(edge);
				}
				return acc as readonly KnowledgeEdge<TRelation>[];
			},
			{
				describeKind: "derived",
				equals: (a, b) => {
					const av = a as readonly KnowledgeEdge<TRelation>[] | undefined;
					const bv = b as readonly KnowledgeEdge<TRelation>[] | undefined;
					if (av === bv) return true;
					if (av == null || bv == null) return false;
					if (av.length !== bv.length) return false;
					for (let i = 0; i < av.length; i += 1) {
						const x = av[i]!;
						const y = bv[i]!;
						if (
							x.from !== y.from ||
							x.to !== y.to ||
							x.relation !== y.relation ||
							x.weight !== y.weight
						)
							return false;
					}
					return true;
				},
				meta: memoryMeta("related"),
			},
		) as Node<readonly KnowledgeEdge<TRelation>[]>;
	}

	const out = Object.assign(graph, {
		events,
		entities: entitiesMap.entries,
		edges: edgesMap.entries,
		adjacencyOut,
		adjacencyIn,
		entityCount,
		edgeCount,
		upsertEntity,
		removeEntity,
		link,
		unlink,
		relatedNode,
	}) as KnowledgeGraph<TEntity, TRelation>;
	return out;
}
