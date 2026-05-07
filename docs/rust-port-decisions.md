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
