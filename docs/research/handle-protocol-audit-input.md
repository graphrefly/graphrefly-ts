# Handle-protocol audit input for Phase 13.6.A

*Created 2026-05-02 as research artifact. Companion to:*
- `docs/research/handle-protocol.tla` — refinement spec EXTENDS `wave_protocol`
- `docs/research/handle_protocol_MC.tla` + `.cfg` — diamond scenario MC
- `src/__experiments__/handle-core/` — TS prototype (22 vitest tests passing)

## Why this doc exists

Phase 13.6.A is locking the "ultimate invariants document" by inventorying ~247 rules from spec + composition guides + memory feedback files. The handle-protocol architecture (Rust core + per-language SDK harness, with values opaque to the core) gives the audit a **cleaving plane**: each rule becomes either *core-internal* (enforced by construction in the dispatch engine) or *binding-layer* (a contract the harness must honor).

The cleaving is empirically validated:
- TS prototype implements the cleave; 22/22 vitest invariant tests pass.
- TLC verifies the cleave preserves all `wave_protocol` invariants under the refinement mapping. Five scenario MCs run clean — totals across pause/custom-equals/multisink/invalidate/diamond: **94,014 states, 39,331 distinct, depth ≤ 25, all under 10s combined**.

## Refinement mapping (the cleaving plane)

| `wave_protocol` concept | Handle interpretation | Boundary classification |
|---|---|---|
| `Values` (payload alphabet) | `HandleId` opaque integer space | Core-internal |
| `cache[n]` | `HandleId` slot | Core-internal |
| `dirtyMask`, `queues`, `version`, `status` | Same shape | Core-internal |
| `EqualsPairs[n] = {<<v,v>> : v ∈ Values}` (identity diagonal) | `equals: 'identity'` — handle-id compare | **Core-internal, zero FFI** |
| `EqualsPairs[n]` non-diagonal | `equals: customFn` — boundary call per emit | **Binding-layer, 1 FFI per check** |
| `Compute(n, val)` (state node fn) | `invokeFn(nodeId, fnId, depHandles)` | **Binding-layer, 1 FFI per fire** |
| `replayBuffer[n]` | Same shape, holds HandleIds | Core-internal |
| `pauseLocks[n]`, `pauseBuffer[n]` | Same shape | Core-internal |
| `handshake[sid]` | Same shape; START + DATA(handle) | Core-internal |
| `BatchSeqs` coalesced waves | Per-edge handle batches | Core-internal |
| Refcount / handle release | New concern; core notifies binding | **Binding-layer, 1 FFI per release** |
| Cross-language graph composition | New concern; out of scope for v1 | **Future research** |

## Rule-by-rule classification

References the rule IDs in `docs/implementation-plan-13.6-prep-inventory.md`.

### Pure-core rules — invisible to user-facing audit

These hold *by construction* in the Rust dispatch engine. The audit can lock them as protocol-internal contracts; downstream library consumers can ignore them.

| Rule | Topic | Verification |
|---|---|---|
| 1.1 | DIRTY precedes DATA/RESOLVED; DATA/RESOLVED exclusive | wave_protocol `DirtyPrecedesTier3` + `DataOrResolvedExclusive` |
| 1.3 | Equals-substitution (under identity diagonal) | wave_protocol `EqualsFaithful`; TS prototype `identity dedup` test |
| 1.4 | ERROR auto-prop default true | wave_protocol auto-cascade invariants |
| 1.5 | Tier-3 synthesizes DIRTY when not already dirty | wave_protocol push semantics |
| 1.7 | Tier-3 buffered while paused; replayed on final RESUME | `wave_protocol_pause_MC` + `wave_protocol_bufferall_MC` |
| 1.8 | Unknown-lockId RESUME is no-op | wave_protocol pause-action shape |
| 1.10 | Meta TEARDOWN fan-out fires before parent's walk | wave_protocol `MetaTeardownObservedPreReset` |
| 1.11 | `actions.down` accepts single Message or Messages array | Core API shape; TLC TypeOK |
| 1.12 | `actions.up` rejects tier-3/4 | Core dispatch enforcement |
| 2.1 | State pushes `[[DATA, cached]]` to new subscribers | wave_protocol push-on-subscribe; TS test |
| 2.3 | Compute fn does NOT run until every dep delivered (first-run gate) | wave_protocol `EmitFnReadinessGate`; TS prototype `first-run gate` test |
| 2.6 | State nodes are ROM | Core kind="state" cache lifecycle |
| 2.7 | Compute nodes are RAM | Core kind∈{derived,dynamic} cache lifecycle |
| 2.8 | `.cache` returns sentinel when deactivated (compute) | Core lifecycle invariant |
| 2.12 | `DepRecord` per-dep state | Core implementation detail |
| 3.1, 3.2 | Edges are derived from `_deps`, not declared | Core registration shape |
| P.1 / P.1a | Stay SENTINEL on no-value-yet | Core first-run gate; bindings reject `undefined` intern |
| P.2 / P.5 | Subscribe before emit; factory wiring order | Core activation order |
| P.9 / P.9a | Diamond resolution with batch coalescing | wave_protocol `BatchEmitMulti`; TS prototype `diamond` test |
| P.12 / P.12-raw | Batch unwrapping `batch.at(-1)` | Core fn-input shape |
| P.19 / P.19-antipattern | Terminal-emission operators emit RESOLVED only | Core dispatch policy |
| P.21 | `actions.emit` vs `actions.down` | Core API shape |
| P.22-limit | `MAX_RERUN=100` for autoTrack discovery | Core safety guard |
| P.25 / P.25-test | START handshake first-emission exemption | wave_protocol handshake invariants |
| P.41 / P.41-protocol-error | Tier-3 wave exclusivity | wave_protocol invariants |
| G.20-cleanup-default / -deactivation | Cleanup hook variants | Core lifecycle hooks |
| G.27 storage tier rules (read-order, transaction, debounce, atomicity, codec, …) | Composition rules at storage layer | Core storage tier protocol |
| L2.11 / L2.11-gate / L2.11-equals | dynamicNode superset model | TS prototype `dynamic` tests; FFI counter shows untracked deps don't fire |
| L2.35-rollback-* | Two-layer rollback (helper + spec) | Core batch rollback |
| L2.36-concurrency | Process manager same-correlationId serialization | Core ordering |
| M.4 | `undefined` is SENTINEL globally | Bindings reject `undefined` at intern |
| M.21 | `prevData[i] === undefined` as "never sent" detector | Core dep-readiness state |

**Count: ~50 rules collapse into core internals.**

### Binding-layer rules — survive at the SDK harness API

These are the contracts the per-language harness owns. The audit should lock them at the binding-API surface, separate from the core protocol.

| Rule | Topic | Lives where in handle architecture |
|---|---|---|
| 1.3 (custom equals leg) | EqualsPairs non-diagonal | `BindingBoundary.customEquals(equalsHandle, a, b)` — 1 FFI per check |
| 2.4 / 5.3 | No silent swallowing; deduplication opt-in | Binding `equals:` option API |
| 5.4 | Domain-language APIs; protocol internals via `inner` | Binding-layer public API design |
| 5.5 | Composition over configuration | Binding-layer composition style |
| 5.6 | Everything is a node | Binding-layer factory shape |
| 5.10 (TS) | No bare `Promise`/`queueMicrotask`/`setTimeout` | Binding async-source contract |
| 5.10 (PY) | No bare `asyncio.create_task` etc. | Binding async-source contract |
| 5.11 | Phase 4+ developer-friendly APIs | Binding-layer ergonomics |
| 5.12 | Data through messages, not peeks | Binding-layer fn writing convention |
| G.3 family (sentinel/null guards) | Guard pattern conventions | Binding-layer fn writing convention |
| G.4 / G.6 | ReactiveMapBundle navigation; TS/PY parity gap | Binding-layer collection API |
| G.14 | PY `first_value_from()` deadlock | Binding-layer runner contract (PY only) |
| G.23 | Rescue uses `errorWhenDepsError: false` | Binding-layer operator option |
| G.26 | Compat layers expose backing node | Binding-layer compat contract |
| L2.8 | `promptNode` SENTINEL gate | Binding-layer pattern |
| L2.15–L2.44 | Composition guide patterns at L2 | Binding-layer + recipe layer |
| L3.* | Solution-level patterns (harness, memory, multi-agent) | Binding-layer + recipe layer |
| M.10 / M.11 / M.12 | No imperative triggers; remove unconsumed imperative paths | Binding-layer API discipline |
| M.13 / M.13-vicious / M.13-structure | T \| Node<T> widening | Binding-layer parameter convention |
| M.15 / M.16 | No backward-compat shims | Binding-layer release discipline |

**Count: ~40 rules survive at the binding layer.**

### Process / agent-workflow rules — wrong document

These are valuable but belong in `CLAUDE.md` / dev-dispatch / qa skills, not in the locked invariants. Phase 13.6.A should EXCLUDE these from the spec and re-home them.

| Rule | Topic |
|---|---|
| M.7 | Stop and raise flag on spec/code conflict |
| M.8 | Shape preservation needs explicit lock |
| M.9 | Don't rename variables/reshape tests without approval |
| M.14 | Don't proceed to implementation after locking decisions |
| M.18 | Read COMPOSITION-GUIDE before composition fixes |
| M.19 | CLAUDE.md is pointer file; single source of truth |
| M.20 / M.20-reason / M.20-load-bearing | `awaitSettled` subscribe-before-kick discipline |

**Count: ~7 rules to re-home.**

### Pre-1.0 simplification candidates surfaced by the cleave

The handle architecture surfaces several cases where rules can be COLLAPSED rather than just classified.

#### 1. SENTINEL family collapses ~13 rules → 1

Rules: M.4, P.1, P.1a, P.1a-antipattern, G.3, G.3-sentinel, G.3-never-undefined, G.3-partial, G.3-companion-restriction, G.3-topicgraph-companion, G.3-reactiveLog-companion, M.21, M.21-upstream-fix, M.21-exception.

**Replacement (single rule, two scoping notes):**
- *Rule:* "Core represents per-dep state as `Pending | Has(handle)`. The first-run gate blocks fn until every dep is `Has`. Bindings reject `undefined` at handle registration; `null` is a valid DATA payload (registers as a real handle)."
- *Note 1:* `reactiveLog` is the documented exception that allows `T | undefined` payloads via a `hasValue` companion.
- *Note 2:* Compute-node `.cache === undefined` reads at the binding boundary mean "deactivated" (RAM lifecycle), not "value is undefined".

#### 2. `.cache`-read sanctioning collapses ~4 rules → 1

Rules: 2.5, 5.12, M.3, P.28, P.22, G.26.

**Replacement:** "Reactive fn never peeks dep values via `.cache`; data flows through messages. The four sanctioned `.cache` boundary reads are: (a) external observers outside the reactive graph, (b) factory-time seed pattern (closure-mirror), (c) compat-layer dep discovery during autoTrack, (d) compat layers exposing backing node for two-way bridges."

#### 3. Imperative boundary classification — DS-13.5.G follow-up

Rules: M.10, M.11, M.12, M.13, L2.34, L2.35, L2.44.

**Replacement (single rubric):**
- *Permitted:* imperative method on a reactive primitive iff (a) backing structure is reactive (map/list/topic/queue/cursor) AND (b) widening to `T | Node<T>` is impractical (multi-arg shape, side effects, audit semantics).
- *Forbidden otherwise.* Default is reactive `NodeInput` signal in opts.
- The five primitives in L2.35 (pipeline.gate, JobQueueGraph, CqrsGraph, saga, processManager) qualify under (a)+(b). All others should widen.

#### 4. Equals-substitution simplifies under handles

Rule 1.3 currently says equals-substitution "cannot be bypassed." Under handles, that's stronger: under `equals: 'identity'` the substitution is a u64 compare with **zero** boundary cost. Under `equals: 'custom'` it's exactly one boundary call per check. The audit can lock these as two distinct cost regimes rather than a single uniform rule.

#### 5. Cleanup hook shapes simplify

Rules G.20-cleanup-default and G.20-cleanup-deactivation define two function shapes for cleanup with overlapping semantics.

**Replacement:** core defines named hooks `{ onRerun, onDeactivation, onInvalidate }`. Bindings expose them; the two-shape API disappears.

## Recommended sequencing for 13.6.A

1. **Re-home the process rules** (M.7, M.8, M.9, M.14, M.18, M.19, M.20*) to CLAUDE.md / dev-dispatch / qa skills. Mechanical, ~30 min, drops audit surface by 7.
2. **Lock the SENTINEL collapse** (~13 rules → 1). Highest semantic-density / lowest disagreement.
3. **Lock the `.cache`-read consolidation** (4 rules → 1). Same shape.
4. **Resolve the imperative boundary rubric** (DS-13.5.G follow-up). This unblocks downstream audit because L2.34/L2.35/L2.44 all reference it.
5. **Per-layer cleanup pass** (Phase 13.6.B): use the pure-core / binding-layer table above as the layer-classification key. Core layer audits the ~50 pure-core rules; patterns / solutions layer audits the ~40 binding-layer rules.

After 13.6 closes, the binding-layer rules become the spec for the per-language SDK harness. The core rules become the spec for the Rust dispatch engine. The two specs can evolve independently — which is exactly the migration unlock.

## Open questions surfaced (not blocking 13.6.A)

These are real but should NOT block locking; flag them in `docs/optimizations.md` for follow-up:

1. **Cross-language handle-space composition** — if a TS-frontend graph mounts a Python-frontend subgraph, the two registries are disjoint. `wave_protocol` doesn't model this. Probably "explicit serialize bridge" or "process boundary" rather than fusing the registries.
2. **Async fn boundary** — state-node `Compute` in `wave_protocol` is synchronous. A real Rust core handing async fns back to JS/Py introduces interleaving. Captured under wave_protocol's `SinkNestedEmit` / multi-sink iteration models for related concerns; explicit async-fn modeling is future work.
3. **Refcount soundness** — bindings must release handles when core says so, with no double-release and no leak. wave_protocol doesn't model refcounts. Could write a small companion module if this matters at audit time. Prototype `extensions.test.ts` already smoke-tests bounded handle counts under steady-state.
4. **Custom-equals oracle correctness** — the `CustomEqualsExtendsIdentity` ASSUME catches misconfigured oracles structurally, but doesn't catch oracles that violate symmetry / transitivity. Probably out of scope for the protocol spec; a binding-layer test convention.

## Verification artifacts

Re-run anytime by:

```bash
# TS prototype
pnpm test src/__experiments__/handle-core/

# TLA+ — copy spec + scenarios into a working dir alongside tla2tools.jar
cp ~/src/graphrefly/formal/wave_protocol.tla /tmp/tla-check/
cp docs/research/handle-protocol.tla /tmp/tla-check/handle_protocol.tla
cp docs/research/handle_protocol_MC.tla /tmp/tla-check/
cp docs/research/handle_protocol_MC.cfg /tmp/tla-check/
cd /tmp/tla-check && \
  java -cp /tmp/tla2tools.jar tlc2.TLC -workers 4 \
       -config handle_protocol_MC.cfg handle_protocol_MC
```

Last run 2026-05-02:

| Artifact | Tests | States | Result |
|---|---:|---:|---|
| TS prototype core.test.ts | 13 | — | PASS |
| TS prototype extensions.test.ts | 9 | — | PASS |
| Full TS suite (regression check) | 2780 | — | PASS |
| TLC handle_protocol_MC (4-node diamond) | — | 9,526 distinct | PASS |
| TLC handle_pause_MC | — | 22,761 distinct | PASS |
| TLC handle_custom_equals_MC | — | 4,359 distinct | PASS |
| TLC handle_multisink_MC | — | 1,014 distinct | PASS |
| TLC handle_invalidate_MC | — | 1,671 distinct | PASS |
| **TLC total** | — | **39,331 distinct** | **all PASS** |
