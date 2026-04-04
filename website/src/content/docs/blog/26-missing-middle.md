---
title: "Why Signals Aren't Enough for AI Streaming"
description: "Signals are great for local UI state, but AI streaming needs orchestration, cancellation, and durable flow semantics across system boundaries."
date: 2026-03-25T16:00:00
authors: [david]
tags: [design-philosophy, architecture]
---

# The Missing Middle: Why Signals Aren't Enough for AI Streaming

*Chronicle 26 - Arc 7: From Library to Platform*

Signals made local reactivity pleasant again. AI products added a different class of problem: long-lived streams with cancellation, retries, checkpoints, and cross-boundary flow control.

That gap is the missing middle.

## Where signals shine

Signals are excellent for:

- synchronous local state
- deterministic dependency tracking
- UI-focused update propagation

If your work is mostly in-memory and immediate, signals are hard to beat.

## Where AI streaming pushes beyond signals

Agent and LLM workflows need more:

- stream composition across network/system boundaries
- explicit cancellation and reset propagation
- orchestration of retries, timeouts, and partial completion
- inspectable status across multi-step pipelines

At that point, "just values changing" is not enough context.

## Why graph-native orchestration helps

GraphReFly's reactive sources and control signals let you model both data and lifecycle in one graph:

- data chunks flow as normal emissions
- control flows through explicit signal channels
- adapters bridge Promise and async iterable boundaries immediately

You can reason about ongoing work, not just current values.

## Balanced view

This is not "signals are bad." It is "signals are incomplete for this class of problem."

Many teams will still use signals at UI edges. The missing middle is the platform layer that coordinates streaming, control, and state coherently behind that UI.

## Takeaway

AI streaming architecture needs a runtime that understands flow, not only snapshots.

Signals solve a critical piece. Reactive orchestration fills the rest.
