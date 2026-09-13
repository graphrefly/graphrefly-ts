# Lazy call-local receipt encoding

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS. User approved continuing the minimal lazy repair proposed after fe547434. This is equivalent private consumer computation under existing D164/D165, no API/protocol/authority decision. Baseline eager implementation056e1fda; compare fixed source to this change on isolated codex/causal-unprofiled-latency. Unrelated instruction and shared-workspace changes remain untouched.

## Result and verdict

| Size / operation | Eager ms | Lazy ms | Lazy/eager repeats |
|---|---:|---:|---|
| P1 / initial | 2.541 | 2.563 | 0.8931, 1.1690, 1.0088 |
| P1 / verification | 0.471 | 0.468 | 0.9240, 0.8791, 0.9947 |
| P1 / sparse | 1.507 | 1.762 | 1.2679, 0.7820, 1.3126 |
| P1 / missing-material | 0.327 | 0.338 | 1.0807, 1.0065, 1.0320 |
| P6 / initial | 633.220 | 632.152 | 1.0052, 0.9977, 1.0010 |
| P6 / verification | 242.931 | 241.705 | 0.9940, 1.0134, 0.9921 |
| P6 / sparse | 8.989 | 8.341 | 1.0053, 0.9873, 0.9077 |
| P6 / missing-material | 35.916 | 34.972 | 0.9921, 0.9737, 0.9691 |

P6 missing-material decreases from35.916ms to34.972ms; all three repeats decrease by about0.8–3.1%. Normal initial and verification paths are effectively similar in this small diagnostic. P1 missing-material increases from0.327ms to0.338ms with all three ratios above1; sparse P1 reverses with order and is inconclusive. Retain the minimal lazy placement for removing objectively unnecessary receipt encoding, while recording its branch/optional-variable cost and these unfavorable measurements. No universal speedup, precise causal percentage or complete elimination of the previous regression is proved. No same-version controls were run; small differences are diagnostic only. Major earlier P6 verification benefit is not visibly lost, but this is not formal noninferiority qualification.

24 complete processes,144 measured observations and48 original three-arm preflights; exact subscribed traces and state checks passed. Independent arithmetic/integrity verification, seven reindexed corruptions and fresh archive replay passed. Full suite2554 passed/two unchanged D159 manifest failures/four skipped;17 loaded mutants detected. Package and example typechecks, scoped Biome and async boundary passed. Existing package build/export result reused because those inputs did not change.

Evidence archive: archive/evals/causal-receipt-lazy-evidence-v1/evidence.tar.gz. Extract and run `python3 tools/verify-causal-receipt-lazy.py capture/run` and `python3 tools/causal-receipt-lazy.test.py capture/run`. The archive retains raw samples, frozen sources, logs, current consumer mutation recipe and reports. This batch is complete; the broader consumer performance/100ms goal is not.

The temporary verification array is declared per evidence invocation and first populated only after an evaluation has a material result. The original expectedRequest/classification logic remains intact, including normal/rejected material; these still require receipt classification. Once created, the array (including an empty array) is reused for the rest of that invocation. Missing material does not encode receipt occurrences. Evaluation occurrence encoding remains as before for the material lookup; this does not remove all possible unnecessary work. Nothing persists across invocations, invalidation, or lifecycle boundaries.

Design check: correct private consumer layer; no reusable public primitive. Optional local array plus ??= has no invalidation protocol. Receipts remain validated/frozen, order and exact identity representation preserved. Alternative eager construction wastes work on absent material; retained caching adds ownership and is excluded. Independent review checks empty arrays, mixed material availability, return/recovery paths and unchanged mutation behavior.

Qualification reuses the full test suite and17 loaded consumer mutants, updating the pending-receipt-loss mutation's exact text anchor while preserving its error behavior. Existing exact-coordinate/ordered evidence test remains. Package source/build inputs are unchanged; previous package build/export evidence is reused, with fresh package/example typechecks and async boundary checks for this edit.

Performance method reuses the frozen previous held-out recipes, including their limits: P1/P6 × initial/verification/sparse/missing-material ×3 repetitions =24 processes,144 measured observations. Before is eager056e1fda, after is lazy. The input bytes and clock boundaries remain the same, one trace observation and one warmup precede three samples per variant, each on a fresh instance. Product source substitution and top-level function diff check constrain buildAdmission. Exact subscribed evidence/authority traces (including initial cache deliveries) and complete state compare; timed observations compare state outside clocks. Parent runner enforces120s child/900s total. No formal p95, identical-version controls, production dataset, summary mode or full-library inference. The missing-material case is an explicit internal fault injection outside clocks, not ordinary public input.

Previous missing-material regression and favorable before-pair timings remain retained. Any small timing difference is descriptive; no formal budget is changed. Do not retrofit sample selection or claim a universal speedup. Full D168/D169 and parent work remain incomplete. No authority ledger is advanced by this isolated delivery.

Review order: result table → examples/spending-alerts/causal-admission.ts material guard and local allocation → mutation anchor → scripts/causal-receipt-lazy.mjs clock/preflight paths → independent Python verifier and corrupted-artifact negatives.
