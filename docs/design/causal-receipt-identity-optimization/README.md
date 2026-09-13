# Call-local exact receipt identity reuse

Owner: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. User approved continuing evidence/authority repeated-work optimization. Classification: equivalent private consumer computation under TS D160/D164/D165; no new API, protocol, architecture lock, work identity or authority record. This batch changes the consumer evidence node, not the authority kernel. Baseline `351a7ace` on isolated branch `codex/causal-unprofiled-latency`; shared checkout/instruction changes preserved.

## Measured result

| Repeated full-list arrival | Before ms | After ms | After/before, three repeats |
|---|---:|---:|---|
| P1 / 1 DATA | 1.139 | 1.147 | 1.0143, 0.9840, 0.9509 |
| P1 / 2 DATA | 8.154 | 7.979 | 0.9786, 1.0243, 0.9437 |
| P3 / 1 DATA | 19.117 | 17.902 | 0.9142, 0.9386, 0.9838 |
| P3 / 2 DATA | 152.562 | 132.155 | 0.8683, 0.8745, 0.8458 |
| P6 / 1 DATA | 129.725 | 102.577 | 0.7906, 0.7907, 0.7886 |
| P6 / 2 DATA | 966.288 | 641.308 | 0.6650, 0.6581, 0.6665 |

P6 single DATA improved about 21%, double DATA about 34% in this controlled diagnostic. P1 has slightly slower observations; do not claim universal benefit. Before/before double-DATA control ratios: P1 0.9275, P3 0.9657, P6 1.0051. P6 main benefit is consistent across all three repeats and materially larger than its observed control difference. Retain the optimization; do not claim formal performance acceptance, memory reduction, or measured P6 new-action verification improvement. The earlier ~311ms verification result remains a pre-change observation until that path is separately measured.

Verification: 21 complete processes, 42 three-arm preflights, 126 measured samples; independent verification and seven reindexed evidence corruptions pass. Final full suite: 2554 passed, two existing D159 implementation-manifest failures, four skipped. Example typechecks, package test typecheck, build, ESM/CJS/DTS exports and raw-async boundary passed. Scoped Biome passed. 17 real loaded consumer mutants detected, including occurrence-id-only; baseline passed. Exact setup evidence/authority DATA sequence equality is distinct from timed duplicate retained-state equality; ordered duplicate evidence has additional focused test coverage. No full authority-mutation rerun is claimed for this consumer-only change.

## Why this change

The evidence node compares every retained evaluation with every retained verification receipt. Previously `same(v.occurrence,e.occurrence)` canonicalized both occurrences on every pair. `same()` and `occurrenceKey()` use identical canonicalMaterial representation and limits. The new version encodes each receipt once into a temporary ordered array, encodes each evaluation once, and compares exact strings. That evaluation encoding is also reused for the existing material lookup.

This reduces identity serialization from roughly 2×E×R to E+R per invocation while retaining the E×R string comparisons. It is not a delta engine and does not remove evidence facts, joins, validations, currentness queries or any waves. At most 64 temporary receipt records/strings are created under the existing bound; they do not survive the call. This is not a retained-memory improvement claim.

## Design review Q5–Q9

Q5: private consumer evidence implementation is the correct layer; no new reusable primitive is warranted. Q6: receipts/evaluations are accepted JSON copies, checked and deeply frozen; canonicalization cannot observe mutable getters or new unsupported data. Retained receipt first-wins/conflict/capacity behavior remains unchanged. Q7: same dependencies, topology, dispatcher invocation and single ctx.down output array; order and multiplicity preserved, no imperative or cache path. Q8: unchanged pairwise canonicalization repeats work; call-local exact strings need no invalidation protocol; cross-wave caching would add ownership/retention risk and is excluded. Q9: use call-local reuse; independent review found no reachable semantic regression. Residual cost is temporary allocation and continued whole-set evidence processing, measured rather than assumed free.

## Verification and evidence scope

Three independent read-only review lenses covered changed behavior, invalid/lifecycle edges, and proof gaps. They confirmed exact canonical equality and identified the old mutation source anchor, which was repaired without weakening its assertion. Added a real consumer test: same occurrenceId but changed domain/revision/digest/sourceRefs never matches; two exact matching receipts emit complete ordered evidence, including repeated invocations, using independent oracle encoding/digests. Added a loaded occurrence-id-only mutant that must be caught by this test. Existing absence/material/rejection/conflict tests remain.

Before/after measurement uses two controlled bundles differing only in buildAdmission (AST verified), original P1/P3/P6 input bytes, identical schedules, 21 processes: three repeats for one/two DATA plus one same-version double-DATA control per profile. One warmup/three measured samples per arm; 120s child/900s total, no retry. Source and tool bytes are frozen. Before/after actual evidence and authority DATA sequences for initial processing are compared exactly, including duplicates, outside clocks. Both bundles run the existing three-arm preflight; retained state must match and duplicate actions must not change it. Measurements cover repeated full-list arrival processing, not P6 new-action verification or single-reference recipes; no extrapolated speedup is claimed for those unmeasured paths.

Independent verifier checks complete inventories, hashes, process/order/sample structure and recalculates all ratios; it does not substitute for runtime correctness. Historical D168/D169 qualification remains incomplete. Small diagnostic medians are not formal p95 acceptance or a 100ms end-to-end guarantee.

## Setup/repair history

Initial isolated-worktree full tests missed one file because the local @graphrefly/ts link was absent; the first example typecheck failed for the same reason. Replaced only this task's node_modules symlink with a local directory of dependency links and a local package link, then built and rechecked. Shared node_modules was not modified. An initial test expectation passed an object to the independent oracleHash string API; fixed by explicitly applying oracleCanonical. Initial mutation attempts and their failures are retained. These are qualification repairs before performance capture, not discarded timing attempts. Historical D159 manifest drift remains visible and was not repaired by changing its gate.

Review order: result summary → evidence node diff (`examples/spending-alerts/causal-admission.ts`) → added consumer identity test → loaded mutation → controlled comparison and independent verifier. Evidence belongs to this isolated branch; no automatic merge, live provider or effect execution.
