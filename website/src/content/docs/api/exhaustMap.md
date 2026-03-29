---
title: "exhaustMap()"
description: "Like , but ignores outer `DATA` while an inner subscription is active (`exhaustMap`)."
---

Like , but ignores outer `DATA` while an inner subscription is active (`exhaustMap`).

## Signature

```ts
function exhaustMap<T, R>(
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

`Node&lt;R&gt;` - Emissions from the active inner while it runs.

## Basic Usage

```ts
import { exhaustMap, state } from "@graphrefly/graphrefly-ts";

exhaustMap(state(0), () => state(1));
```
