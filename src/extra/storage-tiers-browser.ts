/**
 * Browser-only storage tier backends — `indexedDbKv`, etc. Moved into `./storage/tiers-browser.ts` per consolidation
 * plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./storage/tiers-browser.ts`. This shim
 * preserves the legacy `src/extra/storage-tiers-browser.ts` import path so internal
 * and external consumers do not have to migrate.
 */

export * from "./storage/tiers-browser.js";
