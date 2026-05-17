/**
 * Recipe — **multi-tenant isolation** sharding.
 *
 * Two postures over the `shardBy` + `shardCount` faces (plain-fn face ①):
 *
 * - **Strict isolation** (`tenants` listed): one shard per tenant, fixed
 *   `tenant → index` mapping. A tenant's facts never share a shard with
 *   another's — the strongest in-process isolation the static-topology store
 *   offers (per-shard `state<FactStore>` nodes). Unknown tenants fall to a
 *   dedicated overflow shard (last index).
 * - **Soft partition** (no `tenants`): hash the tenant key into `shardCount`
 *   buckets — even load, tenants *may* co-reside (collision), but cross-tenant
 *   reads still require an explicit query (no accidental leakage of the *index*,
 *   just shared physical storage).
 *
 * **Caveats.** Soft "even load" holds only at sufficient tenant cardinality —
 * with few tenants vs `shardCount`, FNV-1a-mod can collide several onto one
 * shard (use **strict** mode for a guaranteed-per-tenant shard). `tenantOf`
 * must return a defined, stable key: a `undefined`/`null` return is coerced to
 * the string `"undefined"` by the factory's hash and silently pools all
 * tenant-less facts together. Strict mode's overflow shard intentionally pools
 * **all** unconfigured tenants together (isolated from configured ones, not
 * from each other).
 *
 * ```ts
 * const mem = reactiveFactStore<Doc>({
 *   ingest, extractDependencies,
 *   ...shardByTenant<Doc>((f) => f.payload.tenantId, {
 *     tenants: ["acme", "globex"],   // strict: 3 shards (2 + overflow)
 *   }),
 * });
 * ```
 *
 * @module
 */

import type { MemoryFragment, ShardKey } from "../fact-store.js";

export interface ShardByTenantOptions {
	/**
	 * Known tenants for strict 1-shard-per-tenant isolation. Omit for soft
	 * hash partitioning. The strict layout adds one trailing **overflow** shard
	 * for tenants not in this list (so an unconfigured tenant is still isolated
	 * from the configured ones, just pooled together).
	 */
	readonly tenants?: readonly string[];
	/** Bucket count for the soft (non-strict) posture. Default `4`. */
	readonly shardCount?: number;
}

export interface ShardByTenantConfig<T> {
	readonly shardBy: (f: MemoryFragment<T>) => ShardKey;
	readonly shardCount: number;
}

/**
 * Build the `{ shardBy, shardCount }` pair for tenant-isolated sharding.
 * `tenantOf` extracts the tenant key from a fragment. Spread into
 * {@link reactiveFactStore}'s config.
 *
 * @category memory
 */
export function shardByTenant<T>(
	tenantOf: (f: MemoryFragment<T>) => string,
	opts: ShardByTenantOptions = {},
): ShardByTenantConfig<T> {
	if (opts.tenants && opts.tenants.length > 0) {
		const idx = new Map(opts.tenants.map((t, i) => [t, i] as const));
		const overflow = opts.tenants.length; // trailing shard for unknown tenants
		return {
			shardBy: (f) => idx.get(tenantOf(f)) ?? overflow,
			shardCount: opts.tenants.length + 1,
		};
	}
	const shardCount = Math.max(1, opts.shardCount ?? 4);
	// Return the tenant string itself — the factory's default FNV-1a hash-mod
	// sharder buckets it deterministically into `shardCount`.
	return { shardBy: (f) => tenantOf(f), shardCount };
}
