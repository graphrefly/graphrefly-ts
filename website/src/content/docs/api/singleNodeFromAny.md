---
title: "singleNodeFromAny()"
description: "Reactive variant: returns a bound callable that hands out `Node<T>` values.\nAll concurrent callers with the same key during an in-flight source share\nthe same N"
---

Reactive variant: returns a bound callable that hands out `Node&lt;T&gt;` values.
All concurrent callers with the same key during an in-flight source share
the same Node. When the underlying source **terminally** settles (ERROR
or COMPLETE), the Node is removed from the cache so the next call
re-invokes `factory`. DATA is NOT terminal — callers subscribing after
the first DATA still receive the shared Node (and push-on-subscribe per
the spec's cached-DATA contract).

Use when downstream wants reactive subscription (not a one-shot Promise).

## Signature

```ts
function singleNodeFromAny<K, T>(
	factory: (key: K) => NodeInput<T>,
	opts: SingleFromAnyOptions<K> = {},
): (key: K) => Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `factory` | `(key: K) =&gt; NodeInput&lt;T&gt;` |  |
| `opts` | `SingleFromAnyOptions&lt;K&gt;` |  |
