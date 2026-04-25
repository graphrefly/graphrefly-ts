---
title: "observableAdapter()"
description: "Wrap any LLMAdapter with a reactive stats bundle.\n\nImplementation (Unit 10 B):\n- `stats.lastCall` is a `state<CallStatsEvent | null>`.\n- Counters (`totalCalls` "
---

Wrap any LLMAdapter with a reactive stats bundle.

Implementation (Unit 10 B):
- `stats.lastCall` is a `state&lt;CallStatsEvent | null&gt;`.
- Counters (`totalCalls` / `totalInputTokens` / `totalOutputTokens`) are
  **derived views** over `allCalls.entries` — self-maintaining, no manual
  `.cache + 1 + emit` pattern, visible topology in `describe()`.
- `stats.allCalls` is a `reactiveLog&lt;CallStatsEvent&gt;` — bounded, supports
  `tail(n)` / `slice(start, stop)` for dashboard views.
- The wrapped adapter passes DATA through via `adaptInvokeResult`, which
  uses `onFirstData` internally to guard against re-subscription double-fire
  and wires `.catch` for Promise-path error recording (Unit 10 A).

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
