# Cleanup segment diagnostic v1 — completed bounded attempt

Owner: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. User confirmed proposal `7c36483a`, §§2–6. `approval.json` binds the unchanged design digest and one 12-process / 28,800-sample / 900-second / zero-retry capture. No library, public API, wave protocol, D168/D169 threshold, formal matrix or provider/live/spend change.

## What this established

All 12 scheduled B/S/D processes completed in **20.952835 seconds**, with **28,800 raw samples**, **19,200 sidecars**, **9,600 deep sidecars**, no retries and no not-run rows. Every row passed independent verification before the next dispatch. The 239-file archive also passed full replay in a fresh directory using both the workspace verifier and its archived copy. Independent JS arithmetic checked all 19,200 sidecars against the report.

For the **1,800 measured samples per D process**:

| Position / cell | Whole cleanup ms | group.release ms | release / cleanup |
|---|---:|---:|---:|
| 2 / D-U | 229.055 | 171.160 | 74.72% |
| 5 / D-V | 225.737 | 169.112 | 74.92% |
| 6 / D-V | 226.917 | 170.544 | 75.16% |
| 9 / D-U | 223.958 | 168.990 | 75.46% |

In those observed processes, cleanup is 50.32–53.64% of **phase elapsed minus original construction elapsed**. Other measured totals are record 106.87–132.61 ms, yield 73.55–76.54 ms, both memory reads combined about 11.96–13.12 ms. Within cleanup: disconnect/roots about 20.18–21.28 ms, group-create-and-describe 19.88–20.16 ms, membership 13.28–14.68 ms. Inner durations are nested; they are never added to outer totals. Phase edge / between-sample / within-sample residuals remain explicit and satisfy the complete phase accounting identity.

This makes **group.release as a whole** the next concrete localization target. It does not identify its quadratic safety checks as the exclusive cause: release also performs runtime/owner teardown. All guards and failure atomicity remain intact.

## Instrumentation limits

Matched measured coordinate ranges (each phase/slot/batch/orientation retained, no averaging away tails):

| Pass | S/B original construction p95 | D/S original construction p95 |
|---|---:|---:|
| 0 | 0.9033–1.0727 | 0.8876–1.1545 |
| 1 | 0.9258–1.0354 | 0.9410–1.1737 |

Thus observation/confounding remains unresolved. The cleanup shares above describe **D instrumentation**, not a proven uninstrumented cost share or production slowdown. The experiment does not establish the cause of original cold construction p95, certify zero observation cost, qualify D169, or demonstrate graded-entry ergonomics. No GC or scheduler attribution, event-duration subtraction, overhead correction, new significance threshold or automatic optimization follows.

`matched-comparisons.csv` preserves both p50 and p95, raw sums and every warmup/measured coordinate. `independent-verification.json` retains all phase CPU/thread/process and segment distributions; `analysis.json` contains totals and matched ratios. Thread/process CPU stays separate, including permissible P>W and negative W−T.

## Implementation and checks

Private source only: `scripts/derive-causal-cleanup.mjs` performs bounded transformations of frozen material; `causal-cleanup-observer.mjs` stores sample-local sidecars; `causal-cleanup-diagnostic.py` enforces the single-use run; `verify-causal-cleanup.py` independently checks source reversal, admission, raw identity, chronology, intervals, complete/incomplete inventory and arithmetic. S/D share exact derived bytes; B keeps frozen driver and both original reference modules. A diagnostic failure still attempts cleanup and retains primary/cleanup/observer errors.

- Loaded fake-clock/factory qualifications: 12 positive cases, 8 actual loaded mutations. Source checks: 6 negatives, 3 generated-entry modes. Four preparation refusals and 8 zero-dispatch inventory negatives.
- Four synthetic S/D×U/V sets cover 66 interval negatives; a fabricated full batch and failed-last-row exercise 6 whole-job identity/inventory/failure negatives. These are synthetic validation data, **zero real consumer constructions**.
- Prior CPU regression: 17 positives, 15 negatives, 12 loaded mutations, 29 Python negatives. One redundant standalone Python invocation omitted its required arguments and failed before testing; its log is retained. The correct invocation already passed through the JS regression harness. This was not a capture retry.
- Static QA: five findings fixed and both reviewers cleared. Fixes cover diagnostic errors, pre-dispatch bindings, failed-row identity, closed inventory and phase residual accounting.
- Full TS: **2547 passed / 2 existing D159 frozen-manifest failures / 4 skipped**. No all-offline-green claim; no manifest regeneration. Lint and governance pass, with existing repository warnings retained. No public API change requiring a package rebuild.
- Root's six preexisting dirty files and all 15 prior qualified CPU tool sources remain unchanged.

## Replay and stopping point

Verify the outer archive/index hashes from `receipt.json`, extract the indexed regular files into a fresh directory, then run:

```sh
python3 -B <fresh>/run/source/scripts/verify-causal-cleanup.py <fresh>/run
```

The verifier is read-only and retains the original execution-root identity when relocated. `verify-segments.mjs <retained-run>` provides the independent JS segment arithmetic check; `analyze.py` rebuilds the report from the independently verified evidence. Neither dispatches consumers.

This diagnostic batch is complete; the same product work remains incomplete and D169 remains method-not-qualified. The one-use grant is exhausted. Next work can inspect the release path and identify a minimal discriminator for its internal costs; no optimization or further capture is authorized by these results.

User ownership remains unverified. Handoff: given unchanged frozen input, compare baseline/outer/deep modes; verify source and raw evidence; report the observed release share without converting it into a cold-p95 causal claim. Recall questions: Where is the private entry? Which three stages produce evidence? What keeps the original timer intact? How are simultaneous failures retained? What remains unproved by the release share?
