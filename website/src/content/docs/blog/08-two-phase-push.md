---
title: "Two-Phase Push: DIRTY First, Values Second"
description: "Phase 1 marks the graph; phase 2 delivers values through the same callbag sinks. Here's how pending counts, diamonds, and batching compose in GraphReFly — without a second data plane."
date: 2026-03-23
authors: [david]
tags: [architecture, correctness]
---

# Two-Phase Push: DIRTY First, Values Second

*Arc 3, Post 8 — Architecture v2: The Great Unification*

---

If you only remember one sentence from architecture v2, make it this: **every reactive tick has two waves — invalidate, then deliver — on the same channel.**

Phase 1 is the stampede of **DIRTY**. Phase 2 is the orderly parade of **values**. Derived nodes sit in the middle with a simple job: **count** how many upstream deps are still unresolved, then **fire once** when the count hits zero.

This post walks through that protocol the way we wished we had read it **before** implementing `pendingCount` in anger.

## Phase 1: DIRTY propagation

When `state.set(newVal)` runs:

1. Store the new value internally (do not emit the value yet).
2. Push **DIRTY** to all downstream sinks.
3. Let DIRTY run depth-first (or your engine's equivalent visit order). Each derived node increments **pending** and remembers **which deps** notified.

Effects and subscribers **enqueue** during this phase — same family of rule as v1: you do not run user callbacks while the graph is mid-stampede, or you invite glitches.

When the propagation **depth returns to zero**, phase 1 is done. Now the graph knows **who is stale** and **how many parents must report** before each node may recompute.

## Phase 2: Value propagation

After phase 1 completes:

1. **Sources** emit their new values on DATA: `sink(DATA, newValue)`.
2. **Derived** nodes receive values from upstream deps:

    - Buffer each input.
    - Decrement the pending count for that dep's resolution.
    - When pending hits **zero**, run `fn()` using fresh inputs plus **cached** values from deps that did not go dirty this cycle.
    - Cache the result, emit to own sinks.

**Effects** and **subscribers** see settled values on this wave — the same moment you'd expect after a v1 flush, but the values arrived **through** the subscriptions instead of solely through `get()`.

## Diamond resolution (the counting trick again)

Classic diamond:

```
        A (state)
       / \
      B   C
       \ /
        D (derived)
```

**Phase 1:** `A` pushes DIRTY to `B` and `C`. Each forwards DIRTY toward `D`. `D` ends up with **pending = 2** — one slot for the `B` branch, one for the `C` branch.

**Phase 2:** `A` emits to both children. `B` computes and emits to `D` → `D` sees **1 of 2** — waits. `C` computes and emits to `D` → **2 of 2** — `D` runs **once** with a consistent pair of inputs. No intermediate "half merge."

That is the same *logical* outcome v1 got from pull ordering; v2 gets it from **waiting on explicit dep resolution** instead of recursive reads.

## batch(): defer phase 2, not phase 1

Inside `batch(() => { ... })`:

- Each `set()` still runs **phase 1** — DIRTY propagates, values queue.
- **Phase 2** waits until the **outermost** batch completes.
- Then all changed states emit together, triggering one value wave.

Derived nodes naturally coalesce: multiple writes in a batch still look like "these deps were dirty; they all reported; compute once at the end." That is the kind of behavior users assume `batch()` promises — v2 makes it a consequence of the protocol, not a special-case hack in every primitive.

## Operators and extras (honest boundaries)

Simple passthrough operators participate exactly like single-dep derived nodes: forward DIRTY in phase 1, transform and emit in phase 2. That keeps **tap**, **take**, **skip**, **distinctUntilChanged**, and friends **glitch-free** in diamonds when they're wired as pure forwarders.

**Time-based** operators (`debounce`, `throttle`, etc.) live outside a single propagation window by design — timers start **new** cycles. **Complex mappers** (`switchMap`, `flat`, ...) track inner lifecycles; diamonds that mix them with shared parents can still glitch, same honesty as RxJS-style models. We document those edges rather than pretend one abstraction fixes async fan-in.

## Further reading

- [Data Should Flow Through the Graph, Not Around It](./07-data-should-flow-through-the-graph-not-around-it) — why we unified transport
- [From Pull-Phase to Push-Phase Memoization](./09-push-phase-memoization) — caching, `equals`, and skipping downstream work
- [Architecture & design](/architecture/) — how later type 3 control signals refined the story
- Historical spec: `src/archive/docs/architecture-v2.md` — emission ordering tests, migration checklist, extras inventory

---

*Next in Arc 3: [From Pull-Phase to Push-Phase Memoization](./09-push-phase-memoization).*
