# Quiescence evidence query gating

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS; graphrefly-ts:D160. Baselinefd697057 in the isolated latency-review worktree. Standing user offline optimization/verification/commit grant applies. Preserve unrelated changes. No public API, registry, retained-state schema, protocol, authority-ledger or acceptance change.

## Audit and implemented boundary

The initial whole-domain audit found a valid cardinality witness for no-op flushes: admissions and six pending collections only shrink during flush, and promotion accounts for cross-domain eviction. However, skipping the second recompute changes alias relationships between emitted currentness/quiescence values and internal comparison state. These interfaces are readonly and baseline already shares some post-flush values, but the candidate would expand the mutable-output hazard. That candidate was removed before sampling or committing. No pending-count guard or domain skip is in this change. Preserve recompute timing and output object relationships. A broader no-op optimization requires an explicit alias-preserving implementation and tests; do not silently add an immutable-output semantic change or a persistent dirty registry.

The final change delays the pure isEvidenceTerminal query until lifecycle=true. Existing retainedEvidence was already lifecycle && evidenceTerminal && noRetentionGap. With lifecycle=false, query result cannot affect state or output. isEvidenceTerminal reads canonical retained entries and builds only a local scratch map; it does not ingest evidence, delete obligations, emit coverage, or authorize effects. receiveEvidence/retainEvidence/emitCoverage remain eager. When lifecycle later settles, the full exact query still runs, including pending evidence and every required kind. Full canonical equality, currentness/release, both global recompute passes, and their object allocation/alias behavior remain unchanged.

The predicate follows the semantic dependency, not a fixture size, consumer ID or special workload. It saves work while obligations remain active; lifecycle-settled workloads retain the original check. No cross-wave cache or added user concept. No claim of universal latency or memory improvement.

## Verification trail

transitionCausalAuthority still receives all lanes and recomputes all watermark domains. New causal-quiescence-evidence.test.ts exercises both orders: evidence while branch obligation remains active, and branch settlement before evidence. It checks retained evidence/coverage, independently false lifecycle/completeness, later true completeness and replay output. Existing73 runtime mutations, full offline TS tests, build/exports, test/example types, async boundary and scoped Biome qualify the affected boundary.

## Diagnostic method and provenance

Reuse finite P1/P3/P6 duplicate one/two-DATA method with three alternating-order repetitions per row plus three before/before controls:21serial fresh processes,126samples,42original preflights. Warmup1/measured3,120s child/900s total. Graph state is compared between variants and after each repeated action. Only transitionCausalAuthority may differ in bundled AST. No timing jobs run alongside this task's tests/build/mutation jobs. Before bundle equals the prior CPU worker whose exact source rebuild was verified; unchanged source and worker adapter match baseline git. Source/bundle/input/tool bytes are retained. This is diagnostic median evidence, not D168/D169 formal p95 qualification or end-to-end100ms acceptance.

## Results

| Profile | DATA count | Before median ms | After median ms | Paired ratios |
|---|---:|---:|---:|---|
| P1 | 1 | 1.247 | 1.033 | 0.7512, 1.2841, 0.7987 |
| P1 | 2 | 7.270 | 7.249 | 0.9731, 1.0039, 0.9959 |
| P3 | 1 | 16.226 | 16.006 | 0.9865, 0.9671, 0.9679 |
| P3 | 2 | 116.260 | 111.201 | 0.9558, 0.9682, 0.9487 |
| P6 | 1 | 95.817 | 90.220 | 0.9517, 0.9503, 0.9332 |
| P6 | 2 | 571.771 | 521.751 | 0.9294, 0.9040, 0.9125 |

These are medians of three process medians. Before/before second/first controls: P1 0.9307, P3 0.9813, P6 0.9961. P6 double DATA improves in all three paired repetitions with a much smaller same-profile control difference. P3 improves modestly; P1 is noisy and inconclusive, including a slower single-DATA pair and a6.9% baseline-control movement. Do not turn median ratios into a formal significance or universal benefit claim. P6 double DATA remains522ms; its single-DATA90ms median does not qualify the complete interactive path.

Full test run2560passed/2existing D159 manifest failures/4skipped. Final focused2tests include exact quiescence output assertions and pass; final test typecheck passes.73runtime mutants killed. Build/export, example types, async boundary and scoped Biome pass. Existing suite failure evidence is retained without a blanket green claim. The independent reviewer verified the final query is side-effect-free for accepted canonical DATA; the initial whole-flush alias finding was a static audit, not a separately executed mutation exploit.

Archive: `archive/evals/causal-quiescence-evidence-evidence-v1/evidence.tar.gz`. Raw run, source/bundle/input manifests, adapter, full logs, tools and reports are retained. Extract and run `python3 tools/verify-causal-quiescence-evidence.py capture` and `python3 tools/causal-quiescence-evidence.test.py capture`. Fresh extraction reproduces both reports. No automatic downstream design or live/provider/spend work.
