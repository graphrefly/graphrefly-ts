# Private spending preset performance attempt v1

**Not qualified.** The original private consumer matrix reached four cold rows; three passed and `cold-P2-summary` rejected the unchanged 1.20 limit. The attempt stopped under its predeclared first-failure rule. Eight cold, 60 steady and 12 recovery rows remain **not run**, with no inferred result. No retry or source optimization followed the failure.

Owner/work: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`; governing architecture remains D164–D166. This is attempt/evidence under the retained private implementation/offline/commit approval, with no new decision or execution grant. It does not reopen A/B/C, change public exports or wave protocol, or authorize real effects, provider/live/spend or B121 studies.

| Completed cold row | Candidate/reference median batch-p95 ratio | Original limit | Result |
|---|---:|---:|---|
| P1 off | 1.086204 | 1.20 | pass |
| P1 summary | 1.055406 | 1.20 | pass |
| P2 off | 1.097663 | 1.20 | pass |
| P2 summary | **1.211671** | **1.20** | rejected |

For the rejected row, candidate batch p95s are 0.368417 / 0.302542 / 0.358250 ms; reference batch p95s are 0.337333 / 0.295666 / 0.292833 ms. The estimator is **0.358250 / 0.295666**, not a median of paired ratios. The deciding candidate batch-2/index-293 and reference batch-1/index-131 samples have no recorded overlapping GC/deopt event. GC timestamps have integer-millisecond precision, so this is evidence about logged overlap, not a causal explanation or a general absence-of-GC claim. Plain absolute median batch p95 is 0.018625 ms and is not the denominator.

P1–P6 use the same declared cold assembly shape per observation mode; profile inputs are applied only during semantic preflight, outside cold timing. The P2 label does **not** establish that prefix-64 arithmetic/hash caused this construction failure. Function-level attribution remains unmeasured. The measured excess is about 0.062584 ms over Graph reference, and 0.003451 ms above 1.20 times that reference. The original threshold was neither rounded nor relaxed.

## Frozen recipe and boundaries

The original recipe remains [assembly Appendix C](../../../../../docs/design/causal-preset-assembly-v1.md). The runnable entry is [compare-spending-preset.mjs](../../../../../scripts/compare-spending-preset.mjs); common shell and worker are private script fixtures. This is a new formal private consumer qualification, **not CSP11, the C/publication runner, or an ad hoc replacement for their receipts**.

- Full predeclared row list: 12 cold / 60 steady / 12 recovery. Cold/steady use AB / BA / AB blocks, each arm 100 warmup + 300 measured. Per-batch nearest-rank p95, then ratio of median batch p95s. Cold <=1.20, steady <=1.10.
- Candidate/reference use the same Graph, six-source construction, ownership transfer/startup, subscription shell, bounded latest observations, and cleanup. Consumer builders remain independently implemented and semantically qualified; common runtime/measurement loading does not introduce consumer helper sharing into the reference implementation.
- Actual cold shapes are 53 owned nodes off / 54 summary, six external sources and two roots. Each reached row records actual node/dependency tables and verifies both Graph arms against the independent business oracle, plain effects, retained evidence, and lifecycle obligations before timing.
- Double DATA is two copies of one arrival frame in a single source wave. Newness means distinct identities absent before that entire wave; entry two is replay. One-new rows report actual 1/16 or 1/64 pre-wave distinct change, and `[1, 0]` newness by entry. This is not two independent fresh cohorts.
- Each all-new/one-new sample gets a predeclared fresh instance with remaining lifetime capacity; no same-instance reset. Constructor and preparation time are separately recorded. P6 late verification/pending drain is inside the measured action; extra verification DATA are explicitly counted.
- Per-input-step preparation/action intervals and independently determined material hints separate inclusive first-material generation/hash waves from retained-only/no-material waves. They do not measure exclusive hash self-time. P1 normal emits no request material. These paths are implemented and semantically tested, **not timed in this attempt**, since no steady row ran.
- Recovery means 20 real full-UI detach/reconnect cycles on one retained-root instance per Graph arm, informational rather than a 1.20/1.10 gate; no synthetic warmup cycles. Assertions are outside clocks. The qualified plain reference has no subscription API, so its recovery is explicitly N/A instead of timing no-ops.
- Recovery verifies fresh assessment/publication/startup DATA and independent authority retention. All observed-port emission counts are retained. Semantic preflight shows coverage may not reemit after reconnect; D163 already explicitly excludes full coverage/issues/etc recovery. Old observer cache is not accepted as proof of fresh publication. **No full five-port recovery claim** is made.
- Plain cold/push numbers cover its passive business/authority obligations; snapshot formatting is outside its action clock. These absolute numbers do not establish equivalent Graph UI rendering cost.
- Process heap/RSS before/after each sample are raw deltas, not retained-size proof. No forced GC or GC sample exclusion. Raw V8 GC and timestamped deopt logs are correlated to sample intervals.
- Before first timing: all 65 prior semantic source bindings, the committed reference archive, its index digest, six fixture hashes, the new 63-file source/config closure and worker bundle are checked/frozen. Original receipts remain untouched. Row timeout 900 seconds; total attempt budget 7200 seconds; first rejected/failed/timed-out row stops the attempt and preserves remaining rows as not-run. Actual attempt elapsed about 5.82 seconds.

## Evidence and review

`evidence.tar.gz` contains `attempt-01/` with its original freeze, all 84 statuses, 14,400 raw samples (10,800 measured + 3,600 warmup), four semantic preflights, actual topology tables, V8 logs and correlations, plus offline test and review evidence. `artifact-index.json` binds every archive member; `receipt.json` binds the archive and index. Absolute original output paths remain provenance; the relative archive entries are portable.

Two static QA reviewers found index authentication, cleanup/logging error handling, stale reconnect observations and first-material attribution gaps. The measurement tool fixes were verified by static re-review. Eight runner checks pass, including an estimator counterexample that would falsely pass with median paired ratios, invalid/incomplete samples, real P1/P3/P6 input schedules, and a loaded missing-reconnect negative control. That negative control validates this observer evidence path; it is not a new candidate runtime mutation qualification. Prior 51-test / 7-runtime-mutant reference qualification is reused only through unchanged source bindings.

Lint and example/package typechecks pass. The default offline suite and artifact gate retain the existing D159 frozen-manifest failures; see receipt and raw logs for exact counts. No public API/build behavior changed. The six pre-existing dirty root files retain their original hashes.

Next within this work: attribute cold assembly cost using a separately identified diagnostic run, preserve this rejected result, and review a concrete local fix before issuing a new bound performance attempt. The remaining matrix, final N1–N12 review package, existing D159 binding issue and complete five-port recovery evidence remain outstanding. This receipt makes no user cognitive-burden or final package-creation ergonomics claim.

To reproduce as a **new attempt** without overwriting evidence: extract the committed `preset-reference-v1/evidence.tar.gz` into a fresh directory, then run `node scripts/compare-spending-preset.mjs NEW_OUTPUT EXTRACTED/freeze-qualified`. Changed prior source bindings are rejected; a fresh semantic qualification is required if consumer/reference code changes. The runner does not automatically retry.
