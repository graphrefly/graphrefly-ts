/**
 * Reactive positional list (roadmap §3.2) — emits `readonly T[]` snapshots directly.
 *
 * Internal version counter drives efficient equality without leaking `Versioned`
 * into the public API (spec §5.12).
 *
 * **Wave 4 refactor (2026-04-15):** Introduces the `ListBackend<T>` pluggable-backend
 * interface. The default `NativeListBackend` uses a mutable array with a monotonic
 * `version` counter. No `maxSize` cap — bounded append-heavy workloads should use
 * `reactiveLog` (head-trim under cap is unambiguous for append-only; insert-anywhere
 * with a cap is not).
 */
import { batch } from "../core/batch.js";
import { DATA, DIRTY } from "../core/messages.js";
import { type Node, node } from "../core/node.js";
import type { VersioningLevel } from "../core/versioning.js";

export type ReactiveListOptions<T> = {
	name?: string;
	/**
	 * Storage backend. Defaults to `NativeListBackend` (flat mutable array).
	 * Users can plug in persistent / RRB-tree backends via the {@link ListBackend} interface.
	 */
	backend?: ListBackend<T>;
	/**
	 * Optional versioning level for the underlying `items` state node. Set at
	 * construction time; cannot be changed later. Pass `0` for V0 identity +
	 * monotonic version counter, or `1` for V1 + content-addressed cid.
	 */
	versioning?: VersioningLevel;
};

export type ReactiveListBundle<T> = {
	/** Emits `readonly T[]` on each structural change (two-phase). */
	readonly items: Node<readonly T[]>;
	/** Current entry count (O(1)). */
	readonly size: number;
	/** Positional access (O(1)); supports negative indices (Python-style). Returns `undefined` on out-of-range. */
	at: (index: number) => T | undefined;
	append: (value: T) => void;
	/** Push all values, emit one snapshot. No-op if `values` is empty. */
	appendMany: (values: readonly T[]) => void;
	/** Insert a value at `index`. Throws `RangeError` on out-of-range. */
	insert: (index: number, value: T) => void;
	/** Insert all values at `index` as one bulk op; emits one snapshot. No-op if `values` is empty. */
	insertMany: (index: number, values: readonly T[]) => void;
	/** Remove and return the value at `index` (default: last). Negative indices Python-style. Throws on empty / out-of-range. */
	pop: (index?: number) => T;
	clear: () => void;
	/**
	 * Releases any internal keepalive subscriptions so the bundle can be
	 * GC'd. `reactiveList` currently holds none (no internal derived nodes),
	 * so `dispose()` is a no-op today — exposed for API parity with
	 * `reactiveIndex.dispose` / `reactiveMap.dispose` / `reactiveLog.dispose`.
	 * Idempotent. D6(a).
	 */
	dispose: () => void;
};

// ── Backend interface ─────────────────────────────────────────────────────

/**
 * Storage contract for {@link reactiveList}. Implementations own the mutable state
 * and expose a monotonic `version` counter that increments on every structural change.
 *
 * The reactive layer reads `version` before and after each backend call; when it
 * advances, a snapshot is emitted.
 *
 * @remarks Post-1.0 op-log changesets will extend this interface with a
 * `changesSince(version: number): Iterable<Change>` method. Current consumers
 * should treat all methods here as stable.
 *
 * @category extra
 */
export interface ListBackend<T> {
	/** Monotonic mutation counter; increments on every structural change. */
	readonly version: number;
	/** Number of items currently stored. */
	readonly size: number;
	/** Positional access; `undefined` on out-of-range. */
	at(index: number): T | undefined;
	/** Append a single value. Advances `version`. */
	append(value: T): void;
	/** Append a batch. Advances `version` once. No-op if empty. */
	appendMany(values: readonly T[]): void;
	/** Insert at index; throws `RangeError` on out-of-range `0 <= index <= size`. Advances `version`. */
	insert(index: number, value: T): void;
	/** Bulk insert at index; throws on out-of-range. Advances `version` once. No-op if `values` empty. */
	insertMany(index: number, values: readonly T[]): void;
	/** Remove and return value at index; throws on empty / out-of-range. Advances `version`. */
	pop(index: number): T;
	/** Clear all entries. Returns count removed. Advances `version` only if non-zero. */
	clear(): number;
	/** Full snapshot as a fresh array. */
	toArray(): readonly T[];
}

/**
 * Default mutable-array backend.
 *
 * **Complexity:**
 * - `at`, `size`: O(1)
 * - `append`: O(1) amortized
 * - `appendMany(values)`, `insertMany(index, values)`: O(n + k) where k = values.length
 * - `insert`, `pop` (middle): O(n) due to splice
 * - `pop` (last): O(1)
 * - `clear`: O(1)
 * - `toArray`: O(n)
 *
 * @category extra
 */
export class NativeListBackend<T> implements ListBackend<T> {
	private _version = 0;
	private readonly _buf: T[];

	constructor(initial?: readonly T[]) {
		this._buf = initial ? [...initial] : [];
	}

	get version(): number {
		return this._version;
	}

	get size(): number {
		return this._buf.length;
	}

	at(index: number): T | undefined {
		if (!Number.isInteger(index)) return undefined;
		const i = index >= 0 ? index : this._buf.length + index;
		if (i < 0 || i >= this._buf.length) return undefined;
		return this._buf[i];
	}

	append(value: T): void {
		this._buf.push(value);
		this._version += 1;
	}

	appendMany(values: readonly T[]): void {
		if (values.length === 0) return;
		// Extra: avoid `this._buf.push(...values)` — spread-push has an
		// engine-dependent stack-argument limit (typically ~100k–500k), so
		// very large bulk inserts can throw "Maximum call stack size exceeded".
		// Indexed write is O(n) and has no spread limit.
		const oldLen = this._buf.length;
		this._buf.length = oldLen + values.length;
		for (let i = 0; i < values.length; i++) {
			this._buf[oldLen + i] = values[i] as T;
		}
		this._version += 1;
	}

	insert(index: number, value: T): void {
		if (!Number.isInteger(index) || index < 0 || index > this._buf.length) {
			throw new RangeError(`insert: index ${index} out of range [0, ${this._buf.length}]`);
		}
		this._buf.splice(index, 0, value);
		this._version += 1;
	}

	insertMany(index: number, values: readonly T[]): void {
		if (!Number.isInteger(index) || index < 0 || index > this._buf.length) {
			throw new RangeError(`insertMany: index ${index} out of range [0, ${this._buf.length}]`);
		}
		if (values.length === 0) return;
		this._buf.splice(index, 0, ...values);
		this._version += 1;
	}

	pop(index: number): T {
		if (this._buf.length === 0) {
			throw new RangeError("pop from empty list");
		}
		if (!Number.isInteger(index)) {
			throw new RangeError(`pop: index ${index} must be an integer`);
		}
		const i = index >= 0 ? index : this._buf.length + index;
		if (i < 0 || i >= this._buf.length) {
			throw new RangeError(`pop: index ${index} out of range`);
		}
		const [v] = this._buf.splice(i, 1);
		this._version += 1;
		return v as T;
	}

	clear(): number {
		const n = this._buf.length;
		if (n === 0) return 0;
		this._buf.length = 0;
		this._version += 1;
		return n;
	}

	toArray(): readonly T[] {
		return [...this._buf];
	}
}

// ── Reactive wrapper ──────────────────────────────────────────────────────

/**
 * Creates a reactive list with immutable array snapshots.
 *
 * @param initial - Optional initial items (copied).
 * @param options - Optional `name` for `describe()` / debugging, or pluggable `backend`.
 * @returns Bundle with `items` (state node), `size` / `at`, `append` / `appendMany` / `insert` /
 *   `insertMany` / `pop` / `clear`.
 *
 * @remarks
 * **No `maxSize`:** insert/pop-anywhere semantics make eviction-under-cap ambiguous.
 * For bounded append-heavy workloads use `reactiveLog` (head-trim is well-defined for
 * append-only).
 *
 * **Backend:** Default {@link NativeListBackend}. For persistent / RRB-tree semantics
 * supply a custom {@link ListBackend}. If you provide a `backend`, `initial` is ignored
 * — seed the backend directly.
 *
 * @example
 * ```ts
 * import { reactiveList } from "@graphrefly/graphrefly-ts";
 *
 * const list = reactiveList<string>(["a"], { name: "queue" });
 * list.append("b");
 * list.insertMany(1, ["x", "y"]);
 * ```
 *
 * @category extra
 */
export function reactiveList<T>(
	initial?: readonly T[],
	options: ReactiveListOptions<T> = {},
): ReactiveListBundle<T> {
	const { name, versioning, backend: userBackend } = options;
	const backend: ListBackend<T> = userBackend ?? new NativeListBackend<T>(initial);

	const items = node<readonly T[]>([], {
		initial: backend.toArray(),
		name,
		describeKind: "state",
		equals: (a, b) => a === b,
		...(versioning != null ? { versioning } : {}),
	});

	function pushSnapshot(): void {
		const snapshot = backend.toArray();
		batch(() => {
			items.down([[DIRTY]]);
			items.down([[DATA, snapshot]]);
		});
	}

	/**
	 * D4(a): try/finally defense-in-depth — if a custom backend op throws
	 * mid-mutation, surface the partial state via pushSnapshot so subscribers
	 * don't see a stale cache. Native ops are atomic by contract; this only
	 * matters for user-supplied backends. Mirrors the pattern in reactive-map,
	 * reactive-index, and reactive-log.
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
		items,

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
			wrapMutation(() => backend.appendMany(values));
		},

		insert(index: number, value: T): void {
			wrapMutation(() => backend.insert(index, value));
		},

		insertMany(index: number, values: readonly T[]): void {
			wrapMutation(() => backend.insertMany(index, values));
		},

		pop(index = -1): T {
			return wrapMutation(() => backend.pop(index));
		},

		clear(): void {
			wrapMutation(() => backend.clear());
		},

		dispose(): void {
			// D6(a): no internal keepalives — no-op for API parity. If a future
			// refactor adds a keepalive, wire its disposer here.
		},
	};
}
