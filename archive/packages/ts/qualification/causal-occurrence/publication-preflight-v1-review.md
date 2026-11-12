# Publication material-v1 — implementation preflight, not qualification

2026-09-09. Owner graphrefly-ts; work CAUSAL-PUBLICATION-MATERIAL-TS remains planned/incomplete. User approved material-v1 implementation, offline qualification and commit. This receipt retains a candidate and an unapplied prerequisite proposal; it grants no additional implementation or live authority.

## Candidate

Two private nodes are cold-assembled with the actual buildCausalNodes result, one existing authority and the original roots. Publication preserves recorded state separately from material state. Bounded strict passive material encoding and full-coordinate association reject malformed, conflicting or mismatched frames. Ordinary DATA restores each dependency; UI teardown does not settle lifecycle. No public export, authority/C/core/protocol or existing spending pipeline source changed.

Final-source focused preflight: **102 tests pass** (66 new publication tests, 18 original committed-view, 18 cold assembly). New cases include independent encoding and negative material verifier; actual spending 100/200 and 100/1000 messages; A/B association; exact coordinate negatives; unknown/terminal states; same-commit outcome; retained obligations after UI teardown; mutable frame DATA versus mutation without DATA; per-dependency and repeated INVALIDATE; actual removal of each incoming edge; payload/raw-count bounds. Instrumented hash-count assertion: unchanged immutable material and authority-only DATA do not rehash payload. This is a deterministic work-count assertion, not a timing qualification.

Final default preflight: **2321 pass, 2 fail, 4 existing opt-in skips**. Both failures are unchanged D159/current-qualification binding checks: adding the new source test changes its measured digest. Historical receipt/binding constants and generated root eval artifacts remain unchanged, so rejection is expected and retained. Do not reinterpret this as all tests passing.

Biome and layer checks pass. Lint/typecheck fails at two pre-existing source locations newly covered by the example target: construction.ts:125 generic assertion, evidence.ts:86 nullable tuple passed to a string-only helper. Both files remain byte-identical to d333a7b8. See the unapplied typecheck patch. Its isolated preview passes final example/test typecheck. The assertion compiles to identical JavaScript; the nullable tuple retains JSON.stringify bytes (64 explicit string/null vectors). No helper public signature is widened.

## QA fixes and evidence limits

Two static reviewers found INVALIDATE/arrival-order and mutable-DATA cache bugs in the first draft. Fixes now use native per-dependency context validity, independently accept actual material DATA even while authority is invalid, and preserve the validated copy when no new material DATA arrived. Runtime dependency guards emit protocol ERROR rather than throwing from raw node fn. All reproduced cases are regression tests. The independent oracle initially checked only valid-fixture association; a separate full material verifier now independently validates hashes, bindings, shape, bounds and conflicts. Final scoped static re-review reports no remaining finding. Static review is not a consumer-comprehension test.

Initial editing smoke attempts are in this task's tool transcript (40 tests: 15 failures from fixture integration, then 4 outcome-fixture errors; 45 tests: 2 raw-fn error handling failures; corrected 40/45/53/63/64/65/66 passes). These early editing attempts were not source-bundle archived. The receipt only claims exact source/log bindings for the explicitly listed run-check attempts, including both failed default/lint preflights. No performance attempt has occurred and none is discarded.

## Required continuation after prerequisite scope approval

The reviewed design §9 excludes authority files. Applying the two-file typecheck repair therefore awaits explicit scope confirmation requested in the current task. No approval is inferred from waiting. Then complete the same work: finalize equivalent plain and two-node reference arms, freeze them before timing, implement the declared runtime mutation/performance runners, cover remaining P1–P10 combinations (including cold wrong graph and transferred faults, legal retention gaps/eviction, full replay/reconnect matrix), and execute all original applicable offline qualification, explicit soak, browser, lint/build/export/artifact and owner gates. Only successful final-source qualification permits the existing no-network binding refresh and a completion receipt.

Still unproven: timing budgets 1.20/1.10; complete P1–P10 qualification; complete actual runtime mutant inventory; full plain/reference equivalence; general material retention; all audience-level hiding/preset ports; true inbox/current-at-dispatch authorization; B121 comprehension experiment. No provider/live/spend/actual inbox or downstream work ran.

## Ownership handoff

Delivered candidate, not yet qualified or ownership-verified. Trace to inspect: real material DATA and committedEffects DATA → requestMaterialJoin → publication; roots remain graph-owned. The user's prior lifecycle prediction is preserved, not treated as an understanding-test result. On resumption the concrete teach-back is why exact success + missing body can coexist, and why UI unsubscribe cannot settle an obligation. Five later questions: where does the material input live; which node can commit authority state; which complete tuple prevents A/B mixing; what permits an index replacement; which evidence is still required before an actual inbox write? No second slice is dispatched.
