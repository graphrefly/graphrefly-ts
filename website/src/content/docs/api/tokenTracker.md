---
title: "tokenTracker()"
description: "Same behavior as tokenBucket. Exposed for naming parity with graphrefly-py (`token_tracker`)."
---

Same behavior as tokenBucket. Exposed for naming parity with graphrefly-py (`token_tracker`).

## Signature

```ts
function tokenTracker(capacity: number, refillPerSecond: number): TokenBucket
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `capacity` | `number` | Maximum tokens (must be positive). |
| `refillPerSecond` | `number` | Tokens added per elapsed second (non-negative). |

## Returns

A TokenBucket instance.
