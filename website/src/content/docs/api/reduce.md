---
title: "reduce()"
description: "Reduce to a single value emitted when `source` completes. On an empty completion (no prior\n`DATA`), emits `seed`."
---

Reduce to a single value emitted when `source` completes. On an empty completion (no prior
`DATA`), emits `seed`.

## Signature

```ts
function reduce<T, R>(
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
