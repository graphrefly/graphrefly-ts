/**
 * Reactive key–value map (roadmap §3.2) — emits `ReadonlyMap` snapshots directly.
 *
 * Internal version counter drives efficient equality without leaking `Versioned`
 * into the public API (spec §5.12).
 *
 * **Wave 4 refactor (2026-04-15):** Introduces the `MapBackend<K, V>` pluggable-backend
 * interface. The default `NativeMapBackend` owns LRU ordering, TTL expiry, and a
 * monotonic `version` counter. Reads that discover expired entries prune them and
 * emit (fixes the former `size`-getter stale-snapshot gap).
 */
import { batch } from "../../core/batch.js";
import { monotonicNs, wallClockNs } from "../../core/clock.js";
import { DATA, DIRTY } from "../../core/messages.js";
import { type Node, type NodeOptions, node } from "../../core/node.js";
import type { VersioningLevel } from "../../core/versioning.js";
import type { MapChange, MapChangePayload } from "./change.js";
import { type ReactiveLogBundle, reactiveLog } from "./reactive-log.js";

export type ReactiveMapOptions<K, V> = {
	/** Optional registry name for `describe()` / debugging. */
	name?: string;
	/**
	 * LRU cap. When set, evicts least-recently-used keys after inserts that exceed this size.
	 * Forwarded to the default `NativeMapBackend`. Ignored if a custom `backend` is provided.
	 *
	 * **Mutually exclusive with `retention`** — the LRU cap is "youngest-access wins,"
	 * score-based retention is "highest-score wins." Configuring both would make
	 * eviction nondeterministic; construction throws if both are set.
	 */
	maxSize?: number;
	/**
	 * Default TTL in seconds. Used when `set`/`setMany` omits per-call `ttl`.
	 * Forwarded to the default `NativeMapBackend`. Ignored if a custom `backend` is provided.
	 */
	defaultTtl?: number;
	/**
	 * Storage backend. Defaults to `NativeMapBackend`. Users can plug in persistent
	 * (HAMT / Immutable.js) or shared-state backends via the {@link MapBackend} interface.
	 */
	backend?: MapBackend<K, V>;
	/**
	 * Optional versioning level for the underlying `entries` state node. Set at
	 * construction time; cannot be changed later. Pass `0` for V0 identity +
	 * monotonic version counter, or `1` for V1 + content-addressed cid.
	 */
	versioning?: VersioningLevel;
	/**
	 * Score-based retention policy. After every mutation, each live entry is
	 * scored; entries below `archiveThreshold` and / or over `maxSize` (lowest-
	 * scored first) are archived via `onArchive` before being removed.
	 *
	 * Retention replaces the ad-hoc "tierClassifier effect writing back to its
	 * own store dep" pattern — the feedback cycle is gone because archival is
	 * part of the atomic mutation, not a second reactive wave.
	 *
	 * Mutually exclusive with top-level `maxSize` (LRU). Pass one or the other.
	 */
	retention?: ReactiveMapRetention<K, V>;
	/**
	 * Enable the `mutationLog` delta companion log. When set, every mutation
	 * appends a typed `MapChange<K, V>` record in the same batch frame as
	 * the snapshot emission (same-wave consistency).
	 *
	 * - `true` — creates a log with default options.
	 * - `{ maxSize?, name? }` — forwards to the inner `reactiveLog`.
	 */
	mutationLog?: true | { maxSize?: number; name?: string };
} & Omit<NodeOptions, "initial" | "describeKind" | "equals" | "versioning">;

/**
 * Score-based retention policy for {@link reactiveMap}. Evaluated synchronously
 * on every successful mutation (`set` / `setMany` / `delete` / `clear` /
 * `pruneExpired`). Entries are archived in ascending score order until the
 * map satisfies both constraints:
 *
 * 1. Every remaining entry has `score >= archiveThreshold` (if set).
 * 2. Total entry count `<= maxSize` (if set).
 *
 * At least one of `archiveThreshold` / `maxSize` must be set; otherwise there's
 * no eviction trigger.
 *
 * **Archival order.** When multiple entries are candidates for archival in the
 * same mutation, they are archived in ascending score order (lowest first). On
 * score ties, iteration order (insertion order in the default backend) is the
 * tiebreak.
 *
 * **No recursion.** Archival deletes happen on the backend directly — they do
 * NOT re-enter the retention evaluator. The one-pass scan collects archival
 * candidates against the post-mutation snapshot before removing them.
 *
 * @category extra
 */
export type ReactiveMapRetention<K, V> = {
	/** Score entry — higher is kept. Should be a pure function of `(key, value)`. */
	score: (key: K, value: V) => number;
	/** Below-threshold entries are archived. Omit for pure `maxSize`-based retention. */
	archiveThreshold?: number;
	/**
	 * Cap on live entry count. Over this, the lowest-scored entries are
	 * archived until the size fits. Omit for pure threshold-based retention.
	 */
	maxSize?: number;
	/**
	 * Synchronous callback fired **before** archival deletion. Receives the
	 * key, value, and computed score. Callers typically persist the entry to
	 * a cold tier here (`await permanent.set(key, value)` — async is fine but
	 * the archival deletion happens synchronously after this callback
	 * returns).
	 */
	onArchive?: (key: K, value: V, score: number) => void;
};

export type ReactiveMapBundle<K, V> = {
	/** Emits `ReadonlyMap<K, V>` on each structural change (two-phase). */
	entries: Node<ReadonlyMap<K, V>>;
	/**
	 * Checks existence. O(1) for live keys. If the key is expired, prunes it AND
	 * emits a snapshot so the reactive surface stays consistent with the return
	 * value. Reads on expired keys are therefore **observable side effects**.
	 *
	 * **LRU touch (F4):** When `maxSize` is configured, a live-key `has` also
	 * marks the entry as most-recently-used — which rearranges internal insertion
	 * order without bumping `version` or emitting. If you care about iteration
	 * order in a downstream subscriber, rely on the `entries` snapshot (a fresh
	 * `ReadonlyMap` per mutation) rather than iterating the backend directly.
	 */
	has: (key: K) => boolean;
	/**
	 * Gets value. O(1) for live keys. If the key is expired, prunes it AND emits
	 * a snapshot. Reads on expired keys are therefore **observable side effects**.
	 *
	 * **LRU touch (F4):** When `maxSize` is configured, a live-key `get` also
	 * marks the entry as most-recently-used (no version bump, no emission). See
	 * `has` for the full note on iteration order.
	 */
	get: (key: K) => V | undefined;
	/**
	 * Sets value with optional TTL (seconds). Throws on `ttl <= 0`. Applies LRU eviction
	 * if `maxSize` is set. Always emits.
	 */
	set: (key: K, value: V, opts?: { ttl?: number }) => void;
	/**
	 * Bulk set — emits one snapshot for the whole batch. Applies `opts.ttl` (falls back
	 * to `defaultTtl`) to every entry. No-op if `entries` is empty.
	 *
	 * **Iterable consumption:** Consumes `entries` once (single-pass). Pass an array
	 * or `Set` for multi-shot consumers. If the iterator throws mid-iteration,
	 * entries already applied remain committed and a snapshot IS emitted (via the
	 * wrapper's finally-block).
	 */
	setMany: (entries: Iterable<readonly [K, V]>, opts?: { ttl?: number }) => void;
	delete: (key: K) => void;
	/**
	 * Bulk delete — emits one snapshot. No-op if no keys were present.
	 *
	 * **Iterable consumption:** Consumes `keys` once (single-pass).
	 */
	deleteMany: (keys: Iterable<K>) => void;
	clear: () => void;
	/**
	 * Current entry count — O(1), **pure read** (no emission). May include
	 * expired entries on TTL maps until a mutation or explicit
	 * `pruneExpired()` / `has(key)` / `get(key)` prunes them. Call
	 * `pruneExpired()` first if you need a live count.
	 */
	readonly size: number;
	/** Explicitly prunes all expired entries. Emits if any were removed. */
	pruneExpired: () => void;
	/**
	 * Delta companion log. Present iff `mutationLog` option was configured.
	 * Each mutation appends a typed `MapChange<K, V>` record in the same
	 * batch frame as the snapshot emission (same-wave consistency).
	 */
	readonly mutationLog?: ReactiveLogBundle<MapChange<K, V>>;
	/**
	 * Releases any internal keepalive subscriptions so the bundle can be
	 * GC'd. `reactiveMap` currently holds none (the `entries` node lives only
	 * as long as external subscribers keep it alive), so `dispose()` is a
	 * no-op today — exposed for API parity with `reactiveIndex.dispose` /
	 * `reactiveList.dispose` / `reactiveLog.dispose`. Idempotent. D6(a).
	 */
	dispose: () => void;
};

// ── Backend interface ─────────────────────────────────────────────────────

/**
 * Storage contract for {@link reactiveMap}. Implementations own the mutable state,
 * including optional TTL and LRU semantics, and expose a monotonic `version` counter
 * that increments on every change to visible state.
 *
 * The reactive layer reads `version` before and after each backend call; when it
 * advances, a snapshot is emitted. Reads (`has`, `get`) may internally prune the
 * target key if expired and advance `version` — in which case the layer emits so
 * subscribers see state consistent with the read's return value.
 *
 * @remarks Post-1.0 op-log changesets will extend this interface with a
 * `changesSince(version: number): Iterable<Change>` method. Current consumers
 * should treat all methods here as stable.
 *
 * @category extra
 */
export interface MapBackend<K, V> {
	/** Monotonic mutation counter; increments on every visible state change. */
	readonly version: number;
	/** Raw entry count (may include expired entries until a read / prune removes them). */
	readonly size: number;
	/** Checks existence. May prune target key if expired; advances `version` if pruned. */
	has(key: K): boolean;
	/** Gets value. May prune target key if expired; advances `version` if pruned. */
	get(key: K): V | undefined;
	/**
	 * Sets a value with optional TTL (seconds). Throws `RangeError` if `ttl <= 0`.
	 * Applies LRU eviction if `maxSize` is configured. Advances `version`.
	 *
	 * **Atomicity contract:** Either fully succeeds or throws before any state
	 * change; `version` advances only on success.
	 */
	set(key: K, value: V, ttl?: number): void;
	/**
	 * Atomic bulk set. Pre-validates TTL once, then applies all entries. Advances
	 * `version` at most once (even for N entries). No-op if iterable is empty.
	 *
	 * **Consumes `entries` once** — pass an array if you want repeatability.
	 *
	 * **Atomicity contract:** TTL validation throws before any mutation. If the
	 * iterable itself throws mid-iteration, entries committed before the throw
	 * remain persisted AND `version` is bumped once (surfaced via finally) so
	 * the reactive wrapper emits a snapshot reflecting the partial state. "At
	 * most once" invariant is preserved.
	 */
	setMany(entries: Iterable<readonly [K, V]>, ttl?: number): void;
	/** Removes a key. Returns `true` if the key existed. Advances `version` only if true. */
	delete(key: K): boolean;
	/**
	 * Atomic bulk delete. Returns count removed. Advances `version` at most once
	 * (even for N keys). No-op if no keys were present. Consumes `keys` once.
	 */
	deleteMany(keys: Iterable<K>): number;
	/** Removes all entries. Returns count removed. Advances `version` only if non-zero. */
	clear(): number;
	/** Removes all expired entries. Returns count removed. Advances `version` only if non-zero. */
	pruneExpired(): number;
	/** Fresh snapshot of non-expired entries (does NOT mutate state). */
	toMap(): ReadonlyMap<K, V>;
}

export type NativeMapBackendOptions = {
	maxSize?: number;
	/** Default TTL in seconds. */
	defaultTtl?: number;
};

type MapEntry<V> = { value: V; expiresAt?: number };

/**
 * Default `Map<K, {value, expiresAt}>` backend with optional per-key TTL and LRU cap.
 *
 * **Complexity:**
 * - `has`, `get`, `delete`, `size`: O(1)
 * - `set`: O(1) amortized (LRU touch + eviction)
 * - `pruneExpired`, `toMap`: O(n)
 *
 * LRU order uses native `Map` insertion order. `get` / `has` on a live key "touches"
 * it by delete-then-reinsert (moving it to the end). This touch does NOT advance
 * `version` — it's an internal optimization; the externally visible snapshot
 * preserves iteration order as of the last mutation. **Note:** because touch
 * reorders the internal `_store` without emitting, an in-process consumer iterating
 * `_store` directly (custom subclasses) could observe changing order; external
 * subscribers only see `toMap()` snapshots which are defensively copied and stable.
 *
 * @category extra
 */
export class NativeMapBackend<K, V> implements MapBackend<K, V> {
	private _version = 0;
	private readonly _store = new Map<K, MapEntry<V>>();
	private readonly _maxSize?: number;
	private readonly _defaultTtl?: number;

	constructor(options: NativeMapBackendOptions = {}) {
		const { maxSize, defaultTtl } = options;
		if (maxSize !== undefined && maxSize < 1) {
			throw new RangeError("maxSize must be >= 1");
		}
		if (defaultTtl !== undefined && defaultTtl <= 0) {
			throw new RangeError("defaultTtl must be positive");
		}
		this._maxSize = maxSize;
		this._defaultTtl = defaultTtl;
	}

	get version(): number {
		return this._version;
	}

	get size(): number {
		return this._store.size;
	}

	has(key: K): boolean {
		const e = this._store.get(key);
		if (e === undefined) return false;
		if (this._isExpired(e)) {
			this._store.delete(key);
			this._version += 1;
			return false;
		}
		this._touchLru(key, e);
		return true;
	}

	get(key: K): V | undefined {
		const e = this._store.get(key);
		if (e === undefined) return undefined;
		if (this._isExpired(e)) {
			this._store.delete(key);
			this._version += 1;
			return undefined;
		}
		this._touchLru(key, e);
		return e.value;
	}

	set(key: K, value: V, ttl?: number): void {
		const expiresAt = this._resolveExpiresAt(ttl);
		// Delete-then-insert to place key at LRU end.
		if (this._store.has(key)) this._store.delete(key);
		this._store.set(key, { value, expiresAt });
		this._evictLruWhileOver();
		this._version += 1;
	}

	setMany(entries: Iterable<readonly [K, V]>, ttl?: number): void {
		// Pre-validate TTL once (throws before any mutation).
		const expiresAt = this._resolveExpiresAt(ttl);
		let count = 0;
		try {
			for (const [key, value] of entries) {
				if (this._store.has(key)) this._store.delete(key);
				this._store.set(key, { value, expiresAt });
				count += 1;
			}
		} finally {
			// D3: if the iterable threw mid-iteration, entries committed before
			// the throw must still advance `version` so subscribers see the
			// partial state consistently. "At most once" is preserved.
			if (count > 0) {
				this._evictLruWhileOver();
				this._version += 1;
			}
		}
	}

	delete(key: K): boolean {
		const had = this._store.delete(key);
		if (had) this._version += 1;
		return had;
	}

	deleteMany(keys: Iterable<K>): number {
		let removed = 0;
		try {
			for (const k of keys) {
				if (this._store.delete(k)) removed += 1;
			}
		} finally {
			if (removed > 0) this._version += 1;
		}
		return removed;
	}

	clear(): number {
		const n = this._store.size;
		if (n === 0) return 0;
		this._store.clear();
		this._version += 1;
		return n;
	}

	pruneExpired(): number {
		const now = monotonicNs();
		let removed = 0;
		for (const [k, e] of this._store) {
			if (this._isExpired(e, now)) {
				this._store.delete(k);
				removed += 1;
			}
		}
		if (removed > 0) this._version += 1;
		return removed;
	}

	toMap(): ReadonlyMap<K, V> {
		const now = monotonicNs();
		const out = new Map<K, V>();
		for (const [k, e] of this._store) {
			if (!this._isExpired(e, now)) out.set(k, e.value);
		}
		return out;
	}

	private _resolveExpiresAt(ttl?: number): number | undefined {
		const effectiveTtl = ttl ?? this._defaultTtl;
		if (effectiveTtl === undefined) return undefined;
		if (!Number.isFinite(effectiveTtl) || effectiveTtl <= 0) {
			throw new RangeError(
				`MapBackend: ttl must be a positive finite number (got ${effectiveTtl})`,
			);
		}
		return monotonicNs() + effectiveTtl * 1_000_000_000;
	}

	private _isExpired(e: MapEntry<V>, now?: number): boolean {
		if (e.expiresAt === undefined) return false;
		return (now ?? monotonicNs()) >= e.expiresAt;
	}

	private _touchLru(key: K, entry: MapEntry<V>): void {
		// Move to LRU end. Does NOT advance `version` — internal optimization.
		this._store.delete(key);
		this._store.set(key, entry);
	}

	private _evictLruWhileOver(): void {
		if (this._maxSize === undefined) return;
		while (this._store.size > this._maxSize) {
			const first = this._store.keys().next().value as K | undefined;
			if (first === undefined) break;
			this._store.delete(first);
		}
	}
}

// ── Reactive wrapper ──────────────────────────────────────────────────────

/**
 * Creates a reactive `Map` with optional per-key TTL and optional LRU max size.
 *
 * @param options - `name`, `maxSize`, `defaultTtl` (seconds), or custom `backend`.
 * @returns `ReactiveMapBundle` — imperative methods (`has`/`get`/`set`/`setMany`/`delete`/
 *   `deleteMany`/`clear`/`pruneExpired`), reactive `entries` node, and O(1)-ish `size`.
 *
 * @remarks
 * **TTL:** Expiry is checked on `get`, `has`, `size`, `pruneExpired`, and before each
 * snapshot emission (expired keys are pruned first). Reads that discover expired keys
 * emit a snapshot so subscribers see state consistent with the read's return value.
 * There is no background timer; monotonic-clock expiry is immune to wall-clock changes.
 *
 * **LRU:** Uses native `Map` insertion order — `get` / `has` refreshes position via
 * delete-then-reinsert; under `maxSize` pressure the first key in iteration order is
 * evicted. LRU touching does NOT trigger emission (internal optimization).
 *
 * **Backend:** The default {@link NativeMapBackend} owns LRU/TTL. For persistent /
 * HAMT / shared-state semantics plug in a custom {@link MapBackend}. `maxSize` and
 * `defaultTtl` on the options object are only applied to the default backend — if
 * you supply `backend`, configure those on your backend directly.
 *
 * @example
 * ```ts
 * import { reactiveMap } from "@graphrefly/graphrefly-ts";
 *
 * const m = reactiveMap<string, number>({ name: "cache", maxSize: 100, defaultTtl: 60 });
 * m.set("x", 1);
 * m.setMany([["y", 2], ["z", 3]]);
 * m.entries.subscribe((msgs) => { console.log(msgs); });
 * ```
 *
 * @category extra
 */
export function reactiveMap<K, V>(options: ReactiveMapOptions<K, V> = {}): ReactiveMapBundle<K, V> {
	const {
		name,
		maxSize,
		defaultTtl,
		versioning,
		backend: userBackend,
		retention,
		mutationLog: mutLogOpt,
	} = options;
	if (retention && maxSize !== undefined) {
		throw new RangeError(
			"reactiveMap: `maxSize` (LRU) and `retention` (score-based) are mutually exclusive. Pick one eviction policy.",
		);
	}
	if (retention && retention.archiveThreshold === undefined && retention.maxSize === undefined) {
		throw new RangeError(
			"reactiveMap: `retention` requires at least one of `archiveThreshold` or `maxSize` to trigger archival.",
		);
	}
	const backend: MapBackend<K, V> =
		userBackend ?? new NativeMapBackend<K, V>({ maxSize, defaultTtl });

	// ── Mutation log companion (Phase 14.3) ──────────────────────────────────
	const mutLog: ReactiveLogBundle<MapChange<K, V>> | undefined = mutLogOpt
		? reactiveLog<MapChange<K, V>>(undefined, {
				name: mutLogOpt === true ? (name ? `${name}.mutationLog` : undefined) : mutLogOpt.name,
				maxSize: mutLogOpt === true ? undefined : mutLogOpt.maxSize,
			})
		: undefined;
	let mutVersion = 0;
	let pendingChanges: MapChangePayload<K, V>[] = [];
	function enqueueChange(payload: MapChangePayload<K, V>): void {
		if (!mutLog) return;
		pendingChanges.push(payload);
	}

	const n = node<ReadonlyMap<K, V>>([], {
		initial: backend.toMap(),
		name,
		describeKind: "state",
		equals: (a, b) => a === b,
		...(versioning != null ? { versioning } : {}),
	});

	function pushSnapshot(): void {
		const map = backend.toMap();
		const changes = pendingChanges;
		pendingChanges = [];
		batch(() => {
			n.down([[DIRTY]]);
			n.down([[DATA, map]]);
			for (const c of changes) {
				mutLog!.append({
					structure: "map",
					version: ++mutVersion,
					t_ns: wallClockNs(),
					lifecycle: "data",
					change: c,
				});
			}
		});
	}

	/**
	 * Run score-based retention over the current live entries. Called right
	 * before snapshot emission so subscribers see the final post-archival
	 * state in a single wave. Archived entries fire `onArchive` synchronously
	 * before deletion. Does not recurse — archival deletions bypass
	 * `wrapMutation` / retention.
	 */
	function applyRetention(): void {
		if (!retention) return;
		const live = backend.toMap();
		const threshold = retention.archiveThreshold;
		const cap = retention.maxSize;
		const scored: Array<{ key: K; value: V; score: number }> = [];
		for (const [key, value] of live) {
			scored.push({ key, value, score: retention.score(key, value) });
		}
		// Ascending score — lowest first, archived first.
		scored.sort((a, b) => a.score - b.score);
		const archiveSet = new Set<K>();
		// 1) Threshold: archive anything below.
		if (threshold !== undefined) {
			for (const s of scored) {
				if (s.score < threshold) archiveSet.add(s.key);
				else break; // scored is ascending — first >= threshold ends the sweep.
			}
		}
		// 2) maxSize: archive additional lowest-scored entries until under cap.
		if (cap !== undefined && scored.length - archiveSet.size > cap) {
			for (const s of scored) {
				if (scored.length - archiveSet.size <= cap) break;
				if (!archiveSet.has(s.key)) archiveSet.add(s.key);
			}
		}
		if (archiveSet.size === 0) return;
		for (const s of scored) {
			if (!archiveSet.has(s.key)) continue;
			retention.onArchive?.(s.key, s.value, s.score);
			backend.delete(s.key);
			enqueueChange({ kind: "delete", key: s.key, previous: s.value, reason: "archived" });
		}
	}

	/**
	 * Defense-in-depth emission guard: compares `version` before/after `op` and
	 * emits a snapshot if advanced. Uses `try/finally` so partial-mutation state
	 * from a custom non-atomic backend is still surfaced to subscribers if the
	 * op throws mid-way (native backends are atomic by contract and won't trip
	 * this path).
	 *
	 * `kind` gates retention: `"mutation"` paths (set/setMany/delete/…) run
	 * retention eviction; `"read"` paths (has/get) do NOT — a pure read that
	 * happens to prune an expired TTL entry should emit a consistency
	 * snapshot, but should NOT fire `onArchive` side-effects for unrelated
	 * low-scored entries. Users reading a TTL map expect read-time expiry
	 * pruning; they do NOT expect a `.get(x)` call to archive key `y`.
	 *
	 * **Distinguish from `mutate` in `src/extra/mutation/index.ts`:**
	 * that factory is the public Phase-4 audit framework — orchestration-tier
	 * batch + freeze + audit-record stamping. This `wrapMutation` is a file-
	 * private snapshot-delivery guard for the reactiveMap version counter.
	 * Different concern.
	 */
	function wrapMutation<T>(op: () => T, kind: "mutation" | "read" = "mutation"): T {
		const prev = backend.version;
		try {
			return op();
		} finally {
			if (backend.version !== prev) {
				if (kind === "mutation") applyRetention();
				pushSnapshot();
			} else {
				pendingChanges.length = 0;
			}
		}
	}

	return {
		entries: n,

		has(key: K): boolean {
			return wrapMutation(() => backend.has(key), "read");
		},

		get(key: K): V | undefined {
			return wrapMutation(() => backend.get(key), "read");
		},

		set(key: K, value: V, opts?: { ttl?: number }): void {
			wrapMutation(() => {
				backend.set(key, value, opts?.ttl);
				enqueueChange({ kind: "set", key, value });
			});
		},

		setMany(entries: Iterable<readonly [K, V]>, opts?: { ttl?: number }): void {
			wrapMutation(() => {
				// Materialize so we can emit per-entry changes.
				const arr = Array.isArray(entries) ? entries : [...entries];
				backend.setMany(arr, opts?.ttl);
				for (const [k, v] of arr) enqueueChange({ kind: "set", key: k, value: v });
			});
		},

		delete(key: K): void {
			wrapMutation(() => {
				const previous = backend.get(key);
				const removed = backend.delete(key);
				if (removed && previous !== undefined) {
					enqueueChange({ kind: "delete", key, previous, reason: "explicit" });
				}
			});
		},

		deleteMany(keys: Iterable<K>): void {
			wrapMutation(() => {
				const arr = Array.isArray(keys) ? keys : [...keys];
				// Capture previous values before deletion.
				const prevs: Array<{ key: K; previous: V }> = [];
				for (const k of arr) {
					const v = backend.get(k);
					if (v !== undefined) prevs.push({ key: k, previous: v });
				}
				backend.deleteMany(arr);
				for (const p of prevs) {
					enqueueChange({ kind: "delete", key: p.key, previous: p.previous, reason: "explicit" });
				}
			});
		},

		clear(): void {
			wrapMutation(() => {
				const count = backend.clear();
				if (count > 0) enqueueChange({ kind: "clear", count });
			});
		},

		pruneExpired(): void {
			wrapMutation(() => backend.pruneExpired());
		},

		/**
		 * Current raw entry count — O(1), **pure read**. May include
		 * not-yet-pruned expired entries on TTL maps until the next mutation
		 * or an explicit `pruneExpired()` / `has` / `get` triggers a prune.
		 *
		 * Previously this getter ran `pruneExpired()` inline and emitted a
		 * snapshot as a side effect — that violated spec §5.8 "no
		 * side-effectful reads" and created a re-entrancy hazard when a
		 * subscriber to `entries` read `.size` from its own callback. D2(a).
		 *
		 * For a live count that excludes expired entries, call
		 * `bundle.pruneExpired()` first.
		 */
		get size(): number {
			return backend.size;
		},

		mutationLog: mutLog,

		dispose(): void {
			if (mutLog) mutLog.dispose();
		},
	};
}
