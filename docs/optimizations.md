# Optimizations — Active Items

> **Resolved decisions, cross-language notes, built-in optimization docs, QA design decisions, and parity fixes have been archived to `archive/optimizations/*.jsonl`.** See `docs/docs-guidance.md` § "Optimization decision log" for the archive workflow.

---

## Active work items

- **PY `ReactiveMapBundle` parity — `.get(key)`, `.has(key)`, `.size` (noted 2026-04-07):**
  - **Level A: DONE (2026-04-07).** Added `.get(key)`, `.has(key)`, `.size` to PY `ReactiveMapBundle` matching TS signatures. PY harness `strategy.py` updated to use `.get(key)` instead of Versioned navigation.
  - **Level B: DONE (TS, 2026-04-07; PY, 2026-04-07).** Removed `Versioned` wrapper from all reactive bundle APIs (ReactiveMap, ReactiveLog, ReactiveList, ReactiveIndex). `.node` / `.entries` / `.items` / `.ordered` now emit unwrapped domain types (`ReadonlyMap<K,V>`, `readonly T[]`, etc.). Internal version counter drives efficient equality without leaking into composition code (spec §5.12). All downstream consumers updated (messaging, cqrs, ai, domain-templates, composite, nestjs/compat).

- **Whole-repo `emit` → `down` audit + `up` / backpressure / `message_tier` sweep (all phases, noted 2026-04-07):**
  - **TS: DONE (2026-04-07).** Renames: `emitWithBatch` → `downWithBatch`, `_emitToSinks` → `_downToSinks`, `_emitAutoValue` → `_downAutoValue`, `_boundEmitToSinks` → `_boundDownToSinks`, `_emitSequential` → `_downSequential`, `emitLine` → `flushLine` (reactive-layout). Batch param `emit` → `sink`. `up()` audit: no asymmetries found — all operators/sources correctly forward or inherit. `messageTier()` audit: already clean, zero hardcoded type checks. `NodeActions.emit()` kept (different semantics from `actions.down()`). CQRS `CommandActions.emit()` kept (domain concept). Spec updated (`_emitAutoValue` → `_downAutoValue`).
  - **PY: DONE (2026-04-07).** Renames: `emit_with_batch` → `down_with_batch`, `_emit_to_sinks` → `_down_to_sinks`, `_emit_auto_value` → `_down_auto_value`, `_emit_partition` → `_down_partition`, `_emit_sequential` → `_down_sequential`, `EmitStrategy` → `DownStrategy`, `emit_line` → `flush_line` (reactive-layout), internal closures renamed. `up()` audit: no asymmetries. `message_tier()` audit: already clean. `NodeActions.emit()` kept. CQRS `CommandActions.emit()` kept. `_manual_emit_used` / `_manual_emit` kept.
  Pre-1.0, no backward compat concern on any rename.

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

---

## Deferred follow-ups

Non-blocking items tracked for later. **Keep this section identical in both repos' `docs/optimizations.md`** (aside from language-specific labels).

| Item | Notes |
|------|-------|
| **`lastDepValues` + `Object.is` / referential equality (resolved 2026-03-31 — documented)** | Default `Object.is` identity check is correct for the common immutable-value case. The `node({ equals })` option already exists for custom comparison. Mutable dep values should use a custom `equals` function. **Documented in `node()` JSDoc (2026-04-07).** |
| **`sideEffects: false` in `package.json`** | Already present. Safe while the library has no import-time side effects. Revisit if global registration or polyfills are added at module load. |
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
