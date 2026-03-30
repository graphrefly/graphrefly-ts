---
title: "pairwise()"
description: "Emits `[previous, current]` pairs starting after the second value (first pair uses `RESOLVED` only)."
---

Emits `[previous, current]` pairs starting after the second value (first pair uses `RESOLVED` only).

## Signature

```ts
function pairwise<T>(source: Node<T>, opts?: ExtraOpts): Node<readonly [T, T]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;readonly [T, T]&gt;` - Pair stream.

## Basic Usage

```ts
import { pairwise, state } from "@graphrefly/graphrefly-ts";

const n = pairwise(state(0));
```
