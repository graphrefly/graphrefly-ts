# graphrefly-ts

TypeScript implementation of **GraphReFly** — reactive graph protocol for human + LLM co-operation.

`@graphrefly/graphrefly-ts` on npm.

## Prerequisites

- [mise](https://mise.jdx.dev/) (recommended) or Node matching [`.node-version`](./.node-version)
- [pnpm](https://pnpm.io/) via Corepack (see `package.json` `packageManager`)

## Bootstrap

```bash
mise run bootstrap
```

Or manually:

```bash
corepack enable && pnpm install
```

## Scripts

| Command        | Description        |
| -------------- | ------------------ |
| `pnpm run build` | Build with tsup  |
| `pnpm test`      | Run Vitest       |
| `pnpm run lint`  | Biome check      |
| `pnpm run format`| Biome format     |

## Layout

- `src/core/` — message protocol, node primitive, batch, sugar constructors
- `src/graph/` — Graph container, describe/observe, snapshot, persistence
- `src/extra/` — operators, sources, data structures, resilience, checkpoint
- `src/patterns/` — domain-layer APIs: orchestration, messaging, memory, AI, CQRS, reactive layout
- `src/compat/` — framework adapters (NestJS)
- `docs/` — documentation and guidance
- `website/` — Astro + Starlight docs site

## Tree-shaking imports

Prefer direct subpath imports when possible:

```ts
import { node, batch, DATA } from "@graphrefly/graphrefly-ts/core";
```

The root entry remains available:

```ts
import { node, batch, DATA } from "@graphrefly/graphrefly-ts";
```

For grouped ergonomic imports, namespace access is also supported:

```ts
import { core } from "@graphrefly/graphrefly-ts";
```

## Optional framework peers (compat adapters)

Framework bindings under `@graphrefly/graphrefly-ts/compat/*` use optional peer dependencies.
You only need to install the framework package(s) for the adapter you use:

- `@graphrefly/graphrefly-ts/compat/react` -> `react`, `react-dom`
- `@graphrefly/graphrefly-ts/compat/vue` -> `vue`
- `@graphrefly/graphrefly-ts/compat/svelte` -> `svelte`
- `@graphrefly/graphrefly-ts/compat/solid` -> `solid-js`

Examples:

```bash
pnpm add react react-dom
pnpm add vue
pnpm add svelte
pnpm add solid-js
```
