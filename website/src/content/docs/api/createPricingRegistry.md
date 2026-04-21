---
title: "createPricingRegistry()"
description: "Create a fresh `PricingRegistry`. Optionally seed with entries."
---

Create a fresh `PricingRegistry`. Optionally seed with entries.

## Signature

```ts
function createPricingRegistry(
	initial?: ReadonlyArray<readonly [provider: string, model: string, pricing: ModelPricing]>,
): PricingRegistry
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `ReadonlyArray&lt;readonly [provider: string, model: string, pricing: ModelPricing]&gt;` |  |
