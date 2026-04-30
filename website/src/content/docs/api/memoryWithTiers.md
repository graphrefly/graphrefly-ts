---
title: "memoryWithTiers()"
description: "Attach 3-tier storage (active / archived / permanent) over a fresh distill\nstore. Returns a `MemoryWithTiersGraph` whose `store` and `tiers` fields\nmirror the p"
---

Attach 3-tier storage (active / archived / permanent) over a fresh distill
store. Returns a `MemoryWithTiersGraph` whose `store` and `tiers` fields
mirror the previous bundle shape.

**API shape** (Class B audit, 2026-04-30 — breaking change vs.
pre-migration): the factory takes a single opts bag including `source`
and `extractFn`. The bundle is exposed as `result.store` for downstream
composers (vectors / KG / retrieval).

- `permanentFilter`-matching entries score `Infinity` in retention →
  never archived. Independent permanent-promotion effect upserts them
  into the `permanent` collection.
- Below-threshold entries → retention archives synchronously.
- Over-`maxActive` entries → retention's `maxSize` evicts lowest-scored.

## Signature

```ts
function memoryWithTiers<TRaw, TMem>(
	opts: MemoryWithTiersOptions<TRaw, TMem>,
): MemoryWithTiersGraph<TRaw, TMem>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `MemoryWithTiersOptions&lt;TRaw, TMem&gt;` |  |
