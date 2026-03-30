---
title: "zip()"
description: "Zips one **`DATA`** from each source per cycle into a tuple. Only **`DATA`** enqueues (spec §1.3.3)."
---

Zips one **`DATA`** from each source per cycle into a tuple. Only **`DATA`** enqueues (spec §1.3.3).

## Signature

```ts
function zip<const T extends readonly unknown[]>(
	...sources: { [K in keyof T]: Node<T[K]> }
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `{ [K in keyof T]: Node&lt;T[K]&gt; }` | Nodes to zip (variadic). |

## Returns

`Node&lt;T&gt;` - Zipped tuples.

## Basic Usage

```ts
import { state, zip } from "@graphrefly/graphrefly-ts";

const n = zip(state(1), state(2));
```
