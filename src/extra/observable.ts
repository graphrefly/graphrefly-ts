/**
 * Observable bridge — `toObservable`. Moved into `./composition/observable.ts`
 * per consolidation plan §2 (Phase 12.B).
 *
 * Public-facing source of truth is `./composition/observable.ts`. This shim
 * preserves the legacy `src/extra/observable.ts` import path so internal and
 * external consumers do not have to migrate.
 */

export * from "./composition/observable.js";
