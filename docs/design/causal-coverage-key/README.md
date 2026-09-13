# Coverage query key reuse

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS, governing graphrefly-ts:D160. Baseline5ce56737 in the isolated latency-review worktree. User's standing offline optimization, diagnostic tooling, verification and commit grant applies. No new semantic lock, API, registry, authority record, persistent state or protocol change; existing unrelated edits preserved.

## Bounded source change

The previous shared CPU profiles included emitCoverage canonical serialization during new evidence reception. After sameRef simplification, the scan still serializes its invariant query occurrence for every retained evidence/gap record. emitCoverage now computes that query key lazily once per synchronous invocation; every candidate entry still computes the complete canonical reference key. This scalar goes out of scope with the scan. No object-identity shortcut, retained index, cross-wave cache or removal of source metadata.

Order remains evidence insertion order followed by coverage-gap insertion order. byKind retains the same last-record precedence; required-kind checks, gap detection, frozen output entries and repeated output multiplicity are unchanged. Empty scans still do not validate/encode an unused query. The candidate entry key is evaluated before the first query key, preserving the old failure order for canonical encoding. Incoming facts already pass canonical DATA validation; this is not a relaxation of the admission boundary. The helper remains private.

Keep quiescence full canonical comparison and lifecycle scans unchanged. Ref arrays can carry complete occurrences and additional fields, so field-subset equality would require more than assuming TypeScript shape. This batch isolates the coverage query's redundant encoding, not all remaining overhead.

## Acceptance and review trail

- transitionCausalAuthority -> receiveEvidence/retainEvidence -> emitCoverage remains the same graph-owned authority route.
- evidence.ts: emitCoverage filters using complete refKey equality and retains output semantics.
- solutions-causal-coverage-key.test.ts: differently ordered object fields still match; modified nested metadata does not; evidence/gap insertion order and last-kind precedence remain; two invocations emit two facts; retained state is unchanged; empty scan does not newly throw.
- Existing runtime mutation suite and full TS tests qualify affected behavior. Build/export, test/example typechecks, scoped Biome and async boundary checks apply. Historical D159 manifest failures remain explicitly separate from the change.

## Performance evidence

Reuse the existing initial/verification/sparse/missing-material diagnostic, adapted only to the changed source and allowed function. P1/P6, four recipes, three alternating-order processes per row, three measured samples after warmup,24processes/144samples/48preflights. Actual graph consumer action state and full evidence/authority traces are compared against the before bundle in untimed trials; measured trial state is also checked. AST comparison admits exactly emitCoverage as the changed bundled function. Source, bundle, input and tool manifests bind the attempt.120s child/900s total. No timing runs overlap this task's tests, build or mutation processes.

These are finite diagnostics, not D168/D169 formal qualification or p95. Missing-material is a behavioral negative, not a before/before timing control; this method has no independent repeated baseline timing controls. Repetition agreement therefore does not establish formal significance. P1/P6 are different workload sizes of the same consumer; the shared implementation contains no fixture-specific condition, but global latency benefits across unrelated consumers remain unmeasured.

A first preparation used a lint-rejected assignment expression; fixed before any sampling and prepared the final exact bundle separately. No observations from that preparation exist or are combined with the final run. Raw preparation is retained with the evidence.

## Independent review and provenance repair

Read-only review found no reachable accepted-DATA regression and confirmed production callers use canonical retained snapshots. It identified missing adapter provenance in the reused diagnostic tool. Before dispatch, preparation was extended to retain/hash worker-adapter.mjs and transformed-worker.ts plus esbuild/TypeScript versions. The final capture is causal-coverage-key-v1-bound. The previous two directories are preparation-only, with zero child jobs. Baseline-provenance.json records that the before bundle equals the prior captured after bundle byte-for-byte, the adapter equals the baseline git version, and adaptation of the frozen raw worker reproduces the captured transformed text. The source/bundle AST check allows only emitCoverage to differ. These preparation checks complement artifact integrity; the Python auditor alone does not rebuild TypeScript sources. Rebuilding requires the repository and installed build dependencies.

## Final observations

| Profile | Action | Before median ms | After median ms | Paired ratios |
|---|---|---:|---:|---|
| P1 | initial | 2.585 | 2.357 | 0.9618, 0.9116, 0.9228 |
| P1 | verification | 0.408 | 0.406 | 1.0021, 0.9945, 1.0358 |
| P1 | sparse | 1.551 | 1.410 | 0.9091, 1.1798, 0.8750 |
| P1 | missing-material | 0.305 | 0.322 | 1.0449, 0.9025, 1.0646 |
| P6 | initial | 569.570 | 552.950 | 0.9619, 0.9708, 0.9626 |
| P6 | verification | 190.138 | 178.084 | 0.9410, 0.9366, 0.9366 |
| P6 | sparse | 8.647 | 8.380 | 0.9362, 0.9330, 1.0118 |
| P6 | missing-material | 30.917 | 30.726 | 0.9976, 0.9938, 0.9913 |

These are medians of three per-process medians. P6 initial and verification improve in all three pairs; small/sparse rows include slower observations. Retain this narrowly bounded removal of redundant work, without claiming formal significance or a universal speedup. P6 verification still takes178ms and initial553ms; the performance objective remains open.

Full test run:2557passed/3failed/4skipped. Two failures are the existing D159 manifest drift. The additional D667 cleanup test failed with created=false under the full run; that file has no dependency on this private coverage helper. Its isolated12-test rerun passed unchanged after all performance processes ended. Treat this as an observed timing-sensitive verification incident, not proof of its ultimate cause; preserve the original failed run.73 runtime mutants killed; build/export, types, boundary and scoped lint passed. Coverage tests passed in the full run. No blanket full-suite green claim.

Archive: `archive/evals/causal-coverage-key-evidence-v1/evidence.tar.gz`. It retains final run, preparation-only incidents, source and transformed-worker material, verification tools, reports and all logs. Extract and run `python3 tools/verify-causal-coverage-key.py final` and `python3 tools/causal-coverage-key.test.py final`. Full work and formal qualification remain incomplete; no new owner-ledger record.
