---
title: "tokenTracker()"
description: "Alias for `new TokenBucket(capacity, refillPerSecond)` (parity with graphrefly-py `token_tracker`)."
---

Alias for `new TokenBucket(capacity, refillPerSecond)` (parity with graphrefly-py `token_tracker`).

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

A new .
