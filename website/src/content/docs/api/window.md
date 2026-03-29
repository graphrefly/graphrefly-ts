---
title: "window()"
description: "Splits source `DATA` into sub-nodes, opening a new window each time `notifier` emits `DATA`."
---

Splits source `DATA` into sub-nodes, opening a new window each time `notifier` emits `DATA`.

## Signature

```ts
function window<T>(
	source: Node<T>,
	notifier: Node<unknown>,
	opts?: ExtraOpts,
): Node<Node<T>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `notifier` | `Node&lt;unknown&gt;` | Each `DATA` from `notifier` closes the current window and opens a new one. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;Node&lt;T&gt;&gt;` - Each emission is a sub-node carrying that window's values.
