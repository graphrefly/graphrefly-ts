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

The node participates in diamond resolution via the pre-set dirty mask
(shared with NodeImpl).

**Lazy-dep composition:** when a tracked dep is itself a lazy compute node
whose first subscribe causes a fresh value to arrive, the rewire buffer
detects the discrepancy and re-runs fn once so it observes the real value.
Capped at MAX_RERUN iterations.

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

const d = dynamicNode((get) => {
    const useA = get(cond);
    return useA ? get(a) : get(b);
  });
```
