---
title: "pipe()"
description: "Composes unary operators left-to-right; returns the final node."
---

Composes unary operators left-to-right; returns the final node.

## Signature

```ts
function pipe(source: Node, ...ops: PipeOperator[]): Node
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node</code> |  |
| <code>ops</code> | <code>PipeOperator[]</code> |  |

## Basic Usage

```ts
const out = pipe(
  source,
  (n) => map(n, (x) => x + 1),
  (n) => filter(n, (x) => x > 0),
);
```
