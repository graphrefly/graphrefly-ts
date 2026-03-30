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
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `ms` | `number` | Window duration in milliseconds. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;Node&lt;T&gt;&gt;` - Each emission is a sub-node carrying that window's values.

## Basic Usage

```ts
import { windowTime, state } from "@graphrefly/graphrefly-ts";

windowTime(state(0), 500);
```
