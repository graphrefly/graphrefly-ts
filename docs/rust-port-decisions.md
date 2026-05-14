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

### D066 — M3 napi-rs operator parity: `rustImpl` re-exports message-type symbols from `@graphrefly/pure-ts`
- **Date:** 2026-05-07
- **Context:** Parity-tests `Impl` interface includes message-type identifiers (`DATA / RESOLVED / DIRTY / INVALIDATE / PAUSE / RESUME / COMPLETE / ERROR / TEARDOWN`) as `unique symbol`s. `rustImpl` could re-export from `@graphrefly/pure-ts` (shared identity) or define its own.
- **Options:** A) re-export from legacy (shared symbol identity across impls; protocol-level identifiers are not impl-bound); B) define own symbols inside `@graphrefly/native` (each impl carries its own; parity scenarios always access via `impl.<name>` so cross-impl symbol comparison never happens).
- **Decision:** A.
- **Rationale:** Message-type symbols are protocol identifiers — they identify the *concept* (DATA, RESOLVED, etc.), not the impl that emits them. Sharing identity across impls is honest, simpler, and avoids the "two unique symbols for the same protocol concept" weirdness that would surface if any future code accidentally does cross-impl comparison. Cost of B (defensive isolation) outweighs benefit for protocol identifiers that are inherently shared.
- **Affects:** `packages/parity-tests/impls/rust.ts` re-exports `DATA / RESOLVED / DIRTY / INVALIDATE / PAUSE / RESUME / COMPLETE / ERROR / TEARDOWN` from `@graphrefly/pure-ts`; the rustImpl arm only contributes its own `name` + `node` + `Graph` + operator factories. Future `@graphrefly/native` runtime DOES NOT need to define its own message-symbol module.

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
- **Rationale:** Aligns with the canonical handle-protocol cleaving plane (`docs/research/handle_protocol.tla` + audit-input.md): "Core operates on opaque `HandleId`; the binding registry holds `T`." For the napi binding, the *binding* is the JS adapter — so the registry naturally lives JS-side. Widening Rust-side adds JS-Object-lifetime + Send/Sync friction (`napi::Object` is `!Send`); option B keeps `BenchBinding` Send+Sync clean. Symmetric with how the future pyo3 binding will marshal Python objects. Smaller Rust diff (~80 LOC additions vs ~200 LOC if Rust held values). User-direction 2026-05-07 ("can we ... compose node or graph like we do in patterns").
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
- **Rationale:** User direction 2026-05-07 (do all 1,2,3,4 now). Local-platform-only would block PR-time parity validation across non-host machines. Full publish is release-engineering separable from parity-test activation: requires npm tokens, semver cadence, and downstream `@graphrefly/pure-ts` publish coordination. Building artifacts in CI gives `pnpm test:parity` the right shape on every PR without committing to a release cadence. Publish flow lands in a separate slice when 1.0 ship-readiness is in play.
- **Affects:** `.github/workflows/ci.yml` adds a `napi-build` matrix job (linux-x64-gnu, darwin-arm64, darwin-x64, win32-x64-msvc); each job runs `napi build --release --target <triple>` and uploads `.node` artifact; `parity-tests` job downloads host artifact and runs against it. The `package.json` for `@graphrefly/native` declares `optionalDependencies` matching the matrix even though the platform sub-packages aren't published yet (so the publish-shape is right when we flip to publishing).

### D088 — Slice X1+Y+X2+X3 /qa pass: 7 architecture-affecting fixes + 7 auto-applied
- **Date:** 2026-05-08
- **Context:** Adversarial-review QA pass on the 4-slice bundle (X1+Y+X2+X3). Two parallel subagents (Blind Hunter + Edge Case Hunter) returned 34 findings; 7 needed user decision (architecture-affecting), 7 were auto-applicable, rest deferred or rejected. User picked option (a) for all 7 needs-decision items.
- **Options applied (all "(a)"):**
  - **A** Explicit `Drop` impls for `BenchDescribeReactiveHandle` + `BenchObserveReactiveHandle` ship inner-drop to `spawn_blocking` fire-and-forget. Defense-in-depth against forgotten `await dispose()` (alternative: doc-only enforcement; rejected as fragile).
  - **B** vitest `afterEach` awaits `cachedState.core.dispose()` BEFORE nulling. Closes deadlock vector for in-flight TSFN deliveries spilling across tests (alternative: leave as-is; rejected — D080 dispose discipline must apply consistently).
  - **C** Reactive-sink TSFN `MaxQueueSize` bumped from 1 to 8. NonBlocking notification streams shouldn't silently drop on `QueueFull`; sync-bridge TSFNs (operators) keep `MaxQueueSize=1` as before (alternative: coalesce on JS drain; rejected — wider queue is simpler and the streams ARE notification-flavored not sync-flavored).
  - **D + E** (paired) Dropped synchronous `JSON.parse(this.bench.describeJson())` seed in `RustGraph._describeReactive`. JS thread no longer acquires Core's mutex during reactive-describe setup; the first TSFN delivery hydrates `latest` and fires queued subscribers. Resolves both the JS-thread deadlock vector AND the duplicate-snapshot delivery (R3.6.1 "exactly one initial snapshot"). Alternative (b) — making `BenchGraph::describe_json` async — was rejected because it doesn't solve the deadlock alone (`_describeReactive` would still need to await before invoking describeReactive — same latency cost) and changes every other call site.
  - **F** `closure_h_to_h` / `closure_hh_to_h` / `closure_packer` graceful no-op (`else { return h_out; }`) on dangling `Weak<BenchBinding>` (was `.expect()` panic). Mirrors the producer-build factories' `else { return; }` discipline (alternative: keep panic; rejected — production closure paths shouldn't panic across napi boundary on Drop-cascade race).
  - **G** Legacy reactive observe + sink-style observe `dispose()` now tracks installed unsub fns and calls them all on dispose. Honors the contract "unsubscribes everything" (alternative: doc that legacy dispose is a no-op; rejected — contract integrity over divergence).
- **Auto-applied (Group 2):** `decodeMessages` panics on missing-handle; bench file `pickValue` indirection dropped; describe-reactive test fallback removed; F17 setTimeout → poll-with-timeout; `encode_messages` skips `Message::Start`; Send+Sync inner-type asserts; `observeEventToMessage` explicit `case "start"`.
- **Deferred to porting-deferred (4):** `Graph::edges` doubles the walk (perf regression, not correctness); `BenchGraph::derived` registry-then-Core lock-ordering (latent concurrent register-vs-emit deadlock); `WeakCore::upgrade` partial-drop window (theoretical 3-Arc race); F14 `Core::binding_ptr()` accessor (cosmetic, unblocks F14 invariant assert).
- **Affects:** `~/src/graphrefly-rs/crates/graphrefly-bindings-js/src/graph_bindings.rs` (Drop impls + MaxQueueSize + Send+Sync inner asserts + encode_messages Start filter); `~/src/graphrefly-rs/crates/graphrefly-bindings-js/src/operator_bindings.rs` (3 closure-builders graceful no-op); `~/src/graphrefly-ts/packages/parity-tests/impls/rust.ts` (afterEach await dispose + describeReactive deadlock fix + decodeMessages panic-on-missing); `~/src/graphrefly-ts/packages/parity-tests/impls/pure-ts.ts` (observe dispose tracks unsubs + observeEventToMessage explicit start); `~/src/graphrefly-ts/packages/pure-ts/src/__bench__/operators-via-tsfn.bench.ts` (pickValue removed); `~/src/graphrefly-ts/packages/parity-tests/scenarios/graph/describe-reactive.test.ts` (names fallback dropped); `~/src/graphrefly-ts/packages/parity-tests/scenarios/core/release-callback-reinstall.test.ts` (poll-with-timeout); `~/src/graphrefly-rs/docs/migration-status.md` + `~/src/graphrefly-rs/docs/porting-deferred.md` (X1+Y+X2+X3 /qa entries).

### D087 — Slice X3 triage: in-scope F-items vs deferred ones
- **Date:** 2026-05-08
- **Context:** Slice X3 covers the Phase E /qa F10–F17 carry-forward (8 items in `porting-deferred.md`). Triage required to scope the slice properly.
- **Options:** (A) Implement all 8. (B) Defer infrastructure-blocked items (F10 cross-platform CI, F13 CI-runtime verification) and consumer-pressure-blocked items (F15, F16); ship F11 + F14 + F17 + F12 strike-through. (C) Skip the slice entirely.
- **Decision:** B.
- **Rationale:** F10 needs CI matrix widening for Alpine artifacts (out of scope; tracked alongside D075 cross-platform shipping). F13 requires GitHub Actions runners to verify; can't reproduce locally. F15 / F16 lift-points explicitly say "when a parity scenario lands that exercises this distinction" — currently no scenario does. F11 is a one-line vitest hook. F14 is invariant documentation. F17 is a small regression test. Bundling unrelated CI work into a /qa cleanup slice would dilute scope.
- **Affects:** `packages/parity-tests/impls/rust.ts` (afterEach hook); `crates/graphrefly-bindings-js/src/graph_bindings.rs` (BenchGraph field doc); `packages/parity-tests/scenarios/core/release-callback-reinstall.test.ts` (new); `porting-deferred.md` (F11/F12/F14/F17 struck through; F10/F13/F15/F16 entries left in-place with doc reasons).

### D086 — Slice X2 reactive observe scope: canonical unified `observe(path?, opts?)` per spec R3.6.2, not separate `observeAll()`
- **Date:** 2026-05-08
- **Context:** Slice X2 wraps reactive describe + observe surfaces. The `graphrefly-graph` crate exposes `observe(path)`, `observe_all()`, `observe_all_reactive()` as separate Rust methods. The canonical spec R3.6.2 (`docs/implementation-plan-13.6-canonical-spec.md:918`) defines a unified `observe(path?, opts?)` API where `observe()` (no path) is the all-nodes variant and `{ reactive: true }` triggers the reactive Node return. User direction: "I remember it has options to do `reactive` and multiple targets (which means 'all') by defaults in TS. Can you double check..." — confirmed by spec.
- **Options:** (A) Expose `observeAll()` as a separate abstract method on `Impl.Graph` to mirror the rust-side method-naming. (B) Use canonical unified `observe(path?, opts?)` and have the JS adapter dispatch into the right rust method based on args. (C) Skip the abstract-side widening; only test `observe_all_reactive` directly.
- **Decision:** B.
- **Rationale:** Spec R3.6.2 is unambiguous — unified `observe(path?, opts?)` is the canonical contract; `observe_all` is a Rust-side naming convenience, not a separate spec method. Diverging the abstract surface from the spec for binding-naming convenience would propagate the divergence through every parity test. (C) hides the abstract surface, which is exactly what `Impl.Graph` is for. The adapter dispatch is straightforward.
- **Affects:** `packages/parity-tests/impls/types.ts` widens `Impl.Graph.observe(path?, opts?)` + `describe(opts?)` per spec; `legacy.ts` and `rust.ts` adapters dispatch internally. New `BenchGraph::observe_subscribe(path: Option<String>, sink)` napi method covers both no-path-and-with-path sink-style cases via the optional arg. Auto-subscribe-late (rust-side `observe_all_reactive`'s feature) is a Rust-port-only enhancement per existing porting-deferred entry; the parity test for that capability is gated `test.runIf(impl.name === "rust-via-napi")` with backport-track note.

### D085 — Slice Y rewriting parity tests, not gating: surfaces additional cross-graph edges() bug
- **Date:** 2026-05-08
- **Context:** Initial pass on the F9 carry-forward (4 parity-test sites using `g.derived(name, deps, fn)` with arbitrary JS fn) used `test.runIf(impl.name !== "rust-via-napi")` to make the tests pass. User pushback: "wth, is that how you make tests pass?" — correctly flagged that as the gate-tests-to-make-them-green anti-pattern. The right fix is either (a) rewrite the tests using documented workaround `g.add(name, await impl.map/combine(...))` so they exercise the same observable behavior on both arms, or (b) implement the missing feature properly.
- **Options:** (A) Test gating only, with proper documentation linking to porting-deferred. (B) Rewrite the 4 tests to use the documented workaround; if they fail, find the underlying bug. (C) Implement `RustGraph.derived` with arbitrary JS fn (D074 deferred work).
- **Decision:** B.
- **Rationale:** Gating is the worst option — it hides bugs and pretends the rust impl is more complete than it is. Documented workarounds for `g.derived` arbitrary JS fn already exist (D074 carry-forward); using them in tests is the proper translation. (C) would expand the slice scope to a full feature implementation. (B) is the right middle ground. Surface bonus: the rewrite UNCOVERED an additional rust impl bug (`graphrefly_graph::Graph::edges_inner` per-level `names_map` didn't propagate across mount tree, so cross-graph deps from `child::z` to root `x` resolved to `sub::_anon_<id>` instead of `x`). Fixed in same slice via new `collect_qualified_names` helper that pre-computes a global names_map. The gating-only approach would have hidden this bug indefinitely.
- **Affects:** `packages/parity-tests/scenarios/graph/edges.test.ts` (3 tests rewritten via `impl.combine` + `g.add`); `packages/parity-tests/scenarios/graph/sugar.test.ts` (1 test rewritten via `impl.map` + `g.add`); `crates/graphrefly-graph/src/graph.rs` (new `collect_qualified_names` + `edges_inner` signature change to take `&names_map`); `porting-deferred.md` F9 entry updated; **122 parity tests passing, 0 failed** (was 118 with gating).

### D084 — Slice Y bundling: TSFN err-first fix + closure-builder cycle audit folded into Slice Y, not deferred
- **Date:** 2026-05-08
- **Context:** Slice X1 surfaced the TSFN err-first wire-vs-typed mismatch (D079, deferred). User's harness/multi-agent use case question prompted a broader cycle audit, which surfaced 3 additional binding-side closure-builder cycle vectors beyond the originally-scoped 7 producer-build sites. User direction: "Fix this in this batch because otherwise parity tests are broken. Do the ultimate fix."
- **Options:** (A) Defer both the broader cycle audit and the TSFN fix to follow-on slices per the original Slice Y scope. (B) Bundle the cycle audit (3 closure builders × 7 call sites) but defer the TSFN fix to a follow-on slice. (C) Bundle BOTH the cycle audit AND the TSFN fix into Slice Y; activate the rustImpl parity arm and validate end-to-end.
- **Decision:** C.
- **Rationale:** User direction explicit. Both fixes share the same theme (Rust-side structural-correctness for the rustImpl parity arm). The TSFN bug silently broke the parity arm — fixing it without the cycle audit would activate a broken substrate; fixing the cycle audit without the TSFN fix would leave the parity arm in a state where it can't be safely activated. Bundled, they jointly unblock rustImpl activation, which is a real Phase-E commitment that gates Phase-13.9 parity test gating in CI. Slice Y was already in flight on the same correctness theme, so the bundling has natural cohesion.
- **Affects:**
  - `crates/graphrefly-bindings-js/src/operator_bindings.rs` — 3 closure builders take `Weak<BenchBinding>` instead of `Arc<BenchBinding>`; 7 call sites flipped from `Arc::clone(&self.binding)` to `Arc::downgrade(&self.binding)`. `Tsfn` type alias's `CalleeHandled` flipped to `false`. 5 `build_*_tsfn` helpers' `.callee_handled::<true>()` flipped to `<false>()`. `bridge_sync` updated to `call_with_return_value(arg, ...)` (plain T, not `Ok(arg)`).
  - `crates/graphrefly-bindings-js/src/core_bindings.rs` — `SinkTsfn` + `ReleaseTsfn` type aliases' `CalleeHandled` flipped to `false`. `build_sink_tsfn` + `set_release_callback` builders' `.callee_handled::<true>()` flipped to `<false>()`. `bridge_sync_unit` + `release_callback` non-blocking call site updated to plain `T` arg shape.
  - `packages/parity-tests/scenarios/graph/edges.test.ts` (3 sites) + `sugar.test.ts` (1 site) — `test.runIf(impl.name !== "rust-via-napi")` gating per F9 carry-forward.
  - **rustImpl parity arm activated** — first time `pnpm --filter @graphrefly/native build` produces `graphrefly-native.darwin-arm64.node`; parity-tests now run against both arms (118 passed, 0 failed, 16 skipped, 4 todo).

### D083 — Slice Y cycle-audit expansion: closure-builder sites (Weak<BenchBinding>)
- **Date:** 2026-05-08
- **Context:** Slice Y's original scope was 7 producer-build closure sites (4 in `ops_impl.rs` + 3 in `higher_order.rs`). User's question — "How would you suggest to address the cycle path issue since we are targeting long running harness, multi-agent worktrees, repeated graph rebuilds?" — prompted a broader audit of binding-side closure registries. Found 3 additional cycle builders in `operator_bindings.rs` that store closures long-term in `binding.registry.{projectors|folders|packers}`: `closure_h_to_h` (used by `register_map`), `closure_hh_to_h` (scan/reduce/pairwise/distinctUntilChangedWith), `closure_packer` (combine/withLatestFrom/zip). Same self-referential cycle shape as producer-builds.
- **Options:** (A) Original scope only — fix 7 producer-build sites; flag the 3 closure-builder sites as a follow-up. (B) Expanded scope — fix all 7 + 3 closure-builder sites in Slice Y, given the cycle shape is identical and the harness use case bears the cost of any remaining cycle. (C) Restructure `BenchBinding` to break cycles at the data-structure level (e.g., move closure registries out of binding entirely).
- **Decision:** B.
- **Rationale:** Cycle shape is identical; fix pattern is identical (downgrade strong → weak, upgrade-on-fire). Splitting across two slices doubles review effort and risks shipping an inconsistent pattern (some closure builders weak-Arc'd, others not). Long-running harness use case is the user's stated target — every per-instance leak compounds across thousands of BenchCore instances over a process lifetime; halfway-fix wouldn't meet the bar. (C) is over-engineering: BenchBinding's closure registries are the natural home for closures; restructuring them to break cycles would invalidate the existing `OperatorBinding` / `ProducerBinding` / `HigherOrderBinding` trait API and cascade through `graphrefly-operators`.
- **Affects:** `crates/graphrefly-bindings-js/src/operator_bindings.rs` closure builders + 7 call sites; documented in `porting-deferred.md` "Closure-builder Arc-cycle" entry. Test fixture `OpRuntime::make_packer` had the same pattern; fixed via `Weak<InnerBinding>` for consistency.

### D082 — Slice Y discovery: D1 (set_deps reentrance) was already resolved in Slice F (A6)
- **Date:** 2026-05-08
- **Context:** Slice Y entered with three planned lifts: D1 set_deps reentrance, BenchCore Drop deadlock, Arc-cycle. On reading the code (`crates/graphrefly-core/src/node.rs:3529`, `crates/graphrefly-core/src/batch.rs:99`, `crates/graphrefly-core/tests/slice_f_corrections.rs:146`), discovered D1 was actually fixed in Slice F A6 (2026-05-07) via thread-local `currently_firing: Vec<NodeId>` stack + `FiringGuard` RAII — `set_deps(N, ...)` from inside N's own fn now returns `SetDepsError::ReentrantOnFiringNode`. The porting-deferred entry was stale (written at Slice A close before A6 landed).
- **Options:** (A) Re-implement (waste). (B) Skip implementation, just strike through the porting-deferred entry, document the historical confusion. (C) Add additional regression tests beyond what `slice_f_corrections.rs` already covers.
- **Decision:** B.
- **Rationale:** Existing fix + test (`a6_set_deps_from_firing_fn_rejected_with_reentrant_error`) is correct and complete. Re-implementation is busywork. Adding more tests beyond what's there is YAGNI. Striking the entry preserves the historical record (entry kept under "Original D1 entry (kept for archive)" subhead).
- **Affects:** `~/src/graphrefly-rs/docs/porting-deferred.md` "Set_deps from inside firing node's fn corrupts Dynamic `tracked` indices" entry struck through; pointer to Slice F's A6 fix added.

### D087 — Slice X5 D3 substrate-only scope: ship union-find registry; Y1 wave-engine migration + Y2 verification carry forward
- **Date:** 2026-05-08 (same-day follow-up after D086 D3 design lock)
- **Context:** User locked D3 design (Option B + Q1=union-find split-eager + Q2/Q3/Q4/Q7=(a) + Q5/Q6/Q8 scope items per D085+D086) and directed "all in one batch" with phased commits internally. Pre-implementation scope assessment surfaced that Y1 (wave engine migration to per-partition `wave_owner`) is fundamentally invasive — every `begin_batch()` / `run_wave()` call site (~80 across `node.rs` + `batch.rs`) + `Core::subscribe`'s `wave_owner.lock_arc()` + `BatchGuard` lock retention + retry-validate semantics for held-Arc-vs-current-root divergence on union — and would risk a long stretch where nothing compiles + tests don't run + parity tests fail. The user-picked Q1 split-eager design adds reachability-walk + state-migration on edge removal on top of the wave-engine refactor, compounding the scope.
- **Options:** (1) Big-bang one-shot full Y1+Y2 in this session — risk of half-broken wave engine + 469→0 cargo tests passing during the migration window. (2) X5 substrate ships now (union-find registry + per-partition `wave_owner` allocated but not yet authoritative + monotonic-merge stepping stone), Y1 (wave engine migration + split-eager + mid-wave reentrancy guard) carries forward to a dedicated batch, Y2 (TLA+ + bench + CLAUDE.md invariant 3 lift) carries forward.
- **Decision:** (2) — X5 substrate-only with Y1/Y2 carry-forward.
- **Rationale:**
  - **Tests-green invariant.** X5 ships with 490 cargo + 142 parity tests passing. The 17-test delta is purely additive (10 subgraph unit tests + 7 integration tests). Y1's wave-engine migration is the hard part — committing to it incrementally requires a rewrite of every state-touching code path before any test runs again, which is multi-day work that doesn't fit one batch even with phased commits.
  - **Substrate utility independent of Y1.** Public `Core::partition_count()` + `Core::partition_of(node)` accessors are useful for downstream debugging + the future bench harness even before the wave engine activates the parallelism. The substrate also locks the registry semantics (union-on-add-edge, monotonic on edge removal — Y1 changes this to split-eager) so Y1 has a stable foundation.
  - **Honest scope surfacing.** Per `feedback_no_autonomous_decisions.md`, the cleaner move is to surface the realistic delivery vs the user's "all in one batch" framing, ship the meaningful intermediate state, and explicitly mark Y1/Y2 as carry-forward — rather than silently struggle in a half-broken wave engine state for hours and hand back a broken tree.
  - **D3's user-facing pain (cross-thread emit blocking) is NOT resolved by X5 alone.** This is documented honestly in the X5 closing entry + porting-deferred D3 entry. Y1's wave engine migration is what lands the parallelism win.
- **Affects:**
  - `crates/graphrefly-core/src/subgraph.rs` (new — 370 LOC).
  - `crates/graphrefly-core/src/lib.rs` adds `pub mod subgraph` + `pub use subgraph::SubgraphId`.
  - `crates/graphrefly-core/src/node.rs` — `Core` struct gains `registry: Arc<parking_lot::Mutex<SubgraphRegistry>>` field; `WeakCore` mirrors the `Weak` of it; `Core::new` initializes; `Core::weak_handle` downgrades; new `Core::partition_count()` + `Core::partition_of(node)` public accessors; `Core::register` calls `ensure_registered + union_nodes` after `s.nodes.insert`; `Core::set_deps` calls `union_nodes` for added edges + `on_edge_removed` for removed edges (latter no-op in X5 monotonic-merge).
  - `crates/graphrefly-core/tests/subgraph_registry.rs` (new — 7 integration tests).
  - `~/src/graphrefly-rs/docs/porting-deferred.md` D3 entry — design LOCKED + X5 LANDED + Y1/Y2 carry-forward sub-bullets.
  - `~/src/graphrefly-rs/docs/migration-status.md` — Slice X5 closing entry at top + scope-honesty note.
  - Slice Y1 entry checklist (when filed): wave-engine migration + split-eager + mid-wave reentrancy guard + parity-test widening.
  - Slice Y2 entry checklist (when filed): TLA+ extension + parallel-emit bench + CLAUDE.md invariant 3 wording lift.

### D086 — Slice X4 D3 design lock: union-find connectivity-based + split-eager (mirrors graphrefly-py + adds split)
- **Date:** 2026-05-08 (same-day follow-up after D085 design-doc filing)
- **Context:** D085 split D3 into a design session doc with Option B recommended at the top level. The Q1 walk in the doc proposed three sub-options: (a) mount-aligned partition tagged at registration, (b) user-tagged via opts, (c) auto-detect from connected components. User pushed back on (a) — registration-based tagging puts a node in its registering Graph's partition regardless of what it's connected to, so cross-mount dep edges produce frequent cross-partition cascades that defeat the parallelism premise. User surfaced graphrefly-py precedent: [`src/graphrefly/core/subgraph_locks.py`](file:///Users/davidchenallio/src/graphrefly-py/src/graphrefly/core/subgraph_locks.py) implements union-find with `_LockBox` indirection + `weakref.ref(node, finalizer)` for auto-cleanup. The "WeakMap" in prior recall = py weakref registry; Rust equivalent = `Drop for NodeRecord` firing the cleanup.
- **Options:** (1) (a-mount) registration-based mount-aligned partitioning; (2) (c-uf monotonic-merge) union-find connectivity-based, py-style monotonic merge (no split on edge removal); (3) (c-uf split-eager) union-find connectivity-based, with split-eager reachability walk on edge removal; (4) (c-uf split-lazy) union-find with split deferred to wave-entry / size-threshold trigger.
- **Decision:** (3) — union-find + split-eager.
- **Rationale:**
  - **Vs (1) mount-aligned:** typical mount patterns import parent values; child nodes registered through child Graph would be tagged child-partition but transitively depend on parent-partition nodes. Every emit cascade across mount boundaries crosses partitions → constant cross-partition lock traffic → defeats parallelism. Connectivity-based grouping aligns with what's actually reachable.
  - **Vs (2) monotonic-merge (py choice):** graphrefly-py operates under GIL/free-threaded constraints where parallelism is intrinsically limited; partition bloat under churn was acceptable. Rust port's primary motivation IS parallelism, so the trade-off doesn't transfer. Long-running multi-agent / dynamic-rewire workloads (Wave 2 narrative target) churn `set_deps` regularly; without split, partitions monotonically consolidate → parallelism collapses asymptotically in exactly the workload class that motivates D3.
  - **Vs (4) split-lazy:** lazy splitting amortizes the walk cost but adds wave-entry complexity (must check + run reachability if marked) and leaves stale connectivity in the gap between mark + reachability run. Split-eager is simpler; the walk cost is bounded by partition size, which the parallelism design itself keeps small. If the eager walk surfaces as a real cost, lazy is a future amortization; not worth the upfront complexity.
- **Implementation shape:** `SubgraphRegistry` with union-find `parent` / `rank` / `children` maps + `Arc<SubgraphLockBox>` per root. `union_nodes(a, b)` on every new dep edge (`Core::register` + `Core::set_deps` adding edges). Edge-removal triggers reachability BFS/DFS within the partition; if disconnected, allocate fresh `SubgraphId` for the smaller half + migrate `SubgraphState` (nodes, pending_notify, tier3_emitted_this_wave, etc.). `Drop for NodeRecord` fires registry cleanup + re-rooting (mirrors py `_on_gc`). Lock-acquisition via `lock_for(node)` retry loop validating root hasn't shifted under concurrent union (mirrors py `MAX_LOCK_RETRIES`). Mid-wave union/split rejected via extending the existing `currently_firing` thread-local from Slice F A6 D1 reentrancy guard.
- **Q-lock outcomes:** Q1=(c-uf split-eager); Q2=(a) cross-partition shared state; Q3=(a-strict) reject mid-wave `set_deps` triggering migration; Q4=(a) per-partition `wave_owner`; Q7=(a) cross-partition batches acquire upfront; Q5/Q6/Q8 scope items locked. D3 design fully locked; X5/Y1 implementation unblocked.
- **Affects:** [`archive/docs/SESSION-rust-port-d3-per-subgraph-parallelism.md`](archive/docs/SESSION-rust-port-d3-per-subgraph-parallelism.md) — full doc rewrite from "open" to "LOCKED 2026-05-08"; `~/src/graphrefly-rs/docs/porting-deferred.md` D3 entry — design lock note + reference to py impl as port template; cost estimate revised from 3000 to ~3500 LOC (union-find bookkeeping + split-walk + mid-wave reentrancy wiring + lock-validation retry loop above the static-partition baseline).

### D085 — Slice X4 D3 design: split into design session doc + impl batch; Option B recommended (per-subgraph state partition)
- **Date:** 2026-05-08
- **Context:** Slice X4 was originally scoped to D2 (late-subscriber + multi-emit-per-wave gap) + D4 (handshake-panic, already resolved by Slice F A7) doc cleanup. User direction expanded scope to "include D3" — the cross-thread emit blocks on `wave_owner` mutex limitation. D3's lift = per-subgraph mutex granularity per CLAUDE.md Rust invariant 3 ("planned"), but the architectural choice was non-obvious: A) per-mounted-Graph multiple Cores, B) single Core with per-subgraph state partition, C) single Core with per-node Mutex. Each is substantial (~2500–3500 LOC + TLA+ extension + loom tests).
- **Options:** (1) One-shot: implement chosen option alongside D2 in this batch (~3000–5000 LOC slice; design issues surface during impl). (2) Split: D2 + D4 + D3 design session doc this batch; D3 impl in a follow-on batch after design lock.
- **Decision:** Split (option 2). Design doc recommends Option B (per-subgraph state partition).
- **Rationale:** D3 is large enough to warrant its own design pass. Per `feedback_no_autonomous_decisions.md`, an architectural pick this large should be the user's call, not silently chosen. Option B recommended because: (a) parity with graphrefly-py per-subgraph RLock pattern; (b) public API stays unchanged (partition wiring is internal CoreState reshape); (c) parallelism kicks in via the natural composition pattern (mount); (d) lock-ordering is mechanical (sort SubgraphIds before acquiring) vs Option A's new cross-Core protocol with no TLA+ ancestor.
- **Affects:** `archive/docs/SESSION-rust-port-d3-per-subgraph-parallelism.md` (new) lays out Q1–Q8 follow-up walk; `~/src/graphrefly-rs/docs/porting-deferred.md` D3 entry stays open with pointer to session doc; Slice X5/Y1 batch is gated on user picking A/B/C and locking Q1–Q8.

### D084 — Slice X4 D2 fix shape: revision-tracked `PendingBatch`es (re-snapshot per push, common-case-cheap)
- **Date:** 2026-05-08
- **Context:** D2 documents the late-subscriber + multi-emit-per-wave gap: pre-X4 `PendingPerNode` snapshot froze on first `queue_notify` per node per wave. A subscriber installed between two emits to the same node is invisible to the second emit's flush — only the handshake's cache replay reaches them. Three candidate fixes documented in `porting-deferred.md`: (a) re-snapshot every push (correct, O(emits × subscribers) memory), (b) walk pending_notify on subscribe and append new sink (re-introduces the original duplicate-Data hazard for single-emit + late-subscribe — the snapshot fix's original target), (c) per-message subscriber tracking (heaviest, no win over (a)).
- **Options:** (A) Naive re-snapshot per push — always allocate. (B) Revision-tracked `PendingBatch`es — `NodeRecord::subscribers_revision: u64` bumps on every `subscribers` mutation; `queue_notify` consults the revision and either appends to the open batch (same revision, no extra allocation) or opens a fresh batch with a new sink snapshot. (C) Per-message tracking.
- **Decision:** B.
- **Rationale:** Option B reduces (A)'s `O(emits × subscribers)` allocation cost to `O(subscriber-change-events × subscribers)` — in practice 1 batch per wave per node (no subscribes during a wave). The pathological multi-emit-with-mid-wave-subscribe case pays the real cost; common case is allocation-free. Option C's heavier machinery doesn't buy more than B over realistic graph topologies. `subscribers_revision` is per-node, not per-Core, so a subscribe to node A doesn't invalidate snapshot reuse for node B's pending batch. `PendingPerNode` becomes `SmallVec<[PendingBatch; 1]>` keeping common-case inline storage. `flush_notifications` iterates batches in arrival order within each phase × node loop.
- **Affects:** `crates/graphrefly-core/src/node.rs` adds `subscribers_revision: u64` to `NodeRecord` + bump at three mutation sites (subscribe install, `Subscription::Drop`, handshake-panic eviction); `crates/graphrefly-core/src/batch.rs` reshapes `PendingPerNode` + new `PendingBatch` struct + `iter_messages` / `iter_messages_mut` helpers + extracts `push_into_pending_notify` helper from `queue_notify`; `crates/graphrefly-core/tests/sink_snapshot.rs` (4 tests); `packages/parity-tests/scenarios/core/sink-snapshot.test.ts` (1 test × 2 impls — common-case no-regression). Closes D2.

### D083 — Slice X4 parity-tests scope: D2 cross-impl widening limited to no-regression case (canonical case is cargo-only)
- **Date:** 2026-05-08
- **Context:** Slice X4 widens `packages/parity-tests/scenarios/core/` for D2. The canonical D2 case (multi-emit + late-subscribe in one wave) is structurally Rust-only — pure-TS dispatcher snapshots subscribers AT DELIVERY TIME PER EMIT (synchronous per-emit dispatch), not per-wave at flush time, so the late-subscriber gap is unreachable in pure-TS. Reaching it requires expressing `emit + subscribe + emit` inside a single Core wave, which the current `Impl` interface does not expose.
- **Options:** (A) Add `Impl.batch(closure)` to widen the public API surface. Pure-TS wraps `batch(() => fn())`. Rust impl is fundamentally hard — `core.batch(|| {...})` is sync; JS closures can't naturally span the `parking_lot::ReentrantMutex` thread-affinity contract that `BatchGuard` holds across napi `spawn_blocking` calls. (B) Add a Rust-port-only test that uses `@graphrefly/native` `BenchCore` directly + a new `begin_batch_external` napi method. Substantial new napi surface area for one test. (C) Limit cross-impl coverage to the no-regression case (multi-emit, stable subscriber set — testable across both impls); document the canonical D2 case as cargo-regression-only.
- **Decision:** C.
- **Rationale:** (A) requires a public-API decision (`Impl.batch`) that's load-bearing across the parity-test layer; the rust-side implementation challenge alone justifies a separate design slice. (B) introduces test-fixture napi for one scenario — disproportionate for the value. (C) honors the user's "widen" directive lightly: a real cross-impl scenario file lands (`scenarios/core/sink-snapshot.test.ts`), the Rust-only canonical case is documented as cargo-only with a clear rationale, and the door stays open for option (A) when `Impl.batch` is justified by other use cases.
- **Affects:** `packages/parity-tests/scenarios/core/sink-snapshot.test.ts` (new — 1 cross-impl test); doc note in the test file's docstring + Slice X4 closing entry in `migration-status.md` explaining the cargo-only coverage of the canonical case.

### D081 — Slice Y Arc-cycle fix: weak-Arc producer-build closures (`Core::weak_handle()` API)
- **Date:** 2026-05-08
- **Context:** Producer-build closures (`zip`/`concat`/`race`/`take_until` in `ops_impl.rs`; `switch_map`/`exhaust_map`/`merge_map` in `higher_order.rs`) captured strong `Arc<dyn ProducerBinding>` (and `Arc<dyn HigherOrderBinding>` for higher-order). The closures live long-term in `binding.registry.producer_builds`, creating cycle: BenchBinding → registry → producer_builds[fn_id] → closure → strong Arc<dyn _Binding> → BenchBinding. Per-instance leak; bounded but real for harness use cases that construct many BenchCore instances over a long-running process. Originally documented as "v2 may switch to Weak<Core> upgrade-on-fire (requires Core::weak_handle() accessor)" in `producer.rs:31` doc.
- **Options:** (A) Add `Core::weak_handle() -> WeakCore` API; weakify all 7 sites; closures upgrade-on-build, sub-closures capture upgraded strong (short-lived per producer activation). (B) Restructure Core's `binding` field to `Weak<dyn BindingBoundary>` and upgrade-per-call internally — broader change, ripples through every Core internal site. (C) Add explicit `BenchCore::shutdown` that drains `registry.producer_builds` (mirrors test `OpRuntime::Drop`) — works around the cycle but doesn't structurally break it; user must remember to call.
- **Decision:** A.
- **Rationale:** Structural fix (cycle gone by construction, no shutdown discipline required). Matches the documented v2 plan. Sub-closure short-lived strong refs are safe because their lifetime is tied to producer activation — `producer_deactivate` lifecycle clears them. Pattern matches existing precedent: `Subscription` already uses `Weak<Mutex<CoreState>>`. Audit found 7 sites total (4 in `ops_impl.rs` + 3 in `higher_order.rs`); all uniformly applied. Test fixture `make_packer` had parallel pattern (test-only; production `closure_packer` captures TSFN, not binding) — fixed in same slice for consistency.
- **Affects:** `crates/graphrefly-core/src/node.rs` adds `pub struct WeakCore { ... }` + `Core::weak_handle()` + `WeakCore::upgrade()`; `crates/graphrefly-core/src/lib.rs` exports `WeakCore`; `crates/graphrefly-operators/src/ops_impl.rs` weakifies 4 factories; `crates/graphrefly-operators/src/higher_order.rs` weakifies 3 factories; `crates/graphrefly-operators/src/producer.rs` doc rewritten ("Reference-cycle note (v1 limitation)" → "Reference-cycle discipline (Slice Y, 2026-05-08)"); `crates/graphrefly-operators/tests/common/mod.rs` `make_packer` weakified; new `crates/graphrefly-operators/tests/arc_cycle_break.rs` with 8 regression tests.

### D080 — Slice Y BenchCore::Drop deadlock fix: explicit dispose() vs Subscription::try_lock
- **Date:** 2026-05-08
- **Context:** `BenchCore::Drop` runs on JS thread when napi GC fires. `subscriptions: Vec<Option<Subscription>>` drops; each `Subscription::Drop` blocks on Core's mutex. If a tokio blocking-pool thread is mid-wave (parked in TSFN bridge waiting for libuv to pump JS-callback result), JS thread blocks → libuv stalls → tokio thread blocks forever.
- **Options:** (A) `BenchCore::dispose() -> Promise<void>` async napi method that ships subscriptions Vec to a tokio blocking thread for drop; JS code MUST `await dispose()` before letting BenchCore drop. (B) Refactor `Subscription::Drop` to `try_lock` instead of `lock` — leaves subscriber registered if mutex is contended; Subscription's responsibility shifts from "definitely cleaned up" to "best effort." (C) Both — dispose for happy path, try_lock as belt-and-suspenders.
- **Decision:** A.
- **Rationale:** Subscription::Drop's "definitely cleans up activation refcount" contract is load-bearing — try_lock would silently leak activation refs in contention scenarios, breaking the parity-tests' refcount assertions. Explicit dispose preserves the contract while routing the work to a thread that's allowed to block. Matches the precedent of `unsubscribe(idx)` (already async-spawn_blocking) — same shape, just bulk. Idempotent (no-op once vec is drained). JS adapter rewiring (rust.ts `g.destroy()` chains to `dispose()`) deferred to follow-on slice — Rust-side method is in place.
- **Affects:** `crates/graphrefly-bindings-js/src/core_bindings.rs` adds `pub async fn dispose(&self) -> Result<()>` after `unsubscribe`; `crates/graphrefly-bindings-js/index.d.ts` declares `dispose(): Promise<void>` on BenchCore; `porting-deferred.md` "v1 limitation: BenchCore::Drop can deadlock" entry struck through.

### D079 — Slice X1 finding: TSFN err-first wire-vs-typed mismatch — work around in bench, fix in next slice
- **Date:** 2026-05-08
- **Context:** Phase D bench harness landing (Slice X1) probed the JS-side wire signature of `Function<u32, u32>`-typed napi callbacks. Empirically: `callee_handled::<true>()` makes JS receive `(err, value)` Node-style — even though the typed Function declares the logical signature as `(u32) -> u32`. Verified via `console.error('args=', JSON.stringify(args))` debug → `args=[null,1]` on every fire. Existing `parity-tests/impls/rust.ts` `makeProjector(state, fn)` does `(h) => registry.get(h); ...` — so `h=null` → `registry.get(null)=undefined` → user fn runs against undefined → silently broken. No parity test caught it because the rustImpl arm hasn't activated yet (binding wasn't built).
- **Options:** (A) Fix in Slice X1 — change every `build_*_tsfn` site in `operator_bindings.rs` + `core_bindings.rs` to `callee_handled::<false>()`, adjust result-handler shape, verify rustImpl parity. ~50–80 LOC + revisits D065 JS-throw isolation. Slice X1 expands. (B) Defer fix to next slice; bench works around it via `pickValue(args) = args[1] ?? args[0]` defensive arg picker. Slice X1 stays narrow on the bench scope. (C) Hybrid — fix it in Slice Y (v1 limitations) since the err-first signature IS a real v1 limitation that user code currently can't exercise correctly.
- **Decision:** B + queue for next slice via `porting-deferred.md`. Bench's `pickValue` accepts both wire shapes so the bench survives the fix without rewriting.
- **Rationale:** Slice X1's locked scope is the bench harness. Bundling the binding fix expands scope into a different correctness domain (parity-test value-chain), risks scope creep into D065 territory, and would block the bench landing. The bench is a Phase D commitment that pre-dates this finding. Defer is correct. Slice Y or X3 picks it up.
- **Affects:** `~/src/graphrefly-rs/docs/porting-deferred.md` "TSFN err-first wire-vs-typed signature mismatch" entry; `operators-via-tsfn.bench.ts` defensive `pickValue` pattern.

### D078 — Phase D bench harness placement: JS-side vitest, not Rust-side criterion
- **Date:** 2026-05-08
- **Context:** Phase D's lift point in `porting-deferred.md` offered two options: "new `crates/graphrefly-bindings-js/benches/operators_via_tsfn.rs` (or JS-side `~/src/graphrefly-ts/bench/operators-via-tsfn.bench.ts` using vitest's bench mode)."
- **Options:** (A) Rust-side criterion bench under `crates/graphrefly-bindings-js/benches/`. (B) JS-side vitest bench under `pure-ts/src/__bench__/`. (C) Both.
- **Decision:** B.
- **Rationale:** TSFN cost is fundamentally a JS-thread phenomenon (V8 → libuv → tokio → libuv → V8). Measuring from Rust would skip the libuv hop and underreport. JS-side vitest matches the user-facing experience (calling napi methods from JS) AND sits next to the existing `ffi-cost.bench.ts` baseline — same harness, same comparison shape. Existing bench infrastructure in `pure-ts/src/__bench__/` (memory.bench, graphrefly.bench, cross-worker.bench) provides the pattern (top-level await for setup, await emit for end-to-end). (A) would also require setting up criterion dep in the bindings-js cdylib crate + special bench target config. (C) doubles maintenance for no insight gain.
- **Affects:** `~/src/graphrefly-ts/packages/pure-ts/src/__bench__/operators-via-tsfn.bench.ts` (new); `migration-status.md` Slice X1 close section; `porting-deferred.md` "Phase D" entry struck through.

### D077 — Phase E rustImpl activation: parity-test scenarios migrate to async; `Impl` interface widened to Promise-returning
- **Date:** 2026-05-07
- **Context:** Parity scenarios are written sync (`test("...", () => { ... })` with synchronous `expect`s after `subscribe` / `down`). Legacy impl runs single-threaded so handshakes fire inline. Rust binding (per D070) is async-only — every Core-touching method goes through `napi::tokio_runtime::spawn_blocking` returning a Promise. Sink TSFN delivery requires JS thread to pump libuv (i.e., be `await`ing) — sync test shape would deadlock. Three options surfaced: (A) async-everywhere parity tests, (B) sync-Core napi class for parity-tests only, (C) operator-only `rustImpl` activation that skips sink-touching scenarios.
- **Options:** (A) Convert all ~30 parity scenario files to `async` tests with sprinkled `await`s; widen `Impl` interface to Promise-returning shape; wrap `pureTsImpl` methods in `Promise.resolve()`. (B) Add a sync-Core napi class that runs Core directly on JS thread without `spawn_blocking` (operator callbacks via direct `Function::call`). (C) Activate `rustImpl` only for scenarios that don't touch sinks/callbacks; leave most scenarios legacy-only.
- **Decision:** A.
- **Rationale:** (B) blocked by `Function<>` `!Send` constraint — closures stored in `Arc<BenchBinding>` registry must be `Send + Sync`, which `Function<>` isn't. Routing around requires non-cleaving-plane shims (thread-local Function refs, `unsafe impl Send`, etc.) that violate CLAUDE.md Rust invariant 1. (C) defeats the purpose — rustImpl validates the "drop-in replacement" claim only when ALL parity scenarios run against both arms. (A) is mechanical (sprinkle `await`) and produces an `Impl` interface that's honest about the cross-impl contract: any napi-bound impl will need async, so async is the right shape. The Promise.resolve overhead on legacy is negligible for parity tests (microseconds per call, not hot path).
- **Affects:** `packages/parity-tests/impls/types.ts` widens to async-returning method signatures (e.g., `node: (deps: Node[], opts: Opts) => Promise<Node>`); `packages/parity-tests/impls/pure-ts.ts` wraps every method in `async (...args) => legacy.method(...args)` (mechanical); `packages/parity-tests/impls/rust.ts` exposes the napi async methods directly via the JS adapter; ~30 test files under `scenarios/{core,graph,operators}/` convert each `test(...)` to `test(..., async () => { ... })` with `await` on every `impl.*` call. **Sink semantics:** `subscribe(cb): Promise<UnsubFn>` resolves AFTER the handshake's sink-fire completes (per `bridge_sync_unit` discipline — tokio thread blocks on a sync_channel until JS sink callback returns); `down(msgs): Promise<void>` resolves AFTER the wave drains AND all sinks have fired. So `await impl.subscribe(...)` followed by sync `expect(seen)...` is correct.

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

### D089 — Slice Y1+Y2: all-in-one D3 closure (single-slice option)
- **Date:** 2026-05-08
- **Context:** X5 closed today landing the union-find substrate; Y1 (wave-engine migration) + Y2 (TLA+ extension + bench + CLAUDE.md edit) are explicit carry-forward. Three slicing options were on the table: (1) four sub-slices (Y1a entry-conditions / Y1b wave engine / Y1c split-eager / Y2 verification), (2) two slices (Y1a + bundled Y1-main + Y2), (3) all-in-one Y1+Y2 single closure of D3.
- **Decision:** Option 3 — single all-in-one Y1+Y2 batch.
- **Rationale:** User direction. One closure event for D3; all five `#[allow(dead_code)]` activations + split-eager + cross-partition acquisition + TLA + bench + CLAUDE.md edit ship in one slice. Trade-offs accepted: ~3650 LOC churn + larger review surface in exchange for no partial-state windows and a cleaner archive-able session-doc lock-to-close arc.
- **Affects:** Slice Y1+Y2 — all of `crates/graphrefly-core/src/{node.rs,batch.rs,subgraph.rs}` plus new `tests/per_subgraph_parallelism.rs`, criterion bench, TLA+ MC, CLAUDE.md, migration-status.md, porting-deferred.md, SESSION-rust-port-d3-per-subgraph-parallelism.md status update.

### D090 — Slice Y1+Y2 P12 fix: move registry mutation back inside state-lock scope
- **Date:** 2026-05-08
- **Context:** X5 /qa P12 surfaced an eventual-consistency window — `Core::register` and `Core::set_deps` acquire the registry mutex AFTER dropping the state lock, so a concurrent thread can observe the new node in `s.nodes` / new edges in `s.children` before the registry has unioned the partition. Today benign (`partition_of` is debug-only); under Y1, `lock_for(node)` would resolve to a partition that's been topologically unioned in `s.children` but not yet in `registry`.
- **Options:** (a) move `registry.ensure_registered/union_nodes` back inside the state-lock scope; (b) document the eventual-consistency window and add lock-validation retry inside `Core::lock_for`.
- **Decision:** (a).
- **Rationale:** User direction. Lock order becomes `state → registry`; registry mutex is uncontended in X5 substrate so the inner critical section adds negligible latency. Avoids a retry loop in the wave-entry hot path. We will pre-verify (via grep) that no path currently acquires `registry` BEFORE the state lock, so the new ordering rule lands without conflict.
- **Affects:** `Core::register` (~line 1976 of `node.rs`) and `Core::set_deps` (~line 3866 of `node.rs`). New invariant: `state lock → registry mutex` (one-way). Lock-discipline doc-comment update.

### D091 — Slice Y1+Y2 P13 error UX: split into PartitionMigrationDuringFire variant
- **Date:** 2026-05-08
- **Context:** X5 /qa P13 surfaced that mid-wave `set_deps` triggering a partition migration (union or split) under Y1 must be rejected per Q3=(a-strict). The existing `SetDepsError::ReentrantOnFiringNode` (Slice F A6, 2026-05-07) catches the same-node case; the question is whether to widen it to also cover partition-migration triggers, or split into a distinct variant.
- **Options:** (a) extend `ReentrantOnFiringNode` to cover both reasons (one variant, two semantic causes); (b) keep `ReentrantOnFiringNode` for same-node, add new `PartitionMigrationDuringFire { n: NodeId, firing: NodeId }`.
- **Decision:** (b).
- **Rationale:** User direction. Two genuinely-distinct failure modes deserve two error UX surfaces — same-node reentrance is "you called `set_deps` on the node currently firing"; partition-migration-during-fire is "your `set_deps` would shift partition membership of a node currently firing on this thread." Reusing one variant would force users to debug "which kind of reentrance was this?" via context. The new variant carries both NodeIds so users can see which node they were mutating + which firing node was the obstacle.
- **Affects:** `SetDepsError` enum in `node.rs`; `Core::set_deps` adds a partition-migration check after the cycle/state-node validations and before union/split execution; updated test fixtures in `tests/setdeps.rs`.

### D092 — Slice Y1+Y2 cross-partition acquisition: acquire-all-upfront in ascending SubgraphId order
- **Date:** 2026-05-08
- **Context:** Q-Y1b-1. Cross-partition waves (e.g. an emit on partition P that cascades through a mount-edge into partition Q) need a deadlock-free multi-lock acquisition strategy. Two flavors: (a) collect touched partitions transitively from the wave's seed, sort by `SubgraphId.raw()`, acquire all upfront; (b) acquire-on-demand with try_lock + back-off.
- **Decision:** (a) — confirms session-doc Q7 lock.
- **Rationale:** User direction (and matches D3 design lock). Acquire-all-upfront preserves "one batch = one wave" user-facing contract. Total ordering on `SubgraphId.raw()` (= union-find root's `NodeId.raw()`) is monotonic and unique per partition, giving deadlock-freedom by lock-ordering proof. (b)'s try_lock + back-off introduces livelock vectors and complicates retry-validate semantics under concurrent union (the partition set you computed before back-off may have shifted). Cost of (a): "upfront" partition discovery walks the cascade graph at wave entry — bounded by graph fan-out but adds a pre-wave pass.
- **Affects:** New `Core::touched_partitions(seed: NodeId) -> SmallVec<[SubgraphId; 4]>` helper (transitive walk over `s.children` + meta-companions); `BatchGuard` holds `SmallVec<[Arc<SubgraphLockBox>; 4]>` of held locks (ascending order); `BatchGuard::drop` releases in reverse order. `Core::subscribe`'s wave-entry path uses the same helper.

### D093 — Slice Y1+Y2 cross_partition lock placement: 2-tier order with risk acceptance (no debug-tracker)
- **Date:** 2026-05-08
- **Context:** Q-Y1b-2. Wave-scoped fields (`pending_pause_overflow`, `pending_auto_resolve`, `wave_cache_snapshots`, `deferred_handle_releases`) move into a new `cross_partition: parking_lot::Mutex<CrossPartitionState>` field per session-doc Q2. Locked order: all touched-partition `wave_owner`s first (ascending `SubgraphId`), then `cross_partition` LAST. Any path that tries `cross_partition` BEFORE a partition lock would deadlock against another wave that has the partition lock and is waiting on `cross_partition`.
- **Options:** Accept the risk (rely on code review + lock-discipline doc comments); or build a debug-only lock-ordering tracker (per-thread Vec of acquired locks, asserts ordering on each new acquisition).
- **Decision:** Accept the risk.
- **Rationale:** User direction. The `cross_partition` mutex is acquired at exactly two sites (wave entry post-partition-acquire, and `BatchGuard::drop`'s drain path). Code review can easily verify the invariant. A debug tracker would add ~200 LOC of infrastructure for a 2-call-site invariant — over-engineering. We document the rule explicitly in `CrossPartitionState` rustdoc + lock-discipline section of `node.rs` module doc, and any future caller adding a third acquisition site is on notice via the doc-comment.
- **Affects:** New `CrossPartitionState` struct + `Core::cross_partition` field; module-doc lock-discipline section; rustdoc on each acquisition site.

### D094 — Slice Y1+Y2 TLA+ extension scope: all 5 items (full Q6 coverage)
- **Date:** 2026-05-08
- **Context:** Q-Y2-1. Session-doc Q6 enumerates 5 TLA+ extension items: (1) per-partition `wave_owner` model, (2) `SubgraphId` ascending acquisition invariant, (3) `Subscription::Drop` cross-partition cleanup cascade, (4) cross-partition deadlock-freedom assertion under all interleavings, (5) union/split discipline + mid-wave reentrancy rejection.
- **Options:** All 5 for Y2 close, or trim to (1)+(2)+(4) (deadlock-essentials) and defer (3)+(5).
- **Decision:** All 5.
- **Rationale:** User direction. Trimming to deadlock-essentials would land Y1+Y2 without verifying the (3) drop-cascade and (5) union/split + reentrancy-rejection paths — exactly the new Y1 paths most likely to harbor subtle bugs. The TLA+ model is the strongest verification we have for cross-partition lock interactions; the marginal cost of modeling all 5 is low relative to the implementation cost. Acceptance bar: each of the 5 items is encoded as a property and MC-checks under representative configs.
- **Affects:** New `docs/research/wave_protocol_partitioned.tla` (extends `wave_protocol_rewire.tla`) + `wave_protocol_partitioned_MC.tla`; `.github/workflows/ci.yml` `tlc` job widened to also check the new MC; CI README pointer.

### D095 — Phase H/I/K/L bundled as one closing slice for D3
- **Date:** 2026-05-09
- **Context:** Slice Y1+Y2 in-flight; Phases B–F + J landed in `d21a5d8`. Carry-forward enumerates Phase H (comprehensive parallelism tests), I (TLA+ extension), K (CLAUDE.md invariant 3 wording), L (closing docs + git tag). Each is small in isolation; bundling avoids three handoffs with D3 sitting "locked-but-not-closed".
- **Options:** A) Four separate slices in sequence; B) One bundled closing slice.
- **Decision:** B.
- **Rationale:** Phase L can only land after H/I/K (it cites them); the natural commit cadence is one combined commit. Estimated ~600–1200 LOC across tests + TLA+ + docs, no production code changes (D3 implementation already in `d21a5d8`). Falls within slice-size guidelines.
- **Affects:** `crates/graphrefly-core/tests/per_subgraph_parallelism.rs` (new); `docs/research/wave_protocol_partitioned.tla` (new) + `_MC.tla` (new); `CLAUDE.md` Rust invariant 3; `docs/migration-status.md` Y1+Y2 closing section; `docs/porting-deferred.md` D3 strikethrough; `archive/docs/SESSION-rust-port-d3-per-subgraph-parallelism.md` § 6 status.

### D096 — Loom budget: defaults for CI smoke, env-overridable for local exhaustive
- **Date:** 2026-05-09
- **Context:** Phase H Q-B. Loom interleaving counts grow combinatorially. CI needs a smoke check that completes in seconds; local exhaustive runs benefit from larger thread/branch budgets to surface complex bugs.
- **Options:** A) Hardcoded small budget (CI-friendly, local can't easily widen); B) Hardcoded large budget (local-friendly, CI runs slow); C) Loom defaults + document env-var override pattern (`LOOM_MAX_THREADS` / `LOOM_MAX_BRANCHES` / `LOOM_MAX_PREEMPTIONS`).
- **Decision:** C.
- **Rationale:** Loom already reads its model parameters from env vars by default; the test code stays minimal and the user can run aggressively locally (`LOOM_MAX_BRANCHES=100000 cargo test ...`) without affecting CI throughput. Existing `tests/loom_subscription.rs` follows the same shape — defaults sufficient for the bounded D5 scenario; no env-var tuning needed for current tests.
- **Affects:** `crates/graphrefly-core/tests/per_subgraph_parallelism.rs` documentation; no Cargo.toml or CI changes.

### D097 — One-batch landing; user commits and tags at the end
- **Date:** 2026-05-09
- **Context:** Phase H/I/K/L Q-C. Whether the slice should auto-commit + tag.
- **Decision:** No commit, no tag. User commits at end; release-plz handles version cadence.
- **Rationale:** User direction. Avoids divergence from the `chore: release vX` cadence pattern; user retains explicit control over the closing commit.
- **Affects:** Workflow only — no code/docs change.

### D098 — Defer N-thread criterion bench widening to Q2+Q3+Q-beyond batch
- **Date:** 2026-05-09
- **Context:** Phase H Q-D. Session-doc § Q8 calls for an N-thread parallel-emit bench validating sub-linear scaling; Phase J landed 2t/4t scenarios. The clean sub-linear-scaling shape was implied but not in the carry-forward list.
- **Options:** A) Widen now in Phase H bundle; B) Defer to the Q2+Q3+Q-beyond per-partition state-shard refactor batch.
- **Decision:** B.
- **Rationale:** Wide-spectrum parallelism (the regime the bench would highlight) only emerges after Q-beyond. Benching it now, when Regime A still serializes on the state mutex, would lock in 0.7× numbers as the "scaling baseline" — misleading. Defer to the batch where the win actually lands.
- **Affects:** `docs/porting-deferred.md` Q2+Q3+Q-beyond entry — already names this as part of its bench scope.

### D099 — Producer-pattern subscribe-during-fire deadlock loom test added with `#[ignore]`
- **Date:** 2026-05-09
- **Context:** Phase H Q-E. The Phase H+ deferred entry calls for a loom test of cross-partition `Core::subscribe`-during-fire — a documented AB/BA hazard. Question: include the test now or defer until the structural fix lands?
- **Options:** A) Don't add the test until the fix lands; B) Add the test now as `#[ignore = "deferred: ..."]` so the asset is preserved and the hazard is flagged in CI; C) Add the test ungated (would fail CI).
- **Decision:** B.
- **Rationale:** Preserves the test asset (no need to rewrite when the structural fix lands); doesn't fail CI; the `#[ignore]` reason string surfaces the hazard during `cargo test --ignored` listing. Matches the canonical pattern for deferred-feature tests in this repo.
- **Affects:** `crates/graphrefly-core/tests/per_subgraph_parallelism.rs` — one test gated `#[ignore]` with a hazard description.

### D100 — Q3 design: per-partition `tier3_emitted_this_wave` via SubgraphLockBox::state, cleared on outermost WaveOwnerGuard drop
- **Date:** 2026-05-09
- **Context:** Q3 (per-partition `tier3_emitted_this_wave`) needed a placement decision. Options: (a) per-`NodeRecord` bool field — cheapest perf, doesn't establish per-partition pattern; (b) per-`SubgraphLockBox::state: parking_lot::Mutex<SubgraphState>` field — establishes the per-partition wave-state pattern Q-beyond will extend; (c) keep global, refactor only structurally. The choice affects how Q-beyond inherits the shape.
- **Options:** A) per-NodeRecord bool; B) per-SubgraphLockBox state mutex; C) global with grouping struct.
- **Decision:** B (per-SubgraphLockBox `state` mutex with `SubgraphState` struct).
- **Rationale:** Q3's value is pattern-prep for Q-beyond. Per-NodeRecord bool is cheaper but doesn't generalize — Q-beyond needs per-partition aggregation, not per-node. Adding `parking_lot::Mutex<SubgraphState>` to `SubgraphLockBox` (sibling to `wave_owner: Arc<ReentrantMutex<()>>`) works because `wave_owner` already serializes access — the state mutex is uncontended in steady state and exists purely for safe interior mutability without `unsafe`. Outermost-WaveOwnerGuard-drop clear discipline — using `held_partitions` refcount return-bool to detect outermost release — handles re-entrant acquire correctly without firing-stack tracking.
- **Affects:** `crates/graphrefly-core/src/subgraph.rs` — new `SubgraphState` struct + `state` field on `SubgraphLockBox`. `crates/graphrefly-core/src/node.rs` — `WaveOwnerGuard` carries `Arc<SubgraphLockBox>` and `Drop` clears partition state on outermost release; `held_partitions::release` returns `bool was_outermost`. `crates/graphrefly-core/src/batch.rs` — `commit_emission` looks up partition box once (registry mutex acquire) and reuses; `mark_tier3_emitted_via(&pbox, node_id)` static helper avoids second acquire.

### D101 — Q2 design: cross_partition mutex split via `CrossPartitionState` sibling on `Core` (not nested in CoreState)
- **Date:** 2026-05-09
- **Context:** Q2 moves four wave-scoped fields (`pending_pause_overflow`, `pending_auto_resolve`, `wave_cache_snapshots`, `deferred_handle_releases`) out of `CoreState`. Two implementation shapes: (a) move into a sub-struct of `CoreState` (no new mutex; rename refactor only) — minimal risk, no lock-discipline change, but doesn't actually "split the mutex"; (b) move into a separate `Arc<parking_lot::Mutex<CrossPartitionState>>` field on `Core` — establishes the lock-discipline pattern (`state → cross_partition`) and matches the porting-deferred entry's literal description.
- **Options:** A) sub-struct in CoreState (struct grouping only); B) separate sibling Mutex on Core (real mutex split).
- **Decision:** B.
- **Rationale:** The porting-deferred entry's wording is "split cross_partition mutex out" — option A doesn't do that. Option B establishes the multi-Core-level-mutex pattern with explicit lock-discipline (`state → cross_partition`), which Q-beyond's per-partition shard layout naturally extends. The bench cost in isolation is real (extra mutex acquire per access on hot paths) but expected per the porting-deferred framing — wins land in Q-beyond.
- **Affects:** `crates/graphrefly-core/src/node.rs` — new `CrossPartitionState` struct with own `Drop` impl for handle-release discipline (mirrors CoreState::drop for the four moved fields); `Core::cross_partition: Arc<Mutex<CrossPartitionState>>` field; `WeakCore::cross_partition: Weak<Mutex<...>>` mirror; `Core::lock_cross_partition()` helper. `crates/graphrefly-core/src/batch.rs` — `commit_wave_cache_snapshots` / `restore_wave_cache_snapshots` / `drain_deferred` widened to take `&mut CrossPartitionState`; ~10 in-line acquire sites in commit_emission / queue_notify / drain_and_flush / BatchGuard::drop. `CoreState::clear_wave_state` widened to take `&mut CrossPartitionState`.

### D102 — Defer Q-beyond and Phase H+ STRICT to follow-up batches; close this batch with Q3+Q2+BTreeMap
- **Date:** 2026-05-09
- **Context:** User direction was α (bundled per original direction) covering Q3 + Q2 + Q-beyond + Phase H+ STRICT (option d typed-error) + the BTreeMap → SmallVec swap. Q3 + Q2 + BTreeMap landed cleanly (~700 LOC across `node.rs` / `batch.rs` / `subgraph.rs` / Cargo.toml; 502 tests still green). The remaining two pieces are large structural refactors: Q-beyond ~2000–3000 LOC across 150+ wave-engine sites, Phase H+ STRICT ~700–900 LOC with operator-architecture refactor (deferred-queue path) plus binding-side error mapping.
- **Options:** A) Continue full bundle in this conversation; B) Q-beyond skeleton + H+ STRICT skeleton (placeholder structs only); C) Defer both as carry-forward, ship Q3+Q2+BTreeMap as the close.
- **Decision:** C.
- **Rationale:** Per the porting-deferred entry's own framing: "multi-day per-site sub-slices ... breaking the test invariant during a multi-day refactor" is named as a real risk. Q-beyond is meant to land in many small per-site sub-slices, not a single big-bang. Phase H+ STRICT removes the producer-pattern operator carve-out (`IN_PRODUCER_BUILD`) — the operator architecture needs parallel changes for the new error-shape to be handleable. Both fit better as their own focused batches. Q3 + Q2 + BTreeMap as the close gives the Q-beyond-focused next batch a cleaner starting position (the per-partition state pattern + cross_partition mutex are already in place).
- **Affects:** `~/src/graphrefly-rs/docs/migration-status.md` — closing section names this batch; carry-forward lists Q-beyond and Phase H+ STRICT. `~/src/graphrefly-rs/docs/porting-deferred.md` — Q-beyond entry preserved; Phase H+ STRICT (cross-partition acquire-during-fire) entry preserved.

### D103 — D1 fix: revert Q3 v1 per-partition tier3 placement to per-thread thread-local
- **Date:** 2026-05-09
- **Context:** /qa pass surfaced D1 — Q3 v1's per-partition `tier3_emitted_this_wave` placement (on `SubgraphLockBox::state`) is vulnerable to mid-wave cross-thread `set_deps` partition-split desync. **Trigger:** thread A is mid-wave on partition P (wave_owner held) but between fn fires (`currently_firing` empty); thread B's `set_deps` acquires the state lock, P13's `currently_firing.is_empty()` short-circuits (line `node.rs:4607`), the split proceeds, X migrates from P to a fresh orphan-side partition with empty `tier3_emitted_this_wave`. Thread A's subsequent emit at X then mis-detects "first emit" → R1.3.3.a violation possible (Resolved + Data both queued at X in the same wave). User picked D1 (b) — trace and fix.
- **Trace finding:** the gap is reachable. `set_deps` doesn't acquire any partition wave_owner; it only acquires `state` (which is dropped between fires for re-entrance). P13's check skips when no node is currently_firing — the natural state when the wave is between fires. Cross-thread split during such a window is unguarded.
- **Options for the fix:** (a) document as known v1 hazard (D1 (a) — chosen as fallback); (b1) move tier3 back to a global `CrossPartitionState` field — breaks under concurrent disjoint-partition waves; (b2) move tier3 to a per-thread thread-local; (c) extend P13 with an `is_locked()` check on the affected partition's wave_owner to also reject splits while ANY thread holds the wave_owner (not just currently_firing); (d) make `split_partition` acquire the affected partition's wave_owner (serializes splits with concurrent waves but adds significant complexity).
- **Decision:** (b2) — per-thread thread-local.
- **Rationale:** Cleanest correctness fix that doesn't require P13 rework. Cross-thread emits at a node BLOCK on the partition's `wave_owner` `parking_lot::ReentrantMutex` — they always land in the OTHER thread's wave context with the OTHER thread's thread-local. Mid-wave splits don't touch thread A's thread-local at all. Wave scope = thread → BatchGuard outermost drop → matches the wave's natural boundary. Cleared at outermost `BatchGuard` drop on both success + panic-discard paths, plus a defensive wave-start clear at outermost owning entry against cargo's thread-reuse propagating stale entries from a panicked-mid-wave prior test. Q3 v1's per-partition substrate (`SubgraphState` struct + `SubgraphLockBox::state` field + `WaveOwnerGuard.box_` field + `Core::partition_box_of` helper) is fully removed — Q-beyond will reintroduce per-partition state placement when the CoreState shard layout actually needs it (with a different field shape that's robust to mid-wave splits).
- **Affects:** `crates/graphrefly-core/src/batch.rs` — new `TIER3_EMITTED_THIS_WAVE` thread_local + `tier3_check`/`tier3_mark`/`tier3_clear` helpers; `commit_emission` / `commit_emission_verbatim` use thread-local; `BatchGuard::new`+`drop` clear discipline. `crates/graphrefly-core/src/node.rs` — `WaveOwnerGuard.box_` field removed; `Drop` no longer clears partition state; `partition_box_of` removed. `crates/graphrefly-core/src/subgraph.rs` — `SubgraphState` struct + `SubgraphLockBox::state` field removed (`SubgraphLockBox` reverts to holding only `wave_owner`).

### D104 — /qa A1–A8 auto-applicable batch
- **Date:** 2026-05-09
- **Context:** /qa adversarial review (Blind Hunter + Edge Case Hunter, parallel) on the Q3+Q2+BTreeMap diff produced 9 auto-applicable findings (A1–A9) after triage. User direction: fix all.
- **Decision:** Apply A1–A8 verbatim per the QA recommendations. A9 (strengthen tier3 doc + Slice G call-site comments) was subsumed by D1's comprehensive doc rewrite. A4 (debug_assert in `partition_box_of`) was obviated by D1's removal of `partition_box_of`.
- **Rationale:** A1 closes a real correctness improvement (`commit_wave_cache_snapshots` releasing handles under held mutex; pre-A1 mirrored a pre-existing pattern, but the right fix is lock-released release per A3 discipline). A2/A3 surface bugs in dev/test builds that the legacy pattern silently masked. A5/A7 prevent latent deadlocks on future maintenance. A6 corrects a doc/code mismatch. A8 documents a load-bearing invariant.
- **Affects:** see `migration-status.md` "/qa pass applied" section for the per-finding code/file delta.

### D105 — Next batch: Q-beyond (per-partition `SubgraphShard` refactor)
- **Date:** 2026-05-09
- **Context:** Post-Q3+Q2+BTreeMap+D1+/qa close, two batches were carried forward in `migration-status.md`: Q-beyond (~2000–3000 LOC, ~150+ wave-engine sites; closes Regime A parallelism gap by sharding `CoreState` per-partition) and Phase H+ STRICT (closes producer-pattern operator carve-out via typed-error or defer-to-post-flush). User invoked `/porting-to-rs next batch` 2026-05-09.
- **Options:** A) Q-beyond; B) Phase H+ STRICT (option d typed-error or option b defer-to-post-flush).
- **Decision:** A — Q-beyond.
- **Rationale:** Q-beyond is the perf-positive batch — it recovers the ~25% Phase J regression Q3+Q2 introduced AND extends parallelism to Regime A (tight state-emit). Phase H+ STRICT is correctness-only against the spec-impl gap; the v1 ships with the documented carve-out. Q-beyond is the natural next step because (i) Q3+Q2 substrate is in place exactly to support it, (ii) bench evidence (Phase J regression) makes the case concrete, (iii) without Q-beyond the Q3+Q2 cost is unjustified standalone. Phase H+ STRICT as a follow-on batch.
- **Affects:** `crates/graphrefly-core/src/node.rs` (5180 LOC), `crates/graphrefly-core/src/batch.rs` (2923 LOC), `crates/graphrefly-core/src/subgraph.rs` (834 LOC). New per-partition `SubgraphShard` struct on `SubgraphLockBox` (sibling to `wave_owner`). `Core::cross_partition` mutex repurposed for residual cross-partition aggregation; per-partition fields move out. ~150+ read/write sites migrate to `shard[partition].lock()` shape.

### D106 — Q-beyond sub-slice ordering: small-first
- **Date:** 2026-05-09
- **Context:** The porting-deferred entry suggested heavy-first (start with `nodes`/`children` move so subsequent moves slot into the established pattern). Counter-proposal: small-first — `pending_fires` is the smallest field, drained per-partition already, and has zero cross-partition flow.
- **Options:** A) small-first (`pending_fires` → `pending_notify` → `nodes`+`children` → wave bookkeeping → bench); B) heavy-first (`nodes`+`children` first, then everything else slots into the established shard pattern).
- **Decision:** A — small-first.
- **Rationale:** Sub-slice 1 (`pending_fires`) is the smallest blast radius for shaking out (i) the per-partition shard mutex shape, (ii) `BatchGuard`'s interaction with multiple shard guards, (iii) the lock-discipline `state-residual → cross_partition → shard[i] → ... → partition_state` invariant. With those proven against a small surface, the heavy `nodes`+`children` move slots into a tested pattern. Each sub-slice ships cargo green at the boundary either way; ordering reduces refactor risk.
- **Affects:** sub-slice sequence — sub-slice 1 (`pending_fires`), sub-slice 2 (`pending_notify`), sub-slice 3 (`nodes`+`children`), sub-slice 4 (wave bookkeeping: `in_tick`, `currently_firing`, etc.), sub-slice 5 (bench re-run + perf assertions).

### D107 — Q-beyond batch shape: full multi-day batch end-to-end
- **Date:** 2026-05-09
- **Context:** Sub-slice-by-sub-slice with HALT between (low risk, slow throughput) vs full multi-day batch end-to-end (faster throughput, no intermediate state visibility, "501-but-internally-churning" test invariant for days).
- **Options:** A) sub-slice-with-halt (HALT after each sub-slice for user approval); B) full batch end-to-end (one Y1+Y2-shape close).
- **Decision:** B — full batch end-to-end.
- **Rationale:** User explicit choice. The Q3+Q2+BTreeMap+D1 batch was also a multi-day batch and shipped clean; the substrate is already in place; risk is contained by cargo green at sub-slice boundary checkpoints (internal checkpoints, no user-facing HALT). Faster total throughput; user can interrupt at any sub-slice boundary if they want to re-scope.
- **Affects:** workflow shape only — sub-slice 1–5 ship as one batch close with internal cargo-green checkpoints between sub-slices.

### D108 — Q-beyond hybrid architecture: per-thread wave state + per-partition registry shards (Mutex, not DashMap/RwLock/Tokio)
- **Date:** 2026-05-09
- **Context:** Original Q-beyond plan was "all per-partition shards for everything in CoreState." User pushed back that locks may be hurting more than helping; asked for first-principles audit + 4 alternatives + bench data. Built `crates/graphrefly-core/benches/lock_strategy.rs` (7 scenarios × 4-6 primitives) measuring uncontended cost, multi-mutex hop, cross-thread disjoint, true contention, read-heavy, MPSC vs Mutex, dynamic topology.
- **Key bench findings:**
  - **Uncontended cost is identical across all primitives** (~14 ns/op for parking_lot Mutex, std Mutex, thread_local). Same-thread mutex acquires are nearly free thanks to parking_lot's adaptive spinning + cache hot path.
  - **Real cost is cross-thread cache-line bouncing.** S3 (2 threads, disjoint keys): shared mutex 35.9 ns/op vs per-partition mutex 13.0 ns/op vs thread_local 13.4 ns/op — shared mutex is 2.7× slower purely from cache-line bouncing on the lock itself. THIS is what's killing Q3+Q2 Phase J numbers, not single-thread mutex hops.
  - **per-partition Mutex matches thread_local** for disjoint workloads (S3: 13.0 vs 13.4 ns/op). DashMap is 1.5-2× slower for single-thread, 12-22% faster only for read-heavy multi-thread.
  - **RwLock is consistently BAD** for read-heavy multi-thread (S5 2-thread: RwLock 39.8 vs Mutex 21.9 ns/op — 82% slower). Read-counter CAS bounces between cores.
  - **crossbeam-channel (Tokio-style Alt-D) is 2× SLOWER than mutex** in single-thread (S6: 17.8 vs 8.7 ns/op), only catches up at 2+ producers. Wrong fit for wave-driven dispatcher (mostly single-thread within a wave).
- **Options:** A) Pure per-partition shards (original Q-beyond); B) DashMap for nodes/children; C) Hybrid per-thread wave + per-partition registry; D) Tokio-style work-stealing scheduler.
- **Decision:** C — Hybrid: per-thread thread_local for wave-scoped state + per-partition Mutex shards for registry-scoped state. No DashMap, no RwLock, no Tokio.
- **Rationale:** Bench data drives the choice. (A) has the cross_partition cache-bounce problem that Q3+Q2 already exhibits. (B) DashMap loses single-thread by 1.5-2×. (D) MPSC channel overhead dominates single-thread workload. (C) per-partition Mutex matches thread_local perf for disjoint workloads, eliminates cross-thread cache bouncing for both wave-scoped and registry-scoped state. Wave-scoped → thread_local has zero cross-thread side effects by construction; registry-scoped → per-partition Mutex enables true disjoint-partition parallelism.
- **Affects:** `crates/graphrefly-core/src/batch.rs` — new `WAVE_STATE` thread_local module holding wave-scoped fields. `crates/graphrefly-core/src/node.rs` — `Core::cross_partition` field eliminated; `CrossPartitionState` struct removed; CoreState slimmed to registry-only fields. `crates/graphrefly-core/src/subgraph.rs` — `SubgraphLockBox.shard: parking_lot::Mutex<SubgraphShard { nodes, children }>` added. `set_deps` split path acquires wave_owner before mutating to serialize against in-flight cross-thread waves on the affected partition.

### D109 — Q-beyond batch shape: full batch end-to-end (5 sub-slices in one close, no HALT between)
- **Date:** 2026-05-09
- **Context:** D107 already established full-batch end-to-end shape; reaffirmed after the architecture re-think.
- **Decision:** Same as D107 — proceed sub-slice 1 → 2 → 3 → 4 → 5 with internal cargo-green checkpoints, no user HALT between sub-slices. User direction "do all the sub slices in one go" 2026-05-09.
- **Affects:** workflow only. Sub-slices: (1) WAVE_STATE thread_local + move 4 cross_partition fields, eliminate Core::cross_partition; (2) move pending_fires + pending_notify; (3) move remaining wave-scoped (currently_firing, deferred queues, in_tick); (4) nodes + children per-partition SubgraphShard + set_deps wave_owner-acquire-on-split; (5) Phase J bench re-run + close.

### D110 — Bench-driven scope reduction: drop sub-slice 4 (per-partition nodes/children shards)
- **Date:** 2026-05-10
- **Context:** Sub-slices 1-3 of the Q-beyond batch shipped (per-thread WaveState for 12 wave-scoped fields). Phase J bench against the prior Q3+Q2 baseline showed:
  - 2t-disjoint state-emit: −17.9% (improved by 22%)
  - 2t-same-partition state-emit: −26.8%
  - Serial 4N: −15.5%
  - Fn-fire serial: −20.9%
  - Fn-fire 2t-disjoint: −4.7%
  - Fn-fire 2t-same: −16.8%
  This RECOVERED the Q3+Q2 regression and went further. The original Q-beyond hypothesis was "per-partition shards needed for Regime A wide-spectrum parallelism." The bench data CONTRADICTED this hypothesis.
- **Sub-slice 4 was estimated 1500-2000 LOC; the agent that started it found ~146 access sites + ~40 indirect via require_node, plus a structural blocker** (`compute_touched_partitions` walks `s.children` to know which partitions to lock; if children lives in shards, chicken-and-egg). Resolutions exist (snapshot, duplicate adjacency, retry-validate) but each adds correctness complexity not justified by bench data.
- **Options:** A) Drop sub-slice 4, close batch; B) Push through anyway (multi-commit staging, ~3-5 day refactor); C) Smaller targeted optimization (compute_touched_partitions projection in registry).
- **Decision:** A — drop sub-slice 4.
- **Rationale:** Bench data is the architecture authority per D108's framing. Sub-slices 1-3 hit the perf goal. The state mutex no longer dominates because most fields moved off it; what's left is read-mostly registry-style HashMap reads, which the bench shows are not the bottleneck. Adding 3000-5000 LOC of structural complexity to chase a marginal additional gain that the bench doesn't justify violates "no implementation without explicit approval" + "too many locks" feedback. Sub-slice 4 deferred to a future batch IF a real workload surfaces state-mutex contention on nodes/children reads — currently no evidence this exists.
- **Affects:** Q-beyond batch closes after sub-slice 3 + sub-slice 5 (bench formalization + close docs). Sub-slice 4 carries forward to porting-deferred.md as "Per-partition nodes/children shards (Q-beyond Sub-slice 4) — DEFERRED, evidence-gated."

### D111 — Architectural lesson: per-thread thread-local was the right shape; per-partition shards were over-engineering
- **Date:** 2026-05-10
- **Context:** Original Q-beyond plan (D102 carry-forward) hypothesized per-partition `SubgraphShard`s for everything in CoreState. User's first-principles audit + bench data revealed this was wrong. Per-thread thread-local for wave-scoped state alone delivers the parallelism win, with zero shared mutex contention by construction.
- **Lesson recorded:** Three independent precedents converge on per-thread for wave-scoped state — graphrefly-py's `_batch_tls`, Tokio's per-worker local queues, and this Rust port's D1 patch (per-thread tier3). The pattern works because cross-thread access to wave-scoped state is structurally impossible (cross-thread emits block on partition wave_owner; the wave runs on ONE thread once unblocked). Per-partition shards are the right shape ONLY for state genuinely shared across threads (registry, nodes lookup) — and even then, only when reads cross partitions concurrently AND the workload mix justifies the shard split overhead. The bench data showed neither condition holds for the current workload.
- **Decision:** This isn't a single decision — it's a recorded heuristic for future architectural calls. Document at `~/src/graphrefly-rs/CLAUDE.md` invariant 3 and at `crates/graphrefly-core/src/batch.rs` `WaveState` doc comment.
- **Rationale:** Future maintainers should resist the urge to "shard everything" without bench evidence. The specific bench scenarios in `crates/graphrefly-core/benches/lock_strategy.rs` (added by this batch) are the canonical comparison harness for any future shard-vs-thread-local-vs-DashMap question.
- **Affects:** documentation + future-batch heuristic. No code changes.

### D112 — Q-beyond batch close: 4 fields → WaveState (sub-slice 1) + 2 (sub-slice 2) + 6 (sub-slice 3) = 12 wave-scoped fields per-thread
- **Date:** 2026-05-10
- **Context:** Final close of the Q-beyond batch. Three sub-slices landed; sub-slice 4 dropped per D110; sub-slice 5 = bench formalization + closing docs.
- **Decision:** Q-beyond batch CLOSES with sub-slices 1-3 + bench harness + this decision log + migration-status.md + porting-deferred.md updates. Phase J bench numbers + lock_strategy.rs bench numbers preserved as the architecture-decision audit trail.
- **Rationale:** Cleanest close. All quality gates green. No deferred items beyond the explicit sub-slice 4 carry-forward (which is evidence-gated, not time-bound).
- **Affects:** `~/src/graphrefly-rs/docs/migration-status.md` — new closing section. `~/src/graphrefly-rs/docs/porting-deferred.md` — Q-beyond entry struck through with closing summary; new sub-slice-4 deferred entry added. `~/src/graphrefly-rs/CLAUDE.md` invariant 3 wording lift (per-thread + per-partition wave_owner pattern is now the load-bearing architecture). `crates/graphrefly-core/benches/lock_strategy.rs` shipped as canonical decision harness.

### D113 — Sub-slice 4 re-explored after user "push through" request; HONEST bench reframe → second defer
- **Date:** 2026-05-10
- **Context:** D110 (2026-05-09) initially dropped sub-slice 4 (per-partition `nodes`/`children` shards). User requested "bench and then push through slice 4 to see if it gains any benefits" (2026-05-10). Built S8 in `crates/graphrefly-core/benches/lock_strategy.rs` (`2t_disjoint_per_partition_shards` variant) — initially reported ~16% projected gain. Subagent invoked to implement minimum-viable slice 4 (nodes only, leave children) HALTED with four-blocker analysis (re-entrancy, clear_wave_state per-wave shard walks, walk_undirected_dep_graph, set_deps split-migration). Halt prompted re-bench with HONEST variant (`2t_disjoint_HONEST_state_plus_shard`) that holds BOTH state.lock() and shard.lock() per access — faithful to a structural-only migration that keeps state.lock() because state still holds `s.children`, ID counters, topology_sinks, config.
- **HONEST bench results (2026-05-10):** Variant A (current arch) 2.74 ms; Variant B' HONEST 2.50 ms (**~9% improvement**); Variant B misleading 2.21 ms (~19% — eliminates state mutex entirely, not what slice 4 does); serial baseline 4.22 ms. The original ~16% projection was wrong because Variant B in S8 had no state mutex at all. Real sub-slice 4 delivers ~9% on the simulation; real-dispatcher gain likely lower (~4-9%) because the bench abstracts away other state mutex contention sources.
- **Options:** α) push through full sub-slice 4 with all four blockers managed (~2000-3000 LOC, multi-day, ~9% gain potential); β) stop here (sub-slices 1-3 already exceed Q-beyond perf goal; ~9% additional doesn't justify engineering risk for pre-1.0); γ) targeted micro-refactor (turned out not to deliver — see analysis).
- **Decision:** β — stop. Sub-slice 4 deferred for the SECOND time, with a tightened lift trigger.
- **Rationale:** (a) Sub-slices 1-3 already delivered 15-27% improvements — the perf goal is met. (b) The marginal 9% from sub-slice 4 doesn't justify the engineering risk (re-entrancy at every cascade site, set_deps behavior change, clear_wave_state per-wave shard walks, walk_undirected_dep_graph signature cascade). (c) The agent's halt was justified — these are real engineering hazards, not paper concerns. (d) γ analysis showed no truly-targeted middle-ground option: the 9% bench win is bench-locked to per-partition sharding eliminating cross-thread cache bouncing on the shard's mutex; you can't capture that win via cosmetic state.lock() shrinking. (e) The 16%-vs-9% reframe demonstrates the danger of speculative bench-driven decisions: the original lift trigger (any bench projection) was too loose. D113 tightens the trigger to require profiler-identified contention on the REAL dispatcher.
- **Tightened lift trigger (D113):** re-engage sub-slice 4 IF AND ONLY IF (i) a profiling trace on a realistic disjoint-partition workload identifies `parking_lot::Mutex::lock` on `Core::state` as a top-3 contributor (>20% of dispatcher time), OR (ii) a user / parity-test report of measurable wall-clock degradation traceable to state-mutex contention on `nodes` reads, OR (iii) a criterion bench where state-emit Regime A shows poor scaling at N≥4 threads on disjoint partitions where ≥80% of dispatcher time is in `parking_lot::Mutex::lock`. The goal: prevent the speculative-bench-driven cycle that triggered this re-exploration.
- **Affects:** `~/src/graphrefly-rs/docs/porting-deferred.md` — sub-slice 4 entry rewritten with HONEST bench data + agent's four blockers + tightened lift trigger + revised scope estimate (~2000-3000 LOC under minimum-viable scope, lower than D110's ~3000-5000 because nodes-only sidesteps several blockers). `crates/graphrefly-core/benches/lock_strategy.rs` S8 docstring rewritten to warn future readers that Variant B is misleading; Variant B' is the load-bearing comparison. This decision log entry. No code change beyond the bench docstring.

### D114 — /qa pass on Q-beyond batch close: F1+F2 reverted (in_tick + currently_firing back to CoreState); F4-F10 auto-applied
- **Date:** 2026-05-10
- **Context:** Adversarial /qa pass (Blind Hunter + Edge Case Hunter, parallel) on the Q-beyond batch (sub-slices 1-3 + dropped sub-slice 4 + bench/profile harnesses + closing docs) surfaced two architectural regressions and 7 minor cleanups. Both regressions were in sub-slice 3 fields placed on per-thread `WaveState` thread_local — the placement broke load-bearing cross-Core / cross-thread invariants.
- **F1 (silent corruption regression):** `in_tick: bool` on per-thread `WaveState` broke cross-Core same-thread BatchGuard isolation. A thread holding a live BatchGuard on Core-A and starting a wave on Core-B reads `ws.in_tick = true` (set by Core-A) → Core-B becomes non-owning → Core-B's writes get drained by Core-A's `BatchGuard::drop` against Core-A's binding (Core-B's HandleIds passed to Core-A's `release_handle`). Pre-sub-slice-3 was structurally safe (`in_tick` was on each Core's CoreState). Post-fix: `in_tick` is back on `CoreState` (per-Core, cross-thread visible via state mutex). `begin_batch_with_guards` re-acquires lock_state to set `in_tick=true`; `BatchGuard::drop` (success + panic) clears under held state lock. Cost: one state mutex acquire per outermost batch entry — small, dominated by the wave's drain time.
- **F2 (P13 cross-thread bypass regression):** `currently_firing: Vec<NodeId>` on per-thread `WaveState` silently bypassed the cross-thread P13 partition-migration check (D091). Pre-sub-slice-3 the shared `s.currently_firing` was visible cross-thread; thread B's `set_deps` could observe thread A's firing pushes during A's lock-released `invoke_fn`. Per-thread placement made thread B read its own empty stack → P13 silently bypassed. Post-fix: `currently_firing` is back on `CoreState` (per-Core, cross-thread visible). `FiringGuard::new` push merges into the existing state-lock scope (same scope as `is_producer` read — atomic, panic-safe). `FiringGuard::drop` pops under state lock. `set_deps`'s D1 reentrance check + P13 partition-migration check both read from `s.currently_firing` under the already-held state lock. Implicitly resolves /qa F3 (FiringGuard panic-window between WaveState push and Self construction — gone because push and is_producer read happen atomically under state lock).
- **Architectural lesson recorded:** wave-scoped fields on per-thread `WaveState` thread_local are correct for fields accessed ONLY by the wave-owner thread under `wave_owner` discipline (the 11 surviving fields: `pending_fires`, `pending_notify`, `wave_cache_snapshots`, `pending_auto_resolve`, `pending_pause_overflow`, `deferred_handle_releases`, `deferred_flush_jobs`, `deferred_cleanup_hooks`, `pending_wipes`, `invalidate_hooks_fired_this_wave` — cross-thread access is structurally impossible because cross-thread emits BLOCK on partition wave_owner). Fields with cross-Core or cross-thread read requirements (`in_tick`, `currently_firing`) MUST stay on shared `CoreState` — the thread_local optimization doesn't apply when the access pattern crosses the thread boundary by design.
- **Group 2 auto-fixes (F4-F10):**
  - F4: `wave_state_clear_outermost` adds `debug_assert!` that retain-holding fields (`wave_cache_snapshots`, `deferred_handle_releases`, `pending_notify`) are empty at outermost wave start. Catches invariant violations in tests immediately.
  - F5: bench S2 `BenchmarkId` relabeled from `3_separate_mutexes` to `3_separate_mutexes_5_acquires_per_iter` to make the per-iter acquire count explicit (loop body does 5 mutex acquires, not 3). Comment expanded.
  - F6: `examples/profile_disjoint_fn_fire.rs` docstring fixed (was 20× off vs constants — claimed "100k/200k emits, ~2 second window" but constant is 2_000_000; actual ~8s).
  - F7: `flush_notifications` `let _ = s;` shim replaced with `let _ = &*s;` + explicit comment that the lock guard belongs to the caller and is held throughout (prevents misleading "lock dropped" interpretation).
  - F8: stale `Q2 (2026-05-09): X moved to [CrossPartitionState::X]` comments in `node.rs` rewritten to `Q-beyond Sub-slice 1 (D108, 2026-05-09): X moved to [crate::batch::WaveState::X]` (CrossPartitionState was eliminated by sub-slice 1).
  - F9: bench S8 docstring adds caveat that Variant B' under-counts state-mutex contention (StateApproxNoNodes has minimal under-state work).
  - F10: bench S8 docstring adds caveat that Variant A under-counts per-emit thread_local borrow (sub-slices 1-3 added borrows the bench doesn't simulate). Both under-counts symmetric → defer-decision robust.
- **Findings rejected:** Edge Case Hunter F11 (S5/S6/S7 thread_local statics persist across criterion iters — documented as fragile but not a real bench bug under normal runs). Edge Case Hunter F8 (`drain_wave_cache_snapshots` orphaned current-cache leak — pre-existing pre-Q-beyond, not a regression).
- **Test count post-/qa: 502 cargo + 142 parity green; 0 failed; 2 ignored.** Same as pre-/qa (F1+F2 reverts are pure structural; the 502 tests already covered the pre-sub-slice-3 placement). `cargo clippy --all-targets -- -D warnings` clean (after F4 + F5 + F8 + bench F-allow). `cargo fmt --check` clean. `#![forbid(unsafe_code)]` preserved.
- **Affects:** `crates/graphrefly-core/src/batch.rs` (~150 LOC) — WaveState struct (`in_tick` + `currently_firing` removed); `WaveState::new` / `clear_wave_state` / `wave_state_clear_outermost` (currently_firing/in_tick paths removed; F4 debug_asserts added); `FiringGuard::new` + `Drop` (push/pop under state lock); `commit_emission` + `commit_emission_verbatim` (in_tick read from `s.in_tick`); `begin_batch_with_guards` (in_tick set under state lock); `BatchGuard::drop` (in_tick clear under state lock, both panic + success paths); `flush_notifications` (F7 comment fix). `crates/graphrefly-core/src/node.rs` (~80 LOC) — CoreState struct (`in_tick` + `currently_firing` re-added with full doc); `Core::new` (init); `CoreState::clear_wave_state` (currently_firing.clear restored); `set_deps` D1 + P13 checks (read `s.currently_firing`); F8 comment cleanup. `crates/graphrefly-core/benches/lock_strategy.rs` (~80 LOC) — F5 + F9 + F10 docstring updates; `dep_count` allow(dead_code). `crates/graphrefly-core/examples/profile_disjoint_fn_fire.rs` (~10 LOC) — F6 docstring fix.

### D115 — Phase H+ STRICT: typed-error variant architecture
- **Date:** 2026-05-10
- **Context:** Phase H+ LIMITED variant landed 2026-05-09 (panicking option d for non-producer surface). The `IN_PRODUCER_BUILD` carve-out lets producer-pattern operators bypass the ascending-order check. Carry-forward: close the carve-out via typed-error variant.
- **Options:**
  - Q1 (error granularity): A) Single `CoreError` enum. B) Per-method error enums. C) `try_*` variants only.
  - Q2 (deferred queue): A) Existing `deferred_flush_jobs` on WaveState. B) New `ProducerDeferredQueue`. C) Thread-local.
  - Q3 (public API scope): A) Internal only — public methods unchanged; producer layer uses `try_*`/`*_or_defer`. B) All 6 methods return `Result`.
  - Q4 (defer scope): A) emit/complete/error only. B) Also subscribe-during-build.
- **Decision:**
  - Q1: B — per-method error enums (consistent with existing `SetDepsError`, `RegisterError`, etc.)
  - Q2: A — per-Core `Mutex<Vec<DeferredProducerOp>>` (NOT WaveState, because deferred ops must be per-Core — /qa F1 precedent). Drained after wave_guards release in `BatchGuard::drop`.
  - Q3: A — internal only. Existing `subscribe`/`emit`/`complete`/`error`/`teardown`/`invalidate` keep current signatures (panic on violation for non-producer paths). New `try_*` internal + `*_or_defer` public methods for producer layer.
  - Q4: B — all four ops: emit, complete, error, AND subscribe. Subscribe deferral uses `DeferredProducerOp::Callback(Box<dyn FnOnce() + Send>)` to avoid graphrefly-core → graphrefly-operators dependency.
- **Rationale:** Per-method errors match the codebase pattern. Per-Core deferred queue avoids the cross-Core contamination that sank WaveState-based `in_tick`/`currently_firing` (D114 F1/F2). Internal-only preserves API stability. Q4 B is necessary because removing `IN_PRODUCER_BUILD` exposes build-closure subscribes to the H+ check.
- **Affects:** `graphrefly-core` (node.rs: PartitionOrderViolation + deferred queue on Core; batch.rs: begin_batch_for returns Result internally, BatchGuard::drop drains deferred ops post-wave_guards; held_partitions: check_and_acquire returns Result). `graphrefly-operators` (producer.rs: remove ProducerSinkGuard, use try_subscribe + Callback defer; ops_impl.rs + higher_order.rs: sink closures use emit_or_defer/complete_or_defer/error_or_defer). Removes IN_PRODUCER_BUILD thread-local + FiringGuard::is_producer_build.

### D116 — B1: closed as already-done via Slice F A4 range reservation
- **Date:** 2026-05-10
- **Context:** Porting-deferred "alloc_lock_id can collide with user-supplied LockId::new(N)" — `LockId(u64)` exposes a `pub fn new(n: u64)` letting users mint colliding ids. TS uses opaque `Symbol()` for guaranteed uniqueness.
- **Options:** A) Restrict `LockId::new` to `pub(crate)` + new `LockId::user(u32)` for user range; update napi bindings. B) Keep as-is — strike through entry as already-done via Slice F A4 range reservation. C) Same as B + fix `1<<32` vs `1<<31` doc-vs-code drift in handle.rs:118-133.
- **Decision:** B — closed as already-done. No code change.
- **Rationale:** User picked (a) initially, then on Phase 2 research surfaced that Slice F A4 (2026-05-07) already shipped option (b) of the original deferred entry's lift options: `next_lock_id` initialized at `1u64 << 31` so dispatcher-allocated ids cannot collide with u32-marshalled user ids in `[0, 2^31)`. The range reservation is sufficient — option (a)'s additional compile-time guarantee is marginal over the existing range invariant. Originally-picked option (a) would also force a napi binding refactor (`core_bindings.rs` + `graph_bindings.rs` use `LockId::new(u64::from(u32))` for u32→LockId marshalling).
- **Affects:** `porting-deferred.md` strike-through for "alloc_lock_id can collide with user-supplied LockId::new(N)." No source change.

### D117 — B3: empty-deps mid-wave queues auto-Resolved via `pending_auto_resolve`
- **Date:** 2026-05-10
- **Context:** Porting-deferred "set_deps mid-wave full-removal leaves stuck DIRTY without RESOLVED" — `set_deps(N, &[])` while N is mid-wave dirty leaves an unpaired DIRTY in `pending_notify[N]`, violating R1.3.1.b.
- **Options:** A) Reject `set_deps(N, &[])` on derived/dynamic with `SetDepsError::EmptyDepsOnComputeNode`. B) Permit + queue auto-Resolved at wave-end via existing `pending_auto_resolve` machinery.
- **Decision:** B — push N to `pending_auto_resolve` when `new_deps.is_empty()` AND N has any pending tier-1 in `pending_notify`. The existing wave-end sweep handles routing (incl. paused-children).
- **Rationale:** Less surface change; symmetric with the existing diamond-resolution auto-resolve path. Rejecting (A) would be a behavior break with no consumer pressure.
- **Affects:** `graphrefly-core::node::Core::set_deps` (post-mutation block adds the conditional push); test `set_deps_full_removal_mid_wave_queues_resolved`.

### D118 — B4: subscribe-after-terminal — clean split by `resubscribable` flag
- **Date:** 2026-05-10
- **Context:** Phase 13.8 carry-forward "Late-subscriber-to-terminal-node-delivers-nothing." Initial proposal split by `has_received_teardown` (replay for not-torn-down, reject for torn-down). User pushed back: that's wrong semantics — `resubscribable` IS the property that gates whether late subscribe re-activates; TEARDOWN is the cleanup signal of the previous activation, not "permanent destruction." The conflation came from Slice A+B F3 audit which made `!has_received_teardown` a guard on reset; that was over-defensive.
- **Final design (canonical-spec change R2.2.7.a + R2.2.7.b, 2026-05-10):**
  - **Resubscribable + terminal (any torn_down state)** → reset to fresh lifecycle on subscribe. Drops the F3 `!has_received_teardown` guard. `wipe_ctx` fires on every reset including post-teardown.
  - **Non-resubscribable + terminal (any torn_down state)** → `try_subscribe` returns `Err(SubscribeError::TornDown { node })`. Public `subscribe` panics with TornDown diagnostic. Operators (producer.rs / higher_order.rs) match on the error variant — defer for `PartitionOrderViolation`, skip the source for `TornDown`.
  - The `torn_down` flag is irrelevant to the rejection / reset decision — `terminal.is_some()` alone gates it.
- **Cross-impl scope (D118, locked 2026-05-10):**
  - **Canonical spec:** R2.2.7.a + R2.2.7.b added; R2.6.4 / Lock 6.F note clarifies TEARDOWN ≠ permanent destruction.
  - **Rust this batch:** `Core::subscribe` reset condition relaxed; `SubscribeError` enum added; `try_subscribe` returns `Result<Subscription, SubscribeError>`; `reset_for_fresh_lifecycle` clears `has_received_teardown`; producer.rs + higher_order.rs callers match on variant; ~3-5 tests rewritten + new rejection tests.
  - **TS follow-up (deferred):** mirror in `packages/pure-ts/src/core/node.ts`. Tracked as a Phase 13.X follow-up to close parity-tests gap; not in scope this Rust batch.
- **Rationale:** "Resubscribable" matches behavior — late subs reactivate, period. Non-resubscribable + terminal = stream over; honest error beats confusing handshake of past events. The Rust port targets the canonical spec, not the current TS — R2.2.7.a/b is the spec position; current TS is the divergence.
- **Affects:** Rust core (subscribe / try_subscribe / reset_for_fresh_lifecycle / SubscribeError); Rust operators (producer.rs subscribe_to / higher_order.rs); ~5 existing Rust tests rewritten; ~3 new tests; canonical spec R2.2 + R2.6.4.

### D119 — A (Phase G): state nodes preserve `cached` on deactivation; compute nodes clear (R2.2.7/R2.2.8 ROM/RAM)
- **Date:** 2026-05-10
- **Context:** Phase G `cleanup_node` activation. Spec R2.2.7 "State nodes retain `.cache` and status (ROM); compute nodes clear `.cache` and transition to `\"sentinel\"` (RAM)." TS `_deactivate` (`pure-ts/src/core/node.ts:2278-2281`): `if (this._fn != null) { this._cached = undefined; }`.
- **Options:** A) State nodes also clear (symmetric, "deactivation = forget"). B) State nodes preserve, compute nodes clear (TS parity).
- **Decision:** B — match TS / spec exactly.
- **Rationale:** State nodes are intrinsic-value carriers (the value IS the node); compute nodes are function-of-deps and the cache is a memo. Clearing state cache would change resubscribe semantics (resubscribe would see SENTINEL instead of the persisted value).
- **Affects:** `Subscription::Drop` Phase G cache-clear branch — `if rec.fn_id.is_some() || rec.op.is_some() { release rec.cached; rec.cached = NO_HANDLE }`.

### D120 — A (Phase G): ordering = user hooks → Core cache-clear (matches TS `_deactivate`)
- **Date:** 2026-05-10
- **Context:** Phase G adds Core internal cache-clear to `Subscription::Drop`'s last-sub branch. Existing order: `cleanup_for(OnDeactivation) → producer_deactivate → wipe_ctx`.
- **Options:** A) Cache-clear FIRST, then user hooks. B) Cache-clear AFTER user hooks (matches TS `_deactivate` step ordering).
- **Decision:** B — Core cache-clear runs LAST.
- **Rationale:** TS does cleanup callback first (step 1), THEN disconnects from deps (step 2), THEN clears Core state (step 3-5). User cleanup may reference cached value or per-dep state via the binding-side `ctx.store`; clearing first would surprise the cleanup closure. Mirrors the existing D056 ordering rationale for cleanup-before-producer-deactivate.
- **Affects:** `Subscription::Drop` — new cache-clear block runs after the existing `cleanup_for / producer_deactivate / wipe_ctx` calls.

### D121 — A (Phase G): per-node `terminal` slot kept on deactivation; per-dep `dep_terminals[i]` slots released
- **Date:** 2026-05-10
- **Context:** "Non-resubscribable terminal Error handles leak via diamond cascade" — each terminal node retains 1 share in its own `terminal` slot AND 1 share per consumer's `dep_terminals[idx]` slot. The leak is per-cascade-destination.
- **Options:** A) Release both on deactivation. B) Release per-dep `dep_terminals[i]`; keep per-node `terminal` slot.
- **Decision:** B — release consumer-side per-edge retains; keep producer-side own terminal slot.
- **Rationale:** The producer's `terminal` slot IS the durable record needed for late-subscriber replay (resubscribable on next subscribe-cycle reset; non-resubscribable for B4 handshake replay). Releasing it would lose the terminal value. The per-cascade-destination leak (the actual reported issue) is fully closed by releasing per-dep slots in the CONSUMER's deactivation cleanup.
- **Affects:** Phase G cache-clear walks `rec.dep_records[i]` releasing `prev_data` + `data_batch` retains + `terminal` Error handles; does NOT touch `rec.terminal`.

### D122 — B2 + C closed as "already done" — porting-deferred entries struck through, no implementation work
- **Date:** 2026-05-10
- **Context:** Phase 1 research surfaced that B2 (pause-buffer overflow ERROR synthesis) is fully implemented in Slice F A3 (2026-05-07) — `BindingBoundary::synthesize_pause_overflow_error` in boundary.rs:366; synth call in batch.rs:856; tests in `slice_f_corrections.rs:332-440`. Similarly C (`take_until` port) is fully implemented in `ops_impl.rs:610` with 4 cargo tests in `tests/subscription.rs:389+`.
- **Options:** A) Re-implement / re-validate. B) Strike through stale porting-deferred entries; doc-only cleanup.
- **Decision:** B — doc-only cleanup. The existing impls are tested + green.
- **Rationale:** No re-implementation needed. The porting-deferred entries are stale — they predate the slices that closed them.
- **Affects:** `porting-deferred.md` strike-through for "Pause-buffer overflow does not synthesize ERROR" + "M3 Slice C-3 — take_until not yet ported."

### D123 — /qa F1: Phase G re-checks `subscribers.is_empty()` to handle user-hook re-entrance
- **Date:** 2026-05-10
- **Context:** Adversarial /qa pass on the B+A batch surfaced that Phase G's cache-clear runs AFTER user `cleanup_for(OnDeactivation)` / `producer_deactivate` / `wipe_ctx` hooks. If a user hook re-subscribes during the lock-released window, the new subscriber's handshake delivers the live `cache` handle to its sink (with a pending_notify retain); Phase G then reacquires the state lock and releases `cache` via `release_handle`, dropping the registry slot to refcount-zero while the new subscriber still holds it via `pending_notify`. Use-after-release in production bindings.
- **Options:** A) Re-check `rec.subscribers.is_empty()` inside Phase G's state-lock acquire and skip if non-empty. B) Hold the state lock across the user hooks (breaks D045 re-entrance contract). C) Document and ship the bug.
- **Decision:** A — skip Phase G if re-entrance re-activated the node.
- **Rationale:** Cleanest fix; matches D119 intent. The TS analog doesn't have the bug because JS is single-threaded with no released-lock window; Rust's lock-released hook discipline opens the window, so the re-check is necessary for refcount soundness. Re-acquire happens atomically with the recheck under the state lock.
- **Affects:** `crates/graphrefly-core/src/node.rs` Subscription::Drop Phase G — new `if !rec.subscribers.is_empty() { return; }` gate. Test `phase_g_skips_cache_clear_when_cleanup_hook_re_subscribes` in `tests/phase_g_cleanup_node.rs`.

### D124 — /qa F8: Phase G releases op_scratch (non-resubscribable only)
- **Date:** 2026-05-10
- **Context:** /qa surfaced that Phase G releases per-edge handles (`prev_data` / `data_batch` / `dep_terminals` Error) but leaves `op_scratch` retains untouched. For non-resubscribable nodes that never re-subscribe, this is a permanent leak (Last.latest, Scan.acc, etc. retained forever). Asymmetric with the per-edge cleanup.
- **Options:** A) Release op_scratch unconditionally. B) Release ONLY for non-resubscribable nodes (resubscribable's `reset_for_fresh_lifecycle` handles release-with-take-before-release ordering for the seed-aliasing-acc invariant). C) Document as carry-forward; don't fix.
- **Decision:** B — gate F8 on `!rec.resubscribable`.
- **Rationale:** Option (A) initially attempted but broke `last_releases_buffered_latest_on_lifecycle_reset` test — eager release collapses the seed-handle registry slot before the next resubscribe's reset can take its retain (Slice C-3 /qa P1 invariant). Gating closes the leak for the non-resubscribable case (the actual D028 carry-forward concern) without breaking the resubscribable cycle.
- **Affects:** `crates/graphrefly-core/src/node.rs` Subscription::Drop Phase G — `if rec.resubscribable { None } else { std::mem::take(&mut rec.op_scratch) }`. Lock-released `release_handles` call mirrors `ScratchReleaseGuard::drop`. Closes D028 partially.

### D125 — /qa F6: B3 predicate counts unpaired DIRTYs (excludes tier-4 INVALIDATE)
- **Date:** 2026-05-10
- **Context:** /qa surfaced that the B3 `pending_auto_resolve` predicate used `any tier >= 3` as the "has_settle" check — but INVALIDATE (tier 4) is NOT a settle for R1.3.1.b two-phase pairing. A wave like `[DIRTY, INVALIDATE]` would short-circuit the auto-resolve. Additionally, multi-emit waves like `[DIRTY, RESOLVED, DIRTY]` left one trailing unpaired DIRTY that the original predicate missed.
- **Decision:** Walk `pending_notify` in arrival order, counting unpaired DIRTYs. Settles are tier-3 (DATA/RESOLVED) AND tier-5 (COMPLETE/ERROR); INVALIDATE / PAUSE / RESUME / TEARDOWN / START are NOT settles.
- **Affects:** `crates/graphrefly-core/src/node.rs` set_deps empty-deps block.

### D126 — /qa F2: SubscribeOutcome substrate + per-operator Dead handling
- **Date:** 2026-05-10
- **Context:** /qa surfaced that `producer::subscribe_to`'s silent-skip-on-TornDown wedged most producer-pattern operators (zip waits on a queue that never fills; concat doesn't advance; race doesn't mark completed; take_until waits for notifier indefinitely; merge_map's `s.active` counter leaks; switch_map/exhaust_map's `[Data, Complete]` batched outer projected to dead inner wedges). User direction (F2 = a): substrate-level outcome enum + per-op Dead handlers.
- **Options:** A) `SubscribeOutcome { Live, Deferred, Dead }` enum returned by `subscribe_to`; per-op Dead handling. B) Inline match on `SubscribeError` per operator. C) Defer to follow-up.
- **Decision:** A — substrate-level outcome enum.
- **Rationale:** Per-domain status-string-union pattern (matches TS's `RefineStatus` / `AgentStatus` / process status `"running" | "completed" | "errored" | "cancelled"`). No single canonical `Outcome<T>` type in TS or Rust; each domain owns its outcome enum. `SubscribeOutcome` documents the producer-layer dead-source contract; operators match on it.
- **Per-op handling:** zip self-Completes on Dead (queue never fills); concat advances phase on Dead first / sets second_completed on Dead second; race marks `completed[idx]=true` and self-Completes if all Dead; take_until self-Completes on Dead source, ignores Dead notifier; switch_map / exhaust_map / merge_map invoke `on_complete_for_dead()` to synthesize inner-Complete and trigger the operator's self-Complete-when-done logic.
- **Affects:** `crates/graphrefly-operators/src/producer.rs` (new `SubscribeOutcome` enum, widened `subscribe_to` return); `crates/graphrefly-operators/src/ops_impl.rs` (zip/concat/race/take_until Dead handling); `crates/graphrefly-operators/src/higher_order.rs` (switch_map/exhaust_map/merge_map TornDown synthesizes on_complete); `crates/graphrefly-operators/src/lib.rs` export. End-to-end Dead-path testing constrained by partition-acquire ordering — substrate-level coverage via `SubscribeError::TornDown` unit tests in `tests/resubscribable.rs`.

### D127 — /qa F3: TornDownError class + trySubscribeOrDead helper (TS substrate)
- **Date:** 2026-05-10
- **Context:** /qa surfaced that the TS-side R2.2.7.b throw (Node.subscribe throws Error) is not type-discriminable by operator code. ~25 TS operator subscribe sites (buffer / take / control / combine / time / higher-order) silently break on dead-upstream consumers post-D118.
- **Options:** A) Typed `TornDownError` class + `trySubscribeOrDead()` helper + audit operators. B) Catch-all try/catch. C) Defer.
- **Decision:** A — substrate landed; full operator audit deferred to a focused follow-up batch.
- **Rationale:** Substrate (typed error class + helper) is the load-bearing change; without it operators have no clean discriminator. The 25-site operator audit is mechanical but large; ship the substrate and document the audit as carry-forward (consumer pressure will drive the per-operator migrations).
- **Affects:** `packages/pure-ts/src/core/subscribe-error.ts` (new file — TornDownError + isTornDownError + SubscribeOutcome type + trySubscribeOrDead helper). `packages/pure-ts/src/core/node.ts` subscribe throws TornDownError instance. `packages/pure-ts/src/core/index.ts` exports. Carry-forward: per-operator audit (buffer / take / control / combine / time / higher-order).

### D128 — /qa F5 + F7 + F10 + F11 + spec wording fixes (auto-applied)
- **Date:** 2026-05-10
- **Context:** /qa surfaced four small-scope items: F5 dead-code branches in `try_subscribe` post-D118 (terminal-replay + teardown-replay arms unreachable after R2.2.7.a/b enforcement); F7 TS error message wording drift (`(status=...)` substring not in canonical or Rust); F10 TS test regex too loose; F11 missing race-window regression test for mid-wave subscribe between `complete()` and TEARDOWN auto-cascade; spec §1 TEARDOWN table row contradicted R2.2.7.a's "not permanent destruction" framing.
- **Decisions (all auto-applied):** F5 removed; F7 routes through TornDownError class (canonical wording); F10 tightened to `/non-resubscribable.*terminated.*R2\.2\.7\.b/`; F11 added; spec §1 row updated in both canonical spec docs.
- **Affects:** node.rs handshake builder (F5); node.ts subscribe (F7); session1-foundation.test.ts (F10); phase_g_cleanup_node.rs (F11); GRAPHREFLY-SPEC.md + implementation-plan-13.6-canonical-spec.md (spec wording).

### D129 — D-α Phase G op_scratch resubscribable defer queue (closes D028)
- **Date:** 2026-05-10
- **Context:** /qa F8 (D124) closed the non-resubscribable case of D028 ("flow operator counters reset only on resubscribable terminal cycle") via eager `op_scratch` release in Phase G. The resubscribable + non-terminal deactivate-reactivate path remained leaky because Phase G's eager release would drop the seed/acc share BEFORE `reset_for_fresh_lifecycle`'s retain-before-release window (Slice C-3 /qa P1 invariant — verified by `scan_resubscribable_reset_with_seed_aliasing_acc_does_not_collapse_registry`).
- **Options:** α) Per-Core `pending_scratch_release` defer queue draining on next `reset_for_fresh_lifecycle` or Core drop. β) Operator factory holds registration-time seed in a separate registry slot; Phase G releases scratch unconditionally; reset re-retains from the registration slot. γ) Defer to consumer pressure.
- **Decision:** α — per-Core defer queue.
- **Rationale:** Smaller diff. Mirrors the F8 STRICT deferred-op discipline (per-Core queue draining at a known synchronization point). Preserves the Slice C-3 /qa P1 retain-before-release invariant by routing the OLD scratch release through the queue, drained AFTER reset's Phase 2 fresh retain.
- **Implementation:** Phase G on resubscribable + has-op: take old `op_scratch`, build fresh via `Core::make_op_scratch_with_binding` (new static variant — Subscription::Drop holds only `&dyn BindingBoundary`), install fresh, push old to `CoreState::pending_scratch_release: Vec<Box<dyn OperatorScratch>>`. Queue drains in `reset_for_fresh_lifecycle` Phase 3b (after Phase 2 fresh retain) and in `Drop for CoreState`.
- **Affects:** `crates/graphrefly-core/src/node.rs` — Subscription::Drop Phase G branch; `reset_for_fresh_lifecycle` Phase 3b drain; `Drop for CoreState` D-α catch-all drain; new static `Core::make_op_scratch_with_binding`. 5 new tests in `crates/graphrefly-operators/tests/phase_g_op_scratch.rs`. Closes [`porting-deferred.md` D028](https://github.com/graphrefly/graphrefly-rs/blob/main/docs/porting-deferred.md).

### D130 — E sub-slice: signal_invalidate two-phase tree-wide gather
- **Date:** 2026-05-10
- **Context:** Original `signal_invalidate` recursed per-graph (each child's recursion locks its own inner, builds its own snapshot, runs its own invalidate cascade). New nodes added between recursion levels were missed; mid-recursion mutations to not-yet-visited subgraphs were visible. The "Why divergent" section of the deferred entry defended this as preserving the Graph→Core lock-ordering rule (Core invalidate cascade re-enters Graph layer), but a tighter shape was achievable.
- **Decision:** Two-phase split — Phase 1 walk the whole mount tree under per-graph locks gathering a flat `Vec<NodeId>`; Phase 2 invalidate the flat list with no Graph locks held.
- **Rationale:** Same lock-ordering preservation (Graph locks released before Core cascade). Tighter snapshot semantics — invalidate ordering is deterministic DFS pre-order across the entire tree; mid-walk mutations only affect not-yet-snapshotted subgraphs (smaller window than the per-subgraph model). Easier to reason about for future maintainers.
- **Affects:** `crates/graphrefly-graph/src/graph.rs` — `signal_invalidate` refactored + new recursive helper `collect_signal_invalidate_ids`. 3 new tests in `crates/graphrefly-graph/tests/mount.rs` (deep tree, destroyed subtree, re-entrant Graph access during Core cascade).

### D131 — F sub-slice: DebugBindingBoundary extension trait + DescribeValue enum
- **Date:** 2026-05-10
- **Context:** `Graph::describe()` surfaced `value: Option<HandleId>` — raw u64. Canonical TS surfaces `value: T`. Lifting required either (a) a Core-side binding callback (violates handle-protocol cleaving plane), or (b) a binding-side extension trait outside the hot path.
- **Options:** A) Add `handle_to_debug` method directly on `BindingBoundary` (intrusive — every binding pays the impl cost). B) Separate optional `DebugBindingBoundary` extension trait in graphrefly-core (forces serde_json dep into core). C) Separate optional `DebugBindingBoundary` extension trait in graphrefly-graph (where serde_json already lives).
- **Decision:** C — `DebugBindingBoundary` in `graphrefly-graph/src/debug.rs`.
- **Rationale:** Keeps graphrefly-core serde-free (preserves "core stays lean" invariant — bindings that don't ship describe-rendering don't pay the dep cost). The trait is colocated with `Graph::describe`'s output type. Bindings opt in by implementing both `BindingBoundary` (hot-path, always) and `DebugBindingBoundary` (cold-path, only if they support describe-rendering).
- **Implementation:** `NodeDescribe.value` refactored from `Option<HandleId>` to `Option<DescribeValue>` enum with `Handle(HandleId)` (raw) + `Rendered(serde_json::Value)` (binding-rendered) variants. Serialized uniformly (number or arbitrary JSON, no tag). `Graph::describe()` returns `Handle`; `Graph::describe_with_debug(debug: &dyn DebugBindingBoundary)` invokes the trait per node.
- **Affects:** `crates/graphrefly-graph/src/debug.rs` (new); `crates/graphrefly-graph/src/describe.rs` (refactor + new `describe_with_debug`); `crates/graphrefly-graph/src/lib.rs` (exports). Existing test assertions updated: `Option<HandleId>` → `Option<DescribeValue::Handle(...)>`. 3 new tests in `crates/graphrefly-graph/tests/describe.rs::debug_render`.

### D132 — B sub-slice: partition-coherent test helper for F2 e2e tests
- **Date:** 2026-05-10
- **Context:** D126 substrate (SubscribeOutcome::Dead + per-op Dead handlers) landed but the e2e Dead-path tests deferred because reaching the immediate-Dead path (vs Phase H+ STRICT Deferred path) requires source + producer partitions both held by the activation wave's current thread. Existing meta-companion test workarounds hit Deferred, not Dead.
- **Decision:** New `OpRuntime::with_all_partitions_held(f)` helper wrapping `f` in `core.batch()`.
- **Rationale:** `core.batch()` acquires every existing partition's `wave_owner` in ascending order via the retry-validate loop. Re-entrant on parking_lot::ReentrantMutex, so the producer's activation wave's `try_subscribe(dead_source)` acquires the source's partition via the already-held lock and the H+ STRICT ascending-order check passes. The source's `resubscribable=false + terminal=Some(...)` state surfaces synchronously as `SubscribeError::TornDown` → `SubscribeOutcome::Dead`.
- **Affects:** `crates/graphrefly-operators/tests/common/mod.rs` (new `with_all_partitions_held`); `crates/graphrefly-operators/tests/dead_source_e2e.rs` (new — 8 tests covering zip / concat / race / take_until per-op Dead semantics).

### D133 — A sub-slice: TS operator audit (D127 follow-up)
- **Date:** 2026-05-10
- **Context:** D127 landed the TS substrate (`TornDownError` + `isTornDownError` + `SubscribeOutcome` + `trySubscribeOrDead`). 25 operator subscribe sites across 6 files still called raw `source.subscribe(...)` — would throw uncaught from `onSubscribe` on dead-upstream consumers.
- **Decision:** Add `subscribeOr(source, sink, onDead)` convenience helper + migrate 25 sites mechanically.
- **Rationale:** The match-on-outcome boilerplate at every site is repetitive; the helper captures the common "live → return unsub; dead → invoke per-op handler + return no-op unsub" pattern. Drop-in replacement for `source.subscribe(sink)`, minimal diff per site.
- **Per-op semantics mirror Rust impl:**
  - buffer / bufferCount / bufferTime / windowCount / windowTime / window source → flush remainder + self-COMPLETE
  - window notifier → no-op (operator passes through source as single open window)
  - takeUntil source → self-COMPLETE; takeUntil notifier → no-op
  - timeout / repeat / rescue source → self-COMPLETE
  - debounce / throttle / sample source → flush pending + self-COMPLETE; sample notifier → self-COMPLETE
  - audit / delay source → flush latest + self-COMPLETE
  - merge / zip / concat / race per-source → per-op Dead-source handling (mirrors Rust ops_impl.rs)
  - higher-order inner (`forwardInner`) → `finish()` (treats as immediate inner-Complete; mirrors Rust `on_complete_for_dead`)
- **Affects:** `packages/pure-ts/src/core/subscribe-error.ts` (new `subscribeOr` helper); `packages/pure-ts/src/core/index.ts` (export); `packages/pure-ts/src/extra/operators/{buffer,take,control,combine,time,higher-order}.ts` (25 sites migrated). All 3008 pure-ts tests pass post-migration.

### D134 — /qa F1: forwardInner Dead-path return-type widening (critical)
- **Date:** 2026-05-10
- **Context:** /qa Blind Hunter critical + Edge Hunter M4 surfaced the same bug: `forwardInner`'s subscribeOr-based shape returned a no-op `() => {}` on Dead inner, which the caller's outer-scope assignment (`innerUnsub = forwardInner(...)`) wrote into the slot AFTER the synchronous `onInnerComplete()` → `clearInner()` had nilled it. Concrete regressions: switchMap never self-completes after Dead inner (`if (!innerUnsub) a.down([[COMPLETE]])` evaluates against the truthy no-op); exhaustMap silently drops next outer DATA (`if (innerUnsub === undefined)` false); concatMap queue stuck (`if (!actions || innerUnsub !== undefined) return` returns early); mergeMap stores undefined-or-no-op in `innerStops` set.
- **Options:** α) Change `forwardInner` return type to `(() => void) | undefined`; switch to `trySubscribeOrDead` directly + outcome-match. β) Add a flag in shared closure state, callers check explicitly. γ) Defer until consumer reports.
- **Decision:** α — return-type widening + outcome match.
- **Rationale:** Smaller diff per caller (all already use `(() => void) | undefined` slot); explicit Dead return preserves the cleared state from `onInnerComplete`'s synchronous `clearInner()` chain. The previous bug was a subtle ordering issue inherent to subscribeOr's "always returns a cleanup closure" contract; widening to "may return undefined" makes the Dead path's "no cleanup needed" state representable.
- **Affects:** `packages/pure-ts/src/extra/operators/higher-order.ts` — `forwardInner` returns `(() => void) | undefined`; `mergeMap.spawn` guards `if (stop) innerStops.add(stop)`. No caller signature changes (all already assign to `(() => void) | undefined` slots). All 3008 pure-ts tests pass.

### D135 — /qa F3+F4+F5: combine.ts race / zip / merge terminated-guard fixes
- **Date:** 2026-05-10
- **Context:** /qa surfaced three related concurrency-window issues in `combine.ts`:
  - **F3 race:** `completedDead` only tracked Dead, not live-COMPLETE-without-DATA. Mixed Dead + live-completed scenarios never self-completed.
  - **F4 zip:** `zipTerminated` flag set in onDead but never checked in the live-msg COMPLETE/ERROR branches → could fire double-COMPLETE.
  - **F5 merge:** synchronous Dead handler's `a.down([[COMPLETE]])` mid-subscribe-loop left subsequent iterations subscribing into an already-terminated operator (unsubs leaked).
- **Decisions (all auto-applied):**
  - F3: rename `completedDead` → `completed`; track from both branches; add `raceTerminated` flag for double-COMPLETE prevention.
  - F4: add `zipTerminated` checks in live-msg COMPLETE/ERROR; for-loop entry guard.
  - F5: add `terminated` flag to merge; for-loop entry guard; live-msg COMPLETE/ERROR branches check + set.
- **Affects:** `packages/pure-ts/src/extra/operators/combine.ts` race / zip / merge implementations. All 3008 pure-ts tests pass.

### D136 — /qa F6: TS audit scope clarification (sources/patterns carry-forward)
- **Date:** 2026-05-10
- **Context:** /qa Edge Hunter M3 surfaced that D133's "TS operator audit RESOLVED" strikethrough was scoped too broadly — only `extra/operators/*` was migrated; `extra/sources/{settled.ts, async.ts}` still has ~8 raw `source.subscribe(...)` calls in `firstWhere` / `firstValueFrom` / `subscribeAndAwaitDone` / async-iter paths that will throw uncaught `TornDownError` on dead upstreams. Patterns-layer not swept either.
- **Decision:** Update `porting-deferred.md` D127 entry from `~~strikethrough~~` to "PARTIALLY RESOLVED (scope: extra/operators)" + add explicit remaining-scope carry-forward bullet for sources/patterns audit.
- **Rationale:** Document the actual scope to prevent future maintainers from missing the gap. Don't widen the audit now — consumer pressure (e.g. someone calling `firstValueFrom(dead)`) will drive prioritization.
- **Affects:** `~/src/graphrefly-rs/docs/porting-deferred.md` D127 entry.

### D137 — /qa doc + test polish batch
- **Date:** 2026-05-10
- **Context:** /qa surfaced 15+ minor findings around docs, test assertions, and rustdoc strength.
- **Decisions (auto-applied):**
  - `migration-status.md` typo fix: "2 TS test assertion updates" → "2 Rust test assertion updates".
  - `mount.rs::signal_invalidate_skips_destroyed_subtree` tightened: assert child still in mount tree (proves destroyed-skip path exercised); pre-invalidate cache snapshot + post-invalidate equality check (state nodes preserve cache per R2.2.8 ROM, so post must equal pre).
  - `phase_g_op_scratch.rs`: `_diag` → `_keep_alive`; explicit baseline assertions (`assert_eq!(baseline, 2)`, `assert_eq!(refcount(seed), 3)` post-registration); seed-aliasing assertion uses `> baseline` rather than weak `> 0`.
  - `boundary.rs`: `BindingBoundary::release_handle` + `retain_handle` rustdoc strengthened with HARD leaf-operation contract — explicit list of forbidden operations (any Core::emit / subscribe / register* / etc.) and safe operations (registry bookkeeping, logging, leaf-op binding methods).
  - `node.rs CoreState.pending_scratch_release`: rustdoc note on growth bound (N entries per N non-terminal deactivate cycles since last terminal-reset; typical O(few KB); degenerate workloads should call complete()/error() periodically).
  - `common/mod.rs::with_all_partitions_held`: rustdoc scope caveats — new partitions inside closure NOT pre-held; cross-Core out of scope; retry-validate panic possibility.
  - `time.ts throttle`: live-COMPLETE now flushes trailing pending (symmetry with debounce's live-COMPLETE + with throttle's own Dead branch).
  - New defer entries in `porting-deferred.md`:
    - `release_handles` / `release_handle` lock-held during Phase 3/3b/5 (established pattern, expanded by D-α).
    - `signal_invalidate` unbounded recursion stack overflow risk.
    - `DescribeValue::Rendered(Value::Null)` JSON-indistinguishable from sentinel-cache `None`.
- **Affects:** docs (`migration-status.md`, `porting-deferred.md`); rustdoc on `boundary.rs` + `node.rs`; tests (`mount.rs`, `phase_g_op_scratch.rs`); operator semantics (`time.ts`). All 539 cargo + 142 parity + 3008 pure-ts tests pass.

### D138 — M4.A canonical-JSON algorithm: serde_json route through `Value` (not hand-roll, not RFC 8785)
- **Date:** 2026-05-10
- **Context:** WAL frame SHA-256 checksum must be byte-identical across TS / Rust (spec §a — `GRAPHREFLY-SPEC.md:1201-1206`). TS's `stableJsonString` is "recursively sort object keys, then `JSON.stringify(_, undefined, 0)`". Rust needs an equivalent canonical encoder.
- **Options:** A) `serde_jcs` crate (RFC 8785 canonical JSON — exhaustive but doesn't match TS algorithm bit-for-bit, especially for numbers); B) hand-roll a recursive key-sort canonicalizer; C) route through `serde_json::Value` → `serde_json::Map` (BTreeMap-backed by default) → `serde_json::to_string` (sorted iteration falls out of BTreeMap).
- **Decision:** C — pick this for Rust then assert TS/PY match. Verified post-implementation that TS already produces the same output for the WAL schema; no TS/PY backport needed.
- **Rationale:** (a) `serde_json::Map<String, Value>` is a type alias for `BTreeMap<String, Value>` when the (off-by-default) `preserve_order` feature isn't enabled; iteration is sorted-by-key by construction. (b) Routing typed structs through `to_value` flattens to `Map` recursively — sorting is recursive too. (c) Zero new deps (serde_json already workspace). (d) Algorithm matches TS bit-for-bit on the WAL frame schema (ASCII keys, integer numerics, no floats). Parity caveats — UTF-16-vs-UTF-8 sort divergence on non-BMP keys, float subnormal divergence — documented in `wal.rs` module doc; lifts when a real consumer surfaces non-ASCII identifiers / float payloads.
- **Affects:** `crates/graphrefly-storage/src/wal.rs::canonical_json` (3 LOC). Parity fixture at `wal.rs::checksum_parity_fixture_minimal_frame` pins the byte-identical output (hand-canonicalized JSON + SHA-256 hex computed via `shasum -a 256`).

### D139 — M4.A `Version` field: `enum { Counter(u64), Cid(String) }` with `#[serde(untagged)]`
- **Date:** 2026-05-10
- **Context:** TS `BaseChange<T>.version` is typed `number | string` (V0 counter vs V1+ CID). Rust port needs an enum that serializes bit-identical to either form on the wire.
- **Options:** A) `enum Version { Counter(u64), Cid(String) }` with `#[serde(untagged)]`; B) `String` only (would break wire parity since TS V0 serializes as JSON number); C) `serde_json::Value` — too loose.
- **Decision:** A.
- **Rationale:** `#[serde(untagged)]` makes serialization emit a bare number for `Counter` and a bare string for `Cid` — wire-identical to TS's `number | string` union. Deserialization tries variants in declaration order; numbers parse as `Counter` and strings parse as `Cid`. Mixed-type sequences across versions remain user-resolved per spec.
- **Affects:** `crates/graphrefly-structures/src/changeset.rs::Version`.

### D140 — M4.A `BaseChange<T>` lives in `graphrefly-structures` (not `graphrefly-storage`)
- **Date:** 2026-05-10
- **Context:** TS has `BaseChange<T>` in `extra/data-structures/change.ts` because reactive Map/List/Log/Index emit them. Rust port: where should it live? Options span storage (M4) and structures (M5).
- **Options:** A) Live in `graphrefly-storage` (storage-internal type, structures port lifts it later); B) Live in `graphrefly-structures` even though that crate is otherwise blocked on M5 (just add the changeset module now, defer the reactive collections); C) Live in `graphrefly-core` (forces everyone to depend on it).
- **Decision:** B — new `changeset` module in `graphrefly-structures`; `graphrefly-storage` consumes via `graphrefly-structures = { workspace = true }`.
- **Rationale:** Many sites that need changeset/diff envelopes (storage WAL frames, bridge wire format, M5 reactive structures) all consume the same type. Putting it close to its primary emitters (reactive structures) matches the TS architecture without requiring a future migration when M5 lands. Dep chain stays acyclic (`storage → structures → graph → core`). The `serde-support` feature gates the codec footprint so structures consumers that don't need serde stay light.
- **Affects:** `crates/graphrefly-structures/src/changeset.rs` (new); `crates/graphrefly-structures/Cargo.toml` (dev-dep `serde_json` for tests); `crates/graphrefly-storage/Cargo.toml` (new dep on structures).

### D141 — M4.A checksum field type: `String` (hex), not `[u8; 32]`
- **Date:** 2026-05-10
- **Context:** TS ships SHA-256 as hex string because `jsonCodec` corrupts `Uint8Array` to numeric-keyed dict on JSON round-trip. Rust serde-cbor / serde-json handles `[u8; 32]` natively but would serialize differently from TS unless we constrain the codec.
- **Options:** A) `[u8; 32]` field, serialize as raw bytes (CBOR-friendly, breaks JSON round-trip parity with TS); B) `String` field, 64-char lowercase hex (wire-parity with TS, ~2× bytes on disk vs raw).
- **Decision:** B.
- **Rationale:** Cross-impl WAL readability is the constraint that wins. The 32-byte vs 64-char overhead is trivial relative to the frame payload size. M4.E parity tests will assert byte-identical files across TS / Rust impls; this field shape makes that assertion easy.
- **Affects:** `WALFrame::checksum: String`.

### D142 — M4.A slice scope: substrate-only (no tier traits, no backends, no Graph integration)
- **Date:** 2026-05-10
- **Context:** M4 storage is ~1200+ TS lines of substrate before Graph integration — too big for one slice. Need to break it into landable sub-slices.
- **Options:** A) Land M4 in one mega-slice (~3000-5000 Rust LOC); B) M4.A substrate-only (WAL frame type + checksum + errors), then M4.B tier traits + memory backend, then M4.C file backend, then M4.D redb backend, then M4.E Graph integration, then M4.F parity tests; C) Skip ahead to M4.E directly (no substrate work, just port everything).
- **Decision:** B with M4.A landing first.
- **Rationale:** M4.A is self-contained (~370 LOC + 19 tests), gives M4.B-F a stable target, and lets the substrate parity-fixture lock byte-equivalence with TS before tier abstractions arrive. Other sub-slices can land out of order based on consumer pressure (e.g. M4.D redb might land before M4.C file if a real consumer surfaces).
- **Affects:** Sequencing of M4 sub-slices. Migration-status M4 row stays 🟢 ready; new "M4.A — landed 2026-05-10" section documents what landed.

### D143 — M4.B `StorageBackend` + `BaseStorageTier` API: sync, NOT async
- **Date:** 2026-05-10
- **Context:** TS uses `void | Promise<void>` polymorphism (sync OR async backends interchangeable). Rust needs to pick a shape.
- **Options:** A) All sync — `fn save(&self, ...)`; memory/redb/std::fs all work; tokio backends wrap async surface at adapter layer; B) Async via `async_trait` macro — every method `async fn`, matches TS Promise-shape; C) Dual sync + async traits.
- **Decision:** A — sync everywhere.
- **Rationale:** redb is sync; the hot path (Graph wave-close → tier flush) is sync in the dispatcher. The actual data flow for the M4.B-D scope (memory + file + redb) is fully sync-compatible. Forcing async semantics through everywhere via `async_trait` adds `Pin<Box<dyn Future>>` overhead per call and pulls async-trait machinery for no measurable benefit. Network-backed backends (M4 post-1.0) can wrap their async surface via `tokio::Handle::block_on` at the adapter layer. CLAUDE.md "No async runtime in Core" stays preserved; `tokio` only enters at M4.E (Graph integration) via the reactive timer source — not at the storage layer.
- **Affects:** `StorageBackend` trait, `BaseStorageTier` trait, all sub-traits. Codec is sync via Q4 — `encode(&T) -> Result<Vec<u8>, _>`. `list_by_prefix_bytes` returns sync `Iterator`, not `Stream`.

### D144 — M4.B `debounce_ms` semantics: API surface lands, runtime semantics defer to M4.E
- **Date:** 2026-05-10
- **Context:** TS uses `setTimeout`-driven flush at the tier level; Rust has no sync timer. Without `tokio::time::sleep` (which would require pulling tokio into storage) or a per-tier OS thread (CLAUDE.md "no polling"), the tier can't drive a debounce timer itself.
- **Options:** A) Defer the knob entirely (drop `debounce_ms` from options + accessor; add at M4.E); B) Ship the API surface, runtime is "buffer until explicit flush"; tier-level no-op; document carry-forward; C) Land tier-level tokio-driven timers (pulls tokio into storage, complicates the sync-only D143 invariant); D) Per-tier OS thread (forbidden by CLAUDE.md "no polling").
- **Decision:** B.
- **Rationale:** `debounce_ms` is correctly tier-level **metadata** that the Graph layer should consume. Architectural split: tier owns the buffer; Graph schedules `flush()` via its own reactive timer (`from_timer` / `from_cron`) at attach time. This is a deliberate Rust-port refinement over TS's tier-level setTimeout — concentrating timer ownership at Graph removes the double-spend when both Graph and tiers each try to drive timers. M4.B ships the field + accessor; M4.E wires the timer. Users who want debounced flush before M4.E call `tier.flush()` explicitly.
- **Affects:** `SnapshotStorageOptions` / `KvStorageOptions` / `AppendLogStorageOptions` carry `debounce_ms: Option<u32>`. `BaseStorageTier::debounce_ms() -> Option<u32>` accessor. Buffer-until-flush behavior documented inline at `tier.rs` module doc + `porting-deferred.md` lift entry.

### D145 — M4.B `list_by_prefix_bytes` dyn-safety: bytes-level on `BaseStorageTier`, typed via free helpers
- **Date:** 2026-05-10
- **Context:** TS `listByPrefix<U>(prefix): AsyncIterable<{key, value: U}>` is a generic method on `BaseStorageTier`. Rust generic methods on trait objects are not dyn-safe — `&dyn BaseStorageTier` couldn't call this.
- **Options:** A) Bytes-level on `BaseStorageTier` (`list_by_prefix_bytes -> Box<dyn Iterator<Item = Result<(String, Vec<u8>), _>>>`), typed decoding via free helpers (`wal::iterate_wal_frames<T>(tier, prefix)`); B) Typed on each sub-trait only (`SnapshotStorageTier<T>::list_by_prefix`), losing `&dyn BaseStorageTier` enumeration; C) Type-erased `Box<dyn Any>` yields.
- **Decision:** A.
- **Rationale:** Matches the M4.A `iterate_wal_frames<T>(tier, prefix)` shape — bytes-level enumeration is the dyn-safe primitive; typed helpers decode at the consumption site. Mirrors how `serde`'s `Serializer` is dyn-safe while typed encoding is via generic free functions. Concrete generic tier structs still expose typed convenience methods (`KvStorage::load(key) -> Result<Option<T>>`); the trait surface stays narrow + dyn-compatible. New `ListByPrefixIter<'a>` type alias keeps the signature readable + satisfies clippy's complex-type lint.
- **Affects:** `BaseStorageTier::list_by_prefix_bytes`, `tier::ListByPrefixIter<'a>`, internal `PrefixIter<B>` adapter.

### D146 — M4.B tier impl strategy: concrete generic structs + trait impls (not `impl Trait` factories or `Box<dyn>`)
- **Date:** 2026-05-10
- **Context:** TS factories return interfaces — caller codes against `BaseStorageTier`. Rust options for factory shape: `impl Trait`, `Box<dyn>`, concrete struct.
- **Options:** A) `impl SnapshotStorageTier<T>` — opaque, static dispatch only; B) `Box<dyn SnapshotStorageTier<T> + Send + Sync>` — dyn cost everywhere; C) Concrete generic struct (`SnapshotStorage<B, T, C>`) with trait impls.
- **Decision:** C.
- **Rationale:** Caller gets both static dispatch (concrete type via factory return) AND dyn-safety (cast to `&dyn SnapshotStorageTier<T>` for heterogeneous Vec storage). Matches `redb::Database` / `tokio::fs::File` ergonomics — concrete struct first, traits second. Generic `<B, T, C>` lets the same struct serve any backend + codec combo without separate types per pair.
- **Affects:** `SnapshotStorage<B, T, C>` / `AppendLogStorage<B, T, C>` / `KvStorage<B, T, C>` with `C: Codec<T>` default to `JsonCodec`.

### D147 — M4.B backend ownership: `Arc<B>` with generic `B`, not `Box<dyn>` or owned-move
- **Date:** 2026-05-10
- **Context:** Graph attaches multiple tiers; tiers may share a backend (`{ snapshot, wal }` paired-tier shape from DS-14-storage §a).
- **Options:** A) `SnapshotStorage<B>` owns `B` by move — one backend per tier; B) `Arc<B>` with generic `B` — shared backend across tiers, static dispatch on B; C) `Arc<dyn StorageBackend + Send + Sync>` — full type erasure.
- **Decision:** B — `Arc<B>` with `B: StorageBackend + ?Sized`.
- **Rationale:** Multi-tier-sharing-one-backend is the canonical pattern. TS does `attachStorage([{ snapshot: snapshotStorage(b), wal: kvStorage(b) }])` with `b` reused. The `?Sized` bound on `B` lets users pass either a concrete `Arc<MemoryBackend>` (static dispatch) OR `Arc<dyn StorageBackend>` (type-erased Vec). Best of both worlds — type-driven by default, erasable when needed.
- **Affects:** `SnapshotStorage::backend: Arc<B>`, factories take `Arc<B>`.

### D148 — M4.B `Codec<T>`: zero-sized `JsonCodec` implementing `Codec<T>` for all `T: Serialize + DeserializeOwned`
- **Date:** 2026-05-10
- **Context:** TS `jsonCodec` is `Codec<unknown>`; consumers cast. Rust can be more typed.
- **Options:** A) Generic struct `JsonCodec<T>(PhantomData<T>)` — typed by construction, more type parameter noise; B) Zero-sized `JsonCodec` implementing `Codec<T>` for all `T: Serialize + DeserializeOwned + Send + Sync` — one unit struct usable for any T; C) Free function `json_codec<T>() -> impl Codec<T>` returning opaque impl.
- **Decision:** B.
- **Rationale:** Less type-parameter noise at consumption sites — caller writes `JsonCodec` and the trait bound at the tier struct's `C: Codec<T>` does the rest. Matches the `serde_json::to_string` / `to_value` shape (no T on the encoder side). Canonical JSON encoding (sorted keys via the `to_value` → BTreeMap → `to_vec` route) matches TS `jsonCodec` byte-for-byte on the value schemas Graph emits.
- **Affects:** `codec::JsonCodec`, `Codec<T>` trait, default `C = JsonCodec` on the three tier structs.

### D149 — M4.B `key_of` / `filter` closures: `Option<Box<dyn Fn(...) + Send + Sync>>`, not generic type params
- **Date:** 2026-05-10
- **Context:** TS `keyOf?: (T) => string` and `filter?: (T) => boolean` are stored as optional functions. Rust options: boxed `dyn Fn` vs generic type params.
- **Options:** A) `Option<Box<dyn Fn(&T) -> String + Send + Sync>>` — boxed dyn, matches TS optional-function shape; B) Generic type params `K: Fn(&T) -> String` — static dispatch, more type parameters; C) Concrete enum variants for common cases.
- **Decision:** A.
- **Rationale:** Closures are uncommon enough that boxing is fine (one virtual call per save). Static-dispatch generics here would force every tier consumer to spell out closure types — `SnapshotStorage<MemoryBackend, Snap, JsonCodec, impl Fn(&Snap) -> String + Send + Sync, impl Fn(&Snap) -> bool + Send + Sync>` is unusable. Default `key_of` falls back to a captured closure returning `tier.name`. Clippy `type_complexity` lint kept happy by extracting `FilterFn<T>` / `KeyOfFn<T>` / `KvFilterFn<T>` type aliases.
- **Affects:** `SnapshotStorageOptions::filter` / `key_of`, `KvStorageOptions::filter`, `AppendLogStorageOptions::key_of`.




### D150 — /qa F2: `compact_every` boundary-crossing trigger (cross-impl)
- **Date:** 2026-05-10
- **Context:** /qa surfaced that strict-modulo trigger (`count % N == 0`) skips the trigger when a batch save jumps multiple `compact_every` boundaries. `append_entries(&[5_items])` with `compact_every=3` bumps count 0→5; `5 % 3 != 0` → no flush. Pre-fix Rust + TS both had this gap.
- **Options:** A) Match TS modulo and document the batch gap; B) Boundary-crossing trigger (`prev / N != new / N`) in both impls; C) Defer.
- **Decision:** B — apply boundary-crossing to all 3 tier impls in Rust AND TS.
- **Rationale:** F2 is a real correctness gap for batch save APIs; the AppendLog tier already exposes the batch surface (`append_entries`). Boundary-crossing is semantically equivalent for single-save callers (count crosses one boundary per save) and correct for batch saves (one flush per boundary). Cross-language coordination preserves cross-impl behavior parity for the cadence semantic.
- **Affects:** Rust `crates/graphrefly-storage/src/memory.rs` (3 sites); TS `packages/pure-ts/src/extra/storage/tiers.ts` (3 factories: `snapshotStorage`, `appendLogStorage`, `kvStorage`).

### D151 — /qa A1: Snapshot compact-trigger race fix
- **Date:** 2026-05-10
- **Context:** Pre-fix `SnapshotStorage::save` released the pending lock between writing `pending = Some(snapshot)` and calling `flush()`. A concurrent save could overwrite pending in that window — the wrong snapshot persists.
- **Decision:** Hold pending lock across the count update + trigger decision + capture; if trigger fires, take pending atomically with the decision.
- **Rationale:** Closes a real race window with minimal restructure. Pending capture is now atomic with the trigger decision; the snapshot that caused the cadence is the one persisted.
- **Affects:** `crates/graphrefly-storage/src/memory.rs:206-240`.

### D152 — /qa A2: `KvStorage::delete` error-path ordering swap
- **Date:** 2026-05-10
- **Context:** Pre-fix order: `pending.lock().remove(key); self.backend.delete(key)`. If `backend.delete` fails, pending is gone but backend still holds the old value — silent stale-read on next `load(key)`.
- **Decision:** Swap order — `backend.delete(key)?` THEN `pending.remove(key)`. Failure leaves pending intact so caller can retry.
- **Rationale:** Matches the canonical error-recovery shape: side effects fire first, local state updates only on success.
- **Affects:** `crates/graphrefly-storage/src/memory.rs:617-622`.

### D153 — /qa A3: `From<ChecksumError> for StorageError`
- **Date:** 2026-05-10
- **Context:** `wal_frame_checksum` returns `Result<String, ChecksumError>`. `StorageError` had no `From<ChecksumError>` impl, so M4.E call sites would need explicit error mapping at every checksum call.
- **Decision:** Add `From<ChecksumError> for StorageError` mapping `CanonicalJsonFailed(serde_json::Error) → Codec(CodecError::Encode(err.to_string()))`.
- **Rationale:** Lets `?` propagate checksum failures at the tier-flush boundary without boilerplate. The canonical-JSON failure is semantically a codec-encode failure; the variant choice is consistent.
- **Affects:** `crates/graphrefly-storage/src/error.rs`.

### D154 — /qa A4: Reject `compact_every: Some(0)` at construction
- **Date:** 2026-05-10
- **Context:** `Some(0)` was silently equivalent to `None` because the `matches!` guard `n > 0` short-circuited. Pre-1.0 footgun.
- **Decision:** Panic with clear diagnostic in all 3 factory functions ("use `None` to disable; `Some(n)` requires n >= 1").
- **Rationale:** Pre-1.0; loud failure is preferable to silent no-op. Three `#[should_panic]` tests pin the behavior. TS-side has the same silent-no-op behavior; left as-is for now (TS users see a different stack trace shape but the behavior is equally permissive — flag for cross-impl conformance review later if needed).
- **Affects:** `crates/graphrefly-storage/src/memory.rs` `snapshot_storage` / `kv_storage` / `append_log_storage` factories.

### D155 — /qa A10: `preserve_order` feature canary test
- **Date:** 2026-05-10
- **Context:** Canonical-JSON parity depends on `serde_json::Map<String, Value>` being `BTreeMap`-backed (sorted iteration). If any workspace consumer enables `serde_json/preserve_order` via Cargo feature unification, `Map` switches to `IndexMap` (insertion-order) and parity silently breaks.
- **Decision:** Add a runtime canary test that builds a `Value::Object` with reverse-alphabetical insertion order and asserts `to_string` produces alphabetical output. Test fails loud with a diagnostic referencing `cargo tree -e features | grep preserve_order` if unification enables the feature.
- **Rationale:** Compile-time detection isn't straightforward (serde_json doesn't expose a `cfg` for `preserve_order` in downstream crates). The runtime canary is cheap (one assertion in unit tests) and high-signal.
- **Affects:** `crates/graphrefly-storage/src/wal.rs::tests::preserve_order_feature_is_not_enabled`.

### D156 — /qa A11: Remove redundant `prefix_owned` allocation in `PrefixIter::new`
- **Date:** 2026-05-10
- **Context:** Pre-fix had `let prefix_owned = prefix.to_string(); keys.retain(|k| k.starts_with(&prefix_owned));`. The String clone is unnecessary because `starts_with` accepts `&str` via `Pattern`.
- **Decision:** Drop the clone; pass `prefix: &str` directly to `starts_with`.
- **Rationale:** One String allocation per `list_by_prefix_bytes` call eliminated; minor perf win without changing correctness.
- **Affects:** `crates/graphrefly-storage/src/tier.rs:206-213`.

### D157 — /qa A5+A6+A7+A8+A13: test surface widening
- **Date:** 2026-05-10
- **Context:** Multiple test-coverage gaps surfaced by /qa: only `Lifecycle::Data` had a parity fixture; only `seq: None` was tested; `WalTag` deserialization tests only covered "wrong string"; filter+compact_every interaction was un-tested; `WALFrame<()>` and `WALFrame<serde_json::Value>` round-trips weren't pinned.
- **Decision:** Add 12 new tests covering each gap.
- **Rationale:** Each gap was at least plausible regression risk. Locking byte-equivalence for all 3 Lifecycle variants closes a parity-drift hole at the canonical-JSON layer. The boundary-crossing F2 fix also needed regression tests covering the batch-save + multi-boundary scenarios.
- **Affects:** `crates/graphrefly-storage/src/wal.rs::tests` (6 new), `crates/graphrefly-storage/tests/tier.rs` (6 new test groups including 3 panic tests + boundary tests + filter+compact interaction + backend.delete error path).

### D158 — M4.C `FileBackend` API shape: struct + builder + `Arc` factory
- **Date:** 2026-05-10
- **Context:** Need a public surface for the file backend that mirrors `MemoryBackend` precedent while exposing the new `include_hidden` filter without options-struct creep.
- **Options:** A) `FileBackend::new(dir)` + `file_backend(dir) -> Arc<FileBackend>` + consuming builder method `with_include_hidden(bool)`. B) Add a `FileBackendOptions { include_hidden: bool }` struct + `FileBackend::with_options(dir, opts)` constructor. C) Free-function variants `file_backend(dir)` + `file_backend_with_options(dir, opts)`.
- **Decision:** A. Constructor + Arc factory + consuming-self builder method.
- **Rationale:** One configuration knob doesn't warrant an options struct. Builder pattern is chainable and extensible — future knobs (e.g. `with_fsync(true)` post-1.0) add methods without breaking callers. `file_backend(dir)` matches `memory_backend()` precedent for the common Arc-shared case; non-default config goes through `Arc::new(FileBackend::new(dir).with_include_hidden(true))`.
- **Affects:** `crates/graphrefly-storage/src/file.rs` `FileBackend` struct + `file_backend` factory.

### D159 — M4.C key→filename encoding: byte-identical with TS `pathFor` / `keyFromFilename`
- **Date:** 2026-05-10
- **Context:** Cross-impl files-on-disk should be interchangeable: a Rust-written `.bin` must load with TS's `fileBackend(dir)` and vice versa. TS uses `[a-zA-Z0-9_-]` unencoded + lowercase `%xx` UTF-8 escape; Rust must match exactly.
- **Options:** A) Match TS byte-for-byte (`is_ascii_alphanumeric() || ch == '_' || ch == '-'`; lowercase hex). B) Rust-idiomatic stricter encoder (reject control chars outright; require explicit opt-in for non-ASCII). C) Use `percent-encoding` crate's `NON_ALPHANUMERIC` set.
- **Decision:** A. Hand-rolled encoder matching TS exactly. Decode also matches TS edge cases (truncated `%x` falls through to literal bytes; invalid-hex falls through; case-insensitive hex).
- **Rationale:** Cross-impl byte parity is the load-bearing requirement; even minor encoder divergence breaks file interop. The `percent-encoding` crate would import a different char set and introduce a code dep for ~30 lines of logic. Hand-rolled mirrors TS algorithmically and includes a test for each encoder/decoder branch + non-ASCII rejection on the decode side (filenames containing literal non-ASCII chars can't have come from our encoder).
- **Affects:** `crates/graphrefly-storage/src/file.rs` `encode_key_to_filename` / `decode_filename_to_key` / `nibble` helpers.

### D160 — M4.C atomic-rename via `tempfile::NamedTempFile::persist`, NOT hand-rolled temp + rename
- **Date:** 2026-05-10
- **Context:** TS uses `randomBytes(8) + writeFileSync + renameSync`; Rust can either replicate or use `tempfile::NamedTempFile`. The `tempfile` crate is already a workspace dep gated behind the `file` feature.
- **Options:** A) `NamedTempFile::new_in(&dir)?.persist(target)?` — idiomatic Rust; Drop-cleanup if `persist` never called. B) Hand-rolled `random` filename + `File::create` + `rename` (1:1 TS algorithm port).
- **Decision:** A. Use `NamedTempFile::persist` with overwriting semantics (NOT `persist_noclobber`).
- **Rationale:** Semantically identical to TS — same-dir atomic rename on POSIX + Windows REPLACE_EXISTING — but with RAII cleanup for the temp file on panic between create and commit (the TS catch-block-unlink shape, automated by Drop). `persist` (overwriting) matches TS `renameSync` for the common overwrite case (snapshot save); `persist_noclobber` would error on the second save of the same key, which doesn't match TS semantics. The leading-`.` prefix in `NamedTempFile`'s default (`.tmpXXXXXX`) also serves as a free natural hidden-filter for D161.
- **Affects:** `crates/graphrefly-storage/src/file.rs` `StorageBackend::write` impl.

### D161 — M4.C `include_hidden` filter — configurable, default `false`
- **Date:** 2026-05-10
- **Context:** Default `list()` should exclude in-flight tempfile names (`tempfile::NamedTempFile` uses leading-`.` `.tmpXXXXXX` prefix). But that filter also hides legitimate keys whose percent-encoding produces a leading-`.` filename (rare but possible — e.g. user explicitly writes key `".hidden-app"`).
- **Options:** A) Always skip dotfiles. B) Always include. C) Configurable, default skip.
- **Decision:** C. `with_include_hidden(bool)` builder method, default `false`.
- **Rationale:** Default-skip is the safe choice — protects against concurrent-flush leakage with zero user opt-in. The override surfaces the rare case where the user actually wants dotfiles visible (e.g. encoded keys, or a debug `list()` over a directory that includes hand-placed dotfiles). The configurable knob is preferable to forcing all-or-nothing because both extremes have legitimate use cases. Note: even with `include_hidden: true`, filenames without `.bin` suffix are still filtered (so the `tempfile` `.tmpABCDEF` raw names without `.bin` still don't leak).
- **Affects:** `crates/graphrefly-storage/src/file.rs` `FileBackend::with_include_hidden` + `list()`.

### D162 — M4.D table strategy: single `"graphrefly"` table for all keys
- **Date:** 2026-05-11
- **Context:** `RedbBackend` needs a table layout. Tiers already namespace keys via prefixes (`"graph/wal/00000..."`, `"snapshot:my-graph"`, etc.).
- **Options:** A) Single `"graphrefly"` table — flat kv matching MemoryBackend/FileBackend. B) Per-tier table — requires `RedbBackend` to know tier name at construction or dynamically create tables.
- **Decision:** A. Single table. Tiers namespace via key prefixes.
- **Rationale:** Matches the flat-kv model of the other two backends. Simpler, no dynamic table management, consistent StorageBackend contract. Per-tier tables add complexity without benefit at the StorageBackend layer.
- **Affects:** `crates/graphrefly-storage/src/redb.rs` `TABLE` const.

### D163 — M4.D write granularity: per-call ACID transaction
- **Date:** 2026-05-11
- **Context:** Each `StorageBackend::write()` call could either commit its own transaction (like FileBackend's atomic rename) or batch writes into a held transaction committed on `flush()`.
- **Options:** A) Per-write transaction — simple, matches FileBackend pattern, ACID per call. B) Batched transaction committed on `flush()` — cross-key atomicity but changes StorageBackend contract semantics.
- **Decision:** A. Per-write transaction.
- **Rationale:** The tier layer already buffers; by the time bytes reach the backend, each `write()` is one logical unit. Per-write transactions structurally close F3 (concurrent flush race — redb serializes writers). Cross-key atomicity is a M4.E concern (Graph-level batched flush).
- **Affects:** `crates/graphrefly-storage/src/redb.rs` `StorageBackend::write` + `flush` impls.

### D164 — M4.D compact semantics: `Database::compact()` for space reclamation
- **Date:** 2026-05-11
- **Context:** Q8 `truncate_on_compact: true` default for Rust. Tier-level compact truncates WAL prefix keys (tier calls `backend.delete(old_key)` per truncated frame); backend-level compact reclaims freed space.
- **Options:** A) `RedbBackend::compact()` = no-op. B) `RedbBackend::compact()` = `db.compact()`.
- **Decision:** B. `compact()` delegates to `db.compact()`.
- **Rationale:** After tier-level truncation deletes WAL keys, redb's B-tree retains the freed pages. `Database::compact()` reclaims them. The tier owns the "what to delete" logic; the backend owns the "reclaim space" logic.
- **Affects:** `crates/graphrefly-storage/src/redb.rs` (currently uses default `BaseStorageTier::compact` which calls `flush`; backend-level compact is a future addition when the RedbBackend surface grows).

### D165 — F1 tier-level pending data loss fix (take-then-restore)
- **Date:** 2026-05-11
- **Context:** Pre-fix, all three tier `flush()` impls used `mem::take` on pending state BEFORE encode/write. If encode failed or write failed, pending was already gone — data lost, no retry path. This was the F1 deferred concern from M4.B /qa.
- **Options:** A) Clone pending before take (requires T: Clone). B) Take-then-restore on error (returns T back to pending via error tuple). C) Defer to M4.D redb (redb transactions mask the issue at the backend level).
- **Decision:** B. Restructured `SnapshotStorage::try_flush` to return `Err((T, StorageError))` on failure so the caller can restore pending. KV and AppendLog flush restructured to restore remaining unprocessed entries on error.
- **Rationale:** B works without adding `T: Clone` bounds (which would be a public API change). The structural fix returns ownership of the unconsumed value on error. Redb transactions (D163) close the backend-level race, but the tier-level encode failure was still losing data — now fixed.
- **Affects:** `crates/graphrefly-storage/src/memory.rs` — all three flush impls + `SnapshotStorageTier::save`.

### D166 — M4.E1 BindingBoundary extension: `serialize_handle` / `deserialize_value`
- **Date:** 2026-05-11
- **Context:** `Graph::snapshot()` needs to serialize user values (which live binding-side) into portable JSON. Core only holds `HandleId`. Snapshot must cross the cleaving plane.
- **Options:** A) Extend `BindingBoundary` with `serialize_handle(HandleId) -> Option<serde_json::Value>` and `deserialize_value(serde_json::Value) -> HandleId`. B) Keep snapshots at HandleId level; let binding layer wrap with value serialization. C) Use `DebugBindingBoundary` (already exists for describe rendering).
- **Decision:** A. Two new default methods on `BindingBoundary`.
- **Rationale:** B defeats the purpose of snapshots (they wouldn't survive process restart). C conflates debug rendering with persistence serialization (different fidelity needs). A cleanly extends the cleaving plane for the persistence use case — binding owns the value→JSON and JSON→value mapping.
- **Affects:** `graphrefly-core::BindingBoundary` trait; all binding impls (`TestBinding`, napi-rs, pyo3, wasm).

### D167 — M4.E1 `Graph::from_snapshot` lives as associated fn on `Graph`
- **Date:** 2026-05-11
- **Context:** TS uses `Graph.fromSnapshot(data, opts?)` as a static method. Rust can do `Graph::from_snapshot(...)` or a free fn.
- **Options:** A) Associated fn `Graph::from_snapshot(...)`. B) Free fn `from_snapshot(...)`.
- **Decision:** A.
- **Rationale:** Mirrors TS ergonomics; discoverable via `Graph::` namespace; consistent with `Graph::new` / `Graph::with_existing_core` constructor family.
- **Affects:** `graphrefly-graph::Graph` public API.

### D168 — M4.E1 both `from_snapshot` modes (auto-hydration + builder)
- **Date:** 2026-05-11
- **Context:** TS `fromSnapshot` has two modes: (a) auto-hydration — reconstruct topology from snapshot; (b) builder — user provides builder fn, snapshot only restores state. Both are useful: (a) for cold boot from storage; (b) for tests and user-controlled topology.
- **Options:** A) Builder only, defer auto-hydration. B) Both modes.
- **Decision:** B.
- **Rationale:** Auto-hydration is needed for `Graph::fromStorage` (M4.E2) and is the primary cold-boot path. Builder mode is simpler but insufficient for the storage use case.
- **Affects:** `Graph::from_snapshot` signature — accepts an optional builder closure + optional factory registry.

### D169 — M4.E1 defer edges in snapshot
- **Date:** 2026-05-11
- **Context:** TS snapshot includes `edges` derived from deps. Rust `Graph::edges()` already computes these on demand. Including edges redundantly in snapshot adds cross-impl portability but also payload bloat.
- **Options:** A) Include edges (cross-impl portability). B) Omit edges (derived on demand).
- **Decision:** B (defer).
- **Rationale:** Edges are derived from deps (R3.3 — "edges derived, not stored"). Including them is a convenience for external tools; can be added later without breaking the snapshot format (additive field). Keeps the initial implementation lean.
- **Affects:** `GraphPersistSnapshot` struct — no `edges` field in v1.

### D170 — M4.E2 `attach_snapshot_storage` + `restore_snapshot` as free fns in graphrefly-storage
- **Date:** 2026-05-11
- **Context:** TS puts `attachSnapshotStorage` and `restoreSnapshot` as methods on `Graph`. In Rust, `graphrefly-graph` does not depend on `graphrefly-storage` (opposite direction: storage→graph). Circular deps are not allowed.
- **Options:** A) Free fns in `graphrefly-storage` (which already depends on `graphrefly-graph`). B) New integration crate. C) Reverse the dep direction.
- **Decision:** A.
- **Rationale:** Preserves the existing DAG. Free fns taking `&Graph` as first arg are ergonomic. No new crate overhead.
- **Affects:** `graphrefly-storage` public API; `attach_snapshot_storage(graph, pairs)` and `restore_snapshot(graph, opts)`.

### D171 — M4.E2 debounce timer wiring deferred
- **Date:** 2026-05-11
- **Context:** TS `attachSnapshotStorage` wires `ResettableTimer` for `debounceMs > 0` tiers. Rust has no `from_timer` reactive source yet; `std::thread::spawn` per tier violates CLAUDE.md "no polling".
- **Options:** A) Implement thread-based timer. B) Defer; sync-through only (`debounceMs=0`). C) Implement `from_timer` first.
- **Decision:** B.
- **Rationale:** Sync-through is the primary production mode. Timer wiring lands when reactive timer sources are ported (M5+ or a focused operators slice). `debounce_ms > 0` at attach triggers a clear warning.
- **Affects:** `attach_snapshot_storage` — `debounce_ms > 0` warns + treats as 0.

### D172 — M4.E2 snapshot-diff strategy for WAL frame generation
- **Date:** 2026-05-11
- **Context:** TS diffs two `GraphDescribeOutput` snapshots to produce WAL frames. Alternative: intercept individual messages at the observe level.
- **Options:** A) Diff two `GraphPersistSnapshot`s (simpler; already have the type from M4.E1). B) Diff `GraphDescribeOutput`s (mirrors TS exactly). C) Intercept messages in the observe sink.
- **Decision:** A.
- **Rationale:** `GraphPersistSnapshot` already carries JSON-serialized values and dep info. Simpler than going through describe (which adds handle→value rendering overhead at diff time). The diff output maps to the same WAL frame structure.
- **Affects:** New `diff_snapshots` + `decompose_diff_to_frames` fns in graphrefly-storage.

### D173 — M4.E2 manifest persistence at `<graph.name>/manifest` key
- **Date:** 2026-05-11
- **Context:** TS `SnapshotStorage::last_saved_key` is process-local; lost across restarts (F4). Manifest at `<graph.name>/manifest` provides cross-restart key recovery.
- **Options:** A) Implement now (closes F4). B) Defer.
- **Decision:** A.
- **Rationale:** Manifest is needed for reliable restore_snapshot and closes a known gap. Small effort (one JSON entry per baseline write + read on restore).
- **Affects:** `attach_snapshot_storage` writes manifest on baseline writes; `restore_snapshot` reads manifest for key recovery. Format: `{ snapshot_key, last_frame_seq, timestamp_ns }`.

### D174 — M4.E2 `key_of` derived from `graph.name` at attach boundary (closes F8)
- **Date:** 2026-05-11
- **Context:** TS default `key_of` peeks into snapshot's `name` field (structural erasure). Rust default `key_of` uses `tier.name`. Cross-impl divergence at the tier level. Graph-level attach can close this by deriving `key_of` from `graph.name`.
- **Options:** A) At attach, pass `key_of = |record| record.name.clone()`. B) Change the tier-level default.
- **Decision:** A.
- **Rationale:** Graph embeds its name in `GraphCheckpointRecord.name`. Deriving `key_of` from the record at the attach boundary eliminates the cross-impl divergence without changing tier-level defaults (which serve non-Graph use cases).
- **Affects:** `attach_snapshot_storage` passes `key_of` override to snapshot tier.

### D175 — M4.F napi-rs storage binding design
- **Date:** 2026-05-11
- **Context:** Parity tests need storage APIs accessible from JS via napi-rs. Storage types are generic over `B: StorageBackend`, `T`, `C: Codec`. napi-rs doesn't support generic structs. `attach_snapshot_storage` takes `Box<dyn Trait>` (ownership) but JS needs shared access to inspect tiers post-attach.
- **Options:** A) Single "BenchStorage" class hiding all internals. B) Per-type napi classes with Arc-wrapper newtypes for shared trait delegation. C) All-JSON boundary (pass config, Rust creates tiers internally).
- **Decision:** B — typed napi classes: `BenchMemoryBackend`, `BenchValueSnapshotTier`, `BenchValueKvTier`, `BenchValueAppendLogTier` (generic value tiers), `BenchCheckpointSnapshotTier`, `BenchWalKvTier` (graph-integration tiers), `BenchStorageHandle`. Arc-wrapper newtypes delegate trait impls so the same tier is shared between the napi class (for inspection) and `attach_snapshot_storage` (which takes `Box<dyn Trait>`). Graph integration as napi free functions, not BenchGraph methods, to avoid cross-module `#[napi] impl` blocks.
- **Rationale:** Typed classes give parity tests direct access to tier operations (save/load/flush/rollback) for verification. Arc sharing solves the ownership vs. inspection tension. Free functions avoid napi-rs multi-module impl-block risks.
- **Affects:** New `storage_bindings.rs` in graphrefly-bindings-js, gated on `#[cfg(feature = "storage")]`.

### D176 — M4.F parity test scope: all 4 tiers, runIf gating
- **Date:** 2026-05-11
- **Context:** Parity scenarios for storage covering Tier 1 (core tier ops), Tier 2 (WAL + attachment), Tier 3 (restore/replay), Tier 4+5 (backends, listing, errors). Rust arm available via napi bindings built in this slice.
- **Options:** A) Gate rustImpl with `test.runIf` until verified. B) Pure-ts-only tests lifted later.
- **Decision:** A — `describe.each(impls)` with `test.runIf(impl.name !== "rust-via-napi")` gating for any scenario where the rust binding doesn't yet support the operation. Build napi bindings in this slice so most scenarios run against both arms.
- **Rationale:** Maximizes parity validation surface. The binding work is bounded (memory backends only, no file/redb at napi boundary). runIf gating is acceptable for genuinely unsupported operations, unlike the F9 anti-pattern which gated entire test files.
- **Affects:** `packages/parity-tests/scenarios/storage-*/*.test.ts`, `packages/parity-tests/impls/types.ts` (Impl widening).

### D177 — M5.A Core-level reactive structure integration (not Graph-level)
- **Date:** 2026-05-11
- **Context:** Reactive data structures (Map, List, Log, Index) need to emit DIRTY→DATA snapshots on mutation. Two integration options: (C1) structures own a BindingBoundary impl, each type manages its own handle allocation; (C2) structures operate at Graph level via `Graph::state()` + `Graph::set()`.
- **Options:** A) Core-level — structures take `WeakCore` + `Arc<dyn BindingBoundary>`, register state nodes directly, manage handles themselves. B) Graph-level — structures take `&Graph` reference, use `graph.state()` + `graph.set()`.
- **Decision:** A — Core-level integration.
- **Rationale:** User requested standalone structures without Graph dependency. Matches TS where structures are standalone (no Graph required). Structures become building blocks that Graph can compose, not Graph-only consumers.
- **Affects:** `graphrefly-structures` depends on `graphrefly-core` only (drop `graphrefly-graph` dep for structures themselves). All 4 structures take `WeakCore` + `Arc<dyn BindingBoundary>` at construction.

### D178 — M5.A Vec default backends (imbl deferred)
- **Date:** 2026-05-11
- **Context:** Cargo.toml already depends on `imbl` for persistent collections. TS uses plain JS arrays/Maps as defaults. For Rust v1, Vec/HashMap is simpler and faster for small-to-medium collections. imbl gives O(log n) snapshot-and-revert but adds complexity.
- **Options:** A) Vec/HashMap defaults now, imbl backends as opt-in later. B) imbl from the start.
- **Decision:** A — Vec/HashMap defaults; imbl backends deferred until bench evidence justifies.
- **Rationale:** Simpler v1. The backend trait abstraction means imbl can slot in later without API changes. No current workload benefits from persistent-collection semantics yet.
- **Affects:** Default backends for all 4 structures use `Vec<T>` / `HashMap<K, V>`. `imbl` dep stays in Cargo.toml for future use.

### D179 — M5.A all 4 structures in single slice
- **Date:** 2026-05-11
- **Context:** Original plan was Log+List first (M5.A), Map+Index in M5.B. User requested bigger scope.
- **Options:** A) All 4 in one slice. B) Split into 2 slices.
- **Decision:** A — all 4 structures in M5.A with base operations.
- **Rationale:** Structures share the same integration pattern (Core-level state node, backend trait, change envelope). Implementing all 4 together avoids duplicating the design discussion and ensures consistent API shape. Advanced features (TTL, LRU, views, scan, attach) deferred to M5.B.
- **Affects:** M5.A scope covers ReactiveLog, ReactiveList, ReactiveMap, ReactiveIndex with base CRUD operations, backend traits, change envelope types, and mutation log companions.

### D180 — M5.B Arc<Mutex> refactoring for ReactiveLog subscription features
- **Date:** 2026-05-11
- **Context:** ReactiveLog views/scan/attach require closures that capture `inner` for read access inside Core subscriber callbacks. `Mutex<LogInner<T>>` can't be cloned into multiple closures.
- **Options:** A) `Arc<Mutex<LogInner<T>>>` (shared ownership). B) Unsafe pointer sharing. C) Channel-based approach.
- **Decision:** A — `Arc<Mutex<LogInner<T>>>` for ReactiveLog only.
- **Rationale:** Clean, safe, minimal overhead. Only ReactiveLog needs this change (subscription-based features). ReactiveList/Map/Index remain `Mutex<Inner>` since they have no subscription-based features in M5.B. `#![forbid(unsafe_code)]` preserved.
- **Affects:** `ReactiveLog.inner` field type, all closure captures in `view`/`scan`/`attach`/`attach_storage`.

### D181 — M5.B ReactiveMap::new returns Result for config validation
- **Date:** 2026-05-11
- **Context:** TTL + LRU + retention policies have mutual exclusivity constraints (LRU and retention are mutually exclusive). Need to validate at construction time.
- **Options:** A) Panic on invalid config. B) Return `Result<Self, MapConfigError>`. C) Silently ignore conflicting options.
- **Decision:** B — fallible construction.
- **Rationale:** Matches Rust conventions. Typed `MapConfigError` enum gives callers clear error handling. Existing callers add `.unwrap()` (test ergonomics preserved). Panicking on config errors is user-hostile; silent override hides bugs.
- **Affects:** All `ReactiveMap::new` call sites (7 in tests, updated to `.unwrap()`).

### D182 — M5.B attach ascending-order constraint (Phase H+ compliance)
- **Date:** 2026-05-11
- **Context:** `ReactiveLog::attach(upstream, read_value)` subscribes to upstream and emits to the log's `node_id` inside the callback. Core's Phase H+ ascending-order invariant requires subscriber-side emits to target nodes with higher `SubgraphId` than the source.
- **Options:** A) Document ordering constraint (upstream must be registered before the log). B) Create bridge node to ensure correct ordering. C) Use deferred emission queue.
- **Decision:** A — document the constraint. Callers must ensure upstream has a lower `SubgraphId` than the log.
- **Rationale:** TS doesn't have this constraint (single-threaded). The Rust Core's ascending-order invariant is fundamental to lock-free parallel dispatch. A bridge node adds complexity for minimal benefit. The constraint is natural in practice (data sources are typically created before their consumers). Deferred emission would require exposing `pub(crate)` Core internals across crate boundaries.
- **Affects:** `ReactiveLog::attach` callers. Documented in migration-status.md M5.B section.

### D183 — M5.B parity: `MapChange::Delete` carries `previous: V`
- **Date:** 2026-05-11
- **Context:** TS `MapChangePayload` includes `previous: V` on delete for audit trails. Rust M5.B initial landing omitted it.
- **Decision:** Add `previous: V` to Rust `MapChange::Delete`. Capture value before backend deletion in all paths (explicit, expired, LRU evict, archived).
- **Rationale:** Audit trails need the deleted value. Matches TS semantics. Slight perf cost (one extra `backend.get()` before delete) is acceptable for correctness.
- **Affects:** All `MapChange::Delete` construction sites in `reactive.rs`. `prune_expired_inner` and `lru_evict` now return `Vec<(K, V)>`.

### D184 — M5.B parity: `"archived"` reason replaces `"lru-evict"` for retention archival (TS fix)
- **Date:** 2026-05-11
- **Context:** TS used `"lru-evict"` as the deletion reason for score-based retention archival — semantically wrong. Rust already had dedicated `DeleteReason::Archived`.
- **Decision:** Add `"archived"` to TS `MapChangePayload.reason` union. Change retention archival code to emit `reason: "archived"`.
- **Rationale:** Rust's design is better. `"lru-evict"` should only mean LRU eviction. Pre-1.0, no backward compat needed.
- **Affects:** TS `change.ts` type union, `reactive-map.ts` `applyRetention()`.

### D185 — M5.B parity: mutation log records only effective upsert rows (TS fix)
- **Date:** 2026-05-11
- **Context:** TS `upsertMany` reactive wrapper logged ALL input rows to mutation log, including those skipped by equals. Rust only logged effective (non-skipped) rows.
- **Decision:** Fix TS to match Rust — pre-filter through equals before logging.
- **Rationale:** Logging skipped rows is misleading for audit consumers. Rust behavior is correct. Added `getRow(primary)` O(1) method to `IndexBackend` (both TS and Rust) for the pre-filter lookup.
- **Affects:** TS `reactive-index.ts` `upsertMany` wrapper, `NativeIndexBackend.getRow`, Rust `IndexBackend::get_row`.

### D186 — M5.B /qa: 4 correctness fixes from adversarial review
- **Date:** 2026-05-11
- **Context:** /qa adversarial review (Blind Hunter + Edge Case Hunter) found 4 actionable bugs across Rust and TS.
- **Fixes applied:**
  1. **Rust `has()`/`get()` early-return emission bug.** Expired target key was deleted from backend but early-return skipped emission + mutation log. Subscribers saw stale state. Fixed: expired target flows through normal collection and emission path.
  2. **Rust per-call TTL validation.** `set_with_ttl`/`set_many_with_ttl` accepted negative/NaN f64 values, silently causing instant expiry. Fixed: assert panics on non-positive or non-finite per-call TTL.
  3. **TS `MapChangePayload.reason` made required.** Was `reason?:` (optional) while Rust `DeleteReason` is required. All call sites already provided a reason. Removed `?` for cross-language parity.
  4. **Rust NaN-safe retention sort.** `apply_retention_inner` used `partial_cmp().unwrap_or(Equal)`, making NaN-scored entries nondeterministic. Changed to `total_cmp()` which places NaN below -Infinity.
- **Affects:** Rust `reactive.rs` (`has`, `get`, `set_with_ttl`, `set_many_with_ttl`, `apply_retention_inner`). TS `change.ts` (`MapChangePayload`).

### D187 — Slice W Q1/Q2: `zip([])` / `race([])` throw at construction
- **Date:** 2026-05-13
- **Context:** Parity tests carried `test.todo` placeholders for empty-source zip/race since Slice F doc cleanup (2026-05-07). Both impls historically allowed empty input — pure-ts emitted `[]+COMPLETE` for zip and lone COMPLETE for race; Rust mirrored TS. Canonical spec was silent. Slice W picked a definitive semantics.
- **Options:** A) Immediate COMPLETE (vacuous-tuple / no-winner-completes). B) Throw at construction ("requires ≥1 source"). C) Hang forever (degenerate operator).
- **Decision:** B — throw at construction with message `"<op>(): requires at least one source"`.
- **Rationale:** zip and race are conjunctions (zip requires all queues; race requires ≥1 winner). The empty set is ill-defined for both. Throwing surfaces the call-site bug instead of producing silently-ambiguous behavior. Mirrors `combineLatest([])` precedent in mainstream Rx libraries. `merge([])` is exempt — union over the empty set is well-defined (immediate COMPLETE preserved).
- **Affects:** TS `combine.ts::zip` / `combine.ts::race` throw at top of factory. Rust `ops_impl::zip` / `ops_impl::race` `assert!` at top; napi binding (`register_zip` / `register_race`) pre-rejects with `NapiError::from_reason` so panic doesn't cross FFI. Canonical spec Appendix E (Subscription Operator Empty-Source Contracts) ports the rule.

### D188 — Slice W Q3 (D041): pure-ts concat phase-zero self-complete confirmed correct
- **Date:** 2026-05-13
- **Context:** Parity test gated `test.runIf(impl.name !== "pure-ts")` based on "TS legacy pre-fix behavior". Source-level inspection of `combine.ts::concat` (lines 379-455 of pure-ts.git) showed the `secondCompleted` flag already implements the D041 fix — the test gate was stale.
- **Decision:** Remove the `runIf` gate; assertion now runs cross-impl. No pure-ts code change required.
- **Rationale:** Pure-ts already mirrors Rust port's phase-transition drain logic. The stale gate originated when this test was added before the pure-ts fix landed. Verification: parity test `concat self-completes when second completes during phase zero` passes for both `pure-ts` and `rust-via-napi`.

### D189 — Slice W Q4 (D-ops P4): pure-ts race all-complete-no-winner confirmed correct
- **Date:** 2026-05-13
- **Context:** Parity test gated `test.runIf(impl.name !== "pure-ts")` based on "TS legacy first-COMPLETE-from-any wins". Source-level inspection of `combine.ts::race` (lines 472-555 of pure-ts.git) showed the `completedCount` counter (line 503 + line 522-532) implements the all-complete-no-winner semantics — the test gate was stale.
- **Decision:** Remove the `runIf` gate; assertion now runs cross-impl. No pure-ts code change required.
- **Rationale:** Both impls correctly require ALL sources to complete (without a winner emerging) before race itself completes. Verification: parity test `race completes when all sources complete without a winner` passes for both impls.

### D190 — Slice W Q5: pure-ts `observe(undefined, { reactive: true })` auto-subscribes late-added nodes
- **Date:** 2026-05-13
- **Context:** R3.6.2 reactive mode should be "live observation" per canonical spec. Pure-ts `_observeReactive` snapshotted namespace at call time via `_collectObserveTargets`; nodes added later were invisible. Rust port shipped auto-subscribe via `Core::subscribe_topology` (Slice V3 D5).
- **Decision:** Backport — pure-ts `_observeReactive` (graph.ts) now installs a topology emitter directly into `_topologyEmitters`. On `node-added` events (when no path given), it calls `this.observe(event.name, obsOpts)` and pumps the resulting `ObserveResult.onEvent` through the same accumulator listener as the initial snapshot. Mounts deferred — recursing into late-added subgraphs would require per-mount topology hooks (no current consumer pressure).
- **Affects:** `packages/pure-ts/src/graph/graph.ts` `_observeReactive` + `_emitTopology` (dropped redundant `_topology == null` guard so direct emitter registration is honored before the lazy topology companion is instantiated).
- **Rationale:** "Live observation" requires the namespace view to track mutations. Snapshot-at-call-time conflicts with `reactive: true` semantics. Default sink-style `observe()` continues to snapshot — only the `reactive: true` opt-in changes.

### D191 — Slice W Q6 (R3.7.3): pure-ts `graph.remove()` clears namespace AFTER TEARDOWN cascade
- **Date:** 2026-05-13
- **Context:** Rust port Slice F /qa P1 reordered `Graph::remove` to clear the namespace AFTER firing TEARDOWN so sinks can resolve `nameOf(node)` from their TEARDOWN handler. Canonical R3.7.3 for `destroy()` says "After cascade, graph internal registries are cleared." Pure-ts `graph.ts::remove()` (lines 1864-1879 before fix) deleted from `_nodes` + `_nodeToName` BEFORE firing `node.down([[TEARDOWN]])`.
- **Decision:** Reorder pure-ts to match Rust + canonical. Fire `node.down([[TEARDOWN]])` first, then delete from `_nodes` + `_nodeToName`. The cross-graph ownership stamp (`GRAPH_OWNER`) is still released BEFORE TEARDOWN so a sink that re-registers the node on another Graph in the same tick succeeds (the namespace-clear-after-cascade preserves `nameOf` resolvability while ownership transfer needs the stamp gone).
- **Affects:** `packages/pure-ts/src/graph/graph.ts` `remove()` local-node branch.
- **Rationale:** Canonical-spec alignment + symmetrical "namespace lives until cascade completes" invariant across `destroy()` and `remove()`. Verification: parity test `namespace remains resolvable from inside the TEARDOWN sink (R3.7.3 ordering)` passes for both impls (was `test.skip`).

### D192 — Slice W /qa: 5 correctness fixes from adversarial review
- **Date:** 2026-05-13
- **Context:** /qa adversarial review (Blind Hunter + Edge Case Hunter) on Slice W found 5 actionable issues across TS and Rust.
- **Fixes applied:**
  1. **F1 — pure-ts `_observeReactive` lateHandle leak + duplicate-subscribe + race window.** Switched `lateHandles[]/lateOffs[]` arrays to a `Map<string, {handle, off}>`. The topology handler now (a) dedupes by name (re-add of same name no-ops), (b) handles `removed` events by disposing+deleting the matching entry (no accumulation in long-lived dynamic graphs), and (c) the cleanup closure detaches the topology handler FIRST so no new lateHandles accumulate during disposal.
  2. **F2 — `Graph._emitTopology` re-entrant Set iteration.** Snapshotted `[...this._topologyEmitters]` before iterating so handler additions during iteration (e.g., the new `_observeReactive` topology hook) don't visit the freshly-added handler in the same loop.
  3. **F3 — `Graph.remove()` registry inconsistency on TEARDOWN throw.** Wrapped `node.down([[TEARDOWN]])` in `try { ... } finally { _nodes.delete(name); _nodeToName.delete(node); }` so a throwing TEARDOWN sink still leaves the registry consistent (otherwise a torn-down node would remain indexed under `name`).
  4. **F4 — Rust `ops_impl::zip` / `race` panic on user-facing path.** Replaced `assert!(!sources.is_empty(), ...)` with `Result<NodeId, OperatorFactoryError>` returning `OperatorFactoryError::EmptySources` on empty input. Mirrors the `combine::combine` precedent. The napi binding pre-check was removed (Result handles it via `operator_factory_error_to_napi`). Test callers in `tests/{subscription, arc_cycle_break, dead_source_e2e}.rs` updated to `.unwrap()` the Result. Future bindings (pyo3, wasm) get a typed error instead of a panic across FFI.
  5. **F5 — `Graph.add()` JSDoc clarification.** Added explicit caveat that R3.7.3 ordering means cross-graph re-register from a TEARDOWN sink works (stamp released pre-cascade) but same-graph re-register-under-a-new-name does not (`_nodeToName` is still populated during the sink) — do same-graph re-register after `remove()` returns.
- **Rejected as false positives or pre-existing:** disposed-flag ordering (already covered by early-return), `_emitTopology` pre-init events (no real path to fire), defensive try-catch around late-subscribe inner observe (hides bugs), annotation-install ordering (pre-existing, not Slice W), race COMPLETE double-count (protocol-illegal), concat phase-zero ERROR state-machine consistency (pure-ts tests pass; defensive only), F19 TTL parity test gap (real, but coverage-not-bug; queued as follow-up), Appendix E text consistency (verified clean), mount-recursion limitation (documented).
- **Affects:** TS `packages/pure-ts/src/graph/graph.ts` (`_emitTopology`, `remove()`, `_observeReactive`, `add()` JSDoc). Rust `crates/graphrefly-operators/src/ops_impl.rs` (`zip`, `race` signatures + body cleanup), `crates/graphrefly-bindings-js/src/operator_bindings.rs` (`register_zip`, `register_race`), `crates/graphrefly-operators/tests/{subscription, arc_cycle_break, dead_source_e2e}.rs` (`.unwrap()` callers). Canonical spec Appendix E (Rust impl text updated to reflect Result migration). Test counts: pure-ts 3011 / parity 289+1 skipped / cargo operators 184 — all green; `cargo clippy -p graphrefly-operators --all-targets -D warnings` clean.
