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
