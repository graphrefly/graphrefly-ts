---
title: "producer()"
description: "Creates a producer node with no deps; `fn` runs when the first subscriber connects."
---

Creates a producer node with no deps; `fn` runs when the first subscriber connects.

## Signature

```ts
function producer<T = unknown>(fn: NodeFn<T>, opts?: NodeOptions): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `NodeFn&lt;T&gt;` | Receives deps (empty) and NodeActions; use `emit` / `down` to push. |
| `opts` | `NodeOptions` | Optional NodeOptions. |

## Returns

`Node&lt;T&gt;` - Producer node.

## Basic Usage

```ts
import { producer } from "@graphrefly/graphrefly-ts";

const tick = producer((_d, a) => {
    a.emit(1);
  });
```
