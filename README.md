# GraphReFly

**The reactive graph your code, your agents, and your humans share as a blueprint.** Compose in code, review the projected spec, co-edit across agents without colliding, trace every decision.

GraphReFly is a reactive graph protocol for human + LLM co-operation. Code is the source of truth: build a graph, inspect its live structure with `topology()`, inspect runtime detail with `describe()`, observe message flow with `observe()`, and persist or restore explicit checkpoint data when you need lifecycle durability. Multi-agent and presentation-layer surfaces are being migrated onto the clean-slate TypeScript package; the protocol authority lives in `~/src/graphrefly`.

[![npm](https://img.shields.io/npm/v/@graphrefly/ts?color=blue)](https://www.npmjs.com/package/@graphrefly/ts)
[![license](https://img.shields.io/github/license/graphrefly/graphrefly-ts)](./LICENSE)

[Docs](https://graphrefly.dev) | [Spec](https://graphrefly.dev/spec/) | [Python API](https://graphrefly.dev/py/api/) | [TS API Reference](https://graphrefly.dev/api/reactivelayout/)

## Packages

| Package | What it is |
|---|---|
| [`@graphrefly/ts`](./packages/ts) | Clean-slate TypeScript implementation: substrate, graph, operators, sources, storage, render, testing, and data structures in one self-contained package. This is the current TS target. |
| `@graphrefly/graphrefly` | Retired root package name. CSP-9/B65 removed active root implementation ownership; use `@graphrefly/ts` and its D125 subpaths. |
| [`@graphrefly/pure-ts`](./packages/pure-ts) | Frozen read-only reference for old behavior and edge cases. It remains only until B66 can delete it. Do not add new development here. |

---

<!-- TODO: Demo 0 GIF/video — NL → flow view → running → "why was this flagged?" -->

## What can you do with it?

**Email triage** — "Watch my inbox. Urgent emails from my team go to a priority list. Newsletters get summarized weekly. Everything else, count by sender." It watches, classifies, and alerts — and when you ask "why was this flagged?", it walks you through the reasoning.

**Spending alerts** — Connect bank transactions to budget categories. Get a push notification when monthly dining exceeds your target. No polling, no manual checks — changes propagate the moment data arrives.

**Knowledge management** — Notes, bookmarks, highlights flow in. Contradictions surface automatically. Related ideas link themselves. Your second brain stays current without you maintaining it.

---

## Quick start

```bash
npm install @graphrefly/ts
```

```ts
import { graph } from "@graphrefly/ts";

const g = graph({ name: "counter" });
const count = g.state(0, { name: "count" });
const doubled = g.derived([count], (c) => c * 2, { name: "doubled" });

g.effect([doubled], (d) => console.log("doubled:", d));
// → doubled: 0

count.set(3);
// → doubled: 6
```

## How it works

Code is the source of truth. In `@graphrefly/ts`, you compose a graph using the eight clean-slate verbs (`node`, `graph`, `batch`, `state`, `producer`, `derived`, `effect`, `mount`) plus operator factories. `graph.topology()` returns a live, JSON-serializable pure-structure snapshot; `graph.describe()` returns the richer developer inspection snapshot; `graph.observe()` is read-only message egress; `graph.profile()` is opt-in and dispatcher-backed.

The graph core is synchronous. Async work lives at source, pool, storage, or wire-bridge boundaries; user functions route through the dispatcher; DATA moves through messages, not hidden cache peeks.

## Migration Status

`@graphrefly/ts` already re-derived most of the old `pure-ts/extra` surface under clean-slate semantics:

| Area | Status |
|---|---|
| Operators | Present: transform, combine, buffer, higher-order, time, control, and error families. Old `window/windowCount/windowTime` are intentionally not ported by the D58 clean-slate decision; use array buffer forms and derived views. |
| Sources | Present: sync values/iterables, promises, async iterables, events, timers, push notifications, and Node fs watch. |
| Data structures | Present: `reactiveMap`, `reactiveList`, `reactiveIndex`, `reactiveLog`, `ReactiveView`, and `reactiveCascadingCache`. |
| Storage | Present as passive helpers: KV, append log, versioned KV, read-through, content-addressed storage, observe-event logs, WAL frame codecs, browser/node backends. Old graph-owned `attachSnapshotStorage` / `restoreSnapshot` convenience APIs are retired; graph restore is `restoreGraph(checkpoint, { registry })`. |
| Render/inspection | Present: describe renderers, diagnostics, observe filters, profile. Old fake live-topology streams are not restored; D118 keeps `describe()` as a snapshot until real topology-event egress exists. |
| Presentation | The old root `src/` implementation is retired. Remaining legacy consumers are tracked through B64/B66: archived historical docs, design-gated demos, and legacy recipe/comparison pages. |

So the old `pure-ts` reference is still useful for edge cases and product memory, but the remaining work is no longer "copy the extras layer." It is mainly entrypoint cleanup, presentation rebasing, and explicit decisions for old shapes that conflict with the clean-slate floor.

The library computes structured facts reactively; LLMs and UIs render them. Natural language is never the library's job — which keeps the whole stack model-agnostic and testable.

## Why GraphReFly?

|  | Zustand / Jotai | RxJS | XState | LangGraph | Archon | Hermes | **GraphReFly** |
|--|-----------------|------|--------|-----------|--------|--------|---------------|
| Simple store API | yes | no | no | no | n/a | n/a | **yes** |
| Streaming operators | no | yes | no | no | no | no | **yes** |
| Diamond resolution | no | n/a | n/a | n/a | n/a | n/a | **glitch-free** |
| Graph introspection | no | no | visual | checkpoints | YAML view | no | **describe / observe / diagram** |
| Causal tracing | no | no | no | no | no | no (black-box) | **explain every decision** |
| Durable checkpoints | no | no | persistence | yes | sqlite | yes | **file / SQLite / IndexedDB** |
| LLM orchestration | no | no | no | yes | yes (workflow) | yes (skills) | **agentLoop / chatStream / toolRegistry** |
| Auto-projection: code → spec | no | no | no | no | no (manual YAML) | partial (skill emit) | **factoryTag round-trip** |
| Multi-agent on shared topology | no | no | no | no | no (worktree-isolated) | no (skill-isolated) | **L0–L3 ownership protocol** |
| Framework adapters | React | Angular | React / Vue | n/a | n/a | n/a | **React / Vue / Svelte / Solid / NestJS** |
| Dependencies | 0 | 0 | 0 | many | many | many | **0** |

## One primitive

Everything is a `node`. Register them on a `Graph` for introspection and let its sugar methods give you the right shape:

```ts
import { fromTimer, graph, initNode, map } from "@graphrefly/ts";

const g = graph({ name: "hello" });

// Writable state
const name = g.state("world", { name: "name" });

// Computed (re-runs when deps change)
const greeting = g.derived([name], (n) => `Hello, ${n}!`, { name: "greeting" });

// Push source (timers, events, async streams)
const clock = g.initNode(fromTimer(1000), [], { name: "clock" });

// Side effect
g.effect([greeting], (s) => { document.title = s; });

// Operator node
const delayed = initNode(map((ts: number) => new Date(ts)), [clock]);
```

## Streaming & operators

Operators are free-standing factories. Instantiate them with `g.initNode(op, deps, opts)` for graph-owned inspection, or with the free `initNode(op, deps)` helper for bare nodes:

```ts
import { debounceTime, fromPromise, graph, switchMap } from "@graphrefly/ts";

const g = graph();
const input = g.state("");
const debounced = g.initNode(debounceTime(300), [input], { name: "debounced" });
const results = g.initNode(
  switchMap((query: string) => g.initNode(fromPromise(fetch(`/api?q=${query}`)), [])),
  [debounced],
  { name: "results" },
);
```

## Graph container

`Graph` is the introspection / checkpoint / lifecycle container. Use its sugar methods to register nodes by name:

```ts
import { describeToMermaid, graph } from "@graphrefly/ts";

const g = graph({ name: "pricing" });
const price = g.state(100, { name: "price" });
const tax = g.derived([price], (p) => p * 0.1, { name: "tax" });
g.derived([price, tax], (p, t) => p + t, { name: "total" });

const snapshot = g.describe();
const topology = g.topology();
const mmd = describeToMermaid(snapshot);
const off = g.observe().subscribe((event) => console.log(event));
```

## Tree-shaking imports

Use `@graphrefly/ts` subpaths for clean-slate bundles:

```ts
import { batch, node } from "@graphrefly/ts/core";
import { map, switchMap } from "@graphrefly/ts/operators";
import { graph } from "@graphrefly/ts/graph";
import { memoryKv } from "@graphrefly/ts/storage";

// Node-only helpers
import { fromFSWatch } from "@graphrefly/ts/sources/node";
import { fileKv, sqliteKv } from "@graphrefly/ts/storage/node";

// Browser-only helpers
import { indexedDbKv } from "@graphrefly/ts/storage/browser";
```

## Resilience & checkpoints

Clean-slate storage is passive. It can store facts, frames, checkpoints, and observe-event logs, but it does not own graph restore semantics:

```ts
import { defaultRestoreRegistry, graph, memoryKv, restoreGraph } from "@graphrefly/ts";

const g = graph({ name: "pricing" });
const price = g.state(100, { name: "price", restore: { ref: "state" } });
const checkpoint = g.checkpoint();

await memoryKv().put("checkpoint:pricing", checkpoint);
const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
```

## Project layout

Clean-slate TS lives in `packages/ts`. The old root presentation implementation has been removed from active ownership; `packages/pure-ts` remains frozen until B66 can delete it.

| Path | Contents |
|------|----------|
| `packages/ts/src/` | Clean-slate TS package: substrate, graph, operators, sources, storage, render, data structures, testing |
| `packages/pure-ts/` | Frozen read-only reference and temporary legacy-consumer dependency |
| `archive/packages/parity-tests/` | Archived old structural parity-test package; clean-slate parity is behavioral conformance in `~/src/graphrefly/spec/conformance.jsonl` |
| `~/src/graphrefly` | Language-neutral authority: decisions, rules, conformance, formal model, sequencer |
| `website/` | Astro + Starlight docs site ([graphrefly.dev](https://graphrefly.dev)) |

The Rust and Python sibling implementations are self-contained packages in `~/src/graphrefly-rs` and `~/src/graphrefly-py`; cross-language parity is conformance behavior, not old symbol-set parity.

## Scripts

```bash
pnpm test            # clean-slate TS test suite
pnpm test:ts         # clean-slate TS test suite
pnpm run lint        # biome check + clean-slate no-raw-async + active package typecheck gate
pnpm run lint:fix    # biome --write
pnpm run build       # @graphrefly/ts build
pnpm bench           # clean-slate TS B49 probe
pnpm probe:b49:ts    # clean-slate TS perf probe
```

## Acknowledgments

GraphReFly builds on ideas from many projects and papers:

**Protocol & predecessor:**
- **[Callbag](https://github.com/callbag/callbag)** (Andre Staltz) — the original reactive protocol spec. GraphReFly's message-based node communication descends from callbag's function-calling-function model.
- **[callbag-recharge](https://github.com/Callbag-Recharge/callbag-recharge)** — GraphReFly's direct predecessor. 170+ modules, 4 architecture iterations, and 30 engineering blog posts that shaped every design decision.

**Reactive design patterns:**
- **[SolidJS](https://github.com/solidjs/solid)** — two-phase execution (DIRTY propagation + value flow), automatic caching, and effect batching. Identified as the closest philosophical neighbor during design research.
- **[Preact Signals](https://github.com/preactjs/signals)** — fine-grained reactivity and cached-flag optimization patterns that informed RESOLVED signal design.
- **[TC39 Signals Proposal](https://github.com/tc39/proposal-signals)** — the `.get()/.set()` contract and the push toward language-level reactivity that clarified where signals end and graphs begin.
- **[RxJS](https://github.com/ReactiveX/rxjs)** — operator naming conventions (aliases like `combineLatest`, `mergeMap`, `catchError`) and the DevTools observability philosophy that inspired the Inspector pattern.

**AI & memory:**
- **[OpenViking](https://github.com/volcengine/openviking)** (Volcengine) — the memory decay formula (`sigmoid(log1p(count)) * exp_decay(age, 7d)`) and L0/L1/L2 progressive loading strategy used in `agentMemory()`.
- **[FadeMem](https://arxiv.org/abs/2501.09399)** (Wei et al., ICASSP 2026) — biologically-inspired dual-layer memory with adaptive exponential decay, validating the decay approach independently.
- **[MAGMA](https://arxiv.org/abs/2501.13920)** (Jiang et al., 2026) — four-parallel-graph model (semantic/temporal/causal/entity) that informed `knowledgeGraph()` design.
- **[Letta/MemGPT](https://github.com/letta-ai/letta)**, **[Mem0](https://github.com/mem0ai/mem0)**, **[Zep/Graphiti](https://github.com/getzep/graphiti)**, **[Cognee](https://github.com/topoteretes/cognee)** — production memory architectures surveyed during `agentMemory()` design.

**Layout & other:**
- **[Pretext](https://github.com/chenglou/pretext)** (Cheng Lou) — inspired the reactive layout engine's DOM-free text measurement pipeline, rebuilt as a `state -> derived` graph.
- **[CASL](https://github.com/stalniy/casl)** — declarative `allow()`/`deny()` policy builder DX that inspired `policy()`, though CASL itself was rejected as a dependency.
- **[Nanostores](https://github.com/nanostores/nanostores)** — tiny framework-agnostic API with near 1:1 `.get()/.set()/.subscribe()` mapping that validated the store ergonomics.

## License

[MIT](./LICENSE)
