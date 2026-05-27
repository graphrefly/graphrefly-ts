---
title: "first()"
description: "Emits the first **`DATA`** then **`COMPLETE`** (same as `take(source, 1)`)."
---

Emits the first **`DATA`** then **`COMPLETE`** (same as `take(source, 1)`).

## Signature

```ts
function first<T>(source: Node<T>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Single-value stream.

## Basic Usage

```ts
import { first, state } from "@graphrefly/pure-ts";

const n = first(state(42));
```
