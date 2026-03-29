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
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `ms` | `number` | Delay in milliseconds. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Same values, shifted in time.

## Basic Usage

```ts
import { delay, state } from "@graphrefly/graphrefly-ts";

delay(state(1), 100);
```
