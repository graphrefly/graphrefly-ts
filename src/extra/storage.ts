/**
 * Storage tier primitive — back-compat barrel (roadmap §3.1).
 *
 * As of 2026-04-22 the storage module is split three ways for bundle hygiene:
 *
 * - {@link ./storage-core} — browser-safe core: `StorageTier`,
 *   `StorageHandle`, `memoryStorage`, `dictStorage`, JSON helpers. Zero
 *   `node:*` imports.
 * - {@link ./storage-node} — Node-only: `fileStorage`, `sqliteStorage`.
 *   Imports `node:fs` / `node:path` / `node:crypto` / `node:sqlite`.
 * - {@link ./storage-browser} — browser-only: `indexedDbStorage`,
 *   `fromIDBRequest`, `fromIDBTransaction`. Imports the DOM lib.
 *
 * This barrel re-exports all three so existing `import from
 * "@graphrefly/graphrefly/extra"` call sites keep working. Browser-first
 * consumers should import `storage-core` directly and reach for
 * `storage-browser` when they need IDB; Node-only consumers can continue
 * importing from this barrel or switch to `storage-node`.
 *
 * @module
 */

export {
	fromIDBRequest,
	fromIDBTransaction,
	type IndexedDbStorageSpec,
	indexedDbStorage,
} from "./storage-browser.js";
export {
	dictStorage,
	memoryStorage,
	type StorageHandle,
	type StorageTier,
	sortJsonValue,
	stableJsonString,
} from "./storage-core.js";
export { fileStorage, sqliteStorage } from "./storage-node.js";
