---
title: "GraphReFly vs Jotai"
description: "Comparing GraphReFly and Jotai for atomic state — diamond resolution, framework independence, and streaming operators."
---

Both GraphReFly and Jotai use atomic state with derived computations. GraphReFly adds glitch-free diamond resolution, streaming operators, and works without React.

## At a Glance

| Feature | Jotai | GraphReFly |
|---------|-------|------------|
| **Primitive** | `atom(0)` | `state(0)` or `atom(0)` via compat |
| **Derived** | `atom((get) => ...)` | `derived([deps], fn)` or `dynamicNode(fn)` |
| **Diamond resolution** | Glitches possible | Glitch-free topological resolution |
| **Framework** | React only | Framework-agnostic with adapters for React, Vue, Svelte, Solid, NestJS |
| **Streaming operators** | None built-in | 70+ operators (map, filter, scan, debounce, ...) |
| **DevTools** | Jotai DevTools extension | `graph.describe()` — runtime, programmatic |
| **Completion semantics** | None | First-class COMPLETE/ERROR/TEARDOWN lifecycle |
| **Bundle** | ~2.4 KB | ~5 KB core (tree-shakeable) |

## Key Difference

Jotai and GraphReFly share the "atoms all the way down" philosophy, but they diverge on **consistency guarantees**. Jotai re-evaluates derived atoms eagerly when dependencies change, which can cause diamond glitches — a derived atom that depends on two branches of the same root may fire with an inconsistent pair of values. GraphReFly resolves the full dependency graph topologically before any derived node re-evaluates, guaranteeing glitch-free reads.

## The Diamond Problem

Consider this dependency shape:

```
    A
   / \
  B   C
   \ /
    D
```

Where `D` depends on both `B` and `C`, which both depend on `A`.

```ts
// Jotai — D may see (B_new, C_old) during A's update
import { atom } from 'jotai';

const a = atom(1);
const b = atom((get) => get(a) * 2);
const c = atom((get) => get(a) * 3);
const d = atom((get) => `${get(b)}-${get(c)}`);
// When a changes from 1 → 2:
// d might briefly see "4-3" (b updated, c stale) before settling to "4-6"
```

```ts
// GraphReFly — D always sees consistent (B_new, C_new)
import { state, derived } from '@graphrefly/graphrefly';

const a = state(1);
const b = derived([a], (a) => a * 2);
const c = derived([a], (a) => a * 3);
const d = derived([b, c], (b, c) => `${b}-${c}`);

a.set(2);
d.get(); // "4-6" — always consistent, never "4-3"
```

## Migration Path

### Drop-in Compat Layer

For incremental migration, use the Jotai-compatible adapter:

```ts
import { atom } from '@graphrefly/graphrefly/compat/jotai';

const countAtom = atom(0);
const doubledAtom = atom((get) => get(countAtom) * 2);
```

This preserves Jotai's `atom((get) => ...)` API while adding diamond resolution under the hood.

### Native API

GraphReFly offers two patterns for derived values:

```ts
import { state, derived, dynamicNode } from '@graphrefly/graphrefly';

const count = state(0);
const multiplier = state(2);

// Explicit deps — statically declared, optimal performance
const result = derived([count, multiplier], (c, m) => c * m);

// Dynamic deps — runtime dependency tracking (like Jotai's get())
const result2 = dynamicNode((get) => {
  const c = get(count);
  return c > 10 ? get(multiplier) * c : c;
});
```

`derived()` with explicit deps is preferred when dependencies are known at definition time. `dynamicNode()` handles cases where the set of dependencies varies based on runtime values — similar to Jotai's `atom((get) => ...)` pattern but with diamond resolution.

## What Jotai Lacks

- **Diamond resolution.** Jotai's eager re-evaluation model can produce glitchy intermediate states in diamond dependency patterns. GraphReFly resolves topologically.
- **Streaming operators.** No built-in operators for debounce, throttle, scan, merge, or async stream composition. GraphReFly provides 70+ composable operators.
- **Framework independence.** Jotai is tightly coupled to React. GraphReFly works in any JavaScript runtime — React, Vue, Svelte, Solid, Node.js, or NestJS on the server.
- **Completion semantics.** Jotai atoms have no lifecycle concept. GraphReFly nodes support COMPLETE, ERROR, and TEARDOWN messages, enabling proper resource cleanup and error propagation through the graph.

## What Jotai Does Better

- **Simpler mental model.** Jotai's `atom((get) => ...)` is immediately intuitive — you just call `get()` on other atoms. No need to think about explicit dependency arrays or sugar constructor choices.
- **React integration.** Jotai is built for React. `useAtom` is zero-config, integrates with Suspense and transitions, and follows React's component model naturally.
- **Ecosystem.** Jotai has a mature ecosystem with utilities for async atoms, storage persistence, URL state, query integration (jotai-tanstack-query), and more.
- **Async atoms.** Jotai's async atom pattern (`atom(async (get) => ...)`) with Suspense integration is elegant for data fetching inside React components.

## When to Choose GraphReFly

Choose GraphReFly when your application needs:

- **Glitch-free diamond resolution** — especially in complex derived chains where intermediate inconsistencies cause bugs or wasted renders
- **Streaming operators** for debouncing user input, throttling API calls, or composing async data flows
- **Framework independence** — shared state logic across React frontend, Vue admin panel, and NestJS backend
- **Runtime inspectability** via `graph.describe()` for debugging, testing, or LLM-driven orchestration
- **Lifecycle semantics** — completion, error propagation, and teardown across the dependency graph

For React-only apps with simple atom graphs and no diamond concerns, Jotai remains an excellent, lightweight choice.
