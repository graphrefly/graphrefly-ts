---
title: "composePricing()"
description: "Compose multiple `PricingFn`s — first non-zero wins. Useful for registry layering."
---

Compose multiple `PricingFn`s — first non-zero wins. Useful for registry layering.

## Signature

```ts
function composePricing(...fns: readonly PricingFn[]): PricingFn
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fns` | `readonly PricingFn[]` |  |
