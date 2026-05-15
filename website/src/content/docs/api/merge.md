---
title: "merge()"
description: "API reference for merge."
---

## Signature

```ts
function merge<T>(...sources: readonly Node<T>[]): Node<T>
function merge<T>(...args: readonly [...Node<T>[], ExtraOpts]): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `args` | `ReadonlyArray&lt;Node&lt;T&gt; | ExtraOpts | undefined&gt;` |  |
