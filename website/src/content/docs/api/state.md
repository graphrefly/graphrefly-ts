---
title: "state()"
description: "Creates a manual source with no upstream deps. Emit values with Node.down.\n\nSpec: `state(initial, opts?)` is `node([], { initial, ...opts })` (GRAPHREFLY-SPEC §"
---

Creates a manual source with no upstream deps. Emit values with Node.down.

Spec: `state(initial, opts?)` is `node([], { initial, ...opts })` (GRAPHREFLY-SPEC §2.7).

## Signature

```ts
function state<T>(initial: T, opts?: Omit<NodeOptions, "initial">): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `T` | Initial cached value. |
| `opts` | `Omit&lt;NodeOptions, "initial"&gt;` | Optional NodeOptions (excluding `initial`). |

## Returns

`Node&lt;T&gt;` - Stateful node you drive imperatively.

## Basic Usage

```ts
import { DATA, state } from "@graphrefly/graphrefly-ts";

const n = state(0);
n.down([[DATA, 1]]);
```
