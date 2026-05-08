/**
 * Storage core helpers — `StorageHandle`, `stableJsonString`, `sortJsonValue`. Moved into `./storage/core.ts` per consolidation
 * plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./storage/core.ts`. This shim
 * preserves the legacy `src/extra/storage-core.ts` import path so internal
 * and external consumers do not have to migrate.
 */

export * from "./storage/core.js";
