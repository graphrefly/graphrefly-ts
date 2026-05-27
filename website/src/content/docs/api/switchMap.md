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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>project</code> | <code>(value: T) =&gt; NodeInput&lt;R&gt;</code> | Maps each outer value to an inner source shape (`Node`, scalar, `PromiseLike`, `Iterable`, or `AsyncIterable`) coerced via fromAny. |
| <code>opts</code> | <code>HigherOrderOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;R&gt;` - Emissions from the active inner subscription.

## Basic Usage

```ts
import { switchMap, state } from "@graphrefly/pure-ts";

const src = state(0);
switchMap(src, (n) => state((n as number) * 2));
```
