# Optimizations

`graphrefly-ts` currently prioritizes protocol correctness and phase-by-phase feature delivery. This document tracks built-in optimizations and concrete optimization opportunities in a format similar to callbag-recharge.

---

## Built-in optimizations

These are implemented in the current codebase.

### 1. Output slot model (`null -> single sink -> Set`)

Node subscriptions use a tiered storage model instead of eagerly allocating a `Set`:

- `null` when no downstream subscribers
- a single callback reference for one subscriber
- a `Set` only when fan-out exceeds one subscriber

This avoids unnecessary allocations in the common 0-1 subscriber case.

### 2. Batch phase split (`DIRTY` immediate, `DATA`/`RESOLVED` deferred)

`core.batch()` and `core.emitWithBatch()` preserve two-phase semantics while reducing redundant downstream work during grouped updates:

- non-phase-2 messages propagate immediately
- phase-2 messages flush once at outermost batch completion
- nested batch scopes share one deferred queue

### 3. Diamond settlement via integer bitmask

Nodes with multiple dependencies use integer bitmasks to track dirty/settled dependency state in each wave:

- `DIRTY` marks dependency bits
- `DATA`/`RESOLVED` settle bits
- recompute runs once when all dirty bits are settled

This gives glitch-free behavior with low overhead.

### 4. Lazy upstream connect/disconnect

Dependency subscriptions are attached on first downstream subscriber and released when the last downstream subscriber unsubscribes.

This keeps disconnected nodes lightweight while preserving cached values.

### 5. Single-dependency DIRTY skip

When a node has exactly one subscriber that is a single-dep node (detected via `subscribe(sink, { singleDep: true })`), DIRTY is filtered from emissions to sinks. The subscriber synthesizes dirty state locally. This halves inter-node dispatch calls in linear single-dep chains. Automatically disabled when fan-out occurs (second subscriber connects).

### 6. `>32` dependency segmented bitmask

Dirty/settled/completion tracking uses a `BitSet` abstraction: integer masks for ≤31 deps, segmented `Uint32Array` masks for >31 deps. Preserves O(1)-ish "all settled" checks at any fan-in width.

### 7. Connect-order guard (`connecting`)

While subscribing upstream deps, `runFn` is suppressed for re-entrant dep emissions until **all** deps are wired, then one explicit `runFn` runs. Prevents `dep.get()` returning `undefined` mid-connect when an earlier dep emits immediately on subscribe. Mirrors Python's `_connecting` flag (see cross-language §6).

### 8. Batch drain resilience

The batch drain loop wraps each individual deferred emission in try/catch so one throwing callback does not orphan remaining emissions. The first error is captured and re-thrown after all emissions drain. `flushInProgress` ensures `isBatching()` remains true during drain, so nested `emitWithBatch` calls still defer phase-2 messages. A cycle-detection cap (`MAX_DRAIN_ITERATIONS = 1000`) prevents infinite loops when reactive cycles occur during drain.

### 9. Sink snapshot during delivery

`emitToSinks` snapshots the sink set before iterating. If a sink callback unsubscribes itself or another sink mid-delivery, all sinks present at delivery start still receive the message. Prevents the classic reactive-library bug where `Set` mutation during `for...of` skips not-yet-visited entries.

### 10. DIRTY→COMPLETE settlement

When a dep goes DIRTY then COMPLETE without intermediate DATA/RESOLVED, the node would be stuck in `"dirty"` status indefinitely. The COMPLETE handler now detects `!depDirtyMask.any() && status === "dirty"` and triggers `runFn()` to settle (typically emitting RESOLVED since dep values are unchanged).

---

## Cross-language implementation notes

**Keep this section in sync with `graphrefly-py/docs/optimizations.md` § Cross-language implementation notes** so you can open both files side by side.

### 1. Message type wire encoding

| | |
|--|--|
| **Python** | `StrEnum` string tags (`"DATA"`, …) — JSON/interop friendly. |
| **TypeScript** | `Symbol.for("graphrefly/…")` — avoids string collisions. |

Same logical protocol; encoding differs by language.

### 2. Unified batch delivery (`emit_with_batch` / `emitWithBatch`)

| | |
|--|--|
| **Python** | One implementation: `emit_with_batch(sink, messages, *, strategy=..., defer_when=...)`. `dispatch_messages(messages, sink)` is a thin alias for sequential delivery with `defer_when="batching"`. Node uses `strategy="partition"`, `defer_when="depth"`. |
| **TypeScript** | `emitWithBatch` matches Python **`partition` + `defer_when="depth"`** (defer only while `batchDepth > 0`). There is no separate sequential/terminal-interleaved mode in TS today. |

### 3. What “batching” means (`is_batching` / `isBatching`)

| | |
|--|--|
| **Python** | `is_batching()` is true while inside `batch()` **or** while deferred phase-2 work is draining (`flush_in_progress`). The **`defer_when=”batching”`** path defers DATA/RESOLVED in both cases — needed for nested-batch-inside-drain QA (same lesson as `callbag-recharge-py` batch + defer ordering). |
| **TypeScript** | `isBatching()` is true while `batchDepth > 0` **or** while `flushInProgress` (draining deferred work). Aligned with Python semantics. |

Both languages now defer phase-2 messages during the drain loop, preventing ordering issues when deferred callbacks trigger further emissions.

**Nested-batch error + drain:** see §7 — do not clear the global phase-2 queue on a nested `batch` throw while the outer drain is active.

### 4. `up` / `unsubscribe` on source nodes

| | |
|--|--|
| **Spec** | Source nodes have no upstream. |
| **TypeScript** | `up` / `unsubscribe` are absent on sources (`?` optional on the type). |
| **Python** | Same methods exist but are **no-ops** when there are no deps (single concrete type / ergonomics). |

### 5. Cleanup vs return value from `fn` (callable detection)

Both ports treat “`fn` returned a callable” as a **cleanup** (TS: `typeof out === "function"`). Returning a non-cleanup callable as a normal computed value remains ambiguous in both.

### 6. Re-entrant recompute while wiring upstream (multi-dep connect)

| | |
|--|--|
| **Python** | `_connecting` flag around the upstream `subscribe` loop: `run_fn` is not run from dep-driven handlers until wiring finishes, then one explicit `run_fn`. Fixes ordering where the first dep emits before the second subscription is installed (`dep.get()` still `None`). |
| **TypeScript** | `connecting` flag mirrors Python's `_connecting`. `runFn` bails early while `connecting` is true; the flag is set/cleared with try/finally around the subscribe loop. One explicit `runFn()` runs after all deps are wired. Root cause class matches lessons from **`callbag-recharge-py`** connect/batch ordering. |

### 7. Nested `batch` throw while draining — queue ownership (**decision A4**)

**Decision:** When a nested `batch()` exits with an error and `batchDepth` returns to **0** while deferred phase-2 work is **still draining** (`flushInProgress` / `flush_in_progress`), implementations **must not** discard the **global** pending phase-2 backlog. Only clear that backlog for a `batch` frame that owns it **outside** an in-flight outer drain.

| | |
|--|--|
| **Rationale** | A `batch(() => …)` invoked from inside a drain callback must not wipe deferrals registered by the outer batch pass (ordering bug + lost `DATA`/`RESOLVED`). |
| **TypeScript** | In the `batchDepth === 0 && threw` branch: run `pendingPhase2.length = 0` **only if** `!flushInProgress`. |
| **Python** | Same invariant: never clear the process-global phase-2 queue solely because a nested `batch` failed while the outer drain is active. |

### 8. Concurrency model (**Python vs TypeScript**)

| | |
|--|--|
| **Python** | Per-subgraph `RLock` + union-find registry (weak-ref cleanup), TLS `defer_set` / `defer_down`, `emit_with_batch(..., subgraph_lock=node)` for batch drains, and a per-node `threading.Lock` on `_cached` so `get()` is safe under free-threaded Python without taking the subgraph write lock (roadmap 0.4). |
| **TypeScript** | Single-threaded assumption per GRAPHREFLY-SPEC §6.1; no subgraph lock layer in core today. |

### 9. `TEARDOWN` / `INVALIDATE` after terminal (`COMPLETE` / `ERROR`) — pass-through (**decision B3**)

**Decision:** The terminal gate on `down()` **does not apply** to **`TEARDOWN`** or **`INVALIDATE`**. For a non-resubscribable node that has already reached `COMPLETE` or `ERROR`, filter the incoming batch to **only** `TEARDOWN` and/or `INVALIDATE` tuples (drop co-delivered `DATA`, etc.); then:

1. Run **local lifecycle** for those tuples (`TEARDOWN`: meta, upstream disconnect, producer stop, etc.; `INVALIDATE`: cache clear, dep memo clear, optional `fn` cleanup — see §12).
2. **Forward the filtered tuples to downstream sinks**.

| | |
|--|--|
| **Rationale** | Same control-plane pattern as B3: `graph.destroy()` and post-terminal cache/UI invalidation must not be swallowed after `COMPLETE`/`ERROR`. |
| **TypeScript** | If `terminal && !resubscribable`, filter to `TEARDOWN` or `INVALIDATE` tuples only before early return. |
| **Python** | `NodeImpl.down`: `terminal_passthrough` = `TEARDOWN` or `INVALIDATE` only. |

### 10. Batch drain: partial apply before rethrow (**decision C1**)

**Decision:** Treat **best-effort drain** as the specified behavior: run **all** queued phase-2 callbacks with **per-callback** error isolation; surface the **first** error only **after** the queue is quiescent. Callers may observe a **partially updated** graph — this is **intentional** (prefer that to orphaned deferrals or fail-fast leaving dirty state). **Document** in module docstrings / JSDoc; optional future knobs (`fail_fast`, `AggregateError`) are not required for parity.

| | |
|--|--|
| **Python** | Keep per-emission handling + `ExceptionGroup` (or first-error policy as chosen); document the partial-state contract explicitly. |
| **TypeScript** | JSDoc on `batch` / `drainPending` documents partial delivery + first error rethrown. |

### 11. `describe_node` / `describeNode` and read-only `meta`

| | |
|--|--|
| **Python** | `describe_node(n)` reads `NodeImpl` internals; `node.meta` is `MappingProxyType` (read-only mapping of companion nodes). |
| **TypeScript** | `describeNode(n)` uses `instanceof NodeImpl` to read class fields directly; `node.meta` is `Object.freeze({...})`. |
| **Shared** | `meta_snapshot` / `metaSnapshot` omit keys when a companion `get()` throws; same best-effort `type` inference for GRAPHREFLY-SPEC Appendix B describe entries (full `graph.describe()` remains Phase 1). |

### 12. `INVALIDATE` local lifecycle (**GRAPHREFLY-SPEC §1.2**)

**Decision:** On `INVALIDATE`, if the node has a registered **`fn` cleanup** (callable returned from `fn`), **run it once** and clear the registration; then clear the cached output (`_cached` / `_cached = undefined`) and drop the dep-value memo (`_last_dep_values` / `_lastDepValues`) so the next settlement cannot skip `fn` purely via unchanged dep identity. Do not schedule `fn` from the `INVALIDATE` handler itself (“don’t auto-emit”). **`INVALIDATE` also passes the post-terminal gate** together with `TEARDOWN` (§9).

| | |
|--|--|
| **Python** | `NodeImpl._handle_local_lifecycle` |
| **TypeScript** | `NodeImpl._handleLocalLifecycle` |

### 13. `Graph` Phase 1.1 (registry + edges)

| | |
|--|--|
| **Shared** | `connect` validates that the target node’s dependency list includes the source node (**reference identity**). Edges are **pure wires** (no transforms). `connect` is **idempotent** for the same `(from, to)` pair. |
| **disconnect** | Both ports **throw** if the edge was not registered. Dropping an edge does **not** remove constructor-time deps on the node (registry / future `describe()`). **See Open design decisions §C** (QA 1d #2). |
| **remove** | Unregisters the node, drops incident edges, sends **`[[TEARDOWN]]`** to that node. |
| **Python** | `Graph(..., {"thread_safe": True})` (default): registry uses an `RLock`; **`down([[TEARDOWN]])` runs after the lock is released** on `remove`. |
| **TypeScript** | No graph-level lock (single-threaded spec). |

### Cross-language summary

| Topic | Python | TypeScript |
|-------|--------|------------|
| Core sugar `subscribe(dep, fn)` / `operator` | Not exported: use `node([dep], fn)`, `effect([dep], fn)`, `derived` (same sugar surface as here) | Not exported: use `node([dep], fn)`, `effect([dep], fn)`, and `derived` for all deps+fn nodes |
| `pipe` and `Node.__or__` | `pipe()` plus `|` on nodes (GRAPHREFLY-SPEC §6.1) | `pipe()` only |
| Message tags | `StrEnum` | `Symbol` |
| Subgraph write locks | Union-find + `RLock`; `defer_set` / `defer_down`; per-node `_cache_lock` for `get()`/`_cached` | N/A (single-threaded) |
| Batch emit API | `emit_with_batch` (+ `dispatch_messages` alias); optional `subgraph_lock` for node emissions | `emitWithBatch` |
| Defer phase-2 | `defer_when`: `depth` vs `batching` | depth **or** draining (aligned with Py `batching`) |
| `isBatching` / `is_batching` | depth **or** draining | depth **or** draining |
| Batch drain resilience | per-emission try/catch, `ExceptionGroup` | per-emission try/catch, first error re-thrown |
| Nested `batch` throw + drain (**A4**) | Do **not** clear global queue while flushing | `!flushInProgress` guard before clear |
| `TEARDOWN` / `INVALIDATE` after terminal (**B3**) | Filter + full lifecycle + emit to sinks | Same |
| Partial drain before rethrow (**C1**) | Document intentional | Document intentional (JSDoc) |
| Source `up` / `unsubscribe` | no-op | no-op (always present for V8 shape stability) |
| `fn` returns callable | cleanup | cleanup |
| Connect re-entrancy | `_connecting` | `_connecting` (aligned) |
| Sink snapshot during delivery | `list(self._sinks)` snapshot before iterating | `[...this._sinks]` snapshot before iterating |
| Drain cycle detection | TBD | `MAX_DRAIN_ITERATIONS = 1000` cap |
| TEARDOWN → `"disconnected"` status | `_status_after_message` maps TEARDOWN | `statusAfterMessage` maps TEARDOWN |
| DIRTY→COMPLETE settlement (D2) | `_run_fn()` when no dirty deps remain but node is dirty | `_runFn()` when no dirty deps remain but node is dirty |
| Describe slice + frozen meta | `describe_node`, `MappingProxyType` | `describeNode` via `instanceof NodeImpl`, `Object.freeze(meta)` |
| Node internals | Class-based `NodeImpl`, all methods on class | Class-based `NodeImpl`, V8 hidden class optimization, prototype methods |
| Dep-value identity check | Before cleanup (skip cleanup+fn on no-op) | Before cleanup (skip cleanup+fn on no-op) |
| `INVALIDATE` (§1.2) | Cleanup + clear `_cached` + `_last_dep_values`; terminal passthrough (§9); no auto recompute | Same |
| `Graph` Phase 1.1 | `thread_safe` + `RLock`; TEARDOWN after unlock on `remove`; `disconnect` vs `_deps` → §C | Registry only; `connect` / `disconnect` errors aligned; see §C |

### Open design items (low priority)

1. **`_is_cleanup_fn` / `isCleanupFn` treats any callable return as cleanup.** Both languages use `callable(value)` / `typeof value === "function"`. A compute function cannot emit a callable as a data value — it will be silently swallowed as cleanup. Fix: accept `{ cleanup: fn }` wrapper or add an opt-out flag. Low priority because the pattern is well-documented and rarely needed.

2. **`inferDescribeType` cannot distinguish effect/passthrough/pre-run-operator from `"derived"`.** Type inference relies on `_manualEmitUsed` (runtime), so an operator that hasn't run yet reports `"derived"`. Fix: sugar constructors (`effect()`, `operator()`) set an `_explicitKind` field on `NodeImpl`. Low priority until Graph.describe() is implemented (Phase 1).

---

## Potential optimizations

These are not yet implemented, but are concrete and compatible with the current protocol.

### 1. (moved to built-in §5)

**Status:** Built-in
**Impact:** Medium-high in single-dep hot paths

When a node has exactly one subscriber and that subscriber declares itself as single-dep (via `subscribe(sink, { singleDep: true })`), the node filters DIRTY from emissions to sinks. The subscriber synthesizes dirty state locally via `onDepSettled → onDepDirty` when DATA arrives without prior DIRTY.

**Safety:** The optimization only activates when `sinkCount === 1 && singleDepSinkCount === 1`. With a single subscriber, no diamond can form from this node. When a second subscriber connects, the count increases and the optimization disables automatically. When it drops back to one single-dep subscriber, it re-engages.

**How it works (inspired by callbag-recharge):**

- `subscribe(sink, { singleDep: true })` — subscriber hints that it has exactly one dep with `fn`
- Source tracks `singleDepSinkCount`; when sole subscriber is single-dep, DIRTY is filtered from `down()` emissions to sinks (local status still updates via `handleLocalLifecycle`)
- Consumer's `onDepSettled` already calls `onDepDirty` when DATA arrives without prior dirty bit — this synthesizes DIRTY locally before recomputing

### 2. >32 dependency fallback for bitmask tracking

**Status:** Built-in
**Impact:** Medium for high-fan-in nodes

Dirty/settled/completion tracking uses a `BitSet` abstraction: integer masks for ≤31 deps, segmented `Uint32Array` masks for >31 deps. Preserves O(1)-ish "all settled" checks at any fan-in width.

### 3. Optional production-time debug stripping

**Status:** Not implemented  
**Impact:** Low-medium (bundle + minor runtime)  
**Priority:** Low

As observability/debug hooks are added, a build-time stripped entry point could remove debug-only branches for production.

---

## Open design decisions (needs product/spec call)

These came out of QA review; behavior is **not** “wrong” until aligned with `docs/GRAPHREFLY-SPEC.md` and roadmap intent.

### A. `COMPLETE` when all dependencies complete

**Current behavior:** A node with dependencies and a compute `fn` may emit `[[COMPLETE]]` when **every** upstream dependency has emitted `COMPLETE`.

**Spec note:** `GRAPHREFLY-SPEC.md` §1.3.5 states that **effect** nodes complete when all deps complete — it does not necessarily require the same rule for derived/operator-style nodes.

**Decision needed:** Should auto-completion apply only to side-effect nodes (`fn` returns nothing), always, never, or behind an explicit option (e.g. `completeWhenDepsComplete`)?

### B. More than 31 dependencies

**Resolved.** Bitmask tracking now uses a `BitSet` abstraction that falls back to segmented `Uint32Array` for >31 deps (see Built-in §5 / Potential §2).

### C. `graph.disconnect` vs `NodeImpl` dependency lists (QA 1d #2)

**Current behavior:** Phase 1.1 `Graph.disconnect(from, to)` removes the `(from, to)` pair from the graph’s **edge registry** only. It does **not** mutate the target node’s constructor-time dependency list (`NodeImpl._deps` in Python; the fixed deps array inside `NodeImpl` in TypeScript). Upstream/downstream **message wiring** tied to those deps is unchanged.

**Why:** Dependencies are fixed when the node is created. True single-edge removal would require core APIs (partial upstream unsubscribe, bitmask width and diamond invariants, thread-safety on the Python side, etc.).

**Decision needed:** Is registry-only `disconnect` the long-term contract (documentation + `describe()` as source of truth), or should a later phase add **dynamic topology** so `disconnect` (or a new API) actually detaches one dep? Align with `GRAPHREFLY-SPEC.md` §3.3 when the spec is tightened.

---

## Deferred follow-ups (QA)

Non-blocking items tracked for later; not optimizations per se.

| Item | Notes |
|------|--------|
| **`lastDepValues` + `Object.is`** | Skips `fn` when dep snapshots are referentially equal. Fine for immutable values; misleading if deps are mutated in place. |
| **`sideEffects: false` in `package.json`** | Safe while the library has no import-time side effects. Revisit if global registration or polyfills are added at module load. |
| **JSDoc on `node()` / public types** | `docs/docs-guidance.md`: add JSDoc on new public exports. |
| **Roadmap §0.3 checkboxes** | Mark Phase 0.3 items when the team agrees the milestone is complete. |

---

## Summary

| Optimization | Status | Impact | When to use |
|---|---|---|---|
| Output slot (`null -> fn -> Set`) | Built-in | Lower memory in common fan-out case | All node subscriptions |
| Batch phase split | Built-in | Coalesced phase-2 propagation | Multi-write updates |
| Diamond bitmask settlement | Built-in | Single recompute per settled wave | Multi-dep/diamond topologies |
| Lazy upstream connect/disconnect | Built-in | Lower idle overhead | Intermittently observed nodes |
| >32 dep segmented bitmask | Built-in | Scales fan-in tracking | High-fan-in compute nodes |
| `completeWhenDepsComplete` opt-out | Built-in | Configurable auto-COMPLETE | Derived/operator nodes that should not auto-complete |
| Single-dep DIRTY skip | Built-in | Fewer dispatches in hot chains | Single-dep linear chains (auto-detected via subscribe hint) |
| Connect-order guard | Built-in | Correct multi-dep initial compute | Multi-dep nodes with eager-emit deps |
| Batch drain resilience | Built-in | Fault-tolerant drain, correct nested deferral, cycle detection | All batch usage |
| Sink snapshot during delivery | Built-in | Correct delivery when sinks mutate mid-iteration | Multi-subscriber nodes |
| DIRTY→COMPLETE settlement | Built-in | Prevents stuck dirty status | Multi-dep nodes where a dep completes without settling |
| Production debug stripping | Potential | Smaller bundle / less branch overhead | Production builds |
| COMPLETE-all-deps semantics | Open decision | Align with spec for effect vs derived | See Open design decisions §A |
| `graph.disconnect` vs `NodeImpl` deps | Open decision | Registry-only vs dynamic topology | See Open design decisions §C |
