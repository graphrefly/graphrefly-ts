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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>notifier</code> | <code>Node&lt;unknown&gt;</code> | Flush trigger on each settlement. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T[]&gt;` - Emits buffered arrays (may be empty-handled via `RESOLVED` when nothing buffered).

## Basic Usage

```ts
import { buffer, state } from "@graphrefly/pure-ts";

buffer(state(0), state(0));
```
