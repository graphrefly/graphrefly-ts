---
title: "fileSnapshot()"
description: "Creates a filesystem snapshot tier backed by a `fileBackend` under `dir`.\n\nConvenience wrapper for `snapshotStorage(fileBackend(dir), opts)`.\nWrites are atomic "
---

Creates a filesystem snapshot tier backed by a `fileBackend` under `dir`.

Convenience wrapper for `snapshotStorage(fileBackend(dir), opts)`.
Writes are atomic (temp + rename). Requires Node.js with filesystem access.

## Signature

```ts
function fileSnapshot<T>(
	dir: string,
	opts?: Omit<SnapshotStorageOptions<T>, "name"> & { name?: string },
): SnapshotStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dir` | `string` | Directory path where snapshot files are stored. |
| `opts` | `Omit&lt;SnapshotStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional snapshot storage options (name, codec, filter, keyOf, debounce, compactEvery). |

## Returns

`SnapshotStorageTier&lt;T&gt;` backed by the filesystem.

## Basic Usage

```ts
import { fileSnapshot } from "@graphrefly/graphrefly/extra/node";

const tier = fileSnapshot<{ count: number }>("./checkpoints", { name: "counter" });
await tier.save({ count: 1 });
```
