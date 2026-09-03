# D152 development-3 closeout

2026-09-02 America/Los_Angeles. Execution evidence under the existing approval,
not a durable decision or authorization for another generation.

## Outcome

The campaign stopped cleanly at its Graph-native 75-minute admission deadline.
It did not complete five matched replicates and made **no efficacy claim**.

- Persisted disposition: `stopped`; `efficacyClaim: none`; `causalAttribution: undetermined`.
- Raw terminal observation: `finding: not-evaluated`,
  `stoppingReason: elapsed-budget-exhausted`; full `graphResult: null`.
- Admission report: `not-candidate`, no violation codes; no executor failure digest.
- 23 provider dispatches: eight usable tool proposals and fifteen HTTP 429 responses.
- All five source Work Items settled: four succeeded, source 2 exhausted capacity
  retries. The source-provenance gate excluded target replicates 1 and 2.
- Replicate 3 settled all six target Work Items; replicates 4 and 5 did not execute
  provider calls. Six waiting first-attempt proposals were rejected at the deadline.
- Twelve retry proposals were admitted and settled; none remain pending.
- Zero active effects, reservations, pending provider proposals or cooldown waits;
  cleanup complete, isolated-workspace directory removed, no transaction journal.
- Qualification streak remains zero; held-out material was not consumed.

The runner exited zero at 22:20:56 PDT after 5699 seconds including precredential
gates. Exit zero means the stopped outcome was closed and persisted successfully,
not that the experiment passed. The single-use claim is consumed and cannot be replayed.

## Partial diagnostic results, not efficacy

Only replicate 3 produced a settled six-arm cohort:

| Arm | Result | Exact tool / public semantic / hidden verifier |
| --- | --- | --- |
| cold | Passed | All passed |
| relevant-applied | Passed | All passed |
| proposal-only | Passed | All passed |
| admission-rejected | Passed after two capacity retries | All passed |
| irrelevant-applied | Capacity retries exhausted | Not executed |
| wrong-scope-applied | Capacity retries exhausted | Not executed |

The last two rows are infrastructure failures, **not semantic control failures**.
Under the frozen whole-replicate technical-exclusion rule this cohort cannot support
an efficacy comparison. The stopped observation does not calculate a full-campaign
finding or evaluable count: it retains source exclusions `[1, 2]` and
`evaluableReplicates: null`; do not rewrite it into a completed finding.

Even the successful subset shows cold and relevant both passing. It does not show
relevant memory improving correctness over cold. The earlier two source exclusions
already left fewer than the required four evaluable replicates, but the campaign
continued under its frozen execution/stopping policy without outcome-based changes.

## Availability and budget

All fifteen persisted 429 bodies name `Fireworks`,
`limit_source: upstream_provider_shared_pool`, and `is_byok: false`; none supplied
`Retry-After`. This is direct response evidence of upstream shared-pool capacity
limiting, not evidence that the office network caused the errors.

Graph pacing started with one slot and 30-second spacing, backed off through
60/120/240 seconds, briefly recovered to 120 after three usable responses, then
returned to 240. Dispatch receipts confirm approximately four-minute spacing in
the sustained-limiting portion. Bounded adaptive retry prevented uncontrolled
requests; it could not guarantee availability from this shared pool. No route,
model, settings, retry limit, time limit, material or scorer was changed during live.

| Quantity | USD |
| --- | ---: |
| Approved generation hard cap | 4.179695 |
| Response-reported cost, conservatively rounded | 0.015451 |
| New unknown-outcome hold | 0.000000 |
| This generation's accounted upper bound | 0.015451 |
| Independent current-key usage delta, informational | 0.015446 |
| Development cumulative accounted upper bound | 35.835756 |
| Remaining under development USD 40 ceiling | 4.164244 |

The fifteen responses passed D154's exact admission-bound nonbillable proof;
their zero accounting is policy-qualified, not fabricated `usage.cost: 0`.
The five-microusd key/response difference is within the recorded eight-microusd
rounding allowance and was not substituted for response-cost accounting.
Historical entries, including development-2's USD 4 unknown hold, are unchanged.
Reconstructing the prior ledger from the first two entries reproduces its original
digest. Remaining partition room does not authorize another generation.

## Acceptance and limits

| Requirement | Evidence / limit |
| --- | --- |
| Fresh bank, frozen provenance and behavioral discrimination | [Preparation matrix](d152-development-3-execution.md); all 120 permutations, real source/target verifiers, no bank 1/2 reuse |
| Committed-state no-network QA | 160 targeted tests; full suite 2186 passed / 4 existing skips; lint/typecheck, build, authority/dashboard and artifact gates passed before credentials |
| Unchanged real solution topology | Implementation `85cc4259`; root remains 311 nodes / 413 edges; [raw describe](artifacts/root-eval-describe.json); no operator flags, RESOLVED repairs or ordering timers added |
| Live occurrence / exact-tool path | Four verified source results and four successful target tools; full five-replicate efficacy path not completed |
| Retry / capacity / cost conservation | 23 admitted dispatches = 23 outcomes; 12 admitted retries = 12 settlements; 15 qualified nonbillable outcomes; zero unresolved reservations |
| Coherent Graph terminal / stop | Time authority exhausted at 4500000ms; six proposals rejected, activity drained, terminal revision 90 and budget digest agree |
| Cleanup / atomic persistence / history | Cleanup complete; mode-0600 evidence; claim/evidence/ledger hashes and bindings verified; no pending journal; prior ledger digest reproduced |
| Efficacy / held-out qualification | Not evaluated; no efficacy claim, streak zero, no held-out execution |

These are positive observations of the exercised architectural paths, not proof of
all branches or efficacy for arbitrary user agents. There was no response-shape,
executor, observation-admission or persistence error reported in this run.
The main operational obstacle was sustained provider capacity limiting. A later
experiment must address that availability constraint without turning infrastructure
failures into apparent treatment gains or altering a consumed generation.

## Exact evidence

- [Private evidence, 90 Graph observation envelopes and independent budget receipt](../.private/graph-native-rerun-avoidance/current-root-eval-development-2026-09-01-d152-v3/root-eval-development-2026-09-01-d152-v3/evidence.v27.json)
- [Private consumed claim](../.private/graph-native-rerun-avoidance/current-root-eval-development-2026-09-01-d152-v3/.root-eval-development-2026-09-01-d152-v3.disposition.v21.json)
- [Private cumulative ledger](../.private/graph-native-rerun-avoidance/d152-charter-ledger.v1.json)
- Generation: `root-eval-development-2026-09-01-d152-v3`.
- Implementation: `85cc4259ad4057d1854f5f3abbe53481e4745ec8`.
- Manifest v70: `sha256:132e11ec5db15cc02eb2a74a67dbb95f02c2e589d6103c6088918a01ff3c192a`.
- Task manifest: `sha256:402961a1e786abbfce170ccadcc70b8f6d530a5140aa22a9be007508094dc72d`.
- Claim: `sha256:0d83df5aa488a11dfcb5c94067aaae12edf510d3e1edf0b049a5e436f0615345`.
- Evidence: `sha256:a779ada418f9be923a13fd79b40abeffc6dce23f9934a023b3366c851230dcb5`.
- Evidence file bytes: `sha256:ced7f2c7ac8577eb72c348fe6a76f1774b18aa7e4297d2bc8107b3f5ec3f7258`.
- Budget receipt: `sha256:0a06e1814e2b389b260bf5aecc4ce12bd38c385b9cd74e8216b432e4767b0811`.
- Ledger: `sha256:ac37f63e1a6964966e15b24d2a906b81a0690095d0fe0ef3d212db6a63b8305a`.
- Log: `.runlog/run-20260902-204557-98390.log`.

No push, follow-on live generation, provider/settings change or confirmatory run
was performed. This closeout does not authorize any of them.
