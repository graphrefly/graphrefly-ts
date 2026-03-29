---
title: "rateLimiter()"
description: "Returns a  that enforces a sliding window: at most `maxEvents` `DATA` values per `windowSeconds`."
---

Returns a  that enforces a sliding window: at most `maxEvents` `DATA` values per `windowSeconds`.

## Signature

```ts
function rateLimiter(maxEvents: number, windowSeconds: number): PipeOperator
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `maxEvents` | `number` | Maximum `DATA` emissions per window (must be positive). |
| `windowSeconds` | `number` | Window length in seconds (must be positive). |

## Returns

Unary operator; excess values queue FIFO until a slot frees.

## Behavior Details

- **Terminal:** `COMPLETE` / `ERROR` cancel timers, drop pending queue, and clear window state.
