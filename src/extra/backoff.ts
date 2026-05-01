/**
 * Backoff strategies — `constant`, `linear`, `exponential`, `fibonacci`, `decorrelatedJitter`, `withMaxAttempts`, `resolveBackoffPreset`. Moved into `./resilience/backoff.ts` per consolidation
 * plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./resilience/backoff.ts`. This shim
 * preserves the legacy `src/extra/backoff.ts` import path so internal
 * and external consumers do not have to migrate.
 */

export * from "./resilience/backoff.js";
