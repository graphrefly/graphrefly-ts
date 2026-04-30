---
title: "memoryWithVectors()"
description: "Attach a vector index to a `DistillBundle`. Indexes every entry in the\nstore as it changes. Returns the `MemoryWithVectorsGraph` whose `vectors`\nfield exposes t"
---

Attach a vector index to a `DistillBundle`. Indexes every entry in the
store as it changes. Returns the `MemoryWithVectorsGraph` whose `vectors`
field exposes the underlying `VectorIndexGraph`.

Teardown is handled by `Graph.destroy()` — typically inherited via
mounting the result on a parent graph (see `agentMemory`).

## Signature

```ts
function memoryWithVectors<TMem>(
	opts: MemoryWithVectorsOptions<TMem>,
): MemoryWithVectorsGraph<TMem>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `MemoryWithVectorsOptions&lt;TMem&gt;` |  |
