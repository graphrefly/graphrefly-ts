---
title: "memoryRetrieval()"
description: "Build the retrieval pipeline (vector + KG + budget packing) over a\n`DistillBundle` and optional `vectors` / `kg` bundles.\n\nBoth consumer surfaces (`retrieve`, `"
---

Build the retrieval pipeline (vector + KG + budget packing) over a
`DistillBundle` and optional `vectors` / `kg` bundles.

Both consumer surfaces (`retrieve`, `retrieveReactive`) write to the same
`retrieval` + `retrievalTrace` state nodes — observers subscribed to those
see ALL queries regardless of which API issued them.

## Signature

```ts
function memoryRetrieval<TMem>(
	graph: Graph,
	store: DistillBundle<TMem>,
	vectors: VectorIndexGraph<TMem> | null,
	kg: KnowledgeGraph<unknown, string> | null,
	opts: MemoryRetrievalOptions<TMem>,
): MemoryRetrievalBundle<TMem>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` |  |
| `store` | `DistillBundle&lt;TMem&gt;` |  |
| `vectors` | `VectorIndexGraph&lt;TMem&gt; | null` |  |
| `kg` | `KnowledgeGraph&lt;unknown, string&gt; | null` |  |
| `opts` | `MemoryRetrievalOptions&lt;TMem&gt;` |  |
