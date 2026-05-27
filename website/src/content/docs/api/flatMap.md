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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>project</code> | <code>(value: T) =&gt; NodeInput&lt;R&gt;</code> | Maps each outer value to an inner source shape (`Node`, scalar, `PromiseLike`, `Iterable`, or `AsyncIterable`) coerced via fromAny. |
| <code>opts</code> | <code>MergeMapOptions</code> | Optional options including `concurrent` limit. |

## Returns

Merged projection; behavior matches `mergeMap`.

## Basic Usage

```ts
import { flatMap, state } from "@graphrefly/pure-ts";

flatMap(state(0), (n) => state(n));
```

## Behavior Details

- **ERROR handling:** An `ERROR` from the outer source cancels all active inner
subscriptions and propagates the error downstream. An `ERROR` from an inner
subscription propagates downstream immediately but does **not** cancel sibling
inner subscriptions — other active inners continue until they complete or the
outer errors/completes. This is intentional: for parallel work, isolating
failures per-inner is more useful than Rx-style "first error cancels all."
