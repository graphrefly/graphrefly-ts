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
| <code>node</code> | <code>Node&lt;T&gt;</code> |  |
| <code>options</code> | <code>ToObservableOptions</code> |  |
