---
title: "last()"
description: "Buffers values and emits the last **`DATA`** on **`COMPLETE`**; optional `defaultValue` if none arrived."
---

Buffers values and emits the last **`DATA`** on **`COMPLETE`**; optional `defaultValue` if none arrived.

## Signature

```ts
function last<T>(source: Node<T>, options?: ExtraOpts & { defaultValue?: T }): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>options</code> | <code>ExtraOpts & { defaultValue?: T }</code> | Optional NodeOptions and `defaultValue` when empty. |

## Returns

`Node&lt;T&gt;` - Last-or-default node.

## Basic Usage

```ts
import { last, state } from "@graphrefly/pure-ts";

const n = last(state(1), { defaultValue: 0 });
```
