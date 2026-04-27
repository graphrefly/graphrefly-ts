---
title: "snapshotStorage()"
description: "Wraps a `StorageBackend` as a typed snapshot tier.\n\nBuffer model: `save(snapshot)` accumulates one pending snapshot in memory.\n`flush()` encodes via codec and w"
---

Wraps a `StorageBackend` as a typed snapshot tier.

Buffer model: `save(snapshot)` accumulates one pending snapshot in memory.
`flush()` encodes via codec and writes to the backend under
`keyOf(snapshot)` (default `name ?? "snapshot"`). `rollback()` discards
the pending write.

## Signature

```ts
function snapshotStorage<T>(
	backend: StorageBackend,
	opts: SnapshotStorageOptions<T> = {},
): SnapshotStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `backend` | `StorageBackend` | Bytes-level backend to persist snapshots into. |
| `opts` | `SnapshotStorageOptions&lt;T&gt;` | Optional name, codec, debounce window, compaction interval, pre-save filter, and key extractor. |

## Returns

`SnapshotStorageTier&lt;T&gt;` that buffers one pending snapshot and flushes on wave-close.

## Basic Usage

```ts
import { memoryBackend, snapshotStorage } from "@graphrefly/graphrefly/extra";

const backend = memoryBackend();
const tier = snapshotStorage<{ count: number }>(backend, { name: "counter" });
await tier.save({ count: 42 });
// Load back:
const loaded = await tier.load?.();
```
