---
title: "bufferTime()"
description: "Flushes buffered `DATA` values every `ms` (`bufferTime` / `windowTime`)."
---

Flushes buffered `DATA` values every `ms` (`bufferTime` / `windowTime`).

## Signature

```ts
function bufferTime<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `ms` | `number` | Flush interval in milliseconds. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T[]&gt;` - Time-windowed batches.

## Basic Usage

```ts
import { bufferTime, state } from "@graphrefly/graphrefly-ts";

bufferTime(state(0), 250);
```
