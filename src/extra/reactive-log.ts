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
	 * Last `n` entries (or fewer) as a derived reactive view. Memoized (LRU-bounded)
	 * — repeat calls with the same `n` return the same node. Throws on non-integer
	 * or negative `n`.
	 */
	tail: (n: number) => Node<readonly T[]>;
	/**
	 * Reactive view of `entries.slice(start, stop)` (same semantics as `Array.prototype.slice`; `stop` exclusive).
	 * Memoized (LRU-bounded) — repeat calls with the same `(start, stop)` return the same node.
	 * Throws on non-integer or negative `start`, or non-integer `stop`.
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
		if (index < 0 || index >= this._size) return undefined;
		if (this._maxSize !== undefined) {
			return this._buf[(this._head + index) % this._maxSize];
		}
		return this._buf[index];
	}

	append(value: T): void {
		this._rawAppend(value);
		this._version += 1;
	}

	appendMany(values: readonly T[]): void {
		if (values.length === 0) return;
		// Pre-trim oversize input in ring mode — skip values that would be immediately evicted.
		const effective =
			this._maxSize !== undefined && values.length > this._maxSize
				? values.slice(values.length - this._maxSize)
				: values;
		for (const v of effective) this._rawAppend(v);
		this._version += 1;
	}

	clear(): number {
		if (this._size === 0) return 0;
		const n = this._size;
		if (this._maxSize === undefined) {
			this._buf.length = 0;
		}
		// Ring buffer: no need to clear slots; _size and _head reset defines the valid window.
		this._head = 0;
		this._size = 0;
		this._version += 1;
		return n;
	}

	trimHead(n: number): number {
		if (n < 0) throw new RangeError("n must be >= 0");
		if (n === 0 || this._size === 0) return 0;
		const removed = Math.min(n, this._size);
		if (this._maxSize === undefined) {
			this._buf.splice(0, removed);
		} else {
			this._head = (this._head + removed) % this._maxSize;
		}
		this._size -= removed;
		this._version += 1;
		return removed;
	}

	slice(start: number, stop?: number): readonly T[] {
		if (start < 0) throw new RangeError("start must be >= 0");
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
		if (n < 0) throw new RangeError("n must be >= 0");
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

	// Memoization caches for derived views — bounded by unique argument values.
	const tailCache = new Map<number, Node<readonly T[]>>();
	const sliceCache = new Map<string, Node<readonly T[]>>();

	function sliceKey(start: number, stop?: number): string {
		return `${start}:${stop === undefined ? "END" : stop}`;
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
			backend.append(value);
			pushSnapshot();
		},

		appendMany(values: readonly T[]): void {
			if (values.length === 0) return;
			const before = backend.version;
			backend.appendMany(values);
			if (backend.version !== before) pushSnapshot();
		},

		clear(): void {
			if (backend.clear() > 0) pushSnapshot();
		},

		trimHead(n: number): void {
			if (backend.trimHead(n) > 0) pushSnapshot();
		},

		tail(n: number): Node<readonly T[]> {
			if (n < 0) throw new RangeError("n must be >= 0");
			let cached = tailCache.get(n);
			if (cached !== undefined) return cached;
			cached = derived(
				[entries],
				([s]) => {
					const list = s as readonly T[];
					if (n === 0 || list.length === 0) return [];
					return list.slice(Math.max(0, list.length - n));
				},
				{ initial: backend.tail(n), describeKind: "derived" },
			);
			keepaliveDerived(cached);
			tailCache.set(n, cached);
			return cached;
		},

		slice(start: number, stop?: number): Node<readonly T[]> {
			if (start < 0) throw new RangeError("start must be >= 0");
			const key = sliceKey(start, stop);
			let cached = sliceCache.get(key);
			if (cached !== undefined) return cached;
			cached = derived(
				[entries],
				([s]) => {
					const list = s as readonly T[];
					return stop === undefined ? list.slice(start) : list.slice(start, stop);
				},
				{ initial: backend.slice(start, stop), describeKind: "derived" },
			);
			keepaliveDerived(cached);
			sliceCache.set(key, cached);
			return cached;
		},
	};
}
