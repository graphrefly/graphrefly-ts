---
title: "saveGraphCheckpoint()"
description: "Writes Graph.snapshot through `adapter.save` using `graph.name` as key."
---

Writes Graph.snapshot through `adapter.save` using `graph.name` as key.

## Signature

```ts
function saveGraphCheckpoint(graph: Graph, adapter: CheckpointAdapter): void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` | Target graph instance. |
| `adapter` | `CheckpointAdapter` | Sync key-value persistence backend. |

## Returns

`void` — side-effect only; the snapshot is written to `adapter`.

## Basic Usage

```ts
import { saveGraphCheckpoint, MemoryCheckpointAdapter, Graph } from "@graphrefly/graphrefly-ts";

const g = new Graph("app");
const adapter = new MemoryCheckpointAdapter();
saveGraphCheckpoint(g, adapter);
```
