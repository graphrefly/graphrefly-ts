---
title: "dictStorage()"
description: "Dict-backed storage tier — stores JSON-cloned values under caller keys in\na caller-owned plain object. Useful for embedding in a parent state shape."
---

Dict-backed storage tier — stores JSON-cloned values under caller keys in
a caller-owned plain object. Useful for embedding in a parent state shape.

## Signature

```ts
function dictStorage(storage: Record<string, unknown>): StorageTier
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `storage` | `Record&lt;string, unknown&gt;` | Caller-owned object used as the backing store. |

## Returns

Sync StorageTier.

## Basic Usage

```ts
import { dictStorage } from "@graphrefly/graphrefly-ts";

const state: Record<string, unknown> = {};
graph.attachStorage([dictStorage(state)]);
```
