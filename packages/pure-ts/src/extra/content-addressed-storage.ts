/**
 * Content-addressed storage — canonical-JSON + CID-keyed kv. Moved into `./storage/content-addressed.ts` per consolidation
 * plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./storage/content-addressed.ts`. This shim
 * preserves the legacy `src/extra/content-addressed-storage.ts` import path so internal
 * and external consumers do not have to migrate.
 */

export * from "./storage/content-addressed.js";
