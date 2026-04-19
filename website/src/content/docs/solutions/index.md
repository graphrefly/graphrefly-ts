---
title: Solutions
description: "GraphReFly solutions are end-to-end answers to real UI and orchestration problems. Today, Reactive Layout is the published solution — pretext-class measurement wired into a reactive graph."
---

A **solution** is not a single API call — it is how you should build a class of product: which primitives to combine, where the sharp edges are, and how it fits the rest of the stack. GraphReFly is growing a small set of these; **Reactive Layout** is the one documented and demo-ready today.

## Reactive Layout

**Pretext-class text measurement** (canvas-based, no layout thrash) **plus a reactive graph**: multi-column flow, shape obstacles, heterogeneous blocks, and observability (`graph.describe()`, meta companions, snapshots). Change inputs — font size, obstacles, streaming text — and only what depends on them recomputes.

- **Solution guide:** [Reactive Layout](/solutions/reactive-layout/) — what it does, quick start, advanced usage (blocks, flow, adapters), and how it composes with harnesses, resilience, lists, and CQRS.
- **Comparison:** [Reactive Layout vs Pretext](/comparisons/pretext/) — bundle size, i18n fidelity, primitive mapping, and when to stay on pretext alone.

If your problem is reactive text and layout in the browser (or headless via adapters), start there.
