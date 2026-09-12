# Fixed-workload diagnostic: tooling qualified, capture not started

Owner: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. Implements the private tooling preparation
approved by the user's continuation after design commit `3d0f4a6e`.
[Design](../fixed-workload-diagnostic.md) and [qualification receipt](qualification.json).

The three derived drivers, observer sidecar, bounded supervisor, explicit capture entry and
independent child/whole-run verifiers are implemented. **No real performance samples were collected.**
This does not repair D169's failed Z qualification or prove another library performance gain.
No library source, public export, wave behavior or graph lifecycle changed.

## What was verified

| Evidence | Result and boundary |
|---|---|
| Source allowlist | 56 cases passed, including 46 generated-source mutations. Independent inversion and the existing D169 AST checker reject changes to factory/clock/record/cleanup boundaries. |
| Loaded drivers | Final run: 37 cases, all 24 planned condition/orientation/round coordinates, 57,600 **stub** instances/samples with fake clocks. Every sample's ordering checked; emitted child artifacts independently recomputed. |
| Independent arithmetic | Eight child tests with 27 negative cases. p50 is conventional median; p95 is nearest rank. CPU greater than elapsed is valid; overlapping GC uses union, not sum. |
| Whole-run replay | Full synthetic 57,600-sample run and 16 negative cases. Checks all assets, coordinates, PID/timeOrigin, flags and observed limits; reports 144 blocks and all 96 contrasts using the common sample span. |
| Supervision and entry | Five supervisor tests, including stopping at each of 24 coordinates and inclusive resource limits. Four capture tests cover complete fake dispatch/replay, failure/not-run retention, source/runtime drift, path aliases and same-approval reuse rejection. |
| Real adapters | Three untimed qualification attempts, nine instances each including plain instances: **27 total**. The first failed in qualification comparison code; corrected and final flags/environment checks passed. No 2,400-sample real loop ran. |
| Real observer channel | One bare-Node tool probe, 100,000 allocated objects and two forced GC calls; finite drain observed valid GC entries. No Graph or consumer import. This is not a complete-VM-observation proof. |
| Portable package | All **89 files** verified after fresh extraction; archived Python whole-run synthetic replay passed without a real consumer. |

Original failures and repairs are retained in [review](review.md), qualification logs and adapter
result files. Initial stub fault-case setup missed ESM mock synchronization; initial adapter checking
double-serialized already canonical evidence. Source review found escaping observer cleanup errors;
capture review found insufficient scenario/runtime rechecks and approval reuse across directories.
All were fixed within this tooling scope. The captured logs distinguish these repairs from consumer results.

## Boundaries that remain explicit

- BASE retains the original checked loop. CPU checkpoints surround whole warmup/measured blocks;
  they include yielding, memory reads, logging and cleanup. CPU_GC adds a separate observer condition.
- Process CPU is not construction-exclusive CPU. No elapsed-minus-process-CPU scheduling claim.
  GC events describe a captured subset; native trace/deopt clocks remain unknown.
- Fixed future capture: **24 serial fresh processes / 57,600 samples**, with 100 warmup + 300 measured
  per slot, 30-second child / 15-minute total ceilings, observed 256 MiB child RSS and directory ceilings,
  target 100 ms observations and rejection above a one-second observation gap. No replacement samples.
- Capture checks source, copied scenario, approval/qualification snapshots and Node digest at dispatch
  and final boundaries. This is not atomic OS attestation against a malicious file swap.
- The approval file receives an exclusive adjacent `.claim.json` before preparation. The same file
  cannot be consumed again with a different output directory. Copying approval text does not create
  another human grant; authorization remains the user's explicit instruction for the exact attempt.
- The whole-run verifier verifies recorded evidence, not the meaning or authenticity of approval prose.
  A rejected/incomplete capture keeps its original result and not-run coordinates; the successful-run
  arithmetic verifier intentionally rejects it rather than inventing missing samples.

## Exact next batch

Tooling preparation is complete. The next separately reviewable action is **one capture under the
fixed design**, followed by independent whole-run replay, retained raw evidence, report and commit.
It has not been started. It may finish with no reproduced variation or unknown attribution; such a
result does not authorize more sampling, a replacement acceptance method or a second optimization.

An approval should bind this qualification receipt, its design digest, the planned output directory
and the one-use approval-file path. Preparation failures consume that claim. No approval artifact or
claim for a real capture was created in this batch.

The executable entry is `scripts/capture-causal-workload.py --capture`, with explicit arguments
for extracted prepared assets, scenario, approval, qualification, new output and pinned Node binary.
It never runs on import. The qualification receipt binds all tool/prepared files and an explicit
minimal environment; no dotenv or unrestricted host environment reading is used.

## Reproduce preparation evidence

The [archive](../../../../archive/evals/causal-workload-diagnostic-tools-v1/prepared.tar.gz) and
[index](../../../../archive/evals/causal-workload-diagnostic-tools-v1/artifact-index.json) bind the
prepared source closure, original frozen driver source, generated modules and exact tool sources.
Verify archive SHA-256 and every indexed member before extraction; expected prefix is `prepared/`.
No generated JavaScript needs to be imported to verify those bytes.

From the repository root, these checks use fake data or parse sources only:

```sh
node scripts/causal-workload-source.test.mjs
python3 scripts/causal-workload-verifier.test.py
python3 scripts/causal-workload-run-verifier.test.py
python3 scripts/causal-workload-supervisor.test.py
python3 scripts/causal-workload-capture.test.py
```

The loaded driver test additionally needs the extracted `prepared/frozen-driver-source.mjs` argument.
Node source tests require installed repository TypeScript dependencies. Python whole-run synthetic
tests can also run from extracted `prepared/tools/` using only the standard library.
Do not run the real adapter or forced-GC probe again merely to verify retained results.

Focused Biome checks passed. No production API or runtime changed, so full TS/build gates were not
rerun; earlier historical TS failures remain historical. Work remains incomplete. Graded public
entry hiding and human/agent usability still require their own evidence.
