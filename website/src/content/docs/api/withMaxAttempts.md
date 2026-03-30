---
title: "withMaxAttempts()"
description: "Decorator that caps any strategy at `maxAttempts`. Returns `null` (stop retrying) after the cap."
---

Decorator that caps any strategy at `maxAttempts`. Returns `null` (stop retrying) after the cap.

## Signature

```ts
function withMaxAttempts(strategy: BackoffStrategy, maxAttempts: number): BackoffStrategy
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `strategy` | `BackoffStrategy` | Inner strategy to wrap. |
| `maxAttempts` | `number` | Maximum number of attempts (inclusive). |

## Returns

Wrapped `BackoffStrategy`.

## Basic Usage

```ts
import { withMaxAttempts, exponential } from "@graphrefly/graphrefly-ts";

const capped = withMaxAttempts(exponential(), 3);
capped(3); // null — no more retries beyond attempt 3
```
