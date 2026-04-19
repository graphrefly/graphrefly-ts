# How to Run a GraphReFly Eval

One-pager for contributors and blog readers.

> **Before any paid run:** follow the pre-flight ladder in [CHEAP-AND-SAFE.md](CHEAP-AND-SAFE.md). The default budget cap is `$2 / 100 calls`, but the USD cap only trips for models in the local pricing table — for OpenRouter routes and preview models, rely on `EVAL_MAX_CALLS`. The safe habit is `EVAL_MODE=dry-run` first, then a single task at `$0.10` ceiling, then full corpus.

---

## What are the evals?

GraphReFly evals measure how well LLMs can **compose** (L0) and **comprehend** (L1) reactive graph specifications.

| Tier | Question | Method |
|------|----------|--------|
| **L0 — Generation** | Can the LLM create a correct graph from natural language? | Contrastive: GraphSpec vs plain Functions (same 12 tasks, both treatments) |
| **L1 — Generation** | NL → GraphSpec zero-shot composition accuracy | GraphSpec only (from spec corpus) |
| **L1 — Comprehension** | Can the LLM understand, debug, modify, and explain an existing graph? | Modification + bug-finding tasks |
| **Dev-DX** | Are error messages helpful for developers? | Vitest suite — no LLM calls |

## Option A: Manual eval (free, any AI)

No API keys. No setup. Works with Claude, ChatGPT, Gemini, or any LLM.

1. Open `evals/portable-eval-prompts.md`
2. Copy the **system context** for Treatment A (GraphSpec) into a fresh AI conversation
3. Copy one **task prompt** (e.g., Task 1) into the same conversation
4. Record the AI's output verbatim
5. Repeat step 3 for each task (or start fresh conversations for independence)
6. Repeat steps 2-5 with Treatment B (Functions) for contrastive comparison
7. For L1: paste the system context + a given graph + the L1 task prompt
8. Score all outputs using the rubrics in the same file

**Scoring cheat sheet:**

| L0 Criterion | What to check |
|---|---|
| C1 Valid output | Is the JSON/TypeScript syntactically correct? |
| C2 Task completion | Does it do ALL parts of the task? |
| C3 No hallucination | Does every fn/source reference exist in the catalog? |
| C4 No bugs | Would it produce correct results if run? |
| C5 Completeness | behaviors_implemented / behaviors_described |

| L1 Criterion | What to check |
|---|---|
| D1 Accurate reading | Does the LLM understand the graph structure correctly? |
| D2 Complete identification | Did it find ALL bugs / trace ALL affected nodes? |
| D3 Correct fix | Is the proposed change valid GraphSpec JSON? |
| D4 Minimal diff | Did it avoid unnecessary restructuring? |
| D5 Reasoning quality | Does it reference actual node names and data flow? |

## Option B: Automated eval (needs API key)

Requires at least one API key for the provider you want to use.

```bash
# Run all evals (L0 + L1 generation + L1 comprehension)
pnpm eval

# Run L0 contrastive eval (GraphSpec vs Functions)
pnpm eval:contrastive

# Run L1 evals (generation + comprehension)
pnpm eval:llm-dx

# Run multi-model matrix eval
pnpm eval:matrix

# Generate publishable scorecard
pnpm eval:scorecard

# Run Dev-DX tests (no LLM, no API key needed)
pnpm eval:dev-dx

# Compare two result files for regressions
pnpm eval:compare evals/results/baseline.json evals/results/current.json
```

**Providers:** The eval system supports six LLM providers. Set `EVAL_PROVIDER` to switch.

| Provider | Env var | SDK | Budget models | Publish models |
|---|---|---|---|---|
| `anthropic` (default) | `ANTHROPIC_API_KEY` | `@anthropic-ai/sdk` | Haiku 4.5 | Sonnet 4.6 / Opus 4.6 |
| `openai` | `OPENAI_API_KEY` | `openai` | gpt-5.4-mini | gpt-5.4 / gpt-4.1 |
| `google` | `GOOGLE_API_KEY` | `@google/genai` | gemini-3-flash-preview | gemini-3.1-pro-preview |
| `ollama` | — | `openai` (Ollama) | Gemma 4 E4B | Gemma 4 26B |
| `openrouter` | `OPENROUTER_API_KEY` | `openai` | free router / :free models | paid routed models |
| `groq` | `GROQ_API_KEY` | `openai` | gpt-oss-20b / llama-class budget | faster larger OSS models |

**Configuration (env vars):**

| Variable | Default | Purpose |
|---|---|---|
| `EVAL_PROVIDER` | `anthropic` | LLM provider |
| `EVAL_MODEL` | `claude-sonnet-4-6` | Model for generation tasks |
| `EVAL_JUDGE_PROVIDER` | `anthropic` | Provider for judge model (can differ from EVAL_PROVIDER) |
| `EVAL_JUDGE_MODEL` | `claude-sonnet-4-6` | Model for LLM-as-judge scoring |
| `EVAL_MODELS` | — | Comma-separated model list for matrix runs |
| `EVAL_PROVIDERS` | — | Comma-separated provider per model (for matrix) |
| `EVAL_OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Base URL for Ollama provider |
| `EVAL_OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Base URL override for OpenRouter provider |
| `EVAL_GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Base URL override for Groq provider |
| `SPEC_EVALS_PATH` | `~/src/graphrefly/evals` | Path to spec repo eval corpus |

Results are written to `evals/results/` as timestamped JSON files.
Scorecards are written to `evals/scorecard/latest.{json,md}`.

**Multi-model matrix example:**

```bash
# Run across three providers
EVAL_MODELS="claude-sonnet-4-6,gpt-5.4-mini,gemma4:26b" \
EVAL_PROVIDERS="anthropic,openai,ollama" \
pnpm eval:matrix

# Local only — free, no API keys
EVAL_MODELS="gemma4:26b" EVAL_PROVIDERS="ollama" pnpm eval:matrix

# OpenRouter free router
EVAL_PROVIDER=openrouter EVAL_MODEL=openrouter/free pnpm eval

# Groq budget model
EVAL_PROVIDER=groq EVAL_MODEL=openai/gpt-oss-20b pnpm eval
```

## Option B2: Running with Ollama (free)

No API keys needed. All eval tiers (L0, L1) work with Ollama models — the only
difference vs cloud models is output quality. Great for development iteration
and cost-free experimentation.

### Prerequisites

1. Install [Ollama](https://ollama.com)
2. Pull a model:

```bash
# Recommended for 32GB Apple Silicon:
ollama pull gemma4:26b      # Best quality that fits in 32GB (Q4 quant, ~18GB)

# Faster alternative for quick iteration:
ollama pull gemma4:e4b      # Snappier, leaves more RAM headroom
```

3. Start the Ollama server (it runs automatically after install, or run `ollama serve`)

### Model recommendations by hardware

| RAM | Chip | Recommended model | Notes |
|-----|------|-------------------|-------|
| 32GB | M1/M2/M3/M4 Pro | **`gemma4:26b`** | Best quality that fits — ~18GB with Q4 quant, ~14GB left for OS |
| 32GB | M1/M2/M3/M4 Pro | `gemma4:e4b` | Faster, good for dev iteration |
| 16GB | M1/M2 base | `gemma4:e4b` | 26B won't fit comfortably |
| 64GB+ | M-series Max/Ultra | `gemma4:26b` or `qwen3:32b` | Plenty of headroom |

### Running evals

```bash
# Single model — run all tiers
EVAL_PROVIDER=ollama EVAL_MODEL=gemma4:26b pnpm eval

# Just L0 contrastive
EVAL_PROVIDER=ollama EVAL_MODEL=gemma4:26b pnpm eval:contrastive

# Just L1 (generation + comprehension)
EVAL_PROVIDER=ollama EVAL_MODEL=gemma4:26b pnpm eval:llm-dx

# Matrix: ollama + cloud comparison
EVAL_MODELS="gemma4:26b,claude-sonnet-4-6" \
EVAL_PROVIDERS="ollama,anthropic" \
pnpm eval:matrix
```

### Custom Ollama endpoint

If Ollama runs on a different host/port:

```bash
EVAL_OLLAMA_BASE_URL=http://192.168.1.100:11434/v1 \
EVAL_PROVIDER=ollama \
EVAL_MODEL=gemma4:26b \
pnpm eval
```

### What to expect

- **Speed:** ~2-5x slower than cloud APIs on M1 Pro. Budget 10-30 min for a full run.
- **Quality:** Ollama 26B models score lower than Sonnet/GPT-4.1 on structured JSON output,
  but the eval harness handles this gracefully (invalid outputs are scored, not crashed).
- **Cost:** $0. Token counts are tracked but cost is reported as $0.00 for Ollama models.
- **Judge model:** By default the same Ollama model judges its own output. For higher-quality
  scoring, use a cloud judge: `EVAL_JUDGE_MODEL=claude-sonnet-4-6 EVAL_PROVIDER=ollama EVAL_MODEL=gemma4:26b pnpm eval`
  (requires `ANTHROPIC_API_KEY` for the judge).

---

## Option C: Reproduce our published results

To verify the numbers in our blog posts:

1. Clone the repo
2. Set the API key(s) for the provider(s) you want
3. Run `pnpm eval` (or `pnpm eval:matrix` for multi-model)
4. Compare with `pnpm eval:compare evals/results/<our-baseline>.json evals/results/<your-run>.json`
5. Run `pnpm eval:scorecard` to see the aggregate view

The portable prompts in `evals/portable-eval-prompts.md` are **model-neutral** — no GraphReFly context is baked in. You can verify our claims with any AI.

## What the evals found

Our eval→fix→re-eval loop discovered real schema gaps:

1. **Feedback loops (T6):** LLMs couldn't express "output feeds back as input" — we added `feedback` edges to GraphSpec
2. **Subgraph templates (T8a):** Per-source resilience stacks were duplicated — we added `templates` for reusable patterns
3. **Resilience catalog (T5):** Missing `fallback`, `cache`, `timeout` — we added them

This loop is the publishable story: evals find gaps, we fix the schema, re-eval improves.

## CI Integration

The `eval.yml` GitHub Action runs weekly (Monday 6am UTC) and on manual dispatch. It:
1. Runs the matrix eval across configured models
2. Generates the scorecard
3. Runs the regression gate (fails if validity drops >5%)
4. Commits results to `evals/results/`
