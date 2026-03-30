---
title: "combine()"
description: "Combines the latest value from each dependency whenever any dep settles (combineLatest)."
---

Combines the latest value from each dependency whenever any dep settles (combineLatest).

## Signature

```ts
function combine<const T extends readonly unknown[]>(
	...sources: { [K in keyof T]: Node<T[K]> }
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `{ [K in keyof T]: Node&lt;T[K]&gt; }` | Nodes to combine (variadic). |

## Returns

`Node&lt;T&gt;` - Tuple of latest values.

## Basic Usage

```ts
import { combine, state } from "@graphrefly/graphrefly-ts";

const n = combine(state(1), state("a"));
```

## Behavior Details

- Unlike RxJS `combineLatest`, this is named `combine`. Use the combineLatest alias
if you prefer the RxJS name. Seed is always required for `scan`/`reduce` (no seedless mode).
