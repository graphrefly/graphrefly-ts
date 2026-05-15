/**
 * Storage core — browser-safe shared helpers.
 *
 * This module exposes only the stable shared utilities (`StorageHandle`,
 * `sortJsonValue`, `stableJsonString`). The old `StorageTier` interface and
 * its in-memory factories (`memoryStorage`, `dictStorage`) have been removed
 * — use `KvStorageTier` + `memoryKv` / `dictKv` from `./storage-tiers.js`
 * instead (Audit 4, 2026-04-24).
 *
 * Node-only backends (`fileKv`, `sqliteKv`) live in `./storage-tiers-node.js`;
 * browser-only ones (`indexedDbKv`) live in `./storage-tiers-browser.js`.
 *
 * @module
 */

/** Handle returned by `Graph.attachSnapshotStorage` — dispose to stop observing. */
export interface StorageHandle {
	dispose(): void | Promise<void>;
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
 * convention (e.g. `fileKv`) append their own; in-database tiers (`sqliteKv`)
 * keep the payload byte-identical for cross-tier hash/CID comparison.
 */
export function stableJsonString(data: unknown): string {
	return JSON.stringify(sortJsonValue(data), undefined, 0);
}
