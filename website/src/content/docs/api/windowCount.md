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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>count</code> | <code>number</code> | Items per window. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;Node&lt;T&gt;&gt;` - Each emission is a sub-node carrying that window's values.

## Basic Usage

```ts
import { windowCount, state } from "@graphrefly/pure-ts";

windowCount(state(0), 3);
```
