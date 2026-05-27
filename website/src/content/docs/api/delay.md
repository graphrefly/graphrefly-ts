---
title: "delay()"
description: "Delays phase-2 emissions by `ms` (timers). `DIRTY` still forwards immediately."
---

Delays phase-2 emissions by `ms` (timers). `DIRTY` still forwards immediately.

## Signature

```ts
function delay<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>ms</code> | <code>number</code> | Delay in milliseconds. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Same values, shifted in time.

## Basic Usage

```ts
import { delay, state } from "@graphrefly/pure-ts";

delay(state(1), 100);
```
