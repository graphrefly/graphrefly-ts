---
title: "buffer()"
description: "Buffers source `DATA` values; flushes an array when `notifier` settles (`buffer`)."
---

Buffers source `DATA` values; flushes an array when `notifier` settles (`buffer`).

## Signature

```ts
function buffer<T>(source: Node<T>, notifier: Node<unknown>, opts?: ExtraOpts): Node<T[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `notifier` | `Node&lt;unknown&gt;` | Flush trigger on each settlement. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T[]&gt;` - Emits buffered arrays (may be empty-handled via `RESOLVED` when nothing buffered).

## Basic Usage

```ts
import { buffer, state } from "@graphrefly/graphrefly-ts";

buffer(state(0), state(0));
```
