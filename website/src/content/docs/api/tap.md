---
title: "tap()"
description: "Run `fn` for side effects; values pass through unchanged."
---

Run `fn` for side effects; values pass through unchanged.

## Signature

```ts
function tap<T>(source: Node<T>, fn: (value: T) => void, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` |  |
| `fn` | `(value: T) =&gt; void` |  |
| `opts` | `ExtraOpts` |  |
