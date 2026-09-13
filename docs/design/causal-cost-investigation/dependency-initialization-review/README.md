# Dependency initialization source review

2026-09-12 · owner `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS` · reviewed HEAD `7a229382`.
Read-only audit and proposal, not implementation authorization or a new architectural lock.
No consumer execution, new profile, performance sample, or production change in this review.

## Conclusion and evidence boundary

The repeated `makeDepBookkeeping` leaf frame is a bounded optimization candidate, not a diagnosed
slow-tail cause. The [aligned capture](../aligned-capture/README.md) found 61/446 slow and 767/4505
ordinary certain measured leaf points at that function; these counts are not duration shares.
There is no demonstrated duplicate authority, duplicate constructor initialization, or removable
parallel state. Do not attribute the consumer's RSS to these arrays.

Codegraph located the factory and its consumers; its index also contains archived copies. Targeted
source reads resolved the current implementation rather than interpreting duplicate search matches as
runtime calls. All six source files listed below match the capture's retained source bytes; hashes are
in `source-binding.json`. This binds the audit to the measured implementation, not to a speculative patch.

## Ownership and lifecycle trace

Paths below are relative to `packages/ts/src/node/` in this repository.

| Source | Finding / consequence |
|---|---|
| `core.ts:284`, `node.ts:263` | One factory call per constructor. Ten dependency-indexed arrays and two initially empty subscription arrays. Source-level count: 12 outer arrays plus 2n nested arrays, and one bookkeeping object. This is not a V8 heap allocation measurement. |
| `core.ts:150`, `core.ts:193`, `node.ts:340` | Core stores the exact `state.dep`; Node retrieves it. No copy. Constructor ends in method retention and registration, not a second reset. |
| `node-lifecycle-runtime.ts:7` | Activation replaces empty `unsubs`/`idxBoxes` with sized arrays before subscribing, so synchronous cached delivery can record cleanup immediately. Removing their initial arrays would require an optional-state contract across inactive rewire/release; not a factory-only deletion. |
| `node-input-runtime.ts:7` | Each dependency has mutable wave projections and live-origin arrays. New wave token appends a projection. Sharing mutable empty arrays would cross-contaminate dependencies/nodes. |
| `node-input-runtime.ts:135` | `batch[idx] === null` selects first DATA. Sparse/undefined initialization would select `.push` on undefined. Array iteration also treats holes differently. |
| `node-context-runtime.ts:28`, `:66`, `:107` | Context creation/reuse consumes dense wave arrays; async snapshots copy nested arrays. Lazy storage would affect context readers and snapshot semantics, not just allocation. |
| `node-input-runtime.ts:327` | After a run, wave-local arrays and terminal input reset; retained prev/data/terminal state does not. Reusing nested arrays by clearing in place requires a separate escaped-context lifetime proof. |
| `node-lifecycle-runtime.ts:57`, `:76`, `:214` | Restore seeds dependencies; deactivate unsubscribes and resets dependency state. These later transitions are not redundant constructor initialization. They do not define permission to settle causal obligations. |
| `node-rewire-runtime.ts:108` | Rewire carries kept dependency state/subscription boxes, drains removed boxes with index -1, starts added dependencies fresh and resets wave-local projections. New indices must remain aligned before cached deliveries. |
| `node-lifecycle-runtime.ts:128` | Release clears references and closes registration. It is distinct from temporary display unsubscribe and does not justify early causal authority settlement. |

`batch` stores current reduced input; `waveData`/`waveTokens`/`waveLive` preserve wave boundaries and
origin. `prev`/`hasData` preserve value presence; `dirty`/`tier` track readiness; `terminal` retains
terminal status while `terminalInput` is transient. `unsubs`/`idxBoxes` own edge cleanup/routing.
Equal scope alone does not make these fields interchangeable. They already belong to one bookkeeping
object. No new registry, WeakMap, cache, or public configuration is needed for the narrow candidate.

## Q5–Q9 review

### Q5 — Abstraction

Keep dependency bookkeeping private in the substrate. This proposal concerns allocation syntax in
`makeDepBookkeeping`, not a new capability or preset. No new verb, public option, dispatcher bypass,
registration authority, or generic transaction. Do not reopen the previously selected registry C.

### Q6 — Maintenance and invariants

INVARIANT: every dependency slot has the same initial values as today, including null versus undefined.
INVARIANT: each mutable nested array is unique per dependency and node.
INVARIANT: array order matches topology; ownership and cleanup remain unchanged.
INVARIANT: reset, restored activation, async snapshot and stale-callback semantics remain unchanged.
A source-level loop rewrite can still alter engine element kinds and performance. Neither speedup nor
RSS reduction follows from fewer callbacks. It must remain easy to discard if evidence is unqualified.

### Q7 — Composition and simplification

For two sources → derived join → sink, topology, dispatch, input projection, and outputs stay identical.
No user must choose storage mode or call an initialization trigger. Library maintainers see only a
local constructor change; framework authors and ordinary users see no added concepts. Graded exports
remain a separate unfinished deliverable. Dependency loss is handled by the existing rewire path.

### Q8 — Alternatives (local alternatives, unrelated to earlier registry A/B/C)

| Alternative / shape | Benefits | Costs / limits |
|---|---|---|
| Keep current `fill` + `Array.from` | Small existing factory; known behavior; no change risk | Repeated initialization operations remain; no new performance gain |
| Single-pass eager initialization: allocate existing arrays, then `for i<n` assign the same ten initial values, including unique `[]` pairs | One bounded function; avoids repeated traversal/callback setup; keeps downstream readers unchanged | Same 12+2n array count; engine may favor existing builtins; performance unknown; does not explain tail |
| Lazy/optional projections or shared immutable empty representation | Could avoid some unused initial objects | Changes readers/context/rewire/reset; first-use branch and allocation move into live waves; larger proof and maintenance cost; no evidence current workloads benefit |

Local precedent for eager indexed initialization is `nodeResetDepState` (`node-lifecycle-runtime.ts:214`)
and rewire rebuilding (`node-rewire-runtime.ts:116`); these are semantic examples, not performance proof.
No external framework precedent is claimed.

### Q9 — Recommendation and coverage

Recommend preparing **single-pass eager initialization** as the only next candidate, while retaining
the current implementation until that bounded change is approved and verified. It directly targets the
observed factory with the smallest semantic surface. Do not implement lazy storage or merge fields.

| Concern | Coverage |
|---|---|
| Ownership, topology, dependency loss and composability | Yes by proposed unchanged representation/call paths; behavior verification still required |
| User cognitive burden and public API | Yes: no new entry or option |
| Identity, lifecycle, retained evidence separation | Yes: no causal authority changes |
| Initialization CPU cost | Partial: plausible mechanism, no measured gain |
| Object count / RSS reduction | No: explicitly not claimed |
| Single slow-tail explanation / D169 qualification | No: remains unknown / incomplete; this candidate cannot stand in for method qualification |

Residual risk is engine-dependent cost and no meaningful consumer benefit. Accept that uncertainty only
for a bounded comparison candidate, not as a reason for another open-ended profiling series.

## Concrete next batch and acceptance proposal

1. After review, change only the factory initialization body; preserve returned field order, types,
   defaults, array independence and all downstream lifecycle code. No production instrumentation.
2. Verify cold construction, zero/one/many dependencies, independent nodes, batched fan-in/fan-out,
   terminal/INVALIDATE, detach/reactivate, restore, dependency removal/reorder and stale callbacks.
   Existing starting suites: `rewire.test.ts`, `rewire-deferred.test.ts`, `batch-dynamic.test.ts`,
   `lifecycle.test.ts`, `graph.restoregraph-fresh-graph-restore-r-restore-d94-d95.test.ts`,
   `causal-cold-assembly.d162.test.ts`; names identify relevant coverage, not a claim they prove every
   invariant. Review gaps before adding only behavior-significant cases.
3. Run applicable full offline tests, lint/build/export/artifact gates and original causal oracle,
   plain/reference and real runtime mutations. Any existing frozen source binding drift is explicit;
   never silently refresh a receipt to make it pass.
4. Before real measurement, prepare a finite uninstrumented parent/candidate comparison with fixed
   same-version controls, both orders, all samples retained and construction plus first-use/steady
   costs. Bind exact inputs/runtime and resource/stop limits in its execution plan. A factory microbench
   alone cannot establish consumer benefit. New execution scope remains separate; this report grants none.
5. If controls fail or outcome is mixed, report unqualified and retain baseline. If qualified, report
   consumer effect and uncertainty separately from unchanged allocation count and formal D169 status.
   No additional sampling rounds follow automatically.

This source-audit direction is complete. No single root cause has been found; no new library speedup,
RSS saving, graded-export completion or formal performance qualification is claimed.
