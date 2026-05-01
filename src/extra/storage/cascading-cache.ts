/**
 * N-tier cascading cache — roadmap §3.1c.
 *
 * Each cached entry is a `state()` node. On miss, tiers are tried in order
 * (tier 0 = hottest). Hits auto-promote to faster tiers. Supports eviction
 * policy and write-through.
 *
 * Consumes {@link KvStorageTier} — no separate `CacheTier` interface. Async
 * tiers participate via `Promise<unknown>` returns from `load`; sync tiers
 * stay zero-microtask (the cascade inspects the return type and branches).
 */
import { DATA, TEARDOWN } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import type { KvStorageTier } from "../storage-tiers.js";

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
	type LNode = { key: K; prev: LNode | null; next: LNode | null };
	const map = new Map<K, LNode>();
	let head: LNode | null = null;
	let tail: LNode | null = null;

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

function isPromiseLike(v: unknown): v is Promise<unknown> {
	return v != null && typeof (v as Promise<unknown>).then === "function";
}

function fireAndForget(result: void | Promise<void>): void {
	if (isPromiseLike(result)) {
		(result as Promise<void>).catch(() => {
			/* ignore — users opt into onError via attachSnapshotStorage, not cache */
		});
	}
}

/**
 * Creates a singleton reactive cache with N-tier cascading lookup.
 *
 * Each cached entry is a `state()` node. On cache miss, tiers are tried in order
 * (index 0 = hottest/fastest). When a lower tier hits, the value is auto-promoted
 * to all faster tiers. Concurrent loads for the same key share the same state
 * instance — natural dedup.
 *
 * **Sync vs async tiers:** if `tier.load` returns a plain value, the cache node
 * cache is populated synchronously (`c.load("k").cache` is readable immediately).
 * If it returns a `Promise`, the node emits `DATA` when the promise resolves.
 *
 * **Miss sentinel:** `undefined` and `null` are both treated as misses — the
 * cascade continues to the next tier.
 *
 * @param tiers - Ordered lookup tiers, hottest first.
 * @param opts - Optional configuration (maxSize, eviction policy, writeThrough).
 * @returns A reactive cache where each entry is a `Node<V | undefined>`.
 *
 * @example
 * ```ts
 * import { cascadingCache, memoryKv, fileKv } from "@graphrefly/graphrefly-ts";
 *
 * const cache = cascadingCache<User>([memoryKv(), fileKv("../cache")]);
 * const user = cache.load("user:42"); // Node<User | undefined>
 * user.subscribe(msgs => console.log(msgs));
 * ```
 *
 * @category extra
 */
export function cascadingCache<V = unknown>(
	tiers: readonly KvStorageTier[],
	opts?: CascadingCacheOptions,
): CascadingCache<V> {
	const entries = new Map<string, Node<V | undefined>>();
	const maxSize = opts?.maxSize ?? 0;
	const policy = maxSize > 0 ? (opts?.eviction ?? lru<string>()) : null;
	const writeThrough = opts?.writeThrough ?? false;

	function promote(key: string, value: V, hitTierIndex: number): void {
		for (let i = 0; i < hitTierIndex; i++) {
			try {
				fireAndForget(tiers[i]!.save(key, value));
			} catch {
				/* ignore promote failures — cache still serves this request */
			}
		}
	}

	/**
	 * Cascade from `startTier` onward. Sync tiers resolve inline; async tiers
	 * yield control via Promise chaining and recurse on miss. Both paths end
	 * by emitting `[[DATA, value]]` on `nd` and promoting to faster tiers.
	 */
	function cascade(key: string, nd: Node<V | undefined>, startTier = 0): void {
		for (let tierIndex = startTier; tierIndex < tiers.length; tierIndex++) {
			let result: unknown;
			try {
				result = tiers[tierIndex]!.load(key);
			} catch {
				continue; // sync throw — next tier
			}
			if (isPromiseLike(result)) {
				const captured = tierIndex;
				(result as Promise<unknown>).then(
					(val) => {
						if (val !== undefined) {
							nd.down([[DATA, val]]);
							promote(key, val as V, captured);
						} else {
							cascade(key, nd, captured + 1);
						}
					},
					() => {
						cascade(key, nd, captured + 1);
					},
				);
				return; // async branch continues the cascade
			}
			if (result !== undefined) {
				nd.down([[DATA, result]]);
				promote(key, result as V, tierIndex);
				return;
			}
		}
		// all tiers missed — value stays undefined
	}

	function evictIfNeeded(): void {
		if (!policy || maxSize <= 0) return;
		while (policy.size() >= maxSize) {
			const victims = policy.evict(1);
			if (victims.length === 0) break;
			for (const key of victims) {
				const nd = entries.get(key);
				if (nd) {
					const value = nd.cache;
					if (nd.status !== "sentinel" && tiers.length > 0) {
						// Demote to last tier, clear faster tiers.
						const lastIndex = tiers.length - 1;
						try {
							fireAndForget(tiers[lastIndex]!.save(key, value as V));
						} catch {
							/* ignore */
						}
						for (let j = 0; j < lastIndex; j++) {
							try {
								const deleteFn = tiers[j]!.delete;
								if (deleteFn) fireAndForget(deleteFn.call(tiers[j], key));
							} catch {
								/* ignore */
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
			if (policy && maxSize > 0 && policy.size() >= maxSize) {
				evictIfNeeded();
			}
			const nd = node<V | undefined>([], { initial: undefined });
			entries.set(key, nd);
			policy?.insert(key);
			cascade(key, nd);
			return nd;
		},

		save(key: string, value: V): void {
			if (writeThrough) {
				for (const tier of tiers) {
					try {
						fireAndForget(tier.save(key, value));
					} catch {
						/* ignore */
					}
				}
			} else if (tiers[0]) {
				try {
					fireAndForget(tiers[0].save(key, value));
				} catch {
					/* ignore */
				}
			}
			const existing = entries.get(key);
			if (existing) {
				existing.down([[DATA, value]]);
				policy?.touch(key);
			} else {
				if (policy && maxSize > 0 && policy.size() >= maxSize) {
					evictIfNeeded();
				}
				const nd = node<V | undefined>([], { initial: value });
				entries.set(key, nd);
				policy?.insert(key);
			}
		},

		invalidate(key: string): void {
			const existing = entries.get(key);
			if (existing) cascade(key, existing);
		},

		delete(key: string): void {
			policy?.delete(key);
			const nd = entries.get(key);
			if (nd) nd.down([[TEARDOWN]]);
			entries.delete(key);
			for (const tier of tiers) {
				try {
					const deleteFn = tier.delete;
					if (deleteFn) fireAndForget(deleteFn.call(tier, key));
				} catch {
					/* ignore */
				}
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
