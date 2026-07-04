---
title: "Historical PagerDuty triage demo"
description: "Historical pre-CSP-9 browser demo notes retained for reference."
---

> **Legacy TypeScript website content.** Shared public website, blog, protocol, guide, and
> language-neutral docs ownership now lives in `~/src/graphrefly` under D563.
> This page is retained here only as migration/reference material while the TS
> API generator still lives in `website/`.


These notes describe the historical pre-CSP-9 PagerDuty triage browser demo. Its
source was retired from the active tree during CSP-9/B66 closeout because it
depended on retired root/pure-ts demo surfaces such as old AI utilities,
`agentMemory`, and `utils/demo-shell`, so it is not an active clean-slate demo or
workspace package.

The historical demo streamed 60 synthetic alerts through a reactive
classify-and-route pipeline. Run twice, once in **Baseline** mode and once in
**GraphReFly** mode, it showed the auto-classify counter climb as old
`agentMemory` recognised decision patterns.

## Historical pipeline modes

**Baseline** — every alert went through the LLM classifier, was either
auto-routed at >=80% confidence or queued for the user, and learned nothing
between sessions.

**GraphReFly** — same old classifier, plus the retired `agentMemory` helper
watching decisions. After 2 consistent decisions for the same
(service, error-category) pair, the demo wrote a `LearnedPattern` to
`patternsState`; matching alerts were then routed programmatically.

## Graph topology

```
currentAlert
    │
    ▼
classifyNode (promptNode — LLM)
    │
    ▼
routeEffect ──► binsState (actionable / escalated / resolved / deferred)
    │           userQueueState (awaiting human decision)
    │
decisionLog ──► agentMemory.compact ──► patternsState
                                            │
                              (snapshot read in classifyNode callback)
```

In the historical design, `classifyNode` depended only on `currentAlert`.
`patternsState` was read as a cold snapshot inside the callback so pattern
updates never re-triggered the LLM on the current alert.

`routeEffect` depended only on `classifyNode` and used a `pendingAlerts` map
keyed by `alertId` to guard against stale in-flight results when alerts arrived
faster than the classifier responded.

Deferred alerts used old source helpers rather than raw `setTimeout`; this is
historical provenance, not current source guidance.

## Option 5 pattern matching

Classification is two-tier:

1. **LLM** — the old `promptNode` demo utility classified the alert and returned `{alertId, disposition, confidence, brief}`.
2. **Programmatic** — if the retired `agentMemory` helper had a matching `LearnedPattern` with confidence >=70%, `routeEffect` routed without invoking the LLM.

The matching idea may still be useful later, but a current implementation should
be designed over `@graphrefly/ts` orchestration/pattern subpaths.

## Token accounting

The token bar at the bottom of the main pane shows cumulative `inputTokens`, `outputTokens`, `LLM calls`, and (GraphReFly only) `localCacheHits`. All counts are updated atomically via `batch()`. Token estimates are intentionally approximate — a real deployment would read `response.usage` from the adapter.

## LLM adapters

| Mode | Notes |
|------|-------|
| Dry-run | Deterministic mock — keyword rules, no latency. Full graph topology and UX visible without an API key. |
| Chrome Nano | `window.LanguageModel` (Chrome 138+ with Prompt API flag). On-device Gemini Nano, zero cost. |
| BYOK | Any OpenAI-compatible API. Enter base URL, key, and model on the setup screen. |

## Alert generator

60 synthetic alerts are generated at page load from a seeded PRNG (mulberry32). Emission rate ramps: alerts 0–19 at 4 s each, 20–39 at 2 s, 40–59 at 1 s. The 3-minute hard cap stops emission; any queued alerts remain actionable. Click **Randomize Alerts** on the setup screen to reseed.

## Source

The historical browser source was removed from the active workspace rather than
migrated through compatibility shims. Re-activating this concept should be a new
slice over current `@graphrefly/ts` orchestration/pattern public subpaths, not a
compatibility shim.
