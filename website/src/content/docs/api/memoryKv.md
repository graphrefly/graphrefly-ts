---
title: "memoryKv()"
description: "Creates an in-memory key-value tier backed by a fresh `memoryBackend`.\n\nConvenience wrapper for `kvStorage(memoryBackend(), opts)`. All writes are\nsynchronous a"
---

Creates an in-memory key-value tier backed by a fresh `memoryBackend`.

Convenience wrapper for `kvStorage(memoryBackend(), opts)`. All writes are
synchronous and in-process — useful for tests and ephemeral record caches.

## Signature

```ts
function memoryKv<T>(
	opts?: Omit<KvStorageOptions<T>, "name"> & { name?: string },
): KvStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `Omit&lt;KvStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional kv storage options (name, codec, filter, debounce, compactEvery). |

## Returns

`KvStorageTier&lt;T&gt;` backed by an in-memory store.

## Basic Usage

```ts
import { memoryKv } from "@graphrefly/graphrefly/extra";

const kv = memoryKv<{ value: number }>();
await kv.save("key1", { value: 42 });
const loaded = await kv.load("key1");
```
