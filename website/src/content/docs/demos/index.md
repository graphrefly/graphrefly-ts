---
title: "Demos"
description: "Interactive demos showing GraphReFly compat layers across frameworks and state libraries."
---

Live demos that show GraphReFly working alongside popular state libraries inside every major UI framework.

## Compat matrix

**4 state libraries × 4 frameworks** — all on one page per framework.

| Framework | State libraries shown |
|-----------|----------------------|
| React | GraphReFly, Jotai, Nanostores, Zustand |
| Vue | GraphReFly, Jotai, Nanostores, Zustand |
| SolidJS | GraphReFly, Jotai, Nanostores, Zustand |
| Svelte | GraphReFly, Jotai, Nanostores, Zustand |

Each page exercises all three framework binding APIs: `useStore`, `useSubscribe`, and `useSubscribeRecord`.

[Run the compat matrix demo →](/demos/compat-matrix/)

## Reactive layout

Text measurement and line-breaking as a reactive graph — five chapters walk through incremental recomputation, `batch()` coalescing, pluggable measurement backends, and mixed-content block flow. The demo is hosted inside the same `demo-shell` used by compat matrix, so the topology mermaid and the source code driving each chapter are always visible to the right of the main canvas.

[Run the reactive layout demo →](/demos/reactive-layout/)

## Knowledge graph extraction

Live KG extraction from a long paper using Chrome's built-in Gemini Nano — runs on-device, zero API key, zero cost. Four chapters take you from `knowledgeGraph()` as a fancy Map to a reactive `paper → promptNode → kg → adjacency` pipeline with `graph.describe({ explain: {...}, reactive: true })` causal tracing and `policyEnforcer` guardrails. The KG renders as a force-directed SVG distinct from the topology mermaid in the side pane.

[Run the knowledge-graph demo →](/demos/knowledge-graph/)

## PagerDuty triage

Two-mode alert triage — Baseline (manual every time) vs GraphReFly (`agentMemory` learns your decisions and auto-classifies). A 3-minute stream of synthetic PagerDuty alerts flows through a `promptNode` classifier; in GraphReFly mode each user decision trains a pattern that is matched programmatically on future alerts (zero token cost). Runs with Chrome Nano, BYOK, or a deterministic dry-run adapter. The token counter is honest — local cache hits are separated from real LLM calls.

[Run the PagerDuty triage demo →](/demos/pagerduty-triage/)

## Source

Demo source lives at `demos/compat-matrix/`, `demos/reactive-layout/`, `demos/knowledge-graph/`, and `demos/pagerduty-triage/` in the repo.
