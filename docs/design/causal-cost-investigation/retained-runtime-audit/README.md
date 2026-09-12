# Retained runtime-log audit

2026-09-12 · `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS` · evidence baseline `4ca15c37`.
The user's continuation authorizes existing-evidence analysis and investigation-plan maintenance.
No consumer, new profiler, capture, production change or new execution authorization occurs here.

## Question and result

Does the slow first-position block in recording child 00 have a distinctive whole-process native
log signature compared with all other 15 retained children? [analyze.py](analyze.py) verifies each
read artifact against the immutable recording archive index. It extracts all native `code-deopt`
records and stdout GC/bailout lines without aligning their clocks to the sample clock.
Full rows and exact bundle source lines are retained in [report.json](report.json).

| Whole-process log quantity | Child 00 | Other 15 min / median / max |
|---|---:|---:|
| Parsed GC event lines | 98 | 100 / 102 / 103 |
| Sum of GC main-duration numbers printed by the trace | 80.98 ms | 51.27 / 54.39 / 67.82 ms |
| Maximum printed GC main-duration number | 5.38 ms | 3.33 / 3.50 / 13.04 ms |
| Stdout bailout lines | 27 | 26 / 28 / 29 |
| Native `code-deopt` records | 60 | 59 / 62 / 63 |

No native source-position/kind/reason combination in child 00 is unique to that child.
The two deopt counts are **separate channels and are never added together**. All detected GC lines
parsed; counts were independently checked against raw prefix matches.

This supports prioritizing **time-aligned runtime attribution**, rather than a specific deoptimized
function or another registry change. GC totals are a clue, not a cause: the logs cover preflights,
warmup, all six blocks, flush and teardown, whereas the slow p95 concerns one measured block.
More GC-reported time could be a consequence of a generally slower process. Its largest individual
GC duration is not the largest among the processes. Neither count nor total determines overlap
with the slow constructions, construction-exclusive CPU, scheduling waits, or removable work.

The native trace and sample clocks have no qualified alignment; this audit deliberately reports
**no overlap percentage or exclusive time**. Bundle positions identify emitted code and namespace,
not stable graph node identities or original-source call counts. No claim that GC explains the
1.414250 ms p95, that JIT is irrelevant, or that memory leaks exist follows from these observations.

## Next investigation boundary

The smallest unresolved question is: **during the specific slow construction intervals, which
part is active execution in the consumer/library, which overlaps runtime collection, and which is
not explained by those observations?** Process-wide CPU and whole-process GC totals cannot answer it.

Before another capture can be proposed as ready, a private tool design must demonstrate:

1. One bounded timeline for constructor windows, GC events and sampled CPU stacks, including
   timestamp origin, unit, alignment uncertainty, delivery loss and unresolved native/idle frames.
2. Function/source attribution separated by the two module namespaces, with shared runtime/harness
   work separate. Preserve source hashes. Function samples do not automatically identify graph nodes.
3. A matched unprofiled condition quantifying observer interference; no reuse of old unprofiled
   samples as denominators. A profile is explanatory evidence, never a formal performance score.
4. Fixed workload/process/resource ceilings and finite stopping rules before execution. If no slow
   interval appears or attribution remains ambiguous, retain unknown and stop; do not keep sampling.
5. No optimization unless a concrete repeated operation is identified and its semantic proof closes.

This is an **evidence requirement**, not a frozen new method, granted capture budget, or automatic
request to implement an entire profiler. OS scheduling attribution may remain unavailable; it must
stay unknown rather than be computed as elapsed minus process CPU. Public library profiling and
additional user concepts remain out of scope.

## Reproduce

From the repository root:

```sh
python3 -B docs/design/causal-cost-investigation/retained-runtime-audit/analyze.py
```

It reads retained files, verifies their hashes and prints the report; no Node process or consumer is
started. Raw recording artifacts and earlier receipts remain unchanged.
