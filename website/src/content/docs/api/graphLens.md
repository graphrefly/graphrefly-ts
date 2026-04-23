---
title: "graphLens()"
description: "Create a reactive observability lens over a Graph. Returns a\nLensGraph with three reactive surfaces (`stats`, `health`, `flow`)\nplus the `why(from, to)` method."
---

Create a reactive observability lens over a Graph. Returns a
LensGraph with three reactive surfaces (`stats`, `health`, `flow`)
plus the `why(from, to)` method.

The returned graph is detached. Mount it via `target.mount("lens", lens)`
if you want it to appear in the target's `describe()`, or keep it standalone.

## Signature

```ts
function graphLens(target: Graph, opts?: GraphLensOptions): LensGraph
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `Graph` | The graph to observe. |
| `opts` | `GraphLensOptions` | See GraphLensOptions. |

## Basic Usage

```ts
const g = new Graph("app");
g.add(state(0, { name: "counter" }));
const lens = graphLens(g);
lens.stats.subscribe((msgs) => console.log(msgs[0]?.[1])); // TopologyStats
// Flow queries — O(1) without subscribing to snapshots:
lens.flow.get("counter");        // FlowEntry | undefined
lens.flow.size;                  // number
lens.flow.entries.subscribe(...); // reactive snapshot, lazy-materialized
```
