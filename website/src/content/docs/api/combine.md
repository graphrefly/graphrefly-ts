---
title: "combine()"
description: "Combines the latest value from each dependency whenever any dep settles (combineLatest)."
---

Combines the latest value from each dependency whenever any dep settles (combineLatest).

## Signature

```ts
function combine<const T extends readonly unknown[]>(
	sources: { [K in keyof T]: Node<T[K]> },
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `{ [K in keyof T]: Node&lt;T[K]&gt; }` | Tuple of nodes (fixed arity preserves tuple type). |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Tuple of latest values.

## Basic Usage

```ts
import { combine, state } from "@graphrefly/graphrefly-ts";

const n = combine([state(1), state("a")] as const);
```
