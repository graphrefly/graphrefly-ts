# Recording-path comparison — completed, mixed result

2026-09-12 · baseline `073d4dc3` · `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`.

**The predefined consistent-construction-response rule did not pass.** Moving sample serialization
and writing out of the sequence did not yield a consistent first-batch construction improvement.
Per the [frozen design](../recording-intervention.md), this finite diagnostic ends here. No extra
rounds, recording-policy adoption, library optimization or D169 qualification follows from this result.

## What ran

The user approved one capture after the [qualified tooling handoff](../recording-tools/README.md).
[approval.txt](approval.txt) and its consumed claim bind the unchanged qualification receipt.
All **16 serial fresh processes / 38,400 samples** completed: 9,600 warmup, 28,800 measured,
96 measured blocks; 32 original three-arm preflight calls / 96 untimed instances. Zero retries,
zero replacements and zero not-run coordinates. Both arms use the same reference/reference-copy
consumer, not library-candidate versus plain or reference. No provider/live/spend occurred.

Last child ended at 24.681 seconds from capture start; maximum observed process RSS was
205.922 MiB, observed run-directory size 20.651 MiB, and observation gap 0.131 seconds.
These are whole Node evaluation process figures, including runtime, modules and retained samples;
they are not memory attributed to the library or individual graph. Observation does not prove
unobserved peaks. All frozen monitored limits passed.

## Fixed comparison

Ratios are DEFERRED/EAGER paired within round, orientation, batch and position. Values below one
mean lower measured cost. All coordinates, warmup and four-round ranges are retained in
[analysis.json](analysis.json); [summary.json](summary.json) is reproducible with [summarize.py](summarize.py).

| First-batch metric, 16 pairs | Minimum ratio | Median ratio | Maximum ratio | Pairs below 1 |
|---|---:|---:|---:|---:|
| Construction p95 | 0.7312 | 0.9852 | 3.1829 | 10/16 |
| Construction sum | 0.7936 | 0.9636 | 1.6381 | 13/16 |
| Common sequence span | 0.6630 | 0.8374 | 1.6375 | See complete coordinate data |

The frozen action criterion requires both construction p95 and sum to be lower in **all four
rounds for all four first-batch orientation/position coordinates**. It fails; median reductions do
not override the inconsistent directions. Across all 48 measured pairs, the p95 ratio median is
0.9686 and construction-sum median 0.9675, also descriptive rather than formal acceptance.

The worst p95 pair is round 0 / V / first batch / first position: DEFERRED child 00 has
**1.414250 ms**, EAGER child 02 has **0.444333 ms** (3.1829×). DEFERRED p50 is also higher,
0.422750 versus 0.330041 ms. This slow block occurred without per-sample JSONL writes inside
the sequence. It shows that such writes are not necessary for this observed slow tail; it does not
identify VM/scheduler/GC causation, prove zero recording interference, or establish the same cause
as earlier diagnostic tails. The first dispatched process is retained, not excluded as an outlier.

## Include the moved work

Eight whole-interval pairs include the complete sample sequence and every sample output write.
Their elapsed-upper ratio spans **0.8013–1.1346**, median **0.9370**; user CPU ratio spans
0.8691–1.0660, median 0.9636; system CPU ratio spans 0.6329–0.8389, median 0.7974.
Thus whole cost can improve in this capture but is not uniformly lower. These are process-wide
CPU figures, not construction-exclusive cost, and elapsed minus CPU is not wait time.

DEFERRED flush itself takes 106.752–123.166 ms (upper bound), median **109.269 ms**. That cost
is included in the whole figures. Median whole elapsed upper is 1,166.019 ms for EAGER and
1,091.137 ms for DEFERRED; medians of absolute costs are distinct from medians of paired ratios.
Diagnostic/completion sidecar publication follows this sample-output interval; resource supervision
continues through publication and process exit. Both conditions use the same interval convention.

The frozen classification is **mixed**, so this result does not prioritize further optimization of
the recording path. Deferred logging also retains its demonstrated loss-of-evidence risk on strong
termination. Keep the current formal logging method; do not repeat this comparison seeking agreement.
The previously measured library optimization remains separate evidence; formal cold qualification
and the larger work item remain incomplete.

## Reproducibility

[receipt.json](receipt.json) binds the exact approval, consumed claim, command, qualification,
reservation, raw archive and independently recomputed analysis. The archive index lists every file.
[archive-replay.json](archive-replay.json) verifies all extracted hashes and exact analysis equality
using the retained verifier copy; replay launches no consumer. Existing workspace changes were
hash-preserved. No tool or production source changed during this attempt.
