# Eval Results: Run 4 (Claude rerun post-catalog-update) + Gemini Pro — 2026-04-06

Date: 2026-04-06
Prompts: `evals/portable-eval-prompts.md` (post-catalog-update: feedback edges, templates, stratify routing, resilience ordering, validateSchema)
Prior run: `claude-web-2026-04-06-run3.md` (pre-catalog-update)

## What changed in the catalog

The Run 3 analysis identified three hallucination sources and two structural confusion patterns.
All were addressed as catalog documentation changes (no library code changes):

| Change | Fixes | Tasks affected |
|--------|-------|---------------|
| Added top-level `feedback` array schema + example | Hallucinated `convergeFn` values | T5, T6, T11 |
| Deprecated `feedback` as inline fn | LLM tried to express cycles in node config | T6, T11 |
| Added `templates` schema + example | T8a node duplication | T8a |
| Added stratify→filterBy routing clarification | Missing branch selection after stratify | T9 |
| Added resilience ordering guidance | Inverted resilience chains | T5, T8a, T8b |
| Removed `fn` field from `retry` | `fn: "rest-api"` hallucination | T5 |
| Added `validateSchema` fn | LLM used llmClassify for schema validation | T2 |

---

## Claude (Opus extended) — Run 4 post-catalog-update

### Treatment A: GraphSpec

```
Task 1:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 2:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)  ← was 12, +3 (validateSchema)
Task 3:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 4:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 5:  C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)  ← was 12, +2 (feedback edge, no hallucination)
Task 6:  C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)  ← was 11, +2 (feedback edge, no hallucination)
Task 7:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 8a: C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)  ← same score, but now uses templates
Task 8b: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 9:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)  ← was 14, +1 (filterBy after stratify)
Task 10: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 11: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)  ← was 12, +2 (feedback edges, no hallucination)
```

| Metric | Run 4 | Run 3 | Delta |
|--------|-------|-------|-------|
| Validity (C1=3) | 100% | 100% | — |
| Hallucination (C3<3) | **0%** | **25%** | **-25pp** |
| Bug rate (C4<3) | **42%** | **58%** | **-16pp** |
| Completeness (avg C5) | **2.83** | **2.58** | **+0.25** |
| Total score | **173/180** | **163/180** | **+10** |

#### Per-task notes

**T2 (15/15, was 12):** First perfect score in 4 runs. `validateSchema` with `onInvalid: "tag"` is exactly right — tags invalid items rather than dropping them, so the merge still works. Diamond topology preserved via `join` with `strategy: "all"`.

**T5 (14/15, was 12):** Uses `feedback` edge `{ from: "updateCache", to: "cachedPrice", maxIterations: 1 }` — cache write-back is now declarative and visible. `scan` with `fn: "latest"` extracts the most recent price for cache update. Remaining C4=2: timeout→retry ordering (timeout wraps whole retry sequence instead of each attempt).

**T6 (13/15, was 11):** Uses `feedback` edge `{ from: "computeInterval", to: "pollingInterval", maxIterations: 1 }`. No hallucinated `convergeFn`. Remaining issues: producer `pollIntervalMs: "$pollingInterval"` template syntax doesn't exist in schema (producers can't dynamically read state); `branch` node has string condition `"count > 100"` which isn't a valid config format. The interval adjustment logic is still incomplete.

**T8a (13/15, uses templates):** First use of templates across all runs. `resilientApi` template with `$source` param instantiated 3x. Per-source isolation is achieved structurally. Remaining: resilience ordering in template is wrong (rateLimiter→breaker→retry→timeout instead of the guided order); uses `fallbackValue: "cached"` string literal instead of `fallbackSource` with cache state; computes avg not median.

**T9 (15/15, was 14):** Perfect score. Uses `filterBy` after `stratify` to select branches — directly follows the routing guidance. P1/P2 get independent dedup→scorer→budgetGate→effect pipelines. P3 goes straight to ClickHouse.

**T11 (14/15, was 12):** Two feedback edges: `initClaim→claimState` (maxIterations 1) for initial load, `mergeClaim→claimState` (maxIterations 3) for convergence. No hallucinated names. Uses `distill` with `strategy: "latest"` (catalog fn). Remaining C4=2: `score` node deps only on `claimState` — needs existing DB claims for novelty comparison but has no DB query node.

### Treatment B: Functions

```
Task 1:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 2:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 3:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 4:  C1=3 C2=2 C3=3 C4=2 C5=2  (12/15)  newsletter digest commented out
Task 5:  C1=3 C2=3 C3=3 C4=1 C5=2  (12/15)  cache never populated (4th consecutive run)
Task 6:  C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)  windowing broken: counts.filter(() => true)
Task 7:  C1=3 C2=2 C3=3 C4=3 C5=2  (13/15)  no classification, just summarize+store
Task 8a: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)  cache populated on success path!
Task 8b: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)  cacheResult TTL=0 means cache never used
Task 9:  C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)  budgetCheck stateless
Task 10: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 11: C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)  scoreItem doesn't compare against existing
```

| Metric | Value |
|--------|-------|
| Validity | 100% |
| Hallucination | 0% |
| Bug rate | 50% (6/12) |
| Completeness | 2.58 |
| Total | 166/180 |

#### Notable Functions observations

**T4 (12/15):** Newsletter digest is commented out with `// Weekly digest would be triggered by a separate timer`. Buffer is populated but never consumed. This is an incomplete implementation — C2=2.

**T5 (12/15, C4=1):** Fourth consecutive run with the cache-never-populated bug. Success path returns price directly; error path calls `cacheResult` with a throwing fn. The cache is never written on success. **This is the most persistent Functions bug across all runs.**

**T8a (15/15):** First perfect score! `cacheResult` is now called on the success path: `await cacheResult(\`${api.name}_price\`, async () => price, 60_000)`. On error, reads from cache. This is the correct pattern. Resilience ordering matches guidance: `rateLimitCalls(withCircuitBreaker(retry(withTimeout(...))))`.

---

## Gemini Pro — GraphSpec

```
Task 1:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 2:  C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)  redundant merge after join
Task 3:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 4:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)  uses stratify+filterBy correctly
Task 5:  C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)  mapFields for API call (no actual fetch), hardcoded fallback
Task 6:  C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)  uses feedback edge, but mapFields can't compute intervals
Task 7:  C1=3 C2=3 C3=3 C4=3 C5=2  (14/15)  minimal: summarize→Slack only
Task 8a: C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)  uses templates! ordering reversed, hardcoded fallback
Task 8b: C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)  hardcoded fallback values, ordering wrong
Task 9:  C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)  merges P1+P2 before dedup (cross-branch collision)
Task 10: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)  clean: stratify+filterBy, approval, weekly report
Task 11: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)  uses feedback edge, well-structured loop
```

| Metric | Gemini GraphSpec |
|--------|-----------------|
| Validity | 100% |
| Hallucination | **0%** |
| Bug rate | 58% (7/12) |
| Completeness | 2.50 |
| Total | 167/180 |

#### Notable Gemini GraphSpec observations

**T4 (15/15):** Uses `stratify` with rules, then `filterBy` for each branch — follows routing guidance perfectly. Also uses `groupBy → aggregate → writeToDB` for "other" path. Best T4 GraphSpec output across all models/runs.

**T5 (13/15):** `apiCall` uses `mapFields` with empty config — this maps the timer output through identity, it doesn't actually fetch anything. There's no REST API source or fetch fn. The retry/fallback chain operates on timer ticks, not API responses. Fundamental design error.

**T6 (13/15):** Uses feedback edge `{ from: "calculateNewInterval", to: "intervalState" }`. But `calculateNewInterval` is just `mapFields` with a field mapping — there's no logic to compute 2000/30000/10000 based on count thresholds. The counting (batchEvents per minute → aggregate count) is correct.

**T8a (13/15):** Uses templates with `$url` param. But the template includes a `producer` node with `"url": "$url"` — bind maps `$url` to a string literal, not a node name. This is a config substitution pattern that the current `compileSpec` might not support (bind is documented for node name mapping). Creative but potentially non-functional.

**T9 (13/15):** Interesting architectural choice: merges P1+P2 into a single pipeline, dedup/score/budget shared, then re-filters by severity for routing. This means P1 and P2 share a dedup window (a critical "HighCPU" and warning "HighCPU" would collide) and share budget (20 total, not 20 each). Task is ambiguous on whether budget is per-branch.

**T11 (14/15):** Well-structured: `mergeExtractAndFeedback` combines new extracts with feedback state, `scoreClaim` scores the merged result, `stratifyNovelty` routes by score, low novelty → summarize → feedback. The loop is correctly expressed. Missing: DB query node for existing claims (same issue as Claude).

---

## Gemini Pro — Functions

```
Task 1:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 2:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 3:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 4:  C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)  routeByField fire-and-forget, count not incremented
Task 5:  C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)  cache pre-evaluated, never gets live prices
Task 6:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)  correct adaptive loop
Task 7:  C1=3 C2=3 C3=3 C4=3 C5=2  (14/15)  summarize+store only, no classification
Task 8a: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)  circuitBreaker outermost (should be rateLimiter)
Task 8b: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)  same ordering, cacheResult TTL=0
Task 9:  C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)  budgetCheck stateless, manual dedup is correct
Task 10: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 11: C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)  scoreItem doesn't measure novelty
```

| Metric | Gemini Functions |
|--------|-----------------|
| Validity | 100% |
| Hallucination | 0% |
| Bug rate | 50% (6/12) |
| Completeness | 2.75 |
| Total | 172/180 |

#### Notable Gemini Functions observations

**T6 (15/15):** Perfect adaptive polling. Clean `while(true)` loop, counts messages per fetch, adjusts interval with correct thresholds. Same as Run 2 Claude Functions T6 — imperative code handles feedback naturally.

**T9 (14/15):** Uses `recentAlerts` dict for persistent dedup state across iterations — solves the cross-invocation statelessness problem that plagued Run 3. `routeByField` for severity routing. `budgetCheck` is still stateless (fundamental API limitation).

---

## Cross-model comparison

### GraphSpec (Treatment A)

| Metric | Claude Run 4 | Gemini | Claude Run 3 (pre-catalog) |
|--------|:------------:|:------:|:--------------------------:|
| Hallucination | **0%** | **0%** | 25% |
| Bug rate | **42%** | 58% | 58% |
| Completeness | **2.83** | 2.50 | 2.58 |
| Total | **173** | 167 | 163 |

### Functions (Treatment B)

| Metric | Claude Run 4 | Gemini |
|--------|:------------:|:------:|
| Hallucination | 0% | 0% |
| Bug rate | 50% | **50%** |
| Completeness | 2.58 | **2.75** |
| Total | 166 | **172** |

### Head-to-head (per model, GraphSpec vs Functions)

| Model | GraphSpec | Functions | Winner |
|-------|:---------:|:---------:|:------:|
| Claude | **173** | 166 | **GraphSpec +7** |
| Gemini | 167 | **172** | **Functions +5** |

---

## Key Findings

### 1. Catalog update eliminated hallucination across both models

| | Run 3 Claude (pre) | Run 4 Claude (post) | Gemini (post) |
|---|:---:|:---:|:---:|
| Hallucination | 25% | **0%** | **0%** |

All three hallucination sources from Run 3 (convergeFn, retry.fn, noveltyConverge) are gone. Both Claude and Gemini correctly use `feedback` edges, `templates`, `validateSchema`, and `filterBy` after `stratify`. **The catalog is the primary lever for LLM output quality.**

### 2. Claude gains more from GraphSpec; Gemini gains more from Functions

Claude GraphSpec leads by +7 over Claude Functions. Gemini Functions leads by +5 over Gemini GraphSpec. This suggests model-specific strengths:
- Claude excels at structured composition (declarative topology)
- Gemini excels at imperative control flow (loops, closures, state management)

### 3. T5 cache pattern remains the hardest Functions bug

Across 4 Claude runs and 1 Gemini run, the cache-never-populated pattern persists in Functions T5. Claude T5 Functions has scored C4=1 in runs 3 and 4. The pattern (call cacheResult with throwing fn on error path, never write on success) is a trap that imperative code walks into every time. Claude T8a Functions finally got it right in Run 4 by writing to cache on the success path — suggesting the LLM CAN do it, but doesn't consistently.

### 4. Both models adopted all catalog features

| Feature | Claude | Gemini |
|---------|:------:|:------:|
| `feedback` edges | T5, T6, T11 | T6, T11 |
| `templates` | T8a | T8a |
| `filterBy` after `stratify` | T9 | T4, T9, T10 |
| `validateSchema` | T2 | T2 |

Gemini used stratify+filterBy more broadly (T4, T9, T10 vs just T9 for Claude). Claude used feedback edges more broadly (T5 cache write-back). Both used templates for T8a.

### 5. Remaining gaps are not catalog problems

| Remaining issue | Root cause | Catalog fix possible? |
|----------------|-----------|----------------------|
| T6: producer can't read state dynamically | Schema gap — producers have no `deps` | No — needs schema extension |
| T8a: resilience ordering still wrong | Guidance present but not enforced | Partially — could add more examples |
| T11: no DB query for existing claims | Missing `database` producer in the loop | No — architectural choice |
| T5 Functions: cache never populated | Imperative state management error | N/A (Functions treatment) |

---

## Catalog update impact summary

| Metric | GraphSpec pre-update (Run 3) | GraphSpec post-update (Run 4 Claude) | Delta |
|--------|:---:|:---:|:---:|
| Hallucination | 25% | **0%** | **-25pp** |
| Bug rate | 58% | **42%** | **-16pp** |
| Completeness | 2.58 | **2.83** | **+0.25** |
| Total | 163 | **173** | **+10** |

**The catalog update produced the largest single-run improvement in the eval history.** +10 points from documentation changes alone, no library code changes.
