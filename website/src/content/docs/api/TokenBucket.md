---
title: "tokenBucket()"
description: "Token-bucket meter (capacity + refill rate per second). Use with rateLimiter or custom gates."
---

Token-bucket meter (capacity + refill rate per second). Use with rateLimiter or custom gates.

## Signature

```ts
function tokenBucket(
	capacity: number,
	refillPerSecond: number,
	opts?: TokenBucketOptions,
): TokenBucket
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `capacity` | `number` | Maximum tokens (must be positive). |
| `refillPerSecond` | `number` | Tokens added per elapsed second (non-negative; may be fractional). |
| `opts` | `TokenBucketOptions` | Optional `clock` override for deterministic testing. |

## Basic Usage

```ts
import { tokenBucket } from "@graphrefly/graphrefly-ts";

const bucket = tokenBucket(10, 2); // capacity 10, refill 2 tokens/sec
bucket.tryConsume(3); // true — 7 tokens remaining
bucket.available();   // ~7 (plus any elapsed refill — float-valued)

// Deterministic test:
let t = 0;
const tb = tokenBucket(5, 1, { clock: () => t });
tb.tryConsume(5);    // exhausts
t = 1_000_000_000;   // advance 1s → +1 refill
tb.tryConsume(1);    // true
```

## Behavior Details

- **Float behavior:** the internal token counter is float-valued — fractional refill
accumulates between `tryConsume` calls. See TokenBucket.available for caveats.

**Clock injection:** pass `opts.clock` to drive refill scheduling deterministically
in tests. The contract matches circuitBreaker's `now` option: must return
`monotonicNs()`-style nanoseconds, never `Date.now()` (wall-clock skew breaks
elapsed math).
