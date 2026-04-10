---
title: "Pure Push: How GraphReFly Eliminated the Pull Phase"
description: "GraphReFly SPEC v0.2 removes pull entirely. State is ROM, compute is RAM, and a pre-set dirty mask unifies first-run gating with wave resolution — here's how the pure push model works."
date: 2026-04-09T10:00:00
authors:
  - david
tags:
  - architecture
  - protocol
  - correctness
  - spec-v0.2
---

# Pure Push: How GraphReFly Eliminated the Pull Phase

*Arc 6, Post 34 — GraphReFly SPEC v0.2: The Pure Push Model*

---

For three architecture generations, GraphReFly carried the same assumption: **push dirty, then pull values**. Phase 1 floods the graph with invalidation signals. Phase 2 computes on demand. The pull phase was the resolver — walk the dependency chain, compute in topological order, cache the result.

It worked. It was correct. And it had a cost we kept paying.

Pull means `get()` can trigger computation. Pull means derived nodes must know how to recursively resolve their deps. Pull means the system has two modes of operation — push for marking, pull for computing — and every invariant must hold in both modes simultaneously.

SPEC v0.2 asks a simple question: **what if there is no pull phase?**

## The Evolution: Four Architectures of Value Delivery

| Version | Phase 1 (invalidation) | Phase 2 (value delivery) |
|---------|----------------------|------------------------|
| v1 | Push DIRTY | **Pull** — `get()` triggers computation |
| v2 | Push DIRTY | **Push** — values flow through subscriptions, but `get()` can still trigger |
| v3–v4 | Push DIRTY | Push DATA, plus RESOLVED for settlement |
| **v0.2** | **Push DIRTY** | **Push DATA — no pull, ever** |

The key constraint in v0.2: **`get()` never triggers computation.** It returns the cached value if one exists, or `undefined` if not. That is all. A disconnected derived node returns `undefined`. A state node returns its last set value. No recursive walks. No lazy evaluation. No side effects.

This sounds limiting. It is liberating.

## ROM and RAM: Two Kinds of Cache

The pure push model requires a clear answer to: what happens to a node's cached value when all subscribers disconnect?

The answer depends on what kind of node it is:

### State nodes are ROM

State nodes (created with `state(value)`) have no computation function. Their value is set explicitly by the developer. When all subscribers disconnect, the value **persists**. When subscribers reconnect, they get the existing value via START + DATA. `get()` always returns the last set value, regardless of connection status.

Think of state as a register — write to it, read from it, and it holds its value through power cycles.

### Compute nodes are RAM

Derived, producer, and dynamic nodes have computation functions. Their values are **products of the reactive graph**. When all subscribers disconnect, the cached value and last-dep-values are **cleared**. When subscribers reconnect, the node recomputes from scratch.

Think of compute as volatile memory — the value exists only while the circuit is powered (subscribed). Disconnect and the slate is wiped.

```
State (ROM):     set(5) → disconnect → reconnect → get() returns 5
Derived (RAM):   compute → disconnect → reconnect → recompute from deps
```

### Why this split matters

ROM/RAM eliminates an entire class of stale-value bugs. Before v0.2, a disconnected derived node would return its last computed value via `get()` — but that value might be stale because upstream deps had changed while the node was disconnected. The developer had to reason about "is this value fresh?" with no tooling support.

Now the contract is simple: if a compute node is disconnected, its cache is empty. No stale values. No false freshness. Reconnection always produces a current result.

## The Pre-Set Dirty Mask: One Trick to Unify Everything

Here is the single most impactful change in v0.2. It is almost embarrassingly simple.

When a derived node connects to its upstream deps, set **every bit in the dirty mask to 1**:

```
_depDirtyMask = [1, 1, 1, ..., 1]  // one bit per dep
```

Each dep's DATA delivery clears its bit. The node's function runs only when **all bits are cleared** — meaning every dep has delivered at least one value.

This one mechanism replaces three separate systems:

### 1. First-run gating

Before v0.2, a derived node with deps `[A, B, C]` needed special logic to wait for all deps to deliver their first values before running `fn`. This was tracked with `_everValueMask` and `_firstRunPending`. Now it is automatic: the pre-set mask starts with all bits set, deps clear their bits as they deliver, fn runs when the mask is empty. First-run and subsequent-run use the same code path.

### 2. SENTINEL dep gating

A dep that has never produced a value (still holding the internal SENTINEL) should prevent its downstream from computing. Before v0.2, this required explicit SENTINEL checks in `_onDepSettled`. Now it is automatic: a SENTINEL dep never delivers DATA, so its bit never clears, and fn never runs with garbage values. The node stays in **pending** status until the SENTINEL dep produces a real value.

### 3. Diamond resolution

```
        A (state)
       / \
      B   C
       \ /
        D (derived)
```

When `A` changes, both `B` and `C` go dirty. Both compute and deliver DATA to `D`. The dirty mask ensures `D` waits for both:

- `A.set(5)` → DIRTY propagates → `D._depDirtyMask = [1, 1]`
- `B` delivers DATA → `D._depDirtyMask = [0, 1]` → wait
- `C` delivers DATA → `D._depDirtyMask = [0, 0]` → **run fn once**

No pending counts. No topological sort. The mask **is** the resolution.

## The Tier Reshuffle

START's introduction required reorganizing message priorities. The new tier table:

| Tier | Messages | Role |
|------|----------|------|
| 0 | START | Subscribe-time handshake |
| 1 | DIRTY, INVALIDATE | Invalidation wave |
| 2 | PAUSE, RESUME | Flow control |
| 3 | DATA, RESOLVED | Value delivery + settlement |
| 4 | COMPLETE, ERROR | Terminal signals |
| 5 | TEARDOWN | Cleanup |

The batch system drains tiers in order: all tier-0 messages before tier-1, all tier-1 before tier-2, and so on. This ensures START handshakes complete before any invalidation waves reference the new subscriber, and invalidation waves complete before value delivery begins.

The tier reshuffle touched every file that used `messageTier()` — bridge filters, auto-checkpoint gates, adapter flush logic, framework compatibility layers. The changes were mechanical but the consistency is load-bearing: every tier check in the codebase references the same table.

## NodeBase: Shared Machinery, Not Shared Complexity

The v0.2 refactor also extracted a shared `NodeBase` abstract class. Before this, `NodeImpl` and `DynamicNodeImpl` duplicated subscribe flow, sink management, lifecycle tracking, and meta node propagation — roughly 300 lines of identical logic.

`NodeBase` captures the shared machinery:
- Subscribe flow with START handshake
- Sink management (`_sinks`, `_downToSinks`, `_downInternal`)
- Lifecycle (activation, deactivation, status tracking)
- Meta node propagation
- `BitSet` with `setAll()` for dirty mask operations

`NodeImpl` and `DynamicNodeImpl` implement abstract hooks: `_onActivate()`, `_onDeactivate()`, `_createMetaNode()`, `up()`, `unsubscribe()`. The result is less code, fewer bug-duplication opportunities, and a single place to maintain the subscribe-time contract.

## What We Deleted

Good protocol changes delete more code than they add. Here is the ledger:

**Removed:**
- `_activating` flag
- `_emittedDataDuringActivate` flag
- `_connecting` flag
- `_everValueMask` bitmask
- `_firstRunPending` boolean
- `_onDepSettled` structural guard (`_upstreamUnsubs.length < _deps.length`)
- Subscribe-time `cachedBefore` snapshot logic
- Duplicated subscribe flow in `DynamicNodeImpl`

**Added:**
- START message type (1 symbol)
- `NodeBase` abstract class (shared, not new logic)
- Pre-set dirty mask initialization (1 line in `_connectUpstream`)
- ROM/RAM cache clearing (2 lines in `_onDeactivate`)

The net result: fewer branches, fewer states, fewer ways for the system to be in an inconsistent configuration. The implementation got shorter. The test suite got more focused — tests now verify protocol contracts ("START then DATA") instead of implementation details ("flag was set before callback returned").

## The Constraint That Makes It Work

The pure push model has one hard constraint: **`get()` never triggers computation.** This is not a limitation — it is the invariant that makes everything else possible.

If `get()` could trigger computation, then disconnected compute nodes would need to decide whether to lazily evaluate or return stale values. Operators would need to handle re-entrant computation during `get()`. The dirty mask could not be the sole arbiter of "should fn run?" because `get()` would be a second entry point.

By making `get()` a pure cache read, the system has **one** entry point for computation: message delivery. One entry point means one set of invariants. One set of invariants means fewer bugs.

## Further Reading

- [The START Protocol: Every Subscription Deserves a Handshake](./33-the-start-protocol) — the protocol message that enabled pure push
- [What Happened When AI Stress-Tested Our Reactive Protocol](./35-ai-stress-tested-our-protocol) — the Phase 5 experiment that exposed why we needed this redesign
- GraphReFly SPEC v0.2 §2.2 — `get()` contract, ROM/RAM semantics, pending status
- GraphReFly SPEC v0.2 §1.2 — tier table and batch drain ordering

## Frequently Asked Questions

### What does "pure push" mean in GraphReFly?

Pure push means all value delivery happens through message propagation — never through on-demand computation. When a source changes, values push through the graph via DATA messages. `get()` only reads the cache; it never triggers computation. This eliminates an entire class of bugs related to lazy evaluation, re-entrant computation, and stale-value reasoning.

### What is the pre-set dirty mask?

The pre-set dirty mask is a bitmask (one bit per dependency) that starts with all bits set to 1 when a node connects to its upstream deps. Each dep's DATA delivery clears its corresponding bit. The node's function runs only when all bits are cleared. This single mechanism handles first-run gating, SENTINEL dep blocking, and diamond resolution — three problems that previously required separate solutions.

### How does ROM/RAM differ from RxJS refCount behavior?

RxJS `shareReplay({refCount: true})` clears the replay buffer when refCount drops to zero, then resubscribes to the source on reconnect. GraphReFly's ROM/RAM is similar in spirit but more granular: state nodes (ROM) always preserve their value, while compute nodes (RAM) clear their cache. This split gives developers a clear mental model — state persists, computation is volatile — without needing to configure replay strategies per node.

### Does pure push work with lazy evaluation?

GraphReFly does not use lazy evaluation. All computation is eager — triggered by upstream DATA messages, not by downstream reads. This is a deliberate design choice: eager evaluation with diamond resolution (via the dirty mask) gives glitch-free consistency without the complexity of lazy evaluation, dependency tracking, or re-entrant `get()` calls.

---

*Next in Arc 6: [What Happened When AI Stress-Tested Our Reactive Protocol](./35-ai-stress-tested-our-protocol).*
