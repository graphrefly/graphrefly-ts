---
title: "sqliteAppendLog()"
description: "Creates a SQLite append-log tier; caller owns the connection lifetime.\n\nConvenience wrapper for `appendLogStorage(sqliteBackend(path), opts)`.\nThe returned tier"
---

Creates a SQLite append-log tier; caller owns the connection lifetime.

Convenience wrapper for `appendLogStorage(sqliteBackend(path), opts)`.
The returned tier exposes an extra `close()` method — call it for explicit
teardown of the underlying SQLite connection.

## Signature

```ts
function sqliteAppendLog<T>(
	path: string,
	opts?: Omit<AppendLogStorageOptions<T>, "name"> & { name?: string },
): AppendLogStorageTier<T> & { close(): void }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Filesystem path to the SQLite database file. |
| `opts` | `Omit&lt;AppendLogStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional append-log storage options (name, codec, keyOf, debounce, compactEvery). |

## Returns

`AppendLogStorageTier&lt;T&gt;` with a `close()` method for connection teardown.

## Basic Usage

```ts
import { sqliteAppendLog } from "@graphrefly/graphrefly/extra/node";

const tier = sqliteAppendLog<{ type: string }>("./events.db", { name: "events" });
await tier.appendEntries([{ type: "created" }]);
tier.close();
```
