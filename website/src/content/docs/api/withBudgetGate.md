---
title: "withBudgetGate()"
description: "Wrap an adapter with budget enforcement. Returns `{adapter, budget}` so\ncallers can subscribe to the bundle for dashboards."
---

Wrap an adapter with budget enforcement. Returns `{adapter, budget}` so
callers can subscribe to the bundle for dashboards.

## Signature

```ts
function withBudgetGate(
	inner: LLMAdapter,
	opts: WithBudgetGateOptions,
): { adapter: LLMAdapter; budget: BudgetGateBundle }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `inner` | `LLMAdapter` |  |
| `opts` | `WithBudgetGateOptions` |  |
