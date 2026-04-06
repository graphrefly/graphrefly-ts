# GraphReFly-TS Evals — Runtime Harness

This directory contains the TypeScript eval runner for GraphReFly benchmarks.

Language-agnostic artifacts (corpora, schemas, rubrics, templates) live in the
spec repo at `~/src/graphrefly/evals/`.

## Eval tiers

### L0 — Generation (Graph > Functions contrastive)

Can an LLM compose a correct graph/pipeline from a natural-language description?
Two treatments: GraphSpec (declarative JSON) vs plain TypeScript functions. 9 tasks
(T1–T7 + T8a/T8b) scored on validity, completion, hallucination, bugs, completeness.

### L1 — Comprehension (debug / modify / explain)

Can an LLM understand, modify, and reason about an *existing* GraphSpec? 6 tasks:
explain a path, find bugs, add a feature, review a diff, assess blast radius,
retrofit resilience. GraphSpec-only (no Functions treatment — tests introspection
advantages). Scored on accurate reading, complete identification, correct fix,
minimal diff, reasoning quality.

Both tiers use portable copy-paste prompts (`portable-eval-prompts.md`) — no
project context, any AI model, unbiased.

## Quick start

```bash
# Run all automated evals (requires ANTHROPIC_API_KEY)
pnpm eval

# Run only the Graph>Functions contrastive eval (L0)
pnpm eval:contrastive

# Run only the LLM-DX composition eval (L1)
pnpm eval:llm-dx

# Run dev-DX tests (no LLM calls — vitest)
pnpm eval:dev-dx

# Compare two eval runs
pnpm eval:compare evals/results/run-a.json evals/results/run-b.json
```

## Structure

```
evals/
├── portable-eval-prompts.md   L0 + L1 copy-paste prompts and rubrics
├── lib/           Core eval infrastructure
│   ├── types.ts       Shared type definitions
│   ├── llm-client.ts  Thin LLM client wrapper
│   ├── judge.ts       LLM-as-judge scoring
│   ├── validator.ts   Runtime validation (validateSpec + graphFromSpec)
│   ├── contrastive.ts A/B runner for Graph>Functions evals
│   ├── reporter.ts    Result aggregation and formatting
│   └── runner.ts      Core eval orchestrator
├── dev-dx/        Vitest suites for developer experience
├── scripts/       CLI entry points
└── results/       Git-tracked eval results (one file per run)
```

## Results

| Run | Date | Model | L0 Tasks | Key findings |
|-----|------|-------|----------|-------------|
| [Run 1](results/claude-web-2026-04-05.md) | 2026-04-05 | Claude (web) | T1–T7 | Functions won; GraphSpec hallucination on T5/T6 (missing catalog entries) |
| [Run 2](results/claude-web-2026-04-05-run2.md) | 2026-04-05 | Claude (web) | T1–T8 | Tie after catalog update; feedback loops (T6) and per-branch resilience (T8) confirmed as schema gaps |

Analysis: [eval-analysis.md](results/eval-analysis.md)

## Key schema gaps identified by evals

Both gaps are addressed in roadmap §8.3 (GraphSpec schema):

1. **Feedback loops (T6):** GraphSpec needs `"feedback"` edges to express bounded cycles. Runtime: §8.1 `feedback()`. No `writeTo` field — that's just `graph.set()` renamed.
2. **Subgraph templates (T8a):** GraphSpec needs `"templates"` for reusable subgraph patterns. Runtime: `graph.mount()`. Without templates, LLMs duplicate or incorrectly share resilience stacks.

## Adding evals

1. Add tasks to the corpus in the spec repo (`~/src/graphrefly/evals/corpus/`)
2. If needed, add judge prompts in the spec repo (`~/src/graphrefly/evals/templates/judge-prompts/`)
3. The runner here automatically picks up new corpus entries

## Environment variables

- `ANTHROPIC_API_KEY` — required for LLM evals
- `EVAL_MODEL` — model to evaluate (default: `claude-sonnet-4-6`)
- `EVAL_JUDGE_MODEL` — model for LLM judge (default: `claude-sonnet-4-6`)
- `SPEC_EVALS_PATH` — path to spec repo evals (default: `~/src/graphrefly/evals`)
