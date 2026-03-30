---
title: "saveGraphCheckpointIndexedDb()"
description: "Persists Graph.snapshot under `spec.key` (browser IndexedDB)."
---

Persists Graph.snapshot under `spec.key` (browser IndexedDB).

## Signature

```ts
function saveGraphCheckpointIndexedDb(
	graph: Graph,
	spec: IndexedDbCheckpointSpec,
): Node<void>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` | Graph to snapshot. |
| `spec` | `IndexedDbCheckpointSpec` | Database name, object store name, optional `key` and schema `version`. |

## Returns

A reactive `Node&lt;void&gt;` that emits `DATA` (`undefined`) then `COMPLETE` on success, or `ERROR` on failure.

## Behavior Details

- **Environment:** Emits `ERROR` if `indexedDB` is undefined (e.g. Node without a polyfill).
