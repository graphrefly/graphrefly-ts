---
title: "memoryWithTiers()"
description: "Attach 3-tier storage (active / archived / permanent) to a fresh distill\nstore, wiring `reactiveMap.retention` at construction so archival happens\nsynchronously"
---

Attach 3-tier storage (active / archived / permanent) to a fresh distill
store, wiring `reactiveMap.retention` at construction so archival happens
synchronously inside the substrate's mutation pipeline (no §7 feedback
cycle). Promotes `permanentKeys` and `entryCreatedAtNs` to reactive maps
mounted on the graph (Tier 4.3 B — Unit 7 Q3) so `describe()`/`explain()`
can walk to "why was X archived?".

**API shape** (Tier 4.1 B, 2026-04-29 — breaking change vs. pre-refactor):
`memoryWithTiers` constructs the distill bundle internally rather than
accepting a pre-built one. Callers pass `(graph, source, extractFn,
opts)`. The bundle is exposed as `result.store` for downstream composers
(vectors / KG / retrieval).

- `permanentFilter`-matching entries score `Infinity` in retention →
  never archived. Independent permanent-promotion effect upserts them
  into the `permanent` collection.
- Below-threshold entries → retention archives synchronously.
- Over-`maxActive` entries → retention's `maxSize` evicts lowest-scored.

## Signature

```ts
function memoryWithTiers<TRaw, TMem>(
	graph: Graph,
	source: NodeInput<TRaw>,
	extractFn: (
		raw: Node<TRaw>,
		existing: Node<ReadonlyMap<string, TMem>>,
	) => NodeInput<Extraction<TMem>>,
	opts: MemoryWithTiersOptions<TMem>,
): { store: DistillBundle<TMem>; tiers: MemoryTiersBundle<TMem>; dispose: () => void }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` |  |
| `source` | `NodeInput&lt;TRaw&gt;` |  |
| `extractFn` | `(
		raw: Node&lt;TRaw&gt;,
		existing: Node&lt;ReadonlyMap&lt;string, TMem&gt;&gt;,
	) =&gt; NodeInput&lt;Extraction&lt;TMem&gt;&gt;` |  |
| `opts` | `MemoryWithTiersOptions&lt;TMem&gt;` |  |
