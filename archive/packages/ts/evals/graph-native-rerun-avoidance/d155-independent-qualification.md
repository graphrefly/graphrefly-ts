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
as `.before-qualification`. The approved upgrade was performed only after clean
committed-state full QA. It is an eval budget-format upgrade, not a B137 authority
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

## Committed-state QA closeout — 2026-09-03

- Implementation commit: `75f27d9f` (D155 initial implementation `8673fe29`).
- `NODE_ENV=test pnpm test`: 2,208 passed, four existing environment-gated skips;
  134 passed files / one skipped. Logged DONE exit 0 after 634 seconds:
  `.runlog/run-20260903-064622-42280.log`.
- Lint/typecheck, build/ESM/CJS/DTS exports, artifact reproduction, authority,
  dashboard and diff gates passed. No public API, protocol or conformance changes.
- Formal root eval remains 311 nodes / 413 edges; node names and edges exactly
  match baseline `44a44c9c`. Generated digest metadata reflects the new closure.
- Frozen implementation: `sha256:e495ae9174a54443392d6d76d5780dddca5718efe3368f7b7f9e9f1a2dbfc2b1`.
- The preliminary full run was intentionally stopped when public endpoint data
  exposed the cache-price mismatch; it is not cited as passing QA.
- Explicit budget format upgrade preserved the original three campaign entries,
  development spend 35,835,756 microusd, confirmatory spend and qualification
  streak. Original ledger digest:
  `sha256:ac37f63e1a6964966e15b24d2a906b81a0690095d0fe0ef3d212db6a63b8305a`.
  Current v2 digest:
  `sha256:4e6bc47310c24614a02c58ca5a69ad4b42772607b931ab8db7c3eb3b041be848`.
- Qualification entries: zero. No credential access, inference dispatch, provider
  spend or browser settings mutation occurred. The browser is on Local Eval 2's
  existing guardrail, awaiting action-time confirmation to add Together while
  retaining Fireworks, the one allowed model, ZDR and training/budget restrictions.
  Do not infer live execution from this closeout.

## Approved Together execution closeout — 2026-09-03

Execution evidence, not a new decision or campaign authorization:
`provider-qualification-together-2026-09-03-1`, implementation `75f27d9f`,
executed from clean documentation HEAD `06aad808`. The user's action-time
approval authorized saving the existing Local Eval 2 guardrail with Fireworks
**and** Together allowed, then the previously approved three-request / USD 0.10
qualification. No other setting was changed. Saved UI confirmed one allowed
model (DeepSeek V4 Flash 0731), non-frontier ZDR enforced, paid training disabled,
Together eligible, and the unchanged USD 32 daily guardrail. Together BYOK was
not configured. The guardrail's historical descriptive text still says
Fireworks-only; that text was not edited and is not routing authority.

- Settings proof digest:
  `sha256:9838ebf6406909c2c97626d72e39c3204ebed8e1906f38ba07ffabc6600ecb92`.
  An initial local preflight rejected pretty-printed proof bytes before external
  checks or inference; formatting those same values with `strictJsonCodec.encode`
  resolved it without changing the semantic digest or implementation.
- Exactly two serial HTTP 200 responses identified Together and the exact model.
  Request 1 passed. Request 2 returned valid replacement JSON but omitted the
  leading U+0009 tab from both `oldText` and `newText`. The admitted request
  contains those tabs; the saved raw response does not. This is a response
  content mismatch, not a local parser trim or lifecycle settlement failure.
- Graph terminal reason: `provider-rejected`; exact outcome reason:
  `qualification-content-mismatch`. No request 3 was admitted/dispatched, so CRLF
  preservation was not tested. No 429 occurred in these two calls; this does not
  establish sustained capacity or comparative provider quality.
- Provider `usage.cost`: USD 0.00002114 + USD 0.00002002 = USD 0.00004116.
  Per-response ceiling to integer microusd accounts 22 + 21 = **43 microusd**.
  The reservation settled atomically; development spend is **35,835,799 microusd**,
  leaving **4,164,201 microusd** under the existing USD 40 ceiling. All original
  campaign entries, streak and confirmatory fields are unchanged. No pending
  D152 write/execution lock remains.
- Settled ledger digest:
  `sha256:d030bd2b7f7c71dc7496bfdaccf9b5474250bdd4d602c492d17e0fc4d2c85933`.
  Terminal receipt digest:
  `sha256:cecde352976dcf59486926434e4249f7c3308026880e19d5a0352d87131f0c65`.
- Offline replay of the exact two saved responses through the qualification
  Graph reproduced both outcomes, costs and terminal receipt, with null next
  admission. All eight private artifacts are mode 0600; the 35 original domain
  observation envelopes include the matching terminal DATA. Raw `describe.json`,
  `observation.json`, admissions, responses, grant and receipt remain under the
  ignored private directory named by the execution reference.

Result: **Together qualification did not pass**. Route availability and the first
exact proposal succeeded; whitespace fidelity did not. The program's exit 0 means
the attempt settled correctly, not that qualification passed. No efficacy claim,
candidate promotion, campaign generation, automatic retry or additional spend
was authorized by this evidence. The consumed reference must not be rerun; a
later paid attempt needs fresh explicit authorization. Do not relax exact-text
validation or repair returned whitespace merely to turn this result green.
