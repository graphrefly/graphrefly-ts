---
title: "sqliteStorage()"
description: "SQLite storage tier using Node.js `node:sqlite` (DatabaseSync).\n\nReturns a StorageTier extended with `close()` — the caller owns the\nconnection and should close"
---

SQLite storage tier using Node.js `node:sqlite` (DatabaseSync).

Returns a StorageTier extended with `close()` — the caller owns the
connection and should close it when discarding the tier.

**Runtime:** Requires Node 22.5+ with `node:sqlite` enabled.

## Signature

```ts
function sqliteStorage(path: string): StorageTier & { close(): void }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | SQLite database file path. |

## Returns

Sync StorageTier with an idempotent `close()` method.

## Basic Usage

```ts
import { sqliteStorage, memoryStorage } from "@graphrefly/graphrefly-ts";

const cold = sqliteStorage("./graphs.sqlite");
graph.attachStorage([memoryStorage(), cold]);
// ... later, on shutdown:
cold.close();
```
