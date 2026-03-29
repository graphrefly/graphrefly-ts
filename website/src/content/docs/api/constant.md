---
title: "constant()"
description: "Builds a strategy that always returns the same delay in seconds."
---

Builds a strategy that always returns the same delay in seconds.

## Signature

```ts
function constant(delaySeconds: number): BackoffStrategy
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `delaySeconds` | `number` | Non-negative delay; values below zero are clamped to zero. |

## Returns

`BackoffStrategy` for use with  or custom timers.

## Basic Usage

```ts
import { constant, retry } from "@graphrefly/graphrefly-ts";

const op = retry({ count: 3, backoff: constant(0.25) });
```
