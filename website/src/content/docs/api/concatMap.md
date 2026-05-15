---
title: "concatMap()"
description: "Enqueues each outer value and subscribes to inners one at a time (`concatMap`)."
---

Enqueues each outer value and subscribes to inners one at a time (`concatMap`).

## Signature

```ts
function concatMap<T, R>(
	source: Node<T>,
	project: (value: T) => NodeInput<R>,
	opts?: HigherOrderOpts & { maxBuffer?: number },
): Node<R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `project` | `(value: T) =&gt; NodeInput&lt;R&gt;` | Maps each outer value to an inner source shape (`Node`, scalar, `PromiseLike`, `Iterable`, or `AsyncIterable`) coerced via fromAny. |
| `opts` | `HigherOrderOpts & { maxBuffer?: number }` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;R&gt;` - Sequential concatenation of inner streams.

## Basic Usage

```ts
import { concatMap, state } from "@graphrefly/graphrefly-ts";

concatMap(state(0), (n) => state((n as number) + 1));
```
