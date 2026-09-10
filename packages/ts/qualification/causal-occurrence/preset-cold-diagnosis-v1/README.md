# Private preset cold-construction diagnosis v1

**Investigation evidence, not qualification or a production repair.** The historical `cold-P2-summary` result remains **1.211671 > 1.20**, and all 80 unrun rows remain unrun. No candidate/reference/runtime/old runner source changed. This investigation narrows the extra work to consumer construction, rejects one unsupported optimization hypothesis, and identifies a slow window in the original samples. It does **not** establish a single function or system event that caused the historical p95 rejection.

Same owner/work: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`, D164–D166. The user authorized investigation with “好的，开始调查”; earlier commit approval remains. This record is attempt/evidence, not a D#, new work item, public API, protocol/C change, effect grant or automatic qualification retry.

## What the evidence supports

1. **P2 arithmetic/hash is outside the cold clock.** The timed operation constructs, starts and initially subscribes a fresh graph before business inputs arrive. P2 facts are only used by semantic preflight. Its prefix length cannot be named as the cause of this cold result.
2. **The observed extra work is mainly in the consumer builder.** A common-shell phase probe found summary-mode builder means of 228.22 / 212.43 μs (candidate/reference). Startup was 13.09 / 13.13 μs, and subscription 3.40 / 3.17 μs. These include identical probe calls and are diagnostic observations, not replacement gate samples.
3. **Finer construction phases show small, distributed differences.** The table below is a separate probe and cannot be subtracted from the first probe to infer “saved” time. Its wrapper and markers can affect JIT optimization.

| Summary-mode builder phase | Candidate mean μs | Reference mean μs | Difference μs |
|---|---:|---:|---:|
| Binding and input-group checks | 12.325 | 12.916 | -0.591 |
| Business/material/admission node assembly | 67.777 | 64.123 | +3.654 |
| Publication and causal-node assembly | 99.062 | 97.130 | +1.932 |
| View/capability/summary assembly | 7.308 | 7.152 | +0.156 |
| Actual topology checks | 22.671 | 23.286 | -0.614 |
| Return container | 0.118 | 0.061 | +0.058 |

These are corresponding responsibilities, not identical statements. For example, reference profile extraction is in its business bucket while candidate `materialProfile(binding)` is in publication. Means average three equally sized batches. Phase p95s are retained but **not summed**. The small view/capability/summary difference does not justify attributing the original rejection to capability layering.

4. **Sampling finds common node-allocation work, not a unique slow candidate function.** Four unmodified-source CPU profiles were taken in candidate/reference then reference/candidate order. Only JavaScript sample stacks containing `graphArm` are counted as construction. `makeDepBookkeeping` is the largest named leaf in both arms; node registration/construction and publication/causal construction dominate both call trees. Cleanup stacks and native/GC samples without `graphArm` are outside this attribution. Inclusive sample counts overlap and are not exclusive time. No profiler/hrtime alignment is assumed.
5. **The frozen-array hypothesis did not show stable benefit.** Candidate `nodeMaker` passes the frozen `expected` dependency array to `scope.node`; reference passes the original ordinary `deps`. `Graph.createOwned` iterates and copies the input. A generated-copy trial changed only that argument, preserving the frozen guard snapshot and both cold/runtime dependency checks. Both variants used the same bundle and global selector; every fresh construction retained the same graph obligations. P2 oracle/Graph/plain preflight passed in both modes/variants. Summary-mode medians across batch means were about 241.306 μs (frozen) / 241.155 μs (ordinary), while median batch p95s were 283.750 / 285.000 μs. Batch directions differ. Off-mode results and its noisy first batch are retained. **No production change follows this experiment.** It neither isolates array-spread cost nor qualifies a faster implementation.
6. **The original deciding batch contains a broad slow window.** The historical candidate batch 2 has these contiguous 100-sample windows, using the original samples without deletion or a substitute estimator:

| Original measured indices | p50 μs | p95 μs |
|---|---:|---:|
| 100–199 | 244.416 | 313.250 |
| 200–299 | 304.375 | 368.042 |
| 300–399 | 254.833 | 318.042 |

The candidate sample deciding its median batch p95 is index 293, inside the slower middle window. The earlier no-GC/deopt-overlap observation for that sample remains true within the log resolution; it does not explain why that whole window slowed. The original attempt did not capture sample-level function stacks or system scheduling evidence. New diagnostics cannot retrospectively supply them. The available evidence is insufficient to identify scheduler activity, CPU frequency, JIT state, or a particular constructor as the cause. No window is removed and the 1.211671 rejection remains binding.

## Runs, controls and evidence

- `run-01`: two common-shell phase jobs (off/summary), AB/BA/AB with 100 warmup + 300 measured per arm, **4,800 raw samples**; four CPU-profile jobs, 500 warmup + 3,000 constructions each, **12,000 raw construction intervals**. CPU profiles also contain out-of-construction work, which the analyzer explicitly excludes by stack ancestry. Source and generated-bundle hashes are frozen before sampling.
- `dependency-input-01`: only one constructor argument varies in the generated copy, fixed AB/BA/AB, 100 warmup + 1,000 measured, both modes, **13,200 raw samples**. All four mode/variant preflights pass. Original and diagnostic source copies are retained for exact diff review.
- `builder-01`: six mapped phase marks in each generated builder, AB/BA/AB, 100 warmup + 300 measured, both modes, **4,800 raw samples**. Both semantic preflights pass. Both variants retain all checks and output paths.
- Semantic preflights use the previously indexed P2 fixture and independently compare business results, Graph/reference/plain effect records, retained evidence and lifecycle obligations. They verify actual node/root counts and fresh required reconnect DATA. They do not claim full five-port recovery or real effect execution.
- Historical window analysis reads the committed old archive. It adds descriptive windows only; the old estimator and statuses are unchanged.
- Raw samples are append-persisted. Recoverable CPU failures attempt to retain a partial profile; normal analysis rejects incomplete/failed jobs and partial profiles. Diagnostic child/outer timeout limits are recorded. All actual jobs completed successfully. No heavy verification command from this task ran concurrently with these measurements; external machine load was not controlled.
- Four diagnostic-tool tests pass: exact marker-only shell transformation, fail-closed phase drift, distinguishing allocation inside construction from the same helper under cleanup, and rejecting malformed CPU call trees. Two static reviewers checked transformations, source snapshots, raw evidence, cleanup, partial-profile handling and attribution limits; all actionable findings were fixed and re-reviewed.

`evidence.tar.gz` contains scripts/source copies, generated bundles, source/metafile bindings, all raw samples, profiles, summaries, console/exit evidence, the original and verified CPU analyses, historical windows and verification logs. `artifact-index.json` hashes every member; `receipt.json` binds the archive and index. Relative archive paths are portable even where raw profiler URLs preserve original absolute provenance.

The default suite remains **2514 passed / 2 existing D159 manifest failures / 4 skipped**. Lint/typechecks and diagnostic-tool checks pass. No public build behavior changed. Previous reference/runtime mutation evidence is reused only through unchanged source bindings; no new candidate runtime mutation qualification or artifact-gate pass is claimed. The six pre-existing dirty root files are preserved.

## Recommended next boundary

Keep the implementation and C design unchanged on this evidence. Before a repair proposal, diagnose the window-level slowdown with simultaneous function-stack/system context in a separately identified run, and distinguish it from repeatable node-assembly cost. Only a concrete, repeatable source-level excess should drive a local fix. Any later formal qualification keeps the original thresholds and preserves this investigation and the rejected attempt. The remaining matrix, N1–N12 review, complete display recovery evidence and D159 binding issue remain outstanding; no cognitive-burden or final factory-ergonomics success is inferred.
