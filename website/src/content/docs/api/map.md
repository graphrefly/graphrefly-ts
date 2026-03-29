---
title: "map()"
description: "Maps each settled value from `source` through `project`."
---

Maps each settled value from `source` through `project`.

## Signature

```ts
function map<T, R>(source: Node<T>, project: (value: T) => R, opts?: ExtraOpts): Node<R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `project` | `(value: T) =&gt; R` | Transform for each value. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;R&gt;` - Derived node emitting mapped values.

## Basic Usage

```ts
import { map, state } from "@graphrefly/graphrefly-ts";

const n = map(state(2), (x) => x * 3);
```
