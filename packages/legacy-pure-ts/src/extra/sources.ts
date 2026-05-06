/**
 * Sources barrel — moved into `./sources/` per consolidation plan §2 (Tier 2.1 A1).
 *
 * Public-facing source of truth is `./sources/index.ts`. Category sub-files
 * (`./sources/async.ts`, `./sources/iter.ts`, `./sources/event.ts`,
 * `./sources/settled.ts`, `./sources/fs.ts` (node-only), `./sources/git.ts`
 * (node-only)) re-export by name for category-level discoverability.
 *
 * This shim preserves the legacy `src/extra/sources.ts` import path (and the
 * `@graphrefly/graphrefly/extra/sources` package subpath) so consumers do not
 * have to migrate.
 */

export * from "./sources/index.js";
