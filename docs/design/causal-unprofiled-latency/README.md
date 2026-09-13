# Unprofiled consumer latency — diagnostic evidence

Owner: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. This is evidence for existing work, not a new decision, budget, or completion claim.

The user's expectation is an interactive response around **100 ms**. Several measured consumer actions clearly exceed that expectation. This is an absolute latency finding in addition to the still-unqualified D169 relative-performance method. No formal threshold has been amended.

Measured optimized product: `b30ae176`, contained in frozen base `20ba5883`. Work is isolated on `codex/causal-unprofiled-latency` because the shared checkout changed to `main`/`1bf11e6c` during preparation. No samples preceded isolation. This report does not measure that shared main revision. No product files, wave protocol, public APIs, cache, or registries were changed by this batch. Concurrent instruction-file edits are excluded from the commit.

## Results and interpretation

Milliseconds below are the median of three process medians (five measured observations per process, except fresh construction: 100). Candidate is preset assembly, reference is equivalent explicit Graph assembly, plain is the existing plain-code arm. P1/P3/P6 contain 1/16/64 evaluations respectively. Small diagnostic samples establish observed latency, not a qualified p95 or a UI response guarantee.

| Operation | P1 candidate | P3 candidate | P6 candidate | P6 reference | P6 plain |
|---|---:|---:|---:|---:|---:|
| Fresh construction, warmed process | 0.24 | 0.25 | 0.23 | 0.22 | 0.01 |
| Construction + initial processing, warmed process | 3.35 | 43.16 | 703.74 | 642.32 | 321.30 |
| Duplicate, single DATA | 1.16 | 19.77 | 134.94 | 140.94 | 50.42 |
| Duplicate, double DATA | 8.56 | 151.79 | 966.79 | 1003.94 | 97.41 |
| All-new, double DATA | 8.84 | 170.11 | 1876.76 | 1811.01 | 291.10 |
| One newly introduced evaluation | — | 22.98 | 506.47 | 478.58 | 221.50 |
| Reconnect | 0.08 | 0.88 | 5.96 | 6.06 | — |

P6 first API use in separate fresh processes (three observations per arm, no preflight/warmup before timing): candidate **796.69 ms**, reference **721.75 ms**, plain **363.91 ms**. P1 candidate **16.84 ms** and P3 **76.83 ms**. Process/module startup is excluded even in this supplement.

Small cases and reconnect are relatively fast in these observations. Fresh instance construction is not the main absolute cost. Both Graph assemblies take substantial time on loaded inputs: reducing only the roughly 4% preset overhead in P6 all-new cannot resolve a roughly 1.9 s action. Plain also exceeds 100 ms in several P6 cases, so input shape and business work matter alongside Graph overhead. These data do not partition time into serialization versus propagation or prove an exact root cause.

Controls matter: P1 initial-ready reference/reference ratios are 1.362, 0.730, 1.395 in the three rotated orders. This shows order-associated instability; it does not isolate GC or JIT as the cause. P6 all-new controls are 1.001, 1.003, 1.003, while main ratios are 1.048, 1.032, 1.037. Heavy-case absolute slowness remains when those controls are stable. P3 reconnect's first main ratio is 4.004 (candidate 3.25 ms); that observation is retained, not discarded.

## What each action actually does

All clocks cover synchronous library consumption through output projection. They exclude UI rendering, external executor/network, process/module startup and correctness checks. Initial-ready covers construction plus every scenario step. The main matrix's legacy `cold` row name means fresh construction after process warmup, not cold JIT; the separate first-use run addresses this distinction.

Double DATA sends two copies of the same arrival frame in one source.down, not two distinct user actions. One-new seeds all but the last evaluation before timing, then still sends the entire 64-reference frame at P6. New-action timing also includes a subsequent verification input. Therefore one-new is not a one-row delta benchmark.

Source review: `examples/spending-alerts/causal-business.ts` project processes each dependency frame and emits separately; evaluationSelections builds selected pending rows per arrival. `scripts/fixtures/spending-preset-performance.ts` schedule defines the full-frame/new-action recipe. These are candidate design seams, not proof that intermediate emissions can safely be eliminated. Earlier diagnostic grouping was not a product-equivalence proof.

## Evidence and verification

Main matrix: 120 completed processes, 20 rows, 120 three-arm preflights, 8,496 samples including 6,840 measured; 660.72 s elapsed. Maximum sampled child RSS: 396.48 MiB, a process-level observation rather than a retained-library-memory estimate. Six jobs per row: three main and three identical-reference controls, interleaved with rotated candidate/reference/plain positions. Recovery omits plain. Default-off Graph profiling, no profiler enabled.

First-use supplement: 27 completed processes, 28.55 s elapsed, rotated dispatch. Graph business assessment checked after timing and full three-arm preflight follows. The exact timed plain instance is not directly oracle-checked; the unchanged plain implementation is checked by that subsequent preflight. Its Node version was observed after capture, not recorded in each process. Runner bytes are bound by the attempt and copied, but runner/lockfile lack the main matrix's prefreeze manifest coverage. These are explicit limits; the supplement is diagnostic evidence only.

Both independent verifiers recompute summaries and validate complete inventories, hashes, ordering and sample structure without importing collectors. Five reindexed corruptions (wrong control arm, negative time, warmup relabeling, absent preflight, hidden child failure) are rejected. Independent read-only review found no blocking measurement bug and identified the scope/metadata limits recorded here. Authored JS/TS tools were formatted after capture; executed bytes remain in frozen source snapshots. Python syntax and scoped Biome checks pass. No full product test rerun was necessary for this evidence-only change. Previous product test failures remain outstanding; no all-green claim is made.

Evidence archive: `archive/evals/causal-unprofiled-latency-evidence-v1/evidence.tar.gz`, with an external SHA-256 index. It contains main/supplement raw results, logs, frozen sources, inputs, bundles and replay tools. Extract to a new directory and run:

```sh
python3 tools/verify-causal-latency-baseline.py run
python3 tools/verify-causal-latency-first-use.py first-use
python3 tools/check-causal-latency-evidence-negatives.py run
```

## Recommended next design slice

Review the consumer's input granularity and required propagation before another product optimization. Specify which actions genuinely require whole-set evaluation, which can carry only changed facts, and which intermediate outputs are observable authorization boundaries. Compare these recipes with equivalent plain code using the same facts and final/intermediate outcomes. Keep invalid/replayed facts, exact admission/currentness checks, and outstanding lifecycle obligations intact.

Do not introduce cross-wave encoding caches, persistent lookup registries, imperative shortcuts, or silent wave coalescing. A product change requires a concrete equivalence argument for authorization/outcome ordering, followed by behavioral regression and runtime mutation evidence. This report does not approve such semantics. Formal D169 qualification and the parent work remain incomplete. No authority ledger was advanced from this isolated evidence branch.

Suggested review order: results above → action recipes → fixture clocks (`scripts/fixtures/causal-latency-baseline.ts`, `causal-latency-first-use.ts`) → independent verifiers and negative verification. The attached JSON summaries preserve all repeats, including unfavorable observations.
