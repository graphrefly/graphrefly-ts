---
title: "indexedDbKv()"
description: "Creates an IndexedDB key-value tier backed by an `indexedDbBackend`.\n\nConvenience wrapper for `kvStorage(indexedDbBackend(spec), opts)`.\nAll reads and writes ar"
---

Creates an IndexedDB key-value tier backed by an `indexedDbBackend`.

Convenience wrapper for `kvStorage(indexedDbBackend(spec), opts)`.
All reads and writes are async via IndexedDB. Requires a browser or
browser-compatible environment.

## Signature

```ts
function indexedDbKv<T>(
	spec: IndexedDbBackendSpec,
	opts?: Omit<KvStorageOptions<T>, "name"> & { name?: string },
): KvStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `spec` | `IndexedDbBackendSpec` | Database name, object store name, and optional schema version. |
| `opts` | `Omit&lt;KvStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional kv storage options (name, codec, filter, debounce, compactEvery). |

## Returns

`KvStorageTier&lt;T&gt;` backed by IndexedDB.

## Basic Usage

```ts
import { indexedDbKv } from "@graphrefly/graphrefly/extra/browser";

const kv = indexedDbKv<{ score: number }>(
  { dbName: "my-app", storeName: "scores" },
);
await kv.save("player1", { score: 100 });
const val = await kv.load("player1");
```
