# Known issues — deferred to post-Rust-port

## Demos disabled in `docs:build` pending API migration

**Symptom:** `pnpm run docs:build` previously ran 4 demos under `demos/`; 3 of them now fail with errors like `"state" is not exported by ... dist/core/index.js, imported by src/lib/counter.ts`.

**Cause:** The standalone `state` / `derived` / `producer` / `effect` exports were removed from `packages/pure-ts/src/core/sugar.ts` at some point during the Graph narrow-waist refactor (per `project_graph_narrow_waist.md` memory). The "Graph narrow-waist" decision moved these to Graph methods (`Graph.state()` / `Graph.derived()` / `Graph.effect()` / `Graph.produce()`), but the migration of demos / examples / generated docs that still consume the old standalone API was never completed.

**Affected callers** (NOT migrated yet):
- `demos/compat-matrix/src/lib/counter.ts`
- `demos/knowledge-graph/src/lib/{lazy-adapter.ts, chapters/reactive.ts}`
- `demos/pagerduty-triage/src/lib/pipeline.ts`
- `examples/basic/state-and-derived/index.ts`
- `examples/framework/{react,solid,svelte,vue}/src/store.ts`
- `examples/{harness-refine-hello, inbox-reducer, knowledge-graph, reactive-layout, spending-alerts}/*.ts`
- `packages/cli/tests/dispatch.test.ts` (not in `pnpm test` path; not blocking)
- 100+ generated `website/src/content/docs/api/*.md` (auto-regenerated; will heal once symbols are re-added or REGISTRY is migrated)
- `website/scripts/gen-api-docs.mjs` REGISTRY (218 entries point at the missing symbols)

**Workaround in place:** Root `package.json` `docs:build` script skips the 3 broken demos (`compat-matrix`, `knowledge-graph`, `pagerduty-triage`) and only builds `reactive-layout`. CI is unblocked but the demos are NOT shipped to the website's static output.

**Decision deferred to:** post-Rust-port (after M5 close + facade build, per PART 13 of `archive/docs/SESSION-rust-port-architecture.md`). Two paths:
- **A — Re-add standalone `state`/`derived`/`producer`/`effect`** as thin wrappers around `node()` in `core/sugar.ts`. Restores public surface; coexists with Graph methods. Minimal surgery, restores 100+ callers.
- **B — Migrate every caller** to Graph methods. Heavier, changes demo/example pedagogical surface (every demo grows a Graph instance).

Path A is the cheaper restore. Punt the decision until after the Rust port settles the API surface, since some of those callers may also be affected by other API churn.

## Restoring this when ready

1. Pick A or B and execute.
2. Edit root `package.json` `docs:build` script to restore the 3 demos:
   ```
   pnpm build && pnpm --dir website build && \
     pnpm --dir demos/compat-matrix build && \
     pnpm --dir demos/reactive-layout build && \
     pnpm --dir demos/knowledge-graph build && \
     pnpm --dir demos/pagerduty-triage build && \
     cp -r demos/compat-matrix/dist/. website/dist/demos/compat-matrix/ && \
     cp -r demos/reactive-layout/dist/. website/dist/demos/reactive-layout/ && \
     cp -r demos/knowledge-graph/dist/. website/dist/demos/knowledge-graph/ && \
     cp -r demos/pagerduty-triage/dist/. website/dist/demos/pagerduty-triage/
   ```
3. Delete this section from `known-issues.md`.

## `@graphrefly/cli` marked private

**Symptom:** changesets `pnpm release` fails with TypeScript build errors when trying to publish this package — `Property 'explain' does not exist on type 'Graph'`, `Module '"@graphrefly/graphrefly"' has no exported member 'memoryStorage'`, etc.

**Cause:** Same root cause as the demos above — the package references removed/renamed APIs (`Graph.explain`, `memoryStorage`, `StorageTier`, `fileStorage`) that drifted during Phase 4+ refactors.

**Workaround in place:** Package marked `"private": true` in its `package.json`. Changesets respects the flag and skips publishing it. It still builds via `pnpm build` for local dev (no publish guard there), but `prepublishOnly` is gated behind the privacy flag.

**Decision deferred to:** same window as the demo migration (post-Rust-port). Restoration:
1. Migrate `cli/src/dispatch.ts` to current API (Graph methods, current storage symbols).
2. Remove `"private": true` from `package.json`.
3. Restore the `NOT YET PUBLISHED — see docs/known-issues.md` text in `description` to the original.
4. Set up npm trusted-publisher config at `https://www.npmjs.com/package/@graphrefly/cli/access`.
5. Push a changeset that bumps → next release publishes.
6. Delete this section from `known-issues.md`.

## First-consumer P0s (memo:Re Story 6.4, 0.46.0) — see `optimizations.md`

Two **consumer-blocking** defects surfaced by memo:Re (first real consumer). Full repros + prioritization in `docs/optimizations.md` § "memo:Re (cognitive-buddy) — first-real-consumer findings (recorded 2026-05-16)":

- **`ReactiveLogBundle.attachStorage()` silently persists only the FIRST append wave on a standalone (non-graph-mounted) `reactiveLog`** (`appendMany` single-wave is fine; N sequential `append()`s lose all but the first — append-only-log data loss with no error).
- **`@graphrefly/graphrefly` root barrel + `/base` hard-require the OPTIONAL `rxjs` peer** → `Cannot find module 'rxjs'` bricks any RN/Hermes/Metro build that imports the root barrel.
