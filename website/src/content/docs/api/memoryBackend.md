---
title: "memoryBackend()"
description: "Creates an in-process bytes backend backed by `Map<string, Uint8Array>`.\n\nUseful for tests, hot tiers, and as the default backend for the convenience\nfactories "
---

Creates an in-process bytes backend backed by `Map&lt;string, Uint8Array&gt;`.

Useful for tests, hot tiers, and as the default backend for the convenience
factories in this module. All operations are synchronous.

## Signature

```ts
function memoryBackend(): StorageBackend
```

## Returns

`StorageBackend` instance backed by an in-memory `Map`.

## Basic Usage

```ts
import { memoryBackend, snapshotStorage } from "@graphrefly/graphrefly/extra";

const backend = memoryBackend();
const tier = snapshotStorage(backend, { name: "my-graph" });
await tier.save({ name: "my-graph", data: { count: 1 } });
```
