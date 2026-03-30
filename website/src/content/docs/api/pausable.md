---
title: "pausable()"
description: "While `PAUSE` is in effect, buffers `DIRTY` / `DATA` / `RESOLVED`; flushes on `RESUME`."
---

While `PAUSE` is in effect, buffers `DIRTY` / `DATA` / `RESOLVED`; flushes on `RESUME`.

## Signature

```ts
function pausable<T>(source: Node<T>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Pass-through with pause buffering.

## Basic Usage

```ts
import { pausable, state, PAUSE, RESUME } from "@graphrefly/graphrefly-ts";

const s = state(0);
pausable(s);
s.down([[PAUSE]]);
s.down([[RESUME]]);
```
