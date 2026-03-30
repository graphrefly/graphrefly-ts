---
title: "toArray()"
description: "Buffers every `DATA`; on upstream `COMPLETE` emits one `DATA` with the full array then `COMPLETE`."
---

Buffers every `DATA`; on upstream `COMPLETE` emits one `DATA` with the full array then `COMPLETE`.

## Signature

```ts
function toArray<T>(source: Node<T>, opts?: ExtraOpts): Node<T[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `opts` | `ExtraOpts` | Optional node options (operator describe kind). |

## Returns

`Node&lt;T[]&gt;` — single array emission before completion.

## Basic Usage

```ts
import { of, toArray } from "@graphrefly/graphrefly-ts";

toArray(of(1, 2, 3));
```
