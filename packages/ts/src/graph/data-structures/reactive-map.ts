/**
 * Reactive key–value map (CSP-2.8, D54/D60) — two-port collection with lazy TTL + LRU.
 *
 * Shape = the shared {@link collectionCore} two ports over a `Map` BACKEND (D60). Specializations
 * (D60 #3 / review #3):
 *   - LAZY-only TTL (first cut): expiry is checked at read (`get`/`has`) + at snapshot
 *     materialization; there is NO background timer. `snapshot()` FILTERS expired entries, so the
 *     snapshot is always correct even before a prune. A read that finds an expired key prunes it
 *     (memory) but does NOT emit a delta — the pruning is reflected on the next demand (no
 *     read-as-emission, the old core's spec-5.8 violation, dissolved by the pull model). Active
 *     periodic sweep (an interval-source composition, D52) is DEFERRED (backlog).
 *   - delete-reason enum {expired|lru-evict|archived|explicit} on the delta (D60 #3c).
 *   - LRU `maxSize`: an over-cap `set` evicts the oldest, emitting a `delete{reason:"lru-evict"}`.
 *     A live-key `get`/`has` touches LRU order WITHOUT a version bump (internal, D60 #3d).
 *   - retention (score-archive) is DEFERRED (backlog) — `delete.reason:"archived"` is reserved.
 *
 * Per-language (D6/D24, never in parity, no conformance — the substrate pull is already C-16).
 */

import type { Node } from "../../node/node.js";
import type { MapChange } from "./change.js";
import { type CollectionCore, type CollectionCoreOptions, collectionCore } from "./core.js";

export interface ReactiveMapOptions extends CollectionCoreOptions {
	/** LRU cap: an over-cap `set` evicts the least-recently-used key (delta `reason:"lru-evict"`). */
	maxSize?: number;
	/** Default TTL in milliseconds; per-call `set(...,{ttl})` overrides. Lazy expiry (no timer). */
	defaultTtl?: number;
	/** Injectable monotonic-ish clock for TTL (default `Date.now`). Graph-local clock = follow-up (D26). */
	now?: () => number;
}

export interface ReactiveMap<K, V> {
	readonly delta: Node<MapChange<K, V>>;
	readonly snapshot: Node<ReadonlyMap<K, V>>;
	readonly pullId: symbol;
	/** Raw entry count (O(1)); may include not-yet-pruned expired entries. Sync non-reactive read. */
	readonly size: number;
	/** Get a live value (prunes the key if expired). Sync read. */
	get(key: K): V | undefined;
	/** Live-key existence (prunes if expired). Sync read. */
	has(key: K): boolean;
	/** Current live (non-expired) entries (fresh copy). Sync non-reactive read (cold-start peek). */
	toMap(): ReadonlyMap<K, V>;
	set(key: K, value: V, opts?: { ttl?: number }): void;
	/** Bulk set; one delta event per entry, one snapshot-arm. No-op if empty. */
	setMany(entries: Iterable<readonly [K, V]>, opts?: { ttl?: number }): void;
	delete(key: K): void;
	/** Bulk delete; one delta per removed key. No-op if none present. */
	deleteMany(keys: Iterable<K>): void;
	clear(): void;
	/** Explicitly prune expired entries (no delta — lazy semantics; reflected on next demand). */
	pruneExpired(): void;
	/** D54 widening: every `[key, value]` from `src` is set. Returns a disposer. */
	setFrom(src: Node<readonly [K, V]>): () => void;
	dispose(): void;
}

interface Entry<V> {
	value: V;
	expiresAt?: number;
}

type Lookup<V> = { found: true; value: V } | { found: false };

/** Default `Map`-backed store with optional per-key TTL + LRU cap (D60 first-cut; pluggable deferred). */
class MapBackend<K, V> {
	private _version = 0;
	private readonly store = new Map<K, Entry<V>>();
	private readonly maxSize?: number;
	private readonly defaultTtl?: number;
	private readonly now: () => number;

	constructor(opts: { maxSize?: number; defaultTtl?: number; now?: () => number }) {
		if (opts.maxSize !== undefined && opts.maxSize < 1)
			throw new RangeError("reactiveMap: maxSize must be >= 1");
		if (opts.defaultTtl !== undefined && opts.defaultTtl <= 0)
			throw new RangeError("reactiveMap: defaultTtl must be positive");
		this.maxSize = opts.maxSize;
		this.defaultTtl = opts.defaultTtl;
		this.now = opts.now ?? Date.now;
	}

	get version(): number {
		return this._version;
	}

	get size(): number {
		return this.store.size;
	}

	private isExpired(e: Entry<V>): boolean {
		return e.expiresAt !== undefined && this.now() >= e.expiresAt;
	}

	private resolveExpiresAt(ttl?: number): number | undefined {
		const t = ttl ?? this.defaultTtl;
		if (t === undefined) return undefined;
		if (!Number.isFinite(t) || t <= 0)
			throw new RangeError(`reactiveMap: ttl must be a positive finite number (got ${t})`);
		return this.now() + t;
	}

	/** Read with read-time prune (memory only — caller does NOT emit a delta, lazy TTL). */
	lookup(key: K): Lookup<V> {
		const e = this.store.get(key);
		if (e === undefined) return { found: false };
		if (this.isExpired(e)) {
			this.store.delete(key);
			this._version += 1;
			return { found: false };
		}
		// LRU touch (no version bump — internal, D60 #3d).
		this.store.delete(key);
		this.store.set(key, e);
		return { found: true, value: e.value };
	}

	get(key: K): V | undefined {
		const r = this.lookup(key);
		return r.found ? r.value : undefined;
	}

	has(key: K): boolean {
		return this.lookup(key).found;
	}

	/** Set; returns the entries evicted by LRU overflow (the caller emits their delete deltas). */
	set(key: K, value: V, ttl?: number): Array<[K, V]> {
		const expiresAt = this.resolveExpiresAt(ttl);
		if (this.store.has(key)) this.store.delete(key); // re-insert at LRU end
		this.store.set(key, { value, expiresAt });
		const evicted: Array<[K, V]> = [];
		if (this.maxSize !== undefined) {
			while (this.store.size > this.maxSize) {
				const first = this.store.keys().next();
				if (first.done) break;
				const oldest = first.value as K;
				const e = this.store.get(oldest);
				if (e !== undefined) evicted.push([oldest, e.value]);
				this.store.delete(oldest);
			}
		}
		this._version += 1;
		return evicted;
	}

	delete(key: K): Lookup<V> {
		const e = this.store.get(key);
		if (e === undefined) return { found: false };
		this.store.delete(key);
		this._version += 1;
		return { found: true, value: e.value };
	}

	clear(): number {
		const n = this.store.size;
		if (n === 0) return 0;
		this.store.clear();
		this._version += 1;
		return n;
	}

	pruneExpired(): number {
		let removed = 0;
		for (const [k, e] of this.store) {
			if (this.isExpired(e)) {
				this.store.delete(k);
				removed += 1;
			}
		}
		if (removed > 0) this._version += 1;
		return removed;
	}

	/** Fresh snapshot of live (non-expired) entries — always correct regardless of pruning. */
	snapshot(): ReadonlyMap<K, V> {
		const out = new Map<K, V>();
		for (const [k, e] of this.store) if (!this.isExpired(e)) out.set(k, e.value);
		return out;
	}
}

/**
 * Create a reactive map (D54/D60). DELTA stream of {@link MapChange} + lazy pull SNAPSHOT (a
 * `ReadonlyMap`) + pullId via {@link collectionCore}; this layer adds the typed map surface.
 */
export function reactiveMap<K, V>(options: ReactiveMapOptions = {}): ReactiveMap<K, V> {
	const { maxSize, defaultTtl, now, ...coreOpts } = options;
	const backend = new MapBackend<K, V>({ maxSize, defaultTtl, now });
	const core: CollectionCore<ReadonlyMap<K, V>, MapChange<K, V>> = collectionCore(
		backend,
		"reactiveMap",
		coreOpts,
	);
	const binds: Array<() => void> = [];

	function doSet(key: K, value: V, ttl?: number): void {
		const evicted = backend.set(key, value, ttl);
		core.emit({ kind: "set", key, value });
		for (const [ek, ev] of evicted)
			core.emit({ kind: "delete", key: ek, previous: ev, reason: "lru-evict" });
	}

	return {
		delta: core.delta,
		snapshot: core.snapshot,
		pullId: core.pullId,

		get size(): number {
			return backend.size;
		},
		get(key: K): V | undefined {
			return backend.get(key);
		},
		has(key: K): boolean {
			return backend.has(key);
		},
		toMap(): ReadonlyMap<K, V> {
			return backend.snapshot();
		},

		set(key: K, value: V, opts?: { ttl?: number }): void {
			doSet(key, value, opts?.ttl);
		},
		setMany(entries: Iterable<readonly [K, V]>, opts?: { ttl?: number }): void {
			for (const [k, v] of entries) doSet(k, v, opts?.ttl);
		},
		delete(key: K): void {
			const previous = backend.delete(key);
			if (previous.found)
				core.emit({ kind: "delete", key, previous: previous.value, reason: "explicit" });
		},
		deleteMany(keys: Iterable<K>): void {
			for (const k of keys) {
				const previous = backend.delete(k);
				if (previous.found)
					core.emit({ kind: "delete", key: k, previous: previous.value, reason: "explicit" });
			}
		},
		clear(): void {
			const count = backend.clear();
			if (count > 0) core.emit({ kind: "clear", count });
		},
		pruneExpired(): void {
			backend.pruneExpired(); // lazy: no delta; reflected on the next snapshot demand
		},

		setFrom(src: Node<readonly [K, V]>): () => void {
			const dispose = core.bindSource(src, ([k, v]) => {
				doSet(k, v);
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
