---
title: "scan()"
description: "Fold: each emission updates an accumulator; output is the new accumulator."
---

Fold: each emission updates an accumulator; output is the new accumulator.

## Signature

```ts
function scan<T, R>(
	source: Node<T>,
	reducer: (acc: R, value: T) => R,
	seed: R,
	opts?: ExtraOpts,
): Node<R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` |  |
| `reducer` | `(acc: R, value: T) =&gt; R` |  |
| `seed` | `R` |  |
| `opts` | `ExtraOpts` |  |
