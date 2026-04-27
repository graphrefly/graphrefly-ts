---
title: "memoryAppendLog()"
description: "Creates an in-memory append-log tier backed by a fresh `memoryBackend`.\n\nConvenience wrapper for `appendLogStorage(memoryBackend(), opts)`. All writes\nare synch"
---

Creates an in-memory append-log tier backed by a fresh `memoryBackend`.

Convenience wrapper for `appendLogStorage(memoryBackend(), opts)`. All writes
are synchronous and in-process — useful for tests and hot-path event buffering.

## Signature

```ts
function memoryAppendLog<T>(
	opts?: Omit<AppendLogStorageOptions<T>, "name"> & { name?: string },
): AppendLogStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `Omit&lt;AppendLogStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional append-log storage options (name, codec, keyOf, debounce, compactEvery). |

## Returns

`AppendLogStorageTier&lt;T&gt;` backed by an in-memory store.

## Basic Usage

```ts
import { memoryAppendLog } from "@graphrefly/graphrefly/extra";

const tier = memoryAppendLog<{ type: string }>({ name: "events" });
await tier.appendEntries([{ type: "init" }]);
```
