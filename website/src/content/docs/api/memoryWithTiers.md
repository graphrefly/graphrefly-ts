---
title: "memoryWithTiers()"
description: "Attach 3-tier storage (active / archived / permanent) to a `DistillBundle`.\nWires a `tierClassifier` effect that:\n- Promotes entries matching `permanentFilter` "
---

Attach 3-tier storage (active / archived / permanent) to a `DistillBundle`.
Wires a `tierClassifier` effect that:
- Promotes entries matching `permanentFilter` into the permanent tier.
- Archives entries whose decayed score falls below `archiveThreshold`.
- Caps the active tier at `maxActive`, evicting lowest-scored on overflow.

**Closure state caveat (Unit 7 Q3 deferred):** `permanentKeys` +
`entryCreatedAtNs` are still closure-held for now; promotion to reactive
nodes is tracked in `docs/optimizations.md`.

## Signature

```ts
function memoryWithTiers<TMem>(
	graph: Graph,
	store: DistillBundle<TMem>,
	opts: MemoryWithTiersOptions<TMem>,
): { tiers: MemoryTiersBundle<TMem>; dispose: () => void }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` |  |
| `store` | `DistillBundle&lt;TMem&gt;` |  |
| `opts` | `MemoryWithTiersOptions&lt;TMem&gt;` |  |
