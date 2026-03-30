---
title: "flatMap()"
description: "RxJS-named alias for mergeMap — projects each `DATA` to an inner node and merges outputs."
---

RxJS-named alias for mergeMap — projects each `DATA` to an inner node and merges outputs.

## Signature

```ts
function mergeMap<T, R>(
	source: Node<T>,
	project: (value: T) => NodeInput<R>,
	opts?: MergeMapOptions,
): Node<R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `project` | `(value: T) =&gt; NodeInput&lt;R&gt;` | Maps each outer value to an inner source shape (`Node`, scalar, `PromiseLike`, `Iterable`, or `AsyncIterable`) coerced via fromAny. |
| `opts` | `MergeMapOptions` | Optional options including `concurrent` limit. |

## Returns

Merged projection; behavior matches `mergeMap`.

## Basic Usage

```ts
import { flatMap, state } from "@graphrefly/graphrefly-ts";

flatMap(state(0), (n) => state(n));
```
