---
title: "windowTime()"
description: "Splits source `DATA` into time-windowed sub-nodes; each window lasts `ms`."
---

Splits source `DATA` into time-windowed sub-nodes; each window lasts `ms`.

## Signature

```ts
function windowTime<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<Node<T>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>ms</code> | <code>number</code> | Window duration in milliseconds. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;Node&lt;T&gt;&gt;` - Each emission is a sub-node carrying that window's values.

## Basic Usage

```ts
import { windowTime, state } from "@graphrefly/pure-ts";

windowTime(state(0), 500);
```
