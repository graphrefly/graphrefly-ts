/**
 * Operators barrel — moved into `./operators/` per consolidation plan §2 (Tier 2.1 A1).
 *
 * Public-facing source of truth is `./operators/index.ts`. Category sub-files
 * (`./operators/transform.ts`, `./operators/take.ts`, `./operators/combine.ts`,
 * `./operators/higher-order.ts`, `./operators/time.ts`, `./operators/buffer.ts`,
 * `./operators/control.ts`) re-export by name for category-level discoverability.
 *
 * This shim preserves the legacy `src/extra/operators.ts` import path (and the
 * `@graphrefly/graphrefly/extra/operators` package subpath) so consumers do not
 * have to migrate.
 */

export * from "./operators/index.js";
