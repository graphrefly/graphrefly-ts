/**
 * Reactive dual-key index (CSP-2.8, D54/D60) — unique primary key, rows sorted by (secondary, primary).
 *
 * Shape = the shared {@link collectionCore} two ports over a sorted-array + parallel-Map BACKEND
 * (D60). The SNAPSHOT port delivers the ordered `IndexRow[]`. Secondary/reverse lookup = "Z"
 * (review #4): `has`/`get`/`rangeByPrimary` are SYNCHRONOUS point-reads over the backend's parallel
 * Map (NOT topology, like `.cache`); `byPrimary` is an OPTIONAL reactive derived over the delta
 * backbone (a pushed primary→value map), LAZILY created on first access (no default keepalive,
 * R-rom-ram). The two coexist: the derived is the reactive reverse-lookup port; the sync reads are
 * the point query.
 *
 * Per-language (D6/D24, never in parity, no conformance — the substrate pull is already C-16).
 */

import type { Ctx } from "../../ctx/types.js";
import { type Node, node } from "../../node/node.js";
import type { IndexChange } from "./change.js";
import { type CollectionCore, type CollectionCoreOptions, collectionCore } from "./core.js";

export interface ReactiveIndexOptions extends CollectionCoreOptions {}

export interface IndexRow<K, V = unknown> {
	readonly primary: K;
	readonly secondary: unknown;
	readonly value: V;
}

export interface ReactiveIndex<K, V = unknown> {
	readonly delta: Node<IndexChange<K, V>>;
	/** SNAPSHOT pull node: demand → rows sorted by (secondary, primary) (lazy O(n)). */
	readonly snapshot: Node<readonly IndexRow<K, V>[]>;
	readonly pullId: symbol;
	/** Row count (O(1)). Sync non-reactive read. */
	readonly size: number;
	/** O(1) primary-key existence. Sync read (Z). */
	has(primary: K): boolean;
	/** O(1) value lookup by primary key. Sync read (Z). */
	get(primary: K): V | undefined;
	/** Values whose primary sorts within `[start, end)`, ascending primary order. Sync read (Z). */
	rangeByPrimary(start: K, end: K): V[];
	/** Ordered rows (fresh copy). Sync non-reactive read (cold-start peek). */
	toArray(): readonly IndexRow<K, V>[];
	/** Primary→value map (fresh copy). Sync non-reactive read. */
	toPrimaryMap(): ReadonlyMap<K, V>;
	/**
	 * OPTIONAL reactive reverse-lookup port (Z): a derived primary→value map, pushed on every
	 * mutation. Lazily created on first access (no keepalive — live only while subscribed). Use the
	 * synchronous {@link ReactiveIndex.get} for a one-shot point query.
	 */
	readonly byPrimary: Node<ReadonlyMap<K, V>>;
	/** Insert/replace a row. Returns `true` if a NEW row was inserted (primary was absent). */
	upsert(primary: K, secondary: unknown, value: V): boolean;
	/** Bulk upsert; one delta per row. No-op if empty. */
	upsertMany(rows: Iterable<{ primary: K; secondary: unknown; value: V }>): void;
	delete(primary: K): void;
	/** Bulk delete; one delta event. No-op if nothing removed. */
	deleteMany(primaries: Iterable<K>): void;
	clear(): void;
	/** D54 widening: every row from `src` is upserted. Returns a disposer. */
	upsertFrom(src: Node<{ primary: K; secondary: unknown; value: V }>): () => void;
	dispose(): void;
}

// ── ordering helpers (pure; backend-internal) ──
function cmpOrd(a: unknown, b: unknown): number {
	if (a === b) return 0;
	const ta = typeof a;
	if (
		ta === typeof b &&
		(ta === "number" || ta === "string" || ta === "boolean" || ta === "bigint")
	) {
		const ax = a as number | string;
		const bx = b as number | string;
		return ax < bx ? -1 : ax > bx ? 1 : 0;
	}
	return String(a).localeCompare(String(b));
}
function compareRows<K, V>(a: IndexRow<K, V>, b: IndexRow<K, V>): number {
	const c = cmpOrd(a.secondary, b.secondary);
	return c !== 0 ? c : cmpOrd(a.primary, b.primary);
}
function bisectLeft<K, V>(rows: readonly IndexRow<K, V>[], row: IndexRow<K, V>): number {
	let lo = 0;
	let hi = rows.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (compareRows(rows[mid] as IndexRow<K, V>, row) < 0) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** Default sorted-array + parallel-Map backend (D60 first-cut; B-tree/persistent backend deferred). */
class IndexBackend<K, V> {
	private _version = 0;
	private readonly buf: IndexRow<K, V>[] = [];
	private readonly byKey = new Map<K, IndexRow<K, V>>();

	get version(): number {
		return this._version;
	}
	get size(): number {
		return this.buf.length;
	}
	has(primary: K): boolean {
		return this.byKey.has(primary);
	}
	get(primary: K): V | undefined {
		return this.byKey.get(primary)?.value;
	}

	private removeRow(row: IndexRow<K, V>): void {
		const start = bisectLeft(this.buf, row);
		for (
			let i = start;
			i < this.buf.length && compareRows(this.buf[i] as IndexRow<K, V>, row) === 0;
			i++
		) {
			if (this.buf[i] === row) {
				this.buf.splice(i, 1);
				return;
			}
		}
		const fallback = this.buf.indexOf(row);
		if (fallback >= 0) {
			this.buf.splice(fallback, 1);
			return;
		}
		throw new Error("reactiveIndex: internal row index desynchronized");
	}

	upsert(primary: K, secondary: unknown, value: V): boolean {
		const existing = this.byKey.get(primary);
		const row: IndexRow<K, V> = { primary, secondary, value };
		if (existing !== undefined) this.removeRow(existing);
		this.buf.splice(bisectLeft(this.buf, row), 0, row);
		this.byKey.set(primary, row);
		this._version += 1;
		return existing === undefined;
	}

	delete(primary: K): boolean {
		const existing = this.byKey.get(primary);
		if (existing === undefined) return false;
		this.removeRow(existing);
		this.byKey.delete(primary);
		this._version += 1;
		return true;
	}

	clear(): number {
		const n = this.buf.length;
		if (n === 0) return 0;
		this.buf.length = 0;
		this.byKey.clear();
		this._version += 1;
		return n;
	}

	rangeByPrimary(start: K, end: K): V[] {
		if (cmpOrd(start, end) >= 0) return [];
		const rows = [...this.byKey.entries()].filter(
			([p]) => cmpOrd(p, start) >= 0 && cmpOrd(p, end) < 0,
		);
		rows.sort(([a], [b]) => cmpOrd(a, b));
		return rows.map(([, r]) => r.value);
	}

	snapshot(): readonly IndexRow<K, V>[] {
		return [...this.buf];
	}
	toPrimaryMap(): ReadonlyMap<K, V> {
		const m = new Map<K, V>();
		for (const r of this.buf) m.set(r.primary, r.value);
		return m;
	}
}

/**
 * Create a reactive dual-key index (D54/D60). DELTA + lazy pull SNAPSHOT + pullId via
 * {@link collectionCore}; this layer adds the sorted backend + Z reverse-lookup surface.
 */
export function reactiveIndex<K, V = unknown>(
	options: ReactiveIndexOptions = {},
): ReactiveIndex<K, V> {
	const backend = new IndexBackend<K, V>();
	const core: CollectionCore<readonly IndexRow<K, V>[], IndexChange<K, V>> = collectionCore(
		backend,
		"reactiveIndex",
		options,
	);
	const binds: Array<() => void> = [];
	// Lazy reactive reverse-lookup port (Z): a delta-driven pushed primary→value map. Created on
	// first access so an index that never uses it pays nothing (no keepalive — R-rom-ram).
	let byPrimaryNode: Node<ReadonlyMap<K, V>> | undefined;
	function getByPrimary(): Node<ReadonlyMap<K, V>> {
		if (byPrimaryNode === undefined) {
			byPrimaryNode = node<ReadonlyMap<K, V>>(
				[core.delta as Node<unknown>],
				(ctx: Ctx) => {
					// pushed reverse-lookup: re-read the backend's primary map on each delta (the
					// structure's own backend, D60 #1 — not a foreign .cache peek).
					ctx.down([["DATA", backend.toPrimaryMap()]]);
				},
				{ factory: "reactiveIndex.byPrimary", partial: true },
			);
		}
		return byPrimaryNode;
	}

	return {
		delta: core.delta,
		snapshot: core.snapshot,
		pullId: core.pullId,

		get size(): number {
			return backend.size;
		},
		has(primary: K): boolean {
			return backend.has(primary);
		},
		get(primary: K): V | undefined {
			return backend.get(primary);
		},
		rangeByPrimary(start: K, end: K): V[] {
			return backend.rangeByPrimary(start, end);
		},
		toArray(): readonly IndexRow<K, V>[] {
			return backend.snapshot();
		},
		toPrimaryMap(): ReadonlyMap<K, V> {
			return backend.toPrimaryMap();
		},
		get byPrimary(): Node<ReadonlyMap<K, V>> {
			return getByPrimary();
		},

		upsert(primary: K, secondary: unknown, value: V): boolean {
			const inserted = backend.upsert(primary, secondary, value);
			core.emit({ kind: "upsert", primary, secondary, value });
			return inserted;
		},
		upsertMany(rows: Iterable<{ primary: K; secondary: unknown; value: V }>): void {
			for (const r of rows) {
				backend.upsert(r.primary, r.secondary, r.value);
				core.emit({ kind: "upsert", primary: r.primary, secondary: r.secondary, value: r.value });
			}
		},
		delete(primary: K): void {
			if (backend.delete(primary)) core.emit({ kind: "delete", primary });
		},
		deleteMany(primaries: Iterable<K>): void {
			const removed: K[] = [];
			for (const p of primaries) if (backend.delete(p)) removed.push(p);
			if (removed.length > 0) core.emit({ kind: "deleteMany", primaries: removed });
		},
		clear(): void {
			const count = backend.clear();
			if (count > 0) core.emit({ kind: "clear", count });
		},

		upsertFrom(src: Node<{ primary: K; secondary: unknown; value: V }>): () => void {
			const dispose = core.bindSource(src, (r) => {
				backend.upsert(r.primary, r.secondary, r.value);
				core.emit({ kind: "upsert", primary: r.primary, secondary: r.secondary, value: r.value });
			});
			binds.push(dispose);
			return dispose;
		},
		dispose(): void {
			for (const d of binds) d();
			binds.length = 0;
		},
	};
}
