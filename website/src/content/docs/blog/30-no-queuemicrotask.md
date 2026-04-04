---
title: "Why We Don't Use queueMicrotask (And Neither Should You)"
description: "Why GraphReFly avoids queueMicrotask for reactive coordination and prefers graph-native propagation to preserve glitch-free guarantees."
date: 2026-03-25
authors: [david]
tags: [correctness, design-philosophy]
---

# Why We Don't Use queueMicrotask (And Neither Should You)

*Chronicle 30 - Arc 8: Engineering Deep Cuts*

`queueMicrotask` is tempting when reactive timing gets complicated. It looks like a neat way to "let things settle."

In reactive graph engines, that often creates hidden schedulers and breaks determinism.

## The problem with microtask coordination

When you defer coordination via microtasks, you move control flow outside the graph protocol.

That can cause:

- ordering differences between equivalent topologies
- racey "works most of the time" behavior
- harder debugging because causality is no longer explicit in the graph

In short: you traded visible signal flow for implicit event-loop timing.

## Our rule

For reactive coordination, we do not use:

- `queueMicrotask`
- `setTimeout(..., 0)`
- `Promise.resolve().then(...)`

Instead, we model sequencing with graph-native primitives (`derived`, `effect`, `subscribe`, control signals) so ordering remains explicit and inspectable.

## Boundary exceptions

Timers still exist at true boundaries (for example `fromTimer` behavior). The distinction is important:

- **Boundary timing** models external time.
- **Internal coordination timing hacks** hide reactive logic.

We ban the second, not the first.

## Why this improves correctness

By keeping coordination inside the graph:

- updates remain glitch-aware
- cancellation/reset semantics propagate reliably
- test behavior matches production behavior more closely

You get fewer spooky-action bugs where "adding a log statement changes timing."

## Takeaway

If you need microtasks to make your reactive logic correct, your reactive model is probably incomplete.

Make causality explicit in the graph, and timing bugs stop being magic.
