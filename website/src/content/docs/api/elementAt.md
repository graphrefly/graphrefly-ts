---
title: "elementAt()"
description: "Emits the `index`th **`DATA`** (zero-based), then **`COMPLETE`**."
---

Emits the `index`th **`DATA`** (zero-based), then **`COMPLETE`**.

## Signature

```ts
function elementAt<T>(source: Node<T>, index: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>index</code> | <code>number</code> | Zero-based emission index. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Single indexed value.

## Basic Usage

```ts
import { elementAt, state } from "@graphrefly/pure-ts";

const n = elementAt(state(0), 2);
```
