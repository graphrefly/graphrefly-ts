# Publication-policy conflict scan reuse

Owner: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS. Authorized continuation of repeated-work optimization. Private consumer computation under existing D164/D165; no new API, registry, persistent state, wave behavior or authority lock. Isolated branch codex/causal-unprofiled-latency; baseline7c91ce87. Unrelated instruction edits preserved.

## Result

| Size / operation | Before ms | After ms | After/before repeats |
|---|---:|---:|---|
| P1 / initial | 2.378 | 2.372 | 1.1011, 0.9956, 0.9243 |
| P1 / verification | 0.449 | 0.446 | 0.8939, 1.0407, 0.9201 |
| P1 / sparse | 1.358 | 1.712 | 1.2604, 0.8077, 1.2973 |
| P1 / missing-material | 0.325 | 0.318 | 0.9520, 1.1153, 0.9412 |
| P6 / initial | 624.738 | 581.354 | 0.9313, 0.9265, 0.9304 |
| P6 / verification | 239.516 | 202.151 | 0.8339, 0.8307, 0.8441 |
| P6 / sparse | 8.918 | 8.439 | 0.9658, 0.9305, 0.9821 |
| P6 / missing-material | 34.893 | 34.726 | 0.9920, 0.9933, 1.0255 |

Retain the change: P6 first verification improves about16%, initial processing about7%, consistently across all repeats. Missing-material is effectively unchanged. Small P1 results reverse by order, especially sparse; its median is worse and must not be hidden. These data do not establish universal improvement, exact causal percentages in small cases, or formal budget acceptance. P6 remains above100ms. The removed repetition is specifically full receipt conflict hashing; candidate matching and per-evaluation authorization checks remain.

24/24 processes and144 retained samples complete,48 original three-arm preflights passed; subscribed output traces and full authority states matched. Independent verification, seven reindexed negative artifacts, fresh archive replay, scoped Biome/Python syntax pass. Full tests2554 passed/two existing D159 manifest failures/four skipped;17 loaded consumer mutants detected. Package/example typechecks and raw-async boundary pass. No all-green product qualification or new direct defensive-true-branch mutation claim.

Archive: archive/evals/causal-policy-conflict-evidence-v1/evidence.tar.gz; after extraction run `python3 tools/verify-causal-policy-conflict.py capture/final` and `python3 tools/causal-policy-conflict.test.py capture/final`. Report/tooling and product delta are committed together, with all unfavorable samples retained.

publicationPolicy previously hashed the entire immutable verification.receipts frame separately for every undecided flagged evaluation reaching verification. Conflict depends only on that frame, not on the evaluation. The new invocation-local optional boolean computes the same full scan on first demand and reuses both false and true for the rest of the callback. Current-frame snapshot, candidate filtering, exact occurrence/request/policy bindings, grant checks, time bounds, issues, decisions and output order stay unchanged. No eager work is added when everything is already issued or material/verification is unavailable. The Map already existed; it is now created once per demand-bearing invocation rather than once per evaluation.

Q5–Q9: private consumer placement; no new primitive. Frame immutability and no inline external callback before final ctx.down make reuse valid. Optional boolean has no lifecycle/eviction protocol. Repeated scan is simpler syntactically but unnecessarily repeats full hashes; persistent memo is excluded. Choose lazy invocation-local reuse. Keep the defensive full conflict check even though upstream checked verification normally rejects conflicting identities; do not silently remove it based on that current upstream guarantee.

Independent read-only review checks false/true reuse, replacement across callbacks, immutable inputs, error/order behavior and existing tests. Scope limit: the defensive true branch is not separately newly qualified through direct callback injection; prior consumer conflict tests exercise upstream rejection. Runtime mutation evidence is the existing17 actual loaded consumer variants, not a new claim of exhaustive internal branch coverage.

Frozen diagnostic uses the same P1/P6 four operation recipes as the held-out/lazy audits:24 processes,144 measured observations,48 original three-arm preflights. Before/after bundles differ only in buildAdmission; source snapshots and input bytes retained. Exact subscribed evidence/authority traces and complete retained state must match. Timed scenarios are initial processing, first verification availability, sparse first arrival, and verification during injected material absence. This does not remeasure steady duplicate processing after issued decisions; such rows skip the changed branch and should not be presumed faster. Construction, setup, injected fault, checks and teardown are excluded. Cached DATA may precede action trace; diagnostic/matching claims retain prior scope. No identical-version controls, formal p95, summary-mode or production-wide claims.

The first preparation bundle preceded a formatting-only repair; the final timed bundle contains formatted source. Tests/mutations executed the semantically identical preformat source. Preserve both snapshots; no timed retry. Existing library build/export evidence is reused because package implementation/build inputs did not change; example/package typechecks, whole test suite and consumer mutations are fresh. No authority ledger changes or automatic formal performance completion.
