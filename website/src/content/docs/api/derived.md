---
title: "derived()"
description: "Creates a derived node from dependencies and a compute function (same primitive as operators)."
---

Creates a derived node from dependencies and a compute function (same primitive as operators).

## Signature

```ts
function derived<T = unknown>(
	deps: readonly Node[],
	fn: NodeFn<T>,
	opts?: NodeOptions,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `readonly Node[]` | Upstream nodes. |
| `fn` | `NodeFn&lt;T&gt;` | Compute function; return value is emitted, or use `actions` explicitly. |
| `opts` | `NodeOptions` | Optional NodeOptions. |

## Returns

`Node&lt;T&gt;` - Derived node.

## Basic Usage

```ts
import { derived, state } from "@graphrefly/graphrefly-ts";

const a = state(1);
const b = derived([a], ([x]) => (x as number) * 2);
```
