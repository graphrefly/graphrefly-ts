# No-op flush recomputation with projection separation

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS; graphrefly-ts:D160. Baseline4f7edccb, isolated latency-review worktree. User's standing offline optimization, verification and commit grant applies. No public API, persistent registry/cache, authority schema, protocol, acceptance or downstream dispatch change. Existing unrelated edits remain untouched.

## Behavior and proof boundary

The first full recompute remains unconditional. During the subsequent flush, admissions, pending occurrences, pending terminals, pending effect proposals/admissions/outcomes, and pending evidence can only lose entries. Each query-relevant flush state change consumes one of these entries; successful occurrence promotion separately covers additions and cross-domain retention eviction. A before/after sum of their sizes is a constant-sized local witness. Failed capacity attempts can still emit issues while leaving state unchanged; those issues are preserved.

If flush changed anything, all prior recomputations and termination conditions remain. If it changed nothing, the candidate replaces the redundant query pass with projection refresh, then stops. This retains the baseline's storage/output separation: eligible currentness wrappers are copied, retention-gap wrappers and their evidence refs are copied, and quiescence wrappers plus their frozen arrays are copied. Canonical occurrence, supersededBy and pending-reference elements remain shared exactly as before. Only watermark-covered byRevision entries are refreshed; untouched currentness keys remain untouched, and existing Map key insertion order is preserved. No extra state is retained between transitions.

These entries exist and have the internally constructed union shapes because the first recompute just produced them. The optimization does not define behavior for manually corrupted noncanonical internal RuntimeState (for example NaN watermarks). It preserves accepted DATA and ordinary restored plain snapshots. It does not freeze formerly mutable output objects or change the readonly public contract.

## Review and actual execution

Three independent read-only review lenses found no reachable product regression. They verified flush monotonicity/promotion, exact projection allocation/alias relationships, and private-state validity assumptions. Tool review found and repaired three gaps before timing: enforce exactly two arm records; compare Map/Set insertion order explicitly in the differential; retain adapter/transformed-worker hashes and build versions. The early behavioral-v1 receipt was insufficient for retained ordering and is superseded by behavioral-v2; neither its metadata nor first preparation is used to claim final qualification.

- Two direct tests exercise emitted-object mutation without retained-state corruption and nested retention-gap separation.
- Final deterministic differential:200traces/9600transitions with ordered/grouped and shuffled arrivals, replay, empty transitions, limited occurrence/effect/evidence/pending capacity, and plain structuredClone restoration. Compare complete result, explicitly ordered retained Map/Set entries, and emitted-projection/final-state alias fingerprints. All seven output kinds are observed. This is not exhaustive enumeration or per-branch coverage proof.
- Three actually loaded source mutants are rejected by behavior assertions: omit projection refresh; force unchanged regardless of flush; reuse nested evidenceRef. These supplement the existing73loaded runtime mutants. The new mutants fail after import/execution, not merely compilation or an unmatched mutation anchor.
- Full tests, build/export, test/example types, async boundary and scoped authored-file lint apply; historical D159 manifest failures remain explicit.

## Diagnostic method and provenance

P1/P3/P6 duplicate one/two-DATA, three alternating-order process repetitions each, plus one before/before control per profile:21serial processes,126measured observations,42original three-arm preflights. Warmup1/measured3,120s child/900s total. State must match between variants and remain unchanged after each duplicate action. Setup/preflight/assertions/cleanup are outside measured actions. No task-owned tests/builds/mutations overlap timing.

Only transitionCausalAuthority differs in bundled function AST. Before bundle equals the prior captured after bundle, adapter and unchanged sources match baseline git, and adapting frozen worker source reproduces transformed-worker bytes. Final freeze retains adapter/transformed source and compiler versions. These preparation proofs complement the independent artifact verifier; its hashes alone do not rebuild TypeScript. The final timing run is causal-flush-copy-v1-bound; the earlier causal-flush-copy-v1 is preparation-only with no samples. Baseline and new-path mutation source bundles are separately retained.

This remains finite diagnostic evidence, not formal D168/D169 p95 qualification, memory qualification, universal-consumer gain or an end-to-end100ms pass. Domain-selection rules and dirty registries remain out of scope; only a proven no-op full pass is replaced.

## Final results

| Profile | DATA count | Before median ms | After median ms | Paired ratios |
|---|---:|---:|---:|---|
| P1 | 1 | 1.088 | 0.827 | 0.8468, 0.7365, 0.8868 |
| P1 | 2 | 7.288 | 6.031 | 0.8092, 0.8543, 0.8164 |
| P3 | 1 | 15.594 | 13.131 | 0.8435, 0.8678, 0.8138 |
| P3 | 2 | 110.712 | 88.359 | 0.7967, 0.8232, 0.7933 |
| P6 | 1 | 89.445 | 80.867 | 0.8980, 0.9069, 0.9080 |
| P6 | 2 | 519.713 | 440.016 | 0.8432, 0.8467, 0.8506 |

Medians are medians of three per-process medians. Before/before second/first controls: P1 0.9280, P3 0.9749, P6 0.9834. All18candidate/baseline pairs improved. P6 double DATA decreased about15.3%; its control changed about1.7%. P1's7.2% control movement limits precision even though its paired improvements are larger. No formal significance claim. P6 double DATA remains440ms; P3's88ms and P6 single-DATA81ms medians do not qualify an entire interactive path or tail latency.

Full tests2562passed/2existing D159 manifest failures/4skipped; alias tests2passed; differential200traces/9600transitions passed.73existing runtime mutants plus3new-path loaded mutants detected. Build/export, test/example types, async boundary and scoped Biome passed. Seven reindexed artifact corruptions are rejected, including the previously unchecked extra-arm case. The final differential can replay directly from its frozen modules without repository source or build tools. Original preparation and insufficient-order-check differential-v1 are retained as superseded attempts; only final bound timing and differential-v2 support current claims.

Archive: `archive/evals/causal-flush-copy-evidence-v1/evidence.tar.gz`. Extract and run `python3 tools/verify-causal-flush-copy.py capture`, `python3 tools/causal-flush-copy.test.py capture`, and `node tools/verify-causal-flush-copy-behavior.mjs behavior replay`. Replay verifies frozen bundle hashes and executes all9600comparisons, including Map/Set order and aliases. Fresh archive extraction must reproduce those three reports. Tests, all logs, source/bundle/adapter material and loaded mutant modules are retained.
