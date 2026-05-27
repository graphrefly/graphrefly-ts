---
name: decision-guard
description: "GraphReFly Rust-port decision-consistency check. Loads the user's locked values/principles/invariants + the canonical D-numbered decision log + recurring decision-process patterns. Use BEFORE answering any question of the form 'is this consistent with our decisions?', 'should I pick option A/B/C?', 'what about this proposed fix?', 'is X part of our scope?', 'is this a regression on a prior decision?'. Triggers: 'decision check', 'drift check', 'align check', 'is this consistent', 'should I pick', 'what about this', 'is this in scope', 'consistency review'."
argument-hint: "[short context of what you're being asked about — paste the chat/proposal if relevant]"
---

# decision-guard — Recall and apply locked decisions, values, invariants

**Purpose.** Future conversations about the GraphReFly Rust port lose context-window state quickly. This skill is the canonical recall surface: invoke it BEFORE answering decision questions to anchor against the user's locked positions and prevent silent drift. Especially valuable when:

- A chat (or a subagent's chat) proposes a scope expansion mid-implementation.
- Multiple options (A/B/C, α/β/γ) are presented as a fork.
- A "completeness" argument is used to justify expanding a locked slice.
- A finding is being triaged (patch / defer / reject).
- A premise sounds plausible but might be stale (the substrate moved under it).

The user has repeatedly invoked patterns from this skill across sessions; relay-ready answers should cite them by name.

## Authority pointers (load these only if the question requires them)

| File | What it is |
|---|---|
| `~/src/graphrefly-ts/docs/rust-port-decisions.md` | **D-numbered decision log.** Each entry has Date / Context / Options / Decision / Rationale / Affects. The canonical record. |
| `~/src/graphrefly-rs/docs/migration-status.md` | Milestone + slice closing blocks; the live tracker. |
| `~/src/graphrefly-rs/docs/porting-deferred.md` | Deferred concerns registry. Findings matching an entry here → **reject silently** in /qa. |
| `~/src/graphrefly-ts/docs/cross-track-ledger.md` | TS↔Rust coupling events. Substrate-contract widening lands here BEFORE the change. |
| `~/src/graphrefly-ts/docs/implementation-plan-13.6-canonical-spec.md` | **Behavior authority** for the Rust port. Canonical spec wins over current TS impl per §11 Implementation Deltas. |
| `~/src/graphrefly-ts/archive/optimizations/cross-language-notes.jsonl` | Verified, sanctioned divergences (`divergence-*` ids). Findings matching these → reject silently. |

## User values & principles (immovable; cite these by name)

1. **No backward compat (pre-1.0).** Free to refactor/rename any API. No legacy shims. Memory: `feedback_no_backward_compat`. When user says "ignore legacy/backward compat" → take the structurally cleaner option without hesitation.
2. **No imperative triggers in public API.** Coordination via reactive `NodeInput` signals and message flow. Imperative methods only on L2.35 controller-with-audit primitives. Actively remove imperative paths when no caller depends. Memory: `feedback_no_imperative`.
3. **Single source of truth.** No mirroring logic across FFI boundary; no duplicate state. Core is authority on its invariants; binding/JS-side preflight = drift bait. Memory: `feedback_single_source_of_truth`.
4. **No autonomous decisions.** Surface spec↔code conflicts; don't silently pick. File-by-file review cadence for multi-file rewrites. Memory: `feedback_no_autonomous_decisions`. **Hard rule.**
5. **No implement without approval.** Decisions locked ≠ implementation approved. Wait for explicit "implement" instruction. Memory: `feedback_no_implement_without_approval`.
6. **Pre-design full decision-set before slicing.** Avoid CoreFull-style accretion (D232→D243→D244→D245 layered widening). Design facade traits' full surface ONCE. Cite spec R-IDs in test expectations. Audit user-visible semantics at design time, not in QA. Memory: `feedback_pre_design_full_decision_set`.
7. **Verify premise before greenfield.** Design-session task tables lag the code; grep named symbols + check landed markers before any 9Q. Surface stale premises as a HALT. Memory: `feedback_verify_premise_before_greenfield`. This pattern has produced multiple wins (D256 invoke_fn_with_core premise-check; D260 timing-divergence reframe).
8. **Sync internal, async at boundary — BOTH directions.** Async/Promise only at the four sanctioned edges (napi `#[napi] async fn` surface, wrapper.js public surface, `timer.rs` tokio task, `graphrefly-storage` tokio integration). Inside `graphrefly-core` / `graphrefly-graph` / `graphrefly-operators` / `graphrefly-structures`: pure sync + reactive. **The boundary applies in BOTH directions** — sync escape hatches on binding read methods callable from inside TSFN callbacks violate the invariant (D070/D077 deadlock recurrence). Read methods on Bench* napi classes must be `async fn`. Memory: extend `feedback_async_sources_binding_layer`.
9. **Consumer-pressure (D196).** No speculative substrate surface. A Rust-core symbol gets a napi binding when (a) a non-pattern consumer materializes, OR (b) a parity scenario exercises it cross-impl. "Parity scenarios are the consumer pressure signal." Applies recursively — don't add features expecting future use; wait for the test/scenario that needs them.
10. **Spec is authority.** The canonical-spec doc wins over current TS implementation. Widening must be explicit (cross-track-ledger event). Test expectations cite R-IDs (R1.3.5.a, R2.5.3, R2.6.4, etc.) — not intuition.
11. **Completeness AND discipline.** When implementation surfaces a real semantic gap, **formalize the scope expansion as a new D-number** with proper design + test plan, don't continue under the original D's banner. (Path X-via-D264 pattern, not Path X-direct or Path Y trim.) Discipline without completeness ships half-baked surfaces; completeness without discipline auto-expands scope.
12. **Long-command observation discipline.** Use `mise run gate` / `mise run run-logged` with sentinel grep (`<<<RUN-LOGGED:DONE>>>`). Never pipe through `tail` (buffers until EOF). Never poll via `sleep` loops. Memory: `feedback_long_command_observation`.
13. **Subagent hygiene.** Synchronous verification OR teardown bg processes (kill by process group) before returning. A leaked bg process surfaces as a stale "running" entry indistinguishable from a real hang. Memory: `feedback_subagent_bg_hygiene`.
14. **Distinguish vestigial-surface from speculative-surface.** D196 ("no speculative substrate") governs **new** surface added without consumer pressure. It does **NOT** govern cleanup of surface that an earlier-locked decision RELAXED into vestigial overhead (e.g., D248 relaxed Sink Send+Sync → operator-internal `Arc<Mutex<X>>` capturing single-owner state became dead weight). Vestigial-surface removal is **decision-consistency restoration**, a separate justification class with locked precedent: D253 (SchedulingGroupId delete), D254-AUDIT (Send-closure variant audit), D267 (Family-2 Cat-3 Arc<Mutex>→Rc<RefCell>). Conflating them = framing error; cite this value when classifying cleanup candidates. Memory: `feedback_distinguish_vestigial_vs_speculative`.

## Architectural invariants (compiler-enforced chokepoints)

| Trait/Type | Signature | What it forbids |
|---|---|---|
| `CoreActor::run<F, R>` | `F: FnOnce(&Core) -> R + Send + 'static` | Can't put `.await` in closure body (no async context) |
| `MailboxOp::Defer(SendDeferFn)` | `SendDeferFn = Box<dyn FnOnce(&dyn CoreFull) + Send>` | Deferred closure body must be sync; no `AsyncDefer` variant exists |
| `BindingBoundary::invoke_fn_with_core` | sync `fn(&self, .., core: &dyn CoreFull)` | Making binding callback async requires widening the trait → cross-track-ledger event |
| `Sink = Arc<dyn Fn(&[Message]) + 'static>` (post-D248, !Send !Sync) | Sync `Fn` closure | Sinks can't be async; they fire synchronously during a wave |
| `Core::emit` / `Core::subscribe` etc. | All sync `pub fn` | Adding `pub async fn` in `graphrefly-core` would require tokio in Core — forbidden by D070/D077 |
| `Core: !Send + !Sync` (D248) | Move-only single-owner | Can't share `Arc<Core>` across threads; cross-Core parallelism is host-native via independent per-worker Cores |
| `BindingBoundary: Send + Sync` (FFI trait, unchanged by D248) | Send+Sync stays | Only subscriber callbacks (Sink/TopologySink/etc.) relaxed off Send+Sync; the FFI contract is unchanged |
| `CoreMailbox: Send + Sync` (D249) | Id-only ops + Send cross-thread Defer | DeferQueue is the !Send owner-only companion |

## Invariant-watch list (red flags — HALT if any are proposed)

1. `pub async fn` in `graphrefly-core` / `graphrefly-graph` / `graphrefly-operators` / `graphrefly-structures`. Only `graphrefly-storage` + `graphrefly-bindings-*` are sanctioned to import tokio.
2. New `MailboxOp::AsyncDefer(BoxFuture<...>)` variant.
3. Sink / TopologySink / NamespaceChangeSink becoming async return types.
4. Actor closure body calling `.await`.
5. napi method body chaining `.then(...)` or awaiting inside the actor closure (instead of inside the napi async fn wrapper).
6. `wrapper.js` stashing Promise chains in long-lived state. Promises resolve at the napi-call boundary; long-lived state = resolved values.
7. A reactive primitive returning `Promise<Node<T>>` in the binding layer.
8. Sync escape hatches on binding read methods (`run_sync` napi methods callable from inside TSFN sink callbacks). The bi-directional async-at-boundary invariant.
9. `BindingBoundary` widening without a cross-track-ledger row added FIRST.
10. Adding a new `Impl` parity-contract method without a parity scenario authored in the same slice. (D196 — "parity scenarios are the consumer pressure signal.")
11. Threadlocal-current-Core or similar machinery (`CURRENT_CORE`, `CoreThreadGuard`, `current_core()` accessor). D256 deleted these; re-adding them is regression.
12. `core.clone()` anywhere (`impl Clone for Core` was deleted at D221/D246).
13. Storing `Core` by value in a struct that's then put in `Arc<>` or `OnceLock<>` (Core is `!Send + !Sync` post-D248).
14. SchedulingGroupId speculative surface (D253 deleted it; re-adding without M6 consumer = regression).

## Decision-process patterns (apply in order)

When asked "is X consistent / should I pick Y?":

1. **Identify the locked decision-scope.** What D-number is this slice operating under? Is the proposed change within that D's locked scope? Scope expansion mid-implementation = anti-pattern unless promoted to a new D-number.
2. **Check the canonical spec.** Does the spec rule pin the behavior? If yes, follow spec — implementation that diverges is buggy, not a "design call." If spec is silent/ambiguous, that's a real design HALT.
3. **Check existing substrate surface.** Verify premise before greenfield: has the trait already been widened? Has the helper already been added? `feedback_verify_premise_before_greenfield` has paid off multiple times — always check before designing new surface.
4. **Apply the 8 user values above.** Especially: no autonomous decisions, no imperative triggers, single source of truth, sync-internal/async-at-boundary (bi-directional).
5. **Check D196 consumer pressure — BUT classify the candidate first.** Is the proposed change **new surface** (D196 applies; needs consumer signal) or **vestigial-surface removal** (D196 does NOT apply; decision-consistency restoration is the right frame — precedent D253/D254-AUDIT/D267, value #14)? Speculative-new widening fails D196; vestigial-cleanup is justified by the earlier relaxation that made the surface dead, no new consumer signal required.
6. **Check completeness AND discipline.** If the proposed change closes a real semantic gap, formalize as new D-number (Path X-via-D[N+1]). If the proposed change is speculative scope expansion, revert (Path Y trim).
7. **Identify cross-track-ledger events.** Does the change widen `Impl` parity contract? Does it cross presentation↔Rust-port? If yes, ledger row goes in BEFORE the change (`docs/cross-track-ledger.md`).
8. **Triage findings.** Match against `porting-deferred.md` (reject silently if matches) and `cross-language-notes.jsonl` `divergence-*` (reject silently if matches). Verified divergences ≠ hypothesized divergences — don't preemptively document the latter.

## Common decision-shape templates

### α/β/γ pattern (when napi binding shapes are forked — applies to S6+)

- **α** — owner-thread-pinned `std::thread` worker + channel + oneshot reply
- **β** — mailbox-only async API (all ops post to mailbox + await reply)
- **γ** — sync owner-thread API via `spawn_blocking` onto pinned thread

**Lock: α (D255).** β is dead permanently (D070/D077 libuv-busy deadlock recurrence — `bridge_sync` blocks libuv while waiting for TSFN microtask that needs libuv). γ collapses to α at impl level (`napi::tokio_runtime::spawn_blocking` has no thread affinity; `LocalSet` is invasive; γ.ii = std::thread + channel + oneshot IS α).

### A/B/C pattern (when fix shape is forked)

Default: the option that **structurally extends an existing pattern** wins over per-site workarounds. Recent applications:
- **D260** (wave-end re-drain loop) — A extends D232-AMEND/D249's drain-to-quiescence past `fire_deferred`. B re-introduces D256-deleted threadlocal. C per-sink eager nested waves change mid-batch ordering without principled rationale. → A wins.
- **F2 S6 fix** (RefCell reentrant borrow panic) — B restructure with RAII Guard is more general; C specialized helper is minimal diff. Either valid; lean B for long-term API generality, C for short-term scope.

### Path X / Path Y / Path Z pattern (when slice scope is contested)

- **Path X-direct** — continue under original D, fix bug introduced by autonomous scope expansion. **Anti-pattern.**
- **Path X-via-D[N+1]** — stop tracing under original D; lock new semantic as new D-number; resume under new banner. **Right pattern when scope expansion catches a real semantic gap.**
- **Path Y** — revert scope expansion; ship original D's locked scope only. **Right pattern when scope expansion is speculative.**
- **Path Z** — defer entire slice; redesign later. **Right pattern when neither shipping nor continuing is principled.**

### Adversarial-review pattern (for /qa)

- **Critical** — show-stopper, breaks first call. Fix or hard HALT.
- **Major (needs decision)** — architecture-affecting or ambiguous fix. User decides between options.
- **Auto-applicable** — clear fix following existing patterns. Batch with approval.
- **Reject** — false positive, matches a porting-deferred entry, or matches a `divergence-*` entry. Drop silently.

## Locked decisions index (concise; load `rust-port-decisions.md` for full)

| D# | Scope | One-line |
|---|---|---|
| D246 | β-simplification lock | Single-owner pushed all the way down; delete shared-Core machinery; ignore legacy ergonomics. Operating rule: NO stubs/deferrals — finish each S fully. |
| D247 | S2c Graph tree shape | `Rc<RefCell<GraphInner>>` (not owned-`&mut`); Graph becomes `!Send+!Sync`. |
| D248 | S2c Sink contract relax | Substrate `Sink`/`TopologySink` dropped `Send+Sync` → `Core`/`OwnedCore`/`Graph` now `!Send + !Sync`. `BindingBoundary` stays `Send+Sync` (FFI). |
| D249 | S2c Defer/mailbox split | Minimal owner-only `!Send` `DeferQueue` split off `Send` `CoreMailbox`. `Core::drain_mailbox` drains BOTH queues to mutual quiescence. |
| D250 | S4 retire imperative re-entry stubs | 3 pause/resume/set_deps in-wave re-entry tests retired as deleted-model (synchronous binding-clones-Core trigger is structurally gone). NO new substrate surface. |
| D251 | S4 rule-8 reusable coalescing slot | Per-handle `Cell<bool>` scheduled gate + observe-prune torn-id buffer in observe/describe/storage defer paths. One Box + one snapshot per wave instead of per emission. Internal refactor. |
| D252 | S5 IN_TICK collapse | `IN_TICK_OWNED: AHashSet<u64>` → `Cell<bool>`. Hard invariant: "one Core per OS thread, no nested cross-Core driving on a single thread." Panic-on-violation at BatchGuard claim. |
| D253 | S5 SchedulingGroupId delete | D196-pure deletion of `SchedulingGroupId` + `node_group` + `partition_of`/`group_of`/`set_scheduling_group` API. Reverses S3 rename. Re-introduce when M6 consumer materializes. |
| D254 | S5 Tier A bundle | DeferQueue Mutex→RefCell + AtomicBool→Cell; test-file doc sweep; process-discipline memory. **D254-AUDIT inline**: TimerEmit typed variant audit found ZERO surviving emit-only Send closures; not adopted. |
| D255 | S6 napi binding shape | α/γ-merged actor model (β dead, γ collapses to α). `crates/graphrefly-bindings-js/src/core_actor.rs` owns Core on dedicated worker thread. |
| D256 | S6 invoke_fn_with_core override | Premise-check win: D245 already added the surface. BenchBinding overrides `BindingBoundary::invoke_fn_with_core`; `CURRENT_CORE` thread-local + `CoreThreadGuard` + `current_core()` accessor **deleted outright**. No cross-track-ledger event (consumption-not-widening). |
| D257 | S6 Drop discipline | BenchCore::Drop dispatches detached unsubscribe via actor with try_send fallback. |
| D258 | S6 WORKER_EXTRAS | Owner-thread-only `thread_local!(RefCell<HashMap<u64, Box<dyn Any>>>)` for `!Send` resources (Graph, StorageHandle, LogView/ScanHandle/ReactiveSub). |
| D260 | S7 wave-end re-drain loop | `BatchGuard::Drop` extends drain past `fire_deferred` to absorb posts made by deferred-jobs themselves. Mutual quiescence in `mailbox + DeferQueue + fire_deferred`. Same `max_batch_drain_iterations` cap. |
| D261 | S7 try_subscribe tail drain | Brief BatchGuard at end of `try_subscribe` reuses D260's drain machinery to flush handshake-fire-time posts. |
| D266 | Family-1 sink Arc→Rc cleanup | Decision-consistency restoration post-D248 sink Send+Sync relaxation. 4 type aliases (Sink/TopologySink/DescribeSink/NamespaceChangeSink) Arc→Rc + operator-internal !Send !Sync `Arc<dyn Fn()>` callback fields + 4 `static_assertions::assert_not_impl_any!(...: Send, Sync)`. 13 per-file `#![allow]` annotations removed. No `Impl` widening. Sequenced after D265/F1. |
| D267 | Family-2 Cat-3 `Arc<Mutex<X>>` → `Rc<RefCell<X>>` cleanup | Decision-consistency restoration; compiler-driven sweep. Try the substitution workspace-wide; compiler classifies Category-1 (bindings Send+Sync required) and Category-2 (storage Send+Sync required) via fail-to-compile → revert; residual compiling set IS Category-3 (operator-internal + test-recording, single-owner). Per-revert one-line comment naming Send+Sync source. Mutex `lock().unwrap()` → RefCell `borrow_mut()`. |
| D268 | Vestigial union-find / defer-shim surface cleanup | Decision-consistency restoration post-D248/D253/D255 relaxation chain. Family A: delete `PartitionOrderViolation` struct + `SubscribeError::PartitionOrderViolation` variant + 9 dead `Err(_)` match arms + 7 `Result<(), PartitionOrderViolation>` fn signatures. Family B: delete `emit_or_defer`/`complete_or_defer`/`error_or_defer` from Core + BindingBoundary trait + CoreFull impl + default impls; delete `DeferredProducerOp` enum + `push_deferred_producer_op` + `drain_deferred_producer_ops` no-op shim; edit ~15 operator call-sites in `buffer.rs`. Sub-option A.i: inline `try_emit/try_complete/try_error` (pub(crate)) bodies into public `emit/complete/error` — pre-flight confirmed ZERO external callers. Net ~110 LOC, mostly deletions. |

**M1 (QA /qa 2026-05-19)** — Cross-queue FIFO inversion documented as new contract: CoreMailbox drains before DeferQueue every round (queue-priority); intra-queue FIFO preserved. Regression test in `lock_discipline.rs::cross_queue_order_mailbox_then_deferred`.

**M2 (QA /qa 2026-05-19)** — `compact_every` cadence restored to per-emission count (TS parity). `pending_count` tracks qualifying emits at filter gate; `flush_tier(s, snapshot, count)` advances `flush_count` by count.

**Decision-audit batch (2026-05-21)** — D266/D267/D268 locked together as a decision-consistency cleanup train; bundled with doc-hygiene + 3 AMEND-D edits into one /porting-to-rs run sequenced after D265/F1 (parallel session). Doc-hygiene: L4-001 (Core rustdoc) + L4-002 (GraphOps doclinks) + L8-001 (close §7-E/§7-B/§7-F as resolved by D253/D255) + L8-002 (D250 stub-deletion history collapse) + L8-003 (CoreShared/StateCell references) + L1-001 (MailboxOp::Defer rustdoc). AMEND-D: D262/P4 affects-list + D267 wording scope precision (factory constructors retain `run_sync` under lifecycle-precondition rationale; absorbs the 4 `create` factory finding) + porting-deferred §7-C framing (decision-consistency restoration, not D196 deviation; closes when D268 lands). Audit doc: `~/src/graphrefly-rs/docs/decision-audit-2026-05-21.md`. Full L2 invariant-watch sweep #1-#14 CLEAN; L7 TRASH/ confirmed non-compiled.

## Pending / open decisions (track but not yet locked at time of skill creation)

These were under active discussion in the session this skill was created from; current state may have moved by next session — check `rust-port-decisions.md` first.

- **D262** — `compact_every` per-emission count (M2 from /qa). Likely locked by now.
- **D263** — `terminal_as_real_input` gate-predicate + flag-surfacing. Original framing: "no semantic change; predicate already conformant; just surface flag." Chat extended scope mid-implementation with `skips_auto_cascade`. **Recommendation: Path X-via-D264** (formalize the auto-cascade-skip semantic as its own D-number if it's the right completion of `terminal_as_real_input`'s meaning).
- **D264 (proposed)** — `terminal_as_real_input` complete semantic with `skips_auto_cascade`, IF spec-cited. Needs spec citation from canonical-spec §5.4 / §519 / R5.4 to confirm auto-cascade-skip is in the spec's text.
- **D265 (proposed)** — graph_bindings F1 fix: convert sync read methods (`nameOf`, `tryResolve`, `nodeCount`, etc.) to `async fn` to eliminate D070/D077 sink-callback re-entrance deadlock. Refine `Impl` parity contract to `T | Promise<T>` so pure-ts arm doesn't artificially wrap sync reads. Cross-track-ledger row.

D263 /qa findings (pending lock):
- **D1.a** — drop `|| self.partial` from `skips_auto_cascade`. Don't OR orthogonal design dimensions. Test rewrite ~10 LOC.
- **D2.a** — `addDep` always calls Core (no JS-side preflight). Single source of truth.
- **D3** — REJECT (canonical-shape consistency with `fire_operator`); mandatory doc note on `register_user_derived` covering NO_HANDLE deps[i] surface.

## Remaining work (post-S5/S6/S7)

- **S6 follow-on bench TODOs** (per-call latency, channel backpressure, multi-instance OS-thread count) — measurement-driven, not blocking.
- **D265 / F1 fix** for graph_bindings sync-read-method deadlock.
- **Storage-parity follow-up** (cross-track-ledger §2: appendLogStorage flush() durability + reject + rollback epoch).
- **attach_storage re-ship-on-shrink** (pre-existing structures-storage smell).
- **Loom verification** — outside the gate; periodic check.
- **Native publish** (D203/D204 — human tag-push gate).
- **M6** — pyo3 + per-binding pluggable group executor (post-1.0).
- **D080** — async-everywhere presentation rebase (deferred until consumer pressure).

## Recurring anti-patterns to call out

1. **Autonomous scope expansion** — chat extends a locked D's scope with a new behavior, hits a bug, asks permission to debug. Right answer: **stop. Formalize as new D-number with proper design + test plan, then resume under new banner.** Don't trace bugs under wrong-D.
2. **"Completeness" used to justify autonomous expansion** — when chat argues "Path X gives more complete results," check if completeness is real (genuine spec/semantic gap) or speculative (chat extending without consumer pressure). If real, formalize as new D. If speculative, revert.
3. **Stale-premise propagation** — chat builds a recommendation on a premise that the substrate has moved past (D245 had already added the surface chat was about to recreate). Verify premise via grep / canonical doc / decision log before greenlighting.
4. **Hypothesized divergence preemptive-doc** — adding a `cross-track-ledger.md` or `cross-language-notes.jsonl` entry for a divergence that hasn't been verified by a cross-arm parity test. **Write the test first; document only verified divergences.**
5. **Dual-source-of-truth fixes** — JS-side preflight mirroring Core invariants; binding-side snapshot kept in sync with actor state. All such fixes drift; reject in favor of single-source-of-truth routing through the authority.
6. **Sync escape hatch on binding reads** — `run_sync` napi methods callable from inside TSFN sink callbacks. Violates bi-directional async-at-boundary. All read methods must be `async fn`.
7. **Test expectations from intuition** — writing `expected = [1, 2]` instead of citing R1.3.5.a + the push-on-subscribe handshake rule. Always anchor test expected vectors in spec R-IDs.
8. **OR-ing orthogonal design flags** — `skips_auto_cascade = self.terminal_as_real_input || self.partial`. Collapses two design dimensions into one; loses expressivity; widens one flag's semantic silently. Each flag's semantic is locked independently; users compose them explicitly.
9. **Preemptive skip-markers** — `runIf(impl.name !== "rust-via-napi")` added preemptively before a divergence is verified. You skip tests with a consumer-driven reason, not preemptively.
10. **Deferring documentation** — comment-update sweeps deferred from S[N] to S[N+1] create reviewer noise + risk of missing sites. Delete-the-code-and-its-docs in the same commit.
11. **D196 misapplication on vestigial-surface cleanup** — waving D196 ("no speculative substrate") at a cleanup that's actually restoring decision-consistency post-relaxation (Family-2 Cat-3 / D267 was the canonical instance; D266→D267 framing was initially wrong). Vestigial surface ≠ speculative surface. When triaging a deferred cleanup item, ask: was this surface made dead by an earlier locked relaxation (D246/D247/D248/D249/D252/D253/D256/...)? If yes, the gate is **decision-consistency restoration** (precedent D253/D254-AUDIT/D267), not D196. Value #14 covers this; cite by name.
12. **"Orthogonal" sub-decisions whose orthogonality wasn't tested** — D301's B.a (drop reserved-prefix guard) and B.b (keep `_anon_<rawid>` snapshot marker) were framed as orthogonal during the Q4 sub-decision lock. They weren't: B.a let users register `_anon_42` as a node name, and B.b emitted `_anon_42` for unresolvable cross-mount deps with `NodeId(42)`. The `SnapshotError::UnresolvableDeps` Debug-format diagnostic could no longer distinguish "user-named node `_anon_42` failed to hydrate" from "anonymous dep with NodeId 42 couldn't be resolved" — collision caught only at /qa, not at design lock. **When sub-decisions are framed as orthogonal, sketch one input that exercises BOTH simultaneously — confirm the orthogonality survives the example before locking.** The B.a/B.b case took ~30 seconds: "user registers a node named `_anon_42`; snapshot encodes an unresolvable dep with NodeId(42); what does the diagnostic say?" — if that one-input sketch had been part of the lock checklist, the coupling would have surfaced at design-time. Add this sketch as a mandatory pre-lock micro-check for any multi-sub-decision question. Source: D301 /qa (2026-05-26).

## How to use this skill in a new session

When the user asks any of the trigger phrases:

1. **Invoke decision-guard skill** to load this context.
2. **Read the relevant section** for the question type (values for "is this consistent," shapes for "should I pick A/B/C," anti-patterns for "what about this chat proposal").
3. **Check the locked decision index** for prior D-numbers that bear on the question; load `rust-port-decisions.md` excerpt if the full text is needed.
4. **Cross-check `porting-deferred.md`** for already-acknowledged deferrals (reject-silently for /qa findings; spec-extension for new ones).
5. **Apply the decision-process pattern** (the 8 ordered steps above).
6. **Produce a relay-ready summary** for the user to paste back into the chat that surfaced the question. The summary should:
   - Cite the relevant decision/value/invariant by name.
   - Give the recommended pick (A/B/C, X/Y/Z, α/β/γ).
   - Explain the reasoning in 2-3 sentences per option.
   - Flag any HALT-worthy concerns (autonomous expansion, stale premise, dual-source-of-truth, etc.).

## Skill scope boundaries

This skill is **read-mostly**: it loads decisions + values + patterns. It does NOT:
- Run gates (`mise run gate`) — that's `/porting-to-rs` or `/qa`.
- Apply fixes — that's `/dev-dispatch` or `/qa` post-decision.
- Author parity scenarios — that's a follow-up `/dev-dispatch` after a decision locks.
- Replace `/porting-to-rs` HALTs — those have their own Phase 1/2 protocol.

Invoke decision-guard when the question is **"what should I decide?"**, not "what should I do?". The output is decision + reasoning + relay-ready text. Implementation follows separately.

## Update protocol

When a new D-number locks (after user approval), append to:
- `~/src/graphrefly-ts/docs/rust-port-decisions.md` — full entry (Date / Context / Options / Decision / Rationale / Affects)
- This skill's "Locked decisions index" — one-line summary
- `~/src/graphrefly-rs/docs/migration-status.md` — if the lock closes/scopes a slice

When a new user value surfaces (in feedback memory format), add to:
- `~/.claude/projects/-Users-davidchenallio-src-graphrefly-ts/memory/feedback_<name>.md`
- This skill's "User values & principles" section — pointer + one-line summary

When an anti-pattern recurs (caught a 2nd time in /qa or design), add to:
- This skill's "Recurring anti-patterns to call out" section
- Optionally a `feedback_<name>.md` memory if it's a generalizable principle.

Keep this skill **tight**: aim for ≤ ~500 lines of skill markdown. If it grows past that, factor sub-skills (`decision-guard:invariants`, `decision-guard:decisions`) and have the main skill point at them.
