---
title: "Demos"
description: "Interactive demos showing clean-slate GraphReFly compositions."
---

Live demos that show GraphReFly clean-slate graph composition, inspection, and host boundaries.

## Reactive layout

Text measurement and line-breaking as a reactive graph — five chapters walk through incremental recomputation, `batch()` coalescing, pluggable measurement backends, and mixed-content block flow. The demo uses the shared clean-slate demo shell, so the topology mermaid and the source code driving each chapter are always visible to the right of the main canvas.

[Read the reactive layout solution →](/solutions/reactive-layout/)

## Knowledge graph extraction

Live KG extraction from a long paper using Chrome's built-in Gemini Nano — runs on-device, zero API key, zero cost. Four chapters take you from `knowledgeGraph()` as a fancy Map to a reactive `paper → promptNode → kg → adjacency` pipeline with `graph.describe({ explain: {...}, reactive: true })` causal tracing and `policyEnforcer` guardrails. The KG renders as a force-directed SVG distinct from the topology mermaid in the side pane.

[Read the knowledge-graph demo notes →](/demos/knowledge-graph/)

## PagerDuty triage

Two-mode alert triage — Baseline (manual every time) vs GraphReFly (`agentMemory` learns your decisions and auto-classifies). A 3-minute stream of synthetic PagerDuty alerts flows through a `promptNode` classifier; in GraphReFly mode each user decision trains a pattern that is matched programmatically on future alerts (zero token cost). Runs with Chrome Nano, BYOK, or a deterministic dry-run adapter. The token counter is honest — local cache hits are separated from real LLM calls.

[Read the PagerDuty triage demo notes →](/demos/pagerduty-triage/)

## Source

Demo source lives at `demos/reactive-layout/`, `demos/knowledge-graph/`, and `demos/pagerduty-triage/` in the repo. The retired compat matrix is no longer an active clean-slate demo.
