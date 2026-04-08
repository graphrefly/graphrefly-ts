---
title: "observeNode$()"
description: "Observe a single node in a `Graph` as an `Observable<T>`.\n\nEquivalent to `toObservable(graph.resolve(path))` but routes through\n`graph.observe()` so actor guard"
---

Observe a single node in a `Graph` as an `Observable&lt;T&gt;`.

Equivalent to `toObservable(graph.resolve(path))` but routes through
`graph.observe()` so actor guards are respected when provided.

## Signature

```ts
function observeNode$<T>(
	graph: Graph,
	path: string,
	options?: ObserveOptions,
): Observable<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` |  |
| `path` | `string` |  |
| `options` | `ObserveOptions` |  |
