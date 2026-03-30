---
title: "fibonacci()"
description: "Builds Fibonacci-scaled delays: `1, 2, 3, 5, … × baseNs`, capped at `maxDelayNs`."
---

Builds Fibonacci-scaled delays: `1, 2, 3, 5, … × baseNs`, capped at `maxDelayNs`.

## Signature

```ts
function fibonacci(baseNs = 100 * NS_PER_MS, maxDelayNs = 30 * NS_PER_SEC): BackoffStrategy
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `baseNs` | `unknown` | Multiplier applied to the Fibonacci unit (default `100ms` in nanoseconds). |
| `maxDelayNs` | `unknown` | Upper bound in nanoseconds (default `30s`). |

## Returns

`BackoffStrategy` for retry.

## Basic Usage

```ts
import { fibonacci, retry, NS_PER_MS } from "@graphrefly/graphrefly-ts";

// Delays: 100 ms, 200 ms, 300 ms, 500 ms, 800 ms … (× 100 ms base)
const out = retry(source, { count: 5, backoff: fibonacci(100 * NS_PER_MS) });
```
