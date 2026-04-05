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

## Summary: what the evals actually revealed

| Finding | Root cause | Fix type |
|---------|-----------|----------|
| Hallucination rate lower in GraphSpec | Catalog constraint works | Validated ✓ |
| Feedback loops not expressible in GraphSpec | Schema gap — no `writes` field | Spec change needed |
| Retry/fallback incomplete in GraphSpec | Catalog gap + schema gap (no composition) | Catalog fix + optional schema extension |
| Functions treatment judged unfairly on reactivity | Biased rubric | Fixed in portable eval |
| Both treatments complete simple tasks equally | Expected — differentiation is at medium/high complexity | Confirmed |

## Action items

1. **Run portable eval across 3+ AIs** with neutral rubric — get unbiased baseline
2. **Propose `writes` field** for GraphSpec feedback loops (spec change, needs RFC)
3. **Fix `retry` catalog entry** to require `config.fn`
4. **Consider `wrappers` array** for resilience composition in GraphSpec
5. **Re-run evals after fixes** to see if Task 5 and Task 6 improve
