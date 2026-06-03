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

import { type Ctx, depBatch, depCount, depLatest } from "../../ctx/types.js";
import { Node, node } from "../../node/node.js";
import { errorPayload } from "../../protocol/messages.js";
import type { Operator } from "../operators.js";
import type { OrderedCapacityPolicy, ReactiveOpt } from "../policies/types.js";
import type { IndexChange } from "./change.js";
import { type CollectionCore, type CollectionCoreOptions, collectionCore } from "./core.js";

export type ReactiveIndexOpt<T> = ReactiveOpt<T>;
export type ReactiveIndexCapacityOrder = "secondary" | "primary" | "lru";

export interface ReactiveIndexCapacityPolicy
	extends OrderedCapacityPolicy<ReactiveIndexCapacityOrder> {}

export interface ReactiveIndexOptions extends CollectionCoreOptions {
	/**
	 * D73 explicit capacity policy: no implicit eviction default.
	 * `order` chooses eviction semantics and `maxSize` may be static or node-valued (D68).
	 */
	readonly capacity?: ReactiveIndexCapacityPolicy;
}

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
	private readonly trackLru: boolean;

	constructor(trackLru: boolean) {
		this.trackLru = trackLru;
	}

	get version(): number {
		return this._version;
	}
	get size(): number {
		return this.buf.length;
	}
	has(primary: K): boolean {
		const row = this.byKey.get(primary);
		if (row === undefined) return false;
		this.touchLru(row);
		return true;
	}
	get(primary: K): V | undefined {
		const row = this.byKey.get(primary);
		if (row === undefined) return undefined;
		this.touchLru(row);
		return row.value;
	}

	private touchLru(row: IndexRow<K, V>): void {
		if (!this.trackLru) return;
		this.byKey.delete(row.primary);
		this.byKey.set(row.primary, row);
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
		if (existing !== undefined) {
			this.removeRow(existing);
			this.byKey.delete(primary);
		}
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

	evictOneForCapacity(order: ReactiveIndexCapacityOrder, maxSize?: number): K | undefined {
		if (maxSize === undefined) return undefined;
		if (!Number.isInteger(maxSize) || maxSize < 1)
			throw new RangeError(`reactiveIndex: maxSize must be a positive integer (got ${maxSize})`);
		const overflow = this.buf.length - maxSize;
		if (overflow <= 0) return undefined;

		switch (order) {
			case "secondary": {
				const row = this.buf[0] as IndexRow<K, V> | undefined;
				if (row === undefined) return undefined;
				this.buf.shift();
				this.byKey.delete(row.primary);
				this._version += 1;
				return row.primary;
			}
			case "primary": {
				let victim: K | undefined;
				for (const key of this.byKey.keys()) {
					if (victim === undefined || cmpOrd(key, victim) < 0) victim = key;
				}
				if (victim === undefined) return undefined;
				const row = this.byKey.get(victim);
				if (row !== undefined) this.removeRow(row);
				this.byKey.delete(victim);
				this._version += 1;
				return victim;
			}
			case "lru": {
				const oldest = this.byKey.keys().next().value as K | undefined;
				if (oldest === undefined) return undefined;
				const row = this.byKey.get(oldest);
				if (row !== undefined) this.removeRow(row);
				this.byKey.delete(oldest);
				this._version += 1;
				return oldest;
			}
			default: {
				throw new Error(`reactiveIndex: unknown capacity order '${String(order)}'`);
			}
		}
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
	const { capacity, graph, dispatcher, name } = options;
	const lruEnabled = capacity?.order === "lru";
	const backend = new IndexBackend<K, V>(lruEnabled);
	const core: CollectionCore<readonly IndexRow<K, V>[], IndexChange<K, V>> = collectionCore(
		backend,
		"reactiveIndex",
		options,
	);
	const binds: Array<() => void> = [];
	const base = dispatcher ? { dispatcher } : {};
	const bindDeps = new WeakSet<Node<unknown>>();
	let bindSeq = 0;
	let capacityPolicy: Node<number> | undefined;
	let apply: Node<IndexChange<K, V>> | undefined;
	let releaseApply = () => {};

	function isNodeOpt<T>(x: ReactiveIndexOpt<T>): x is Node<T> {
		return x instanceof Node;
	}

	function validateMaxSize(v: number): number {
		if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1)
			throw new RangeError(`reactiveIndex: maxSize must be a positive integer (got ${v})`);
		return v;
	}

	function enforceCapacity(): void {
		if (currentCapacityOrder === undefined) return;
		for (;;) {
			const primary = backend.evictOneForCapacity(currentCapacityOrder, currentMaxSize);
			if (primary === undefined) return;
			core.emit({ kind: "delete", primary });
		}
	}

	const applyBody = (ctx: Ctx): void => {
		const deps = apply?.deps ?? [];
		for (let i = 0; i < depCount(ctx); i++) {
			const dep = deps[i];
			if (dep === capacityPolicy) {
				const latest = depLatest(ctx, i);
				if (latest !== undefined) currentMaxSize = validateMaxSize(latest as number);
				continue;
			}
			if (dep && bindDeps.has(dep)) {
				for (const r of (depBatch(ctx, i) ?? []) as readonly {
					primary: K;
					secondary: unknown;
					value: V;
				}[]) {
					backend.upsert(r.primary, r.secondary, r.value);
					core.emit({ kind: "upsert", primary: r.primary, secondary: r.secondary, value: r.value });
					enforceCapacity();
				}
			}
		}
		enforceCapacity();
	};

	function ensureApply(): Node<IndexChange<K, V>> {
		if (apply !== undefined) return apply;
		const op: Operator<unknown, IndexChange<K, V>> = {
			factory: "reactiveIndex.capacityPolicy",
			body: applyBody,
			opts: { partial: true },
		};
		const deps = capacityPolicy ? [capacityPolicy as Node<unknown>] : [];
		apply = graph
			? graph.initNode(op, deps, {
					name: name ? `${name}.capacityPolicy` : undefined,
					meta: { kind: "collection_policy_apply", collection: "reactiveIndex" },
				})
			: new Node<IndexChange<K, V>>(deps, op.body, {
					...base,
					factory: "reactiveIndex.capacityPolicy",
					partial: true,
					name: name ? `${name}.capacityPolicy` : undefined,
				});
		releaseApply = graph
			? graph.retain(apply, { reason: "reactiveIndex.capacityPolicy" })
			: apply.subscribe(() => {});
		return apply;
	}

	let currentMaxSize: number | undefined;
	const currentCapacityOrder: ReactiveIndexCapacityOrder | undefined = capacity?.order;
	if (capacity !== undefined) {
		if (
			currentCapacityOrder !== "secondary" &&
			currentCapacityOrder !== "primary" &&
			currentCapacityOrder !== "lru"
		) {
			throw new Error("reactiveIndex: capacity.order must be one of secondary|primary|lru (D73)");
		}

		const maxSize = capacity.maxSize;
		if (isNodeOpt(maxSize) && graph === undefined) {
			throw new Error(
				"reactiveIndex capacity.maxSize Node option requires options.graph so the policy edge is describe-visible (D73)",
			);
		}

		capacityPolicy = isNodeOpt(maxSize)
			? maxSize
			: graph
				? graph.initNode<number, number>(
						{
							factory: "reactiveIndex.maxSizePolicy",
							body: () => {},
							opts: { initial: validateMaxSize(maxSize) },
						},
						[],
						{
							name: name ? `${name}.maxSizePolicy` : undefined,
							meta: { kind: "collection_policy", collection: "reactiveIndex", policy: "maxSize" },
						},
					)
				: undefined;

		if (!isNodeOpt(maxSize)) currentMaxSize = validateMaxSize(maxSize);

		if (capacityPolicy instanceof Node) ensureApply();
	}

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
			enforceCapacity();
			return inserted;
		},
		upsertMany(rows: Iterable<{ primary: K; secondary: unknown; value: V }>): void {
			for (const r of rows) {
				backend.upsert(r.primary, r.secondary, r.value);
				core.emit({ kind: "upsert", primary: r.primary, secondary: r.secondary, value: r.value });
				enforceCapacity();
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
			if (graph === undefined)
				throw new Error(
					"reactiveIndex.upsertFrom requires options.graph so the input fold is describe-visible (D61)",
				);
			const op: Operator<
				{ primary: K; secondary: unknown; value: V },
				{ primary: K; secondary: unknown; value: V }
			> = {
				factory: "reactiveIndex.bindSource",
				body: (ctx: Ctx) => {
					try {
						for (const r of (depBatch(ctx, 0) ?? []) as readonly {
							primary: K;
							secondary: unknown;
							value: V;
						}[]) {
							ctx.down([["DATA", r]]);
						}
					} catch (e) {
						ctx.down([["ERROR", errorPayload(e, "reactiveIndex.bindSource failed")]]);
					}
				},
			};
			const folder = graph.initNode(op, [src], {
				name: name ? `${name}.bind#${bindSeq++}` : undefined,
				meta: { kind: "collection_bind_source", collection: "reactiveIndex" },
			});
			bindDeps.add(folder as Node<unknown>);
			const applyNode = ensureApply();
			applyNode.addDep(folder as Node<unknown>, applyBody);
			let active = true;
			const dispose = () => {
				if (!active) return;
				active = false;
				applyNode.removeDep(folder as Node<unknown>, applyBody);
			};
			binds.push(dispose);
			return dispose;
		},
		dispose(): void {
			for (const d of binds) d();
			binds.length = 0;
			releaseApply();
		},
	};
}
