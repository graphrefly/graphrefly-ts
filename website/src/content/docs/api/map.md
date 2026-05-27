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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>project</code> | <code>(value: T) =&gt; R</code> | Transform for each value. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;R&gt;` - Derived node emitting mapped values.

## Basic Usage

```ts
import { map, state } from "@graphrefly/pure-ts";

const n = map(state(2), (x) => x * 3);
```
