# SESSION DS-D292 — Native async lifecycle: `@graphrefly/native@0.1.0` minor bump

> **Status:** ✅ **LOCKED 2026-05-25** via `/design-review`. User approved all 4 sub-decision picks + 5 refinements. Implementation slice opens next as paired `/porting-to-rs` batch.
>
> **Authority:** `~/src/graphrefly-ts/docs/rust-port-decisions.md` D292; this session record is the canonical Q5–Q9 walk-through.

## Scope

Three-target binding-layer slice for `@graphrefly/native@0.1.0` (D265 hold-local until user tag-push):

- **D.1** — `BenchGraph.derived(name, deps, fn)` arbitrary-fn widening. Lifts D287 carve-out on `packages/parity-tests/scenarios/graph/resource-profile.test.ts` test #1 cross-arm (currently `runIf(impl.name === "pure-ts")` because the native arm's `BenchGraph::derived` at [`wrapper.js:569-577`](../../../graphrefly-rs/crates/graphrefly-bindings-js/wrapper.js) throws on arbitrary JS callbacks).
- **D.2** — Async `BenchBatchContext::commit` + `rollback`. Lifts D291 Case 15a `runIf(pure-ts)` gate on `packages/parity-tests/scenarios/core/batch-throw-rollback.test.ts:928`; closes the libuv-sync-commit deadlock (sync napi blocks libuv → `BatchGuard::Drop`'s success-path `fire_deferred` can't reach TSFN-backed JS sinks → 3-way deadlock) + closes BH15 (sink panic during `fire_deferred` hangs JS caller forever).
- **D.3** — Post-D293 lifecycle residuals (5 sub-items): (1) libuv-finalizer drop-running-join hazard, (2) silent close-error swallow in wrapper.js, (3) nested `Symbol.asyncDispose` on Graph/Subscription, (4) close-cancels-vs-drains semantics, (5) `process.on('beforeExit')` safety net default.

**D293 prerequisite:** the lifecycle MVP (`CoreActor::shutdown` + `BenchCore::close` + top-level `Symbol.asyncDispose` + `Impl.close()` widening) shipped 2026-05-25 as the patch-tier candidate (`@graphrefly/native@0.0.8` candidate; D265 hold-local). D292 is the v0.1.0 follow-on that lifts what D293 deliberately deferred.

**Cross-cutting reason for one session:** D.2 panic-propagation (Q2.5) and D.3 Item 2 (close-error reject-vs-swallow) are the same concern at different layers. D.1 closure-cell lifetime ties into D.3 Item 4 (close-drains-batch must also drop the closure-cell registry). Locking all three together prevents same-arm divergence.

## Evidence / anchors

- `~/src/graphrefly-ts/docs/cross-track-ledger.md` §1 — D293 row (locked 2026-05-25); D282 row Case 15a `pending D292 async-commit` carry; D283 row test #1 `runIf` carry.
- `~/src/graphrefly-rs/docs/porting-deferred.md` — § "D293 → D292 carries" (drop-running-join + silent close-error swallow), § "D291 → D292 carry — `BatchOp::Commit` panic-during-drop hang" (BH15).
- `~/src/graphrefly-ts/docs/optimizations.md` "🔴 DESIGN SESSION FIRST — `@graphrefly/native` async lifecycle batch (D292 pre-design)" — D.1/D.2/D.3 queued; reframes to "✅ LOCKED" on this session's close.
- `archive/docs/SESSION-DS-D288-native-batch-path-D.md` — D288 Q1–Q5 locks (Path D parked-actor + `crossbeam-channel` + per-op `sync_channel`); D292 D.2 reopens Q5 but preserves Q1+Q2+Q3+Q4.
- D255 α-shape (single-worker-per-Core actor model) — load-bearing for the D.2 refinement (`tokio::task::spawn_blocking`, not `actor.run`).
- D196 consumer-pressure gate — D.3 Item 3 deferral cites this.

---

## D.1 — `BenchGraph.derived(name, deps, fn)` arbitrary-fn widening

### Locked: **Option A — async `BenchGraph::derived` via D263 reroute**

```js
// crates/graphrefly-bindings-js/wrapper.js (replaces the current throwing stub at :569-577)
async derived(name, deps, fn) {
  const fnId = ++this._nextFnId;
  this._closureCells.set(fnId, fn);
  const nodeId = await this._operators.registerUserDerived(
    deps.map(d => d.inner), fnId
  );
  await this._bench.addNode(name, nodeId);
  const node = new NativeNode(this.core, nodeId, this.registry);
  this.nodesByName.set(name, node);
  this.nodeIdToName.set(nodeId, name); // D267 reverse cache
  // closure-cell auto-evicted on graph.remove(name) / destroy()
  return node;
}
```

Mirrors the D285 `tag_factory` shape: 2 napi crossings per call (`registerUserDerived` + `addNode`), JS-side closure-cell map keyed by `fnId`, eviction wired into the existing `nodesByName` teardown path (graph.remove / graph.destroy / impl.close cascade).

### Refinement (R1)

**JSDoc on `BenchGraph.derived` MUST cite the closure-cell eviction coupling.** Exact lock text:

> ```
> /**
>  * Construct an arbitrary-fn derived node via the D263 TSFN reroute.
>  *
>  * **CLOSURE-CELL LIFETIME (anti-pattern #5 watch):** the JS-side `fn`
>  * is retained in `this._closureCells` keyed by an auto-generated `fnId`.
>  * The cell is evicted ONLY when the substrate tears the node down,
>  * which today happens via `graph.remove(name)` or `graph.destroy()`
>  * cascading into `Core::teardown_node` (R2.6.4) → eviction hook fires.
>  *
>  * **If substrate teardown ever evolves to fire outside graph.remove /
>  * graph.destroy** (e.g., a future GC-driven sweep, a `Core::trim_dead_nodes`
>  * primitive, etc.), update the eviction wiring HERE — silently leaving the
>  * closure cell alive past the substrate node IS the foot-gun.
>  */
> ```

### Why not B / C

- **B (pure-JS wrapper around `impl.combine + impl.map + g.add`)** — would introduce an intermediate `combine` node, regressing the very `nodeCount=3` parity test #1 wants → doesn't lift the D287 carve-out. Rejected.
- **C (substrate-level `derived_user_fn` single-napi-crossing)** — perf optimization (1 napi crossing instead of 2). Defer until consumer pressure on a hot `derived` loop surfaces (D196 gate). Non-breaking widening to add later.

### Scope notes (D.1)

- `Impl.derived(g, name, deps, fn)` widened on `packages/parity-tests/impls/types.ts` (Promise<ImplNode<T>>).
- D287 `runIf(pure-ts)` gate dropped on `scenarios/graph/resource-profile.test.ts` test #1.
- Pure-ts arm's `Impl.derived` adapter forwards to existing `legacy.derived` (which already returns `Promise<Node<T>>` via the legacy `async derived` path).
- Cross-track-ledger §1 D283 row STATUS updated: "✅ TS ↔ native aligned 2026-05-25 (D283 lift via D292 D.1)."

---

## D.2 — Async `BenchBatchContext::commit` + `rollback`

### Locked: **Option A — preserve parked-actor; async commit/rollback via `tokio::task::spawn_blocking`**

```rust
// crates/graphrefly-bindings-js/src/batch_bindings.rs
// BenchBatchContext::commit becomes:
#[napi]
pub async fn commit(&self) -> napi::Result<()> {
    if self.closed.swap(true, Ordering::AcqRel) {
        return Err(napi::Error::from_reason("BenchBatchContext used after batch closed"));
    }
    let (tx, rx) = sync_channel::<Result<(), String>>(1);
    self.op_tx.send(BatchOp::Commit { reply: tx })
        .map_err(|_| napi::Error::from_reason("BenchBatchContext used after batch closed"))?;
    // R2 (D292 refinement): spawn_blocking, NOT actor.run — D255 α-shape is
    // single-worker-per-Core; a pending sync rx.recv() inside actor.run
    // would serialize every concurrent actor.run read behind this commit.
    // spawn_blocking moves the blocking await to tokio's blocking pool,
    // leaving the Core actor free.
    tokio::task::spawn_blocking(move || rx.recv())
        .await
        .map_err(|_| napi::Error::from_reason("BenchBatchContext: spawn_blocking join failed"))?
        .map_err(|_| napi::Error::from_reason("BenchBatchContext: actor reply channel closed"))?
        .map_err(napi::Error::from_reason)
}
```

The parked-actor's `BatchOp::Commit` arm wraps `drop(guard_holder.take())` in `catch_unwind` and converts a sink panic into `reply.send(Err(panic_msg))` — JS Promise rejects cleanly instead of hanging forever (closes Q2.5 BH15).

### Refinement (R2 — D255 α-shape correction)

**Use `tokio::task::spawn_blocking(move || rx.recv())`, NOT `actor.run(|_core| rx.recv())`.** D255 α-shape locks single-worker-per-Core actor model; a pending sync `rx.recv()` inside an `actor.run` closure would block every subsequent `actor.run` read against that Core until the commit reply lands. `spawn_blocking` moves the blocking wait to tokio's blocking pool — Core actor stays free; libuv stays free; other in-flight reads against the Core proceed unblocked.

**Lock text for `actor.run` doc-comment** (defensive guidance to prevent future regression):

> ```rust
> /// **Do not call `rx.recv()` (or any blocking sync op) inside an
> /// `actor.run` closure body — D255 α-shape locks single-worker-per-
> /// Core, so a blocked closure serializes every subsequent actor.run
> /// against the same Core. Use `tokio::task::spawn_blocking` for
> /// sync-channel waits and `tokio::sync` primitives for async waits.**
> /// Reference: D292 D.2 R2 refinement.
> ```

### Refinement (R3 — rollback symmetry)

**Make rollback panic propagation symmetric with commit.** Both arms of the parked-actor loop widen their reply channel + wrap their substrate call in `catch_unwind`:

- `BatchOp::Commit { reply: SyncSender<Result<(), String>> }` + `catch_unwind` around `drop(guard_holder.take())` (the success-path `fire_deferred` site).
- `BatchOp::Rollback { reply: SyncSender<Result<(), String>>, panic_payload: Option<Box<dyn Any + Send>> }` + `catch_unwind` around `discard_wave_cleanup` (the panic-path cleanup site).

Both arms ack-first → convert any closure panic into `reply.send(Err(panic_msg))` → JS Promise rejects with the captured panic message; CoreActor not bricked (the actor's outer `catch_unwind` at `core_actor.rs:356` is the safety net, but the inner `catch_unwind` is what surfaces the error cleanly).

### Why not B / C

- **B (collapse parked-actor entirely; route every batch op through `actor.run`)** — drops `BatchOp` enum + parked-actor; 12× actor.run overhead per batch frame; loses D288 Path D's locked "amortize 12 ops in 1 parked closure" perf shape. Reopens D288 Q1 (rejected Path B). Rejected.
- **C (hybrid — parked-actor for `down_*`, async `actor.run` for commit/rollback)** — requires a substrate-level "stable guard id" mechanism so the `BatchGuard` can be referenced across two different actor-thread closures. Non-trivial substrate widening; no precedent. Rejected.

### Scope notes (D.2)

- `closed: Cell<bool>` → `closed: AtomicBool` (cross-async-task safety with `swap(true, Ordering::AcqRel)` matching D293's `shutdown_flag` precedent).
- D291's explicit `drop(handle_guard)` BEFORE `drop(guard_holder.take())` in `BatchOp::Commit` preserved (Q2 invariant on tripwire ordering); the new `catch_unwind` wraps the `drop(guard_holder.take())` line, not the surrounding `drop(handle_guard)`.
- Cargo regression `d292_async_commit_panic_propagates_as_rejection` — REQUIRED to use a TSFN-backed sink (Rust-side `napi::bindgen_prelude::ThreadsafeFunction` fixture), NOT just `Rc<dyn Fn>`. D291's substrate test passed with `Rc` sinks but didn't exercise the libuv-vs-actor handoff path that causes Case 15a's deadlock.
- Case 15a `runIf(pure-ts)` gate dropped in `scenarios/core/batch-throw-rollback.test.ts:928`.
- Cross-track-ledger §1 D282 row STATUS updated: "✅ Case 15a aligned 2026-05-25 (D292 D.2); row CLOSED, archive on next sweep alongside D292 row + D283 row + D293 row."

---

## D.3 — Post-D293 lifecycle residuals (5 sub-items)

### Item 1 — Drop-running-join on libuv: **Locked: A — FinalizationRegistry-driven `napi::bindgen_prelude::spawn(shutdown)`**

```js
// crates/graphrefly-bindings-js/wrapper.js
const _finalizer = new FinalizationRegistry((coreHandle) => {
  // Posts the shutdown work to napi's tokio runtime so the join
  // happens off the libuv thread. coreHandle is a stable reference
  // (the napi class instance's underlying Rust pointer wrapper).
  coreHandle._finalizeAsync();  // calls napi::bindgen_prelude::spawn on Rust side
});

export function createNativeImpl(opts = {}) {
  // ...existing...
  _finalizer.register(impl, state.core, impl);
  // ...
}
```

```rust
// crates/graphrefly-bindings-js/src/core_bindings.rs
#[napi]
impl BenchCore {
    #[napi]
    pub fn finalize_async(&self) {
        let actor = self.actor.clone();
        // Posts to napi's tokio runtime — NOT a tokio::spawn against
        // a generic runtime. napi::bindgen_prelude::spawn ensures the
        // future runs on the napi-managed runtime so its lifecycle is
        // tied to the napi module, not a user-managed runtime.
        napi::bindgen_prelude::spawn(async move {
            actor.shutdown();  // sync method; runs on the spawned task
        });
    }
}
```

`Drop for CoreActor` stays in place as the synchronous-shutdown safety net for non-libuv drop sites (Rust-side ownership transfers, panic unwinds, etc.); the FinalizationRegistry path is the OPT-IN async path for the libuv-finalizer case.

### Item 2 — Silent close-error swallow: **Locked: A — reject on actor errors**

```js
// crates/graphrefly-bindings-js/wrapper.js
// Replace:
//   impl.close = async () => { await state.core.close().catch(() => {}); };
// With:
impl.close = async () => state.core.close();
// (No .catch. Errors surface as rejected Promise per Promise contract.)
```

Pre-1.0, surfacing uncaught rejections IS the desired behavior — users who want silent cleanup wrap in `try { await impl.close(); } catch { /* swallow */ }`. The previous swallow-by-default was a D293-era backward-compat carry for the parity harness's pre-`close()` `_dispose` afterEach pattern; with `_dispose` removed (F4 below), the swallow has no justification.

### Item 3 — Nested `Symbol.asyncDispose` on Graph/Subscription: **Locked: A — defer until consumer pressure (D196 gate)**

No code change. Future addition is non-breaking; deferring keeps the v0.1.0 surface tight. README's "Closing a NativeImpl" section documents the canonical pattern: top-level `await using impl = createNativeImpl()` cascades into all sub-surfaces via the actor shutdown.

### Item 4 — close-cancels-in-flight vs close-waits: **Locked: A — close-waits (drain)**

```js
// crates/graphrefly-bindings-js/wrapper.js
impl.close = async () => {
  // Drain in-flight commit/rollback awaits BEFORE shutting down the
  // actor. D288 Q3's per-frame lifetime contract guarantees no
  // truly-zombie BenchBatchContexts — BatchContextInner::Drop posts
  // a best-effort Rollback if neither commit/rollback was called —
  // so the "drain" is bounded by the longest in-flight batch frame.
  await state.core.close();  // actor.shutdown() inside awaits the worker join
};
```

Pairs naturally with D.2's async commit Promise (a pending `await ctx.commit()` resolves before `state.core.close()` joins the worker). The substrate-side `CoreActor::shutdown` already takes the join lock; the JS side just needs to not bail before the join completes.

### Refinement (R4 — runtime-discoverable warning)

**`Impl.close` JSDoc MUST carry the "stuck closure → close hangs" caveat.** Users discover hangs at runtime, not in README. Exact lock text added to `packages/parity-tests/impls/types.ts:608-624` `Impl.close` JSDoc (one-line append):

> ```
>  * **Note (D292 D.3 Item 4):** `close()` DRAINS in-flight ops (batch
>  * commits, async describes) before shutting down. A stuck user closure
>  * inside an in-flight op → `close()` hangs until the closure returns.
>  * Wrap in `Promise.race([impl.close(), timeoutMs])` if bounded close
>  * time matters.
> ```

### Item 5 — `process.on('beforeExit')` safety net: **Locked: B — default-off opt-in via `createNativeImpl({ autoCloseOnBeforeExit: true })`**

```js
// crates/graphrefly-bindings-js/wrapper.js
export function createNativeImpl(opts = {}) {
  // ...existing...
  if (opts.autoCloseOnBeforeExit) {
    const handler = async () => { await impl.close(); };
    process.on('beforeExit', handler);
    // Detach the handler on explicit close so a `await impl.close()` followed
    // by process exit doesn't double-fire.
    const userClose = impl.close;
    impl.close = async () => {
      process.removeListener('beforeExit', handler);
      await userClose();
    };
  }
  // ...
}
```

Default-off respects user agency; pre-1.0 semantic stays unlocked; opt-in is non-breaking to widen later if consumer pressure surfaces.

### Refinement (R5 — opt-in discoverability)

**README's "Closing a NativeImpl" section MUST include a "When to opt in to `autoCloseOnBeforeExit`" subsection.** Without an explicit decision rubric, B's opt-in lands as "an option nobody knows when to use." Lock text for the new subsection (added to `crates/graphrefly-bindings-js/README.md`):

> ```markdown
> ## When to opt in to `autoCloseOnBeforeExit`
>
> The default surface (`createNativeImpl()`) does NOT register a
> `process.on('beforeExit', () => impl.close())` safety net — you call
> `close()` explicitly (or use `await using` on Node 22+). Opt in to
> `createNativeImpl({ autoCloseOnBeforeExit: true })` ONLY when ALL three
> apply:
>
> 1. Your runtime fires `beforeExit` reliably. **NOT** under: jest worker
>    pools with `isolate: false`; deno; browser (wasm); `process.exit()`
>    paths; long-lived servers (`beforeExit` only fires when the event
>    loop is genuinely empty).
> 2. You can't sequence an explicit `await impl.close()` at the right
>    place (e.g., your code creates a NativeImpl as a module-level
>    singleton with no natural teardown hook).
> 3. You accept that `beforeExit` runs synchronously — close-drain
>    semantics (Item 4) may block process exit beyond expected timing.
>
> If any of the three doesn't hold, prefer `await using` (Node 22+) or
> explicit `try/finally`.
> ```

---

## Phase 2 — Cross-cutting findings (locked)

### F1 — Async-everywhere convergence at the batch frame

**Refined per user:** F1's original phrasing ("close calls ctx.rollback() on any unclosed contexts") is overstated — D288 Q3's per-frame lifetime contract (`BatchContextInner::Drop` posts best-effort `Rollback` if neither commit/rollback was called) makes truly-zombie ctxs impossible. The correct phrasing is **"close drains in-flight commit/rollback awaits."** Lock text:

> `impl.close()` awaits any in-flight `ctx.commit()` / `ctx.rollback()` Promise before joining the worker. D288 Q3 guarantees no orphaned ctxs survive (BatchContextInner::Drop is the safety net for forgotten ctxs). The close-drain shape is bounded by the longest in-flight batch frame's commit/rollback completion.

### F2 — Panic-propagation contract is shared (Q2.5 ↔ Item 2.A)

**Locked unified shape:** every napi method that posts to the actor MUST surface actor panics as rejected Promises with a payload-string error message; the wrapper.js MUST NOT `.catch(() => {})` any actor error. Applies to commit, rollback, close, and any future widening. The `core_actor.rs:356` outer `catch_unwind` stays as the BenchCore-survival safety net; per-op `catch_unwind` (D.2 R3) is what surfaces the panic to JS.

### F3 — Closure-cell registry teardown

**Locked:** D.1's `_closureCells.set(fnId, fn)` is evicted on:
1. `graph.remove(name)` — single-node teardown
2. `graph.destroy()` — whole-graph teardown
3. `impl.close()` — actor shutdown sweeps all remaining cells

Wired into the existing `nodesByName` teardown path; one mechanism, no new state machine. R1's JSDoc anti-pattern #5 watch covers the future-evolution case.

### F4 — Drop `_dispose` entirely

**Locked per user value #1 (no backward compat, pre-1.0):** drop `wrapper.js:1398 impl._dispose = impl.close` in the same slice. Sweep `packages/parity-tests/` for `_dispose` callsites; replace each with `close()`. The parity harness afterEach pattern was the only `_dispose` consumer; rewriting to `close()` IS the value-#1 clean cut.

---

## Open follow-ups (after D292 lands)

None at lock time. The D265 hold-local-vs-OIDC-tag-push question is independent of D292 (user-gated; lands when user tags); the D196 deferred items (D.3 Item 3 nested `Symbol.asyncDispose`) re-open only on consumer pressure.

## Acceptance bar (for the implementation slice)

- Substrate-internal: zero changes (D292 is a binding-layer slice).
- `crates/graphrefly-bindings-js/`: changes per D.1 / D.2 / D.3 above.
- New cargo regressions: `d292_async_commit_panic_propagates_as_rejection` (TSFN-backed sink fixture), `d292_async_rollback_panic_propagates_as_rejection`, `d292_close_drains_inflight_batch`, `d292_finalize_async_off_libuv`, `d292_auto_close_on_before_exit_opt_in`.
- Parity-tests: `Impl.derived(g, name, deps, fn)` widening + drop D287 carve-out gate (test #1) + drop D291 Case 15a `runIf` gate + new `scenarios/usage/close-drains.test.ts` for Item 4 + sweep `_dispose` → `close` cross-arm.
- `mise run gate` (graphrefly-rs): GREEN with the new tests.
- `pnpm --filter @graphrefly/parity-tests test`: GREEN cross-arm (rust-via-napi arm runs against the locally-rebuilt napi `.node`).
- `~/src/graphrefly-rs/docs/migration-status.md`: D292 closing block.
- `~/src/graphrefly-rs/docs/porting-deferred.md`: D293 → D292 carries CLOSED; D291 → D292 carry CLOSED.
- `~/src/graphrefly-ts/docs/cross-track-ledger.md`: §1 D282 / D283 / D293 rows + (new) D292 row all marked CLOSED, archive on next sweep.
- `~/src/graphrefly-ts/docs/optimizations.md`: "🔴 DESIGN SESSION FIRST" block archived to `archive/optimizations/resolved-decisions.jsonl` id `d292-native-async-lifecycle-locked-2026-05-25`.

---

## Canonical

- This session record (Q5–Q9 walk-through + 5 refinements).
- `~/src/graphrefly-ts/docs/rust-port-decisions.md` D292 (design lock entry).
- `~/src/graphrefly-ts/docs/optimizations.md` "✅ D292 LOCKED" reframe.
- `~/src/graphrefly-rs/docs/migration-status.md` "Real options remaining D" reframe.
- D293 (predecessor patch slice); D288 (Path D lock that D.2 reopens Q5 on); D291 (Case 15a substrate fix that D.2 lifts cross-arm); D287 (test #1 carve-out that D.1 lifts); D255 (α-shape that R2 corrects against); R4.3.2 (canonical-spec rule the batch-throw-rollback parity scenarios pin).
