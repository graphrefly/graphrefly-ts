# Rust Port Decision Log

Decisions made during the Rust port, recorded after inline discussion.

---

<!-- Template:
### DXXX — [short title]
- **Date:** 2026-05-XX
- **Context:** [what prompted the question]
- **Options:** A) … B) … C) …
- **Decision:** [what you chose]
- **Rationale:** [why]
- **Affects:** [which modules/milestones]
-->

### D047 — Slice H typed-error: tests `.unwrap()`, production `.expect("...")`
- **Date:** 2026-05-07
- **Context:** Slice H promotes `register*` / `set_pausable_mode` to typed `Result`. Each of the ~150 call sites needs to handle the new `Result` shape.
- **Options:** A) `.unwrap()` everywhere; B) `.expect("...")` everywhere; C) per-site discretion (tests `.unwrap()`, production `.expect("invariant: ...")`).
- **Decision:** C.
- **Rationale:** Tests benefit from terseness — a panic message contains the site location anyway. Production-shape sites in `graphrefly-operators` / `graphrefly-graph` / `graphrefly-bindings-js` benefit from explicit invariant messages because they wrap into named higher-level operations where the failure mode is "the caller violated the API contract"; an explicit invariant message points the right finger.
- **Affects:** all sweep sites in Slice H.

### D048 — Slice H widened `set_pausable_mode` to surface `UnknownNode`
- **Date:** 2026-05-07
- **Context:** `set_pausable_mode(node_id, mode)` had two failure modes: (1) `node_id` not registered → panic via `require_node_mut`; (2) node currently paused → panic via `assert!`. Slice H typed-errors case 2; the question is whether to also typed-error case 1.
- **Options:** A) widen to also surface `UnknownNode`; B) leave case 1 as panic, only typed-error `WhilePaused`.
- **Decision:** A.
- **Rationale:** Without widening, callers see `Err(WhilePaused)` for one case but a process abort for the other — same surface, two different failure modes. Mirrors `Core::up::UpError::UnknownNode` (QA A10 fix 2026-05-07 — "check unknown node BEFORE tier rejection for consistent error UX"). Cost: ~5 LOC in `set_pausable_mode` + same call-site sweep that's already happening.
- **Affects:** `Core::set_pausable_mode` signature; `SetPausableModeError` enum.

### D049 — M3 napi-rs operator parity: three-bench shape
- **Date:** 2026-05-07 (scheduling decision; implementation in M3 napi-rs slice)
- **Context:** Adding TSFN (thread-safe function) plumbing for JS callbacks introduces scheduling overhead. The current `bench_builtin_fn` measures pure dispatcher + FFI; a TSFN-based bench would conflate FFI and scheduling.
- **Options:** A) one bench (TSFN-based, existing builtin retired); B) two benches (builtin + TSFN-with-real-JS-fn); C) three benches (builtin + TSFN identity overhead + TSFN with real JS fn body).
- **Decision:** C.
- **Rationale:** Subtracting bench 1 from bench 2 isolates TSFN scheduling cost; bench 3 is the honest TS-vs-Rust comparison with full callback path. Lets us read results as "TSFN adds X µs/call; with that overhead included, Rust-via-TSFN is still N× faster than TS at end-to-end."
- **Affects:** M3 napi-rs operator parity slice — `crates/graphrefly-bindings-js/benches/`.

### D050 — M3 napi-rs operator parity: TSFN strategy = napi-rs latest version sync blocking call
- **Date:** 2026-05-07
- **Context:** Core's wave engine is sync (per CLAUDE.md Rust invariant 4); JS callbacks via `napi::JsFunction` are `!Send`. TSFN crosses thread boundaries but is async (queued on JS event loop).
- **Options:** A) block-on-oneshot; B) napi-rs 3.x `call_with_return_value` blocking pattern; C) pre-baked closures only (current state); D) async dispatch in Core.
- **Decision:** B (use latest napi-rs version's blocking call API; verify exact API name + version via context7 / searxng during the slice).
- **Rationale:** A is deadlock-prone if Core fires fn from inside the JS event loop's stack frame. C punts the question. D violates "no async runtime in Core." B is the clean path.
- **Affects:** M3 napi-rs operator parity slice — `crates/graphrefly-bindings-js/Cargo.toml` (napi-rs version pin).

### D051 — M3 napi-rs operator parity: new `BenchOperators` companion class
- **Date:** 2026-05-07
- **Context:** Adding 21 `register_*` methods (13 transform + 4 producer + 4 higher-order) to `BenchCore` would inflate it to ~50 napi methods.
- **Options:** A) pile onto `BenchCore`; B) new `BenchOperators` companion class wrapping `Arc<Core>`.
- **Decision:** B.
- **Rationale:** Cleaner separation; dispatcher concerns stay on `BenchCore`, operator concerns on `BenchOperators`. Trade-off: two classes to construct/coordinate, but the cost is paid once per test fixture.
- **Affects:** M3 napi-rs operator parity slice — `crates/graphrefly-bindings-js/src/`.

### D052 — M3 napi-rs operator parity: bundle custom-equals TSFN with operators
- **Date:** 2026-05-07
- **Context:** Same TSFN plumbing gates `EqualsMode::Custom(callback)`. Two options: bundle into M3 napi-rs slice, or land separately.
- **Options:** A) bundle (one TSFN refactor covers both paths); B) separate slices.
- **Decision:** A.
- **Rationale:** Doubling the slice scope is cheaper than two TSFN design passes. One refactor, one design pass, one test infrastructure update.
- **Affects:** M3 napi-rs operator parity slice.

### D053 — M3 napi-rs operator parity: activate-and-triage for `parity-tests`
- **Date:** 2026-05-07
- **Context:** When the napi-rs slice lands, `packages/parity-tests/impls/rust.ts` flips from `null` to non-null and ~25 existing parity scenarios run against `rustImpl` for the first time.
- **Options:** A) walk all scenarios pre-activation, predict failures, document expected divergences as `test.runIf` markers; B) activate, let CI fail, triage one by one.
- **Decision:** B.
- **Rationale:** Slower but reveals unknown-unknowns. Pre-walking risks confirmation bias — we'd document the divergences we expect and miss the ones we don't.
- **Affects:** M3 napi-rs operator parity slice; `packages/parity-tests/` activation step.

### D054 — Slice E2: cleanup hooks via `BindingBoundary::cleanup_for(NodeId, CleanupTrigger)`
- **Date:** 2026-05-07 (scheduling decision; implementation in Slice E2)
- **Context:** Spec R2.4.5 says fn returns `NodeFnCleanup = { onRerun?, onDeactivation?, onInvalidate? }`. Spec R2.4.6 says `ctx.store` persists across deactivation by default, wiped on resubscribable terminal reset. Both cross the cleaving plane — `ctx.store` contents and cleanup closures are user values that live binding-side.
- **Options:** A) extend `BindingBoundary::invoke_fn` to take ctx (Core owns `ctx.store`); B) lifecycle-trigger hooks (Core extends `BindingBoundary` with `cleanup_for(NodeId, CleanupTrigger)`); C) hybrid — return cleanup token from `invoke_fn`, Core stores token, fires `cleanup_for(node, key, trigger)`.
- **Decision:** B.
- **Rationale:** A violates the cleaving plane (Core would own user values). C only matters if hooks change between fn-fires within the same activation, but the binding can keep a stable lookup `node_id → current cleanup` updated on each `invoke_fn` return — same map that holds `ctx.store`. B mirrors the existing `BindingBoundary::producer_deactivate` pattern from Slice D-substrate (D035) — Core fires lifecycle triggers; binding manages state.
- **Affects:** Slice E2 — `BindingBoundary` trait; `Core::_deactivate` / INVALIDATE handler / fn-fire entry hooks.

### D055 — Slice E2: binding-owned `Mutex<HashMap<NodeId, NodeCtxState>>` with `wipe_ctx` only on resubscribable reset
- **Date:** 2026-05-07
- **Context:** Per D054 (B), binding owns ctx state. Need to lock the storage shape: where the state lives, when it's wiped, how cleanup re-entrance is handled.
- **Decision:** binding holds `Mutex<HashMap<NodeId, NodeCtxState>>` where `NodeCtxState = { store: HashMap<String, BindingValue>, current_cleanup: Option<NodeFnCleanup> }`. Core extends `BindingBoundary` with `wipe_ctx(node_id)` fired only on `reset_for_fresh_lifecycle` (resubscribable terminal reset). Default deactivation does NOT wipe (per R2.4.6). `cleanup_for` fires LOCK-RELEASED per Slice E (D045) handshake discipline. Per-wave-per-node dedup for `onInvalidate` via new `CoreState.invalidate_hooks_fired_this_wave: HashSet<NodeId>` cleared in `clear_wave_state`.
- **Rationale:** Matches spec R2.4.6 wipe-on-resubscribable-reset semantics. Mismatch trap with current TS impl noted (TS wipes on `_deactivate` per canonical spec §11 item 3 — Phase 13.6.B migration scope).
- **Affects:** Slice E2 — `BindingBoundary` extension; `CoreState` invalidate-hooks dedup field; `reset_for_fresh_lifecycle` wipe call.

### D056 — Slice E2: separate `OnDeactivation` cleanup hook from existing `producer_deactivate`
- **Date:** 2026-05-07
- **Context:** `Subscription::Drop` already fires `producer_deactivate` for producer nodes when the last sub drops. Slice E2 needs to fire `cleanup_for(node, OnDeactivation)` for any node that has fired its fn at least once (including producer nodes that ALSO returned cleanup hooks).
- **Options:** A) overload `producer_deactivate` to also carry the `OnDeactivation` semantic; B) keep them as separate hooks fired in sequence (cleanup first, producer-deactivate second).
- **Decision:** B.
- **Rationale:** `producer_deactivate` is producer-specific (tear down upstream subscriptions captured during fn-fire). `OnDeactivation` is a user-facing cleanup hook that may exist on any node kind. Conflating them would force every binding's `producer_deactivate` impl to also dispatch `current_cleanup.onDeactivation`, breaking the producer-vs-cleanup separation that D054 mirrored. Order (cleanup first) chosen because cleanup may release handles the producer subscription owns; reverse order would let producer_deactivate drop subs that user cleanup expected to be live.
- **Affects:** `Subscription::Drop` site; `BindingBoundary::cleanup_for` semantics.

### D057 — Slice E2: OnInvalidate dedup via wave-scoped HashSet (not just cache-clear idempotency)
- **Date:** 2026-05-07
- **Context:** `invalidate_inner` already has natural cache-clear idempotency (a node with `cache == NO_HANDLE` is a no-op). For most fan-in shapes this provides per-wave-per-node dedup for free. The edge case: a node could re-populate mid-wave (fn fires, emits) and then be re-invalidated in the same wave via a separate path.
- **Options:** A) rely on cache-clear idempotency only; B) explicit `invalidate_hooks_fired_this_wave: AHashSet<NodeId>` cleared in `clear_wave_state`.
- **Decision:** B (strict reading confirmed by user 2026-05-07 Q1).
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

### D062 — M3 napi-rs operator parity: worker-thread Core for the napi binding (deadlock resolution)
- **Date:** 2026-05-07
- **Context:** D050 picked `ThreadsafeFunction::call_with_return_value(arg, Blocking, |ret, env| ...)` as the TSFN strategy. Research during the napi-operators design call (`archive/docs/SESSION-rust-port-napi-operators.md` §2.2 / §7 Q1) revealed that this API is asynchronous from the calling Rust thread: the result-handler closure runs on the JS event-loop thread; the calling Rust thread blocks on a oneshot/mpsc to read the value back. **Deadlocks** if the calling Rust thread IS the JS event-loop thread (which is the case today — `BenchCore::emit_int(...)` is a sync `#[napi]` method, so Core's wave engine fires `invoke_fn` while holding the JS thread). Operator workloads with any non-trivial JS callback would deadlock.
- **Options:** A) worker-thread Core (napi method enqueues to dispatcher thread; worker drives Core; TSFN call from worker → JS thread non-deadlocking); B) hybrid Function<>+thread-local-Env on JS thread + TSFN otherwise (two code paths, breaks cleaving plane); C) defer the deadlock concern (ship anyway, accept the failure mode as a porting-deferred item).
- **Decision:** A.
- **Rationale:** A is the only option that supports arbitrary JS callbacks without deadlock. B doubles the maintenance surface and entangles the binding with `!Send` Function shape + Env-lifetime concerns. C ships a known-broken path. Performance cost of A is bounded — per-napi-method scheduler-jitter overhead, paid per batch (not per emission), so amortizes well over real workloads. The existing `bench_builtin_fn` baseline will regress slightly versus the current single-thread impl; the regression is acceptable as the cost of correctness under JS-callback workloads.
- **Affects:** `crates/graphrefly-bindings-js/src/core_bindings.rs` (every `#[napi]` method becomes worker-routed); new `BenchCore::worker: WorkerHandle` field; new dispatcher thread per `BenchCore::new()`; bench (1) baseline numbers.

### D063 — M3 napi-rs operator parity: worker-thread implementation pattern (per-Core dispatcher thread + mpsc command channel + per-call oneshot return)
- **Date:** 2026-05-07
- **Context:** D062 chose worker-thread Core. Implementation pattern needed locking before §5 Phase A2 in the session doc.
- **Decision:** Each `BenchCore::new()` spawns one dedicated dispatcher thread (`std::thread::spawn(...)`) that owns the `Core` and `BenchBinding` arcs. The thread runs a loop receiving `CoreCommand` enum variants from an `mpsc::Sender` stored on `BenchCore`. Each `#[napi]` method (e.g., `emit_int`, `register_state_int`, `subscribe_noop`) builds the appropriate `CoreCommand` variant + a per-call `oneshot::channel`, sends both, then `recv()`s the result oneshot and returns it to JS. JS-side API stays sync (the napi method blocks on the worker until the wave completes). TSFN calls fire from the worker thread; JS callbacks run on the JS thread; result-handler closure pushes value back to worker via a *separate* oneshot inside the TSFN bridge. No deadlock: when the worker thread blocks on the TSFN-result oneshot, the JS thread is free (it's not holding any Rust frame that would prevent libuv from draining).
- **Rationale:** Single-thread-per-`BenchCore` keeps Core's existing single-locked model intact (no concurrency changes inside Core). mpsc + oneshot is the standard Rust pattern for sync RPC over a channel boundary. Per-`BenchCore` worker (vs. shared global pool) keeps tests independent and avoids cross-fixture contention.
- **Affects:** new `crates/graphrefly-bindings-js/src/worker.rs` module (CoreCommand enum + dispatcher loop); `BenchCore::new()` spawns; `BenchCore::Drop` cleanly shuts down the worker (drop sender → worker thread observes channel close → exits loop → JoinHandle joined). `BenchOperators::from(core)` shares the SAME worker (no second dispatcher). Document in §5 Phase A2 of `archive/docs/SESSION-rust-port-napi-operators.md`.

### D064 — M3 napi-rs operator parity: HandleId narrowed to `u32` for TSFN signatures
- **Date:** 2026-05-07
- **Context:** Core HandleId is `NewType<u64>`. TSFN type-parameters need a concrete numeric type for the JS-side `number` representation. Three options surfaced in `SESSION-rust-port-napi-operators.md` §7 Q3.
- **Options:** A) narrow to `u32` (matches existing `BenchCore::register_state_int → u32` convention; document 4B-handles-per-`BenchCore` limit); B) use `napi::JsBigInt` (native u64; per-call BigInt boxing cost); C) use `f64` (TS `number`; 53-bit safe; awkward napi-rs coercion).
- **Decision:** A.
- **Rationale:** Consistency with existing `BenchCore` napi method signatures (every public napi method already uses `u32` for `NodeId` / `HandleId`-shaped parameters and returns). 4B-handles-per-`BenchCore`-instance is benign for bench fixtures, parity tests, and short-lived consumers; long-running production processes that exhaust the space can be re-evaluated when bench evidence justifies the BigInt cost. Keeps TSFN type signatures simple (`Function<u32, u32>` reads naturally).
- **Affects:** All new `BenchOperators` register_* method signatures; `Registry::next_handle` increment (already u64 internally; truncation at the napi boundary). Document the binding-local 4B-handle limit in `BenchOperators` rustdoc + `BenchCore::register_state_int` rustdoc as a known-limit + porting-deferred entry "BigInt HandleId for unbounded handle space".

### D065 — M3 napi-rs operator parity: JS-callback throws panic at FFI boundary (Core panic-naive, symmetric with D060)
- **Date:** 2026-05-07
- **Context:** TSFN bridge receives a `Result<T, napi::Error>` from the result-handler closure. When a user JS callback throws, the bridge can either propagate as a Rust panic (matching D060 cleanup-closure discipline) or convert to a typed error.
- **Options:** A) panic at FFI boundary; rely on Core's existing panic-discard discipline (`clear_wave_state`); B) convert to typed `OperatorFireError` enum routed through Core's fire-error paths; C) catch + log + insert `NO_HANDLE` (filter-drop semantics).
- **Decision:** A.
- **Rationale:** Symmetric with D060 (cleanup closures). Cleanest semantics: user closures are the binding's responsibility; Core stays panic-naive about user code. JS exceptions become Rust panics at the bridge → `clear_wave_state` panic-discards the wave per existing discipline → napi binding propagates the panic back to JS as an exception (napi-rs default panic→exception path). C silently hides bugs; B doubles the error-path surface for marginal benefit (the binding can already see the JS exception via the napi `Result` and re-throw it via panic without additional Rust enum machinery).
- **Affects:** `BenchBinding::invoke_*_sync` helpers (panic on `Err(napi::Error)` from TSFN bridge); rustdoc on each `BenchOperators::register_*` method documenting the throw → panic → wave-discard chain; porting-deferred entry "JS-callback throw panic-discards entire wave (no per-fire isolation)" so consumers know the granularity.

### D066 — M3 napi-rs operator parity: `rustImpl` re-exports message-type symbols from `@graphrefly/legacy-pure-ts`
- **Date:** 2026-05-07
- **Context:** Parity-tests `Impl` interface includes message-type identifiers (`DATA / RESOLVED / DIRTY / INVALIDATE / PAUSE / RESUME / COMPLETE / ERROR / TEARDOWN`) as `unique symbol`s. `rustImpl` could re-export from `@graphrefly/legacy-pure-ts` (shared identity) or define its own.
- **Options:** A) re-export from legacy (shared symbol identity across impls; protocol-level identifiers are not impl-bound); B) define own symbols inside `@graphrefly/native` (each impl carries its own; parity scenarios always access via `impl.<name>` so cross-impl symbol comparison never happens).
- **Decision:** A.
- **Rationale:** Message-type symbols are protocol identifiers — they identify the *concept* (DATA, RESOLVED, etc.), not the impl that emits them. Sharing identity across impls is honest, simpler, and avoids the "two unique symbols for the same protocol concept" weirdness that would surface if any future code accidentally does cross-impl comparison. Cost of B (defensive isolation) outweighs benefit for protocol identifiers that are inherently shared.
- **Affects:** `packages/parity-tests/impls/rust.ts` re-exports `DATA / RESOLVED / DIRTY / INVALIDATE / PAUSE / RESUME / COMPLETE / ERROR / TEARDOWN` from `@graphrefly/legacy-pure-ts`; the rustImpl arm only contributes its own `name` + `node` + `Graph` + operator factories. Future `@graphrefly/native` runtime DOES NOT need to define its own message-symbol module.

### D067 — Slice E2 /qa: fire `OnRerun` from `set_deps` on dynamic nodes that had previously fired
- **Date:** 2026-05-07
- **Context:** Slice E2 /qa surfaced (EC-2): `Core::set_deps(dyn, new_deps)` resets `has_fired_once = false` for dynamic nodes (so the cleared `tracked` set doesn't block every future fire — see `node.rs:3577-3583` rationale). The next `fire_regular` Phase 1 captures `has_fired_once = false`, causing Phase 1.5 to skip OnRerun. The previous fn-fire's `current_cleanup.on_rerun` is silently dropped when the next `invoke_fn` overwrites `current_cleanup`. Per spec R2.4.5, `set_deps` does NOT end the activation cycle (subscribe→unsubscribe is the cycle boundary), so OnRerun MUST fire on every re-fire including post-`set_deps`.
- **Options:** A) document as expected ("set_deps re-bootstraps the dep-shape gate; treat as activation reset for OnRerun purposes"); B) fire `OnRerun` from inside `set_deps` BEFORE the `has_fired_once = false` reset (lock-released, after the rewrite completes); C) split flags — `has_ever_fired` (sticky, used for OnRerun gate) vs `has_fired_once_in_dep_shape` (resets, used for first-fire gate).
- **Decision:** B.
- **Rationale:** Minimal blast radius (~10 LOC + 1 regression test); matches spec semantics literally; preserves the existing `has_fired_once` reset rationale (cleared `tracked` first-fire branch); doesn't introduce a flag-split that future maintainers would have to reason about. Fires `binding.cleanup_for(n, OnRerun)` directly lock-released after `drop(s)` (NOT via `deferred_cleanup_hooks`) because `set_deps` may not enter a wave (only opens `run_wave` if there are added deps requiring push-on-subscribe) — queueing into the deferred wave-cleanup queue would orphan the hook until the next unrelated wave drains.
- **Affects:** `Core::set_deps` (capture `is_dynamic && has_fired_once` before reset; fire `cleanup_for` lock-released after `drop(s)`); regression test `d062_set_deps_fires_on_rerun_for_dynamic` in `tests/slice_e2_cleanup.rs`.

### D068 — Slice E2 /qa: gate `Subscription::Drop` OnDeactivation on `fn_id.is_some()` (skip state nodes)
- **Date:** 2026-05-07
- **Context:** Slice E2 /qa surfaced (EC-5): state nodes have no `fn_id` (no `invoke_fn` ever runs), but `has_fired_once` is initialized to `initial != NO_HANDLE` (`node.rs:1737`). When the last sub leaves a `state(Some(v))`, `Subscription::Drop` fired `cleanup_for(state_id, OnDeactivation)`. Binding lookup found no `current_cleanup` (state nodes can't register cleanup specs via the production fn-return path per R2.4.5) → user-visible no-op, but a wasted FFI hop per state-node deactivation.
- **Options:** A) gate on `fn_id.is_some()` so `Subscription::Drop` skips cleanup_for for state nodes (`has_fired_once && fn_id.is_some()`); B) leave as is (binding correctly no-ops; spec-literal correct).
- **Decision:** A.
- **Rationale:** Matches design-doc table wording ("never-fired state nodes — skip cleanup") and saves an FFI hop per state-node deactivation. State nodes literally cannot have user-registered cleanup specs in production (R2.4.5 specifies cleanups come from fn-return; state nodes have no fn). Test ergonomic `TestBinding::register_cleanup` bypasses the spec, but tests that imperatively register cleanup on a state node are exercising an out-of-spec path that the gate correctly ignores. Gate is structural (fn_id presence) so future binding designs that add fn-shaped state nodes would naturally pick up cleanup support.
- **Affects:** `node.rs` `Subscription::Drop` (replace `has_fired_once` gate with `has_fired_once && fn_id.is_some()`, surfaced as new `has_user_cleanup` local); regression test `d068_state_with_initial_value_skips_on_deactivation` in `tests/slice_e2_cleanup.rs`.

### D069 — Slice E2 /qa: eager `wipe_ctx` on resubscribable terminal (close the never-resubscribed leak vector)
- **Date:** 2026-05-07
- **Context:** Slice E2 /qa surfaced (EC-3): `wipe_ctx` only fired from `subscribe`'s `did_reset` path. A resubscribable node that hits COMPLETE/ERROR and stays unsubscribed for the lifetime of `Core` retained its `NodeCtxState` (store + current_cleanup) until `Core` dropped. Spec R2.4.6 says wipe is "on resubscribable terminal reset (when a `resubscribable: true` node hits COMPLETE/ERROR and is later resubscribed)" — so this matched the spec literal, but represented a memory-leak vector that's not idiomatic in Rust (RAII culture prefers eager, deterministic cleanup over "lazy GC when owner drops").
- **Options:** A) document as known limitation in `wipe_ctx` rustdoc + `porting-deferred.md` entry (production bindings can implement their own GC if it matters); B) fire `wipe_ctx` eagerly from `terminate_node` for resubscribable nodes whose subscriber set is already empty — eager wipe, spec-conformant under broader reading.
- **Decision:** B (user direction 2026-05-07: "more Rust-idiomatic, removes a real leak vector").
- **Rationale:** Eager cleanup at the terminal-and-no-subs transition is more idiomatic Rust (RAII / deterministic resource reclaim). The implementation has two mutually-exclusive trigger sites depending on the order of `terminate_node` vs last-sub-drop:
  - If subs are EMPTY when `terminate_node` runs (last sub already dropped, then `Core::complete`/`Core::error`): `terminate_node` queues the node into a new `CoreState::pending_wipes: Vec<NodeId>` field. The wave's `BatchGuard::drop` success path takes the queue via `Core::drain_deferred` and fires each `wipe_ctx` lock-released through `Core::fire_deferred` with per-item `catch_unwind` (mirrors D060 drain-don't-short-circuit discipline).
  - If subs are LIVE when `terminate_node` runs (terminate fires while subs still hold subscriptions): `terminate_node` does NOT queue — the eventual last `Subscription::Drop` checks `terminal.is_some() && resubscribable && last_sub` and fires `wipe_ctx` directly lock-released, AFTER the existing `OnDeactivation` + `producer_deactivate` hooks (preserves test 10's "OnDeactivation observes pre-wipe store" invariant).
  Mutually exclusive: each terminal lifecycle fires exactly one wipe via exactly one path. The existing `subscribe`-time `wipe_ctx` site (in `reset_for_fresh_lifecycle`) becomes a defensive safety net for the rare edge case where subs are alive at terminate AND a new subscribe arrives BEFORE the existing subs drop — the second fire is idempotent (`HashMap::remove` on absent key is a no-op).
  **Panic-discard semantics**: `BatchGuard::drop` panic path takes-and-drops `pending_wipes` silently, mirroring D061's `deferred_cleanup_hooks` discipline. External-resource state attached via the binding's `wipe_ctx` impl MUST idempotent-cleanup at process exit / next successful terminate-with-no-subs cycle.
- **Affects:** `CoreState::pending_wipes: Vec<NodeId>` field; `Core::terminate_node` (push to queue when `resubscribable && subscribers.is_empty()`); `Subscription::Drop` (fire `wipe_ctx` directly when last-sub-drops on terminal-resubscribable node, after OnDeactivation + producer_deactivate); `Core::drain_deferred` / `Core::fire_deferred` (extended with 4th tuple element + new `WaveDeferred` type alias to satisfy `clippy::type_complexity`); `BatchGuard::drop` panic path (silent `pending_wipes` drop); regression tests `d069_terminate_with_no_subs_fires_eager_wipe` + `d069_terminate_then_last_sub_drops_fires_wipe_via_subscription_drop` in `tests/slice_e2_cleanup.rs`. Updated assertion in `r2_4_6_store_wiped_on_resubscribable_reset` to allow 1 OR 2 wipe fires (the resubscribe-after-wipe path may double-fire idempotently via the safety net).

### D073 — Phase E rustImpl activation: JS-side value registry (not Rust-side polymorphic widen)
- **Date:** 2026-05-07
- **Context:** Phase E activates `rustImpl` in `packages/parity-tests/impls/rust.ts`. Parity scenarios use `impl.node<T>([], { initial, name })` with arbitrary `T` (number/string/object). Existing `BenchBinding::Registry` only stores `BenchValue::Int(i32)`; the question is whether to widen Rust-side to hold polymorphic `T` (e.g., `BenchValue::JsObject(napi::Object)` or napi-ref-keyed map) or to keep Rust handle-opaque and put the value mirror entirely in JS.
- **Options:** (A) Widen Rust registry — `BenchValue` becomes a polymorphic enum holding JS-rooted values; `retain_handle`/`release_handle` adjust refcounts on values Rust owns. Mirrors how TS legacy `node()` works internally (value cache lives with the node). (B) JS-side registry — Rust binding stays handle-opaque (only refcount-tracks JS-allocated handle IDs via a `BenchValue::JsAllocated` marker); JS adapter holds the actual `Map<HandleId, T>`; Rust notifies JS via TSFN when refcount drops (D076).
- **Decision:** B.
- **Rationale:** Aligns with the canonical handle-protocol cleaving plane (`docs/research/handle-protocol.tla` + audit-input.md): "Core operates on opaque `HandleId`; the binding registry holds `T`." For the napi binding, the *binding* is the JS adapter — so the registry naturally lives JS-side. Widening Rust-side adds JS-Object-lifetime + Send/Sync friction (`napi::Object` is `!Send`); option B keeps `BenchBinding` Send+Sync clean. Symmetric with how the future pyo3 binding will marshal Python objects. Smaller Rust diff (~80 LOC additions vs ~200 LOC if Rust held values). User-direction 2026-05-07 ("can we ... compose node or graph like we do in patterns").
- **Affects:** `BenchValue::JsAllocated(u32)` marker variant; new `BenchCore::register_state_with_handle` / `emit_handle` / `cache_handle` / `subscribe_with_tsfn` napi methods (handle-passthrough); new `BenchBinding::set_release_callback(tsfn)` to notify JS on refcount-zero (D076); `packages/parity-tests/impls/rust.ts` JS adapter contains `JSValueRegistry` class + `RustNode<T>` wrapper.

### D074 — Phase E rustImpl activation: bundle Graph wrapping in this slice (don't defer)
- **Date:** 2026-05-07
- **Context:** `Impl` interface includes `Graph` (used by 6 parity scenarios under `scenarios/graph/`). Original Phase E proposal punted Graph wrapping ("`rustImpl.Graph = null`, gate graph scenarios with `runIf`"). User pushed back: Graph is needed for downstream `patterns/` parity scenarios; the M3 substrate is incomplete without it, and "Graph later" risks indefinite deferral.
- **Options:** (A) Operator-only this slice; defer Graph to follow-on. (B) Bundle Graph wrapping (BenchGraph napi class + JS `Graph` adapter wrapper) into this slice. (C) Defer entire Phase E until Graph wrapping is designed independently.
- **Decision:** B.
- **Rationale:** User direction 2026-05-07 ("Graph is needed for the patterns anyways"). Without Graph in `rustImpl`, the parity activation is half-done — patterns/ work that lands later would need to retroactively wire up Graph. Doing it once, now, is cheaper than two slices. Slice grows from ~500 LOC to ~1000–1300 LOC but stays coherent (single-purpose: activate `rustImpl`).
- **Affects:** New `BenchGraph` napi class wrapping `graphrefly_graph::Graph` (Slice E+/F surface — `state` / `derived` / `dynamic` / `add` / `node` / `remove` / `try_resolve` / `name_of` / `mount` / `unmount` / `destroy` / `describe` / `observe` / `observe_all` / `signal` / `edges` / `signal_invalidate`); JS `RustGraph` wrapper class returning `RustNode<T>` for reactive methods. Slice E4 (`Node<T>` Rust-side wrapper) stays deferred — JS adapter's `RustNode<T>` is the wrapper from the JS side, no Rust-side `Node<T>` widening needed.

### D075 — Phase E rustImpl activation: cross-platform CI matrix scope (build artifacts, no npm publish)
- **Date:** 2026-05-07
- **Context:** napi-rs cross-platform shipping uses `optionalDependencies` on per-platform sub-packages (`@graphrefly/native-darwin-arm64`, `@graphrefly/native-linux-x64-gnu`, etc.). Each sub-package is its own npm release. Full publish requires CI matrix builds + npm-publish credentials + version-tag flow. The question for this slice is how far to take it.
- **Options:** (A) Local-platform-only this slice (host arch via `napi build`); cross-platform deferred. (B) Cross-platform CI matrix that builds + caches `.node` artifacts per platform on push, NO npm publish (artifacts are workflow outputs, accessible via download). (C) Full publishable shape including npm publish wired up.
- **Decision:** B.
- **Rationale:** User direction 2026-05-07 (do all 1,2,3,4 now). Local-platform-only would block PR-time parity validation across non-host machines. Full publish is release-engineering separable from parity-test activation: requires npm tokens, semver cadence, and downstream `@graphrefly/legacy-pure-ts` publish coordination. Building artifacts in CI gives `pnpm test:parity` the right shape on every PR without committing to a release cadence. Publish flow lands in a separate slice when 1.0 ship-readiness is in play.
- **Affects:** `.github/workflows/ci.yml` adds a `napi-build` matrix job (linux-x64-gnu, darwin-arm64, darwin-x64, win32-x64-msvc); each job runs `napi build --release --target <triple>` and uploads `.node` artifact; `parity-tests` job downloads host artifact and runs against it. The `package.json` for `@graphrefly/native` declares `optionalDependencies` matching the matrix even though the platform sub-packages aren't published yet (so the publish-shape is right when we flip to publishing).

### D077 — Phase E rustImpl activation: parity-test scenarios migrate to async; `Impl` interface widened to Promise-returning
- **Date:** 2026-05-07
- **Context:** Parity scenarios are written sync (`test("...", () => { ... })` with synchronous `expect`s after `subscribe` / `down`). Legacy impl runs single-threaded so handshakes fire inline. Rust binding (per D070) is async-only — every Core-touching method goes through `napi::tokio_runtime::spawn_blocking` returning a Promise. Sink TSFN delivery requires JS thread to pump libuv (i.e., be `await`ing) — sync test shape would deadlock. Three options surfaced: (A) async-everywhere parity tests, (B) sync-Core napi class for parity-tests only, (C) operator-only `rustImpl` activation that skips sink-touching scenarios.
- **Options:** (A) Convert all ~30 parity scenario files to `async` tests with sprinkled `await`s; widen `Impl` interface to Promise-returning shape; wrap `legacyImpl` methods in `Promise.resolve()`. (B) Add a sync-Core napi class that runs Core directly on JS thread without `spawn_blocking` (operator callbacks via direct `Function::call`). (C) Activate `rustImpl` only for scenarios that don't touch sinks/callbacks; leave most scenarios legacy-only.
- **Decision:** A.
- **Rationale:** (B) blocked by `Function<>` `!Send` constraint — closures stored in `Arc<BenchBinding>` registry must be `Send + Sync`, which `Function<>` isn't. Routing around requires non-cleaving-plane shims (thread-local Function refs, `unsafe impl Send`, etc.) that violate CLAUDE.md Rust invariant 1. (C) defeats the purpose — rustImpl validates the "drop-in replacement" claim only when ALL parity scenarios run against both arms. (A) is mechanical (sprinkle `await`) and produces an `Impl` interface that's honest about the cross-impl contract: any napi-bound impl will need async, so async is the right shape. The Promise.resolve overhead on legacy is negligible for parity tests (microseconds per call, not hot path).
- **Affects:** `packages/parity-tests/impls/types.ts` widens to async-returning method signatures (e.g., `node: (deps: Node[], opts: Opts) => Promise<Node>`); `packages/parity-tests/impls/legacy.ts` wraps every method in `async (...args) => legacy.method(...args)` (mechanical); `packages/parity-tests/impls/rust.ts` exposes the napi async methods directly via the JS adapter; ~30 test files under `scenarios/{core,graph,operators}/` convert each `test(...)` to `test(..., async () => { ... })` with `await` on every `impl.*` call. **Sink semantics:** `subscribe(cb): Promise<UnsubFn>` resolves AFTER the handshake's sink-fire completes (per `bridge_sync_unit` discipline — tokio thread blocks on a sync_channel until JS sink callback returns); `down(msgs): Promise<void>` resolves AFTER the wave drains AND all sinks have fired. So `await impl.subscribe(...)` followed by sync `expect(seen)...` is correct.

### D076 — Phase E rustImpl activation: `release_handle` TSFN callback for JS-side refcount-zero notification
- **Date:** 2026-05-07
- **Context:** Per D073, JS adapter holds `Map<HandleId, T>`. When Rust dispatcher's refcount drops to 0 for a JS-allocated handle, the JS map should prune (otherwise it grows unbounded across long-running parity tests / harness scenarios).
- **Options:** (A) JS-side prune at end of test ("trust the test scope to bound mirror size"). Simple but leaks within long-lived `BenchCore` instances; harness scenarios that run thousands of waves on one Core would balloon. (B) Rust-side TSFN callback: `BenchBinding::release_handle(JsAllocated(h))` fires a TSFN that notifies JS to drop `map.delete(h)`. Symmetric with the existing `producer_deactivate` TSFN pattern. (C) Rust-side WeakRef tracking — JS uses a `FinalizationRegistry` to notify Rust when JS-side value is GC'd. Backwards: we want Rust → JS notification, not JS → Rust.
- **Decision:** B.
- **Rationale:** Bounded mirror size is correctness, not optimization — without it, parity-tests may pass but a real harness would OOM. Symmetric with existing TSFN patterns (`producer_deactivate`). Cost: one TSFN call per refcount-zero (rare in practice — handles persist across cache slots). Per CLAUDE.md Rust invariant 4, the TSFN call goes through `BenchBinding`, NOT through `Core`; `Core` stays sync + binding-agnostic.
- **Affects:** `BenchBinding::release_callback: parking_lot::Mutex<Option<ThreadsafeFunction<u32, ()>>>` field; `BenchCore::set_release_callback(tsfn)` napi method (called once at JS adapter init); `BindingBoundary::release_handle` impl on `BenchBinding` checks if value is `JsAllocated` AND refcount drops to 0, then fires the TSFN with the handle ID; JS adapter installs the callback on `BenchCore` construction. **Edge case:** TSFN fire is async (libuv pump); JS map prune happens on the JS thread out-of-band. Since handle IDs are never reused (allocated by JS-side counter), late prune is safe. **Drop safety:** if `BenchCore` drops with TSFN registered, the TSFN's queue may still drain — JS map is owned by JS adapter (which lives at least as long as `rustImpl` in the test process), so prune-after-Core-drop is benign no-op (`map.delete` of unknown key).

### D072 — M3 napi-rs operator parity /qa-followup: clean napi 3.x bump (no compat-mode); supersedes D071 + Cargo.toml 2.x pin
- **Date:** 2026-05-07 (QA-followup-followup, user directive: "no compat mode! no backward compat needed. no legacy behind")
- **Context:** D071 deferred the 3.x bump to a follow-on slice and applied a Rust-built JS wrapper (option C) for C1. User pushback rejected this: napi 3.x is the explicit target, no compat-mode, no legacy. Direct migration:
  - **Cargo.toml:** `napi = "3"` + `napi-derive = "3"` with `default-features = false` (just `napi9 + tokio_rt`); explicitly NO `compat-mode`.
  - **`#![forbid(unsafe_code)]` → `#![deny(unsafe_code)]`** in `bindings-js/src/lib.rs` (per-crate carve-out from CLAUDE.md Rust invariant 1). Justification: napi-derive 3.x's `#[napi]` macro emits `#[allow(unsafe_code)]` on generated registration items; `forbid` rejects all `allow` overrides while `deny` permits the macro's explicit allows. No hand-written unsafe lives in this crate's source.
  - **API migration:** `JsFunction` → `Function<Args, Return>` typed callback (impls `FromNapiValue`); `JsObject` → `PromiseRaw<'env, T>` for Promise returns; `create_threadsafe_function`'s 7-generic-param call shape → builder pattern (`build_threadsafe_function::<T>().max_queue_size::<1>().callee_handled::<true>().build_callback(|ctx| Ok(ctx.value))?`); `ErrorStrategy` enum → const-bool `CalleeHandled` generic; `execute_tokio_future` → `Env::spawn_future` (returns `PromiseRaw<'env, T>` directly; no resolver closure needed since `T: ToNapiValue`).
  - **C1 fixed by design.** TSFN cb signature changed from `FnOnce(D) -> Result<()>` (2.x — JS-throw → fatal abort) to `FnOnce(Result<Return>, Env) -> Result<()>` (3.x — JS-throw delivered as `Err` to cb). Our cb logs the throw, sends `Result<R>` through the channel, returns `Ok(())` so napi doesn't treat us as panicked. Bridge then panics on the receiving side via channel-collapse path (caught by Core's `BatchGuard::drop` panic-discard discipline, D061). **Rust-built JS wrapper from D071 (`wrap_safe_handle_returning` + `wrap_safe_bool_returning`) DELETED** — no longer needed.
  - **Two-arg callbacks:** napi 3.x requires `FnArgs<(u32, u32)>` wrapper for multi-arg JS callback signatures (was bare `(u32, u32)` in 2.x).
- **Options:** (A) napi 3.x without compat-mode (full migration; ~250 net LOC change in `operator_bindings.rs` + ~10 LOC in `lib.rs` Cargo.toml); (B) napi 3.x with compat-mode (preserves more 2.x-shaped APIs but compat-mode doesn't fully escape `forbid(unsafe_code)` either, so we pay the carve-out cost without the migration savings); (C) stay on 2.16 + JS wrapper (D071's choice — rejected by user).
- **Decision:** A.
- **Rationale:** User directive explicit. Compat-mode adds complexity without fully solving the unsafe issue. Clean 3.x is the target. Migration cost paid once.
- **Affects:** `Cargo.toml` (napi/napi-derive 3.x); `lib.rs` (`forbid` → `deny`); `operator_bindings.rs` (full rewrite of TSFN substrate + 22 register methods); D071 superseded (no longer applies — wrapper deleted, native cb-handles-throw replaces it); D070 Option E architecture preserved (still uses `napi::tokio_runtime::spawn_blocking` via `bindgen_prelude::*` re-export); D050 / D062 remain the chronological history of this design path.

### D071 — ~~M3 napi-rs operator parity /qa-followup: napi 2.x → 3.x bump deferred; C1 fixed via Rust-built JS wrapper (option C)~~ — SUPERSEDED by D072 (2026-05-07)
~~Original entry deferred the 3.x bump and applied a Rust-built JS wrapper (option C) for C1.~~ User pushback (same day) rejected the compat / legacy approach; D072 replaces this with a clean napi 3.x migration. The wrapper helpers (`wrap_safe_handle_returning` / `wrap_safe_bool_returning`) were deleted; native 3.x cb signature handles JS-throw natively.

### D070 — M3 napi-rs operator parity /qa: Option E (`napi::tokio_runtime::spawn_blocking` + Promise-returning napi methods) supersedes D062 + D063
- **Date:** 2026-05-07 (QA pass on Phases A–C)
- **Context:** D062 + D063 locked a homemade `WorkerHandle` design with a per-`BenchCore` dispatcher thread + `mpsc::sync_channel` blocking on the JS thread. QA pass confirmed (via context7 + napi-rs source review) the design **deadlocks** the first time a JS-callback operator wave runs: TSFN delivery is unconditionally async via libuv (no synchronous bypass exists in Node-API or napi-rs); a sync napi method blocking on `mpsc::recv` parks the JS thread → libuv can't pump → TSFN result-handler never fires → worker thread blocks on bridge oneshot → JS thread blocks on dispatch oneshot.
- **Options:** (A) homemade worker + JsDeferred-based Promise — keeps the homemade worker but Promise-shapes the napi API (~600 LOC); (B) hybrid `Function<>` + thread-local Env — sync JS calls on JS thread (breaks cleaving plane, !Send conflicts); (C) defer the JS-callback path entirely — punts; (D) drop worker thread + sync `Function<>::call` from JS thread — different deadlock vector + violates D062's "Core not on JS thread" intent; **(E) `napi::tokio_runtime::spawn_blocking` + Promise-returning napi methods** — delete the homemade worker, use tokio's blocking pool to run Core's sync wave engine, return Promises so JS thread is free to pump libuv during await.
- **Decision:** E (user direction 2026-05-07).
- **Rationale:**
  - Smaller code: ~350 LOC (delete `worker.rs` ~220 LOC; add ~130 LOC for tokio integration) vs A's ~600 LOC.
  - Idiomatic: `napi::tokio_runtime::spawn_blocking` is the canonical napi-rs pattern for "run sync work off the JS thread, return Promise." The homemade `WorkerHandle` was reinventing tokio.
  - Concurrency-multiplexed: tokio's blocking pool (default 512 threads) handles many `BenchCore` instances and concurrent calls; the homemade design was 1 thread per `BenchCore`.
  - **Rust core stays sync:** `tokio::task::spawn_blocking` boundary is the ONLY async surface; `graphrefly-core` / `graphrefly-operators` / `graphrefly-graph` still run synchronously inside the closure. CLAUDE.md invariant 4 ("no async runtime in Core") preserved.
  - Deadlock-free: JS code `await`s the napi method's Promise → V8 yields to libuv → TSFN delivers → JS callback runs → bridge oneshot delivers → tokio thread continues wave.
  - Re-entrance preserved: producer dispatch in `BindingBoundary::invoke_fn` reads thread-local `CURRENT_CORE` set via RAII `CoreThreadGuard` at the top of every `spawn_blocking` closure. Replaces the old `worker::WORKER_CORE`.
  - Enables future placement of timer-based reactive sources (e.g., `fromTimer`) in `graphrefly-operators` with snapshot-portability across bindings (see user 2026-05-07 design discussion).
- **JsFunction `!Send` workaround:** `JsFunction` is `!Send`, so `async fn` methods that take it as a parameter produce a `!Send` future (Rust async-fn captures parameters into the future state, defeating napi-rs's `Send` requirement on the future). Fix: methods taking `JsFunction` are non-async (`pub fn`) returning `Result<JsObject>` (the Promise), with the async work moved into an `async move {}` block passed to `Env::execute_tokio_future`. The `JsFunction` parameter is consumed synchronously at the top into a `ThreadsafeFunction` (which is `Send`); only the TSFN moves into the async block. Methods without `JsFunction` parameters (e.g., `BenchCore::emit_int`) stay as `async fn`.
- **Auto-applicable QA fixes bundled:** M1 (`Mutex<Registry>` → `parking_lot::Mutex` for non-poisoning); M3 (clear `WORKER_CORE` thread-local properly via RAII); M4 (`register_with_latest_from` keeps `Result<JsObject>` for Promise-typing — factory still infallible internally); M6 (removed dead `_op_binding` captures in flow methods); M7 (deduplicated `build_u32_to_bool_tsfn` ↔ `build_u32_input_tsfn`); M8 (`pause_lock_count` returns `Result<u32>`); M9 (TSFN `max_queue_size = 1`).
- **C2 fix bundled:** Added `BenchCore::intern_int(value: i32) -> u32` and `BenchCore::deref_int(handle: u32) -> i32` (sync; pure Registry ops). Required so JS-side adapter code in operator callbacks can produce/consume HandleIds (`x => intern_int(deref_int(x) + 1)`).
- **C3 fix bundled:** TSFN-wrapped closures (`closure_h_to_h` / `closure_hh_to_h` / `closure_packer`) now `binding.retain_handle(h)` on the JS-returned HandleId before returning to Core. Per D016 + boundary.rs:247-249, Core takes ownership of one fresh retain on each returned handle; the bump pairs Core's eventual `release_handle` so the registry's refcount stays balanced.
- **C4 fix bundled:** `tokio::task::spawn_blocking` natively catches panics in the closure and returns them via `JoinError` — no manual `catch_unwind` needed. The wave-discard discipline lives in Core's `BatchGuard::drop` panic path; the spawn_blocking → `JoinError` → `napi::Error` chain converts the worker panic to a JS exception cleanly.
- **Affects:** Supersedes D062 + D063. `worker.rs` moved to `TRASH/`. New patterns: `core_bindings::run_blocking(core, f)` helper centralizes spawn_blocking + thread-local install; JsFunction-taking methods in `operator_bindings.rs` use `env.execute_tokio_future(async move { ... }, |env, val| env.create_uint32(val))`. `BenchCore` directly holds `core: Core` + `subscriptions: parking_lot::Mutex<Vec<Option<Subscription>>>` (no worker indirection). Documented in M3 napi-rs operator parity session doc.
