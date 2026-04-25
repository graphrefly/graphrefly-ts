---
title: "memoryWithKG()"
description: "Attach a knowledge graph alongside a `DistillBundle`. Inner graph is named\n`${name}-kg`; mount path defaults to `name` but can be overridden via\n`opts.mountPath"
---

Attach a knowledge graph alongside a `DistillBundle`. Inner graph is named
`${name}-kg`; mount path defaults to `name` but can be overridden via
`opts.mountPath` so a parent factory (e.g. `agentMemory`) can keep a stable
mount path independent of the inner graph's identity.

If `opts.entityFn` is omitted, no indexer effect is wired — the empty KG is
mounted for manual `upsertEntity` / `link` use.

Indexer keepalive (when present) is registered with `graph.addDisposer`;
explicit `dispose()` is also available.

## Signature

```ts
function memoryWithKG<TMem>(
	graph: Graph,
	store: DistillBundle<TMem>,
	name: string,
	opts: MemoryWithKGOptions<TMem>,
): { kg: KnowledgeGraphGraph<unknown, string>; dispose: () => void }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` |  |
| `store` | `DistillBundle&lt;TMem&gt;` |  |
| `name` | `string` |  |
| `opts` | `MemoryWithKGOptions&lt;TMem&gt;` |  |
