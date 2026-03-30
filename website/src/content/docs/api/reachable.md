---
title: "reachable()"
description: "Reachability query over a Graph.describe snapshot.\n\nTraversal combines dependency links (`deps`) and explicit graph edges (`edges`):\n- `upstream`: follows `deps"
---

Reachability query over a Graph.describe snapshot.

Traversal combines dependency links (`deps`) and explicit graph edges (`edges`):
- `upstream`: follows `deps` plus incoming edges.
- `downstream`: follows reverse-`deps` plus outgoing edges.

## Signature

```ts
function reachable(
	described: GraphDescribeOutput,
	from: string,
	direction: ReachableDirection,
	options: ReachableOptions = {},
): string[]
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `described` | `GraphDescribeOutput` | `graph.describe()` output to traverse. |
| `from` | `string` | Start path (qualified node path). |
| `direction` | `ReachableDirection` | Traversal direction. |
| `options` | `ReachableOptions` | Optional max depth bound. |

## Returns

Sorted list of reachable paths (excluding `from`).

## Basic Usage

```ts
import { Graph, reachable } from "@graphrefly/graphrefly-ts";

const g = new Graph("app");
const a = g.register("a");
const b = g.register("b", [a]);
const described = g.describe();

reachable(described, "app.a", "downstream"); // ["app.b"]
reachable(described, "app.b", "upstream");   // ["app.a"]
```
