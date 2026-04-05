/**
 * N-tier cascading cache and tiered storage — roadmap §3.1c.
 *
 * Each cached entry is a `state()` node. On miss, tiers are tried in order
 * (tier 0 = hottest). Hits auto-promote to faster tiers. Supports eviction
 * policy and write-through.
 *
 * Adapted from callbag-recharge `cascadingCache` / `tieredStorage` to use
 * GraphReFly `state()` / `node` + message protocol.
 */
import { DATA, TEARDOWN } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { state } from "../core/sugar.js";
import type { CheckpointAdapter } from "./checkpoint.js";

// ——————————————————————————————————————————————————————————————
//  Eviction policy
// ——————————————————————————————————————————————————————————————

/** Pluggable eviction policy for {@link cascadingCache}. */
export interface CacheEvictionPolicy<K> {
	insert(key: K): void;
	touch(key: K): void;
	delete(key: K): void;
	evict(count: number): K[];
	size(): number;
}

/**
 * LRU eviction policy backed by a doubly-linked list + Map.
 *
 * @returns An {@link CacheEvictionPolicy} that evicts least-recently-used entries.
 *
 * @category extra
 */
export function lru<K>(): CacheEvictionPolicy<K> {
	// Doubly-linked list node
	type LNode = { key: K; prev: LNode | null; next: LNode | null };
	const map = new Map<K, LNode>();
	let head: LNode | null = null; // most recent
	let tail: LNode | null = null; // least recent

	function unlink(n: LNode): void {
		if (n.prev) n.prev.next = n.next;
		else head = n.next;
		if (n.next) n.next.prev = n.prev;
		else tail = n.prev;
		n.prev = null;
		n.next = null;
	}

	function pushFront(n: LNode): void {
		n.next = head;
		n.prev = null;
		if (head) head.prev = n;
		head = n;
		if (tail === null) tail = n;
	}

	return {
		insert(key: K): void {
			if (map.has(key)) {
				this.touch(key);
				return;
			}
			const n: LNode = { key, prev: null, next: null };
			map.set(key, n);
			pushFront(n);
		},
		touch(key: K): void {
			const n = map.get(key);
			if (!n) return;
			unlink(n);
			pushFront(n);
		},
		delete(key: K): void {
			const n = map.get(key);
			if (!n) return;
			unlink(n);
			map.delete(key);
		},
		evict(count: number): K[] {
			const victims: K[] = [];
			for (let i = 0; i < count && tail !== null; i++) {
				const n = tail;
				victims.push(n.key);
				unlink(n);
				map.delete(n.key);
			}
			return victims;
		},
		size(): number {
			return map.size;
		},
	};
}

// ——————————————————————————————————————————————————————————————
//  CascadingCache
// ——————————————————————————————————————————————————————————————

/** A single lookup/storage tier for {@link cascadingCache}. */
export interface CacheTier<V> {
	/** Read a value. `undefined` / `null` = miss. */
	load(key: string): V | undefined | null;
	/** Write a value. Optional — tiers without save are read-only. */
	save?(key: string, value: V): void;
	/** Delete a value. Optional. */
	clear?(key: string): void;
}

export interface CascadingCacheOptions {
	/** Max entries before eviction. 0 = unlimited (default). */
	maxSize?: number;
	/** Eviction policy. Default: LRU. Only used when maxSize > 0. */
	eviction?: CacheEvictionPolicy<string>;
	/** Write-through: save() writes to all tiers, not just tier 0. Default: false. */
	writeThrough?: boolean;
}

export interface CascadingCache<V> {
	/** Get or create a singleton state node for this key. Cascades tiers on miss. */
	load(key: string): Node<V | undefined>;
	/** Write value to tier(s) and update cache node in-place. */
	save(key: string, value: V): void;
	/** Re-cascade tiers into the existing cache node (subscribers see the update). */
	invalidate(key: string): void;
	/** Remove from all tiers, teardown the node, and delete cache entry. */
	delete(key: string): void;
	/** Check if key exists in cache map. */
	has(key: string): boolean;
	/** Number of cached entries. */
	readonly size: number;
}

/**
 * Creates a singleton reactive cache with N-tier cascading lookup.
 *
 * Each cached entry is a `state()` node. On cache miss, tiers are tried in order
 * (index 0 = hottest/fastest). When a lower tier hits, the value is auto-promoted
 * to all faster tiers. Concurrent lookups for the same key share the same state
 * instance — natural dedup.
 *
 * **Note:** `undefined` is the "not yet loaded" sentinel. Tiers that return
 * `undefined` or `null` are treated as misses.
 *
 * @param tiers - Ordered lookup tiers, hottest first.
 * @param opts - Optional configuration (maxSize, eviction policy, writeThrough).
 * @returns A reactive cache where each entry is a `Node<V | undefined>`.
 *
 * @example
 * ```ts
 * import { cascadingCache } from "@graphrefly/graphrefly-ts";
 *
 * const cache = cascadingCache([
 *   { load: k => memMap.get(k), save: (k, v) => memMap.set(k, v) },
 *   { load: k => JSON.parse(fs.readFileSync(`cache/${k}`, "utf8")) },
 * ]);
 * const user = cache.load("user:42"); // Node<User | undefined>
 * user.subscribe(msgs => console.log(msgs));
 * ```
 *
 * @category extra
 */
export function cascadingCache<V>(
	tiers: CacheTier<V>[],
	opts?: CascadingCacheOptions,
): CascadingCache<V> {
	const entries = new Map<string, Node<V | undefined>>();
	const maxSize = opts?.maxSize ?? 0;
	const policy = maxSize > 0 ? (opts?.eviction ?? lru<string>()) : null;
	const writeThrough = opts?.writeThrough ?? false;

	function promote(key: string, value: V, hitTierIndex: number): void {
		for (let i = 0; i < hitTierIndex; i++) {
			const tier = tiers[i];
			if (tier.save) tier.save(key, value);
		}
	}

	function cascade(key: string, nd: Node<V | undefined>): void {
		for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
			let result: V | undefined | null;
			try {
				result = tiers[tierIndex].load(key);
			} catch {
				continue; // tier threw — skip to next
			}
			if (result != null) {
				nd.down([[DATA, result]]);
				promote(key, result, tierIndex);
				return;
			}
		}
		// All tiers missed — value stays undefined
	}

	function evictIfNeeded(): void {
		if (!policy || maxSize <= 0) return;
		while (policy.size() >= maxSize) {
			const victims = policy.evict(1);
			if (victims.length === 0) break;
			for (const key of victims) {
				const nd = entries.get(key);
				if (nd) {
					// Demote to deepest tier with save before evicting
					const value = nd.get();
					if (value !== undefined) {
						for (let i = tiers.length - 1; i >= 0; i--) {
							if (tiers[i].save) {
								tiers[i].save!(key, value);
								// Clear faster tiers
								for (let j = 0; j < i; j++) {
									if (tiers[j].clear) tiers[j].clear!(key);
								}
								break;
							}
						}
					}
					nd.down([[TEARDOWN]]);
				}
				entries.delete(key);
			}
		}
	}

	return {
		load(key: string): Node<V | undefined> {
			const existing = entries.get(key);
			if (existing) {
				policy?.touch(key);
				return existing;
			}

			// Evict before inserting to avoid evicting the new entry
			if (policy && maxSize > 0 && policy.size() >= maxSize) {
				evictIfNeeded();
			}

			const nd = state<V | undefined>(undefined);
			entries.set(key, nd);
			if (policy) {
				policy.insert(key);
			}

			cascade(key, nd);
			return nd;
		},

		save(key: string, value: V): void {
			if (writeThrough) {
				for (const tier of tiers) {
					if (tier.save) tier.save(key, value);
				}
			} else if (tiers[0]?.save) {
				tiers[0].save(key, value);
			}

			const existing = entries.get(key);
			if (existing) {
				existing.down([[DATA, value]]); // update in-place
				policy?.touch(key);
			} else {
				// Evict before inserting to avoid evicting the new entry
				if (policy && maxSize > 0 && policy.size() >= maxSize) {
					evictIfNeeded();
				}

				const nd = state<V | undefined>(value);
				entries.set(key, nd);
				if (policy) {
					policy.insert(key);
				}
			}
		},

		invalidate(key: string): void {
			const existing = entries.get(key);
			if (existing) {
				cascade(key, existing);
			}
		},

		delete(key: string): void {
			policy?.delete(key);
			const nd = entries.get(key);
			if (nd) nd.down([[TEARDOWN]]);
			entries.delete(key);
			for (const tier of tiers) {
				if (tier.clear) tier.clear(key);
			}
		},

		has(key: string): boolean {
			return entries.has(key);
		},

		get size(): number {
			return entries.size;
		},
	};
}

// ——————————————————————————————————————————————————————————————
//  TieredStorage
// ——————————————————————————————————————————————————————————————

export interface TieredStorageOptions {
	/** Max entries before eviction. 0 = no limit (default). */
	maxSize?: number;
	/** Eviction policy. Default: LRU. Only used when maxSize > 0. */
	eviction?: CacheEvictionPolicy<string>;
}

export interface TieredStorage {
	/** Get or create a singleton state node for this key. Cascades tiers on miss. */
	load(key: string): Node<unknown | undefined>;
	/** Write value to tier 0 (hottest) and update cache node in-place. */
	save(key: string, value: unknown): void;
	/** Re-cascade tiers into the existing cache node. */
	invalidate(key: string): void;
	/** Remove from all tiers and delete cache entry. */
	delete(key: string): void;
	/** Check if key exists in cache. */
	has(key: string): boolean;
	/** Number of cached entries. */
	readonly size: number;
	/** The underlying cascading cache (for advanced use). */
	readonly cache: CascadingCache<unknown>;
}

/** Convert a CheckpointAdapter to a CacheTier. */
function adapterToTier(adapter: CheckpointAdapter): CacheTier<unknown> {
	return {
		load: (key) => adapter.load(key),
		save: (key, value) => adapter.save(key, value),
		clear: (key) => adapter.clear(key),
	};
}

/**
 * Creates a reactive tiered storage cache backed by {@link CheckpointAdapter}s.
 *
 * Each cached key is a `state()` node. On cache miss, adapters are tried in order
 * (index 0 = hottest). Hits auto-promote to faster adapters.
 *
 * @param adapters - Ordered `CheckpointAdapter`s, hottest first.
 * @param opts - Optional configuration (maxSize, eviction policy).
 * @returns A reactive tiered storage where each entry is a `Node<unknown | undefined>`.
 *
 * @example
 * ```ts
 * import { tieredStorage, MemoryCheckpointAdapter } from "@graphrefly/graphrefly-ts";
 *
 * const storage = tieredStorage([new MemoryCheckpointAdapter()], { maxSize: 100 });
 * const val = storage.load("key"); // Node<unknown | undefined>
 * ```
 *
 * @category extra
 */
export function tieredStorage(
	adapters: CheckpointAdapter[],
	opts?: TieredStorageOptions,
): TieredStorage {
	const inner = cascadingCache<unknown>(adapters.map(adapterToTier), {
		maxSize: opts?.maxSize,
		eviction: opts?.eviction,
		writeThrough: true,
	});

	return {
		load: (key) => inner.load(key),
		save: (key, value) => inner.save(key, value),
		invalidate: (key) => inner.invalidate(key),
		delete: (key) => inner.delete(key),
		has: (key) => inner.has(key),
		get size() {
			return inner.size;
		},
		cache: inner,
	};
}
