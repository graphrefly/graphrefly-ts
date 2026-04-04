---
title: "GraphReFly vs Zustand"
description: "Comparing GraphReFly and Zustand for state management — ergonomics, computed values, diamond resolution, and migration paths."
---

Both GraphReFly and Zustand are simple, ergonomic state management libraries that prize small APIs and minimal boilerplate. GraphReFly adds diamond-safe computed values, streaming operators, and runtime graph inspectability while preserving a familiar API shape.

## At a Glance

| Feature | Zustand | GraphReFly |
|---------|---------|------------|
| **API style** | `create((set, get) => state)` | Same via compat layer, or one primitive (`node`) with sugar constructors |
| **Computed values** | None built-in (middleware or manual) | `derived()` — automatic, diamond-safe |
| **Dynamic deps** | N/A | `dynamicNode()` — runtime dependency tracking |
| **Diamond resolution** | N/A (no derived graph) | Glitch-free topological resolution |
| **Streaming operators** | None | 70+ operators (map, filter, scan, debounce, ...) |
| **DevTools** | Browser extension | `graph.describe()` — runtime, programmatic |
| **Framework** | React-first (vanilla available) | Framework-agnostic with adapters for React, Vue, Svelte, Solid, NestJS |
| **Bundle** | ~1.1 KB | ~5 KB core (tree-shakeable) |

## Key Difference

Zustand gives you a flat store with `set`/`get` — simple and effective for straightforward state. GraphReFly gives you a **reactive graph** where state nodes, derived computations, and effects form an inspectable DAG. This means computed values are first-class, dependency chains resolve without glitches, and you can introspect the entire graph at runtime for debugging or LLM-driven orchestration.

## Migration Path

### Option 1: Native API

Zustand's `create` pattern maps naturally to GraphReFly's sugar constructors:

```ts
// Zustand
import { create } from 'zustand';

const useStore = create((set, get) => ({
  count: 0,
  doubled: () => get().count * 2,
  increment: () => set((s) => ({ count: s.count + 1 })),
}));

// Read
const count = useStore((s) => s.count);
const doubled = useStore((s) => s.doubled());
```

```ts
// GraphReFly — native
import { state, derived } from '@graphrefly/graphrefly';

const count = state(0);
const doubled = derived([count], (c) => c * 2); // diamond-safe, cached

// Read
count.get();    // 0
doubled.get();  // 0

// Write
count.set(1);
doubled.get();  // 2 — automatically recomputed
```

### Option 2: Drop-in Compat Layer

For incremental migration, use the Zustand-compatible adapter:

```ts
import { create } from '@graphrefly/graphrefly/compat/zustand';

const useStore = create((set, get) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}));
```

This gives you the same `create((set, get) => ...)` API while allowing you to incrementally adopt `derived()` and streaming operators on top.

## What Zustand Lacks

- **Computed values.** Zustand has no built-in derived/computed primitive. You either recompute in selectors (no caching) or add middleware. GraphReFly's `derived()` is first-class, cached, and diamond-safe.
- **Diamond resolution.** Without a dependency graph, Zustand cannot detect or resolve diamond dependencies. Derived values that depend on multiple branches of the same root may see inconsistent intermediate states.
- **Streaming operators.** No built-in operators for debounce, throttle, scan, merge, or async stream composition. GraphReFly provides 70+ operators that compose naturally.
- **Programmatic inspection.** Zustand's devtools require a browser extension. GraphReFly's `graph.describe()` returns a structured snapshot at runtime — usable in tests, logging, or LLM-driven analysis.

## What Zustand Does Better

- **Smaller bundle.** At ~1.1 KB, Zustand is one of the smallest state libraries available. GraphReFly's ~5 KB core is still small, but Zustand wins on raw size.
- **React integration.** Zustand's `useStore` hook is zero-config and deeply integrated with React's rendering model. GraphReFly requires an adapter for React bindings.
- **Ecosystem.** Zustand has a large community, extensive middleware (persist, immer, devtools), and widespread adoption. GraphReFly's ecosystem is younger.
- **Simplicity.** For apps that need a flat store with no computed values or streaming, Zustand's `set`/`get` model is hard to beat for directness.

## When to Choose GraphReFly

Choose GraphReFly when your application needs:

- **Derived computations** that must stay consistent across diamond dependencies
- **Streaming operators** for debouncing, throttling, or composing async data flows
- **Runtime inspectability** for debugging, testing, or LLM-driven orchestration
- **Framework independence** — the same state logic running in React, Vue, Svelte, Solid, or server-side NestJS
- **Graph-structured state** where nodes have typed relationships and lifecycle semantics (completion, error propagation, teardown)

For simple flat stores in React-only apps, Zustand remains an excellent choice.
