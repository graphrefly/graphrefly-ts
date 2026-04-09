# Optimizations — Active Items (TS + PY)

> **This file is the single source of truth** for optimization tracking across both graphrefly-ts and graphrefly-py.
>
> **Resolved decisions, cross-language notes, built-in optimization docs, QA design decisions, and parity fixes have been archived to `archive/optimizations/*.jsonl`.** See `docs/docs-guidance.md` § "Optimization decision log" for the archive workflow.

---

## Active work items

- **START protocol + ROM/RAM refactor (2026-04-09 → 2026-04-10):**
  - **TS: DONE.** Full NodeImpl/DynamicNodeImpl refactor on a shared `NodeBase`.
    Added `[[START]]` handshake as a first-class protocol message (tier 0);
    shifted other tiers (DIRTY/INVALIDATE → 1, PAUSE/RESUME → 2, DATA/RESOLVED → 3,
    COMPLETE/ERROR → 4, TEARDOWN → 5). Added `"pending"` node status. Implemented
    ROM/RAM cache rule: state preserves cache across disconnect, compute nodes
    clear cache. First-run gate uses pre-set dirty mask trick — fn waits until
    every dep has delivered DATA. Reconnect re-runs fn (C2). DynamicNodeImpl
    uses rewire-buffer for lazy-dep composition: fn runs, rewire subscribes new
    deps (messages buffered), scan detects discrepancies and re-runs fn once
    (bounded by MAX_RERUN=16). Connection-time diamond glitch fix, subscribe-time
    double-delivery fix, and D2 "DIRTY→COMPLETE without DATA" unsticker all
    retained. Spec §1.2/§1.3/§2.2 updated; composition guide §1/§3 updated.
  - **PY: TODO — parity port needed.** Apply the same refactor to
    `graphrefly-py/src/graphrefly/core/node.py`, `dynamic_node.py`, `messages.py`,
    and `batch.py`. Port the `NodeBase` split + `START` message + tier shuffle +
    ROM/RAM + rewire buffer. Verify Python test suite catches the same edge
    cases (SENTINEL gate, diamond resolution, rewire stabilization).
  - **QA pass (2026-04-10):** Fixed `forwardInner` leaking START to downstream
    operators (switchMap/concatMap/exhaustMap/mergeMap now filter tier < 1);
    restored ABAC guard check in `DynamicNodeImpl.up()` (regression in refactor);
    simplified `startWith` to `derived([source], passthrough, { initial })` (no
    onMessage needed — handshake handles initial delivery); `DynamicNodeImpl`
    rewire-buffer discrepancy check now uses `_equals` instead of `Object.is`;
    all JSDoc tier numbers updated to match new 0-5 scheme; CLAUDE.md auto-checkpoint
    rule corrected to `messageTier >= 3`.

---

## Implementation anti-patterns

Cross-cutting rules for reactive/async integration (especially `patterns.ai`, LLM adapters, and tool handlers). **Keep this table identical in both repos' `docs/optimizations.md`.**

| Anti-pattern | Do this instead | Spec ref |
|--------------|-----------------|----------|
| **Polling** | Do not busy-loop on `node.get()` or use ad-hoc timers to poll for completion. Wait for protocol delivery: `subscribe` / `firstValueFrom` / `first_value_from` patterns on the node produced by `fromAny` / `from_any`. | §5.8 |
| **Imperative triggers** | Do not use event emitters, callbacks, or `setTimeout` + manual `set()` to trigger graph behavior. All coordination uses reactive `NodeInput` signals and message flow through topology. If you need a trigger, create a reactive source node. | §5.9 |
| **Raw Promises / microtasks (TS)** | Do not use bare `Promise`, `queueMicrotask`, `setTimeout`, or `process.nextTick` to schedule reactive work. Async boundaries belong in sources (`fromPromise`, `fromAsyncIter`) and the runner layer. | §5.10 |
| **Raw async primitives (PY)** | Do not use bare `asyncio.ensure_future`, `asyncio.create_task`, `threading.Timer`, or raw coroutines for reactive work. Async boundaries belong in sources (`from_awaitable`, `from_async_iter`) and the runner layer. | §5.10 |
| **Non-central time** | Do not schedule periodic work with raw `setTimeout` / `setInterval` / `time.sleep` for graph-aligned sampling. Use `fromTimer` / `from_timer` (or other documented `extra` time sources) and compose reactively. Use `monotonicNs()` / `monotonic_ns()` for event ordering, `wallClockNs()` / `wall_clock_ns()` for attribution. | §5.11 |
| **Hardcoded message type checks** | Do not hardcode `if (type === DATA)` for checkpoint or batch gating. Use `messageTier` / `message_tier` utilities for tier classification. | §5.11 |
| **Bypassing `fromAny` / `from_any` for async** | Do not one-off `asyncio.run`, bare `.then` chains, or manual thread sleeps to bridge coroutines / async iterables / Promises into the graph. Route unknown shapes through `fromAny` / `from_any` so `DATA` / `ERROR` / `COMPLETE` stay consistent end-to-end. | §5.10 |
| **Leaking protocol internals in Phase 4+ APIs** | Domain-layer APIs (orchestration, messaging, memory, AI, CQRS) must never expose `DIRTY`, `RESOLVED`, bitmask, or settlement internals in their primary surface. Use domain language. Protocol access available via `.node()` or `inner`. | §5.12 |
| **`Node` resolution without `get()`** | When blocking until first `DATA`, prefer `node.get()` when it already holds a settled value, then subscribe only if still pending — avoids hangs when the node does not replay `DATA` to new subscribers. | — |
| **Passing plain strings through `fromAny` (TypeScript)** | `fromAny` treats strings as iterables (one `DATA` per character). For tool handlers that return plain strings, return the string directly; use `fromAny` only for `Node` / `AsyncIterable` / Promise-like after await. | — |

- **`ObserveResult.completedCleanly` ambiguous in graph-wide mode (noted 2026-04-08):**
  In graph-wide observation (`graph.observe()` without a path), `completedCleanly` is set to `true` when **any** node sends COMPLETE without prior ERROR. If a different node later sends ERROR, `errored` becomes `true` but `completedCleanly` is never reset — both flags are `true` simultaneously. Single-node observation is unaffected (terminal rules prevent both). **Why:** `completedCleanly` and `errored` are additive per-node aggregates, but the names read as mutually exclusive graph-level state. **Options:** (A) rename to `anyCompletedCleanly` / `anyErrored` to match additive semantics; (B) add `allCompletedCleanly` (every observed node completed without error); (C) reset `completedCleanly = false` on any ERROR (makes them exclusive but loses info). Applies to both TS and PY `ObserveResult`.

---

## Deferred follow-ups

Non-blocking items tracked for later. **Keep this section identical in both repos' `docs/optimizations.md`** (aside from language-specific labels).

| Item | Notes |
|------|-------|
| **`lastDepValues` + `Object.is` / referential equality (resolved 2026-03-31 — documented)** | Default `Object.is` identity check is correct for the common immutable-value case. The `node({ equals })` option already exists for custom comparison. Mutable dep values should use a custom `equals` function. **Documented in `node()` JSDoc (2026-04-07).** |
| **`sideEffects: false` in `package.json`** | Already present. Safe while the library has no import-time side effects. Revisit if global registration or polyfills are added at module load. |
| **`DynamicNodeImpl` identity-skip false positive on dep reorder (TS + PY)** | After `_rewire` / `_rewire`, `_trackedValues` is indexed by the *previous* fn run's dep order, but `_deps` holds the *new* order. If deps are reordered (same deps, different positions), index mismatch triggers a false "values differ" detection and an unnecessary `_runFn` re-run. No data corruption (same inputs produce same output), but wastes a compute cycle. **Fix:** track dep values by node identity (`Map<Node, unknown>` / `dict[Node, Any]`) instead of positional index. Applies to both TS `dynamic-node.ts` and PY `dynamic_node.py`. |
| **JSDoc / docstrings on `node()` and public APIs** | `docs/docs-guidance.md`: JSDoc on new TS exports; docstrings on new Python public APIs. `node()` equals guidance added (2026-04-07). `mergeMap` ERROR behavior documented (2026-04-07). `fromRedisStream` COMPLETE/disconnect documented (2026-04-07). |
| **Roadmap §0.3 checkboxes** | Mark Phase 0.3 items when the team agrees the milestone is complete. |

### Factory teardown — `dispose()` pattern (D1/D2, noted 2026-04-07)

| Item | Status | Notes |
|------|--------|-------|
| **Phase 4+ factories don't register internal nodes on the graph** | **DONE (TS + PY, 2026-04-07)** | Added `Graph.addDisposer(fn)` / `Graph.add_disposer(fn)` — general-purpose disposer registration drained on `destroy()` **before** TEARDOWN signal. TS: Fixed `harnessLoop`, `strategyModel`, `agentMemory`, `feedback`, `gate`, `contentModerationGraph`, `funnel` bridge, `ChatStreamGraph`, `ToolRegistryGraph`. PY: Fixed `harness_loop`, `reduction.py`, `ChatStreamGraph`, `ToolRegistryGraph`, `AgentMemoryGraph`. Dead `_version` counter removed from all reactive bundles (TS + PY). |

### AI surface (Phase 4.4) — deferred optimizations

| Item | Status | Notes |
|------|--------|-------|
| **Re-indexes entire store on every change** | Deferred | Decision: diff-based indexing using internal version counter to track indexed entries. Deferred to after Phase 6 — current N is small enough that full re-index is acceptable pre-1.0. |
| **Budget packing always includes first item** | Documented behavior | The retrieval budget packer always includes the first ranked result even if it exceeds `maxTokens`. This is intentional "never return empty" semantics — a query that matches at least one entry always returns something. Callers who need strict budget enforcement should post-filter. |
| **Retrieval pipeline auto-wires when vectors/KG enabled** | Documented behavior | When `embedFn` or `enableKnowledgeGraph` is set, the retrieval pipeline automatically wires vector search and KG expansion into the retrieval derived node. There is no explicit opt-in/opt-out per retrieval stage — the presence of the capability implies its use. Callers who need selective retrieval should use the individual nodes directly. |

### Tier 2 extra operators — deferred semantics

| Item | Status | Notes |
|------|--------|-------|
| **`mergeMap` / `merge_map` + `ERROR`** | **Documented (TS JSDoc, 2026-04-07)** | Inner errors propagate downstream but do not cancel sibling inners. Outer ERROR cancels all inners. Current behavior is intentional for parallel work. **Documented in `mergeMap` JSDoc.** PY: add matching docstring. |

### Ingest adapters — deferred items

| Item | Status | Notes |
|------|--------|-------|
| **`fromRedisStream` / `from_redis_stream` never emits COMPLETE** | **Documented (TS JSDoc, 2026-04-07)** | Long-lived stream consumers intentionally never complete. **Documented in `fromRedisStream` JSDoc.** PY: add matching docstring. |
| **`fromRedisStream` / `from_redis_stream` does not disconnect client** | **Documented (TS JSDoc, 2026-04-07)** | The caller owns the Redis client lifecycle. **Documented in `fromRedisStream` JSDoc.** PY: add matching docstring. |
| **PY `from_csv` / `from_ndjson` thread not joined on cleanup** | Documented limitation (2026-04-03) | Python file-ingest adapters run in a daemon thread. On teardown, `active[0] = False` signals the thread to exit but does not `join()` it. The daemon flag ensures the thread does not block process exit. A future optimization could add optional `join(timeout)` on cleanup for stricter resource control. |

### Intentional cross-language divergences

Archived to `archive/optimizations/cross-language-notes.jsonl` (entries with `id` prefix `divergence-`). The `/parity` and `/qa` skills read the archive to avoid re-raising confirmed divergences.
