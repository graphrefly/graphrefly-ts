---
title: "reactiveList()"
description: "Creates a reactive list with versioned immutable array snapshots."
---

Creates a reactive list with versioned immutable array snapshots.

## Signature

```ts
function reactiveList<T>(
	initial?: readonly T[],
	options: ReactiveListOptions = {},
): ReactiveListBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `readonly T[]` | Optional initial items (copied). |
| `options` | `ReactiveListOptions` | Optional `name` for `describe()` / debugging. |

## Returns

Bundle with `items` (state node) and `append` / `insert` / `pop` / `clear`.

## Basic Usage

```ts
import { reactiveList } from "@graphrefly/graphrefly-ts";

const list = reactiveList<string>(["a"], { name: "queue" });
list.append("b");
```
