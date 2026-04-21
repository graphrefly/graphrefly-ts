---
title: "singleFromAny()"
description: "Dedupe concurrent `factory(key)` invocations. Returns a bound callable."
---

Dedupe concurrent `factory(key)` invocations. Returns a bound callable.

## Signature

```ts
function singleFromAny<K, T>(
	factory: (key: K) => NodeInput<T>,
	opts: SingleFromAnyOptions<K> = {},
): (key: K) => Promise<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `factory` | `(key: K) =&gt; NodeInput&lt;T&gt;` | Produces a `NodeInput&lt;T&gt;` for each unique key. |
| `opts` | `SingleFromAnyOptions&lt;K&gt;` | Optional key-stringification. |

## Returns

A function `(key: K) =&gt; Promise&lt;T&gt;` whose inflight results are shared per key.
