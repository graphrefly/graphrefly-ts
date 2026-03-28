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

The batch drain loop wraps each individual deferred emission in try/catch so one throwing callback does not orphan remaining emissions. The first error is captured and re-thrown after all emissions drain. `flushInProgress` ensures `isBatching()` remains true during drain, so nested `emitWithBatch` calls still defer phase-2 messages.

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

### 8. `TEARDOWN` after terminal (`COMPLETE` / `ERROR`) — full pass-through (**decision B3**)

**Decision:** The terminal gate on `down()` **does not apply** to **`TEARDOWN`**. For a non-resubscribable node that has already reached `COMPLETE` or `ERROR`, a `down` payload that includes `TEARDOWN` must still:

1. Run normal **local lifecycle** for teardown (companion meta teardown, upstream disconnect, producer stop, etc.).
2. **Forward `TEARDOWN` to downstream sinks** (filter mixed payloads to teardown-only if needed).

| | |
|--|--|
| **Rationale** | `graph.destroy()` and resource cleanup must work after a node has terminated; §5.1 control flows **through** the graph — sinks may still need `TEARDOWN` after they saw `COMPLETE`/`ERROR`. |
| **TypeScript** | If `terminal && !resubscribable`, skip the early return when the payload contains `TEARDOWN`; handle lifecycle + emit teardown to sinks. |
| **Python** | Mirror in `NodeImpl.down` (or equivalent): teardown is not swallowed after terminal. |

### 9. Batch drain: partial apply before rethrow (**decision C1**)

**Decision:** Treat **best-effort drain** as the specified behavior: run **all** queued phase-2 callbacks with **per-callback** error isolation; surface the **first** error only **after** the queue is quiescent. Callers may observe a **partially updated** graph — this is **intentional** (prefer that to orphaned deferrals or fail-fast leaving dirty state). **Document** in module docstrings / JSDoc; optional future knobs (`fail_fast`, `AggregateError`) are not required for parity.

| | |
|--|--|
| **Python** | Keep per-emission handling + `ExceptionGroup` (or first-error policy as chosen); document the partial-state contract explicitly. |
| **TypeScript** | JSDoc on `batch` / `drainPending` documents partial delivery + first error rethrown. |

### Cross-language summary

| Topic | Python | TypeScript |
|-------|--------|------------|
| Message tags | `StrEnum` | `Symbol` |
| Batch emit API | `emit_with_batch` (+ `dispatch_messages` alias) | `emitWithBatch` |
| Defer phase-2 | `defer_when`: `depth` vs `batching` | depth **or** draining (aligned with Py `batching`) |
| `isBatching` / `is_batching` | depth **or** draining | depth **or** draining |
| Batch drain resilience | per-emission try/catch, `ExceptionGroup` | per-emission try/catch, first error re-thrown |
| Nested `batch` throw + drain (**A4**) | Do **not** clear global queue while flushing | `!flushInProgress` guard before clear |
| `TEARDOWN` after terminal (**B3**) | Full lifecycle + emit to sinks | Same |
| Partial drain before rethrow (**C1**) | Document intentional | Document intentional (JSDoc) |
| Source `up` / `unsubscribe` | no-op | omitted |
| `fn` returns callable | cleanup | cleanup |
| Connect re-entrancy | `_connecting` | `connecting` (aligned) |

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
| Batch drain resilience | Built-in | Fault-tolerant drain, correct nested deferral | All batch usage |
| Production debug stripping | Potential | Smaller bundle / less branch overhead | Production builds |
| COMPLETE-all-deps semantics | Open decision | Align with spec for effect vs derived | See Open design decisions §A |
