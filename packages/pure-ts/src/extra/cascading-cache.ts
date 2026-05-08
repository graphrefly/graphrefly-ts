/**
 * Cascading-cache substrate — `createCascadingCache`. Moved into `./storage/cascading-cache.ts` per consolidation
 * plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./storage/cascading-cache.ts`. This shim
 * preserves the legacy `src/extra/cascading-cache.ts` import path so internal
 * and external consumers do not have to migrate.
 */

export * from "./storage/cascading-cache.js";
