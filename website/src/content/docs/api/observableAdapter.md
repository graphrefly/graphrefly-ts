---
title: "observableAdapter()"
description: "Wrap any LLMAdapter with a reactive stats bundle.\n\nImplementation:\n- `stats.lastCall` is a `state<CallStatsEvent | undefined>` exposed via a\n  null-filtering de"
---

Wrap any LLMAdapter with a reactive stats bundle.

Implementation:
- `stats.lastCall` is a `state&lt;CallStatsEvent | undefined&gt;` exposed via a
  null-filtering derived so consumers see a typed `Node&lt;CallStatsEvent&gt;`.
- Counters (`totalCalls` / `totalInputTokens` / `totalOutputTokens`) are
  plain state nodes updated via `.emit()`.
- `stats.allCalls` is a `reactiveLog&lt;CallStatsEvent&gt;` — bounded, supports
  `tail(n)` / `slice(start, stop)` for dashboard views.
- The wrapped adapter passes DATA through via a `derived` tap that writes
  to the stats nodes as a side-effect. No pricing — users compose pricing
  as a derived on top of `stats.lastCall`.

## Signature

```ts
function observableAdapter(
	inner: LLMAdapter,
	opts?: { logMax?: number; name?: string },
): { adapter: LLMAdapter; stats: AdapterStats }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `inner` | `LLMAdapter` |  |
| `opts` | `{ logMax?: number; name?: string }` |  |
