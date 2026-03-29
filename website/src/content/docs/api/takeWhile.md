---
title: "takeWhile()"
description: "Emit values while `predicate` holds; then `COMPLETE`."
---

Emit values while `predicate` holds; then `COMPLETE`.

## Signature

```ts
function takeWhile<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` |  |
| `predicate` | `(value: T) =&gt; boolean` |  |
| `opts` | `ExtraOpts` |  |
