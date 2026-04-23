---
title: "indexedDbStorage()"
description: "IndexedDB-backed async storage tier (browser runtime).\n\nAll three methods return `Promise`s — pairs naturally with a warm/cold\ncadence where async writes are de"
---

IndexedDB-backed async storage tier (browser runtime).

All three methods return `Promise`s — pairs naturally with a warm/cold
cadence where async writes are debounced per tier via
`Graph.attachStorage`. Writes use `readwrite` transactions; reads use
`readonly`. Missing records resolve to `null`.

## Signature

```ts
function indexedDbStorage(spec: IndexedDbStorageSpec): StorageTier
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `spec` | `IndexedDbStorageSpec` | Database name, store name, optional `key` (default
`"graphrefly_checkpoint"`) and schema `version` (default `1`). |

## Returns

Async StorageTier.

## Basic Usage

```ts
import { indexedDbStorage, memoryStorage } from "@graphrefly/graphrefly-ts";

graph.attachStorage([
    memoryStorage(),
    indexedDbStorage({ dbName: "myApp", storeName: "checkpoints" }),
  ]);
```
