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

`BackoffStrategy` for retry.

## Basic Usage

```ts
import { linear, retry, NS_PER_SEC } from "@graphrefly/graphrefly-ts";

// Attempt 0 → 1 s, attempt 1 → 2 s, attempt 2 → 3 s …
const out = retry(source, { count: 4, backoff: linear(NS_PER_SEC) });
```
