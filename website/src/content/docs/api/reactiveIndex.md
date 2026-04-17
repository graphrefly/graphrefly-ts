---
title: "reactiveIndex()"
description: "Creates a reactive index: unique primary key per row, rows sorted by `(secondary, primary)` for ordered scans."
---

Creates a reactive index: unique primary key per row, rows sorted by `(secondary, primary)` for ordered scans.

## Signature

```ts
function reactiveIndex<K, V = unknown>(
	options: ReactiveIndexOptions<K, V> = {},
): ReactiveIndexBundle<K, V>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `ReactiveIndexOptions&lt;K, V&gt;` | Optional `name` for `describe()` / debugging, and optional `backend` (see IndexBackend). |

## Returns

Bundle with `ordered` (sorted rows), `byPrimary` (map), O(1) `has` / `get` / `size`,
imperative `upsert` / `upsertMany` / `delete` / `deleteMany` / `clear`.

## Basic Usage

```ts
import { reactiveIndex } from "@graphrefly/graphrefly-ts";

const idx = reactiveIndex<string, string>();
idx.upsert("id1", 10, "row-a");
idx.upsert("id2", 5, "row-b");
```

## Behavior Details

- **Ordering:** `secondary` and `primary` are compared via a small total order: same primitive `typeof` uses
numeric/string/boolean/bigint comparison; mixed or object keys fall back to `String(a).localeCompare(String(b))`
(not identical to Python's rich comparison for exotic types).

**Backend:** The default NativeIndexBackend offers O(1) primary-key lookups and O(n) upserts.
For scale beyond a few thousand rows, supply a user-pluggable persistent/B-tree backend via the
`backend` option — reactive emission semantics are unchanged.
