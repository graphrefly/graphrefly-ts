# Known issues

## HISTORICAL — pre-CSP-9 browser demos retired from active workspace

**Symptom:** `demos/knowledge-graph/` and `demos/pagerduty-triage/`
still import retired root/pure-ts surfaces such as old AI utilities,
`agentMemory`, and `utils/demo-shell`.

**Cause:** those browser demos were authored before CSP-9/B65/B66 retired
`@graphrefly/graphrefly` as an implementation owner and froze pure-ts as
reference-only material.

**Resolution:** the demos are historical references only. They are not active
workspace packages, not advertised as runnable clean-slate demos, and should not
be migrated by reviving compatibility shims. Re-activation requires a separate
design/migration slice over current `@graphrefly/ts` public subpaths.

Known historical callers:
- `demos/knowledge-graph/src/lib/{lazy-adapter.ts, chapters/reactive.ts}`
- `demos/pagerduty-triage/src/lib/pipeline.ts`

## RESOLVED — `@graphrefly/cli` retired during CSP-9/B66

**Symptom:** the CLI package depended on the retired root `@graphrefly/graphrefly` facade and old GraphSpec-oriented APIs.

**Cause:** after B65, there is no active root implementation for the CLI to consume. Migrating the old CLI would require reviving or redesigning `GraphSpec`, `createGraph`, `runReduction`, `SurfaceError`, `Graph.fromSnapshot`, and `Graph.diff` semantics instead of using existing `@graphrefly/ts` public surfaces.

**Resolution:** CSP-9/B66 removed `packages/cli` from active workspace, lockfile, release, README, and site docs ownership. A future CLI would be a new clean-slate product over existing `@graphrefly/ts` surfaces, not restoration of the old GraphSpec shell.

Retained as a tombstone only; remove this section when known-issues archival cleanup happens.

## ✅ RESOLVED — First-consumer P0s (memo:Re Story 6.4) — fixed in `0.47.0`

Both consumer-blocking defects surfaced by memo:Re (first real consumer) were **fixed in `0.47.0`** (`dc7c34e fix p0`) and **independently verified by the consumer** against the installed build:

- **`ReactiveLogBundle.attachStorage()` first-wave-only data loss on a standalone `reactiveLog`** — FIXED (every append wave now forwarded; repro that lost `['b','c','d']` now persists all four).
- **`@graphrefly/graphrefly` root/`/base` hard-require of optional `rxjs`** — FIXED (root import no longer throws; `no-rxjs-in-loaded-path` test added upstream).

Full history + repros in `docs/optimizations.md` (resolution stamp at top of the memo:Re entry). Tombstone retained for provenance; remove this section per the known-issues archival convention when convenient.
