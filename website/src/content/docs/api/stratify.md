---
title: "stratify()"
description: "Route input to different reduction branches based on classifier functions.\n\nEach branch gets an independent operator chain. Rules are reactive — update\nthe `\"ru"
---

Route input to different reduction branches based on classifier functions.

Each branch gets an independent operator chain. Rules are reactive — update
the `"rules"` state node to rewrite classification at runtime. Rule updates
affect **future items only** (streaming classification, not retroactive).

Branch nodes are structural — created at construction time and persist for
the graph's lifetime. If a rule name is removed from the rules array, the
corresponding branch silently drops items (classifier not found). To tear
down a dead branch, call `graph.remove("branch/&lt;name&gt;")`.

## Signature

```ts
function stratify<T>(
	name: string,
	source: Node<T>,
	rules: ReadonlyArray<StratifyRule<T>>,
	opts?: StratifyOptions,
): Graph
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Graph name. |
| `source` | `Node&lt;T&gt;` | Input node (registered externally or will be added as `"source"`). |
| `rules` | `ReadonlyArray&lt;StratifyRule&lt;T&gt;&gt;` | Initial routing rules. |
| `opts` | `StratifyOptions` | Optional graph/meta options. |

## Returns

Graph with `"source"`, `"rules"`, and `"branch/&lt;name&gt;"` nodes.
