# D155 — independent provider qualification

Owner: `graphrefly-ts:D155`. Delivery-only; ownership checkpoints skipped by request.
Approved execution remains `provider-qualification-together-2026-09-03-1`: at most
three serial requests and 100,000 microusd, charged to the existing development
ceiling. No campaign, generation, efficacy claim or candidate promotion follows.

## Design review

- Q5: package-private qualification, not a library driver or simulated solution.
  Its input-to-output map is qualification state → exact wire admission → existing
  HTTP transport leaf → correlated result → atomic development ledger receipt.
- Q6: invariant: reserve the entire grant before inference; unknown outcomes cannot
  refund it without bounded evidence. One execution reference cannot dispatch again.
  A process crash leaves a held reservation/lock requiring explicit recovery.
- Q7: domain request count, costs, admission and stopping live in Graph nodes.
  Caller bookkeeping owns only I/O and persistence. No new partial override,
  manual RESOLVED or domain ordering timer. Raw domain `Graph.observe()` targets
  are selected before HTTP instrumentation attaches; no sanitizer rewrites events.
- Q8: rejected direct unaccounted probes and disguised development generations.
  Chosen: separate qualification records in the same development budget authority.
- Q9: explicit current-format upgrade preserves original bytes/digest and every
  campaign/carry/streak field. Readers reject the old format; no compatibility
  path runs implicitly. Shared execution exclusion and write-lock/CAS cover both
  campaign and qualification. The real fetch is lexical to the validated CLI;
  injected test runners contain no credential/network capability.

## Frozen behavior and stopping boundary

Given a separately approved exact Together route and sufficient development/key
budget, when current committed implementation, settings, pricing and ZDR pass,
the qualification Graph admits at most three strict structured proposals against
public diagnostic strings. Then each exact result is accounted, unknown cost is
held, and the first unusable result or budget boundary stops further requests.
Three usable responses complete transport qualification, never efficacy.

## Acceptance matrix

| Requirement | Evidence |
| --- | --- |
| Exact request/route/privacy/output ceiling | request digest + mutation test |
| Three serial requests, no fourth | Graph admissions + injected real HTTP leaf |
| Correct terminal reason | three-success and next-request-budget tests |
| Same development cap, unchanged generation/streak | reservation/settlement tests |
| Unknown 429/5xx/transport/malformed response | conservative reservation tests |
| Valid cost survives route/format rejection | reported-cost test |
| Single-use and conflicting receipt replay | repeated-run/settlement tests |
| Crash or persistence failure holds full grant | response-file failure test |
| Atomic budget + receipt | single ledger object, shared lock, stale-CAS test |
| Old ledger preserved, no fallback | explicit upgrade/archive test |
| Offline grant cannot select real transport | relabel rejection; real fetch only in CLI |
| No material in raw topology/domain observation | direct describe/observe encoding test |
| Existing root campaign unaffected | full regression suite and regenerated artifacts |

Initial static QA found and fixed (1) competing campaign/qualification writes,
(2) third-success stop-reason precedence, (3) missing request digest in admission,
and (4) an exported real-fetch path accepting plain grants. Both static reviewers
reported no remaining concrete findings after fixes. Eighteen focused tests and
lint/typecheck passed before committed-state full QA.

The 2026-09-03 public endpoint preflight pinned Together input/output/cache-read
pricing at USD 0.14/0.28/0.03 per million tokens. A cached-token regression uses
the existing strict usage-cost audit. Reservation still assumes fully uncached
input, so caching cannot shrink the upfront safety bound.

## Operation

The current ledger path retains its historical filename `d152-charter-ledger.v1.json`;
its **content** is upgraded explicitly to schema v2, with the exact original saved
as `.before-qualification`. No upgrade or private ledger change has been performed
at implementation freeze. It is an eval budget-format upgrade, not a B137 authority
or historical-decision migration.

`run-provider-qualification.ts` accepts an exact execution reference and either
an exact predecessor digest (`--upgrade-ledger`) or a current same-key settings
proof digest (`--execute-live`). The latter requires a private
`together-qualification-settings.json` based on the observed guardrail change.
Missing settings proof stops before credential access. Do not invent this receipt.
No existing Fireworks claim or operator-configuration artifact is rebound.

The public strings test exact JSON, whitespace and CRLF replacement transport.
They do not exercise experimental task difficulty, Work Item/Memory efficacy,
sustained rate capacity or a five-replicate campaign.
