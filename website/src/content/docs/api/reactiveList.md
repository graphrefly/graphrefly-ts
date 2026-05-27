---
title: "reactiveList()"
description: "Creates a reactive list with immutable array snapshots."
---

Creates a reactive list with immutable array snapshots.

## Signature

```ts
function reactiveList<T>(
	initial?: readonly T[],
	options: ReactiveListOptions<T> = {},
): ReactiveListBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>initial</code> | <code>readonly T[]</code> | Optional initial items (copied). |
| <code>options</code> | <code>ReactiveListOptions&lt;T&gt;</code> | Optional `name` for `describe()` / debugging, or pluggable `backend`. |

## Returns

Bundle with `items` (state node), `size` / `at`, `append` / `appendMany` / `insert` /
`insertMany` / `pop` / `clear`.

## Basic Usage

```ts
import { reactiveList } from "@graphrefly/pure-ts";

const list = reactiveList<string>(["a"], { name: "queue" });
list.append("b");
list.insertMany(1, ["x", "y"]);
```

## Behavior Details

- **No `maxSize`:** insert/pop-anywhere semantics make eviction-under-cap ambiguous.
For bounded append-heavy workloads use `reactiveLog` (head-trim is well-defined for
append-only).

**Backend:** Default NativeListBackend. For persistent / RRB-tree semantics
supply a custom ListBackend. If you provide a `backend`, `initial` is ignored
— seed the backend directly.
