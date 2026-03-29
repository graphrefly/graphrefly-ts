---
title: "bufferCount()"
description: "Batches consecutive `DATA` values into arrays of length `count` (`bufferCount` / `windowCount`)."
---

Batches consecutive `DATA` values into arrays of length `count` (`bufferCount` / `windowCount`).

## Signature

```ts
function bufferCount<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `count` | `number` | Buffer size before emit; non-positive completes immediately. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T[]&gt;` - Emits fixed-size arrays; remainder flushes on `COMPLETE`.

## Basic Usage

```ts
import { bufferCount, state } from "@graphrefly/graphrefly-ts";

bufferCount(state(0), 3);
```
