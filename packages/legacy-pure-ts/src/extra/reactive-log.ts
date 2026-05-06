/**
 * Reactive append-only log — `reactiveLog`. Moved into `./data-structures/reactive-log.ts` per consolidation
 * plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./data-structures/reactive-log.ts`. This shim
 * preserves the legacy `src/extra/reactive-log.ts` import path so internal
 * and external consumers do not have to migrate.
 */

export * from "./data-structures/reactive-log.js";
