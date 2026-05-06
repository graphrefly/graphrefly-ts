/**
 * Reactive secondary-key index — `reactiveIndex`. Moved into `./data-structures/reactive-index.ts` per consolidation
 * plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./data-structures/reactive-index.ts`. This shim
 * preserves the legacy `src/extra/reactive-index.ts` import path so internal
 * and external consumers do not have to migrate.
 */

export * from "./data-structures/reactive-index.js";
