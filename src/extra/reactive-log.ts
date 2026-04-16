/**
 * Reactive append-only log (roadmap §3.2) — emits `readonly T[]` snapshots directly.
 *
 * Internal version counter drives efficient equality without leaking `Versioned`
 * into the public API (spec §5.12).
 *
 * **Wave 4 refactor (2026-04-15):** Introduces the `LogBackend<T>` pluggable-backend
 * interface. The default `NativeLogBackend` uses a ring buffer when `maxSize` is set
 * (O(1) append + trim) and a flat array otherwise. `tail(n)` and `slice(start, stop)`
 * are memoized — repeat calls with identical arguments return the same derived node,
 * bounding the keepalive-subscription footprint. The standalone `logSlice` factory
 * has been removed; use `log.slice(start, stop)` instead.
 */
import { batch } from "../core/batch.js";
import { DATA, DIRTY } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { derived, state } from "../core/sugar.js";
import type { VersioningLevel } from "../core/versioning.js";

export type ReactiveLogOptions<T> = {
	name?: string;
	maxSize?: number;
	/**
	 * Optional versioning level for the underlying `entries` state node. Set
	 * at construction time; cannot be changed later. Pass `0` for V0 identity
	 * + monotonic version counter, or `1` for V1 + content-addressed cid.
	 */
	versioning?: VersioningLevel;
	/**
	 * Storage backend. Defaults to `NativeLogBackend` (ring buffer if `maxSize` is set,
	 * flat array otherwise). Users can plug in persistent / RRB-tree backends via
	 * the {@link LogBackend} interface.
	 */
	backend?: LogBackend<T>;
};

export type ReactiveLogBundle<T> = {
	/** Emits `readonly T[]` on each append/clear/trim (two-phase). */
	readonly entries: Node<readonly T[]>;
	/** Current entry count (O(1)). */
	readonly size: number;
	/** Positional access (O(1)); returns `undefined` on out-of-range. Supports negative indices (Python-style). */
	at: (index: number) => T | undefined;
	append: (value: T) => void;
	/**
	 * Push all values, emit one snapshot. No-op if `values` is empty.
	 * **Iterable consumption:** `values` is a `readonly T[]` — safe to pass arrays.
	 */
	appendMany: (values: readonly T[]) => void;
	clear: () => void;
	/** Remove the first `n` entries (clamped to `size`). Throws on non-integer or negative `n`. */
	trimHead: (n: number) => void;
	/**
	 * Last `n` entries (or fewer) as a derived reactive view. Memoized with
	 * an LRU cache (default cap 64) — repeat calls with the same `n` return
	 * the same node. Throws on non-integer or negative `n`.
	 *
	 * **LRU eviction contract (D3(b)):** when a 65th distinct `n` is passed,
	 * the least-recently-used cached view is evicted and its keepalive is
	 * disposed. External holders of the evicted node will NOT receive further
	 * updates — re-call `tail(n)` for a fresh node, or dispose proactively
	 * via {@link disposeTail} / {@link disposeAllViews}. To avoid surprise:
	 * resolve `tail(n)` at the point of use rather than caching the returned
	 * node across many distinct `n`s.
	 */
	tail: (n: number) => Node<readonly T[]>;
	/**
	 * Reactive view of `entries.slice(start, stop)` — non-negative integer
	 * `start`, non-negative integer `stop` (exclusive) or `undefined` (to end).
	 * Memoized with an LRU cache (default cap 64) — repeat calls with the
	 * same `(start, stop)` return the same node.
	 *
	 * Throws on non-integer `start`, negative `start`, non-integer `stop`, or
	 * negative `stop` (P4 — the backend cannot cheaply honor JS-style
	 * negative `stop` without scanning length; disallowed for a consistent
	 * contract between backend, derived recomputation, and cached initial).
	 *
	 * **LRU eviction contract (D3(b)):** same as {@link tail} — past 64
	 * distinct `(start, stop)` pairs, the oldest cached view is evicted and
	 * its keepalive disposed. External holders stop receiving updates.
	 */
	slice: (start: number, stop?: number) => Node<readonly T[]>;
	/**
	 * Releases the cached `tail(n)` view if present (disposes its keepalive
	 * subscription). Subsequent `tail(n)` calls create a fresh node. No-op if
	 * `n` was not cached. Returns `true` if a view was disposed.
	 */
	disposeTail: (n: number) => boolean;
	/**
	 * Releases the cached `slice(start, stop?)` view if present. No-op if not cached.
	 */
	disposeSlice: (start: number, stop?: number) => boolean;
	/** Releases all cached tail/slice views and their keepalive subscriptions. */
	disposeAllViews: () => void;
	/**
	 * Releases all internal keepalive subscriptions so the bundle can be
	 * GC'd — currently equivalent to {@link disposeAllViews}, but exposed as
	 * a uniform API across all reactive data structures for lifecycle
	 * symmetry (mirrors `reactiveMap.dispose` / `reactiveList.dispose` /
	 * `reactiveIndex.dispose`). Idempotent. D6(a).
	 */
	dispose: () => void;
};

// ── Backend interface ─────────────────────────────────────────────────────

/**
 * Storage contract for {@link reactiveLog}. Implementations own the mutable state and
 * expose a monotonic `version` counter that increments on every structural change.
 *
 * The reactive layer reads `version` to decide when to emit; it does not inspect
 * internal representation. Users can plug in persistent / ring-buffer / skip-list
 * backends without touching the reactive emission logic.
 *
 * @remarks Post-1.0 op-log changesets will extend this interface with a
 * `changesSince(version: number): Iterable<Change>` method. Current consumers
 * should treat all methods here as stable.
 *
 * @category extra
 */
export interface LogBackend<T> {
	/** Monotonic mutation counter; increments on every append/trim/clear that changes state. */
	readonly version: number;
	/** Number of entries currently stored. */
	readonly size: number;
	/** O(1) positional access; returns `undefined` on out-of-range. */
	at(index: number): T | undefined;
	/** Append a value. Applies `maxSize` head-drop if configured. Advances `version`. */
	append(value: T): void;
	/** Append a batch; advances `version` once. No-op if `values.length === 0`. */
	appendMany(values: readonly T[]): void;
	/** Remove all entries. Returns count removed. Advances `version` only if non-zero. */
	clear(): number;
	/** Remove the first `n` entries (clamped). Returns count removed. Throws on negative `n`. */
	trimHead(n: number): number;
	/** Fresh snapshot array for `[start, stop)`. Throws on negative `start`. */
	slice(start: number, stop?: number): readonly T[];
	/** Last `n` entries as a fresh array. Throws on negative `n`. */
	tail(n: number): readonly T[];
	/** Full snapshot as a fresh array. */
	toArray(): readonly T[];
}

/**
 * Default append-only log backend.
 *
 * - When `maxSize` is set: uses a **ring buffer** with `_head` index and circular
 *   modular arithmetic. Append and trim become O(1); snapshot is O(size) unrolling.
 * - When `maxSize` is unset: uses a flat array with standard push/splice.
 *
 * `appendMany` pre-trims oversize input: if `values.length > maxSize`, only the
 * tail of `values` is pushed (the rest would be immediately evicted).
 *
 * @category extra
 */
export class NativeLogBackend<T> implements LogBackend<T> {
	private _version = 0;
	private readonly _maxSize?: number;
	private readonly _buf: T[];
	private _head = 0;
	private _size = 0;

	constructor(initial?: readonly T[], maxSize?: number) {
		if (maxSize !== undefined && maxSize < 1) {
			throw new RangeError("maxSize must be >= 1");
		}
		this._maxSize = maxSize;
		if (maxSize !== undefined) {
			// Ring buffer mode — pre-allocate fixed size
			this._buf = new Array(maxSize);
			if (initial && initial.length > 0) {
				const take = Math.min(initial.length, maxSize);
				const start = initial.length - take;
				for (let i = 0; i < take; i++) {
					this._buf[i] = initial[start + i]!;
				}
				this._size = take;
			}
		} else {
			// Unbounded mode — dynamic array
			this._buf = initial ? [...initial] : [];
			this._size = this._buf.length;
		}
	}

	get version(): number {
		return this._version;
	}

	get size(): number {
		return this._size;
	}

	at(index: number): T | undefined {
		if (!Number.isInteger(index)) return undefined;
		// P5: Python-style negative index — `-1` returns the last entry.
		const i = index >= 0 ? index : this._size + index;
		if (i < 0 || i >= this._size) return undefined;
		if (this._maxSize !== undefined) {
			return this._buf[(this._head + i) % this._maxSize];
		}
		return this._buf[i];
	}

	append(value: T): void {
		this._rawAppend(value);
		this._version += 1;
	}

	appendMany(values: readonly T[]): void {
		if (values.length === 0) return;
		// Pre-trim oversize input in ring mode — skip values that would be
		// immediately evicted. Iterate with a start index instead of
		// allocating an intermediate slice. F2.
		const start =
			this._maxSize !== undefined && values.length > this._maxSize
				? values.length - this._maxSize
				: 0;
		for (let i = start; i < values.length; i++) {
			this._rawAppend(values[i] as T);
		}
		this._version += 1;
	}

	clear(): number {
		if (this._size === 0) return 0;
		const n = this._size;
		if (this._maxSize === undefined) {
			this._buf.length = 0;
		} else {
			// Ring buffer: only null the currently-live window so the GC can
			// reclaim ref-typed `T`. Iterating the full capacity would be O(cap)
			// even when only a few slots are in use (P6). Non-live slots are
			// already `undefined` (pre-allocation state) or whatever a prior
			// trim/clear left — they hold no live refs.
			for (let i = 0; i < n; i++) {
				this._buf[(this._head + i) % this._maxSize] = undefined as unknown as T;
			}
		}
		this._head = 0;
		this._size = 0;
		this._version += 1;
		return n;
	}

	trimHead(n: number): number {
		if (!Number.isInteger(n) || n < 0) {
			throw new RangeError(`trimHead: n must be a non-negative integer (got ${n})`);
		}
		if (n === 0 || this._size === 0) return 0;
		const removed = Math.min(n, this._size);
		if (this._maxSize === undefined) {
			this._buf.splice(0, removed);
		} else {
			// Null trimmed slots so the GC can reclaim ref-typed T (P4 extension).
			for (let i = 0; i < removed; i++) {
				this._buf[(this._head + i) % this._maxSize] = undefined as unknown as T;
			}
			this._head = (this._head + removed) % this._maxSize;
		}
		this._size -= removed;
		this._version += 1;
		return removed;
	}

	slice(start: number, stop?: number): readonly T[] {
		if (!Number.isInteger(start) || start < 0) {
			throw new RangeError(`slice: start must be a non-negative integer (got ${start})`);
		}
		// P4: reject negative `stop` explicitly so the bundle / backend / derived
		// contract stays consistent. Previously stop was silently clamped to 0,
		// producing `[]` in the backend but a different value under JS semantics
		// in the derived recomputation — a latent bug for negative inputs.
		if (stop !== undefined && (!Number.isInteger(stop) || stop < 0)) {
			throw new RangeError(`slice: stop must be a non-negative integer or undefined (got ${stop})`);
		}
		const end = stop === undefined ? this._size : Math.min(Math.max(stop, 0), this._size);
		const s = Math.min(start, this._size);
		if (s >= end) return [];
		const len = end - s;
		if (this._maxSize === undefined) {
			return this._buf.slice(s, end);
		}
		const out: T[] = new Array(len);
		for (let i = 0; i < len; i++) {
			out[i] = this._buf[(this._head + s + i) % this._maxSize]!;
		}
		return out;
	}

	tail(n: number): readonly T[] {
		if (!Number.isInteger(n) || n < 0) {
			throw new RangeError(`tail: n must be a non-negative integer (got ${n})`);
		}
		if (n === 0 || this._size === 0) return [];
		const take = Math.min(n, this._size);
		return this.slice(this._size - take, this._size);
	}

	toArray(): readonly T[] {
		if (this._maxSize === undefined) {
			return [...this._buf];
		}
		const out: T[] = new Array(this._size);
		for (let i = 0; i < this._size; i++) {
			out[i] = this._buf[(this._head + i) % this._maxSize]!;
		}
		return out;
	}

	/** Internal append without version bump — used by `appendMany`. */
	private _rawAppend(value: T): void {
		if (this._maxSize === undefined) {
			this._buf.push(value);
			this._size = this._buf.length;
			return;
		}
		if (this._size < this._maxSize) {
			this._buf[(this._head + this._size) % this._maxSize] = value;
			this._size += 1;
		} else {
			// Overwrite slot at head, advance head.
			this._buf[this._head] = value;
			this._head = (this._head + 1) % this._maxSize;
		}
	}
}

// ── Reactive wrapper ──────────────────────────────────────────────────────

/** Installs a keepalive subscription; returns the disposer so callers can release it. */
function keepaliveDerived(n: Node<unknown>): () => void {
	return n.subscribe(() => {});
}

/** Default cap on the LRU view cache for `tail(n)` / `slice(start, stop?)`. D2(c). */
const DEFAULT_VIEW_CACHE_MAX = 64;

/**
 * Creates an append-only reactive log with immutable array snapshots.
 *
 * @param initial - Optional seed entries (copied; pre-trimmed to `maxSize` if set).
 * @param options - `name`, `maxSize`, and optional pluggable `backend`.
 * @returns Bundle with `entries` (state node), `append`/`appendMany`/`clear`/`trimHead`,
 *   `size` / `at`, and memoized derived views `tail(n)` / `slice(start, stop?)`.
 *
 * @remarks
 * **Backend:** The default {@link NativeLogBackend} uses a ring buffer when `maxSize`
 * is set (O(1) append + trim) and a flat array otherwise. For persistent/structural-
 * sharing semantics plug in a custom {@link LogBackend}.
 *
 * **`initial` + custom `backend` (F5):** When you supply `options.backend`, the
 * `initial` argument is IGNORED — seed the backend yourself before passing it in.
 * The `initial` seed only applies to the default `NativeLogBackend`.
 *
 * **Memoized views:** {@link ReactiveLogBundle.tail} and {@link ReactiveLogBundle.slice}
 * cache derived nodes per-argument. Repeat calls with the same `n` / `(start, stop)`
 * return the same node, bounding keepalive-subscription count to one per unique argument.
 *
 * @example
 * ```ts
 * import { reactiveLog } from "@graphrefly/graphrefly-ts";
 *
 * const lg = reactiveLog<number>([1, 2], { name: "audit", maxSize: 100 });
 * lg.append(3);
 * lg.entries.subscribe((msgs) => console.log(msgs));
 * const last5 = lg.tail(5);          // derived node
 * const window = lg.slice(10, 20);   // derived node
 * ```
 *
 * @category extra
 */
export function reactiveLog<T>(
	initial?: readonly T[],
	options: ReactiveLogOptions<T> = {},
): ReactiveLogBundle<T> {
	const { name, maxSize, versioning, backend: userBackend } = options;
	const backend: LogBackend<T> = userBackend ?? new NativeLogBackend<T>(initial, maxSize);

	const entries = state<readonly T[]>(backend.toArray(), {
		name,
		describeKind: "state",
		equals: (a, b) => a === b,
		...(versioning != null ? { versioning } : {}),
	});

	function pushSnapshot(): void {
		const snapshot = backend.toArray();
		batch(() => {
			entries.down([[DIRTY]]);
			entries.down([[DATA, snapshot]]);
		});
	}

	// Memoization caches for derived views (D2(c)). Each cache is an LRU keyed by
	// the unique view argument, bounded by `DEFAULT_VIEW_CACHE_MAX`. On cache miss
	// past the cap, the least-recently-used entry is evicted and its keepalive
	// disposer is called so the underlying derived node can be GC'd. Callers can
	// also release views proactively via `disposeTail` / `disposeSlice` /
	// `disposeAllViews`. Iteration order of `Map` is insertion order, so moving
	// an entry to the end on hit is the LRU "touch".
	type ViewEntry = { node: Node<readonly T[]>; dispose: () => void };
	const tailCache = new Map<number, ViewEntry>();
	const sliceCache = new Map<string, ViewEntry>();

	function sliceKey(start: number, stop?: number): string {
		return `${start}:${stop === undefined ? "END" : stop}`;
	}

	function evictOldestIfFull<K>(cache: Map<K, ViewEntry>): void {
		if (cache.size < DEFAULT_VIEW_CACHE_MAX) return;
		const first = cache.keys().next();
		if (first.done) return;
		const oldest = cache.get(first.value);
		if (oldest !== undefined) oldest.dispose();
		cache.delete(first.value);
	}

	/**
	 * D4(a): try/finally defense-in-depth — if a custom backend op throws
	 * mid-mutation, surface the partial state via pushSnapshot so subscribers
	 * don't see a stale cache. Matches the pattern in reactive-map and
	 * reactive-index. Native ops are atomic by contract; this only matters
	 * for user-supplied backends.
	 */
	function wrapMutation<R>(op: () => R): R {
		const prev = backend.version;
		try {
			return op();
		} finally {
			if (backend.version !== prev) pushSnapshot();
		}
	}

	return {
		entries,

		get size(): number {
			return backend.size;
		},

		at(index: number): T | undefined {
			return backend.at(index);
		},

		append(value: T): void {
			wrapMutation(() => backend.append(value));
		},

		appendMany(values: readonly T[]): void {
			if (values.length === 0) return;
			wrapMutation(() => backend.appendMany(values));
		},

		clear(): void {
			wrapMutation(() => backend.clear());
			// NOTE: cached tail/slice derived views are intentionally NOT
			// disposed here. Disposing would kill the keepalive on any node
			// a caller already holds externally, silently stopping their
			// updates. The derived nodes recompute from the new empty
			// snapshot when `entries` emits post-clear, so `.cache` on an
			// outstanding view settles to `[]` without any manual
			// reset. (Initial snapshots, if inspected before the next wave,
			// may be stale — callers who care can `disposeTail` / `slice`
			// explicitly.)
		},

		trimHead(n: number): void {
			wrapMutation(() => backend.trimHead(n));
		},

		tail(n: number): Node<readonly T[]> {
			if (!Number.isInteger(n) || n < 0) {
				throw new RangeError(`tail: n must be a non-negative integer (got ${n})`);
			}
			const hit = tailCache.get(n);
			if (hit !== undefined) {
				// LRU touch: move to end of insertion order.
				tailCache.delete(n);
				tailCache.set(n, hit);
				return hit.node;
			}
			evictOldestIfFull(tailCache);
			const node_ = derived(
				[entries],
				([s]) => {
					const list = s as readonly T[];
					if (n === 0 || list.length === 0) return [];
					return list.slice(Math.max(0, list.length - n));
				},
				{ initial: backend.tail(n), describeKind: "derived" },
			);
			const dispose = keepaliveDerived(node_);
			tailCache.set(n, { node: node_, dispose });
			return node_;
		},

		slice(start: number, stop?: number): Node<readonly T[]> {
			if (!Number.isInteger(start) || start < 0) {
				throw new RangeError(`slice: start must be a non-negative integer (got ${start})`);
			}
			// P4: reject negative stop explicitly to keep bundle / backend / derived
			// consistent (JS `Array.prototype.slice` supports negative stop, but the
			// backend can't cheaply honor it without scanning length, so we disallow).
			if (stop !== undefined && (!Number.isInteger(stop) || stop < 0)) {
				throw new RangeError(
					`slice: stop must be a non-negative integer or undefined (got ${stop})`,
				);
			}
			const key = sliceKey(start, stop);
			const hit = sliceCache.get(key);
			if (hit !== undefined) {
				sliceCache.delete(key);
				sliceCache.set(key, hit);
				return hit.node;
			}
			evictOldestIfFull(sliceCache);
			const node_ = derived(
				[entries],
				([s]) => {
					const list = s as readonly T[];
					return stop === undefined ? list.slice(start) : list.slice(start, stop);
				},
				{ initial: backend.slice(start, stop), describeKind: "derived" },
			);
			const dispose = keepaliveDerived(node_);
			sliceCache.set(key, { node: node_, dispose });
			return node_;
		},

		disposeTail(n: number): boolean {
			const hit = tailCache.get(n);
			if (hit === undefined) return false;
			hit.dispose();
			tailCache.delete(n);
			return true;
		},

		disposeSlice(start: number, stop?: number): boolean {
			const key = sliceKey(start, stop);
			const hit = sliceCache.get(key);
			if (hit === undefined) return false;
			hit.dispose();
			sliceCache.delete(key);
			return true;
		},

		disposeAllViews(): void {
			for (const entry of tailCache.values()) entry.dispose();
			tailCache.clear();
			for (const entry of sliceCache.values()) entry.dispose();
			sliceCache.clear();
		},

		dispose(): void {
			// D6(a): currently identical to disposeAllViews. Exposed as a
			// uniform lifecycle API across all 4 reactive data structures.
			for (const entry of tailCache.values()) entry.dispose();
			tailCache.clear();
			for (const entry of sliceCache.values()) entry.dispose();
			sliceCache.clear();
		},
	};
}
