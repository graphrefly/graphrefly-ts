---
title: "kvStorage()"
description: "Wraps a `StorageBackend` as a typed key-value tier.\n\nBuffer model: `save(k, v)` encodes via codec and writes to the backend\nunless debounced. Pending writes are"
---

Wraps a `StorageBackend` as a typed key-value tier.

Buffer model: `save(k, v)` encodes via codec and writes to the backend
unless debounced. Pending writes are committed on `flush()` and discarded
on `rollback()` — the wave-as-transaction model.

## Signature

```ts
function kvStorage<T>(
	backend: StorageBackend,
	opts: KvStorageOptions<T> = {},
): KvStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `backend` | `StorageBackend` | Bytes-level backend to persist records into. |
| `opts` | `KvStorageOptions&lt;T&gt;` | Optional name, codec, debounce window, compaction interval, and pre-save filter. |

## Returns

`KvStorageTier&lt;T&gt;` that supports `save`, `load`, `delete`, and `list` operations.

## Basic Usage

```ts
import { memoryBackend, kvStorage } from "@graphrefly/graphrefly/extra";

const backend = memoryBackend();
const kv = kvStorage<{ score: number }>(backend, { name: "scores" });
await kv.save("player1", { score: 100 });
const val = await kv.load("player1");
```
