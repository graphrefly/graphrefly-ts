---
title: "circuitBreaker()"
description: "Factory for a synchronous circuit breaker with `closed`, `open`, and `half-open` states.\n\nSupports escalating cooldown via an optional BackoffStrategy — each co"
---

Factory for a synchronous circuit breaker with `closed`, `open`, and `half-open` states.

Supports escalating cooldown via an optional BackoffStrategy — each consecutive
open→half-open→open cycle increments the backoff attempt.

## Signature

```ts
function circuitBreaker(options?: CircuitBreakerOptions): CircuitBreaker
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `CircuitBreakerOptions` | Threshold, cooldown, half-open limit, and optional clock override. |

## Basic Usage

```ts
import { circuitBreaker, exponential, NS_PER_SEC } from "@graphrefly/graphrefly-ts";

const b = circuitBreaker({
    failureThreshold: 3,
    cooldown: exponential({ baseNs: 1 * NS_PER_SEC }),
  });
```

## Behavior Details

- **Timing:** Uses `monotonicNs()` by default (nanoseconds). Override `now` for tests.
