---
title: "Pre-1.0, We Deleted More Than We Shipped"
description: "A pre-1.0 library can do something post-1.0 libraries can't: delete APIs without leaving anyone behind. Here's what we cut from GraphReFly's graph module, why each cut made the system more trustworthy, and what it signals about how we approach stability."
date: 2026-04-19T09:00:00
authors:
  - david
tags:
  - architecture
  - design-philosophy
  - spec-v0.4
---

# Pre-1.0, We Deleted More Than We Shipped

*Arc 7, Post 38 — The Simplification Budget*

---

There's an asymmetry in software library development that most teams don't talk about openly: pre-1.0 is your only chance to delete things.

Post-1.0, every API you shipped becomes a commitment. Someone is using it. Someone's CI pipeline depends on it. Someone wrote a blog post about it. Deleting it means deprecation warnings, migration guides, version negotiation, and the steady erosion of trust that comes with breaking changes.

Pre-1.0, the calculus is different. An API that shouldn't exist can simply disappear. No one has committed to it. The only cost is intellectual honesty about what you got wrong.

We spent v0.4 exercising this budget aggressively. Here's what we deleted and why.

## The edge registry: the API that lied

The biggest deletion was the edge registry: `connect(from, to)`, `disconnect(from, to)`, and `Graph._edges`.

The premise of this API was that you'd wire nodes after constructing them, and the graph would track the connections. Reasonable idea. The problem: when we grepped every `connect()` call site across the entire codebase, we found that **not a single one was doing anything the construction-time dependency declarations hadn't already done.** Every call was redundant.

Worse, `disconnect()` actively created a lie. It removed the edge from the registry without removing the underlying dependency. The graph's introspection layer would report that two nodes weren't connected while they were still reactively linked. The registry and the runtime state had diverged.

We deleted the registry and replaced it with `edges()`: a function that derives the edge list by walking the live `_deps` graph on demand. No registration. No divergence. The introspection reflects reality because it reads reality.

There's a secondary benefit: `autoTrackNode`, which discovers its dependencies at runtime as the function runs, was previously invisible to the edge registry. It registered no edges because it had no edges at construction time. The derived `edges()` function sees `autoTrackNode`'s deps correctly because it reads the live state — not a snapshot taken at construction.

## The parallel dispatch methods: API surface that confused more than it helped

`toMermaid()`, `toD2()`, and `dumpGraph()` are gone. Each had a different call signature. Each produced a different format. Each was a separate method to discover, document, and maintain.

They're now `describe({format: "mermaid" | "d2" | "pretty" | "json"})`. One entry point. The format is a parameter, not a method name. The implementation is shared, which means diagram output and structured output are always consistent with each other.

This is a small change in capability (none lost) and a large change in cognitive overhead (one API to learn instead of four).

## The static factory registry: a test isolation hazard

`Graph.registerFactory(pattern, factory)` stored factories in process-global static state. The intent was to allow `fromSnapshot()` to reconstruct custom node types when hydrating a persisted graph.

The hazard: static state that persists across tests. One test registers a factory. The next test doesn't — but the factory is still there. The test suite works when run sequentially and fails non-deterministically when run in parallel or in different orders.

We deleted the static registry entirely. `fromSnapshot(data, {factories})` accepts factories as a per-call parameter. The scope is exactly right: the factories live as long as the call, not as long as the process.

## `toObject` and `toJSONString`: aliases that created confusion

`snapshot()` is the primary API for serializing a graph. `toObject()` was an alias for it. `toJSONString()` was `JSON.stringify(snapshot())` with stable key ordering.

Having three names for closely related things meant three places to document, three options for readers to choose between, and uncertainty about which was canonical.

Now: `snapshot()` returns an object. `toJSON()` is the ECMAScript hook that makes `JSON.stringify(graph)` work. If you want stable text for git diffing, `JSON.stringify(graph)` suffices. The API surface is smaller and the semantics are unambiguous.

## `queueMicrotask` in `firstValueFrom` and `firstWhere`

This one isn't a user-facing API deletion, but it's worth documenting because it represents the same principle at the implementation level.

`firstValueFrom` and `firstWhere` both used `queueMicrotask(() => unsub())` to defer unsubscription. The reason was a chicken-and-egg: if the source pushed synchronously (as `state(42)` does), the subscription callback would fire before `unsub` was assigned, so you couldn't call it immediately.

The workaround violated a core design invariant (no bare `queueMicrotask` in the reactive layer) and introduced a microtask boundary that could interleave with other operations in surprising ways.

The fix is synchronous:

```typescript
let shouldUnsub = false;
let unsub: (() => void) | undefined;

unsub = source.subscribe((msgs) => {
  // ... handle DATA/ERROR/COMPLETE
  if (unsub) { unsub(); unsub = undefined; }
  else shouldUnsub = true; // unsub not assigned yet — flag it
});

if (shouldUnsub) { unsub?.(); } // Source settled synchronously
```

No microtask. No invariant violation. The chicken-and-egg is resolved with a flag.

## What this signals about how we think about stability

Every library claims to care about stability. The question is what they actually do when stability conflicts with cleanliness.

Our answer is: clean up aggressively before 1.0, then hold the line afterward. The deletions above aren't arbitrary — each one was a source of real confusion, a real test isolation hazard, or a real invariant violation. Keeping them would have meant carrying that debt into 1.0 and beyond.

The implicit commitment we're making with this release is that post-1.0, we won't make changes like these. The protocol is stable. The core API surface is locked. The only changes will be additions.

But right now, before that lock happens, we cleaned house. And we're comfortable saying: there's nothing left in the core API that we're uncertain about.

Next: [Durable, Attachable, Vendor-Neutral](/blog/39-attach-storage) — how we unified five persistence primitives into one.
