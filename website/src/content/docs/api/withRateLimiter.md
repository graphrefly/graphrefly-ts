---
title: "withRateLimiter()"
description: "Wrap an adapter with adaptive rate limiting. Returns `{adapter, limiter}`\nso callers can subscribe to limiter internals (rpmAvailable, pending, etc.)\nfor dashbo"
---

Wrap an adapter with adaptive rate limiting. Returns `{adapter, limiter}`
so callers can subscribe to limiter internals (rpmAvailable, pending, etc.)
for dashboards.

## Signature

```ts
function withRateLimiter(
	inner: LLMAdapter,
	opts: WithRateLimiterOptions = {},
): { adapter: LLMAdapter; limiter: AdaptiveRateLimiterBundle }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `inner` | `LLMAdapter` |  |
| `opts` | `WithRateLimiterOptions` |  |
