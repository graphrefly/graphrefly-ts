# Current source readiness and cold-method qualification

Owner: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. Evidence continuation on 2026-09-12,
source checkpoint `a27580a9`. No new decision, method, sampling or implementation.

## Concrete finding

All **60 current harness source files match the archived optimized C revision byte for byte**.
The candidate builder imports 42 files; the reference builder imports 40; 35 are shared, including
`packages/ts/src/solutions/causal-occurrence/identity.ts`, where the optimization landed.
These are bundler module closures, not executed-path counts, node counts or cost attribution.
Type-only imports are not included. The harness also includes the plain/oracle paths.

Thus the retained before/after result remains tied to current source; another such run is not
justified by source drift. However, the optimization is in code shared by candidate and reference.
It can benefit both arms. The retained 20.8–27.8% candidate before/after action-sum p95 reduction
does not predict the current candidate/reference ratio, nor establish a cold construction result.
No consumer was executed during this source audit.

The actual harness constructs the same Graph/input lanes and construction scope, selects
`buildSpendingPresetNodes` for candidate or `buildReferencePreset` for reference, then uses the
common seal/transfer/start/observation path. The reference's business implementation is separately
authored; it shares the C/runtime floor. It is not the independent plain-code oracle and does not
measure the whole library's overhead against plain code.

## Evidence reuse map

| Evidence | Reuse | Limit |
|---|---|---|
| Currentness comparison source archive and replay | Yes: all 60 current harness inputs match retained C sources. | Different wrapper/timing design from D169; not a preset/reference run. Original verifier correction and pause still apply. |
| Prior semantic/offline qualification | Retain its exact historical source and run identity; this audit does not rerun it. | Source equality alone is not new environment/runtime qualification. |
| D169 Z negative result | Yes, as a historical method-qualification failure. | Both slots execute identical reference; not a production regression. Do not relabel its old bundles current. |
| M adapter functional tests | Yes, as historical evidence that the extra construction/cleanup path operated. | M timing sensitivity remains untested, since Z stopped the run. |
| Older allocation profile | Historical optimization selection only. | Not the optimized runtime's residual profile. |

## Qualification gap: no demonstrated code defect yet

The [D169 attempt](../../causal-cold-position-pairs-v3-implementation/README.md) failed three of
four controls and the frozen Z intervals. The [retained-data investigation](../../causal-position-pairs-retained-audit-v1/README.md)
already checked all 96,000 samples and found temporal clustering, including shifts in block p50.
The final control also failed, so removing the first half would not solve the qualification.

Those findings do not identify a correctable source defect. Available records cannot distinguish
CPU work from scheduling delay or fully align VM events to sample time. The same-source finding
above adds no missing CPU/scheduler/VM evidence. Repeating the arithmetic, swapping order again,
increasing repetitions, or selecting a different averaging rule would not resolve that gap.

The outstanding D169 requirements remain unchanged:

1. Z identical-reference controls and all frozen intervals must qualify under the adopted method.
2. M must separately demonstrate the fixed extra-construction sensitivity, after Z permits it.
3. Only then can current candidate/reference cold rows support the 1.20 budget; separate plain
   absolute timing and the unaffected D168 steady/recovery provisions retain their own boundaries.

No new capture is ready merely because source binding succeeded. No budget, sample deletion,
warmup or statistic is changed here. The work remains incomplete.

## Next action and stopping boundary

The remaining useful step is the previously identified **fixed-workload diagnostic design** for
reference-only timing variation. It must separate block elapsed time from process CPU time,
state what each can and cannot attribute, define VM-clock calibration failure as unknown, and
include an instrumentation-interference control. Fixed sample count, raw retention, stopping
conditions and an explicit execution boundary are required before any run.

This audit completes the source/readiness checklist. It does not start that experiment or choose
a replacement acceptance method. Another source audit or before/after recapture is unnecessary
unless relevant source changes. A second library optimization requires a current, attributable
cost finding; the old hotspot list is not an automatic queue.

## Reproduce without running consumers

From the repository root, use the full `revision` stored in `source-manifest.json`:

```sh
node docs/design/causal-cost-investigation/source-readiness/bind.mjs "$(python3 -c 'import json; print(json.load(open("docs/design/causal-cost-investigation/source-readiness/source-manifest.json"))["revision"])')" > /tmp/causal-source-manifest.json
cmp /tmp/causal-source-manifest.json docs/design/causal-cost-investigation/source-readiness/source-manifest.json
python3 docs/design/causal-cost-investigation/source-readiness/compare.py > /tmp/causal-source-comparison.json
cmp /tmp/causal-source-comparison.json docs/design/causal-cost-investigation/source-readiness/retained-source-comparison.json
```

`bind.mjs` bundles the three entries without importing generated output, verifies every loaded
file against the specified Git revision, and records hashes/roles/external imports. A future
working-source change intentionally rejects replay until the historical checkout is restored in
an isolated directory. `compare.py` verifies the archive against its existing receipt and compares
the source hashes with retained C. Bundle hashes also depend on the recorded esbuild version.
