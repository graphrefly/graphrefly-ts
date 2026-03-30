---
title: "pipe()"
description: "Composes unary operators left-to-right; returns the final node. Does not register a Graph."
---

Composes unary operators left-to-right; returns the final node. Does not register a Graph.

## Signature

```ts
function pipe(source: Node, ...ops: PipeOperator[]): Node
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node` | Starting node. |
| `ops` | `PipeOperator[]` | Each operator maps `Node` to `Node` (curried operators from `extra` use a factory pattern — wrap or use direct calls). |

## Returns

`Node` - Result of the last operator.

## Basic Usage

```ts
import { filter, map, pipe, state } from "@graphrefly/graphrefly-ts";

const src = state(1);
const out = pipe(
  src,
  (n) => map(n, (x) => x + 1),
  (n) => filter(n, (x) => x > 0),
);
```
