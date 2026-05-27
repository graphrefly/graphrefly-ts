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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>fn</code> | <code>(value: T) =&gt; void</code> | Side effect per value. |
| <code>opts</code> | <code>ExtraOpts</code> | Effect node options. |

## Returns

Unsubscribe function (idempotent).

## Basic Usage

```ts
import { forEach, state } from "@graphrefly/graphrefly";

const u = forEach(state(1), (v) => console.log(v));
u();
```
