# Causal occurrence TS arm qualification

This package-private qualification covers `graphrefly:D791` contract-v2 and the original
`graphrefly-ts:CAUSAL-OCCURRENCE-TS` work. It does not qualify a consumer's external host,
the future layered API/preset, source-to-node binding, or the B121 product proof.

Run from the repository root:

```sh
pnpm --filter @graphrefly/ts exec vitest run src/__tests__/solutions-causal-occurrence.d791.test.ts
pnpm test:causal-occurrence:qualification --output /tmp/causal-occurrence-mutations.json
```

The runner checks unchanged and structure-guard-isolated baselines, then mutates real
temporary source modules. It removes each of 29 required runtime edges twice: once to
test topology validation and once to test observable behavior with only the construction
guard isolated. Another 15 mutations alter authorization, result, conservation, retention,
or progress semantics. Behavior mutants must fail an assertion; compiler, module-loading,
unexpected runtime errors, timeouts, empty runs, and surviving mutants are failures of
qualification. `--filter` supports focused development runs; a subset never receives
`complete: true`. Neither the checkout nor the production factory has a mutation switch.

The mutation report binds source, tests, runner, toolchain, runtime, executed tests, and
failing oracles. Test fixtures release output and helper subscriptions and remove graph
registrations through the existing topology-group API. Each candidate runs in a child
process which must exit; the runner removes its temporary directory and checks that the
original source and tests are unchanged. This verifies fixture/process cleanup, not a
new public bundle-disposal API.

The repaired bounded behavior is intentional:

- `maxOccurrences` also bounds distinct retained revision domains across every input
  lane, including watermark-only and pending-only domains. Domain tombstones are not
  recycled when an occurrence is evicted; new domains over the lifetime bound receive
  `causal-occurrence/domain-bound` DATA issues.
- Evidence at `maxEvidence` produces a persistent explicit coverage gap through the
  same transition for direct and pending arrivals. Overflow retains at most one gap per
  occurrence/required evidence kind and one optional-kind representative. It cannot
  erase a prior gap or imply complete coverage; this is not an exhaustive overflow log.
- Proposals blocked by `maxEffects` remain in the existing bounded pending storage.
  Capacity issues do not mean an effect was admitted or settled. Pending obligations
  prevent occurrence eviction; available capacity drains exact proposal/admission/outcome
  facts synchronously, preserving the first retained proposal against conflicting replay.
- Occurrence eviction retains the existing fail-closed retention-gap behavior. These
  repairs do not invent restoration of lost contiguous currentness evidence.

`ts-v3-mutations.json` and `ts-v3-receipt.json` retain the original arm qualification and closure; historical ts-v1 receipts remain in the
original work record. Runtime qualification and root contract-definition completion
remain separate from B121 integration completion.

Pre-commit QA found two additional paths: a new domain’s first pending revision must drain when capacity returns, and an independently invalid outcome state/result pair must be rejected before reserving domain capacity. These are repaired and requalified in ts-v3. The ts-v2 receipt and mutation report are preserved as historical evidence; `ts-v2-inputs.json` preserves their original file bytes. Their older passing tests did not cover these two defects and are not current full qualification.


## D160 authority decomposition — ts-v4

The separately approved `graphrefly-ts:CAUSAL-AUTHORITY-DECOMPOSITION-TS` work splits
identity, lifecycle and evidence into fixed private functions. A single transition context
contains the cloned state, bounded options and pending output facts. The graph authority
still commits once and publishes the same topology outputs. No helper owns a second
registry, subscription, callback runner or persistent external closure. Public package
exports and contract-v2 remain unchanged.

The original ts-v3 bytes, including its receipt-bound test and runner, are preserved in
`ts-v3-inputs.json`. `ts-v4-receipt.json` binds the new source closure and qualification;
it does not rewrite or extend the original work's historical receipt. The new mutation
runner copies and mutates all six actual modules, verifies unchanged checkout bytes,
and preserves 29 structural plus 44 behavior-sensitive mutant obligations. Structural
checker rejection, import failure and compilation failure cannot count as behavioral kills.

The focused suite has 27 contract tests plus three private responsibility tests. The new
UI case detaches output subscribers while keeping the real graph-owned retain; passive
external cache inspection confirms a mismatched outcome is processed while detached.
Exact settlement after resubscription is compared with continuous subscription, including
a no-valid-outcome control. This does not claim new whole-composition disposal semantics,
or that observers must remain subscribed to preserve an obligation.

Run the offline differential comparison with:

```sh
node scripts/compare-causal-authority.mjs --output /tmp/causal-authority-comparison.json
pnpm --filter @graphrefly/ts exec vitest run src/__tests__/solutions-causal-occurrence.d791.test.ts src/__tests__/solutions-causal-authority.d160.test.ts
```

The comparison loads the hash-bound ts-v3 source into a temporary module and uses the
current graph runtime for both arms. It compares six complete graph event traces and
pure transition state/output results, including reverse arrival and retention pressure.
This is a regression control, not an independent spending-alerts business verifier.
Candidate, runner and frozen-input bytes are bound and checked for concurrent changes.
Temporary graph registrations/subscriptions and the child process are cleaned up.

Performance separates single-pass, baseline-first graph timing observations from warmed,
alternating small-graph path samples, prepared-state replay samples and an empty-coordination microbenchmark.
Nearest-rank percentiles, raw samples and aggregate process memory are retained. These
are local observations, not portable latency guarantees; aggregate RSS cannot establish
comparative allocation costs. `--scaffold-only` is diagnostic and sets `complete:false`.
The earlier factory allocation attempt remains in `ts-v4-factory-comparison.json` with
its actual module bytes in `ts-v4-factory-inputs.json`; it is superseded diagnostic evidence,
not current qualification. Its measured closure-creation overhead motivated the fixed
functions. No evidence count or causal obligation was removed to improve performance.

The existing immutable `docs/design/causal-composition-v1.json` has a file-specific
formatter exception in biome.json so formatting cannot invalidate its approved digest;
JSON parsing, lint and authority/hash checks remain enabled. New qualification JSON is
formatted before its completion digests are frozen.

Capability views, failure-atomic construction, full instance stop/drain/replacement,
the ordinary preset, independent business verifier and actual inbox authorization path
remain subsequent design-v1/B121 work. This qualification grants no provider/live/spend,
inbox execution, public API expansion or automatic next-batch permission.

## D161 graph-owned construction — construction-v1 / ts-v5

The ts-v5 acceptance was **partial**: its measured construction p95 ratios (1.219–1.336)
exceed the approved 1.20 limit. Functional evidence is separate from whole-slice completion.

The approved `graphrefly-ts:CAUSAL-CONSTRUCTION-OWNERSHIP-TS` slice moves the real private
causal composition through preflight, cold construction, seal, graph ownership transfer,
and native startup. Root and internal dependency leases are recorded before handshake
callbacks. A post-transfer fault returns the same graph-owned instance; presentation
unsubscribe and mismatched outcomes cannot settle its authority's active obligations.
Cold cleanup reports original and secondary errors with resource locators. No public
exports or wave-protocol rules are added.

`identity`, `execution`, and `retained` are frozen exact private capability handles, with
real payload projection for causal quiescence. They keep the complete contract-v2 runtime
closure. This qualifies private wiring and field hiding; it does not complete an ordinary
preset or the public package layering design.

The new evidence is separate from immutable ts-v4 history:

- `ts-v4-construction-inputs.json`: hash-bound, actually imported ts-v4 runtime source closure.
- `ts-v5-construction-verifier.json`: independent plain resource model and actual runtime
  registrations, dispatcher handles, slots, subscriptions, topology and authority obligation
  snapshots; normal, cold-abort and activation-fault traces plus negative controls.
- `ts-v5-construction-mutations.json`: actual source mutations with successful compilation
  and behavioral assertions; compiler/import failure does not count as a kill.
- `ts-v5-causal-mutations.json`: original 29 structural and 44 behavioral obligations, rerun
  through the new construction path. Behavioral edge deletion isolates both the required-edge
  assertion and cold manifest completeness; their structural arms remain independently tested.
- `ts-v5-construction-comparison.json`: matched actual old/new Graph resources, original
  seven-port trace comparison, alternating performance samples and dynamic view resource checks.
- `construction-v1-review.md`: human trace, reading paths, two key mutants and limitations.
- `ts-v5-receipt.json`: historical acceptance status, source/runner/evidence hashes, checks and
  performance limitations. A passing behavioral report alone does not establish full acceptance.

Run the local qualifications from the repository root:

```sh
node scripts/verify-causal-construction.mjs --output /tmp/causal-construction-verifier.json
node scripts/qualify-causal-construction.mjs --output /tmp/causal-construction-mutations.json
node scripts/qualify-causal-occurrence.mjs --output /tmp/causal-occurrence-mutations.json
node scripts/compare-causal-construction.mjs --output /tmp/causal-construction-comparison.json
```

The comparison uses actual Graph runtimes. The independent verifier uses a separate plain
resource model, not a runtime speed baseline. The graph-wired test guard demonstrates a startup
condition at an in-memory host boundary. It does not qualify a real consumer's deterministic
business verifier, execution grant, current-at-dispatch check or inbox effect. Generic view
release exercises an explicitly ended non-causal view; it grants no authority to dispose a
causal instance when its UI detaches.

Performance construction samples use matching capacities with zero arrivals; occupancy and
retained evidence are exercised in the separate full steady-state traces. The performance
arm subscribes to the original seven ports, so it does not qualify activated narrow-view
steady cost. Dynamic peak heap is a whole-process diagnostic, not C-attributed retained
memory. Runner exit zero means the measurements completed; the receipt evaluates the
unchanged 1.20 construction and 1.10 steady budgets separately.


## Construction edge-index optimization A — ts-v6

The reviewed A change indexes exact string edges by target/source in the existing topology
checker. It preserves `causalOccurrenceRequiredEdges`, diagnostic order, the full live
`Graph.describe()` call, and the construction/activation/authority lifecycle. This is an
internal implementation change under the same D161 work, with no public API or protocol change.

`ts-v5-inputs.json` preserves all 71 ts-v5 receipt-bound files and the receipt's exact bytes.
The old reports remain unchanged. The new `ts-v6-receipt.json` binds this attempt separately;
`construction-v1-edge-index-review.md` provides the human review, actual performance numbers,
and remaining limits. A local measurement result does not authorize the deferred B reader,
public preset work, commit, or external execution.

The 12 additional topology tests cover special characters, exact tuple collisions,
duplicates/extras, sparse-array holes, first-error order, and a real cold-construction dependency change.
The guard-isolated mutation control excludes this topology-only suite together with the
older topology-only tests; ordinary focused and full suites execute it. All original
29 structural and 44 behavioral mutant identities remain, plus the 17 C runtime mutants.

Use explicit `--output` paths as above when rerunning so historical reports are preserved.
Construction and steady budgets remain 1.20 and 1.10; the new receipt reports their measured
status separately from functional qualification and whole-work completion.

## Construction incoming-edge materialization B1 — ts-v7

The separately approved B1 implementation shares the existing Graph inspection walk between
full describe and private cold-construction validation. It reads live deps and preserves full
identity-discovery order, including unrelated transitive dependencies. Only owned-target
incoming edges are materialized for validation; current mounted child describe calls remain.
Overridden describe methods retain their original call semantics, including getter-backed
callables and callables with an overridden `call` property. No public method, export, protocol,
authority/lifecycle policy, or per-DATA transaction operation is added.

This reduces materialization; it does not establish strictly local traversal complexity.
`ts-v6-inputs.json` preserves the previous receipt and its 78 bound files. The new evidence is
`ts-v7-receipt.json`, with the human handoff in `construction-v1-incoming-review.md`.
Historical receipts and reports remain unchanged.

The differential runner loads frozen ts-v6 runtime source and compares 144 real graph scenarios:
IDs, live edges, subsequent observation events, describe/checkpoint, errors and a two-input view.
This is finite differential evidence, separate from the independent resource model and from
the eight new actual B1 runtime mutants. The original 73 causal and 17 construction mutant
obligations remain. A cold getter fixture additionally stresses inspection cycles; public
rewire still rejects cycles.

```sh
node scripts/compare-causal-incoming.mjs --output /tmp/causal-incoming-differential.json
node scripts/qualify-causal-construction.mjs --output /tmp/causal-construction-mutations.json
node scripts/verify-causal-construction.mjs --output /tmp/causal-construction-verifier.json
node scripts/compare-causal-construction.mjs --output /tmp/causal-construction-comparison.json
```

The performance baseline remains the frozen actual ts-v4 runtime, using the same resources,
sampling and 1.20 construction / 1.10 steady budgets. The receipt reports the measured outcome;
functional success alone does not qualify performance or authorize B2, public presets or live work.

### A2 target-name materialization (ts-v8)

The A2 attempt moves each input lane's target string out of the per-edge predicate in
`causalOccurrenceRequiredEdges`. It preserves the existing source/filter ordering, identities,
observation and cold construction boundaries. See `construction-v1-target-review.md` and
`ts-v8-receipt.json` for the final qualification and unchanged-budget performance result.
`ts-v7-helper-inputs.json` preserves the receipt-bound prior solution source; the finite pure-function
comparison is separate from the existing actual-runtime mutation evidence.

Rerun the new comparison to a separate output path:

```sh
node scripts/compare-causal-required-edges.mjs --output /tmp/causal-required-edges-comparison.json
```

This attempt does not qualify a public layered preset, B2 observation changes, consumer effect host,
provider/live execution or user ownership teach-back. Prior receipts remain immutable.


## cold-v1 — shared private cold assembly (2026-09-07)

`graphrefly-ts:CAUSAL-COLD-ASSEMBLY-TS` is complete under the approved D160/D161/D162 private extraction scope. Existing standalone entries share one cold builder; the combined real upstream → authority → downstream caller is transferred to one graph owner before activation. UI unsubscribe and late startup failure preserve exact admitted obligations.

See [implementation review](cold-v1-review.md) and [revision-bound receipt](cold-v1-receipt.json). Qualification: 103 focused tests, 2,239 default tests (4 existing opt-in skips), 101 explicit offline root-soak tests, browser/lint/typecheck/build/export/artifact/workspace/dashboard gates; original 73 + 25 mutations and 16 new detections (9 construction assertions, 1 error contract, 3 structural rejections, 3 post-start runtime output failures); frozen ts-v8 eight-port/six-trace and startup-fault comparison; all four original ts-v4 construction ≤1.20 / steady ≤1.10 budget rows passed. Raw attempts and all performance samples are retained.

This qualifies private assembly and ownership only. It does not complete the spending-alerts preset, ordinary five-port hiding, business verifier, exact publication/inbox boundary, B121, S1–S8 or E1–E10. Dormant authority projections retain their existing bounded replay behavior. No public API/protocol change, provider/live/spend execution, staging, commit or downstream dispatch occurred in this slice. Historical receipts remain historical, with their original bytes preserved.

## committed-v2 — failed stable-source offline refresh (2026-09-08)

[Review](committed-v2-review.md), [receipt](committed-v2-receipt.json) and [unapplied proposal](committed-v2-shuffle-proposal.patch) retain the stable-source refresh attempt at 861a9a46. Candidate bindings passed 2,257 default tests (4 existing live opt-in skips), all 73 + 25 + 16 + 11 categorized mutations, independent comparisons and other offline gates. The explicit full soak failed 96/5; isolated original failures recovered to 4/1, with the 120-shuffle test still exceeding its unchanged 5-second deadline. Original source-bound performance evidence remains valid.

The three candidate qualification digests and five derived artifacts were withdrawn and restored byte-for-byte. Final checkout still has the known qualification drift; CAUSAL-COMMITTED-VIEW-TS remains incomplete. The proposed parameterization changes watchdog granularity and requires approval. No production code, scientific input, actual grant, public API or downstream work changed.

## committed-v3：批准拆分后的离线资格

[committed-v3-review.md](committed-v3-review.md) 记录批准的 120 排列参数化（另加 enumeration/support 对照）、每项 5 秒的验收粒度及具体边界。[committed-v3-receipt.json](committed-v3-receipt.json) 与 [committed-v3-evidence.tar.gz](committed-v3-evidence.tar.gz) 保留本次 221 soak / 2257 default pass（4 个原有 live opt-in skips）、mutation/oracle/基线/构建和当前资格摘要证据；原性能测量按未变的实际 runtime/harness 复核，没有新性能运行。历史失败收据原样保留。本批完成 private committed-effects view 的离线资格，按用户等级隐藏入口、完整 preset 和实际 effect 执行仍不在完成声明内。最终记录检查见 [committed-v3-closeout.json](committed-v3-closeout.json)。
