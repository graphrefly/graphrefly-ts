---
title: "resolveBackoffPreset()"
description: "Maps a preset name to a concrete  with library-default parameters."
---

Maps a preset name to a concrete  with library-default parameters.

## Signature

```ts
function resolveBackoffPreset(name: BackoffPreset): BackoffStrategy
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `BackoffPreset` | One of `constant`, `linear`, `exponential`, or `fibonacci`. |

## Returns

Configured strategy (1s constant/linear, default exponential/fibonacci).
