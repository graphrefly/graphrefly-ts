# GraphReFly-TS Evals — Runtime Harness

This directory contains the TypeScript eval runner for GraphReFly benchmarks.

Language-agnostic artifacts (corpora, schemas, rubrics, templates) live in the
spec repo at `~/src/graphrefly/evals/`.

## Eval tiers

### L0 — Generation (Graph > Functions contrastive)

Can an LLM compose a correct graph/pipeline from a natural-language description?
Two treatments: GraphSpec (declarative JSON) vs plain TypeScript functions. 9 tasks
(T1–T7 + T8a/T8b) scored on validity, completion, hallucination, bugs, completeness.

### L1 — Generation (NL → GraphSpec)

Zero-shot composition accuracy: NL description → valid, runnable GraphSpec.
Uses real `validateSpec()` and `compileSpec()` from `src/patterns/graphspec.ts`.

### L1 — Comprehension (debug / modify / explain)

Can an LLM understand, modify, and reason about an *existing* GraphSpec?
Modification tasks (nl-mod corpus) and bug-finding tasks (contrastive-bugs corpus).

### Dev-DX — Error quality

Vitest suite — no LLM calls. Validates that `validateSpec()` produces actionable
error messages for common developer mistakes.

## Providers

| Provider | SDK | Budget tier | Publish tier |
|---|---|---|---|
| `anthropic` (default) | `@anthropic-ai/sdk` | Haiku 4.5 | Sonnet/Opus 4.6 |
| `openai` | `openai` | GPT-4o-mini | GPT-4o / GPT-4.1 |
| `google` | `@google/genai` | Gemini 3 Flash Preview | Gemini 3.1 Pro Preview |
| `ollama` | `openai` (Ollama) | Gemma 4 27B | — |
| `openrouter` | `openai` | `openrouter/free` or `:free` models | paid routed models |
| `groq` | `openai` | GPT-OSS 20B / smaller Llama-family | larger/faster OSS models |

Set `EVAL_PROVIDER` to switch. SDKs are dynamically imported — only install what you use.

## Quick start

```bash
# Run all automated evals (requires API key for chosen provider)
pnpm eval

# Run only the Graph>Functions contrastive eval (L0)
pnpm eval:contrastive

# Run L1 evals (generation + comprehension)
pnpm eval:llm-dx

# Run multi-model matrix eval
pnpm eval:matrix

# Generate publishable scorecard
pnpm eval:scorecard

# Run dev-DX tests (no LLM calls — vitest)
pnpm eval:dev-dx

# Compare two eval runs
pnpm eval:compare evals/results/run-a.json evals/results/run-b.json
```

## Structure

```
evals/
├── portable-eval-prompts.md   L0 + L1 copy-paste prompts and rubrics
├── HOW-TO-EVAL.md             One-pager for running evals
├── lib/                       Core eval infrastructure
│   ├── types.ts               Shared type definitions
│   ├── llm-client.ts          Multi-provider LLM client
│   ├── cost.ts                Token → USD cost estimation
│   ├── judge.ts               LLM-as-judge scoring
│   ├── validator.ts           Wired to real validateSpec + compileSpec
│   ├── contrastive.ts         A/B runner for Graph>Functions evals
│   ├── harness-metrics.ts     KPI computation from run data
│   ├── reporter.ts            Result aggregation and formatting
│   └── runner.ts              Core eval orchestrator (generation + comprehension)
├── dev-dx/                    Vitest suites for developer experience
├── scripts/                   CLI entry points
│   ├── run-all.ts             pnpm eval
│   ├── run-l0.ts              pnpm eval:contrastive
│   ├── run-l1.ts              pnpm eval:llm-dx
│   ├── run-matrix.ts          pnpm eval:matrix
│   ├── publish-scorecard.ts   pnpm eval:scorecard
│   └── compare.ts             pnpm eval:compare
├── scorecard/                 Generated scorecard (latest.json + latest.md)
└── results/                   Git-tracked eval results (one file per run)
```

## Results

| Run | Date | Model | Key findings |
|-----|------|-------|-------------|
| [Run 1](results/claude-web-2026-04-05.md) | 2026-04-05 | Claude (web) | Functions won; GraphSpec hallucination on T5/T6 |
| [Run 2](results/claude-web-2026-04-05-run2.md) | 2026-04-05 | Claude (web) | Tie after catalog update; feedback/resilience gaps confirmed |

Analysis: [eval-analysis.md](results/eval-analysis.md)

## Adding evals

1. Add tasks to the corpus in the spec repo (`~/src/graphrefly/evals/corpus/`)
2. If needed, add judge prompts in the spec repo (`~/src/graphrefly/evals/templates/judge-prompts/`)
3. The runner here automatically picks up new corpus entries

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `EVAL_PROVIDER` | `anthropic` | LLM provider |
| `EVAL_MODEL` | `claude-sonnet-4-6` | Model for generation |
| `EVAL_JUDGE_MODEL` | `claude-sonnet-4-6` | Model for LLM judge |
| `EVAL_MODELS` | — | Comma-separated for matrix runs |
| `EVAL_PROVIDERS` | — | Provider per model (matrix) |
| `EVAL_OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama endpoint |
| `EVAL_OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter endpoint override |
| `EVAL_GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Groq endpoint override |
| `SPEC_EVALS_PATH` | `~/src/graphrefly/evals` | Spec repo evals path |
| `EVAL_L0_FROM` | — | L0 only: task id to start at (inclusive); set only one of this or `EVAL_L0_AFTER` |
| `EVAL_L0_AFTER` | — | L0 only: task id to resume after (exclusive); set only one of this or `EVAL_L0_FROM` |
| `ANTHROPIC_API_KEY` | — | Anthropic provider |
| `OPENAI_API_KEY` | — | OpenAI provider |
| `GOOGLE_API_KEY` | — | Google provider |
| `OPENROUTER_API_KEY` | — | OpenRouter provider |
| `GROQ_API_KEY` | — | Groq provider |
