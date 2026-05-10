# GraphReFly Canonical Spec & Invariants (post-Phase 13.6.A)

*Consolidated source-of-truth for the GraphReFly protocol, primitives, container, patterns, and invariants — incorporating the 24 locks resolved in `implementation-plan-13.6-locks-draft.md`. Supersedes the multi-file split (`GRAPHREFLY-SPEC.md` + `COMPOSITION-GUIDE-*.md`) for read-once handoff.*

**Status:** post-Phase 13.6.A audit, pre-implementation. The canonical text below describes what the spec + composition guide WILL be after the lock-driven edits land. Use this for Rust port; the underlying TS edit work is tracked under Phase 13.6.B.

**Rule ID convention:** `R<section>.<sub>[.letter]` for stable cross-reference (e.g. `R1.3.3.b` = §1.3 invariant 3, sub-clause b).

**Lock cross-references:** `→ Lock X.Y` traces canonical content back to its audit decision in the locks-draft.

**Section structure** (post-F4 renumber — body order matches header):
1. ✅ Message Protocol
2. ✅ Node — also covers standalone sugar (`dynamicNode`, `autoTrackNode`, `pipe`) in §2.8
3. ✅ Graph — also covers `graph.state` / `graph.derived` / `graph.effect` / `graph.producer` named sugar
4. ✅ Utilities (`pipe` / clock / batch / messageTier)
5. ✅ Design Principles (R5.1–R5.12)
6. ✅ Implementation Guidance (TS / PY / Rust)
7. ✅ Node Versioning (V0/V1, setVersioning, V0→V1 fresh-root boundary)
8. ✅ Patterns Layer (folds COMPOSITION-GUIDE-PATTERNS / SOLUTIONS)
9. ✅ Storage & Persistence (folds COMPOSITION-GUIDE-GRAPH §27)
10. ✅ Implementation Deltas (TS reference vs canonical spec — 20 items)
11. ✅ Appendices (A: message types, B: describe schema, C: scenarios, D: v0.4 addendum, E: verification)

After §11 Appendices: **Final summary** (post-audit handoff notes) — not numbered.

**🎯 ALL SECTIONS COMPLETE — ready for review pass before Rust port handoff.**

---

## 1. Message Protocol

The unit of communication between nodes. A protocol-pure layer that knows nothing about node lifecycle, fn execution, or graph structure — those build on top.

### 1.1 Format

**R1.1.1** — All inter-node communication uses a single format: an array of message tuples.

```
Messages = [[Type, Data?], ...]
```

There is no single-message shorthand. Even one message arrives as `[[DATA, 42]]`, never `[DATA, 42]`.

**R1.1.2 — Examples (informative):**

```
[[DATA, 42]]                                 — single value
[[DIRTY], [DATA, 42]]                        — two-phase update
[[DIRTY], [RESOLVED]]                        — unchanged after dirty
[[DATA, "a"], [DATA, "b"], [COMPLETE]]       — burst + close
[[PAUSE, lockId]]                            — pause with lock
[[RESUME, lockId], [DATA, "resumed"]]        — resume + value
[[ERROR, err]]                               — error termination
```

### 1.2 Message Types

**R1.2.1 — Type table:**

| Type | Data | Purpose |
|------|------|---------|
| `START` | — | Subscribe handshake: "upstream connected and ready" |
| `DATA` | value (non-`undefined`) | Value delivery |
| `DIRTY` | — | Phase 1: value about to change |
| `RESOLVED` | — | Phase 2 alt: dual-role — equals-substituted DATA OR no-DATA wave settle |
| `INVALIDATE` | — | Clear cached state, don't auto-emit |
| `RESET` | — | INVALIDATE then push initial |
| `PAUSE` | lockId (mandatory) | Suspend (lockId identifies pauser) |
| `RESUME` | lockId (mandatory, must match) | Resume after pause |
| `TEARDOWN` | — | Cleanup of current lifecycle (resubscribable nodes may re-activate per R2.2.7.a) |
| `COMPLETE` | — | Clean termination |
| `ERROR` | error (non-`undefined`) | Error termination |

**R1.2.2 — Open type set.** Implementations MAY define additional types. Nodes MUST forward unrecognized types unchanged. → Lock 1.E

**R1.2.3 — `START` handshake.** Emitted to each new sink at the top of `subscribe()`, before any other downstream message on that subscription. Shape:
- `[[START]]` alone when cache is SENTINEL.
- `[[START], [DATA, cached]]` when cache holds a value.

`START` is informational for wave tracking — does not participate in DIRTY/DATA/RESOLVED wave masks; not forwarded through intermediate nodes (each node emits its own `START` to its own new sinks). Absence of `START` on subscribe means the node is terminal (COMPLETE/ERROR without `resubscribable`).

**R1.2.4 — `DATA` payload constraint.** `[DATA, value]` MUST include the second element AND the value MUST NOT be `undefined` (TS) / `None` (PY). → Lock 5.A rule (1)

`undefined` / `None` is the global SENTINEL ("never sent DATA"). `null` is a valid DATA value — use it for domain-level absence. A bare `[DATA]` tuple or `[[DATA, undefined]]` is a protocol violation; implementations MUST reject or ignore rather than coerce.

**Reactive log clarification (Lock 5.A):** `reactiveLog<T>` does not permit `T` to include `undefined`. The previous `T | undefined` exception is eliminated; empty-log queries settle via `[[RESOLVED]]` (R1.3.3.f); the `hasLatest` companion is removed (redundant — empty vs non-empty unambiguous from RESOLVED vs DATA).

**R1.2.5 — `ERROR` payload constraint.** `[ERROR, payload]` MUST include the second element AND the payload MUST NOT be `undefined` / `None`. Acutely matters: `DepRecord.terminal === undefined` means "dep is live"; `ERROR(undefined)` would be indistinguishable from a non-terminated dep. Implementations MUST reject `[[ERROR, undefined]]` and bare `[ERROR]` at the dispatch boundary (typically `_emit`).

**R1.2.6 — `PAUSE` / `RESUME` lockId mandatory.** Bare `[[PAUSE]]` / `[[RESUME]]` throws. Per-node lock set provides multi-pauser correctness by construction. Unknown-lockId `RESUME` is a no-op (idempotent dispose).

### 1.3 Protocol Invariants

#### 1.3.1 Two-phase push (DIRTY before DATA/RESOLVED)

**R1.3.1.a — DIRTY precedes DATA/RESOLVED in the same batch.** Every outgoing tier-3 payload is preceded by `[DIRTY]` in the same batch, regardless of which entry point produced the emission. The dispatcher synthesizes a `[DIRTY]` prefix whenever the caller omits it, provided (a) any tier-3 message is present in the batch and (b) the node is not already in `dirty` status from an earlier emission in the same wave.

Applies uniformly to every emission path: `node.emit(v)`, `node.down(msgs)`, `actions.emit(v)`, `actions.down(msgs)`, passthrough forwarding, equals-substituted `[DATA, v]` → `[RESOLVED]` rewrites. **No raw-down compatibility carve-out** — raw and framed paths are observationally identical on the wire.

**R1.3.1.b — Two-phase propagation.** Phase 1 (DIRTY) propagates through the entire graph before phase 2 (DATA / RESOLVED) begins. Guarantees glitch-free diamond resolution.

**R1.3.1.c — Activation-wave exemption.** The DIRTY-before-tier-3 invariant is a *state-transition* invariant. The subscribe ceremony (fn's first run during `subscribe()`) is exempt: initial emission during activation does not require a preceding DIRTY. Two-phase applies to all post-activation waves where a dep transitions through DIRTY.

#### 1.3.2 Equals substitution and cache discipline

**R1.3.2.a — Cache cannot drift.** Every outgoing DATA payload is subject to equals-vs-cache substitution: if `equals(cache, newValue)` returns true, the node emits `[RESOLVED]` instead of `[DATA, v]`, and `cache` is not re-advanced. Applies uniformly to every emission path — computed fn results, `actions.emit(v)`, `actions.down(msgs)`, raw `node.down([[DATA, v]])`, passthrough forwarding. The node's cache cannot drift from "the last DATA payload actually delivered downstream."

**R1.3.2.b — Equals check order.** → Lock 2.A

The dispatcher's equals check evaluates in this order, short-circuiting on first match:

1. **Version check (preferred when present).** If value is a `Versioned<T>` wrapper (R8.G.4 in §8 Patterns), compare `version` fields. O(1) regardless of payload size.
2. **Identity check.** `value === cache`. Cheap; catches reuse of the same reference.
3. **Deep equals (opt-in).** Call user-provided `equals(value, cache)` only if the node was constructed with one.

If none matches, emit `[DATA, value]` verbatim (no substitution).

**R1.3.2.c — Equals throws inside dispatch.** → Lock 2.A

- **Dev mode:** dispatcher rethrows the error annotated with node id + wave context. Buggy `equals` surfaces immediately.
- **Production:** dispatcher catches, logs once per node (rate-limited via `GraphReFlyConfig.equalsThrowPolicy`), proceeds as if equals returned `false` (emit DATA verbatim). Reactive graph stays alive; one bad equals does not kill the wave.

**R1.3.2.d — Substitution scope (single-DATA waves only).** Equals substitution only fires when a wave contains a *single* DATA emission whose payload matches `cache`. → Lock 1.D

Multi-DATA waves (e.g. `[[DATA, v1], [DATA, v2]]`) pass through verbatim — the substrate does not per-item-substitute inside a multi-DATA batch. Operators that drop or filter items (`filter`, `take`, `skip`) do NOT synthesize `[RESOLVED]` for dropped batch elements: dropping is silent, not signalled.

`RESOLVED` reaches downstream only via:
- **(R1)** Substrate substitution on a single-DATA wave matching cache (this clause).
- **(R2)** Explicit user emission via `actions.down([[RESOLVED]])` / `node.down(...)` — see R1.3.3.f for the no-DATA wave settle role.

Consumers needing per-item batch-drain accounting must count upstream of any filtering operator or emit explicit `RESOLVED` markers from their own fn.

#### 1.3.3 Wave-content invariants

**R1.3.3.a — Tier-3 wave exclusivity.** Within any single wave at any single node, the tier-3 slot is **either** ≥1 `DATA` **or** exactly 1 `RESOLVED` — never mixed. → Lock 1.D, folds COMPOSITION-GUIDE-PROTOCOL §41

Both of the following are protocol violations:

- A single delivery containing both — e.g. `actions.down([[DATA, v1], [RESOLVED], [DATA, v2]])`.
- Multiple deliveries to the same node within one `batch()` frame whose union mixes the two — e.g. `batch(() => { node.down([[RESOLVED]]); node.emit(v2); })`.

**R1.3.3.b — `actions.down(Messages[])` legality.** `actions.down([msg1, msg2, ...])` is allowed — one call = one wave with multiple messages. The wave-content invariants (R1.3.3.a) apply. → Lock 1.D

**R1.3.3.c — Multi-DATA waves pass through verbatim.** Caller's choice to send multiple DATA values signals "deliver each verbatim"; the dispatcher does not collapse mid-wave. No equals substitution applies. → Lock 1.D, R1.3.2.d

**R1.3.3.d — Runtime enforcement deferred.** Wave-content invariants are documented user contract. Runtime assertion (dev-mode dispatcher check for mixed tier-3 / multi-DATA equals attempts) is filed as a deferred consideration. Implementations MAY add dev-mode assertions; production is implementation-defined. → Lock 1.D

**R1.3.3.e — RESOLVED dual role.** RESOLVED carries two protocol roles, both valid; both shapes appear identical on the wire (`[[RESOLVED]]`): → Lock 5.A RESOLVED dual-role note

- **(R1) Equals-substituted DATA** (R1.3.2.a, R1.3.2.b): "value emitted, equals matched cache, no real change."
- **(R2) No-DATA wave settle** (R1.3.3.f, R8.P.19 in §8 Patterns): "wave closed, nothing to advertise as latest."

The dual role is **load-bearing** — terminal-emission operators (`filter` / `take` / `skip` / `takeWhile` / `distinctUntilChanged`) and empty-state primitives (`reactiveLog.lastValue` on empty log) rely on R2 to keep wave shape valid without violating R1.2.4.

**R1.3.3.f — Terminal-emission operator carve-out.** Operators that drop entries from a multi-value batch (`filter`, `take`, `skip`, `takeWhile`, `distinctUntilChanged`) emit one `[RESOLVED]` only when the entire wave produces zero `DATA` — never per-dropped-item, never trailing a wave that already emitted `DATA`. This is the R2 use of RESOLVED. → Lock 1.E

**R1.3.3.g — No silent swallowing of unrecognized tuples.** Distinct from R1.3.3.f: documented operator suppression of DATA per the operator's contract is **not** silent swallowing. Silent swallowing of unrecognized tuples (R1.2.2) remains forbidden. → Lock 1.E, Lock 5.B

#### 1.3.4 Terminal lifecycle

**R1.3.4.a — COMPLETE and ERROR are terminal.** After either, no further messages from that node. A node MAY be resubscribable (opt-in); a new subscription starts fresh.

**R1.3.4.b — Effect nodes complete when ALL deps complete.** Not ANY. Matches `combineLatest` semantics.

**R1.3.4.c — ERROR auto-propagates by default.** Default `errorWhenDepsError: true`. Rescue-style operators (only) override with `false` to suppress auto-ERROR; they handle via `ctx.terminalDeps[i]`.

#### 1.3.5 START ordering

**R1.3.5.a — START precedes any other message on a subscription.** A sink never receives DATA, DIRTY, RESOLVED, COMPLETE, ERROR, or any other message from a node without first receiving `START` from that node on the same subscription. `START` is emitted through the same `downWithBatch` path as other messages, so it respects batch semantics when `subscribe()` is called inside `batch()`.

#### 1.3.6 Batch semantics

**R1.3.6.a — Batch defers DATA/RESOLVED, not DIRTY.** Inside an explicit `batch()` scope, DIRTY propagates immediately. DATA and RESOLVED (phase-2 messages) are deferred until batch exits. During drain, further phase-2 emissions are re-deferred to preserve strict DIRTY-before-tier-3 ordering across the entire flush. Dirty state established across the graph before recomputation.

**R1.3.6.b — Per-node emit coalescing.** Within one explicit `batch()` scope, multiple emissions from the same node accumulate into a **single multi-message delivery** (tier-sorted at batch end). K consecutive `.emit()` calls to the same source collapse to K DIRTYs in one tier-1 sink call plus K DATAs in one tier-3 sink call — not K separate sink calls per tier. → folds COMPOSITION-GUIDE-PROTOCOL §9a

Downstream nodes' fns receive the full wave batch (`batchData[i] = [v1, v2, …, vK]`) and run **once per wave**, not K times. Fixes fan-in over-fire under diamond topologies.

Note: per Lock 6.B, the coalesce-to-latest-only optimization for non-accumulating derived was **NOT pursued**. All derived nodes receive the full batch; consumers wanting last-only use `batch.at(-1) ?? ctx.prevData[i]` (sugar constructors) or guard with `batch != null && batch.length > 0` (raw `node()`). → Lock 6.B

**R1.3.6.c — Coalescing scope.** Coalescing applies ONLY inside an explicit `batch()` scope. Emissions during a drain (where `flushInProgress` is true but `batchDepth` is 0 — e.g. inside a subscriber callback or a node fn firing mid-drain) do NOT coalesce; each such emit is its own wave. Outside any batch context, every `.emit()` is its own wave.

#### 1.3.7 Signal tier table

**R1.3.7.a — Tier classification.** Implementations expose `messageTier(msg)` / `message_tier(msg)` utilities; never hardcode type checks for checkpoint or batch gating.

| Tier | Signals | Role | Batch behavior |
|------|---------|------|----------------|
| 0 | `START` | Subscribe handshake | Immediate |
| 1 | `DIRTY` | Notification | Immediate |
| 2 | `PAUSE`, `RESUME` | Flow control | Immediate |
| 3 | `DATA`, `RESOLVED` | Value settlement | Deferred in batch |
| 4 | `INVALIDATE` | Settle-class cache reset | Deferred (drains alongside tier 3 in settle slice) |
| 5 | `COMPLETE`, `ERROR` | Terminal lifecycle | Deferred (drains after settle slice) |
| 6 | `TEARDOWN` | Destruction | Deferred (drains last) |

**R1.3.7.b — INVALIDATE tier semantics (DS-13.5.A 2026-05-01).** `INVALIDATE` is its own tier-4 settle group between value settlement (tier-3) and terminal lifecycle (tier-5). A single `[[INVALIDATE]]` arrival on a previously-dirty dep clears the dirty flag and decrements `_dirtyDepCount` (same role as RESOLVED). On a clean dep: no-op for the counter. The emitting node's status transitions to `"sentinel"` (no value, nothing pending) — NOT `"dirty"` (value about to change) — because INVALIDATE has cleared the cache outright with no new value pending. `defaultOnSubscribe`'s push-on-subscribe sends only `[START]` to subsequent subscribers (not `[START, DIRTY]`) so a freshly-attached dep doesn't inherit a phantom dirty count from a prior INVALIDATE. The deadlock where INVALIDATE-only emissions left dependents wedged in DIRTY and never re-fired is eliminated; `[[INVALIDATE], [RESOLVED]]` paired-reset retires; plain `[[INVALIDATE]]` is sufficient. → Lock 6.H (current code wrongly sets `"dirty"`; refactor target is `"sentinel"`)

**R1.3.7.c — Auto-checkpoint gate.** Auto-checkpoint saves (§3.8 Persistence) gate on `messageTier >= 3` (DATA / RESOLVED / INVALIDATE / COMPLETE / ERROR), excluding tier-6 TEARDOWN (graph teardown skips final checkpoint). Worker-bridge wire filtering (extra layer) uses the same threshold.

#### 1.3.8 PAUSE/RESUME semantics

**R1.3.8.a — Per-node lock set.** A node may hold multiple concurrent PAUSE locks (each with distinct lockId). RESUME with a known lockId releases that lock. The node remains paused until ALL locks released.

**R1.3.8.b — Buffer shape.** Under `pausable: "resumeAll"` mode, outgoing **tier-3 (DATA / RESOLVED) AND tier-4 (INVALIDATE)** deliveries while any lock is held are buffered as **`Messages[]`** — one entry per attempted wave, preserving exact wave shape (single-DATA, multi-DATA, single-RESOLVED, or INVALIDATE). → Lock 2.C, Lock 2.C′-pre

Tier-5 (COMPLETE/ERROR) and tier-6 (TEARDOWN) continue to dispatch synchronously while paused — they MUST reach observers regardless of leaked controllers (a never-released lock cannot strand subscribers without an end-of-stream signal).

**R1.3.8.c — Buffer cap.** Buffer is bounded by `GraphReFlyConfig.pauseBufferMax` (default 10_000 waves; configurable). On overflow: dispatcher drops oldest waves and emits `[[ERROR]]` once per overflow event with diagnostic `{ nodeId, droppedCount, configuredMax, lockHeldDurationMs }`. The error propagates downstream per R1.3.4.c. → Lock 6.A

**R1.3.8.d — Replay semantics.** On final-lock RESUME, dispatcher replays buffered waves in order. Per-wave handling follows wave-content invariants (R1.3.3): → Lock 2.C

- **Multi-DATA waves**: emit each verbatim, no equals substitution.
- **Single-DATA waves**: equals substitution against cache; if matches, rewrite to `[RESOLVED]`.
- **Single-RESOLVED waves**: emit verbatim.

**R1.3.8.e — Cache reference for replay.** Cache value used for equals substitution during replay is the cache **at the end of the previous wave in the buffer** (not pause-start, not replay-time). Each wave in the buffer sees the cache shaped by all prior buffered waves having "happened" in the conceptual timeline. → Lock 2.C

**R1.3.8.f — Unknown-lockId RESUME no-op.** Enables multi-pauser pattern where one pauser may not know about others (idempotent dispose).

#### 1.3.9 Cleanup and INVALIDATE

**R1.3.9.a — INVALIDATE delivery is idempotent within a wave.** A node that has already broadcast `INVALIDATE` to its sinks during the current wave does not re-broadcast on subsequent arrivals from other parents. Diamond fan-in topologies (multiple paths from one originator converging at a join) cascade `INVALIDATE` once per node per wave, not once per arriving path.

Equivalent rule: an `INVALIDATE` arrival at a node whose cache is already at the reset sentinel (i.e. node has already processed an INVALIDATE this wave) is a no-op — neither the cleanup hook nor the downstream broadcast fires a second time.

**R1.3.9.b — Cleanup hook fires on INVALIDATE.** Function-form cleanup (`onInvalidate` slot per Lock 4.A; see §2.X Node fn Contract) fires on `[[INVALIDATE]]` as well as deactivation and pre-re-run. Hooks fire **at most once per wave per node** regardless of fan-in shape.

**R1.3.9.c — Never-populated case.** An `INVALIDATE` arriving at a node whose cache is the **never-populated sentinel** (node has not yet settled in this lifetime, distinct from "reset by an earlier INVALIDATE this wave") is also a no-op. There is no cached value to clean up; cleanup hook does not fire; downstream broadcast suppressed.

A practical consequence: `graph.observe()` on a never-populated mid-chain derived node will not see `INVALIDATE` propagate through that node — observers must subscribe to the originating source (or to a downstream node that has settled at least once) to receive cache-bust notifications.

**R1.3.9.d — Meta TEARDOWN ordering.** Meta TEARDOWN fan-out fires at the top of `_emit` before the parent's own state-transition walk. **Load-bearing ordering invariant** — must be enforced by a dedicated ordering test, not just behavioral coverage. → Lock 2.B

### 1.4 Directions

**R1.4.1 — down vs up conventions.**

- **down** — downstream from source toward sinks. Carries: DATA, DIRTY, RESOLVED, INVALIDATE, COMPLETE, ERROR.
- **up** — upstream from sink toward source. Carries: DIRTY, PAUSE, RESUME, INVALIDATE, TEARDOWN.

These are **conventions** plus an enforced tier filter on `up`: `actions.up` / `node.up` reject tier-3 (DATA/RESOLVED) and tier-5 (COMPLETE/ERROR) — value and terminal-lifecycle planes are downstream-only. All other tiers pass.

**R1.4.2 — INVALIDATE bidirectionality.** INVALIDATE is bidirectional in the convention sense:
- **Downstream:** part of cascading cache reset on a settle wave (R1.3.7.b).
- **Upstream:** plain forward — does not self-process INVALIDATE on intermediate or terminal nodes (no `_emit`, no cache clear at source). Cache-clearing semantics apply downstream side only.

**R1.4.3 — Lifecycle messages may flow either direction.** Implementations do not validate by direction. Lifecycle messages (TEARDOWN, INVALIDATE) may propagate downstream for graph-wide management (e.g. `graph.destroy()` sends TEARDOWN downstream to all nodes). A source MAY forward PAUSE/RESUME downstream when pausing consumers.

---

## 2. Node

One primitive. A node is a node. What it does depends on what you give it.

### 2.1 Construction

**R2.1.1 — Single primitive.**

```
node(deps?, fn?, opts?)
```

**R2.1.2 — Behavior matrix.**

| Config | Behavior | Sugar name |
|--------|----------|------------|
| No deps, no fn | Manual source. User calls `.down()` to emit. | `state(initial?, opts?)` |
| No deps, with fn | Auto source. fn runs, emits via actions. | `producer(fn, opts?)` |
| Deps, fn returns value | Reactive compute. Recomputes on dep change. | `derived(deps, fn, opts?)` |
| Deps, fn uses `.down()` | Full protocol access, custom transform. | `derived(deps, fn, opts?)` |
| Deps, fn returns nothing | Side effect, graph leaf. | `effect(deps, fn, opts?)` |
| Deps, no fn | Passthrough wire. | — (use `node([dep])`) |

These sugar names are convenience constructors. They all create nodes. **They are not separate types.** Implementations SHOULD provide them for ergonomics and readability.

**R2.1.3 — `dynamicNode` is a construction variant.** Declares a **superset** of all possible deps at construction time but selectively reads from them at runtime via a `track(dep)` function. Same `node` primitive with `_isDynamic: true` — not a separate class. → §2.7 first-run gate behavior; → Lock 6.C for `partial: true` escape.

### 2.2 Interface

**R2.2.1 — Public surface (every node).**

```
node.cache           → cached value (readonly getter, never errors)
node.status          → "sentinel" | "pending" | "dirty" | "settled" |
                        "resolved" | "completed" | "errored"
node.down(msgOrMsgs) → send one or more messages downstream.
                        Accepts Message | Messages — one call = one wave.
node.emit(value)     → sugar for down([[DATA, value]]).
node.up(msgOrMsgs)   → send upstream. Same Message | Messages shape.
                        Tier-3/5 (DATA/RESOLVED/COMPLETE/ERROR) throw (R1.4.1).
node.subscribe(sink) → receive downstream messages, returns unsubscribe fn.
node.meta            → companion stores (each key is a subscribable node).
```

**R2.2.2 — `.cache` semantics.** Read-only getter. Returns the cached value or `undefined` (TS) / `None` (PY) when SENTINEL. Never throws. Never triggers computation. **Read-sanctioned at three boundaries only** per R5.12 / Lock 1.C.

**Status table (status is the source of truth — always check before trusting `.cache`):**

| Status | Meaning | `.cache` returns |
|--------|---------|------------------|
| `sentinel` | No subscribers, no value ever set (compute: cache cleared) | `undefined` / `None` |
| `pending` | Subscribed + upstream connected, waiting for first DATA | `undefined` / `None` |
| `dirty` | DIRTY or INVALIDATE received, waiting for DATA | previous value (stale) |
| `settled` | DATA received, value current | current value (fresh) |
| `resolved` | Was dirty, value confirmed unchanged | current value (fresh) |
| `completed` | Terminal: clean completion | final value |
| `errored` | Terminal: error occurred | last good value or `initial` or `undefined`/`None` |

**R2.2.3 — `subscribe(sink) → unsubscribe`.** Adds a sink callback to receive downstream messages. Returns a function that removes the sink. **The only way to connect to a node's output.** Implementation method: `_subscribe`.

Subscribe flow (R1.2.3 START handshake + activation), verified against `node.ts:1085-1110`:

1. If terminal AND `resubscribable: true` → reset (clear cache, status, DepRecords; `_hasCalledFnOnce := false`).
2. Increment `_sinkCount`.
3. **Call `cfg.onSubscribe(this, sink, ctx, actions)`** which delivers START to **this specific sink only** via direct callback invocation (not via the `_sinks` set):
   - cache is SENTINEL → `[[START]]`
   - cache has value v → `[[START], [DATA, v]]`
   - if `replayBuffer` enabled → deliver buffered DATA after START
   - On throw: roll back `_sinkCount`; rethrow.
4. **Register sink in `_sinks` AFTER START delivery** (load-bearing ordering — `node.ts:1103` comment). Why this order: START is per-subscription (R1.2.3 — each new sink gets its own handshake). If the sink were registered first, any `_emit` during the START handshake would broadcast to ALL existing subscribers, conflating the new sink with the established set.
5. If `_sinkCount === 1` AND not terminal → `_activate()`:
   - state node (no deps, no fn): no-op
   - producer (no deps, with fn): run fn (may emit via actions)
   - derived/effect (deps, with fn): subscribe to all deps in declaration order
6. If activation did not produce a value AND cache is still SENTINEL → status := `"pending"`.
7. Return unsubscribe function (last unsub → `_deactivate()`).

**R2.2.4 — `down(msgOrMsgs)`.** Send messages downstream. Accepts `Message | Messages`. Dispatch pipeline tier-sorts, auto-prefixes `[DIRTY]` per R1.3.1.a, runs equals substitution per R1.3.2.b, delivers with phase deferral. Implementation method: `_emit`.

```
node.down([DATA, 42])                — single-tuple shape
node.down([[DATA, 42]])              — array shape (equivalent)
node.down([[DIRTY], [DATA, 42]])     — explicit two-phase
node.down([[COMPLETE]])              — terminate
```

**R2.2.5 — `emit(value)`.** Sugar for `down([[DATA, value]])`. Identical wire output.

**R2.2.6 — `up(msgOrMsgs)`.** Send messages upstream toward deps. Same `Message | Messages` shape. Tier-3/5 throw (R1.4.1). Available only on nodes with deps. Implementation method: `_emitUp` (with `_validateUpTiers` filter).

**R2.2.7 — `unsubscribe()`.** Disconnect from upstream deps. State nodes retain `.cache` and status (ROM); compute nodes clear `.cache` and transition to `"sentinel"` (RAM). Lazy reconnect on next downstream subscribe.

**R2.2.7.a — Subscribe to a terminal `resubscribable: true` node resets the lifecycle.** When a late `subscribe()` arrives at a node that has terminated (received `[COMPLETE]` or `[ERROR, h]`) AND has `resubscribable: true`, the dispatcher resets the node to a fresh lifecycle BEFORE installing the new sink: `terminal` cleared, `_hasCalledFnOnce` cleared, all per-dep `prevData` / `dataBatch` / `terminal` cleared, pause lockset drained, replay buffer cleared. The new subscriber receives a fresh `[START]` (cache survives for state nodes per R2.2.8; sentinel for compute). **The `[TEARDOWN]` history of the prior lifecycle does NOT block reset** — TEARDOWN is the cleanup signal of the previous activation cycle, not permanent destruction. The `wipe_ctx` cleanup hook fires on reset so binding-side `ctx.store` starts fresh per R2.4.6.

**R2.2.7.b — Subscribe to a terminal `resubscribable: false` node is rejected.** When a late `subscribe()` arrives at a node that has terminated AND has `resubscribable: false`, the dispatcher refuses the subscription. The stream is permanently over; the late subscriber receives no handshake. Each implementation surfaces this via its idiomatic error channel:

- **Rust:** `Core::try_subscribe` returns `Err(SubscribeError::TornDown { node })`. `Core::subscribe` (the panic-on-error variant) panics with the `TornDown` diagnostic.
- **TS / PY:** `subscribe()` throws (TS `Error`, PY `RuntimeError`).

The `torn_down` (i.e. has-received-TEARDOWN) flag is irrelevant for the rejection decision — `terminal.is_some()` alone gates rejection on non-resubscribable nodes. Operators (zip / concat / race / take_until / merge / switch_map / etc.) that subscribe to upstream sources MUST handle the rejection by skipping that source (e.g., concat advances to the next source on `TornDown`).

**Rationale.** The current Rust impl prior to D118 treated TEARDOWN as "permanent destruction" (Slice A+B F3) and replayed the full terminal lifecycle to late subscribers regardless of resubscribable flag. R2.2.7.a / R2.2.7.b clean up that conflation: `resubscribable` IS the property that gates whether late subscribe re-activates; TEARDOWN is the cleanup signal of the previous activation, not an exception to that property. Non-resubscribable terminal nodes refuse rather than silently replay so callers get a clear error rather than a confusing handshake of past events.

**R2.2.8 — ROM/RAM cache semantics.** State nodes retain cached value across disconnect — the value is intrinsic and non-volatile (ROM). Compute nodes (producer, derived, dynamic, effect) clear cache on `_deactivate` because their value is a function of live subscriptions; reconnect re-runs fn from scratch.

| Node kind | `.cache` after disconnect | Reconnect behavior |
|---|---|---|
| state | retained value | unchanged |
| producer / derived / dynamic / effect | `undefined` / `None` | re-runs fn, fresh DepRecord |

Runtime writes via `state.down([[DATA, v]])` persist across subscriber churn.

### 2.3 Meta (Companion Stores)

**R2.3.1 — Meta is an object where each key is a subscribable node.** Replaces all `with*()` wrapper patterns.

```ts
const n = node(deps, fn, {
  meta: { status: "idle", error: null, latency: 0 }
});

n.meta.status.cache;                  // "idle"
n.meta.error.subscribe((msgs) => ...); // reactive
n.meta.status.down([[DATA, "loading"]]); // update (from inside fn or externally)
```

**R2.3.2 — Common meta fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `description` | string | Human/LLM-readable purpose |
| `type` | string | Value type hint: "string", "number", "boolean", "enum" |
| `range` | [min, max] | Valid range for numeric values |
| `values` | string[] | Valid values for enums |
| `format` | string | Display format: "currency", "percentage", "status" |
| `access` | string | Who can write: "human", "llm", "both", "system" |
| `tags` | string[] | Categorization |
| `unit` | string | Measurement unit |

Meta fields appear in `describe()` output and are individually observable via `observe()`.

**R2.3.3 — Companion lifecycle.** Meta nodes survive graph-wide lifecycle signals that would disrupt their cached values:

- **INVALIDATE** via `graph.signal()` — no-op on meta nodes (cached values preserved). Filtering is a graph-layer responsibility: `graph.signal([[INVALIDATE]])` skips meta children before broadcasting. Core `_emit` INVALIDATE path itself does not distinguish meta from non-meta — sending `[[INVALIDATE]]` directly to a meta node's `down()` does wipe its cache.
- **COMPLETE/ERROR** — not propagated from parent to meta (meta outlives terminal state for post-mortem writes like setting `meta.error` after ERROR).
- **TEARDOWN** — propagated from parent on parent's own TEARDOWN, releasing meta resources. **Fan-out happens at the top of the parent's `_emit` pipeline, before the parent's own state-transition walk** (R1.3.9.d). Meta children observe TEARDOWN while the parent's `_cached` / `_status` are still at their pre-teardown values. Keeps the dispatch walk re-entrance-free.

### 2.4 Node fn Contract

**R2.4.1 — Signature.** When a node has deps and fn:

```ts
node(deps, fn, opts?)
fn: (data, actions, ctx) => Cleanup | undefined
```

**R2.4.2 — `data`** — batch-per-dep array. `data[i]` is `readonly unknown[] | undefined`:
- `undefined` — dep `i` was not involved in this wave.
- `[]` — dep `i` settled RESOLVED this wave (no new DATA value).
- `[v1, v2, ...]` — dep `i` delivered one or more DATA values this wave, in arrival order. Most waves: `[v]` (single-element).

→ R1.3.6.b for batch-coalescing rules.

**R2.4.3 — `actions`** — `{ emit, down, up }`. Every action call produces one wave; multiple calls within a single fn invocation produce multiple independent waves. **No accumulation or flush boundary at fn return.**

- `emit(v)` — sugar for `down([[DATA, v]])`. One wave with single DATA payload.
- `down(msgOrMsgs)` — see R2.2.4. Auto-prefixes `[DIRTY]` per R1.3.1.a, runs equals substitution per R1.3.2, applies phase deferral.
- `up(msgOrMsgs)` — see R2.2.6. Tier-3/5 throw.

**R2.4.4 — `ctx`** — `{ prevData, terminalDeps, store }`: → Lock 4.E (canonical name is `prevData`; `latestData` retired)

- `prevData[i]` — last DATA value from dep `i` as of the **end of the previous wave** (i.e. the value that was stable before this wave started). Use as fallback when `data[i]` is `undefined` (not involved this wave) or `[]` (RESOLVED, no new values this wave). **`prevData[i] === undefined`** is the canonical "this dep has never emitted DATA" detector (Lock 1.B sanctioned use). `null` is a valid DATA value.
- `terminalDeps[i]` — `true` = COMPLETE, error payload = ERROR, `undefined` = live.
- **`store`** — mutable bag that **persists across deactivation by default** (Lock 6.D). See R2.4.6.

**R2.4.5 — Cleanup hooks (named-hook object only).** → Lock 4.A, Lock 4.A′

The fn return value is **NEVER auto-framed as DATA or RESOLVED**. ALL emission is explicit via `actions.emit(v)` / `actions.down(msgs)`. The return is **cleanup specification only**:

```ts
type NodeFnCleanup = {
  onRerun?: () => void;        // before next fn run within same activation
  onDeactivation?: () => void; // when subscriber count drops to zero
  onInvalidate?: () => void;   // on incoming [[INVALIDATE]] message
};
```

- **Returns `NodeFnCleanup` object:** registered slots fire at their respective lifecycle events. Slots are independent; partial returns are valid (`{ onDeactivation }` only, etc.).
- **Returns `undefined` / void:** no cleanup registered.
- **Throws:** emits `[[ERROR, err]]` to downstream subscribers via `_wrapFnError`.

The previous dual-shape API is **eliminated** (Lock 4.A): the `() => void` shorthand form is removed, and the named-hook fields are renamed (Lock 4.A′):

| Previous (current code) | Canonical (target) |
|---|---|
| `() => void` shorthand | (removed) |
| `beforeRun` | `onRerun` |
| `deactivate` | `onDeactivation` |
| `invalidate` | `onInvalidate` |

Each lifecycle event has its own slot; intent explicit at call site.

**R2.4.6 — `ctx.store` lifecycle.** → Lock 6.D

`ctx.store` is a mutable object scoped to the node. Persists across:
- fn re-runs within one activation cycle (continuous accumulation).
- **Deactivation → reactivation cycles (default)** — store survives `_deactivate`. Operators that need restart-from-fresh on resubscribe must explicitly clear via `onDeactivation` cleanup hook:

```ts
fn: (data, actions, ctx) => {
  if (!("acc" in ctx.store)) ctx.store.acc = seed;
  ctx.store.acc = reducer(ctx.store.acc, data[0].at(-1));
  actions.emit(ctx.store.acc);
  return {
    onDeactivation: () => { ctx.store = {}; }  // restart-from-seed on resubscribe
  };
}
```

Or selectively clear specific keys: `delete ctx.store.acc;`.

**Wiped automatically:** on resubscribable terminal reset (when a `resubscribable: true` node hits COMPLETE/ERROR and is later resubscribed), `ctx.store` is cleared as part of the full reset (alongside `_hasCalledFnOnce`, DepRecords).

**Migration scope (Phase 13.6.B):** `take.ts`, `transform.ts` (scan/reduce/distinctUntilChanged/pairwise), `time.ts`, `sources/async.ts`, `io/csv.ts` — see Lock 6.D source list.

**R2.4.7 — Sugar wrap pattern.** Sugar constructors (`derived`, `effect`, `task`) wrap user functions internally to call `actions.emit()` — user returns a value, sugar converts to explicit emission. They also auto-unwrap batch format using:

```ts
batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i]
```

Direct `node()` callers receive raw batch arrays and handle that format themselves.

### 2.4a Same-wave merge rules (DS-13.5.A)

**R2.4a.1 — Tier ordering produces correct end state.** When a single emission carries multiple settle-class messages on one node, the framing pipeline relies on tier ordering (R1.3.7). Tier sort puts tier-3 (DATA/RESOLVED) before tier-4 (INVALIDATE), so `_updateState` walks the wave as DIRTY → DATA(v) → INVALIDATE: cache advances to `v` on DATA, then INVALIDATE clears it back to SENTINEL. Subscribers observe the full sequence (no message silently dropped).

| Mix on same node in one wave | Wire delivery | End cache |
|---|---|---|
| `DATA(v)` + `INVALIDATE` | `[DIRTY, DATA(v), INVALIDATE]` | SENTINEL (cleared by INVALIDATE) |
| `RESOLVED` + `INVALIDATE` | `[DIRTY, RESOLVED, INVALIDATE]` | SENTINEL (RESOLVED no-op for cache; INVALIDATE clears) |
| `INVALIDATE` + `INVALIDATE` | `[DIRTY, INVALIDATE]` | SENTINEL (Q9 collapse) |
| `DATA` + `RESOLVED` (same node, same wave) | **Protocol violation** (R1.3.3.a) | — |
| `INVALIDATE` + `COMPLETE`/`ERROR` | both pass through; tier-sort puts INVALIDATE first | SENTINEL → terminal lifecycle |

**R2.4a.2 — Q9 explicit collapse rule.** The dispatcher applies **only one** explicit merge: multiple INVALIDATEs in one wave collapse to a single occurrence so cleanup hooks fire at most once and the wire stays compact.

**R2.4a.3 — Equals substitution interplay.** R1.3.2 single-DATA equals substitution runs in `_updateState` after tier-sort framing. For wave `[[DATA, v], [INVALIDATE]]` where `equals(cache, v)` is true, the walk produces `[[RESOLVED], [INVALIDATE]]` on the wire — cache transition is identical (DATA → RESOLVED elides no-op cache write; INVALIDATE then clears).

**R2.4a.4 — Cross-node merge not performed.** An INVALIDATE on dep A and a DATA on dep B in the same wave are independent — each consumer's `_dirtyDepCount` accounting reconciles them in arrival order.

### 2.5 Options

**R2.5.1 — Option table.**

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `name` | string | — | Identifier for graph registration |
| `equals` | (a, b) → bool | `Object.is` | Custom equality. See R1.3.2.b for the version-first check order. |
| `initial` | T \| null | absent (SENTINEL) | Initial cached value. Type is `T \| null` — never `T \| undefined` per R1.2.4. |
| `meta` | object | — | Companion store fields |
| `resubscribable` | bool | false | Allow reconnection after COMPLETE |
| `resetOnTeardown` | bool | false | Clear cached value on TEARDOWN |
| `pausable` | bool \| `"resumeAll"` | `true` | PAUSE/RESUME behavior (R1.3.8) |
| `replayBuffer` | number | — | Buffer last N outgoing DATA for late subscribers (DATA only — RESOLVED entries NOT buffered). **NOT YET IMPLEMENTED** — Lock 6.G target; Implementation Delta #13. `NodeOptions` has no `replayBuffer` field today. |
| `completeWhenDepsComplete` | bool | `true` | Auto-emit COMPLETE when all deps complete. `false` for terminal-emission operators (`last`, `reduce`) controlling own COMPLETE timing. |
| `errorWhenDepsError` | bool | `true` | Auto-emit ERROR when any dep errors. `false` for rescue/`catchError` operators handling errors via `ctx.terminalDeps[i]`. |
| `partial` | bool | **`false`** (raw `node()`, sugar `derived`/`effect` inherit). **Override `true` for sugar `dynamicNode` / `autoTrackNode`** | First-run gate (§2.7). When `false`, fn is held until every declared dep has delivered at least one DATA or terminal. When `true`, fn fires as soon as `_dirtyDepCount === 0` regardless of dep sentinel state. → Lock 6.C, Lock 6.C′ |
| `versioning` | `0 \| 1 \| undefined` | `cfg.defaultVersioning` | Versioning level (§7). Bumped via `setVersioning` (R7.2). |
| `describeKind` | enum | inferred | Type label for `describe()` output |
| `_isDynamic` | bool (internal) | false | Marks `dynamicNode` variant |

**R2.5.2 — `initial` semantics.** When `initial` is provided AND not `undefined`/`None`, cache is pre-populated; `.cache` returns that value before any emission. Source nodes with `initial` push `[[DATA, initial]]` to each new subscriber per R1.2.3. On first `actions.emit(v)`, equals IS called against the initial value.

When `initial` is **absent** or explicitly `undefined`/`None`, cache holds SENTINEL; node does not push on subscribe; first emission always produces `DATA` regardless of value.

`INVALIDATE` and `resetOnTeardown` return cache to SENTINEL.

**R2.5.3 — INVALIDATE does NOT re-arm the first-run gate.** Gate is `_hasCalledFnOnce`-scoped — once fn has fired in an activation cycle, subsequent INVALIDATEs reset per-dep `prevData` / `dataBatch` / `terminal` but do NOT block fn from firing on partial settlements thereafter. Callers needing gate re-engagement must use terminal-reset on a `resubscribable: true` node, which clears `_hasCalledFnOnce` along with DepRecords.

**R2.5.4 — `equals` contract.** Called between two consecutively cached values. Never called when cache is in SENTINEL state (no `initial`, or `initial: undefined`/`None`, or after INVALIDATE / `resetOnTeardown` / resubscribe reset). When cache holds a real value — whether from `initial` or prior emission — `equals` compares it against the new value.

Default `Object.is` handles all cases. Custom `equals` need only handle the value types the node actually produces. Throw policy: dev rethrow, prod log-and-continue per R1.3.2.c.

### 2.6 Singleton Hooks and Per-Node Options

**R2.6.1 — Per-node behavior hooks** (`fn`, `equals`) and **system-level options** (`pausable`, `replayBuffer`).

**R2.6.2 — `pausable` option behavior:**

| Value | Behavior |
|-------|----------|
| `true` (default) | On PAUSE, suppress fn execution. On RESUME, fire fn once with latest dep values. |
| `"resumeAll"` | On RESUME, replay every outgoing tier-3/4 message buffered while paused, in order. See R1.3.8. |
| `false` | Ignore PAUSE/RESUME — fn fires normally regardless of flow control. Appropriate for sources like reactive timers that must keep ticking regardless of downstream backpressure. |

**R2.6.3 — Lock-id mandatory** — see R1.2.6 + R1.3.8.a. Bare `[[PAUSE]]` / `[[RESUME]]` throws.

**R2.6.4 — TEARDOWN auto-precedes with COMPLETE (DS-13.5.A Q16).** When `[[TEARDOWN]]` arrives at a node not yet terminal, dispatcher synthesizes `[COMPLETE]` prefix in the same outgoing wave: `[[TEARDOWN]]` → `[[COMPLETE], [TEARDOWN]]`. Sinks observe a clean "complete-then-teardown" lifecycle pair — bridge subscribers like `firstWhere` / `firstValueFrom` resolve from COMPLETE before subscription unwires.

Applies to `"sentinel"`-status nodes too — a state node that never delivered DATA (e.g. `node<T>([])` with no `initial`, or just-INVALIDATE'd node) still gets the synthetic COMPLETE on TEARDOWN. Bridge subscribers waiting on a stream that never emitted need COMPLETE to reject cleanly with "completed without matching value" rather than hang.

**TEARDOWN is the cleanup signal of the previous activation cycle, NOT permanent destruction of the node** (D118 / R2.2.7.a). On `resubscribable: true` nodes, a late subscribe AFTER TEARDOWN resets the lifecycle and the node begins a fresh activation cycle — the prior cycle's TEARDOWN was just its cleanup, not a death sentence. On `resubscribable: false` nodes, late subscribe is rejected per R2.2.7.b. The `_teardownDone` (TS) / `has_received_teardown` (Rust/PY) flag is wave-scoped bookkeeping for the synthesis-skip in R2.6.4 above; it does NOT gate resubscribable reset.

Auto-precede is **idempotent** via `_teardownProcessed: boolean` flag: subsequent arrivals deliver `[[TEARDOWN]]` alone without re-emitting COMPLETE. Skips when wave already carries a terminal lifecycle signal (`COMPLETE` or `ERROR`).

**Implementation status:** spec target — **NOT YET IMPLEMENTED in core** (only `patterns/process/index.ts:1285` does it at the pattern layer). → Lock 6.F (file as 13.6.B implementation task).

**R2.6.5 — `replayBuffer` option.** When `replayBuffer: N` is set, node maintains a circular buffer of last N outgoing DATA values (RESOLVED entries are NOT buffered). Late subscribers receive buffered DATA after START handshake but before live updates: `[[DATA, v0], [DATA, v1], ..., [DATA, vN-1]]` as one `Messages` wave. Replaces `replay()` operator + `wrapSubscribeHook` monkey-patching.

**Implementation status:** spec target — **NOT YET IMPLEMENTED in core** (`_invariants.ts:4857` confirms). → Lock 6.G (file as 13.6.B implementation task).

**R2.6.6 — Singleton hooks.** Message interception and subscribe ceremony customization are **singleton** (global) hooks configured once at app startup, not per-node options:

```ts
configure((cfg) => {
  cfg.onMessage = (msg, depIndex, node, actions) => { ... };
  cfg.onSubscribe = (node, sink) => { ... };
  cfg.registerMessageType(MY_TYPE, { tier: 3 });
});
// Config freezes on first node creation.
```

**R2.6.7 — Central config singleton (`GraphReFlyConfig`).** Lives at `src/core/config.ts`. Holds:

| Field | Type | Default | Origin |
|---|---|---|---|
| `messageTypeRegistry` | MessageTypeRegistry | built-in 11 types | per `registerMessageType` |
| `codecRegistry` | CodecRegistry | empty | per `registerCodec` |
| `onMessage` | hook | default identity | R2.6.6 |
| `onSubscribe` | hook | default ceremony | R2.6.6 |
| `defaultVersioning` | `0 \| 1` | `0` | §7 |
| `maxFnRerunDepth` | number | `100` | Lock 2.F + Lock 2.F′ — central cap for ALL `_pendingRerun` chains in `_execFn` (re-entrance, dep-DATA-during-fn, autoTrackNode discovery). Replaces module-level `MAX_RERUN_DEPTH` constant. |
| `maxBatchDrainIterations` | number | `1000` | Lock 2.F′ extended per F7 — central cap for batch drain loop. Replaces module-level `MAX_DRAIN_ITERATIONS` constant in `batch.ts:31`. |
| `pauseBufferMax` | number | `10_000` | Lock 6.A |
| `equalsThrowPolicy` | `'rethrow' \| 'log-and-continue'` | dev: `'rethrow'`, prod: `'log-and-continue'` | Lock 2.A |

Two access paths:
1. **Default instance** (`defaultConfig`) — `configure((cfg) => ...)` at app startup; every node implicitly binds.
2. **Isolated instance** (`new GraphReFlyConfig(...)`) — pass via `opts.config` for test isolation or custom protocol stacks.

Config **freezes on first getter read** of any hook (`onMessage`, `onSubscribe`). `NodeImpl` constructor touches one of these on first use so configuration cannot drift once nodes exist.

### 2.7 Diamond Resolution and First-Run Gate

**R2.7.1 — Diamond resolution.** When a node depends on multiple deps that share an upstream ancestor:

```
    A
   / \
  B   C
   \ /
    D       ← D depends on [B, C], both depend on A
```

1. A changes → `[DIRTY]` propagates to B and C → both propagate `[DIRTY]` to D.
2. D's `DepRecord` array marks: dep 0 dirty, dep 1 dirty (needs both to settle).
3. B settles (DATA or RESOLVED) → D marks dep 0 settled, `_dirtyDepCount--`.
4. C settles → D marks dep 1 settled, `_dirtyDepCount === 0` → D recomputes.

D recomputes **exactly once**, with both deps settled. Glitch-free guarantee.

**R2.7.2 — Connection-time diamond.** When D subscribes for the first time and both B and C activate (pushing initial values), D's settlement machinery ensures fn runs exactly once after all deps have settled — not once per dep.

**R2.7.3 — First-run gate (authoritative).** Implemented in core `NodeImpl`, controlled by `partial` option (R2.5.1):

- **`partial: false`** — **default for raw `node()`** (verified `node.ts:682`: `this._partial = opts.partial ?? false`). Gate applies. Multi-parent activation holds fn through the sequential dep callbacks and fires exactly once after the last dep delivers, producing one combined initial wave `[[START], [DIRTY], [DATA, fn(init...)]]`. No intermediate RESOLVED emitted. `graph.derived` / `graph.effect` (R3.9) inherit the default.
- **`partial: true`** — **opt-in** (passed explicitly at construction). fn fires as soon as `_dirtyDepCount === 0` regardless of whether any dep is still SENTINEL. Operators that need partial firing (`withLatestFrom`, `valve`, worker-bridge aggregators) opt in. Default for `dynamicNode` and `autoTrackNode` per Lock 6.C′ (selective deps / runtime discovery don't fit gate-all-deps semantics).

**Gate scope:** applies only until fn has fired once in the current activation (`_hasCalledFnOnce`). `_addDep` post-activation, subsequent waves, and INVALIDATE do not re-gate (R2.5.3). Terminal reset on `resubscribable: true` clears `_hasCalledFnOnce` and re-arms gate.

**R2.7.4 — `dynamicNode` and `autoTrackNode` default to `partial: true`.** → Lock 6.C′

These two sugars **override** the raw-node default of `partial: false`:

- `dynamicNode(allDeps, fn, opts)` — declares a superset of deps; some may rarely or never deliver. Gate-all-deps semantics would stall fn indefinitely. Default `partial: true`. fn receives `track(dep)` instead of flat array; `track(dep)` returns `undefined` for not-yet-delivered deps; user fn handles explicitly.
- `autoTrackNode(fn, opts)` — discovers deps at runtime via `track(dep)` calls. No upfront `allDeps`. Default `partial: true`. Discovery loop fires fn immediately with `undefined` returns for unknown deps; subscribes via `_addDep`; `_pendingRerun` chain re-fires fn until convergence (capped by `cfg.maxFnRerunDepth`).

**Override:** caller can pass `{ partial: false }` explicitly to opt into gate-all-deps semantics.

Unused deps in `dynamicNode` still participate in wave tracking; their updates fire fn but equals absorption prevents downstream propagation.

**R2.7.5 — Multi-dep push-on-subscribe serialization.** `_activate` subscribes deps sequentially in declaration order; each dep's subscribe synchronously fires its own push-on-subscribe as a **separate wave**. When a compute node has N deps and each dep's source is already cached (e.g. N `state()` nodes), activation produces N sequential dep-settlement callbacks — not one combined initial wave. The first-run gate (R2.7.3 `partial: false`) holds fn through these N callbacks and fires once.

**R2.7.6 — Operator escape hatches for `partial: true` operators.** Raw `node()` operators that fire on partial deps can still emit RESOLVED from fn body to balance outstanding DIRTY messages:

- **`ctx.prevData[i]` fallback** — when `batch[i]` is null for a dep that must be paired, read `ctx.prevData[i]` (last-emitted DATA, regardless of which wave).
- **Factory-time seed pattern (sanctioned per Lock 1.C category 1)** — read dep's `.cache` at wiring time, stash in closure, update via subscribe handler. **Required** for factories built on raw `node()` with producer-pattern semantics (zero declared deps + closure-driven `subscribe` handlers) — gate has no multi-dep work to hold on empty `_deps` array, so those factories bypass the gate entirely. Examples: `stratify`, `budgetGate`, `distill`, `verifiable`. → folds COMPOSITION-GUIDE-PROTOCOL §28

Sugar `derived` / `effect` callers no longer need this pattern for multi-dep initial-pair case — the core gate delivers one combined initial wave.

### 2.8 Standalone sugar constructors

**R2.8.1 — Three standalone sugars exported from `core/sugar.ts`:**

```
dynamicNode(allDeps, fn, opts?)  → node(allDeps, wrapped, { describeKind: "derived", partial: true, ...opts })
autoTrackNode(fn, opts?)         → new NodeImpl([], wrapped, { describeKind: "derived", partial: true, ...opts })
pipe(source, ...ops)             → left-to-right fold (`ops.reduce` over Node)
```

These are the ONLY standalone sugar constructors. The named primitives `state` / `producer` / `derived` / `effect` (described in COMPOSITION-GUIDE patterns) **are NOT exported as standalone functions** — they exist only as methods on `Graph` (see §3.X).

**R2.8.2 — `dynamicNode`** declares an upfront superset of deps; fn receives `track(dep)` instead of positional `data[]`. `track(dep)` reads from `DepRecord.prevData` (P3-compliant — never reads `dep.cache`). Default `partial: true` per Lock 6.C′ (selective deps; gate-all-deps would stall on rarely-tracked deps). Throws if `track(dep)` is called with a dep not in `allDeps`.

**R2.8.3 — `autoTrackNode`** discovers deps at runtime via `track(dep)` calls. No upfront `allDeps`. Two-phase discovery:
1. **Discovery run** — `track(dep)` for unknown dep returns `dep.cache` as a stub (P3 boundary exception); subscribes via `_addDep`; result discarded.
2. **Real run** — DATA delivery from new dep triggers `_pendingRerun` → fn re-fires; `track(dep)` now returns protocol-delivered values.
3. Converges when no new deps found → emit result.

Capped by `cfg.maxFnRerunDepth` (Lock 2.F′). On overflow: emit `[[ERROR]]` with diagnostic shape `{ nodeId, currentDepth, configuredLimit, lastDiscoveredDeps }`.

Default `partial: true` per Lock 6.C′.

Discovery-run errors are stashed on `ctx.store.__autoTrackLastDiscoveryError` and cleared on successful real run.

**R2.8.4 — `pipe(source, ...ops)`** — left-to-right operator composition; each `op: (n: Node) => Node`. Pure type/code utility; no protocol involvement. Equivalent to `ops.reduce((n, op) => op(n), source)`.

**R2.8.5 — `NodeValues<TDeps>`** — tuple-mapped type utility (`{ readonly [K in keyof TDeps]: TDeps[K] extends Node<infer V> ? V : never }`). Used by compat layers and typed APIs. Pure type; no runtime.

**Implementation Delta #18:** Spec §2.8 (original draft + `~/src/graphrefly/GRAPHREFLY-SPEC.md` §2.8) listed `state(initial, opts?)`, `producer(fn, opts?)`, `derived(deps, fn, opts?)`, `effect(deps, fn, opts?)` as standalone sugar constructors. **They are not exported in TS.** Resolution:
- **TS:** keep current shape — sugars stay on Graph (`graph.state` / etc.). Spec text needs to clarify the Graph-method-only surface; JSDoc examples in `src/extra/` may remain as illustrative shorthand.
- **Rust port (directive 2026-05-03):** put sugars BACK into core alongside `dynamicNode` / `autoTrackNode`. Standalone `state` / `producer` / `derived` / `effect` return `Node<T>` directly; Graph methods become thin wrappers (e.g. `fn graph.state(name, ...) → graph.add(name, state(...))`). This realignment matches the JSDoc-example mental model and reduces the apparent surface-area split.

### 2.9 NodeImpl internal surface (informative — for Rust port)

The `NodeImpl` class in `src/core/node.ts` owns the protocol implementation. Implementations may differ in concrete shape; the field/method **names** below are TS-specific but the **roles** are spec-defined.

**Internal state fields** (Rust analogs need to preserve role, not name):

| TS field | Role |
|---|---|
| `_deps: DepRecord[]` | per-dep state — see R2.9.b for full DepRecord shape (R6.3) |
| `_sinks: NodeSink \| Set<NodeSink> \| null` | sink set |
| `_sinkCount: number` | drives activation/deactivation |
| `_cached: T \| undefined` | cache backing |
| `_status: NodeStatus` | status enum (R2.2.2) |
| `_cleanup: NodeFnCleanup \| undefined` | named-hook object (Lock 4.A) |
| `_store: Record<string, unknown>` | `ctx.store` backing (R2.4.6) |
| `_hasCalledFnOnce: boolean` | first-run gate state (R2.7.3) |
| `_dirtyDepCount: number` | settlement tracking (R2.7.1) |
| `_pauseLocks: Set<unknown> \| null` | per-node lock set (R1.3.8.a) |
| `_pauseBuffer: Messages[] \| null` | buffered waves — **TARGET shape per Lock 2.C / 2.C′** (current: `Message[] \| null` flat at node.ts:603; refactor pending — Implementation Delta #10) |
| `_isExecutingFn: boolean` | re-entrance guard |
| `_pendingRerun: boolean` | re-entrance pending flag |
| `_versioning: NodeVersionInfo \| undefined` | V0/V1 metadata (§7) |

**Internal methods** (lifecycle order):

| Method | Role |
|---|---|
| `_activate()` | first sink subscribed, wire up deps |
| `_deactivate(skipStatusUpdate?)` | last sink unsubscribed |
| `_addDep(depNode)` | post-construction dep wiring (rare) |
| `_emit(messages)` | central emission entry — Meta TEARDOWN fan-out at top (R1.3.9.d), tier-sort, equals substitution (R1.3.2), wave validation (R1.3.3) |
| `_emitUp(messages)` | upstream emit — runs `_validateUpTiers` first |
| `_validateUpTiers(messages)` | reject tier-3/5 (R1.4.1) |
| `_onDepMessage(depIndex, msg)` | dep wave routing → `_dep*` family |
| `_depDirtied(dep)` / `_depSettledAsData(...)` / `_depSettledAsResolved(...)` / `_depSettledAsTerminal(...)` / `_depInvalidated(...)` | per-message dep state transitions |
| `_maybeRunFnOnSettlement()` | check `_dirtyDepCount === 0`, gate-check, schedule `_execFn` |
| `_maybeAutoTerminalAfterWave()` | auto-COMPLETE/ERROR per R1.3.4 |
| `_execFn()` | run user fn with re-entrance guard; emit framing per R1.3.6.b |
| `_clearWaveFlags()` | reset per-wave bookkeeping |
| `_wrapFnError(label, err)` | normalize errors thrown by fn for `[[ERROR]]` emission |
| `_frameBatch(messages)` | tier-sort + DIRTY synthesis (R1.3.1.a) |
| `_updateState(messages)` | walk wave, advance cache, trigger downstream |
| `_dispatchOrAccumulate(messages)` | route to `_deliverToSinks` or accumulate during batch |
| `_deliverToSinks(messages)` | per-sink delivery |
| `_applyVersioning(level, opts?)` | internal versioning upgrade — see §7; user-facing surface is `Graph.setVersioning` (Lock 4.C) |
| `_setInspectorHook(hook)` | inspector machinery for `observe()` |
| `_pushGuard(guard)` | guard machinery for write authorization |
| `_checkGuard(opts?)` | guard enforcement on transport |

These are TS-specific implementation details. Rust port should preserve **role + ordering** (especially Meta TEARDOWN at top of `_emit`, R1.3.9.d) but is free to reshape names and granularity.

**R2.9.b — `DepRecord` shape (verified against `src/core/node.ts:358-388`):**

```ts
interface DepRecord {
  readonly node: Node;
  unsub: (() => void) | null;
  prevData: unknown;          // last DATA from end of previous wave; undefined = never sent
  dirty: boolean;             // awaiting DATA/RESOLVED for current wave
  involvedThisWave: boolean;  // distinguishes "RESOLVED in wave" vs "not involved"
  dataBatch: unknown[];       // DATA values accumulated this wave; cleared by _clearWaveFlags
  terminal: unknown;          // undefined = live; true = COMPLETE; else = ERROR payload
}
```

**`involvedThisWave`** (line 377) was an undocumented field in the spec. It distinguishes:
- `involvedThisWave === true && dataBatch.length === 0` → dep settled RESOLVED this wave (`data[i] === []`)
- `involvedThisWave === false` → dep was not involved in this wave (`data[i] === undefined`)

`_clearWaveFlags` resets `involvedThisWave = false` and `dataBatch.length = 0` between waves; `_depDirtied` sets `involvedThisWave = true`.

**R2.9.c — Versioning two-field split.** → Lock 4.F

`NodeImpl` maintains two parallel versioning fields (intentional design):

- `_versioningLevel: VersioningLevel | undefined` — explicit V0/V1/null enum, used for monotonicity checks and future v2/v3 extensions. Doesn't rely on `"cid" in _versioning` shape discrimination.
- `_versioning: NodeVersionInfo | undefined` — runtime metadata (`cid`, `prev`, etc.).

Mutated in lockstep by constructor (lines 701-710) and `_applyVersioning` (line 828). Rust port may collapse to a single struct with the level as a discriminant; the **roles** must be preserved.

---

## 3. Graph

The container that organizes nodes into a named, inspectable, composable artifact. Where the named sugar (`state` / `derived` / `effect` / `producer`) actually lives.

### 3.1 Construction

**R3.1.1 — Constructor.** `new Graph(name: string, opts?: GraphOptions)`. Creates a named graph; nodes are added explicitly via `add()` or via sugar methods.

**R3.1.2 — `tagFactory(factory: string, factoryArgs?: unknown): this`.** Annotates the graph with the factory function name and args used to create it (provenance for `describe()`, snapshot replay, debugging). Returns `this` for chaining.

### 3.2 Node Management

**R3.2.1 — Public surface:**

```
graph.add(node, opts?: { name?, annotation? }) → node    # register existing node
graph.remove(name) → GraphRemoveAudit                     # unregister + teardown
graph.node(name) → Node                                   # get by local/qualified name (throws if missing)
graph.nameOf(node) → string | undefined                   # reverse lookup
graph.set(name, value, opts?)                             # sugar: node.emit(value)
graph.get(name) → unknown                                 # sugar: node.cache
graph.invalidate(name, opts?)                             # sugar: down([[INVALIDATE]])
graph.complete(name, opts?)                               # sugar: down([[COMPLETE]])
graph.error(name, err, opts?)                             # sugar: down([[ERROR, err]])
graph.setVersioning(level)                                # bulk apply versioning level
```

**R3.2.2 — `add(node, opts?)`.** If `opts.name` provided, registers under that local name. If `node.name` is set and `opts.name` omitted, uses `node.name`. Throws on name collision (use unique names per graph). Returns the registered node.

**R3.2.3 — `remove(name)` lifecycle.** Sends `[[TEARDOWN]]` to the removed node (which fans out to its meta children per R1.3.9.d before deactivation). For mounted subgraphs, recursively tears down the mount tree. Returns `GraphRemoveAudit` describing what was removed (node count, mount count, audit IDs).

**R3.2.4 — `setVersioning(level)`.** Bulk-applies versioning level to every currently-registered node. Internal: iterates `_nodes.values()`; calls each node's `_applyVersioning(level)` (R7.2). **Local only** — does not propagate to mounted subgraphs. **Refuses to run mid-wave** (per R7.2 invariant). User-facing surface for versioning per Lock 4.C; `_applyVersioning` is `@internal`.

### 3.3 Edges

**R3.3.1 — Edges are derived, not stored.** `graph.edges(opts?)` returns `ReadonlyArray<[from, to]>` derived from each node's construction-time `_deps` array plus the mount hierarchy. **No stored edge registry.** No explicit `connect` / `disconnect`. Topology visible through `describe()` and diagram formats purely as a function of `(nodes, deps, mounts)`.

**R3.3.1.1 (exploratory, Phase 13.8) — Post-construction dep mutation via internal substrate primitives.** `_deps` is mutable post-construction via three external-facing substrate APIs and one internal-escape-hatch:

- `_addDepInternal(depNode, opts?: { fn?: NodeFn })` — append a dep without validation guards. Used by `autoTrackNode` (runtime discovery from inside `_execFn`) and `Graph.connect` (post-construction wiring). Q1 terminal-non-resubscribable rejection still applies. **`fn` is OPTIONAL on this internal path** — autoTrack discovery doesn't change fn.
- `_addDep(depNode, fn: NodeFn)` — external entry point with full validation: rejects mid-fn (`_isExecutingFn`), terminal-`this`, self-dep, cycle, reentrancy, and Q1 terminal-non-resubscribable. **`fn` is REQUIRED.**
- `_removeDep(depNode, fn: NodeFn)` — symmetric removal. Idempotent on absent deps (the fn swap still applies). Auto-settles wave if removed dep was the sole DIRTY contributor. **`fn` is REQUIRED.**
- `_setDeps(newDeps, fn: NodeFn)` — atomic replace. Surgical: kept deps' subscriptions and DepRecords are untouched; only removed deps unsubscribed and only added deps freshly subscribed. **`fn` is REQUIRED.**

Graph-layer wrappers `Graph._addDep(name, dep, fn)`, `Graph._removeDep(name, dep, fn)`, `Graph._rewire(name, newDeps, fn)` provide path-aware (`mount::leaf`) access plus a `GraphRewireAudit`. `TopologyEvent { kind: "rewired", audit }` carries diff visibility on `graph.topology`.

**Required `fn` parameter (Phase 13.8 lock).** The three external-facing substrate APIs (and their Graph wrappers) require `fn` at every call site — even when the caller intends to preserve the existing fn. Rationale: user fns read `data[i]` / `prevData[i]` positionally; dep-shape changes (count or order) silently misroute reads unless the caller acknowledges the fn-deps pairing at every call site. The required-fn signature forces that audit step at the API boundary, making the call site self-documenting in code review and AI-controller logs. Callers preserve the existing fn by passing the fn ref explicitly (`g._rewire("x", [y], oldFn)` — define fns as named consts when reuse is needed, or read `(node as NodeImpl)._fn` for ad-hoc retrieval).

Old fn's `onRerun` cleanup hook fires on the next `_execFn` invocation (clean wrap-up); if no further `_execFn` runs (immediate deactivation), `onRerun` is silently dropped — `onDeactivation` still fires.

**Surgical kept-dep semantics + Option C dispatch.** Subscription callbacks bind to the DepRecord reference, not a closure-captured index; the current `depIndex` is looked up dynamically via `_deps.indexOf(record)` at dispatch time. This means kept deps may shift position freely without re-subscribing — reorder + interior-remove are allowed.

**Reentrancy guard.** A `_inDepMutation` flag set in try/finally rejects synchronous re-entry from a subscribe-handshake or topology-subscriber callback (TLA+ atomicity assumption — `wave_protocol_rewire.tla`).

**Status:** experimental, internal-only API (single-underscore). Surface may change in DS-14. Canonical lock targeted for DS-14 alongside the delta protocol (op-log changesets, `restoreSnapshot mode: "diff"`, etc.). See [docs/research/rewire-design-notes.md](research/rewire-design-notes.md) and [docs/research/rewire-gap-findings.md](research/rewire-gap-findings.md) for the design lock + gap-findings record.

**R3.3.2 — `opts.recursive: true`** walks mounted subgraphs with qualified `::` paths; default is local-only.

**R3.3.3 — Decorative edges not representable.** If `describe()` shows an edge, there is a protocol subscription behind it. Factories that need a reactive wire between two already-constructed nodes must use runtime discovery primitives (`autoTrackNode`).

### 3.4 Composition (`mount`)

**R3.4.1 — Three overloads:**

```ts
graph.mount<G extends Graph>(name: string, child: G): G      # embed existing graph
graph.mount(name: string): Graph                              # create empty subgraph
graph.mount(name: string, builder: (sub: Graph) => void): Graph # create + builder pattern
```

**R3.4.2 — Lifecycle propagation.** Lifecycle signals propagate from parent to mounted children:
- `graph.signal([[INVALIDATE]])` cascades to all mounts (with meta filtering — R3.7.2).
- `graph.destroy()` sends `[[TEARDOWN]]` to all nodes including mounted children.

**R3.4.3 — Mount hierarchy queryable** via `graph.ancestors(includeSelf?: boolean): Graph[]` — returns the parent chain.

### 3.5 Namespace

**R3.5.1 — Path separator.** Double-colon (`::`) delimited paths. Single colons allowed in node and graph names.

```
"system"                        — root graph
"system::payment"               — mounted subgraph
"system::payment::validate"     — node within subgraph
```

**R3.5.2 — Resolution rules:**
- Mount automatically prepends parent scope.
- Within a graph, use local names (`"validate"`).
- Cross-subgraph references use relative paths from the shared parent.
- `graph.resolve(path) → Node` throws if missing.
- `graph.tryResolve(path) → Node | undefined` returns undefined if missing.

### 3.6 Introspection

**R3.6.1 — `describe(opts?)`** — heavily overloaded structure-query entry point. Mode is selected by opts shape; runtime throws `TypeError` on conflicting modes (e.g. `explain` + `reachable` together).

**Static modes** (return-by-value snapshot):

```ts
graph.describe()                                 → GraphDescribeOutput  // JSON
graph.describe({ format: "pretty" })             → string               // human-readable
graph.describe({ format: "mermaid" })            → string               // mermaid diagram
graph.describe({ format: "d2" })                 → string               // D2 diagram
graph.describe({ format: "stage-log" })          → string               // multi-line by stage
graph.describe({ detail: "minimal"|"full" })     → variant detail levels
graph.describe({ filter: {...} })                → filtered subset
graph.describe({ explain: { from, to, ... } })   → CausalChain          // walkback path
graph.describe({ reachable: { ... } })           → string[] | ReachableResult
```

**Reactive modes** (return-by-Node, live stream):

```ts
graph.describe({ reactive: true })               → ReactiveDescribeHandle<GraphDescribeOutput>
                                                   // live snapshot — emits whole new GraphDescribeOutput
                                                   // on every topology change.

graph.describe({ reactive: "diff" })             → ReactiveDescribeHandle<DescribeChangeset>
                                                   // diff stream — emits only the per-change
                                                   // delta (added/removed/mutated nodes).

graph.describe({ explain: {...}, reactive: true })
                                                 → { node: Node<CausalChain>; dispose: () => void }
                                                   // live causal chain.
```

**Mode interactions:**
- `reactive: true` is mutually exclusive with `format` (use `derived([describe({ reactive: true }).node], render)` to compose).
- `reachable` has no reactive form — compose via `derived` over a reactive describe Node.
- `explain` accepts both static and reactive forms.

**Static-only sentinel:** `reactive: false | undefined` opt narrows the static-form return type and rejects `name`/`reactiveName` (which only apply in reactive mode).

**`GraphDescribeOutput` shape:**

```json
{
  "name": "payment_flow",
  "nodes": {
    "retry_limit": {
      "type": "state",
      "status": "settled",
      "value": 3,
      "deps": [],
      "meta": { "description": "...", "type": "integer", "range": [1, 10] }
    },
    "validate": {
      "type": "derived",
      "status": "settled",
      "value": true,
      "deps": ["input"],
      "meta": { "description": "..." }
    }
  },
  "edges": [
    { "from": "input", "to": "validate" },
    { "from": "validate", "to": "charge" }
  ],
  "subgraphs": ["email"]
}
```

**Knobs vs Gauges** are filter views over `describe()`, not separate APIs:
- Knobs = writable nodes with meta (filter `type: "state"` + writable + has meta).
- Gauges = readable nodes with meta (filter has `meta.description` or `meta.format`).

The `type` field comes from `describeKind` set by sugar constructors; when not set, inferred:
- No deps, no fn → `"state"`
- No deps, with fn → `"producer"`
- Deps, with fn → `"derived"` (default for compute nodes)
- No fn, with deps → passthrough (labeled `"derived"`)

**R3.6.2 — `observe(path?, opts?)`** — live observation of message flow. Mode is selected by opts shape; the **default** is the sink-style API, NOT a Node, NOT an async iterable. Reactive Nodes and async iterables are opt-in.

**Default (sink-style)** — `GraphObserveOne` / `GraphObserveAll`:

```ts
graph.observe("validate")     → GraphObserveOne   // { subscribe(sink), up(messages) }
graph.observe()               → GraphObserveAll   // { subscribe(sink: (path, msgs) => …), up(path, msgs) }
```

The single-node handle exposes:
- `subscribe(sink)` — receive downstream messages from observed node. Includes the initial `[[DATA, cached]]` push if cached value present (R1.2.3).
- `up(messages)` — send upstream toward the observed node's sources (e.g. `[[PAUSE, lockId]]`). If a node guard denies, silently dropped.

The all-nodes handle:
- `subscribe(sink: (path, messages) => void)` — receives `(path, messages)` tuples.
- `up(path, messages)` — direct upstream by path.

**Reactive modes** (return-by-Node):

```ts
graph.observe("validate", { reactive: true })     → Node<ObserveChangeset>
                                                    // coalesces all observed events for one
                                                    // outermost batch flush into a single
                                                    // ObserveChangeset DATA wave.

graph.observe("validate", { changeset: true })    → Node<GraphChange>
                                                    // one DATA per discrete change (data flow +
                                                    // topology + batch boundaries) with edge
                                                    // attribution (`fromPath` + `fromDepIndex`).
                                                    // Mutually exclusive with reactive: true.
```

**Async-iterable mode** — `ObserveResult` (sink + async-iterable hybrid):

```ts
graph.observe("validate", { structured: true })   → ObserveResult
graph.observe("validate", { timeline: true })     → ObserveResult
graph.observe("validate", { causal: true })       → ObserveResult
graph.observe("validate", { detail: "minimal" })  → ObserveResult
// (any StructuredTriggers opt enables ObserveResult: structured / timeline / causal / derived
//  / detail other than the default)
for await (const ev of graph.observe("validate", { structured: true })) { ... }
```

**Mode interactions:**
- Default sink-style is NOT iterable. `for await (const ev of graph.observe("p"))` throws "not async iterable" — pass a `StructuredTriggers` opt to get `ObserveResult`.
- `reactive: true` and `changeset: true` are mutually exclusive.
- Reactive variants compose with `derived` for downstream reactive consumption: `derived([graph.observe("p", { reactive: true })], (cs) => …)`.

The `changeset: true` variant returns a `Node<GraphChange>` for reactive consumption of structural deltas (additions, removals, mutations) — see Phase 14 op-log changeset protocol.

**R3.6.3 — `resourceProfile(opts?) → GraphProfileResult`** — runtime profile (subscriber counts, fan-in/out, etc.). Used by `graphProfile()` / `harnessProfile()` debugging utilities.

### 3.7 Lifecycle

**R3.7.1 — `signal(messages, opts?)` — broadcast.**

```ts
graph.signal([[PAUSE, lockId]])    // pause everyone
graph.signal([[INVALIDATE]])       // wipe caches (with meta filtering)
graph.signal([[RESUME, lockId]])   // resume everyone
```

**R3.7.2 — Meta filtering on `signal([[INVALIDATE]])`.** Meta nodes (R2.3.3 companion lifecycle) are **skipped** during `INVALIDATE` broadcast — their cached values are preserved across graph-wide invalidation. Filtering happens at the graph layer (`graph.signal` iterates registered nodes and skips meta children of registered parents). Direct `[[INVALIDATE]]` to a meta node's `down()` does wipe its cache.

**R3.7.3 — `destroy()`** — TEARDOWN cascade. Sends `[[TEARDOWN]]` to all nodes (including mounted subgraphs). Each node fans out meta TEARDOWN at top of `_emit` per R1.3.9.d. After cascade, graph internal registries are cleared.

**R3.7.4 — `batch(fn)` — graph-scoped batch.** Same semantics as core `batch()` (R1.3.6): DATA/RESOLVED defer, DIRTY propagates immediately, downstream sees one coalesced wave. Convenience wrapper on graph instance.

### 3.8 Persistence

Detailed in §9 Storage & Persistence. Public surface here:

```
graph.snapshot(opts?)                        # → object | string | bytes
graph.restore(data, opts?)                   # rebuild state from snapshot
graph.attachStorage(tiers, opts?)            # reactive observe → per-tier debounced save
Graph.fromSnapshot(data, opts?)              # static — construct from snapshot
Graph.fromStorage(name, tiers)               # static — cold boot from first hit
Graph.decode(bytes, { config? })             # static — auto-dispatch via envelope
```

`graph.snapshot` formats:
- **Object form** (no arg): `GraphPersistSnapshot` — plain JS object.
- **`{ format: "json-string" }`**: `JSON.stringify` of the sorted object. Stable for hashing/file writes.
- **`{ format: "bytes", codec }`**: codec-encoded payload wrapped in v1 envelope (§9).

`JSON.stringify(graph)` works via `toJSON()` hook — delegates to `snapshot()` and returns the object form.

### 3.9 Named sugar methods (`state` / `derived` / `effect` / `producer`)

**R3.9.1 — These are GRAPH METHODS, not standalone exports.** All four create the underlying node, register on the graph in one call, and return the registered node. → Implementation Delta #18

#### R3.9.a — `graph.state<T>(name, initial?, opts?)`

```ts
graph.state<T>(name: string, initial?: T | null, opts?: GraphStateOptions<T>): Node<T>
```

Creates a dep-free node with optional initial value. Equivalent (verified `graph.ts:2090-2101`):

```ts
const n = node<T>([], { ...nodeOpts, name, describeKind: "state",
                        ...(initial !== undefined ? { initial } : {}) });
this.add(n, { name, ...(annotation != null ? { annotation } : {}) });
this._wireSignalToRemove(name, signal);
return n;
```

Primary entry for external data into the graph. Emit new values via `node.emit(v)` or protocol-level `down([[DATA, v]])`. `signal` opt: when aborted, removes node from graph.

`initial: undefined` is treated as absent (SENTINEL). `initial: null` is valid.

#### R3.9.b — `graph.derived<T>(name, deps, fn, opts?)`

```ts
type GraphDerivedFn<T> = (
  data: readonly (readonly unknown[] | undefined)[],
  ctx: FnCtxDerived<T>,
) => readonly (T | null)[];

graph.derived<T>(
  name: string,
  deps: readonly (string | Node<unknown>)[],
  fn: GraphDerivedFn<T>,
  opts?: GraphDerivedOptions<T>,
): Node<T>
```

Reactive compute over a mix of `::`-qualified path strings (resolved via `graph.resolve` at construction time) and direct `Node` refs (used as-is).

**Restricted fn signature** — fn returns `readonly (T | null)[]` (an array of values to emit). The wrapper (verified `graph.ts:1975-1992`):
- Empty array `[]` → settles as `[[RESOLVED]]` (no DATA, R2 use of RESOLVED per R1.3.3.f).
- Non-empty `[v]` → `actions.emit(v)` once.
- Multi-value `[v1, v2]` → `actions.emit(v1); actions.emit(v2)` (multi-DATA wave per R1.3.3.c).

`FnCtxDerived<T>` extends `FnCtx` with `cache: T | undefined` (closure-captured `nodeRef.cache` for self-cache reads — sole-writer scope per Lock 1.C).

**Opts:** `keepAlive: true` installs internal subscription so the node stays activated without external subscriber (self-prunes on terminal). `signal` aborts → removes from graph. `annotation` is a free-form provenance string for `describe()`.

#### R3.9.c — `graph.effect(name, deps, fn, opts?)`

```ts
type GraphEffectFn = (
  data: readonly (readonly unknown[] | undefined)[],
  up: NodeUpActions,
  ctx: FnCtx,
) => NodeFnCleanup | void;

type NodeUpActions = {
  pause: (lockId: unknown) => void;
  resume: (lockId: unknown) => void;
};

graph.effect(
  name: string,
  deps: readonly (string | Node<unknown>)[],
  fn: GraphEffectFn,
  opts?: GraphEffectOptions,
): Node<unknown>
```

**Pure sink** — fn has no `emit` / `down`. Effects that need downstream emission use `producer` or drop to raw `node() + graph.add()`. `up` exposes only `pause(lockId)` / `resume(lockId)` for upstream backpressure.

**Cleanup:** standard `NodeFnCleanup` per R2.4.5 (target shape: named hooks per Lock 4.A / 4.A′). Graph teardown triggers `onDeactivation`.

**Dormant by default** — without `keepAlive: true`, an effect with no external subscriber never fires (no sink → no activation). `keepAlive` installs internal subscription.

#### R3.9.d — `graph.producer<T>(name, setupFn, opts?)`

```ts
type GraphProducerSetupFn<T> = (
  push: (values: readonly (T | null)[]) => void,
  ctx: FnCtxProducer,
) => NodeFnCleanup | void;

type FnCtxProducer = { store: Record<string, unknown> };

graph.producer<T>(
  name: string,
  setupFn: GraphProducerSetupFn<T>,
  opts?: GraphProducerOptions<T>,
): Node<T>
```

Dep-free source with setup fn that receives a `push` channel for emitting values. Setup runs once when first subscriber connects.

`push([v])` → single DATA. `push([v1, v2])` → two DATAs (multi-DATA wave). Wrapper iterates and calls `actions.emit(v)` per value (verified `graph.ts:2131-2138`).

Return cleanup; graph teardown triggers `onDeactivation`.

### 3.10 Internal Graph state (informative)

| Internal | Role |
|---|---|
| `_nodes: Map<string, Node>` | local node registry |
| `_mounts: Map<string, Graph>` | mounted subgraph registry |
| `_parent: Graph \| null` | parent graph for ancestor walk |
| `_factoryTag` | provenance from `tagFactory` |
| `_keepalives: Set<() => void>` | self-pruning keepalive disposers |

**Removal audit shape** (`GraphRemoveAudit`):

```ts
{
  removedNodes: string[],
  removedMounts: string[],
  auditId: string,
}
```

---

## 4. Utilities

### 4.1 `pipe`

Covered in R2.8.4 (standalone sugar). Type-only utility for left-to-right operator composition.

### 4.2 Central timer (`monotonicNs`, `wallClockNs`)

**R4.2.1 — All timestamps go through `src/core/clock.ts`.** No `performance.now()`, `Date.now()`, or `process.hrtime()` calls outside this module. Same rule for PY (`core/clock.py` — `monotonic_ns()` / `wall_clock_ns()`).

**R4.2.2 — Two functions:**

```ts
monotonicNs(): number  // Math.trunc(performance.now() * 1_000_000)
wallClockNs(): number  // Date.now() * 1_000_000
```

**R4.2.3 — Use cases:**
- **`monotonicNs`** — internal/event-order durations (latency measurement, lifecycle timestamps that need to be monotonic). Used for `lockHeldDurationMs` in PAUSE diagnostic, audit-record `timestamp_ns`, etc.
- **`wallClockNs`** — wall-clock attribution (mutation provenance, cron emission, audit-record human-readable timestamps).

**R4.2.4 — Precision limits (TS):**
- `monotonicNs`: effective ~microsecond precision (`performance.now()` returns ms with ~5µs resolution; last 3 digits of ns value always zero).
- `wallClockNs`: ~256ns precision loss at current epoch (IEEE 754 safe-integer limit).

In practice both irrelevant — TS is single-threaded so sub-microsecond timestamp collisions don't occur. Rust port retains nanosecond precision via `std::time::Instant::now()` / `SystemTime::now()`.

### 4.3 `batch` and drain phases

**R4.3.1 — `batch(fn: () => void): void`** runs `fn` inside a batch scope. Nested `batch()` calls share one deferral queue. Inside batch:
- **Tier 0–2** propagate immediately (Phase 1, never queued).
- **Tier 3** (DATA/RESOLVED) deferred to drainPhase2.
- **Tier 4** (INVALIDATE per R1.3.7) deferred to drainPhase3.
- **Tier 5+** (COMPLETE/ERROR/TEARDOWN) deferred to drainPhase4.

Drain rule: fire pending flush hooks first, then drain lowest non-empty phase. Re-enqueues during drain bump the loop back to the top.

**R4.3.2 — Throw rollback.** If `fn` throws during the outermost batch frame: per-node flush hooks fire (so nodes clear their pending state), all drainPhase queues are cleared, throw re-propagates. **Inner batches inside flushInProgress skip rollback** (cross-language decision A4).

**R4.3.3 — Drain cap.** Drain loop has iteration cap (`MAX_DRAIN_ITERATIONS = 1000` currently; → `cfg.maxBatchDrainIterations` per Implementation Delta #20). On exceed: clear all phases, throw `'batch drain exceeded N iterations — likely a reactive cycle'`.

**R4.3.4 — Public surface:**

```ts
batch(fn: () => void): void
isBatching(): boolean              // true inside batch OR during drain
isExplicitlyBatching(): boolean    // true ONLY inside batch (excludes drain)
registerBatchFlushHook(hook: () => void): void  // node-level flush hook
downWithBatch(sink, messages, tierOf): void     // dispatcher entry
```

**R4.3.5 — Per-node coalescing.** `_emit` checks `isExplicitlyBatching()` (drain exclusion is critical per R1.3.6.c). Inside batch, accumulates into `_batchPendingMessages` and registers flush hook. On drain, hook fires and emits the coalesced multi-message batch as one `downWithBatch` call.

### 4.4 `messageTier` / `tierOf`

**R4.4.1 — Two surfaces, same lookup:**

```ts
cfg.messageTier(t: symbol): number     // method form
cfg.tierOf: (t: symbol) => number      // pre-bound closure (hot path)
```

`tierOf` is captured once in the config constructor as a closure over `_messageTypes`. Used by `_frameBatch` and `downWithBatch` to avoid per-call `.bind(config)` allocation.

**R4.4.2 — Unknown types default to tier 1** (immediate, after START). Forward-compat per R1.2.2.

**R4.4.3 — Custom message types** registered via `cfg.registerMessageType(symbol, { tier, wireCrossing?, metaPassthrough? })`:
- `wireCrossing` default = `tier >= 3`. Controls whether the message crosses worker bridges.
- `metaPassthrough` default = `true`. Controls whether the message reaches meta children.

**R4.4.4 — Never hardcode type checks.** Use `cfg.messageTier(t)` for tier classification. Used by checkpoint gating (`messageTier >= 3` per R1.3.7.c), worker-bridge filtering, batch drain phase routing.

---

## 5. Design Principles

The 12 invariants that hold across implementations (TS, Rust). Pure code rules; agent-process rules are excluded per Lock 7.A.

**R5.1 — Control flows through the graph, not around it.** Lifecycle and coordination use messages and topology, not imperative bypasses. If you're registering callbacks in a flat list for lifecycle, the design is wrong.

**R5.2 — Signal names must match behavior.** Rename the signal, don't change behavior to match a misleading name (RESET → INVALIDATE example).

**R5.3 — Nodes are transparent by default.** No silent swallowing of unrecognized message types. Documented operator suppression of DATA per the operator's contract IS sanctioned (R1.3.3.f, Lock 1.E carve-out). → folds Lock 5.B

**R5.4 — High-level APIs speak domain language.** Protocol internals (`DIRTY`, `RESOLVED`, bitmask, etc.) accessible via `inner` or `.node()` but never surface in primary API.

**R5.5 — Composition over configuration.** Prefer `pipe` with operators over a single node with options. Each concern is a separate node.

**R5.6 — Everything is a node.** One kind of thing connected by one kind of thing (edges). Transforms on edges or conditional routing? Add a node.

**R5.7 — Graphs are artifacts.** Can be snapshotted, versioned, restored, shared, composed. Persists beyond the process that created it.

**R5.8 — No polling.** State changes propagate reactively via messages. If periodic behavior needed, use timer source (`fromTimer`, `fromCron`) emitting through the graph.

**R5.9 — No imperative triggers outside the graph.** All coordination uses reactive `NodeInput` signals. Reaching for `setTimeout` + manual `set()` is a design smell — the situation needs a reactive source node.

Default: widen options/methods to `T | Node<T>` per Lock 1.A. Wrap as primitive only when underlying structure is reactive (map/list/topic/queue) AND the wrap eliminates an imperative call rather than shifting it elsewhere. → Lock 1.A

**R5.10 — No raw async primitives in the reactive layer.**
- **TS:** no bare `Promise`, `queueMicrotask`, `setTimeout`, `process.nextTick` to schedule reactive work. Use central timer (R4.2) and batch system for deferred delivery.
- **PY:** no bare `asyncio.ensure_future`, `asyncio.create_task`, `threading.Timer`, raw coroutines.
- **Rust:** equivalent — no bare `tokio::spawn`, `std::thread::spawn`, async runtime calls in the reactive layer outside designated source/runner boundaries.

**R5.11 — Domain-layer APIs (Phase 4+) speak developer language.** Sensible defaults, minimal boilerplate, clear errors, discoverable options. Developer unfamiliar with spec should use from examples alone.

**R5.12 — Data flows through messages, not peeks.** `.cache` reads sanctioned only at the three boundaries listed in Lock 1.C: (1) Inspection outside any reactive fn, (2) Sole-writer scope (lexically the only emit() call site), (3) Compat layers (`autoTrackNode` discovery). → folds Lock 1.C, Lock 5.B

---

## 6. Implementation Guidance

### 6.1 Language-Specific Adaptations

The spec defines **behavior**. Implementations choose syntax, concurrency model, type encoding.

**TS specifics:**
- `node` / `dynamicNode` / `autoTrackNode` / `pipe` standalone exports (R2.8).
- Sugar `state` / `derived` / `effect` / `producer` on `Graph` only (R3.9). → Implementation Delta #18
- Cleanup: named-hook object `{ onRerun?, onDeactivation?, onInvalidate? }` per Lock 4.A. → Implementation Delta #2
- `==/=== undefined` SENTINEL check (R1.2.4, R5.12, Lock 1.B).
- `pipe(source, ...ops)` left-to-right.
- Symbols for message types (`Symbol("DATA")` etc.).

**PY specifics (informative):**
- All public functions return `Node[T]`, `Graph`, `None`, or plain synchronous value — no `async def` / `Awaitable` in public APIs.
- `with batch():` instead of TS's `batch(() => ...)`.
- `|` pipe operator: `Node.__or__` maps to TS `pipe()`.
- `is None` / `is not None` SENTINEL check.
- `RLock` per subgraph; per-node `_cache_lock` for thread safety.

**Rust specifics (port plan):**
- Same `Node<T>` / `Graph` types; sugars (`state` / `producer` / `derived` / `effect`) standalone in core per Implementation Delta #18.
- Cleanup: enum or struct with named slots — Rust may use `Drop` + structured cleanup struct.
- Ownership model lets `mutate` rollback be structurally enforced (revisit Lock 4.B at Rust port).
- `Option::None` SENTINEL (Rust's natural zero-value sentinel).

### 6.2 Output Slot Optimization (informative)

Implementations MAY optimize the common single-message tier-3 path by short-circuiting framing (e.g. interned `[DIRTY_MSG, [DATA, v]]` arrays). Must produce observationally identical output to the general `_frameBatch` path. TS implements this at `node.ts:1875-1881` (`_frameBatch` fast path for single message).

### 6.3 DepRecord (per-dep state)

Full shape documented at R2.9.b. Cross-language note: `involvedThisWave` field is essential for distinguishing `data[i] === []` (RESOLVED-this-wave) from `data[i] === undefined` (not-involved). Rust port retains this field (perhaps as a packed bool with `dirty`).

**R6.3.1 (Phase 13.8) — Subscription-callback closure binding to DepRecord reference, not array index.** Every dep subscription's callback closes over the DepRecord ref `dep` (or `record`). At dispatch time the closure resolves `depIdx = this._deps.indexOf(dep)` dynamically and passes that into `MessageContext.depIndex` and `_onDepMessage`. **A closure-captured numeric index would silently misroute messages after a `_setDeps` reorder/interior-remove, because surgical kept-dep semantics keep the DepRecord identity stable but shift its position.** Public surfaces (`MessageContext.depIndex`, `NodeInspectorHookEvent.depIndex`) stay numbers; they just reflect the current position rather than a stale snapshot. Stale closures (post-unsub) early-return on the `dep.unsub === null` liveness check OR on `indexOf` returning `-1` (for the rollback case where the record was spliced out of `_deps`).

Rust port: same pattern — store the dep reference (e.g. `Arc<DepRecord>` or `NodeId`) in the closure, look up the index dynamically. O(N) `indexOf` is acceptable for the typical small N; promote to a parallel `HashMap<DepRecordId, usize>` cache if profiling warrants.

**R6.3.2 (Phase 13.8) — Failed-add rollback.** When `_addDepInternal` or `_setDeps` subscribe-throws on a freshly-added dep, the catch path:
1. Nulls `record.unsub` so any drainPhase2 closures from the partial subscribe are dropped via the liveness check.
2. Decrements `_dirtyDepCount` if the record was pre-dirtied.
3. Splices the failed record out of `_deps` so it is not visible to any subsequent in-flight callbacks (which would otherwise see `indexOf(record) !== -1`) and so a subsequent `_setDeps` does not treat it as kept-and-live.
4. If `[DIRTY]` was already emitted downstream, emits `[ERROR, err]` to close the wave deterministically (R1.3.1.a — DIRTY without follow-up is invalid).
5. Rethrows.

---

## 7. Node Versioning (Progressive, Optional)

### 7.1 Attaching versioning

**R7.1.1 — Per-node opt-in via `opts.versioning`:**

```ts
node([], { versioning: 0 })   // V0 — version counter only
node([], { versioning: 1 })   // V1 — V0 + content-addressed cid
node([], { versioning: undefined })  // unversioned (default)
```

**R7.1.2 — Config-level default via `cfg.defaultVersioning`:** applies to all nodes bound to the config, unless per-node `opts.versioning` overrides. Settable only before the config freezes (i.e. before first node creation).

**R7.1.3 — Levels:**
- `undefined` — no versioning (skip counter entirely).
- `0` (V0) — version counter on every DATA emission.
- `1` (V1) — V0 + content-addressed `cid` (hash of cached value) + `prev` chain.
- `2`, `3` — reserved for linked-history and cryptographic-attestation extensions.

### 7.2 Retroactive upgrade (`Graph.setVersioning`)

**R7.2.1 — User-facing surface is `Graph.setVersioning(level)`.** → Lock 4.C

```ts
graph.setVersioning(level: VersioningLevel | undefined): void
```

Iterates `_nodes.values()`; calls each node's `_applyVersioning(level)` (internal). Local only — does NOT propagate to mounted subgraphs.

**Not a default-for-future-adds mechanism** — that's `cfg.defaultVersioning`. Nodes added after `setVersioning()` do NOT automatically inherit `level`.

**R7.2.2 — Internal `_applyVersioning(level)` semantics:**
- **Monotonic upward only.** Downgrade (e.g. V1 → V0) is a no-op. Either node's current level < requested → upgrade applied; else untouched.
- **Refuses to run mid-wave.** Throws `'_applyVersioning cannot run mid-fn'`. Safe call points: setup time before subscribers attach (recommended), or between externally-driven `down()` / `emit()` calls at quiescent boundaries.

**R7.2.3 — `@internal` per Lock 4.C.** Users do not call `_applyVersioning` directly; they use `Graph.setVersioning` (or per-node `opts.versioning` at construction). Rust port may collapse to a single internal method.

**R7.2.4 — Two-field split** (per Lock 4.F):
- `_versioningLevel: VersioningLevel | undefined` — explicit V0/V1/null enum, used for monotonicity checks.
- `_versioning: NodeVersionInfo | undefined` — runtime metadata (`cid`, `prev`, etc.).
- Mutated in lockstep by constructor + `_applyVersioning`. Rust port may collapse to a single struct with the level as discriminant.

### 7.3 Linked-history boundary at V0 → V1 upgrade

**R7.3.1 — V0 → V1 produces fresh history root.** When `_applyVersioning(1)` runs on a V0 node:
- New `cid` = `hash(currentCachedValue)`.
- `prev` = `null` (fresh root, not chained from V0).

**R7.3.2 — Audit consequence.** Audit tools walking `v.cid.prev` backwards encounter `null` boundary at the upgrade point. Pre-upgrade history is intentionally invisible; the upgrade marks a cleavage point in the linked history.

This is intentional design. Implementations MUST NOT silently fabricate a `prev` for the upgrade cid.

### 7.4 Hash function

**R7.4.1 — Resolution order** (constructor line 696):
1. Per-node `opts.versioningHash` (highest precedence).
2. `cfg.defaultHashFn`.
3. Vendored sync SHA-256 default (`defaultHash` from `core/versioning.ts`).

**R7.4.2 — Hot-path swap.** Workloads that want a faster hash (xxHash, FNV-1a) set once at app init via `configure(cfg => { cfg.defaultHashFn = ... })`. Stronger hash for cryptographic-attestation use cases.

### 7.5 Hash advance ordering

**R7.5.1 — Version advances once per wave, not per DATA.** When a multi-DATA wave arrives at a versioned node, `_updateState` (line 2197-2204) pre-scans for the **last** DATA index in the batch and only calls `advanceVersion` on that last DATA. Rationale: `_cached` retains the last DATA value; intermediate version entries would reference values that can never be retrieved from cache.

For single-DATA waves: `lastDataIdx === -1`; `advanceVersion` fires unconditionally.

---

## 8. Patterns Layer

Domain-level compositions over the core protocol. Folds `COMPOSITION-GUIDE-PATTERNS.md` (L2) and `COMPOSITION-GUIDE-SOLUTIONS.md` (L3). All patterns are **composed factories** built on `node`, `Graph`, `derived`, `effect`, `producer`, `dynamicNode` per Phase 4+ developer-friendly API (R5.11).

### 8.1 Pattern catalog (`src/patterns/`)

**R8.1.1 — Module map (verified `src/patterns/`):**

| Module | Primary exports | Concern |
|---|---|---|
| `harness/` | `harnessLoop`, `refineLoop`, `spawnable`, `actuatorExecutor`, `evalVerifier`, `autoSolidify`, `bridge`, `defaults`, `strategy`, `trace`, `profile` (file-level helper; the `harnessProfile` export is in `inspect/`) | 7-stage reactive collaboration loop + presets |
| `cqrs/` | `cqrs`, `CqrsGraph`, `cqrsEventKeyOf`, `dispatchKeyOf`, `sagaInvocationKeyOf` | Command-query-responsibility-segregation with audit log |
| `memory/` | `collection`, `CollectionGraph`, `vectorIndex`, `VectorIndexGraph`, `knowledgeGraph`, `KnowledgeGraph` | Memory primitives |
| `messaging/` | `topic`, `TopicGraph`, `subscription`, `SubscriptionGraph`, `topicBridge`, `TopicBridgeGraph`, `messagingHub`, `MessagingHubGraph`, `TopicRegistry` | Pub/sub topology |
| `orchestration/` | `pipelineGraph`, `PipelineGraph`, `humanInput`, `tracker`, `decisionKeyOf` | Pipeline + human-in-loop + tracker |
| `process/` | `processManager`, `processInstanceKeyOf`, `processStateKeyOf` | Long-running stateful workflows |
| `job-queue/` | `jobQueue`, `JobQueueGraph`, `jobFlow`, `JobFlowGraph`, `jobEventKeyOf` | Job queue with claim/ack/nack |
| `ai/` | `promptNode`, `agentLoop`, `frozenContext`, `distill`, `verifiable`, `compileSpec`, etc. | LLM/agent primitives |
| `reduction/` | streaming reduction primitives | massive-info → actionable-items |
| `reactive-layout/` | layout primitives (Astro / browser) | UI integration |
| `inspect/` | `graphProfile`, `harnessProfile`, etc. | Inspection beyond core describe/observe |
| `demo-shell/` | demo scaffolding utilities | Demo infrastructure (not public API surface) |
| `topology-view/` | rendering helpers | describe-output renderers |
| `surface/` | API surface utilities | meta/factory-tag helpers |
| `graphspec/` | GraphSpec compilation | `compileSpec` and friends |
| `domain-templates/` | factory templates | catalog templates |
| `_internal/` | shared helpers | not public API |

### 8.2 Harness 7-stage solution (R8.2 = R8.L3.Harness)

**R8.2.1 — Reactive collaboration loop (canonical solution):**

```
INTAKE (TopicGraph)
  → TRIAGE (promptNode + withLatestFrom strategy)
    → QUEUE (JobQueueGraph)
      → GATE (human approval / auto-valve)
        → EXECUTE (promptNode + tools)
          → VERIFY (verifiable + promptNode)
            → REFLECT (strategy update + reingestion)
```

**R8.2.2 — Stage wiring (verified `src/patterns/harness/presets/harness-loop.ts`):**

- **TRIAGE → QUEUE:** `withLatestFrom(intake.latest, strategy.node)` — strategy is **advisory**, not a trigger. Avoids §7 feedback cycles (R8.G.7).
- **GATE:** Human approval via `gate.approve()` / `gate.reject()` / `gate.modify()` (Lock 1.A sanctioned imperative methods — backing structure is reactive audit cursor). Auto mode via `valve` (boolean flow control). Both append to the same audit log per R8.L2.35.
- **EXECUTE → VERIFY:** Wired via `verifiable(executeOutput, verifyFn, { autoVerify: true })`. Internal `switchMap` cancels stale verification when new execution arrives.
- **VERIFY → REFLECT:** Nested `withLatestFrom` (R8.L2.16) — REFLECT fires only on verify settle, sampling execute output + input as context.
- **REFLECT → INTAKE** (reingestion): Failed-verification items re-enter INTAKE with `relatedTo: [originalKey]` for stable dedup (R8.L2.17).

**R8.2.3 — Strategy model (closed-loop learning).** REFLECT updates `strategy.node` with `rootCause × intervention → successRate` entries. Future TRIAGE reads use `withLatestFrom` to route toward higher-success interventions. Storage: per-tier `attachStorage` (R9).

**R8.2.4 — Inspection.** `harnessProfile(graph)` returns per-stage stats (throughput, latency, error rate, queue depth). `graph.describe({ format: "mermaid" })` renders full topology.

### 8.3 Multi-agent orchestration (R8.3 = R8.L3.MultiAgent)

**R8.3.1 — Three composition modes** (verified `src/patterns/ai/`):

**R8.3.1.a — Sequential chain** — researcher → writer via `derived([researchResult], fn)` transformation. Simplest.

**R8.3.1.b — Fan-out / fan-in** — one input → N specialists via `topics.map(topic => agentLoop(...))`; merge outputs via `merge(...specialists.map(s => s.output))`; synthesize via `promptNode(adapter, [allResults], synthesizePrompt)`.

**R8.3.1.c — Supervisor with handoffs** — specialists registered as tools (agent-as-tool mode); supervisor calls via tool registry. See R8.L2.29.

**R8.3.2 — Shared state across agents.** All agents mount in the same `Graph` and share `agentMemory`. **No explicit context-passing** — the graph IS the shared state (R8.L2.29-context).

**R8.3.3 — Guardrails across agents.** Wire `contentGate` (R8.L2.30) at supervisor level to gate all specialist outputs before they reach the user.

### 8.4 Memory tier composition (R8.4 = R8.L3.Memory)

**R8.4.1 — `agentMemory` composition:**

```
collection (reactiveMap)
  + vectorIndex (derived, cosine similarity / HNSW)
  + knowledgeGraph (reactiveMap of typed edges)
  + decay (effect, time-based scoring)
  + retrieval (derived via distill, budget-constrained)
```

**R8.4.2 — Wiring (verified `src/patterns/memory/index.ts`):**
- **Collection → vectorIndex**: `derived([collection.entries], fn)` recomputes embeddings on collection change.
- **Retrieval**: `distill(query, extractFn, { score, cost, budget })` composes collection + vectorIndex + knowledgeGraph into budget-constrained context window. The `compact` node feeds `promptNode.context`.
- **Decay**: `effect([fromTimer(decayIntervalMs), collection.entries], fn)` periodically re-scores entries; evicts below-threshold.
- **Consolidation**: `distill`'s `consolidateTrigger` fires periodic merge of related entries via LLM (R8.L2.40 reactive extractFn).

**R8.4.3 — `frozenContext` integration** (R8.L2.33). Wrap `memory.context` in `frozenContext` to stabilize system prompt prefix across turns. Refresh on stage transitions or time intervals, not on every memory write. Maintains 90%+ prefix-cache hit rate.

**R8.4.4 — Reactive reads only** (per memory module module docstring, locked 2026-04-25). Public-face primitives expose `itemNode` / `hasNode` / `searchNode` / `relatedNode` for reactive observation. One-shot snapshots use `node.cache` after `awaitSettled`, or `firstValueFrom(node)`.

**R8.4.5 — Audit logs.** Every imperative mutation (`upsert`, `remove`, `clear`, `link`, `unlink`, `rescore`, `reindex`) is wrapped via `mutate` (R8.L2.35, Phase 14.1) and appends a typed record to a public `events` log on the bundle / graph.

### 8.5 Resilient pipeline composition (R8.5 = R8.L3.Pipeline)

**R8.5.1 — Standard order:**

```
rateLimiter → budgetGate → withBreaker → timeout → retry → fallback
```

```ts
const pipeline = pipe(
  userInput,
  rateLimiter({ rpm: 60, tpm: 100_000 }),
  budgetGate(costMeter, { maxCost: 10.0 }),
  withBreaker({ failureThreshold: 5, resetTimeMs: 30_000 }),
  timeout({ ms: 30_000 }),
  retry({ maxAttempts: 3, backoff: [100, 500, 2_000] }),
  fallback(cachedResponse),
);
```

**R8.5.2 — Order rationale (R8.L3.Pipeline-order):**
1. `rateLimiter` first — prevents burst from hitting provider rate limits.
2. `budgetGate` second — stops before spending tokens on a doomed request.
3. `withBreaker` third — fast-fails when provider down (avoids timeout wait).
4. `timeout` fourth — caps individual attempt duration.
5. `retry` fifth — retries on transient failures (timeout, 5xx).
6. `fallback` last — serves cached/default response when all retries exhausted.

**R8.5.3 — Each primitive is a `Node` in the graph.** `describe()` shows full topology. `observe(budgetGate)` logs every gate decision. `graphProfile(graph)` reports per-stage latency.

**R8.5.4 — `withBudgetGate` auto-wires adapter abort** per Lock 3.C — when adapter exposes `abort: NodeInput<void>`, gate's denied-state automatically fires abort to cancel in-flight calls. Without it, dev-mode warning logs once per adapter at wire-time.

**R8.5.5 — `handlerVersion` (R8.L2.37) on each stage** enables per-stage version tracking in audit log.

### 8.6 Imperative-controller-with-audit (R8.6 = R8.L2.35)

**R8.6.1 — Five sanctioned primitives** (Lock 1.A grandfathered — backing structure is reactive audit cursor; alternative would shift imperative call to `producer.emit()` upstream):

- **`pipeline.gate`** — gate primitive with `gate.approve()` / `gate.reject()` / `gate.modify()` methods.
- **`JobQueueGraph`** (`src/patterns/job-queue/index.ts:70`) — `claim()`, `ack()`, `nack()` per JobFlow C2 lock.
- **`CqrsGraph`** (`src/patterns/cqrs/index.ts:383`) — `dispatch(cmd)`, `register(handler)`.
- **`saga`** — `advance()`, `compensate()` with `"advance"` (default) / `"hold"` error policy.
- **`processManager`** (`src/patterns/process/index.ts:517`) — `handle(event)`, `cancel(correlationId)`.

**R8.6.2 — Shared shape (Phase 14.1 — `mutate` factory):**

```ts
class ControllerGraph extends Graph {
  readonly audit: ReactiveLogBundle<AuditRecord>;  // typed audit log
  readonly cursor: Node<number>;                    // bumped per mutation

  imperativeMethod = mutate(
    { up: (...args) => { /* user-supplied logic */ }, down?: () => { /* rollback */ } },
    {
      frame: "transactional",            // "inline" | "transactional"
      log: this.audit,
      onSuccessRecord: (args, result, meta) => ({ ... }),
      seq: this.cursor,
      handlerVersion: { id: "method", version: 1 },
    },
  );
}
```

**R8.6.3 — Helper machinery (verified `src/extra/mutation/`, Phase 14.1):**

- `mutate(act, opts)` — unified factory replacing the prior `lightMutation` + `wrapMutation` two-tier split. `act` is either a plain function (inline) or a `MutationAct<TArgs, TResult>` with `up`/`down` hooks. Two frame modes:
  - `frame: "inline"` — no batch rollback; audit + freeze only.
  - `frame: "transactional"` — surrounds action with **freeze-at-entry** (`Object.freeze(structuredClone(args))`); catches throws inside open `batch()`; discards reactive emissions + cursor seq on throw; fires `down` hook for closure-state rollback.
- `MutationAct<TArgs, TResult> = { up: (...args) => TResult, down?: (args, result, error) => void }` — DB up/down framing for rollback. `down` replaces the prior `compensate` option.
- `createAuditLog<T>()` — creates typed `ReactiveLogBundle<T>` for audit records.
- `registerCursor(node, initial)` — elevates closure counter to state node for observability.
- `registerCursorMap(node, fn)` — same for keyed cursors (e.g. per-claim cursors).
- `registerMutable(node, value)` — Lock 4.B Option B: opt-in auto-snapshot for closure mutables (Maps, Sets, counters).
- `DEFAULT_AUDIT_GUARD` — denies external writes; allows `observe` / `signal`.

**R8.6.4 — Two-layer rollback** (R8.L2.35-rollback-layers):
- **Helper-level (`mutate` with `frame: "transactional"`)**: catches throws in open `batch()`; discards reactive emissions + cursor seq; fires `down` hook.
- **Spec-level**: any user code in `batch()` benefits from batch throw rollback (R4.3.2).

**R8.6.5 — Closure-state hazard** (Lock 4.B): closure mutations (array splices, `Map.set`, plain JS counters) **do not roll back automatically**. Mitigations:
- **(A) `down` hook** — explicit declaration in `MutationAct` (`{ up: fn, down: () => { myMap.delete(key); counter--; } }`).
- **(B) `registerMutable(node, value)`** — opt-in auto-snapshot for common collections.
- **(C) Dev-mode Proxy detection** — wraps `Map`/`Set`/`Array` inside transaction; logs unregistered mutations.

Provisional per Lock 4.B; revisit at Rust port.

**R8.6.6 — `BaseAuditRecord` shape** (R8.L2.37):

```ts
interface BaseAuditRecord {
  seq: number;                 // cursor at time of record
  t_ns: number;                // wallClockNs() per R4.2.3
  handlerVersion?: { id: string; version: string | number };
}
```

Every controller's audit record extends this base.

**R8.6.7 — `BaseChange<T>` universal change envelope (Phase 14.2):**

```ts
interface BaseChange<T> {
  structure: string;           // "map" | "list" | "log" | "index" | ...
  version: number | string;    // monotonic per-structure
  t_ns: number;                // wallClockNs()
  seq?: number;                // optional cursor position
  lifecycle: ChangeLifecycle;  // "spec" | "data" | "ownership"
  change: T;                   // per-structure discriminated payload
}
```

Per-structure payload unions: `MapChangePayload<K,V>` (set/delete/clear), `ListChangePayload<T>` (append/appendMany/insert/insertMany/pop/clear), `LogChangePayload<T>` (append/appendMany/clear/trimHead), `IndexChangePayload<K,V>` (upsert/delete/deleteMany/clear). Types defined in `src/extra/data-structures/change.ts`.

**R8.6.8 — `mutationLog` companion on reactive data structures (Phase 14.3):**

Every reactive data-structure bundle (`reactiveMap`, `reactiveList`, `reactiveLog`, `reactiveIndex`) accepts an optional `mutationLog: true | { maxSize?, name? }` option. When configured, a companion `ReactiveLogBundle<StructureChange>` is exposed on the bundle as `bundle.mutationLog`. Each mutation enqueues a typed change record and flushes it inside the same `batch()` frame as the main snapshot emission (same-wave consistency). When the bundle is disposed, the companion log is also disposed. If a mutation is a no-op (backend version unchanged), pending change records are discarded.

**R8.6.9 — `reactiveLog.scan(initial, step)` incremental aggregate (Phase 14.4):**

O(1) per append — applies `step` only to entries appended since the last emission. Full rescan on `trimHead`/`clear`. Returns `Node<TAcc>`. Standalone `scanLog(log, initial, step)` delegates to `log.scan()`.

### 8.7 Process manager pattern (R8.7 = R8.L2.36)

**R8.7.1 — Use cases.** Long-running async stateful workflows correlating events across aggregates. Use when:
- Multiple steps with per-instance state.
- State survives across event boundaries.
- Cross-aggregate event correlation.
- Retry / compensation needed.

**R8.7.2 — Don't use** when (R8.L2.36-not):
- One-shot sync, no state.
- Linear pipeline (use `pipe`).
- Naturally expressible as a graph topology.

**R8.7.3 — Step result discriminated union** (R8.L2.36-step-result):

```ts
type StepResult<TState> =
  | { kind: "continue"; state: TState }
  | { kind: "terminate"; reason?: string }
  | { kind: "fail"; error: unknown };  // triggers compensate
```

**R8.7.4 — Synthetic event types namespace** (R8.L2.36-synthetic, Lock 2.E reserve-only). Process lifecycle events use reserved `_process_<name>_*` prefix. Avoid user event-type names starting with `_process_`. **No runtime collision check** — convention only.

**R8.7.5 — Concurrency safety** (R8.L2.36-concurrency). Multiple events for same `correlationId` serialize through step pipeline. `cancel(correlationId)` during async step is single-shot.

**R8.7.6 — `processInstanceKeyOf`** = `i.correlationId`. **`processStateKeyOf`** = derived from instance's correlation + state version.

### 8.8 Recipes (R8.8)

Recipes are **patterns, not factories** — they describe how to compose existing primitives. Locked as recipes per Lock 1.A abort criteria (no clear gain from wrapping).

**R8.8.A — `promptNode` SENTINEL gate** (R8.L2.8). `promptNode` gates on nullish deps and empty prompt text; skips LLM call and emits `null`. Guard with `!= null` (not `!== null`) to catch both. → Implementation: `src/patterns/ai/prompt-node.ts`.

**R8.8.B — `dynamicNode` superset model** (R8.L2.11). Already covered in R2.7.4. For wide-superset cases, default `partial: true` per Lock 6.C′.

**R8.8.C — Standard scenario patterns indexed in spec Appendix C** (R8.L2.15): LLM cost control, security policy, human-in-loop, multi-agent, LLM-builds-graph, git-versioned, custom signals.

**R8.8.D — Nested `withLatestFrom`** (R8.L2.16) — multi-stage context: fire on stage N, sample N-1 and N-2 as context. Outer trigger prevents mismatched values.

**R8.8.E — Stable identity for retried items** (R8.L2.17). Use `relatedTo[0]` as key, not mutated summary. All retries share identity via `relatedTo: [originalKey]`.

**R8.8.F — Multi-agent handoff (full)** (R8.L2.29). TRIAGE routes to specialist queue via TopicGraph; specialist owns response. Specialist becomes active agent; prompts focused.

**R8.8.G — Agent-as-tool mode** (R8.L2.29-mode2). Manager calls specialist as bounded subtask; manager synthesizes outputs.

**R8.8.H — Parallel guardrail** (R8.L2.30). Three modes:
- **Blocking** — guardrail before agent.
- **Parallel** — optimistic execution + cancel on tripwire (`switchMap` + `gatedStream` + AbortSignal). Best when guardrail fast, agent expensive, tripwire rate low.
- **Post-hoc** — final output check.

**R8.8.I — Dynamic tool selection** (R8.L2.31). Constraints reactively compose tool list. Anti-pattern: don't use as sole security boundary; pair with `toolInterceptor` for enforcement (R8.L2.31-antipattern).

**R8.8.J — `frozenContext`** (R8.L2.33). Wraps drifting source in stable snapshot; only re-materializes on explicit refresh trigger. Two modes:
- **Single-shot** — read once on first activation.
- **Refresh-on-trigger** — re-materialize on firing.

**R8.8.K — `handoff` primitive** (R8.L2.34). Sugar over full-handoff mode (§29). Specialist lifetime = "active while condition open."

**R8.8.L — Reactive `extractFn` for `distill`** (R8.L2.40). User picks cancellation semantics via `switchMap` / `concat` / `mergeMap`. Cancel-on-new-input most common; uses `switchMap`. Closure-mirror + subscribe handler (not `withLatestFrom`) to avoid initial-source-emission loss.

**R8.8.M — Criteria-grid verifier** (R8.L2.41). N binary axes instead of single yes/no; aggregated via `.every()` and approval gate. Recipe, not factory — human and LLM verifiers substitutable.

**R8.8.N — Cost-bubble** (R8.L2.42). Per-agent `bundle.cost: Node<CostState>` bubbled to parent via `derived` aggregation. **Honest cost control requires two pieces** (R8.L2.42-honest-cost):
1. Bubble for observability.
2. Adapter-abort hookup to cancel in-flight calls (auto-wired by `withBudgetGate` per Lock 3.C).

Without (2), gate cuts propagation but token burn continues.

**R8.8.O — `boundaryDrain`** (R8.L2.43). Accumulate on topic until boundary signal, drain batch downstream. Alias for `buffer(source, notifier)` operator; maps to `bufferWhen` semantics. Upgrade to factory if max-buffer-size cap, fallback emission on timeout, or per-boundary TTL needed.

**R8.8.P — `T | Node<T>` widening** (R8.L2.44, Lock 1.A canonical). Don't wrap imperative helper if bundle is trivial; widen helper with `T | Node<T>` instead. Wrap as primitive only when underlying structure is reactive AND wrap genuinely eliminates an imperative call (vs shifts upstream — abort criteria per Lock 1.A "stop the work in vain").

### 8.9 Pattern decision rubric

**R8.9.1 — When to compose vs add a primitive:**

| Situation | Choice |
|---|---|
| Need three or more places to call the same composition | Recipe in COMPOSITION-GUIDE; no factory until 3+ user-side pain points |
| Recipe used widely + non-trivial wiring | Promote to factory in `src/patterns/<domain>/` |
| Imperative helper in a trivial bundle | `T | Node<T>` widen — Lock 1.A |
| Imperative method on reactive structure (map / list / topic / queue / cursor) | Sanctioned per Lock 1.A — controller-with-audit shape (R8.6) |
| Behavior emerges from existing operators | Use `pipe` — no new primitive |

**R8.9.2 — When to use which orchestration pattern:**

| Use case | Pattern |
|---|---|
| Linear LLM chain | `pipe` + sequential `derived` |
| One input, multiple specialists | Fan-out + `merge` + synthesizer |
| Supervisor routes among specialists | Supervisor with `agent-as-tool` |
| Long-running stateful workflow | `processManager` |
| Audit trail + rollback | Controller-with-audit (R8.6) |
| Streaming reduction | `reduction/` primitives |
| Pub/sub fan-out | `topic` + `subscription` |
| Job queue with backpressure | `jobQueue` / `jobFlow` |

---

## 9. Storage & Persistence

Three-layer architecture (Audit 4, locked 2026-04-24). Folds COMPOSITION-GUIDE-GRAPH §27 + spec §3.8 + Lock 2.D (atomicity invariant) + Lock 4.D (defaults consolidation) + Lock 6.E (`compactEvery` in defaults).

### 9.1 Three-layer architecture (R9.1)

**R9.1.1 — Layer separation:**

```
Layer 3 — Wiring (per-domain attachStorage)
  ├─ Graph.attachSnapshotStorage(tiers)
  ├─ reactiveLog.attachStorage(tiers)
  ├─ cqrsGraph.attachEventStorage(tiers)
  └─ jobQueueGraph.attachEventStorage(tiers)
        │
Layer 2 — Tier specializations (typed, parametric over T)
  ├─ SnapshotStorageTier<T>     (one snapshot per save)
  └─ AppendLogStorageTier<T>    (sequential entries, optional partition)
        │ extends BaseStorageTier
        │
Layer 1 — StorageBackend (bytes I/O, generic kv)
  ├─ memoryBackend()             (browser + Node, in-process Map)
  ├─ fileBackend(path)           (Node-only — extra/storage-node.ts)
  ├─ sqliteBackend(path)         (Node-only)
  └─ indexedDbBackend()          (browser-only — extra/storage-browser.ts)
```

**R9.1.2 — Browser/Node split.** Layer 1 backends honor the universal/node/browser tier convention (R6.1). `memoryBackend` is universal; `fileBackend` / `sqliteBackend` are Node-only; `indexedDbBackend` is browser-only.

### 9.2 Layer 1 — `StorageBackend` (R9.2)

**R9.2.1 — Interface (verified `src/extra/storage/tiers.ts:34-49`):**

```ts
interface StorageBackend {
  readonly name: string;
  read(key: string): Uint8Array | undefined | Promise<Uint8Array | undefined>;
  write(key: string, bytes: Uint8Array): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
  list?(prefix?: string): readonly string[] | Promise<readonly string[]>;
  flush?(): Promise<void>;
}
```

**R9.2.2 — Sync vs async.** Sync backends return `void` / `T`; async return `Promise<...>`. Callers that want uniform handling `await` unconditionally (awaiting `undefined` is no-op).

**R9.2.3 — Tier-level concerns absent at this layer.** No debounce, no codec, no compaction. Pure bytes I/O.

### 9.3 Layer 2 — Tier specializations (R9.3)

**R9.3.1 — `BaseStorageTier`** (verified `src/extra/storage/tiers.ts:126-136`):

```ts
interface BaseStorageTier {
  readonly name: string;
  readonly debounceMs?: number;     // 0 = sync-through; >0 = batch across waves
  readonly compactEvery?: number;   // force flush every Nth write (Lock 6.E)
  flush?(): Promise<void>;          // commit pending; framework calls at wave-close / debounce-fire
  rollback?(): Promise<void>;       // discard pending; framework calls on wave-throw
}
```

**R9.3.2 — `SnapshotStorageTier<T>`** (verified `src/extra/storage/tiers.ts:147-154`):

```ts
interface SnapshotStorageTier<T = unknown> extends BaseStorageTier {
  save(snapshot: T): void | Promise<void>;
  load?(): T | Promise<T | undefined> | undefined;
  filter?: (snapshot: T) => boolean;        // skip-save policy — return false to skip
  keyOf?: (snapshot: T) => string;          // default: () => name ?? "snapshot"
}
```

Buffer model: `save(snapshot)` accumulates one pending snapshot in memory. `flush()` encodes via codec and writes to backend under `keyOf(snapshot)`. `rollback()` discards pending.

**R9.3.3 — `AppendLogStorageTier<T>`** (verified `src/extra/storage/tiers.ts:164-173`):

```ts
interface AppendLogStorageTier<T = unknown> extends BaseStorageTier {
  appendEntries(entries: readonly T[]): void | Promise<void>;
  loadEntries?(opts?: {
    cursor?: AppendCursor;
    pageSize?: number;
    keyFilter?: string;
  }): AppendLoadResult<T> | Promise<AppendLoadResult<T>>;
  keyOf?: (entry: T) => string;             // partition per-entry; default: () => name ?? "append-log"
}
```

`AppendCursor` is opaque: `Readonly<{ position: number; tag?: string }>` with brand. `AppendLoadResult<T>` = `{ entries: readonly T[]; cursor: AppendCursor | undefined }`.

**R9.3.4 — `defaultTierOpts`** — ⚠️ **target per Lock 4.D consolidation; NOT YET an exported constant**. The TS code today does not export a `defaultTierOpts` constant — defaults are inlined per-factory. Lock 4.D's consolidation produces the following target shape:

```ts
const defaultTierOpts: BaseTierOpts = {
  debounceMs: 0,             // sync flush at wave-close
  compactEvery: undefined,    // no forced flush cap
  filter: undefined,          // save everything
  codec: jsonCodec,           // built-in JSON (already the default — verified `tiers.ts:267`)
  keyOf: undefined,           // primitive-default keyOf
};
```

After Lock 4.D lands, tier docs describe only **deviations from defaults**.

### 9.4 Codec system (R9.4)

**R9.4.1 — `Codec<T>` interface** (verified `src/extra/storage/tiers.ts:60-66`):

```ts
interface Codec<T = unknown> {
  readonly name: string;
  readonly version: number;     // u16 — bumped on breaking codec changes
  encode(value: T): Uint8Array;
  decode(bytes: Uint8Array): T;
}
```

**R9.4.2 — Built-in `jsonCodec`** (verified `src/extra/storage/tiers.ts:76-86`):

```ts
const jsonCodec: Codec<unknown> = {
  name: "json",
  version: 1,
  encode(value) { return textEncoder.encode(stableJsonString(value)); },
  decode(bytes) { return JSON.parse(textDecoder.decode(bytes)) as unknown; },
};
```

`stableJsonString` produces deterministic output (sorted keys); enables byte-stable hashes and git-diffable snapshots.

`jsonCodecFor<T>()` returns `jsonCodec` cast to `Codec<T>` for type ergonomics.

**R9.4.3 — Codec registry on `GraphReFlyConfig`** (R3.8):

```ts
config.registerCodec(codec)    // before first node creation; overwrites prior same-name
config.lookupCodec(name)       // resolve by name; undefined for unknown
```

### 9.5 Envelope v1 wire format (R9.5)

**R9.5.1 — Layout (frozen for 1.0 line):**

```
[envelope_v=1 : u8][name_len : u8][name : utf8(1..=255 bytes)][codec_v : u16 BE][payload : rest]
```

**R9.5.2 — Field rules:**

| Field | Type | Constraint |
|---|---|---|
| `envelope_v` | u8 | Currently `1`. Bumped on breaking layout changes. |
| `name_len` | u8 | 1..=255. Both encoder and decoder reject `name_len == 0`. |
| `name` | UTF-8 | Codec identifier matching `config.lookupCodec` key. |
| `codec_v` | u16 BE | Codec's own version. Passed to `codec.decode(buffer, codecVersion)`. |
| `payload` | bytes | Codec output verbatim. |

**R9.5.3 — Self-describing.** Callers decode without knowing the codec up front. `Graph.decode(bytes)` reads the header, looks up codec via `config.lookupCodec`, returns the snapshot.

**R9.5.4 — Cross-language portability.** Envelope format is **frozen at v1 for the 1.0 line**. Every implementation (TypeScript, Rust, Python) MUST produce and consume **byte-identical envelopes**. Snapshot written in one runtime must restore in another.

**R9.5.5 — Scope boundary.** Envelopes live at I/O boundaries (storage tiers, wire transports). Internal records (`GraphCheckpointRecord`, `WALEntry`, in-memory snapshots) stay JS objects — `encode`/`decode` only fires when bytes need to leave the process.

### 9.6 Atomicity invariant (top-line — Lock 2.D elevated)

**R9.6.1 — Top-line invariant.**

> Each storage tier owns its own transaction. **Cross-tier atomicity is best-effort** — if tier A succeeds and tier B fails, partial persistence results. Callers depending on cross-tier consistency must implement their own reconciliation (idempotent writes, version reconciliation on read, or compensating actions on read-side detection).

→ Lock 2.D elevated this from buried sub-rule to top-line because it is a user-visible correctness risk.

**R9.6.2 — Wave-as-transaction** model:
- One wave produces one transaction per tier.
- `save(snapshot)` / `appendEntries(entries)` adds to per-tier buffer.
- `flush()` commits.
- `rollback()` discards on wave-throw.

**R9.6.3 — Debounce extends transaction window.** When `debounceMs > 0`, `flush()` is deferred until debounce fires — multiple waves accumulate in the same buffer. **Partial-persistence window grows with debounce.** Document deliberately.

**R9.6.4 — `compactEvery` flush cap.** When set, forces flush every Nth write regardless of debounce. Caps in-flight buffer for append-log tiers and per-tier debounce-extended snapshot tiers (Lock 6.E lifts to defaults). Default: `undefined` (no cap).

**R9.6.5 — Per-tier independence.**
- Sync tiers (`debounceMs === 0`) flush at wave-close.
- Debounced tiers fire their own timer.
- Each tier tracks its own `{lastSnapshot, lastFingerprint}` so cold-tier diff baselines aren't polluted by hot-tier flushes.

### 9.7 Layer 3 — High-level wiring (R9.7)

**R9.7.1 — `Graph.attachSnapshotStorage(tiers, opts?)`** subscribes to the graph (or scoped `paths` subset), tier-gates on `messageTier >= 3` (R1.3.7.c — value changes only; skips DIRTY/PAUSE/TEARDOWN control traffic), flushes per-tier at each tier's cadence.

```ts
graph.attachSnapshotStorage(
  tiers: readonly SnapshotStorageTier<GraphCheckpointRecord>[],
  opts?: { autoRestore?: boolean; onError?: (err, tier) => void }
): () => void  // disposer
```

`opts.autoRestore: true` triggers a cold-read cascade before the first save: tiers tried in order; **first hit wins** (R8.G.27-read-order).

**R9.7.2 — `reactiveLog.attachStorage(tiers, opts?)`** — same mechanism for append-log primitives. Each tier's `appendEntries` receives entries on every append wave.

**R9.7.3 — `CqrsGraph.attachEventStorage(tiers)`** and **`JobQueueGraph.attachEventStorage(tiers)`** — domain-specific attach methods on controller graphs. Wrap append-log persistence around the controller's event log.

**R9.7.4 — `GraphCheckpointRecord` shape** (verified `graph.ts:552-557`):

```ts
type GraphCheckpointRecord = {
  name: string;          // graph name (used for keyOf default)
  data: GraphPersistSnapshot;
  timestamp_ns: number;  // wallClockNs() at flush
  format_version: number;  // SNAPSHOT_VERSION
  // mode-specific: full snapshot OR diff against tier's last baseline
};
```

**R9.7.5 — Diff vs full mode.** Each write is a `GraphCheckpointRecord` with mode-specific payload:
- `full`: complete snapshot.
- `diff`: diff against tier's last baseline (Phase 14 changeset protocol — currently planned, not all tiers yet).

`compactEvery: N` forces a `full` snapshot every N writes regardless of mode.

### 9.8 Snapshot / restore APIs (R9.8 = R3.8 detailed)

**R9.8.1 — Public surface:**

```ts
graph.snapshot()                              // GraphPersistSnapshot (object)
graph.snapshot({ format: "json-string" })     // string (deterministic, sorted keys)
graph.snapshot({ format: "bytes", codec })    // Uint8Array (envelope-wrapped)
graph.restore(data, opts?)                    // rebuild state
Graph.fromSnapshot(data, opts?)               // static — construct new graph from snapshot
Graph.fromStorage(name, tiers)                // static — cold boot from first hit
Graph.decode(bytes, { config? })              // static — auto-dispatch via envelope
```

**R9.8.2 — `restore(data, opts?)` semantics:**
- Accepts `onError?: (path, err) => void` callback. Omitted callback preserves historical silent behavior (guard denials and missing paths swallowed).
- Walks the snapshot, restores cached values + status, re-applies versioning info if present.

**R9.8.3 — `JSON.stringify(graph)` works** via the ECMAScript `toJSON()` hook — delegates to `snapshot()` and returns object form.

**R9.8.4 — Snapshots capture wiring + state values, NOT computation functions.** The `fn` lives in code. Snapshots capture which nodes exist, how they're connected (derived from `_deps` per R3.3), their cached values, and their meta.

Same state → same JSON bytes → git can diff.

### 9.9 Cascading cache (informative)

**R9.9.1 — `extra/storage/cascading-cache.ts`** provides `cascadingCache(tiers, opts)` — read cascade across tiers (hot first, cold last); first-hit wins. Used by `Graph.fromStorage` and `attachSnapshotStorage(autoRestore: true)`.

### 9.10 Content-addressed storage (informative)

**R9.10.1 — `extra/storage/content-addressed.ts`** provides content-addressed storage helpers (CID-keyed) for V1-versioned graphs (R7). Layered over a `StorageBackend`; key is `hash(content)`.

---

## 10. Implementation Deltas (TS reference vs canonical spec)

*Audit-trail section: where the current TS reference implementation (`src/core/node.ts`, `src/core/sugar.ts`) diverges from the canonical spec above. Phase 13.6.B implementation owns closing these. Rust port reads the canonical spec; TS implementation team reads this delta list.*

| # | Canonical rule | Current TS code | Refactor | Lock |
|---|---|---|---|---|
| 1 | R2.4.4 — `ctx` has `prevData` only (no `latestData`) | `FnCtx` (node.ts:192-196) already correct: only `prevData` | Spec-only: rename `latestData` → `prevData` in `~/src/graphrefly/GRAPHREFLY-SPEC.md` §2.4 | Lock 4.E |
| 2 | R2.4.5 — Cleanup hooks: `{ onRerun, onDeactivation, onInvalidate }`; no shorthand | `NodeFnCleanup` (node.ts:162-168) is dual-shape with `() => void` shorthand + `{ beforeRun, deactivate, invalidate }` | Type rename + remove shorthand; update `_execFn` (1722-1751), `_updateState` INVALIDATE (2290-2336 — full INVALIDATE branch including rigor recorder hook + cache reset, not just cleanup tail), `_deactivate` cleanup-firing | Lock 4.A, Lock 4.A′ |
| 3 | R2.4.6 — `ctx.store` persists across deactivation by default | Currently wiped on `_deactivate` (per docstring node.ts:189-190; actual wipe-site in `_deactivate` body needs grep during 13.6.B) | Flip default in `_deactivate`; migrate `take.ts`, `transform.ts`, `time.ts`, `async.ts`, `csv.ts` to add explicit `onDeactivation: () => { ctx.store = {} }` | Lock 6.D |
| 4 | R2.5.1 — `partial` default `false` for raw `node()` | Already correct: `this._partial = opts.partial ?? false` (line 682) | None for raw node; spec docstring fix only (`GRAPHREFLY-SPEC.md` §2.5 wrongly says raw default `true`) | Lock 6.C′ |
| 5 | R2.7.4 — `dynamicNode` and `autoTrackNode` default `partial: true` | Both inherit raw default (`false`); neither explicitly overrides | Add explicit `partial: true` in `sugar.ts:98` (dynamicNode) and `sugar.ts:225-228` (autoTrackNode) | Lock 6.C′ |
| 6 | R1.3.2.b — Equals check order: version → identity → user equals | `_updateState` (line 2206-2241) does only user-equals (no Versioned, no identity short-circuit) | Add version-first + identity short-circuit in `_updateState` DATA branch | Lock 2.A |
| 7 | R1.3.2.c — Equals throws: dev rethrow, prod log-and-continue | `_updateState` (line 2215-2222) catches + aborts walk + delivers prefix + recursive ERROR | Branch on `cfg.equalsThrowPolicy`; current behavior (catch+ERROR) does neither | Lock 2.A, Lock 2.A′ |
| 8 | R1.3.7.b — INVALIDATE → status `"sentinel"` | `_updateState` line 2312 sets `"dirty"` | Change to `"sentinel"`; verify subsequent push-on-subscribe sends `[[START]]` only | Lock 6.H |
| 9 | R1.3.8.b — PAUSE buffer covers tier-3 + tier-4 | `_emit` line 2126-2136 buffers only tier-3 | Extend tier check to tier-3 OR tier-4 | Lock 2.C′-pre |
| 10 | R1.3.8 — `_pauseBuffer` is `Messages[]` (per-wave) | `_pauseBuffer: Message[] \| null` (line 603) — flat | Type to `Messages[] \| null`; push wave at line 2126; per-wave replay in PAUSE/RESUME final-lock-release block (around lines 2048-2065+) | Lock 2.C, Lock 2.C′ |
| 11 | R1.3.8.c — Buffer cap via `cfg.pauseBufferMax` (default 10_000) with overflow ERROR | No cap; unbounded | Add `pauseBufferMax` to config; check on push; emit ERROR on overflow with diagnostic | Lock 6.A |
| 12 | R2.6.4 — Q16 auto-COMPLETE-before-TEARDOWN in core | Not implemented in core (only `patterns/process/index.ts:1285`) | Add `_teardownProcessed` flag + synthesis in `_emit` | Lock 6.F |
| 13 | R2.6.5 — `replayBuffer: N` circular buffer of last-N DATAs (DATA only; RESOLVED entries NOT buffered) | Not implemented (`_invariants.ts:4857` confirms); `NodeOptions` has no `replayBuffer` field | Add `_replayBuffer` field + buffer machinery + late-subscriber replay | Lock 6.G |
| 14 | R2.6.7 — `cfg.maxFnRerunDepth` (broad scope, not just autoTrack) | `MAX_RERUN_DEPTH = 100` module-level constant (node.ts:83); check at line 1819, diagnostic string at line 1825 | Move to config; broaden diagnostic to `{ nodeId, currentDepth, configuredLimit, lastDiscoveredDeps? }` | Lock 2.F, Lock 2.F′ |
| 15 | R5.12 — `.cache` reads sanctioned in 3 categories only | No runtime enforcement; convention only | Sweep `src/` for fn-body `.cache` reads; classify per categories; document accepted exceptions | Lock 1.C (audit) |
| 16 | R1.3.3.d — Wave-content invariant runtime assertion | No dev-mode check | File optimizations.md item; dev-mode `_emit` assertion deferred | Lock 1.D |
| 17 | R2.4a Q9 INVALIDATE collapse | Verify present in `_frameBatch` or `_updateState` (not yet confirmed) | Audit during 13.6.B | DS-13.5.A Q9 |
| 18 | R2.8.1 — `state` / `producer` / `derived` / `effect` are NOT standalone exports | Only `dynamicNode` / `autoTrackNode` / `pipe` exported from `core/sugar.ts`. Named sugar lives ONLY as `Graph` methods (`graph.state` / `graph.derived` / `graph.effect` / `graph.producer`) | **TS: keep current shape** (sugars on Graph). **Spec-only TS update**: clarify in `~/src/graphrefly/GRAPHREFLY-SPEC.md` §2.8 that named sugar is on Graph, not standalone. JSDoc examples in `src/extra/` may stay as illustrative shorthand. **Rust port: realign by putting sugars BACK in core** alongside `dynamicNode` / `autoTrackNode` (per user direction 2026-05-03). Rust `state` / `producer` / `derived` / `effect` return `Node<T>` standalone; Graph methods become thin wrappers (`fn graph.state(name, ...) → graph.add(name, state(...))`). | (no lock — TS no-op; Rust-port directive) |
| 19 | R1.3.7 — Tier table per DS-13.5.A: tier 4 = INVALIDATE, tier 5 = COMPLETE/ERROR, tier 6 = TEARDOWN | `src/core/batch.ts` doc comments use **pre-DS-13.5.A numbering**: "Tier 4 — deferred to drainPhase3" calls tier 4 "COMPLETE/ERROR"; "Tier 5 — deferred to drainPhase4" calls tier 5 "TEARDOWN". Actual code logic at line 228 (`tier >= 5 ? drainPhase4 : tier === 4 ? drainPhase3 : drainPhase2`) maps correctly | Comment-only sweep: `src/core/batch.ts` lines 22-25, 38-43, 204-208. Update wording to match canonical tier table. Plus `node.ts:2113-2125` `_emit` BufferAll comment uses same old numbering. | (no lock — comment cleanup) |
| 20 | R4.3 — Batch drain iteration cap should be central config | `src/core/batch.ts:31` defines `MAX_DRAIN_ITERATIONS = 1000` as module-level constant. Same anti-pattern as `MAX_RERUN_DEPTH` (Lock 2.F′). | Move to `cfg.maxBatchDrainIterations` (default `1000`). Diagnostic at line 169-171 also vague — broaden to `{ phase, queueSizeAtThrow, configuredLimit }`. | Lock 2.F′ extended per F7 — covers both `maxFnRerunDepth` and `maxBatchDrainIterations` |

**Phase 13.8 substrate additions (post-13.6.A, exploratory):** the rewire substrate primitives (`_setDeps`, `_addDep`, `_addDepInternal`, `_removeDep` on `NodeImpl`; `_rewire`, `_addDep`, `_removeDep` on `Graph`) are NEW additions that extend §3.3 and §6.3. They are NOT deltas in the sense of "TS impl drifts from canonical" — the canonical spec text in R3.3.1.1 / R6.3.1 / R6.3.2 was added simultaneously with the TS implementation. Status: experimental, internal-only API; final canonical lock targeted for DS-14. See [research/rewire-design-notes.md](research/rewire-design-notes.md) and [research/rewire-gap-findings.md](research/rewire-gap-findings.md).

**Flag for handoff:** Items 6, 12, 13 are non-trivial **net-new code** (versioning equals path, Q16 synthesis, replayBuffer machinery). Items 8, 9, 10 are subtle **behavior changes** with downstream test impact. Items 1, 4, 14 are largely **documentation/rename** with low risk. Item 3 is a **migration** with broad impact.

**Phase 13.6.B should sequence:**

1. **Pure renames + spec fixes** (low risk): Items 1, 4, 14 (config rename), Lock 4.A′ field rename — low-risk type/identifier changes.
2. **Code-side spec compliance** (correctness fixes): Items 8, 9, 10, 11 — small surgical changes, well-localized.
3. **Behavior flips with migration** (broad sweep): Item 3 (`ctx.store`), Lock 4.A removing shorthand — affects many call sites.
4. **Net-new implementation** (new machinery): Items 6 (equals check order + throw policy), 12 (Q16), 13 (replayBuffer) — meaningful new code.
5. **Audit sweeps** (non-coding): Items 15, 17, original Lock A/B/C audit items.

---

## 11. Appendices

### Appendix A — Message Type Reference

```
DATA          [DATA, value]           Value delivery (value MUST NOT be undefined per R1.2.4)
DIRTY         [DIRTY]                 Phase 1: about to change
RESOLVED      [RESOLVED]              Phase 2: dual-role per R1.3.3.e (equals-substituted DATA OR no-DATA wave settle)
INVALIDATE    [INVALIDATE]            Clear cache (status → "sentinel" per Lock 6.H)
RESET         [RESET]                 INVALIDATE + push initial
PAUSE         [PAUSE, lockId]         Suspend (lockId mandatory per R1.2.6)
RESUME        [RESUME, lockId]        Resume (must match PAUSE lockId; unknown lockId = no-op)
TEARDOWN      [TEARDOWN]              Cleanup of current lifecycle (resubscribable nodes may re-activate per R2.2.7.a; auto-precedes COMPLETE per R2.6.4 / Lock 6.F)
COMPLETE      [COMPLETE]              Clean termination
ERROR         [ERROR, payload]        Error termination (payload MUST NOT be undefined per R1.2.5)
START         [START]                 Subscribe handshake (R1.2.3 — first message on every subscription)
```

### Appendix B — `describe()` JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["name", "nodes", "edges"],
  "properties": {
    "name": { "type": "string" },
    "nodes": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["type"],
        "properties": {
          "type": {
            "type": "string",
            "enum": ["state", "derived", "producer", "operator", "effect"]
          },
          "status": {
            "description": "Present at detail >= 'standard'. Omitted at 'minimal'.",
            "type": "string",
            "enum": ["sentinel", "pending", "dirty", "settled", "resolved", "completed", "errored"]
          },
          "value": {},
          "deps": { "type": "array", "items": { "type": "string" } },
          "meta": { "type": "object" },
          "v": {
            "description": "Optional versioning payload when node versioning enabled (§7).",
            "oneOf": [
              {
                "type": "object",
                "required": ["id", "version"],
                "properties": {
                  "id": { "type": "string" },
                  "version": { "type": "integer", "minimum": 0 }
                },
                "additionalProperties": false
              },
              {
                "type": "object",
                "required": ["id", "version", "cid", "prev"],
                "properties": {
                  "id": { "type": "string" },
                  "version": { "type": "integer", "minimum": 0 },
                  "cid": { "type": "string" },
                  "prev": { "type": ["string", "null"] }
                },
                "additionalProperties": false
              }
            ]
          }
        }
      }
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["from", "to"],
        "properties": {
          "from": { "type": "string" },
          "to": { "type": "string" }
        }
      }
    },
    "subgraphs": { "type": "array", "items": { "type": "string" } }
  }
}
```

### Appendix C — Scenario Validation

Detailed pattern recipes are in §8 (Patterns Layer). Scenario summary table:

| Scenario | Primitives |
|----------|------------|
| LLM cost control | `graph.state` (knob) → `graph.derived` → gauges via meta + cost-bubble (R8.8.N) + `withBudgetGate` (Lock 3.C) |
| Security policy | `graph.state` + `graph.derived` + `graph.effect` + PAUSE + `policyGate` |
| Human-in-the-loop | `graph.state` × 2 → `graph.derived` gate → `humanInput` (orchestration/) |
| Multi-agent routing | `Graph.mount` + `connect` (D.3) + supervisor pattern (R8.3.1.c) |
| LLM builds graph | `Graph.fromSnapshot` + `describe()` + `compileSpec` (graphspec/) |
| Git-versioned graphs | `graph.snapshot({format:"json-string"})` (R9.8) + stable JSON sort |
| Custom domain signals | Singleton `MessageTypeRegistry` (R4.4.3) + unknown-type forwarding (R1.2.2) |
| Reactive harness | Full 7-stage `harnessLoop` (R8.2) |
| Process workflow | `processManager` (R8.7) |
| Audit + rollback | Imperative-controller-with-audit (R8.6) |
| Tiered persistence | `attachSnapshotStorage` + cascading cache (R9.7, R9.9) |

### Appendix D — v0.4 Foundation Redesign Addendum

Folded into main spec sections; cross-references for traceability:

- **D.1 `errorWhenDepsError`** → R1.3.4.c, R2.5.1
- **D.2 `NodeOptions.config` and `GraphReFlyConfig` surface** → R2.6.7 + Implementation Deltas #6/#11/#14 (new config fields per Locks 2.A/6.A/2.F′)
- **D.3 `Graph.connect(from, to)`** — reactive edge, post-construction. Calls `NodeImpl._addDep(sourceNode)` on the target. Target's `_deps` array grows; source subscribed; new dep participates in wave tracking from that point. **Breaking change from prior spec:** `connect()` no longer requires the target to include the source in its constructor deps — it auto-adds. Enables pattern factories (stratify, feedback, gate, forEach) to wire nodes after creation.
- **D.4 Compat-layer two-way bridge invariant** → R8 messaging + Implementation Delta context. Three sub-invariants:

  - **Invariant I (Write paths).** All three shapes are equivalent under v0.4.0 unified dispatch waist:
    1. `n.emit(value)` — preferred.
    2. `n.down([DATA, value])` — single-tuple.
    3. `n.down([[DIRTY], [DATA, value]])` — explicit two-phase.

    `equals` cannot be bypassed by write-API choice (R1.3.2.a). Force same-value re-emission via `equals: () => false`.

  - **Invariant II (Compute paths).** Compat compute nodes MUST produce **exactly one framed outcome per wave** — either DATA (changed) or RESOLVED (unchanged). Silent no-emit leaves `dep.dirty` stuck and freezes sibling waves.

  - **Invariant III (Equality semantics).** Encoded as `NodeOptions.equals`, NOT as a side-effect of omitting emission. Jotai/Nanostores use `Object.is` → default equals. Zustand fires on every `setState` → `equals: () => false` at construction.

  - **Testability.** Conformance is testable only via:
    1. Live subscribers observing `cb` arguments + fire counts (`.cache` reads are insensitive to mid-wave glitches per Lock 1.C).
    2. Two-way bridge tests: subscribe directly to compat backing `._node` and compare DATA sequence against compat subscribe path.

  Applies to `compat/jotai/`, `compat/nanostores/`, `compat/signals/`, and any future compat layer.

### Appendix E — Verification

Two formal substrates back the protocol invariants:

- **TLA+ model** (`formal/wave_protocol.tla` in `graphrefly` repo): TLA+ model of the wave protocol covering a 4-node diamond topology. TLC exhaustive state-space exploration over small topologies produces ~77k reachable states with 0 counter-examples against 7 invariants (DIRTY-before-DATA ordering, glitch-free diamond resolution, no data loss, others).

- **Property-based harness** (`src/__tests__/properties/_invariants.ts`): fast-check harness with **registry-style `INVARIANTS` array** (~9 numbered invariants today). The registry format makes the full contract enumerable — each invariant is a named entry inspectable directly. **DS-13.5.A added invariants #54–#58** for cleanup witness, terminal classification, batch-idle checks (via `cfg.rigorRecorder` ghost-state hook).

TLC explores exhaustively at small scale; fast-check samples randomly across realistic operator compositions. Together they form the formal substrate for §1.3 and §2 invariants.

**13.6.B addition:** new locks introduce verification needs:
- Lock 2.B — dedicated TEARDOWN ordering test (load-bearing R1.3.9.d).
- Lock 6.F — Q16 idempotency test (sentinel + dirty + double-TEARDOWN cases).
- Lock 6.G — replayBuffer late-subscriber + capacity overflow + `_pauseBuffer` interaction tests.
- Lock 6.H — INVALIDATE → `"sentinel"` status verification + push-on-subscribe shape after INVALIDATE.

---

## Final summary (post-Phase 13.6.A audit)

**This canonical spec is ready for handoff to Rust port agent.** It supersedes the multi-file split (`GRAPHREFLY-SPEC.md` + 4 `COMPOSITION-GUIDE-*.md` files) for read-once handoff.

### Document set

1. **`docs/implementation-plan-13.6-canonical-spec.md`** (this file) — canonical rules + invariants + Implementation Deltas table.
2. **`docs/implementation-plan-13.6-flowcharts.md`** — 70 mermaid diagrams across 6 batches; verified against actual code with drift annotations.
3. **`docs/implementation-plan-13.6-locks-draft.md`** — audit-trail of 28 original + 11 amendment locks (39 total).
4. **`docs/implementation-plan-13.6-prep-inventory.md`** — precursor 247-rule inventory across 12 sources.

### Lock totals (post-deep-read)

- 28 original locks (Aspects 1-7 from initial audit)
- 11 amendments (post-deep-read drift findings)
- = **39 lock entries total**

### Implementation Deltas (TS reference vs canonical spec)

20 items in §10. Phase 13.6.B should sequence per the suggested batches:
1. Pure renames + spec fixes (low risk): items 1, 4, 14, 18-20
2. Code-side spec compliance (correctness): items 8, 9, 10, 11
3. Behavior flips with migration: item 3 (`ctx.store`), Lock 4.A removing shorthand
4. Net-new implementation: items 6 (equals check order + throw), 12 (Q16), 13 (replayBuffer)
5. Audit sweeps: items 15, 17

### Rust port handoff

Reads canonical-spec §1–9 + §10 Implementation Deltas + §11 Appendices + flowcharts file. Lock 4.B (rollback closure-state hazard) is provisional — revisit at port (Rust ownership may enforce structurally). Implementation Delta #18 directs Rust to **put sugars BACK in core** alongside `dynamic_node` / `auto_track_node`.

### Pre-handoff review checklist

For your final review pass, cross-check:

- **Lock 1.A** (imperative boundary) — does the abort-criteria text capture your intent precisely?
- **Lock 4.A + 4.A′** (cleanup hook reshape) — the `beforeRun → onRerun` etc. rename — confirm the new names are right.
- **Lock 6.D** (`ctx.store` flip default) — migration scope (5 operator files) is correct?
- **Lock 6.G** (`replayBuffer` implement) — should this be implemented now or marked as 1.0 stretch?
- **Lock 6.H** (INVALIDATE → `"sentinel"`) — confirm you want code to match spec (not vice versa)?
- **Implementation Delta #18** (sugars on Graph in TS, in core in Rust) — re-confirm the divergence is acceptable.

After your review, the next step is to either (a) execute the canonical edits per the dev-dispatch normal workflow (Phase 3), or (b) hand off to the Rust port agent.

