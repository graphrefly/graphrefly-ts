---
title: "fibonacci()"
description: "Builds Fibonacci-scaled delays: `1, 2, 3, 5, … × baseSeconds`, capped at `maxDelaySeconds`."
---

Builds Fibonacci-scaled delays: `1, 2, 3, 5, … × baseSeconds`, capped at `maxDelaySeconds`.

## Signature

```ts
function fibonacci(baseSeconds = 0.1, maxDelaySeconds = 30): BackoffStrategy
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `baseSeconds` | `unknown` | Multiplier applied to the Fibonacci unit (default `0.1`). |
| `maxDelaySeconds` | `unknown` | Upper bound in seconds (default `30`). |

## Returns

`BackoffStrategy` for .
