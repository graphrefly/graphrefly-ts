# D171 preparation verification-gap review

Reviewed 2026-09-14 in the isolated latency-review worktree. This review independently inspected `spending-proof-verifier.ts`, `spending-proof-scenarios.ts`, and their worker observations against the approved finite proof plan. The reviewer also authored the plain-host fixture and preparation launcher; this is not an independent blind review of those authored files or a human-study result.

## Findings and repairs checked

- The original verifier checked final host records but did not check the recipient authority's outcome. The added wrong-admission mutation now preserves the successful host record and actual written bytes while requiring the independently observed authority effect to remain pending. Missing-terminal-report additionally checks the authority lifecycle remains false despite a successful effect.
- S3 originally saved pending checkpoints without verifying them. Frozen expected checkpoints now specify ordered transport-request counts, and the worker projects actual checkpoints into that exact schema. The independent verifier checks these counts, including the preverification boundary.
- Pre-grant qualification uses actual observed business and request material from each candidate. It does not substitute the oracle's expected request for the candidate request. Missing-business and missing-current cases remain non-writable.
- Preparation now imports a separate frozen verifier bundle and recomputes every verdict from the frozen scenario, actual trace, and memory readback. Its runtime dependency closure is limited to the verifier and independent numeric oracle. Mutations cannot edit verifier/oracle dependencies. Worker `passed` is not the sole acceptance criterion.

No remaining concrete blocker was found in these reviewed finite paths after the repairs. This statement does not extend to unreviewed runtime behavior or the full B121 program.

## Final offline evidence

Final retained attempt: [attempt-2026-09-14T20-26-15-335Z](../../../archive/evals/causal-host-proof-preparation/attempt-2026-09-14T20-26-15-335Z/summary.json).

- 23 frozen scenarios × 2 arms = 46 independently verified memory runs passed.
- All 23 actual Graph descriptions retained identical node IDs, factory names, and edges, including loaded numeric and runtime mutations. Plain has no Graph topology.
- The loaded score mutation changes actual numerical/business results and is rejected before writing. The exact BigInt equivalent rewrite passes request-byte verification. Missing business, missing terminal, and wrong admission outcome mutate actual loaded sources. CLI-title before/after source bytes are retained separately and explicitly outside the executing closure.
- Source closure raw/loaded hashes, runtime bundle hashes, verifier/scenario bundles, lockfile, Node executable, launcher, and future executor bindings were checked. A post-run read-only check confirmed the manifest's bindings still matched disk.
- Manifest SHA-256: `68e6fbcc564fb6ddc48c9780faa9f61de9c378f0f44075349233e145465a7ec3`.

| Quantity | Frozen expected / bound | Observed memory execution |
|---|---:|---:|
| Host requests reaching held proof transport | 30 | 30 |
| Full host-request bytes | 7,932 | 7,932 |
| Underlying write calls released by full/short settlement | 26 | 26 |
| Underlying bytes / independent memory readback | 6,338 | 6,338 |
| Total maximum calls for a future approved batch | 2,944 | Not a utilization claim |
| Total maximum bytes for a future approved batch | 12,058,624 | Not a utilization claim |
| Total maximum child wall time | 1,380,000 ms (23 minutes) | Not a performance measurement |

Host requests and underlying writes are distinct: short writes release one byte; injected rejection and unreturned requests do not release an underlying write. The launcher verifies underlying events against the frozen settlement schedule.

The future manifest names an absent fresh directory, `/Users/davidchenallio/src/graphrefly-ts-latency-review/latency-inputs/proof-7dc208e850ee10af`, and all 46 exact destination paths. No inbox directory was created and no local inbox execution occurred. The executor was read and its bindings checked; it was not invoked.

## Preserved attempt history

- `20-21-41-018Z`: construction failed because the original proposed absolute destination IDs exceeded the existing 128-byte schema bound. Concurrent scenario edits also invalidated source binding. The raw attempt was moved unchanged into archive; its historical embedded paths remain historical. These are preparation failures, not business mutation kills.
- `20-24-29-301Z`: all 46 memory arms passed; superseded by the final host observation-metadata correction.
- `20-25-30-682Z`: six additional launcher checks incorrectly equated held requests with underlying writes. The independent business verifier passed, but the preparation correctly remained failed. The check was corrected to follow frozen full/short/reject/unreturned settlement semantics.
- `20-26-15-335Z`: final 46-arm pass with source binding and corrected transport-event verification.

The evidence is finite offline preparation. It proves neither real-file effects nor fsync/crash durability, formal performance qualification, arbitrary algorithm equivalence, a blind human/agent study, or B121 completion. Future real execution requires separate explicit approval of the exact manifest.
