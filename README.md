# graphrefly-ts

TypeScript package for **GraphRefly** (`@graphrefly/graphrefly-ts` on npm).

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

- `src/` — library source
- `docs/` — documentation
- `archive/docs/` — archived design/session notes

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
