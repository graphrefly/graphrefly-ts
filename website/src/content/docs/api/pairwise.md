---
title: "pairwise()"
description: "Emit `[previous, current]` pairs (starts after the second source value)."
---

Emit `[previous, current]` pairs (starts after the second source value).

## Signature

```ts
function pairwise<T>(source: Node<T>, opts?: ExtraOpts): Node<readonly [T, T]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` |  |
| `opts` | `ExtraOpts` |  |
