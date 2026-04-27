---
title: "appendLogStorage()"
description: "Wraps a `StorageBackend` as a typed append-log tier.\n\nBuffer model: `appendEntries(entries)` accumulates per-key buckets in\nmemory. `flush()` encodes each bucke"
---

Wraps a `StorageBackend` as a typed append-log tier.

Buffer model: `appendEntries(entries)` accumulates per-key buckets in
memory. `flush()` encodes each bucket as a JSON array via codec and writes
under that bucket key. `rollback()` discards pending appends.

Storage shape: each backend key holds a JSON array of all entries for that
partition, growing on every flush. Adapters that need true append semantics
(versus rewrite) should layer their own tier impl over the same backend.

## Signature

```ts
function appendLogStorage<T>(
	backend: StorageBackend,
	opts: AppendLogStorageOptions<T> = {},
): AppendLogStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `backend` | `StorageBackend` | Bytes-level backend to persist log entries into. |
| `opts` | `AppendLogStorageOptions&lt;T&gt;` | Optional name, codec, per-entry key extractor, debounce window, and compaction interval. |

## Returns

`AppendLogStorageTier&lt;T&gt;` that buffers pending entries and flushes per-key buckets on wave-close.

## Basic Usage

```ts
import { memoryBackend, appendLogStorage } from "@graphrefly/graphrefly/extra";

const backend = memoryBackend();
const tier = appendLogStorage<{ type: string; payload: unknown }>(backend, { name: "events" });
await tier.appendEntries([{ type: "created", payload: { id: 1 } }]);
const result = await tier.loadEntries?.();
```
