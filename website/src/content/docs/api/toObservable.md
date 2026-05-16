---
title: "toObservable()"
description: "API reference for toObservable."
---

## Signature

```ts
function toObservable<T>(
	node: Node<T>,
	options?: ToObservableOptions & { raw?: false },
): InteropObservable<T>
function toObservable<T>(
	node: Node<T>,
	options: ToObservableOptions & { raw: true },
): InteropObservable<Messages>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `node` | `Node&lt;T&gt;` |  |
| `options` | `ToObservableOptions` |  |
