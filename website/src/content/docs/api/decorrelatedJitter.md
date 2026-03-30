---
title: "decorrelatedJitter()"
description: "Decorrelated jitter (AWS-recommended): `random(baseNs, min(maxNs, lastDelay * 3))`.\n\nStateless — uses `prevDelayNs` (passed by the consumer) instead of closure "
---

Decorrelated jitter (AWS-recommended): `random(baseNs, min(maxNs, lastDelay * 3))`.

Stateless — uses `prevDelayNs` (passed by the consumer) instead of closure state.
Safe to share across concurrent retry sequences.

## Signature

```ts
function decorrelatedJitter(
	baseNs = 100 * NS_PER_MS,
	maxNs = 30 * NS_PER_SEC,
): BackoffStrategy
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `baseNs` | `unknown` | Floor of the random range (default `100ms` in nanoseconds). |
| `maxNs` | `unknown` | Ceiling cap (default `30s` in nanoseconds). |

## Returns

`BackoffStrategy` for retry.

## Basic Usage

```ts
import { decorrelatedJitter, retry, NS_PER_MS, NS_PER_SEC } from "@graphrefly/graphrefly-ts";

const out = retry(source, {
    count: 6,
    backoff: decorrelatedJitter(100 * NS_PER_MS, 10 * NS_PER_SEC),
  });
```
