---
title: "rateLimiter()"
description: "Returns a  that enforces a sliding window: at most `maxEvents` `DATA` values per `windowNs`."
---

Returns a  that enforces a sliding window: at most `maxEvents` `DATA` values per `windowNs`.

## Signature

```ts
function rateLimiter(maxEvents: number, windowNs: number): PipeOperator
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `maxEvents` | `number` | Maximum `DATA` emissions per window (must be positive). |
| `windowNs` | `number` | Window length in nanoseconds (must be positive). |

## Returns

Unary operator; excess values queue FIFO until a slot frees.

## Behavior Details

- **Terminal:** `COMPLETE` / `ERROR` cancel timers, drop pending queue, and clear window state.
