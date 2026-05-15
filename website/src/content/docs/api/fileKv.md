---
title: "fileKv()"
description: "Creates a filesystem key-value tier backed by a `fileBackend` under `dir`.\n\nConvenience wrapper for `kvStorage(fileBackend(dir), opts)`.\nEach key is stored as a"
---

Creates a filesystem key-value tier backed by a `fileBackend` under `dir`.

Convenience wrapper for `kvStorage(fileBackend(dir), opts)`.
Each key is stored as a separate file; writes are atomic (temp + rename).

## Signature

```ts
function fileKv<T>(
	dir: string,
	opts?: Omit<KvStorageOptions<T>, "name"> & { name?: string },
): KvStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dir` | `string` | Directory path where key files are stored. |
| `opts` | `Omit&lt;KvStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional kv storage options (name, codec, filter, debounce, compactEvery). |

## Returns

`KvStorageTier&lt;T&gt;` backed by the filesystem.

## Basic Usage

```ts
import { fileKv } from "@graphrefly/graphrefly/extra/node";

const kv = fileKv<{ score: number }>("../scores");
await kv.save("player1", { score: 100 });
const val = await kv.load("player1");
```
