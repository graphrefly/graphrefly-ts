/**
 * Backpressure controller — `createWatermarkController`. Moved into
 * `./composition/backpressure.ts` per consolidation plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./composition/backpressure.ts`. This shim
 * preserves the legacy `src/extra/backpressure.ts` import path so internal and
 * external consumers do not have to migrate.
 */

export * from "./composition/backpressure.js";
