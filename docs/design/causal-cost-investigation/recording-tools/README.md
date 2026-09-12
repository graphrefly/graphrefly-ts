# Recording intervention tooling qualification

2026-09-12 · `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS` · baseline `bfe68ef3`.
User continuation authorizes preparation and offline qualification of the
[recording intervention](../recording-intervention.md). No performance capture was executed.
This does not replace D168/D169 or qualify cold construction.

## Prepared behavior

Private EAGER/DEFERRED drivers derive from the independently checked CPU workload.
The original sample push and cold construction/cleanup loop are preserved; DEFERRED moves
only sample stringify/append into finalization, retaining one append per sample.
Both arms retain block CPU observations, with no GC observer, and bracket the complete sample
sequence including all sample JSONL output. DEFERRED separately brackets flush. Diagnostic
sidecar/completion file publication occurs after that interval and is not included in its CPU/wall
numbers; the supervisor still monitors these files and process exit for all resource ceilings.

The same two byte-identical but separately imported reference bundles are reused. Preparation
verifies all 60 current source hashes against the prior qualified source closure and verifies the
prior prepared artifact and tool hashes. No consumer import occurs during preparation.

The sample stability premise is supported by the frozen cold source: scalar fields, per-iteration
fresh preparation/action arrays, fresh `process.memoryUsage()` value objects, absent recovery
counts, and no retained run/graph object. Loaded tests capture objects at the **original push** and
compare their serialization after cleanup and later iterations. Test hooks exist only in the test
process; no clone, freeze, extra queue or per-sample instrumentation enters the prepared driver.

Errors preserve the successful output prefix without retries. Catchable factory/cleanup failure
still reaches deferred flushing; write failure and workload failure survive together. SIGKILL can
lose all deferred records. Completion is published only on successful workload, cleanup and output.
There is one flush site; source mutation that duplicates it is rejected.

## Executed checks

Exact commands, exits and logs: [checks.json](checks.json).

| Check | Evidence |
|---|---|
| Loaded planned coordinates | 16 coordinates; 38,400 stub factories/samples; fake clocks; exact cross-condition sample content/order equality |
| Loaded error and stability checks | 42 cases; first/middle/last serialize/write/cleanup failures, business failures, combined errors, exact attempted calls, push-to-finalization object stability |
| Independent source guard | 12 rejected source mutations including changed construction, cleanup, push, output and duplicate flush |
| Process termination | Two stub-only processes SIGKILL at factory 1,200: EAGER retains 1,199 lines, DEFERRED zero; neither publishes completion |
| Independent arithmetic/archive verifier | Synthetic 16-child archive; non-1 ratios; 48 block pairs, eight whole pairs, flush cost included; 21 negative mutations covering identities, completion, scope, sources and resource timestamps |
| Capture admission/stop | Six tests including synthetic full dispatch, early stop, source/runtime drift, approval reuse, existing output consuming the grant without altering existing files, round order |
| Reused resource supervisor | Five existing tests; unchanged 30 s child / 900 s attempt / 256 MiB observed RSS and directory / 1 s gap rules |
| Scoped JS check | Exit 0; two intentional literal-source template-placeholder warnings |

All factory execution in this qualification uses test doubles. There are **zero real consumer
executions and zero performance samples**. Synthetic and loaded test counts are not performance
results. Existing semantic adapter evidence is reused for unchanged, byte-verified bundles.
Full TS runtime tests/build were not rerun because no runtime, package export or bundle source changed.

[Independent review](review.md) found and resolved the verifier import, condition-source digest,
missing test assertions, preparation-claim ordering, and resource timestamp consistency issues.

## Reproduction and remaining boundary

[qualification.json](qualification.json) binds the exact prepared files, tools, source design,
Node 24.18.0 binary, P2 inputs and explicit environment. The archive/index named there are the
portable preparation evidence. [archive-replay.json](archive-replay.json) records hash validation
and offline Python verifier replay from the extracted tool copies.

The next real capture requires a separate human grant bound to this receipt: **one** 16-process,
38,400-sample attempt, four rounds, two conditions, two orientations; 9,600 warmup and 28,800
measured samples, 32 original preflight calls / 96 untimed instances. Preparation failure consumes
the grant. No retry, replacement, formal matrix, provider/live/spend or production change is included.

On a future authorized run, `scripts/capture-causal-recording.py --capture` accepts the prepared
directory, P2 input, approval artifact, this qualification receipt, an unused output directory and
qualified Node binary. Importing/preparing/verifying tools never dispatches that capture.

Claims protect one approval artifact path; copied text is not a new human grant. Hash checks occur
at dispatch boundaries, not continuous OS attestation. RSS observation is periodic, not a proof of
unobserved peaks. Whole/sequence CPU is process-wide, not construction-exclusive; elapsed minus
CPU is not wait time. Deferred output has the demonstrated evidence-durability disadvantage.
