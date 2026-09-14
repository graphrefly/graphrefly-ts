# Publication policy comparison: measured remaining opportunity

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS / D160; unchanged D168/D169 gates. User approved continuing the bounded investigation after the cumulative regression screen. Product code remains 0c4cbdf6 (diagnostic HEAD bf60cf25); no product implementation, API, protocol, persistent registry or cross-wave cache changed. This is attempt/evidence under the standing offline grant, not a durable design decision or downstream dispatch.

## Finding and recommendation

Remaining opportunity is **material on initial/verification work**, not universal. Proceed to a bounded production optimization of publicationPolicy's repeated canonical comparison, then behavior/mutation and timing qualification. Do not continue scattered library micro-optimizations. The disposable prototype demonstrates enough benefit to justify that work, but is not production-qualified.

| P6 action | Baseline median ms | Prototype median ms | Three paired ratios |
|---|---:|---:|---|
| Initial input sequence | 452.32 | 393.33 | .8726 / .8646 / .8713 |
| Duplicate two DATA | 436.27 | 433.55 | .9987 / .9886 / .9964 |
| Verification | 143.76 | 85.08 | .5863 / .5990 / .5829 |

Before/before order controls: initial .9950, duplicate .9838, verification .9960. Verification saves about 59 ms (41% by the aggregate medians), with the same improvement direction in all three pairs and much smaller order-control movement. Initial saves about 59 ms (13%). Duplicate is effectively unchanged and provides the intended no-target-work overhead screen. None of this is a formal p95 result or an end-to-end 100 ms guarantee: initial and duplicate remain hundreds of milliseconds.

P3 verification is 9.77 → 6.57 ms; its three ratios .6200/.8135/.6725 all improve. P3 initial has one non-improving pair (1.0149), so do not overstate uniformity. P1 performs no target comparisons and has mixed tiny changes: verification .394 → .401 ms. There are no P1/P3 identical-code controls, making small changes especially uncertain. Full values and every sample are in timing.json and the archive.

## Exact repetition accounting

The untimed instrumented bundle replaces only five `same()` call sites inside publicationPolicy: receipt occurrence, current occurrence, policy reference, grant occurrence and destination reference. It still executes **both original canonical encodings** and compares complete text. A diagnostic Map records previously seen operand identities only within that invocation; repeated operands must produce the identical text. It neither avoids encoding nor modifies product source.

| Profile/action | Operand encodings | First identities, summed over calls | Repeat identities |
|---|---:|---:|---:|
| P1 initial / verification | 0 | 0 | 0 |
| P3 initial / verification, each | 688 | 81 | 607 (88.2%) |
| P6 initial / verification, each | 18,752 | 578 | 18,174 (96.9%) |
| Duplicate, all three profiles | 0 | 0 | 0 |

Counts are operand encodings (two per equality call), not comparisons. Reuse is counted across all five sites within an invocation; it is reset for each invocation. P6 verification spans three publicationPolicy invocations. Its 4,254,242 cumulative characters are UTF-16 text lengths, not memory allocations or bytes. Count reduction potential must not be mistaken for runtime speedup. The count result particularly corrects the earlier hotspot hypothesis: duplicate's encodeMaterial CPU comes from other paths, not these five sites.

All nine original/instrumented workflows compare authority state after every input step. This does not prove full consumer state, ordered output multiplicity, aliases, or every accepted input shape. The first preparation expected six sites and stopped at the shape guard before loading or executing any sample; actual source has five. The corrected count-v2 is the only result. This failed preparation is not performance evidence.

## Disposable prototype and measurement

The prototype alters only the same five call sites in the exact frozen worker. It uses a lazy, invocation-local Map from operand identity to the result of the **unchanged full canonicalMaterial encoder**; the Map is discarded when the callback returns. Empty/no-comparison calls never allocate the Map. No persistence, graph registration or user-facing entry is added. This is an experimental implementation only, not a claim that identity-based reuse is safe for every accepted input.

P1/P3/P6 × initial/duplicate-two-DATA/verification × three alternating-order process repetitions, plus one P6 before/before order control per recipe: 30 serial processes, 180 measured actions, 60 original business preflights. Each arm has one warmup and three measured fresh instances. Setup, preflight, state comparisons and cleanup are outside clocks. No task-owned tests, builds, profiles or audits overlap this timing capture. Each timed and warmup result matches complete final authority state across both variants.

Controls reuse the same imported module in the second block and include further JIT warming; they are not isolated-module controls. Three pairs are enough for target selection, not significance or formal qualification. Only valid fixtures are exercised. Invalid/replaced dependencies, extra canonical fields, getters/prototypes, size-limit failures, ordering and aliases are not newly qualified here. Existing prior product tests/mutations remain unchanged and are not presented as qualification of this scratch prototype.

## Production acceptance required next

The production candidate must preserve full canonical equality (including extra fields), descriptor/size validation, left-to-right reachability and exceptions, complete input replacement/invalidation, stale/conflicting receipt behavior, and precise effect-admission outcomes. Establish why any reused input is immutable for the callback; do not assume TypeScript readonly provides that guarantee. A narrower occurrence key is not an equivalent replacement.

Exercise actual consumer inputs and ordered facts/effects, including malformed/stale/replaced frames, wrong grants and missing dependencies; mutate the loaded matching/admission paths to verify those checks matter. Then rerun relevant full offline checks and the diagnostic holdouts. Maintain explicit historical D159 manifest failures and unqualified D169 status. A repeatable benefit here would justify ending this focused optimization batch and returning to qualification repair and progressive disclosure, rather than expanding to unrelated kernel changes.

## Verification and replay

An independent read-only reviewer found no blocker for the stated narrow count/timing claims and identified the important duplicate-path and equivalence limits retained above. The Python verifier checks all 30 frozen jobs, exact arm/sample counts, failure records, unique process IDs, file inventories, bundle/tool/input hashes and summary arithmetic. Four reindexed corruptions (extra arm, hidden failure, negative sample, false state check) are rejected. The verifier does not rebuild or prove the transformation; frozen source, exact transformation guards and source review supply that separate link.

Archive contains original/count/prototype bundles, inputs, captured tools, all timings, count results and upstream worker freeze. Fresh extraction must reproduce timing and negative reports, then execute all nine count workflows and reproduce counts.json byte-for-byte as parsed JSON. Commands after extraction:

```sh
python3 tools/verify-causal-policy-prototype.py prototype
python3 tools/test-causal-policy-prototype.py prototype
node tools/count-causal-policy-comparisons.mjs upstream/cpu replay-counts
```

No provider/live/spend action, owner ledger mutation or product qualification claim is created by this diagnostic. The prior cumulative regression report remains the broader source of coverage evidence.
