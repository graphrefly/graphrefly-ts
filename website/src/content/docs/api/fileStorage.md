---
title: "fileStorage()"
description: "Atomic JSON file storage tier (one file per key in a directory, temp + rename).\n\nKeys are sanitized to filesystem-safe names (`[^a-zA-Z0-9_-]` → `%<hex>`).\n`loa"
---

Atomic JSON file storage tier (one file per key in a directory, temp + rename).

Keys are sanitized to filesystem-safe names (`[^a-zA-Z0-9_-]` → `%&lt;hex&gt;`).
`load` returns `null` for missing files, empty files, or invalid JSON.

## Signature

```ts
function fileStorage(dir: string): StorageTier
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dir` | `string` | Directory where per-key JSON files are written. |

## Returns

Sync StorageTier.

## Basic Usage

```ts
import { fileStorage, memoryStorage } from "@graphrefly/graphrefly-ts";

graph.attachStorage([memoryStorage(), fileStorage("./checkpoints")]);
```
