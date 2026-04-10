# Optimizations — Active Items (TS + PY)

> **This file is the single source of truth** for optimization tracking across both graphrefly-ts and graphrefly-py.
>
> **Resolved decisions, cross-language notes, built-in optimization docs, QA design decisions, and parity fixes have been archived to `archive/optimizations/*.jsonl`.** See `docs/docs-guidance.md` § "Optimization decision log" for the archive workflow.

---

## Active work items

- **Per-node resource tracking / subscriber audit (proposed):**
  `graph.resourceProfile()` / `graph.resource_profile()` — snapshot-based walk of all nodes: per-node stats (subscriber count, cache state, activation count) + aggregate memory estimate. Detects orphan effects (`_sinkCount === 0` / `_sink_count == 0` on effect nodes), unbounded log growth. Reactive DevTools direction — inspection-as-test-harness.

- **Shared test helpers: refactor remaining PY `sink.append` sites (2026-04-09):**
  Unified `collect(node, *, flat=False, raw=False)` helper shipped in both TS and PY. ~127 `sink.append` sites in PY tests (`test_extra_tier1.py`, `test_extra_tier2.py`, `test_edge_cases.py`, etc.) remain to be migrated. Custom extraction (type-only, value-only, filtered) stays inline. See `docs/test-guidance.md` § "Shared test helpers".

- ~~**PY blocking-bridge deadlock: `_resolve_node_input` + `AsyncioRunner` (2026-04-09):**~~ — **RESOLVED.** All call sites now use `_has_event_loop_runner()` guard + `_async_resolve_node_input()` non-blocking path. Archive candidate.

- **Stream extractor unbounded re-scan on every chunk (2026-04-09):**
  All stream extractors (`keywordFlagExtractor`, `toolCallExtractor`, `costMeterExtractor`, and generic `streamExtractor`) re-process the entire `accumulated` string from scratch on every `StreamChunk`. For long streams this is O(n×k) total work (n = final length, k = chunk count). `toolCallExtractor`'s brace-scanning is especially expensive. Optimization: maintain a cursor/offset between invocations so each chunk only processes the delta. Deferred — acceptable pre-1.0 where streams are short (LLM output typically <10K chars).

- **Stream extractor redundant emissions on identical chunks (2026-04-09):**
  If two consecutive `StreamChunk`s produce identical extracted results (e.g., same keyword flags), the extractor still re-emits a new array/object instance. Downstream subscribers miss memoization opportunities. Optimization: pass a structural `equals` function to the `derived` node options to suppress redundant emissions via `RESOLVED`. Deferred — identical consecutive chunks are rare in practice (accumulated text grows monotonically).

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
| **`DynamicNodeImpl` identity-skip false positive on dep reorder** | **Resolved (TS 2026-04-09).** TS `_trackedValues` is `Map<Node, unknown>` (identity-based). PY `dynamic_node.py` doesn't have `_tracked_values` — no action needed unless PY adds the rewire buffer. |

- **Missing `meta=_ai_meta(...)` on stream extractor `derived()` calls (TS + PY, 2026-04-09):**
  All four extractor factories (`streamExtractor`/`stream_extractor`, `keywordFlagExtractor`/`keyword_flag_extractor`, `toolCallExtractor`/`tool_call_extractor`, `costMeterExtractor`/`cost_meter_extractor`) create `derived` nodes without `meta` tags. Every other AI-layer node carries `_ai_meta(...)`. Extractor nodes will not appear in AI-layer catalog scans or harness introspection that filters on `meta.ai`. Fix: add `meta=_ai_meta("stream_extractor")` etc. to each `derived()` call in both TS and PY.

- **`EffectivenessTrackerBundle.record()` thread safety (PY, 2026-04-10):**
  `record()` does read-modify-write on `self._map` (get → compute → set) without a lock. Under free-threaded Python (no GIL), two concurrent `record()` calls for the same key can race: both read the same existing entry, both compute `attempts+1`, and one write overwrites the other. Same pattern exists in other pattern-layer factories (e.g. `strategyModel`). Should be addressed with a per-bundle `RLock`, consistent with the project's threading policy ("per-subgraph `RLock`, per-node `_cache_lock`"). Deferred — all current callers are single-threaded; needs systematic pattern-layer lock audit.

- **`_async_pump` return annotation is `AsyncIterable` not `AsyncGenerator` (PY, 2026-04-09):**
  In `streaming_prompt_node`, the inner `_async_pump` function uses `yield` (making it an `AsyncGenerator`) but is annotated `-> AsyncIterable[Any]`. No runtime impact (`AsyncGenerator` is a subtype of `AsyncIterable`), but the annotation is technically incorrect. Fix: change to `-> AsyncGenerator[Any, None]`.

### AI surface (Phase 4.4) — deferred optimizations

| Item | Status | Notes |
|------|--------|-------|
| **Re-indexes entire store on every change** | Deferred | Decision: diff-based indexing using internal version counter to track indexed entries. Deferred to after Phase 6 — current N is small enough that full re-index is acceptable pre-1.0. |
| **Budget packing always includes first item** | Documented behavior | The retrieval budget packer always includes the first ranked result even if it exceeds `maxTokens`. This is intentional "never return empty" semantics — a query that matches at least one entry always returns something. Callers who need strict budget enforcement should post-filter. |
| **Retrieval pipeline auto-wires when vectors/KG enabled** | Documented behavior | When `embedFn` or `enableKnowledgeGraph` is set, the retrieval pipeline automatically wires vector search and KG expansion into the retrieval derived node. There is no explicit opt-in/opt-out per retrieval stage — the presence of the capability implies its use. Callers who need selective retrieval should use the individual nodes directly. |

### Intentional cross-language divergences

Archived to `archive/optimizations/cross-language-notes.jsonl` (entries with `id` prefix `divergence-`). The `/parity` and `/qa` skills read the archive to avoid re-raising confirmed divergences.
