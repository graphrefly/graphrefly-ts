/**
 * Dual-key sorted index (roadmap §3.2) — unique primary key, rows ordered by `(secondary, primary)`.
 *
 * Emits `readonly IndexRow[]` snapshots directly — no `Versioned` wrapper (spec §5.12).
 *
 * **Wave 4 pilot (2026-04-15):** Introduces the `IndexBackend<K, V>` pluggable-backend interface.
 * The default `NativeIndexBackend` maintains a parallel `Map<K, IndexRow>` for O(1) `has`/`get`
 * and eliminates the O(n) filter pass during `upsert`/`delete`. A monotonic `version` counter
 * on the backend tracks mutations — foundation for post-1.0 op-log changesets.
 */
import { batch } from "../../core/batch.js";
import { wallClockNs } from "../../core/clock.js";
import { DATA, DIRTY } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import type { VersioningLevel } from "../../core/versioning.js";
import type { IndexChange, IndexChangePayload } from "./change.js";
import { type ReactiveLogBundle, reactiveLog } from "./reactive-log.js";

export type IndexRow<K, V = unknown> = {
	readonly primary: K;
	readonly secondary: unknown;
	readonly value: V;
};

export type ReactiveIndexOptions<K, V = unknown> = {
	/** Optional registry name for `describe()` / debugging. */
	name?: string;
	/**
	 * Storage backend. Defaults to `NativeIndexBackend` (flat array + parallel `Map<K,IndexRow>`).
	 * Users can plug in persistent / B-tree backends via the {@link IndexBackend} interface.
	 */
	backend?: IndexBackend<K, V>;
	/**
	 * Optional versioning level for the underlying `ordered` state node. Set at
	 * construction time; cannot be changed later. Pass `0` for V0 identity +
	 * monotonic version counter, or `1` for V1 + content-addressed cid.
	 * (The `byPrimary` derived node inherits through the dep graph.)
	 */
	versioning?: VersioningLevel;
	/**
	 * Default row-equality used to short-circuit idempotent upserts. When
	 * provided, every `upsert` / `upsertMany` that finds an existing primary
	 * compares the stored and candidate rows via `equals(existing, next)` —
	 * on `true` the call is a no-op (no version bump, no emission). Per-call
	 * `UpsertOptions.equals` overrides this default. Analogous to
	 * `NodeOptions.equals` on the core `node()` primitive.
	 */
	equals?: (existing: IndexRow<K, V>, next: IndexRow<K, V>) => boolean;
	/**
	 * Enable the `mutationLog` delta companion log. When set, every mutation
	 * appends a typed `IndexChange<K, V>` record in the same batch frame as
	 * the snapshot emission (same-wave consistency).
	 *
	 * - `true` — creates a log with default options.
	 * - `{ maxSize?, name? }` — forwards to the inner `reactiveLog`.
	 */
	mutationLog?: true | { maxSize?: number; name?: string };
};

export type ReactiveIndexBundle<K, V = unknown> = {
	/** Rows sorted by `(secondary, primary)`. */
	readonly ordered: Node<readonly IndexRow<K, V>[]>;
	/** Map from primary key to stored value. */
	readonly byPrimary: Node<ReadonlyMap<K, V>>;
	/** O(1) primary-key existence check. */
	has: (primary: K) => boolean;
	/** O(1) value lookup by primary key. */
	get: (primary: K) => V | undefined;
	/** Number of rows currently in the index (O(1)). */
	readonly size: number;
	/**
	 * Upserts a row. When `opts.equals(existing, next)` returns `true` for an
	 * existing primary key, the upsert is a no-op (no version bump, no emission).
	 * Useful for idempotent writes.
	 *
	 * @returns `true` if a new row was inserted (primary key was absent),
	 *   `false` if the primary key was already present (updated in place OR
	 *   skipped idempotently via `opts.equals`). D5(a).
	 */
	upsert: (primary: K, secondary: unknown, value: V, opts?: UpsertOptions<K, V>) => boolean;
	/**
	 * Bulk upsert — emits one snapshot for the whole batch. `opts.equals` applied
	 * per-row. No-op if empty or all rows skipped.
	 *
	 * **Iterable consumption:** Consumes `rows` once (single-pass).
	 */
	upsertMany: (
		rows: Iterable<{ primary: K; secondary: unknown; value: V }>,
		opts?: UpsertOptions<K, V>,
	) => void;
	delete: (primary: K) => void;
	/**
	 * Bulk delete — emits one snapshot for the whole batch. No-op if nothing was removed.
	 *
	 * **Iterable consumption:** Consumes `primaries` once (single-pass).
	 */
	deleteMany: (primaries: Iterable<K>) => void;
	clear: () => void;
	/**
	 * Delta companion log. Present iff `mutationLog` option was configured.
	 * Each mutation appends a typed `IndexChange<K, V>` record in the same
	 * batch frame as the snapshot emission (same-wave consistency).
	 */
	readonly mutationLog?: ReactiveLogBundle<IndexChange<K, V>>;
	/**
	 * Releases internal keepalive subscriptions (on `byPrimary`) so the bundle
	 * can be GC'd. Safe to call more than once (subsequent calls are no-ops).
	 * Subsequent mutations after `dispose()` still execute on the backend but
	 * `byPrimary` may stop updating if no external subscriber is attached.
	 * D6(a).
	 */
	dispose: () => void;
};

// ── Ordering ──────────────────────────────────────────────────────────────

/** Lexicographic ordering for index keys (mirrors Python tuple compare for typical primitives). */
function cmpOrd(a: unknown, b: unknown): number {
	if (a === b) return 0;
	const ta = typeof a;
	const tb = typeof b;
	if (ta === tb && (ta === "number" || ta === "string" || ta === "boolean" || ta === "bigint")) {
		const ax = a as number | string | boolean | bigint;
		const bx = b as number | string | boolean | bigint;
		if (ax < bx) return -1;
		if (ax > bx) return 1;
		return 0;
	}
	return String(a).localeCompare(String(b));
}

function compareKeys<K>(a: [unknown, K], b: [unknown, K]): number {
	const c = cmpOrd(a[0], b[0]);
	if (c !== 0) return c;
	return cmpOrd(a[1], b[1]);
}

function rowKey<K, V>(row: IndexRow<K, V>): [unknown, K] {
	return [row.secondary, row.primary];
}

function bisectLeft<K, V>(rows: readonly IndexRow<K, V>[], row: IndexRow<K, V>): number {
	const k = rowKey(row);
	let lo = 0;
	let hi = rows.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (compareKeys(k, rowKey(rows[mid]!)) > 0) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

// ── Backend interface ─────────────────────────────────────────────────────

/**
 * Storage contract for {@link reactiveIndex}. Implementations own the mutable state and
 * expose a monotonic `version` counter that increments on every structural change.
 *
 * The reactive layer reads `version` to decide when to emit; it does not inspect
 * internal representation. Users can plug in B-tree / skip-list / persistent backends
 * without touching the reactive emission logic.
 *
 * @remarks Post-1.0 op-log changesets will extend this interface with a
 * `changesSince(version: number): Iterable<Change>` method. Current consumers
 * should treat all methods here as stable.
 *
 * @category extra
 */
/**
 * Optional per-call options for {@link IndexBackend.upsert} and bulk upsert.
 *
 * @category extra
 */
export type UpsertOptions<K, V> = {
	/**
	 * Skip the upsert if an existing row is considered equal to the proposed row.
	 * Default: no skip — every upsert advances `version`. Provide for idempotent
	 * keys (e.g., `(a, b) => a.secondary === b.secondary && a.value === b.value`).
	 */
	equals?: (existing: IndexRow<K, V>, next: IndexRow<K, V>) => boolean;
};

export interface IndexBackend<K, V = unknown> {
	/** Monotonic mutation counter; increments on every upsert/delete/clear that changes state. */
	readonly version: number;
	/** Number of rows currently stored. */
	readonly size: number;
	/** O(1) primary-key existence check. */
	has(primary: K): boolean;
	/** Value lookup by primary key. */
	get(primary: K): V | undefined;
	/**
	 * Insert or replace a row. Returns `true` if a row was inserted (primary
	 * didn't exist), `false` otherwise (updated OR skipped via `opts.equals`).
	 *
	 * **Atomicity contract:** Either fully succeeds or throws before any state
	 * change; `version` advances only on state change.
	 */
	upsert(primary: K, secondary: unknown, value: V, opts?: UpsertOptions<K, V>): boolean;
	/**
	 * Atomic bulk upsert. Returns the number of rows that caused a state change
	 * (inserts + non-skipped updates). Advances `version` at most once.
	 * No-op if iterable is empty or all rows skipped by `opts.equals`.
	 *
	 * **Consumes `rows` once** — pass an array for multi-shot consumers.
	 */
	upsertMany(
		rows: Iterable<{ primary: K; secondary: unknown; value: V }>,
		opts?: UpsertOptions<K, V>,
	): number;
	/** Remove a row by primary key. Returns `true` if the row existed. Advances `version` only if true. */
	delete(primary: K): boolean;
	/**
	 * Atomic bulk delete. Returns count removed. Advances `version` at most once.
	 * No-op if no keys were present. Consumes `primaries` once.
	 */
	deleteMany(primaries: Iterable<K>): number;
	/** Remove all rows. Returns the number removed. Advances `version` only if non-zero. */
	clear(): number;
	/** Rows in sorted `(secondary, primary)` order — fresh snapshot suitable for emission. */
	toArray(): readonly IndexRow<K, V>[];
	/** Primary-key → value map — fresh snapshot. */
	toPrimaryMap(): ReadonlyMap<K, V>;
}

/**
 * Default flat-array backend. Maintains `buf: IndexRow[]` sorted by `(secondary, primary)`
 * and a parallel `Map<K, IndexRow>` for O(1) primary-key lookup.
 *
 * **Complexity:**
 * - `has`, `get`: O(1)
 * - `upsert`: up to 2× O(log n) bisect (locate old + locate new) + up to 2× O(n) splice (remove-old + insert-new) = O(n)
 * - `upsertMany(k rows)`: O(k log n) bisect + O(k·n) splice worst case; single version bump
 * - `delete`: O(log n) bisect + O(n) splice = O(n)
 * - `deleteMany(k keys)`: O(k log n) + O(k·n) splice worst case; single version bump
 * - `clear`: O(1)
 * - `toArray`, `toPrimaryMap`: O(n)
 *
 * @category extra
 */
export class NativeIndexBackend<K, V = unknown> implements IndexBackend<K, V> {
	private _version = 0;
	private readonly _buf: IndexRow<K, V>[] = [];
	private readonly _byPrimary = new Map<K, IndexRow<K, V>>();

	get version(): number {
		return this._version;
	}

	get size(): number {
		return this._buf.length;
	}

	has(primary: K): boolean {
		return this._byPrimary.has(primary);
	}

	get(primary: K): V | undefined {
		return this._byPrimary.get(primary)?.value;
	}

	upsert(primary: K, secondary: unknown, value: V, opts?: UpsertOptions<K, V>): boolean {
		const existing = this._byPrimary.get(primary);
		const row: IndexRow<K, V> = { primary, secondary, value };
		if (existing !== undefined && opts?.equals?.(existing, row)) {
			// Idempotent — no state change, no version advance.
			return false;
		}
		if (existing !== undefined) {
			// Remove from current sorted position via bisect on the stored row.
			const oldPos = bisectLeft(this._buf, existing);
			this._buf.splice(oldPos, 1);
		}
		const newPos = bisectLeft(this._buf, row);
		this._buf.splice(newPos, 0, row);
		this._byPrimary.set(primary, row);
		this._version += 1;
		return existing === undefined;
	}

	upsertMany(
		rows: Iterable<{ primary: K; secondary: unknown; value: V }>,
		opts?: UpsertOptions<K, V>,
	): number {
		let changed = 0;
		try {
			for (const r of rows) {
				const existing = this._byPrimary.get(r.primary);
				const row: IndexRow<K, V> = {
					primary: r.primary,
					secondary: r.secondary,
					value: r.value,
				};
				if (existing !== undefined && opts?.equals?.(existing, row)) {
					continue;
				}
				if (existing !== undefined) {
					const oldPos = bisectLeft(this._buf, existing);
					this._buf.splice(oldPos, 1);
				}
				const newPos = bisectLeft(this._buf, row);
				this._buf.splice(newPos, 0, row);
				this._byPrimary.set(r.primary, row);
				changed += 1;
			}
		} finally {
			// D3: surface partial commits on iterator throw; "at most once" preserved.
			if (changed > 0) this._version += 1;
		}
		return changed;
	}

	delete(primary: K): boolean {
		const existing = this._byPrimary.get(primary);
		if (existing === undefined) return false;
		const pos = bisectLeft(this._buf, existing);
		this._buf.splice(pos, 1);
		this._byPrimary.delete(primary);
		this._version += 1;
		return true;
	}

	deleteMany(primaries: Iterable<K>): number {
		let removed = 0;
		try {
			for (const primary of primaries) {
				const existing = this._byPrimary.get(primary);
				if (existing === undefined) continue;
				const pos = bisectLeft(this._buf, existing);
				this._buf.splice(pos, 1);
				this._byPrimary.delete(primary);
				removed += 1;
			}
		} finally {
			if (removed > 0) this._version += 1;
		}
		return removed;
	}

	clear(): number {
		const n = this._buf.length;
		if (n === 0) return 0;
		this._buf.length = 0;
		this._byPrimary.clear();
		this._version += 1;
		return n;
	}

	toArray(): readonly IndexRow<K, V>[] {
		return [...this._buf];
	}

	toPrimaryMap(): ReadonlyMap<K, V> {
		const m = new Map<K, V>();
		for (const r of this._buf) m.set(r.primary, r.value);
		return m;
	}
}

// ── Reactive wrapper ──────────────────────────────────────────────────────

function keepaliveDerived(n: Node<unknown>): () => void {
	return n.subscribe(() => {});
}

/**
 * Creates a reactive index: unique primary key per row, rows sorted by `(secondary, primary)` for ordered scans.
 *
 * @param options - Optional `name` for `describe()` / debugging, and optional `backend` (see {@link IndexBackend}).
 * @returns Bundle with `ordered` (sorted rows), `byPrimary` (map), O(1) `has` / `get` / `size`,
 *   imperative `upsert` / `upsertMany` / `delete` / `deleteMany` / `clear`.
 *
 * @remarks
 * **Ordering:** `secondary` and `primary` are compared via a small total order: same primitive `typeof` uses
 * numeric/string/boolean/bigint comparison; mixed or object keys fall back to `String(a).localeCompare(String(b))`
 * (not identical to Python's rich comparison for exotic types).
 *
 * **Backend:** The default {@link NativeIndexBackend} offers O(1) primary-key lookups and O(n) upserts.
 * For scale beyond a few thousand rows, supply a user-pluggable persistent/B-tree backend via the
 * `backend` option — reactive emission semantics are unchanged.
 *
 * @example
 * ```ts
 * import { reactiveIndex } from "@graphrefly/graphrefly-ts";
 *
 * const idx = reactiveIndex<string, string>();
 * idx.upsert("id1", 10, "row-a");
 * idx.upsert("id2", 5, "row-b");
 * ```
 *
 * @category extra
 */
export function reactiveIndex<K, V = unknown>(
	options: ReactiveIndexOptions<K, V> = {},
): ReactiveIndexBundle<K, V> {
	const {
		name,
		versioning,
		equals: defaultEquals,
		backend: userBackend,
		mutationLog: mutLogOpt,
	} = options;
	const backend: IndexBackend<K, V> = userBackend ?? new NativeIndexBackend<K, V>();

	// ── Mutations companion log (Phase 14.3) ─────────────────────────────────
	const mutLog: ReactiveLogBundle<IndexChange<K, V>> | undefined = mutLogOpt
		? reactiveLog<IndexChange<K, V>>(undefined, {
				name: mutLogOpt === true ? (name ? `${name}.mutationLog` : undefined) : mutLogOpt.name,
				maxSize: mutLogOpt === true ? undefined : mutLogOpt.maxSize,
			})
		: undefined;
	let mutVersion = 0;
	let pendingChanges: IndexChangePayload<K, V>[] = [];
	function enqueueChange(payload: IndexChangePayload<K, V>): void {
		if (!mutLog) return;
		pendingChanges.push(payload);
	}

	// F1 override: merge factory-level `equals` into per-call UpsertOptions
	// so callers who set it once at construction get idempotent-key semantics
	// on every upsert without repeating the predicate.
	function withDefaultEquals(opts?: UpsertOptions<K, V>): UpsertOptions<K, V> | undefined {
		if (opts?.equals !== undefined) return opts;
		if (defaultEquals === undefined) return opts;
		return { ...opts, equals: defaultEquals };
	}

	const ordered = node<readonly IndexRow<K, V>[]>([], {
		initial: [],
		name,
		describeKind: "state",
		equals: (a, b) => a === b,
		...(versioning != null ? { versioning } : {}),
	});

	const byPrimary = node<ReadonlyMap<K, V>>(
		[ordered],
		(batchData, actions, ctx) => {
			const batch0 = batchData[0];
			const s = batch0 != null && batch0.length > 0 ? batch0.at(-1) : ctx.prevData[0];
			const rows = s as readonly IndexRow<K, V>[];
			const m = new Map<K, V>();
			for (const r of rows) m.set(r.primary, r.value);
			actions.emit(m);
		},
		{ initial: backend.toPrimaryMap(), describeKind: "derived" },
	);
	const disposeByPrimaryKeepalive = keepaliveDerived(byPrimary);
	let disposed = false;

	function pushSnapshot(): void {
		const snapshot = backend.toArray();
		const changes = pendingChanges;
		pendingChanges = [];
		batch(() => {
			ordered.down([[DIRTY]]);
			ordered.down([[DATA, snapshot]]);
			for (const c of changes) {
				mutLog!.append({
					structure: "index",
					version: ++mutVersion,
					t_ns: wallClockNs(),
					lifecycle: "data",
					change: c,
				});
			}
		});
	}

	/**
	 * Defense-in-depth emission guard: compares `version` before/after `op` and
	 * emits a snapshot if advanced. `try/finally` surfaces partial-mutation
	 * state from non-atomic custom backends even on thrown ops; native backends
	 * are atomic by contract and won't reach the finally with a changed version.
	 */
	function wrapMutation<R>(op: () => R): R {
		const prev = backend.version;
		try {
			return op();
		} finally {
			if (backend.version !== prev) pushSnapshot();
			else pendingChanges.length = 0;
		}
	}

	return {
		ordered,
		byPrimary,

		has(primary: K): boolean {
			return backend.has(primary);
		},

		get(primary: K): V | undefined {
			return backend.get(primary);
		},

		get size(): number {
			return backend.size;
		},

		upsert(primary: K, secondary: unknown, value: V, opts?: UpsertOptions<K, V>): boolean {
			return wrapMutation(() => {
				const result = backend.upsert(primary, secondary, value, withDefaultEquals(opts));
				enqueueChange({ kind: "upsert", primary, secondary, value });
				return result;
			});
		},

		upsertMany(
			rows: Iterable<{ primary: K; secondary: unknown; value: V }>,
			opts?: UpsertOptions<K, V>,
		): void {
			const list = [...rows];
			if (list.length === 0) return;
			wrapMutation(() => {
				backend.upsertMany(list, withDefaultEquals(opts));
				for (const r of list) {
					enqueueChange({
						kind: "upsert",
						primary: r.primary,
						secondary: r.secondary,
						value: r.value,
					});
				}
			});
		},

		delete(primary: K): void {
			wrapMutation(() => {
				backend.delete(primary);
				enqueueChange({ kind: "delete", primary });
			});
		},

		deleteMany(primaries: Iterable<K>): void {
			const list = [...primaries];
			if (list.length === 0) return;
			wrapMutation(() => {
				backend.deleteMany(list);
				enqueueChange({ kind: "deleteMany", primaries: list });
			});
		},

		clear(): void {
			wrapMutation(() => {
				const count = backend.clear();
				if (count > 0) enqueueChange({ kind: "clear", count });
			});
		},

		mutationLog: mutLog,

		dispose(): void {
			if (disposed) return;
			disposed = true;
			disposeByPrimaryKeepalive();
			if (mutLog) mutLog.dispose();
		},
	};
}
