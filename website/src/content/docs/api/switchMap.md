---
title: "switchMap()"
description: "Maps each settled value to an inner node; unsubscribes the previous inner (Rx-style `switchMap`)."
---

Maps each settled value to an inner node; unsubscribes the previous inner (Rx-style `switchMap`).

## Signature

```ts
function switchMap<T, R>(
	source: Node<T>,
	project: (value: T) => NodeInput<R>,
	opts?: HigherOrderOpts,
): Node<R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `project` | `(value: T) =&gt; NodeInput&lt;R&gt;` | Maps each outer value to an inner source shape (`Node`, scalar, `PromiseLike`, `Iterable`, or `AsyncIterable`) coerced via fromAny. |
| `opts` | `HigherOrderOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;R&gt;` - Emissions from the active inner subscription.

## Basic Usage

```ts
import { switchMap, state } from "@graphrefly/graphrefly-ts";

const src = state(0);
switchMap(src, (n) => state((n as number) * 2));
```
