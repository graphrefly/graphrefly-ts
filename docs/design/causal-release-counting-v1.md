# Release-local subscriber counting proposal

Status: reviewable proposal, not implementation or capture authorization. Owner: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. Baseline commit `9a5b148c`; evidence: `causal-release-boundaries-v1-implementation/receipt.json`. Existing work remains incomplete. This is an implementation strategy under graphrefly:D122/D124/D152 and graphrefly-ts:D161/D167, not a new lifecycle contract or an A/B/C architecture reconsideration.

## 1. What the evidence actually isolates

The four R measured processes place 62.33–62.62% of whole release elapsed time in the combined quiescence/subscriber guard interval. This is not exclusive time for any one loop, nor proof of the original cold-construction p95 cause. No new samples were taken for this proposal.

Current source is more specific than the interval name:

- `packages/ts/src/graph/graph.ts:334`: quiescence is tested once per released node.
- `graph.ts:340–346`: for EACH target, rescan other released entries, test their activity, then scan active dependents' live dependencies to count matches.
- `packages/ts/src/node/node-lifecycle-runtime.ts:108`: quiescence includes wave, dependency and control state. Inactive does not imply quiescent.
- `packages/ts/src/node/runtime-accessors.ts:187`: activity is an exact-issued-identity read of runtime activation state.
- `packages/ts/src/node/node.ts:402`: ordinary Node.deps returns its live slot dependencies without running computation.

Thus the proposed optimization is repeated internal-subscriber accounting, NOT removal or caching of the quiescence predicate.

## 2. Concrete recommended change

Limit production changes to the private `_releaseNodes` accounting block in `packages/ts/src/graph/graph.ts`. Keep entry resolution, external-dependent validation, predicates, runtime release, ownership cleanup and topology-event publication unchanged.

Use an optional invocation-local `Map<Node, number>`, built once only after the first entry passes its quiescence check. Iterate the deduplicated registered release entries. For each active dependent, iterate its current deps; for each dep inside the existing releaseSet other than the dependent itself, increment its count. Preserve repeated dependency occurrences; do not convert deps to a Set. Missing map keys mean zero. A singleton group needs no map or activity scan because the existing loop excludes self. An empty group follows the existing path unchanged.

Then retain the ORIGINAL target-entry loop and order: quiescence(target), compare actual subscriber count against computed internal count, proceed to next target. Never precheck all quiescence predicates first: an early live-subscriber error must still precede a later nonquiescence error. External-dependent rejection remains before either.

The map is local scratch storage, dies on return/throw, and is never attached to Graph, Node, authority, a registry or a context. No invalidation, rewire hook, subscription hook, configuration, public helper or extra export is introduced. Rejected release followed by reconnect/rewire/retry computes fresh counts.

For fixed runtime facts, the original count for target t is the sum, over active release members d != t, of occurrences of t in d.deps. The proposed traversal computes exactly this sum by reversing the loops, restricted to targets in releaseSet. It leaves the acceptance inequality `subscriberCount(t) > internalCount(t)` unchanged, even where one might prefer a different interpretation of the old predicate.

## 3. Cost and correctness boundaries

Let n be resolved release members and E_a the total dependency occurrences of active members. Old activity checks are n(n−1); dependency visits are at most (n−1)E_a. Proposed successful multi-member accounting uses n activity checks, E_a dependency visits and O(n) transient map entries. Existing external checks and quiescence costs remain. The frozen 60-member group gives 3,540 versus 60 activity reads as static arithmetic; 93 total deps only bound E_a. These are NOT measured time savings.

No extra allocation is added to construction, activation, subscription, rewire or steady propagation. Multi-member release allocates one transient map; tiny groups may pay more than the old loop. Do not add speculative size thresholds or persistent counters to hide that possibility. Measure before making a zero-overhead or net-performance claim.

INVARIANT: accounting and ordered validation operate on one synchronous, non-mutating runtime view. Ordinary accessors above are read-only, and user cleanup begins only after all guards. Instrumentation must not insert a callback into this window. Arbitrary monkeypatches or subclass overrides of deps/private runtime methods could make reordered reads observable: qualification must inspect supported extension paths; if a supported accessor can mutate/reenter/throw in that window, stop and revise this proposal instead of silently declaring it unsupported. Do not add a fallback branch or broad runtime-accessor redesign without review.

INVARIANT: rejection leaves registry entries, retired IDs, runtime resources, owner records and topology events unchanged. Successful validation retains existing full commit and first-runtime-error behavior, including later cleanup execution and retained failure evidence. Display unsubscription alone never settles causal obligations; this optimization adds no lifecycle authority or settlement path.

## 4. Proposed next implementation batch and acceptance

Approval of this section would authorize only the one-file production change, necessary offline tests/mutations, QA, source/receipt binding and commit. It would NOT authorize new consumer performance samples, a formal matrix, another diagnostic capture, protocol/API work, live/provider/spend work, or automatic downstream dispatch.

Required qualification:

| Scenario | Required evidence |
| --- | --- |
| Empty/singleton; duplicate input; unknown member | Same accepted members, ordering, resource/event outcomes; no unnecessary map for empty/singleton |
| Fan-out/fan-in with active and inactive dependents | Original predicate and count equality; inactive members still undergo full quiescence checks |
| Duplicate deps, self reference, deps outside release set | Preserve occurrence multiplicity, exclude self and ignore non-target deps for internal accounting |
| First external dependent plus any internal failure | External-dependent error first; no mutation |
| Early external subscriber / late dirty node, and reversed order | Preserve exact first error and entry name |
| Rejection → unsubscribe/rewire → explicit later release | Fresh invocation counts; no stale cache or unintended settlement |
| Dirty/pending/wave/rewire/pause/pull states | Existing quiescence predicate unchanged; rejection never commits |
| Cleanup failure, later member success, owner evidence | Existing first error, continue cleanup, retained failed owner, truthful events |
| Real registered-node lifecycle paths | Load production implementation; verify describe/find/profile/checkpoint/retired IDs and resource ownership |

Use a deterministic independent oracle implementing the original count equation over finite synthetic states. Include entry permutations, multiplicity and first-error competition; compare outcome and mutation trace, not only returned counts. Synthetic self/duplicate states test predicate equivalence without claiming all such states are legal public constructions. At least one active fan-in/out case must use real Node/Graph subscription and release paths.

Load actual candidate source with mutations removing active filtering, removing self exclusion, deduplicating deps, counting outside-group dependents, caching across calls, skipping quiescence, changing `>` to `>=`, reordering all quiescence checks ahead of subscriber checks, and moving registry removal before validation. Reject each through observable behavior. Assert operation counts with controlled hosts as complexity evidence, not timing evidence.

Run all applicable offline TS tests, release/registration/construction and causal obligation regressions, lint/typechecks, build/export/artifact checks and governance gates. Two existing D159 manifest failures must remain explicitly classified; never refresh frozen artifacts merely to make checks pass. Preserve all existing receipts and six root workspace changes. Review the production diff and test mutations before commit. No algorithm benefit is accepted solely because tests pass.

A subsequent performance proposal must separately bind candidate/reference bytes and a fixed no-retry budget, compare uninstrumented whole release and whole consumer lifecycle, include tiny and active groups, and report construction/steady costs separately. Keep frozen D169 tooling/evidence unchanged; this document grants no performance run.

## 5. Q5–Q9 review

**Q5 — Abstraction.** Keep subscriber accounting inside Graph's existing atomic release validation. Both topology groups and graph-owned collection views use this lifecycle. A local reduction over current dependencies fits that layer; a new registry, node verb or public capability does not. The map is an intermediate count, not authoritative topology.

**Q6 — Long-term burden.** One bounded local map avoids invalidation obligations across activation, rewire and teardown. Preserve exact identity, multiplicity, first-error order and no-callback validation. Supported accessor reentrancy is a qualification condition, not an assumed contract change. Tiny-group allocation remains a measured-risk item; no speedup claim yet.

**Q7 — Composition and explanation.** Two sources feeding two derived branches and one joined sink retain identical graph nodes, deps, dispatcher paths and describe output. Releasing that group still requires the same graph-owned boundary. Ordinary users receive the same view ports; framework authors the same issued capabilities; maintainers the same full topology. No user-facing concept, imperative trigger or role-dependent runtime is added. This preserves existing composition, but does not itself complete graded-entry usability evidence.

**Q8 — Local implementation alternatives (not the earlier architectural A/B/C).**

| Choice | Shape / precedent | Benefit | Cost |
| --- | --- | --- | --- |
| Keep nested scan | Current graph.ts:340 | No new allocation; exact existing access order | Quadratic repeated activity reads; repeated deps scans |
| Invocation-local counts | Existing releaseSet/releaseIds establish local scratch precedent | Linear accounting; no steady-state maintenance or new user model | Transient allocation; requires stable read-only validation window |
| Persistent reverse counts | Would need activation/rewire/unsubscribe integration | Potentially cheap repeated release queries | New maintained state and failure/invalidation burden across unrelated paths; wider unmeasured steady cost |

**Q9 — Recommend invocation-local counts.** It removes repeated work at the observed dominant interval and preserves registry/lifecycle ownership with the smallest production diff.

| Concern | Coverage |
| --- | --- |
| Existing layer and unique topology authority | Yes: one private block, existing live deps |
| Composition and audience entry shape | Yes: no exports or runtime topology change |
| First-error/rejection/cleanup obligations | Design preserves them; production qualification required |
| Stable synchronous reads | Ordinary accessors verified; supported extension paths must be checked during qualification |
| Performance and allocation | Partial: static operation reduction only; subsequent bounded measurement required |
| Original cold-p95 rejection / D169 | Unresolved and explicitly outside this batch |

No new durable D# is proposed because no semantic or authority boundary is intended to change. If qualification exposes such a change, stop and return it for review. Sections 2–4 are the concrete next implementation scope awaiting approval.
