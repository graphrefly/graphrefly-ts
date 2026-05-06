/**
 * Composite factories — `verifiable`, `distill`. Moved into
 * `./composition/composite.ts` per consolidation plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./composition/composite.ts`. This shim
 * preserves the legacy `src/extra/composite.ts` import path so internal and
 * external consumers do not have to migrate.
 */

export * from "./composition/composite.js";
