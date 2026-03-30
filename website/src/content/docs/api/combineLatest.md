---
title: "combineLatest()"
description: "RxJS-named alias for combine — emits when any dep updates with latest tuple of values."
---

RxJS-named alias for combine — emits when any dep updates with latest tuple of values.

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

Combined node; signature matches `combine`.

## Basic Usage

```ts
import { combineLatest, state } from "@graphrefly/graphrefly-ts";

const n = combineLatest(state(1), state("a"));
```

## Behavior Details

- Unlike RxJS `combineLatest`, this is named `combine`. Use the combineLatest alias
if you prefer the RxJS name. Seed is always required for `scan`/`reduce` (no seedless mode).
