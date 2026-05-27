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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>ms</code> | <code>number</code> | Quiet window in milliseconds. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Debounced stream.

## Basic Usage

```ts
import { debounce, state } from "@graphrefly/pure-ts";

debounce(state(0), 50);
```
