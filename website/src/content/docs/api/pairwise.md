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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;readonly [T, T]&gt;` - Pair stream.

## Basic Usage

```ts
import { pairwise, state } from "@graphrefly/pure-ts";

const n = pairwise(state(0));
```
