---
title: "graphLens()"
description: "Reactive observability preset over a target Graph."
---

Reactive observability preset over a target Graph.

## Signature

```ts
function graphLens(target: Graph): GraphLensView
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `Graph` | The graph to observe. |

## Basic Usage

```ts
const g = new Graph("app");
g.add(state(0, { name: "counter" }), { name: "counter" });

const lens = graphLens(g);
lens.topology.subscribe((msgs) => console.log("topology:", msgs));
lens.health.subscribe((msgs) => console.log("health:", msgs));
lens.flow.subscribe((msgs) => {
    for (const [type, payload] of msgs) {
      if (type === DATA) console.log("flow map size:", (payload as ReadonlyMap<string, FlowEntry>).size);
    }
});

// Causal chains: use the underlying primitive directly — `graphLens` no
// longer wraps it, since `graph.explain({ reactive: true })` already
// provides everything the old `lens.why()` did.
const why = g.explain("counter", "consumer", { reactive: true });

// Tear down when done.
lens.dispose();
```
