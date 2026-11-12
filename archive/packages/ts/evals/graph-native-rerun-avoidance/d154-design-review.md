# D154 design review: provider settlement, adaptive pacing and explicit campaign stop

2026-09-02. Design and implementation approved by the user. D154 is locked in
the unique owner ledger, `decisions/decisions.jsonl`; that inline record is the
architecture authority. This report records the review, not a second authority.

## Frozen outcome and scope

Repair the existing D152 efficacy evaluation without changing its model, route,
tasks, prompts, six arms, five matched replicates, verifier, success criterion or
held-out qualification. Keep one root Graph and the actual Work Item and Agentic
Memory solutions. No library/public API/export, protocol or conformance changes.
Continue delivery-only / skip ownership checkpoints.

Given an exactly admitted provider request, when it receives capacity feedback
or admission reaches a budget boundary, the root Graph must conserve the request,
settle its cost according to explicit evidence, control the next admission and
produce a truthful terminal result after all admitted work and cleanup drain.
An incomplete campaign cannot produce efficacy or a development qualification win.

## Verified premise

- The worktree was clean at `6fbe5d93` before this report.
- The latest package-local durable decision was D153.
- D152 development-2 is consumed: 43 calls, 23 usable tool proposals, 20 HTTP 429
  responses, three complete six-arm replicates, complete cleanup, no efficacy claim.
- All 20 retained error responses name Fireworks, `is_byok: false` and
  `limit_source: upstream_provider_shared_pool`. None contains `usage`, a
  generation ID or `Retry-After`. This is not evidence of insufficient credits.
- A no-network invocation of the existing response parser over all 20 original
  responses reproduced `reservation-upper-bound` and USD 0.20 each, USD 4 total.
- The current accounting upper bound leaves USD 0.179695 under the development
  USD 36 cap. The independent key usage delta was USD 0.093128; it is an audit,
  not authority to erase per-request reservations under D113.
- D129 deliberately specified structured partial evidence for elapsed stopping.
  Returning a first-class normal Graph stop is a contract improvement, not proof
  of a wave-protocol defect or an undiscovered violation of that decision.

Evidence and exact hashes: [development-2 closeout](d152-development-2-closeout.md).

## Q5: layer and abstraction

All changes belong to package-private Eval policy and composition, not a public
rate limiter or generic effect driver. Existing focused adapters still execute
only admitted effects. Three explicit outputs are needed: cost settlement,
route pacing state, and campaign terminal state. They compose with existing
admission, budget, activity, cleanup and canonical-observation nodes.

Implementation map (five files):

1. `root-eval-live.ts`: classify bounded, exact response evidence.
2. `eval-topology.ts`: Graph settlement, pacing and campaign termination.
3. `settled-spend.ts`: independent accounting conservation checks.
4. `root-eval-live-authority.ts`: strict current evidence/receipt admission.
5. `run-live-campaign.ts`: consume Graph termination and persist atomically.

Existing focused tests and generated topology artifacts must migrate with these
contracts; no compatibility reader is introduced.

## Q6: invariants and maintenance

### Cost evidence

- Valid response `usage.cost` retains precedence, including a nonzero amount on
  an error. Do not relabel a derived zero as `provider-reported`.
- Add a distinct policy-qualified nonbillable classification only for a complete,
  bounded, unique-key JSON HTTP 429 error response on the exact admitted
  OpenRouter/Fireworks route, with matching error status, `is_byok: false`, no
  inference output or usage record, and a request known to contain no separately
  billable plugins. Bind the policy reference and exact request/response digests.
- Missing, malformed or contradictory evidence, malformed usage, transport
  uncertainty, HTTP 200 body errors and other status classes keep the existing
  conservative reservation unless they independently carry valid reported cost.
- This is reliance on a documented provider billing policy, not proof that a
  specific account ledger has settled. Keep the independent billing audit visible;
  contradictory evidence stops further dispatch pending review.
- Any historical reserve release requires an explicit, exact accounting adjustment
  bound to the original consumed claim, dispatch receipts, raw response digests and
  budget receipt. Preserve the original evidence and ledger history; no claim
  rebinding, rewritten finding or generation replay. Deduplicate adjustments.
- Propose only development-2's 20 qualifying responses for historical review.
  Do not release any older reserve or infer zero from an aggregate account delta.

### Route pacing

- Retain one provider slot, separate logical/capacity/availability retry budgets,
  the 75-minute admission boundary and existing bounded cleanup/drain leases.
- Proposed frozen interval policy: start at 30 seconds; each unique, exact-route
  429 doubles the interval, capped at 240 seconds; three consecutive valid usable
  provider responses halve it one step, with a 30-second floor. Reset the success
  streak on failure. State persists across Work Items and replicate boundaries.
- Interval means minimum dispatch-start spacing, not an unconditional sleep after
  success. Existing capacity backoff and valid `Retry-After` are additional lower
  bounds, never shortened by a pacing recovery.
- Capacity feedback remains effective after per-request retry exhaustion. Replay
  cannot double-apply a slowdown or count another success.
- Bind readiness to the current schedule/revision. An old 30-second clock result
  cannot admit work after a newer feedback occurrence increased the delay.
- Provider feedback does not disclose the shared pool's actual quota. This policy
  cannot guarantee availability; reaching the elapsed limit remains a valid stop.

### Campaign termination

- Add a typed Graph-produced terminal result separating completed evaluation from
  budget/elapsed-stopped incomplete evaluation. A stopped campaign has no efficacy
  finding; `pending` is not its terminal scientific conclusion.
- Termination requires the stop/completion reason, a coherent budget/activity cut,
  exact admitted-effect settlement and cleanup evidence. It is not merely a count
  of zero on a potentially stale branch.
- Preserve pending/rejected proposal accounting and partial verification counts
  without scoring unfinished replicates as wins or losses.
- The caller consumes this result and mechanically drains/persists. It does not
  infer domain termination from independent latest values or throw an expected
  budget stop as if the executor crashed. Actual faults remain explicit failures.
- No new `partial: true`, operator flag overrides, ordinary manual `RESOLVED`,
  domain-ordering timer, external domain map or imperative queue.

## Q7: reactive composition

The actual root dependencies must expose these paths (descriptions, not a claimed
raw `describe()` rendering):

- Correlated provider outcome -> cost settlement -> budget admission/stop.
- Correlated capacity/success feedback -> route pacing state -> revision-bound
  physical-time readiness -> next provider admission.
- Campaign completion or admission stop + conserved activity/cleanup facts ->
  coherent terminal state -> canonical observation and persistence egress.

Reuse existing occurrence-aware and retained quiet boundaries. Material-free
metadata exposes policy version, reason, status, counters and digest references;
raw responses and private task content remain outside public observation.

## Q8: alternatives

**A. Keep current contracts and increase the spend cap.** Smallest code change,
but retains false budget pressure for policy-qualified rejected requests, fixed
rate after cooldown, and expected stops represented as runner failures. Not
recommended; available account credit is not evidence that these contracts work.

**B. Explicit Graph settlement, adaptive pacing and normal stop.** Preserves
bounded execution and makes policy-derived cost distinguishable from reported
cost; improves lifecycle composition. Requires strict schema migration, policy
provenance, schedule-revision tests and an explicit historical adjustment contract.

**C. Infer zero from key-level deltas or route to another provider.** Rejected.
The first loses per-request authority and contradicts D113; the second changes the
frozen route and is outside this repair. Neither follows from sufficient balance.

## Q9: recommendation and acceptance

Recommend B. Remaining risks are provider-policy changes, continued shared-pool
unavailability and a genuinely negative efficacy result. None is permission to
weaken the experiment, exceed a cap or continue indefinitely.

| Concern | Required no-network evidence |
| --- | --- |
| Exact zero-cost classification | Reproduce all 20 retained responses; mutated route, status, usage, output, BYOK, plugin, duplicate keys or receipt cannot release a reserve |
| Financial conservation | Mixed reported/nonbillable/unknown cases, reported nonzero precedence, exact replay, contradictory evidence, adjustment replay rejection, rounding and atomic crash recovery |
| Adaptive pacing | Virtual-time 30/60/120/240 transitions, success recovery, state across replicates, exhausted-request feedback, stale-ready rejection, Retry-After lower bound and cutoff |
| Graph termination | Cost and elapsed stops before start and with provider/tool/retry/billing tails; complete cleanup; no late admission or false efficacy; errors remain distinct |
| Topology integrity | Delete/mutate settlement, feedback, readiness and terminal nodes/edges; raw describe and Graph-native observation agree without sanitizing |
| Regression qualification | Five replicates/six arms, maximum dispatch/retry envelope, response replay, privacy, complete targeted/full tests, lint/typecheck/build/export and reproducible artifacts |

## Owner-local authority

Canonical decision: `graphrefly-ts:D154`, locked in `decisions/decisions.jsonl`.
No protocol, public API or cross-project admission is included.

## Separate execution boundary

The latest request authorizes repair and asks for a follow-on live evaluation; it
does not raise USD 36 or authorize silently erasing unknown reserves. Development-2
cannot be reused. No new live execution binding has been installed.

The user separately approved this conditional execution: if all 20 historical
responses qualify under the approved adjustment contract, releasing exactly USD 4
would leave USD 4.179695 under the unchanged development cap. The grant is
**D152 development-3, five replicates by six
arms, generation hard cap USD 4.179695, development cumulative hard cap USD 36**,
conditional on that exact adjustment, full no-network qualification and fresh
runtime budget admission. Otherwise stop and report the actual available amount.
This is a proposed execution grant, not part of D154 and not an authorization.

## Official policy sources inspected 2026-09-02

- [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits): separates
  credit limits from platform/provider rate limits and requires backoff plus
  honoring Retry-After. Does not publish this route's usable quota.
- [OpenRouter Zero Completion Insurance](https://openrouter.zendesk.com/hc/en-us/articles/51693138951451-Was-I-charged-for-a-failed-errored-or-empty-response-Zero-Completion-Insurance):
  describes error-output waivers and separate plugin/BYOK charges, with per-request
  Activity/generation inspection for actual billing. This is the basis for the
  proposed narrowly qualified classification, not an existing local permission.
