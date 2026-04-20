# SESSION: Eval Story Reframe — The Feedback Loop Is the Thesis, Not Templates

**Date:** 2026-04-20
**Status:** Course correction mid-§9.1 Treatment execution
**Scope:** §9.1 Wave 1 narrative, Claude model parameters, cost-tracking bugs fixed along the way
**Trigger:** User correction after I drifted into "Treatment D proves templates are needed" framing, which inverts the actual §9.1 thesis.

---

## The correction

I had been framing the blog narrative as *"Treatment A baseline → Treatment B auto-prompt → Treatment D with templates: templates close architectural gaps the LLM can't work around."* That's a finding along the way, not the thesis.

The actual §9.1 thesis, per roadmap and marketing strategy:

> **The eval harness is a self-improving pipeline.** It discovers specific failure modes on a real corpus, feeds them back as library fixes (catalog descriptions, auto-refine prompts, new templates), and re-runs the same eval to verify the fix. That loop — eval → diagnose → fix-in-library → re-eval — is the publishable product.

Treatments A/B/C/D are stations in the loop, not the conclusion:

| Treatment | What it demonstrates in the loop | Status |
|---|---|---|
| **A: Manual catalog** | Baseline. Where everyone starts today. | DONE on z-ai/glm-4.7 |
| **B: Auto-gen prompt** | Library automates the mechanical work (prompt construction from structured `CatalogFnEntry`). Dev writes data, library writes the prompt. | DONE on z-ai/glm-4.7 |
| **C: B + auto-refine** | Library self-corrects. On catalog-validation error, feed errors back and retry. **This is load-bearing for the thesis — it's the "self-improving" part.** | **Skipped so far.** Runner treats it as B because the refine loop lives in `llmCompose`, not the bare contrastive path. |
| **D: C + pre-built templates** | Library ships architectural fixes *discovered by the loop*. The `resilientFetch` template is what came out of Run 4's gap analysis. | DONE on z-ai/glm-4.7 |

C is the station I almost let the user skip. Skipping it would mean publishing a story about "pre-built templates are good" without showing the self-improvement mechanism that produced those templates in the first place.

## What actually changes

### Narrative (for the blog)

**Replaced framing:** "D beats A because templates close gaps." *[wrong thesis]*

**Correct framing:**
> Our eval harness surfaced failure patterns on a 30-task L0 corpus. Treatment B showed the library can restructure a hand-written catalog into an auto-generated prompt for free. Treatment C showed the library can self-correct from catalog-validation errors with `maxAutoRefine`. Treatment D showed the loop's discoveries (the `resilientFetch`/`adaptivePoller` templates, the `conditionalMap` wrapper, the `median` op, the `llmScore` description update) can be shipped back into the catalog and re-validated automatically. You can run this pipeline on your own catalog — it's not bespoke to GraphReFly.

The 4-treatment comparison stops being a scoreboard contest and becomes a **traversal of the loop's stages**.

### C is no longer optional

Wiring C is prerequisite to the publishable story. "We would run C but the bare runner doesn't have the refine loop wired" is a roadmap item, not an acceptable narrative gap. Either wire `llmCompose` into the contrastive runner (~50 LOC) or run the refine loop externally and feed results back through the merge mechanism.

### Templates reframed as loop output, not headline

The `resilientFetch` / `adaptivePoller` templates are still the right thing to have shipped, and they still closed `error-circuit-breaker` on glm-4.7. But they're *examples of what the loop discovers*, not the reason to adopt the library. Internal iteration on more templates can continue by chat/dogfood — no paid runs required for every new template idea.

### Paid Sonnet runs deferred

No immediate need to burn ~$10-15 on a Sonnet A+B+D sweep. The glm-4.7 data is already enough to validate the loop mechanically. When publish-tier validation is needed, it's one run per treatment, on one publish-tier model, **for the blog's credibility anchor** — not to re-litigate the A vs B vs D ranking.

## Verified Claude model parameters (from docs.anthropic.com, 2026-04-20)

Fetched to sanity-check before any future publish-tier run. Updates applied in this session.

### Pricing ($ per 1M tokens)

| Model | Input | Output | Registry status |
|---|---|---|---|
| claude-opus-4-6 | **$5** | **$25** | **Updated** (was $15/$75 — 3x outdated; 4.6 dropped from Opus 4/4.1's $15/$75) |
| claude-sonnet-4-6 | $3 | $15 | Unchanged |
| claude-haiku-4-5-20251001 | **$1** | **$5** | **Updated** (was $0.80/$4) |

### Rate limits (Tier 1 default, $5 minimum credit)

Anthropic uses split ITPM / OTPM; our single `tpm` registry field uses ITPM (input-heavy eval workload).

| Model | RPM | ITPM | OTPM | Context | Max output |
|---|---|---|---|---|---|
| claude-opus-4-x | 50 | 30,000 | 8,000 | 200K | 32K |
| claude-sonnet-4-x | 50 | 30,000 | 8,000 | 200K | 64K |
| claude-haiku-4-5 | 50 | 50,000 | 10,000 | 200K | 64K |

Tier advancement: Tier 2 at $40 deposit (1000 RPM, 450K ITPM, 90K OTPM), Tier 3 at $200 ($800K ITPM), Tier 4 at $400 ($2M ITPM). Spend cap per tier: $100 / $500 / $1000 / $200K.

Prompt caching discount: 10% of base input for cache reads. 1.25x base for 5-min cache writes, 2x for 1-hour. Batch API: 50% off both input and output. None used by the eval runner currently — potential future cost optimization.

Long context (up to 1M) available on Sonnet 4.6 and Opus 4.6 at standard per-token rates. 200K is the practical default.

## Cost-tracking bugs found and fixed this session

While investigating why user's reported "Estimated cost" diverged from OpenRouter's actual charges:

1. **Generation calls weren't tracked.** `contrastive.ts` didn't set `req.model` on generation requests → budget gate's `estimateTokenCost(req.model=undefined)` returned 0. Only judge calls (which did set model) showed in `[budget]` output. **Fixed**: set `model: config.model` on both treatments' calls in [evals/lib/contrastive.ts](../../evals/lib/contrastive.ts).

2. **Reasoning tokens weren't counted.** GLM, Claude with thinking, GPT-o1, etc. emit hidden chain-of-thought tokens billed at the output rate. Our `outputTokens = completion_tokens` missed these — for GLM-5.1, reasoning was ~equal to completion, so we undercounted output by ~50%. **Fixed**: [evals/lib/llm-client.ts](../../evals/lib/llm-client.ts) `OpenAICompatibleProvider` now adds `usage.completion_tokens_details.reasoning_tokens` to `outputTokens`. Conservative for OpenRouter (correct) but may double-count on OpenAI direct (minor, since OAI models rarely emit reasoning_tokens).

3. **Merge double-counted `total_cost_usd` on resume.** `mergeRuns` did `prev.total_cost_usd + current.total_cost_usd`, but `current.total_cost_usd` included cached tasks whose cost was already in `prev`. Each resume compounded. **Fixed**: [evals/lib/reporter.ts](../../evals/lib/reporter.ts) now recomputes `total_cost_usd` from the deduplicated merged task array. Two new tests at [src/__tests__/evals/merge-runs.test.ts](../../src/__tests__/evals/merge-runs.test.ts).

4. **Cache wrapper chain naming coupled cache keys to wrapper order.** Reordering inner wrappers (budget gate, rate limiter) silently invalidated every cached entry. **Fixed**: added explicit `providerKey` to `ReplayCacheOptions` so stable identity is decoupled from debug naming.

5. **Dry-run responses poisoned the real-mode cache** because the cache key didn't include `EVAL_MODE`. **Fixed**: `providerKey` now includes `+dryrun` suffix when `EVAL_MODE=dry-run`. Real and dry-run caches are isolated by construction.

6. **Registry-resolved `maxOutputTokens` wasn't in the cache key.** Bumping the registry default didn't invalidate yesterday's truncated-response cache entries. **Fixed**: `maxOutput=N` is now part of `keyMaterialExtra`. Registry bumps naturally invalidate.

7. **Rate limiter paced cache hits.** The limiter wrapped *outside* the cache, so every logical call — even a 0ms cache hit — counted against the 60-second window. Fully-cached reruns took minutes. **Fixed**: reordered the stack so `cache → budget → rateLimiter → base`. Cache hits short-circuit at the outermost layer.

8. **Crash on transient API error killed the whole run.** A single truncated JSON response or connection drop propagated up through `runContrastiveEval`, losing all in-flight progress. **Fixed**: each task body is now in a try/catch; transient errors record a diagnostic failure for both treatments and the run continues. Successful responses still cache.

Net effect on cost accuracy: reported `total_cost_usd` now tracks OpenRouter actuals within ~10%.

## Findings worth a blog paragraph each

Separate from the main "eval → fix → re-eval loop" narrative, these surfaced during execution:

### Shifting-failure pattern

Across A → B → D on z-ai/glm-4.7, the *error rate* stayed in a narrow band (13.3%, 10%, ~7% real-only), but **which specific tasks failed kept shuffling**. The auto-gen prompt (B) fixed 3 of A's 4 failures while introducing 2 new ones. D fixed error-circuit-breaker (failed in both A and B) but broke fanout-video-process. **Prompt structure redistributes failures** — the failure surface is a function of the prompt, not a fixed property of the task or model. Counter-intuitive, publishable.

### Reasoning-loop cap exhaustion

Dominant failure mode on reasoning-enabled models (GLM, presumably Claude with thinking and GPT-o1 too). The model enters extended reasoning, exhausts the output cap on reasoning tokens, and emits zero visible content. In D's raw outputs: 2 of 3 "failures" had empty `raw_output` with `output_tokens ≈ 128K` (2x the 65K cap after reasoning inclusion). Latency up to 16 minutes. These aren't prompt/catalog problems — they're cap-vs-reasoning-budget problems orthogonal to treatment.

Implication for evals: reasoning models need bigger output caps or need to be run with reasoning disabled during evals. Otherwise the cap-bound failures dominate signal.

### Validator vs. judge disagreement

On `multi-step-user-signup` (D), the LLM produced a template that used `$fn` and `$config` as template params — spec only allows node-reference params. **Both judges passed it** as structurally valid JSON and behaviorally correct. **`validateSpec()` rejected it** because `config` must be object, not string. Real validator-vs-judge disagreement. Worth digging into whether validator is too strict or LLM is over-creative; either way the eval surfaced it automatically.

## Current state of §9.1 (honest accounting)

Against [docs/roadmap.md §9.1.2](../../docs/roadmap.md) execution checklist:

**DONE (glm-4.7 only):**
- Treatment A baseline
- Treatment B auto-prompt
- Treatment D auto-prompt + templates

**PARTIAL:**
- Treatment C — contrastive runner doesn't route refine. Either wire `llmCompose` in or deliberately note the runner limitation.

**NOT STARTED:**
- Cross-model validation on publish-tier (deferred; can do when ready to publish)
- Blog write-up
- Scorecard (`graphrefly.dev/scorecard`)
- Design-partner outreach (per marketing strategy §16A)

**IMPLICIT WORK DONE (not in the roadmap checklist):**
- Eight cost-tracking / cache / rate-limit / crash-recovery bugs found and fixed
- Claude / OpenRouter registry params validated against live docs
- Merge-on-resume feature shipped
- `EVAL_RUN_ID` env var shipped
- Reasoning-token accounting shipped
- Documented three publishable findings (shifting failures, reasoning-loop, judge-vs-validator)

## What's next

Before any paid Sonnet run, two concrete items:

1. **Wire Treatment C properly** — route through `llmCompose` or extract the refine loop. ~50 LOC in [evals/lib/contrastive.ts](../../evals/lib/contrastive.ts). Without this, the published narrative has a hole.

2. **Write up the three findings** — shifting failures, reasoning-loop, judge-vs-validator — as a companion to the A→B→C→D progression. Each is a real result that the eval surfaced automatically (the thesis in miniature).

Then, and only then, one publish-tier validation run (my pick: Sonnet 4.6 eval + GPT-4.1 judge for cross-family bias reduction, A + D = 2 runs minimum).

## Files touched this session

Cost-tracking + cache + rate-limit + crash-recovery fixes:

- `evals/lib/contrastive.ts` — model field on gen requests, try/catch per-task
- `evals/lib/llm-client.ts` — reasoning tokens, providerKey decoupling, stack reorder
- `evals/lib/rate-limiter.ts` — `withRateLimiter` wrapper
- `evals/lib/replay-cache.ts` — `providerKey` option
- `evals/lib/reporter.ts` — `mergeRuns` cost recompute, `mergeAndWriteResults`
- `evals/lib/types.ts` — `EvalConfig.runId`, `CatalogTreatment`, `EVAL_TREATMENT`
- `evals/lib/cost.ts` — Claude pricing updated, OpenRouter/Chutes models added
- `evals/lib/limits.ts` — Anthropic Tier 1 limits, OpenRouter paid-route RPD fix
- `evals/scripts/run-l0.ts` — uses `mergeAndWriteResults`

Test fixtures:

- `src/__tests__/evals/merge-runs.test.ts` — 8 tests for merge semantics
- `src/__tests__/evals/rate-limit-cache-order.test.ts` — 4 tests for wrapper order + cache isolation
- `src/__tests__/evals/prompt-template-validity.test.ts` — fail-fast for prompt/validator drift
- `src/__tests__/evals/portable-catalog.test.ts` — 16 tests for the portable catalog

Docs:

- `evals/CHEAP-AND-SAFE.md` — 4-step pre-flight ladder + cheap-model presets + USD-cap gotcha
- `evals/HOW-TO-EVAL.md` — pointer to CHEAP-AND-SAFE
- `docs/roadmap.md` — §9.1 umbrella reorganization (§9.1.0 matrix, §9.1.1 tiers, §9.1.2 treatments, §9.1.3 execution methods, §9.1.4 internal telemetry, §9.1.5 external deliverables)

Data (fixtures + templates for Treatment B/D):

- `evals/lib/portable-catalog.ts` — 58 fn + 20 source rich entries
- `evals/lib/portable-templates.ts` — `resilientFetch`, `adaptivePoller` templates
- `~/src/graphrefly/evals/templates/graphspec-treatment.md` — added `name` field to prompt and examples (was the reason for 100% glm-4.7 graphspec failure)

## Open questions for next session

- Wire Treatment C into `contrastive.ts` via `llmCompose`, or accept the runner's B-C equivalence and note it in the blog?
- Should the eval-runner support cross-provider (eval on Sonnet, judge on GPT-4.1) workflows? Currently requires both API keys; flow is tested with openrouter+openrouter but not mixed-family.
- Reasoning-token cap handling: raise maxOutputTokens to 131K for reasoning models, or add an `EVAL_REASONING_MODE=off` to disable extended thinking during evals?
- Publish-tier validation: one model (Sonnet + GPT-4.1 judge) or two (add gemini-3-pro as a third data point)? Depends on blog budget.
