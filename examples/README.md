# examples/

Runnable, self-contained examples that show how to compose GraphReFly in
different environments. Each example lives in its own package so you can
`cd` into one, `pnpm install`, and run it without touching the others.

Clean-slate examples reference `@graphrefly/ts` via `workspace:*` so they
exercise the clean-slate package surface directly. **To copy any example out
as a starter for your own project, replace `workspace:*` with a published
version** (see `examples/basic/state-and-derived/README.md`).

## Layout

```
examples/
├── basic/
│   └── state-and-derived/       state() + derived() + subscribe(), run via tsx
├── compat/
│   ├── jotai/                   Jotai-style atom facade over caller-owned GraphReFly nodes
│   ├── nanostores/              Nanostores-style atom facade over caller-owned GraphReFly nodes
│   └── zustand/                 Zustand StoreApi facade over a caller-owned GraphReFly state node
├── framework/
│   ├── react/                   Vite + React 19, useNodeInput/useNodeValue via `@graphrefly/ts/adapters/react` (D238)
│   ├── vue/                     Vite + Vue 3, useNodeInput/useNodeValue via `@graphrefly/ts/adapters/vue` (D238)
│   ├── solid/                   Vite + SolidJS, createNodeInput/createNodeValue via `@graphrefly/ts/adapters/solid` (D238)
│   └── svelte/                  Vite + Svelte 5 (runes), nodeWritable/nodeReadable via `@graphrefly/ts/adapters/svelte` (D238)
├── knowledge-graph/             Node-runnable semantic-memory KG reducer via `@graphrefly/ts/patterns`
├── nestjs-graph-boundary/       NestJS HTTP, WebSocket, message, cron, guard/filter boundary nodes via focused provider bundles
├── reactive-layout/
│   ├── flow/                    Multi-column text wrapping drifting obstacles
│   └── recipes/                 Host-owned measurement glue notes; not a standalone package
└── spending-alerts/             Node-runnable deterministic causal tracing pipeline
```

## Running an example

Runnable package examples follow the same pattern:

```bash
cd examples/<subject>/<name>
pnpm install
pnpm start        # headless examples (basic, compat, knowledge-graph, nestjs-graph-boundary, spending-alerts)
# or
pnpm dev          # Vite-hosted examples (framework, reactive-layout)
```

For single-directory examples such as `examples/spending-alerts`, run the
same commands from that directory instead of `examples/<subject>/<name>`.
`examples/reactive-layout/recipes/` is documentation-only glue, so it has no
package commands.

## Retired

`examples/inbox-reducer/` was retired from the active tree during CSP-9/B66
closeout. It depended on the retired root package and old AI pattern surfaces,
so it is not an active clean-slate starter. Re-activating the concept needs a
separate design slice over current `@graphrefly/ts` public subpaths, not
compatibility shims.

## Demos vs examples

- **`examples/`** (this folder) — minimum viable compositions. Copy one,
  swap imports, build from there.
- **`demos/`** (sibling folder) — rich, multi-pane showcases with
  inspection strips, mermaid graphs, and chapter navigation. Use these to
  explore; use `examples/` to compose.
