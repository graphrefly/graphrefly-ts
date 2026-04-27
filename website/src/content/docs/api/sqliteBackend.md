---
title: "sqliteBackend()"
description: "Creates a SQLite backend using Node 22.5+ `node:sqlite`.\n\nStores byte values under string keys in a single `graphrefly_storage` table.\nThe caller owns the conne"
---

Creates a SQLite backend using Node 22.5+ `node:sqlite`.

Stores byte values under string keys in a single `graphrefly_storage` table.
The caller owns the connection lifetime — call `.close()` for explicit teardown.
Requires Node 22.5 or later for `node:sqlite`.

## Signature

```ts
function sqliteBackend(path: string): StorageBackend & { close(): void }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Filesystem path to the SQLite database file (created if absent). |

## Returns

`StorageBackend` with an extra `close()` method for explicit teardown.

## Basic Usage

```ts
import { sqliteBackend, snapshotStorage } from "@graphrefly/graphrefly/extra/node";

const backend = sqliteBackend("./state.db");
const tier = snapshotStorage(backend, { name: "my-graph" });
await tier.save({ name: "my-graph", state: { count: 1 } });
backend.close();
```
