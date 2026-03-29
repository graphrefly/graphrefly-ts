---
title: "mergeMap()"
description: "Subscribes to every inner in parallel and merges outputs (`mergeMap` / `flatMap`)."
---

Subscribes to every inner in parallel and merges outputs (`mergeMap` / `flatMap`).

## Signature

```ts
function mergeMap<T, R>(
	source: Node<T>,
	project: (value: T) => Node<R>,
	opts?: ExtraOpts,
): Node<R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `project` | `(value: T) =&gt; Node&lt;R&gt;` | Maps each outer value to an inner node. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;R&gt;` - Merged output of all active inners; completes when the outer and every inner complete.

## Basic Usage

```ts
import { mergeMap, state } from "@graphrefly/graphrefly-ts";

mergeMap(state(0), (n) => state((n as number) + 1));
```
