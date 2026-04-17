---
title: "memoryStorage()"
description: "In-memory storage tier (process-local; useful for tests and hot tier)."
---

In-memory storage tier (process-local; useful for tests and hot tier).

## Signature

```ts
function memoryStorage(): StorageTier
```

## Returns

Sync StorageTier with JSON-cloned isolation.

## Basic Usage

```ts
import { memoryStorage } from "@graphrefly/graphrefly-ts";

const hot = memoryStorage();
graph.attachStorage([hot]);
```
