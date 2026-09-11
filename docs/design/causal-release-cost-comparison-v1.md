# Release counting cost comparison — finite proposal

Status: design only; §§2–6 await explicit approval. Owner remains `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. Based on implementation `907eec81` and its receipt. This is a descriptive before/after diagnostic of one library optimization, not a new formal acceptance method, D169 qualification, preset/reference architecture comparison, or another A/B/C decision.

## 1. Verified starting point

Implementation qualified 1,036 oracle states, 15 actual quiescence predicates, nine loaded semantic mutants and real fan-out/fan-in/rejection/retry paths. Full TS: 2,550 pass / two existing D159 failures / four skipped; soak: 221 pass. Type/layer, scoped formatting, build/export and governance passed. Full formatting retains seven prior byte-bound JSON errors; artifact gate retains D159 drift. Those limitations and all frozen bytes remain intact.

Current private consumer is `scripts/fixtures/spending-preset-performance.ts:90` graphArm. Both comparison arms must select `graphArm("candidate", "summary")`: the SAME preset, on two library revisions. Its factory constructs six sources, seals/transfers ownership, starts construction, then connects existing view observations. Its cleanup disconnects views and owner roots, describes membership, and calls topologyGroup.release. Comparing this whole cleanup is different from timing group.release alone.

The archived D/R diagnostic workers contain internal clocks/forwarding; they are unsuitable as uninstrumented treatment arms. The P2 input remains the six-step, one-evaluation fixture with SHA256 `44f1165557fc1444540731a73846233ce3d71da7a0af3a3d4fa2137e249c2079`, obtained from the indexed release-boundaries evidence archive, not trusted from an untracked run directory. Its plain-code and independent business oracle remain semantic preflight controls, not additional timing arms.

## 2. Source identity and build

- **B (before)**: `2f19cc0d79937bee0faa462cc9f2cf5209b62111`.
- **C (after)**: `907eec8138cddce9f8ff0e74d9f19d60db8c5b96`.
- Build isolated modules from these exact git snapshots with the same installed, recorded esbuild/TypeScript versions and identical private fixture wrapper. Do not check out or modify the user's working tree.
- Capture the full reachable import closure and bundle hashes. Independently establish that the reachable library/consumer inputs differ only in Graph._releaseNodes counting. Tests, docs and generated packaging output must not become hidden runtime inputs. Verify common business fixtures match both commits. Unexpected source differences stop preparation.
- Main physical slots M0=B, M1=C. Controls M0=B, M1=a byte-identical B copy at a distinct module URL. Load M0 then M1 every time, through identical namespace call sites. No runtime monkeypatch, diagnostic argument, internal clock, CPU observer, per-node counter or persistent cache in measured libraries.
- Bundle/path provenance is recorded separately. Qualify only known nonsemantic path normalization if needed; never strip arbitrary code to force equivalence.

## 3. Five cases, fixed order and boundaries

| Row | Workload | Timed action / interpretation |
| --- | --- | --- |
| P2-lifecycle | Same candidate summary preset, exact archived P2 input | Construction, first six input steps, one duplicate-arrival operation, existing full cleanup, and full lifecycle span |
| inactive-60 | 60 named independent state nodes in one group, never subscribed | Successful group.release; isolates node-count accounting, not P2 topology |
| active-diamond-5 | Two state sources → two derived branches → one joined sink, with an external sink subscription | Expected release rejection at joined sink; measures a real active guard path, not successful active teardown |
| inactive-2 | State → derived, never activated, both in group | Successful group.release; small-map allocation tradeoff |
| inactive-1 | One never-subscribed state node | Successful group.release; no count-map branch |

Micro fixtures use ordinary Graph/topologyGroup factories, no private activation toggles. Their construction/setup is outside the release timer. Active-diamond uses the exact values/functions of the landed regression (2,3; sum/product; joined sum), must emit 11, and release order is sources/branches/join. Its expected rejection preserves topology. After timing, unsubscribe and explicitly release once for cleanup. This second call is separately counted and untimed. Any unexpected rejection/success stops the capture. Empty-group behavior remains offline-qualified and is deliberately not another timing row.

For P2-lifecycle, derive the duplicate operation from the existing `schedule` for `steady-P2-summary-duplicate-1`. Run its six setup steps once, then the one duplicate arrival; do not repeat setup for the duplicate. This diagnostic is not a stationary long-lived steady workload or any of the formal 60 steady rows.

Use eight external clock reads: C0/C1 immediately around factory; A0/A1 around the six-step send loop; S0/S1 around the duplicate send; R0/R1 around the EXISTING cleanup closure. Report construction C1−C0, initial-input A1−A0, duplicate-input S1−S0, full cleanup R1−R0, their sum, and wall span R1−C0. Capture graphSnapshot after S1 and before R0, before state is released; validate its effects/evidence/obligations and view against the independent expected snapshot after R1. Snapshot work and gaps are explicitly the wall-span residual, never described as pure consumer execution. This is one-way source input, not a new trigger or effect authority.

Micro rows use two outer reads around group.release (including its expected throw for active-diamond); classify the result after the closing read. Semantic assertions, record serialization, raw memory snapshots and file writes stay outside action timers. Setup, validation and cleanup still affect later VM history, so timing isolation is not a claim of zero observation interference. All raw phases and residuals are retained, without subtracting a guessed timer overhead. No clock is inserted in Graph or the original factory body. “Uninstrumented” refers to the library, not the external harness.

## 4. Pairing, controls and reporting

Per row: one B/B-copy control pair → FOUR B/C main pairs → one B/B-copy control pair. Each pair is two fresh serial processes, U and V. Each process has three blocks; each block runs each slot as one contiguous 100-warmup + 300-measured block. U slot orders are [M0,M1], [M1,M0], [M0,M1]; V is complementary. Never interleave individual samples or pool warmup with measured data.

Before the first child, generate and retain 30 fair random bits (six pairs × five rows), one bit per pair for whether U or V starts first. Freeze the complete schedule, source/runtime/input bindings and budget in one exclusive reservation. No redraw, result-dependent ordering, outlier removal, pair replacement or retry. Complementary positions reduce one known confound; they do not guarantee independent or stationary samples.

Independently recompute each block's measured p95 as sorted element 285 (one-based), and raw p50/elapsed sums. Compare C/B at the SAME block and position across U/V, keeping each pair separate. For each phase and position also report the median of its three block ratios, along with all underlying values. Never divide p95 values from different workload rows or call phases, and never take an average across positions to hide opposite results.

Only four main pairs exist: report their full range and both positions, without a confidence interval or population-level acceptance claim. Show controls alongside main results. As a diagnostic interpretation rule, call a phase “observed consistent decrease” only if both control pairs' per-position median ratios lie in [1/1.05,1.05] and all eight main pair-position medians are below 1; analogously above 1 is “observed consistent increase.” Otherwise report mixed or control-unstable/inconclusive. These labels are observations under this batch, not new library pass/fail budgets. Report the actual magnitude, including small increases, not just the label. Zero/nonpositive p95 ratios are unresolvable, not replaced with epsilon; nonfinite/backward raw clocks are invalid.

Control instability does not drop the row or prevent the remaining scheduled rows: finish this fixed descriptive inventory unless a structural/semantic/resource failure occurs. Do not take more samples to stabilize it. The formal 1.20/1.10 budgets, D169's method status and all unrun formal rows remain unchanged. Never call these external-window measurements the frozen CSP11/D169 eval.

## 5. Qualification and single-use budget

Before dispatch, qualify private source loading/timer boundaries with countable hosts and fake clocks. Exercise all five real fixture entry shapes without running timed performance factories in qualification. Reuse the landed library qualification; rerun affected private tests and regression checks rather than the unchanged 16-minute historical soak merely for a harness edit.

The capture's untimed preflights provide actual factory/oracle checks before sampling: micro rows run one full fixture per physical module (two instances per child); P2 runs existing cold-P2-summary and steady-P2-summary-duplicate-1 three-arm preflights for BOTH modules (four preflights / twelve instances per child). Also run one explicit candidate-only cold→six steps→one duplicate→snapshot→cleanup preflight per physical module (two additional instances per P2 child, fourteen total). Assert no new occurrence on duplicate, exact semantic snapshot against independent expected vectors, graph ownership and cleanup. These extra instances qualify the exact timed factory path; they are not hidden inside the sample count.

Loaded negative tests must catch source/slot swapping, wrong candidate/reference business selection, wrong input/row, missing/doubled factory/cleanup, timer moved across setup/snapshot or into library code, swallowed cleanup failure, reused process identity, replayed sample coordinates, omission of the last block, reversed ratios and position averaging. Non-1 deterministic numeric vectors test p95/indexing, boundary inclusion, residual accounting and control labels. Collector code cannot supply the verifier's arithmetic implementation.

Independent admission validates reservation/source/build/preflight rules before first dispatch; independent cumulative prefix verification precedes every next child. Per-child verification checks entry/source/runtime/PID/row/schedule, exact raw sample coordinates and lifecycle outcomes, then permits the next child. Failed rows keep any available identity even if numerical evidence is incomplete. Reject hidden execution directories and stale receipts. Clock/capture failure must not skip cleanup or repeat a completed release; record cleanup failure separately and stop.

| Quantity | Hard bound |
| --- | ---: |
| Rows / pairs per row | 5 / 6 (4 main + 2 control) |
| New timed child processes | 60 (40 main + 20 control), serial |
| Samples per child | 2,400 (600 warmup + 1,800 measured) |
| Total samples | 144,000 (36,000 warmup + 108,000 measured) |
| Untimed preflight instances | 264 (168 P2 + 96 micro), including plain |
| Timed-library internal clocks | 0 |
| External action clock reads | 460,800 (P2 28,800×8 + micro 115,200×2) |
| Child / whole-attempt ceiling | 30 seconds / 900 seconds, preparation through per-child verification |
| RSS guard | 256 MiB soft ceiling, parent observes every 100 ms |
| Retries / extra timed fixtures | 0 / 0 |

Use the same recorded Node executable/version for every child, with NO optional trace/profiler/GC flags and no implicit NODE_OPTIONS/coverage/compile-cache hooks. Record executable hash, Node/V8/platform, complete allowed environment and wake/sleep evidence; sleep, source/runtime drift, deadline, memory or semantic failure stops remaining children as not-run. Changing tracing from the old diagnostic is deliberate; these results cannot be spliced into its samples.

One exclusive output directory: `archive/evals/causal-release-cost-comparison-v1/run`. Reservation/preparation failure consumes the attempt. Hash and archive raw inputs, snapshot source/bundles, schedule, entries, samples, failures and verifier sources. Re-extract indexed regular files into a fresh directory and compare workspace versus archived verifier output. Archive replay creates zero new samples. Format newly authored report JSON before binding hashes; do not reformat old evidence, change lint exclusions or repair unrelated D159 records.

## 6. Exact next approval and limits

Approval of §§2–6 would authorize new PRIVATE comparison tooling, bounded offline qualification, the ONE fixed capture above, independent replay/report/archive and commit. No library algorithm/API/protocol change, provider/live/spend, formal performance matrix, extra run or automatic next batch. This is not a request to reapprove the landed counting implementation.

The result must answer: did full cleanup get cheaper; did construction, initial input, duplicate processing or small-group release get worse; is apparent benefit consistent across positions and control stability? Report unsupported answers as unresolved. Even successful diagnostics do not prove user-tier hiding, human/agent ownership, broad workload performance, or effect authorization. Existing semantic/mutation evidence remains independent of timing.

## 7. Q5–Q9 review

**Q5.** Private evaluation layer: same real consumer and standard graph-owned micro fixtures on two library snapshots. No generic benchmark framework or public timing API. The existing graphArm and release-counting regression are the concrete precedents.

**Q6.** INVARIANT: only counting differs between imported closures; source/slot/position/phase identity never inferred from filenames alone. Fixed budget and no retry prevent selective evidence. Four pairs and external observation leave substantial statistical/generalization limits; retain raw controls and inconclusive results.

**Q7.** Ordinary users and framework authors receive no new concepts or runtime state. Maintainers get a direct before/after table with named construction/input/cleanup boundaries. Tiny cases expose scratch-map cost; active-diamond rejection tests a real lifecycle guard rather than manufactured private activation. Composition and authority remain unchanged.

**Q8.** Reuse old D/R workers: cheapest, but confounds optimization with internal instrumentation and compares the wrong implementation labels. Run full formal matrix now: broader, but current method remains unqualified and would exceed this diagnostic question. Recommend the finite external-window comparison: more tool qualification, but exact source attribution and explicit limits without reopening product design.

**Q9.** Source attribution, tiny-group coverage, active guard coverage and user cognitive cost are addressed. Real consumer cleanup is separated from micro group.release. Performance significance and broad steady/recovery guarantees are only partially addressed and remain deferred to a separately qualified method. Recommend §§2–6 as one bounded next batch; no new D# or work identity, because formal acceptance criteria and authority semantics do not change.
