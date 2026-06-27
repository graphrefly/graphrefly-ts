# Eval Results: Claude Web Chat — 2026-04-05

AI: Claude (web chat, model version unknown)
Date: 2026-04-05
Prompts: `evals/portable-eval-prompts.md`

---

## Treatment A: GraphSpec

```
Task 1: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 2: C1=3 C2=3 C3=2 C4=2 C5=3  (13/15)
Task 3: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 4: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 5: C1=3 C2=2 C3=2 C4=1 C5=2  (10/15)
Task 6: C1=3 C2=2 C3=3 C4=1 C5=2  (11/15)
Task 7: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
```

| Metric | Value |
|--------|-------|
| Validity rate (C1=3) | 7/7 = 100% |
| Task completion rate (C2>=2) | 7/7 = 100% |
| Hallucination rate (C3<3) | 2/7 = 29% |
| Bug rate (C4<3) | 5/7 = 71% |
| Avg Completeness (C5) | 19/21 = 2.71 |

### Notes

**Task 1:** `mapFields({ title: "title" })` is a no-op identity mapping — unnecessary node but not harmful.

**Task 2:** Used `llmExtract` for schema validation — semantically wrong (AI extraction != validation) but no dedicated validate fn exists in catalog.

**Task 3:** `currentAvg` state node has `deps: ["rollingAverage"]` — state nodes don't take deps per the schema spec. The state node is redundant since `rollingAvg` already computes the running average.

**Task 4:** Perfect score. Fan-out with classify + 3 filtered branches is clean and correct.

**Task 5 (worst):** Major issues:
- No producer node for the actual API call — `retry` config references `"fn": "rest-api"` (a source, not a function)
- `cache` derives from `fetchPrice` but should be populated from successful fetches, not the retry node
- `fallback` deps on both inputs but no mechanism to select which to use
- "Log every attempt" only logs final result, not each attempt

**Task 6 (second worst):** Feedback loop is broken:
- `messagePoll` producer has `deps: ["pollInterval"]` — producers don't take deps
- `adjustInterval` uses `mapFields` which just remaps field names, doesn't compute new interval
- The loop never closes — model acknowledges this in its own notes

**Task 7:** Good interpretation of ambiguous prompt. Summarize + daily batch + format + email is a reasonable pipeline.

---

## Treatment B: Functions

```
Task 1: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 2: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 3: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 4: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 5: C1=3 C2=3 C3=3 C4=2 C5=3  (14/15)
Task 6: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
Task 7: C1=3 C2=3 C3=3 C4=3 C5=3  (15/15)
```

| Metric | Value |
|--------|-------|
| Validity rate (C1=3) | 7/7 = 100% |
| Task completion rate (C2>=2) | 7/7 = 100% |
| Hallucination rate (C3<3) | 0/7 = 0% |
| Bug rate (C4<3) | 2/7 = 29% |
| Avg Completeness (C5) | 21/21 = 3.0 |

### Notes

**Task 4:** SQL injection via string interpolation `'${sender}'` in `queryDatabase`. Logic otherwise correct.

**Task 5:** `pollSource(apiUrl, 60_000)` + `fetchPriceWithRetry(apiUrl, ...)` double-fetches — pollSource already calls the API, then the handler calls it again. Retry count is 4 attempts (should be 1 initial + 3 retries = 4, arguably correct but ambiguous).

**Task 6:** Perfect — `while(true)` + `setTimeout` with timestamp-based rate tracking correctly implements adaptive polling with proper default-interval reset.

---

## Head-to-Head

| Metric | GraphSpec | Functions | Winner |
|--------|-----------|-----------|--------|
| Validity | 100% | 100% | Tie |
| Task completion | 100% | 100% | Tie |
| Hallucination rate | 29% | 0% | Functions |
| Bug rate | 71% | 29% | Functions |
| Completeness | 2.71 | 3.0 | Functions |
| Total score | 92/105 | 103/105 | Functions (+11) |

### Analysis

**Low/medium tasks (1-4, 7):** GraphSpec competitive — constrained error space thesis holds for linear, diamond, and fan-out topologies. Task 4 (fan-out) is a perfect score.

**High-complexity tasks (5, 6):** GraphSpec breaks down on:
1. **Error-handling composition** — retry/fallback/cache don't compose naturally in a DAG; the schema lacks primitives for "try A, on failure use B"
2. **Feedback loops** — GraphSpec is inherently DAG-shaped; circular deps require runtime support the LLM can't express
3. **Schema edge cases** — LLM invents invalid structures (state with deps, producer with deps) when the schema doesn't fit

**Implication for roadmap:** Adding `fallback`, `cache`, `timeout` as first-class node types or composition primitives (roadmap §3.1c) would directly address the Task 5 failure. Feedback loops may require a `dynamicNode` or `adaptiveSource` pattern rather than static GraphSpec.

**Caveat:** Single run, single model. Need more models (GPT-4o, Gemini) and multiple runs for statistical significance.
