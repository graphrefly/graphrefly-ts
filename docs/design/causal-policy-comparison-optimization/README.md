# Publication policy: invocation-local full canonical comparison

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS / D160. User approved continuing from the measured comparison prototype to implementation and verification. No new API, protocol, acceptance threshold, persistent registry or cross-wave cache. Existing unrelated worktree edits remain untouched; no owner status is advanced.

## Product behavior

Only the five full-canonical comparisons inside publicationPolicy reuse encoded text. The scratch Map is created lazily on the first successfully encoded operand and discarded when the synchronous callback finishes. First-use encoding uses the same canonicalMaterial function and default size limit; complete text, left-to-right evaluation, short-circuit reachability and failures are preserved. Failed encodings are never stored.

The premise was verified through the sole production caller: checkInput canonicalizes and parses passive JSON, validates and deeply freezes frames; evaluation objects retain those snapshots. validateBinding creates a separate frozen binding snapshot. These operands cannot mutate during this callback. The helper does not rely on TypeScript readonly alone, does not receive a persistent cache, and does not change any emitted or retained product object. No user gains a new configuration or concept.

A separate one-character non-null type assertion repairs the prior projection refresh type error: the immediately preceding recompute creates evidenceRef whenever it creates this retention gap. Esbuild transformation checks prove transition.ts emits identical JavaScript before and after that annotation. It is not another runtime optimization or behavioral change.

## Actual product timing

The existing 30-process diagnostic now bundles actual edited TypeScript source, not injected prototype code. Its baseline rebuild matches the previous frozen baseline byte-for-byte. All other bundled source matches git HEAD4596c069 except the explicitly verified JavaScript-identical transition annotation. Source hashes, before/after bytes, inputs and preparation provenance are retained.

| Profile/action | Before median ms | Product median ms | Paired ratios |
|---|---:|---:|---|
| P3 verification | 9.98 | 6.59 | .6239 / .8161 / .6597 |
| P6 initial sequence | 451.89 | 395.16 | .8701 / .8757 / .8745 |
| P6 duplicate two DATA | 436.96 | 437.49 | 1.0019 / .9988 / 1.0008 |
| P6 verification | 145.02 | 85.99 | .5862 / .5962 / .6045 |

P6 before/before second-block controls: initial .9982, duplicate .9882, verification .9966. Verification improves about41% and initial about13%; duplicate has essentially no change, consistent with the prior zero target-comparison count. P1 verification .366 → .409 ms is a small adverse observation, with mixed pair direction and no P1 identical-code control; do not claim every row improves. P3 initial/duplicate also have non-improving individual pairs. Every observation is retained in timing.json.

Method unchanged: P1/P3/P6 × initial/duplicate/verification × three alternating-order process repetitions, plus three P6 identical-code order controls; one warmup and three measured actions per arm, 180 measurements and60 original preflights. No task-owned tests/build/profile/audit overlapped capture. Setup, assertions and cleanup are outside clocks. Controls reuse a module and include additional warming. These finite diagnostic medians do not qualify p95, memory or an end-to-end100ms experience; heavy initial and duplicate paths remain hundreds of milliseconds. D168/D169 formal qualification remains incomplete.

## Behavior and review

- New real-consumer test rejects a same-occurrence-ID grant with wrong sourceRefs, verifies that mutating the caller's raw frame cannot change accepted facts, then requires an explicit replacement frame to recover the second admission. Ordered admission output is exactly first occurrence then second; duplicate arrival does not repeat settled policy rows.
- Nine paired actual-bundle workflows cover P1/P3/P6 initial input, delayed verification and wrong-then-replaced grants, followed by duplicate arrival and reconnect. Compare complete authority state and complete ordered publicationPolicy frames after each input step, plus retained state across reconnect. This complements existing tests; it is not a general alias or all-node output proof.
- Existing consumer runtime qualification: baseline passes and17 actually loaded mutants are detected. New loaded `policy-grant-identity-bypass` mutant is detected by the new test; final baseline and this mutant were rerun after type/test repairs. This is runtime assertion failure, not a failed compile or unmatched text anchor.
- Two independent read-only source reviews found no reachable regression, including input immutability, replacement, exceptions and callback lifetime. A third delegated reviewer could not start because of the agent limit; the verification-gap lens was performed locally. Do not claim three independent reviews.

## Checks, repairs and remaining gaps

Full offline suite:2563passed, two existing D159 manifest-drift failures, four skipped. The initial intended targeted invocation used `vitest run -- ...` and ran the full suite; retain it as the full run, not as a targeted-only receipt. Final correctly selected consumer/projection tests:102passed. Final package test types, example typecheck and async-boundary checks pass. Six authored/changed source and tool files pass scoped Biome. Full root Biome remains non-green (323errors in that run, including accumulated diagnostic artifact formatting); no blanket formatting or unrelated worktree modification was applied. Whole-work completion is not claimed.

Initial typecheck caught two readonly raw-test mutations; the test now constructs mutable caller data explicitly. It also found the prior optional evidenceRef spread error, fixed with the justified type-only annotation above. Initial/final logs are retained. An initial attempt to invoke a Python runner with Node failed before dispatch; the corrected Python invocation is the only timed attempt. timing-v1 is preparation-only, superseded by timing-v2 after source/type repair. No timed retry or sample exclusion occurred.

No public export changed, so no new package build is claimed or required for this consumer-only runtime change; the paired source builds and strict type checks verify the actual change. Historical build/export evidence remains separately scoped. Root H/L qualification repair, D169 method fitness, graded exports and B121 human/agent acceptance remain unfinished.

This focused optimization is ready to retain. Recommend pausing additional small performance edits and returning to the qualification/delivery gaps, while explicitly retaining the unresolved heavy duplicate latency. The new result does not authorize changing wave grouping, dropping facts, weakening admission or introducing persistent indexes to reach100ms.

## Evidence replay

Archive includes timing-v2, preparation-only v1, source/input/provenance, full and targeted logs, old/new/final loaded mutation receipts, and replay tools. Fresh extraction independently recomputes timings and corruption negatives, then executes the nine ordered-output/authority workflows:

```sh
python3 tools/verify-causal-policy-prototype.py timing
python3 tools/test-causal-policy-prototype.py timing
node tools/verify-causal-policy-ordered.mjs timing
```

Hash/inventory/arithmetic verification does not independently rebuild source; preparation assertions and source review supply that provenance link. Prior unchanged engine mutation/alias evidence remains in causal-flush-copy and is not relabeled as newly run. No provider/live/spend or external effect execution occurred.
