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
