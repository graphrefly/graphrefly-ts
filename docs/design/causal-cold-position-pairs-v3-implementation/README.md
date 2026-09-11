# Cold position-paired v3: method not qualified

The user confirmed design commit `739145d1`. TS evaluation-method decision D169 adopts the immutable [design](../causal-cold-position-pairs-v3.md), partially replacing D168 only for 12 cold rows. [Approval](approval.json) separately authorizes section 5: private tooling, offline qualification, one bounded Z/M attempt, independent replay, archive and commit. This batch is complete; `CAUSAL-PRESET-ASSEMBLY-TS` remains incomplete.

**The one actual attempt completed Z and failed its fixed criteria. M was not run.** This is a valid negative method-qualification result, not a consumer performance result. The [independent verifier](verifier-result.json) independently reconstructs all sample coordinates, block p95 values, same-position ratios, pair statistics and panel intervals. [Receipt](receipt.json) binds the sources, approval, qualification and portable evidence.

## Actual result

- 40 serial fresh processes, 20 complementary pairs, 96,000 samples: 24,000 warmup and 72,000 measured.
- 68.54501149999851 seconds including runner preparation; 80 original untimed preflight calls construct 240 instances separately from those samples.
- All 40 Z jobs completed. All 40 M jobs remain not-run. Zero retries; the preregistered unused M order was not repurposed.
- Both timed slots use identical reference code. Three of four control pairs fail the inclusive `[1 / 1.05, 1.05]` band.

| Control pair | First-position g | Second-position g | Stable |
|---|---:|---:|---|
| 0 | 1.040759 | 0.516278 | No |
| 1 | 0.473370 | 1.025464 | No |
| 18 | 1.040129 | 0.998708 | Yes |
| 19 | 0.875267 | 0.995151 | No |

The 16 main identical-reference pairs also fail the frozen interval criteria:

| Statistic | Lower | Point | Upper |
|---|---:|---:|---:|
| First position | 0.875467 | 0.996407 | 1.098512 |
| Second position | 0.608706 | 1.016339 | 1.516863 |
| T, worse position | 0.992596 | 1.064706 | 1.516863 |

For each pair and position, g is the median of three same-batch, same-position C/R p95 ratios across complementary U/V processes. T is the greater of the two g values. Each interval uses the second and fifteenth sorted values from 16 pairs; the point averages the eighth and ninth. Z requires all three intervals wholly inside the same 5% band, as well as stable controls. These are the approved arithmetic and stopping criteria, unchanged after collection.

Checking both control positions matters: T alone would hide downward departures in pairs 0 and 1. Absolute batch p95 values, all ratios and both positions remain in [analysis.json](../../../archive/evals/causal-cold-position-pairs-v3/analysis.json). No sample was discarded, corrected by a control, pooled with an earlier attempt or averaged into a different verdict.

This attempt establishes that matching positions across fresh processes did **not** restore the required repeatability. It does not establish that the consumer, registry or architecture C is slower by any of these ratios: both Z arms are the same reference implementation. GC/deopt traces are retained, but their native clocks remain uncalibrated; event association and the mechanism behind the variation remain unknown. A single cost or production regression cannot be inferred.

## What was implemented and checked

Six new private scripts implement the preregistered schedule/runner, source-derived driver, independent AST checker, independent raw-data verifier and offline tests. Library code, exported APIs, wave protocol and existing frozen evidence were unchanged.

The generated driver preserves the original timed-loop body except for the approved arm-order declaration. Both slots call the same factory site through checked module namespaces. The positive-control adapter performs an additional real reference construction and cleanup inside the timer before returning its ordinary instance. Its functional behavior was qualified offline, but its M performance panel was not executed because Z failed. No plain timing process or formal consumer matrix ran.

[Qualification](qualification.json) binds all 11 executed tool/helper source digests and six log/review digests before measurement:

- 23 loaded driver/entry cases, 23 AST negative cases and nine loaded source mutants passed, including work moved outside the timer and swallowed cleanup.
- Three real adapter/oracle cases passed: control and main each create/clean three instances; mutation creates/cleans four. Returned business outputs, evidence and obligations agree with the frozen oracle/plain comparison; detach retains obligations and reconnect works. These are functional checks, not performance samples.
- Eight Python tests with 72 negative cases passed, including hand-calculated unequal-denominator arithmetic, inclusive 5% boundaries, strict M 1.20 boundary, copied PID/time-origin, hidden M artifacts, malformed raw samples and operational failure evidence.
- Historical block/history, neutral-driver, crossover and repetition-tool regressions passed. Two independent static reviews ended with no remaining actionable findings; [reviews](reviews.json) retain the repairs.
- Lint/layer/typecheck passed. The full TS suite recorded **2,547 passed, two failed, four skipped**. Both failures are the existing D159 frozen implementation-manifest mismatch in `solutions-agentic-memory-work-item-root-eval-topology.test.ts`; the suite is not all green. No frozen manifest was rewritten. Build was not repeated for these private-tool-only changes.

The single-use runner freezes all 80 job coordinates before dispatch, preserves source/approval bindings and child/wake/deadline failures, and stops after failed Z. The independent verifier reads archived samples and parses source; it does not execute a business consumer. Successful verification means the recorded verdict is supported, not that the method passed.

## Evidence and replay

[Portable archive](../../../archive/evals/causal-cold-position-pairs-v3/evidence.tar.gz), [file index](../../../archive/evals/causal-cold-position-pairs-v3/artifact-index.json) and [archive proof](../../../archive/evals/causal-cold-position-pairs-v3/archive-proof.json) retain 635 files, including every raw child record, process trace, reservation, generated entry, source snapshot, qualification log and result. All indexed bytes were checked after fresh extraction and the independent replay produced the identical verdict and 96,000-sample count. The compressed archive is 4,794,033 bytes.

From this repository, extract the archive into a fresh directory after checking its index, then run:

```sh
python3 scripts/verify-causal-position-pairs.py /absolute/path/to/extracted/run archive/evals/causal-performance-repetition-v2
```

Replay needs the pinned repository verifier/helpers, TypeScript parser and original repetition-v2 archive. Historical absolute execution paths are checked as recorded text; the extracted run is read from its new location. Replay creates no new consumer measurements. The archive includes source snapshots and the exact qualification logs. The original v1 rejection, D168 control-instability result and earlier diagnostic receipts remain historical and unchanged.

## Handoff

There is no new choice between architectures A, B and C here. The current blocker is reliable cold-performance evidence. D169 is adopted but unqualified; its failure does not authorize a replacement criterion or another attempt. The next useful proposal is read-only examination of the retained absolute distributions and process histories to identify what matching positions left uncontrolled, before another bounded method design. No additional measurement, full matrix or downstream work is dispatched by this receipt.

The unique owner remains `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. No public entry was added, no runtime implementation changed, and no effect/provider/live/spend work ran. Existing root-workspace changes were preserved. Graded entry hiding, human/agent ergonomics and user teach-back remain unverified. The following retrieval prompts make the handoff reviewable; they are not a new approval gate or a repeated questionnaire:

1. Which two executable implementations did Z compare, and why can this result not quantify registry overhead?
2. How do same-position q, pair g and worse-position T differ?
3. Which control failures would T alone conceal?
4. Why is the extra-construction adapter functionally checked while its M performance sensitivity is still unproven?
5. Which artifact reproduces the failure without running a consumer, and what must be resolved before another performance qualification?
