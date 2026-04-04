---
title: "Skip DIRTY: How We Halved Dispatch for Single-Dep Paths"
description: "How single-dependency optimization removed unnecessary DIRTY propagation and significantly reduced dispatch overhead in common linear paths."
date: 2026-03-25
authors: [david]
tags: [performance, correctness]
---

# Skip DIRTY: How We Halved Dispatch for Single-Dep Paths

*Chronicle 28 - Arc 8: Engineering Deep Cuts*

Two-phase signaling is robust. It can also be overkill in trivial paths.

For nodes with a single dependency, we found many cases where sending a separate DIRTY phase added overhead without improving correctness. So we introduced a selective skip strategy.

## The optimization target

Common app graphs have many linear segments:

- source -> derived -> derived
- state -> selector -> UI sink

In these segments, the extra DIRTY hop often carried no decision value. It was just protocol traffic.

## What "skip DIRTY" does

For eligible single-dependency paths, we:

- avoid the standalone DIRTY dispatch
- propagate value/update state directly with equivalent correctness guards
- preserve full two-phase behavior in multi-dep and ambiguity-prone paths

This is a selective optimization, not a semantic rewrite.

## Why correctness holds

We only skip DIRTY when dependency topology makes ordering and invalidation unambiguous.

If a path can reintroduce branch races or fan-in ambiguity, we keep normal two-phase signaling.

The rule is simple: optimize where guarantees are already implied by topology.

## Result

Dispatch volume dropped substantially in single-dep heavy workloads, with correspondingly better throughput and lower overhead.

The bigger win was conceptual: the protocol can adapt to graph shape without becoming inconsistent.

## Takeaway

The right abstraction is stable semantics plus topology-aware execution.

Skip-DIRTY worked because it respected the original contract and only removed work that provably added no information.
