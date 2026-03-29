---
title: "Graph()"
description: "Named container for nodes and explicit edges (GRAPHREFLY-SPEC §3.1–§3.7).\n\nQualified paths use `::` as the segment separator (for example `parent::child::node`)"
---

Named container for nodes and explicit edges (GRAPHREFLY-SPEC §3.1–§3.7).

Qualified paths use `::` as the segment separator (for example `parent::child::node`).

Edges are pure wires: `connect` only validates wiring — the target must already list the source in
its dependency array; no transforms run on the edge.

## Signature

```ts
class Graph
```

## Basic Usage

```ts
import { Graph, state } from "@graphrefly/graphrefly-ts";

const g = new Graph("app");
g.register("counter", state(0));
```
