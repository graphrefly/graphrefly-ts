---
title: "fileBackend()"
description: "Creates a filesystem backend that maps each key to a file under `dir`.\n\nWrites are atomic via temp + rename. Keys are percent-encoded to safe\nfilenames; `list(p"
---

Creates a filesystem backend that maps each key to a file under `dir`.

Writes are atomic via temp + rename. Keys are percent-encoded to safe
filenames; `list(prefix)` enumerates `.bin` files in the directory.

## Signature

```ts
function fileBackend(dir: string): StorageBackend
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dir` | `string` | Directory path where key files are stored (created on first write). |

## Returns

`StorageBackend` backed by the filesystem under `dir`.

## Basic Usage

```ts
import { fileBackend, snapshotStorage } from "@graphrefly/graphrefly/extra/node";

const backend = fileBackend("../checkpoints");
const tier = snapshotStorage(backend, { name: "my-graph" });
await tier.save({ name: "my-graph", state: { count: 1 } });
```
