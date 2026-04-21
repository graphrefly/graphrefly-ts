---
title: "registryPricing()"
description: "Build a `PricingFn` from a `PricingRegistry`. If no entry matches, returns\n`{ total: 0, currency: \"USD\" }` (never throws). Callers who need \"unknown\nmodel\" fail"
---

Build a `PricingFn` from a `PricingRegistry`. If no entry matches, returns
`{ total: 0, currency: "USD" }` (never throws). Callers who need "unknown
model" failures can compose their own `PricingFn`.

## Signature

```ts
function registryPricing(registry: PricingRegistry, defaultCurrency = "USD"): PricingFn
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `registry` | `PricingRegistry` |  |
| `defaultCurrency` | `unknown` |  |
