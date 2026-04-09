---
title: "startWith()"
description: "Prepends `initial` as **`DATA`**, then forwards every value from `source`."
---

Prepends `initial` as **`DATA`**, then forwards every value from `source`.

## Signature

```ts
function startWith<T>(source: Node<T>, initial: T, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `initial` | `T` | Value emitted before upstream. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Prefixed stream.

## Basic Usage

```ts
import { startWith, state } from "@graphrefly/graphrefly-ts";

const n = startWith(state(2), 0);
```
