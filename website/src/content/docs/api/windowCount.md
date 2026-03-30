---
title: "windowCount()"
description: "Splits source `DATA` into sub-nodes of `count` values each. Each sub-node completes after `count` items or when source completes."
---

Splits source `DATA` into sub-nodes of `count` values each. Each sub-node completes after `count` items or when source completes.

## Signature

```ts
function windowCount<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<Node<T>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `count` | `number` | Items per window. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;Node&lt;T&gt;&gt;` - Each emission is a sub-node carrying that window's values.

## Basic Usage

```ts
import { windowCount, state } from "@graphrefly/graphrefly-ts";

windowCount(state(0), 3);
```
