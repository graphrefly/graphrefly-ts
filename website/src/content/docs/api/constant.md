---
title: "constant()"
description: "Builds a strategy that always returns the same delay in nanoseconds."
---

Builds a strategy that always returns the same delay in nanoseconds.

## Signature

```ts
function constant(delayNs: number): BackoffStrategy
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `delayNs` | `number` | Non-negative delay in nanoseconds; values below zero are clamped to zero. |

## Returns

`BackoffStrategy` for use with retry or custom timers.

## Basic Usage

```ts
import { constant, retry, NS_PER_SEC } from "@graphrefly/graphrefly-ts";

const out = retry(source, { count: 3, backoff: constant(0.25 * NS_PER_SEC) });
```
