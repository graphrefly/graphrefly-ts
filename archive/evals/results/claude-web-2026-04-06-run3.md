# Eval Results: Claude Web Chat — 2026-04-06 (Run 3, post-§8.3 w/ feedback + templates + reduction + T9-T11)

AI: Claude (web chat, model version unknown)
Date: 2026-04-06
Prompts: `evals/portable-eval-prompts.md` (12 tasks: T1-T7, T8a/b, T9-T11)
Prior run: `claude-web-2026-04-05-run2.md` (8 tasks, post-3.1c catalog)

## Changes from Run 2

- **New tasks:** T8 split into T8a (per-source isolation) / T8b (shared gating). Added T9 (reduction pipeline), T10 (orchestration w/ approval), T11 (feedback w/ LLM).
- **Library shipped since Run 2:** §8.3 GraphSpec `feedback` edges + `templates` + `compileSpec()`. §8.1 reduction primitives (`stratify`, `scorer`, `budgetGate`, `feedback`).
- **Catalog NOT updated:** The portable-eval-prompts.md system context still describes individual nodes only. It does NOT mention top-level `feedback` array or `templates` — the LLM has no way to know these features exist.

---

## Treatment A: GraphSpec

```
Task 1:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 2:  C1=3 C2=2 C3=3 C4=2 C5=2  (12/15)
Task 3:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 4:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 5:  C1=3 C2=3 C3=2 C4=2 C5=2  (12/15)
Task 6:  C1=3 C2=2 C3=2 C4=2 C5=2  (11/15)
Task 7:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 8a: C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)
Task 8b: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 9:  C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 10: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 11: C1=3 C2=3 C3=2 C4=2 C5=2  (12/15)
```

| Metric | Run 3 (12 tasks) | Run 2 (8 tasks) | Delta |
|--------|------------------|-----------------|-------|
| Validity rate (C1=3) | 12/12 = 100% | 8/8 = 100% | — |
| Task completion (C2>=2) | 12/12 = 100% | 8/8 = 100% | — |
| Hallucination rate (C3<3) | 3/12 = 25% | 0/8 = 0% | **+25pp** regression |
| Bug rate (C4<3) | 7/12 = 58% | 4/8 = 50% | +8pp |
| Avg Completeness (C5) | 2.58 | 2.88 | **-0.30** |
| Total score | 163/180 | 114/120 | — (different N) |

### Per-task notes

**T2 (C2=2, C4=2):** Uses `llmClassify` for schema validation — same persistent issue, no `validateSchema` fn in catalog. Semantic mismatch not a catalog gap (validation is domain logic, not a reactive primitive).

**T5 (C3=2, C4=2):** `retry` config uses `fn: "rest-api"` — references a source name, not a catalog function. Cache state node (`cachedPrice`) never updated by fallback output. Same write-back gap as Run 2.

**T6 (C3=2, C4=2):** `feedback` config uses `convergeFn: "adjustPollRate"` — hallucinated, not in catalog. Producer has `deps: ["pollInterval"]` (non-standard). Feedback loop still doesn't close — nothing writes back to `pollInterval` state. **Third consecutive run with this failure.** The LLM doesn't know about the top-level `"feedback"` array because the catalog doesn't mention it.

**T8a (C4=2, C5=2):** Resilience ordering inverted: timeout → rateLimiter → circuitBreaker → retry. Should be rateLimiter → circuitBreaker → retry → timeout(innerCall). Also computes `aggregate` with op "avg" but task says median (catalog has no median fn — catalog gap). Per-source isolation is correctly expressed as 3 independent chains. No `templates` used (LLM doesn't know about them).

**T8b (C4=2):** Same resilience ordering issue. Shared stack is correctly shared (single pipeline before fan-out).

**T9 (C4=2):** Both `p1Dedup` and `p2Dedup` depend directly on `stratify` with no branch selection. Compare to Graph C (L1 section) which uses explicit `filterBy` after `stratify`. The catalog doesn't clarify that stratify output requires filterBy to select branches.

**T10 (C4=3):** Best-in-class output. Approval gate, merge all decisions, weekly batch report — all cleanly expressed. This is GraphSpec's sweet spot: orchestration topology.

**T11 (C3=2, C4=2):** `feedback` config uses `convergeFn: "noveltyConverge"` — hallucinated. Feedback node doesn't feed back to `scoreClaim`. Same structural issue as T6: the LLM tries to express feedback within a single node's config rather than as a graph-level cycle.

### Hallucination regression analysis

Run 2 had 0% hallucination (8 tasks). Run 3 has 25% (3/12). But this is entirely from:
- T5: `fn: "rest-api"` (persistent issue from Run 1)
- T6: `convergeFn: "adjustPollRate"` (persistent issue)
- T11: `convergeFn: "noveltyConverge"` (new task, same pattern as T6)

All three are the **same root cause**: the `feedback` fn's `convergeFn` config field has no valid values listed. The LLM invents plausible names. This is a catalog documentation gap, not an LLM capability regression.

---

## Treatment B: Functions

```
Task 1:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 2:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 3:  C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 4:  C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 5:  C1=3 C2=3 C3=3 C4=1 C5=2  (12/15)
Task 6:  C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)
Task 7:  C1=3 C2=2 C3=3 C4=3 C5=2  (13/15)
Task 8a: C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)
Task 8b: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 9:  C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)
Task 10: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 11: C1=3 C2=3 C3=3 C4=2 C5=2  (13/15)
```

| Metric | Run 3 (12 tasks) | Run 2 (8 tasks) | Delta |
|--------|------------------|-----------------|-------|
| Validity rate (C1=3) | 12/12 = 100% | 8/8 = 100% | — |
| Task completion (C2>=2) | 12/12 = 100% | 8/8 = 100% | — |
| Hallucination rate (C3<3) | 0/12 = 0% | 0/8 = 0% | — |
| Bug rate (C4<3) | 7/12 = 58% | 4/8 = 50% | +8pp |
| Avg Completeness (C5) | 2.50 | 2.75 | -0.25 |
| Total score | 165/180 | 113/120 | — (different N) |

### Per-task notes

**T4 (C4=2):** SQL injection via `WHERE sender='${e.from}'`. `routeByField` callbacks are `void` but routes fire async — fire-and-forget, errors silently swallowed.

**T5 (C4=1):** Cache never populated. Success path returns price directly without calling `cacheResult`. Error path calls `cacheResult` with a throwing fn — will always fail on first error since cache is empty. **Worst score in the entire eval.** Imperative cache management is error-prone.

**T6 (C4=2, C5=2):** Counts poll *attempts* (timestamps of `counts.push(now)`) not *messages returned*. Task says "count how many messages arrive per minute." Also `fetchFromApi` result is discarded — no message processing at all.

**T7 (C2=2, C5=2):** Classifies into 3 categories but ignores spam entirely. No daily digest. Thinnest interpretation of ambiguous task.

**T8a (C4=2, C5=2):** `cacheResult` with throwing fn — same never-populated cache pattern as T5. One-shot execution, no timer loop (task says "call" not "continuously monitor" so debatable).

**T9 (C4=2, C5=2):** `deduplicate([a], "alert_name", 300000)` operates on a single-element array per invocation — no cross-invocation state, so dedup is broken. `budgetCheck(1, 20, 3600000)` similarly stateless — no shared counter across calls. Fundamental impedance mismatch: stateful operators require persistent state that doesn't exist in imperative per-event functions.

**T10 (C4=3):** Correct if/else flow, `requestApproval` properly awaited. Weekly report via setInterval + spliced buffer works in single-threaded JS.

**T11 (C4=2, C5=2):** SQL injection in `queryDatabase`. `scoreItem(current, { newInfo: 1 })` doesn't actually compare against existing claims for novelty — just scores the item alone with arbitrary weights. The manual 3-iteration loop is correctly structured but the scoring is semantically broken.

---

## Head-to-Head: Run 3

| Metric | GraphSpec | Functions | Winner |
|--------|:---------:|:---------:|:------:|
| Validity | 100% | 100% | Tie |
| Task completion | 100% | 100% | Tie |
| Hallucination rate | **25%** | **0%** | **Functions** |
| Bug rate | 58% | 58% | Tie |
| Completeness | **2.58** | **2.50** | **GraphSpec** (marginal) |
| Total score | 163 | 165 | **Functions** (+2) |

### Per-task winner

| Task | GraphSpec | Functions | Winner |
|------|:---------:|:---------:|:------:|
| T1 (linear) | 15 | 15 | Tie |
| T2 (diamond) | 12 | 15 | **Functions** |
| T3 (stateful) | 15 | 15 | Tie |
| T4 (fan-out) | 15 | 14 | **GraphSpec** |
| T5 (error handling) | 12 | 12 | Tie |
| T6 (feedback) | 11 | 13 | **Functions** |
| T7 (ambiguous) | 15 | 13 | **GraphSpec** |
| T8a (per-source) | 13 | 13 | Tie |
| T8b (shared) | 14 | 14 | Tie |
| T9 (reduction) | 14 | 13 | **GraphSpec** |
| T10 (orchestration) | 15 | 15 | Tie |
| T11 (feedback+LLM) | 12 | 13 | **Functions** |

GraphSpec wins: T4 (fan-out topology), T7 (ambiguity → structured interpretation), T9 (reduction pipeline)
Functions wins: T2 (Promise.all natural), T6 (imperative feedback), T11 (manual loop easier)

---

## Key Findings

### 1. Hallucination regressed because the catalog doesn't document §8.3 features

All 3 hallucinations (T5, T6, T11) stem from the same root cause: `convergeFn` and `retry.fn` config fields have no valid values listed. The LLM invents plausible names. **This is a catalog documentation gap, not an LLM capability problem.** Run 2 had 0% hallucination after the 3.1c catalog update proved that fixing the catalog fixes hallucination.

### 2. Bug types are qualitatively different (same rate)

| | GraphSpec bugs | Functions bugs |
|---|---|---|
| **Nature** | Structural: wrong ordering, unclosed cycles, missing branch routing | Behavioral: stateless operators, cache never populated, fire-and-forget async |
| **Inspectability** | Visible by reading JSON deps chain | Hidden in runtime execution traces |
| **Fix effort** | Reorder deps, add a node | Must understand execution model |
| **Best example** | T8a: timeout→rateLimiter→breaker→retry (wrong order, visible in deps) | T5: `cacheResult` never called on success path (must trace both branches) |

### 3. Functions' T5 is the worst single output (C4=1)

Cache is never populated on the success path. Fallback calls `cacheResult` with a throwing function. On first API failure, fallback also fails. This is a silent runtime bug invisible from code review. GraphSpec's T5 (C4=2) at least has a visible structural gap (cache state node not connected to fallback output).

### 4. Stateful operators are broken in Functions treatment

T9 is the clearest case: `deduplicate([a], ...)` on a single-element array per event has no cross-invocation memory. `budgetCheck` is similarly stateless. Imperative per-event functions can't express persistent windowed state without explicit external stores. GraphSpec nodes implicitly carry state across events.

### 5. GraphSpec's structural advantages hold for orchestration and reduction

T4 (fan-out), T9 (reduction pipeline), T10 (orchestration) — all score equal or better in GraphSpec. The declarative deps graph naturally expresses topology. Functions require manual control flow that's harder to audit.

---

## Action Items

1. **UPDATE CATALOG** — Add `feedback` edges, `templates`, `stratify` routing clarification, resilience ordering guidance to `portable-eval-prompts.md`. This is the #1 fix — Run 2 proved catalog updates eliminate hallucination.
2. **Re-run after catalog update** — Expect hallucination to drop to 0%, T6/T11 feedback loops to improve, T8a to use templates.
3. **Consider adding `validateSchema` fn to catalog** — T2 has used wrong tools (llmClassify/llmExtract) across all 3 runs.
4. **Run across more models** — still only Claude data. Need GPT-4o, Gemini for validation.

---

## Raw Outputs

GraphSpec and Functions outputs for this run are recorded in the conversation that generated this eval.
