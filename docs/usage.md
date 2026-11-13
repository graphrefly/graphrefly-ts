# TypeScript package usage

GraphReFly is a synchronous reactive graph runtime for building inspectable data
flows. Code defines the graph, the graph emits facts, and inspection APIs let
tools, tests, UIs, and agents see what exists and why it changed.

This repository contains the current TypeScript implementation:
`@graphrefly/ts`.

[![npm](https://img.shields.io/npm/v/@graphrefly/ts?color=blue)](https://www.npmjs.com/package/@graphrefly/ts)
[![license](https://img.shields.io/github/license/graphrefly/graphrefly-ts)](../LICENSE)

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

total.subscribe((msgs) => {
  for (const [type, value] of msgs) {
    if (type === "DATA") console.log(value);
  }
});
// 108.25

price.set(120);
// 129.9

console.log(g.describe());
// [{ id: "price", kind: "state", deps: [], quiet: false },
//  { id: "tax", kind: "node", deps: ["price"], quiet: false },
//  { id: "total", kind: "node", deps: ["price", "tax"], quiet: false }]
```

A sink receives one array of messages per delivery. `total` depends on `price`
twice (directly and through `tax`), yet each write delivers it one value: the
wave settles both paths before `total` runs. `derived` and `effect` run their
function once every dependency has a value, and then whenever a dependency
sends DATA.

`@graphrefly/ts` is self-contained: substrate, graph layer, operators, sources,
storage helpers, framework adapters, messaging, work queues, orchestration,
CQRS, renderers, testing helpers, and solution modules live in one package.

## Topology module

The main package and `@graphrefly/ts/graph` both export `topology`:

```ts
import { graph, renderSnapshot, topology } from "@graphrefly/ts";

const parent = graph({ name: "shop" });
const orders = graph({ name: "orders" });
const members = topology.group(orders, { name: "order view" });
members.state(0, { name: "count" });
const before = renderSnapshot(parent);
topology.mount(parent, orders, "orders");
console.log(topology.name(parent)); // "shop"
console.log(topology.diff(before, renderSnapshot(parent)).events);
```

These calls keep nodes cold. Mounting adds a named child view for rendering and
checkpoints; each graph retains its own execution domain. Release groups own no
extra graph state and release their members only when quiescent. `topology.diff`
compares two render snapshots without subscribing to either graph.

## Package Names

| Package | Status |
| --- | --- |
| `@graphrefly/ts` | Current TypeScript package. Use this for all new work. |
| `@graphrefly/graphrefly` | Retired root package name. Deprecated on npm; use `@graphrefly/ts`. |
| `@graphrefly/pure-ts` | Retired old TypeScript implementation. Deprecated on npm; use `@graphrefly/ts`. |

There is no compatibility layer for the retired packages. The current package
uses focused subpaths instead of the old root, `utils`, `base`, `compat`, and
`presets` surfaces.

## What It Gives You

- Graph-owned `state`, `derived`, `producer`, and `effect` sugar;
  `topology.mount(parent, child, path)` composes diagnostic graph views.
- Glitch-free synchronous wave propagation; every node belongs to one graph,
  and `graph.batch(fn)` commits a group of writes as one wave.
- Free-standing operator factories such as `map`, `filter`, `scan`,
  `switchMap`, `combine`, `buffer`, `debounce`, and `rescue`, instantiated with
  `g.initNode(op, deps)` or chained with `pipe(g, source, ...ops)`.
- Sources for values, iterables, promises, timers, events, HTTP/SSE/WebSocket
  driver boundaries, webhooks, cron-like schedules, and Node-specific process
  or filesystem bindings.
- Inspectable graph structure via `describe()`, `find()`, and module helpers `graphTopology(graph)`,
  `observe()`, `observeTopology()`, diagnostics, renderers, and optional profiling.
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
import { graph, renderToMermaid, map, memoryKv } from "@graphrefly/ts";
```

Use focused subpaths when you want clearer ownership or better bundle shape:

```ts
import { graph } from "@graphrefly/ts/graph";
import { map, switchMap } from "@graphrefly/ts/operators";
import { fromPromise, timer } from "@graphrefly/ts/sources";
import { memoryKv } from "@graphrefly/ts/storage";
import { renderToMermaid } from "@graphrefly/ts";
import { useNodeValue } from "@graphrefly/react";
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

sum.subscribe((msgs) => {
  for (const [type, value] of msgs) {
    if (type === "DATA") console.log("sum", value);
  }
});
// sum 0

count.set(1); // sum 2
count.set(2); // sum 6
```

### Sources

```ts
import { graph, timer } from "@graphrefly/ts";

const g = graph({ name: "clock" });
const tick = g.initNode(timer(1000), [], { name: "tick" });

const stop = tick.subscribe((msgs) => {
  for (const [type, value] of msgs) {
    if (type === "DATA") console.log("tick", value);
  }
});
// tick 0 (after one second)
```

A source starts when its first subscriber arrives and stops when the last one
leaves; call `stop()` to end the subscription.

### Inspection

```ts
import { graph, renderSnapshot, renderToMermaid } from "@graphrefly/ts";

const g = graph({ name: "flow" });
const input = g.state("hello", { name: "input" });
g.derived([input], (value) => value.toUpperCase(), { name: "upper" });

const nodes = g.describe(); // [{ id, kind, deps, quiet }, ...]
const snapshot = renderSnapshot(g); // adds names, factories, status and values
const mermaid = renderToMermaid(snapshot);
// flowchart LR
//   n0["input"]
//   n1["upper"]
//   n0 --> n1

const stop = g.observe(["upper"], ({ id, msgs }) => console.log(id, msgs));
// upper [["START"], ["DATA", "HELLO"]]
input.set("bye");
// upper [["PENDING"], ["DATA", "BYE"]]
stop();
```

`describe()` is the topology as data, and `find(id)` gives the node
for reading status and cache. `graphTopology(g)` and `graphBlueprint(g)` derive richer metadata in the blueprint module; `renderSnapshot(g)` and the `renderTo*` functions are renderer helpers.
`observe(ids, sink)` subscribes to each named node, so a cold node activates,
and hands on every array it delivers as `{ id, msgs }`; the returned function
stops it. `g.retain(node)` keeps a node active without a sink and returns the
release.

### Checkpoint And Restore

```ts
import { defaultRestoreRegistry, graph, restoreGraph } from "@graphrefly/ts";

const g = graph({ name: "counter" });
const count = g.state(1, { name: "count" });
count.set(2);

const checkpoint = g.checkpoint(); // format "graphrefly-ts/checkpoint@1"
const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
console.log(restored.find("count")?.cache); // 2
```

State nodes restore from their values. A `derived`, `effect` or `producer` node
is restorable when it is built with `opts.recipe` (`{ ref, config? }`) and the
restoring caller registers that `ref` in the registry; operators and sources
carry their own recipes, which `defaultRestoreRegistry` includes. Restore
refuses a node without a recipe and any other checkpoint format.

### Batch

```ts
import { graph } from "@graphrefly/ts";

const g = graph({ name: "cart" });
const qty = g.state(1, { name: "qty" });
const price = g.state(10, { name: "price" });
const total = g.derived([qty, price], (q, p) => q * p, { name: "total" });

total.subscribe((msgs) => {
  for (const [type, value] of msgs) {
    if (type === "DATA") console.log("total", value);
  }
});
// total 10

g.batch(() => {
  qty.set(2);
  price.set(15);
});
// total 30 (one wave for both writes)
```

The body runs at once and delivers nothing; its writes commit as one wave when
it returns. If the body throws, none of its writes commit.

### Writing a node function

`g.node(deps, fn)` gives the full function surface. The function receives a
`ctx` and sends output only through `ctx.down(arrayOfMessages)` or
`ctx.emit(...values)`:

```ts
import { graph } from "@graphrefly/ts";

const g = graph({ name: "words" });
const line = g.state("a b", { name: "line" });

// One DATA per word, sent as one array.
const words = g.node<string>(
  [line],
  (ctx) => {
    const [dep] = ctx.deps;
    if (!dep.has) return;
    ctx.down(String(dep.value).split(" ").map((w) => ["DATA", w] as const));
  },
  { name: "words" },
);

words.subscribe((msgs) => console.log(msgs));
// [["START"], ["DATA", "a"], ["DATA", "b"]]
line.set("c d e");
// [["PENDING"], ["DATA", "c"], ["DATA", "d"], ["DATA", "e"]]
```

Each `ctx.deps[i]` is a view of one dependency: `id`, `waves` (the arrays it
delivered to this run, each as its DATA payloads), `terminal`, `value`, `has`
and `invalidated`. A kernel node has no first-run gate: its function runs on
activation and on every later input, so it checks `has` before reading `value`.
`ctx.emit(a, b)` is sugar for `ctx.down([["DATA", a], ["DATA", b]])` for a few
fixed values; when the count follows the input, build the array and use
`ctx.down`. `ctx.down([])` sends nothing. A run that sends nothing gets the
kernel's RESOLVED. The messages are `START`, `PENDING`, `DATA`, `RESOLVED`,
`INVALIDATE`, `COMPLETE` and `ERROR`; a function may not send `PENDING` or
`RESOLVED` itself.


Package setup and checks: [development](development.md). Ownership: [documentation map](README.md).
