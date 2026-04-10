---
title: "toObservable()"
description: "API reference for toObservable."
---

## Signature

```ts
function toObservable<T>(
	node: Node<T>,
	options?: ToObservableOptions & { raw?: false },
): Observable<T>
function toObservable<T>(
	node: Node<T>,
	options: ToObservableOptions & { raw: true },
): Observable<Messages>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `node` | `Node&lt;T&gt;` |  |
| `options` | `ToObservableOptions` |  |
