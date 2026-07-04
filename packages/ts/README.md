# @graphrefly/ts

Clean-slate TypeScript implementation of GraphReFly.

GraphReFly is a synchronous reactive graph runtime. You compose nodes, push data
through explicit messages, inspect the live graph, and keep async work at clear
source/adapter/executor boundaries.

```bash
npm install @graphrefly/ts
```

## Quick Start

```ts
import { graph } from "@graphrefly/ts";

const g = graph({ name: "example" });

const count = g.state(0, { name: "count" });
const doubled = g.derived([count], (n) => n * 2, { name: "doubled" });

doubled.subscribe((msg) => {
  if (msg[0] === "DATA") console.log("doubled", msg[1]);
});

count.set(3);
```

The graph can also describe itself:

```ts
console.log(g.topology());
console.log(g.describe());
```

## Core Ideas

- `state` is the sanctioned external input boundary.
- `derived` computes from declared dependencies.
- `producer` and source factories create graph-visible input streams.
- `effect` performs side effects from graph-visible values.
- Operators are node factories, not a second runtime.
- `describe()`, `topology()`, `observe()`, and `profile()` are read-only
  inspection surfaces.

The wave core is synchronous. Promises, timers, fetches, subprocesses, workers,
and remote bridges belong at source, adapter, executor, worker, or wire-bridge
boundaries. Results re-enter the graph as facts, commands, or messages.

## Common Imports

```ts
import { graph } from "@graphrefly/ts/graph";
import { map, filter, scan, switchMap } from "@graphrefly/ts/operators";
import { fromPromise, fromEvent, timer } from "@graphrefly/ts/sources";
import { memoryKv } from "@graphrefly/ts/storage";
import { describeToMermaid } from "@graphrefly/ts/render";
```

The package also exports the common surface from the root:

```ts
import { graph, map, timer, memoryKv } from "@graphrefly/ts";
```

## Operators

```ts
import { graph, map, scan } from "@graphrefly/ts";

const g = graph({ name: "counter" });
const count = g.state(0, { name: "count" });

const doubled = g.initNode(map((n: number) => n * 2), [count], { name: "doubled" });
const total = g.initNode(scan((acc: number, n: number) => acc + n, 0), [doubled], {
  name: "total",
});

count.set(1);
count.set(2);
```

Available operator families include transform, filter, accumulation, combine,
buffer, higher-order, time, control, and error handling operators.

## Sources

```ts
import { graph, timer } from "@graphrefly/ts";

const g = graph({ name: "clock" });
const tick = g.initNode(timer(1000), [], { name: "tick" });

tick.subscribe((msg) => {
  if (msg[0] === "DATA") console.log(msg[1]);
});
```

Sources include scalar values, sync and async iterables, promises, timers,
events, push notifications, HTTP/SSE/WebSocket driver boundaries, webhooks, and
cron-like schedules. Node-only process and filesystem helpers live under
`@graphrefly/ts/sources/node`.

## Inspection And Rendering

```ts
import { describeToMermaid, graph } from "@graphrefly/ts";

const g = graph({ name: "pricing" });
const price = g.state(100, { name: "price" });
const tax = g.derived([price], (p) => p * 0.0825, { name: "tax" });
g.derived([price, tax], (p, t) => p + t, { name: "total" });

const topology = g.topology();
const snapshot = g.describe();
const mermaid = describeToMermaid(snapshot);
const stop = g.observe().subscribe((event) => console.log(event));
```

Use `topology()` for pure structure, `describe()` for richer developer
inspection, `observe()` for message egress, and render helpers for Mermaid, D2,
ASCII, JSON, and pretty text.

## Storage And Restore

Storage helpers are passive. They store facts, frames, snapshots, checkpoints,
and event logs, but they do not own graph hydration.

```ts
import { defaultRestoreRegistry, graph, memoryKv, restoreGraph } from "@graphrefly/ts";

const g = graph({ name: "counter" });
const count = g.state(1, { name: "count", restore: { ref: "state" } });
count.set(2);

const checkpoint = g.checkpoint();
const kv = memoryKv();
await kv.put("checkpoint:counter", checkpoint);

const saved = await kv.get("checkpoint:counter");
if (saved !== undefined) {
  const restored = restoreGraph(saved, { registry: defaultRestoreRegistry });
}
```

## Reactive Collections

```ts
import { graph, reactiveMap } from "@graphrefly/ts";

const g = graph({ name: "inventory" });
const items = reactiveMap<string, { stock: number }>();

items.set("sku-1", { stock: 3 });

g.effect([items.snapshot], (snapshot) => {
  console.log(snapshot.get("sku-1"));
});
```

The package includes `reactiveMap`, `reactiveList`, `reactiveLog`,
`reactiveIndex`, collection persistence helpers, views, and cascading cache.

## Framework And Runtime Adapters

Focused adapter subpaths keep framework/runtime ownership explicit:

```ts
import { useNodeValue as useReactNodeValue } from "@graphrefly/ts/adapters/react";
import { useNodeValue as useVueNodeValue } from "@graphrefly/ts/adapters/vue";
import { nodeReadable } from "@graphrefly/ts/adapters/svelte";
import { createNodeValue } from "@graphrefly/ts/adapters/solid";
```

Other focused surfaces include:

- `@graphrefly/ts/adapters/nestjs`
- `@graphrefly/ts/adapters/observe-storage`
- `@graphrefly/ts/messaging`
- `@graphrefly/ts/memory`
- `@graphrefly/ts/memory/semantic`
- `@graphrefly/ts/work-queue`
- `@graphrefly/ts/orchestration`
- `@graphrefly/ts/cqrs`
- `@graphrefly/ts/executors/tool-provider`
- `@graphrefly/ts/executors/tool-provider-runtime`
- `@graphrefly/ts/executors/tool-provider-adapters`
- `@graphrefly/ts/scoring`
- `@graphrefly/ts/solutions/agentic-memory`
- `@graphrefly/ts/solutions/agentic-work-item-memory`
- `@graphrefly/ts/solutions/reactive-layout`
- `@graphrefly/ts/solutions/work-item`
- `@graphrefly/ts/solutions/work-item/actions`
- `@graphrefly/ts/solutions/work-item/scheduling`
- `@graphrefly/ts/solutions/work-item/work-queue`

## Package Status

This is the current TypeScript package. The old `@graphrefly/graphrefly` and
`@graphrefly/pure-ts` packages are retired and deprecated. New code should use
`@graphrefly/ts` and its focused subpaths.

`@graphrefly/ts` is pre-1.0. The package favors clean-slate correctness over
backward compatibility with retired APIs.

## Documentation Boundary

This package owns TypeScript-local documentation only: install notes, package
usage examples, public API JSDoc, generated TypeScript API reference artifacts,
examples, demos, and release-facing package guidance.

The shared `graphrefly.dev` website shell, public docs architecture, blog,
protocol/rules views, shared guides, conformance records, and dashboard live in
the sibling `~/src/graphrefly` authority repo. See the repo-level
`docs/docs.jsonl` for the package-local docs policy.

## Development

```bash
pnpm --filter @graphrefly/ts test
pnpm --filter @graphrefly/ts build
pnpm run lint
```

Before publishing:

```bash
pnpm test
pnpm run lint
pnpm run build
pnpm --filter @graphrefly/ts pack --pack-destination /tmp
```
