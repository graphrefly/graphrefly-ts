---
title: "GraphReFly vs RxJS"
description: "Comparing GraphReFly and RxJS — first-class state, diamond resolution, and streaming operators in a unified model."
---

Both GraphReFly and RxJS provide streaming operators for composing asynchronous data flows. GraphReFly adds first-class state (`.get()`/`.set()`), diamond-safe derived computations, and a simpler API surface.

## At a Glance

| Feature | RxJS | GraphReFly |
|---------|------|------------|
| **State** | `BehaviorSubject` (awkward) | `state()` — first-class `.get()`/`.set()` |
| **Derived** | `combineLatest` + `map` | `derived([deps], fn)` — diamond-safe |
| **Dynamic deps** | `switchMap` chains | `dynamicNode()` — runtime dependency tracking |
| **Operators** | 200+ | 70+ |
| **Diamond resolution** | Glitches via `combineLatest` | Glitch-free topological resolution |
| **Graph inspection** | None | `graph.describe()` — runtime, programmatic |
| **Interop** | Via adapter | `toObservable()` / `fromAny()` |
| **Framework** | Framework-agnostic | Framework-agnostic with adapters for React, Vue, Svelte, Solid, NestJS |
| **Bundle** | ~30 KB | ~5 KB core (tree-shakeable) |

## Key Difference

RxJS is a **streaming library** that awkwardly handles state. GraphReFly is a **state management library** that natively handles streams.

In RxJS, state requires `BehaviorSubject` — a special Observable that holds a current value but exposes it through a clunky `.value` property with no `.set()` ergonomics. Derived state requires `combineLatest` + `map`, which suffers from diamond glitches. In GraphReFly, `state()` is a first-class primitive with `.get()`/`.set()`, and `derived()` resolves diamonds topologically before any recomputation fires.

## Code Comparison

### State Management

```ts
// RxJS — state via BehaviorSubject
import { BehaviorSubject, combineLatest, map } from 'rxjs';

const count$ = new BehaviorSubject(0);
const multiplier$ = new BehaviorSubject(2);
const result$ = combineLatest([count$, multiplier$]).pipe(
  map(([c, m]) => c * m)
);

// Read current value — awkward
console.log(count$.value);

// Write — asymmetric API
count$.next(5);

// Subscribe to derived
result$.subscribe(console.log);
```

```ts
// GraphReFly — state is first-class
import { state, derived } from '@graphrefly/graphrefly-ts';

const count = state(0);
const multiplier = state(2);
const result = derived([count, multiplier], (c, m) => c * m);

// Read — symmetric, obvious
console.log(count.get());

// Write — symmetric, obvious
count.set(5);

// Derived is always consistent
console.log(result.get()); // 10
```

### The Diamond Problem

```ts
// RxJS — combineLatest diamond glitch
import { BehaviorSubject, combineLatest, map } from 'rxjs';

const a$ = new BehaviorSubject(1);
const b$ = a$.pipe(map((a) => a * 2));
const c$ = a$.pipe(map((a) => a * 3));
const d$ = combineLatest([b$, c$]).pipe(map(([b, c]) => `${b}-${c}`));

d$.subscribe(console.log);
// Emits: "2-3"
a$.next(2);
// Emits: "4-3" (GLITCH — b updated, c stale)
// Emits: "4-6" (settles)
```

```ts
// GraphReFly — no glitch
import { state, derived } from '@graphrefly/graphrefly-ts';

const a = state(1);
const b = derived([a], (a) => a * 2);
const c = derived([a], (a) => a * 3);
const d = derived([b, c], (b, c) => `${b}-${c}`);

a.set(2);
d.get(); // "4-6" — always consistent, never "4-3"
```

### Interop

GraphReFly provides bidirectional interop with RxJS Observables:

```ts
import { state } from '@graphrefly/graphrefly-ts';
import { toObservable, fromAny } from '@graphrefly/graphrefly-ts/extra';

// GraphReFly → RxJS
const count = state(0);
const count$ = toObservable(count);
count$.subscribe(console.log); // works with any RxJS operator

// RxJS → GraphReFly
import { interval } from 'rxjs';
const ticks = fromAny(interval(1000));
ticks.get(); // current tick value
```

## What RxJS Lacks

- **First-class state.** `BehaviorSubject` is a workaround, not a primitive. `.value` is read-only in the type system sense, `.next()` is the write path — an asymmetric API for a symmetric concept.
- **Diamond resolution.** `combineLatest` emits on every input change independently. There is no topological resolution — diamonds always produce intermediate glitchy emissions.
- **Graph inspection.** RxJS has no built-in way to inspect the operator graph at runtime. GraphReFly's `graph.describe()` returns a structured snapshot of all nodes, edges, and metadata.
- **Simple API.** RxJS's 200+ operators, multiple Subject variants, hot/cold semantics, and scheduler system create a steep learning curve. GraphReFly achieves common patterns with one primitive (`node`) with sugar constructors and a focused operator set.

## What RxJS Does Better

- **More operators.** RxJS has 200+ operators covering virtually every stream transformation pattern. GraphReFly's 70+ cover the most common cases but may lack niche operators.
- **Mature ecosystem.** RxJS has been battle-tested for years in Angular and beyond, with extensive documentation, community resources, and third-party integrations.
- **Scheduler control.** RxJS's scheduler abstraction gives fine-grained control over execution timing (async, animationFrame, queue, test schedulers). This is powerful for testing and animation.
- **Hot/cold semantics.** RxJS's distinction between hot and cold Observables, combined with operators like `share`, `shareReplay`, and `multicast`, provides precise control over subscription behavior and side effects.

## When to Choose GraphReFly

Choose GraphReFly when your application needs:

- **State + streams unified** — no awkward `BehaviorSubject` workarounds, just `state()` and `derived()` that also support streaming operators
- **Diamond-safe derived computations** — especially when multiple derived values share common upstream dependencies
- **Runtime inspectability** via `graph.describe()` for debugging, testing, or LLM-driven orchestration
- **Smaller bundle** — ~5 KB vs ~30 KB, with tree-shaking for operators you do not use
- **Simpler onboarding** — one primitive (`node`) with sugar constructors instead of 200+ operators and multiple Subject types

For pure event-stream processing (WebSocket message transforms, animation sequences, complex async orchestration) where state management is secondary, RxJS remains the more mature and feature-rich choice.
