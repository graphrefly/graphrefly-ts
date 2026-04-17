---
title: "GraphReFly v0.4: The Foundation Your Agent Stack Will Stand On"
description: "After six months of foundation redesign, we're releasing GraphReFly v0.4 — the last architectural change before 1.0. Here's what changed, what it means for adopters, and why we're confident nothing this fundamental will change again."
date: 2026-04-17T09:00:00
authors:
  - david
tags:
  - announcements
  - architecture
  - spec-v0.4
---

# GraphReFly v0.4: The Foundation Your Agent Stack Will Stand On

*Arc 7, Post 36 — The v0.4 Foundation*

---

When you evaluate an infrastructure library for a production agent system, the question you care about most isn't "does it work today?" It's "will I have to rewrite this in six months?"

GraphReFly v0.4 is our answer to that question. After six months of designing, stress-testing, and systematically tearing down every architectural decision we'd made, we're releasing what we believe is the last foundational change before 1.0. Not because we ran out of ideas — because we ran out of things we weren't confident about.

Here's what changed, and why it matters if you're betting production agent workflows on this library.

## What "foundation redesign" actually means

Most library "redesigns" are surface-level API shuffles. v0.4 went deeper. We redesigned the core dispatch model — the mechanism that every node, every operator, every graph introspection call, and every persistence hook runs through.

The central change is what we call the **unified dispatch waist**: a single internal `_emit` function that every emission in the entire system — whether from user code, framework logic, passthrough forwarding, or error recovery — converges at. One path. One set of invariants. One place where equals substitution, DIRTY prefix synthesis, PAUSE lock bookkeeping, and tier sorting happen.

Before v0.4, these responsibilities were scattered. Different emission paths had different rules about when to add a DIRTY prefix, when to check equals, when to forward. The result was a category of subtle correctness bugs that only appeared in specific composition patterns — bugs that our 1,400+ test suite missed because the tests had been written to accommodate the broken behavior.

## The three invariants that now hold unconditionally

The unified dispatch waist enforces three things that previously required careful per-operator discipline to maintain:

**Signal vs data, always separated.** `onMessage` handles protocol: START, DIRTY, RESOLVED, PAUSE, RESUME, TEARDOWN. `fn` handles data: it receives only resolved DATA payloads from deps, never message types, never protocol state. Before v0.4, operators routinely read `dep.status` and `dep.cache` inside node functions to compensate for uncertain delivery timing. In v0.4, those reads are prohibited — the START handshake delivers the right information at the right time, and `fn` never needs to interrogate its neighbors.

**No cross-node inspection.** `.cache` and `.status` are external-observer APIs — for user code, graph tooling, and debuggers. Inside the reactive layer, dep values arrive exclusively through DATA messages. This closes a class of wave-timing races that occurred when a node fetched a dep's cached value out-of-band and got a stale snapshot.

**Tier ordering, not special cases.** Where the old implementation had explicit branches for "is this a COMPLETE?", "is this an ERROR?", "should I add a DIRTY prefix?", v0.4 uses a tier classifier that routes every message by its behavioral category. The result is that new message types extend the system cleanly, without requiring new branches in every operator.

## What this means for operators: concrete improvements

The higher-order operators (`switchMap`, `exhaustMap`, `concatMap`, `mergeMap`) all benefited directly. They were previously built on a `producer` pattern that created an escape hatch from the framework's wave tracking. They're now `fn+closure` nodes with the source declared as a proper dependency — which means they participate in diamond resolution, get automatic equals substitution, and benefit from the pre-function skip when a dep emits RESOLVED.

We also fixed a memory leak that had been present in `mergeMap` since the initial implementation: inner subscription errors were not cleaning up their slot, which inflated the active-concurrency count and prevented the operator from ever completing after all inners errored. Not a footgun in most use cases, but exactly the kind of silent failure that only surfaces in production.

## The graph container: delete-to-ship philosophy

The graph module underwent a parallel cleanup driven by the same principle: pre-1.0 is the only time you can delete an API without leaving anyone behind.

The edge registry is gone. The `connect(from, to)` and `disconnect(from, to)` methods are gone. Every site in the codebase that called `connect()` was redundant with construction-time dependency declaration — the edges were already tracked. We replaced the registry with `edges()`: a derived function that walks the live `_deps` graph on demand, correctly reflecting runtime-discovered dependencies (including `autoTrackNode` deps) that a static registry could never see.

`dumpGraph`, `toMermaid`, and `toD2` are gone as standalone methods. They're now `describe({format: "pretty" | "mermaid" | "d2"})`. The static factory registry is gone — factories are passed per-call to `fromSnapshot({factories})`. `toObject` and `toJSONString` are gone — `snapshot()` is the primary persistence API.

In each case, the deleted API was either redundant, inconsistent with the model, or a footgun for test isolation. Pre-1.0 is the right time to make these cuts.

## Why we're confident this is the last foundation change

The key question any engineering team should ask before adopting an infrastructure library is whether the protocol is *stable*. Not frozen — stable. Does the spec have clear change categories? Are breaking changes restricted to major versions? Do the invariants hold unconditionally, or are there footnotes?

GraphReFly's spec now follows semver strictly: patch for clarifications, minor for new optional features and message types, major for breaking protocol changes. The v0.4 spec changelog documents every behavioral change with migration notes.

More importantly: the foundation redesign was driven by running every known composition pattern against the old implementation and finding the inconsistencies. We've now done that systematically — [with LLM stress testing](/blog/35-ai-stress-tested-our-protocol), with adversarial QA rounds, and with a 1,600+ test suite that covers diamond resolution, PAUSE/RESUME under concurrent locks, equals substitution across emission paths, and node versioning upgrades.

The next steps are adding rigor infrastructure (property-based tests and a formal TLA+ spec) and shipping the full Phase 4+ pattern layer. Neither of those will change the protocol core.

## What to read next

If you're evaluating GraphReFly for production use, the most useful next reads are:

- [Signal In, Data Out](/blog/37-signal-in-data-out) — the P2/P3 invariants and what they prevent
- [Pre-1.0, We Deleted More Than We Shipped](/blog/38-deleted-more-than-shipped) — what we cut and why
- [Durable, Attachable, Vendor-Neutral](/blog/39-attach-storage) — how `attachStorage` unifies persistence
- [Versioned Nodes, Portable State](/blog/40-versioned-nodes) — V0/V1 and safe schema evolution

The full spec is at [graphrefly.dev/spec](/spec). The changelog for v0.4 is in §8.
