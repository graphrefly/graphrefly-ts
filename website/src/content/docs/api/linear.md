---
title: "linear()"
description: "Builds linear backoff: `baseSeconds + stepSeconds * attempt` (`stepSeconds` defaults to `baseSeconds`)."
---

Builds linear backoff: `baseSeconds + stepSeconds * attempt` (`stepSeconds` defaults to `baseSeconds`).

## Signature

```ts
function linear(baseSeconds: number, stepSeconds?: number): BackoffStrategy
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `baseSeconds` | `number` | Base delay in seconds (clamped non-negative). |
| `stepSeconds` | `number` | Added per retry attempt (clamped non-negative). |

## Returns

`BackoffStrategy` for .
