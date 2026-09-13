# Remaining CPU cost after f44f8f54

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS. Current-product diagnostic, no product/API/protocol/authority change. Captured fixed f44f8f54 source, using the previous exact after bundle and source manifest; checked current admission source digest before freezing. Same isolated branch, unrelated edits preserved.

## Finding

| P6 action | sortedJsonValue + stableJsonString self samples | encodeMaterial self samples | Authority present on sampled stack |
|---|---:|---:|---:|
| Duplicate double DATA, repeat1 | 43.5% | 3.1% | 76.3% |
| Duplicate double DATA, repeat2 | 42.5% | 3.1% | 76.0% |
| First verification, repeat1 | 39.3% | 20.3% | 60.0% |
| First verification, repeat2 | 40.1% | 20.3% | 59.9% |

These are **unweighted sampling proportions, not exact time percentages**. Authority is an inclusive stack category and overlaps the self samples; do not add those columns. Inspector overhead and short start/stop tails are present. The repeat agreement supports hotspot selection, not a formal significance claim or a speedup prediction. No new unprofiled latency is inferred from these captures.

Highest recurring paths include canonical JSON through dataKey/refKey into recomputeDomain, pendingObligations and isEvidenceTerminal; duplicate actions also show receiveTerminals. Verification has emitCoverage and emitConservation costs. `encodeMaterial` stacks map to spending publicationPolicy at frozen bundle line6220, with exact occurrence/policy/grant matching still present. The post-policy-conflict optimization source is visible in that bundle.

## Source map and next priority

1. `packages/ts/src/solutions/causal-occurrence/transition.ts:305` recomputeDomain: currentness, obligations, evidence terminal status, then `dataKey(prior) !== dataKey(value)` for full quiescence change detection. This shared authority path appears in both expensive actions. Review the exact equality contract and legal restored state before any typed comparison or call-local key reuse. Do not assume field omission or array reordering is harmless.
2. `packages/ts/src/solutions/causal-occurrence/evidence.ts:28` emitCoverage and `lifecycle.ts:70` emitConservation scan retained records with exact refs. Preserve record order, duplicates/gaps and all emitted facts; do not add cross-wave indexes or silently coalesce updates.
3. `examples/spending-alerts/causal-admission.ts` publicationPolicy still does evaluation-specific canonical matching against receipts/current/grants. It is a secondary consumer-specific candidate, not the entire remaining bottleneck.

Recommendation: next bounded design/source audit should target shared authority quiescence comparison and exact-ref query encoding first. Any replacement must preserve canonical equality, pending obligations, retained evidence, restoration and output multiplicity, with runtime mutations and before/after measurements. Current evidence identifies candidates but does not quantify each individual optimization's removable cost. No implementation is started by this report.

## Capture and verification

Four serial processes: P6 duplicate double-DATA and first verification, two independent processes each. Each process runs original three-arm preflight, then one unprofiled warmup and five independently prepared actions. Setup/creation and correctness assertions are outside CPU sampling; duplicate setup fully initializes the graph, verification setup sends every original nonverification step. Each sample action has its own500us CPU profiler window. This avoids profiling preparatory work while retaining the original two verification steps for P6. Graph profiling mode is off; Node inspector is enabled only for action sampling. Complete authority state after each action must equal the corresponding warmup result. No plain/reference CPU profiles or before-optimization CPU comparison were collected this round.

20 CPU profiles total, four ordinary preflights. Parent runner enforces120s child/600s total and retains failed records; no retries. Independent verifier checks file inventory/hashes, job identities, tree structure, sample references/deltas and recomputes self/inclusive/caller counts. It does not independently execute or verify business semantics. Four reindexed corruptions (unknown sample, missing profile, negative delta, hidden failure) must be rejected. Scoped tool syntax/format checks apply; prior product checks reused since product source is unchanged.

Artifacts: archive/evals/causal-remaining-cpu-evidence-v1/evidence.tar.gz. Extract and run `python3 tools/verify-causal-remaining-cpu.py capture` and `python3 tools/test-causal-remaining-cpu.py capture`. Raw profiles, exact bundled/source bytes, logs and independent tools are included. Inspect summary.json for untruncated top100 inclusive function counts and serialization ancestors; anonymous locations refer to the frozen bundle. Full formal performance qualification and the parent work remain incomplete; no owner ledger update or live/provider/effect execution.

## Provenance and attribution review

Independent review identified two evidence limitations, now addressed. `build-provenance.json` records an exact workspace rebuild whose SHA-256 equals the captured worker. Every esbuild input and the worker adapter was checked against git f44f8f54; the archived source manifest matches those inputs. Reproduce from this repository with `node scripts/verify-causal-remaining-build.mjs <capture-directory>` and installed dependencies. An initial rebuild from the partial archived source tree differed because it lacked the original TypeScript configuration context; that attempt was rejected, no profiling was rerun, and no raw capture was changed. This is not a claim that the partial source archive is a standalone build environment.

Name-based self/inclusive tables aggregate frames with identical function names. `topSelfLocations` now preserves all sampled function names, URLs and zero-based line/column positions. The two canonical JSON hotspot functions each have a single sampled location per job. Native/JavaScript names such as Hash/update and anonymous callbacks can collide in the name tables; use locations for those. The primary recommendation is unchanged. Four reindexed negative checks pass after the verifier update.
