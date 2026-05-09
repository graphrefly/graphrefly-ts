/**
 * Storage barrel — persistence tiers (memory/file/sqlite/IDB), codecs,
 * content-addressed storage, cascading cache.
 *
 * Per the consolidation plan §2, this folder gathers the existing
 * `storage-*` and related files for category-level discoverability. Physical
 * files remain at `src/extra/storage-*.ts`, `cascading-cache.ts`, and
 * `content-addressed-storage.ts` (deferred move).
 *
 * Browser-only (`tiers-browser.ts`) and Node-only (`tiers-node.ts`) are
 * intentionally NOT re-exported from this barrel — keep those subpaths
 * environment-scoped to preserve the universal/node/browser split.
 */

export * from "./cascading-cache.js";
export * from "./content-addressed.js";
export * from "./core.js";
export * from "./tiers.js";
export * from "./wal.js";
