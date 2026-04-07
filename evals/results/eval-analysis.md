# Eval Analysis: Honest Assessment

## Bias in prior results

The L0 batch 1-2 results were biased in GraphReFly's favor. Criteria that smuggled
in our design invariants as universal virtues:

| Biased criterion | Why it's unfair |
|-----------------|-----------------|
| "Reactive: updates when sources change" | Penalizes correct one-shot implementations |
| "Mutable global state" as a bug | Standard JS/TS pattern; only a bug in our philosophy |
| "setTimeout" as a violation | Perfectly valid in plain TypeScript |
| "Not reactive" as a failure | Task didn't always require persistent reactivity |

**Fix:** The portable eval rubric (`portable-eval-prompts.md`) uses only neutral
criteria: validity, task completion, hallucination, bugs, completeness.

## Feedback loop weakness: library problem or catalog problem?

**Verdict: LIBRARY PROBLEM (schema expressiveness gap).**

The spec has `graph.set(name, value)` — an imperative API for updating state nodes.
But GraphSpec (the declarative JSON format) has NO way to express "this effect/derived
node writes back to a state node."

In the running library code, a feedback loop looks like:

```typescript
// Works in graphrefly-ts code:
const g = new Graph();
g.add('interval', state(10000));
g.add('poll', producer(restApi, { deps: ['interval'] }));
g.add('count', derived(['poll'], countPerMinute));
g.add('adjust', effect(['count'], (c) => {
  if (c > 100) g.set('interval', 2000);   // ← imperative write-back
  else if (c < 20) g.set('interval', 30000);
}));
```

But in GraphSpec JSON, there's no way to declare this:

```json
{
  "nodes": {
    "interval": { "type": "state", "initial": 10000 },
    "poll": { "type": "producer", "source": "rest-api" },
    "count": { "type": "derived", "deps": ["poll"], "fn": "countPerMinute" },
    "adjust": { "type": "effect", "deps": ["count"], "fn": "???" }
  }
}
```

`adjust` needs to express: "when count > 100, set interval to 2000." This requires
either:

### Option A: `writes` field (new schema feature)
```json
"adjust": {
  "type": "effect",
  "deps": ["count"],
  "fn": "adaptiveRate",
  "writes": ["interval"],
  "config": { "rules": [
    { "when": { "gt": 100 }, "set": 2000 },
    { "when": { "lt": 20 }, "set": 30000 }
  ]}
}
```

### Option B: `fn` that returns state updates (convention)
```json
"adjust": {
  "type": "derived",
  "deps": ["count"],
  "fn": "computeInterval",
  "config": { "target": ["interval"] }
}
```

### Option C: Accept that feedback loops are code-level, not spec-level
GraphSpec handles composition; feedback loops are inherently imperative
(conditional write-back). Accept that some patterns require code, and
GraphSpec's scope is structural composition.

**Recommendation:** Option A is cleanest — it makes the write-back explicit
and auditable. But this is a SPEC CHANGE, not a catalog fix.

## Error handling weakness: library + catalog problem

**Verdict: BOTH — catalog gap AND schema expressiveness gap.**

### Catalog gap
`retry` fn needs `config.fn` to know what to retry. Currently `retry` is listed
as a standalone fn, but retry is a *wrapper* — it needs an inner operation.

**Fix:** Change the catalog to:
```
retry: Retry an operation on failure.
  Config: { fn: "fnToRetry", maxAttempts, backoff?: "exponential"|"linear" }
```

This is purely a catalog documentation fix.

### Schema gap
The deeper issue: GraphSpec has no composition operators. You can't express
"retry(fetchPrice)" as a node — you'd need:

```json
"fetchPrice": {
  "type": "derived",
  "deps": ["trigger"],
  "fn": "fetchFromApi",
  "config": { "url": "https://pricing.example.com" },
  "wrappers": ["retry:3:exponential", "fallback:cached"]
}
```

or a pipeline notation per spec §5.5:
> "Prefer `pipe(source, withRetry(3), withTimeout(5000))` over
>  `source({ retries: 3, timeout: 5000 })`"

The spec recommends composition over configuration, but GraphSpec JSON can't
express `pipe()`. This is a schema expressiveness gap.

**Options:**
1. **`wrappers` array** — ordered list of middleware applied to the fn
2. **Pipeline nodes** — `{ "type": "pipeline", "steps": ["fetch", "retry", "fallback"] }`
3. **Accept code for resilience** — retry/fallback patterns are code-level concerns

**Recommendation:** Option 1 (wrappers) is minimal and keeps GraphSpec declarative.

## Summary: what the evals actually revealed (updated through Run 4)

| Finding | Root cause | Fix type | Status |
|---------|-----------|----------|--------|
| Catalog quality = product quality | Prompt text determines LLM output | Automated — `CatalogFnEntry` + `generateCatalogPrompt` | **Shipped** |
| Hallucination from missing catalog features | LLM can't use features it doesn't know about | Catalog update → 25%→0% hallucination | **Fixed** |
| Feedback loops not expressible in GraphSpec | Schema gap → top-level `feedback` array | Spec change | **Shipped** |
| Subgraph duplication (T8a) | No template support → `templates` in GraphSpec | Spec change | **Shipped** |
| Retry/fallback incomplete in GraphSpec | Catalog gap + schema gap (no composition) | Catalog fix + templates | **Fixed** |
| Functions treatment judged unfairly on reactivity | Biased rubric | Fixed in portable eval | **Fixed** |
| Both treatments complete simple tasks equally | Expected — differentiation is at medium/high complexity | Confirmed | N/A |
| Claude prefers GraphSpec (+7), Gemini prefers Functions (+5) | Model-specific strengths | Catalog quality narrows gap for all models | Observed |
| Catalog-aware validation catches LLM errors | fn/source name mismatch, wrong config | `validateSpecAgainstCatalog` + auto-refine in `llmCompose` | **Shipped** |

### The eval story arc (Runs 1→4)

1. **Run 1** — Biased rubric favored GraphReFly. Fixed rubric.
2. **Run 2** — Added resilience fns to catalog. Hallucination: 29%→0%. Proved catalog is load-bearing.
3. **Run 3** — Shipped feedback edges + templates in library but **forgot to update catalog**. Hallucination regressed to 25%. Proved the LLM can't use features it doesn't know about.
4. **Run 4** — Updated catalog with feedback/templates/routing/validation. Hallucination: 0% across both Claude and Gemini. +10 points. Largest single-run improvement.

**The publishable insight:** Catalog documentation quality is the #1 lever for LLM output quality. We proved it empirically, then automated it: `CatalogFnEntry` bundles descriptions with factories, `generateCatalogPrompt` auto-generates prompts, `validateSpecAgainstCatalog` catches errors, and `llmCompose` auto-refines on catalog errors. The manual eval→fix→re-eval loop is now built into the library.

## Action items

1. ~~**Run portable eval across 3+ AIs** with neutral rubric — get unbiased baseline~~ → Run 2 completed (2026-04-05), see `claude-web-2026-04-05-run2.md`
2. ~~**Propose `writes` field** for GraphSpec feedback loops~~ → decided against standalone `writeTo`; it's just `graph.set()` renamed. Feedback loops use §8.1 `feedback(graph, condition, reentry)` serialized as top-level `"feedback"` array in GraphSpec §8.3. The fn is a normal derived computation; the cycle is the `feedback` edge. No `conditionMap` catalog entry needed — if-else logic is just a derived fn.
3. ~~**Fix `retry` catalog entry** to require `config.fn`~~ → done in catalog update (added fibonacci, updated config)
4. ~~**Consider `wrappers` array** for resilience composition in GraphSpec~~ → replaced by `templates` in GraphSpec §8.3 (define-once subgraph pattern, instantiate per source via `"type": "template"` + `"bind"`)
5. ~~**Re-run evals after fixes** to see if Task 5 and Task 6 improve~~ → T5 improved (+4 pts), T6 barely (+1 pt, schema gap confirmed)
6. ~~**Schema: subgraph template / pattern reuse**~~ → added to roadmap §8.3 as `templates` top-level key. `compileSpec()` expands into `graph.mount()`. See roadmap for schema examples.
7. ~~**L1 eval tier added**~~ — debug/modify/explain tasks in `portable-eval-prompts.md`, tests GraphSpec's introspection advantages
8. ~~**Task 8 split into 8a/8b**~~ — 8a requires per-source isolation, 8b requires shared gating (tests whether LLM applies correct topology)
9. ~~**Run across more models**~~ → Gemini Pro completed (2026-04-06), see `claude-web-2026-04-06-run4.md`. Gemini confirms: catalog update eliminates hallucination across models. Gemini prefers Functions (+5), Claude prefers GraphSpec (+7). Need GPT-4o and smaller models still.
10. ~~**Re-run L0 + L1 evals after §8.3 ships**~~ → Run 3 completed (2026-04-06), see `claude-web-2026-04-06-run3.md`. §8.3 features (feedback edges, templates) shipped in library but **catalog was NOT updated** — LLM couldn't use features it didn't know about. Hallucination regressed to 25% (all from feedback/retry config). Catalog updated in portable-eval-prompts.md to include feedback edges, templates, stratify routing, resilience ordering, validateSchema.
11. ~~**Re-run L0 after catalog update**~~ → Run 4 completed (2026-04-06). Hallucination: 25% → 0% (both Claude and Gemini). Bug rate: 58% → 42% (Claude). Total: +10 points. **Largest single-run improvement in eval history.** Both models adopted feedback edges, templates, filterBy-after-stratify, and validateSchema.
12. **Add `validateSchema` to library** — added to catalog in portable-eval-prompts.md but needs implementation in graphspec.ts FnFactory catalog. T2 has used wrong tools across first 3 runs, fixed in Run 4.
13. **Catalog-as-structured-data** — the eval→fix→re-eval loop (Runs 1→4) is the biggest quality lever discovered. Currently the catalog is a prompt string (`catalogDescription` in `llmCompose`). Proposal: make catalog a structured object with fn/source descriptions, config schemas, ordering hints, and examples. `validateSpec` can then check fn names against catalog (catch "fn: rest-api" at validation time). See `claude-web-2026-04-06-run4.md` for full analysis of catalog quality as the primary lever.
14. **Run L1 evals** — still untested. L1 measures comprehension/debugging which is GraphSpec's predicted advantage over Functions.
15. **Run GPT-4o + smaller models** — Claude and Gemini covered. Need breadth.
16. **Catalog growth governance** — established decision framework for when to add fns vs templates vs docs vs wrappers vs prune. Key metric: **score per prompt token** (declining = bloat). `conditionalMap` reclassified as catalog wrapper over `dynamicNode`, not a new primitive. Only `median` (genuinely missing op) warrants new library code out of 5 identified gaps. See `session-2026-04-06-catalog-automation.md` §6 for full decision rules and metrics. Future Treatment E: catalog subsetting (task-relevant subset) to test whether smaller targeted catalogs outperform comprehensive ones.
