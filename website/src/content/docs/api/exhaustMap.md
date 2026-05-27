---
title: "exhaustMap()"
description: "Like switchMap, but ignores outer `DATA` while an inner subscription is active (`exhaustMap`)."
---

Like switchMap, but ignores outer `DATA` while an inner subscription is active (`exhaustMap`).

## Signature

```ts
function exhaustMap<T, R>(
	source: Node<T>,
	project: (value: T) => NodeInput<R>,
	opts?: HigherOrderOpts,
): Node<R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>project</code> | <code>(value: T) =&gt; NodeInput&lt;R&gt;</code> | Maps each outer value to an inner source shape (`Node`, scalar, `PromiseLike`, `Iterable`, or `AsyncIterable`) coerced via fromAny. |
| <code>opts</code> | <code>HigherOrderOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;R&gt;` - Emissions from the active inner while it runs.

## Basic Usage

```ts
import { exhaustMap, state } from "@graphrefly/pure-ts";

exhaustMap(state(0), () => state(1));
```
