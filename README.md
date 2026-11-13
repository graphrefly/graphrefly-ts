# GraphReFly TypeScript

`@graphrefly/ts` is the self-contained TypeScript implementation of GraphReFly:
a synchronous reactive graph runtime with inspectable data flows.

## Where things are

| Path | Contents |
|---|---|
| [packages/ts/](packages/ts/) | Published package and public export map |
| [packages/ts/src/](packages/ts/src/) | Runtime, graph API, operators and helpers |
| [examples/](examples/) / [demos/](demos/) | Package examples and interactive demos |
| [docs/](docs/README.md) | Documentation map, package usage, policy and evidence links |
| [website/](website/) | Legacy site material and the current TS API generator host |

## Where things stand

- **Local work:** [plan/work.jsonl](plan/work.jsonl); foreign dependencies resolve
  through the [root work locator](../graphrefly/authority/work-ledgers.jsonl).
- **Rules and ownership:** [documentation map](docs/README.md) and
  [package docs policy](docs/docs.jsonl).
- **Package use:** [usage and examples](docs/usage.md), [API docs](https://ts.graphrefly.dev/)
  and [release notes](packages/ts/CHANGELOG.md).

## Start

```sh
npm install @graphrefly/ts
```

For this checkout, use the pinned [mise toolchain](.mise.toml), then `pnpm install`.
See [development](docs/development.md) for package commands and boundaries.

| Command | What it does |
|---|---|
| `pnpm test` | TypeScript package tests |
| `pnpm run lint` | Biome, layer and typecheck gates |
| `pnpm run build` | Package build and exports |
| `pnpm run docs:gen:check` | Check generated API output |
| `pnpm run docs:gen:missing` | Report missing public API documentation |

Retired package names are described in [usage](docs/usage.md#package-names).
[Agent entrypoint](AGENTS.md) · [MIT license](LICENSE).
