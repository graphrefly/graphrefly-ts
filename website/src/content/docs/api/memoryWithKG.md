---
title: "memoryWithKG()"
description: "Attach a knowledge graph alongside a `DistillBundle`. Returns the\n`MemoryWithKGGraph` whose `kg` field exposes the inner `KnowledgeGraph`."
---

Attach a knowledge graph alongside a `DistillBundle`. Returns the
`MemoryWithKGGraph` whose `kg` field exposes the inner `KnowledgeGraph`.

## Signature

```ts
function memoryWithKG<TMem>(opts: MemoryWithKGOptions<TMem>): MemoryWithKGGraph<TMem>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `MemoryWithKGOptions&lt;TMem&gt;` |  |
