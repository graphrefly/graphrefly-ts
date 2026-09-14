# Independent acceptance planning review

2026-09-13. Read-only source review against the user-approved
`docs/design/causal-completion-integrated-plan.md`; this checklist records acceptance work,
not a new semantic decision or passing test receipt. No production files changed by this review.

## Source seams to preserve

- `causal-preset.ts::buildSpendingPresetNodes` owns one real authority and returns
  `publication.causal.committedEffects`, `materials.materialSnapshot`, and checked
  `admission.{currentFacts,verificationFacts,localFacts,inboxFacts}`. These are the exact
  sources for the host guard, not a second reconstruction of the business graph.
- `causal-publication.ts::PublicationRow` is deliberately passive: it has no admissionRef.
  A `recorded: admitted-no-outcome` string cannot be used as permission. Match the actual
  committed effect/admission and complete retained material tuple.
- `causal-material-owner.ts` retains an immutable material under full occurrenceKey before
  effectProposals emits it. Its lifetime limit is 64; rejected/normal rows do not allocate
  material. Payload plus newline must fit 4096 bytes. Host records must be a subset of this
  existing set, with one composition exclusively owning one host epoch.
- `causal-inputs.ts::checkInput` validates whole bound frames; it does not authenticate an
  arbitrary caller as a real host. The private offline host must remain visibly unqualified.
- `causal-admission.ts::publicationPolicy` freezes one decision per occurrence; readiness is
  a fact and does not reserve capacity. Existing two-vendor same-batch fixture proves two
  admitted effects can share one readiness observation.
- `lifecycle.ts::emitConservation` counts active only when outcome is absent.
  `settledForEviction` accepts any exact recorded outcome when other conditions hold.
  Therefore run normal-end must independently reject unknown/reconcile-required and
  pending association, notification, in-flight, fault and retained-evidence conditions.
  Do not silently change generic authority lifecycle semantics for consumer shutdown.

## Integration cases and independent observables

| Case | Stimulus | Required independent observation |
|---|---|---|
| Real happy path, off and summary | Valid pack/current/oracle receipt/grant; fake prepared resource | Resource receives oracle-derived exact bytes once; authority records the same exact refs after microtask; same five ordinary view keys and original framework handles |
| Normal negative | Unflagged input with genuine no-publish receipt | Zero resource calls, no proposal, all three business branches reach their intended terminal |
| Absent/failed verifier | Remove receipt, then valid recovery; separately exact fail | Missing waits with no fake terminal; failure causes no resource call; recovery uses actual DATA |
| Same topology changed algorithm | Source closure revision changes while stable node names/edges remain | Old source-bound receipt cannot execute; independently generated new receipt verifies consequences; provenance separate from hash |
| Two same-batch admissions | coffee and tea domains with combined current/verification/grants, one readiness snapshot | Two genuine admitted records; one actual in-flight resource call; other exact cancelled busy/known-no-submit; no queued later call |
| Final currentness | Pause guard, admit, replace current/policy/grant or tick/stop, resume | Resource never called for stale permission; legal exact no-submit is retained and returned, original authority settles only exact outcome |
| Missing dependencies | Remove or INVALIDATE each required guard edge after admission before execution | No cache fallback and no execution; recovery requires real valid dependency DATA; topology mutation must not reinterpret positional slots |
| Replay/duplicate/conflict | Re-present identical facts and repeated complete snapshots; wrong tuple variants | Same request never executes twice, first completion immutable; conflicting request cannot occupy a legal record or settle its obligation |
| Full capacity | 64 lifetime retained materials, then a 65th occurrence through genuine input frames | No material replacement and no 65th host record/call; busy refusals count as retained records; completion delivery never recycles capacity |
| Wrong refs/epoch | Wrong occurrence, requestRef, admissionRef, digest, binding/epoch separately | Original active obligation remains; no counterfeit cancellation or resource call |
| Resource uncertainty | Controlled fake throw, short write, malformed result, deferred completion | Possible submission remains unknown/reconcile-required; no success claim, no retry and run cannot end normally |
| UI detach | Disconnect every ordinary subscriber while fake operation pending, complete, reconnect | Run-owned guard/source still work; exact original record retained; no duplicate graph/authority/operation |
| Stop and lifetime | Stop new work during pending write; attempt normal end before/after completion | Existing completion still delivered; no new write; early end rejected; unknown/fault never passes normal-end test |
| Notification failure | Inject scheduler throw; separately actual source subscriber throw | Records retained, host faults, new execution rejected; inspectable run-owned fault even if broken source cannot deliver it |
| Notification coalescing | Multiple completions before microtask; completion generated during delivery | Complete immutable snapshots; at most one scheduled next notification, no synchronous flush recursion |
| Construction rollback | Invalid graph/epoch/names/closure; throw before transfer | Original graph/input identities survive; all newly constructed nodes/resources removed; no effect call |

Tests should inspect the authority checkpoint only as a read-only oracle of its real state, while
resource call log, in-flight maximum, and fake resource byte acceptance are independent observations.
Never manufacture host outcomes with `presetRun.outcome()` in the successful host integration path.

## Reusable fixtures and traps

- Reuse `evaluationFixture`, `evaluationPack`, `policyFacts`, `evaluationWithAmounts` from
  `scripts/fixtures/spending-preset-harness.ts`; expected payload comes from the separate
  `spending-preset-oracle.ts`, not candidate material helpers.
- Reuse the combined two-domain frames from
  `causal-admission-capacity-feasibility.test.ts`. Two revisions in the same domain are not
  equivalent: currentness can make the earlier request stale and obscure the slot race.
- The existing `presetRun.drive()` sends caller-built inbox facts every time. Do not use it
  unchanged in integrated tests: it would overwrite host-owned readiness/outcomes and hide
  missing host feedback. Drive only evaluation, current, verification and local sources.
- Existing `presetRun.cleanup()` forcibly tears down the graph. Keep teardown in finally
  for test hygiene, but do not count it as a successful normal lifecycle end.
- Borrow real queueMicrotask, deferred completion, reentrant delivery, final RESUME and
  actual throwing subscriber scenarios from `causal-host-completion-feasibility.test.ts`.
  Those numeric-ID probe records are not sufficient proof of exact production association.
- Existing D164 tests already cover all 64 evaluations, same-wave receipt conflict,
  INVALIDATE/recovery and actual dependency removal. Extend their real integration seam;
  do not replace them with tests of a manually built guard-only toy graph.

## Mutation and performance evidence

Runtime mutation must change loaded candidate code, not merely send malformed fixture data.
Kill at least: final guard bypass (resource log), slot bypass (max in-flight), duplicate write
(call count), wrong-outcome settlement (real authority state), capacity bypass (65th record),
and detach-clears-record (identity/retention after reconnect). Mutation receipts must show
baseline passing, patch applied to intended source, expected test failure, and restoration.

Performance must distinguish private factory overhead from host record/frame work, comparing
equal inputs, graph and prerequisites. Include full 64-record frames, not just empty/singleton
notifications; report canonical frame bytes separately from the per-completion 4KiB limit.
Steady replay should show no reexecution. Reconnect should show no reconstruction. Keep
allocation/RSS absolute and environment-qualified; preserve existing frozen performance method
status and budgets rather than treating an informational microbenchmark as new qualification.
