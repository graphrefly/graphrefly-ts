# Release boundary diagnostic — completed

Approved design: `720f9b18`, causal-release-boundaries-v1 §§2–5. Owner work remains `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`; this diagnostic does not complete its performance acceptance.

The observed release cost is concentrated in the quiescence/subscriber guard interval. Four R processes each contain 1,800 measured samples:

| Position | Guard total ms | Share of whole release | Runtime release total ms | Share |
| --- | ---: | ---: | ---: | ---: |
| 1 R-V | 110.544 | 62.33% | 30.605 | 17.26% |
| 3 R-U | 107.611 | 62.59% | 29.604 | 17.22% |
| 4 R-U | 106.012 | 62.39% | 29.684 | 17.47% |
| 6 R-V | 107.968 | 62.62% | 29.837 | 17.30% |

These are measured elapsed sums, not exclusive CPU costs. The guard interval includes quiescence and subscriber checks; it does not isolate the quadratic active-node scan. Runtime release includes more than dispatcher teardown. Neither result establishes the cause of the original cold-construction p95 rejection.

D retains the prior frozen diagnostic worker. R adds explicit sample-local forwarding and seven clocks outside node loops. No library, public API, registry ownership, wave protocol or release algorithm changed. Matched measured-phase R/D construction p95 ratios range 0.9025–1.1697 in the first schedule half and 0.8387–1.0912 in the second; release p95 ratios range 0.9614–1.1655 and 0.9062–1.0817. These ranges cover matched phases, not confidence intervals. R/D includes the entire instrumentation intervention, so it does not estimate a pure clock-read cost or demonstrate a performance improvement.

The single approved capture completed D-U/R-V/D-V/R-U/R-U/D-V/R-V/D-U: eight processes, 19,200 samples (4,800 warmup, 14,400 measured), 17.501184 seconds including preparation and verification, zero retries, no omitted rows. There were 16 untimed preflights / 48 untimed arms. All 19,200 outer/deep sidecars and 9,600 internal sidecars passed independent verification. Six internal intervals plus wrapper remainder partition the existing whole-release interval without double counting.

The 193-file archive at `archive/evals/causal-release-boundaries-v1/evidence.tar.gz` was extracted into a fresh directory, every member hashed, and replayed with both workspace and archived verifiers. Both results equal `independent-verification.json`. `segment-arithmetic-verification.json` independently checks raw arithmetic in JavaScript. Analysis and matched comparisons are retained alongside this report; no replay generates consumer samples.

Private qualification covers actual extracted release paths, loaded mutations, observer failures, source/entry validation, zero-dispatch admission failures, cumulative prefix inventory and failed-row identity. Both static reviews are clear. Lint passed. Full TS: 2,547 passed, two existing D159 frozen-manifest failures, four skipped; this is not all-offline-green. Frozen source/log hashes, earlier archives and six preexisting root workspace changes were preserved.

Next design target: inspect whether repeated quiescence checks can share graph-scoped facts while retaining exact rejection order, multiplicity, failure precedence and release ownership. This is a proposed investigation target, not an approved optimization or another capture. The current grant is exhausted. D169 performance qualification and graded-entry/human-agent ownership evidence remain incomplete; no further matrix, provider, live or spend execution was started.
