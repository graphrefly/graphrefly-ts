---
title: "Stores All the Way Down"
date: 2026-03-25
authors: [david]
tags: [architecture, design-philosophy, state]
---

# Stores All the Way Down: Adding State to Reactive Programming

*Chronicle 23 — Arc 7: From Library to Platform*

---

Streams are great at movement. Apps also need memory.

That tension drove one of our biggest platform decisions: every reactive node should expose state directly, not just events. In GraphReFly, every `node` IS a store natively:

- `get()` for current value
- `set()` for controlled writes
- subscribable for reactive composition

In the predecessor (callbag-recharge), the Store interface was a separate contract layered on top of callbag sources via `source()`. GraphReFly evolved this by making the store surface intrinsic to `node` itself — there is no separate "store wrapper" because the primitive already is one.

## Why plain streams were not enough

Pure stream APIs are elegant until product code asks practical questions:

- "What is the current value right now?"
- "Can I set an optimistic value before async work returns?"
- "Can UI, orchestration, and persistence all reference one object?"

Without a stateful surface, teams bolt on side stores and caches. You end up with two systems: one reactive graph and one imperative state layer.

## The node-as-store contract

GraphReFly's `node` unifies those worlds:

1. **Pull now** with `get()` when needed by UI or logic.
2. **Push updates** with `set()` in explicit mutation points.
3. **Compose reactively** — subscribe to any node, derive from any node, feed any node into `graph.describe()`.

This keeps reactive semantics intact while giving app code predictable state access. No separate `source()` call to bridge between store and stream worlds — the node is both.

## Platform effect

Once every node speaks store, higher layers become straightforward:

- adapters can load/save against a stable state shape
- compat wrappers can mirror familiar APIs (like Zustand-style stores via `@graphrefly/graphrefly/compat/zustand`)
- orchestration flows can coordinate around explicit status stores
- `graph.describe()` can snapshot the entire graph's state for inspection or persistence

You are no longer building "a stream library plus glue." You are building a coherent state platform.

## Trade-off we accepted

Yes, exposing `set()` invites misuse if teams mutate everything from everywhere.

The fix is architectural discipline, not hiding capability:

- keep mutation boundaries explicit
- use `derived()` wherever possible
- treat `set()` as a domain action, not random assignment
- use `graph.describe()` to audit mutation patterns

## Takeaway

Reactive programming becomes practical at scale when state is first-class, not an afterthought.

`get()`/`set()`/subscribe looks small. It is the decision that let GraphReFly move from library internals to platform architecture — and because it lives on the single `node` primitive, it is not an optional add-on but the foundation everything else builds on.
