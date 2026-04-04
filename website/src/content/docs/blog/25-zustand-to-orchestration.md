---
title: "From Zustand to Reactive Orchestration"
date: 2026-03-25
authors: [david]
tags: [migration, compat, zustand, adoption]
---

# From Zustand to Reactive Orchestration

*Chronicle 25 — Arc 7: From Library to Platform*

---

Most teams cannot rewrite state architecture in one sprint.

That is why GraphReFly ships compatibility wrappers: start with familiar store ergonomics, then progressively adopt richer reactive orchestration without breaking app code.

## Migration reality

A typical Zustand codebase already has:

- centralized store setup
- selector-driven reads
- imperative action methods

Asking teams to jump directly into `node`, `derived()`, and `graph.describe()` is a non-starter. The wrapper strategy meets them where they are.

## What the wrapper does

The compat layer at `@graphrefly/graphrefly/compat/zustand` maps known patterns onto GraphReFly internals:

```ts
import { createStore } from '@graphrefly/graphrefly/compat/zustand';

const useStore = createStore((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}));
```

Under the hood:

- Zustand-style creation APIs map to `state()` and `derived()` nodes
- selectors and subscriptions map to reactive node subscriptions
- actions remain explicit mutation boundaries via `set()`

Teams now get graph-aware propagation and composable lifecycle signals without changing a line of component code.

## Why this is more than syntax sugar

The key upgrade is architectural:

- from isolated state slices to connected dataflow through the reactive graph
- from ad hoc async logic to orchestrated reactive pipelines via `producer()` and `effect()`
- from opaque updates to inspectable graph behavior via `graph.describe()`

You keep adoption friction low while changing what is possible.

## Practical rollout pattern

Successful migrations usually follow:

1. Replace store creation with `@graphrefly/graphrefly/compat/zustand` wrapper
2. Keep existing actions/selectors stable — components do not change
3. Move async flows into reactive operators and orchestration nodes
4. Gradually replace wrapper surfaces with native `state()`, `derived()`, and `effect()` where beneficial
5. Use `graph.describe()` to verify the reactive topology matches expectations

This lets teams de-risk gradually and measure value at each step.

## The Trojan horse

The compat wrapper is deliberately a Trojan horse. Once teams have GraphReFly running under familiar Zustand APIs, the reactive graph is already there — connected, inspectable, orchestratable. The shift from "Zustand with extra steps" to "reactive orchestration platform" happens incrementally as teams discover what the graph enables: cross-store derivations, lifecycle-aware effects, observable control flow.

In the predecessor (callbag-recharge), we proved this strategy worked. GraphReFly carries it forward with a cleaner primitive foundation — one `node` instead of five separate primitives means the compat layer has less internal mapping to do.

## Takeaway

Compatibility is not compromise when it is designed as a bridge.

For GraphReFly, wrappers are a platform strategy: reduce migration pain now, unlock orchestration capability later. The team that starts with `createStore` today is the team running full reactive orchestration next quarter.
