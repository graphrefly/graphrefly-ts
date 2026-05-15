---
title: "fromTimer()"
description: "Builds a timer-driven source: one-shot (first tick then `COMPLETE`) or periodic (`0`, `1`, `2`, …)."
---

Builds a timer-driven source: one-shot (first tick then `COMPLETE`) or periodic (`0`, `1`, `2`, …).

## Signature

```ts
function fromTimer(ms: number, opts?: AsyncSourceOpts & { period?: number }): Node<number>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Milliseconds before the first emission. |
| `opts` | `AsyncSourceOpts & { period?: number }` | Producer options plus optional `period` for repeating ticks and optional `signal` (`AbortSignal`) to cancel with `ERROR`. |

## Returns

`Node&lt;number&gt;` — tick counter from `0`; teardown clears timers.

## Basic Usage

```ts
import { fromTimer } from "@graphrefly/pure-ts";

fromTimer(250, { period: 1_000 });
```
