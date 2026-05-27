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
| <code>strategy</code> | <code>BackoffStrategy</code> | Inner strategy to wrap. |
| <code>maxAttempts</code> | <code>number</code> | Maximum number of attempts (inclusive). |

## Returns

Wrapped `BackoffStrategy`.

## Basic Usage

```ts
import { withMaxAttempts, exponential } from "@graphrefly/graphrefly";

const capped = withMaxAttempts(exponential(), 3);
capped(3); // null — no more retries beyond attempt 3
```
