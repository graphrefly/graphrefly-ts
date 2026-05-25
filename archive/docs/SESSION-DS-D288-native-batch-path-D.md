# SESSION DS-D288 — Native `Impl.batch(fn)` resolution: Path D walk-through

**Opened / locked:** 2026-05-24 (single-session walk; opened off the `/design-review` pass that locked D288; sub-decisions Q1–Q5 user-locked 2026-05-24 after a 4-of-5-aligned correction pass).
**Status:** **Q1–Q5 LOCKED.** Doc artifacts shipped this session; paired `/porting-to-rs` slice + `/dev-dispatch` slice deferred to explicit user "implement" call per `feedback_no_implement_without_approval`.
**Trigger:** `docs/rust-port-decisions.md` D288 — Path D (sync `BenchBatchContext` napi handle) was user-locked off the design-review of paths B/C/D, with 5 sub-decisions enumerated as design-session-must-lock-before-`/porting-to-rs`-slice.

## Scope

Walk the 5 sub-decisions D288 enumerated. Each one is a real design call with non-trivial downstream consequences — the dispatch protocol shape constrains the napi infra; the "no sink fire during handle dispatch" invariant has to be auditable in `graphrefly-rs`; the `ctx.down` test contract widens the parity `Impl` interface; the D080 forward-compat decoupling determines whether DS-14 inherits a precedent; pure-ts ergonomic preservation determines whether `legacy.batch` callers see *any* change.

**Out of scope.** Re-litigating the B-vs-C-vs-D choice (locked under D288). Async-fn-body widening (defers to DS-14 / D080). Any change to `graphrefly-rs/crates/graphrefly-core/src/batch.rs` `BatchGuard` semantics (substrate stays conformant).

## Evidence / anchors

- D288: `docs/rust-port-decisions.md:2515` (the lock + sub-decision list).
- D282: `docs/rust-port-decisions.md:2341` (original mint), `docs/cross-track-ledger.md:55` (the ledger row Path D will close).
- α-shape actor: D255 `docs/rust-port-decisions.md:1960`, D256 `:1968`. Pattern lives in `graphrefly-rs/crates/graphrefly-bindings-js/src/core_actor.rs` (~586 LOC, post-S6).
- Rust substrate batch path: `graphrefly-rs/crates/graphrefly-core/src/batch.rs:3693` (`BatchGuard::discard_wave_cleanup`); `restore_wave_cache_snapshots` peer.
- R4.3.1/R4.3.2 (sink-fire-deferral, throw-rollback): `docs/implementation-plan-13.6-canonical-spec.md:1183`.
- Locked `Impl.batch` signature: `packages/parity-tests/impls/types.ts:428` (`batch(fn: () => void): Promise<void>`).
- Stub: `packages/parity-tests/impls/rust.ts:216–219`.
- 12 D282 scenarios: `packages/parity-tests/scenarios/core/batch-throw-rollback.test.ts`.
- Invariant-watch #4 (no `.await` in actor closure): governs `core_actor.rs` `actor.run` closures; D256 records the single-owner-thread shape.
- Value #6 (pre-design full decision-set; avoid same-arm divergence): `docs/rust-port-decisions.md:2428` D284 reference.

---

## Q1 — Dispatch protocol shape

The actor thread parks holding a `BatchGuard`; JS drives a sync napi handle. What does the wire between them look like?

### Options

- **(a) `crossbeam-channel` outer Sender/Receiver for op delivery + per-op `std::sync::mpsc::sync_channel::<()>(1)` oneshot reply carried *inside* the `BatchOp` envelope.**
  Mirrors α-shape's existing two-channel topology exactly — `core_actor.rs:437` already uses this pattern: outer channel ships the closure, inner `sync_channel::<R>(1)` is created per-call and its `Sender` is moved INTO the closure (the actor sends the result back on it; caller blocks on `rx.recv()`). For Path D the outer channel ships `BatchOp` envelopes; the per-op reply `Sender` rides in the envelope so the actor signals "applied" exactly when each op is done. Op envelope:
  ```rust
  enum BatchOp {
    Down  { node: NodeId, msgs: Vec<Message>, reply: SyncSender<()> },
    Commit                                     { reply: SyncSender<()> },
    Rollback { panic_payload: Option<Box<dyn Any + Send>>, reply: SyncSender<()> },
  }
  ```
  Actor closure on `open_batch`: hold `BatchGuard`; `while let Ok(op) = rx.recv() { match op { Down{reply,..} ⇒ apply; reply.send(()).ok(); Commit{reply} ⇒ flush; reply.send(()).ok(); break; Rollback{reply,..} ⇒ discard_wave_cleanup; reply.send(()).ok(); break } }`. JS-visible `ctx.down(...)` is sync because the napi call blocks on the per-op `rx.recv()` until the actor acks.
- **(b) Same channel shape but `std::sync::mpsc`.**
  Drops the workspace dep on `crossbeam-channel` for this slot. Functionally identical for single-producer-single-consumer; `crossbeam` would only matter if we ever wanted multi-producer (we don't — JS thread is the sole driver). Marginally smaller dep surface.
- **(c) Shared `parking_lot::Mutex<BatchScratch>` + condvar.**
  No channel; JS napi calls grab the lock, mutate scratch, signal the actor, release. Actor wakes, applies, signals back. More awkward for the panic-payload path (no natural "I panicked, here's the payload" wire); reintroduces lock contention exactly where we removed it under α-shape.

### Trade-offs

| Concern | (a) crossbeam | (b) std::mpsc | (c) Mutex + condvar |
|---|---|---|---|
| Pattern fidelity to α-shape | ✅ same primitive | ✅ similar | ❌ regresses to lock model |
| Dep surface | already there | smaller | already there (`parking_lot`) |
| Panic-payload wire | natural (`BatchOp::Rollback(payload)`) | natural | awkward |
| Back-pressure | natural (bounded channel) | natural (bounded `sync_channel`) | manual |
| Ack-on-each-op (so `ctx.down` is JS-sync) | natural | natural | natural |

### Recommendation — **(a) `crossbeam-channel`**

Pattern fidelity to the existing actor wins. The actor closure stays in the same idiom (`recv` loop); the panic-payload envelope is a single `enum` variant; no new primitive to reason about. **✅ LOCKED 2026-05-24.**

### AMEND-D288 — `BatchOp` envelope widened at D289 HALT (2026-05-25)

The Q1 lock above enumerates `BatchOp { Down, Commit, Rollback }` — the minimum surface needed to honor the locked `Impl.batch(fn: () => void)` shape. At the D289 `/porting-to-rs` HALT (`docs/rust-port-decisions.md:2515` D289 entry, 2026-05-25), the user picked "**full Message-tier surface**" over "DATA + COMPLETE + ERROR only" for `BenchBatchContext::down_*`, accepting the D196 deviation for tiers the current 12 D282 scenarios don't exercise (the paired `/dev-dispatch` scenario-rebase IS the consumer pressure).

The envelope widening that landed in `graphrefly-rs/crates/graphrefly-bindings-js/src/batch_bindings.rs`:

```rust
pub(crate) enum BatchOp {
  Down  { node, msg: BatchMessage, reply: SyncSender<()> },
  Pause { node, lock_id, reply: SyncSender<Result<(), String>> },
  Resume { node, lock_id, reply: SyncSender<Result<Option<(u32, u32)>, String>> },
  Commit { reply: SyncSender<()> },
  Rollback { panic_payload: Option<Box<dyn Any + Send>>, reply: SyncSender<()> },
}

pub(crate) enum BatchMessage {
  Data(HandleId), Complete, Error(HandleId), Invalidate, Teardown,
}
```

`Pause`/`Resume` get their own variants (not `Down`) because the substrate calls (`core.pause` / `core.resume`) return `Result<…, PauseError>` and need typed `Result`-carrying reply channels. All other tiers (DATA/COMPLETE/ERROR/INVALIDATE/TEARDOWN) flow through `Down { msg }` because their substrate calls are infallible. The Q1 envelope-shape invariant — "every variant carries its own per-op `sync_channel<R>(1)` reply inside the envelope; JS blocks on `rx.recv()` until the actor acks" — is preserved across all 5 variants.

`BenchBatchContext` napi methods exposed: `down_int` / `down_str` / `down_handle` (DATA), `down_complete`, `down_error_int` / `down_error_str`, `down_invalidate`, `down_teardown`, `down_pause`, `down_resume` (returns `Option<ResumeReportJs>`), `commit`, `rollback`. START (tier 0) and RESOLVED (tier 3) intentionally NOT exposed — substrate-internal (RESOLVED is what compute nodes emit through `FnResult`; START is bootstrap, no public substrate API).

**Why this isn't a Q1 violation:** Q1 locks the **dispatch protocol shape** (channels + per-op replies in envelope) and lists `{Down, Commit, Rollback}` as the *minimum* set required to satisfy the 12 D282 scenarios. The expanded set respects every shape constraint (per-op reply in envelope; sync-block on `rx.recv()`; no `.await` in actor closure; Q3 per-frame lifetime). It does take a D196 deviation on PAUSE/RESUME/INVALIDATE/TEARDOWN tiers — accepted at HALT for cross-arm completeness (the paired TS slice's scenario rebase IS the trigger).

---

## Q2 — "No sink fire during handle dispatch" invariant — formal statement

R4.3.1/R4.3.2 already defer sink fires to commit on the Rust substrate. The binding layer relies on this — if a sink could fire while the actor thread is parked holding `BatchGuard`, the sink callback (a Blocking TSFN dispatch back to JS per `bridge_sync`) would deadlock because the JS thread is busy driving the handle. The invariant needs to be re-stated as a *binding-layer* contract + pinned with a regression test.

### Options for the invariant statement

- **(a) Tight statement.** *"While a `BenchBatchContext` is open, the actor thread executes no `bridge_sync*` / no Blocking-TSFN call. Specifically: `BatchGuard::apply_down`, `apply_set_*`, etc. must enqueue work via `pending_notify` / deferred-cleanup hooks and not invoke any user-callback or sink-wire path until `commit` (which fires `pending_notify`) or `rollback` (which `discard_wave_cleanup`s them)."*
  Pinned via a regression test that opens a context, drives some ops, asserts that no TSFN dispatch happened (e.g., a thread-local counter incremented by every `bridge_sync*` call site, asserted zero across the handle window).
- **(b) Loose statement.** *"Sinks may fire during dispatch as long as they don't block on the JS thread."*
  Weaker; requires per-sink audit and a new "is this sink TSFN-safe" axis. Rejected on its face — every sink in the binding layer is TSFN today (that's what `bridge_sync` is).
- **(c) Lock-mode statement.** *"The actor thread sets a `during_batch_handle: Cell<bool>` flag; every `bridge_sync*` call site checks it and panics if true."*
  Same as (a) but failure-by-panic instead of by-deadlock. More observable in tests; adds one Cell read per `bridge_sync*` call (negligible — single-owner Cell, no atomic).

### Trade-offs

- (a) is the spec-honest version; (c) is (a) plus runtime enforcement; (b) is a no.
- (c)'s panic-on-violation is the kind of "tripwire" that catches future drift (e.g., someone adds a new operator-side TSFN call site and forgets the contract). The cost is ~1 Cell read per binding-side dispatch — cheaper than an atomic.
- **`Cell<bool>` not `AtomicBool`.** D248 makes `Core: !Send + !Sync`; D252 collapsed `IN_TICK_OWNED` from `AHashSet` to `Cell<u64>` exactly because single-owner construction makes the atomic redundant *and* cost-bearing. D254 Tier A bundle (#1+#2) repeated the pattern: `DeferQueue` `Mutex → RefCell, AtomicBool → Cell<bool>` "owner-thread-only by D248-D249 construction; the lock + atomic are unused capacity" (`docs/rust-port-decisions.md:1940`). Under D255 α-shape, the actor's worker thread is the sole writer (sets true on `open_batch`, false on commit/rollback) *and* the sole reader (every `bridge_sync*` call site executes on the actor thread). `AtomicBool` would re-introduce the exact redundancy D252/D254 removed.

### Recommendation — **(a) + (c) bundled: tight statement + Cell<bool> runtime tripwire**

State the invariant in the binding-layer doc; enforce via the `during_batch_handle: Cell<bool>` that every `bridge_sync*` site checks and panics if violated; pin via a regression test that asserts the counter stayed zero across a representative batch-handle window. Precedent for Cell-over-Atomic on this thread: D252 + D254 Tier A. **✅ LOCKED 2026-05-24.**

---

## Q3 — Cross-arm `ctx.down` test contract

The 12 D282 scenarios currently use `(src.inner as { down(msgs): void }).down([[DATA, 42]])` — pure-ts substrate reach-through. The `Impl` contract widens; what shape?

### Options for the widened `Impl.batch` signature

- **(a) `batch(fn: (ctx: BatchCtx) => void): Promise<void>` with `BatchCtx.down<T>(node: ImplNode<T>, msg: Message<T>): void` (single-msg, NOT a singleton array).**
  Each `ctx.down` call is one napi round-trip / one channel op. Surface takes a single `Message<T>` (e.g., `ctx.down(src, [impl.DATA, 42])` where `[impl.DATA, 42]` IS the message tuple — not `ctx.down(src, [[impl.DATA, 42]])` wrapping it in an array). The 12 D282 scenarios all currently call `(src.inner as {down}).down([[DATA, 42]])` — the outer array is the substrate-call-shape artifact, not a semantic ask for multi-msg-per-call. Scenarios rewrite cleanly to single-msg-per-`ctx.down` (per value #1: don't let rewrite cost drive public surface design).
- **(b) `BatchCtx.down<T>(node: ImplNode<T>, msgs: ReadonlyArray<Message<T>>): void` (batch-of-msgs, mirrors substrate `down([msg, msg, …])`).**
  Closer to the substrate's actual `down(messages: Message[])` signature on `NodeImpl`. One channel op for N messages.
- **(c) Both — `down(node, msg)` + `downMany(node, msgs)`.**
  Convenience + the substrate shape both available. Two-method surface.

### Trade-offs

- Scenarios overwhelmingly emit one message at a time; (a) reads cleaner at the call site.
- (b) is closer to substrate truth and saves channel round-trips on multi-msg cases — which the scenarios *don't currently exercise*, so it's speculative.
- (c) gives both at low cost but adds a surface item.

### Open question on `BatchCtx` shape beyond `down`

The 12 scenarios only need `ctx.down` today. But: do we widen now or lazily? Other surface candidates: `ctx.signal(name, msgs)`, `ctx.setDeps(node, deps)` (the D5/D263/D264 set-deps inside batch case). **Recommended:** YES `down` only for D288's slice; flag the rest as follow-on when consumer pressure surfaces (D196 rule). Adding methods is additive; widening prematurely violates value #6.

### Recommendation — **(a) `ctx.down(node, msg)` single-msg only + per-frame lifetime contract**

Cleanest call site; matches scenario use; (b) is a speculative widening on substrate-shape grounds that D196 doesn't justify. If multi-msg scenarios surface later, add `downMany` then.

**Lifetime contract — `ctx` is per-frame, do NOT stash.** The `ctx` argument is valid only for the synchronous duration of the `fn` invocation. Stashing it in a closure that fires later (e.g., `setTimeout(() => ctx.down(...), 0)`, or capturing into a Promise resolver) is a user bug — by the time the stashed closure runs, the actor thread has either committed or rolled back the batch, the `BatchGuard` is dropped, and the underlying channel `Sender` has been moved out of the actor closure. On the native arm, post-batch `ctx.down(...)` rejects loudly (the napi handle's `Drop` impl has fired; the next sync call panics through napi as `"BenchBatchContext used after batch closed"`). Document on `BatchCtx`'s JSDoc + the `Impl.batch` JSDoc; pin with a regression test that asserts post-frame `ctx.down` throws on both arms.

**✅ LOCKED 2026-05-24** — (a) single-msg + "down-only-for-now" follow-on policy + per-frame lifetime contract all locked together.

---

## Q4 — D080 forward-compat decoupling — explicit non-precedent

D288 says Path D doesn't pre-commit DS-14 / D080. The design session should mint that rationale explicitly so future readers don't infer "sync handle is the GraphReFly substrate idiom for callback-bearing primitives."

### Options for the non-precedent statement

- **(a) Doc-only — add a paragraph to D288's rationale block citing this DS, no API marker.**
  Future readers find the rationale by following D288 → this DS. Costs zero code.
- **(b) Name-level marker — call the surface `Impl.batchSync(fn: (ctx) => void)` to leave room for a future `Impl.batchAsync(fn: (ctx) => Promise<void>)`.**
  Pre-commits the *name* to a "sync flavor" framing. Loses the locked `Impl.batch` shape on a question DS-14 hasn't actually answered.
- **(c) Decoupling spelled out in `Impl.batch` JSDoc.**
  *"`Impl.batch` is a sync-fn-body primitive by D282 lock. Path D's sync-handle binding pattern is a binding-layer mechanism, NOT a precedent for future callback-bearing primitives — DS-14 / D080 retain free hand on whether `mutate` / `withSnapshot` / op-log-replay take sync or async bodies. See `archive/docs/SESSION-DS-D288-native-batch-path-D.md` Q4."*
  Surface in the right place; zero cost; survives if someone reads only the type.

### Trade-offs

- (b) buys nothing today and renames a locked symbol; rejected.
- (a) is fine but discoverable only via D-numbers.
- (c) puts the contract where readers actually look (the type).

### Recommendation — **(a) + (c) bundled**

Mint the rationale in this DS; mirror a compact version in the `Impl.batch` JSDoc. **✅ LOCKED 2026-05-24.**

---

## Q5 — Pure-ts ergonomic preservation

The ledger row already pre-records the answer: existing sync `legacy.batch(fn)` stays the substrate-level API; the cross-arm `ctx` is a thin pure-ts wrapper that forwards `ctx.down(node, msg)` to `(node.inner as NodeImpl).down(msg)`. Confirm or amend.

### Options

- **(a) Confirmed shape: pure-ts substrate API unchanged; parity-layer wraps.**
  `legacy.batch(fn: () => void)` keeps the existing zero-arg-fn signature. `packages/parity-tests/impls/pure-ts.ts` `batch` becomes `async batch(fn) { legacy.batch(() => fn(makePureTsCtx())); }` where `makePureTsCtx()` returns `{ down: (node, msg) => (node.inner as NodeImpl).down([msg]) }`. Zero churn for pure-ts consumers; only the parity adapter shifts.
- **(b) Widen the pure-ts substrate API too: `legacy.batch(fn: (ctx?) => void)`.**
  Same-arm consumer-visible change — pure-ts users would either see `fn` gain an optional `ctx` arg they don't use, OR we'd publish two `batch` overloads. Adds surface for no clear win (pure-ts already has substrate access without the ctx).
- **(c) Two batch APIs: substrate-level `legacy.batch(fn)` AND parity-aligned `legacy.batchWithCtx(fn)`.**
  Discoverability cost on pure-ts users; "which do I use?" axis with no obvious answer.

### Trade-offs

- (b) violates Value #6 — same-arm divergence to ratify a cross-arm gap.
- (c) ships the same divergence as two named methods. No.
- (a) keeps the substrate clean; parity layer eats the complexity (which is what parity layers exist for).

### Recommendation — **(a) confirmed**

Substrate stays at `legacy.batch(fn: () => void)`. Parity adapter is a 3-line wrapper. The cross-arm `ctx.down` shape exists only at the `Impl` boundary. **✅ LOCKED 2026-05-24.**

---

## Aggregate HALT — recap of recommended locks

| Q | Recommendation (post-2026-05-24 user corrections) |
|---|---|
| Q1 dispatch protocol | (a) `crossbeam-channel` outer Sender/Receiver, blocking-`recv`, op envelope `BatchOp { Down{reply}, Commit{reply}, Rollback{payload, reply} }` — **per-op `std::sync::mpsc::sync_channel::<()>(1)` reply carried inside the envelope** (mirrors α-shape's existing pattern at `core_actor.rs:437`) |
| Q2 no-sink-fire invariant | (a) tight statement + (c) `during_batch_handle: Cell<bool>` runtime tripwire panic + pinned regression. **`Cell<bool>` NOT `AtomicBool`** — single-owner by D248; precedent at D252 (`Cell<u64>` IN_TICK_OWNED collapse) + D254 Tier A `DeferQueue` `AtomicBool→Cell<bool>` |
| Q3 `ctx` surface | (a) `ctx.down(node, msg)` single-msg only (**single `Message<T>`, NOT a singleton array** — substrate-call `[[DATA, 42]]` outer-array is an artifact, scenarios rewrite cleanly per value #1). **`ctx` is per-frame, do NOT stash** — post-frame `ctx.down(...)` rejects loudly; pinned regression. Other methods deferred per D196 |
| Q4 D080 non-precedent | (a) mint rationale here + (c) compact JSDoc note on `Impl.batch` |
| Q5 pure-ts ergonomics | (a) substrate `legacy.batch(fn)` unchanged; 3-line parity wrapper injects `ctx` |

## What lands when Q1–Q5 are locked

Two paired slices (NOT started this session):

1. **`/porting-to-rs` slice** in `graphrefly-rs/crates/graphrefly-bindings-js/`:
   - New `BenchBatchContext` napi class (sync handle methods: `down(node_id, msgs_json)`, `commit()`, `rollback(payload?)`; `Drop` impl calls `rollback` if not committed).
   - `BenchCore::open_batch() -> BenchBatchContext` napi method that parks the actor thread holding `BatchGuard` on a `crossbeam-channel` `recv` loop.
   - `during_batch_handle: AtomicBool` + `bridge_sync*` tripwire panic.
   - Regression tests pinning: (a) sink-fire-zero across a representative batch-handle window; (b) panic-during-fn triggers `discard_wave_cleanup` parity with R4.3.2; (c) commit fires `pending_notify` exactly once at close.

2. **`/dev-dispatch` slice** in `graphrefly-ts`:
   - Widen `Impl.batch(fn: () => void): Promise<void>` → `Impl.batch(fn: (ctx: BatchCtx) => void): Promise<void>` in `packages/parity-tests/impls/types.ts`; add `BatchCtx` type with `down<T>(node: ImplNode<T>, msg: Message<T>): void`.
   - `packages/parity-tests/impls/pure-ts.ts` `batch` adapter: 3-line wrapper injecting pure-ts `ctx`.
   - `packages/parity-tests/impls/rust.ts` Proxy `get` trap drops the `batch` throwing stub; wires the wrapper that opens the napi `BenchBatchContext` and forwards `ctx.down` calls.
   - Rewrite 12 D282 scenarios in `batch-throw-rollback.test.ts` from `(src.inner as {down}).down(...)` to `ctx.down(src, ...)`; drop `runIf(impl.name === "pure-ts")` gates.
   - Update D288 entry → "LANDED"; update cross-track-ledger §1 D282 row → "TS ✅ + native ✅ aligned" with a pointer to the landed D-number; archive both on next sweep per the D287/D283 pattern.

Each slice has its own gate (cargo test green / `pnpm --filter @graphrefly/parity-tests test` 12-of-12 D282 cross-arm green). Order: `/porting-to-rs` slice first (substrate-down), then `/dev-dispatch` slice picks up against the rebuilt `.node`.

---

**Q1–Q5 ✅ LOCKED 2026-05-24.** Both paired slices are now design-unblocked but **NOT implementation-approved** — per `feedback_no_implement_without_approval`, the paired `/porting-to-rs` + `/dev-dispatch` slices wait for an explicit user "implement" call. This DS doc + the D288 entry are the lock record.
