---
title: "From callbag-recharge to GraphReFly: Why We Started Over"
date: 2026-04-03T09:00:00
authors:
  - david
tags:
  - architecture
  - design-philosophy
  - announcements
---

# From callbag-recharge to GraphReFly: Why We Started Over

*Capstone — the final chapter of the engineering chronicle*

---

Over the past 24 posts, we've told the story of building a reactive graph engine from scratch — four architecture iterations, dozens of correctness bugs, performance cliffs, and design breakthroughs. That story began in [callbag-recharge](/blog/01-the-road-to-graphrefly/), a TypeScript library that grew from a weekend experiment into 170+ modules across 12 categories.

And then we threw it all away and started over.

This post explains why.

## What callbag-recharge taught us

The predecessor was a success story in every way except one. It validated every hypothesis we had about reactive graph programming:

**Two-phase push works.** [DIRTY-first propagation](/blog/08-two-phase-push/) solves the diamond problem without schedulers, without pull-phase computation, without polling. Every derived value computes exactly once per upstream change.

**Stores all the way down works.** Making [every node a subscribable store](/blog/23-stores-all-the-way-down/) — with `.get()`, `.set()`, and reactive subscriptions — gives you the ergonomics of Zustand with the power of RxJS.

**Protocol-first design works.** Starting from a [message protocol](/blog/02-protocol-first-thinking/) rather than an API surface means the system composes correctly by construction. New operators don't need special cases. New message types don't break existing ones.

**Inspectability works.** Making [every node observable](/blog/06-inspector-pattern/) at runtime — names, edges, values, phases — turns debugging from guesswork into science. `graph.describe()` gives you a complete picture of your reactive system at any moment.

These weren't just ideas we liked. We proved them across 863 tests, benchmarks against Preact Signals and SolidJS, and real usage in streaming AI pipelines.

## What callbag-recharge got wrong

The thing callbag-recharge got wrong wasn't any single decision. It was the accumulation of decisions made before we understood the full picture.

### Too many primitives

callbag-recharge had six primitives: `state`, `derived`, `dynamicDerived`, `producer`, `effect`, and `operator`. Each had its own creation path, its own internal flags, and its own edge cases. When we added features — meta companions, guards, lifecycle options — we had to add them to all six.

GraphReFly has **one primitive**: `node`. Everything else — `state()`, `derived()`, `producer()`, `effect()` — is a sugar constructor that calls `node()` with the right options. One code path. One set of options. One place to add features.

The difference isn't cosmetic. When we added `dynamicNode()` (runtime dependency tracking), it was a single new constructor over the same `node` internals. In callbag-recharge, `dynamicDerived` required its own implementation with its own bugs.

### Callbag protocol lock-in

The original callbag spec uses numeric types: 0 for handshake, 1 for data, 2 for termination. callbag-recharge extended this with Type 3 for state signals (DIRTY, RESOLVED, PAUSE, RESUME). But the numeric encoding was opaque, the handshake ceremony was complex, and the protocol couldn't be extended without risking collisions with existing callbag operators.

GraphReFly uses **named message tuples**: `[[DATA, value]]`, `[[DIRTY]]`, `[[RESOLVED]]`. They're self-describing, extensible, and debuggable. You can `console.log` a message array and immediately see what it means. The [message tier system](/blog/11-control-signals-separation/) classifies messages by behavior (Tier 0 coordination, Tier 1 lifecycle, Tier 2+ data/terminal) rather than by numeric encoding.

### No first-class graph container

callbag-recharge nodes were standalone. You could connect them, but there was no registry, no namespace, no way to snapshot the entire graph or diff two states. The Inspector was bolted on as a side-channel observer.

GraphReFly's `Graph` is a first-class container. You `register()` nodes, `describe()` the topology, `snapshot()` the state, `diff()` two snapshots, render a `diagram()`, and `observe()` changes — all from a single object. This isn't a debugging tool; it's the foundation for persistence, checkpointing, and AI orchestration.

### No cross-language spec

callbag-recharge was TypeScript-only. The behavior was defined by the implementation, not by a spec. When we started a Python port, every edge case required reading the TypeScript source to understand the intended behavior.

GraphReFly has a [cross-language behavioral spec](/spec/) (`GRAPHREFLY-SPEC.md`) that defines messages, node contracts, Graph container behavior, and invariants. The TypeScript and Python implementations both conform to this spec. When they disagree, the spec wins.

## The decision to start over

We could have refactored callbag-recharge incrementally. Replace the six primitives with `node()` sugar. Migrate from numeric callbag types to named tuples. Add a Graph container. Update the spec.

We chose not to, for three reasons:

**1. Breaking changes were total.** Every one of these changes breaks the public API. If you're going to break everything, you might as well break it once with a clean design rather than in six painful migration steps.

**2. The name carried baggage.** "callbag-recharge" implied a callbag-ecosystem library. GraphReFly is not a callbag library — it's a reactive graph protocol that learned from callbag. The name change signals the scope change.

**3. We wanted a fresh dependency graph.** callbag-recharge had accumulated 170+ modules with internal dependencies that made tree-shaking imperfect. Starting over with a single `node` primitive and clean module boundaries gave us better tree-shaking from day one.

## What carried forward

Almost everything that matters:

| From callbag-recharge | In GraphReFly |
|---|---|
| Two-phase push (DIRTY/DATA) | Same algorithm, same guarantees |
| Bitmask diamond resolution | Same approach, [same post](/blog/17-bitmask-flag-packing/) |
| Output slot optimization (null → fn → Set) | [Carried forward](/blog/14-output-slot/) |
| Skip DIRTY for single-dep paths | [Carried forward](/blog/28-skip-dirty/) |
| Push-phase memoization (RESOLVED) | [Core protocol message](/blog/12-resolved-signal/) |
| 70+ operators | All ported, same semantics |
| Framework adapters | React, Vue, Svelte, Solid, NestJS |
| Inspector philosophy | Evolved into `Graph.describe()` / `Graph.observe()` |
| Checkpoint adapters | Memory, file, SQLite, IndexedDB |
| No queueMicrotask | [Same invariant](/blog/30-no-queuemicrotask/) |
| No polling | Same invariant |
| No imperative triggers | Same invariant |

The design invariants, the correctness guarantees, the performance optimizations, and the operator semantics all carried forward. What changed was the foundation they sit on.

## What's new in GraphReFly

Beyond the architectural cleanup, GraphReFly adds capabilities that callbag-recharge never had:

- **Domain-layer patterns** — `pipeline()`, `agentLoop()`, `chatStream()`, `toolRegistry()`, `collection()`, `knowledgeGraph()`, `cqrs()` — high-level APIs with sensible defaults that hide protocol internals.
- **Reactive layout engine** — DOM-free text measurement and Knuth-Plass line breaking as a reactive graph, inspired by [Pretext](https://github.com/chenglou/pretext).
- **Agent memory** — `agentMemory()` with time-based decay (inspired by [OpenViking](https://github.com/volcengine/openviking)), retrieval, and consolidation for long-running AI agents.
- **Worker bridge** — `workerBridge()` / `workerSelf()` for transparent cross-thread node communication.
- **Backpressure** — `createWatermarkController()` with PAUSE/RESUME flow control.
- **Python implementation** — [graphrefly-py](https://py.graphrefly.dev) conforming to the same behavioral spec.

## The chronicle continues

This blog has told the story of how we got here — from a [design crush on callbag's symmetry](/blog/01-the-road-to-graphrefly/) through [four architecture iterations](/blog/07-data-flows-through-graph/) to a [protocol that solves problems other libraries don't even see](/blog/26-missing-middle/).

GraphReFly is the result. One primitive. Zero dependencies. A reactive graph protocol for human + LLM co-operation.

The chronicle continues at [graphrefly.dev](https://graphrefly.dev).
