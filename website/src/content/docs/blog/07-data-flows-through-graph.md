---
title: "Data Should Flow Through the Graph, Not Around It"
date: 2026-03-23T09:00:00
authors: [david]
tags: [architecture, two-phase-push, design-philosophy]
---

# Data Should Flow Through the Graph, Not Around It

*Arc 3, Post 7 — Architecture Evolution: The Great Unification*

---

In the predecessor (callbag-recharge), callbag was already doing the hard work: **talkback**, explicit sinks, a graph you could reason about. In our first architecture pass, we still treated it like a **notification bus** while the real numbers moved through a side door.

**DIRTY** rode callbag's DATA channel. **Values** rode `store.get()`, which walked the dependency chain and pulled fresh results. It worked — diamonds resolved, effects batched — but the shape of the system said something awkward: *the graph is for invalidation; the truth is elsewhere.*

This post is about the v1 to v2 turning point in callbag-recharge's evolution: why that split stopped feeling like a feature and started feeling like debt, and how the principle of **two-phase push on a single transport** became one of GraphReFly's foundational invariants.

## The context: callbag without values

In the predecessor's v1, the mental model was clean on paper:

- **Push:** Flood downstream with a sentinel when something changed.
- **Pull:** Recompute when code asked for a value.

We told that story in [Push Dirty, Pull Values](./04-push-dirty-pull-values). The **pull chain** was the diamond resolver: `D.get()` forced `B` and `C` to settle before `D` combined them.

The catch: **callbag never carried ordinary state updates as the primary path.** Pipes and effects subscribed to sources, but if you wanted "what is this derived right now?", you did not subscribe — you **called get()**. Callbag wired the topology; `get()` was a parallel world.

That is not wrong as a hack. It is incomplete as a **protocol story**. Every other operator ecosystem eventually asks: *does data flow through the pipe, or around it?*

## The pitfall: elegance vs honesty

Dual-channel designs are everywhere — Preact Signals and Solid lean on **notify + lazy recompute** patterns that separate "you are stale" from "here is the new value." We could have mirrored that: keep DIRTY on the reactive spine, add proper **caching** on derived nodes, and let `get()` trigger refresh like they do.

We seriously considered it. Lazy refresh is battle-tested, easy to explain, and familiar to anyone coming from signals.

We still moved to **two-phase push** instead:

1. **Phase 1 -- DIRTY:** Same as v1. Cheap fan-out; nodes count which upstream deps are pending.
2. **Phase 2 -- Values:** Sources emit real values through the **same** message path. Derived nodes buffer until every dirty dep has delivered, then compute **once**, cache, and emit downstream.

Why? Because it keeps a single rule: **what the graph subscribes to is what the graph delivers.** Batch coalescing, operator fusion, and test assertions over emission order all stay on one mechanism. `get()` becomes a read of cached state, not the hidden highway for every value.

## The insight: unification is not "more magic"

Two-phase push sounds more complex than "push dirty, pull values." In some ways it is — you now have **pending counts** and a second wave after depth returns to zero.

But **unification removed a whole class of rationalizations:** you no longer defend why the protocol is used "for wiring only." The message path carries both the invalidation story and the value story. Operators that forward DIRTY and forward transformed values are participating in the **same** contract the core uses, not bolting a mini-scheduler on top.

That matters when you add **batch()**, **equals**, and operators like **combine**: the diamond case stops being "pull ordering luck" and becomes "**wait until all dirty deps have reported**, then compute."

## How GraphReFly evolved this further

In the predecessor, this unification happened on callbag's function signature — `sink(1, value)` for data, `sink(3, DIRTY)` for control. Two-phase push was an extension of the callbag protocol.

GraphReFly took the principle and made it native. Message tuples `[[Type, Data?], ...]` are designed for multi-phase updates from the ground up:

```ts
// A single batch of messages flowing through the graph
[[DIRTY]]                  // Phase 1: something is about to change
[[DATA, 42]]               // Phase 2: here's the new value

// Or, if the value didn't actually change:
[[DIRTY]]                  // Phase 1: something is about to change
[[RESOLVED]]               // Phase 2: never mind, same value
```

The graph container makes this even more powerful. In callbag-recharge, you had to manually wire sources and sinks. In GraphReFly, the `Graph` knows the full topology and enforces batch semantics — DIRTY propagates immediately even inside a batch, while DATA and RESOLVED defer until the batch exits. The protocol invariant that data flows *through* the graph is not just a design principle; it's enforced by the container.

```ts
import { state, derived, Graph, batch } from '@graphrefly/graphrefly';

const g = new Graph();
const a = g.add(state(1));
const b = g.add(state(2));
const sum = g.add(derived([a, b], () => a.get() + b.get()));

// Inside a batch, DIRTY propagates immediately.
// DATA defers until batch exits. Sum computes once.
batch(() => {
  a.set(10);
  b.set(20);
});
// sum.get() === 30 — computed once, not twice
```

## What we kept from v1

None of this threw away v1's wins:

- **Explicit dependencies** — still arrays and explicit declarations, not auto-tracking magic (though GraphReFly also offers `dynamicNode` for runtime dep tracking when needed).
- **Diamond safety as a graph property** — still counting and ordering, not framework batching prayers.
- **Depth tracking and flush points** — phase 2 still waits until phase 1 quiesces.

We changed the **carrier**, not the **values** (pun intended): one spine, two beats per tick.

## The design principle

The lesson that carried from callbag-recharge into GraphReFly is simple: **if you have a reactive graph, data should flow through it.** Not around it via imperative pulls. Not beside it via event emitters. Through it, as messages, with the full protocol guaranteeing ordering and consistency.

Every architecture decision in GraphReFly traces back to this principle. The message tuple format, the batch semantics, the Graph container, `graph.describe()` — they all exist because data flows through the graph, and the graph knows it.

## Further reading

- [Push Dirty, Pull Values: Our First Diamond Solution](./04-push-dirty-pull-values) — the dual-channel baseline this post reacts to
- [Two-Phase Push: DIRTY First, Values Second](./08-two-phase-push) — the protocol in detail
- [Architecture](/architecture/) — today's canonical design

---

*Next in Arc 3: [Two-Phase Push: DIRTY First, Values Second](./08-two-phase-push).*
