---
title: "indexedDbBackend()"
description: "Creates an IndexedDB backend for browser-based persistent storage.\n\nAll operations (`read`, `write`, `delete`, `list`) are async and return\n`Promise`. The backi"
---

Creates an IndexedDB backend for browser-based persistent storage.

All operations (`read`, `write`, `delete`, `list`) are async and return
`Promise`. The backing object store is created automatically on first open
if it does not already exist.

## Signature

```ts
function indexedDbBackend(spec: IndexedDbBackendSpec): StorageBackend
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `spec` | `IndexedDbBackendSpec` | Database name, object store name, and optional schema version. |

## Returns

`StorageBackend` backed by an IndexedDB object store.

## Basic Usage

```ts
import { indexedDbBackend, snapshotStorage } from "@graphrefly/graphrefly/extra/browser";

const backend = indexedDbBackend({ dbName: "my-app", storeName: "snapshots" });
const tier = snapshotStorage(backend, { name: "graph1" });
await tier.save({ name: "graph1", state: {} });
```
