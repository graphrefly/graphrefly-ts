---
title: "find()"
description: "First value matching `predicate`, then `COMPLETE`."
---

First value matching `predicate`, then `COMPLETE`.

## Signature

```ts
function find<T>(
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
