---
title: "dynamicNode()"
description: "Creates a node with runtime dep tracking. Deps are discovered each time the\ncompute function runs by tracking which nodes are passed to the `get()` proxy.\n\nAfte"
---

Creates a node with runtime dep tracking. Deps are discovered each time the
compute function runs by tracking which nodes are passed to the `get()` proxy.

After each recompute:
- New deps (not in previous set) are subscribed
- Removed deps (not in current set) are unsubscribed
- Kept deps retain their existing subscriptions
- Bitmasks are rebuilt to match the new dep set

The node participates fully in diamond resolution via the standard two-phase
DIRTY/RESOLVED protocol across all dynamically-tracked deps.

## Signature

```ts
function dynamicNode<T = unknown>(fn: DynamicNodeFn<T>, opts?: DynamicNodeOptions): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `DynamicNodeFn&lt;T&gt;` | Compute function receiving a tracking `get` proxy. |
| `opts` | `DynamicNodeOptions` | Optional configuration. |

## Returns

`Node&lt;T&gt;` with dynamic dep tracking.

## Basic Usage

```ts
import { dynamicNode, state } from "@graphrefly/graphrefly-ts";

const cond = state(true);
const a = state(1);
const b = state(2);

// Deps change based on cond's value
const d = dynamicNode((get) => {
    const useA = get(cond);
    return useA ? get(a) : get(b);
  });
```
