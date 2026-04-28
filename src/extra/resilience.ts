/**
 * Resilience barrel — moved into `./resilience/` per consolidation plan §2 (Tier 2.1 A1).
 *
 * Public-facing source of truth is `./resilience/index.ts`. Category sub-files
 * (`./resilience/retry.ts`, `./resilience/breaker.ts`, `./resilience/rate-limiter.ts`,
 * `./resilience/fallback.ts`, `./resilience/status.ts`, `./resilience/backoff.ts`)
 * re-export by name for category-level discoverability.
 *
 * `timeout` is also exported here. Note: `extra/index.ts` re-exports
 * resilience explicitly to avoid a `timeout` name collision with the operator
 * of the same name in `extra/operators.ts`.
 *
 * This shim preserves the legacy `src/extra/resilience.ts` import path so
 * consumers do not have to migrate.
 */

export * from "./resilience/index.js";
