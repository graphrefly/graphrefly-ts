---
title: "mergeMap()"
description: "Subscribes to inner nodes in parallel (up to `concurrent`) and merges outputs (`mergeMap` / `flatMap`)."
---

Subscribes to inner nodes in parallel (up to `concurrent`) and merges outputs (`mergeMap` / `flatMap`).

## Signature

```ts
function mergeMap<T, R>(
	source: Node<T>,
	project: (value: T) => Node<R>,
	opts?: MergeMapOptions,
): Node<R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `project` | `(value: T) =&gt; Node&lt;R&gt;` | Maps each outer value to an inner node. |
| `opts` | `MergeMapOptions` | Optional options including `concurrent` limit. |

## Returns

`Node&lt;R&gt;` - Merged output of all active inners; completes when the outer and every inner complete.

## Basic Usage

```ts
import { mergeMap, state } from "@graphrefly/graphrefly-ts";

// Unbounded (default)
mergeMap(state(0), (n) => state((n as number) + 1));

// Limited concurrency
mergeMap(state(0), (n) => state((n as number) + 1), { concurrent: 3 });
```
