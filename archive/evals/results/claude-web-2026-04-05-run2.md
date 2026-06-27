# Eval Results: Claude Web Chat — 2026-04-05 (Run 2, post-3.1c catalog)

AI: Claude (web chat, model version unknown)
Date: 2026-04-05
Prompts: `evals/portable-eval-prompts.md` (updated with 3.1c resilience catalog)
Prior run: `claude-web-2026-04-05.md` (pre-3.1c, 7 tasks)

## Changes from Run 1

- **Catalog additions (Treatment A):** `timeout`, `circuitBreaker`, `rateLimiter`, `withStatus`. Updated `retry` (fibonacci backoff), `fallback` (fallbackSource), `cache` (TTL required).
- **Utility additions (Treatment B):** `retry`, `withFallback`, `withTimeout`, `withCircuitBreaker`, `rateLimitCalls`, `cacheResult`.
- **New Task 8:** resilience composition — timeout + retry + fallback + circuit breaker + rate limiter + merge + withStatus across 3 parallel API sources.

---

## Treatment A: GraphSpec

```
Task 1: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 2: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 3: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 4: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 5: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 6: C1=3 C2=2 C3=3 C4=2 C5=2  (12/15)
Task 7: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 8: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
```

| Metric | Run 2 | Run 1 (7 tasks) | Delta |
|--------|-------|-----------------|-------|
| Validity rate (C1=3) | 8/8 = 100% | 7/7 = 100% | — |
| Task completion rate (C2≥2) | 8/8 = 100% | 7/7 = 100% | — |
| Hallucination rate (C3<3) | 0/8 = 0% | 2/7 = 29% | **-29pp** ✓ |
| Bug rate (C4<3) | 4/8 = 50% | 5/7 = 71% | **-21pp** ✓ |
| Avg Completeness (C5) | 2.88 | 2.71 | **+0.17** ✓ |

### Notes

**Task 2 (C4=2):** Used `llmExtract` for schema validation — semantically wrong (AI extraction ≠ validation) but no dedicated `validate` fn in catalog. Same issue as Run 1; not a catalog gap from 3.1c.

**Task 5 (C4=2):** `priceCache` state node declared but `updateCache` effect uses `cache` fn rather than writing back to `priceCache`. The fallback/cache feedback loop is ambiguous — the LLM can't close the loop between "successful fetch → update cache" and "failed fetch → read cache." Improvement over Run 1 (C4=1→2, C5=2→3): the catalog additions gave the LLM the right vocabulary, but the schema still lacks a `writes` field for the write-back.

**Task 6 (C4=2, C5=2):** Feedback loop still broken. LLM invented `"{{pollInterval}}"` template syntax and `"target": "pollInterval"` on the effect node — schema extensions that don't exist. The actual interval-computation logic is missing: `checkHigh`/`checkLow` produce booleans but nothing maps those to concrete interval values. **Persistent weakness across both runs** — confirms this is a schema expressiveness gap, not a catalog problem.

**Task 8 (C4=2):** Shared `circuitBreaker` and `rateLimiter` nodes placed before the 3-way fan-out. One API's failures trip the breaker for all three — architectural bug. Per-branch resilience (timeout/retry/fallback) is correctly duplicated per API. The LLM correctly used all new catalog entries (`timeout`, `circuitBreaker`, `rateLimiter`, `withStatus`) — no hallucination. The bug is in topology design, not vocabulary.

### Run 1 → Run 2 improvement on Tasks 5/6

| Task | Run 1 score | Run 2 score | Change |
|------|-------------|-------------|--------|
| T5 | C4=1 C5=2 (10/15) | C4=2 C5=3 (14/15) | **+4** |
| T6 | C4=1 C5=2 (11/15) | C4=2 C5=2 (12/15) | **+1** |

**T5 improved significantly** — the catalog additions (`fallback` with `fallbackSource`, `cache` with required TTL) gave the LLM correct building blocks. Remaining bug is the write-back gap.

**T6 barely improved** — feedback loops are a schema problem, not a catalog problem. Confirmed by Run 1 analysis.

---

## Treatment B: Functions

```
Task 1: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 2: C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)
Task 3: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 4: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 5: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 6: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 7: C1=3 C2=2 C3=3 C4=2 C5=2  (12/15)
Task 8: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
```

| Metric | Run 2 | Run 1 (7 tasks) | Delta |
|--------|-------|-----------------|-------|
| Validity rate (C1=3) | 8/8 = 100% | 7/7 = 100% | — |
| Task completion rate (C2≥2) | 8/8 = 100% | 7/7 = 100% | — |
| Hallucination rate (C3<3) | 0/8 = 0% | 0/7 = 0% | — |
| Bug rate (C4<3) | 4/8 = 50% | 2/7 = 29% | +21pp |
| Avg Completeness (C5) | 2.75 | 3.0 | -0.25 |

### Notes

**Task 2 (C4=2, C5=2):** No actual schema validation — `validateSchema` called but result not used to reject invalid payloads. Missing explicit error handling.

**Task 4 (C4=2):** SQL injection via string interpolation. Newsletter batch fires on next email arrival after week elapses, not on a timer — could delay digest indefinitely.

**Task 5 (C4=2):** `withFallback` Promise-level fallback may evaluate cached branch eagerly via `.then()` chaining. `source` variable mutation across async boundaries is fragile.

**Task 6 (C4=3, C5=3):** Perfect. `while(true)` + `setTimeout` with timestamp-based rate tracking correctly implements adaptive polling. Same as Run 1 — imperative code handles feedback loops naturally.

**Task 7 (C4=2, C5=2):** Incomplete behavior coverage — spam written to generic `email_summaries` table instead of separate spam log. Informational category handling missing.

**Task 8 (C4=3, C5=3):** Solid. Each `callApi()` wraps its own resilience stack — per-call isolation emerges naturally from imperative composition. Correctly uses `prices[1]` as median of 3 sorted values.

---

## Head-to-Head

| Metric | GraphSpec | Functions | Winner |
|--------|-----------|-----------|--------|
| Validity | 100% | 100% | Tie |
| Task completion | 100% | 100% | Tie |
| Hallucination rate | 0% | 0% | **Tie** (was Functions) |
| Bug rate | 50% | 50% | **Tie** (was Functions) |
| Completeness | 2.88 | 2.75 | **GraphSpec** (was Functions) |
| Total score | 114/120 | 113/120 | **Tie** (+1 GraphSpec) |

### Per-task winner

| Task | GraphSpec | Functions | Winner |
|------|-----------|-----------|--------|
| T1 (linear) | 15 | 15 | Tie |
| T2 (diamond) | 14 | 13 | GraphSpec |
| T3 (stateful) | 15 | 15 | Tie |
| T4 (fan-out) | 15 | 14 | GraphSpec |
| T5 (error handling) | 14 | 14 | Tie |
| T6 (feedback loop) | 12 | 15 | **Functions** |
| T7 (ambiguous) | 15 | 12 | **GraphSpec** |
| T8 (resilience) | 14 | 15 | **Functions** |

---

## Key Findings

### 1. Catalog update eliminated hallucination gap

Run 1 had 29% hallucination for GraphSpec vs 0% for Functions. Run 2: 0% for both. Adding `timeout`, `circuitBreaker`, `rateLimiter`, `withStatus` to the catalog gave the LLM the vocabulary it needed. **The catalog is load-bearing for LLM-DX.**

### 2. GraphSpec caught up overall but has structural weaknesses

Total scores nearly identical (114 vs 113). GraphSpec wins on structural tasks (T2 diamond, T4 fan-out, T7 ambiguous interpretation). Functions win on tasks requiring imperative logic (T6 feedback, T8 per-branch resilience).

### 3. Two schema gaps confirmed across both runs

**Feedback loops (T6):** GraphSpec has no `writes` / `target` field for effects that mutate state nodes. The LLM invents schema extensions both times. This is the #1 schema expressiveness gap.

**Per-branch composition (T8):** No "template" or "subgraph factory" concept. When the same resilience pattern must be applied per-source, the LLM either duplicates correctly (timeout/retry/fallback) or shares incorrectly (breaker/limiter). Code naturally gets per-call isolation via function scope.

### 4. GraphSpec's advantage is ambiguity handling

T7 (ambiguous "do something useful with my emails") — GraphSpec produced a clean, complete pipeline (15/15). Functions missed behaviors (12/15). The constrained catalog forces the LLM to compose from known-good building blocks rather than inventing ad-hoc logic.

### 5. This eval tier only measures generation quality

The audit's strongest claims — auditability via `describe()`, causal chains, structural diff, progressive trust — are not tested. A second eval tier measuring "given a graph, can an LLM debug/modify/explain it?" would test the actual differentiators.

---

## Action Items

1. ~~**Schema: `writes` field for feedback loops**~~ → decided against standalone `writeTo` (it's just `graph.set()` renamed). Feedback loops use §8.1 `feedback()` serialized as top-level `"feedback"` array in GraphSpec §8.3. The fn is a normal derived computation; the cycle is the feedback edge. No `conditionMap` needed — if-else is just a derived fn. Added to roadmap §8.3.
2. ~~**Schema: subgraph template / pattern reuse**~~ → added to roadmap §8.3 as `"templates"` top-level key + `"type": "template"` node type. `compileSpec()` expands into `graph.mount()`.
3. ~~**Eval: add L1 tier**~~ → done, added to `portable-eval-prompts.md` (6 tasks: explain, debug, modify, diff, blast radius, resilience retrofit)
4. ~~**Eval: split T8**~~ → done, split into T8a (per-source isolation) and T8b (shared gating) in `portable-eval-prompts.md`
5. **Run across more models** — GPT-4o, Gemini, smaller models to validate catalog sufficiency
6. **Re-run L0 + L1 evals after §8.3 ships** — validate that `feedback` edges fix T6 and `templates` fix T8a

---

## Raw Outputs

GraphSpec and Functions outputs for this run are recorded in the conversation that generated this eval. Prompt version: `evals/portable-eval-prompts.md` as of commit containing 3.1c catalog additions.
