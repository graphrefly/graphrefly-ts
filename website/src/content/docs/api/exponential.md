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

## Basic Usage

```ts
import { exponential, retry, NS_PER_SEC } from "@graphrefly/graphrefly-ts";

// 100 ms → 200 ms → 400 ms … capped at 30 s, with full jitter
const out = retry(source, {
    count: 5,
    backoff: exponential({ baseNs: 100 * NS_PER_SEC / 1000, jitter: "full" }),
  });
```

## Behavior Details

- **Jitter:** `"full"` spreads delay across `[0, delay]`; `"equal"` uses `[delay/2, delay]`.
