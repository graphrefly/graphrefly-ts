---
title: "Knowledge graph extraction"
description: "Live KG extraction from a long paper using Chrome's built-in Gemini Nano — zero API key, on-device. Four chapters: baseline → reactive → inspect → guard."
---

The knowledge-graph demo extracts entities and relations from a long paper one paragraph at a time. The extractor is **Chrome's built-in Gemini Nano** (`window.LanguageModel`) — runs on-device, no API key, no cost. When the Prompt API isn't available the demo falls back to a deterministic mock extractor so the page works on every browser.

[Run the knowledge-graph demo →](/demos/knowledge-graph/)

The page uses the same three-pane `demoShell` as [reactive layout](/demos/reactive-layout/): main pane (paper text + force-directed KG), side-top (`describe(graph)` mermaid topology), side-bottom (the chapter's source code with cross-highlighting).

## What the four chapters teach

**1. Baseline — "this is just a fancy Map so far."** Hand-seeded entities and links, calls to `upsertEntity` / `link` / `related`. Exists to dispel the "knowledgeGraph() is Obsidian" misconception up front: the user-facing types are whatever you set as `TEntity` and `TRelation`; `entities` / `edges` / `adjacency` are internal node names.

**2. Reactive turn — the moment Graph beats Map.** A real pipeline:

```
paper-text → paragraphs → current-paragraph → promptNode (Gemini Nano)
                                                    ↓
                                           apply-extraction (effect)
                                                    ↓
                                       kg.{entities, edges, adjacency}
                                                    ↓
                                           force-directed SVG (subscribes)
```

`promptNode` is the universal LLM transform — it re-fires whenever any dep changes. The structured JSON output is shaped by a `responseConstraint` JSON schema. `apply-extraction` is the only imperative line in the whole pipeline; everything downstream is reactive. Click **Extract next paragraph** and watch entities accumulate in the canvas.

The textbox at the top accepts any URL. The page fetches it via [`r.jina.ai`](https://jina.ai/reader) (anonymous, 20 RPM) — paywalled or aggressively-throttled sources may fail; the bundled sample (Mohit Sewak's "What is AI Harness Engineering?") always works.

**3. Inspect & trace.** Same pipeline; adds `kg.describe({ explain: { from: "paper-text", to: "adjacency" }, reactive: true })` — a `Node<CausalChain>` that re-derives whenever any node along the path fires. Subscribe; render the chain. This is the answer to "why did this entity end up here?" — the homepage pain point 02 closure.

**4. Guardrails.** Same pipeline; wraps the KG in `policyEnforcer([…], { mode: "enforce" })`. The legitimate extraction effect (`system` actor) writes freely. Click **Try malicious write** to attempt a write as `untrusted-llm`: the guard throws `GuardDenied` and a violation is recorded — the closure for homepage pain point 03.

## Why a force-directed SVG (not mermaid)

The right-side mermaid pane already shows the **graph topology** — `paper-text → … → adjacency` and friends. The KG itself (entities and their relations) is a *different* graph — domain data, not pipeline structure. A force-directed layout makes that distinction visually obvious. Drag a node to pin it; double-click empty space to reset zoom. The simulation is hand-rolled (~200 LOC) — no d3 dependency.

## Why a real LLM in a demo

The session note in `archive/docs/SESSION-strategy-roadmap-demo-reprioritization.md` says "do not use a real LLM API call in the example." That rule still holds for [`examples/knowledge-graph/`](https://github.com/graphrefly/graphrefly-ts/blob/main/examples/knowledge-graph/index.ts), the Node-runnable companion that uses pre-parsed documents and runs in CI with no key.

For the **browser demo**, Chrome Nano changes the calculus: it's on-device, free, and visually intuitive. The same `LLMAdapter` interface accepts both the Chrome adapter and the mock — only the extraction quality differs.

## Source

Demo source lives at [`demos/knowledge-graph/`](https://github.com/graphrefly/graphrefly-ts/tree/main/demos/knowledge-graph) in the repo. The Node-runnable mirror is at [`examples/knowledge-graph/`](https://github.com/graphrefly/graphrefly-ts/tree/main/examples/knowledge-graph).
