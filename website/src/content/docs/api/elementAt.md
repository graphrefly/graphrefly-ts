---
title: "elementAt()"
description: "Emits the `index`th **`DATA`** (zero-based), then **`COMPLETE`**."
---

Emits the `index`th **`DATA`** (zero-based), then **`COMPLETE`**.

## Signature

```ts
function elementAt<T>(source: Node<T>, index: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `index` | `number` | Zero-based emission index. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Single indexed value.

## Basic Usage

```ts
import { elementAt, state } from "@graphrefly/graphrefly-ts";

const n = elementAt(state(0), 2);
```
