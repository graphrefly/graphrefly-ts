---
title: "withBreaker()"
description: "API reference for withBreaker."
---

## Signature

```ts
function withBreaker(
	inner: LLMAdapter,
	opts: WithBreakerOptions = {},
): { adapter: LLMAdapter; breaker: CircuitBreaker }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `inner` | `LLMAdapter` |  |
| `opts` | `WithBreakerOptions` |  |
