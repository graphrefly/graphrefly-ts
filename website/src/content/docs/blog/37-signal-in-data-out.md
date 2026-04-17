---
title: "Signal In, Data Out: The Protocol Discipline That Kills an Entire Class of Agent Bugs"
description: "Two invariants — fn sees data only, no cross-node inspection — eliminate the most common source of reactive composition bugs. Here's how they work and why they matter."
date: 2026-04-18T09:00:00
authors:
  - david
tags:
  - architecture
  - correctness
  - spec-v0.4
  - protocol
---

# Signal In, Data Out: The Protocol Discipline That Kills an Entire Class of Agent Bugs

*Arc 7, Post 37 — v0.4 Invariants P2 + P3*

---

There's a category of bug that's unique to reactive systems. Not logic errors. Not off-by-ones. A subtler failure mode: your computation runs at the wrong time, with partially stale inputs, and produces a value that's technically valid but semantically wrong.

It propagates silently. It doesn't throw. Your tests don't catch it because the final value eventually becomes correct — it just passed through a bad intermediate state first.

In GraphReFly v0.4, we've eliminated this entire category with two invariants. They sound simple. The implications are significant.

## The problem: nodes that know too much

In the old architecture, operators routinely needed to know things they shouldn't. A node computing a derived value would call `dep.status` to check whether the dep had settled yet. A node would call `dep.cache` to retrieve the dep's current value out-of-band, outside the message delivery path.

This seems harmless. The information is right there. Why not use it?

The problem is timing. `.cache` and `.status` are snapshots of a node's state at the moment you read them. But in a reactive system, state changes propagate through waves — and a wave isn't instantaneous. When node D reads `depA.cache` during a wave where depA is in the middle of updating, it gets the *previous* value.

The old architecture papered over this with the `D8 fallback`: if `fn` ran before all deps had delivered DATA, it would re-read dep values from their caches as a fallback. The fallback was almost always correct. Almost.

The cases where it wasn't were exactly the hard-to-reproduce, production-only, depends-on-subscription-ordering bugs that reactive systems are infamous for.

## P2: fn sees data, never protocol

The first invariant is a hard separation of concerns:

- `onMessage` is the **signal layer** — it sees full message tuples, handles START, DIRTY, RESOLVED, PAUSE, RESUME, COMPLETE, ERROR. It decides when to run `fn`.
- `fn` is the **data layer** — it receives only resolved DATA payloads from deps. It never sees message types. It never checks if a dep is settled. By the time `fn` is called, the framework guarantees that every dep has delivered DATA in this wave.

This eliminates the entire `depHasData` tracking pattern that operators previously needed. Before v0.4, a typical multi-dep operator looked like this:

```typescript
// Old pattern — fn checking what the framework should guarantee
node([source, secondary], (data, a, ctx) => {
  if (!ctx.dataFrom[0]) return; // Did source emit this wave?
  const val = data[0];
  const latest = ctx.latestData[1]; // Latest from secondary
  if (latest === undefined) return; // Has secondary ever emitted?
  a.emit(combine(val, latest));
});
```

In v0.4, the checks move into the framework. `fn` runs only when the framework's sentinel tracking confirms all required deps have data:

```typescript
// v0.4 — fn trusts the framework
node([source, secondary], (data, a) => {
  const batch0 = data[0];
  if (!batch0?.length) { a.down([[RESOLVED]]); return; }
  for (const val of batch0) {
    a.emit(combine(val, data[1]));
  }
});
```

The framework handles "has this dep ever emitted?" via the sentinel count. It handles "did this dep emit in the current wave?" via the dirty count. `fn` just computes.

## P3: no cross-node inspection

The second invariant is a hard rule: **inside the reactive layer, dep values arrive exclusively through DATA messages.** Never `dep.cache`. Never `dep.status`. Those APIs exist for external observers — user code, the graph's introspection layer, debugging tools. Not for nodes reasoning about their neighbors.

The rationale is about source of truth. The protocol is the source of truth. A message carries the value at the moment it was emitted. A cached value is a snapshot from some previous moment. When you bypass the protocol to read a dep's cache, you're reading potentially stale data and coupling your node's correctness to subscription ordering and activation timing.

This matters especially for `autoTrackNode` — our dynamic dependency tracking mechanism — which previously had to read `dep.cache` via a `get(dep)` API to access dep values inside the tracking function. In v0.4, tracked deps are treated the same as declared deps: their values arrive through DATA messages.

## What this prevents: the `forwardInner` dead code story

The most concrete example of what P3 eliminates was in `forwardInner` — the shared inner-subscription helper used by all `*Map` operators:

```typescript
// Old code — post-subscribe cache reads as a guard
const unsub = inner.subscribe(callback);
if (!emitted && (inner.status === "settled" || inner.status === "resolved")) {
  a.emit(inner.cache as R); // Cross-node cache read
}
if (inner.status === "completed" || inner.status === "errored") {
  finish(); // Cross-node status read
}
```

These post-subscribe reads were a guard for "inner was already settled before subscribe fired." The intent was correct — you want to handle a synchronously-settling inner. The implementation was wrong.

With the START handshake (P4), a node that subscribes to an already-settled inner receives `[[START], [DATA, cached]]` synchronously in the first callback invocation. By the time those post-subscribe reads ran, the callback had already set `emitted = true` and called `finish()`. The reads were unreachable dead code — a maintenance hazard that obscured the invariant and created a false sense of safety.

In v0.4, we deleted them. The START handshake is the single mechanism. Post-subscribe cache reads aren't needed, aren't allowed, and aren't present.

## The ops implication: fewer mystery incidents

These invariants sound like internal architecture choices. They are — but they have operational consequences.

The bugs they eliminate are the ones that are hardest to reproduce and debug in production: race conditions between subscription ordering, intermediate glitch values propagating downstream, operators silently producing wrong results when inputs arrive in unexpected sequences.

We found three of these bugs during the v0.4 work. All three had been present for months. All three required careful composition scenarios to trigger. None appeared in normal usage. All would have eventually caused production incidents for someone.

When `fn` can't see protocol state and nodes can't inspect each other's internals, the only things that determine a node's output are its declared inputs and the values that arrived through the protocol. The reactive system is predictable by construction, not by discipline.

## The broader pattern: protocol as contract

The deeper principle here is that a protocol is a contract. When you bypass it — even for performance, even for convenience — you're betting that your bypass won't interfere with the contract's guarantees. Sometimes you win that bet. Sometimes you get a production incident at 2am.

GraphReFly's approach is to make the contract enforceable at the architecture level: `fn` receives data, `onMessage` receives signals, the protocol is the only communication channel. No bypasses, no exceptions, no "except in this one case."

If you're building agent workflows that need to run reliably over hours or days, this predictability is the foundation everything else rests on.

Next: [Pre-1.0, We Deleted More Than We Shipped](/blog/38-deleted-more-than-shipped) — how the same discipline applied to the public API surface.
