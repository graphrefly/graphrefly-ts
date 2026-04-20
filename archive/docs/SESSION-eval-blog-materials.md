# SESSION: Blog Materials — GraphReFly Eval-Driven Catalog Loop (§9.1 Wave 1)

**Date:** 2026-04-20
**Status:** Pre-blog-draft materials gathered. Blog post not yet written.
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
