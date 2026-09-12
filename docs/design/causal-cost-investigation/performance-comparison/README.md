# Currentness performance comparison: reviewable result

Owner remains `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. Library optimization committed at `f7ea7a52` is compared with `60190fcc`, using the same candidate summary preset and exact archived P2 input. Independent frozen-source verification and bundle reconstruction prove the only reachable source difference is the approved private currentness comparator.

## Result

All 48 scheduled children and 6720 samples completed, including 1920 warmup and 4800 measured lifecycle samples. All 384 untimed semantic preflight instances passed. No sample was rerun or replaced. Table ratios are C/B: each of the four main pairs has two positions, each summarizing its two repetitions by their median p95 ratio. Each p95 uses nearest rank 48 of 50 measurements. These ranges retain all eight main pair-position medians; they are not confidence intervals or pooled percentiles.

| P2 phase | Main ratio range | Control range | Predeclared descriptive result |
| --- | ---: | ---: | --- |
| Construction | 0.903–1.222 | 0.846–0.980 | Control unstable; unresolved |
| Initial six inputs | 0.761–0.878 | 0.948–1.028 | Control unstable; unresolved |
| Duplicate arrival | 0.565–0.662 | 0.911–1.014 | Control unstable; unresolved |
| Cleanup | 0.794–1.193 | 0.919–1.041 | Control unstable; unresolved |
| Action sum | **0.722–0.792** | **0.994–1.040** | **Observed consistent decrease** |
| Whole lifecycle wall span | **0.722–0.795** | **0.997–1.041** | **Observed consistent decrease** |
| Snapshot/gaps residual | 0.758–1.227 | 0.944–1.106 | Control unstable; unresolved |

Action sum p95 shows a 20.8–27.8% reduction across the eight pair-position medians, with stable controls under the predeclared 5% criterion. Wall span shows a similar direction. Initial/duplicate input ratios are all below one, but their own controls fail that criterion; they are not independently qualified improvement claims. Construction and cleanup include increases; those are not hidden by the aggregate decrease.

The inactive single-node negative control has main ratios 0.801–3.578 and control ratios 0.723–1.346: unstable and unresolved. No currentness work occurs there, and no tiny-case improvement is claimed. This is a finite short-history diagnostic, not formal CSP11/D169 acceptance, stationary long-lived performance, a broad regression clearance or proof that all construction costs are within budget.

Maximum observed RSS was 254001152 bytes (242.23 MiB), below the unchanged 256 MiB stop line. The longest observed RSS interval, including process boundary gaps, was 132.1 ms. Polling targets 100 ms; it does not prove a continuous peak bound. Each process loads both slots, so this RSS is process-wide and cannot establish per-graph memory usage, an arm-specific memory improvement, allocation reduction or retained-heap improvement.

## Interrupted execution and correction

The original collector stopped after child 0 had successfully produced 140 samples. Its verifier rejected a macOS-injected `__CF_USER_TEXT_ENCODING` field. A standalone Node probe with the same minimal environment confirmed the exact system value; no consumer was executed by that probe. The original tools, reservation, child bytes and stop result are preserved in `initial-stop.tar.gz` and its index.

A corrected verifier permits only the observed exact value on Darwin; unrelated environment changes remain errors. The retained child was verified offline. A separately bound continuation ran only original schedule entries 1–47. Library inputs, child sampler, action driver, random bits, physical modules, process/sample ceilings and resource stop lines remained unchanged. No child or sample was retried.

This is **a post-freeze verifier correction and paused continuation**, not adherence to the original uninterrupted execution plan. The pause falls inside the first control pair and can affect VM/host comparisons; raw positions and both control pairs remain visible. Reported total 348.04 seconds includes the pause, reconstructed from the original stop file timestamp and wall clock before continuation, then tracked monotonically. That reconstruction assumes no intervening wall-clock adjustment and is not an original independently retained monotonic anchor. It is unsuitable as formal method qualification.

## Reproduce without taking new samples

From the repository root:

```sh
python3 -B docs/design/causal-cost-investigation/performance-comparison/replay.py archive/evals/causal-currentness-comparison-v1
```

This verifies the archive SHA256 and exact regular-file index, extracts into a fresh temporary directory, runs the archived corrected Python verifier, and requires the recomputed report to match the retained report. It uses only Python's standard library and executes zero consumers. Optional `--rebuild` also checks the recorded local Node/esbuild JS/native/TypeScript bytes and independently reconstructs both bundles; that requires the matching installed build tools.

`summary.json` retains every ratio and interpretation. `phase-results.csv` exposes every absolute p95/p50/sum by row, pair, repetition, variant, position, slot and phase. `archive/evals/causal-currentness-comparison-v1/report.json` retains the complete independently computed result; the indexed archive contains all raw clocks, sample coordinates, snapshots' digests, semantic preflights, process identities, RSS observations, source/git-object proofs, source transformations, tool snapshots, initial stop and continuation evidence. `PLAN.md`, `approval.json`, `review.md` and `continuation.json` preserve the predeclared method and later correction separately.

The reproduction result is recorded in `archive-replay.log`. The pre-capture `qualification.json` hashes refer to the archived `run/tools` snapshot; continuation tools are bound separately. The final archive replay entry is a post-capture verification tool. Earlier library correctness qualification and its existing unrelated test/lint failures remain at `implementation/receipt.json`; private tooling did not rerun the unchanged full suite or historical soak. Root uncommitted work and prior archives remain untouched. The owner work remains incomplete: graded entry hiding, formal performance qualification and broad recovery/user-ownership evidence are not established by this comparison.
