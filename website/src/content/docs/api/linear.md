---
title: "linear()"
description: "Builds linear backoff: `baseNs + stepNs * attempt` (`stepNs` defaults to `baseNs`)."
---

Builds linear backoff: `baseNs + stepNs * attempt` (`stepNs` defaults to `baseNs`).

## Signature

```ts
function linear(baseNs: number, stepNs?: number): BackoffStrategy
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `baseNs` | `number` | Base delay in nanoseconds (clamped non-negative). |
| `stepNs` | `number` | Added per retry attempt in nanoseconds (clamped non-negative). |

## Returns

`BackoffStrategy` for .
