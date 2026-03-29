---
title: "distinctUntilChanged()"
description: "Suppress adjacent duplicates; delegates to node-level `equals` (default `Object.is`)."
---

Suppress adjacent duplicates; delegates to node-level `equals` (default `Object.is`).

## Signature

```ts
function distinctUntilChanged<T>(
	source: Node<T>,
	equals: (a: T, b: T) => boolean = Object.is,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` |  |
| `equals` | `(a: T, b: T) =&gt; boolean` |  |
| `opts` | `ExtraOpts` |  |
