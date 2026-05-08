---
session: rust-port-napi-operators
status: implemented-phases-a-c (Phases A–C landed 2026-05-07; Phases D + E carried forward to follow-on slices via `~/src/graphrefly-rs/docs/porting-deferred.md`)
date_opened: 2026-05-07
date_locked: 2026-05-07
date_implemented: 2026-05-07 (Phases A–C)
slice: M3 napi-rs operator parity (queued in `~/src/graphrefly-rs/docs/migration-status.md:64`)
spec_refs: R5.7 (transform operators), R1.3.6.b (multi-emit batch), R1.3.2.d (per-wave equals coalescing), R5.5 (custom-equals semantics)
related_decisions: D049, D050, D051, D052, D053 (locked entering); D062, D063, D064, D065, D066 (locked closing); D016 (closure-wrapping discipline), D044 (HigherOrderBinding `ProjectFn` shape), D047/D048 (typed-error pattern), D045 (lock-released handshake), D060 (cleanup-closure panic isolation precedent for D065)
---

# M3 napi-rs operator parity — design call

## 0. Status

**IMPLEMENTED (Phases A–C).** Phases D + E carry forward to follow-on slices.

### What landed (2026-05-07)

- **Phase A (TSFN substrate + worker-thread Core)** — `crates/graphrefly-bindings-js/src/worker.rs` (new module, ~220 LOC) with `WorkerHandle::dispatch<F, R>(f) -> R` running closures on a per-`BenchCore` dispatcher thread. Worker-thread-local `WORKER_CORE` (used by `BenchBinding::invoke_fn` for producer dispatch — avoids the Arc cycle that an on-binding `core_ref` would create). All ~25 existing `BenchCore` `#[napi]` methods refactored to route through `worker.dispatch(...)`. Subscriptions live on the worker thread (their `Drop` accesses Core's mutex; dropping on JS thread risks deadlock when worker is mid-wave).
- **Phase B (`BenchOperators` napi class)** — `crates/graphrefly-bindings-js/src/operator_bindings.rs` (new module, ~590 LOC) with 22 `register_*` napi methods covering all 24 operator factories (6 transform + 3 combine + 7 flow + 4 producer-shape + 4 higher-order). `OperatorBinding` / `HigherOrderBinding` / `ProducerBinding` impls on `BenchBinding`. TSFN bridge `bridge_sync<T, R>(tsfn, arg) -> R` blocks on `mpsc::sync_channel` for the JS-callback return value; on JS-callback throw, the cb closure is dropped without firing → channel collapses → `recv` returns `Err` → bridge panics per D065.
- **Phase C (custom-equals bundle)** — `BenchOperators::register_distinct_until_changed_with(src, equals)` accepts a JS callback. `BindingBoundary::custom_equals(fn_id, a, b)` looks up the registered closure in `Registry.equalses` (falls back to identity-equals if no callback registered). `EqualsMode::Custom(fn_id)` paths flow through naturally.

### What carried forward (porting-deferred.md entries 2026-05-07)

- **Phase D — three-bench shape (D049):** bench fixtures `bench_tsfn_identity` + `bench_tsfn_addone_js` not yet implemented. Substrate (TSFN bridge + BenchOperators) is in place; bench harness layer waits.
- **Phase E — `parity-tests/impls/rust.ts` activation (D053):** the JS-side adapter wrapping `BenchCore` / `BenchOperators` into the high-level `Impl` shape (~200–400 LOC) is its own conceptually-independent slice. Plus the napi binding needs `napi-cli` packaging into a publishable `@graphrefly/native` shape.
- **napi 2.16 → 3.x bump deferred:** napi 3.x's `#[napi]` macro generates `ctor`-based registration that requires `unsafe`; conflicts with Rust invariant 1's `#![forbid(unsafe_code)]`. Bump deferred to a slice with explicit signoff on the unsafe-code exception.
- **JS-callback re-entrance:** v1 limitation — JS callbacks must not re-enter `BenchCore` / `BenchOperators` (worker-thread parked-on-oneshot deadlock).
- **Arc-cycle leak per `BenchCore`:** producer build closures capture `Arc<BenchBinding>` + `Core`, stored on `BenchBinding.registry.producer_builds` → cycle. Bounded constant per `BenchCore` instance; process exit cleans up.
- **u32 narrowing limit (D064):** 4-billion-handle ceiling per `BenchCore`. BigInt migration deferred.
- **Per-fire JS-callback throw isolation (D065):** wave-level panic-discard granularity. Per-fire isolation deferred.

All carry-forwards have `porting-deferred.md` entries with lift points.

### Decisions

All ten decisions locked: D049–D053 (entering), D062–D066 (closing). See `~/src/graphrefly-ts/docs/rust-port-decisions.md`.

## 1. Background

### 1.1 What's deferred

Migration tracker `~/src/graphrefly-rs/docs/migration-status.md:64`:

> **M3 (napi-rs operator parity)** | `graphrefly-bindings-js` | ⏸ deferred to next session (user direction 2026-05-07) | Binding-layer work — `BenchCore` (or richer `BenchOperators` companion class) needs to expose `register_map` / `register_filter` / `register_scan` / `register_reduce` / `register_distinct_until_changed` / `register_pairwise` / `register_combine` / `register_with_latest_from` / `register_merge` / `register_take` / `register_skip` / `register_take_while` / `register_last` plus the producer/higher-order set (`register_zip` / `register_concat` / `register_race` / `register_take_until` / `register_switch_map` / `register_exhaust_map` / `register_concat_map` / `register_merge_map`). ~400+ LOC + TSFN (thread-safe function) plumbing for the project/predicate/fold/pack callbacks (same plumbing gates the deferred TSFN custom-equals work). On landing, flip `parity-tests/impls/rust.ts` non-null and the existing ~25 parity scenarios activate against `rustImpl` for the first time — surfacing any canonical-spec divergences not yet caught.

### 1.2 What already exists in `graphrefly-rs`

Substrate is in place — this slice is binding-layer wiring, not new Core types:

- **`graphrefly-operators::OperatorBinding`** super-trait of `BindingBoundary` at [`crates/graphrefly-operators/src/binding.rs:45`](../../crates/graphrefly-operators/src/binding.rs) — six closure-registration methods covering all transform / combine / flow operators: `register_projector` (Map), `register_predicate` (Filter / TakeWhile / Find), `register_folder` (Scan / Reduce), `register_equals` (DistinctUntilChanged + `BindingBoundary::custom_equals`), `register_pairwise_packer` (Pairwise), `register_packer` (Combine / WithLatestFrom / Zip).
- **`graphrefly-operators::HigherOrderBinding`** super-trait at [`crates/graphrefly-operators/src/higher_order.rs`](../../crates/graphrefly-operators/src/higher_order.rs) — `register_project(ProjectFn) → FnId` + `invoke_project(fn_id, value) → NodeId` for switchMap / exhaustMap / concatMap / mergeMap. ProjectFn returns a `NodeId` (the inner stream), not a `HandleId` (D044).
- **`graphrefly-operators::ProducerBinding`** super-trait — `register_producer_build` + `producer_storage` for zip / concat / race / takeUntil. **No user callback for race / concat / takeUntil**; only zip needs a packer (which is `register_packer` from `OperatorBinding`).
- **`graphrefly-bindings-js::BenchCore`** at [`crates/graphrefly-bindings-js/src/core_bindings.rs:264`](../../graphrefly-rs/crates/graphrefly-bindings-js/src/core_bindings.rs) — sync napi class, ~830 lines, exposes `register_state_int` / `register_derived` (pre-baked `BuiltinFn::Identity | AddOne` enum) / `subscribe_noop` / `emit_int` / `cache_int` / lifecycle (pause/resume/invalidate/teardown) / `set_deps` / `batch_emit`. Pre-baked closure registry — **no JS callback path yet.** napi pin: `2.16`.
- **Existing dispatcher bench** at [`crates/graphrefly-core/benches/dispatcher.rs`](../../graphrefly-rs/crates/graphrefly-core/benches/dispatcher.rs) — Rust criterion bench, no FFI; the side-by-side companion `~/src/graphrefly-ts/bench/dispatcher.bench.ts` does the JS perf compare via `BenchCore`.

### 1.3 What activates on landing

- `parity-tests/impls/rust.ts` flips from `null` to a non-null `Impl` — the workspace `impls` array length grows from 1 to 2; every `describe.each(impls)` scenario now runs against `rustImpl` too.
- Test count: 50 operator scenarios (combine 6 + transform 8 + flow 11 + higher-order 9 + subscription 16) + 18 graph scenarios (sugar 5, signal 3, edges 3, remove 3, observe-all-reactive 3, describe-reactive 3) + 1 core dispatcher = **69 cross-impl scenarios**. Each runs once for legacy + once for rust. Scenarios marked with `test.runIf(impl.name !== "legacy-pure-ts")` (Slice E /qa Rust-port-only divergences) ALSO activate.
- Surface the slice must wire (per the `Impl` interface in [`packages/parity-tests/impls/types.ts`](../../packages/parity-tests/impls/types.ts)): all symbols already enumerated. Beyond what `BenchCore` already covers (M1 dispatcher + M2 Graph), the new surface is the 24 operator factories.

## 2. Decision recap (locked entering: D049, D050, D051, D052, D053)

The five questions surfaced last session are pre-answered in `docs/rust-port-decisions.md`. This section recaps the rationale and ties each decision to its design consequence.

### 2.1 D049 — Three-bench shape (Q4 from prompt)

**Locked: three separate benches** — (1) builtin sync, (2) TSFN identity overhead, (3) TSFN with real JS fn body.

| Bench | Purpose | What it measures |
|---|---|---|
| `bench_builtin_fn` (existing) | "True FFI" baseline. Pre-baked Rust closure; no JS callback. | Pure dispatcher + handle intern + napi method overhead. |
| `bench_tsfn_identity` (NEW) | TSFN scheduling-cost isolation. JS callback is `(x) => x`. | (1) → (2) delta = TSFN scheduling overhead per fn-fire. |
| `bench_tsfn_addone_js` (NEW) | Honest TS-vs-Rust comparison. JS callback does real `(x) => x + 1`. | End-to-end Rust-via-TSFN, comparable to TS pure-impl. |

**Rationale:** subtraction reveals scheduling cost; bench (3) is the headline "Rust is N× faster" number. Bench (1) survives intact — anything currently quoted in `archive/docs/SESSION-rust-port-architecture.md` Phase 13.7 bench study stays apples-to-apples.

**Implication:** §5 implementation plan adds two new benches under [`crates/graphrefly-bindings-js/benches/`](../../graphrefly-rs/crates/graphrefly-bindings-js/benches/) (the directory does not yet exist; will be created). Pairs with new TS-side `~/src/graphrefly-ts/bench/operators-via-tsfn.bench.ts`.

### 2.2 D050 — TSFN strategy = napi-rs latest version sync blocking call (Q1 from prompt)

**Locked: option B** — use napi-rs `ThreadsafeFunction::call_with_return_value(arg, ThreadsafeFunctionCallMode::Blocking, |ret, _env| ...)` with a oneshot/mpsc to bridge the result-handler closure back to the calling Rust thread.

**Rationale (per D050):**
- (A) block-on-oneshot — same underlying mechanism as B, but B is the documented napi-rs 3.x recipe; A would be reinventing it.
- (B) ✅ napi-rs 3.x `call_with_return_value` is the canonical sync-return TSFN pattern.
- (C) pre-baked closures only — punts the question; never reaches parity.
- (D) async dispatch in Core — violates Rust invariant 4 ("no async runtime in Core") in [`graphrefly-rs/CLAUDE.md`](../../graphrefly-rs/CLAUDE.md).

**The deadlock concern** (open follow-up Q1 in §7 — needs user signoff before implementation):

`ThreadsafeFunction::call_with_return_value`'s "Blocking" mode blocks on **TSFN queue submission**, not on JS-callback completion. The result-handler closure runs on the **JS event-loop thread** (libuv tick), with the Rust caller blocking on a oneshot to read the value back. This deadlocks if the Rust caller IS the JS event-loop thread, because the JS thread is busy executing the napi method that called `call_with_return_value` — libuv can't drain the tick we just queued.

```
Rust (JS thread) | tsfn.call_with_return_value(Blocking, |ret| oneshot.send(ret))
                 |   ↓ queues to libuv tick
Rust (JS thread) | oneshot.recv()  ←── blocks
                 |   ↓ JS thread can't drain tick → DEADLOCK
```

Today, `BenchCore::emit_int(...)` is a sync `#[napi]` method — Rust IS the JS thread, and Core's wave engine fires `invoke_fn` synchronously inside that handler. Adding TSFN-driven JS callbacks therefore requires one of:

- **Move Core to a worker thread** (recommended, see §7 Q2). Public napi methods like `emit_int` enqueue work to the worker via `napi::Task` / a dedicated dispatcher thread; the worker drives Core; TSFN calls from worker → JS thread don't deadlock because the JS thread is free to drain libuv. Cost: every napi method becomes async-shaped at the Rust layer; the JS API stays sync via the napi method's own promise/sync-return convention.
- **Hybrid:** detect "am I on the JS thread?" via napi's thread-id check; on JS thread, use sync `Function<>::call(arg)` with a `FunctionRef` + thread-local Env; on non-JS thread, use TSFN. **Not recommended** — two code paths to maintain, breaks the cleaving plane (Function is `!Send` + requires Env access).
- **Force users to drive Core off the JS thread** (e.g., from a Worker). Punts the problem to consumers; conflicts with the "JS-friendly napi binding" goal.

**Open follow-up Q2 in §7:** explicit signoff on "Core moves to worker thread for the napi binding."

### 2.3 D051 — New `BenchOperators` companion class (Q2 from prompt)

**Locked: option B** — new `#[napi] pub struct BenchOperators { core: Arc<Core>, binding: Arc<BenchBinding>, ... }` companion class wrapping the same `Arc<Core>` + `Arc<BenchBinding>` that `BenchCore` already holds.

**Rationale (per D051):**
- (A) pile onto `BenchCore` — would balloon to ~50 napi methods (existing 26 + 24 register_* + lifecycle for operator nodes).
- (B) ✅ separation: dispatcher concerns on `BenchCore`; operator concerns on `BenchOperators`.

**Trade-off:** two classes to construct/coordinate. JS test fixture pattern: `const c = new BenchCore(); const ops = BenchOperators.from(c);` — `BenchOperators::from(core)` shares the `Arc<BenchBinding>` (registry stays unified for handle interning across both classes; otherwise an `intern` on `BenchCore` and a `register_map` on `BenchOperators` would see different handles).

**Implementation:**
- `BenchCore` exposes a getter for its internal `Arc<BenchBinding>` so `BenchOperators::from(core)` can share state. Alternatively, BOTH classes are constructed from a shared factory (`BenchHarness::new() → (BenchCore, BenchOperators)`).
- All `register_*` operator methods live on `BenchOperators`; `subscribe_noop` / `emit_int` / `cache_int` / lifecycle stay on `BenchCore`. Higher-order operators that need `subscribe_noop` on the inner producer go through `BenchCore` (the methods are on the companion, but the underlying NodeId is the same — both classes operate over the same `Arc<Core>`).

### 2.4 D052 — Bundle custom-equals TSFN with operators (Q3 from prompt)

**Locked: option A** — bundle. One TSFN refactor covers both paths; one design pass; one test infrastructure update.

**Rationale (per D052):** TSFN substrate is the heavy lift (~400+ LOC). Custom-equals is `BindingBoundary::custom_equals(fn_id, a, b) → bool` — same TSFN-call shape as `register_predicate` (different operand count: `register_predicate` is `fn(HandleId) → bool`, custom_equals is `fn(HandleId, HandleId) → bool`). Doubling the slice scope to absorb custom-equals is cheaper than two TSFN design passes.

**Implication for §5 plan:**
- Phase A wires the TSFN substrate (closure storage, sync-return bridge, panic isolation).
- Phase B uses the substrate to implement `OperatorBinding::register_*` methods.
- Phase C uses the same substrate to wire `BindingBoundary::custom_equals` to a JS callback when `EqualsMode::Custom(fn_id)` is registered. **`OperatorBinding::register_equals` already returns the FnId** that the operator factory threads into `OperatorOp::DistinctUntilChanged`; the custom-equals path uses the SAME `register_equals` registration flow but the FnId flows through `EqualsMode::Custom` (consumed by `Core::register_*` opts). No new closure-registration trait method needed.

### 2.5 D053 — Activate-and-triage for `parity-tests` (Q5 from prompt)

**Locked: option B** — activate, let CI fail, triage one by one.

**Rationale (per D053):** pre-walking 69 scenarios to predict which will fail risks confirmation bias — we'd document the divergences we expect and miss the ones we don't. Activate-and-triage reveals unknown-unknowns.

**Implication:** the slice closes when (a) the binding compiles + benches run, (b) `parity-tests/impls/rust.ts` flips non-null + import surface validates, (c) ALL existing parity-tests run green against `rustImpl` OR are explicitly marked with `test.runIf(impl.name !== "legacy-pure-ts")` + a pointer to a tracking entry in `~/src/graphrefly-rs/docs/porting-deferred.md` that explains the Rust-port-only divergence and the lift point.

The slice does NOT need to fix every divergence — Slice E /qa already established the precedent for per-scenario divergence pinning (race no-winner all-complete; concat phase-0 COMPLETE; etc.). The acceptance bar is: every divergence is visible in CI as a `test.runIf` exclusion, and every exclusion has a `porting-deferred.md` row.

## 3. The substrate the slice has to build

This section is descriptive — it lists what exists vs what the slice creates. The locked decisions in §2 already constrain the choice space.

### 3.1 Trait impls already needed

The napi binding already implements `BindingBoundary` for `BenchBinding` (existing). To add operators, the binding must additionally impl:

```rust
// graphrefly-bindings-js/src/operator_binding.rs (NEW)
impl OperatorBinding for BenchBinding { ... 6 register_* methods ... }
impl HigherOrderBinding for BenchBinding { ... register_project / invoke_project ... }
impl ProducerBinding for BenchBinding { ... register_producer_build / producer_storage ... }
```

`ProducerBinding` impl is the lightest (no JS callback for race / concat / takeUntil; zip uses `register_packer` from `OperatorBinding`). `OperatorBinding` is the bulk. `HigherOrderBinding` is the only one needing the new `ProjectFn → NodeId` shape (per D044 — return value is a NodeId, requiring the caller to first invoke a JS callback that returns a NodeId, which is itself a number-handle into the binding's NodeId registry).

### 3.2 TSFN closure storage

Current `BenchBinding.registry: Mutex<Registry>` already has:
- `fns: AHashMap<FnId, SingleFnImpl>` — pre-baked single-emission Rust closures
- `batch_fns: AHashMap<FnId, BatchFnImpl>` — pre-baked batch Rust closures

The slice extends Registry with TSFN-backed closures:

```rust
struct Registry {
    // ... existing pre-baked fields kept (used by bench_builtin_fn) ...

    // NEW: TSFN-backed JS closures, keyed by the same FnId namespace.
    // ProjectFn = Fn(HandleId) → HandleId
    js_projectors: AHashMap<FnId, Arc<ThreadsafeFunction<u32, u32>>>,
    // PredicateFn = Fn(HandleId) → bool
    js_predicates: AHashMap<FnId, Arc<ThreadsafeFunction<u32, bool>>>,
    // FolderFn = Fn(HandleId, HandleId) → HandleId
    js_folders: AHashMap<FnId, Arc<ThreadsafeFunction<FnArgs<(u32, u32)>, u32>>>,
    // EqualsFn = Fn(HandleId, HandleId) → bool (used by both register_equals AND custom_equals)
    js_equals: AHashMap<FnId, Arc<ThreadsafeFunction<FnArgs<(u32, u32)>, bool>>>,
    // PairwisePackerFn = Fn(HandleId, HandleId) → HandleId
    js_pairwise_packers: AHashMap<FnId, Arc<ThreadsafeFunction<FnArgs<(u32, u32)>, u32>>>,
    // PackerFn = Fn(&[HandleId]) → HandleId — variadic via Vec<u32>
    js_packers: AHashMap<FnId, Arc<ThreadsafeFunction<Vec<u32>, u32>>>,
    // ProjectFn (higher-order) = Fn(HandleId) → NodeId
    js_higher_order_projectors: AHashMap<FnId, Arc<ThreadsafeFunction<u32, u32>>>,
}
```

Design choice surfaced as open follow-up Q3: **HandleId is `u64` but the TSFN type-parameter shows `u32`**. The TS layer treats handles as numbers; v8 `Number` is f64, safe up to 2^53. Inside the binding, we narrow `HandleId(u64)` to `u32` IF a binding-local guarantee that handles fit in u32 is safe (the existing `register_state_int` already returns `u32` to JS, so this is consistent). Alternative: serialize as `BigInt` via napi's BigInt support. The narrow-to-u32 is the simpler choice given the existing binding patterns.

### 3.3 The sync-return bridge

For each TSFN call, the binding bridges async TSFN → sync Rust return via:

```rust
fn invoke_projector_sync(&self, fn_id: FnId, h_in: HandleId) -> HandleId {
    let tsfn = self.registry.lock().js_projectors.get(&fn_id).cloned()
        .expect("invariant: fn_id was registered via register_projector");
    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<u32>>(1);
    let h_in_u32 = h_in.as_u64() as u32;  // narrow per §3.2
    tsfn.call_with_return_value(
        Ok(h_in_u32),
        ThreadsafeFunctionCallMode::Blocking,
        move |ret, _env| {
            let _ = tx.send(ret);
            Ok(())
        },
    );
    let ret = rx.recv().expect("TSFN result-handler dropped channel");
    HandleId::new(ret.expect("JS callback threw") as u64)
}
```

**Per D060** (Slice E2 `BindingBoundary::cleanup_for` precedent): user JS callbacks can throw. The binding catches the throw via `Result<T>` and either propagates as a Rust panic at the binding-FFI boundary OR converts to a typed error path. **Open follow-up Q4:** which propagation policy for JS-callback throws inside operator callbacks?

### 3.4 Closure wrapping for `OperatorBinding` impl

Per D016 (closure-wrapping discipline), `OperatorBinding::register_projector(f: Box<dyn Fn(HandleId) → HandleId + Send + Sync>) → FnId` takes an already-wrapped closure. The napi-binding-side wrapping is:

```rust
impl OperatorBinding for BenchBinding {
    fn register_projector(&self, f: Box<dyn Fn(HandleId) -> HandleId + Send + Sync>) -> FnId {
        let mut reg = self.registry.lock();
        let fn_id = FnId::new(reg.next_fn_id);
        reg.next_fn_id += 1;
        reg.fns.insert(fn_id, Arc::from(f));  // store as SingleFnImpl shape (existing infra)
        fn_id
    }
    // ... 5 more methods with same shape
}
```

The napi-facing method on `BenchOperators` does the JS-callback → boxed-closure wrapping:

```rust
#[napi]
impl BenchOperators {
    /// `project` is a JS function `(handleId: number) => number`.
    pub fn register_map(&self, src: u32, project: Function<u32, u32>) -> Result<u32> {
        let tsfn = project.build_threadsafe_function().build()?;
        let fn_id = {
            let mut reg = self.binding.registry.lock();
            let fn_id = FnId::new(reg.next_fn_id);
            reg.next_fn_id += 1;
            reg.js_projectors.insert(fn_id, Arc::new(tsfn));
            fn_id
        };
        // Register the operator via graphrefly-operators::transform::map factory.
        // The factory takes `Box<dyn Fn(HandleId) -> HandleId + Send + Sync>`; we
        // wrap a closure that invokes the TSFN sync-return bridge.
        let src_id = NodeId::new(src as u64);
        let binding = self.binding.clone();
        let projector = Box::new(move |h: HandleId| -> HandleId {
            binding.invoke_projector_sync(fn_id, h)
        });
        // ... call graphrefly_operators::transform::map(&self.core, src_id, projector, opts)
        //     which internally calls OperatorBinding::register_projector and wires Core registration.
        // Convert OperatorRegistration result → u32 NodeId for JS.
    }
}
```

**Note:** the `OperatorBinding::register_projector` call inside the factory ALSO inserts into `js_projectors`? No — re-read §3.4. `register_projector` stores the boxed closure (which itself wraps the TSFN) into `fns`. The TSFN itself goes into `js_projectors` once, keyed by fn_id, so the closure can find it via `binding.invoke_projector_sync(fn_id, h)`. **Two registrations against same fn_id** — `fns[fn_id] = Arc::from(boxed_projector_closure)` AND `js_projectors[fn_id] = Arc::new(tsfn)`. The closure-stored side is what `invoke_fn` would see (but operators don't use `invoke_fn` — they use `OperatorOp::Map` which dispatches to `OperatorBinding::project_each(fn_id, h)` → `(self.fns[fn_id])(h)`). So `fns[fn_id]` IS the dispatch path; `js_projectors[fn_id]` is just the TSFN handle the closure dereferences.

**Cleaner alternative:** drop `js_projectors` etc. — the boxed closure CAPTURES the TSFN by `Arc<...>` clone, so no separate registry needed. The closure is `move |h| { tsfn_clone.call_with_return_value(...) }`. Strictly cleaner; no need for a parallel registry. **Adopting this in the §5 plan.**

### 3.5 Why `ProducerBinding` is mostly free

zip / concat / race / takeUntil are subscription-managed producer operators (D036–D038). They don't take user callbacks EXCEPT zip's `register_packer`. Default `ProducerBinding` impl on `BenchBinding` is essentially `default_producer_deactivate` + the `producer_storage` shape; both already exist conceptually in `BenchBinding`'s state, just need wiring.

Zip's packer goes through the same `register_packer` path as combine / withLatestFrom (already covered by `OperatorBinding`). No new TSFN type needed.

### 3.6 Higher-order: `register_project` returns NodeId

Higher-order operators (switchMap / exhaustMap / concatMap / mergeMap) project each outer DATA into an inner `Node<T>`. The binding-side challenge: the JS callback returns a **NodeId** (the inner stream), not a HandleId.

JS-facing API:
```typescript
ops.register_switch_map(outer: number, project: (h: number) => number): number
// project(h_in) returns a NodeId (already-registered) representing the inner stream.
```

Behind the scenes:
- `register_project(f: ProjectFn) → FnId` stores the JS-callback-wrapped closure of shape `Fn(HandleId) → NodeId`.
- `invoke_project(fn_id, h)` looks up the closure and invokes it; the returned NodeId is passed to Core's higher-order substrate which subscribes to it.

The TSFN type is `ThreadsafeFunction<u32, u32>` — same as `register_projector`, but the returned `u32` semantically represents a NodeId (binding-side type discipline; not enforced by napi). JS-side construction pattern: the JS callback uses the SAME `BenchOperators` instance to construct the inner stream and returns its NodeId.

## 4. Surface widening on `BenchOperators`

Per the migration-status text, the napi surface needs 21 register methods (13 transform + 4 producer + 4 higher-order). Mapping to the existing TS legacy operator names:

| JS method on `BenchOperators` | Calls Rust factory | TSFN closure shape |
|---|---|---|
| `register_map(src, project)` | `transform::map` | `Fn<u32, u32>` |
| `register_filter(src, predicate)` | `transform::filter` | `Fn<u32, bool>` |
| `register_scan(src, seed, folder)` | `transform::scan` | `Fn<FnArgs<(u32, u32)>, u32>` |
| `register_reduce(src, seed, folder)` | `transform::reduce` | `Fn<FnArgs<(u32, u32)>, u32>` |
| `register_distinct_until_changed(src, equals?)` | `transform::distinct_until_changed` | `Fn<FnArgs<(u32, u32)>, bool>` (optional) |
| `register_pairwise(src, packer)` | `transform::pairwise` | `Fn<FnArgs<(u32, u32)>, u32>` |
| `register_combine(srcs, packer)` | `combine::combine` | `Fn<Vec<u32>, u32>` |
| `register_with_latest_from(primary, others, packer)` | `combine::with_latest_from` | `Fn<Vec<u32>, u32>` |
| `register_merge(srcs)` | `combine::merge` | (none — `MergeRegistration`) |
| `register_take(src, count)` | `flow::take` | (none) |
| `register_skip(src, count)` | `flow::skip` | (none) |
| `register_take_while(src, predicate)` | `flow::take_while` | `Fn<u32, bool>` |
| `register_last(src)` / `register_last_with_default(src, default_handle)` | `flow::last` / `flow::last_with_default` | (none — handle-only) |
| `register_first(src)` / `register_find(src, predicate)` / `register_element_at(src, idx)` | `flow::first` / `flow::find` / `flow::element_at` | predicate for `find`; (none) for others |
| `register_zip(srcs, packer)` | `ops_impl::zip` | `Fn<Vec<u32>, u32>` |
| `register_concat(first, second)` | `ops_impl::concat` | (none) |
| `register_race(srcs)` | `ops_impl::race` | (none) |
| `register_take_until(src, notifier)` | `ops_impl::take_until` | (none) |
| `register_switch_map(outer, project)` | `higher_order::switch_map` | `Fn<u32, u32>` (returns NodeId) |
| `register_exhaust_map(outer, project)` | `higher_order::exhaust_map` | `Fn<u32, u32>` |
| `register_concat_map(outer, project)` | `higher_order::concat_map` | `Fn<u32, u32>` |
| `register_merge_map(outer, project, concurrency?)` | `higher_order::merge_map_with_concurrency` | `Fn<u32, u32>` |

That's 22 methods (some surface combines into one — `register_last` doubles as `register_last_with_default` based on `default_handle` presence). 6 of them need NO TSFN (zero-callback subscription/flow ops). 16 need TSFN. Plus `BindingBoundary::custom_equals` opt path (D052 bundling).

## 5. Implementation plan (proposed; gated on §7 Q1–Q5 answers)

### Phase A — TSFN substrate (~150 LOC)

Conditional on Q1 deadlock resolution + Q2 worker-thread architecture decision.

- A1. Bump napi-rs from `2.16` to `3.x` in [`crates/graphrefly-bindings-js/Cargo.toml`](../../graphrefly-rs/crates/graphrefly-bindings-js/Cargo.toml). Audit existing `BenchCore` for v3 API breakage (per [napi-rs v3 announce](https://github.com/napi-rs/website/blob/main/pages/blog/announce-v3.en.mdx) — `JsFunction` deprecated → `Function<Args, Return>`; minor breakage in `Env` access patterns; `Arc<ThreadsafeFunction>` is now native).
- A2. Architectural decision implementation per §7 Q2 (worker thread OR single-thread + Function<>+thread-local-Env OR confirm hybrid).
- A3. Build the sync-return bridge helper inside `BenchBinding`. One helper per TSFN signature shape: `invoke_projector_sync` / `invoke_predicate_sync` / `invoke_folder_sync` / `invoke_equals_sync` / `invoke_pairwise_packer_sync` / `invoke_packer_sync` / `invoke_higher_order_project_sync`. All share `bridge_via_oneshot<Args, Ret>(tsfn, args) → Ret` infrastructure; the per-shape wrappers are thin.
- A4. JS-callback throw policy per Q4 (panic at FFI boundary OR ThreadId-tagged Rust error).

### Phase B — `BenchOperators` napi class (~250 LOC)

- B1. New file `crates/graphrefly-bindings-js/src/operator_bindings.rs`. `#[napi] pub struct BenchOperators { core: Arc<Core>, binding: Arc<BenchBinding> }` + `#[napi(factory)] pub fn from(core: &BenchCore) → Self`.
- B2. Implement `OperatorBinding` for `BenchBinding` (6 methods; thin closure storage).
- B3. Implement `HigherOrderBinding` for `BenchBinding` (`register_project` + `invoke_project`).
- B4. Implement `ProducerBinding` for `BenchBinding` (default impls; zero-effort since zip's packer reuses `register_packer`).
- B5. Add the 22 napi methods to `BenchOperators` per §4 table. Each method:
  - Builds TSFN from incoming `Function<...>` (if applicable);
  - Wraps into the appropriate `Box<dyn Fn(...) -> ... + Send + Sync>` closure capturing the TSFN;
  - Calls `graphrefly_operators::<factory>(core, ..., closure, opts)`;
  - Returns the resulting `NodeId.as_u64() as u32` to JS.
- B6. `BenchOperators` shares the `Arc<BenchBinding>` with `BenchCore` so handle interning is unified. `BenchCore::binding_arc()` getter (or shared factory `BenchHarness::new() → (BenchCore, BenchOperators)`).

### Phase C — Custom-equals via the same TSFN substrate (~30 LOC)

Per D052 bundle. Adds:

- C1. `BenchCore::register_state_int_with_custom_equals(initial, equals_fn)` (or extends existing `register_state_*` with optional `equals` parameter taking `Function<FnArgs<(u32, u32)>, bool>`).
- C2. `BenchOperators::register_derived_with_custom_equals(...)` analog for derived nodes.
- C3. The `equals_fn` is registered via `OperatorBinding::register_equals` (same path as `distinct_until_changed`), and the resulting `FnId` is passed via `EqualsMode::Custom(fn_id)` into `Core::register_*` opts.
- C4. `BindingBoundary::custom_equals(fn_id, a, b)` looks up the TSFN-wrapped closure and invokes `invoke_equals_sync`.

### Phase D — Bench harness (~120 LOC)

Per D049 three-bench shape.

- D1. New `crates/graphrefly-bindings-js/benches/operators_via_tsfn.rs` (Rust criterion bench loaded via `cargo bench -p graphrefly-bindings-js`). Inside napi context: cannot use criterion directly (criterion runs in a Rust binary, not via napi). So this is a JS-side bench file — `~/src/graphrefly-ts/bench/operators-via-tsfn.bench.ts` — using vitest's bench mode.
- D2. JS bench fixtures:
  - `bench_builtin_fn` (existing, on `BenchCore::register_derived(BuiltinFn::AddOne)`) — RETAIN as the FFI baseline.
  - `bench_tsfn_identity` (NEW) — `BenchOperators::register_map(src, x => x)`. Measures TSFN scheduling overhead.
  - `bench_tsfn_addone_js` (NEW) — `BenchOperators::register_map(src, x => x + 1)`. Headline number.
- D3. Document the subtraction interpretation in the bench file's header comment: "(2) − (1) = TSFN scheduling cost; (3) is end-to-end Rust-via-TSFN comparable to TS impl."

### Phase E — `parity-tests/impls/rust.ts` activation (~80 LOC)

Per D053 activate-and-triage.

- E1. Build the binding (`pnpm build` inside `crates/graphrefly-bindings-js/`).
- E2. Publish a workspace `package.json` for `@graphrefly/native` (or temporarily add a path-based import to `parity-tests` package.json that points to the local `.node` artifact).
- E3. Flip `rust.ts` non-null. Wire the rust `Impl` shape: `name: "rust-via-napi"`, surface methods that bridge to `BenchCore` / `BenchOperators` with the same JS API as `legacy.node` / `legacy.map` / etc. Symbols `DATA / RESOLVED / DIRTY / INVALIDATE / PAUSE / RESUME / COMPLETE / ERROR / TEARDOWN` are JS constants — pull from `@graphrefly/legacy-pure-ts` for now (single-source), since they're protocol-level message-type identifiers, not impl-bound. Open follow-up Q5: should `rustImpl` re-export them or define its own?
- E4. Run `pnpm --filter @graphrefly/parity-tests test`. Triage failures one-by-one.
- E5. For each Rust-port-only divergence: convert to `test.runIf(impl.name !== "rust-via-napi")` (or `!== "legacy-pure-ts"` if it's the OTHER direction), add a row to `~/src/graphrefly-rs/docs/porting-deferred.md` under a new "M3 napi-rs operator parity — activate-and-triage divergences" section, point to the test file + line.
- E6. The slice closes when 0 unguarded failures remain in the `pnpm test:parity` run.

### Phase F — Migration-status + decision-log + porting-deferred updates

- F1. Update `migration-status.md:64` from `⏸ deferred` to `✅ landed` with closing-section format (date, what landed, what was deferred). Bump rust-test count.
- F2. Add new D-numbered entries (D062–D066 or wherever the counter lands) to `docs/rust-port-decisions.md` for the §7 Q1–Q5 sub-decisions, AFTER the user signs off on them.
- F3. Sweep `porting-deferred.md`'s "M3 Slice C-1 — operator deferrals" section — the entry "napi-rs operator binding parity not yet shipped" can be moved to the closing section. The "Operator describe doesn't surface per-operator discriminant" entry stays (different scope).
- F4. Update `parity-tests/README.md` schedule table — M3 row flips to ✅.

## 6. Test plan

### 6.1 Rust-side (bindings crate)

Three new test files under `crates/graphrefly-bindings-js/tests/`:

- `tsfn_substrate.rs` — TSFN sync-return bridge correctness:
  - Bridge returns the JS callback's value verbatim.
  - Bridge propagates JS throws as documented per Q4.
  - Bridge handles concurrent fires (multiple operator nodes share the same TSFN when the user passes the same JS function).
  - Bridge respects pause/resume — a TSFN call from inside a paused node's invalidate path doesn't deadlock (assuming Q2 worker-thread architecture).
- `operator_binding.rs` — per-operator parity smoke tests:
  - One test per of the 16 TSFN-using operators: register, fire, verify output handle interns to expected value.
  - Refcount discipline: `binding.refcount_of(handle)` matches expected after a fire / re-fire / unsubscribe sequence.
- `higher_order_napi.rs` — switchMap / exhaustMap / concatMap / mergeMap with JS-callback project fn:
  - Outer emits → JS callback fires → returns NodeId → inner subscription wired → inner DATA propagates.
  - Cancellation (switchMap): outer re-emit → inner subscription dropped → no late inner DATA leakage.

### 6.2 Parity-tests activation (per D053)

After E3, run `pnpm --filter @graphrefly/parity-tests test`. Expected results:

- 50 operator scenarios + 18 graph scenarios + 1 dispatcher scenario = **69 cross-impl scenarios × 2 impls = 138 test runs**.
- Likely divergences (predict-but-don't-pre-skip per D053):
  - Refcount-discipline tests for handles created in JS may diverge — Rust impl interns differently from TS legacy.
  - `Object.hasOwn(opts, "defaultValue")` for `last()` (porting-deferred D2) — needs the napi binding to dispatch correctly per the existing porting-deferred entry.
  - Custom equals scenarios — gated on Phase C landing.
- Acceptance: every failing test EITHER passes after triage OR is marked `test.runIf(...)` with a `porting-deferred.md` row.

### 6.3 Bench harness (Phase D)

- Bench (1) `bench_builtin_fn` — existing baseline; numbers should not regress (binding refactor is additive).
- Bench (2) `bench_tsfn_identity` — establishes TSFN scheduling overhead. Expected order-of-magnitude: tens of µs/call (rough sanity check; actual numbers come from the run).
- Bench (3) `bench_tsfn_addone_js` — the headline. Compare against the TS impl's `bench/dispatcher.bench.ts` `state_emit_changing_value` numbers run through `map(x => x + 1)`.

## 7. Follow-up questions — RESOLVED 2026-05-07

All five follow-ups answered + locked as D062–D066. Each Q below shows the user's pick and the resulting D-entry. The implementation plan in §5 is now unconditional on these (every "conditional on Q..." reference resolves).

| Q | User pick | Locked as | Summary |
|---|---|---|---|
| Q1 | A | **D062** | Worker-thread Core for the napi binding (deadlock resolution). |
| Q2 | confirm | **D063** | Per-`BenchCore` dispatcher thread + mpsc command channel + per-call oneshot return. |
| Q3 | A | **D064** | HandleId narrowed to `u32` for TSFN signatures (matches existing `BenchCore` convention). |
| Q4 | A | **D065** | JS-callback throws panic at FFI boundary; Core stays panic-naive (symmetric with D060). |
| Q5 | A | **D066** | `rustImpl` re-exports message-type symbols from `@graphrefly/legacy-pure-ts`. |

### Q1. Deadlock resolution — what's the actual sync-bridge mechanism?

Per §2.2: napi-rs `ThreadsafeFunction::call_with_return_value(arg, Blocking, |ret, env| ...)` is asynchronous from the calling Rust thread's POV — the closure runs on the JS thread, with the calling thread receiving the value via a oneshot/mpsc. **This deadlocks if the calling Rust thread is the JS event-loop thread.**

Three options:

- **A.** **Worker-thread Core** (recommended). All public napi methods enqueue work to a dedicated dispatcher thread; that thread drives Core; TSFN calls from worker → JS thread are non-deadlocking. Cost: every napi method becomes async-shaped at the Rust layer (~50 LOC per method to wrap in `napi::Task` or hand-rolled enqueue). Q2 is the architectural variant of this.
- **B.** **Hybrid Function<>+thread-local-Env on JS thread; TSFN otherwise.** Two code paths; `Function<>` is `!Send` so storage requires `FunctionRef` + a thread-local Env scoped to the napi method handler. Breaks the cleaving plane (Function is per-Env-bound).
- **C.** **Defer the deadlock concern**: ship the binding with the TSFN approach assuming JS-thread Core is acceptable, accept that operator workloads beyond a trivial size will deadlock, and treat that as a porting-deferred item until users actually hit it.

**Proposed (subject to user signoff):** A — Core moves to a worker thread for the napi binding. The performance cost is one trip across the worker-boundary per napi method invocation, but graphrefly's batching model means this is paid per *batch*, not per *emission*, so the amortized cost is small.

### Q2. Worker-thread architecture — explicit signoff

Conditional on Q1 = A. This is the substantive architectural call: the napi binding spins up one worker thread per `BenchCore` (or per `Core::new()`); all `#[napi]` methods queue work to that thread. JS-side API stays sync (the napi method blocks on the worker until Core completes the wave). Implementation pattern:

- `BenchCore::new()` spawns a `std::thread::spawn(...)` worker; stores `JoinHandle` + `mpsc::Sender<CoreCommand>`.
- Each `#[napi]` method (e.g., `emit_int`, `register_state_int`) enqueues a `CoreCommand` and `recv()`s the result via a per-call oneshot.
- TSFN calls fire from the worker thread; JS callbacks run on JS thread; result-handler closure pushes value back to worker via oneshot. Worker continues wave engine. No deadlock.

**Cost:** per-napi-method latency includes a worker-trip (typically tens of ns + scheduler jitter). Bench (1) `bench_builtin_fn` will REGRESS slightly versus the current single-thread impl. **This is acceptable** because (1) the regression is real but bounded (per-call ns-scale, not per-fire), (2) the alternative is deadlock under any non-trivial JS-callback workload.

**Proposed (subject to user signoff):** approve the worker-thread architecture. Document the trade-off in §5 Phase A2 + add a porting-deferred entry "single-threaded napi binding optimization" in case future bench evidence justifies revisiting.

### Q3. HandleId narrowing — `u64` → `u32` for TSFN args?

Per §3.2: HandleIds are `NewType<u64>` in Core. The existing `BenchCore` napi methods narrow to `u32` for JS interop (e.g., `register_state_int → u32`). For consistency, TSFN closures use `u32`. But: (a) HandleId space could exceed `u32::MAX` in a long-running process; (b) napi BigInt is available for native `u64` interop.

Three options:

- **A.** Narrow to `u32`. Document the binding-local 4-billion-handles-per-process limit. Match existing `BenchCore` convention.
- **B.** Use BigInt (`napi::JsBigInt`) for handle args. Native `u64`. Slightly more boilerplate per call; BigInt boxing has its own cost.
- **C.** Use `f64` (TS `number`). 53-bit safe; cleaner JS-side ergonomics; native `Number` type. But coercion is awkward at the napi-rs layer.

**Proposed:** A. Match existing convention; the 4B-handles-per-`BenchCore`-instance limit is benign for bench fixtures and tests.

### Q4. JS-callback throw propagation — what happens when `Function::call(...)` throws inside an operator?

Per Slice E2 D060, user cleanup closure panics are catch_unwind'd binding-side. For operator callbacks, the JS-throw → Rust-side path is:

- TSFN `call_with_return_value` returns `Result<T, napi::Error>` via the result-handler closure.
- The Rust-side bridge can either (a) panic at the binding-FFI boundary (deferred-cleanup-hook style — Core sees a panic, wave is panic-discarded per D061), or (b) convert to a typed `OperatorFire::JsCallbackThrew` error path.

Three options:

- **A.** Panic at FFI boundary; rely on Core's existing panic-discard discipline (clear_wave_state). Symmetric with D060.
- **B.** Convert to typed Rust error; surface via a new `OperatorFireError` enum routed through Core's existing fire-error paths.
- **C.** Catch + log + continue (insert `NO_HANDLE` as the result, treat as filter-drop). User-friendly but hides bugs.

**Proposed:** A. Symmetric with D060; cleanest semantics; aligns with "user closures are the binding's responsibility, Core stays panic-naive."

### Q5. `rustImpl` re-export of message-type symbols (DATA / RESOLVED / etc.)?

Per §5 E3: TS legacy exports `DATA / RESOLVED / DIRTY / INVALIDATE / PAUSE / RESUME / COMPLETE / ERROR / TEARDOWN` as `unique symbol`s. `rustImpl` could:

- **A.** Re-export the SAME symbols from `@graphrefly/legacy-pure-ts` (since they're protocol-level identifiers, not impl-bound). Both impls share the same symbol identities.
- **B.** Define its own symbols inside `@graphrefly/native`. Each impl carries its own. parity-tests would have to test that `legacyImpl.DATA !== rustImpl.DATA` (which is fine — scenarios always use `impl.DATA`, never compare across impls).

**Proposed:** A. The message-type symbols are protocol identifiers; sharing them across impls is more honest, simpler, and avoids the "two unique symbols for the same protocol concept" weirdness.

## 8. What's explicitly out-of-scope (deferred)

- `BenchGraph` napi class for Graph parity — separate slice, follows pattern in `migration-status.md` deferral entries.
- pyo3 operator binding — M6 (gated on M5).
- wasm-bindgen operator binding — lands alongside napi-rs progression per migration plan.
- `Object.hasOwn(opts, "defaultValue")` distinction for `last()` (porting-deferred D2) — surfaces in Phase E5 triage; if it falls out as a needed fix, address inline; otherwise deferred to a follow-on.
- `Graph::describe()` per-operator discriminant exposure (existing porting-deferred entry).
- Operator factory typed-error promotion already happened in Slice H (D047, D048) — no work here.

## 9. References

- Locked decisions: D049 (three-bench shape), D050 (TSFN strategy), D051 (`BenchOperators` companion), D052 (custom-equals bundle), D053 (activate-and-triage) in [`docs/rust-port-decisions.md`](../../docs/rust-port-decisions.md).
- Migration tracker: [`migration-status.md`](../../graphrefly-rs/docs/migration-status.md) line 64.
- Operator substrate: [`crates/graphrefly-operators/src/binding.rs`](../../graphrefly-rs/crates/graphrefly-operators/src/binding.rs) (`OperatorBinding`), [`higher_order.rs`](../../graphrefly-rs/crates/graphrefly-operators/src/higher_order.rs) (`HigherOrderBinding`), [`producer.rs`](../../graphrefly-rs/crates/graphrefly-operators/src/producer.rs) (`ProducerBinding`).
- Existing napi binding: [`crates/graphrefly-bindings-js/src/core_bindings.rs`](../../graphrefly-rs/crates/graphrefly-bindings-js/src/core_bindings.rs).
- napi-rs v3 announce: [pages/blog/announce-v3.en.mdx](https://github.com/napi-rs/website/blob/main/pages/blog/announce-v3.en.mdx).
- napi-rs ThreadsafeFunction concept doc: [pages/docs/concepts/threadsafe-function.en.mdx](https://github.com/napi-rs/website/blob/main/pages/docs/concepts/threadsafe-function.en.mdx).
- Parity test surface: [`packages/parity-tests/impls/types.ts`](../../packages/parity-tests/impls/types.ts), [`scenarios/operators/`](../../packages/parity-tests/scenarios/operators/).
- Prior session doc format reference: [`SESSION-rust-port-fn-ctx-cleanup.md`](./SESSION-rust-port-fn-ctx-cleanup.md).

## 10. Halt point

**HALT for explicit implementation approval.** All ten decisions are locked (D049–D053 + D062–D066). The implementation plan in §5 is unconditional. Phase A starts on explicit "implement" instruction.

**Slice estimate (revised):** ~700–800 LOC total, broken down:
- Phase A (TSFN substrate + worker-thread Core, per D062/D063): ~250 LOC.
- Phase B (`BenchOperators` napi class + 22 register methods + trait impls): ~250 LOC.
- Phase C (custom-equals bundle, per D052): ~30 LOC.
- Phase D (bench harness, per D049): ~120 LOC.
- Phase E (`parity-tests/impls/rust.ts` activation + triage, per D053): ~80 LOC + N triage edits.
- Phase F (docs sweep — migration-status, decision log, porting-deferred, parity-tests README): ~50 LOC of doc edits.

Phase F closing requirements (per `~/src/graphrefly-ts/.claude/skills/porting-to-rs/SKILL.md` § 3e):
- `migration-status.md` line 64 entry flips to ✅ landed with closing-section format.
- `parity-tests/README.md` schedule table — M3 row flips to ✅.
- `porting-deferred.md` — sweep "M3 Slice C-1 — operator deferrals" section; move "napi-rs operator binding parity not yet shipped" to closing record. Add new entries surfaced during Phase E triage (Rust-port-only divergences) + the deferred items flagged in D064 (BigInt HandleId) and D065 (per-fire JS-callback throw isolation granularity).
