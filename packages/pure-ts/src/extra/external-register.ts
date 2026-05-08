/**
 * External-register helpers — `externalProducer`, `externalBundle`. Moved into
 * `./composition/external-register.ts` per consolidation plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./composition/external-register.ts`. This
 * shim preserves the legacy `src/extra/external-register.ts` import path so
 * internal and external consumers do not have to migrate.
 */

export * from "./composition/external-register.js";
