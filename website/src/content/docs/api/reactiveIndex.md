---
title: "reactiveIndex()"
description: "Creates a reactive index: unique primary key per row, rows sorted by `(secondary, primary)` for ordered scans."
---

Creates a reactive index: unique primary key per row, rows sorted by `(secondary, primary)` for ordered scans.

## Signature

```ts
function reactiveIndex<K, V = unknown>(
	options: ReactiveIndexOptions = {},
): ReactiveIndexBundle<K, V>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `ReactiveIndexOptions` | Optional `name` for `describe()` / debugging. |

## Returns

Bundle with `ordered` (sorted rows), `byPrimary` (map), and imperative `upsert` / `delete` / `clear`.

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
