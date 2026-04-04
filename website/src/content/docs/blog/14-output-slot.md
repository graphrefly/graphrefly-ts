---
title: "Output Slot: How null->fn->Set Saves 90% Memory"
description: "How GraphReFly moved from eager Set allocation to a null->fn->Set output slot model and cut memory overhead for sparse reactive graphs."
date: 2026-03-25
authors: [david]
tags: [performance, architecture]
---

# Output Slot: How null->fn->Set Saves 90% Memory

*Chronicle 14 - Arc 5: Architecture v4 - Performance Without Compromise*

The easiest way to waste memory in a reactive library is to allocate collections for nodes that never need them.

That was our v3 reality. Every producer created an output `Set` up front. It was simple and predictable, but most nodes had `0` or `1` downstream consumer for most of their lifetime. We were paying for the general case on every instance.

In v4, we replaced eager allocation with an output slot state machine:

- `null` when a node has no subscribers
- `fn` when exactly one subscriber is attached
- `Set<fn>` when fan-out grows beyond one

## Why this matters in real graphs

Large app graphs are sparse. Even with many derived nodes, most edges are linear chains or temporary subscriptions.

When every node starts with `new Set()`, you allocate:

- an object for the `Set`
- internal hash storage
- bookkeeping for iteration and growth

Multiplied across thousands of nodes, this dominated baseline memory before useful work even started.

## The slot transition model

The output slot behaves like a tiny adaptive container:

1. **Subscribe first sink**: `null -> fn`
2. **Subscribe second sink**: `fn -> Set([fn1, fn2])`
3. **Unsubscribe to one sink**: `Set -> fn`
4. **Unsubscribe last sink**: `fn -> null`

This keeps the hot path branchy but cheap, and avoids object churn in the common `0/1` subscriber case.

## Performance trade-off we accepted

We intentionally traded a little code complexity for much lower resident memory:

- More branch checks in subscribe/unsubscribe
- More careful handling of iteration when the slot can change shape
- Fewer allocations and fewer GC-triggering objects

In practice, the branch overhead was noise compared with allocation savings. The graph spends far more time existing than changing topology.

## Correctness hazards we had to avoid

Adaptive containers are easy to get wrong. The dangerous bugs were:

- **Mutation while iterating**: removing a sink during dispatch can skip callbacks
- **Shape drift**: forgetting to downshift `Set -> fn` leaks structure and loses benefits
- **Duplicate fan-out**: accidental double-subscribe corrupts cardinality assumptions

The fix was to centralize transitions and keep all add/remove operations in one path instead of inline branching in many callers.

## The architectural lesson

v4 was not "micro-optimizations week." It was about aligning data structures with observed graph shape.

The output slot model works because it mirrors reality:

- most nodes are disconnected or singly connected
- high fan-out exists, but is exceptional

If your graph is sparse, your core storage should be sparse-first too.

That single change unlocked a lot of v4's memory profile improvements without changing user APIs at all.
