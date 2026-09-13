# Remaining CPU and quiescence work amplification

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS. Diagnostic-only continuation of the user's standing offline grant. Product baseline32474ec63dd90287cc66d31c2a9ca836bce17f69, isolated latency-review worktree; no product, API, registry, lifecycle, protocol, authority-ledger or acceptance change. Existing unrelated changes preserved.

## Findings and next target

Four serial fresh processes capture P6 duplicate double DATA and first verification twice, five action-only CPU windows each. Reused the existing500us inspector tool and120s child/600s total limits. Setup, preflight and assertions are outside sampling.20profiles, four original preflights. Exact workspace rebuild equals worker d9aeae65d30ef343537fb0ac4afe7a9d60848add0e8fdd254bcc46e09dfc8d90; every bundled source and adapter checked against the baseline revision. Raw inputs, source, adapter and transformed worker retained.

recomputeDomain appears on38.1–38.4% of duplicate samples and34.1–35.0% of verification samples. This is inclusive and contains currentness, pending-obligation and evidence queries. Observed dataKey frames directly parented by recomputeDomain account for3.19–3.24% and14.01–15.18%, respectively. These are unweighted sampled subtrees, not exact time percentages, removable cost estimates or speedup predictions. JIT inlining and omitted frames limit exact source attribution. No before/after latency comparison or formal performance qualification was run this turn.

A separate untimed inspection shows64revision domains. Final duplicate/verification snapshots have zero pending occurrence refs and small quiescence values. Those final snapshots do not describe intermediate state: an instrumented exact worker was therefore used to count actual quiescence encodings, preserving each original dataKey call and return string. The instrumented and original workers agree on authority state after setup and every action step.

| P6 action | recomputeDomain calls | quiescence encodings | encoded UTF-16 characters, cumulative | maximum per encoding | encodings with nonempty refs |
|---|---:|---:|---:|---:|---:|
| Duplicate double DATA | 6016 | 12032 | 2504912 | 210 | 0 |
| First verification | 896 | 1792 | 4276934 | 9142 | 448 |

Counts exclude setup and include the entire original action. They are operation counts, not timings or memory/RSS. Instrumentation uses a separate diagnostic module counter, never a library registry or retained authority field; no instrumented worker was used for CPU or latency sampling. State equivalence is checked; no separate full message-trace equivalence is claimed for the instrumented diagnostic. Two exact replacement anchors fail closed on bundle drift.

The next priority is an audit of repeated whole-domain recomputation when that domain has not changed. Current transition processes arrivals, recomputes every watermark domain, flushes pending work and recomputes every watermark domain again until finite progress stops. This source explains a route for amplification; these counts do not yet identify how many calls are safely removable. A subsequent change must prove domain impact through admissions, currentness/release, branch/effect terminals, evidence, retention eviction and global capacity, including flush-induced changes in other domains. Do not simply skip the second pass or process only the input domain. Preserve output order/multiplicity and one authority commit, without persistent dirty indexes or cross-wave caching.

Do not start with a field-subset quiescence comparator. Intermediate refs really contain larger data; extra fields and ordered references remain part of canonical equality. Reducing repeated unaffected-domain work could remove several dependent scans together, whereas another local encoding shortcut would address only one portion. This is a target selection, not proof of an implementation or authorization for new semantics.

## Verification and reproduction

Existing CPU artifact verifier passes; four reindexed corruptions rejected. Function-name aggregation retains full self frame locations. The new attribution script first validates input then counts sample ancestry. The new state inspection and instrumented count scripts are untimed; they bind the exact worker hash. Scoped Biome/Python syntax checks pass. Product tests/build were not rerun because product source is unchanged; prior receipts retain their original failure limits.

Archive: `archive/evals/causal-remaining-cpu-v2-evidence/evidence.tar.gz`. Extract, then:

- `python3 tools/verify-causal-remaining-cpu.py capture`
- `python3 tools/test-causal-remaining-cpu.py capture`
- `python3 tools/analyze-causal-quiescence-cpu.py capture`
- `node tools/inspect-causal-quiescence.mjs capture`
- `node tools/count-causal-quiescence.mjs capture <fresh-existing-output-directory>`

The final command creates a separate instrumented worker in the given empty directory; it never edits the captured worker. Rebuilding original sources with verify-causal-remaining-build.mjs requires the repository and build dependencies. Fresh archive extraction reproduces the reports. No formal p95/100ms pass, universal consumer benefit, memory reduction, completed work or progressive-disclosure claim.
