---
title: "stratify()"
description: "Route input to different branches based on classifier functions.\n\nEach branch gets an independent operator chain. Branch nodes are structural —\ncreated at const"
---

Route input to different branches based on classifier functions.

Each branch gets an independent operator chain. Branch nodes are structural —
created at construction time and persist for the graph's lifetime. If a rule
name is removed from the rules array, the corresponding branch silently
drops items (classifier not found). To tear down a dead branch, call
`graph.remove("branch/&lt;name&gt;")`.

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
| <code>name</code> | <code>string</code> | Graph name. |
| <code>source</code> | <code>Node&lt;T&gt;</code> | Input node (registered as `"source"`). |
| <code>rules</code> | <code>ReadonlyArray&lt;StratifyRule&lt;T&gt;&gt;</code> | Initial routing rules. |
| <code>opts</code> | <code>StratifyOptions</code> | Optional graph/meta options. |

## Returns

Graph with `"source"`, `"rules"`, and `"branch/&lt;name&gt;"` nodes.
