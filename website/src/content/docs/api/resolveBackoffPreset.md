---
title: "resolveBackoffPreset()"
description: "Maps a preset name to a concrete BackoffStrategy with library-default parameters."
---

Maps a preset name to a concrete BackoffStrategy with library-default parameters.

## Signature

```ts
function resolveBackoffPreset(name: BackoffPreset): BackoffStrategy
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `BackoffPreset` | One of `constant`, `linear`, `exponential`, `fibonacci`, or `decorrelatedJitter`. |

## Returns

Configured strategy with default parameters.

## Basic Usage

```ts
import { resolveBackoffPreset, retry } from "@graphrefly/graphrefly-ts";

const out = retry(source, { count: 3, backoff: resolveBackoffPreset("exponential") });
// Equivalent to retry(source, { count: 3, backoff: exponential() })
```
