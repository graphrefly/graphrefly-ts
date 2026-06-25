---
title: "Historical knowledge graph extraction demo"
description: "Historical pre-CSP-9 browser demo notes. The active clean-slate successor is examples/knowledge-graph."
---

These notes describe the historical pre-CSP-9 browser demo for knowledge-graph
extraction. Its source is retained for reference, but it still depends on
retired root/pure-ts demo surfaces such as old AI utilities, policy helpers, and
`utils/demo-shell`, so it is not an active clean-slate demo.

Use [`examples/knowledge-graph/`](https://github.com/graphrefly/graphrefly-ts/tree/main/examples/knowledge-graph)
for the active clean-slate version. That example is Node-runnable, deterministic,
and built on current `@graphrefly/ts` public subpaths.

The historical page extracted entities and relations from a long paper one
paragraph at a time. The extractor was **Chrome's built-in Gemini Nano**
(`window.LanguageModel`) with a deterministic mock fallback.

The page used the old three-pane `demoShell` pattern: main pane (paper text +
force-directed KG), side-top topology, side-bottom chapter source with
cross-highlighting. That shell is not a current package surface.

## What the four chapters taught

**1. Baseline — "this is just a fancy Map so far."** Hand-seeded entities and
links, using the old `upsertEntity` / `link` / `related` browser-demo helpers.
This existed to dispel the "knowledgeGraph() is Obsidian" misconception up
front; those helpers are historical, not current public package guidance.

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

In the old demo, `promptNode` acted as the LLM transform and re-fired whenever
any dep changed. The structured JSON output was shaped by a
`responseConstraint` JSON schema. Treat that as provenance for the retired demo,
not as current `@graphrefly/ts` AI adapter guidance.

The textbox at the top accepts any URL. The page fetches it via [`r.jina.ai`](https://jina.ai/reader) (anonymous, 20 RPM) — paywalled or aggressively-throttled sources may fail; the bundled sample (Mohit Sewak's "What is AI Harness Engineering?") always works.

**3. Inspect & trace.** Same historical pipeline; added
`kg.describe({ explain: { from: "paper-text", to: "adjacency" }, reactive: true })`
to render a causal chain for "why did this entity end up here?"

**4. Guardrails.** Same historical pipeline; wrapped the KG in the old
`policyEnforcer` demo helper. That helper is also retired with the browser demo.

## Why a force-directed SVG (not mermaid)

The right-side mermaid pane already shows the **graph topology** — `paper-text → … → adjacency` and friends. The KG itself (entities and their relations) is a *different* graph — domain data, not pipeline structure. A force-directed layout makes that distinction visually obvious. Drag a node to pin it; double-click empty space to reset zoom. The simulation is hand-rolled (~200 LOC) — no d3 dependency.

## Why the historical demo used a real LLM

The session note in `archive/docs/SESSION-strategy-roadmap-demo-reprioritization.md` says "do not use a real LLM API call in the example." That rule still holds for [`examples/knowledge-graph/`](https://github.com/graphrefly/graphrefly-ts/blob/main/examples/knowledge-graph/index.ts), the Node-runnable companion that uses pre-parsed documents and runs in CI with no key.

For that **historical browser demo**, Chrome Nano changed the calculus because it
was on-device, free, and visually intuitive. Re-activating the idea now should
use current `@graphrefly/ts` public subpaths rather than the old `LLMAdapter`
surface.

## Source

Historical source lives at [`demos/knowledge-graph/`](https://github.com/graphrefly/graphrefly-ts/tree/main/demos/knowledge-graph)
in the repo. It is not included in the active workspace. The Node-runnable
clean-slate successor is [`examples/knowledge-graph/`](https://github.com/graphrefly/graphrefly-ts/tree/main/examples/knowledge-graph).
