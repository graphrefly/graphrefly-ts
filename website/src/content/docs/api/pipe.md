---
title: "pipe()"
description: "Linear composition: returns the last node in the chain. Does not register a Graph."
---

Linear composition: returns the last node in the chain. Does not register a Graph.

## Signature

```ts
function pipe(source: Node, ...ops: PipeOperator[]): Node
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node` |  |
| `ops` | `PipeOperator[]` |  |
