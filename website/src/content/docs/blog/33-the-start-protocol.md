---
title: "The START Protocol: Every Subscription Deserves a Handshake"
description: "GraphReFly v0.2 introduces START — a tier-0 protocol message that eliminates flag soup, makes subscribe-time semantics deterministic, and gives every new subscriber a clean entry point."
date: 2026-04-09T09:00:00
authors:
  - david
tags:
  - architecture
  - protocol
  - correctness
  - spec-v0.2
---

# The START Protocol: Every Subscription Deserves a Handshake

*Arc 6, Post 33 — GraphReFly SPEC v0.2: The Pure Push Model*

---

What happens when a new subscriber connects to a reactive node? The answer should be simple. For most reactive systems, it is not.

In RxJS, `BehaviorSubject` replays its last value on subscribe. `Subject` does not. `shareReplay({refCount: true})` does — unless refCount dropped to zero. `ReplaySubject(1)` always does, but keeps values alive forever. Each has its own mental model, its own edge cases, its own set of flags tracking "did we already emit during subscribe?"

We had the same problem. Before SPEC v0.2, GraphReFly tracked subscribe-time behavior with three internal boolean flags: `_activating`, `_emittedDataDuringActivate`, and `_connecting`. They interacted in subtle ways. They were duplicated between `NodeImpl` and `DynamicNodeImpl`. And they still produced double-delivery bugs under diamond topologies.

So we replaced all three flags with one protocol message: **`[[START]]`**.

## What START Does

Every `subscribe()` call now emits a deterministic sequence to the new subscriber — and only the new subscriber:

**Node with no cached value (SENTINEL):**
```
[[START]]
```

**Node with a cached value:**
```
[[START], [DATA, cachedValue]]
```

That is the entire subscribe-time contract. No conditions. No flags. No "did we already push during activation?" bookkeeping. The subscriber always gets START first, optionally followed by the cached DATA.

START is **not forwarded** through intermediate nodes. Each node emits its own START to its own new sinks. This means a subscriber connecting to a derived node gets that node's START — not a cascade of STARTs from upstream deps.

## Why a Protocol Message, Not a Flag

The insight is that subscribe-time behavior is not a special case to be handled with flags — it is a **message** like any other. Once you accept that, the implementation collapses to a three-line sequence in `subscribe()`:

1. Emit `[[START]]` to the new sink.
2. If cached value exists, emit `[[DATA, cached]]` to the new sink.
3. Done.

Compare this to the flag-based approach we replaced:

```typescript
// Before: flag soup (simplified)
_activating = true;
_connectUpstream();
_activating = false;
if (!_emittedDataDuringActivate && _cached !== SENTINEL) {
  _downToSinks([[DATA, _cached]], newSinkOnly);
}
```

The flag version has three failure modes:
- **Double-delivery:** If `_connectUpstream` triggers computation that pushes DATA, and then the post-subscribe push also fires, the subscriber sees the value twice.
- **Missing delivery:** If the flag check is too aggressive, late subscribers get nothing.
- **Diamond glitch:** If multiple deps settle during `_connectUpstream`, the flag tracks a single boolean where the real state is multi-dimensional.

START eliminates the entire category. The subscribe flow is a deterministic state machine with two states: emit START, then maybe emit DATA. No branching. No flags.

## START as Tier 0

GraphReFly's message protocol organizes messages into tiers that control batch drain ordering:

| Tier | Messages | Purpose |
|------|----------|---------|
| **0** | **START** | **Subscribe-time handshake** |
| 1 | DIRTY, INVALIDATE | Invalidation wave |
| 2 | PAUSE, RESUME | Flow control |
| 3 | DATA, RESOLVED | Value delivery |
| 4 | COMPLETE, ERROR | Terminal signals |
| 5 | TEARDOWN | Cleanup |

START lives at tier 0 — the lowest priority tier, processed first during batch drain. This is intentional: the handshake must complete before any invalidation or data waves can reference the new subscriber. Operators that intercept messages (like `takeUntil` or `sample`) can use `onMessage` to consume START and make local decisions — such as clearing a dep's dirty bit if that dep is a notifier that should never gate computation.

## What START Unlocks

### Deterministic late-subscriber behavior

Every node, regardless of type — state, derived, producer, dynamic — follows the same subscribe-time contract. Late subscribers (second, third, hundredth) joining an already-active node get `[[START], [DATA, cached]]`. First subscribers triggering activation get START, then the activation produces DATA through the normal computation path. The subscriber does not need to know which case it is.

### Clean operator composition

Operators that need to distinguish "this is the initial value" from "this is a propagation update" can check for START. The `startWith` operator, for example, was reimplemented using `onMessage`: it emits its initial value when it sees START from its source, then forwards subsequent DATA normally. No special-casing for first-run vs. subsequent-run.

### The "pending" status

A node that has subscribed to its deps but has not yet received DATA from all of them is now in a well-defined state: **pending**. Before START, this state was implicit — you had to infer it from the combination of `_activating`, `_firstRunPending`, and `_everValueMask`. Now it is explicit: a node that has emitted START but not yet emitted DATA is pending. `describe()` surfaces this status directly.

### SENTINEL gating for free

Nodes depending on a SENTINEL dep (a dep that has never produced a value) naturally stay pending — their pre-set dirty mask never fully clears, so `fn` never runs. Before START, this required a separate `_everValueMask` to track "has this dep ever delivered?" Now the dirty mask handles it: on `_connectUpstream`, set every bit to 1. Each dep's DATA clears its bit. SENTINEL deps never clear their bit. The fn runs only when all bits are cleared.

This is the **pre-set dirty mask** — the companion innovation to START. Together, they unify first-run gating and subsequent-wave logic into one code path.

## The Broader Pattern: Messages Over Flags

START is part of a larger principle in GraphReFly's v0.2 redesign: **if something needs to be communicated, make it a message**. Flags are local, implicit, and invisible to the rest of the system. Messages are typed, observable, and composable.

When we added START, we were also able to remove `_activating`, `_emittedDataDuringActivate`, `_connecting`, `_everValueMask`, and `_firstRunPending` — five internal flags replaced by one protocol message and one bitmask. The node implementation got shorter, not longer.

That is the mark of a good protocol extension: it should **delete** more code than it adds.

## Further Reading

- [Pure Push: How GraphReFly Eliminated the Pull Phase](./34-pure-push) — ROM/RAM cache semantics and the pre-set dirty mask
- [What Happened When AI Stress-Tested Our Reactive Protocol](./35-ai-stress-tested-our-protocol) — how Phase 5 LLM validation exposed the bugs that led to START
- GraphReFly SPEC v0.2 §1.2 — START message definition and tier table
- GraphReFly SPEC v0.2 §2.2 — subscribe flow, ROM/RAM, pending status

## Frequently Asked Questions

### What is the START protocol message in GraphReFly?

START is a tier-0 protocol message emitted to every new subscriber during `subscribe()`. It serves as a deterministic handshake that tells the subscriber "you are now connected." If the node has a cached value, START is followed by `[[DATA, cached]]`. START replaced five internal boolean flags and eliminated an entire class of subscribe-time bugs.

### Does START affect performance?

No. START is a lightweight sentinel — it carries no data payload and is processed at tier 0 during batch drain. The overhead is one extra message per subscription, which is negligible compared to the computation cost of node functions. The implementation actually got faster because it eliminated branching logic from five flag checks.

### How does START differ from RxJS BehaviorSubject replay?

BehaviorSubject replays the last value on subscribe, but it is a specific Observable type with specific rules. START is a protocol-level message that applies uniformly to every node type in GraphReFly. It separates the "you are connected" signal from the "here is the value" signal, making it composable with operators that need to distinguish initial values from propagation updates.

### Can operators intercept START?

Yes. Operators with an `onMessage` handler can consume START and make local decisions. For example, `takeUntil` consumes START from its notifier dep to clear that dep's dirty bit, preventing the notifier from blocking the main computation. `startWith` uses START to know when to emit its initial value.

---

*Next in Arc 6: [Pure Push: How GraphReFly Eliminated the Pull Phase](./34-pure-push).*
