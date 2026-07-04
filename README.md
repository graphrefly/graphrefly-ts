# GraphReFly TypeScript

GraphReFly is a synchronous reactive graph runtime for building inspectable data
flows. Code defines the graph, the graph emits facts, and inspection APIs let
tools, tests, UIs, and agents see what exists and why it changed.

This repository contains the current TypeScript implementation:
`@graphrefly/ts`.

[![npm](https://img.shields.io/npm/v/@graphrefly/ts?color=blue)](https://www.npmjs.com/package/@graphrefly/ts)
[![license](https://img.shields.io/github/license/graphrefly/graphrefly-ts)](./LICENSE)

## Current Package

```bash
npm install @graphrefly/ts
```

```ts
import { graph } from "@graphrefly/ts";

const g = graph({ name: "pricing" });

const price = g.state(100, { name: "price" });
const tax = g.derived([price], (p) => p * 0.0825, { name: "tax" });
const total = g.derived([price, tax], (p, t) => p + t, { name: "total" });

total.subscribe((msg) => {
  if (msg[0] === "DATA") console.log(msg[1]);
});

price.set(120);

console.log(g.topology());
console.log(g.describe());
```

`@graphrefly/ts` is self-contained: substrate, graph layer, operators, sources,
storage helpers, framework adapters, messaging, work queues, orchestration,
CQRS, renderers, testing helpers, and solution modules live in one package.

## Package Names

| Package | Status |
| --- | --- |
| `@graphrefly/ts` | Current TypeScript package. Use this for all new work. |
| `@graphrefly/graphrefly` | Retired root package name. Deprecated on npm; use `@graphrefly/ts`. |
| `@graphrefly/pure-ts` | Retired old TypeScript implementation. Deprecated on npm; use `@graphrefly/ts`. |

There is no compatibility layer for the retired packages. The clean-slate
package uses focused subpaths instead of the old root, `utils`, `base`,
`compat`, and `presets` surfaces.

## What It Gives You

- Graph-owned `state`, `derived`, `producer`, `effect`, and `mount` sugar.
- Glitch-free synchronous wave propagation through a dispatcher.
- Free-standing operator factories such as `map`, `filter`, `scan`,
  `switchMap`, `combine`, `buffer`, `debounceTime`, and `catchError`.
- Sources for values, iterables, promises, timers, events, HTTP/SSE/WebSocket
  driver boundaries, webhooks, cron-like schedules, and Node-specific process
  or filesystem bindings.
- Inspectable graph structure via `topology()`, `describe()`, `observe()`,
  `observeTopology()`, diagnostics, renderers, and optional profiling.
- Passive storage helpers for strict JSON, KV, append logs, WAL frames,
  content-addressed storage, read-through tiers, and observe-event logs.
- Reactive collections: `reactiveMap`, `reactiveList`, `reactiveLog`,
  `reactiveIndex`, views, persistence helpers, and cascading cache.
- Focused framework/runtime adapters for React, Vue, Svelte, Solid, NestJS,
  observe-storage, wire bridge, tool-provider runtimes, and worker/work queues.

The graph core is synchronous. Async work belongs at source, adapter, executor,
worker, storage, or wire-bridge boundaries and returns to the graph as explicit
messages, facts, or commands.

## Import Paths

Use the root for the common surface:

```ts
import { graph, map, memoryKv, describeToMermaid } from "@graphrefly/ts";
```

Use focused subpaths when you want clearer ownership or better bundle shape:

```ts
import { graph } from "@graphrefly/ts/graph";
import { map, switchMap } from "@graphrefly/ts/operators";
import { fromPromise, timer } from "@graphrefly/ts/sources";
import { memoryKv } from "@graphrefly/ts/storage";
import { describeToMermaid } from "@graphrefly/ts/render";
import { useNodeValue } from "@graphrefly/ts/adapters/react";
```

Node-only and browser-only helpers are split:

```ts
import { nodeProcessDriver } from "@graphrefly/ts/sources/node";
import { indexedDbKv } from "@graphrefly/ts/storage/browser";
```

## Small Examples

### Operators

```ts
import { graph, map, scan } from "@graphrefly/ts";

const g = graph({ name: "counter" });
const count = g.state(0, { name: "count" });

const doubled = g.initNode(map((n: number) => n * 2), [count], { name: "doubled" });
const sum = g.initNode(scan((acc: number, n: number) => acc + n, 0), [doubled], {
  name: "sum",
});

sum.subscribe((msg) => {
  if (msg[0] === "DATA") console.log("sum", msg[1]);
});

count.set(1);
count.set(2);
```

### Sources

```ts
import { graph, timer } from "@graphrefly/ts";

const g = graph({ name: "clock" });
const tick = g.initNode(timer(1000), [], { name: "tick" });

tick.subscribe((msg) => {
  if (msg[0] === "DATA") console.log("tick", msg[1]);
});
```

### Inspection

```ts
import { describeToMermaid, graph } from "@graphrefly/ts";

const g = graph({ name: "flow" });
const input = g.state("hello", { name: "input" });
g.derived([input], (value) => value.toUpperCase(), { name: "upper" });

const topology = g.topology();
const snapshot = g.describe();
const mermaid = describeToMermaid(snapshot);
```

### Checkpoint And Restore

```ts
import { defaultRestoreRegistry, graph, restoreGraph } from "@graphrefly/ts";

const g = graph({ name: "counter" });
const count = g.state(1, { name: "count", restore: { ref: "state" } });
count.set(2);

const checkpoint = g.checkpoint();
const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
```

## Repository Layout

| Path | Contents |
| --- | --- |
| `packages/ts/` | The published `@graphrefly/ts` package. |
| `packages/ts/src/` | TypeScript source for core, graph, operators, storage, adapters, and solutions. |
| `examples/` | Runnable clean-slate examples that consume `@graphrefly/ts`. |
| `demos/` | Current demo surfaces. Retired demos live under `archive/`. |
| `docs/docs.jsonl` | Package-local docs policy for this TypeScript repo. |
| `archive/` | Historical code and retired examples kept out of active workspace ownership. |
| `website/` | Legacy/migration site plus the current TS API docs generator host until the generator moves. |

The language-neutral protocol, decisions, conformance scenarios, and formal
model live in the sibling `graphrefly` authority repository. Sibling runtime
implementations are self-contained packages; cross-language compatibility is
behavioral conformance, not symbol-set parity.

## Documentation Ownership

This repo owns package-local TypeScript docs: install notes, package README
material, examples, demos, JSDoc on exported `@graphrefly/ts` APIs, generated
TypeScript API reference artifacts, and the automation that produces those
artifacts.

The shared `graphrefly.dev` website shell, public docs architecture, blog,
language-neutral guides, protocol/rules views, conformance views, and
maintainer dashboard live in `~/src/graphrefly` under D563. Do not hand-maintain
mirrors of those shared docs here. The current `website/` directory remains only
as legacy/migration material and as the temporary host for TypeScript API docs
generation.

## Development

```bash
pnpm install
pnpm test
pnpm run lint
pnpm run build
pnpm run docs:gen:check
```

Useful package-local commands:

```bash
pnpm --filter @graphrefly/ts test
pnpm --filter @graphrefly/ts build
pnpm --filter @graphrefly/ts pack --pack-destination /tmp
pnpm run docs:gen
pnpm run docs:gen:missing
```

## Release Notes

`@graphrefly/ts` is pre-1.0. The project intentionally does not preserve
backward compatibility with the retired `@graphrefly/graphrefly` or
`@graphrefly/pure-ts` APIs. Use current subpaths and examples as the migration
target.

## License

[MIT](./LICENSE)
