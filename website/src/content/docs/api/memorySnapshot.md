---
title: "memorySnapshot()"
description: "Creates an in-memory snapshot tier backed by a fresh `memoryBackend`.\n\nConvenience wrapper for `snapshotStorage(memoryBackend(), opts)`. All writes\nare synchron"
---

Creates an in-memory snapshot tier backed by a fresh `memoryBackend`.

Convenience wrapper for `snapshotStorage(memoryBackend(), opts)`. All writes
are synchronous and in-process — useful for tests and hot-path caching.

## Signature

```ts
function memorySnapshot<T>(
	opts?: Omit<SnapshotStorageOptions<T>, "name"> & { name?: string },
): SnapshotStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `Omit&lt;SnapshotStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional snapshot storage options (name, codec, filter, keyOf, debounce, compactEvery). |

## Returns

`SnapshotStorageTier&lt;T&gt;` backed by an in-memory store.

## Basic Usage

```ts
import { memorySnapshot } from "@graphrefly/graphrefly/extra";

const tier = memorySnapshot<{ count: number }>({ name: "counter" });
await tier.save({ count: 1 });
```
