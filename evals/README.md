# GraphReFly-TS Evals — Runtime Harness

This directory contains the TypeScript eval runner for GraphReFly benchmarks.

Language-agnostic artifacts (corpora, schemas, rubrics, templates) live in the
spec repo at `~/src/graphrefly/evals/`.

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
└── results/       Git-tracked eval results (one JSON per run)
```

## Adding evals

1. Add tasks to the corpus in the spec repo (`~/src/graphrefly/evals/corpus/`)
2. If needed, add judge prompts in the spec repo (`~/src/graphrefly/evals/templates/judge-prompts/`)
3. The runner here automatically picks up new corpus entries

## Environment variables

- `ANTHROPIC_API_KEY` — required for LLM evals
- `EVAL_MODEL` — model to evaluate (default: `claude-sonnet-4-6`)
- `EVAL_JUDGE_MODEL` — model for LLM judge (default: `claude-sonnet-4-6`)
- `SPEC_EVALS_PATH` — path to spec repo evals (default: `~/src/graphrefly/evals`)
