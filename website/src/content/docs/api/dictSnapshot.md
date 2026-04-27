---
title: "dictSnapshot()"
description: "Creates a snapshot tier backed by a caller-owned plain object (`Record<string, Uint8Array>`).\n\nUseful for embedding checkpoints inside a parent state shape or f"
---

Creates a snapshot tier backed by a caller-owned plain object (`Record&lt;string, Uint8Array&gt;`).

Useful for embedding checkpoints inside a parent state shape or for tests
that need direct access to the raw bytes. The dict stores raw JSON bytes as
`Uint8Array`. Use `opts.name` to control the storage key (defaults to
`"snapshot"`).

## Signature

```ts
function dictSnapshot<T>(
	storage: Record<string, Uint8Array>,
	opts?: Omit<SnapshotStorageOptions<T>, "name"> & { name?: string },
): SnapshotStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `storage` | `Record&lt;string, Uint8Array&gt;` | Caller-owned `Record&lt;string, Uint8Array&gt;` to use as the backing store. |
| `opts` | `Omit&lt;SnapshotStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional snapshot storage options (name, codec, filter, keyOf, debounce, compactEvery). |

## Returns

`SnapshotStorageTier&lt;T&gt;` backed by the provided dict object.

## Basic Usage

```ts
import { dictSnapshot } from "@graphrefly/graphrefly/extra";

const store: Record<string, Uint8Array> = {};
graph.attachSnapshotStorage([dictSnapshot(store, { name: graph.name })]);
```
