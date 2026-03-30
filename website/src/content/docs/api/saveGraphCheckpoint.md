---
title: "saveGraphCheckpoint()"
description: "Writes Graph.snapshot through `adapter.save`."
---

Writes Graph.snapshot through `adapter.save`.

## Signature

```ts
function saveGraphCheckpoint(graph: Graph, adapter: CheckpointAdapter): void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` | Target graph instance. |
| `adapter` | `CheckpointAdapter` | Sync persistence backend. |
