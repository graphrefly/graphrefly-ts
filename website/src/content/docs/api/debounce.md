---
title: "debounce()"
description: "Emits the latest value only after `ms` quiet time since the last trigger (`debounce`)."
---

Emits the latest value only after `ms` quiet time since the last trigger (`debounce`).

## Signature

```ts
function debounce<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `ms` | `number` | Quiet window in milliseconds. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Debounced stream.

## Basic Usage

```ts
import { debounce, state } from "@graphrefly/graphrefly-ts";

debounce(state(0), 50);
```
