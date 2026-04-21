---
title: "adaptiveRateLimiter()"
description: "Create an adaptive rate limiter. Compose with any call source via\n`await limiter.acquire({ requestCost, tokenCost, signal })`."
---

Create an adaptive rate limiter. Compose with any call source via
`await limiter.acquire({ requestCost, tokenCost, signal })`.

## Signature

```ts
function adaptiveRateLimiter(
	opts: AdaptiveRateLimiterOptions = {},
): AdaptiveRateLimiterBundle
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `AdaptiveRateLimiterOptions` |  |
