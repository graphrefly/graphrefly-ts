/**
 * stratify — classifier-routed multi-output operator. Moved into
 * `./composition/stratify.ts` per consolidation plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./composition/stratify.ts`. This shim
 * preserves the legacy `src/extra/stratify.ts` import path so internal and
 * external consumers do not have to migrate.
 */

export * from "./composition/stratify.js";
