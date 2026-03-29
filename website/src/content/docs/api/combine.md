---
title: "combine()"
description: "Combine latest value from each dependency whenever any dep settles (combineLatest)."
---

Combine latest value from each dependency whenever any dep settles (combineLatest).

## Signature

```ts
function combine<const T extends readonly unknown[]>(
	sources: { [K in keyof T]: Node<T[K]> },
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `{ [K in keyof T]: Node&lt;T[K]&gt; }` |  |
| `opts` | `ExtraOpts` |  |
