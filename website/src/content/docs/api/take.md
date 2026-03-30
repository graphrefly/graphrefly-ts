---
title: "take()"
description: "Emits at most `count` **`DATA`** values, then **`COMPLETE`**. `RESOLVED` does not advance the counter."
---

Emits at most `count` **`DATA`** values, then **`COMPLETE`**. `RESOLVED` does not advance the counter.

## Signature

```ts
function take<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `count` | `number` | Maximum `DATA` emissions (≤0 completes immediately). |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Limited stream.

## Basic Usage

```ts
import { take, state } from "@graphrefly/graphrefly-ts";

const n = take(state(0), 3);
```
