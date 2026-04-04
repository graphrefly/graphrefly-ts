---
title: "One Primitive, Two Tiers, Zero Schedulers"
date: 2026-03-24T15:00:00
authors: [david]
tags: [architecture, design-philosophy, primitives]
---

# One Primitive, Two Tiers, Zero Schedulers

*Arc 4, Post 13 — Architecture v3: The Type 3 Breakthrough*

---

The core API is intentionally small. **One primitive** — `node` — covers how data enters the graph, transforms, and exits. Sugar constructors give you ergonomic entry points without adding conceptual surface area:

| Constructor | Role | Under the hood |
| --- | --- | --- |
| **`state()`** | Ergonomic source — `set` / `update`, TC39-friendly `equals` | `node` with source defaults |
| **`derived()`** | Computed store sugar — sync multi-dep transform | `node` with operator shape |
| **`producer()`** | Async boundary — `emit`, `signal`, lifecycle | `node` with source + lifecycle |
| **`effect()`** | Terminal sink — runs when deps resolve, no downstream store | `node` with sink shape |

In the predecessor (callbag-recharge), these were five separate primitives: `producer`, `state`, `operator`, `derived`, and `effect`. GraphReFly evolved this into a single `node` primitive with sugar constructors that configure it for each role. The mental model shifts from "pick the right primitive" to "configure one primitive for your use case."

**`dynamicNode()`** fits beside **`derived()`**: same operator lineage, but dependencies are discovered at runtime via tracking reads — still a transform, not a separate conceptual axis (source / transform / sink).

## Two tiers: where STATE stops

- **Tier 1** — synchronous transforms, static dependency lists, full DIRTY / RESOLVED / DATA protocol. Use **`derived()`** (or configure `node` directly). Diamond resolution and bitmask logic live here.
- **Tier 2** — timers, promises, inner subscriptions, dynamic upstream. Use **`producer()`** with **`autoDirty: true`** and imperative `subscribe()` inside the producer body. Tier-2 nodes start **fresh DIRTY+DATA cycles** per emission; they do not inherit upstream two-phase STATE the same way tier-1 nodes do.

The split is how we keep **RxJS-shaped** async operators without pretending they are the same animal as a pure `map`. Async boundaries are **producer-shaped**; sync graph logic stays **derived-shaped**.

## Zero schedulers

There is **no `enqueueEffect`**, no global tick, no `queueMicrotask` layer deciding order. When all dirty deps of an **effect** have resolved (DATA or RESOLVED), the effect function runs **inline**, synchronously, in the same call stack as the resolution — **deterministic ordering**, glitch-friendly batching, and no hidden microtask priority inversions.

For single-dep reactions that do not need DIRTY/RESOLVED bookkeeping, **subscribe** stays the lightweight DATA sink.

## One node base

Everything is `node`. `state()` is not a parallel implementation — it rides `node` with defaults users expect (`Object.is`, `set(same)` no-op semantics). `producer()` unifies "event stream," "async boundary," and "bare metal source" so we are not maintaining three competing source classes. `derived()` and `effect()` configure the same `node` for transform and sink roles respectively.

This single-primitive design means the protocol implementation exists in one place. Sugar constructors are thin — they set flags and defaults, not alternate code paths.

## Further reading

- [RESOLVED: The Signal That Skips Entire Subtrees](./12-resolved-signal) — how tier-1 nodes finish waves
- [The Inspector Pattern](./06-inspector-pattern) — observability without changing the primitive
- [No queueMicrotask](./30-no-queuemicrotask) — why we avoid scheduler indirection

---

*Chronicle continues with [Output Slot: How null->fn->Set Saves 90% Memory](./14-output-slot) — our first Arc 5 deep dive.*
