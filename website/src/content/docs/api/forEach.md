---
title: "forEach()"
description: "Subscribes immediately and runs `fn` for each upstream `DATA`; returns unsubscribe."
---

Subscribes immediately and runs `fn` for each upstream `DATA`; returns unsubscribe.

## Signature

```ts
function forEach<T>(source: Node<T>, fn: (value: T) => void, opts?: ExtraOpts): () => void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `fn` | `(value: T) =&gt; void` | Side effect per value. |
| `opts` | `ExtraOpts` | Effect node options. |

## Returns

Unsubscribe function (idempotent).

## Basic Usage

```ts
import { forEach, state } from "@graphrefly/graphrefly-ts";

const u = forEach(state(1), (v) => console.log(v));
u();
```
