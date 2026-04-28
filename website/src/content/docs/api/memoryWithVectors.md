---
title: "memoryWithVectors()"
description: "Attach a vector index to a `DistillBundle`. Indexes every entry in the\nstore as it changes. Returns the `VectorIndexGraph` so retrieval can read\nits `entries` a"
---

Attach a vector index to a `DistillBundle`. Indexes every entry in the
store as it changes. Returns the `VectorIndexGraph` so retrieval can read
its `entries` and call `search()`.

The indexer's keepalive is registered with `graph.addDisposer` so it tears
down on `graph.destroy()`. The returned `dispose()` is also available for
early release without destroying the parent graph.

## Signature

```ts
function memoryWithVectors<TMem>(
	graph: Graph,
	store: DistillBundle<TMem>,
	opts: MemoryWithVectorsOptions<TMem>,
): { vectors: VectorIndexGraph<TMem>; dispose: () => void }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` |  |
| `store` | `DistillBundle&lt;TMem&gt;` |  |
| `opts` | `MemoryWithVectorsOptions&lt;TMem&gt;` |  |
