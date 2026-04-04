---
title: "Protocol-First Thinking"
date: 2026-03-21
authors: [david]
tags: [architecture, design-philosophy, protocol]
---

# Protocol-First Thinking

*Arc 1, Post 2 — Origins: From Callbag to GraphReFly*

---

Most reactive libraries start with an API. You get `Observable`, `Signal`, `Atom`, `Store` — a set of classes or functions that encode a specific model of reactivity. The protocol is an implementation detail, hidden behind the public surface.

GraphReFly starts with a protocol. The API is whatever you build on top.

This sounds like an academic distinction. It's not. It's the reason GraphReFly can unify state management, stream processing, and workflow orchestration in a single library — while Signals, RxJS, and Zustand each occupy their own silo.

We learned this principle the hard way, building the predecessor (callbag-recharge). The callbag protocol taught us that if you get the message format right, everything else follows. GraphReFly's message tuples are the evolution of that insight.

## The message protocol

GraphReFly's protocol uses typed message tuples, delivered as arrays:

```ts
Messages = [[Type, Data?], ...]
```

| Type | Data | Purpose |
|------|------|---------|
| DATA | value | Value delivery |
| DIRTY | -- | Phase 1: value about to change |
| RESOLVED | -- | Phase 2 alt: was dirty, value unchanged |
| INVALIDATE | -- | Clear cached state |
| PAUSE | lockId? | Suspend activity |
| RESUME | lockId? | Resume after pause |
| TEARDOWN | -- | Permanent cleanup, release resources |
| COMPLETE | -- | Clean termination |
| ERROR | error | Error termination |

The message type set is open. Nodes forward types they don't recognize — forward compatibility as a protocol invariant, not an afterthought.

In the predecessor, we started with callbag's three types (START, DATA, END) and extended with a fourth (STATE) for control signals. That extension mechanism worked, but it was bolted onto a protocol not designed for it. GraphReFly was designed from the start with an open vocabulary — every message type is a first-class citizen, and the forwarding rule is the foundation, not an exception.

## How it differs from the callbag handshake

In callbag, every interaction starts with a START handshake — the source and sink exchange function references:

```ts
// Callbag: bidirectional handshake
source(0, sink);         // sink connects
sink(0, talkback);       // source sends talkback
sink(1, value);          // data flows
talkback(2);             // sink unsubscribes
```

This bidirectional setup enabled cancellation, pull semantics, and backpressure through a single function type. Elegant — but it meant topology was implicit, buried in closure references. You couldn't inspect the graph without walking memory.

GraphReFly replaces the handshake with explicit dependency declarations and a `Graph` container:

```ts
import { state, derived, effect, Graph } from '@graphrefly/graphrefly';

const g = new Graph();

const count = g.add(state(0));
const doubled = g.add(derived([count], () => count.get() * 2));
const logger = g.add(effect([doubled], () => {
  console.log('doubled:', doubled.get());
}));

// Topology is inspectable
g.describe();
// => { nodes: [...], edges: [...], metadata: {...} }
```

Same protocol-level composability. But the graph is a data structure you can query, snapshot, and reason about — not a web of closures you have to reverse-engineer.

## Why DATA must carry only real values

In the predecessor's v1, we made a mistake that many reactive libraries make: we sent control signals on the data channel.

```ts
// v1 mistake: DIRTY was a sentinel on the data channel
sink(1, DIRTY);  // "something changed upstream"
sink(1, value);  // "here's the new value"
```

This worked, but it broke a fundamental expectation. If you write a `map()` operator, it should transform every value it receives:

```ts
const doubled = map(x => x * 2)(source);
```

But what happens when `DIRTY` arrives as data? The map function receives `DIRTY` as `x`, tries to compute `DIRTY * 2`, and produces `NaN`. Every operator needs special-case handling for sentinel values. Every new signal you add means auditing every operator in the library.

The fix was obvious in retrospect, and it became a core GraphReFly invariant: **DATA carries only real values. Control messages are separate message types.** Operators that don't understand a message type forward it unchanged — future-proofing for free.

```ts
// GraphReFly: clean separation via message tuples
[[DIRTY]]                  // control: "value is about to change"
[[DATA, newValue]]         // data: "here's the new value"
[[RESOLVED]]               // control: "I was dirty, but value didn't change"
```

## Two-phase push: the diamond killer

The diamond problem is reactive programming's classic correctness bug:

```
     A
    / \
   B   C
    \ /
     D
```

When A changes, both B and C recompute. D depends on both. If D sees B's new value but C's old value, it computes with inconsistent state — a **glitch**.

Signals solve this with topological sorting or lazy evaluation. RxJS punts on it entirely (use `combineLatest` and accept the intermediate emission). GraphReFly solves it with two-phase push at the protocol level.

**Phase 1 -- DIRTY propagation:**
When `A.set(5)` is called, `[[DIRTY]]` propagates through the entire downstream graph instantly and synchronously. No values are computed. Every node just learns "something upstream changed."

```
A.set(5)
  -> B receives DIRTY (marks dirty bit 0)
  -> C receives DIRTY (marks dirty bit 0)
  -> D receives DIRTY from B (marks dirty bit 0)
  -> D receives DIRTY from C (marks dirty bit 1)
  D knows: 2 deps are dirty, wait for both
```

**Phase 2 -- Value propagation:**
After DIRTY propagation completes, actual values flow. Each node waits until all its dirty deps have delivered before computing:

```
A emits [[DATA, 5]]
  -> B computes: A.get() * 2 = 10, emits [[DATA, 10]]
  -> C computes: A.get() + 1 = 6, emits [[DATA, 6]]
  -> D has 1 dep resolved (B). Dirty bitmask: still waiting on C.
  -> D receives C's value. Bitmask clear. Now computes: B.get() + C.get() = 16
  -> D sees consistent state. No glitch.
```

D never computes with partial information. The bitmask (one bit per dependency) tracks exactly which deps have resolved. When the bitmask reaches zero, all deps are fresh. This works for any DAG topology — not just diamonds, but arbitrary fan-in patterns.

## RESOLVED: the signal that skips subtrees

Imagine A changes, but B's `equals` guard determines the output hasn't actually changed (e.g., B clamps values to a range, and A moved within the same range). In most reactive systems, B still notifies its children, who recompute and discover nothing changed.

With GraphReFly's message protocol, B sends `[[RESOLVED]]` instead of `[[DATA, v]]`:

```ts
// B's computation
const newValue = clamp(A.get(), 0, 100);
if (equals(oldValue, newValue)) {
  // Value didn't change -- tell downstream to stand down
  emit([[RESOLVED]]);
} else {
  emit([[DATA, newValue]]);
}
```

Downstream nodes receiving RESOLVED decrement their dirty bitmask *without recomputing*. If all of D's deps sent RESOLVED, D itself emits RESOLVED without ever calling its function. The skip cascades through the entire subtree.

This is push-phase memoization. It's not an optimization bolted on after the fact — it's a natural consequence of having control messages in the protocol. No other mainstream reactive system has this.

## Protocol composability vs API composability

Here's the philosophical difference that shapes everything:

**API composability** (Zustand, Jotai, Signals): You compose by calling functions that return objects with known shapes. `createStore()` returns a store. `computed()` returns a computed signal. The composition boundary is the function signature.

**Protocol composability** (GraphReFly): You compose by connecting nodes that speak the message protocol. Any node that understands `[[Type, Data?], ...]` can plug into any other. The composition boundary is the protocol — not the API surface.

This is why GraphReFly can offer:
- **Stream operators** (map, filter, switchMap, debounce...) that work on state nodes
- **Reactive data structures** (reactiveMap, reactiveLog, reactiveIndex) that participate in the graph
- **Workflow orchestration** (pipeline, task, gate, branch) built on the same primitives
- **Domain patterns** (AI, CQRS, messaging, memory) composed from the same nodes

Every new primitive we add automatically works with every existing operator. Not because we designed it that way for each combination — but because they all speak the same protocol.

## The node interface: protocol hidden, power accessible

The message protocol is the engine. Users rarely see it.

The public API is `node` — with sugar constructors for common patterns:

```ts
import { state, derived, effect } from '@graphrefly/graphrefly';

const count = state(0);
const doubled = derived([count], () => count.get() * 2);

effect([doubled], () => {
  console.log('doubled:', doubled.get());
});

count.set(5); // logs: "doubled: 10"
```

Three concepts. That's the entire user-facing surface for state management. Everything else — the DIRTY/RESOLVED protocol, the bitmask tracking, the output slot optimization — is internal machinery that makes `get()` and `set()` behave correctly.

But when you need the protocol, it's right there:

```ts
import { pipe, map, filter, throttle, subscribe } from '@graphrefly/graphrefly/extra';

// Same node, now treated as a stream
pipe(
  count,
  filter(n => n > 0),
  map(n => n * 2),
  throttle(100),
  subscribe(v => console.log(v))
);
```

Same `count` node. Same underlying protocol. GraphReFly doesn't care whether you're treating it as "state" or "stream" — it just pushes messages through the graph.

## What the protocol gives us for free

Because GraphReFly is protocol-first, several things fall out naturally:

**graph.describe()**: Every node speaks the same protocol, so the Graph container can describe any node — state, derived, operator, effect, data structure, orchestration task. One tool sees everything.

**Cross-boundary composition**: A `reactiveMap` (data structure) can be a dependency of a `derived` (state) which feeds into a `pipeline` (orchestration). No adapter layers needed.

**Forward compatibility**: Unknown message types are forwarded, not swallowed. PAUSE, RESUME, TEARDOWN, and future control verbs travel without breaking existing operators.

**Zero-framework coupling**: The protocol doesn't reference React, Vue, Solid, or any framework. Compat layers are thin wrappers that bridge the node interface to framework-specific subscriptions.

---

The protocol is the product. Everything else is convenience.

---

*Next: [Signals Are Not Enough](./03-signals-are-not-enough) -- where TC39 Signals excel, where they fall short, and why the reactive programming world needs more than fine-grained UI state.*
