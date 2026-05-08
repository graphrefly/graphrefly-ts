---
session: rust-port-fn-ctx-cleanup
status: design-locked (all open questions resolved; awaiting explicit implementation approval)
date_opened: 2026-05-07
date_locked: 2026-05-07
slice: M3 Slice E2 (fn ctx + cleanup hooks)
spec_refs: R2.4.5, R2.4.6, R1.3.9, R1.3.9.b, R1.3.9.c, Lock 4.A, Lock 4.A′, Lock 6.D
related_decisions: D054, D055 (locked entering session); D056, D057, D058, D059, D060, D061 (locked closing session); D035 (producer_deactivate analog), D045 (lock-released handshake), D047/D048 (typed-error pattern)
---

# Slice E2 design call — fn ctx + cleanup hooks

## 0. Status

DESIGN-ONLY. Lock the substrate, halt for user review BEFORE any implementation.

The two structural decisions (D054, D055) are already locked in `~/src/graphrefly-ts/docs/rust-port-decisions.md`. This doc formalizes the consequential design — lifecycle wiring, re-entrance discipline, deactivation-vs-wipe semantics, implementation phases, test scenarios — and surfaces follow-up questions that need explicit user signoff before Slice E2 becomes implementation-eligible.

## 1. Background

Migration tracker `~/src/graphrefly-rs/docs/migration-status.md:62` lists Slice E2 as ⏸ scheduled — blocked on:

- (a) whether `ctx` extends `FnCtx` or replaces it
- (b) binding-side storage shape

Three positions surfaced during prior analysis:

- **(A)** Extend `BindingBoundary::invoke_fn` signature to take ctx → Core would own `ctx.store` contents. **Violates the cleaving plane** — binding values would enter Core types.
- **(B)** Add lifecycle-trigger hooks via new `BindingBoundary::cleanup_for(NodeId, CleanupTrigger)` → Core fires triggers; binding owns state. **Mirrors `BindingBoundary::producer_deactivate` from Slice D-substrate (D035).**
- **(C)** Hybrid — return cleanup token from `invoke_fn`, Core stores token, fires `cleanup_for(node, key, trigger)`. Token-keyed, but per-fn-fire identity isn't actually load-bearing because the binding can keep a stable `node_id → current_cleanup` lookup it overwrites on each `invoke_fn` return.

**Decision (D054, locked 2026-05-07): (B).** Cleaving-plane preservation + symmetry with the existing producer-deactivate pattern.

## 2. Decision (a) — `ctx` storage location

**Locked: binding-owned, Core-oblivious.**

Core does NOT extend `BindingBoundary::invoke_fn`'s signature with a ctx parameter. Core knows nothing about `ctx.store` contents. The binding-side `BindingBoundary` impl synthesizes the user-facing `ctx` object on each `invoke_fn` call by looking up `node_id` in its own `NodeCtxState` map.

`ctx.prevData[i]` and `ctx.terminalDeps[i]` (R2.4.4) are derivable from `DepBatch` (already passed via `invoke_fn`). They're a binding-side projection, not new Core state.

`ctx.store` is the only ctx field that requires per-node persistent storage. It lives binding-side per D054.

## 3. Decision (b) — binding-side storage shape

**Locked (D055):**

```rust
// Binding-side (e.g., crates/graphrefly-bindings-js/src/binding_impl.rs)
struct NodeCtxState {
    /// User-data bag. Persists across deactivation by default (R2.4.6).
    /// Wiped on `wipe_ctx(node_id)` only.
    store: HashMap<String, BindingValue>,
    /// The most recent NodeFnCleanup returned by invoke_fn for this node,
    /// or None if the fn returned void / never fired.
    current_cleanup: Option<NodeFnCleanup>,
}

struct BindingImpl {
    // ... existing fields (handle registry, fn registry, ...)
    node_ctx: Mutex<HashMap<NodeId, NodeCtxState>>,
}
```

`Mutex` is a `parking_lot::Mutex` (consistent with the rest of the codebase; non-reentrant — the binding does NOT re-enter its own ctx lock, only Core's).

`BindingValue` is the binding-language native value type:
- napi-rs binding: `napi::JsValue` (or a typed wrapper)
- pyo3 binding: `pyo3::Py<PyAny>`
- wasm-bindgen binding: `wasm_bindgen::JsValue`
- test binding: a small enum or `Box<dyn Any>` for testing flexibility

**Lazy creation:** `node_ctx.entry(node_id).or_insert_with(...)` on first `invoke_fn` for that node. Operator nodes (those that route via `project_each` / `predicate_each` / `fold_each` / `pairwise_pack` / `pack_tuple`) never call `invoke_fn` and therefore never get a `NodeCtxState` entry.

## 4. New `BindingBoundary` surface

Two new methods, both with default no-op impls so non-cleanup-aware bindings (like the existing `TestBinding` in `boundary.rs`) compile unchanged.

```rust
/// Trigger discriminator for cleanup_for. Lock 4.A/4.A′ slot names.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CleanupTrigger {
    /// R2.4.5 onRerun — fires before next fn run within same activation.
    /// Only fired when the node has `has_fired_once == true`.
    OnRerun,
    /// R2.4.5 onDeactivation — fires when subscriber count drops to zero.
    /// Only fired when the node has `has_fired_once == true`.
    OnDeactivation,
    /// R2.4.5 onInvalidate — fires on incoming [[INVALIDATE]] message.
    /// Per R1.3.9.b: at most once per wave per node, regardless of
    /// fan-in shape. Per R1.3.9.c: never fires when cache is the
    /// never-populated sentinel.
    OnInvalidate,
}

pub trait BindingBoundary: Send + Sync {
    // ... existing methods ...

    /// Fire a registered cleanup hook for `node_id`. Bindings look up
    /// their per-node `current_cleanup` and invoke the matching slot if
    /// present; absent slots are no-ops.
    ///
    /// Fires lock-released (Slice E D045 handshake discipline). Re-entrance
    /// into Core is permitted — typical patterns: `release_handle` for
    /// captured handle shares, `Core::up(other_node, Pause)` for cross-
    /// node lifecycle coordination. Re-entrance into the SAME node's
    /// `Core::emit` from `OnRerun` is undefined behavior (a fresh emit
    /// during the same wave's pre-fire window is wave-engine-defined);
    /// users shouldn't do this. Cleanup closures that panic are
    /// caught_unwind-isolated by Core (see §6 below).
    ///
    /// Default no-op so bindings without cleanup-hook support compile.
    fn cleanup_for(&self, _node_id: NodeId, _trigger: CleanupTrigger) {}

    /// Wipe the binding-side ctx state for `node_id`. Called by Core on
    /// resubscribable terminal reset (per R2.4.6 — `ctx.store` is
    /// "Wiped automatically: on resubscribable terminal reset"). Bindings
    /// drop their `NodeCtxState` entry for `node_id`, releasing both
    /// `store` and `current_cleanup`.
    ///
    /// Fires lock-released. Default no-op.
    fn wipe_ctx(&self, _node_id: NodeId) {}
}
```

**Why a single `cleanup_for` instead of three methods (`fire_on_rerun`/`fire_on_deactivation`/`fire_on_invalidate`):** the binding's lookup logic is identical for all three; the only difference is the slot name. One method + enum keeps the FFI surface compact and matches the spec's `NodeFnCleanup` shape. Pattern-matched by the binding side; per-trigger overhead is one enum compare.

## 5. Lifecycle wiring points (Core side)

| Trigger | Site | When | Gating | Lock-released? |
|---|---|---|---|---|
| `OnRerun` | `Core::fire_regular` (batch.rs:430) | between Phase 1 (snapshot, lock-held) and Phase 2 (`invoke_fn`, lock-released) | only if `rec.has_fired_once == true` | yes — call before re-acquiring lock for Phase 3 |
| `OnDeactivation` | `Subscription::Drop` (node.rs:453) | when `subscribers.is_empty()` after removal | only if `rec.has_fired_once == true` (skip never-fired state nodes) | yes — current pattern: clone Arc<dyn BindingBoundary>, drop state lock, fire (parallel to existing `producer_deactivate` call) |
| `OnInvalidate` | `Core::invalidate_inner` (node.rs:3027) | when a node's cache transitions from `!= NO_HANDLE` to `NO_HANDLE` | (i) `cache != NO_HANDLE` (R1.3.9.c never-populated guard); (ii) `!s.invalidate_hooks_fired_this_wave.contains(&node_id)` (R1.3.9.b strict per-wave-per-node dedup) | yes — collected into new `s.deferred_cleanup_hooks: Vec<(NodeId, CleanupTrigger)>`, drained after wave's lock drop alongside `deferred_handle_releases` |
| `wipe_ctx` | `Core::reset_for_fresh_lifecycle` (node.rs:2220) | resubscribable terminal cycle, late subscribe path | always (the function only runs on resubscribable reset) | yes — fire after current Phase 1–3 collect-and-release work, lock-released |

### 5.1 New `CoreState` field

```rust
pub(crate) struct CoreState {
    // ... existing fields ...

    /// R1.3.9.b — per-wave-per-node dedup for OnInvalidate cleanup hooks.
    /// Cleared in `clear_wave_state`. A node already in this set this wave
    /// has already fired its onInvalidate and MUST NOT fire again, even if
    /// invalidate_inner re-encounters it (rare: only matters if the node
    /// re-populates and gets re-invalidated within the same wave).
    pub(crate) invalidate_hooks_fired_this_wave: AHashSet<NodeId>,

    /// Lock-released cleanup hook drain queue. Collected during a
    /// lock-held phase (e.g., invalidate_inner cascade), drained after
    /// the state lock is dropped at wave boundary. Mirrors
    /// `deferred_handle_releases`.
    pub(crate) deferred_cleanup_hooks: Vec<(NodeId, CleanupTrigger)>,
}
```

### 5.2 Why a deferred drain for OnInvalidate

`Core::invalidate_inner` runs entirely under the state lock and walks an iterative work-queue. Calling `binding.cleanup_for(...)` directly inside the walk would either:

- Drop the lock per-iteration (heavy churn + invariants harder to reason about)
- Hold the lock through user code (violates Slice E D045 lock-released discipline; deadlock risk if cleanup re-enters Core)

The existing `deferred_handle_releases` pattern (collect-while-locked, drain-after-unlock) is the canonical Rust-port idiom for this exact shape. Mirror it.

`Core::invalidate` already calls `run_wave(closure)` which provides the post-wave drain hook (the wave engine drops the lock then drains pending releases). Plumb `deferred_cleanup_hooks` into the same drain path.

### 5.3 Why `OnRerun` does NOT use the deferred drain

`fire_regular` is structured as four phases with explicit lock-acquire / lock-release transitions. Phase 2 (`invoke_fn`) is already lock-released. The new `cleanup_for(node, OnRerun)` call slots in **between Phase 1 and Phase 2**:

```rust
// Existing Phase 1: lock-held snapshot of dep_batches + has_fired_once flag.
let prep: Option<(FnId, Vec<DepBatch>, bool, bool)> = {  // bool added: has_fired_once
    let mut s = self.lock_state();
    // ... existing ...
};
let Some((fn_id, dep_batches, is_dynamic, has_fired_once)) = prep else { return; };

// NEW Phase 1.5 (lock-released): fire OnRerun if applicable.
if has_fired_once {
    self.binding.cleanup_for(node_id, CleanupTrigger::OnRerun);
}

// Existing Phase 2: lock-released invoke_fn.
let result = {
    let _firing = FiringGuard::new(self, node_id);
    self.binding.invoke_fn(node_id, fn_id, &dep_batches)
};
```

The cleanup fires OUTSIDE `FiringGuard` because re-entrance protection during cleanup is a different concern (cleanup closures shouldn't be subject to the A6 reentrancy guard against `set_deps(self, ...)` — that guard is specifically for protecting the in-flight fn dispatch).

### 5.4 Why `OnDeactivation` piggybacks the existing producer_deactivate site

`Subscription::Drop` (node.rs:453) is already structured as: lock-held subscriber-removal + last-sub detection → lock-released hook fire. Today it fires `producer_deactivate` for producer nodes only. Slice E2 adds:

```rust
let (was_last_sub, is_producer, has_fired_once, binding) = {
    let mut s = state.lock();
    let Some(rec) = s.nodes.get_mut(&self.node_id) else { return; };
    rec.subscribers.remove(&self.sub_id);
    let last = rec.subscribers.is_empty();
    let producer = rec.is_producer();
    let fired = rec.has_fired_once;
    let binding = if last && (producer || fired) {
        Some(s.binding.clone())
    } else { None };
    (last, producer, fired, binding)
};
if was_last_sub {
    if let Some(binding) = binding {
        if has_fired_once {
            binding.cleanup_for(self.node_id, CleanupTrigger::OnDeactivation);
        }
        if is_producer {
            binding.producer_deactivate(self.node_id);
        }
    }
}
```

`cleanup_for(OnDeactivation)` and `producer_deactivate` are **separate hooks** — they fire on the same lifecycle moment but represent separate concerns. A producer that also returns user cleanup gets both fired (cleanup first, then producer-side teardown). Order: cleanup THEN producer_deactivate, because cleanup may release handles the producer subscription owns; firing producer_deactivate first could drop subs that the cleanup expected to still be live.

### 5.5 Why `wipe_ctx` runs in `reset_for_fresh_lifecycle`

`reset_for_fresh_lifecycle` (node.rs:2220) is the canonical site for "resubscribable terminal reset" per R2.2.7 / R2.4.6. It already collects handle releases under the lock and drops them post-borrow. Add `wipe_ctx` to the post-borrow phase:

```rust
fn reset_for_fresh_lifecycle(&self, s: &mut CoreState, node_id: NodeId) {
    // Existing Phase 1: collect handle releases + take old_scratch + clear state.
    let (prev_op, mut old_scratch, handles_to_release, pause_buffer_payloads) = { ... };

    // Existing Phase 2-3: rebuild scratch + release old shares (lock-released-where-feasible).
    // ... existing ...

    // NEW Phase 4 (lock-released): wipe binding-side ctx state.
    // Drop state lock first if still held by caller — caller convention.
    self.binding.wipe_ctx(node_id);
}
```

Caller convention check needed: `reset_for_fresh_lifecycle`'s callers acquire the state lock and pass `&mut s`. The post-borrow phase already releases the borrow on `s`, but the outer `MutexGuard` may still be held. The `wipe_ctx` call needs to happen AFTER that guard drops. → **plumbed via the same caller-side post-lock-drop pattern as `deferred_handle_releases`** (collect node_id at the end of `reset_for_fresh_lifecycle`'s lock-held work, drain it after caller's `MutexGuard` drops).

Cleaner alternative: have `reset_for_fresh_lifecycle` accept a `&mut Vec<NodeId>` "wipe queue" param, push to it during lock-held phase, caller drains after lock drop. Mirrors `deferred_handle_releases`.

## 6. Re-entrance discipline (Slice E D045 handshake)

All four hooks (`OnRerun`, `OnDeactivation`, `OnInvalidate`, `wipe_ctx`) fire **lock-released**. Per Slice E D045, this is the canonical discipline for FFI calls that may re-enter Core.

### 6.1 What re-entrance is permitted

| From hook | Into Core | Permitted? | Notes |
|---|---|---|---|
| any | `release_handle` / `retain_handle` | ✅ | binding-side hooks expected to release captured handles |
| any | `Core::up(other_node, Pause/Resume/Invalidate/Teardown)` | ✅ | lock-released; opens nested wave naturally |
| any | `Core::emit(other_node, v)` | ✅ | nested wave |
| any | `Core::subscribe(other_node)` / `Subscription::drop` | ✅ | lock-released |
| `OnRerun` | `Core::emit(self_node, v)` | ⚠️ undefined | fresh emit during the same wave's pre-fire window. The next `invoke_fn` will see this emission as part of the wave. Behavior is wave-engine-defined; users SHOULD NOT do this. |
| `OnRerun` | `Core::set_deps(self_node, ...)` | ❌ no-op | A6 reentrancy guard's `currently_firing` is NOT set during cleanup_for (FiringGuard scope is invoke_fn only). But spec-wise, modifying self's deps from a cleanup hook is unspecified — document as undefined behavior. |
| `OnDeactivation` | `Core::subscribe(self_node)` | ⚠️ avoid | self-resubscribe inside one's own deactivation hook creates a re-activation race. Document as undefined behavior. |
| any | binding's own `node_ctx` lock | ⚠️ deadlock risk | the binding's `cleanup_for` impl already holds `node_ctx` lock during lookup. If the user's cleanup closure re-enters the binding (e.g., creates a new sub via the binding's high-level API), the binding may try to re-acquire `node_ctx`. Bindings MUST release `node_ctx` lock before invoking the user closure (one-time clone of the closure handle, drop lock, fire). |

### 6.2 Panic isolation

Cleanup closures are user code — they can panic. Mirror Slice F audit fix A7 (D4 handshake-panic discipline): per-tier handshake fires wrapped in `catch_unwind`, panicking sink is removed before re-raise.

For Slice E2:
- `cleanup_for` calls Core-side stay outside `catch_unwind` (we trust the binding's `cleanup_for` impl to handle panics from user closures internally).
- Bindings SHOULD wrap user closure invocations in `catch_unwind` on the binding side. If a closure panics:
  - For `OnRerun`: log + continue to invoke_fn. Stale closure stays in `current_cleanup`; next invoke_fn replaces it.
  - For `OnDeactivation`: log + continue (this hook is end-of-life anyway).
  - For `OnInvalidate`: log + continue draining `deferred_cleanup_hooks`.

This is binding-side discipline, not Core-side. Document in `BindingBoundary::cleanup_for` rustdoc.

### 6.3 `current_cleanup` lifecycle on the binding side

| Event | Effect on `NodeCtxState.current_cleanup` |
|---|---|
| First `invoke_fn` returns cleanup spec | Insert entry; set `current_cleanup = Some(spec)` |
| Subsequent `invoke_fn` returns | Replace `current_cleanup` (overwrite) |
| `cleanup_for(node, OnRerun)` | Read + invoke `onRerun` slot; do NOT clear (next invoke_fn will overwrite) |
| `cleanup_for(node, OnInvalidate)` | Read + invoke `onInvalidate` slot; do NOT clear (multiple INVALIDATEs across waves can re-fire same closure — by design) |
| `cleanup_for(node, OnDeactivation)` | Read + invoke `onDeactivation` slot; **clear `current_cleanup` to `None`** (one-shot per activation cycle; `store` persists separately) |
| `wipe_ctx(node)` | Remove the entire `NodeCtxState` entry (drops `store` AND `current_cleanup`) |

## 7. Deactivation-vs-resubscribable wipe semantics

This is the load-bearing semantic difference vs current TS impl:

| Lifecycle event | TS current behavior | Canonical spec / Rust port (this slice) |
|---|---|---|
| Deactivation (last sub leaves) | wipes `ctx.store` (per node.ts:189-190 docstring; canonical spec §11 item 3 flags this as drift) | `store` PERSISTS; `OnDeactivation` cleanup hook fires, then `current_cleanup` cleared (but `store` retained) |
| Resubscribable terminal reset | wipes `ctx.store` as part of full reset | `store` WIPED via `wipe_ctx`; full reset of `NodeCtxState` |
| INVALIDATE | does not wipe `ctx.store` (cache clear, fn re-runs reading prior store) | same — `ctx.store` is independent of cache; `OnInvalidate` cleanup fires; store retained |
| Plain fn re-fire (DATA from dep) | does not wipe | same — `OnRerun` cleanup fires; store retained for fn to see prior accumulator state |

**Migration trap:** TS's Phase 13.6.B will eventually flip TS to canonical (per R2.4.6), with operator-side migrations (`take.ts`, `transform.ts` scan/reduce/distinctUntilChanged/pairwise, `time.ts`, `sources/async.ts`, `io/csv.ts`) adding explicit `onDeactivation: () => { ctx.store = {}; }` to preserve their existing reset-on-resubscribe behavior. The Rust port targets canonical from the start; binding-side ergonomic operators (built atop the dispatcher in graphrefly-operators) will register their own cleanup hooks where needed — but the Rust impl's built-in operator dispatch path (`project_each` etc.) doesn't carry user fn closures and doesn't surface `ctx.store` to operator authors at all (operator state lives in `OperatorScratch`, separate concern).

## 8. Implementation plan

### Phase 0 — substrate (no behavior change)

- Add `CleanupTrigger` enum to `crates/graphrefly-core/src/boundary.rs`.
- Add `cleanup_for` and `wipe_ctx` default-no-op methods to `BindingBoundary` trait.
- Add `invalidate_hooks_fired_this_wave: AHashSet<NodeId>` and `deferred_cleanup_hooks: Vec<(NodeId, CleanupTrigger)>` to `CoreState`.
- Clear `invalidate_hooks_fired_this_wave` in `clear_wave_state`.
- Verify all existing tests pass (default no-ops mean no behavior change).

### Phase 1 — wire `OnRerun` (fire_regular Phase 1.5)

- Extend `fire_regular` Phase 1 snapshot to capture `has_fired_once`.
- Insert lock-released `cleanup_for(node, OnRerun)` between Phase 1 and Phase 2, gated on `has_fired_once`.
- Test: state node, two emits in sequence — verify `cleanup_for(self, OnRerun)` fires before second `invoke_fn`, not before first.

### Phase 2 — wire `OnDeactivation` (Subscription::Drop)

- Extend the lock-held detection block to capture `has_fired_once`.
- Add `cleanup_for(node, OnDeactivation)` lock-released call alongside the existing `producer_deactivate` site.
- Order: cleanup_for FIRST (may release handles), producer_deactivate SECOND.
- Test: state + producer + derived nodes — verify each fires `OnDeactivation` exactly once when last sub drops.

### Phase 3 — wire `OnInvalidate` (invalidate_inner deferred drain)

- Extend `invalidate_inner` to insert `(node_id, OnInvalidate)` into `deferred_cleanup_hooks` when `cache != NO_HANDLE` AND `!invalidate_hooks_fired_this_wave.contains(&node_id)`. Mark in set.
- Plumb `deferred_cleanup_hooks` drain into the wave engine's post-lock-drop path (alongside `deferred_handle_releases` drain).
- Test: diamond fan-in (A → B; A → C; B + C → D) — invalidate A — verify D's `OnInvalidate` fires exactly once.
- Test: never-populated case — register a state node, never emit, invalidate it — verify `OnInvalidate` does NOT fire (R1.3.9.c).

### Phase 4 — wire `wipe_ctx` (reset_for_fresh_lifecycle)

- Add `wipe_ctx_queue: Vec<NodeId>` parameter or piggyback on `deferred_cleanup_hooks` with a synthetic trigger (decision: separate queue for clarity).
- In `reset_for_fresh_lifecycle`'s lock-held phase, push `node_id` to the queue.
- Caller drains queue after dropping its `MutexGuard`, calling `binding.wipe_ctx(node_id)` for each.
- Test: resubscribable node, fn writes to store, complete, resubscribe — verify next first-fire sees empty store (i.e., `wipe_ctx` cleared the binding-side state).

### Phase 5 — TestBinding extension (test infrastructure)

- Extend the shared `tests/common/mod.rs` `TestBinding` with:
  - `node_ctx: Mutex<HashMap<NodeId, NodeCtxState>>` field
  - `register_cleanup(node_id, NodeFnCleanup)` helper for tests to register closures imperatively
  - Override `cleanup_for` and `wipe_ctx` to fire registered closures
  - `cleanup_calls: Mutex<Vec<(NodeId, CleanupTrigger)>>` recorder for assertion
- This is test-only scaffolding — production napi-rs / pyo3 / wasm-bindgen bindings will roll their own per their host language's idioms. Documented as a Rust-port-only test pattern.

### Phase 6 — `BindingBoundary` rustdoc

- Document `cleanup_for` semantics (lock-released, panic isolation guidance, current_cleanup lifecycle).
- Document `wipe_ctx` semantics (called only on resubscribable terminal reset).
- Document `CleanupTrigger` enum variants with R-rule cross-refs.
- Update `boundary.rs` module-level doc comment to mention the new lifecycle hook surface alongside producer_deactivate.

### Phase 7 — close-out

- Update `migration-status.md`: move Slice E2 row from `⏸ scheduled` to `✅ landed`, document test count delta.
- Sweep `porting-deferred.md`: remove any entries resolved by Slice E2 (none expected — this is net new surface).
- If napi-rs binding has activated by then, add cross-impl parity scenario in `packages/parity-tests/scenarios/core/cleanup-hooks.test.ts` covering `OnRerun` / `OnDeactivation` / `OnInvalidate` semantics. Until activation, mark as `legacyImpl`-only via the `Impl` interface widening.

## 9. Test scenarios (mandatory)

Per R-rule:

| # | Spec rule | Scenario | Expected | Crate / file |
|---|---|---|---|---|
| 1 | R2.4.5 OnRerun | State node, two sequential emits | Fires `cleanup_for(OnRerun)` before second invoke_fn, not before first | `tests/slice_e2_cleanup.rs::r2_4_5_on_rerun_fires_before_second_fn` |
| 2 | R2.4.5 OnRerun gate | First fn run | Does NOT fire `OnRerun` (no prior fn run to clean) | `tests/slice_e2_cleanup.rs::r2_4_5_on_rerun_skipped_on_first_fire` |
| 3 | R2.4.5 OnDeactivation | Subscribe + emit + drop sub | Fires `cleanup_for(OnDeactivation)` once | `tests/slice_e2_cleanup.rs::r2_4_5_on_deactivation_fires_on_last_unsub` |
| 4 | R2.4.5 OnDeactivation + producer | Producer node, last sub drops | Fires `OnDeactivation` THEN `producer_deactivate`, in order | `tests/slice_e2_cleanup.rs::r2_4_5_on_deactivation_precedes_producer_deactivate` |
| 5 | R2.4.5 OnDeactivation gate | Never-fired state node, sub + drop sub without emit | Does NOT fire `OnDeactivation` | `tests/slice_e2_cleanup.rs::r2_4_5_on_deactivation_skipped_on_never_fired` |
| 6 | R1.3.9.b dedup | Diamond fan-in graph (A→B, A→C, B+C→D), invalidate A | D's `OnInvalidate` fires exactly once | `tests/slice_e2_cleanup.rs::r1_3_9_b_on_invalidate_dedup_diamond` |
| 7 | R1.3.9.c never-populated | State node, never emitted, invalidate | Does NOT fire `OnInvalidate` (cache is sentinel) | `tests/slice_e2_cleanup.rs::r1_3_9_c_on_invalidate_skipped_on_never_populated` |
| 8 | R2.4.6 store persistence | State+derived node where fn writes to store, deactivate, reactivate | Next fn run reads prior store value (NOT wiped) | `tests/slice_e2_cleanup.rs::r2_4_6_store_persists_across_deactivation` |
| 9 | R2.4.6 store wipe | Resubscribable node, fn writes store, complete, resubscribe | Next first-fire sees empty store (`wipe_ctx` cleared it) | `tests/slice_e2_cleanup.rs::r2_4_6_store_wiped_on_resubscribable_reset` |
| 10 | OnDeactivation pre-wipe | Resubscribable node, fn registers `onDeactivation: () => store["k"] = "cleaned"`, complete | Hook fires AND sees pre-wipe store; wipe runs after | `tests/slice_e2_cleanup.rs::on_deactivation_runs_before_wipe_on_terminal_reset` |
| 11 | Re-entrance lock-released | `OnDeactivation` calls `Core::up(other_node, Pause)` | Pause takes effect; no deadlock | `tests/slice_e2_cleanup.rs::cleanup_can_reenter_core_lock_released` |
| 12 | OnRerun panic isolation | fn returns `OnRerun` closure that panics, second emit | Wave drains; `tier3_emitted_this_wave` cleared; node still fireable on next emit (binding-side recovery) | `tests/slice_e2_cleanup.rs::on_rerun_panic_isolated_does_not_corrupt_wave` |
| 13 | INVALIDATE during pause | Pause node, invalidate, resume | `OnInvalidate` fires at cache-clear time (not at replay time); single fire | `tests/slice_e2_cleanup.rs::on_invalidate_fires_at_cache_clear_not_replay` |
| 14 | Operator nodes never get cleanup | Map / Filter / Scan node, full lifecycle | Binding's `cleanup_for` is never called for operator NodeIds | `tests/slice_e2_cleanup.rs::operator_nodes_skip_cleanup_hooks` |
| 15 | Per-fire-wave dedup edge: re-emit-then-reinvalidate | Emit → fire fn → fn re-emits self via re-entrance → another invalidate this wave hits self again | `OnInvalidate` fires ONCE total this wave (R1.3.9.b strict) | `tests/slice_e2_cleanup.rs::r1_3_9_b_strict_dedup_across_repopulate` |

Test-count delta target: +15 tests in `tests/slice_e2_cleanup.rs`.

## 10. Decision log entries (new — locked 2026-05-07)

Appended to `~/src/graphrefly-ts/docs/rust-port-decisions.md` at session close:

```markdown
### D056 — Slice E2: separate `OnDeactivation` cleanup hook from existing `producer_deactivate`
- **Date:** 2026-05-07
- **Context:** `Subscription::Drop` already fires `producer_deactivate` for producer nodes when the last sub drops. Slice E2 needs to fire `cleanup_for(node, OnDeactivation)` for any node that has fired its fn at least once (including producer nodes that ALSO returned cleanup hooks).
- **Options:** A) overload `producer_deactivate` to also carry the `OnDeactivation` semantic; B) keep them as separate hooks fired in sequence (cleanup first, producer-deactivate second).
- **Decision:** B.
- **Rationale:** `producer_deactivate` is producer-specific (tear down upstream subscriptions captured during fn-fire). `OnDeactivation` is a user-facing cleanup hook that may exist on any node kind. Conflating them would force every binding's `producer_deactivate` impl to also dispatch `current_cleanup.onDeactivation`, breaking the producer-vs-cleanup separation that D054 mirrored. Order (cleanup first) chosen because cleanup may release handles the producer subscription owns.
- **Affects:** `Subscription::Drop` site; `BindingBoundary::cleanup_for` semantics.

### D057 — Slice E2: OnInvalidate dedup via wave-scoped HashSet (not just cache-clear idempotency)
- **Date:** 2026-05-07
- **Context:** `invalidate_inner` already has natural cache-clear idempotency (a node with `cache == NO_HANDLE` is a no-op). For most fan-in shapes this provides per-wave-per-node dedup for free. The edge case: a node could re-populate mid-wave (fn fires, emits) and then be re-invalidated in the same wave via a separate path.
- **Options:** A) rely on cache-clear idempotency only; B) explicit `invalidate_hooks_fired_this_wave: AHashSet<NodeId>` cleared in `clear_wave_state`.
- **Decision:** B.
- **Rationale:** R1.3.9.b strict reading: "fires at most once per wave per node, regardless of fan-in shape." Strict dedup across the entire wave matches the spec; cache-clear idempotency only catches "still at sentinel," not "fired earlier this wave but re-populated since." Extra HashSet has negligible cost (single u64 lookup per invalidate cascade visit).
- **Affects:** `CoreState::invalidate_hooks_fired_this_wave`; `Core::invalidate_inner`; `clear_wave_state`.

### D058 — Slice E2: OnInvalidate fires at cache-clear time, not at wire-delivery time
- **Date:** 2026-05-07
- **Context:** When a node is paused, its outgoing tier-3/tier-4 messages are buffered. INVALIDATE on a paused node clears the cache immediately (node-local) but the wire message buffers until resume. The spec says `OnInvalidate` "fires on [[INVALIDATE]]" — ambiguous whether at cache-clear time or at wire-delivery time.
- **Options:** A) fire at cache-clear time (immediate, regardless of pause state); B) fire at wire-delivery time (deferred through pause buffer).
- **Decision:** A.
- **Rationale:** Cleanup is a node-internal lifecycle event tied to the cache transition `cache → SENTINEL`. Wire-delivery is observer-side concern (handled by pause buffering). Firing at cache-clear matches the spec's "cleanup hook fires on INVALIDATE" reading where INVALIDATE is the node-state transition. Bindings that need delivery-time semantics can subscribe to the wire INVALIDATE message instead of using `OnInvalidate`.
- **Affects:** `Core::invalidate_inner` cleanup-hook insertion site.

### D059 — Slice E2: clear `current_cleanup` on `OnDeactivation` (one-shot per activation cycle); persist `store` separately
- **Date:** 2026-05-07
- **Context:** Per D055, binding-side `NodeCtxState = { store, current_cleanup }`. `store` persists across deactivation per R2.4.6. The question: does `current_cleanup` also persist?
- **Options:** A) persist both (matches store symmetry); B) clear current_cleanup on OnDeactivation fire (one-shot per activation cycle); C) clear current_cleanup but only when the closure successfully fired.
- **Decision:** B.
- **Rationale:** A user closure registered via fn return is implicitly scoped to one activation cycle — captures fn-local handles, expects fn to re-run on reactivation and replace it. If `current_cleanup` persisted across deactivation, the dangling closure would hold captured state across an inactive period, surfacing as memory churn (closures hold handle shares via `release_handle` calls). One-shot semantics match user intent. Note: the next `invoke_fn` on reactivation will set fresh `current_cleanup` regardless of A/B/C choice — only difference is whether the cleanup spec is in the map for the deactivated period.
- **Affects:** binding-side `cleanup_for(OnDeactivation)` impl convention. Documented in `BindingBoundary::cleanup_for` rustdoc.

### D060 — Slice E2: cleanup-closure panic isolation is binding-side (Core panic-naive)
- **Date:** 2026-05-07
- **Context:** User cleanup closures can panic. Two locii for `catch_unwind`: Core wraps `cleanup_for` invocations, OR bindings wrap user closures internally and decide their own propagation policy.
- **Options:** A) Core-side `catch_unwind` around every `cleanup_for` call; B) binding-side `catch_unwind` (A7-symmetric); C) no isolation (panic propagates).
- **Decision:** B.
- **Rationale:** Mirrors Slice F audit fix A7 (D4 handshake-panic discipline) — Core stays panic-naive about user code. Bindings know their host language's panic semantics best (JS exception → console.error, Python panic → warning, Rust panic → log + continue). Core-side `catch_unwind` would also force `UnwindSafe` bounds onto every closure crossing the FFI, which conflicts with capturing handle shares. **Drain-loop discipline (`OnInvalidate` deferred drain):** drain MUST iterate-don't-short-circuit — bindings catch per-item, drain continues, final panic re-raised after drain completes if any item panicked. This preserves wave-end discipline (all queued cleanup attempts run) while still surfacing failures.
- **Affects:** `BindingBoundary::cleanup_for` rustdoc; `Core::deferred_cleanup_hooks` drain implementation.

### D061 — Slice E2: panic-discard wave drops `deferred_cleanup_hooks` silently
- **Date:** 2026-05-07
- **Context:** If `invoke_fn` panics mid-wave, `clear_wave_state` runs to scrub wave-scoped state. The question: does `clear_wave_state` drain `deferred_cleanup_hooks` or drop it silently?
- **Options:** A) drain (fire all pending OnInvalidate hooks during panic teardown); B) drop silently (match Slice F /qa A3 `pending_pause_overflow` precedent).
- **Decision:** B.
- **Rationale:** A3 already established the precedent for wave-scoped queues that don't survive panic-discard: the panicked wave is logically aborted; firing partial cleanup during teardown could compound the panic state with corrupt cleanup ordering. Risks acknowledged: external-resource cleanup (file handles, network sockets, external transactions) won't run on panicked waves. Mitigation: bindings using `OnInvalidate` for resource management must idempotent-cleanup at process exit (or at next successful subscribe / invalidate cycle); document this in `BindingBoundary::cleanup_for` rustdoc as a guarantee gap. Scope clarification: this decision specifically covers `OnInvalidate` (the only trigger routed through `deferred_cleanup_hooks`). `OnRerun` and `OnDeactivation` fire inline lock-released and don't have a wave-end deferred drain.
- **Affects:** `Core::clear_wave_state` (clear `deferred_cleanup_hooks` silently); `BindingBoundary::cleanup_for` rustdoc panic-discard guarantee gap.
```

## 11. Open questions — resolved 2026-05-07

All six surfaced questions resolved by user. Resolutions written into the design and propagated to the new decision-log entries (§10 + D060 / D061 in `rust-port-decisions.md`).

1. **Q1: Strict-once-per-wave reading of R1.3.9.b?** → **YES, strict.** D057 stands. `invalidate_hooks_fired_this_wave: AHashSet<NodeId>` cleared in `clear_wave_state`. Even a re-populate-then-re-invalidate sequence within one wave fires `OnInvalidate` only once per node.

2. **Q2: Cleanup closure panic isolation locus?** → **Binding-side `catch_unwind`** (A7-symmetric default). Core remains panic-naive about user closures; Core never wraps `cleanup_for` invocations. **Locked as D060.** Bindings that don't catch panics propagate them up through `cleanup_for` into Core's caller frame — for OnRerun this means the panic propagates out of the lock-released cleanup site between Phase 1 and Phase 2 of `fire_regular`, which is BEFORE `FiringGuard` is established, so the wave's `currently_firing` set stays clean. For OnDeactivation a panic propagates out of `Subscription::Drop` (Drop guarantees apply: state lock already released). For OnInvalidate the panic propagates out of the `deferred_cleanup_hooks` drain loop — the drain MUST iterate-don't-short-circuit (catch panic per-item, log via `eprintln!`, continue draining; final panic re-raised after drain completes if any item panicked). For wipe_ctx a panic propagates out of `reset_for_fresh_lifecycle`'s post-borrow drain. Bindings that DO catch panics surface the failure via their host-language idiom (JS console.error, Python warnings, etc.).

3. **Q3: OnDeactivation firing order vs `producer_deactivate`?** → **Default: cleanup-first.** D056 stands. `cleanup_for(OnDeactivation)` fires BEFORE `producer_deactivate` because user cleanup may release handles the producer subscription owns; reverse order would let producer_deactivate drop subs that user cleanup expected to be live.

4. **Q4: Cleanup hook firing under panic-discard wave teardown?** → **Default: drop `deferred_cleanup_hooks` silently** (matches A3 `pending_pause_overflow` precedent). **Locked as D061.** `clear_wave_state` clears `deferred_cleanup_hooks` without firing. Risks acknowledged: external-resource cleanup won't run on panicked waves; bindings using cleanup for resource management must idempotent-cleanup at process exit. Documented in `BindingBoundary::cleanup_for` rustdoc as a guarantee gap. Note: `OnRerun` and `OnDeactivation` are NOT routed through `deferred_cleanup_hooks` (OnRerun fires inline lock-released between Phase 1.5 and Phase 2 of `fire_regular`; OnDeactivation fires inline from `Subscription::Drop`); only `OnInvalidate` goes through the deferred drain. So this lock specifically covers OnInvalidate panic-discard semantics. OnRerun panic-discard is moot (panic in OnRerun aborts the wave's fire_regular before it can corrupt state, but Phase 1 already cleaned `pending_fires` for the node — graceful). OnDeactivation panic-discard is moot (Drop is invoked during stack unwinding; if cleanup panics during a drop call we double-panic which Rust handles per std::process::abort semantics).

5. **Q5: `wipe_ctx` payload?** → **`node_id` only.** Signature locked as `fn wipe_ctx(&self, node_id: NodeId)`. Binding does `self.node_ctx.lock().remove(&node_id)` — drops both `store` and `current_cleanup`.

6. **Q6: `TestBinding::register_cleanup` ergonomics?** → **Defer to Phase 5 implementation.** No signoff needed.

## 12. Acceptance bar for Slice E2 close

When implementation lands:

- [ ] All 15 test scenarios in §9 pass
- [ ] `cargo test -p graphrefly-core` clean (zero regressions across the existing 438+ tests)
- [ ] `cargo clippy -p graphrefly-core --all-targets -D warnings` clean
- [ ] `cargo fmt --check` clean
- [ ] `#![forbid(unsafe_code)]` preserved across all crate roots
- [ ] `BindingBoundary::cleanup_for` and `wipe_ctx` rustdoc covers re-entrance, panic isolation, current_cleanup lifecycle, and CleanupTrigger semantics with R-rule cross-refs
- [ ] `migration-status.md` Slice E2 row marked ✅ landed with test count delta and links to new test file
- [ ] `porting-deferred.md` swept (no entries currently expected to resolve; verify)
- [ ] D056 / D057 / D058 / D059 appended to `rust-port-decisions.md`
- [ ] Suggest `/qa` for adversarial review

## 13. References

- **Canonical spec:** `~/src/graphrefly-ts/docs/implementation-plan-13.6-canonical-spec.md`
  - R2.4.5 (lines 414–442) — cleanup hook shape
  - R2.4.6 (lines 443–464) — ctx.store lifecycle
  - R1.3.9 (lines 219–229) — INVALIDATE idempotency + cleanup hook firing
  - Lock 4.A / 4.A′ (line 432–439) — named-hook reshape + slot rename
  - Lock 6.D (line 464) — store persistence migration scope
- **Rust port architecture:** `~/src/graphrefly-ts/archive/docs/SESSION-rust-port-architecture.md`
- **Decision log:** `~/src/graphrefly-ts/docs/rust-port-decisions.md` — D054, D055 (locked); D056–D059 (this slice's outputs)
- **Migration status:** `~/src/graphrefly-rs/docs/migration-status.md:62` — Slice E2 entry
- **Slice D-substrate pattern reference:** D035 (`producer_deactivate`) — `~/src/graphrefly-rs/crates/graphrefly-core/src/boundary.rs:287` + `node.rs:453`
- **Slice E lock-released handshake:** D045 — `~/src/graphrefly-rs/crates/graphrefly-core/src/batch.rs` `deferred_handle_releases` pattern
- **Current TS drift:** `docs/implementation-plan-13.6-canonical-spec.md` §11 item 2 (Lock 4.A type rename) + item 3 (Lock 6.D store wipe-default flip)
