# Causal cold construction: internal accessor registry review

2026-09-09 · source baseline `3b9d0ba0` · owner `graphrefly-ts`

Investigation and review evidence for `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`.
The user asked whether the observed WeakMap is necessary or violates invariants,
then asked to continue. This report makes no architectural lock or implementation
change. Existing private investigation and commit authorization applies.

## Conclusion

**WeakMap is not, by itself, a hidden business authority. The current six eager
accessor registries are not required by the governing contracts.** They connect a
Node identity to private runtime access functions; canonical state stays in that
node's runtime storage. The observed `checkpointReaders` table holds functions,
not a second occurrence/admission/outcome ledger.

There is nevertheless a concrete thin-node concern: every bare Node pays for
checkpoint/restore accessor registration even when no graph inspection is used.
Moving inspection methods outside the public Node interface does not by itself
satisfy the whole intent of `graphrefly:D5` / `R-node-thin`. Treat this as an
implementation-boundary concern to resolve, not an exemption inferred from the
word “internal”, and not grounds to abandon the approved construction design.

## Verified paths and limits

Source references below are relative to the repository at the baseline commit.

| Path | Actual role | Boundary that must survive a replacement |
| --- | --- | --- |
| `packages/ts/src/node/runtime-accessors.ts:19` and `packages/ts/src/node/node.ts:347` | Six per-node function registries: checkpoint read, restore write, release, quiescence, subscriber count, activation. | Canonical state remains node-owned; no copied domain ledger. |
| `packages/ts/src/graph/graph.ts:984` and `packages/ts/src/graph/graph-support.ts:46` | Graph checkpoint reads runtime state and describes its factory. Unregistered live dependencies can also be inspected. | External inspection must not become dependency cache peeking inside reactive computation. Graph registration alone is therefore not a sufficient replacement validity test. |
| `packages/ts/src/graph/restore.ts:932` | Fresh-graph construction installs previously validated runtime state before returning the graph. | Preserve `graphrefly:D94`: internal restore commit, no public setter, fresh DATA, activation, or live restore. |
| `packages/ts/src/graph/graph.ts:339` | Release first checks external dependencies, runtime quiescence and external subscribers; then retires identities and invokes cleanup. | Keep graph ownership, rejection before removal, ID retirement and cleanup failure handling. |
| `packages/ts/src/node/node-lifecycle-runtime.ts:138` | Runtime release clears state/resources and explicitly deletes accessor registrations at lines 213–220. | Preserve released/unknown-node behavior and release idempotence; do not substitute UI unsubscribe or GC. |
| `packages/ts/src/node/node-runtime-host.ts:101` | Existing internal `nodeRuntimeHost(node)` accesses the same private runtime shape through a TypeScript cast. | This is a reuse candidate, **not a runtime identity validator**. A cast alone cannot replace WeakMap membership checks. |
| `packages/ts/src/core/index.ts:30` and `packages/ts/src/index.ts:425` | Explicit Node exports omit the internal accessor helpers. | Keep the helpers out of public entry points; require export checks for any later implementation. |

The graph's `_entries` and `_byId` maps strongly retain registered nodes
(`graph.ts:279–289`). A WeakMap does not expire an entry while its key remains
reachable. Its weak-key behavior prevents the auxiliary registry alone from
keeping an otherwise unreachable node alive; it provides no durable retention
guarantee and no business settlement event.

`graphrefly:D23` prohibits implicit shared domain state. The inspected accessors
do not implement cross-node business coordination: checkpoint is inspection,
restore has the explicit D94 boundary, and release has D122/D124 ownership rules.
This is a reading of those contracts together, not a general exception allowing
arbitrary shared runtime maps. A domain fn using these helpers to read another
node's state or settle an obligation would require a different verdict under
`R-data-not-peek` / `R-no-imperative`.

**Runtime quiescence is not business completion.** An admitted effect may still
await an outcome while the synchronous wave is quiet. The existing causal
instance's graph-owned leases and retained authority obligations under
`graphrefly-ts:D160/D161` must remain; a replacement must not infer completion
from no UI subscribers, no pending wave, a collected weak key, or a release call.

## Q5 — Abstraction and placement

Review one internal access boundary, not all runtime storage. Graph inspection,
fresh restore and graph-owned release need access to existing private state.
They do not need six per-node closure registries or six new public Node methods.
Keep business identity/lifecycle/evidence in the approved single authority.
Ownership tokens and topology observers have different roles and are outside
this proposed replacement; a blanket removal of WeakMaps would be unjustified.

## Q6 — Long-term cost and hidden invariants

INVARIANT: one canonical runtime state; unknown and released identities retain
their defined reject/default behavior. INVARIANT: live bare dependencies remain
checkpoint-readable. INVARIANT: synchronous inspection and fresh restore do not
invoke user computation or manufacture messages. INVARIANT: graph release retains
its complete preflight and resource cleanup, including failure accounting.
INVARIANT: UI detachment cannot settle admitted obligations.

Costs to compare are whole-construction time, retained allocations, steady reads
and release, with instrumentation interference separate. Shared module registry
maintenance can affect allocation timing across constructed graphs; that is not
evidence of cross-graph semantic influence. User concepts must remain unchanged.

## Q7 — Reactive shape and simplification

The spending inputs → candidate/verification → authority → business projections
and output ports remain exactly the same. Changing this internal access mechanism
must preserve node/factory/ordered dependency identities and all dispatcher
invocations. It introduces no new graph node, hidden business input or imperative
trigger. Existing `nodeRuntimeHost` is a smaller precedent than another public
capability or general transaction abstraction. Its use must stay in substrate
mechanics, inspection and the already specified lifecycle boundaries.

## Q8 — Named alternatives

These compare an internal implementation detail; they do not reopen the earlier
construction A/B/C decision.

| Alternative | Shape / precedent | Advantages | Costs and risks |
| --- | --- | --- | --- |
| Current per-operation registries | `WeakMap<Node, () => State>` and five sibling tables; current code. | Natural identity membership; private closures; existing cleanup behavior. | Six registrations/closures per Node, including unused inspection; shared table maintenance; public thinness does not remove construction cost. |
| Shared internal functions over existing runtime storage | `checkpointStateOfNode(n) → validated internal host → state`; existing `nodeRuntimeHost` and `NodeCore` precedent. | Avoid per-operation registration and per-node accessor closures; preserve current external surface and canonical storage. | Must design identity/liveness validation rather than rely on a cast, `instanceof`, or field presence; direct field coupling; performance benefit remains unmeasured. |
| One identity registry for a runtime record | `WeakMap<Node, InternalRecord>`; consolidation of the current local pattern. | Explicit identity membership; fewer table writes; no public methods. | Still eager record/registry allocation and table maintenance; must not duplicate canonical state; not proven faster. |

No external-library analogy is needed to justify these candidates: both reuse
mechanisms already present in this runtime, whose behavior is the relevant baseline.

## Q9 — Recommendation and remaining proof

**Recommend evaluating shared internal functions over existing runtime storage.**
It targets the observed registration work, reuses an existing internal boundary,
and adds no user concept. This is a recommendation for a concrete replacement
design, not approval to land it or a claim that it repairs the failed budget.

| Concern | Coverage | Required disposition |
| --- | --- | --- |
| Thin public Node and no new user concepts | Yes at proposed surface level | Preserve exact package exports. |
| Avoid eager per-operation closure/table registration | Yes by proposed shape | Inspect generated code and allocation behavior after implementation. |
| One canonical authority and reactive topology | Yes by scope | Exact topology and occurrence/admission/replay regressions. |
| Unknown/released identity and live bare dependencies | Partial | Specify a non-forgeable runtime identity/liveness guard before implementation; do not silently replace it with a structural cast. |
| Fresh restore and graph-owned release | Partial | Preserve existing rejection/default behavior, cleanup failure accounting and lifecycle tests. |
| End-to-end performance budget | Unproven | Private bounded comparison first; a separately admitted formal attempt is still needed. |

The next design step is a method-by-method replacement contract for these six
helpers, including exact invalid-identity behavior and the guard's ownership and
allocation cost. If it cannot remove registration without weakening those guards,
compare the single-record registry instead. No all-module redesign is needed.

For a later approved implementation, first verify checkpoint/restore, bare/live/
released identities, external-dependent release rejection, failure cleanup,
pending obligations across UI detach/reconnect, exact outcomes and replay. Then
compare identical generated candidate/reference copies with the same mechanism
in both arms, whole construction as the primary diagnostic, original node order,
retained raw attempts and no changed threshold. Apply all applicable offline
gates to a real source change. Never count moving the expensive insertion to a
different node as a performance repair.

## Evidence status

Prior measurements remain at
[preset-current-order-v1](../../packages/ts/qualification/causal-occurrence/preset-current-order-v1/README.md).
They show that the larger interval follows construction position 22 in the
instrumented candidate, plus a checkpointReaders backing-table replacement in
one non-timed V8 inspection. They do **not** establish table capacity, exclusive
cost, all-registry attribution, or the historical failed p95's unique cause.

This review ran no benchmark, runtime mutation, offline behavior suite or formal
qualification. No source/reference/frozen receipt changed. The original
P2-summary ratio **1.211671 > 1.20** remains rejected, with **80 rows unrun**;
the same work stays incomplete. Documentation/workspace gates are recorded by
the accompanying commit workflow. No new D#, execution grant or downstream
dispatch is created.
