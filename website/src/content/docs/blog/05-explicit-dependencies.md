---
title: "Why Explicit Dependencies Beat Magic Tracking"
description: "Jotai and Signals auto-discover what you read. GraphReFly wires deps up front. That looks like boilerplate — until you debug a production graph."
date: 2026-03-22T11:00:00
authors: [david]
tags: [design-philosophy, correctness]
---

# Why Explicit Dependencies Beat Magic Tracking

*Arc 2, Post 5 — Architecture v1: The Naive First Attempt*

---

Every reactive library makes a fork in the road:

- **Implicit tracking:** While your computed function runs, the runtime records which signals or atoms you touched. Those become dependencies automatically.
- **Explicit dependencies:** You pass a list — `derived([a, b, c], fn)` — and the runtime subscribes to exactly that set.

Implicit tracking feels like magic. Explicit deps feel like ceremony. We chose ceremony.

This post explains why — and what we gained when we refactored the core around **pure callbag wiring** and **static dep arrays**.

## The context: auto-tracking is seductive

Frameworks that track reads for you ship a beautiful demo:

```ts
// Implicit style (illustrative)
const sum = computed(() => a.get() + b.get());
// "It just knows" a and b are deps.
```

You write less. You refactor fearlessly. Until the day a conditional read means **sometimes** you depend on `c` and sometimes you do not — and production traffic takes a path your mental model did not include.

Then you reach for docs on "tracking scopes," "stable references," or "atom families."

## Explicit deps: what we actually do

In GraphReFly, derived nodes are declared with **both** wiring and pulling:

```ts
const sum = derived([a, b], () => a.get() + b.get());
```

- The **deps array** answers: "What am I subscribed to?" — fixed at construction, reconnected only when the node's lifecycle says so.
- The **function body** answers: "What values do I read when I compute?" — still plain `.get()` calls, no hidden global context.

That split is deliberate. Subscriptions are **graph structure**. Reads are **computation**. Mixing them into one implicit mechanism saves keystrokes but merges two different concerns.

## Why we rejected "just track like Jotai"

The trade-off shows up clearly when you compare APIs side by side — see [GraphReFly vs Jotai](/comparisons/jotai) for the full picture.

**Implicit tracking** needs a runtime mechanism: a stack or zone of "who is computing right now," hooks in `get()`, dependency diffing when the set changes, and rules for async boundaries. It is powerful — Jotai proves you can ship a minimal API on top — but when something goes wrong, you debug **the tracking implementation**, not just your business logic.

**Explicit deps** push the graph into the source code:

- Code review can see the dependency surface.
- Conditional **subscriptions** are visible — if deps need to change, that is a different primitive (`dynamicNode` in the modern core), not an accidental read inside a branch.
- `.get()` stays a **pure read**: no side effects, no registration, no allocation on the hot path for tracking.

The archived v1 architecture claimed an order-of-magnitude style win for reads without a tracking context ("~10x faster" in that doc's wording). Exact factors depend on workload; the **invariant** we cared about was simpler: **reading a value should not be a tracing operation.**

## Callbag purity

When we moved to **explicit callbag wiring**, effects and derived nodes stopped trying to "discover" deps dynamically during every run. Instead, they **subscribe once** to the declared stores and react to protocol messages.

That aligned the implementation with the mental model: callbag is about **known sources** and **known sinks**. The graph you build is the graph you run.

## The pitfall: explicit is more typing

Fair criticism: `derived([a, b, c, d, e], ...)` is longer than letting the runtime infer five deps.

Our answer is not that boilerplate is good for its own sake. It is that **the graph is part of your program's contract**. When the contract is visible:

- Static analysis and grep work.
- Onboarding is faster — new contributors see edges without digging through runtime internals.
- Test doubles are trivial: pass `[mockA, mockB]`.

## The insight

Magic tracking optimizes for **lines of code in the happy path**.

Explicit deps optimize for **clarity at scale** — when the graph is large, conditional, long-lived, or touched by people who did not write the first version.

We still use plain `.get()` inside computations. We did not throw away pull semantics. We only refused to pretend that **subscription structure** can always be inferred safely from **arbitrary user code**.

## Further reading

- [Push Dirty, Pull Values: Our First Diamond Solution](./04-push-dirty-pull-values) — how pull chains interacted with explicit wiring in v1
- [Signals Are Not Enough](./03-signals-are-not-enough) — where fine-grained UI signals stop and streaming begins
- [GraphReFly vs Jotai](/comparisons/jotai) — implicit atoms vs explicit `derived([...], fn)` deps

---

*Next in Arc 2: [The Inspector Pattern: Observability as a First-Class Citizen](./06-inspector-pattern).*
