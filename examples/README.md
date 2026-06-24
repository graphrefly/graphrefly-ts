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
├── framework/
│   ├── react/                   Vite + React 19, useNodeInput/useNodeValue via `@graphrefly/ts/adapters/react` (D238)
│   ├── vue/                     Vite + Vue 3, useNodeInput/useNodeValue via `@graphrefly/ts/adapters/vue` (D238)
│   ├── solid/                   Vite + SolidJS, createNodeInput/createNodeValue via `@graphrefly/ts/adapters/solid` (D238)
│   └── svelte/                  Vite + Svelte 5 (runes), nodeWritable/nodeReadable via `@graphrefly/ts/adapters/svelte` (D238)
├── nestjs-graph-boundary/       NestJS HTTP, WebSocket, message, cron, guard/filter boundary nodes via focused adapter subpaths
├── reactive-layout/
│   └── flow/                    Multi-column text wrapping drifting obstacles
```

## Running an example

All examples follow the same pattern:

```bash
cd examples/<subject>/<name>
pnpm install
pnpm start        # headless examples (basic, nestjs-graph-boundary)
# or
pnpm dev          # Vite-hosted examples (framework, reactive-layout)
```

## Demos vs examples

- **`examples/`** (this folder) — minimum viable compositions. Copy one,
  swap imports, build from there.
- **`demos/`** (sibling folder) — rich, multi-pane showcases with
  inspection strips, mermaid graphs, and chapter navigation. Use these to
  explore; use `examples/` to compose.
