/**
 * HTTP error helpers — `HttpError`. Moved into `./io/http-error.ts` per consolidation
 * plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./io/http-error.ts`. This shim
 * preserves the legacy `src/extra/http-error.ts` import path so internal
 * and external consumers do not have to migrate.
 */

export * from "./io/http-error.js";
