# Consumer input granularity and propagation review

Status: reviewable proposal; no implementation or semantic lock. Owner context: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. Source baseline: `20ba5883`, latency evidence: `e5c000d7`. This continues the existing performance investigation, not the earlier A/B/C construction choice. Classification: design/diagnostic proposal; no D# or authority mutation is needed to inspect already-supported inputs.

## Finding and recommendation

**First exercise the existing single-reference arrival input. Do not design a new delta API or change propagation yet.** The prior one-new benchmark re-sent all 64 references and then verification. The implementation already accepts subsets of arrival references. That makes a bounded comparison possible without changing library behavior, adding indexes, or changing the user's composition model.

This is not a replacement for the full-frame benchmark. Full-frame replay remains a required workload. A faster subset action would establish a useful interaction path, not fix the cost of whole-set work or qualify D168/D169. It also would not prove progressive disclosure or eliminate Graph overhead.

Evidence: `causal-inputs.ts:39` defines ArrivalFrame; `:359` validates its reference list. `causal-business.ts:278` resolves pending refs; `:298` consumes each arrival frame; `:103` joins via retained per-input occurrence maps and touched keys. `spending-preset-plain.ts:182` also accepts listed refs. Existing `spending-alerts-preset-reference.test.ts:185` exercises sequential single-reference arrivals and invalidation recovery. Single-reference performance at P6 remains unmeasured.

## Three different boundaries

| Input/work | Current meaning | Proposed treatment |
|---|---|---|
| Arrival references | Select evaluations from the bound pack; repeated refs remain actual inputs | Compare full list with last-ref-only through the existing input |
| Verification/current/local/inbox frames | Available facts supplied as complete frames; omitted permission cannot silently remain current | Keep exact full-frame values and ordering; do not reinterpret as patches |
| Multiple DATA frames | Each can carry validity changes, issues and observable consequences | Preserve frames, order and dependency/wave behavior |

`causal-business.ts:179` explicitly documents complete available frames, not patches over old permissions. `join:111–142` clears unavailable/invalid dependencies. An arrival invalidation followed by another valid reference cannot automatically restore every old eligible evaluation: the existing reference test checks this. Therefore subset/full equivalence is conditional on identical valid prehistory; it is not a universal rewrite rule.

## Minimal composition and user burden

Existing pack + arrival sources → evaluationSelections → transaction/vendorStats/userProfile/policy → joins → material/proposal → the single authority → existing projections. Policy/evidence sources retain explicit dependencies. The proposal leaves this topology unchanged and adds no user-facing switch, mode, export or second owner.

An application that already knows which evaluation arrived can send that reference. An application receiving a full snapshot can still send the full list. We do not require ordinary users to build a diff engine or remember which authority facts have been processed. Any future snapshot-to-change adapter needs its own ownership/lifecycle design and is outside this proposal.

## Bounded next diagnostic specification

Keep original P1/P3/P6 immutable inputs, product bytes and plain/reference/candidate implementations. Add a separate diagnostic recipe, never edit the frozen 84-row schedule.

For P3 and P6, use two prehistories: (1) first N−1 valid refs processed, last ref unseen; (2) all refs already processed. For each, exercise full-list and last-ref-only arrivals, once and twice in the same input step. This is 16 action recipes. Each recipe gets three fresh processes, rotating arm positions: 48 processes. Each arm gets two warmup observations and five measured observations on fresh equivalent instances; preparation is outside clocks.

For P6 new-ref recipes, preserve verification absence before arrival and submit the identical full verification step afterward, matching the historical timing boundary. Record separate synchronous arrival and verification durations, plus their sum. P3 retains its existing verification-ready prehistory. Do not move expensive work outside the reported total. Construction/preparation timing is separately recorded. Limits: 120 s/process, 1,800 s total, sampled RSS 2 GiB operational cap, zero retries. Any failure stops capture and retains partial artifacts. These are proposed diagnostic limits, not formal performance budgets.

Compare arms only on identical recipes. Across full-list/subset recipes, compare business results for the selected occurrence and exact retained authority/material/currentness consequences where equivalence is expected. Do not assert equal raw assessment-frame row counts or equal graph invocation counts: the selected input intentionally differs. Preserve a trace of intermediate admission/outcome changes; a final-state match alone cannot prove safe equivalence. Distinguish repeated observations from independent processes; report all repeats and medians, not a qualified p95.

Success means a reproducible answer to: how much work is removed by selecting one reference; how much remains in full verification/authority processing; does the narrow path approach 100 ms without changing its obligations? No promised speedup. If verification dominates, that is a measured next target, not permission to make verification incremental.

## Correctness and adversarial acceptance

| Scenario | Required observation |
|---|---|
| Valid N−1 history → last ref | Same selected business decision/material/admission as full-list recipe under identical facts; prior obligations unchanged |
| Full prehistory → duplicate last ref, one/two DATA | No extra execution authorization or terminal settlement; retain any required replay evidence |
| Invalid arrivals → valid last ref | Only legitimate reactivation; do not resurrect old eligibility by assuming subset/full equivalence |
| Valid → invalid → valid within supplied frames | Preserve invalidation and issue consequences; no last-value-only filter |
| Empty/omitted verification or stale occurrence/admission | No retained old permission used as current authorization |
| Fan-out/fan-in with unavailable dependency | No mixed-occurrence join or effect authorized from incomplete facts |
| UI detach/reconnect while admitted | Runtime retains obligation/material until the exact lifecycle boundary; no unsubscribe settlement |
| Wrong outcome followed by exact terminal outcome | Wrong correlation cannot settle; exact admitted obligation alone can settle |
| Unknown ref / conflicting pack / capacity overflow | Preserve existing rejection and issue behavior; no normalization before capacity accounting |

Reuse independent business oracle and plain implementation; add assertions at the actual authority/publication boundary, not just selector output. Proposed loaded runtime mutations: replace invalid frame handling with skip; keep omitted verification permissions; drop unknown-ref issue; settle on detach; accept mismatched outcome. Each must produce an observable failing correctness check. Existing mutation evidence is reusable background, not proof for newly added recipes. Timed runs must wait for recipe correctness/preflight checks. No actual external effect is executed.

## Q5 — Abstraction and placement

The right immediate unit is a consumer diagnostic recipe using an existing input, not a substrate primitive. Selection is already graph-visible and occurrence joins already retain bounded node-private maps. Generalizing a delta framework now would add ownership and validity rules without evidence of need. No new name or public symbol is proposed; F-GRAPH-FIRST-API and the closed verb set remain intact.

## Q6 — Long-term invariants and maintenance

INVARIANT: subset arrivals do not mean partial policy snapshots. INVARIANT: identical valid prehistory is necessary for the limited cross-recipe comparison. INVARIANT: invalidation does not erase admitted obligations. INVARIANT: the exact pack binding and occurrence identity remain authoritative. The recipe must document preparation and verification timing so later benchmark changes cannot hide cost. Original formal rows remain immutable (TS D168/D169); D160/D163/D164 retention and projection boundaries remain governing.

## Q7 — Reactivity, composition and simplification

Use the existing two sources and declared joins. No graph-internal cache peeks, imperative triggers, dispatcher bypass, persistent lookup table or cross-wave encoding cache. `describe()` retains the same node/edge structure; inputs and traces explain the differing work. R-msg-format still gives each ctx.down array its existing wave meaning. This simplifies the proposed next step from new architecture to selecting fewer already-addressable evaluations. It does not prove existing audience-level exports are sufficiently hidden.

## Q8 — Alternatives

**Existing-input diagnostic (recommended):** `ArrivalFrame{packRef,evaluationRefs:[last]}`. Pros: supported shape, no runtime state/API additions, isolates full-list work. Cons: cannot improve unavoidable full snapshots, verification may dominate. Precedent: current selector/plain code and existing single-reference tests above.

**Consumer frame aggregation:** collect per-frame projected output and emit together. Pros: may reduce repeated downstream invocations while retaining payloads; local consumer implementation. Cons: separate ctx.down calls are separate waves; grouping can change invalidation and intermediate admission behavior. The current join has per-invocation touched-key collection, but that is not precedent for crossing emission boundaries. Requires a trace-equivalence design before implementation.

**Persistent delta tracking/cache:** remember previous input and derive changes. Pros: may reduce repeat work for snapshot callers. Cons: extra ownership/retention, conflict/invalidation rules, memory and user mental model; explicitly excluded by the user's no-new-registry/cache direction. Not proposed.

## Q9 — Coverage and decision

| Concern | Existing-input diagnostic coverage |
|---|---|
| Correct placement / no new primitive | Yes: private fixture only |
| Composition / graded entry points | Preserved; no new proof of progressive disclosure |
| Existing validity/lifecycle semantics | Preserved in product; new recipe assertions still to implement |
| Lower interactive latency | Unknown until measured |
| Full-frame cost | Exposed and retained; not solved |
| Formal performance acceptance | No: unchanged and incomplete |

Recommendation: implement the bounded diagnostic above under the user's existing diagnostic-tool authorization; no additional architecture decision is required. Product aggregation is a separate possible subsequent proposal, not authorized by a favorable diagnostic. This document itself changes no implementation, frozen protocol or owner ledger. Next implementation must keep baseline/full-list evidence visible and stop at a clear measured answer instead of expanding diagnostics indefinitely.
