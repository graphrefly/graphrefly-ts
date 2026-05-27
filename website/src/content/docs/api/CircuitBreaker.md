---
title: "circuitBreaker()"
description: "Factory for a synchronous circuit breaker with `closed`, `open`, and `half-open` states.\n\nSupports escalating cooldown via an optional BackoffStrategy — each co"
---

Factory for a synchronous circuit breaker with `closed`, `open`, and `half-open` states.

Supports escalating cooldown via an optional BackoffStrategy — each consecutive
open→half-open→open cycle increments the backoff attempt.

## Signature

```ts
function circuitBreaker(options?: NodeOrValue<CircuitBreakerOptions>): CircuitBreaker
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>options</code> | <code>NodeOrValue&lt;CircuitBreakerOptions&gt;</code> | Threshold, cooldown, half-open limit, and optional clock
override; OR a `Node&lt;CircuitBreakerOptions&gt;` carrying the same shape
reactively (Tier 6.5 3.2.4). |

## Basic Usage

```ts
import { circuitBreaker, exponential, NS_PER_SEC } from "@graphrefly/graphrefly";

const b = circuitBreaker({
    failureThreshold: 3,
    cooldown: exponential({ baseNs: 1 * NS_PER_SEC }),
  });
```

## Behavior Details

- **Timing:** Uses `monotonicNs()` by default (nanoseconds). Override `now` for tests.

**Reactive options (locked semantics, Tier 6.5 3.2.4, 2026-04-29).**
When `options` is a `Node<CircuitBreakerOptions>`, the breaker
subscribes at construction and re-reads `failureThreshold` /
`cooldownNs` / `cooldown` / `halfOpenMax` / `now` on each DATA. **An
option swap RESETS the breaker to `"closed"`** with all counters
cleared — operators tuning a runaway breaker get a clean baseline.
If retaining failure history across re-tunings matters, derive a new
breaker per-tuning instead. Call `breaker.dispose()` when retiring to
release the option-Node subscription.
