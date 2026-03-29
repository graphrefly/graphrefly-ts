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

`BackoffStrategy` for .
