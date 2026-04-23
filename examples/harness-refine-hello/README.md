# harness-refine-hello

Smallest possible end-to-end wiring of `harnessLoop` + `refineExecutor` + `evalVerifier`.

One intake item. One refined artifact. One reactive re-eval. No API keys.

## Run

```sh
pnpm --filter @graphrefly-examples/harness-refine-hello start
```

## What it shows

- **Pluggable EXECUTE slot** — `refineExecutor` replaces the default LLM-backed executor. The harness emits an `ExecuteOutput` only when the inner `refineLoop` reaches a terminal status (`converged` / `budget` / `errored`).
- **Pluggable VERIFY slot** — `evalVerifier` re-runs the *same* evaluator against the artifact emitted by EXECUTE. No "LLM said it looks fine" gap.
- **Consistent scoring** — EXECUTE and VERIFY share the `Evaluator<T>` definition, so the verifier grades what EXECUTE optimized.
- **Inspectable topology** — `graph.describe({ format: "pretty" })` lists every node and edge, including the `refine-executor` and `eval-verifier` slots wired through `withLatestFrom`.
- **Preflight validation** — `validateGraphObservability` exits non-zero if the dry-run surface (describe + formats + resolve) can't inspect the graph, before any LLM calls run.

## Scenario

The "artifact" is a catalog description string. The evaluator checks whether each required keyword (`reactive`, `composable`, `inspectable`) appears in the description — one keyword per dataset row. The strategy appends the next missing keyword each iteration until all rows score 1.0.

TRIAGE uses `dryRunAdapter` with a canned classifier response, so the demo is deterministic and zero-cost. Replace the adapter with a real LLM provider to drive TRIAGE live; EXECUTE and VERIFY stay LLM-free.

## Expected output (trimmed)

```
validateGraphObservability: OK (describe, 2 formats)

VerifyResult received
  verified:    true
  findings:    3/3 eval tasks passed; mean score 1.000 ≥ 1
  outcome:     success
  detail:      refineLoop converged at score 1.000
  refined text: "The GraphReFly protocol is a framework reactive composable inspectable"
```
