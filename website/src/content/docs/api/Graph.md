---
title: "Graph()"
description: "Named container for nodes and explicit edges (GRAPHREFLY-SPEC §3.1–§3.7).\n\nQualified paths use `::` as the segment separator (e.g. `\"parent::child::node\"`).\n\nEd"
---

Named container for nodes and explicit edges (GRAPHREFLY-SPEC §3.1–§3.7).

Qualified paths use `::` as the segment separator (e.g. `"parent::child::node"`).

Edges are **pure wires**:  does not apply transforms; it
validates that the target node already depends on the source (same object
reference in ).

## Signature

```ts
class Graph
```
