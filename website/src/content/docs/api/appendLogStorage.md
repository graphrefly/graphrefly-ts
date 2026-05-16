---
title: "appendLogStorage()"
description: "Wraps a `StorageBackend` as a typed append-log tier.\n\nBuffer model: `appendEntries(entries)` accumulates per-key buckets in\nmemory. `flush()` encodes each bucke"
---

Wraps a `StorageBackend` as a typed append-log tier.

Buffer model: `appendEntries(entries)` accumulates per-key buckets in
memory. `flush()` encodes each bucket as a JSON array via codec and writes
under that bucket key. `rollback()` discards pending appends.

Storage shape & semantics: each backend key holds a JSON array of entries
for that partition. This is a true **logical append log** — `mode:"append"`
(default) read-merges the key's existing array and persists
`[...prior, ...pending]`, so the key accumulates monotonically and a
*fresh* tier over an existing key continues the accumulation (no entries
lost). The *physical* write rewrites the whole per-key array each flush
(not a byte-level backend append); that is an implementation detail, not a
semantic limitation — callers do **not** need to layer their own tier for
append semantics. Set `mode:"overwrite"` for snapshot semantics (each flush
replaces the key with only that flush's entries, no read-merge).

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
