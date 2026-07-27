# @graphrefly/ts

GraphReFly is a synchronous reactive graph runtime for TypeScript. You compose
nodes, push data through explicit messages, inspect the live graph, and keep
async work at clear source/adapter/executor boundaries.

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
import { useNodeValue as useReactNodeValue } from "@graphrefly/react";
import { useNodeValue as useVueNodeValue } from "@graphrefly/vue";
import { nodeReadable } from "@graphrefly/svelte";
import { createNodeValue } from "@graphrefly/solid";
```

Other focused surfaces include:

- `@graphrefly/nestjs`
- `@graphrefly/ts/adapters/observe-storage`
- `@graphrefly/ts/rate-limit`
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

## Keyed Externally Authoritative Rate Limits

D651 places the complete keyed rate-limit domain on the focused
`@graphrefly/ts/rate-limit` application-infrastructure subpath. The package
root and `@graphrefly/ts/orchestration` do not re-export it. The bounded host
adapter remains under `@graphrefly/ts/adapters`:

```ts
import {
  attachKeyedRateLimitAuthority,
  type KeyedRateLimitAuthority,
} from "@graphrefly/ts/adapters";
import {
  assertKeyedRateLimitRequest,
  createFixedWindowRateLimitPolicy,
  createFixedWindowRateLimitTransitionInput,
  createKeyedRateLimitOutcome,
  evaluateFixedWindowRateLimitTransition,
  keyedRateLimitRequestIdentity,
} from "@graphrefly/ts/rate-limit";
```

The focused domain separates these responsibilities:

- A request binds the complete strict quota-consumption identity: request id,
  opaque key, exact policy and algorithm revision, authority, operation, and
  positive units. `keyedRateLimitRequestIdentity` supplies canonical identity;
  consumers do not hand-author canonical encoding.
- An outcome is the externally authoritative host decision.
- An admission is the correlated Graph fact produced only from a valid
  `allowed` outcome. A denial is a ready valid quota denial produced only from
  a valid `denied` outcome. Unavailable, conflict, malformed, mismatched,
  overflow, and orphan material fails closed through status and issues.
- A policy defines exact algorithm configuration and scope. State is the exact
  algorithm-specific quota state for key, policy/algorithm revision, authority,
  and state revision.
- Evaluator input combines the request, exact policy, exact state or explicit
  first initialization, and externally supplied `observedAtMs`.
- A transition is an immutable ready allowed/denied calculation with
  `nextState`; it is not an outcome, receipt, admission, clock, transaction, or
  Graph node.

Within one host-owned atomic consume operation, validate and identify the
request; look up the receipt by authority/request id; return the stored outcome
for identical material without policy, state, time, evaluator, or commit
access; return conflict for different material; otherwise resolve the exact
policy, load exact scoped state, acquire authoritative `observedAtMs`, evaluate,
and atomically persist `nextState` with the outcome receipt. The host assigns
the outcome id, maps the transition through `createKeyedRateLimitOutcome`, and
supplies the externally authoritative outcome through
`KeyedRateLimitAuthority`.

The governed topology is raw request → bounded authority adapter →
authority-admitted correlation facts → externally authoritative outcome →
admission or denial. Protected effects depend only on
`adapter.admission.admissions`; they retain no raw-request bypass.

Three optional synchronous pure host-side reference evaluators are available:

- Fixed Window uses Unix-epoch-aligned half-open windows `[start, end)` and
  permanent valid denial for units above capacity.
- Sliding Window keeps an exact bounded successful-consumption ledger with
  exact-cutoff expiry and equal-millisecond coalescing.
- Token Bucket uses integer-rational refill with persisted remainder and
  saturation that discards excess credit and remainder.

Each evaluator receives externally supplied `observedAtMs`; it owns no Graph
node, admission authority, clock, persistence, transaction, durable receipt,
outcome id, timer, retry loop, or protected effect. A host can use a completely
custom algorithm behind `KeyedRateLimitAuthority` without a registry, policy
SDK, provider registry, or callback engine.

Durable quota-receipt replay and protected application-effect receipts are
different boundaries. Quota replay prevents consumption from advancing twice.
The live admission gate suppresses replay only while the completed correlation
entry remains retained. Cross-restart or multi-instance protected-effect
exactly-once requires an application/executor-owned effect receipt and is not
provided by this surface.

B111.6 supplies deterministic serialized atomic contract-model evidence only;
it does not certify SQLite, Redis, fsync, crash-mid-commit recovery, or real
parallel-process isolation. `localFixedWindowRateLimitBundle` is only a
graph-local in-memory non-keyed stream shaper, not durable or multi-instance
authority and not a governed-effect bypass.

See the
[`examples/basic/keyed-rate-limit`](../../examples/basic/keyed-rate-limit/README.md)
runnable example for receipt-first replay/conflict, all three evaluators,
custom authority, Graph admission topology, and the distinct effect-receipt
boundary.

This is a TS-first application-infrastructure surface. It is not wave-protocol
or conformance behavior and does not promise Rust/Python parity.

## Package Status

This is the current TypeScript package. The old `@graphrefly/graphrefly` and
`@graphrefly/pure-ts` packages are retired and deprecated. New code should use
`@graphrefly/ts` and its focused subpaths.

`@graphrefly/ts` is pre-1.0. The package prioritizes the current API surface
over backward compatibility with retired APIs.

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

AgenticMemory committed fact-log runtime confidence checks are opt-in:

```bash
pnpm --filter @graphrefly/ts test -- agentic-memory
pnpm --filter @graphrefly/ts test:browser:agentic-memory
```

The focused Vitest command includes the Node file-backed single-writer backend
smoke against the real filesystem. The browser command bundles and runs the real
browser IndexedDB smoke in Chrome/Chromium; set `CHROME_BIN` if Chrome is not on
one of the usual executable paths. These checks exercise append/read
normalization, fact-stream cursors versus backend diagnostic cursors,
single-writer reference-backend status, duplicate/conflict outcomes, and
`uncertain` append handling. They remain smoke/runtime-confidence checks only:
IndexedDB transaction completion and file write completion are physical adapter
attempts, not fsync or permanent durability guarantees, multi-writer correctness,
hydration, restore, replay, live refresh, backend materialization, application
acknowledgement, live graph truth, record mutation, same-evaluation feedback, or
graph commit barriers.

Before publishing:

```bash
pnpm test
pnpm run lint
pnpm run build
pnpm --filter @graphrefly/ts pack --pack-destination /tmp
```
