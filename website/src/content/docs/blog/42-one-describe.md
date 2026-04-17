---
title: "One describe() for Diagrams, Dumps, and Debugging: Lower Cognitive Cost for Agent Teams"
description: "GraphReFly v0.4 folds dumpGraph, toMermaid, toD2, and the inspector's output format into a single describe({format}) call. The design decision behind consolidation — and what it means for teams operating agent systems at scale."
date: 2026-04-23T09:00:00
authors:
  - david
tags:
  - developer-experience
  - inspectability
  - spec-v0.4
  - tooling
---

# One describe() for Diagrams, Dumps, and Debugging: Lower Cognitive Cost for Agent Teams

*Arc 7, Post 42 — Introspection Consolidation*

---

Here's a problem that doesn't look like a problem until you have several developers working with the same system: every introspection task requires learning a different API.

Want to dump the graph's current state for debugging? That's `dumpGraph()`. Want to generate a Mermaid diagram for documentation? That's `toMermaid()`. Want D2 format for your architecture diagrams? That's `toD2()`. Want structured JSON for a monitoring dashboard? That's `describe()` with specific options.

Four entry points, four different signatures, four places to discover and document. When something goes wrong in a production agent system at 2am, the last thing you want is to spend time remembering which method returns what format.

In v0.4, it's one call.

## `describe({format})` — the unified entry point

```typescript
// Human-readable text with color and indentation
graph.describe({ format: "pretty" })

// Structured JSON for dashboards and monitoring
graph.describe({ format: "json" })

// Mermaid flowchart for documentation
graph.describe({ format: "mermaid" })

// D2 diagram for architecture tools
graph.describe({ format: "d2" })

// Minimal (default) — just the essentials
graph.describe()
```

The underlying data model is shared across all formats. `describe()` builds the graph representation once; the format is a rendering concern. This means Mermaid diagrams and JSON dumps are always consistent with each other — they describe the same graph at the same moment, in the format most useful for the context.

## Why consistency between formats matters

Before consolidation, `dumpGraph` and `toMermaid` were separate code paths. A node that appeared in one might not appear in the other if the implementations had diverged. Edge detection logic was duplicated and could produce different results.

This is a subtle correctness issue in introspection tooling: if your diagram shows edges A→B and B→C, but your debug dump shows a different set of nodes, which one do you trust? The answer shouldn't be "whichever one was updated most recently."

With `describe({format})`, there's one traversal and one data model. The format is a rendering lens on a consistent snapshot. If the diagram shows a node, the JSON dump will too.

## Inspector-aware degradation

The `inspectorEnabled` flag — now a property on `GraphReFlyConfig` rather than a static on `Graph` — controls whether the inspector infrastructure runs.

In development (default `NODE_ENV !== "production"`), inspector enabled: `describe()` can produce rich output including causal chain attribution, wave event history, and derived node source tracking.

In production, inspector disabled: `describe()` still works — it gracefully degrades to structural information (nodes, edges, values, versioning). The extras that require inspector infrastructure silently fall back. No throw. No crash. Reduced overhead.

This means you can safely call `describe()` in a monitoring hook without gating it on environment checks:

```typescript
graph.observe("health-check", (event) => {
  if (event.type === "data" && event.path === "status") {
    metrics.gauge("graph.nodes", graph.describe().nodes.length);
  }
});
```

In development, this gets full detail. In production, it gets structure. The call is the same.

## `reachable`, `trace`, and `resourceProfile`: the operational trio

Beyond `describe`, v0.4 ships three operational tools that answer the questions agent teams most frequently need during incidents:

**`graph.reachable(from, to?)`** — given a set of source nodes, which nodes can be reached through the dependency graph? Given a target node, which source nodes can affect it? Answers "why is this node recomputing?" and "what does this node's change affect?"

**`graph.trace(node, depth?)`** — for nodes with V1 versioning, return the causal chain: this value came from these deps at these versions, which came from these upstream nodes, and so on. Not a log dump — a structured causal graph that you can query.

**`graph.resourceProfile()`** — memory footprint, retained value sizes, queue depths, activation counts per node. The same data that `graphProfile()` and `harnessProfile()` expose, but at the graph container level rather than the harness level.

Together these answer: "What happened?" (`trace`), "What's affected?" (`reachable`), "How much does it cost?" (`resourceProfile`).

## The `metaPassthrough` flag: configurable protocol filtering

One detail that affected `describe()` output: the list of message types that the graph filtered from meta-node broadcasts was previously hardcoded as `{TEARDOWN, INVALIDATE, COMPLETE, ERROR}`.

This was an anti-pattern. It meant the filtering logic lived in the framework core, not in configuration. Adding a new message type required remembering to add it to the hardcoded set.

In v0.4, each message type registered with `GraphReFlyConfig.registerMessageType` carries a `metaPassthrough` flag. The graph's filter reads this flag dynamically. New message types can declare their own passthrough semantics at registration time, without touching the graph internals.

For `describe()`, this means the output's event history is accurate: the filtered-vs-surfaced distinction comes from the message type's declared intent, not from a list that someone might forget to update.

## What this means for teams

The practical benefit of introspection consolidation is cognitive: one API surface, one mental model, one place to look.

For teams operating reactive agent systems, this matters during incidents (fewer things to remember under pressure), during onboarding (one API to learn instead of four), and during reviews (consistent output that doesn't require reconciling between tools).

The Mermaid output is the same graph as the JSON output. The debug dump is the same graph as the architecture diagram. When your inspector is off in production, `describe()` still returns useful structure. The tools work together because they're one tool.

Next: [The Audit Trail Your Compliance Team Will Ask For](/blog/43-audit-trail) — SENTINEL discipline, equals substitution, and causal trace as a governance primitive.
