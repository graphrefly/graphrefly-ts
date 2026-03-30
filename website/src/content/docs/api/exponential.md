---
title: "exponential()"
description: "Builds exponential backoff in nanoseconds, capped by `maxDelayNs`, with optional jitter."
---

Builds exponential backoff in nanoseconds, capped by `maxDelayNs`, with optional jitter.

## Signature

```ts
function exponential(options?: ExponentialBackoffOptions): BackoffStrategy
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `ExponentialBackoffOptions` | Base, factor, cap, and jitter mode. |

## Returns

`BackoffStrategy` for retry.

## Behavior Details

- **Jitter:** `"full"` spreads delay across `[0, delay]`; `"equal"` uses `[delay/2, delay]`.
