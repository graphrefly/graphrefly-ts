---
title: "restoreGraphCheckpoint()"
description: "Loads a snapshot via `adapter.load(graph.name)` and applies Graph.restore when data exists."
---

Loads a snapshot via `adapter.load(graph.name)` and applies Graph.restore when data exists.

## Signature

```ts
function restoreGraphCheckpoint(graph: Graph, adapter: CheckpointAdapter): boolean
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` | Graph whose topology matches the snapshot. |
| `adapter` | `CheckpointAdapter` | Sync key-value persistence backend. |

## Returns

`true` if data was present and `restore` ran; `false` if `load()` returned `null`.

## Basic Usage

```ts
import {
  saveGraphCheckpoint,
  restoreGraphCheckpoint,
  MemoryCheckpointAdapter,
  Graph,
} from "@graphrefly/graphrefly-ts";

const g = new Graph("app");
const adapter = new MemoryCheckpointAdapter();
saveGraphCheckpoint(g, adapter);

const g2 = new Graph("app");
restoreGraphCheckpoint(g2, adapter); // true
```
