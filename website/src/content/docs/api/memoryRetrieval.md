---
title: "memoryRetrieval()"
description: "Build the retrieval pipeline (vector + KG + budget packing) over a\n`DistillBundle` and optional `vectors` / `kg` substrates. Returns a\n`MemoryRetrievalGraph` ex"
---

Build the retrieval pipeline (vector + KG + budget packing) over a
`DistillBundle` and optional `vectors` / `kg` substrates. Returns a
`MemoryRetrievalGraph` exposing `retrieval` / `retrievalTrace` reactive
state and `retrieve` / `retrieveReactive` consumer methods.

## Signature

```ts
function memoryRetrieval<TMem>(
	opts: MemoryRetrievalOptions<TMem>,
): MemoryRetrievalGraph<TMem>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `MemoryRetrievalOptions&lt;TMem&gt;` |  |
