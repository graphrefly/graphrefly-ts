---
title: "saveGraphCheckpointIndexedDb()"
description: "Persists  under `spec.key` (browser IndexedDB)."
---

Persists  under `spec.key` (browser IndexedDB).

## Signature

```ts
async function saveGraphCheckpointIndexedDb(
	graph: Graph,
	spec: IndexedDbCheckpointSpec,
): Promise<void>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` | Graph to snapshot. |
| `spec` | `IndexedDbCheckpointSpec` | Database name, object store name, optional `key` and schema `version`. |

## Behavior Details

- **Environment:** Throws if `indexedDB` is undefined (Node tests).
