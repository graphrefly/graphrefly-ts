/**
 * Storage tier primitive — browser-safe core (types + in-memory backends).
 *
 * Split out of `extra/storage.ts` so browser bundles can import the
 * {@link StorageTier} contract, {@link memoryStorage}, {@link dictStorage}
 * and shared JSON helpers without pulling `node:fs` / `node:sqlite` /
 * `node:crypto`. Node-only backends (`fileStorage`, `sqliteStorage`) live in
 * {@link ./storage-node}; browser-only ones (`indexedDbStorage`,
 * `fromIDBRequest`, `fromIDBTransaction`) live in {@link ./storage-browser}.
 * The legacy `extra/storage.ts` module re-exports all three for back-compat.
 *
 * @module
 */

/**
 * Single persistence primitive — supports sync and async backends alike via
 * `void | Promise<void>` returns. `debounceMs` / `compactEvery` / `filter`
 * are per-tier cadence controls honored by `Graph.attachStorage`;
 * `cascadingCache` ignores them (it has its own eviction policy).
 */
export interface StorageTier {
	/** Read a value. Returns `null` (or resolves to `null`) on miss. */
	load(key: string): unknown | Promise<unknown>;
	/** Write a record. Sync tiers return `void`; async tiers return `Promise<void>`. */
	save(key: string, data: unknown): void | Promise<void>;
	/** Delete a value. Optional — tiers without `clear` are append/overwrite-only. */
	clear?(key: string): void | Promise<void>;
	/**
	 * Enumerate known keys. Optional — tiers that only address a single record
	 * (e.g. `indexedDbStorage`) or that can't cheaply enumerate (e.g. a remote
	 * write-only sink) may omit it. Callers that require enumeration (the
	 * surface `snapshot.list()` helper, MCP `graphrefly_snapshot_list`, CLI
	 * `graphrefly snapshot list`) should check before calling.
	 */
	list?(): readonly string[] | Promise<readonly string[]>;
	/**
	 * Debounce saves on this tier (ms). Hot tier: `0` (sync-through).
	 * Warm: `1000`. Cold: `60000`. Each tier holds its own last-save baseline,
	 * so cold flushes aren't penalized by hot flushes.
	 */
	debounceMs?: number;
	/**
	 * Every Nth record is a full snapshot; others are diffs against this
	 * tier's own baseline. Default `10`. Set `1` for always-full;
	 * `Number.POSITIVE_INFINITY` is unsafe — WAL replay needs periodic anchors.
	 */
	compactEvery?: number;
	/** Pre-save filter — return `false` to skip this record on this tier. */
	filter?: (key: string, record: unknown) => boolean;
}

/** Handle returned by `Graph.attachStorage` — dispose to stop observing. */
export interface StorageHandle {
	dispose(): void;
}

/** Recursively sort object keys so `JSON.stringify` output is order-independent. */
export function sortJsonValue(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(sortJsonValue);
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const out: Record<string, unknown> = {};
	for (const k of keys) out[k] = sortJsonValue(obj[k]);
	return out;
}

/**
 * Stable JSON encoding (no trailing newline). Tiers that want POSIX newline
 * convention (e.g. `fileStorage`) append their own; in-database tiers
 * (`sqliteStorage`) keep the payload byte-identical for cross-tier hash/CID
 * comparison.
 */
export function stableJsonString(data: unknown): string {
	return JSON.stringify(sortJsonValue(data), undefined, 0);
}

/**
 * In-memory storage tier (process-local; useful for tests and hot tier).
 *
 * @returns Sync {@link StorageTier} with JSON-cloned isolation.
 *
 * @example
 * ```ts
 * import { memoryStorage } from "@graphrefly/graphrefly-ts";
 *
 * const hot = memoryStorage();
 * graph.attachStorage([hot]);
 * ```
 *
 * @category extra
 */
export function memoryStorage(): StorageTier {
	const data = new Map<string, unknown>();
	return {
		save(key, record) {
			data.set(key, JSON.parse(JSON.stringify(record)));
		},
		load(key) {
			const v = data.get(key);
			return v === undefined ? null : JSON.parse(JSON.stringify(v));
		},
		clear(key) {
			data.delete(key);
		},
		list() {
			return [...data.keys()].sort();
		},
	};
}

/**
 * Dict-backed storage tier — stores JSON-cloned values under caller keys in
 * a caller-owned plain object. Useful for embedding in a parent state shape.
 *
 * @param storage - Caller-owned object used as the backing store.
 * @returns Sync {@link StorageTier}.
 *
 * @example
 * ```ts
 * import { dictStorage } from "@graphrefly/graphrefly-ts";
 *
 * const state: Record<string, unknown> = {};
 * graph.attachStorage([dictStorage(state)]);
 * ```
 *
 * @category extra
 */
export function dictStorage(storage: Record<string, unknown>): StorageTier {
	return {
		save(key, record) {
			storage[key] = JSON.parse(JSON.stringify(record));
		},
		load(key) {
			const raw = storage[key];
			return raw === undefined ? null : JSON.parse(JSON.stringify(raw));
		},
		clear(key) {
			delete storage[key];
		},
		list() {
			return Object.keys(storage).sort();
		},
	};
}
