---
title: "effect()"
description: "Runs a side-effect when deps settle; return value is not auto-emitted."
---

Runs a side-effect when deps settle; return value is not auto-emitted.

## Signature

```ts
function effect(
	deps: readonly Node[],
	fn: NodeFn<unknown>,
	opts?: NodeOptions,
): Node<unknown>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `readonly Node[]` | Nodes to watch. |
| `fn` | `NodeFn&lt;unknown&gt;` | Side-effect body. |
| `opts` | `NodeOptions` |  |

## Returns

`Node&lt;unknown&gt;` - Effect node.

## Basic Usage

```ts
import { effect, state } from "@graphrefly/graphrefly-ts";

const n = state(1);
effect([n], ([v]) => {
    console.log(v);
  });
```
