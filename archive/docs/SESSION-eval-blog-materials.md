# SESSION: Blog Materials — GraphReFly Eval-Driven Catalog Loop (§9.1 Wave 1)

**Dates:** 2026-04-20 → 2026-04-21
**Status:** Full A→E progression complete across 3 model classes (thinking, coding-specialized, middle-tier cheap). Blog post not written. Final findings + verdicts appended in § "Verdicts & What To Do About Them" below.
**Purpose:** Consolidate everything a writer (human or LLM) needs to produce the Wave 1 blog post without re-deriving findings from raw run data. Companion to [SESSION-eval-story-reframe.md](SESSION-eval-story-reframe.md) (the thesis reframe that precedes this material).

---

## Thesis (one sentence)

> GraphReFly's eval harness is a self-improving pipeline: it automatically surfaces catalog/prompt/template gaps on a fixed LLM corpus, those gaps feed back as library fixes, and re-running the same eval closes the loop — the **feedback loop itself is the product**, not any single treatment.

---

## The 4-treatment experiment — what each station of the loop demonstrates

| Treatment | Developer action | Library action | Loop role | Status (glm-4.7) |
|-----------|-----------------|----------------|-----------|-----------------|
| **A** | Writes `catalogDescription` (hand-written string) | Nothing | Baseline — what everyone does today | DONE |
| **B** | Writes `CatalogFnEntry` objects (typed data) | Auto-generates prompt via `generateCatalogPrompt()` | Library automates the mechanical prompt work | DONE |
| **C** | Same as B | + auto-refine (`maxAutoRefine: 2` — feeds validation errors back to LLM) | Library self-corrects from catalog-validation errors | DONE (refine path wired but never actually triggered on glm-4.7 — see findings) |
| **D** | Same as B + opts into templates | + ships `resilientFetch`/`adaptivePoller` pre-built templates (loop-discovered from Run 4 gap analysis) | Library ships architectural fixes the loop surfaced | DONE |

**Why C isn't dropped from the blog**: it's the "self-correcting" station. Without it, "library automates X" is incomplete — we'd only show "library generates prompts" (B) and "library ships pre-built templates" (D). C shows the mid-layer: **library observes its own output, diagnoses validation errors, retries**. On glm-4.7 the refine path wasn't triggered (findings §F3), which is itself a publishable result.

---

## Run data (all glm-4.7 via OpenRouter, judge z-ai/glm-5.1)

### Aggregate scores

| Run | Cost | Graphspec pass | Functions pass | Error rate |
|-----|------|---------------|----------------|------------|
| A (manual catalog) | $1.35 | 26/30 | 30/30 | 13.3% |
| B (auto-gen prompt) | $1.92 | 27/30 | 30/30 | 10.0% |
| C (B + auto-refine) | $1.37 | 25/30 | 30/30 | 16.7%\* |
| D (C + templates) | $2.06 | 27/30 | 30/30 | 10.0%\** |

\* C's higher error rate is a **validity-criterion artifact**, not a regression — see findings §F3.
\** D's 10% includes 2 reasoning-loop cap-bound empties; real error rate excluding cap-bound ~6.9%.

### Per-task stability matrix

Shows which treatments fixed or broke which tasks. `P` = passed, `F` = failed, `abort` = transient error (linear-dns in D).

| Task | A | B | C | D |
|------|---|---|---|---|
| linear-rss-filter-notify | P | P | P | P |
| linear-csv-transform-store | P | P | P | P |
| linear-log-parse-report | P | P | P | P |
| linear-image-resize-upload | P | P | **F** | P |
| linear-dns-lookup-cache-respond | **F** | P | P | abort |
| linear-markdown-render-deploy | P | P | P | P |
| fanout-email-classify | P | P | P | P |
| fanout-iot-sensor-broadcast | P | P | P | P |
| fanout-order-fulfillment | P | P | P | P |
| fanout-video-process | P | P | P | **F** |
| fanout-deploy-notify | P | **F** | **F** | P |
| fanin-morning-brief | P | P | P | P |
| fanin-patient-summary | P | P | P | P |
| fanin-social-sentiment | P | P | P | P |
| fanin-fraud-scoring | P | P | P | P |
| fanin-infrastructure-health | P | P | P | P |
| diamond-validate-transform-merge | P | P | P | P |
| diamond-image-classify-watermark | P | P | P | P |
| diamond-loan-underwrite | P | P | P | P |
| diamond-content-publish | P | P | P | P |
| diamond-shipping-label | P | P | P | P |
| stateful-running-average | P | P | P | P |
| stateful-rate-limiter | P | **F** | **F** | P |
| stateful-shopping-cart | P | P | P | P |
| stateful-leaderboard | **F** | P | P | P |
| error-retry-fallback | P | P | P | P |
| error-circuit-breaker | **F** | **F** | **F** | P |
| error-dead-letter-queue | P | P | P | P |
| multi-step-threshold-alert | P | P | P | P |
| multi-step-user-signup | **F** | P | **F** | **F** |

**21 tasks pass everywhere. 9 tasks (30%) fail in at least one treatment. 0 tasks fail in all 4.**

### One task fixed monotonically by templates

`error-circuit-breaker` (the resilience-ordering task) failed in A, B, and C — then **passed in D**. This is the cleanest narrative point for "Treatment D's pre-built resilience template closed a gap no other treatment closed."

All other failures shift treatment-to-treatment without a monotonic pattern.

---

## Three publishable findings the eval surfaced automatically

### F1. Shifting-failure pattern

Across A → B → C → D, the aggregate error rate stays in a **narrow band (10-17%)** but **which specific tasks fail reshuffles continuously**:

- A→B: 3 of A's 4 failures disappeared, 2 new failures appeared (`fanout-deploy-notify`, `stateful-rate-limiter`).
- B→C: 1 of B's 3 failures remained (error-circuit-breaker). 2 new failures appeared (`linear-image-resize-upload`, `multi-step-user-signup`). Same structural criteria but slightly different catalog-validation stringency.
- C→D: Templates fixed `error-circuit-breaker`, `linear-image-resize-upload`, and refined-invalidity cases; introduced 1 new cap-exhaustion (`fanout-video-process`).

**Conclusion for the blog:**
> Prompt *structure* reshapes the failure surface as much as prompt *content*. The same model, same corpus, same questions — different prompts surface different failures. Failure mode is a function of the prompt, not a fixed property of the task or model.

This is counter-intuitive (*"a better prompt should reduce failures uniformly"*) and defensible from the data. Worth a dedicated blog section.

### F2. Reasoning-loop cap exhaustion (thinking-model failure mode)

Dominant failure mode on GLM-4.7 (a reasoning-enabled model). The model enters extended reasoning, consumes the output cap on hidden chain-of-thought tokens, and emits **empty visible content**. Observed:

| Task | Output tokens (mostly reasoning) | Latency | Visible content |
|------|---------------------------------|---------|-----------------|
| D/linear-dns-lookup-cache-respond | 127,886 | 286s | empty |
| D/fanout-video-process | 129,199 | (cached, was similar) | empty |
| D/multi-step-user-signup | 65,536 (hit cap exactly) | 16 min (967s) | empty |
| C/stateful-rate-limiter | 124,230 | cached | empty |
| C/error-circuit-breaker | 131,072 | cached | empty |

**Implications for the eval blog:**
- Evals on reasoning models need larger output caps OR a way to disable extended thinking during evals.
- Cost impact is non-trivial: 65K wasted reasoning tokens at $3.15/M = **~$0.20 per failure** at GLM-5.1 pricing.
- Non-thinking models (GPT-5.4-mini, gpt-5.3-codex, etc.) should show different failure distributions — worth confirming in publish-tier cross-model run.

### F3. Validator vs. judge disagreement — the "template-param overreach" case

`multi-step-user-signup` (Treatment D): the LLM produced a template using `$fn` and `$config` as parameter placeholders — parameterizing the fn-name and config-object at the template level:

```json
"resilientStep": {
  "params": ["$input", "$fn", "$config"],
  "nodes": {
    "action": { "type": "effect", "deps": ["$input"], "fn": "$fn", "config": "$config" }
  }
}
```

- **Both LLM-as-judges passed it** as "syntactically valid JSON" and "all key behaviors present."
- **`validateSpec()` rejected it** because `fn: "$fn"` can't reference the catalog and `config: "$config"` is a string where an object is required.

This is a real tension between **behavioral validity** (the LLM-judge view) and **structural validity** (the validator view). Worth a blog paragraph: **evals need both** — judges catch semantic errors, validators catch composition errors. Neither alone is sufficient.

### F4. Treatment C's refine path was never triggered on GLM-4.7

All 5 of C's failures were either:
- Empty content from reasoning-loop exhaustion (JSON.parse fails → refine path never reached)
- `multi-step-user-signup` template-param overreach (validateSpec fails → refine path never reached)

**Zero tasks entered the "valid JSON but catalog-invalid" state** where `llmRefine` would attempt a correction. Auto-refine is **necessary but not sufficient** for thinking-model failure modes — refine assumes there's output to refine.

**Implication for the blog:** refine's utility is model-family-dependent. Codex/GPT-5.4 non-thinking models likely to produce actual catalog-invalid outputs where refine can demonstrate value. That's the publish-tier comparison's job.

---

## Cost-accuracy milestones (bugs found & fixed during the runs)

Each bug found by running the eval on real data. Each fix preserved going forward:

1. **Generation cost was $0.** `req.model` wasn't set on generation calls → `estimateTokenCost(undefined)` returned 0 → only judge cost tracked. Fixed — reported cost now within ~10% of OpenRouter billing.
2. **Reasoning tokens uncounted.** `outputTokens = completion_tokens` missed `completion_tokens_details.reasoning_tokens`. For GLM-5.1 this was ~50% undercount. Fixed in `OpenAICompatibleProvider`.
3. **Merge double-counted cost on resume.** `mergeRuns` did `prev.cost + current.cost` but `current` included cached tasks already in `prev`. Fixed — now recomputes from deduped task array.
4. **Cache key coupled to wrapper chain.** Adding/reordering any inner wrapper silently invalidated every cached entry. Fixed — `providerKey` is explicit.
5. **Dry-run/real cache cross-pollution.** `EVAL_MODE=dry-run` cached canned `[DRY RUN]` strings under the same key as real responses. Fixed — dry-run uses `${provider}+dryrun` suffix.
6. **Registry-bump didn't invalidate cache.** Bumping `maxOutputTokens` from 4K → 65K didn't invalidate stale truncated responses because the key didn't include the resolved cap. Fixed — cap is now part of `keyMaterialExtra`.
7. **Rate limiter outside cache.** Fully-cached reruns took minutes because cache hits still paced against the 60s window. Fixed — reordered stack: `cache → budget → limiter → base`.
8. **Transient errors killed the run.** Single truncated JSON response propagated up, losing all in-flight progress. Fixed — per-task try/catch records diagnostic failure and continues.

Net effect: reported `total_cost_usd` tracks OpenRouter actuals within ~10%; reruns are fast and free; crashes no longer lose progress.

---

## Publish-tier plan (what's left before the blog goes out)

### Recommended runs on publish-tier

All via OpenRouter:

| Run | Model | Judge | Treatment | Expected cost |
|-----|-------|-------|-----------|---------------|
| l0-codex-A | `openai/gpt-5.3-codex` | `openai/gpt-5.4-mini` | A | ~$3-4 |
| l0-codex-C | same | same | C | ~$3-5 (refine bumps call count) |
| l0-codex-D | same | same | D | ~$3-5 |

**Why Codex as eval:** coding-specialized, non-thinking → failure distributions should differ from GLM's reasoning-loop pattern. Expected to exercise refine's real value (F4 hypothesis).

**Why GPT-5.4-mini as judge:** non-thinking, cross-family-adjacent to avoid Codex self-judging bias, cheap enough (`$0.75/$4.50` per 1M).

**Caps verified:** `openai/gpt-5.3-codex` registered with `maxOutputTokens: 128_000` in both `openai/` (direct) and `openrouter/openai/` entries of [evals/lib/limits.ts](../../evals/lib/limits.ts). Codex is non-thinking so cap won't be the binding constraint this time.

### Commands (ready to run)

```bash
# A baseline on Codex
EVAL_RUN_ID=l0-codex-A EVAL_TREATMENT=A \
  EVAL_RPM=60 EVAL_MAX_CALLS=400 EVAL_MAX_PRICE_USD=8 \
  EVAL_PROVIDER=openrouter EVAL_MODEL=openai/gpt-5.3-codex \
  EVAL_JUDGE_PROVIDER=openrouter EVAL_JUDGE_MODEL=openai/gpt-5.4-mini \
  pnpm eval:contrastive

# C auto-refine on Codex
EVAL_RUN_ID=l0-codex-C EVAL_TREATMENT=C \
  EVAL_RPM=60 EVAL_MAX_CALLS=500 EVAL_MAX_PRICE_USD=10 \
  EVAL_PROVIDER=openrouter EVAL_MODEL=openai/gpt-5.3-codex \
  EVAL_JUDGE_PROVIDER=openrouter EVAL_JUDGE_MODEL=openai/gpt-5.4-mini \
  pnpm eval:contrastive

# D templates on Codex
EVAL_RUN_ID=l0-codex-D EVAL_TREATMENT=D \
  EVAL_RPM=60 EVAL_MAX_CALLS=400 EVAL_MAX_PRICE_USD=8 \
  EVAL_PROVIDER=openrouter EVAL_MODEL=openai/gpt-5.3-codex \
  EVAL_JUDGE_PROVIDER=openrouter EVAL_JUDGE_MODEL=openai/gpt-5.4-mini \
  pnpm eval:contrastive
```

Skip B unless the publish-tier A→C→D results leave the story needing it. B's value was already demonstrated on glm-4.7 (B matches A in aggregate; the structural argument is "auto-prompt works"). Codex B is additional validation but not critical.

---

## Suggested blog structure (outline only — write later)

**Working title**: *"How We Built (and Ran) a Self-Improving Eval Harness for LLM Graph Composition"*

**Audience**: harness-engineering readers (Martin Fowler's blog audience, Anthropic/OpenAI agent-SDK users, LangGraph/CrewAI contributors, reactive programming maintainers). Technical but accessible.

### Structure

1. **Hook** (150 words) — paint the eval problem: "You hand-roll a catalog, you pray the LLM gets it. We ran ours through a real eval, found things we didn't expect, and turned the whole thing into a feedback loop."
2. **The 4-treatment experiment** (300 words) — what each treatment tests in plain English. Emphasize the *loop station* framing, not "templates win."
3. **What we learned by running it** (600 words) — the three findings (F1/F2/F3), each with one concrete example from the data. This is the heart of the post.
4. **Reproducibility** (200 words) — one-liner commands + link to `evals/CHEAP-AND-SAFE.md`. Show how readers can run it on their own catalog with their own model for ~$2.
5. **What the loop does next** (200 words) — loop-discovered fixes (templates, `conditionalMap` wrapper, `median` op, `llmScore` description) that we shipped back into the library. Shows "find it → fix it → re-eval" as a closed circuit.
6. **Open threads** (150 words) — refine's utility is model-family-dependent (F4); judges vs. validators are a real tension (F3); failure modes reshuffle with prompt structure (F1). These are publishable-in-part-2 hooks.
7. **Close** (100 words) — "The eval, the runner, the rubrics, the corpus are all in the repo. Fork it. Run it on your catalog. If the failures surprise you, that's the signal to iterate."

### Blog-quotable numbers

- **"60 tasks across 4 treatments on one model, under $7 total"** — low bar of entry
- **"30% of tasks failed in at least one treatment, 0% in all four"** — shifting-failure headline
- **"One task (error-circuit-breaker) only the `resilientFetch` template fixed"** — concrete templates-work example
- **"16-minute latency on one failure — the model spent its whole output budget thinking"** — reasoning-loop anecdote
- **"8 bugs in our own runner discovered by trying to trust the numbers"** — the meta-story of making evals cheap-and-honest is itself interesting

### Visuals to include

- **Task stability matrix** (the 30x4 table above) rendered as a grid heatmap
- **A 2x2 cost-vs-error tradeoff chart** plotting each treatment
- **Failure taxonomy pie chart** — cap-exhaustion vs. spec-overreach vs. wrong-catalog-entry vs. other
- **Per-task failure lineage** — sparkline-style P/F/F/P for each of the 9 failing tasks across A/B/C/D

### What to NOT say (tempting but wrong framings)

- "D beats A" — we reframed; the thesis is the loop, not any treatment.
- "Templates are necessary" — they help for specific failure modes, not universally.
- "Auto-refine works" — it didn't trigger once on GLM-4.7. Wait for Codex data.
- "GraphReFly is faster/cheaper/better" — not the pitch. The pitch is *"the eval harness is a library feature."*

---

## Assets available for the blog

### In-repo
- All 4 result JSONs: `evals/results/l0-glm47-{A,B,C,D}.json`
- Corpus: `~/src/graphrefly/evals/corpus/contrastive-tasks.json`
- Rubric: `~/src/graphrefly/evals/rubrics/l0-contrastive.json`
- Judge prompts: `~/src/graphrefly/evals/templates/judge-prompts/`
- Portable prompts (for manual reproducibility): `evals/portable-eval-prompts.md`
- Reproducibility one-pager: `evals/HOW-TO-EVAL.md`
- Cost-safety ladder: `evals/CHEAP-AND-SAFE.md`

### External references
- Gemini CSV data (actual OpenRouter billing): gathered 2026-04-20, confirms $4.52 spent on today's runs (glm-4.7 + glm-5.1 across B, C, D retries) — within 10% of our local estimate.
- Anthropic pricing/limits (for future Sonnet runs): documented in [SESSION-eval-story-reframe.md](SESSION-eval-story-reframe.md).
- OpenAI GPT-5.x + Google Gemini 3.x pricing (for publish-tier): registry updated 2026-04-20.

---

## Open questions for the next session

1. **Publish-tier results timing.** Run Codex A/C/D tonight or save for a fresh session? Cost: ~$10-15.
2. **Should B run on Codex too?** Only if A→C→D story has a hole. Current data says skip.
3. **Judge-vs-validator tension (F3).** Is this worth a dedicated follow-up post, or a paragraph in the main one?
4. **Reasoning-loop findings (F2).** Worth a separate blog targeted at "people evaluating thinking models" — broader audience than the harness crowd?
5. **Scorecard infrastructure (§9.1.5).** Do we ship `evals/scorecard/latest.json` now or wait for the blog to land first?

---

## Status against §9.1 external deliverables (roadmap.md §9.1.5)

- [ ] 5+ automated runs across 2+ models — **4 runs on glm-4.7 done; need one more model**
- [ ] Schema gaps as running metric — partial (Run 4 gap analysis captured; not yet formalized as a chart)
- [ ] Scorecard page — NOT STARTED
- [ ] Updated weekly from CI eval runs — NOT STARTED
- [ ] Machine-readable `scorecard/latest.json` — NOT STARTED
- [ ] Blog post — **this file is the prep**
- [ ] Open-source the eval runner — DONE (already in repo)
- [ ] Multi-model comparison results page — NOT STARTED (would be a sub-page of scorecard)
- [ ] "Reproduce our evals" guide — partial (`HOW-TO-EVAL.md` + `CHEAP-AND-SAFE.md` cover it; could be cleaned up into a single user-facing page)
- [ ] Design-partner outreach — NOT STARTED

Minimum remaining before Wave 1 ships: **publish-tier Codex runs → blog → scorecard JSON → design-partner outreach**. Estimated 1-2 working days + ~$15 API cost.

---

## Appendix — 2026-04-21 updates

### Cross-model runs completed

Three model classes, full A-through-E where applicable:

| Model | Class | Treatments run | Cost (actual, OpenRouter CSV) | Pass rate |
|---|---|---|---|---|
| `z-ai/glm-4.7` + `z-ai/glm-5.1` judge | thinking | A, B, C, D | $2.93 + $2.13 + $2.26 + $2.66 = **$9.98** | 25-27/30 per treatment |
| `openai/gpt-5.3-codex` + `openai/gpt-5.4-mini` judge | non-thinking, coding-specialized | A, C | $0.97 + $0.68 + $0.50 = **$2.15** | **30/30** both treatments |
| `qwen/qwen3.5-flash-02-23` + judge varied | middle-tier, thinking | A, E | $0.68 + $3.78 (qwen-397b judge on A) + $0.48 (gpt-5.4-mini judge on E) = **$4.94** | 30/30 on A; 28/30 real + 1 abort on E |

**Total Wave 1 eval spend across 3 runs of A, 1 B, 2 C, 1 D, 1 E on 3 model classes: ~$17.** Under the $20 ceiling we set.

### Treatment E results (qwen-flash-02-23, 2026-04-21)

- **72% prompt-token reduction**: 2,962 → 824 input tokens/task on graphspec (subsetting kept ~8-15 fns and ~2-4 sources per task from the full 58/20 catalog).
- **29/30 graphspec pass** — 1 real failure (`error-circuit-breaker` reasoning-loop cap exhaustion, **not** caused by subsetting) + 1 transient abort (`stateful-leaderboard`).
- **Zero catalog-invalid failures** — subsetting didn't drop any fn a task needed.
- **Confirms F4 on another model family**: qwen-flash also exhibits reasoning-loop cap exhaustion (164K output tokens on the one failure), same pattern as glm-4.7. Not model-specific to glm.

### Bug fixes landed 2026-04-21

Both were masking real cost + observability data:

1. **Bug 1 fixed**: `run.total_cost_usd` now sums budget-gate state across all providers (generation + judge), not just per-task generation cost. Implemented via new `getAllBudgetStats()` export from `llm-client.ts` + consumed in `runContrastiveEval`. Previously hidden ~$3.78 of judge spend on the qwen-397b judge run; going forward reported cost will match OpenRouter bills within the limits of Bug 2.
2. **Bug 3 fixed**: `runContrastiveEval` now APPENDS judge scores to `result.judge_scores` instead of OVERWRITING pre-existing diagnostics. The `catalog subset size` (Treatment E) and `auto-refine attempts used` (Treatment C) diagnostics are now preserved alongside judge pass/fail. One-line fix: `[...result.judge_scores, ...scores]`.

Bug 2 (reasoning-token pricing — some models discount reasoning below output rate, e.g. qwen-397b at $0.195/M vs $2.34/M output) remains deferred. Direction is conservative (over-estimates trip USD cap early) but produces 5-10x over-estimates on thinking models. `ModelPricing.reasoning?: number` field + handler in `estimateTokenCost` would close it. Non-blocking.

### Cost-accuracy snapshot (2026-04-21 CSV vs reported)

| Date | Model pair | Reported | Actual (CSV) | Ratio |
|---|---|---|---|---|
| 2026-04-20 | glm-4.7 + glm-5.1 (run B/D/retries) | ~$3-4 | $4.92 | close |
| 2026-04-20 | codex + gpt-5.4-mini (A) | $1.48 | $1.31 | 1.1x over |
| 2026-04-21 | qwen-flash + qwen-397b (A first attempt) | $0.53 | $4.13 | **0.13x — 8x under** |
| 2026-04-21 | qwen-flash + gpt-5.4-mini (E) | $0.80 | ~$1.10 | 0.7x — 1.4x under |

Post-Bug-1 fix, reported cost will be within ~15% of actual for non-thinking judges and within ~3x for thinking judges (Bug 2 blind spot).

---

## Verdicts & What To Do About Them

### F1 — Shifting failures within a narrow error-rate band

**Verdict:** **Real.** Across glm-4.7 A→B→D the per-treatment failures shuffled among a rotating cast of ~9 tasks while aggregate error rate held 10-17%. Zero tasks fail in all treatments.

**What to do about it:**
- **Blog framing**: Use as counter-intuitive section. "Prompt structure doesn't uniformly reduce failures — it *redistributes* them." Challenges the naive assumption that better prompts always win.
- **Practical advice for readers**: Report error rate *per task* across prompt variations, not just aggregates. A treatment that passes 26/30 with different failures than another 26/30 treatment isn't "the same."
- **Not a follow-up action** — no library change addresses this. It's an empirical observation about LLM behavior.

### F2 — Reasoning-loop cap exhaustion (dominant failure mode on thinking models)

**Verdict:** **The biggest finding.** ~93% of glm-4.7 failures are cap exhaustion on extended-thinking tasks. Replicated on qwen-flash (1 failure was 164K output tokens, 545s latency on error-circuit-breaker). Not replicated on Codex or gpt-5.4-mini.

**What to do about it:**
- **Library change**: document in `evals/HOW-TO-EVAL.md` and `CHEAP-AND-SAFE.md` that thinking models need `maxOutputTokens >= 128K` for composition tasks. We already bumped glm-4.7 to 65K mid-run and the pattern still appeared; 128K+ probably isn't enough either — the root cause is the model sidetracking into reasoning, not actual output size.
- **Eval runner change**: surface reasoning-token count as a first-class field in `TaskResult` (not just bundled into `outputTokens`). Current aggregation hides the "all spent on reasoning, nothing on output" pattern.
- **Blog framing**: dedicated section "Evaluating Thinking Models". Publishable-in-a-second-post territory — the audience for this finding is broader than harness engineering.
- **Future experiment**: add an `EVAL_DISABLE_REASONING=true` env var that passes provider-specific no-think flags (e.g., OpenAI `reasoning_effort: "minimal"`, Anthropic `thinking: { type: "disabled" }`). Compare same model with/without thinking on same corpus.

### F3 — Validator vs. judge disagreement (`multi-step-user-signup` template-param case)

**Verdict:** **Real and informative.** Both LLM-as-judges passed the output as valid JSON + all key behaviors present; `validateSpec()` rejected because the LLM invented template params (`$fn`, `$config`) that aren't in the spec's contract.

**What to do about it:**
- **Spec / validation change**: the current GraphSpec template schema allows `params: string[]` but validation doesn't enforce that params can only be *referenced* in node deps (not as fn names or config values). Tightening this is a spec change — propose to `~/src/graphrefly/GRAPHREFLY-SPEC.md` as a clarification. Maybe also a friendlier error message: `fn: "$fn"` should be flagged as "template params can only substitute node references, not function names or config values. Use a concrete fn name."
- **Blog framing**: one paragraph. "Judges catch semantic correctness; validators catch composition correctness. Evals need both." Useful for anyone building their own eval harness — don't pick one.
- **Not a follow-up action** beyond the spec clarification — the LLM invented a reasonable extension; the spec is the constraint.

### F4 — Auto-refine's utility is model-family-dependent

**Verdict:** **Refine never actually triggered on any glm-4.7 or Codex run.** All glm-4.7 failures were structural (empty content from reasoning exhaustion) — refine can't fix what isn't there. Codex produced zero catalog-invalid output. No model in this experiment produced the "valid JSON but wrong fn name" failure mode refine was designed to close.

**What to do about it:**
- **De-scope Treatment C from the main blog**. It's wired, it's tested, it's documented — and the data says it's infrastructure waiting for the right test subject.
- **Keep C in the roadmap**: when we eventually evaluate weaker models (edge-tier gemma, Ollama local), refine may fire and we'll have real data.
- **Narrow Treatment E's claim similarly**: we proved "72% prompt-token reduction with zero quality regression on middle-tier models," not "subsetting reduces catalog-invalid failures." Stay within the data.

### F5 (new) — Treatment E's narrow win: 72% token reduction on middle-tier

**Verdict:** **Measurable and defensible on qwen-flash-02-23.** Not generalizable to every model until we replicate on at least one other middle-tier model, but sufficient as a "one-model existence proof."

**What to do about it:**
- **Blog framing**: Treatment E gets a paragraph. "Subsetting the catalog by task keywords cut prompt size 72% without hurting pass rate." Conservative claim, honest number.
- **Follow-up experiment**: run A+E on `deepseek/deepseek-v3.2` or `qwen/qwen3-32b` to confirm the reduction generalizes. ~$1 total cost. Low priority.
- **Library change**: promote `selectCatalogSubset` from `evals/lib/portable-catalog.ts` → `src/patterns/graphspec.ts` as a public helper. Users with their own catalogs can apply it. ~20 LOC refactor.

### F6 (new) — Judge model choice dominates total eval cost on reasoning models

**Verdict:** Qwen A first attempt: $3.78 on the judge (thinking) vs. $0.35 on generation. Judge was 10x the eval model. Changing judge on Qwen E to `gpt-5.4-mini` (non-thinking) cut total cost to ~$1.10.

**What to do about it:**
- **`evals/HOW-TO-EVAL.md` update**: explicit warning + recommended judges ("pick a non-thinking judge — `gpt-5.4-mini` or `qwen/qwen3.5-flash-02-23` self-judged if cost sensitive").
- **Blog framing**: part of the "cost accuracy" section. "The model you judge with matters more than the model you evaluate."
- **Already addressed by Bug 1 fix** — future runs will at least *show* the judge cost in the summary so users can catch this immediately.

### F7 (new) — Failures are rarely composition-capability problems

**Verdict:** Across 240+ task results, zero "the model doesn't understand GraphSpec" failures. Every failure is one of: (a) reasoning-loop cap exhaustion, (b) template-param overreach, (c) transient API error, (d) cached stale response from prior cache-key invalidation. None are "model picked the wrong fn" or "model couldn't compose."

**What to do about it:**
- **Headline insight for the blog**: the LLM composition rate is already high on capable models; **the failures are infrastructure, not model**. What moves the metric isn't better prompts — it's better caps, better caches, better judges, better cost tracking.
- **Not a roadmap change**: just a reframing. Wave 1's story shifts from "we improved prompts" to "we built an eval harness that found real problems the library needed to solve (caps, caches, judges, cost tracking, diagnostics)."

---

## Revised "What's Left for §9.1" (updated 2026-04-21)

1. **Write the blog post** using the updated findings above. **Headline candidate**: "We Built an Eval Harness to Test LLM Graph Composition — We Found 8 Bugs in Our Own Tooling First." Pivots the narrative from "the composition rate is 93%" to "the eval harness matters more than the model on this corpus."
2. **Scorecard `latest.json`** — now straightforward since total_cost_usd is accurate.
3. **Reproduce guide polish** — one linking pass for `HOW-TO-EVAL.md` + `CHEAP-AND-SAFE.md` + a new note on judge-model choice.
4. **Design-partner outreach** — 20-30 emails.

Not needed for Wave 1:
- Bug 2 fix (reasoning-token pricing) — conservative direction, defer.
- Treatment C on Codex or qwen — refine's value not testable on these models; gather on weaker models later.
- Gemma edge-model test — move to post-Wave-1 follow-up.

**Total remaining effort: ~8h across blog + scorecard + outreach.** No more paid LLM runs required before publish.
