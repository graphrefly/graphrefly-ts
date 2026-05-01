/**
 * Reactive key–value map — `reactiveMap`. Moved into `./data-structures/reactive-map.ts` per consolidation
 * plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./data-structures/reactive-map.ts`. This shim
 * preserves the legacy `src/extra/reactive-map.ts` import path so internal
 * and external consumers do not have to migrate.
 */

export * from "./data-structures/reactive-map.js";
