# Optimizations — Active Items (TS + PY)

> **This file is the single source of truth** for optimization tracking across both graphrefly-ts and graphrefly-py.
>
> **Resolved decisions, cross-language notes, built-in optimization docs, QA design decisions, and parity fixes have been archived to `archive/optimizations/*.jsonl`.** See `docs/docs-guidance.md` § "Optimization decision log" for the archive workflow.

---

## Active work items

- **Higher-order operators: fn+closure tier-1 upgrade (proposed, 2026-04-11):**
  `switchMap`, `exhaustMap`, `concatMap`, `mergeMap` currently use the **producer pattern** (manual `source.subscribe()` inside a producer fn). This matches RxJS semantics and has no correctness regression from v4, but the outer source does not participate in the node's wave tracking (tier 2 operator — message-level, not wave-level).
  **fn+closure alternative:** declare `[source]` as a dep, use `data[0]` for the outer value, manage inner subscriptions in closure, return cleanup. Benefits:
  (a) **Wave batching** — multiple outer DATAs in the same batch → fn runs once with the latest value. Fewer inner subscription churn for switchMap (cancel+resubscribe once instead of N times).
  (b) **Pre-fn skip** — if outer emits RESOLVED (unchanged via `equals`), fn doesn't re-run at all. Zero inner subscription management overhead. Free subtree pruning.
  (c) **Diamond coordination** — downstream nodes that depend on both the higher-order operator AND another path from the same source get glitch-free wave resolution via DepRecord tracking.
  Trade-off: fn fires once per wave (not per DATA message). For switchMap this is semantically identical (latest value wins). For concatMap/mergeMap, it means "batch of outer values → one fn call with latest" which may differ from per-message semantics. Needs careful design per operator.
  Depends on: foundation redesign completion. Not blocking — current producer pattern is correct.

- **Single-dep fast path (re-introduce, 2026-04-11):**
  Removed during foundation redesign. Current bench shows single-dep and multi-dep derived are nearly identical (~1.8M ops/sec). In the old design, single-dep was significantly faster because it skipped diamond-resolution overhead. Re-introducing a lightweight check (`deps.length === 1` → skip DepRecord iteration on incoming message, direct fn re-run) could recapture that gap. Target: 2x single-dep vs multi-dep.

- **Message array allocation in hot path (proposed, 2026-04-11):**
  Every `down([[DIRTY], [DATA, v]])` allocates two inner arrays + one outer array per write. This is the primary GC pressure source in write-heavy workloads. Options: (a) intern common message tuples (singleton `DIRTY_MSG = [DIRTY]` as frozen object), (b) accept pre-allocated message batches, (c) `emit()` path already frames internally — encourage `emit` over raw `down` for state writes. Benchmark `emit` vs `down` to quantify.

- **Diamond wide scaling — per-dep iteration overhead (proposed, 2026-04-11):**
  "diamond: wide (10 intermediates)" is 184K ops/sec — 3.7x slower than flat diamond (680K). Each incoming message iterates all DepRecords to check settlement. Potential: maintain a "pending dep count" integer that decrements on each dep settlement, triggering fn re-run when it hits 0 — O(1) settlement check instead of O(deps) scan.

- **Fan-out scaling — sink notification overhead (proposed, 2026-04-11):**
  10→100 subscribers drops throughput 4x (3.1M→762K). Sink array is iterated with per-sink `downWithBatch` calls. Potential: share the same message array reference across sinks (already immutable by convention), reduce per-sink overhead to a single function call without re-framing.

- **`equals` subtree skip verification (proposed, 2026-04-11):**
  Bench shows `equals` provides no benefit when values always change (expected). However, need to verify that when `equals` returns true and RESOLVED is emitted, downstream derived nodes truly skip fn re-run (not just emit RESOLVED themselves after re-running). Add a bench variant where `equals` returns true 50% of the time to measure actual subtree pruning benefit.

- **P3 audit: `.cache` reads inside fn/subscribe callbacks (2026-04-12):**
  Six call sites read `.cache` on another node from inside a reactive context (fn body, subscribe callback, or project function) — bypassing protocol delivery. These work "by accident" when execution is synchronous but could return stale values under batch deferral. Tracked violations:
  1. `operators.ts:994` — `forwardInner` reads `inner.cache` after subscribe to seed value for synchronous producers. Fragile under batch.
  2. `composite.ts:78` — `sourceNode.cache` inside switchMap project fn. Should receive value through the trigger/dep protocol.
  3. `composite.ts:184` — `verdict.cache === true` inside derived fn. Should subscribe to verdict reactively (partially addressed by forEach patch, needs full redesign).
  4. `resilience.ts:624` — `out.meta.status.cache === "errored"` in subscribe callback. Should react to status changes via protocol.
  5. `resilience.ts:733` — `(fb as Node<T>).cache` reads fallback value in callback. Should subscribe to fallback node.
  6. `adapters.ts:394` — `fetchCount.cache ?? 0` in subscribe callback. Should use protocol-delivered value.
  Fix approach: each call site needs case-by-case analysis — some may need structural redesign (subscribe + protocol delivery), others may be acceptable external reads at wiring time. Separate audit session.

- **Distill eviction redesign — reactive verdict tracking (deferred, 2026-04-12):**
  `distill()` eviction with `Node<boolean>` verdicts was patched during foundation v5 rewrite with `forEach(verdict, ...)` subscriptions — functional but adds subscribe overhead per-key. The original design used `dynamicNode` to track verdict deps automatically. Redesign options: (a) store mutation events (§6 "composite.ts eviction — store mutation events") so verdict changes flow as protocol messages, (b) reactive per-entry eviction nodes managed internally by the store, (c) keep `forEach` approach but add cleanup-on-delete tracking. Separate session; blocked on store mutation event design.

- **Reactive rate limiter → `src/extra/rate-limiter.ts` (proposed, 2026-04-10):**
  The eval harness has an imperative `AdaptiveRateLimiter` in `evals/lib/rate-limiter.ts` (sliding-window RPM/TPM, 429 parsing, exponential backoff with jitter, adaptive limit tightening/relaxation). To promote it to a library primitive:
  1. **Reactive core** — `state()` nodes for effective RPM/TPM (live-tunable by LLM or human), `slidingWindow()` utility for request/token tracking, pacing via `fromTimer` + reactive gate (not imperative `while`+`sleep`), backoff signal as reactive input that triggers adaptation.
  2. **Separate HTTP-specific parsing** — 429 status detection, `retry-after`/`x-ratelimit-*` header parsing, error message regex extraction. Keep composable (same file, exported separately) so the reactive rate limiter core applies to any stream/reactive problem (queue consumers, WebSocket reconnect, polling sources), not just HTTP APIs.
  3. **`resilientPipeline()` integration** — the reactive rate limiter becomes a building block in §9.0b `resilientPipeline()` (rateLimiter → breaker → retry → timeout → fallback). Natural composition point.
  4. **Migrate `evals/lib/rate-limiter.ts`** to thin adapter over the reactive version.
  Depends on: `slidingWindow()` utility (new), `fromTimer` (existing). Aligns with §9.0b.

- **`toolInterceptor(agentLoop, opts?)` — Composition C (harness §9.0, 2026-04-10):**
  Mounts a reactive interception pipeline between `agentLoop` tool emission and tool execution (valve → budgetGate → gate → auditTrail). Blocked by an `agentLoop` refactor: the current tool execution path runs imperatively inside `async run()` and has no reactive tap point. To unblock: refactor `AgentLoopGraph` to emit each `ToolCall` as a DATA message to a configurable `toolCallNode` (state or topic) before dispatching — downstream can intercept via `switchMap`/`valve`/`gate` before `appendToolResult` is called. See SESSION-reactive-collaboration-harness §11 for full design. Downstream of §9.2 (`auditTrail`).


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
| **Leaking protocol internals in Phase 4+ APIs** | Domain-layer APIs (orchestration, messaging, memory, AI, CQRS) must never expose `DIRTY`, `RESOLVED`, DepRecord, or settlement internals in their primary surface. Use domain language. Protocol access available via `.node()` or `inner`. | §5.12 |
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
