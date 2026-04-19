# examples/

Runnable, self-contained examples that show how to compose GraphReFly in
different environments. Each example lives in its own package so you can
`cd` into one, `pnpm install`, and run it without touching the others.

Every example references `@graphrefly/graphrefly` via `workspace:*` — this
resolves locally inside the monorepo. **To copy any example out as a
starter for your own project, replace `workspace:*` with a published
version** (see `examples/basic/state-and-derived/README.md`).

## Layout

```
examples/
├── basic/
│   └── state-and-derived/       state() + derived() + subscribe(), run via tsx
├── compat/
│   ├── jotai/                   atom(...) API over GraphReFly nodes
│   ├── nanostores/              atom + computed API
│   └── zustand/                 create(initializer) API
├── framework/
│   ├── react/                   Vite + React 19, useStore / useSubscribe
│   ├── vue/                     Vite + Vue 3, useStore / useSubscribe
│   ├── solid/                   Vite + SolidJS, useStore / useSubscribe
│   └── svelte/                  Vite + Svelte 5 (runes), useStore / useSubscribe
├── reactive-layout/
│   └── flow/                    Multi-column text wrapping drifting obstacles
└── nestjs/
    └── order-flow/              Full CQRS flow — command, event, projection, saga, SSE, WS
```

## Running an example

All examples follow the same pattern:

```bash
cd examples/<subject>/<name>
pnpm install
pnpm start        # headless examples (basic, compat, nestjs)
# or
pnpm dev          # Vite-hosted examples (framework, reactive-layout)
```

## Demos vs examples

- **`examples/`** (this folder) — minimum viable compositions. Copy one,
  swap imports, build from there.
- **`demos/`** (sibling folder) — rich, multi-pane showcases with
  inspection strips, mermaid graphs, and chapter navigation. Use these to
  explore; use `examples/` to compose.
