---
title: "sqliteKv()"
description: "Creates a SQLite key-value tier; caller owns the connection lifetime.\n\nConvenience wrapper for `kvStorage(sqliteBackend(path), opts)`.\nThe returned tier exposes"
---

Creates a SQLite key-value tier; caller owns the connection lifetime.

Convenience wrapper for `kvStorage(sqliteBackend(path), opts)`.
The returned tier exposes an extra `close()` method — call it for explicit
teardown of the underlying SQLite connection.

## Signature

```ts
function sqliteKv<T>(
	path: string,
	opts?: Omit<KvStorageOptions<T>, "name"> & { name?: string },
): KvStorageTier<T> & { close(): void }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Filesystem path to the SQLite database file. |
| `opts` | `Omit&lt;KvStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional kv storage options (name, codec, filter, debounce, compactEvery). |

## Returns

`KvStorageTier&lt;T&gt;` with a `close()` method for connection teardown.

## Basic Usage

```ts
import { sqliteKv } from "@graphrefly/graphrefly/extra/node";

const kv = sqliteKv<{ score: number }>("./scores.db");
await kv.save("player1", { score: 100 });
kv.close();
```
