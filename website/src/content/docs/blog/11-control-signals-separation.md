---
title: "Why Control Signals Don't Belong in the Data Stream"
date: 2026-03-24T11:00:00
authors: [david]
tags: [architecture, protocol, invariants]
---

# Why Control Signals Don't Belong in the Data Stream

*Arc 4, Post 11 — Design Invariants*

---

Reactive libraries need two different conversations at once: **"something may change"** (control) and **"here is the next value"** (data). If both use the same envelope, every operator becomes a classifier — *is this payload or prelude?* — and the simplest `map` is wrong twice.

GraphReFly's rule is blunt:

1. **DATA carries only real values.** No sentinels, no `undefined` as "I am dirty," no parallel vocabulary hiding inside the value stream.
2. **Control messages (DIRTY, RESOLVED, PAUSE, RESUME, INVALIDATE) are separate message types** that propagate downstream unless a node has a deliberate, documented reason to absorb them.
3. **DIRTY before DATA, always** — phase one establishes *pending*; phase two delivers DATA or RESOLVED.

This is not purism. It is **receiver ergonomics**. A sink that only implements DATA + COMPLETE can still attach to a node; a wrapper that uses `subscribe()` and only observes values is not forced to understand graph coordination — yet fully-participating nodes still handle diamond resolution because they see the full protocol.

We learned this the hard way. In the predecessor (callbag-recharge), our v1 and v2 sent DIRTY as a sentinel on the DATA channel. Every operator had to ask "is this real data or a control signal?" before doing anything. The v3 breakthrough — moving control to Type 3 STATE — eliminated that entire class of bugs. GraphReFly bakes this separation into the protocol from day one.

## How GraphReFly separates control from data

Instead of callbag-recharge's two channels (Type 1 DATA and Type 3 STATE), GraphReFly gives each message type its own identity in the tuple format:

```ts
// Control messages — their own types
[[DIRTY]]                  // "value is about to change"
[[RESOLVED]]               // "was dirty, value unchanged"
[[PAUSE, lockId]]          // "suspend activity"
[[RESUME, lockId]]         // "resume after pause"

// Data messages — their own types
[[DATA, 42]]               // "here is the next value"
[[COMPLETE]]               // "clean termination"
[[ERROR, err]]             // "error termination"
```

The message tier system classifies these for batch ordering:

- **Tier 0** (DIRTY): Propagates immediately, even inside batches. Establishes the "pending" wave across the graph before any values move.
- **Tier 1** (PAUSE, RESUME, INVALIDATE): Lifecycle management. Scheduling and resource control.
- **Tier 2+** (DATA, RESOLVED, COMPLETE, ERROR, TEARDOWN): Deferred inside batches. The "resolution" wave that follows DIRTY.

This tier system generalizes the predecessor's two-phase push into a multi-tier ordering. The invariant that DIRTY propagates before DATA is now a special case of: lower-tier messages always propagate before higher-tier messages within a batch.

## Extensibility without version churn

Unknown message types forward by default. That is how GraphReFly avoids a "flag day" when new control verbs are added: intermediates pass what they do not understand, and only nodes with explicit handling change behavior.

In the predecessor, this worked because Type 3 STATE signals forwarded through operators that didn't recognize specific payloads. GraphReFly takes this further — since every message type is a separate tuple type, forwarding is the natural default. There's no "data channel" to accidentally catch control messages on.

If control lived on DATA, every `map`/`filter`/`scan` would need a default branch for "not actually data," or the ecosystem would fracture into wrapped value types.

## Suppression is not silence

When a transform decides **not** to emit a new value (filter rejects, `distinctUntilChanged` sees equality), it does not "emit nothing." Silence after a forwarded DIRTY leaves downstream bitmasks stuck. **RESOLVED** is the phase-two message that means: *the pending wave is over; nothing new on the wire.*

So control is not only "before values" — **RESOLVED is part of the same vocabulary** as DATA in terms of phase-two resolution, but it is a control message, not masquerading as a value.

```ts
// Filter receives DIRTY, then DATA that doesn't pass the predicate:
// It forwards DIRTY (tier 0, propagates immediately)
// Then sends RESOLVED instead of DATA (tier 2, deferred in batch)
// Downstream decrements its dirty bitmask without recomputing
```

This is how GraphReFly achieves push-phase memoization: entire subtrees skip recomputation when an upstream node's value didn't actually change, because RESOLVED cascades through the dirty bitmask system without triggering any compute functions.

## Tier boundaries stay honest

Nodes that bridge async boundaries (timers, fetch, inner subscriptions) do not see upstream DIRTY/RESOLVED the same way synchronous derived nodes do — they start fresh cycles via producer semantics. **Separating DATA from control messages** keeps that boundary visible in the protocol: synchronous nodes speak full two-phase protocol; async sources bridge at the edges without pretending async is the same shape as sync transforms.

The message tier classification makes this explicit. A `fromTimer` source emits `[[DATA, tick]]` — tier 2. It never emits DIRTY because it's the origin of its own values, not a transform of upstream state. A `derived` node, by contrast, receives `[[DIRTY]]` from its deps and participates in the full two-phase cycle. The protocol shape tells you which kind of node you're looking at.

## The invariant

DATA is data. Control is control. Mix them and every operator pays the tax. Keep them separate and the protocol does the coordination work — operators just transform values.

This invariant, born from a painful lesson in callbag-recharge's v1, is now one of GraphReFly's non-negotiable design rules. It enables two-phase push, push-phase memoization, batch semantics, and forward compatibility — all from a single separation.

## Further reading

- [The Day We Read the Spec (Again)](./10-reading-the-spec-again) — how the control/data split was discovered
- [RESOLVED and subtree skipping](./12-resolved-signal) — what RESOLVED does to downstream work
- [Architecture](/architecture/) — protocol invariants

---

*Next: [RESOLVED and subtree skipping](./12-resolved-signal).*
