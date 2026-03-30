---
title: "tokenBucket()"
description: "Token-bucket meter (capacity + refill rate per second). Use with rateLimiter or custom gates."
---

Token-bucket meter (capacity + refill rate per second). Use with rateLimiter or custom gates.

## Signature

```ts
function tokenBucket(capacity: number, refillPerSecond: number): TokenBucket
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `capacity` | `number` | Maximum tokens (must be positive). |
| `refillPerSecond` | `number` | Tokens added per elapsed second (non-negative). |

## Basic Usage

```ts
import { tokenBucket } from "@graphrefly/graphrefly-ts";

const bucket = tokenBucket(10, 2); // capacity 10, refill 2 tokens/sec
bucket.tryConsume(3); // true — 7 tokens remaining
bucket.available();   // ~7 (plus any elapsed refill)
```
