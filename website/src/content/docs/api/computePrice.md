---
title: "computePrice()"
description: "Compute price from a usage object + model pricing.\n\n- Tier-threshold math uses `sumInputTokens(usage)` as the axis.\n- Service tier (`opts.tier`) multiplies the "
---

Compute price from a usage object + model pricing.

- Tier-threshold math uses `sumInputTokens(usage)` as the axis.
- Service tier (`opts.tier`) multiplies the final total via `tierMultipliers`.
- Each token class is priced independently using the matching `Rate` lookup.
- `breakdown` is populated when `opts.withBreakdown = true` (default false
  to keep hot-path allocations low).

## Signature

```ts
function computePrice(
	usage: TokenUsage,
	pricing: ModelPricing,
	opts?: { tier?: string; withBreakdown?: boolean },
): PriceBreakdown
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `usage` | `TokenUsage` |  |
| `pricing` | `ModelPricing` |  |
| `opts` | `{ tier?: string; withBreakdown?: boolean }` |  |
