/**
 * Storage tier interfaces and shared in-memory backends. Moved into `./storage/tiers.ts` per consolidation
 * plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./storage/tiers.ts`. This shim
 * preserves the legacy `src/extra/storage-tiers.ts` import path so internal
 * and external consumers do not have to migrate.
 */

export * from "./storage/tiers.js";
