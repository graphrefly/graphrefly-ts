---
title: "takeWhile()"
description: "Emits while `predicate` holds; on first false, sends **`COMPLETE`**."
---

Emits while `predicate` holds; on first false, sends **`COMPLETE`**.

## Signature

```ts
function takeWhile<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `predicate` | `(value: T) =&gt; boolean` | Continuation test. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Truncated stream.

## Basic Usage

```ts
import { takeWhile, state } from "@graphrefly/graphrefly-ts";

const n = takeWhile(state(1), (x) => x < 10);
```
