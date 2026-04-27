---
title: "fileAppendLog()"
description: "Creates a filesystem append-log tier backed by a `fileBackend` under `dir`.\n\nConvenience wrapper for `appendLogStorage(fileBackend(dir), opts)`.\nWrites are atom"
---

Creates a filesystem append-log tier backed by a `fileBackend` under `dir`.

Convenience wrapper for `appendLogStorage(fileBackend(dir), opts)`.
Writes are atomic (temp + rename). Requires Node.js with filesystem access.

## Signature

```ts
function fileAppendLog<T>(
	dir: string,
	opts?: Omit<AppendLogStorageOptions<T>, "name"> & { name?: string },
): AppendLogStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dir` | `string` | Directory path where append-log files are stored. |
| `opts` | `Omit&lt;AppendLogStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional append-log storage options (name, codec, keyOf, debounce, compactEvery). |

## Returns

`AppendLogStorageTier&lt;T&gt;` backed by the filesystem.

## Basic Usage

```ts
import { fileAppendLog } from "@graphrefly/graphrefly/extra/node";

const tier = fileAppendLog<{ type: string; id: number }>("./events");
await tier.appendEntries([{ type: "created", id: 1 }]);
```
