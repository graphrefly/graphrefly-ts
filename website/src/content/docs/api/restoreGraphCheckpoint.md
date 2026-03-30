---
title: "restoreGraphCheckpoint()"
description: "Loads a snapshot via `adapter.load` and applies Graph.restore when data exists."
---

Loads a snapshot via `adapter.load` and applies Graph.restore when data exists.

## Signature

```ts
function restoreGraphCheckpoint(graph: Graph, adapter: CheckpointAdapter): boolean
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` | Graph whose topology matches the snapshot. |
| `adapter` | `CheckpointAdapter` | Sync persistence backend. |

## Returns

`true` if data was present and `restore` ran; `false` if `load()` returned `null`.
