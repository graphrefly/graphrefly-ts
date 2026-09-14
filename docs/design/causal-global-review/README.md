# Cumulative regression screen and remaining headroom

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS, D160; unchanged D168/D169 acceptance. The user requested broad regression diagnosis and a reasoned stopping point. This is offline evidence under the existing grant, not a new decision or product implementation. Product HEAD remains 0c4cbdf6 in the isolated latency-review worktree. Unrelated worktree edits are preserved.

## Verdict

No new **confirmed** regression was found. All 60 candidate steady observations decreased, all 84 business preflights passed per version, and the 696 recorded invocation observations match. Small construction/recovery differences remain measurement uncertainty, not a proof of equivalence. Memory improvement is not established. Formal performance remains unqualified; heavy interactive paths are still slow.

Remaining exercised cost is not negligible. However, continued scattered kernel micro-optimization is a poor next step. Pause that approach and focus any next bounded investigation on publicationPolicy's repeated full canonical comparisons. Do not translate a CPU share into promised savings. No product edit is made here.

## Fresh complete map

Fresh serial runs compare b30ae176 with 0c4cbdf6 using the exact existing 84-row fixture, six frozen inputs and original graph-profile intervention. Baseline bundle is copied unchanged from causal-post-optimization-review-v1, rather than reconstructed under a different method. All 63 captured source hashes independently match the corresponding git revision; only identity.ts, evidence.ts, transition.ts and consumer causal-admission.ts differ. Node executable digest, inputs, limits and profiling intervention match. Current preparation and CPU rebuild were performed outside timed capture.

- 12 cold rows, 60 steady rows, 12 recovery rows per version.
- 84 three-arm business preflights per version; recovery uses the original Graph arms.
- 696 observations per map; 480 disconnect/reconnect actions per map, each checking retained state and resumed ports.
- Steady candidate after/before ratios span 0.418–0.839 (16–58% lower in these individual observations). This is a screen, not a confidence interval or p95 result.
- Worst current profiled row: P6/summary/all-new/two DATA, 1881.35 → 1135.08 ms. P6/off/all-new/two DATA: 1879.68 → 1107.40 ms. These include profile overhead and are not directly comparable to the prior unprofiled 440 ms duplicate result.
- Four recovery medians increased by 0.005, 0.0277, 0.0812 and 0.0606 ms. Maximum relative increase is about 2.9%; causes are unresolved. All recovery state assertions pass. The worst current recovery median is 5.76 ms.
- Total process duration 182.35 → 157.32 s includes setup and preflights, so is not an action-latency speedup. Peak sampled process RSS 443.56 → 442.75 MiB is essentially unchanged. RSS includes V8, fixtures, all implementation arms, preflight and retained diagnostic output; heapUsed deltas are uncollected, not retained heap or per-graph memory.

Coverage verification compares semantic summaries, topology and node invocation counts. It does not compare complete cross-version state/output/alias histories. Cold invocation deltas start after construction and therefore do not prove construction invocation equivalence. These limits were independently reviewed and are intentionally retained.

## Construction follow-up

Two single cold observations rose by about 0.15–0.16 ms. A separate unprofiled screen runs both off/summary modes, three alternating-order before/after process repetitions plus one before/before order control per mode, 30 warmups and 200 measured fresh constructions per arm: eight processes and 3200 measurements. P1 preflight is used because construction itself receives no scenario inputs.

Final cold-v2 ratios are off 1.0181 / 1.0378 / 0.9627 and summary 1.0693 / 1.0327 / 0.9584. Before/before second-block ratios are 0.9533 and 0.9091. There is no consistent direction across repeats; small regression is not excluded. These are warmed-process fresh constructions, not process-first-use startup. The identical arm reuses its imported module, so controls include extra module/JIT warming. Do not claim cold improvement or formal equivalence.

Initial cold overlapped a short CPU-result audit and is retained only as a screen. cold-final removed overlap but independent review identified an ambiguous undefined state sentinel. cold-v2 uses an explicit sentinel and is the only final cold receipt. All attempts are retained; no favorable attempt is selected. The new assertion compares uninitialized state correctly, but full business behavior remains the separate preflight's responsibility.

## Current CPU and optimization budget

Four serial processes, P6 duplicate-two-DATA and verification recipes repeated twice, five action-only windows per process, 500 µs inspector sampling. Setup, checks and cleanup are outside profiling. Current worker is byte-identical to a workspace rebuild; all bundled source and adapter hashes match 0c4cbdf6. Twenty profiles and their state checks pass.

| Observed inclusive subtree | Duplicate | Verification | Interpretation |
|---|---:|---:|---|
| recomputeDomain | 19.2–19.5% | 15.3–16.0% | Much smaller share than pre-flush profiles; still real work |
| encodeMaterial | 21.4% | 42.2–43.0% | Largest actionable investigation is now in the consumer |
| recomputeCurrentness | 9.6–10.1% | 4.0–4.7% | Includes required identity/currentness work |
| pendingObligations | 6.0–6.1% | 2.9–3.2% | Includes required lifecycle work |
| refreshProjections | 1.0–1.1% | 0.5–0.6% | Small; preserves output/storage separation |
| canonicalEntry | 1.0–1.1% | 0.4–1.0% | Tiny even if all of its cost could vanish |

These are unweighted sample shares; JIT inlining affects attribution and inclusive subtrees overlap. They must not be added, or treated as removable percentages. The earlier 34–38% recomputeDomain shares used different pre-optimization code and denominators; the change in share alone is not an absolute speedup measurement.

Observed verification stacks locate encodeMaterial under publicationPolicy (frozen worker line 6252), including receipt filtering and currentness/grant full-occurrence comparisons. The existing comparisons repeatedly serialize both sides across evaluation/receipt rows. A bounded follow-up can count exact redundant encodings and prototype lazy invocation-local reuse of **full canonical text**, preserving extra fields, descriptor validation, byte limits, conflict detection and control-flow reachability. Do not replace this with the narrower occurrence key or eager validation that changes rejected-input behavior. No persistent registry or cross-wave cache is proposed.

Temporary-array reductions in identity/lifecycle and one-per-invocation code-binding digest reuse are smaller candidates with unmeasured payoff. Even eliminating all of the roughly 1% canonicalEntry subtree could not transform a 440 ms operation into 100 ms; shaving small allocations is not the priority. Domain-selective recomputation or persistent indexing has substantially greater semantic/ordering complexity and is outside this diagnostic.

Recommended stopping rule for the next investigation: establish repeated work and a semantics-preserving bounded candidate before editing; if it cannot produce an improvement distinguishable from controls across duplicate and verification holdouts, stop optimization and return to qualification/delivery work. This is a workflow recommendation, not a new acceptance threshold. An exact remaining-ms estimate is not justified yet.

## Existing qualification and next project work

No product source changed, so reuse the exact current-HEAD results in causal-flush-copy: 2562 passed, two existing D159 manifest-drift failures, four skipped; 73 existing loaded mutants plus three new-path mutants detected; 9600 transition comparisons including ordered Maps/Sets, restoration and aliases; build/export/types and scoped lint passed. This diagnostic does not turn the historical failures green or expand those tests' scope to all possible consumers.

D169 method qualification remains failed; M was not run. Public graded exports, qualified inbox/factory and B121 human/agent evidence remain unfinished. Owner work still identifies H/L historical-evidence/current-gate repair as a next delivery concern, with formal method fitness separate. If pausing optimization, resume that concrete qualification repair before treating the preset as complete, then resume progressive disclosure and flagship user evidence. No downstream implementation or owner status change is dispatched by this report.

## Replay and artifact trail

The evidence archive contains both fresh maps, all cold attempts, current CPU profiles, exact source/bundle/inputs, provenance and tools. After extracting, run:

```sh
python3 tools/audit-causal-global-review.py before after
python3 tools/verify-causal-global-cold.py cold-v2
python3 tools/verify-causal-remaining-cpu.py cpu
python3 tools/test-causal-global-review.py .
python3 tools/test-causal-remaining-cpu.py cpu
```

Independent audit hashes bind captured bytes and verify shapes/arithmetic; only the separately executed build/git checks establish source-to-worker provenance. Four new reindexed corruptions and four existing CPU corruptions are rejected. A read-only reviewer checked method scope and remaining-code candidates; no independent full-library equivalence claim is made. Syntax checks apply to new tools. Fresh archive extraction must reproduce final reports before commit.
