/**
 * Pubsub hub — in-process pub/sub primitive. Moved into
 * `./composition/pubsub.ts` per consolidation plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./composition/pubsub.ts`. This shim
 * preserves the legacy `src/extra/pubsub.ts` import path so internal and
 * external consumers do not have to migrate.
 */

export * from "./composition/pubsub.js";
