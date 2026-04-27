---
title: "indexedDbSnapshot()"
description: "Creates an IndexedDB snapshot tier backed by an `indexedDbBackend`.\n\nConvenience wrapper for `snapshotStorage(indexedDbBackend(spec), opts)`.\nAll reads and writ"
---

Creates an IndexedDB snapshot tier backed by an `indexedDbBackend`.

Convenience wrapper for `snapshotStorage(indexedDbBackend(spec), opts)`.
All reads and writes are async via IndexedDB. Requires a browser or
browser-compatible environment.

## Signature

```ts
function indexedDbSnapshot<T>(
	spec: IndexedDbBackendSpec,
	opts?: Omit<SnapshotStorageOptions<T>, "name"> & { name?: string },
): SnapshotStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `spec` | `IndexedDbBackendSpec` | Database name, object store name, and optional schema version. |
| `opts` | `Omit&lt;SnapshotStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional snapshot storage options (name, codec, filter, keyOf, debounce, compactEvery). |

## Returns

`SnapshotStorageTier&lt;T&gt;` backed by IndexedDB.

## Basic Usage

```ts
import { indexedDbSnapshot } from "@graphrefly/graphrefly/extra/browser";

const tier = indexedDbSnapshot<{ count: number }>(
  { dbName: "my-app", storeName: "snapshots" },
  { name: "counter" },
);
await tier.save({ count: 1 });
```
