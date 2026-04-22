---
title: "resilientAdapter()"
description: "Wrap `inner` with the standard resilience stack. See module docs for the\ncomposition order and rationale."
---

Wrap `inner` with the standard resilience stack. See module docs for the
composition order and rationale.

## Signature

```ts
function resilientAdapter(
	inner: LLMAdapter,
	opts: ResilientAdapterOptions = {},
): ResilientAdapterBundle
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `inner` | `LLMAdapter` |  |
| `opts` | `ResilientAdapterOptions` |  |

## Basic Usage

```ts
const { adapter, budget, breaker } = resilientAdapter(openai, {
    rateLimit: { rpm: 60, tpm: 90_000 },
    budget: { caps: { usd: 5 } },
    breaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
    timeoutMs: 30_000,
    retry: { attempts: 3 },
    fallback: webllm,  // cascades to local on exhaustion
  });

// `adapter` is drop-in for anything expecting LLMAdapter.
// Subscribe to `budget.totals`, `breaker.state`, etc. for dashboards.
```
