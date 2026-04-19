# Cheap & Safe Eval Runs

Reference doc for running GraphReFly evals without surprise bills.

Open this **before** any paid LLM call. The default budget cap is **$2 / 100 calls** with replay cache on, but the cap only trips for models in the local pricing table at [evals/lib/cost.ts](lib/cost.ts) — for unknown models (most OpenRouter routes), `EVAL_MAX_CALLS` is your only real ceiling. See "USD-cap gotcha" below.

---

## Pre-flight ladder (mandatory, in order)

### Step 1 — Dry run (zero cost, no API key)

```bash
EVAL_MODE=dry-run pnpm eval:contrastive
EVAL_MODE=dry-run pnpm eval                  # all tiers
```

Prints every call that *would* have been made. Catches infinite loops, unexpected fan-out, and prompt bloat before you spend a cent. Implementation: [evals/lib/dry-run-provider.ts](lib/dry-run-provider.ts).

### Step 2 — Local Ollama (zero cost, slower)

```bash
EVAL_PROVIDER=ollama EVAL_MODEL=gemma4:e4b pnpm eval:contrastive
```

Validates the full pipeline end-to-end against a real LLM. Quality is lower than cloud, but the harness itself is exercised. See [HOW-TO-EVAL.md](HOW-TO-EVAL.md) "Option B2" for Ollama setup.

### Step 3 — First paid pass: tight caps + write-only cache + single task

```bash
EVAL_REPLAY=write-only \
EVAL_MAX_CALLS=10 \
EVAL_MAX_PRICE_USD=0.10 \
EVAL_L0_FROM=linear-rss-filter-notify \
EVAL_PROVIDER=google EVAL_MODEL=gemini-2.0-flash \
pnpm eval:contrastive
```

Run **one task only** with a $0.10 ceiling. `BudgetExceededError` halts the pipeline — no surprise bills. `write-only` forces fresh calls so the cache gets populated for Step 4.

### Step 4 — Full corpus, replay cache enabled (default)

```bash
EVAL_MAX_CALLS=200 \
EVAL_PROVIDER=google EVAL_MODEL=gemini-2.0-flash \
pnpm eval:contrastive
```

`EVAL_REPLAY=read-write` is the default. Reruns return cached responses in 0ms for $0 — only changed prompts incur cost. **Bump `EVAL_MAX_CALLS=200`** because the full L0 corpus needs ~120-150 calls (12 tasks × 2 treatments × ~5 calls each) — the default `100` trips the budget gate mid-corpus.

### Resume across multiple invocations (incremental cost-controlled run)

If you'd rather keep `EVAL_MAX_CALLS=100` and split the corpus across two or more invocations, set a stable `EVAL_RUN_ID` so each run **merges into the same result file** instead of writing siloed partials.

```bash
# Run 1 — first slice (caps at 100 calls, ~5-6 tasks)
EVAL_RUN_ID=l0-glm-trial1 \
EVAL_MAX_CALLS=100 \
EVAL_TREATMENT=B \
EVAL_PROVIDER=openrouter EVAL_MODEL=z-ai/glm-4.7 \
pnpm eval:contrastive

# Run 2 — pick up where Run 1 stopped
EVAL_RUN_ID=l0-glm-trial1 \
EVAL_MAX_CALLS=100 \
EVAL_L0_AFTER=<last-completed-task-id> \
EVAL_TREATMENT=B \
EVAL_PROVIDER=openrouter EVAL_MODEL=z-ai/glm-4.7 \
pnpm eval:contrastive
```

The writer dedupes by `task_id+treatment` (last write wins), recomputes scores over the merged set, and sums costs / rate-limit totals. **Without `EVAL_RUN_ID` each invocation gets a fresh `l0-<timestamp>` filename — partial files don't merge automatically.** A run-id mismatch on an existing file throws (no silent overwrite).

### CI-friendly: read-only (fail loud on cache miss)

```bash
EVAL_REPLAY=read-only pnpm eval:contrastive
```

Useful in CI where you want runs to fail rather than silently incur cost when the cache is incomplete.

---

## Safety env vars

| Var | Default | Purpose |
|---|---|---|
| `EVAL_MODE` | `real` | Set to `dry-run` for zero-cost validation |
| `EVAL_MAX_CALLS` | `100` | Hard cap on total LLM calls (always works) |
| `EVAL_MAX_PRICE_USD` | `2` | Hard cap on USD spend (only trips for models in the pricing table) |
| `EVAL_MAX_INPUT_TOKENS` | — | Optional input-token cap (always works) |
| `EVAL_MAX_OUTPUT_TOKENS` | — | Optional output-token cap (always works) |
| `EVAL_REPLAY` | `read-write` | `read-write` \| `read-only` \| `write-only` \| `off` |
| `EVAL_L0_FROM` | — | Run L0 starting from this task id (slice corpus head) |
| `EVAL_L0_AFTER` | — | Run L0 starting after this task id (resume) |
| `EVAL_RUN_ID` | — | Stable run id for incremental runs. Reuses the existing `<id>.json` and **merges** new task results into it (dedupe by task_id+treatment). Required when splitting one logical run across multiple invocations. |

Replay cache lives at `evals/results/replay-cache/`. Safe to delete to force fresh calls. Wrapping order is **cache outside budget** — cache hits never count toward `EVAL_MAX_PRICE_USD`. See [evals/lib/llm-client.ts:281](lib/llm-client.ts) (`createSafeProvider`).

---

## USD-cap gotcha (read this)

The budget gate at [evals/lib/budget-gate.ts:122](lib/budget-gate.ts) computes spend by calling `estimateTokenCost(input, output, model)`. That function at [evals/lib/cost.ts:34](lib/cost.ts) looks up the model in a hardcoded table and **returns 0 for any model not listed**.

So if you set `EVAL_MAX_PRICE_USD=0.50` and run a model that's not in the table:

1. Every call adds `+0` to the recorded spend
2. Recorded spend stays at `$0.0000` forever
3. The `>= maxPriceUsd` check never trips
4. Your dollar cap is silently infinite

**Always-working caps** (don't depend on the pricing table):
- `EVAL_MAX_CALLS`
- `EVAL_MAX_INPUT_TOKENS`
- `EVAL_MAX_OUTPUT_TOKENS`

**Best-effort cap** (depends on the pricing table):
- `EVAL_MAX_PRICE_USD`

For OpenRouter routes and preview models, **trust `EVAL_MAX_CALLS`, not `EVAL_MAX_PRICE_USD`**. To make the USD cap reliable for a new model, add a row to [evals/lib/cost.ts](lib/cost.ts) — the pricing table is short by design (~20 models). Use `loadLiteLLMPricing()` (future, not built) if you need exhaustive coverage.

---

## Cheap-model presets

Sorted by approximate input price ($/1M tokens). Output price typically 3-4x input.

### Tier 0 — Free (no API key)

```bash
# Local Ollama (slowest, install from ollama.com first)
EVAL_PROVIDER=ollama EVAL_MODEL=gemma4:e4b pnpm eval

# OpenRouter free routes (rate-limited, quality varies)
EVAL_PROVIDER=openrouter EVAL_MODEL=meta-llama/llama-3.3-70b-instruct:free pnpm eval
EVAL_PROVIDER=openrouter EVAL_MODEL=z-ai/glm-4.6:free pnpm eval
EVAL_PROVIDER=openrouter EVAL_MODEL=deepseek/deepseek-chat-v3.1:free pnpm eval
```

### Tier 1 — Ultra-cheap paid ($0.08–$0.20 / 1M input)

```bash
# OpenRouter / Chutes (open-weight models routed via decentralized GPU)
EVAL_PROVIDER=openrouter EVAL_MODEL=qwen/qwen3-32b pnpm eval                        # $0.08 / $0.24
EVAL_PROVIDER=openrouter EVAL_MODEL=xiaomi/mimo-v2-flash pnpm eval                  # $0.09 / $0.29
EVAL_PROVIDER=openrouter EVAL_MODEL=minimax/minimax-m2.5 pnpm eval                  # $0.118 / $0.99

# Google Gemini Flash family
EVAL_PROVIDER=google EVAL_MODEL=gemini-2.0-flash pnpm eval                          # $0.10 / $0.40
EVAL_PROVIDER=google EVAL_MODEL=gemini-2.5-flash pnpm eval                          # $0.15 / $0.60
EVAL_PROVIDER=google EVAL_MODEL=gemini-3-flash-preview pnpm eval                    # verify pricing on console

# OpenAI nano / mini family
EVAL_PROVIDER=openai EVAL_MODEL=gpt-4.1-nano pnpm eval                              # $0.10 / $0.40
EVAL_PROVIDER=openai EVAL_MODEL=gpt-4o-mini pnpm eval                               # $0.15 / $0.60
```

### Tier 2 — Cheap with strong quality ($0.27–$0.40 / 1M input)

The sweet spot for L0 contrastive runs — capable enough for structured GraphSpec output without burning much.

```bash
# DeepSeek V3.2 — best output price on Chutes; strong on structured output
EVAL_PROVIDER=openrouter EVAL_MODEL=deepseek/deepseek-v3.2 pnpm eval                # $0.28 / $0.42

# DeepSeek Chat V3.1 — established workhorse
EVAL_PROVIDER=openrouter EVAL_MODEL=deepseek/deepseek-chat-v3.1 pnpm eval           # $0.27 / $1.00

# Z.AI GLM 4.7 — same family as GLM 5.1, ~60% cheaper
EVAL_PROVIDER=openrouter EVAL_MODEL=z-ai/glm-4.7 pnpm eval                          # $0.39 / $1.75

# Moonshot Kimi K2.5 — strong reasoning, similar price to GLM 4.7
EVAL_PROVIDER=openrouter EVAL_MODEL=moonshotai/kimi-k2.5 pnpm eval                  # $0.38 / $1.72

# OpenAI GPT-4.1-mini
EVAL_PROVIDER=openai EVAL_MODEL=gpt-4.1-mini pnpm eval                              # $0.40 / $1.60
```

### Tier 3 — Mid-range (~$0.80–$1.00 / 1M input)

```bash
# Anthropic Claude Haiku 4.5
EVAL_PROVIDER=anthropic EVAL_MODEL=claude-haiku-4-5-20251001 pnpm eval              # $0.80 / $4.00

# Z.AI GLM 5.1 — newer GLM, premium of the open-weight set on Chutes
EVAL_PROVIDER=openrouter EVAL_MODEL=z-ai/glm-5.1 pnpm eval                          # $0.95 / $3.15
```

---

## Recommended picks

For the §9.1 eval program (see [docs/roadmap.md](../docs/roadmap.md)):

| Use | Model | Why |
|---|---|---|
| **Pre-flight Step 3** | `xiaomi/mimo-v2-flash` ($0.09/$0.29) via OpenRouter | Sub-cent total cost for a single L0 task; confirms pipeline works |
| **Default cheap (Treatment B/C runs)** | `z-ai/glm-4.7` ($0.39/$1.75) via OpenRouter | Same family as GLM 5.1 you already chose, ~60% cheaper |
| **Cheapest credible for full L0** | `deepseek/deepseek-v3.2` ($0.28/$0.42) via OpenRouter | Output price 7x cheaper than GLM 5.1 — matters because GraphSpec outputs are token-heavy |
| **Cheap Google fallback** | `gemini-2.0-flash` ($0.10/$0.40) | In the local pricing table — USD cap actually trips |
| **Publish tier (Wave 1 blog runs)** | `claude-sonnet-4-6` or `gpt-4.1` | After cheap-tier results validate methodology |

---

## Cross-model matrix runs

Compare a cheap pair side-by-side:

```bash
EVAL_MODELS="gemini-2.0-flash,gpt-4.1-nano" \
EVAL_PROVIDERS="google,openai" \
EVAL_MAX_PRICE_USD=0.50 \
pnpm eval:matrix
```

Or compare a cheap OpenRouter pair (USD cap won't trip — relies on `EVAL_MAX_CALLS`):

```bash
EVAL_MODELS="z-ai/glm-4.7,deepseek/deepseek-v3.2" \
EVAL_PROVIDERS="openrouter,openrouter" \
EVAL_MAX_CALLS=50 \
pnpm eval:matrix
```

---

## Adding a new cheap model to the pricing table

If you want `EVAL_MAX_PRICE_USD` to actually trip for a model not listed in [evals/lib/cost.ts](lib/cost.ts), add a row:

```ts
"your-model-slug": { input: 0.30, output: 1.00 },   // $/1M tokens, verify from provider console
```

Match keys: the lookup is exact-string first, then prefix match (so `"z-ai/glm-4.7"` matches a model field of `"z-ai/glm-4.7-instruct"`). Keep the table small and curated — exhaustive coverage is a future concern (`loadLiteLLMPricing()` helper, not built).
