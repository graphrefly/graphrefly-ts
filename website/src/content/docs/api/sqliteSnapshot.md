---
title: "sqliteSnapshot()"
description: "Creates a SQLite snapshot tier; caller owns the connection lifetime.\n\nConvenience wrapper for `snapshotStorage(sqliteBackend(path), opts)`.\nThe returned tier ex"
---

Creates a SQLite snapshot tier; caller owns the connection lifetime.

Convenience wrapper for `snapshotStorage(sqliteBackend(path), opts)`.
The returned tier exposes an extra `close()` method — call it for explicit
teardown of the underlying SQLite connection.

## Signature

```ts
function sqliteSnapshot<T>(
	path: string,
	opts?: Omit<SnapshotStorageOptions<T>, "name"> & { name?: string },
): SnapshotStorageTier<T> & { close(): void }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Filesystem path to the SQLite database file. |
| `opts` | `Omit&lt;SnapshotStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional snapshot storage options (name, codec, filter, keyOf, debounce, compactEvery). |

## Returns

`SnapshotStorageTier&lt;T&gt;` with a `close()` method for connection teardown.

## Basic Usage

```ts
import { sqliteSnapshot } from "@graphrefly/graphrefly/extra/node";

const tier = sqliteSnapshot<{ count: number }>("./state.db", { name: "counter" });
await tier.save({ count: 42 });
tier.close();
```
