---
title: "skip()"
description: "Skips the first `count` **`DATA`** emissions. `RESOLVED` does not advance the counter."
---

Skips the first `count` **`DATA`** emissions. `RESOLVED` does not advance the counter.

## Signature

```ts
function skip<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `count` | `number` | Number of `DATA` values to drop. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Skipped stream.

## Basic Usage

```ts
import { skip, state } from "@graphrefly/graphrefly-ts";

const n = skip(state(0), 2);
```
