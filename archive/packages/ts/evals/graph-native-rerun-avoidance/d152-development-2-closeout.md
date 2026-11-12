# D152 development-2 closeout

2026-09-02. Execution evidence only; not a durable decision or authorization for another run.

## Outcome

The approved live campaign stopped at the Graph budget boundary. It did not complete five matched replicates and made **no efficacy claim**.

- Persisted disposition: `partial-failure`; `efficacyClaim: none`; `graphResult: null`.
- Last raw Graph observation: `stoppingReason: budget-exhausted`, `finding: pending`.
- Three complete six-arm replicates, 18 target Work Items, plus five source Work Items.
- 43 provider calls: 23 valid tool proposals and 20 capacity-retryable HTTP 429 responses.
- 20 retry proposals: 19 admitted and settled; the last rejected by budget admission.
- Zero active effects, zero active reservations, complete cleanup; no pending atomic transaction.
- Qualification streak remains zero; held-out was not consumed. This generation is consumed and cannot be replayed.

Process exit zero means the runner closed and persisted this partial outcome successfully, not that the experiment succeeded. The last observation remains a partial campaign observation, not a completed efficacy finding.

## Partial results, not a full-campaign conclusion

| Arm | Passed / completed |
|---|---:|
| cold | 3 / 3 |
| relevant-applied | 3 / 3 |
| proposal-only | 3 / 3 |
| admission-rejected | 3 / 3 |
| irrelevant-applied | 0 / 3 |
| wrong-scope-applied | 3 / 3 |

The observed subset distinguishes relevant from rotated irrelevant memory, but does not show relevant memory improving correctness over cold. Do not describe the missing efficacy claim as solely a budget problem, promote these partial counts into the frozen full-campaign test, or infer efficacy for arbitrary user agents. The two remaining replicates were not completed.

## Cost and stopping

| Quantity | USD |
|---|---:|
| Approved generation hard cap | 4.272834 |
| Response-reported cost, conservatively rounded | 0.093139 |
| Unknown-outcome reservation retained for 20 HTTP 429 responses | 4.000000 |
| Accounted upper bound for this generation | 4.093139 |
| Independent current-key usage delta, informational | 0.093128 |
| Development cumulative accounted upper bound | 35.820305 |
| Remaining under development USD 36 ceiling | 0.179695 |

The USD 4.00 reservation is **not an assertion that OpenRouter billed USD 4.00**. These responses lacked usable usage-cost evidence under the frozen settlement rule, so each retained its USD 0.20 reservation. The remaining USD 0.179695 could not fund another USD 0.20 admission. Key-level billing delta is recorded separately and was not used to silently release per-request unknown-outcome reservations. No budget, retry, provider, model, prompt, verifier or stopping policy changed during the campaign.

## Architecture evidence and limits

The live path traversed the real Work Item and Memory lifecycle for three complete replicates, recovered from 429 through Graph-admitted retries, rejected further admission at the budget boundary, drained active work and independently persisted a valid budget receipt despite the missing full-campaign finding. There were no reported executor failures, response-shape failures or observation-admission violation codes. This is evidence for those exercised paths, not proof that all architecture branches or memory efficacy are validated end to end.

The architecture remains as qualified in [the acceptance matrix](architecture-acceptance.md): no new operator flags, settlement repairs or domain-ordering timers were added for this execution. Existing pathological diagnostic-volume performance limitations remain open.

## Exact evidence and reproducibility

- [Private raw evidence, including Graph observation envelopes and independent budget receipt](../.private/graph-native-rerun-avoidance/current-root-eval-development-2026-09-01-d152-v2/root-eval-development-2026-09-01-d152-v2/evidence.v26.json)
- [Private single-use claim](../.private/graph-native-rerun-avoidance/current-root-eval-development-2026-09-01-d152-v2/.root-eval-development-2026-09-01-d152-v2.disposition.v21.json)
- [Private cumulative ledger](../.private/graph-native-rerun-avoidance/d152-charter-ledger.v1.json)
- Generation: `root-eval-development-2026-09-01-d152-v2`.
- Implementation commit: `d5362fd6a1cc8cc6f24b70936c6bfa169cb6e47e`.
- Implementation manifest: `sha256:8543c48f3cd5bd56f2246f1d78038a2ab172cb14b8c66a1b5800ba81fbde9eb9`.
- Claim: `sha256:90415bbe7edc10e3e2b90237b0d30f140268caa90f8cb3357c51cc00f90ce4a4`.
- Evidence: `sha256:010e275155d91bd2bd32ed00a0f2d5f1c70f7bf427fc701f19abab664e5a1f8d`.
- Evidence file bytes: `sha256:0517b60cbe76afb0d7004a338b9253d18f3ea60974289c3d82e82c4d46de3efc`.
- Budget receipt: `sha256:e1798f99504782029d27b904e517d468b92b07e67a2efd32ae31b64345520f1`.
- Ledger: `sha256:bc1bdd67b7ebad4e04547ace592fb9bc2c2f80ca85a13d5e66443bcf006ad00a`.
- Local run log: `.runlog/run-20260902-050321-39076.log`; exit 0, DONE at 2026-09-02 06:06:54 America/Los_Angeles.

Precredential gates on the committed implementation passed: 132 targeted tests; full suite 2,117 passed / 4 skipped; lint and typechecks; build and exports; authority/dashboard; artifact reproduction. An earlier preparation run stopped before credentials, claim or network on one stale development-1 assertion; it was fixed, then all gates reran. Claim/evidence/ledger digests and independent budget arithmetic were revalidated after persistence.

No push was performed. No follow-on generation or confirmatory run is authorized by this closeout.
