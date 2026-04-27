---
title: "indexedDbAppendLog()"
description: "Creates an IndexedDB append-log tier backed by an `indexedDbBackend`.\n\nConvenience wrapper for `appendLogStorage(indexedDbBackend(spec), opts)`.\nAll reads and w"
---

Creates an IndexedDB append-log tier backed by an `indexedDbBackend`.

Convenience wrapper for `appendLogStorage(indexedDbBackend(spec), opts)`.
All reads and writes are async via IndexedDB. Requires a browser or
browser-compatible environment.

## Signature

```ts
function indexedDbAppendLog<T>(
	spec: IndexedDbBackendSpec,
	opts?: Omit<AppendLogStorageOptions<T>, "name"> & { name?: string },
): AppendLogStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `spec` | `IndexedDbBackendSpec` | Database name, object store name, and optional schema version. |
| `opts` | `Omit&lt;AppendLogStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional append-log storage options (name, codec, keyOf, debounce, compactEvery). |

## Returns

`AppendLogStorageTier&lt;T&gt;` backed by IndexedDB.

## Basic Usage

```ts
import { indexedDbAppendLog } from "@graphrefly/graphrefly/extra/browser";

const tier = indexedDbAppendLog<{ type: string }>(
  { dbName: "my-app", storeName: "events" },
);
await tier.appendEntries([{ type: "init" }]);
```
