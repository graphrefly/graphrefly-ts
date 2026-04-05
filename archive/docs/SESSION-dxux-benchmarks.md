---
SESSION: dxux-benchmarks
DATE: April 4, 2026
TOPIC: DX/UX benchmark design — quantifiable metrics and evals for LLM composition accuracy, developer onboarding, and end-user comprehension
REPO: graphrefly-ts
PREREQUISITE: SESSION-first-principles-audit.md (Decision #5)
---

## CONTEXT

The first-principles audit (Decision #5) calls for a dedicated session to "design DX/UX benchmarks — quantify LLM composition accuracy, dev onboarding time, end-user comprehension." This document applies the backward-design pattern (Questions → Metrics → Measurement) from Product-Manager-Platform's methodology to produce testable, quantifiable benchmarks across all three DX/UX layers identified in the audit.

---

## BACKWARD DESIGN: QUESTIONS FIRST

### Layer 1 — LLM-DX (LLM Developer Experience)

| # | Question | Why it matters |
|---|----------|---------------|
| L1-Q1 | Can a frontier LLM generate a valid, runnable GraphSpec from a natural-language description on the first attempt? | Audit Part 12 litmus test — if zero-shot fails, the schema is too complex |
| L1-Q2 | When the LLM makes an error, can it self-correct from the validation error message alone? | Self-debuggability is a stated requirement (Part 10, Layer 1) |
| L1-Q3 | Can an LLM produce a correct structural diff (specDiff) from a natural-language modification request? | Demo 0 AC #3 — modification via NL produces correct diff |
| L1-Q4 | Does the LLM avoid "hallucinating" node types, source names, or fn references outside the catalog? | Constrained error space is the core argument (Part 7) |

### Layer 2 — Dev-DX (Engineer Developer Experience)

| # | Question | Why it matters |
|---|----------|---------------|
| L2-Q1 | Can a developer go from `npm install` to a visible, running graph in under 5 minutes? | Audit Part 10, Layer 2: "5-minute setup" |
| L2-Q2 | Can a developer use `state()`, `derived()`, `effect()` without reading protocol internals? | Progressive disclosure: bitmasks/DIRTY/RESOLVED must not surface |
| L2-Q3 | Can a developer diagnose a bug using `describe()` + `observe()` faster than console.log? | Audit Part 5 Requirement 2: built-in > bolted-on |
| L2-Q4 | Does the error message for a common mistake (missing dep, cycle, type mismatch) tell the developer exactly what to fix? | Callbag died from DX neglect (Key Insight #6) |

### Layer 3 — End-User UX

| # | Question | Why it matters |
|---|----------|---------------|
| L3-Q1 | Can a non-technical user understand the simplified flow view of their graph? | Audit Part 9: "if ordinary people can't understand what the graph is doing, it's useless to them" |
| L3-Q2 | Can a non-technical user modify their graph via natural language and verify the change in the flow view? | Demo 0 AC #2 and #3 |
| L3-Q3 | Can a user understand the causal explanation for why a specific action was taken? | Demo 0 AC #5: human-readable causal chain |
| L3-Q4 | Does the end-to-end cycle (NL → graph → run → persist → resume) feel trustworthy? | Part 8: progressive trust accumulation |

---

### Layer 0 — Graph > Functions (Contrastive — Audit Part 7)

This layer validates the audit's core thesis: GraphSpec constrains error space vs plain functions.

| # | Question | Why it matters |
|---|----------|---------------|
| L0-Q1 | Does GraphSpec produce fewer composition errors than plain-function composition for the same task? | Part 7 core claim — "like SQL constraining database operations" |
| L0-Q2 | Are GraphSpec errors easier to localize than plain-function errors? | Part 7 table: "which node/edge is wrong" vs "requires understanding global control flow" |
| L0-Q3 | Does GraphSpec produce more consistent outputs across multiple LLM attempts for the same task? | Constrained systems should reduce variance |
| L0-Q4 | Can an LLM detect and fix bugs faster in a GraphSpec than in equivalent plain-function code? | Part 7: "fix blast radius" — changing one node vs changing one function affects others |

---

## NORTH STAR METRIC

**NSM: Weekly graphs composed and running via natural language**

This moves when all three layers work: LLM generates valid specs (L1), developers can embed the runtime (L2), and end users actually use the NL→graph flow (L3).

### NSM Decomposition (AARC)

```
NSM: Weekly NL-composed graphs running
├── Acquisition: New users who attempt NL → graph for the first time
├── Activation: Users whose first graph runs successfully without manual fix
├── Retention: Users who have a graph still running after 7 days
└── Expansion: Users who modify or add to their graph via NL
```

---

## METRICS & MEASUREMENT

### Layer 0 — Graph > Functions Contrastive Metrics

These are A/B evals: same task, two treatments (GraphSpec vs plain functions).

| Metric | Measurement method | What "wins" looks like |
|--------|-------------------|----------------------|
| **L0-M1: Composition error rate** — % of attempts with at least one bug, GraphSpec vs plain functions | 30 tasks × 3 attempts each × 2 treatments = 180 runs. LLM judge scores correctness. | GraphSpec error rate ≤ 50% of plain-function error rate |
| **L0-M2: Error localizability** — given a seeded bug, can the LLM identify the faulty component? | 15 buggy GraphSpecs + 15 equivalent buggy function sets. LLM asked to locate bug. Score: correct identification rate. | GraphSpec localization ≥ 85% vs plain functions ≤ 60% |
| **L0-M3: Output consistency** — variance in structure across 5 attempts for the same task | 10 tasks × 5 attempts × 2 treatments. Measure structural similarity (Jaccard on node/function names + topology). | GraphSpec Jaccard ≥ 0.8 vs plain functions ≤ 0.5 |
| **L0-M4: Bug-fix speed** — number of LLM round-trips to fix a seeded bug | 10 buggy specs + 10 buggy function sets. Feed error, count iterations to correct output. | GraphSpec median ≤ 2 rounds vs plain functions median ≥ 3 |

**Contrastive eval design:**

Each task has two prompt variants:

```
# Treatment A (GraphSpec)
"Given this GraphSpec schema and function catalog, compose a graph for: {{task}}"
→ Output: JSON conforming to GraphSpec schema
→ Validation: validateSpec() + runtime execution + LLM judge

# Treatment B (Plain functions)
"Write TypeScript functions that accomplish: {{task}}"
→ Output: TypeScript code
→ Validation: TypeScript compilation + runtime execution + LLM judge
```

**30-task corpus (shared across treatments):**

| Category | Count | Complexity | Example |
|----------|-------|-----------|---------|
| Linear pipeline | 6 | Low | "Fetch RSS → filter → send to Slack" |
| Fan-out | 5 | Medium | "Classify email into 3 categories" |
| Fan-in | 5 | Medium | "Merge weather + calendar + traffic" |
| Diamond | 5 | Medium-High | "Validate AND transform, then merge" |
| Stateful (accumulator) | 4 | High | "Running average of sensor readings" |
| Error handling | 3 | High | "Retry failed API calls, fallback to cache" |
| Multi-step with side effects | 2 | High | "If threshold crossed, alert + log + update dashboard" |

**Key controls:**
- Same LLM, same temperature, same system prompt preamble
- GraphSpec treatment gets: schema + fn catalog + 2 few-shot examples
- Plain functions treatment gets: TypeScript types + utility library + 2 few-shot examples
- Both get equivalent context budget

---

### Layer 1 — LLM-DX Metrics

| Metric | Baseline (est.) | Target | Measurement method |
|--------|-----------------|--------|-------------------|
| **L1-M1: Zero-shot validity rate** — % of NL descriptions producing a valid, runnable GraphSpec on first attempt | TBD (measure with eval suite) | ≥ 80% across 50 diverse prompts | Automated eval: 50 NL prompts → GraphSpec → `validateSpec()` → run |
| **L1-M2: Self-correction rate** — % of invalid specs self-corrected after one error message round-trip | TBD | ≥ 90% (of the ~20% that fail L1-M1) | Automated eval: feed validation error back → re-generate → validate |
| **L1-M3: Diff accuracy** — % of NL modification requests producing correct specDiff (no unrelated changes, requested change present) | TBD | ≥ 85% across 30 modification prompts | Automated eval: base spec + NL mod → specDiff → assert only intended nodes changed |
| **L1-M4: Hallucination rate** — % of generated specs referencing non-existent types/sources/fns | TBD | ≤ 5% | Automated eval: parse generated spec → check all references against catalog |

**Eval suite design (inspired by Product-Manager-Platform evals):**

```jsonc
{
  "eval_id": "l1_zero_shot_validity",
  "prompt_template": "Given this GraphSpec schema and function catalog, generate a GraphSpec for: {{nl_description}}",
  "test_cases": 50,  // Diverse: simple (3-node linear) to complex (10-node with branches)
  "assertions": [
    { "type": "llm_judge", "claim": "The generated JSON is valid against GraphSpec JSON Schema" },
    { "type": "runtime", "claim": "graphFromSpec(output) does not throw" },
    { "type": "runtime", "claim": "graph.describe() returns expected node count ±1" },
    { "type": "llm_judge", "claim": "All node deps reference existing nodes in the spec" },
    { "type": "llm_judge", "claim": "All fn references exist in the provided function catalog" }
  ]
}
```

**Prompt corpus categories (50 prompts):**

| Category | Count | Examples |
|----------|-------|---------|
| Linear pipeline (A→B→C) | 10 | "Fetch RSS, filter by keyword, send to Slack" |
| Fan-out (A→B,C,D) | 8 | "Watch inbox, classify into urgent/newsletter/other" |
| Fan-in (A,B,C→D) | 8 | "Combine weather + calendar + traffic into morning brief" |
| Diamond (A→B,C→D) | 8 | "Fetch data, validate AND transform, then merge for output" |
| Feedback loop | 6 | "Monitor metrics, adjust threshold, re-monitor" |
| Multi-source + effect | 5 | "Watch 3 APIs, correlate events, alert on anomaly" |
| Ambiguous/edge case | 5 | "Do something with my emails" (tests graceful handling) |

### Layer 2 — Dev-DX Metrics

| Metric | Baseline (est.) | Target | Measurement method |
|--------|-----------------|--------|-------------------|
| **L2-M1: Time to first graph** — minutes from `npm install` to visible running graph | TBD (measure with 5 devs) | ≤ 5 min median | Timed user study: provide README + blank project, measure |
| **L2-M2: Lines of code for hello-world** — LOC for minimal state→derived→effect | Current (count) | ≤ 10 LOC (imports included) | Code review of quickstart example |
| **L2-M3: Zero-concept success rate** — % of devs who build a working 3-node graph using only `state()`/`derived()`/`effect()` docs, no protocol knowledge | TBD | ≥ 80% (of 10 test devs) | User study: provide sugar API docs only, ask to build specific graph |
| **L2-M4: Debug time ratio** — time to diagnose a seeded bug using describe()/observe() vs console.log | TBD | ≤ 0.5x (half the time) | A/B user study: same bug, two groups, measure time to correct diagnosis |
| **L2-M5: Error message actionability** — % of common error messages where dev fixes the issue without external search | TBD | ≥ 90% for top-10 errors | User study: seed 10 common mistakes, measure if dev fixes from error alone |

**Top-10 common errors to seed (L2-M5):**

1. Missing dependency in `deps` array
2. Circular dependency
3. Type mismatch (string where number expected)
4. Reading node before graph started
5. Duplicate node name
6. Effect with no deps (won't trigger)
7. Producer source not found / misconfigured
8. Accessing `.value` on errored node
9. Modifying state inside derived (should be pure)
10. Forgetting to call `graph.start()`

### Layer 3 — End-User UX Metrics

| Metric | Baseline (est.) | Target | Measurement method |
|--------|-----------------|--------|-------------------|
| **L3-M1: Flow comprehension** — % of non-technical users who correctly describe what a 5-node flow does after viewing simplified flow view for 30 seconds | TBD | ≥ 70% (of 20 test users) | User study: show flow, ask "what does this do?", judge answer |
| **L3-M2: NL modification success** — % of users who successfully change their graph behavior via NL instruction | TBD | ≥ 75% | User study: running graph + "change X to Y" → verify behavior changed |
| **L3-M3: Causal explanation clarity** — 1-5 Likert: "I understand why the system did X" | TBD | ≥ 4.0 mean | Post-task survey after viewing explainPath() output |
| **L3-M4: Trust score** — 1-5 Likert: "I trust this system to handle this task while I'm away" | TBD | ≥ 3.5 mean (first session), ≥ 4.0 (after 3 sessions) | Longitudinal survey: after session 1 and session 3 |
| **L3-M5: Resume confidence** — % of users who believe their graph resumed correctly after simulated app restart | TBD | ≥ 90% | User study: run graph, close, reopen, ask "is it working correctly?" + verify |

---

## ACTIONABLE WORK ITEMS

Organized by dependency order. Each item maps to metrics it unblocks.

### Phase A: Infrastructure (unblocks all evals)

| # | Item | Unblocks | Effort | Output |
|---|------|----------|--------|--------|
| A1 | **Design & implement GraphSpec JSON Schema** — minimal input format per audit Part 12 proposal (nodes with type/deps/fn/source/config, no edges array) | L1-M1 thru L1-M4 | M | `src/graph/graphspec-schema.json` |
| A2 | **Implement `validateSpec()`** — validate GraphSpec against schema, return structured actionable errors | L1-M1, L1-M2, L2-M5 | M | `src/graph/validate-spec.ts` |
| A3 | **Implement `graphFromSpec()`** — hydrate a Graph from a validated GraphSpec | L1-M1, Demo 0 | L | `src/graph/from-spec.ts` |
| A4 | **Implement `specDiff()`** — structural diff between two GraphSpecs | L1-M3, Demo 0 | M | `src/graph/spec-diff.ts` |
| A5 | **Build function catalog registry** — named fn references that GraphSpec can point to | L1-M4 | S | `src/graph/fn-catalog.ts` |
| A6 | **Implement `explainPath()`** — walk causal chain and produce human-readable explanation | L3-M3, Demo 0 | M | `src/graph/explain-path.ts` |

### Phase B0: Graph > Functions Contrastive Eval (measures Layer 0)

| # | Item | Unblocks | Effort | Output |
|---|------|----------|--------|--------|
| B0-1 | **Write 30-task shared corpus** — NL descriptions covering all 7 complexity categories | L0-M1 thru L0-M4 | M | `evals/corpus/contrastive-tasks.json` |
| B0-2 | **Write GraphSpec prompt template** — system prompt with schema, catalog, few-shot | L0-M1 | S | `evals/templates/graphspec-treatment.md` |
| B0-3 | **Write plain-functions prompt template** — system prompt with TS types, utils, few-shot | L0-M1 | S | `evals/templates/functions-treatment.md` |
| B0-4 | **Build contrastive eval runner** — runs both treatments, scores all L0 metrics | L0-M1 thru L0-M4 | M | `evals/run-contrastive.ts` |
| B0-5 | **Write 15 seeded-bug pairs** — same bug expressed in GraphSpec and plain functions | L0-M2, L0-M4 | M | `evals/corpus/contrastive-bugs.json` |
| B0-6 | **Run baseline contrastive eval** — establish L0-M1 thru L0-M4 with current schema | All L0 metrics | S | `evals/results/contrastive-baseline.json` |

### Phase B: LLM-DX Eval Suite (measures Layer 1)

| # | Item | Unblocks | Effort | Output |
|---|------|----------|--------|--------|
| B1 | **Write 50 NL→GraphSpec prompt corpus** — covering all 7 categories above | L1-M1 | M | `evals/corpus/nl-to-spec.json` |
| B2 | **Write 30 NL-modification prompt corpus** — base spec + modification instruction + expected diff | L1-M3 | S | `evals/corpus/nl-mod.json` |
| B3 | **Build automated eval runner** — runs prompts through LLM, validates output, scores metrics | L1-M1 thru L1-M4 | M | `evals/run-evals.ts` |
| B4 | **Run baseline eval** — establish L1-M1 thru L1-M4 baselines with current schema | All L1 metrics | S | `evals/results/baseline.json` |
| B5 | **Iterate schema until L1-M1 ≥ 80%** — if baseline fails, simplify schema and re-run | L1-M1 | Variable | Schema changes |

### Phase C: Dev-DX (measures Layer 2)

| # | Item | Unblocks | Effort | Output |
|---|------|----------|--------|--------|
| C1 | **Write quickstart guide** — npm install → 10 LOC → running graph, uses only sugar API | L2-M1, L2-M2 | S | `docs/quickstart.md` |
| C2 | **Audit and improve error messages** — for top-10 seeded errors, ensure each message says what's wrong + how to fix | L2-M5 | M | Error message improvements across `src/` |
| C3 | **Build seeded-error test suite** — 10 test cases that trigger each common error, assert message quality | L2-M5 | S | `evals/dev-dx/seeded-errors.test.ts` |
| C4 | **Recruit and run dev user study (N=5-10)** — timed, protocol: quickstart only, build specific graph | L2-M1, L2-M3 | M | `evals/results/dev-study.md` |

### Phase D: End-User UX (measures Layer 3)

| # | Item | Unblocks | Effort | Output |
|---|------|----------|--------|--------|
| D1 | **Design simplified flow view renderer** — IFTTT/Shortcuts-style, no graph jargon, no node IDs | L3-M1, Demo 0 | L | `src/patterns/flow-view.ts` or demo component |
| D2 | **Build NL→graph round-trip demo** — type NL, see flow, modify NL, see diff | L3-M2, Demo 0 | L | Demo 0 implementation |
| D3 | **Design user study protocol** — comprehension test, modification test, causal explanation survey, trust survey | L3-M1 thru L3-M5 | S | `evals/user-study-protocol.md` |
| D4 | **Recruit and run end-user study (N=10-20)** — non-technical users, protocol from D3 | L3-M1 thru L3-M5 | L | `evals/results/user-study.md` |

### Phase E: Continuous Tracking

| # | Item | Effort | Output |
|---|------|--------|--------|
| E1 | **Add eval metrics to CI** — L1-M1 thru L1-M4 run on every GraphSpec schema change | S | CI config |
| E2 | **Dashboard** — track all metrics over time, alert on regression | M | Internal dashboard or markdown report |

---

## EVAL ARCHITECTURE — SCAFFOLDING FOR BOTH REPOS

### Why two repos?

| Repo | Role in evals |
|------|--------------|
| `~/src/graphrefly` (spec repo) | Spec-level eval artifacts: task corpora, prompt templates, LLM-judge rubrics, expected-output schemas. These are **language-agnostic** — the same corpus tests `graphrefly-ts` and future `graphrefly-py`. |
| `~/src/graphrefly-ts` (this repo) | Runtime eval harness: runners, validators, CI integration, dev-DX test suites. These are **TypeScript-specific**. |

### Spec repo (`~/src/graphrefly`) — new `evals/` directory

```
~/src/graphrefly/
├── GRAPHREFLY-SPEC.md
└── evals/                          ← NEW
    ├── README.md                   # Eval philosophy, how to add tasks, scoring rubrics
    ├── schema/
    │   ├── task.schema.json        # JSON Schema for eval task definitions
    │   ├── result.schema.json      # JSON Schema for eval result records
    │   └── rubric.schema.json      # JSON Schema for LLM-judge rubric definitions
    ├── corpus/
    │   ├── contrastive-tasks.json  # 30 tasks for Graph-vs-Functions (L0)
    │   ├── contrastive-bugs.json   # 15 seeded-bug pairs (L0-M2, L0-M4)
    │   ├── nl-to-spec.json         # 50 NL→GraphSpec prompts (L1-M1)
    │   └── nl-mod.json             # 30 NL modification prompts (L1-M3)
    ├── templates/
    │   ├── graphspec-treatment.md  # System prompt for GraphSpec generation
    │   ├── functions-treatment.md  # System prompt for plain-function generation
    │   └── judge-prompts/
    │       ├── validity.md         # Judge: "Is this a valid runnable spec?"
    │       ├── correctness.md      # Judge: "Does this spec accomplish the task?"
    │       ├── diff-accuracy.md    # Judge: "Does this diff match the requested change?"
    │       ├── bug-localization.md # Judge: "Did the LLM correctly identify the bug?"
    │       └── causal-clarity.md   # Judge: "Is this explanation human-readable?"
    └── rubrics/
        ├── l0-contrastive.json     # Scoring rubric for Graph>Functions evals
        ├── l1-llm-dx.json          # Scoring rubric for LLM-DX evals
        └── l3-user-ux.json         # Scoring rubric for end-user comprehension
```

**Key design choices:**
- **Corpora are JSON arrays of task objects**, each with: `id`, `category`, `nl_description`, `expected_nodes` (count or names), `complexity` (low/medium/high), `tags`
- **Rubrics define LLM-judge assertions** — same pattern as Product-Manager-Platform evals: `{ "claim": "...", "weight": N }` so scoring is transparent and reproducible
- **Templates are markdown** (not code) — any LLM runner can consume them, not locked to a specific SDK

### TS repo (`~/src/graphrefly-ts`) — new `evals/` directory

```
~/src/graphrefly-ts/
├── src/                            # Library source (unchanged)
├── evals/                          ← NEW
│   ├── README.md                   # How to run evals, prerequisites, interpreting results
│   ├── tsconfig.json               # Separate TS config for eval code
│   ├── lib/
│   │   ├── runner.ts               # Core eval runner: load corpus → call LLM → validate → score
│   │   ├── llm-client.ts           # Thin LLM client wrapper (supports Claude, GPT-4o, Gemini)
│   │   ├── judge.ts                # LLM-as-judge: load rubric → evaluate output → score assertions
│   │   ├── validator.ts            # Runtime validation: validateSpec() + graphFromSpec() + execute
│   │   ├── contrastive.ts          # A/B runner: same task → two treatments → compare scores
│   │   ├── reporter.ts             # Aggregate results → JSON + markdown summary
│   │   └── types.ts                # Shared types: EvalTask, EvalResult, ScoreCard, etc.
│   ├── dev-dx/
│   │   ├── seeded-errors.test.ts   # Vitest: 10 common errors, assert message quality
│   │   └── hello-world-loc.test.ts # Vitest: assert quickstart LOC ≤ 10
│   ├── results/                    # Git-tracked results (one JSON per run)
│   │   ├── .gitkeep
│   │   └── README.md               # How results are versioned and compared
│   └── scripts/
│       ├── run-l0.ts               # `pnpm eval:contrastive` — Graph>Functions
│       ├── run-l1.ts               # `pnpm eval:llm-dx` — LLM composition accuracy
│       ├── run-all.ts              # `pnpm eval` — all automated evals
│       └── compare.ts              # `pnpm eval:compare <a.json> <b.json>` — diff two runs
```

### package.json scripts (graphrefly-ts)

```jsonc
{
  "scripts": {
    "eval": "tsx evals/scripts/run-all.ts",
    "eval:contrastive": "tsx evals/scripts/run-l0.ts",
    "eval:llm-dx": "tsx evals/scripts/run-l1.ts",
    "eval:compare": "tsx evals/scripts/compare.ts",
    "eval:dev-dx": "vitest run evals/dev-dx/"
  }
}
```

### Eval task schema (shared, lives in spec repo)

```jsonc
// ~/src/graphrefly/evals/schema/task.schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["id", "category", "nl_description"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "category": {
      "enum": ["linear", "fan-out", "fan-in", "diamond",
               "feedback-loop", "multi-source", "ambiguous",
               "stateful", "error-handling", "multi-step-effects"]
    },
    "nl_description": { "type": "string", "minLength": 10 },
    "expected_node_count": { "type": "integer", "minimum": 2 },
    "expected_node_names": {
      "type": "array", "items": { "type": "string" },
      "description": "Optional — soft match, not exact"
    },
    "complexity": { "enum": ["low", "medium", "high"] },
    "tags": { "type": "array", "items": { "type": "string" } },
    "contrastive": {
      "type": "object",
      "description": "Only for L0 tasks — defines the plain-function equivalent",
      "properties": {
        "expected_function_count": { "type": "integer" },
        "key_behaviors": {
          "type": "array", "items": { "type": "string" },
          "description": "Behaviors that both treatments must exhibit"
        }
      }
    }
  }
}
```

### Eval result schema (shared, lives in spec repo)

```jsonc
// ~/src/graphrefly/evals/schema/result.schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["run_id", "timestamp", "layer", "model", "scores", "tasks"],
  "properties": {
    "run_id": { "type": "string" },
    "timestamp": { "type": "string", "format": "date-time" },
    "layer": { "enum": ["L0", "L1", "L2", "L3"] },
    "model": { "type": "string", "description": "e.g. claude-sonnet-4-6" },
    "schema_version": { "type": "string", "description": "GraphSpec schema git SHA" },
    "scores": {
      "type": "object",
      "description": "Aggregate metric scores, e.g. { 'L0-M1': 0.73, 'L0-M2': 0.87 }"
    },
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "task_id": { "type": "string" },
          "treatment": { "enum": ["graphspec", "functions", "single"] },
          "raw_output": { "type": "string" },
          "valid": { "type": "boolean" },
          "runnable": { "type": "boolean" },
          "judge_scores": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "claim": { "type": "string" },
                "pass": { "type": "boolean" },
                "reasoning": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

### CI integration

```yaml
# .github/workflows/evals.yml (graphrefly-ts)
# Runs on: PRs that touch src/graph/graphspec*, evals/**, or GraphSpec schema
# Does NOT run on every PR — only schema-affecting changes

on:
  pull_request:
    paths:
      - 'src/graph/graphspec*'
      - 'src/graph/validate-spec*'
      - 'src/graph/from-spec*'
      - 'evals/**'

jobs:
  eval-regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: pnpm eval:dev-dx           # Fast: no LLM calls, vitest only
      - run: pnpm eval:llm-dx           # Slow: LLM calls, ~5 min
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - run: pnpm eval:compare evals/results/baseline.json evals/results/latest.json
      # Fail if any gated metric regresses by >5pp from baseline
```

---

## DEPENDENCY GRAPH

```
A1 ─┬─→ A2 ─→ A3 ─┬─→ B1  ─→ B3 ─→ B4 ─→ B5
    │              │    ↗
    ├─→ A4 ────────┤───┘
    ├─→ A5         │
    │              ├─→ B0-1 ─→ B0-4 ─→ B0-6  (contrastive, parallel with B1-B5)
    │              │   B0-2 ──┘↗
    │              │   B0-3 ──┘
    │              │   B0-5 ──────→ B0-4
    │              │
    └─→ A6 ────────┴──────────────→ D1 ─→ D2 ─→ D3 ─→ D4

C1 (independent, start anytime)
C2 ─→ C3 ─→ C4
E1 (after B3 + B0-4)
E2 (after B4 + B0-6 + C4 + D4)
```

**Critical paths (two, parallelizable):**
1. A1 → A2 → A3 → B1 → B3 → B4 → B5 (LLM-DX eval loop)
2. A1 → A2 → A3 → B0-1 → B0-4 → B0-6 (Graph>Functions contrastive)

---

## SUCCESS CRITERIA (GO/NO-GO FOR DEMO 0)

Demo 0 should proceed only when:

| Gate | Metric | Threshold |
|------|--------|-----------|
| G0 | L0-M1 (GraphSpec error rate ≤ 50% of plain functions) | Confirmed — this is the thesis validation |
| G1 | L1-M1 (zero-shot validity) | ≥ 80% |
| G2 | L1-M3 (diff accuracy) | ≥ 85% |
| G3 | L2-M2 (hello-world LOC) | ≤ 10 |
| G4 | L3-M1 (flow comprehension) | ≥ 70% |

**G0 is existential.** If Graph doesn't measurably beat plain functions for LLM composition, the audit's core thesis (Part 7) is unvalidated. G0 failing doesn't kill the project (other advantages remain — auditability, causal persistence) but it changes the positioning from "better for LLMs" to "better for humans auditing LLMs."

G1-G4 failing: root cause is likely schema complexity (simplify) or flow view design (iterate), not missing features.

---

## RELATION TO ROADMAP

| Roadmap phase | Items from this plan |
|---------------|---------------------|
| Phase 1 (Graph) | A1, A2, A3, A4, A5 — GraphSpec is a Graph-layer concern |
| Phase 4+ (Patterns) | A6, D1 — explainPath and flow view are pattern-layer APIs |
| Phase 7.3 (Demo 0) | D2 — the demo itself |
| New: Evals (cross-cutting) | B0-1 thru B0-6, B1-B5, C1-C4, D3-D4, E1-E2 |
| Spec repo (cross-language) | Corpora, schemas, templates, rubrics (B0-1, B0-2, B0-3, B0-5, B1, B2) |

---

## DECISIONS

1. **Adopt backward design** — all metrics derived from questions, not features.
2. **Graph > Functions contrastive eval is Gate 0** — existential thesis must be empirically validated before Demo 0.
3. **Two-repo eval architecture** — language-agnostic artifacts (corpora, rubrics, schemas) in spec repo; runtime harness in TS repo.
4. **Automated LLM evals as first-class CI** — schema changes must not regress L1-M1.
5. **User studies required before Demo 0 launch** — dev study (N=5-10) and end-user study (N=10-20).
6. **Go/no-go gates** — Demo 0 blocked until G0-G4 pass.
7. **Schema simplicity is the primary lever** — if L1-M1 < 80%, simplify schema before adding tooling.
8. **If G0 fails, reposition** — shift from "better for LLMs to compose" to "better for humans to audit LLM-composed systems." The audit's Parts 5, 8, 9 still hold even if Part 7 doesn't.

---

## EVAL EXECUTION — CONVERSATIONAL RUNS (April 4–5, 2026)

### Method

To avoid API costs, evals were run conversationally: Claude Opus 4.6 acted as both generator and judge within a single session. Results were recorded in structured JSON matching the result schema.

### L0 Batch 1 — Baseline (3 tasks × 2 treatments)

**Result:** `evals/results/l0-conversational-baseline.json`

| Metric | GraphSpec | Functions |
|--------|-----------|-----------|
| Error rate | 0% | 33% |
| Hallucination rate | 0% | 33% |
| All behaviors correct | 100% | 100% |
| Bug visibility | 100% | 67% |

Key findings:
- GraphSpec: 0 hallucinated references (catalog constraint effective)
- Functions: hallucinated `validateSchema`/`normalizeFields` not in declared utils
- GraphSpec bugs are structural and visible in topology; functions bugs are behavioral and hidden in logic
- Both treatments correct for simple tasks; divergence at medium/high complexity

### L0 Batch 2 — Catalog Stress (3 tasks × 2 treatments)

**Result:** `evals/results/l0-conversational-batch2.json`

| Metric | GraphSpec | Functions |
|--------|-----------|-----------|
| All behaviors | 83% | 100% |
| Bug visibility | 100% | 67% |
| Reactivity advantage | 33% (1 of 3 tasks) | — |

Key findings:
- Fan-in (patient summary): GraphSpec naturally reactive, functions one-shot — strongest case for GraphReFly
- Fan-out (email classify): both treatments had bugs — GraphSpec missing filter, functions had mutable globals
- Error handling (retry/fallback): **GraphSpec exposed catalog gap** — `retry` fn has nothing to retry
- Functions produced more complete error-handling code (inline retry loop, backoff, logging)

### L1 Batch 1 — Zero-Shot Composition (5 tasks, GraphSpec only)

**Result:** `evals/results/l1-conversational-batch1.json`

| Metric | Score | Target |
|--------|-------|--------|
| Structural validity | 100% | ≥ 80% ✓ |
| Hallucination rate | 0% | ≤ 5% ✓ |
| Semantic pass (all behaviors) | 60% | — |

Key findings:
- 5/5 structurally valid (exceeds G1 gate target)
- 0/5 hallucinated (well under target)
- 3/5 semantically complete
- 1/5 partial: feedback loop not closable with current schema
- Ambiguous input ("do something with my emails") handled gracefully

### Bias Correction

**Problem identified:** L0 batch 1–2 judging criteria smuggled GraphReFly design invariants as universal virtues:

| Biased criterion | Why it's unfair |
|-----------------|-----------------|
| "Reactive: updates when sources change" | Penalizes correct one-shot implementations |
| "Mutable global state" as a bug | Standard JS/TS pattern |
| "setTimeout" as a violation | Perfectly valid in plain TypeScript |
| "Not reactive" as a failure | Task didn't always require persistent reactivity |

**Fix:** Created `evals/portable-eval-prompts.md` — self-contained prompts for copy-paste into any AI (Claude web, ChatGPT, Gemini) with a neutral 5-criterion rubric:

1. **Valid output** — structurally correct JSON/TypeScript
2. **Task completion** — accomplishes all parts of the task
3. **No hallucinated references** — all fn/source refs exist in catalog
4. **No logical bugs** — produces correct results if executed
5. **Completeness** — all described behaviors present

Explicitly does NOT penalize: mutable state, setTimeout/setInterval, one-shot functions, lack of reactivity.

### Root Cause Analysis — Schema Expressiveness Gaps

**Full analysis:** `evals/results/eval-analysis.md`

#### Feedback loops — LIBRARY PROBLEM (schema gap)

GraphSpec has `graph.set(name, value)` in imperative code but no declarative way to express "this effect writes back to a state node."

**Recommendation:** Add `writes` field to effect/derived nodes:
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

This is a **spec change**, not a catalog fix. Needs RFC.

#### Error handling — BOTH library + catalog problem

1. **Catalog gap:** `retry` fn needs `config.fn` to know what to retry. Fix: update catalog entry.
2. **Schema gap:** GraphSpec can't express `pipe()` or composition operators. No way to say "retry(fetchPrice)."

**Recommendation:** Add `wrappers` array for resilience composition:
```json
"fetchPrice": {
  "type": "derived",
  "deps": ["trigger"],
  "fn": "fetchFromApi",
  "wrappers": ["retry:3:exponential", "fallback:cached"]
}
```

### Summary Table

| Finding | Root cause | Fix type | Status |
|---------|-----------|----------|--------|
| Hallucination rate lower in GraphSpec | Catalog constraint works | Validated | ✓ |
| Feedback loops not expressible | Schema gap — no `writes` field | Spec change needed | Pending |
| Retry/fallback incomplete | Catalog gap + schema gap | Catalog fix + optional `wrappers` | Pending |
| Judging criteria biased | Rubric smuggled design invariants | Fixed in portable eval | ✓ |
| Both treatments equal on simple tasks | Expected | N/A | Confirmed |

### Next Steps

1. Run portable eval across 3+ AIs with neutral rubric — get unbiased cross-AI baseline
2. Propose `writes` field for GraphSpec feedback loops (spec RFC)
3. Fix `retry` catalog entry to require `config.fn`
4. Consider `wrappers` array for resilience composition
5. Re-run evals after fixes to measure improvement on Task 5 (error handling) and Task 6 (feedback loop)

---

## UPDATED DECISIONS

*(additions to original decisions)*

9. **Conversational evals are a valid low-cost method** — same model acting as generator + judge produces structurally useful data for schema iteration, though cross-AI portable evals needed for unbiased comparison.
10. **Neutral rubric is mandatory** — never score on reactivity, mutable state avoidance, or other framework-specific philosophy. Only score on validity, completeness, hallucination, bugs, task completion.
11. **Two spec-level gaps discovered** — `writes` field (feedback loops) and `wrappers` array (resilience composition) are schema expressiveness problems, not documentation problems. Both need spec-level proposals before catalog fixes alone can close the gap.

---

## FILES CHANGED

- This file created and updated: `archive/docs/SESSION-dxux-benchmarks.md`
- `evals/results/l0-conversational-baseline.json` — L0 batch 1 results
- `evals/results/l0-conversational-batch2.json` — L0 batch 2 results
- `evals/results/l1-conversational-batch1.json` — L1 batch 1 results
- `evals/results/eval-analysis.md` — Honest bias and root-cause analysis
- `evals/portable-eval-prompts.md` — Neutral cross-AI eval prompts
- `evals/dev-dx/seeded-errors.test.ts` — 10 dev-DX error tests (passing)
- `evals/vitest.config.ts` — Separate vitest config for eval tests
- `evals/lib/*.ts` — Eval harness (types, llm-client, judge, validator, contrastive, runner, reporter)
- `evals/scripts/*.ts` — CLI entry points (run-l0, run-l1, run-all, compare)
- `package.json` — Added eval scripts and dev dependencies (@anthropic-ai/sdk, tsx)

---END SESSION---
