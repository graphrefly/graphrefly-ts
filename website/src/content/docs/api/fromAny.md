---
title: "fromAny()"
description: "Coerces a `NodeInput<T>` (Node, scalar, Promise, Iterable, or AsyncIterable)\nto a `Node<T>`. Used by higher-order operators to normalise project returns.\n\nPass "
---

Coerces a `NodeInput&lt;T&gt;` (Node, scalar, Promise, Iterable, or AsyncIterable)
to a `Node&lt;T&gt;`. Used by higher-order operators to normalise project returns.

Pass `{ iter: true }` to opt into fromIter dispatch for Iterables
(otherwise Iterables are treated as single-value scalars via `of`).

## Signature

```ts
function fromAny<T>(
	input: NodeInput<T>,
	opts?: AsyncSourceOpts & { iter?: boolean },
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `NodeInput&lt;T&gt;` |  |
| `opts` | `AsyncSourceOpts & { iter?: boolean }` |  |
