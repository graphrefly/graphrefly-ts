---
title: "interval()"
description: "Increments on each tick (`interval`); uses `setInterval` via producer."
---

Increments on each tick (`interval`); uses `setInterval` via producer.

## Signature

```ts
function interval(periodMs: number, opts?: ExtraOpts): Node<number>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `periodMs` | `number` | Time between ticks. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;number&gt;` - Emits `0`, `1`, `2`, … while subscribed.

## Basic Usage

```ts
import { interval } from "@graphrefly/graphrefly-ts";

interval(1_000);
```
