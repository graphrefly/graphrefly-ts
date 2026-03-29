---
title: "restoreGraphCheckpointIndexedDb()"
description: "Loads a snapshot from IndexedDB and applies  when present."
---

Loads a snapshot from IndexedDB and applies  when present.

## Signature

```ts
async function restoreGraphCheckpointIndexedDb(
	graph: Graph,
	spec: IndexedDbCheckpointSpec,
): Promise<boolean>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` | Graph whose topology matches the stored snapshot. |
| `spec` | `IndexedDbCheckpointSpec` | Same `dbName` / `storeName` / `key` / `version` as save. |

## Returns

`true` if a value existed and was restored.
