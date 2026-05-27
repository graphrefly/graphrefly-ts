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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional node options (derived describe kind). |

## Returns

`Node&lt;T[]&gt;` — single array emission before completion.

## Basic Usage

```ts
import { of, toArray } from "@graphrefly/graphrefly";

toArray(of(1, 2, 3));
```
