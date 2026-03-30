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

## Basic Usage

```ts
import { tokenTracker } from "@graphrefly/graphrefly-ts";

const tracker = tokenTracker(100, 10); // 100-token capacity, 10/sec refill
tracker.tryConsume(5); // true
```
