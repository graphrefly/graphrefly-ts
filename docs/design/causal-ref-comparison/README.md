# Shared exact-reference comparison optimization

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS; governing graphrefly-ts:D160. Baseline 0e15fe0263ab452be3dd0a35938d757554c5f910 in the isolated codex/causal-unprofiled-latency worktree. Existing instruction edits and other untracked evidence are preserved. User's sustained offline optimization/verification and commit grant applies; no new authority record, API, protocol, registry, state schema, live/provider/spend or downstream dispatch.

## Source audit and bounded choice

The remaining-CPU evidence selected shared authority reference encoding and quiescence comparison. `sameRef` first compared `refKey` values, then compared digest and serialized sourceRefs a second time. The key already contains revisionDomain, String(revision), occurrenceId, digest and canonical serialization of the entire sourceRefs array. JSON tuple encoding separates arbitrary string coordinates without delimiter collisions. For accepted stable DATA, key equality implies both subsequent conditions. Removing them preserves key generation, validation and exact identity while eliminating two redundant serializations on matching refs. It introduces no shortcut for mismatched refs and no persistent/call-local registry.

Keep full canonical equality for `quiescence`: its pending refs may be full occurrence objects, and arrays preserve order. A typed comparison that drops payload or additional fields would change the prior contract. No such comparator, altered output multiplicity, query coalescing or cross-wave encoding cache is introduced. Evidence/lifecycle scan fusion remains a separate candidate requiring its own before/after proof.

This helper is shared by authority identity, lifecycle and evidence callers, not conditioned on spending profiles, fixture sizes, IDs or branch names. That establishes general applicability of the removed work, not a universal latency improvement. Matching references benefit mechanically; mismatch paths perform the same work. Workloads dominated elsewhere may see little or no end-to-end gain.

## Behavior and review

800 explicit coordinate/metadata/order comparisons check both independently stated expected truth values and the old comparator. Noncanonical nested data must still throw. Existing authority lifecycle tests cover retained state isolation, release authority and evidence capacity. Read-only independent reviewer traced incoming canonicalEntry validation, retained canonical snapshots and plain-data restoration, finding no reachable accepted-DATA regression. Accessor-backed direct internal helper calls can change read count; ordinary accessors are rejected by the canonical admission boundary and the helper is not publicly re-exported. No claim is made about preserving unsupported effectful object access.

## Performance method and incidents

Reuse the finite duplicate-action diagnostic method: P1/P3/P6, one and two DATA, three alternating-order process repetitions per row, plus one before/before control per profile. 21 processes, 126 measured durations, 42 original three-arm preflights. Both bundles execute actual candidate graph behavior; retained state must agree and remain unchanged after every duplicate action. Warmup1/measured3,120s child/900s total, no inspector. Bundle AST comparison permits exactly the sameRef function change. Full source/input/tool digests and exact before source are retained.

The first complete capture overlapped a short focused test at startup. It is excluded in full, retained as an incident, and never spliced with final observations. Final capture runs after all tests, mutations, build and typechecks terminate. See attempt-policy.json. Repeated samples and controls are diagnostic evidence, not D168/D169 formal p95 qualification. No new100ms pass, memory gain or progressive-disclosure qualification is claimed.

## Review trail

1. `packages/ts/src/solutions/causal-occurrence/transition.ts` drives the same identity/lifecycle/evidence calls and one unchanged authority transition.
2. `packages/ts/src/solutions/causal-occurrence/identity.ts` refKey and sameRef preserve all exact identity coordinates while removing the redundant work.
3. `packages/ts/src/__tests__/solutions-causal-ref-comparison.test.ts` demonstrates metadata/order sensitivity and malformed-data rejection.
4. `summary.json`, `receipt.json` and archived raw evidence give measured outcomes and limits. Independent evidence verification checks manifests, identities, order, sample counts and retained failures; six reindexed corruptions must be rejected. This artifact verifier is not a replacement for runtime business verification.

## Final observations

| Profile | DATA count | Before median ms | After median ms | Paired ratios |
|---|---:|---:|---:|---|
| P1 | 1 | 1.247 | 1.165 | 1.0224, 0.9684, 0.8279 |
| P1 | 2 | 8.292 | 7.171 | 0.8825, 0.8793, 0.8613 |
| P3 | 1 | 18.117 | 16.440 | 0.9158, 0.9071, 0.9074 |
| P3 | 2 | 132.384 | 114.928 | 0.8681, 0.8773, 0.8655 |
| P6 | 1 | 101.771 | 99.100 | 0.9687, 0.9474, 0.9738 |
| P6 | 2 | 640.038 | 572.416 | 0.8961, 0.8943, 0.8962 |

Medians here are the median of three per-process medians. Before/before control second/first ratios: P1 0.9507, P3 0.9798, P6 0.9837. Double-DATA improvements repeat across all three profiles and orders, with larger differences than these observed controls; this is not a statistical significance test. P1 single DATA includes one slower paired observation; P6 single DATA has only a small improvement. Its99ms action median does not qualify the full interactive path. P6 double DATA remains572ms. No memory measurement was made.

Full tests2556pass/2existing D159 manifest failures/4skip;73 loaded runtime mutants killed; focused5tests, build/export, example/test typechecks, async boundary and scoped Biome passed. No blanket full-suite/lint green claim. Evidence verifier and six reindexed negatives pass. Independent review found no reachable accepted-DATA regression; no reviewer ran performance concurrently.

Archive: `archive/evals/causal-ref-comparison-evidence-v1/evidence.tar.gz` contains both complete attempts, tool copies, logs and reports. Extract and run `python3 tools/verify-causal-ref-comparison.py final` and `python3 tools/causal-ref-comparison.test.py final`.
