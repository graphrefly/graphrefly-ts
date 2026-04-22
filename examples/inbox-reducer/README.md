# Inbox Reducer — 50 emails → 3-bullet morning brief

A non-toy example that exercises every safety + inspection primitive
GraphReFly ships for LLM workflows:

| Feature | Where it shows up |
|---|---|
| **Dry-run token counting** (no spend) | Pre-flight banner — reports exact input/output tokens, and USD estimate if pricing is in `config.ts`. |
| **`resilientAdapter`** (rate-limit + budget + timeout + retry + fallback) | One call in `index.ts` wraps the provider. |
| **`withReplayCache`** (file-backed) | First run pays for the 3 LLM calls; reruns serve from `.cache/` for free. |
| **`observableAdapter`** stats | Counts every call's input/output tokens reactively — surfaces in both dry-run and real-run summaries. |
| **Live budget subscriber** | `budget.totals` streams to stdout after each LLM call. |
| **`promptNode`** (reactive LLM transform) | The three LLM hops (classify, extract, brief) — topology + retries handled by the factory. |
| **Stage-by-stage stdout trace** | Each of the 7 named nodes logs when it fires. |
| **`graph.explain(from, to)`** | Prints the causal chain from `emails` → `brief` at the end, with the WHY annotation for each hop. |

## Topology

```
emails (state)
  │  promptNode — batched classify (LLM call 1)
  ▼
classifications ──┐
  │               │
  ▼               │
actionable (derived filter)
  │               │  promptNode — batched extract (LLM call 2)
  ▼               │
extractions ──────┤
                  │
  ▼               ▼
ranked (derived: priority × confidence)
  │
  ▼
top3 (derived)
  │  promptNode — free-text brief (LLM call 3)
  ▼
brief (string)
```

Three LLM calls total. Everything else is deterministic reactive derivation.

## Running

```bash
# 1) pick a provider + model — edit config.ts OR set INBOX_CONFIG
export INBOX_CONFIG=openrouter         # or `anthropic`, `google`, `ollama`
export OPENROUTER_API_KEY=sk-or-v1-... # whichever env var your config references

# Optional: override the preset's model without editing config.ts
# export INBOX_MODEL=gemma4:26b

# Optional: timeout for the whole pipeline (default 120000 ms = 2 min)
# export INBOX_TIMEOUT_MS=180000

pnpm --filter @graphrefly-examples/inbox-reducer start
# or
npx tsx examples/inbox-reducer/index.ts
```

### Local model via Ollama

If you have Ollama running locally:

```bash
ollama pull gemma4:26b           # or any other model
export INBOX_CONFIG=ollama
# INBOX_MODEL defaults to gemma4:26b; override if your tag differs

# Large models on consumer hardware are slow. The 50-email classify prompt
# is ~3K tokens of input — easily 1-3 minutes per call on M1-class silicon.
# Three calls in the pipeline → plan for 10+ minutes end-to-end.
export INBOX_TIMEOUT_MS=900000   # 15 minutes

pnpm --filter @graphrefly-examples/inbox-reducer start
```

No API key required. The Ollama preset ships with **no per-call timeout and
no retries** — local inference isn't transient, so aborting/retrying it just
wastes time. `INBOX_TIMEOUT_MS` is the only bound; set it generously for big
models.

If a call fails (5xx, malformed JSON, etc.), the adapter's error is printed
with an `[adapter]` prefix, so you'll see the real reason for any `null`
stage output instead of guessing.

### Two timeouts — which one is biting you?

| Knob | Layer | What it aborts | Default |
|---|---|---|---|
| `INBOX_TIMEOUT_MS` | Outer pipeline | The whole end-to-end wait for the brief | 120 000 ms |
| `resilience.timeoutMs` in `config.ts` | Per HTTP call (via `resilientAdapter`) | A single LLM request | API presets: 30–60 s · Ollama preset: none |

If you see `[adapter] invoke failed after ~120000ms — AbortError: ...` lines
before the outer timeout fires, `resilience.timeoutMs` is the knob to raise
(or delete) in `config.ts`.

The script:

1. **Dry-runs first.** Prints exact token counts. If `capabilities.pricing` is
   filled in in `config.ts`, also prints the USD estimate. Otherwise, USD is
   skipped — no fabricated numbers.
2. **Prompts** `Proceed to real run? [y/N]` — pass `--yes` to skip.
3. **Real run** with live stage trace, budget stream, final brief, and
   `graph.explain` causal chain.

Rerun after the first success: the three LLM calls hit the replay cache
(`.cache/`) and the whole pipeline completes offline with identical output.
Delete `.cache/` to force fresh API calls.

## Config

All config lives in `config.ts`. Three preset shapes are provided — pick one
with `INBOX_CONFIG` or edit the file to add your own. Every field maps
1-to-1 onto a shipped library type (links in the file header).

**Pricing:** by default, the preset pricing blocks are commented out, so the
dry-run reports token counts only. Uncomment and fill in from your provider's
current pricing page to enable USD estimates. No fabricated rates.

## What this example is not

- **Not a test.** It runs against real APIs; you pay for the first run.
  Intended to be run by a human looking at stdout, not by CI.
- **Not a replacement for the eval harness.** The eval harness at `evals/`
  measures accuracy across many runs. This is a single end-to-end trace
  showing how the primitives compose for a real task.
- **Not the website demo.** An interactive Chrome-Nano-backed version at
  `demos/inbox-reducer/` is scoped for a later session.
