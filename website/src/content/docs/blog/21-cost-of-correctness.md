---
title: "The Cost of Correctness"
date: 2026-03-25
authors: [david]
tags: [performance, correctness, benchmarks]
---

# The Cost of Correctness

*Chronicle 21 — Arc 6: Correctness Stories*

---

In the predecessor (callbag-recharge), we measured roughly `9.8M ops/sec` where Preact-style signal benchmarks showed around `34M`.

It was tempting to hide that number. We published it.

## Why the numbers differed

Benchmarks are not neutral. They encode assumptions.

The predecessor engine paid for guarantees that many microbenchmarks do not model:

- explicit dependency graph semantics
- lifecycle signal propagation (reset/cancel/pause paths)
- diamond-safe coordination under composition
- inspector visibility and deterministic control flow

Those guarantees cost cycles. They also prevent classes of production bugs.

## What "faster" can mean

A lean signal core optimized for trivial fan-out can dominate synthetic throughput. That is a valid design target.

But if your workload includes orchestration, cancellation, dynamic branches, and observable control state, peak scalar throughput is not the only metric that matters.

## GraphReFly's position

GraphReFly carries forward the same correctness guarantees — DIRTY/RESOLVED two-phase propagation, diamond-safe resolution, deterministic effect ordering — with further optimizations in memory layout and protocol overhead. The single `node` primitive eliminates dispatch indirection that the five-primitive predecessor required.

We continue to optimize hard inside our semantic contract. We do not relax the contract to win one chart.

That means:

- aggressively improving representation and memory layout (bitmask flag packing, output slot optimization)
- removing avoidable protocol complexity (one primitive instead of five)
- keeping correctness behavior explicit and testable

But it does **not** mean deleting safety properties because they are inconvenient to benchmark.

## How to evaluate fairly

When comparing reactive runtimes, ask:

1. What guarantees are included in the measured path?
2. How does the system behave under cancellation and switching?
3. Are lifecycle/control semantics visible and composable?
4. What fails first under graph complexity: speed or correctness?

A single ops/sec number cannot answer those.

## Takeaway

The honest benchmark is not the one where you win. It is the one where users understand the trade-off.

GraphReFly is built for correctness-first reactive orchestration. If that costs raw peak throughput in minimal scenarios, that is a deliberate engineering choice, not an accident. The predecessor proved this trade-off was right; GraphReFly refines the execution.
