# GraphReFly

**The reactive harness layer for agent workflows.** Describe in plain language, review visually, run persistently, trace every decision.

GraphReFly makes long-running human + LLM co-operation reactive, resumable, and causally explainable. State pushes downstream on change (no re-reading), nodes have lifecycles (not infinite append), and every decision has a traceable causal chain — the substrate underneath tools, agents, and personal automations.

[![npm](https://img.shields.io/npm/v/@graphrefly/graphrefly?color=blue)](https://www.npmjs.com/package/@graphrefly/graphrefly)
[![license](https://img.shields.io/github/license/graphrefly/graphrefly-ts)](./LICENSE)

[Docs](https://graphrefly.dev) | [Spec](https://graphrefly.dev/spec/) | [Python API](https://graphrefly.dev/py/api/) | [TS API Reference](https://graphrefly.dev/api/node/)

---

<!-- TODO: Demo 0 GIF/video — NL → flow view → running → "why was this flagged?" -->

## What can you do with it?

**Email triage** — "Watch my inbox. Urgent emails from my team go to a priority list. Newsletters get summarized weekly. Everything else, count by sender." It watches, classifies, and alerts — and when you ask "why was this flagged?", it walks you through the reasoning.

**Spending alerts** — Connect bank transactions to budget categories. Get a push notification when monthly dining exceeds your target. No polling, no manual checks — changes propagate the moment data arrives.

**Knowledge management** — Notes, bookmarks, highlights flow in. Contradictions surface automatically. Related ideas link themselves. Your second brain stays current without you maintaining it.

---

## Quick start

```bash
npm install @graphrefly/graphrefly
```

```ts
import { state, derived, effect } from "@graphrefly/graphrefly";

const count = state(0);
const doubled = derived([count], ([c]) => c * 2);

effect([doubled], ([d]) => console.log("doubled:", d));
// → doubled: 0

count.set(3);
// → doubled: 6
```

## How it works

You describe what you need — an LLM composes a reactive graph (like SQL for data flows). The graph runs persistently, checkpoints its state, and traces every decision through a causal chain. Ask "why?" at any point and get a human-readable explanation from source to conclusion.

## Harness engineering coverage

The eight requirements of a production agent harness cluster into a handful of composed blocks that sit on top of the reactive graph primitives:

| Need | GraphReFly |
|---|---|
| Context & state | `persistentState()` — `autoCheckpoint` + `snapshot` / `restore` + incremental diff |
| Agent memory | `agentMemory()` — `distill` + vectors + knowledge graph + tiers, OpenViking decay |
| Control flow & resilience | `resilientPipeline()` — `rateLimiter → breaker → retry → timeout → fallback`, correct ordering built in |
| Execution & policy | `guardedExecution()` — Actor / Guard ABAC + `policy()` + `budgetGate` + scoped describe |
| Observability & causality | `graphLens()` — reactive topology, health, flow, and `why(node)` causal chains as structured data |
| Human governance | `gate` — reactive `pending` / `isOpen` with `approve` / `reject` / `modify(fn, n)` |
| Verification | Multi-model eval harness with regression gates |
| Continuous improvement | Strategy model: `rootCause × intervention → successRate` |

The library computes structured facts reactively; LLMs and UIs render them. Natural language is never the library's job — which keeps the whole stack model-agnostic and testable.

## Why GraphReFly?

|  | Zustand / Jotai | RxJS | XState | LangGraph | TC39 Signals | **GraphReFly** |
|--|-----------------|------|--------|-----------|-------------|---------------|
| Simple store API | yes | no | no | no | yes | **yes** |
| Streaming operators | no | yes | no | no | no | **yes** |
| Diamond resolution | no | n/a | n/a | n/a | partial | **glitch-free** |
| Graph introspection | no | no | visual | checkpoints | no | **describe / observe / diagram** |
| Causal tracing | no | no | no | no | no | **explain every decision** |
| Durable checkpoints | no | no | persistence | yes | no | **file / SQLite / IndexedDB** |
| LLM orchestration | no | no | no | yes | no | **agentLoop / chatStream / toolRegistry** |
| NL → graph composition | no | no | no | no | no | **graphFromSpec / llmCompose** |
| Framework adapters | React | Angular | React / Vue | n/a | varies | **React / Vue / Svelte / Solid / NestJS** |
| Dependencies | 0 | 0 | 0 | many | n/a | **0** |

## One primitive

Everything is a `node`. Sugar constructors give you the right shape:

```ts
import { state, derived, producer, effect, pipe } from "@graphrefly/graphrefly";

// Writable state
const name = state("world");

// Computed (re-runs when deps change)
const greeting = derived([name], ([n]) => `Hello, ${n}!`);

// Push source (timers, events, async streams)
const clock = producer((emit) => {
  const id = setInterval(() => emit([[DATA, Date.now()]]), 1000);
  return () => clearInterval(id);
});

// Side effect
effect([greeting], ([g]) => document.title = g);

// Operator pipeline
const delayed = pipe(clock, delay(500), map(([, ts]) => new Date(ts)));
```

## Streaming & operators

70+ operators — transform, combine, buffer, window, rate-limit, retry, circuit-break:

```ts
import { pipe, merge, switchMap, debounceTime, retry } from "@graphrefly/graphrefly";

const search = pipe(
  input,
  debounceTime(300),
  switchMap((query) => fromPromise(fetch(`/api?q=${query}`))),
  retry({ strategy: "exponential", maxAttempts: 3 }),
);
```

## Graph container

Register nodes in a `Graph` for introspection, snapshot, and persistence:

```ts
import { Graph, state, derived } from "@graphrefly/graphrefly";

const g = new Graph("pricing");
const price = g.register("price", state(100));
const tax   = g.register("tax", derived([price], ([p]) => p * 0.1));
const total = g.register("total", derived([price, tax], ([p, t]) => p + t));

g.describe();   // → full graph topology as JSON
g.diagram();    // → Mermaid diagram string
g.observe((e) => console.log(e));  // → live change stream
```

## AI & orchestration

First-class patterns for LLM streaming, agent loops, and human-in-the-loop workflows:

```ts
import { chatStream, agentLoop, toolRegistry } from "@graphrefly/graphrefly";

// Streaming chat with tool use
const chat = chatStream("assistant", {
  model: "claude-sonnet-4-20250514",
  tools: toolRegistry("tools", { search, calculate }),
});

// Full agent loop: observe → think → act → memory
const agent = agentLoop("researcher", {
  llm: chat,
  memory: agentMemory({ decay: "openviking" }),
});
```

## Framework adapters

Drop-in bindings — your framework, your way:

```tsx
// React
import { useNode } from "@graphrefly/graphrefly/compat/react";
const [value, setValue] = useNode(count);

// Vue
import { useNode } from "@graphrefly/graphrefly/compat/vue";
const value = useNode(count);  // → Ref<number>

// Svelte
import { toStore } from "@graphrefly/graphrefly/compat/svelte";
const value = toStore(count);  // → Svelte store

// Solid
import { useNode } from "@graphrefly/graphrefly/compat/solid";
const value = useNode(count);  // → Signal<number>

// NestJS
import { GraphReflyModule } from "@graphrefly/graphrefly/compat/nestjs";
@Module({ imports: [GraphReflyModule.forRoot()] })
```

## Tree-shaking imports

Prefer subpath imports for minimal bundle:

```ts
import { node, batch, DATA } from "@graphrefly/graphrefly/core";
import { map, switchMap } from "@graphrefly/graphrefly/extra";
import { Graph } from "@graphrefly/graphrefly/graph";
```

The root entry re-exports everything:

```ts
import { node, map, Graph } from "@graphrefly/graphrefly";
```

## Resilience & checkpoints

Built-in retry, circuit breakers, rate limiters, and persistent checkpoints:

```ts
import { retry, circuitBreaker, saveGraphCheckpoint, FileCheckpointAdapter } from "@graphrefly/graphrefly";

// Retry with exponential backoff
const resilient = pipe(source, retry({ strategy: "exponential" }));

// Circuit breaker
const breaker = circuitBreaker({ threshold: 5, resetTimeout: 30_000 });

// Checkpoint to file system
const adapter = new FileCheckpointAdapter("./checkpoints");
await saveGraphCheckpoint(graph, adapter);
```

## Project layout

| Path | Contents |
|------|----------|
| `src/core/` | Message protocol, `node` primitive, batch, sugar constructors |
| `src/extra/` | Operators, sources, data structures, resilience, checkpoints |
| `src/graph/` | `Graph` container, describe/observe, snapshot, persistence |
| `src/patterns/` | Orchestration, messaging, memory, AI, CQRS, reactive layout |
| `src/compat/` | Framework adapters (React, Vue, Svelte, Solid, NestJS) |
| `docs/` | Roadmap, guidance, benchmarks |
| `website/` | Astro + Starlight docs site ([graphrefly.dev](https://graphrefly.dev)) |

## Scripts

```bash
pnpm test          # vitest run
pnpm run lint      # biome check
pnpm run build     # tsup (ESM + CJS + .d.ts)
pnpm bench         # vitest bench
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
