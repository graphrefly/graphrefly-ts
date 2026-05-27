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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>project</code> | <code>(value: T) =&gt; NodeInput&lt;R&gt;</code> | Maps each outer value to an inner source shape (`Node`, scalar, `PromiseLike`, `Iterable`, or `AsyncIterable`) coerced via fromAny. |
| <code>opts</code> | <code>HigherOrderOpts & { maxBuffer?: number }</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;R&gt;` - Sequential concatenation of inner streams.

## Basic Usage

```ts
import { concatMap, state } from "@graphrefly/pure-ts";

concatMap(state(0), (n) => state((n as number) + 1));
```
