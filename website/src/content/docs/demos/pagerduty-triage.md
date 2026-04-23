---
title: "PagerDuty triage"
description: "Two-mode alert triage — Baseline vs GraphReFly agentMemory. A 3-minute stream of synthetic PD alerts; the GraphReFly pipeline learns your decisions and auto-classifies future matches at zero token cost."
---

The PagerDuty triage demo streams 60 synthetic alerts through a reactive classify-and-route pipeline. Run it twice — once in **Baseline** mode, once in **GraphReFly** mode — and watch the auto-classify counter climb as `agentMemory` recognises your decision patterns.

[Run the PagerDuty triage demo →](/demos/pagerduty-triage/)

## Two pipeline modes

**Baseline** — every alert goes through the LLM classifier, is either auto-routed at ≥80% confidence or queued for you. No learning happens between sessions.

**GraphReFly** — same classifier, plus `agentMemory` watching your decisions. After 2 consistent decisions for the same (service, error-category) pair, a `LearnedPattern` is written to `patternsState`. From that point on, matching alerts are routed programmatically — no LLM call, no user prompt, instant. Token counter stays honest: local cache hits are counted separately from real calls.

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

`classifyNode` depends only on `currentAlert`. `patternsState` is read as a cold snapshot inside the callback so pattern updates never re-trigger the LLM on the current alert — the feedback cycle is structurally impossible.

`routeEffect` depends only on `classifyNode` and uses a `pendingAlerts` map keyed by `alertId` (echoed by the LLM in its JSON response) to guard against stale in-flight results when alerts arrive faster than the classifier responds.

Deferred alerts use `fromTimer` source nodes rather than raw `setTimeout`, keeping all scheduling inside the reactive graph.

## Option 5 pattern matching

Classification is two-tier:

1. **LLM** — `promptNode` classifies the alert and returns `{alertId, disposition, confidence, brief}`.
2. **Programmatic** — if `agentMemory` has a matching `LearnedPattern` with confidence ≥70%, `routeEffect` routes without ever invoking the LLM. Matching uses service equality, severity range intersection, and a ≥70% keyword overlap on the error category extracted from the summary.

The LLM decides what attributes matter (it picks the disposition); the matching is deterministic structural comparison. Zero tokens for auto-classifies.

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

Demo source lives at [`demos/pagerduty-triage/`](https://github.com/graphrefly/graphrefly-ts/tree/main/demos/pagerduty-triage) in the repo.
