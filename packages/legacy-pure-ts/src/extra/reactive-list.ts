/**
 * Reactive ordered list — `reactiveList`. Moved into `./data-structures/reactive-list.ts` per consolidation
 * plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./data-structures/reactive-list.ts`. This shim
 * preserves the legacy `src/extra/reactive-list.ts` import path so internal
 * and external consumers do not have to migrate.
 */

export * from "./data-structures/reactive-list.js";
