---
title: "first()"
description: "Emits the first **`DATA`** then **`COMPLETE`** (same as `take(source, 1)`)."
---

Emits the first **`DATA`** then **`COMPLETE`** (same as `take(source, 1)`).

## Signature

```ts
function first<T>(source: Node<T>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Single-value stream.

## Basic Usage

```ts
import { first, state } from "@graphrefly/graphrefly-ts";

const n = first(state(42));
```
