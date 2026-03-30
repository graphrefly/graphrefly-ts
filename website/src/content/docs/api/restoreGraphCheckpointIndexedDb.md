---
title: "restoreGraphCheckpointIndexedDb()"
description: "Loads a snapshot from IndexedDB and applies Graph.restore when present."
---

Loads a snapshot from IndexedDB and applies Graph.restore when present.

## Signature

```ts
function restoreGraphCheckpointIndexedDb(
	graph: Graph,
	spec: IndexedDbCheckpointSpec,
): Node<boolean>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` | Graph whose topology matches the stored snapshot. |
| `spec` | `IndexedDbCheckpointSpec` | Same `dbName` / `storeName` / `key` / `version` as save. |

## Returns

A reactive `Node&lt;boolean&gt;`: emits `true` if a snapshot was restored, `false` if missing or not a plain object, then `COMPLETE`; or `ERROR` on I/O failure.
