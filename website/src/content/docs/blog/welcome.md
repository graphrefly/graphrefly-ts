---
title: GraphReFly Blog
description: Engineering stories from building GraphReFly — architecture decisions, bugs that taught us something, and ideas that didn't survive contact with reality.
date: 2026-04-03T10:00:00
authors:
  - david
tags:
  - announcements
featured: true
---

Engineering stories from building GraphReFly — the architecture decisions, the bugs that taught us something, and the ideas that didn't survive contact with reality.

## The GraphReFly Chronicle

A 25-post series tracing the evolution from a forgotten reactive protocol to a full graph engine for human + LLM co-operation.

**Origins** — Why we bet on callbag, what signals can't do, and protocol-first thinking.

**Architecture** — Four iterations of the reactive graph: from naive diamonds to two-phase push, from pull-phase memoization to the RESOLVED signal.

**Performance** — Output slot optimization, bitmask flag packing, Skip DIRTY dispatch halving, and why we don't use queueMicrotask.

**Correctness** — Diamond resolution without pull-phase computation, the cost of correctness vs raw speed, and promises as the new callback hell.

**Platform** — Stores all the way down, eagerly reactive computed state, the Zustand-to-orchestration migration path, and why signals aren't enough for AI streaming.

**Capstone** — [From callbag-recharge to GraphReFly: Why We Started Over](/blog/31-from-callbag-recharge-to-graphrefly/) — the full story of what we kept, what we threw away, and why.

Browse all posts in the sidebar, or start from the beginning with [The Road to GraphReFly](/blog/01-the-road-to-graphrefly/).
