# Inbox Reducer — historical pre-CSP-9 example

This directory is retained as historical reference only. It depends on the
retired root package and old AI pattern surfaces, so it is not an active
clean-slate starter and is not included in the workspace examples set.
Re-activating it should be a separate design slice over current
`@graphrefly/ts` public subpaths, not a compatibility shim.

The remaining write-up is preserved to explain what this old example did;
it is not current run, provider, or configuration guidance.

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
| **`graph.describe({ explain: { from, to } })`** | Prints the causal chain from `emails` → `brief` at the end, with the WHY annotation for each hop. |

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

The old run commands are intentionally omitted from active guidance.

## Historical notes

The old implementation showed dry-run token counting, provider presets,
fallback/replay behavior, and a prompted real run over LLM APIs. Those
operational instructions are not current clean-slate guidance because the
example still depends on retired root-package AI surfaces.

## What this example is not

- **Not a test.** It was intended to be run by a human looking at stdout, not
  by CI.
- **Not a replacement for the eval harness.** The eval harness at `evals/`
  measures accuracy across many runs. This is a single end-to-end trace
  showing how the primitives compose for a real task.
- **Not the website demo.** There is no active clean-slate inbox-reducer demo
  directory in this repo.
