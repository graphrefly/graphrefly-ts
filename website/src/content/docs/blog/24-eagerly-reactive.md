---
title: "Why Our Computed States Are Eagerly Reactive"
date: 2026-03-25
authors: [david]
tags: [architecture, correctness, performance]
---

# Why Our Computed States Are Eagerly Reactive

*Chronicle 24 — Arc 7: From Library to Platform*

---

Lazy computed values look efficient. They can also hide work until inconvenient moments.

GraphReFly's `derived()` is eagerly reactive: when dependencies update, the computation runs immediately through two-phase push propagation. We chose this because orchestration correctness depends on predictable update timing.

## The lazy trap

Lazy computed models defer work until someone reads the value. In UI-only scenarios that can be fine. In orchestration-heavy graphs it creates ambiguity:

- did this dependency actually settle yet?
- is this branch idle or just unread?
- did cancellation happen before computation even started?

Those timing ambiguities are painful in control-sensitive pipelines.

## Why eager helps

Eager computation gives deterministic behavior:

- dependencies update, computation runs
- status changes are observable immediately
- downstream nodes do not "wake up late" on first read

That makes control signals like reset/cancel easier to reason about and easier to test. When you call `get()` on a `derived()` node, the value is already current — no hidden recomputation triggered by the read.

## Standalone operation and platform guarantees

GraphReFly strengthened this decision further. When nodes can operate independently outside a framework render cycle, hidden lazy work becomes a bigger source of surprise.

Eager semantics preserve a simple contract: if upstream changed and the node is active, the computed state is current now. This holds whether the consumer is a React component, a server-side orchestration pipeline, or an AI agent reading graph state.

## Performance concerns

Eager does not mean "compute everything always."

GraphReFly still optimizes with:

- topology-aware propagation (DIRTY flows only to actual dependents)
- subtree skipping through RESOLVED signals (see [RESOLVED: The Signal That Skips Entire Subtrees](./12-resolved-signal))
- bitmask flag packing for minimal overhead per node
- output slot optimization for memory efficiency

So the choice is not eager vs fast. It is eager plus disciplined optimization.

## Takeaway

We prioritized predictability over clever deferred execution.

In a platform meant for UI, orchestration, and AI workflows, eager computed state is the safer default because it makes system behavior explicit at the moment changes occur. GraphReFly's `derived()` carries this forward as a core design commitment, not a performance compromise.
