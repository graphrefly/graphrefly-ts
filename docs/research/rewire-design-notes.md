---
SESSION: rewire-design-verification
DATE: 2026-05-03
TOPIC: `node.setDeps(newDeps)` substrate primitive — design questions resolved, TLA+ verified
REPO: graphrefly-ts (Phase 13.7 prep; M1 implementation handoff)
---

## Context

`graph.rewire(name, newDeps)` is needed for AI self-pruning of harness topology (per [project_rewire_gap memory](#)). The high-level Graph API needs to atomically change a node's upstream deps without TEARDOWN cascading and without losing cache. Implementation requires a substrate primitive `node.setDeps(newDeps)` that doesn't currently exist.

This design session resolved the seven open design questions and verified them in TLA+ before M1 implementation begins.

**Locked spec context:**
- 13.6.A canonical spec ([implementation-plan-13.6-canonical-spec.md](../implementation-plan-13.6-canonical-spec.md)) — 24 invariants locked.
- R3.3.1: edges derived from construction-time `_deps`; **no parallel edge registry**. `setDeps()` mutates the same canonical `_deps`; no separate registry introduced.
- R2.2.7 / R2.2.8: ROM/RAM cache rule.
- R2.4.6: `ctx.store` lifecycle.
- R2.5.3: first-run gate reset semantics.

## Resolved design questions

| # | Question | Resolution |
|---|---|---|
| Q1 | dirtyMask post-rewire | **Clear bits for removed deps; added deps start clean.** Aligns with R1.3.1.a (DIRTY without follow-up DATA/RESOLVED is meaningless). |
| Q2 | `_hasCalledFnOnce` (firstRunPassed) | **PRESERVE.** Rewire is partial — only some deps change. Resetting would re-arm the gate against unchanged deps. New deps simply enter with `prevData[new] = SENTINEL`; user fns handle this via Lock 1.B canonical detector. |
| Q3 | `pauseLocks`, `pauseBuffer` | **PRESERVE both.** `pauseBuffer[N]` holds N's *outgoing* emissions (not incoming) — verified against [wave_protocol.tla:79+388+549+617](../../../../graphrefly/formal/wave_protocol.tla). The buffer is N's downstream contract, valid regardless of upstream rewire. |
| Q4 | DepRecord (prevData) cleanup | **Removed deps: discard. Added deps: SENTINEL until first DATA.** Domain consistency enforced by `prevData'[n][d] = SENTINEL` for d ∈ removed ∪ added in the SetDeps action. |
| Q5 | `setDeps(N, sameDeps)` idempotent | **Yes.** Computed via `removed = added = ∅` → all per-dep updates are no-ops; only `rewireCount` ghost variable bumps. No observable state change. |
| Q6 | Mid-wave rewire wave-close | **Removed deps' DIRTY bits clear; if mask becomes empty AND status was dirty, auto-settle.** Allowed mid-wave per design call. |
| Q7 | ROM/RAM cache | **PRESERVE cache for activated compute nodes; state nodes always preserve.** State nodes intrinsic-value (R2.2.7); compute nodes function-of-deps but cache stays valid while activated. |

## Edge cases resolved

| Case | Resolution |
|---|---|
| `setDeps` while paused | **Allowed.** lockId is per-node, not per-path. The pauser holding L can still `resume(L)` after rewire. If pauser is gone, that's a leaked-pause (independent of rewire). |
| Mid-wave `setDeps` | **Allowed.** Removed dep's DIRTY bit clears; if removed dep was sole DIRTY participant, wave closes via existing settle path. |
| `setDeps(N, deps[N])` | **No-op.** Idempotent. Single-step transition reaches identical state (modulo rewireCount). |
| `setDeps` with paused-buffered emissions | **Buffer preserved.** pauseBuffer is outgoing — not affected by upstream rewire. Drains on RESUME as normal. |
| `setDeps` adding a dep with cached DATA | **Push-on-subscribe applies.** New edge enqueues `[DIRTY, DATA(cache[d])]` per R1.2.3. |
| `setDeps` adding a dep with SENTINEL cache | **No push.** New edge starts with `prevData[N][d] = SENTINEL`; subscribe handshake delivers START only. |
| `setDeps(N, {})` removing all deps | **Allowed structurally.** N becomes a fn-with-no-deps shape. Doesn't fire (no DEP triggers). Cache preserved. M1 should treat this as a degenerate state, not auto-deactivate. |

## Buffer fate summary (corrected)

| Buffer | Owner | Direction | Fate on `setDeps(N)` |
|---|---|---|---|
| `replayBuffer[N]` | N | outgoing (new-subscriber replay) | PRESERVE |
| `pauseBuffer[N]` | N | outgoing (RESUME drain) | PRESERVE |
| `prevData[i]` / `dataBatch[i]` | N's DepRecord | incoming, per-dep | DISCARD with DepRecord (removed deps only); SENTINEL for added |
| `replayBuffer[d]` for removed dep d | d | d's downstream contract | UNTOUCHED |

Net effect: rewire only touches DepRecord-attached state. All node-output buffers preserve.

## TLA+ verification

**Spec:** [`wave_protocol_rewire.tla`](wave_protocol_rewire.tla) — focused standalone, ~370 lines. Models the rewire-relevant subset (deps as state variable, dirtyMask, prevData, firstRunPassed, pauseLocks, pauseBuffer, cache, status, queues). Intentionally omits multi-hop fn-fire-emits-downstream — rewire invariants are per-node. Full integration with `wave_protocol.tla` happens during M1 implementation.

**MC:** [`wave_protocol_rewire_MC.tla`](wave_protocol_rewire_MC.tla) — 3-node topology (A, B sources; C compute, initial deps = {A}, candidates = {A, B}). Bounds: `MaxEmits=2`, `MaxRewires=2`, `MaxPauses=2`, `MaxDeliveries=4`.

**Invariants:**
- `TypeOK` — structural type sanity.
- `RewireDirtyConsistency` (Q1) — `dirtyMask[n] \subseteq deps[n]`.
- `DepRecordDomainConsistency` (Q4) — `prevData[n][d]` well-typed for `d \in deps[n]`.
- `RewirePreservesFirstRun` (Q2) — relational, ghost-driven.
- `RewirePreservesPauseLocks` (Q3) — relational, ghost-driven.
- `RewirePreservesPauseBuffer` (Q3) — relational, ghost-driven.
- `RewirePreservesCache` (Q7) — relational, ghost-driven.
- `WaveClosesWhenSoleDirtyDepRemoved` (Q6) — relational, ghost-driven.

**TLC result (2026-05-03):**
- 126,563 states generated
- 35,950 distinct states
- depth 11
- ~1 second
- **No invariant violations.**

**Sanity checks (each restored after):**
1. Skipped `pauseLocks' = pauseLocks` → `RewirePreservesPauseLocks` tripped at 256 states. ✅ load-bearing.
2. Skipped `dirtyMask' = [...EXCEPT ![n] = clearedMask]` → `RewireDirtyConsistency` tripped at 242 states. ✅ load-bearing.
3. Coverage probe `NoRewireExecuted` (rewireCount = 0) → tripped at 71 states. ✅ confirms SetDeps is actually explored, model isn't vacuous.

## Scenarios exercised by the MC

The 3-node topology + bounds explores rewire combinations including:

- `SetDeps(C, {B})` — straight rewire from {A} to {B} (1 removed + 1 added).
- `SetDeps(C, {A, B})` — additive rewire (0 removed + 1 added).
- `SetDeps(C, {})` — full removal (1 removed + 0 added).
- `SetDeps(C, {A})` — idempotent no-op.
- Rewire while C paused (lock 10 held).
- Rewire mid-wave (after `EmitFromSource(A) → DeliverDirty(A, C)`, before `DeliverData(A, C)`).
- Rewire to dep with cached DATA (push-on-subscribe verified).
- Rewire when removed dep is sole DIRTY participant.
- Two consecutive rewires interleaved with emits/deliveries.

## What this verification does NOT cover

These are intentional simplifications. M1 implementation must verify them in code (or in a follow-up TLA+ extension if surprises emerge):

- **Multi-hop fn-fire propagation post-rewire.** When C's fn fires after rewire, it emits to C's children. The MC doesn't model this; the integration with `wave_protocol.tla` post-M1 will exercise it.
- **INVALIDATE / COMPLETE / ERROR / TEARDOWN interactions with rewire.** Not modeled here — terminal lifecycle is orthogonal to the rewire design questions.
- **Equals substitution post-rewire.** Identity equals only in this spec. Custom equals adds boundary calls but doesn't change rewire semantics.
- **Multi-sink iteration during rewire.** Rewire could fire while a multi-sink iteration is in flight; multi-sink isn't modeled here.
- **Replay buffer state across rewire.** This spec doesn't model replay buffers (per the corrected understanding, replay buffer is N's outgoing — should preserve, but verification deferred).
- **Cross-mount rewire** (Graph-layer rewire across mounted subgraphs). Out of scope for this primitive; lives at `graph.rewire()`.

## M1 implementation notes

When M1 implements `setDeps()` in `graphrefly-rs/crates/graphrefly-core/`:

1. **Storage shape.** DepRecords keyed by `NodeId` (already the natural Rust shape — `HashMap<NodeId, DepRecord>` or `dashmap::DashMap<NodeId, DepRecord>`). Avoid index-based DepRecord arrays.
2. **`_deps` mutability.** `parking_lot::RwLock<HashSet<NodeId>>` or similar. The TS impl can mirror this pattern when the rewire DS lands at the Graph layer.
3. **Atomic operation.** SetDeps must be atomic — either a single critical section, or composed primitives that don't observe intermediate state. The TLA+ spec assumes single-step atomicity.
4. **No version bump.** SetDeps does NOT bump the per-node version counter. Version tracks DATA emissions, not topology changes. (Confirm with DS-14 when version-counter shape locks for op-log changesets.)
5. **Push-on-subscribe for added deps.** When `setDeps` adds a dep d with `cache[d] # SENTINEL`, the implementation must enqueue the equivalent of `[DIRTY, DATA(cache[d])]` to the new edge — same as the subscribe handshake (R1.2.3).
6. **Queue drain for removed deps.** Edges to removed deps must be drained — otherwise stale messages from removed deps could land at C after rewire. The TLA+ spec does this via `drainedQueues`.
7. **DepRecord cleanup.** When a dep is removed, its DepRecord is destroyed — `prevData`, `dataBatch`, and dirtyMask bit all go with it.
8. **Status auto-settle.** If `clearedMask = ∅` AND `status[n] = "dirty"`, transition status to "settled" in the same atomic step. (Otherwise leave dirty.)

## Cross-references

- [implementation-plan.md Phase 13.7](../implementation-plan.md) — bench feasibility study; rewire pre-decision section.
- [implementation-plan-13.6-canonical-spec.md](../implementation-plan-13.6-canonical-spec.md) — R2.2.7, R2.2.8, R2.4.6, R2.5.3, R2.6.4, R3.3.1.
- [optimizations.md](../optimizations.md) — `project_rewire_gap` follow-up.
- [wave_protocol.tla](../../../../graphrefly/formal/wave_protocol.tla) — full protocol spec; SetDeps integration target post-M1.
- [SESSION-rust-port-architecture.md](../../archive/docs/SESSION-rust-port-architecture.md) — Rust port plan; `graphrefly-rs/crates/graphrefly-core/` is the M1 target.

## Open follow-ups

### Resolved 2026-05-03 (post-design)

**Self-rewire `setDeps(N, {N})` — REJECT.** `setDeps` returns `Err(SetDepsError::SelfDependency)` if `n \in newDeps`. Self-loops in compute nodes are pathological without explicit fixed-point semantics, which GraphReFly does not provide. If a real consumer surfaces (e.g. iterative refinement with explicit termination), revisit at Graph-layer design (`graph.rewire`); don't let it leak into the substrate primitive. M1 enforces structurally — two-line check at the top of `setDeps`.

**Cycle prevention — REJECT cycles.** `setDeps` returns `Err(SetDepsError::WouldCreateCycle { path })` if the new dep set would introduce a cycle in the graph topology. Algorithm: for each `d \in added` (deps not previously in `deps[N]`), DFS from `d` through the existing `deps[*]` map looking for `N`. If `N` is reachable from `d`, adding `d → N` creates a cycle. O(V + E) per `setDeps` call where V/E count only nodes/edges currently in the graph (not the full universe). The TLA+ spec's small `DepCandidates` precludes cycles by construction in the MC; M1 needs the explicit guard. Cycle errors include the offending path for debuggability.

### Deferred (NOT blocking M1)

1. **Multi-hop verification.** Integrate SetDeps action into the full `wave_protocol.tla` post-M1 — exercises rewire × multi-sink, rewire × INVALIDATE, rewire × replay-buffer cross-axes.
2. **Graph-layer `graph.rewire(name, newDeps)`.** Wraps `node.setDeps()`; adds mount-aware behavior, audit record emission. Cycle detection lives at Core (per resolution above). Mount-aware path resolution lives at Graph layer. Designed post-M1.
3. **Concurrent rewire on same node.** Two `setDeps(N, ...)` calls in flight simultaneously must serialize. Rust `RwLock` discipline handles this; TLA+ models single-step atomicity which subsumes the concern.
