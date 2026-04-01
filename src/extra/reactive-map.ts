/**
 * Reactive key–value map (roadmap §3.2) — versioned snapshots (`reactive-base`) and a manual
 * {@link state} node.
 */
import { batch } from "../core/batch.js";
import { monotonicNs } from "../core/clock.js";
import { DATA, DIRTY } from "../core/messages.js";
import type { Node, NodeOptions } from "../core/node.js";
import { state } from "../core/sugar.js";
import { bumpVersion, snapshotEqualsVersion, type Versioned } from "./reactive-base.js";

type MapEntry<V> = { value: V; expiresAt?: number };

export type ReactiveMapSnapshot<K, V> = Versioned<{ map: ReadonlyMap<K, V> }>;

export type ReactiveMapOptions = {
	/** Optional registry name for `describe()` / debugging. */
	name?: string;
	/** When set, evicts least-recently-used keys after inserts that exceed this size. */
	maxSize?: number;
	/** Default TTL in seconds. Used when `set` omits per-call `ttl`. */
	defaultTtl?: number;
} & Omit<NodeOptions, "initial" | "describeKind" | "equals">;

export type ReactiveMapBundle<K, V> = {
	/** Emits {@link ReactiveMapSnapshot} on each structural change (two-phase). */
	node: Node<ReactiveMapSnapshot<K, V>>;
	get: (key: K) => V | undefined;
	set: (key: K, value: V, opts?: { ttl?: number }) => void;
	delete: (key: K) => void;
	clear: () => void;
	has: (key: K) => boolean;
	readonly size: number;
	/** Removes expired entries (monotonic clock), emitting if the visible map changes. */
	pruneExpired: () => void;
};

function emptySnapshot<K, V>(): ReactiveMapSnapshot<K, V> {
	return { version: 0, value: { map: new Map() } };
}

function isExpired(e: MapEntry<unknown>, now: number): boolean {
	return e.expiresAt !== undefined && now >= e.expiresAt;
}

function buildMap<K, V>(store: Map<K, MapEntry<V>>, now: number): Map<K, V> {
	const out = new Map<K, V>();
	for (const [k, e] of store) {
		if (!isExpired(e, now)) out.set(k, e.value);
	}
	return out;
}

/**
 * Creates a reactive `Map` with optional per-key TTL and optional LRU max size.
 *
 * @param options - Node options plus `maxSize` / `defaultTtl` (seconds).
 * @returns `ReactiveMapBundle` — imperative `get` / `set` / `delete` / `clear` / `pruneExpired` and a `node` emitting versioned readonly map snapshots.
 *
 * @remarks
 * **TTL:** Expiry is checked on `get`, `has`, `size`, `pruneExpired`, and before each
 * snapshot emission (expired keys are pruned first). There is no
 * background timer; monotonic-clock–expired keys may still appear in the last-emitted
 * snapshot on `node` until a read or `pruneExpired` removes them.
 * Uses `monotonicNs()` — immune to wall-clock adjustments.
 *
 * **LRU:** Uses native `Map` insertion order — `get` / `has` refreshes position; under
 * `maxSize` pressure the first key in iteration order is evicted. When `maxSize` is
 * omitted or is less than 1, no size-based eviction runs.
 *
 * @example
 * ```ts
 * import { reactiveMap } from "@graphrefly/graphrefly-ts";
 *
 * const m = reactiveMap<string, number>({ name: "cache", maxSize: 100, defaultTtl: 60 });
 * m.set("x", 1);
 * m.node.subscribe((msgs) => {
 *   console.log(msgs);
 * });
 * ```
 *
 * @category extra
 */
export function reactiveMap<K, V>(options: ReactiveMapOptions = {}): ReactiveMapBundle<K, V> {
	const { name, maxSize, defaultTtl, ...nodeOpts } = options;
	const store = new Map<K, MapEntry<V>>();

	let current = emptySnapshot<K, V>();

	const n = state<ReactiveMapSnapshot<K, V>>(current, {
		...nodeOpts,
		name,
		describeKind: "state",
		equals: snapshotEqualsVersion,
	});

	function pruneExpiredInternal(): boolean {
		const now = monotonicNs();
		let removed = false;
		for (const [k, e] of store) {
			if (isExpired(e, now)) {
				store.delete(k);
				removed = true;
			}
		}
		return removed;
	}

	function evictLruWhileOver(): void {
		if (maxSize === undefined || maxSize < 1) return;
		while (store.size > maxSize) {
			const first = store.keys().next().value as K | undefined;
			if (first === undefined) break;
			store.delete(first);
		}
	}

	function pushSnapshot(): void {
		pruneExpiredInternal();
		const now = monotonicNs();
		const map = buildMap(store, now) as ReadonlyMap<K, V>;
		const nv = n.v;
		current = bumpVersion(current, { map }, nv ? { id: nv.id, version: nv.version } : undefined);
		batch(() => {
			n.down([[DIRTY]]);
			n.down([[DATA, current]]);
		});
	}

	function touchLru(key: K): void {
		const e = store.get(key);
		if (e === undefined) return;
		store.delete(key);
		store.set(key, e);
	}

	const bundle: ReactiveMapBundle<K, V> = {
		node: n,

		get(key: K): V | undefined {
			const now = monotonicNs();
			const e = store.get(key);
			if (e === undefined) return undefined;
			if (isExpired(e, now)) {
				store.delete(key);
				pushSnapshot();
				return undefined;
			}
			touchLru(key);
			return e.value;
		},

		set(key: K, value: V, setOpts?: { ttl?: number }): void {
			pruneExpiredInternal();
			const ttlSec = setOpts?.ttl ?? defaultTtl;
			if (ttlSec !== undefined && ttlSec <= 0) {
				throw new RangeError(`reactiveMap: ttl must be positive (got ${ttlSec})`);
			}
			const expiresAt = ttlSec !== undefined ? monotonicNs() + ttlSec * 1_000_000_000 : undefined;
			if (store.has(key)) store.delete(key);
			store.set(key, { value, expiresAt });
			evictLruWhileOver();
			pushSnapshot();
		},

		delete(key: K): void {
			if (!store.delete(key)) return;
			pushSnapshot();
		},

		clear(): void {
			if (store.size === 0) return;
			store.clear();
			pushSnapshot();
		},

		has(key: K): boolean {
			const now = monotonicNs();
			const e = store.get(key);
			if (e === undefined) return false;
			if (isExpired(e, now)) {
				store.delete(key);
				pushSnapshot();
				return false;
			}
			touchLru(key);
			return true;
		},

		get size(): number {
			pruneExpiredInternal();
			return store.size;
		},

		pruneExpired(): void {
			if (!pruneExpiredInternal()) return;
			pushSnapshot();
		},
	};

	return bundle;
}
