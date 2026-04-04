---
title: "From Pull-Phase to Push-Phase Memoization"
description: "v1 derived.get() recomputed every time; equals helped only on read. v2 caches by default and lets equals suppress downstream work during the value wave — a real DIRTY barrier."
date: 2026-03-23T13:00:00
authors: [david]
tags: [performance, architecture]
---

# From Pull-Phase to Push-Phase Memoization

*Arc 3, Post 9 — Architecture v2: The Great Unification*

---

Memoization in reactive systems is never *just* "skip work." It is **where** you skip work **relative** to dirty propagation, subscriptions, and user-visible commits.

In v1, **`derived.get()` always recomputed.** There was no persistent cache for "last settled value" in the core story. You could opt into `equals` behaviors at pull time, but the dominant path was still: *read -> walk -> compute.*

v2 flipped the default: **derived stores cache.** The cache updates when phase 2 finishes and all dirty deps have reported. `get()` on a settled node is a **cheap read.** That alone saves real CPU when templates, logs, or debugging read the same derived repeatedly between ticks.

The bigger leap: **`equals` becomes a push-phase tool**, not only a pull-time shortcut.

## Pull-phase memoization: helpful, but downstream already woke up

Imagine a derived that maps a large structure to a small key — `user -> user.id`. Suppose the user object updates often but `id` rarely changes.

With **pull-phase** equality only, you might avoid returning a *new* reference to consumers that compare by identity on read. But anything already marked dirty from the **push** side has often **already scheduled** work: child deriveds incremented pending counts, effects queued, operators forwarded DIRTY.

You saved the *final* allocation at the last moment — you did not necessarily stop the **wave**.

## Push-phase memoization: equals as a barrier

After v2 recomputes in phase 2, if `equals(prev, next)` is true:

- **Keep the cached reference** — reference stability for downstream consumers.
- **Do not emit a meaningful change** to downstream sinks — or emit a deliberate no-change resolution so parents counting deps can settle without redoing heavy work.

That is "**equals suppresses downstream emission**" in the v2 doc's words: the irrelevant churn stops **during** the value propagation pass, not after the damage is scheduled.

It is the same *intent* as signal libraries that bump versions or compare at push time — we just express it in **callbag-shaped** terms: deps know whether they must wake children.

## get() during pending: the honest escape hatch

v2 acknowledges imperative code that calls `get()` **while** a node is between DIRTY and resolution. Blocking was considered and rejected — throwing pushes complexity onto every caller for a transient state.

Instead, a connected pending derived may **recompute on demand** via recursive reads through the chain (states are settled; other deriveds may recurse). The result is **not** treated as the authoritative cache update — phase 2 still owns cache coherence and sink emissions.

Tradeoff: rare duplicate work if someone pokes `get()` mid-tick. In practice reactive UI and subscriptions use **signals through the graph**, not mid-propagation pulls. The escape hatch exists so **ergonomics** does not regress v1's guarantee that you can always obtain a consistent snapshot.

## Comparison snapshot (why we did not clone Preact/Solid)

Archived v2 included a compact comparison — worth quoting the *shape* of the decision:

| Aspect | v1 | v2 target | Typical signals (lazy refresh) |
| --- | --- | --- | --- |
| Data transport | DIRTY via callbag, values via `get()` | DIRTY **and** values via callbag | notify + refresh/read path |
| Derived cache | No default cache | Cached on phase 2 | Cached, lazy recompute on read |
| Memoization | Pull-phase `equals` emphasis | Push-phase suppression | Push-phase version / equality checks |

We are not claiming v2 "beats" those libraries — they are excellent. Our constraint was **callbag-native transport** plus **glitch-free diamonds** without inventing a parallel data plane. Push-phase memoization falls out naturally once values ride the same wave as DIRTY.

## Further reading

- [Two-Phase Push: DIRTY First, Values Second](./08-two-phase-push) — pending counts and the value wave
- [Push Dirty, Pull Values](./04-push-dirty-pull-values) — where pull-time recompute was the default
- [Architecture & design](/architecture/) — primitives, output slots, and later control-channel refinements
- Historical spec: `src/archive/docs/architecture-v2.md` — full `get()` semantics, test inventory, extras glitch boundaries

---

*Chronicle continues in Arc 4 — [The Day We Read the Callbag Spec (Again)](./10-the-day-we-read-the-callbag-spec-again).*
