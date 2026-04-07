# Session: Catalog Automation Design + Eval Plan

Date: 2026-04-06
Context: Post-Run 4 analysis. Rich catalog types shipped. Designing eval validation + pre-built templates.

---

## 1. Architectural/semantic gaps from Run 4

Five persistent issues appeared in BOTH Claude AND Gemini (not model-specific):

### Gap 1: Resilience ordering (T5, T8a, T8b)

**What happens:** LLMs consistently build resilience chains in wrong order (timeout outside retry, or rateLimiter inside circuitBreaker). The catalog has text guidance but no enforcement.

**Root cause:** Ordering is a composition concern. Individual fn descriptions don't express "I should wrap X." The LLM composes them as a linear chain and guesses the order.

**Fix: Pre-built `resilientFetch` template** with correct ordering baked in. The developer (or LLM) just binds a source. The template handles: rateLimiter → circuitBreaker → retry → timeout(inner) → fallback → cache feedback → withStatus.

```json
{
  "templates": {
    "resilientFetch": {
      "params": ["$source"],
      "nodes": {
        "rateLimited":  { "type": "derived", "deps": ["$source"],      "fn": "rateLimiter",     "config": { "maxEvents": 5, "windowMs": 1000 } },
        "breaker":      { "type": "derived", "deps": ["rateLimited"],  "fn": "circuitBreaker",  "config": { "failureThreshold": 3, "cooldownMs": 30000 } },
        "retried":      { "type": "derived", "deps": ["breaker"],      "fn": "retry",           "config": { "maxAttempts": 3, "backoff": "exponential" } },
        "timed":        { "type": "derived", "deps": ["retried"],      "fn": "timeout",         "config": { "timeoutMs": 2000 } },
        "cache":        { "type": "state", "initial": null },
        "withFallback": { "type": "derived", "deps": ["timed"],        "fn": "fallback",        "config": { "fallbackSource": "cache" } },
        "cacheUpdate":  { "type": "derived", "deps": ["withFallback"], "fn": "scan",            "config": { "fn": "latest", "initial": null } },
        "status":       { "type": "derived", "deps": ["withFallback"], "fn": "withStatus",      "config": { "initialStatus": "pending" } }
      },
      "output": "status"
    }
  },
  "feedback": [
    { "from": "resilientFetch::cacheUpdate", "to": "resilientFetch::cache", "maxIterations": 1 }
  ]
}
```

**Eval impact:** T5, T8a, T8b should all improve. T8a should score 15/15 (template handles both ordering and cache).

### Gap 2: Producer can't read state dynamically (T6)

**What happens:** T6 needs an adaptive polling interval. The LLM writes `pollIntervalMs: "$pollingInterval"` but producers have no `deps` and can't read state nodes.

**Root cause:** Schema gap. `GraphSpecNode.deps` is documented as "for derived/effect/operator." Producers are pull-based — they don't react to upstream changes.

**Fix options:**

- **Option A: `switchMap` pattern** — Use a derived node with `switchMap` that re-creates the timer whenever the interval state changes. This is what the library already supports at the code level. Need a catalog fn `dynamicTimer` that takes an interval dep.
  
- **Option B: `deps` on producer** — Allow producers to have deps. When a dep changes, the source factory is re-invoked with new config. This is a schema extension.

- **Option C: Pre-built `adaptivePoller` template** — Encapsulates the switchMap pattern. The developer binds a rate-computation fn and a source.

**Recommendation:** Option C (template) for LLM-facing use. Option A (switchMap fn) for the catalog. No schema change needed.

```json
{
  "templates": {
    "adaptivePoller": {
      "params": ["$rateComputer"],
      "nodes": {
        "interval":     { "type": "state", "initial": 10000 },
        "timer":        { "type": "producer", "source": "timer", "config": { "intervalMs": 10000 } },
        "fetch":        { "type": "derived", "deps": ["timer"], "fn": "dynamicTimer", "config": { "intervalSource": "interval" } },
        "rateComputed": { "type": "derived", "deps": ["$rateComputer"], "fn": "mapFields", "config": {} }
      },
      "output": "fetch"
    }
  },
  "feedback": [
    { "from": "adaptivePoller::rateComputed", "to": "adaptivePoller::interval", "maxIterations": 1 }
  ]
}
```

**Eval impact:** T6 should improve significantly. Currently scores 12-13/15 across all runs and models.

### Gap 3: No median fn (T8a)

**What happens:** Task says "compute the median." Catalog only has `aggregate` with op `avg`. LLM uses avg.

**Fix:** Add `median` to aggregate ops, or add a standalone `median` fn to catalog.

**Eval impact:** T8a C5 should go from 2→3.

### Gap 4: Missing DB query in feedback loop (T11)

**What happens:** T11 needs to score novelty "against existing claims stored in a database." The LLM creates `llmScore` but doesn't add a `database` producer node to feed existing claims into the comparison.

**Root cause:** The LLM doesn't think to add a producer node mid-pipeline. It treats the pipeline as a linear chain from source to sink.

**Fix: Pre-built `noveltyLoop` template** or a catalog example showing "derived node + database producer as co-deps for comparison."

Simpler fix: Add guidance to the `llmScore` fn description:
```
llmScore: Score item with LLM rubric. When comparing against existing data, 
add a "database" producer node as a second dep. Config: { rubric, scale? }
```

**Eval impact:** T11 C4 should go from 2→3.

### Gap 5: Interval computation logic (T6)

**What happens:** The LLM can't express "if count > 100 → 2000ms, if count < 20 → 30000ms, else → 10000ms" declaratively. It tries `branch` or `mapFields` which can't do conditional value mapping.

**Fix:** Add a `conditionalMap` fn to catalog:
```
conditionalMap: Map input to output based on rules. 
Config: { rules: [{ match: { field, op, value }, output: <value> }], default: <value> }
```

This is a generalization of `thresholdCheck` that produces values instead of booleans.

**Eval impact:** T6 C5 should go from 2→3.

---

## 2. Pre-built templates (common patterns to extract)

| Template | Solves gaps | Nodes | What developer configures |
|----------|-----------|-------|--------------------------|
| `resilientFetch` | #1 (ordering), T5/T8a/T8b cache | 8 | Rate limit, breaker threshold, retry count, timeout, fallback |
| `adaptivePoller` | #2 (producer+state), #5 (interval logic), T6 | 4 | Initial interval, rate computation fn, source |
| `classifyAndRoute` | None (LLMs do this well) | N/A | Skip — not a pain point |
| `noveltyLoop` | #4 (DB query in loop), T11 | 6 | Score rubric, DB query, merge fn, max iterations |

**Key insight:** Templates aren't just for reducing boilerplate — they encode **architectural decisions** that LLMs get wrong. The resilience ordering, the cache-feedback pattern, the DB-as-codep — these are patterns where the LLM needs help, and templates provide that help structurally.

### Developer experience with templates

Without template (current — developer writes catalog description + hopes LLM gets it right):
```typescript
const spec = await llmCompose(
  "Fetch price from API with retry and cache fallback",
  adapter,
  { catalogDescription: "retry: ...\nfallback: ...\ncache: ..." }
);
// LLM builds: timeout → retry → fallback (wrong order, no cache feedback)
```

With pre-built template (proposed — developer selects template, LLM just binds):
```typescript
const spec = await llmCompose(
  "Fetch price from API with retry and cache fallback",
  adapter,
  {
    catalog: {
      ...BASE_CATALOG,
      templates: { resilientFetch: BUILTIN_TEMPLATES.resilientFetch }
    }
  }
);
// LLM outputs: { "type": "template", "template": "resilientFetch", "bind": { "$source": "priceApi" } }
// Ordering is correct. Cache feedback is correct. Developer didn't have to think about it.
```

---

## 3. Eval plan for 9.1b

### The experiment

Four treatments, same 12 tasks, measuring the delta at each automation step:

| Treatment | What changes | Developer effort | Expected delta |
|-----------|-------------|-----------------|---------------|
| **A: Manual catalog** | Developer writes `catalogDescription` string by hand (mimic current portable-eval-prompts.md) | High — must write clear descriptions, examples, ordering hints | Baseline (Run 4: 173/180) |
| **B: Auto-generated prompt** | Developer writes `CatalogFnEntry` objects. Library auto-generates prompt via `generateCatalogPrompt()` | Medium — writes structured metadata instead of prose | Should match A (same info, different format) |
| **C: Auto-gen + auto-refine** | Same as B, plus `maxAutoRefine: 2`. Library catches catalog errors and feeds them back to LLM | Low — errors self-correct | Should improve on B (fewer hallucinations/config errors) |
| **D: Auto-gen + auto-refine + templates** | Same as C, plus pre-built templates (`resilientFetch`, `adaptivePoller`, `conditionalMap`). Library provides architectural patterns | Lowest — developer selects patterns, LLM binds | Should close remaining gaps (ordering, cache, feedback) |

### What to measure

| Metric | A (manual) | B (auto-gen) | C (+refine) | D (+templates) |
|--------|-----------|-------------|------------|---------------|
| Hallucination rate | 0% (Run 4) | ? | ? | ? |
| Bug rate | 42% (Run 4) | ? | ? | ? |
| Completeness | 2.83 | ? | ? | ? |
| Total score | 173/180 | ? | ? | ? |
| Developer effort | ~60 min writing descriptions | ~30 min writing entries | Same as B | Same as B + template selection |
| Auto-refine attempts | N/A | N/A | count | count |
| Template usage rate | N/A | N/A | N/A | % tasks using templates |

### Hypotheses

1. **A ≈ B** — Auto-generated prompts should match hand-written quality if the CatalogFnEntry descriptions are good. The format differs but the information content is the same.

2. **C > B by 1-3 points** — Auto-refine catches config errors (wrong enum values, missing required fields) but not architectural errors (wrong ordering, missing nodes). Expect T2, T5 config issues to self-correct.

3. **D > C by 5-10 points** — Templates close the architectural gap. T5, T6, T8a, T8b, T11 should all improve because the patterns that LLMs get wrong are now encoded in templates.

4. **D should score 178-180/180** — Only T6 and T7 might not hit 15/15 (T6 depends on adaptivePoller template quality, T7 is inherently ambiguous).

### Simulation approach

For each treatment, mimic a developer:

**Treatment A (manual catalog):**
- Copy the existing portable-eval-prompts.md system context as `catalogDescription`
- This IS the Run 4 baseline — already scored

**Treatment B (auto-generated):**
- Write `CatalogFnEntry` objects for each fn/source in the portable-eval catalog
- Pass as `catalog` to `llmCompose` (no `catalogDescription`)
- Library calls `generateCatalogPrompt` internally
- Score the output

**Treatment C (auto-gen + auto-refine):**
- Same as B, plus `maxAutoRefine: 2`
- Track how many refine attempts per task
- Score the final output

**Treatment D (auto-gen + auto-refine + templates):**
- Same as C, plus add `resilientFetch`, `adaptivePoller`, `conditionalMap` to catalog
- Track template usage
- Score the final output

### Timeline

| Week | What |
|------|------|
| **This week** | Write `CatalogFnEntry` objects for existing catalog. Implement `conditionalMap` fn. Add `median` to aggregate. |
| **Next week** | Build pre-built template library (`resilientFetch`, `adaptivePoller`). Run Treatment B + C evals. |
| **Week after** | Run Treatment D evals. Write up comparison. |
| **Announcement** | Blog post with A→D progression data. "We automated the quality gap away." |

---

## 4. How this benefits the 9.1 eval story

The narrative arc becomes:

> **Act 1 (Runs 1-2):** We found that catalog quality matters. Manual catalog fixes improved scores.
>
> **Act 2 (Runs 3-4):** We proved it's the #1 lever. Forgot to update catalog → regression. Updated → biggest improvement ever. Works across models.
>
> **Act 3 (9.1b):** We automated it. Rich catalog types auto-generate prompts. Catalog-aware validation catches errors. Auto-refine corrects them. Pre-built templates encode architectural patterns LLMs get wrong.
>
> **Act 4 (the punchline):** Treatment D scores 178/180. Treatment A (manual, what every other framework requires) scores 173. The 5-point gap is the value of the automation. And the developer wrote LESS code.

This is the "harness engineering" proof: the framework doesn't just provide primitives — it actively ensures LLMs use them correctly.

---

## 5. Responsibility matrix (final)

| Layer | What | Owner | Automated? |
|-------|------|-------|:---:|
| Model capability | Claude vs Gemini vs GPT-4o strengths | LLM provider | No |
| Catalog fn descriptions | "What does filterBy do?" | Library (base) + developer (custom) | **Yes — CatalogFnEntry** |
| Config schemas | "What fields does retry.config take?" | Library (base) + developer (custom) | **Yes — configSchema + validation** |
| Prompt structure | "How to use feedback edges" | Library (llmCompose system prompt) | **Yes — auto-generated from catalog** |
| Architectural patterns | "Correct resilience ordering" | Library (pre-built templates) | **Yes — templates** |
| Validation feedback | "fn 'rest-api' is a source, not a function" | Library (validateSpecAgainstCatalog) | **Yes — auto-refine loop** |
| Domain knowledge | "Orders have priority 1-5" | Developer | No — but structured catalog captures it |
| Context management | Token limits, prompt truncation | Library (future: smart catalog compression) | Future |

The developer's remaining job: describe WHAT their custom fns do and WHAT domain entities look like. Everything else — prompt generation, validation, error correction, architectural patterns — is the library's job.

---

## 6. Semantic sugars vs docs vs templates: the decision framework

### The question

After identifying 5 gaps (§1), we asked: should we create new catalog fns (like `conditionalMap`), rely on docs/templates to guide LLMs, or both? What metrics determine the right direction?

### Key finding: `conditionalMap` is a wrapper, not a primitive

`dynamicNode` already exists at `src/core/dynamic-node.ts` (647 lines). It handles conditional deps with full runtime tracking. `conditionalMap` is a subset of dynamicNode's capability — a thin factory wrapper around `dynamicDerived`.

**Decision:** Expose as a rich `CatalogFnEntry` pointing to a thin dynamicNode wrapper. NOT a new primitive. The catalog entry IS the semantic sugar — a named, documented facade over existing capability. The library doesn't grow a new code path.

### Three tools for guiding LLMs, each with different cost/benefit

| Tool | When to use | Library cost | LLM benefit |
|------|------------|-------------|-------------|
| **New catalog fn** | Operation genuinely doesn't exist (e.g. `median`) | Real code, new test surface | High — single node, no composition |
| **Pre-built template** | Multi-node pattern LLM consistently gets wrong (e.g. resilience ordering) | Moderate — tested subgraph | Very high — encodes architectural decisions |
| **Better docs/examples** | LLM has the right primitives but doesn't reach for them (e.g. DB as codep) | Zero library cost | Medium — works for config errors, fails for structural |
| **Catalog wrapper** | LLM can't compose a pattern that dynamicNode already supports | Thin — no new code paths | High — named shortcut in catalog |

### The 5 gaps mapped to fix types

| Gap | Failure type | Right fix |
|-----|-------------|-----------|
| Resilience ordering (T5, T8a/b) | Multi-node architectural | **Template** (`resilientFetch`) |
| Producer can't read state (T6) | Multi-node architectural | **Template** (`adaptivePoller`) |
| No median (T8a) | Missing operation | **Catalog fn** (add to aggregate ops) |
| DB query in loop (T11) | Composition guidance | **Docs** (update `llmScore` description) |
| Conditional value mapping (T6) | Composition over existing primitive | **Catalog wrapper** (conditionalMap over dynamicNode) |

Score: 2 templates, 1 real fn, 1 docs update, 1 catalog wrapper. Only 1 out of 5 gaps needs new library code.

### Bloat control principle

> **Add a catalog fn** when the LLM drops points because the operation doesn't exist.
> **Add a template** when the LLM drops points because it composes correct fns in wrong structure.
> **Add docs/examples** when the LLM drops points because it doesn't think to use an existing fn.
> **Add a catalog wrapper** (not a primitive) when the LLM can't compose a pattern that dynamicNode already supports.

### Will evals lead to more semantic sugars?

Yes — but the eval should also **cap** them. Every new catalog entry makes the LLM's prompt longer. Run 4 showed that ~20 well-documented fns produce 0% hallucination. Adding 50 more fns won't improve 0% — it'll degrade quality (LLM confuses similar fns, prompt overflows context).

**Risk threshold:** If Treatment D's prompt token count crosses a quality-degradation point, implement catalog subsetting (include only fns relevant to the task).

### Metrics/criteria for determining improvement direction

The eval should measure these KPIs per treatment to decide "more of X" vs "less of X":

| Metric | What it tells us | Direction signal |
|--------|-----------------|-----------------|
| **Total score** (out of 180) | Overall quality | Higher = keep going |
| **Hallucination rate** | Catalog coverage | Rising = catalog too large or descriptions ambiguous |
| **Bug rate** | Structural correctness | High = need templates for patterns LLM gets wrong |
| **Completeness** (C5 avg) | Feature coverage | Low = missing fns or missing docs for existing fns |
| **Prompt token count** | Catalog size | Rising without score improvement = bloat, prune |
| **Auto-refine attempt count** | Validation friction | High = catalog descriptions unclear or config schemas too strict |
| **Template usage rate** | Template relevance | Low = templates don't match task patterns; high = templates encode real value |
| **Score per prompt token** | Efficiency | Declining = diminishing returns, stop adding |
| **Per-task delta A→D** | Where automation helps | Tasks with no improvement = gap type is docs, not fn/template |

**Decision rules:**

1. **Score up, tokens flat** → good addition, keep it
2. **Score flat, tokens up** → bloat, remove or merge entries
3. **Score up only with templates, not with fns** → invest in templates, not new fns
4. **Hallucination rises with catalog size** → implement catalog subsetting (task-relevant subset)
5. **Auto-refine consistently fixes the same error** → description is bad, fix the description instead of relying on refine
6. **Per-task delta = 0 across A→D** → that task is at ceiling, don't add more catalog for it

### Open question for future eval

Should we measure a **Treatment E: catalog subsetting** — where the library selects only relevant fns/templates for the task? This would test whether a smaller, targeted catalog outperforms a comprehensive one. Hypothesis: for simple tasks, a 10-fn catalog beats a 30-fn catalog. For complex tasks, the full catalog is needed. Smart subsetting could be the next automation layer after templates.
