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
- `packages/mcp-server/tests/tools.test.ts` (not in `pnpm test` path; not blocking)
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
