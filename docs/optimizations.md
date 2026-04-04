# Optimizations and Open Decisions

## Open design decisions

- **Gateway helpers: async iterator queue backpressure (Phase 5.1, noted 2026-04-02, resolved 2026-04-02):** `observeSubscription` uses a `QueueItem[]` between the graph push and the consumer's `next()` pull. Resolved with option (b): `GraphObserveOne` now exposes `up(messages)` for upstream signaling, and `observeSubscription` accepts `highWaterMark`/`lowWaterMark` options that create a `WatermarkController`. When the queue depth exceeds `highWaterMark`, `PAUSE` is sent upstream; when the consumer drains below `lowWaterMark` via `next()`, `RESUME` is sent. Dispose sends `RESUME` to prevent permanent upstream stall. Each controller uses a unique lockId so multiple consumers on the same node do not collide.
- **Gateway helpers: custom message types not forwarded to clients (Phase 5.1, noted 2026-04-02, resolved 2026-04-03):** `observeSSE`, `observeSubscription`, and `ObserveGateway` only forward DATA/ERROR/COMPLETE/TEARDOWN to clients. Resolved with option (c): add `forwardTypes?: MessageType[]` allowlist to gateway options (default `[]`). Types in the allowlist are forwarded as generic events alongside the standard set. Self-documenting, type-safe, cheap Set lookup. TS-only (NestJS integration), no PY parity needed.
- **Gateway helpers: WebSocket backpressure (Phase 5.1, noted 2026-04-02, resolved 2026-04-02):** `ObserveGateway` now accepts `highWaterMark`/`lowWaterMark` options. Each per-client subscription creates a `WatermarkController`. DATA sends increment the pending count; the client sends `{ type: "ack", path, count }` to decrement. PAUSE is sent upstream when pending exceeds `highWaterMark`; RESUME when drained below `lowWaterMark`. Disconnect disposes all controllers (sends RESUME). SSE (`observeSSE`) also supports watermarks via a pull-based `ReadableStream` model — DATA is buffered internally and drained via `pull()`, with `onDequeue` triggering RESUME.
- **Sink adapter silent error swallowing (Phase 5.2b–5.2d, noted 2026-04-04):** All per-record sink adapters (`toPostgres`/`to_postgres`, `toMongo`/`to_mongo`, `toLoki`/`to_loki`, `toTempo`/`to_tempo`, `toSqlite`/`to_sqlite`) silently swallow transport errors when `onTransportError`/`on_transport_error` is not provided. If the user omits the callback, failed inserts/sends are lost with zero indication. Options: (a) default to `console.warn` / `warnings.warn`; (b) require the callback; (c) add an `errors` meta companion node. Sweep deferred — affects all sinks uniformly, not just SQLite.
- **Synchronous SQLite blocking in `toSqlite` / `to_sqlite` sink (Phase 5.2b, noted 2026-04-04):** Unlike async sinks (`toPostgres`, `toKafka`) which fire-and-forget via `void promise.catch`, `toSqlite`/`to_sqlite` calls `db.query()` synchronously inside the `onMessage`/`on_message` handler. During a batch drain of N DATA messages, each insert blocks the event loop (TS) / thread (PY) sequentially. For high-throughput sources this can starve other nodes waiting for batch-deferred settlements. Options: (a) add a `batchInsert` option that collects rows and executes a multi-row INSERT or wraps in a transaction; (b) document the performance cliff. Currently documented in JSDoc only.

## Cross-language implementation notes

- **SQLite adapter parity (Phase 5.2b, 2026-04-04):** Both TS and PY use duck-typed `SqliteDbLike` with a `query(sql, params)` method — matching the `PostgresClientLike`/`ClickHouseClientLike` convention. TS `SqliteDbLike.query()` returns `unknown[]`; PY `SqliteDbLike.query()` returns `list[Any]`. Both are fully synchronous (no Promises/async). `fromSqlite`/`from_sqlite` is one-shot (DATA per row, then COMPLETE); compose with `switchMap` + `fromTimer` for periodic re-query. `toSqlite`/`to_sqlite` follows per-record sink pattern (same as `toPostgres`/`to_postgres`). Default insert SQL uses JSON column; custom `toSQL`/`to_sql` override available. TS uses `node:sqlite` `DatabaseSync` or `better-sqlite3`; PY uses stdlib `sqlite3` — both zero-dep from GraphReFly's perspective (user provides instance).
- **Storage & sink adapter pattern parity (Phase 5.2d, 2026-04-03):** All 5.2d sinks follow the same pattern in both TS and PY: duck-typed client protocols, `onMessage` intercepting `DATA`, `SinkTransportError` for serialize/send failures. Buffered sinks (`toClickHouse`/`to_clickhouse`, `toS3`/`to_s3`, `toFile`/`to_file`, `toCSV`/`to_csv`) return a `BufferedSinkHandle` with `dispose()` + `flush()`. Per-record sinks (`toPostgres`/`to_postgres`, `toMongo`/`to_mongo`, `toLoki`/`to_loki`, `toTempo`/`to_tempo`) return an unsubscribe function. Checkpoint adapters (`checkpointToS3`/`checkpoint_to_s3`, `checkpointToRedis`/`checkpoint_to_redis`) wire `graph.autoCheckpoint()`/`graph.auto_checkpoint()`. TS uses `setTimeout` for flush timers; PY uses `threading.Timer`. PY `to_postgres` calls `client.execute(sql, params)` (psycopg2/3 style); TS calls `client.query(sql, params)` (pg style). PY `to_s3` uses `json.dumps` which includes spaces after separators; TS `JSON.stringify` does not — NDJSON output is semantically equivalent but not byte-identical across languages.
- **Block layout adapters are sync-only (Phase 7.1, 2026-04-02):** `SvgBoundsAdapter` parses viewBox/width/height from SVG strings (pure regex, no DOM). `ImageSizeAdapter` returns pre-registered dimensions by src key (sync lookup, no I/O). No async measurement path in either TS or PY. Browser users who need `getBBox()` or `Image.onload` should pre-measure and pass explicit dimensions on the content block. PY `ImageSizeAdapter` takes `dict[str, dict[str, float]]`; TS takes `Record<string, {width, height}>`.
- **Block layout graph shape parity (Phase 7.1, 2026-04-02):** Both TS and PY use identical 6-node graph: `state("blocks")`, `state("max-width")`, `state("gap")` → `derived("measured-blocks")` → `derived("block-flow")` → `derived("total-height")`. Meta on `measured-blocks`: `block-count`, `layout-time-ns` (phase-3 deferred, matching text layout pattern). Text blocks delegate to `analyzeAndMeasure`/`computeLineBreaks` internally — no separate `reactiveLayout` subgraph mount.
- **Block content model divergence (Phase 7.1, 2026-04-02):** TS uses discriminated union `ContentBlock = { type: "text" | "image" | "svg", ... }` with optional inline fields. PY uses typed dataclasses `TextBlock`, `ImageBlock`, `SvgBlock` with `ContentBlock = TextBlock | ImageBlock | SvgBlock`. SVG dimensions: TS uses `viewBox?: { width, height }` object, PY uses `view_box?: tuple[float, float]`. Image dimensions: TS uses `naturalWidth?/naturalHeight?`, PY uses `natural_width?/natural_height?`. These are language-idiomatic adaptations, not behavioral differences.
- **SvgBoundsAdapter validation (Phase 7.1, resolved 2026-04-02):** Parsed viewBox width/height and fallback `<svg>` width/height must be finite and positive (`Number.isFinite` / Python `math.isfinite`). Invalid numerics raise a message distinct from the “no viewBox or width/height attributes” case.
- **Block layout INVALIDATE + text adapter cache (Phase 7.1, resolved 2026-04-02):** PY `reactive_block_layout` invokes `clear_cache` only when `callable(getattr(adapters.text, "clear_cache", None))`, matching `reactive_layout` and TS `clearCache?.()`.
- **Block layout deferred items (Phase 7.1, noted 2026-04-02, partially resolved 2026-04-03):** (1) Adapter throw inside `derived("measured-blocks")` fn produces terminal `[[ERROR, err]]` with no recovery — resolved: add per-factory `resubscribable?: boolean` option (default `false`) to `reactiveLayout` / `reactiveBlockLayout`. When true, adapter errors emit ERROR but the node can be re-triggered via INVALIDATE. (2) ~~Closure-held `measureCache` survives `graph.destroy()`~~ — **resolved 2026-04-03:** `onMessage` now clears `measureCache` and calls `clearCache?.()` on both INVALIDATE and TEARDOWN. (3) `SvgBoundsAdapter` regex may match nested `<svg>` elements or content inside XML comments/CDATA — resolved: strip `<!--...-->` and `<![CDATA[...]]>` before viewBox extraction; document single-root-SVG constraint; expose `SvgParserAdapter` interface so users can opt in their own parser. (4) ~~`ImageSizeAdapter` returns mutable references~~ — **resolved 2026-04-03:** `measureImage` now returns a shallow copy (`{ width, height }` spread).

## Resolved design decisions (streaming + AI lifecycle)

- **Streaming token delivery (Phase 4.4, resolved 2026-03-31 — option (a) `reactiveLog` internally):** `fromLLMStream(adapter, messages)` returns `Node<ReactiveLogSnapshot<string>>`, accumulating tokens via `reactiveLog` internally. This reuses the existing Phase 3.2 data structure; `tail()` / `logSlice()` give natural windowed views; fully reactive (no polling); `describe()` / `observe()` / inspector work out of the box. Rejected alternatives: (b) `DATA` with `{ partial, chunk }` — loses composability and version dedup; (c) `streamFrom` pattern — premature abstraction for a single use case.

- **Retrieval pipeline reactivity model (Phase 4.4, resolved 2026-03-31 — option (b) persistent derived node):** `agentMemory`'s retrieval is a persistent derived node that re-runs when store, query, or context change. The `query` input is a `state` node updated via `retrieve(query)`. This fits GraphReFly's reactive model: memory context auto-updates as conversation evolves. Rejected: (a) method that creates a derived node on-demand — doesn't compose reactively, loses `observe()` introspection.

- **`agentMemory` in-factory composition scope (Phase 4.4, resolved 2026-03-31):** All primitives (`vectorIndex`, `knowledgeGraph`, `lightCollection`, `decay`, `autoCheckpoint`) are opt-in via options. Vector + KG indexing happens in a reactive `effect` that observes the distill store. Tier classification runs in a separate `effect`. This avoids monolithic coupling while keeping the factory ergonomic. Cross-language parity: TS uses `fromTimer(ms)` for reflection trigger, PY uses `from_timer(seconds)`.

- **Reactive layout (roadmap §7.1, resolved 2026-03-31):** Cross-language parity target is **same graph shape + shared tests for ASCII/Latin** (not full ICU / `Intl` segmentation parity). Whitespace normalization matches TypeScript: collapse `[\t\n\r\f ]+` to a single ASCII space, then strip **at most one** leading and one trailing ASCII space (Python does **not** use full-Unicode `str.strip()`). The `segments` meta field **`cache-hit-rate`** is `hits / (hits + misses)` over `measureSegment` / `measure_segment` lookups in that recompute (`1` when there were zero lookups). Companion meta **`DATA`** for layout metrics is delivered **after** the parent `segments` node settles via batch phase-3 (TS: `emitWithBatch(..., 3)`, PY: `emit_with_batch(..., phase=3)`). **`MeasurementAdapter`:** `clearCache` / `clear_cache` is optional on both sides.
- **Reactive layout meta timing parity (Group 3 — FYI):** Both TS and PY defer meta companion emissions to **batch phase-3** (TS: `emitWithBatch(..., 3)`, PY: `emit_with_batch(..., phase=3)`). Phase-3 drains only after all phase-2 work (parent node settlements) completes, guaranteeing meta values arrive after the parent `segments` DATA has propagated. This ordering is asserted by a batch-ordering test.
- **Reactive layout intentional divergences (Group 4 — FYI):** TS CLI width heuristics use hard-coded codepoint ranges and a terminal-like approximation of East Asian width/combining marks, while Py uses `unicodedata.east_asian_width()` + Unicode `category()` (so rare/ambiguous codepoints may differ). TS feeds the layout pipeline using `Intl.Segmenter` word segmentation, while Py seeds it via regex tokenization (full ICU parity is not guaranteed; current parity tests target ASCII/Latin). Runtime backend sets differ by environment: TS canvas/Node-canvas adapters vs Python Pillow-based measurement.
- **Reactive layout max-width clamp (Phase 7.1, resolved 2026-04-02):** `reactiveLayout` / `reactiveBlockLayout` (TS) and `reactive_layout` / `reactive_block_layout` (PY) clamp the `max-width` state to ≥ 0 on factory init and on `setMaxWidth` / `set_max_width`.

- **Default node versioning `id` (Phase 6, resolved 2026-03-31):** Auto-generated V0/V1 ids are **RFC 4122 UUID strings with hyphens**, matching `crypto.randomUUID()` (TypeScript) and `str(uuid.uuid4())` (Python). For stable cross-session ids, set `versioningId` / `versioning_id` explicitly.

- **`fromLLMStream` / `from_llm_stream` teardown (Phase 4.4, resolved 2026-04-02):** `fromLLMStream` now returns `LLMStreamHandle { node, dispose }` — a bundle matching the `withBreaker`/`withStatus` pattern. `dispose()` aborts any in-flight stream, unsubscribes the keepalive, and propagates `TEARDOWN` to the internal effect node (per spec §2.3). Cross-language: PY `from_llm_stream` (when implemented) should follow the same bundle pattern.

- **CQRS terminal state handling (Phase 4.5, resolved 2026-04-02):** `dispatch()` / `_appendEvent` now throws if the event stream node has reached terminal status (`completed`/`errored`). This is a cheap fail-fast guard that prevents silent data loss. Broader cross-cutting terminal strategy deferred.

- **CQRS dispatch-time persistence (Phase 4.5, resolved 2026-04-02):** `persist()` is now sync-only on the type surface. Adapters with async I/O buffer internally and expose an optional `flush()` method. The unawaited Promise path has been removed. Cross-language: PY `persist` is also now sync.

- **CQRS saga vs projection event ordering (Phase 4.5, resolved 2026-04-02):** Keep the intentional split. Projections globally sort by `(timestampNs, seq)` for consistent read models. Sagas use per-stream causal ordering (new tail entries since last run). Different jobs need different ordering guarantees — reordering across streams is dangerous for side effects. Document in module docstrings.

- **CQRS event store `since` / replay cursor (Phase 4.5, resolved 2026-04-02):** Opaque `EventStoreCursor` type. `loadEvents` returns `LoadEventsResult { events, cursor }`. Next `loadEvents` takes the cursor for incremental replay. `MemoryEventStore` uses `(timestampNs, seq)` tuple comparison for filtering — events with the same timestamp but higher seq are included. Cross-language: same API shape and cursor key names (`timestamp_ns`/`seq` in PY).

- **Cross-language V1 cid parity (Phase 6, resolved 2026-04-02):** `canonicalizeForHash` / `canonicalize_for_hash` normalizer applied before JSON serialization. Integer-valued floats normalize to integers. `NaN`/`Infinity`/`undefined` are rejected. Integers outside the safe range (`|n| > 2^53-1`) are rejected — JS and Python serialize large integers differently (`1e+21` vs decimal), so cid parity is only guaranteed within `Number.isSafeInteger` bounds. No external dependency needed.

- **`_versioningLevel` field removed (Phase 6, resolved 2026-04-02):** Field deleted (pre-1.0, no backward compat). TS never had it (versioning level was consumed at construction). PY `_versioning_level` on NodeImpl removed — inlined as local in `__init__`. `Graph._default_versioning_level` retained (actively used by `Graph.add` / `set_versioning`).

## Implementation anti-patterns

Cross-cutting rules for reactive/async integration (especially `patterns.ai`, LLM adapters, and tool handlers). **Keep this table identical in both repos’ `docs/optimizations.md`.**

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

## Resolved design decisions (compat adapters)

- **Compat adapter write semantics (resolved 2026-03-31):** `useStore` setters in framework adapters **must forward** `DATA` when payload is `undefined` (for `Node<T | undefined>`). `undefined` is a valid `T`; dropping writes silently loses data.
- **Compat adapter lifecycle semantics (resolved 2026-03-31):** Subscriptions **remain mounted until framework teardown**, not auto-disposed on terminal messages (`COMPLETE`/`ERROR`). The framework owns lifecycle, not the protocol.
- **Compat adapter record-sync semantics (resolved 2026-03-31):** Keyed record subscriptions **ignore phase-1 `DIRTY` waves** and only resubscribe on settled phase-2 key updates (`DATA`/`RESOLVED`). `DIRTY` is transient; acting on it causes unnecessary churn.
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
| **Shared** | `meta_snapshot` / `metaSnapshot` omit keys when a companion `get()` throws; same best-effort `type` inference for Appendix B entries; `Graph.describe()` Phase 1.3 (TS + Python). |

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
| **disconnect** | Both ports **throw** if the edge was not registered. Dropping an edge does **not** remove constructor-time deps on the node (registry / future `describe()`). **See Resolved design decisions §C** (QA 1d #2). |
| **remove** | Unregisters the node, drops incident edges, sends **`[[TEARDOWN]]`** to that node. |
| **Python** | `Graph(..., {"thread_safe": True})` (default): registry uses an `RLock`; **`down([[TEARDOWN]])` runs after the lock is released** on `remove`. |
| **TypeScript** | No graph-level lock (single-threaded spec). |

### 14. `Graph` Phase 1.2 composition — parity (mount, `resolve`, `signal`)

**Path separator:** Both ports use `::` as the qualified-path separator (e.g. `"parent::child::node"`). Single `:` is allowed in graph names, node names, and mount names. Both ports forbid `::` in names.

**Aligned:** Both provide `mount`, `::` separated `resolve`, recursive `signal`, forbid `::` in local node and mount names, forbid mount versus node name collisions, reject self-mount and mount cycles, treat a path that ends on a subgraph (or continues past a leaf node) as an error, and:

- `remove(mount_name)` unmounts and sends TEARDOWN through the mounted subtree
- `node` / `get` / `set` accept `::` qualified paths
- `connect` / `disconnect` accept `::` qualified paths; same-owner edges stored on child graph, cross-subgraph edges on parent
- `add` rejects duplicate node instances (same reference registered under two names)
- `mount` rejects the same child `Graph` instance mounted twice on one parent
- `edges()` public read-only listing of registered `(from, to)` pairs
- `signal` visit order: recurse into mounts first, then deliver to local nodes
- `resolve` strips leading graph name (e.g. `root.resolve("app::sub::x")` when `root.name == "app"`)
- Graph names may contain single `:` (both ports reject `::` in graph names)

**Remaining intentional divergence:**

| Topic | Python | TypeScript | Rationale |
|-------|--------|------------|-----------|
| `signal` node dedupe | No per-call dedupe (duplicate mount is forbidden, so unnecessary). | Shared `visited` `Set<Node>` across recursion. | TS keeps the dedupe as defense-in-depth. |

**Docs:** `graphrefly-py/docs/roadmap.md` still lists `graph.signal` under Phase 1.4 unchecked while Phase 1.2 marks composition done; `signal` exists — checklist drift only.

### 15. `Graph` Phase 1.3 introspection (`describe`, `observe`, meta paths)

| | |
|--|--|
| **Meta path segment** | Reserved literal `__meta__` (export `GRAPH_META_SEGMENT`). Address: `localNode::__meta__::<metaKey>`; **repeat** the segment for nested companion meta (same as graphrefly-py `_resolve_meta_chain`). |
| **`connect` / `disconnect`** | Paths whose `::` segments include `__meta__` are rejected (wires stay on registered primaries). **TypeScript:** `assertConnectPathNotMeta`. |
| **`Graph.add` / registry name** | **TypeScript:** If the node has no `name` in options, `add(localName, node)` calls `NodeImpl._assignRegistryName(localName)` so `describe()` / `deps` match the registry (parity with Python setting `_name` on add). |
| **`signal` → meta** | **TypeScript:** After each primary, deliver the batch to companion `meta` nodes (sorted by meta key), except **TEARDOWN-only** batches — primary `down()` already cascades TEARDOWN to meta, so the extra meta pass is skipped (no duplicate). **Python:** Same TEARDOWN rule in `_signal_node_subtree`; otherwise depth-first meta with sorted keys; `visited` on `id(node)` (see graphrefly-py `docs/optimizations.md` §15). |
| **`observe()` all nodes** | **Both:** One `subscribe` per primary + meta target; **subscription attach order** is full-path code-point sort on the qualified path (deterministic; **not** causal emission order). Resolved 2026-03-31: TS switched from `localeCompare` to plain string comparison; Python switched from per-level sort to full-path `sorted()`. Cross-language observe order is now identical. |
| **Describe `type`** | Both: `describeKind` / `describe_kind` on `NodeOptions`; sugar constructors (`effect`, `producer`, `derived`) set it; `inferDescribeType` / `_infer_describe_type` prefers explicit kind when set. |
| **`describe().nodes`** | Keys = same qualified targets as `_collect_observe_targets` (primary + recursive meta). | Same pattern. |

| **`describe().nodes`** | Both strip `name` from per-node entries (dict key is the qualified path). |
| **`describe().subgraphs`** | Both recursively collect all nested mount paths (e.g. `["sub", "sub::inner"]`). |
| **`connect` self-loop** | Both reject `connect(x, x)` before dep validation. |

**Docs:** `graphrefly-py/docs/optimizations.md` §15 — Python Phase 1.3 shipped (`GRAPH_META_SEGMENT`, `describe`, `observe`, `signal`→meta). Both ports now sort local nodes and mounts in `signal`, `_collect_observe_targets`, and `_collect_edges`. **Resolved (2026-03-31):** Both ports now use full-path code-point sort for `observe()` target ordering. TS switched from `localeCompare` to plain string comparison; Python switched from per-level sort to full-path `sorted()`. Cross-language observe order is now identical for the same graph topology.

### 16. `Graph` Phase 1.4 lifecycle & persistence (`destroy`, `snapshot`, `restore`, `fromSnapshot`, `toJSON`)

**Aligned:**

| | |
|--|--|
| **`destroy()`** | Both: `signal([[TEARDOWN]])` then clear all registries recursively through mounts. |
| **`snapshot()`** | Both: `{ version: 1, ...describe() }` — flat `version` field, sorted `nodes` keys. |
| **`restore(data)`** | Both: validate `data.name` matches graph name; skip `derived`/`operator`/`effect` types; silently ignore unknown/failing paths. |
| **`fromSnapshot(data, build?)`** | Both: optional `build` callback registers topology before `restore()` applies values. Without `build`, both use registry-based reconstruction (mounts → topo node creation via factories → edges → restore). |
| **`toJSON()` / `to_json()`** | TS returns a plain sorted-key **object** (for `JSON.stringify(graph)`); Python returns a compact JSON **string** with trailing newline. Language-appropriate. |
| **`toJSONString()`** | TS only — `JSON.stringify(toJSON()) + "\n"`. Python's `to_json()` serves the same role. |

**Intentional divergence:**

| Topic | Python | TypeScript | Rationale |
|-------|--------|------------|-----------|
| `toJSON()` return type | `to_json()` → `str` (no universal `__json__` hook in Python) | `toJSON()` → plain object (ECMAScript `JSON.stringify` protocol) | Language idiom |
| JSON separator style | Compact: `separators=(",",":")` | Default: `JSON.stringify` (also compact with one arg) | Both produce compact JSON; byte-identical cross-language snapshots are not required |
| `_parse_snapshot_envelope` | Validates `version`, `name`, `nodes`, `edges`, `subgraphs` types | Only validates `data.name` match | Python is stricter; both correct |

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
| `Graph` Phase 1.1 | `thread_safe` + `RLock`; TEARDOWN after unlock on `remove`; `disconnect` registry-only (§C resolved) | Registry only; `connect` / `disconnect` errors aligned; §C resolved |
| `Graph` Phase 1.2 | Aligned: `::` path separator, mount `remove` + subtree TEARDOWN, qualified paths, `edges()`, signal mounts-first, `resolve` strips leading name, `:` in names OK; see §14 | Same; see §14 |
| `Graph` Phase 1.3 | `describe`, `observe`, `GRAPH_META_SEGMENT`, `signal`→meta, `describe_kind` on sugar; see §15 | `describe()`, `observe()`, `GRAPH_META_SEGMENT`, `describeKind` on sugar, registry name on add; see §15 | `observe()` order: both use full-path code-point sort (resolved 2026-03-31; see §15) |
| `Graph` Phase 1.4 | `destroy`, `snapshot` (flat `version: 1`), `restore` (name check + type filter + silent catch), `from_snapshot(data, build=)`, `to_json()` → str + `\n`; see §16 | `destroy`, `snapshot`, `restore`, `fromSnapshot(data, build?)`, `toJSON()` → object, `toJSONString()` → str + `\n`; see §16 |
| `Graph` Phase 1.5 | **Both:** actor/guard/`policy()`, scoped `describe`/`observe`, `set`/`signal`/`down`/`up` actor + delivery (`write` vs `signal`), `internal` lifecycle TEARDOWN, `meta.access` guarded hint, `GuardDenied` + `lastMutation`; non-transactional `signal` on first denial — see `graphrefly-py/docs/optimizations.md` built-in §8 | Same |
| `policy()` semantics | Deny-overrides: any matching deny blocks; if no deny, any matching allow permits; no match → deny | Same (aligned from parity round) |
| `DEFAULT_ACTOR` | `{"type": "system", "id": ""}` | `{ type: "system", id: "" }` (aligned) |
| `lastMutation` timestamp | `timestamp_ns` via `wall_clock_ns()` (`time.time_ns()`) | `timestamp_ns` via `wallClockNs()` (`Date.now() * 1_000_000`) — both wall-clock nanoseconds; centralised in `core/clock` |
| `accessHintForGuard` | Probes guard with standard actor types → `"both"`, `"human"`, `"restricted"`, etc. | `accessHintForGuard()` — same probing logic (aligned from parity round) |
| `subscribe()` observe guard | `subscribe(sink, hints, *, actor=)` checks observe guard at node level | `subscribe(sink, { actor? })` checks observe guard at node level (aligned from parity round) |
| `up()` guard + attribution | `up(msgs, *, actor=, internal=, guard_action=)` checks guard, records `last_mutation` | `up(msgs, opts?)` checks guard, records `lastMutation` (aligned from parity round) |
| `on_message` (spec §2.6) | `on_message` option on node; checked in `_handle_dep_messages`; `True` consumes, exception → ERROR | `onMessage` option; same semantics |
| `meta` guard inheritance | Meta companions inherit parent guard at construction | Same |
| `Graph.destroy()` guard bypass | `_signal_graph(..., internal=True)` bypasses all guards | Same |
| `Graph.set` internal | `set(name, value, *, internal=False)` | `set(name, value, { internal? })` |
| `allows_observe()` / `has_guard()` | Public methods on `NodeImpl` | Public methods on `Node` interface |
| Extra Phase 2.3 (sources/sinks) | `graphrefly.extra.sources` + `graphrefly.extra.cron`; see §5 above | `src/extra/sources.ts` + `src/extra/cron.ts`; see §5 above |
| `gate(source, control)` | `graphrefly.extra.tier2.gate` | `src/extra/operators.ts` `gate` (aligned 2026-03-28) |
| `firstValueFrom` | `first_value_from(source, timeout=)` (blocking) | `firstValueFrom(source): Promise<T>` |
| `fromEvent` / `from_event_emitter` | Generic emitter (`add_method=`, `remove_method=`) | DOM `addEventListener` API |
| `toArray` / `to_array` | Reactive `Node[list]` | Reactive `Node<T[]>` |
| `to_list` (blocking) | Py-only sync bridge | N/A |
| Extra Phase 3.1 (resilience) | `graphrefly.extra.{backoff,resilience,checkpoint}`; see §6 below | `src/extra/{backoff,resilience,checkpoint}.ts`; see §6 below |
| Extra Phase 3.2 (data structures) | `graphrefly.extra.data_structures` (`reactive_map`, …); see §17 | `reactiveMap` + `reactive-base` (`Versioned` snapshots); see §17 |

### 18. Inspector causality hooks (Phase 3.3 observe extensions)

| Topic | TypeScript | Python |
|-------|------------|--------|
| Core hook shape | `NodeImpl._setInspectorHook()` installs an internal, opt-in hook with `dep_message` and `run` events. | `NodeImpl._set_inspector_hook()` mirrors the same hook contract (`dep_message`, `run`). |
| Runtime overhead | Hook pointer is `undefined` by default; no event allocation unless `observe(name, { timeline/causal/derived })` is active. | Hook pointer is `None` by default; no event allocation unless `observe(..., timeline/causal/derived)` is active. |
| Graph usage | `observe(name, { timeline, causal, derived })` enriches structured events with `in_batch`, trigger dep metadata, and dep snapshots. `observe({ structured: true, ... })` is also supported graph-wide. | `observe(name, timeline=True, causal=True, derived=True)` uses the same hook-driven enrichment model (graph-wide structured supported). |

Parity hardening (2026-03-30): both ports now keep `data` / `resolved` events under `causal` even when no trigger index is known yet, always emit `derived` on every `run`, and set `completedCleanly` / `completed_cleanly` only when no prior `ERROR` was seen. Structured timeline timestamps use `timestamp_ns` in both ports (nanoseconds). `ObserveResult.values` is latest-by-path map in both ports.

### 19. Inspector helper parity (reasoning trace + diagram export)

| Topic | TypeScript | Python |
|-------|------------|--------|
| Reasoning trace path validation | `graph.annotate(path, reason)` resolves `path` and throws if unknown. | `graph.annotate(path, reason)` resolves `path` and raises if unknown. |
| Reasoning trace entry key | `TraceEntry.path` (qualified node path) | `TraceEntry.path` (qualified node path) |
| Inspector disabled behavior | `traceLog()` returns `[]`; `annotate()` is a no-op. | `trace_log()` returns `[]`; `annotate()` is a no-op. |
| Diagram export | `graph.toMermaid({ direction })`, `graph.toD2({ direction })` | `graph.to_mermaid(direction=...)`, `graph.to_d2(direction=...)` |
| Direction set | `TD`, `LR`, `BT`, `RL` | `TD`, `LR`, `BT`, `RL` |
| D2 direction mapping | `TD→down`, `LR→right`, `BT→up`, `RL→left` | `TD→down`, `LR→right`, `BT→up`, `RL→left` |
| Direction validation | Runtime guard throws for values outside `TD/LR/BT/RL`. | Runtime guard raises for values outside `TD/LR/BT/RL`. |
| Trace ring size | 1000 entries (bounded ring). | 1000 entries (bounded ring). |
| Trace timestamp | `timestamp_ns` via `monotonic_ns()` (`time.monotonic_ns()`). | `timestamp_ns` via `monotonicNs()` (`performance.now`-based ns). Both centralised in `core/clock`. |
| Inspector default | Disabled when `NODE_ENV=production`; enabled otherwise. | Disabled when `NODE_ENV=production`; enabled otherwise. |
| `spy` return shape | `Graph.spy(...)` returns `{ result: ObserveResult, dispose() }` (`GraphSpyHandle`) | `Graph.spy(...)` returns `SpyHandle` with `.result` and `.dispose()` |
| `dumpGraph` / `dump_graph` JSON stability | Uses recursively sorted keys before stringify (byte-stable for same graph + options) | Uses `json.dumps(..., sort_keys=True)` (byte-stable for same graph + options) |

### 20. `reachable(...)` parity decisions (2026-03-30)

| Topic | TypeScript | Python |
|-------|------------|--------|
| Signature style | `reachable(described, from, direction, { maxDepth? })` | `reachable(described, from_path, direction, *, max_depth=None)` |
| Direction validation | Runtime guard: only `"upstream"` / `"downstream"` accepted; invalid throws | Runtime guard: only `"upstream"` / `"downstream"` accepted; invalid raises |
| Depth validation | Integer-only `maxDepth >= 0` (`0` returns `[]`) | Integer-only `max_depth >= 0` (`0` returns `[]`; rejects `bool`) |
| Malformed payload handling | Defensive: non-object `nodes` / non-array `edges` treated as empty; malformed edges skipped | Defensive: same behavior (`nodes`/`edges` normalized, malformed entries skipped) |
| Traversal semantics | BFS over `deps` + `edges`; upstream = deps+incoming, downstream = reverse-deps+outgoing | Same |
| Output ordering | Lexical code-point ordering (stable, locale-independent) | Lexical code-point ordering via `sorted()` |

### 21. Centralised clock utilities (`core/clock`) — parity (2026-03-30)

Both repos export two timestamp functions from `core/clock`:

| Function | Python | TypeScript | Use case |
|----------|--------|------------|----------|
| `monotonic_ns` / `monotonicNs` | `time.monotonic_ns()` — true nanoseconds | `Math.trunc(performance.now() * 1_000_000)` — ~microsecond effective precision | Timeline events, trace entries, resilience timers, TTL deadlines, all internal duration tracking |
| `wall_clock_ns` / `wallClockNs` | `time.time_ns()` — true nanoseconds | `Date.now() * 1_000_000` — ~256ns precision loss at epoch scale | `lastMutation` attribution (guard), `fromCron` emission payload |

**Convention:** all timestamps in the protocol are nanoseconds (`_ns` suffix). No code outside `core/clock` should call `Date.now()`, `performance.now()`, `time.time_ns()`, or `time.monotonic_ns()` directly.

**JS platform precision limits** (documented in `src/core/clock.ts`):

- `monotonicNs`: `performance.now()` returns ms with ~5µs browser resolution; last 3 digits of ns value are always zero.
- `wallClockNs`: `Date.now() * 1e6` produces values ~1.8×10¹⁸ which exceed IEEE 754's 2⁵³ safe integer limit, causing ~256ns quantisation. Irrelevant in practice — JS is single-threaded, so sub-µs collisions cannot occur.

Python has no precision limitations (arbitrary-precision `int`).

**Internal timing (acceptable divergence):** TS `throttle` operator uses `performance.now()` (milliseconds) directly for relative elapsed-time gating. This is internal and never exposed as a protocol timestamp. Python tier-2 time operators use `threading.Timer` (wall-clock seconds). Both are correct for their purpose.

**Ring buffer (TS):** Trace log uses a fixed-capacity `RingBuffer<TraceEntry>` (default 1000) for O(1) push + eviction. Python uses `collections.deque(maxlen=1000)`.

**Diagram export — deps + edges:** Both `toMermaid`/`to_mermaid` and `toD2`/`to_d2` now render arrows from **both** constructor `deps` and explicit `connect()` edges, deduplicated by `(from, to)` pair.

### 22b. Phase 4.3 `vectorIndex` backend seam (optional HNSW dependency)

| Topic | TypeScript | Python |
|-------|------------|--------|
| Default backend | `backend: "flat"` exact cosine search (no external dependency). | `backend="flat"` exact cosine search (no external dependency). |
| HNSW backend | `backend: "hnsw"` requires an injected optional adapter (`hnswFactory`). Missing adapter throws a clear configuration error. | `backend="hnsw"` requires an injected optional adapter (`hnsw_factory`). Missing adapter raises a clear configuration error. |
| Product contract | Stable `vectorIndex` API now; production HNSW can be enabled later without changing the public API. | Same contract for cross-language parity. |

### 22c. Phase 4.3 memory patterns — Graph extension style, variable-length vectors, snapshot immutability

**Graph extension style (parity note):** TypeScript factories typically build a `Graph`, then attach domain methods with `Object.assign(graph, { ... })` so call sites get a single object with both `Graph` APIs and helpers. Python factories use a **`Graph` subclass** (for example `CollectionGraph`, `KnowledgeGraph`) with the same surface methods. Behavior is aligned; the difference is idiomatic typing and ergonomics in each language.

**Variable-length vectors (when `dimension` is omitted):** Stored rows and queries may differ in length. Flat cosine similarity **implicitly zero-pads both sides to `max(len(query), len(row))`** so ranking matches across TypeScript and Python. When `dimension` is set, vectors must match that length (unchanged).

**Snapshot immutability:** Memory-pattern derived snapshots follow the same spirit as messaging metadata: Python uses `MappingProxyType` / tuples for adjacency lists; TypeScript exposes **frozen** arrays for per-node edge lists in `knowledgeGraph` adjacency so callers do not accidentally mutate derived state.

### 22. Phase 4.2 messaging patterns parity (`topic`, `subscription`, `jobQueue`)

Both repos now ship a Pulsar-inspired messaging domain layer under `patterns.messaging`:

| Topic | TypeScript | Python | Notes |
|-------|------------|--------|-------|
| Namespace | `patterns.messaging` | `graphrefly.patterns.messaging` | Aligned |
| Topic factory | `topic(name, { retainedLimit?, graph? })` | `topic(name, retained_limit=, opts=)` | Naming differs by language convention |
| Subscription factory | `subscription(name, topicGraph, { cursor?, graph? })` | `subscription(name, topic_graph, cursor=, opts=)` | Cursor-based consumer on retained topic log |
| Job queue factory | `jobQueue(name, { graph? })` | `job_queue(name, opts=)` | Same queue behavior; naming differs by language convention |
| Job flow factory | `jobFlow(name, { stages?, maxPerPump?, graph? })` | `job_flow(name, stages=, max_per_pump=, opts=)` | Autonomous multi-stage queue chaining |
| Topic bridge factory | `topicBridge(name, sourceTopic, targetTopic, { cursor?, maxPerPump?, map?, graph? })` | `topic_bridge(name, source_topic, target_topic, cursor=, max_per_pump=, map_fn=, opts=)` | Autonomous cursor-based topic relay |
| Queue controls | `enqueue`, `claim`, `ack`, `nack` | `enqueue`, `claim`, `ack`, `nack` | `nack(requeue=false)` drops the job on both |
| Metadata capture | `Object.freeze({...metadata})` | `MappingProxyType(dict(metadata))` | Immutable snapshot at enqueue time on both |
| Return shape (imperative helpers) | Arrays (`readonly T[]`) | Tuples (`tuple[...]`) | Intentional language idiom; reactive node outputs remain protocol-driven in both |

**Design note:** helper methods like `pull()` / `retained()` return local collection snapshots for ergonomics. Reactive protocol semantics still flow through node outputs and `Graph.observe()` (messages are always `[[Type, Data?], ...]`). `jobFlow` and `topicBridge` use keepalive-backed effect pumps (Option B) so forwarding/advancement runs autonomously after graph construction.

#### 3.1 Composition strategy: explicit topology via `mount()`

`subscription(name, topicGraph, ...)` now mounts the topic graph under `topic` and wires `topic::events -> source` via explicit graph edges.

| Approach | Pros | Cons |
|---|---|---|
| Direct cross-graph dep | Minimal API surface; easy to compose quickly. | Topology/ownership is implicit; edge registry cannot fully represent the dependency. |
| `mount()` + explicit edge (current) | Topology ownership and dependency edges are explicit (`topic::events -> source`), aligned with graph composition semantics. | Slightly more internal wiring. |

**Recommendation (current contract):** keep explicit topology (`mount` + explicit edge) for messaging composition.

**Supported counteract:** when lightweight composition is desired, use `topicBridge` and `jobFlow` helpers that still preserve explicit topology internally.

### 23. CQRS reactive log snapshot shape (Phase 4.5 — cross-language note)

The append-only log underneath CQRS events is `reactiveLog` in TypeScript (`Versioned<{ entries: readonly T[] }>`) and `reactive_log` in Python (`Versioned` wrapping a **tuple** of entries). The CQRS layer adapts locally when building projections and sagas. This is **not** a user-facing API mismatch for typical use.

### 6. Resilience & checkpoint (roadmap 3.1) — parity (2026-03-29)

**Aligned:**

| Topic | Both |
|-------|------|
| `retry` | Resubscribe-on-ERROR with optional backoff; `count` caps attempts; `backoff` accepts strategy or preset name; successful DATA resets attempt counter; max-retries sentinel: `2_147_483_647` (`0x7fffffff`) |
| `backoff` strategies | `constant`, `linear`, `exponential`, `fibonacci`, `decorrelatedJitter` / `decorrelated_jitter`; jitter modes: `none`, `full`, `equal`; `resolveBackoffPreset` / `resolve_backoff_preset` maps preset names (including `"decorrelated_jitter"`); `withMaxAttempts` / `with_max_attempts` caps any strategy at N attempts (returns `null`/`None` after cap) |
| `CircuitBreaker` | `closed` → `open` → `half-open` states; `canExecute` / `can_execute`, `recordSuccess` / `record_success`, `recordFailure` / `record_failure`, `reset()`, `failureCount` / `failure_count`; optional `cooldownStrategy` / `cooldown_strategy` (BackoffStrategy) for escalating cooldowns across open cycles |
| `withBreaker` / `with_breaker` | Returns `WithBreakerBundle` (`node` + `breakerState`/`breaker_state`); `onOpen: "skip"` → RESOLVED, `"error"` → CircuitOpenError |
| `rateLimiter` / `rate_limiter` | Sliding-window FIFO queue; throws/raises on `maxEvents <= 0` or `windowSeconds <= 0`; COMPLETE/ERROR clear timers + pending + window times |
| `TokenBucket` | Capacity + refill-per-second; `tryConsume` / `try_consume`; `tokenTracker` / `token_tracker` factory alias |
| `withStatus` / `with_status` | `WithStatusBundle` (`node` + `status` + `error`); recovery from `errored` via `batch` |
| `describeKind` | All resilience operators use `"operator"` |
| Checkpoint adapters | `Memory`, `Dict`, `File`, `Sqlite` on both; `save_graph_checkpoint`/`restore_graph_checkpoint`; `checkpoint_node_value` returns `{ version: 1, value }` |

**Intentional divergences:**

| Topic | Python | TypeScript | Rationale |
|-------|--------|------------|-----------|
| Timer base | `monotonic_ns()` (nanoseconds via `time.monotonic_ns()`) | `monotonicNs()` (nanoseconds via `performance.now()`) | Both centralised in `core/clock`; nanosecond internal tracking |
| Thread safety | `CircuitBreaker` + `TokenBucket` use `threading.Lock`; retry uses `threading.Timer` | Single-threaded (`setTimeout`) | Spec §6.1 |
| `CircuitBreaker` params | `cooldown` (seconds, implicit) | `cooldownSeconds` (seconds, explicit) | Naming convention |
| `CircuitOpenError` base | `RuntimeError` | `Error` | Language convention |
| API pattern | `@runtime_checkable Protocol` + private `_Impl` class + `circuit_breaker()` / `token_bucket()` factory | `interface` + private class + `circuitBreaker()` / `tokenBucket()` factory | Both expose factory functions as primary API; types for structural checks |
| Retry delay validation | `_coerce_delay()` raises `ValueError` for non-finite | `coerceDelaySeconds()` throws `TypeError` for non-finite | Both validate; error type differs |
| IndexedDB checkpoint | N/A (backend-only) | `saveGraphCheckpointIndexedDb` / `restoreGraphCheckpointIndexedDb` (browser) | TS browser runtime only |
| `SqliteCheckpointAdapter` | `sqlite3` stdlib | `node:sqlite` (`DatabaseSync`, Node 22.5+) | Both stdlib, zero deps |

**Meta integration (spec §2.3, Option A):** `withBreaker` and `withStatus` wire companion nodes into `node.meta` at construction via the `meta` option. Bundles still provide ergonomic typed access; `node.meta.breakerState` / `node.meta["status"]` are the same node instances returned in the bundle. Companions appear in `graph.describe()` under `::__meta__::` paths.

### 17. Phase 3.2 data structures (versioned snapshots)

**TypeScript:** `reactiveMap` (`src/extra/reactive-map.ts`); shared `Versioned<T>` + `snapshotEqualsVersion` in `src/extra/reactive-base.ts` (not re-exported from the package barrel — use concrete factories).

**Python:** `reactive_map`, `reactive_log`, `reactive_index`, `reactive_list`, `pubsub`, `log_slice` in `graphrefly.extra.data_structures` (re-exported from `graphrefly.extra`). **Parity aligned (2026-03-29):** All mutations emit via two-phase `batch()` (DIRTY then DATA); all snapshot nodes use `Versioned` (named tuple with monotonic `version` + `value`) with `_versioned_equals` for efficient dedup; `data.get().value` returns `MappingProxyType` (immutable) for maps and `tuple` for logs/lists; all factories accept an optional `name` param; `describe_kind` set on all internal nodes.

**Semantics (aligned):** Both ports use `Versioned` snapshots with a monotonic version counter for `NodeOptions.equals`. TTL: both use `monotonicNs()` / `monotonic_ns()` internally; public API takes seconds (`defaultTtl` / `default_ttl`). Lazy expiry + explicit `prune()` / `pruneExpired()` on both; no background timer in the first iteration. LRU: TS refreshes order on `get`/`has`; Python refreshes order on `set` only (reads use `data.get()` as a dict snapshot — no per-key LRU touch on read). `pubsub` topic publish uses two-phase protocol on both.

**Doc / API surface:** Both use seconds for TTL: TS `defaultTtl` / Python `default_ttl`.

**Derived log views (`tail` / `log_slice` / `logSlice`):** Both ports attach a noop subscription to each derived view so `get()` stays wired without a user sink (same idea as Python’s `_keepalive_derived`). Each call allocates a new derived node plus that subscription; creating very many throwaway views can retain subscriptions until those nodes are unreachable. See JSDoc on `reactiveLog` / `logSlice` in graphrefly-ts and docstrings on `ReactiveLogBundle.tail` / `log_slice` in `graphrefly.extra.data_structures` (Py).

### 17b. Phase 3.2b composite patterns parity (`verifiable`, `distill`)

Both ports now align on the following:

- **Falsy option values are honored** (`trigger`, `context`, `consolidateTrigger`) by checking only for `null`/`undefined` (`None` in Python), not truthiness.
- **Extraction/consolidation are atomic**: each `Extraction` payload applies inside one outer `batch`, so downstream observers do not see intermediate partial states for multi-op updates.
- **Extraction contract is strict**: `upsert` is required by contract; malformed payloads are ignored by internal sink wiring (no imperative exception leakage to caller).
- **Eviction contract is explicit**: `evict` accepts `boolean | Node<boolean>` on both sides.

### Resolved design items (low priority)

1. **`_is_cleanup_fn` / `isCleanupFn` treats any callable return as cleanup (resolved 2026-03-31 — document limitation).** Both languages use `callable(value)` / `typeof value === "function"`. A compute function cannot emit a callable as a data value — it will be silently swallowed as cleanup. **Decision:** Document this as a known limitation in JSDoc/docstrings on `node()` and in API docs. No wrapper or opt-out flag — the pattern is well-documented, extremely rare in practice, and adding `{ cleanup: fn }` would add API surface for a near-zero use case.

2. **Describe `type` before first run (operator vs derived).** Both ports: `describeKind` / `describe_kind` on `NodeOptions` and sugar (`effect`, `producer`, `derived`); operators that only use `down()`/`emit()` still infer via `_manualEmitUsed` / `_manual_emit_used` after a run unless `describeKind: "operator"` / `describe_kind="operator"` is set.

3. **Tier 1 extra operators (roadmap 2.1).** TypeScript ships `src/extra/operators.ts`; Python ships `graphrefly.extra.tier1`. **Parity aligned (2026-03-28):**

   | Operator | Aligned behavior |
   |----------|-----------------|
   | `skip` | Both count wire `DATA` only (via `onMessage`); initial dep settlement does not consume a skip slot |
   | `reduce` | Both: COMPLETE-gated fold — accumulate silently, emit once on COMPLETE (not alias for `scan`) |
   | `race` | Both: winner-lock — first source to emit DATA wins, continues forwarding only that source |
   | `merge` | Both: dirty bitmask tracking; single DIRTY downstream per wave; `COMPLETE` after all sources complete |
   | `zip` | Both: only DATA enqueues (RESOLVED does not, per spec §1.3.3); COMPLETE when a source completes with empty buffer or all complete |
   | `concat` | Both: buffer DATA from second source during phase 0; replay on handoff |
   | `takeUntil` | Both: default trigger on DATA only from notifier; optional `predicate` for custom trigger |
   | `withLatestFrom` | Both: full `onMessage` — suppress secondary-only emissions; emit only on primary settle |
   | `filter` | Both: pure predicate gate — no implicit dedup (use `distinctUntilChanged` for that) |
   | `scan` | Both: delegate equality to `node(equals=eq)`, no manual RESOLVED in compute |
   | `distinctUntilChanged` | Both: delegate to `node(equals=eq)` |
   | `pairwise` | Both: explicit RESOLVED for first value (no pair yet) |
   | `takeWhile` | Both: predicate exceptions handled by node-level error catching (spec §2.4) |
   | `startWith` | Both: inline `a.emit(initial)` then `a.emit(v)` in compute |
   | `combine/merge/zip/race` | Both: accept empty sources (degenerate case: empty tuple or COMPLETE producer) |
   | `last` | Both: sentinel for no-default — empty completion without default emits only COMPLETE |

   **Deferred QA items:** see §Deferred follow-ups.

4. **Tier 2 extra operators (roadmap 2.2).** Python ships `graphrefly.extra.tier2` (`threading.Timer`); TypeScript ships `src/extra/operators.ts` (`setTimeout`/`setInterval`). **Parity aligned (2026-03-28):**

   | Operator | Aligned behavior |
   |----------|-----------------|
   | `debounce` | Both: flush pending value on COMPLETE before forwarding COMPLETE |
   | `delay` | Both: only delay DATA; RESOLVED forwarded immediately |
   | `throttle` | Both: `leading` (default `true`) + `trailing` (default `false`) params |
   | `audit` | Both: trailing-only (Rx `auditTime`); timer starts on DATA, emits latest when timer fires; no leading edge |
   | `sample` | Both: trigger on notifier `DATA` only (RESOLVED ignored) |
   | `buffer` | Both: flush trigger on notifier `DATA` only |
   | `bufferCount` | Both: throw on `count <= 0` |
   | `repeat` | Both: throw on `count <= 0` |
   | `scan` | Both: `resetOnTeardown: true` |
   | `concatMap` | Both: optional `maxBuffer` / `max_buffer` queue depth limit |
   | `switchMap` / `exhaustMap` / `concatMap` / `mergeMap` | Both: inner ERROR unsubscribes inner; outer ERROR tears down all active inners |
   | `pausable` | Both: protocol-level PAUSE/RESUME buffer; buffers DIRTY/DATA/RESOLVED while paused, flushes on RESUME |
   | `window` | Both: true sub-node windows (emits `Node<T>` per window, not arrays); notifier-based |
   | `windowCount` | Both: true sub-node windows of `count` items each |
   | `windowTime` | Both: true sub-node windows of `ms`/`seconds` duration |
   | `merge` / `zip` | TS: BigInt bitmask (no >31-source overflow); Python: unlimited-precision int |

   `gate(source, control)` — value-level boolean gate. Both ports (parity aligned 2026-03-28).

   **Deferred QA items:** see **Deferred follow-ups** → *Tier 2 extra operators (roadmap 2.2) — deferred semantics (QA)*.

5. **Sources & sinks (roadmap 2.3).** TypeScript ships `src/extra/sources.ts` + `src/extra/cron.ts`; Python ships `graphrefly.extra.sources` + `graphrefly.extra.cron`. **Parity aligned (2026-03-28):**

   | Source/Sink | Aligned behavior |
   |-------------|-----------------|
   | `fromTimer` / `from_timer` | Both: `(delay, { period? })` — one-shot emits `0` then COMPLETE; periodic emits `0, 1, 2, …` every `period` (never completes). TS: `signal` (AbortSignal) support; Py: no signal (deferred). |
   | `fromCron` / `from_cron` | Both: built-in 5-field cron parser (zero external deps); emits wall-clock `timestamp_ns` via `wallClockNs()` / `wall_clock_ns()`. TS: `output: "date"` option for Date objects. |
   | `fromIter` / `from_iter` | Both: synchronous drain, one DATA per item, then COMPLETE. Error → ERROR. |
   | `of` | Both: `fromIter(values)` / `from_iter` under the hood. |
   | `empty` | Both: synchronous COMPLETE, no DATA. |
   | `never` | Both: no-op producer, never emits. |
   | `throwError` / `throw_error` | Both: immediate ERROR. |
   | `fromAny` / `from_any` | Both: Node passthrough, then async/iterable/scalar dispatch. Scalar → `of(value)`. |
   | `forEach` / `for_each` | Both: return unsubscribe callable (`() => void`). TS: `onMessage`-based; Py: sink-based with optional `on_error`. |
   | `toArray` / `to_array` | Both: reactive Node — collect DATA, emit `[…]` on COMPLETE. |
   | `share` | Both: ref-counted upstream wire; pass `initial: source.get()`. |
   | `cached` | Both: `replay(source, 1)` / `replay(source, buffer_size=1)`. |
   | `replay` | Both: real circular buffer + late-subscriber replay; reject `bufferSize < 1`. |
   | `firstValueFrom` | TS: `Promise<T>` (resolves on first DATA, rejects on ERROR/COMPLETE-without-data). Py: `first_value_from(source, timeout=)` blocks via `threading.Event`. |
   | `toSSE` / `to_sse` | Both: standard SSE frames (`event:` + `data:` lines + blank line), DATA/ERROR/COMPLETE mapping, optional keepalive comments, optional DIRTY/RESOLVED inclusion, and transport-level cancellation without synthetic graph ERROR frames. |
   | `describeKind` | Both: source factories use `"producer"` (not `"operator"`). |
   | Static source timing | Both: synchronous emission during producer start (no deferred microtask). |

   **Intentional divergences:**

   | Topic | Python | TypeScript | Rationale |
   |-------|--------|------------|-----------|
   | `fromEvent` / `from_event_emitter` | `from_event_emitter(emitter, event, add_method=, remove_method=)` — generic emitter | `fromEvent(target, type, opts?)` — DOM `addEventListener` API | Language ecosystem |
   | `to_list` (blocking) | Py-only: blocks via `threading.Event`, returns `list` | N/A — use `await firstValueFrom(toArray(src))` | Py sync bridge |
   | `first_value_from` | Py-only: sync bridge | `firstValueFrom`: `Promise<T>` | Language concurrency model |
   | `to_sse` / `toSSE` return type | Iterator of SSE text chunks (`Iterator[str]`) | WHATWG stream (`ReadableStream<Uint8Array>`) | Language runtime idiom |
   | `fromPromise` / `from_awaitable` | `from_awaitable`: worker thread + `asyncio.run` | `fromPromise`: native Promise | Language async model |
   | `fromAsyncIter` / `from_async_iter` | Worker thread + `asyncio.run` | Native async iteration | Language async model |
   | `fromHTTP` / `from_http` transform input | `transform(raw_bytes: bytes)` | `transform(response: Response)` | Runtime/library shape (`urllib` bytes vs Fetch `Response`) |
   | `fromHTTP` external cancellation | No external signal (deferred); unsubscribe suppresses late emissions | Supports external `AbortSignal` via options | Language/runtime cancellation primitives |
   | AbortSignal on async sources | Not supported (deferred) | `signal` option on `fromTimer`, `fromPromise`, `fromAsyncIter` | TS has native AbortSignal; Py deferred |

   **Resolved (2026-03-31):** When implemented, async sources (`from_timer`, `from_awaitable`, `from_async_iter`) will accept the same `CancellationToken` protocol from parity follow-up #7 (a small interface with `.is_cancelled` property and `.on_cancel(fn)` callback registration, backed by `threading.Event`). `TEARDOWN`-via-unsubscribe remains the primary cancellation path; the token is for external/cooperative cancellation. Implementation deferred until a concrete user hits the gap, but the cancellation token design is settled.

### M. Worker bridge (roadmap §5.3) — TS-only, cross-language note

Worker bridges (`workerBridge` / `workerSelf`) are JavaScript/browser-specific (Worker, SharedWorker, ServiceWorker, BroadcastChannel, MessagePort). Python would use `multiprocessing.Queue`, `threading`, or ZMQ-based bridges instead — different transport but same wire protocol concept.

**Wire protocol design:**
- Messages with `messageTier >= 2` cross the wire. Known tier 0/1 (DIRTY, INVALIDATE, PAUSE, RESUME) stay local to each side's reactive graph.
- DATA values go through the coalescing path (derived + effect). RESOLVED, COMPLETE, ERROR, TEARDOWN forward as signal/error messages.
- Unknown `Symbol.for()` types always forward (spec §1.3.6 — forward-compat). Round-tripped via `Symbol.keyFor()` / `Symbol.for()`.
- Lifecycle signals serialize as string names (Symbols can't survive structured clone).
- Error payloads serialize to `{ message, name, stack }` since Error objects don't survive structured clone.
- Batch coalescing via `derived()` + `effect()`: two-phase push + bitmask gives natural coalescing — one `postMessage` per reactive cycle.
- Connection status uses `meta` companion nodes (not a separate `withConnectionStatus` wrapper).
- Optional `timeoutMs` for handshake timeout — sets `meta.error` and destroys on timeout.

**Decided against READY as a spec message type (2026-03-31):** The handshake `{ t: "r" }` wire message is transport-level, not graph-level. Connection readiness is already expressed as `meta.status` DATA change ("connecting" → "connected"). No spec change needed.

**Python parity:** If `graphrefly-py` adds a thread/process bridge, reuse the same wire protocol message types (`"v"`, `"b"`, `"r"`, `"i"`, `"s"`, `"e"`) and handshake sequence. Transport layer will differ (no `postMessage`).

## Resolved design decisions (cross-language, 2026-04-03)

- **Per-factory `resubscribable` option (Phase 7.1+, resolved 2026-04-03 — option (b) per-factory opt-in):** Add `resubscribable?: boolean` to `reactiveLayout` / `reactiveBlockLayout` options (default `false`). When true, adapter errors emit ERROR but the node can be re-triggered via INVALIDATE. Broader audit across all extra factories deferred — apply the option incrementally as use cases arise. Pre-1.0, no backward compat concern.

- **`SvgBoundsAdapter` regex hardening (Phase 7.1, resolved 2026-04-03):** Strip `<!--...-->` and `<![CDATA[...]]>` from SVG content before viewBox/width/height extraction. Document that input should be a single root SVG element. Additionally, expose an `SvgParserAdapter` interface so users can opt in their own parser for complex SVG inputs (e.g. DOMParser-based). Default: built-in regex parser. Cross-language: PY exposes equivalent `SvgParser` protocol.

- **`sample` + `undefined` as `T` (Tier 2, resolved 2026-04-03 — no action):** Documented limitation. TypeScript emits RESOLVED instead of DATA when cache holds `undefined`. Python does not have this ambiguity. No sentinel needed.

- **`mergeMap` + `ERROR` cascading (Tier 2, resolved 2026-04-03 — no action):** Documented limitation. Inner errors do not cascade to siblings. Current behavior (independent inner lifecycles) is more useful for parallel work. Document in JSDoc.

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

**Status:** Resolved (2026-04-03) — infrastructure already in place
**Impact:** Low-medium (bundle + minor runtime)
**Priority:** Low

`package.json` declares `"sideEffects": false` and the inspector gate uses standard `process.env.NODE_ENV === "production"` checks. Consumer bundlers (webpack, esbuild, Vite) automatically dead-code-eliminate these branches in production mode. No library-level `define` override needed — that would bake in a specific NODE_ENV at library build time, which is incorrect for a published package.

---

## Design decisions (QA review)

These came out of QA review. Most are now **resolved** (2026-03-31); remaining items are deferred with rationale.

### A. `COMPLETE` when all dependencies complete

**Resolved (2026-03-31, Option A3):** Auto-completion is controlled via `completeWhenDepsComplete` (TS) / `complete_when_deps_complete` (Python). Both ports already expose this option. Defaults: **`true`** for effect and operator nodes (matches spec §1.3.5 — effects complete when all deps complete), **`false`** for derived nodes (derived nodes should stay alive for future `INVALIDATE` / resubscription). Most operators already set `completeWhenDepsComplete: false` explicitly.

**Rationale:** The spec mandates effect-node completion; derived nodes benefit from staying alive for invalidation and Graph lifecycle. The existing opt-in flag gives maximum flexibility.

### B. More than 31 dependencies

**Resolved.** Bitmask tracking now uses a `BitSet` abstraction that falls back to segmented `Uint32Array` for >31 deps (see Built-in §5 / Potential §2).

### C. `graph.disconnect` vs `NodeImpl` dependency lists (QA 1d #2)

**Resolved (2026-03-31, Option C1 — registry-only):** `Graph.disconnect(from, to)` removes the `(from, to)` pair from the graph’s **edge registry** only. It does **not** mutate the target node’s constructor-time dependency list, bitmasks, or upstream subscriptions. This is the **long-term contract**.

**Why registry-only is correct:** Dependencies are fixed at node construction. True single-edge removal would require partial upstream unsubscribe, bitmask width resizing, diamond invariant recalculation, and thread-safety rework in Python — enormous complexity for a niche use case. For runtime dep rewiring, use `dynamicNode` (Phase 0.3b), which handles full dep-diff, bitmask rebuild, and subscription lifecycle.

**Contract:** `disconnect` is a registry/bookkeeping operation. `describe()` and `edges()` are the source of truth for registered topology. Message flow follows constructor-time deps, not the edge registry. Document this clearly in JSDoc/docstrings and API docs.

### D. Tier-2 time operators — `asyncio` vs wall-clock timers

**Resolved (2026-03-31 — keep `threading.Timer` as default, defer `asyncio`):** `graphrefly.extra.tier2` uses wall-clock **`threading.Timer`**. Callbacks emit via **`Node.down(..., internal=True)`**, which takes the **subgraph write lock** when **`thread_safe`** is true (default), so timer threads stay consistent with synchronous graph work **without** requiring a running **`asyncio`** loop.

**Rationale:** The current design is correct and portable. Optional **`asyncio`**-based scheduling (e.g. **`loop.call_soon_threadsafe`**) can be added later only when a concrete user reports integration friction with an existing event loop, while keeping **`threading.Timer`** as the default baseline.

**TypeScript (parity note):** The same product split applies on the JS side: tighter integration with the host’s **event loop / task queue** vs timer primitives that do not assume a specific runtime; align cross-language when either port adds loop-integrated scheduling.

### E. Roadmap §3.1b callback coercion scope (`fromAny` / `from_any`)

**Resolved (Option 2):** Public higher-order operators in TypeScript (`switchMap`, `concatMap`, `mergeMap`, `exhaustMap`) and Python (`switch_map`, `concat_map`, `merge_map`, `exhaust_map`) now accept callback outputs as **Node, scalar, Promise/Awaitable, Iterable, or AsyncIterable**, with coercion through `fromAny` / `from_any`.

**Rationale:** Better ergonomics and stronger parity with AI-generated integration code while preserving the single reactive output model.

### F. Phase 4.1 orchestration API shape (`pipeline` + step naming collisions)

**Resolved (Option B):** Orchestration primitives ship under a grouped namespace (`patterns.orchestration.*`), not as colliding top-level exports. This keeps Phase 2 `extra` names (`forEach`, `gate`) intact while exposing solution-level workflow APIs as domain constructs.

**Current contract:** `patterns.orchestration.gate` / `approval` / `branch` / `task` are workflow-step builders over `Graph` topology and lifecycle, not aliases of stream-only `extra` operators/sinks.

**Parity note:** `describe().nodes[*].meta` now uses canonical key `orchestration_type` in both ports for orchestration step metadata.

### G. Phase 4.1 `loop(iterations)` coercion contract

**Resolved:** Orchestration `loop` uses a shared **permissive numeric parse + truncate** rule in both ports:

- Parse iteration input permissively (numeric values and numeric-like strings).
- Truncate toward zero.
- Clamp negatives to `0`.
- If parse is non-finite/invalid, default to `1`.
- Empty string and `null`/`None` normalize to `0`.

**Rationale:** Keeps orchestration ergonomics AI-friendly while preserving deterministic cross-language behavior.

### H. Phase 5.2 WebSocket adapter seam (`fromWebSocket` / `toWebSocket`)

**Resolved subset:** Both ports now support the same practical seam for source/sink adapters:

- Source supports either runtime socket listener wiring or explicit register-style wiring.
- Inbound payload normalization uses `event.data` when present, otherwise the raw event payload.
- Sink supports optional terminal close metadata (`close_code`/`close_reason` in Python, `closeCode`/`closeReason` in TypeScript).

**Rationale:** This keeps adapters thin and runtime-friendly while preserving parity for message shaping and terminal close behavior.

**Note:** Lifecycle and sink error-policy behavior are tracked separately below under
**WebSocket adapter lifecycle and error-policy seams**.

### I. TC39 compat read/subscribe terminal semantics (`Signal.get` / `Signal.sub`)

**Resolved (2026-03-31, Option I1 — strict data-only):** Both ports standardize on **strict data-only** compat APIs:

- `get()` **never throws** and returns the last good value when status is `errored`.
- `Signal.sub` forwards **only `DATA`** — terminal/error tuples remain in the core/node API layer.

**Rationale:** The compat layer should be the simplest possible bridge to framework APIs. Users who need terminal observability should use the core `subscribe` / `node` APIs directly. This matches the spec's `get()` contract and keeps the compat surface minimal.

### J. WebSocket adapter lifecycle and error-policy seams (`fromWebSocket` / `toWebSocket`)

**Resolved (2026-03-31, Option J1 — eager teardown + propagate):** Both ports standardize on:

1. **Eager terminal teardown:** Listeners are detached immediately on first terminal message (`COMPLETE`/`ERROR`). Close is idempotent — repeated terminal calls are no-ops.
2. **Propagate sink errors:** `send`/`close` transport exceptions are surfaced as protocol-level `[[ERROR, err]]` to callers, not swallowed.

**Rationale:** Keep it simple and predictable. Resources are freed immediately; errors are visible. Users who need reconnect behavior can layer `retry` on top — that's what the resilience operators are for.

### K. Adapter behavior contract scope (`fromWebhook` / `fromWebSocket` / `toWebSocket`)

**Resolved (2026-03-31, Option K1 — define canonical contract now):** A shared cross-language adapter contract covers:

1. **Register callback expectations:** `register` must return a cleanup callable. Registration is atomic — the cleanup callable is valid immediately. Errors thrown during registration are forwarded as `[[ERROR, err]]`.
2. **Terminal-time ordering:** Cleanup runs **before** terminal tuple emission. Listeners are detached before `COMPLETE`/`ERROR` propagates downstream.
3. **Sink transport failure handling:** Transport exceptions (`send`/`close` failures) surface as `[[ERROR, err]]` — never swallowed, never thrown to caller (see §J). Callback payloads are structured and non-throwing by contract.
4. **Idempotency:** Repeated terminal input (multiple `COMPLETE`/`ERROR`) is idempotent — first terminal wins, subsequent are no-ops. Malformed input is ignored (no crash).

**Action (done):** `docs/ADAPTER-CONTRACT.md` defined in both repos with mirrored integration tests.

### L. `fromFSWatch` / `from_fs_watch` event contract and path matching

**Resolved (2026-03-31):** Cross-language adapter contract for filesystem watch sources now standardizes on:

1. **Debounce-only, no polling fallback** (event-driven watcher backends only),
2. **Dual-path glob matching** against both absolute path and watch-root-relative path,
3. **Expanded payload shape** with `path`, `root`, `relative_path`, `timestamp_ns`,
4. **Rename-aware payloads** (TS classifies `fs.watch` rename notifications with best-effort `create`/`delete` and preserves `rename` fallback; Py preserves move/rename semantics and includes `src_path`/`dest_path` when available),
5. **Watcher error handling via protocol** (`[[ERROR, err]]`) with teardown-latched cleanup.

**Rationale:** Prevent silent filter mismatches, preserve rename semantics, and keep lifecycle/error behavior inside GraphReFly message protocol without violating the no-polling invariant.

---

## Deferred follow-ups (QA)

Non-blocking items tracked for later; not optimizations per se. Keep this section **identical** in `graphrefly-py/docs/optimizations.md` and here (aside from language-specific labels in the first table).

| Item | Notes |
|------|-------|
| **`lastDepValues` + `Object.is` / referential equality (resolved 2026-03-31 — keep + document)** | Default `Object.is` identity check is correct for the common immutable-value case. The `node({ equals })` option already exists for custom comparison. Document clearly that mutable dep values should use a custom `equals` function. No code change needed. |
| **`sideEffects: false` in `package.json`** | TypeScript package only. Safe while the library has no import-time side effects. Revisit if global registration or polyfills are added at module load. |
| **JSDoc / docstrings on `node()` and public APIs** | `docs/docs-guidance.md`: JSDoc on new TS exports; docstrings on new Python public APIs. |
| **Roadmap §0.3 checkboxes** | Mark Phase 0.3 items when the team agrees the milestone is complete. |

### AI surface (Phase 4.4) — behavioral semantics parity (resolved 2026-03-31)

Cross-language notes for `patterns.ai` / `graphrefly.patterns.ai`. **Keep this subsection aligned in both repos’ `docs/optimizations.md`.**

| Topic | Resolution |
|-------|------------|
| **`agent_loop` / `agentLoop` — LLM adapter output** | `invoke` may return a plain `LLMResponse`, or any `NodeInput` (including `Node`, awaitables, async iterables). Implementations coerce with `fromAny` / `from_any`, prefer a synchronous `get()` when it already holds an `LLMResponse`, then **block until the first settled `DATA`** (`subscribe` + `Promise` in TypeScript; `first_value_from` in Python). Do not unsubscribe immediately after `subscribe` without waiting for emissions. |
| **`toolRegistry` / `tool_registry` — handler output** | Handlers may return plain values, Promise-like values, or reactive `NodeInput`. **TypeScript:** `execute` awaits Promise-likes, then resolves **only** `Node` / `AsyncIterable` via `fromAny` + first `DATA` (do **not** pass arbitrary strings through `fromAny` — it treats strings as iterables and emits per character). **Python:** `execute` uses `from_any` + `first_value_from` only for awaitables, async iterables, or `Node`; plain values return as-is. |
| **`agentMemory` / `agent_memory` — factory scope** | **Resolved (2026-03-31):** Ship as-designed. The full in-factory composition (`knowledgeGraph` + `vectorIndex` + `lightCollection` + `decay` + `autoCheckpoint`, opt-in via options) will be implemented per the resolved design decision at the top of this document. A single `agentMemory(name, { vectorDimensions, embedFn, enableKnowledgeGraph })` call provides batteries-included memory. Implementation to follow. |

### AI surface (Phase 4.4) — parity follow-ups

| # | Topic | Notes |
|---|--------|-------|
| **3** | **`_invoke_llm` / `_invokeLLM` defensive alignment** | **TypeScript** (`_invokeLLM`): rejects `null`/`undefined` and plain `str` before `fromAny` (strings would iterate per character); accepts sync plain objects with `content` when not a Promise/`Node`. **Python** (`_invoke_llm`): should mirror those guards — reject `None`; reject `str`; do not pass raw `dict`/`Mapping` through `from_any` without normalizing to `LLMResponse` (iterating a `dict` yields keys). **Status:** pending implementation in `graphrefly-py`. |
| **4** | **`LLMInvokeOptions` + cooperative cancellation** | **Resolved (2026-03-31):** Python will use a `CancellationToken` protocol — a small interface with `.is_cancelled` property and `.on_cancel(fn)` callback registration, backed internally by `threading.Event`. This mirrors TS's `AbortSignal` pattern. The token is passed from `AgentLoopGraph` into `adapter.invoke()`. Adapters react to cancellation via `.on_cancel()` callbacks (no polling — respects the reactive invariant). The protocol can be extended to `asyncio.Event` backing later. **TypeScript** retains `AbortSignal` via `LLMInvokeOptions.signal`. |

Normative anti-patterns table: [**Implementation anti-patterns**](#implementation-anti-patterns) (top of this document).

### AI surface (Phase 4.4) — resolved follow-ups (2026-03-31)

| Item | Resolution |
|------|------------|
| **keepalive subscription cleanup on destroy** | `ChatStreamGraph`, `ToolRegistryGraph`, and `systemPromptBuilder` create keepalive subscriptions (`n.subscribe(() => {})`) that are never cleaned up. **Auto-fixable:** add `destroy()` methods that unsubscribe keepalive sinks to prevent leaks in long-lived processes. |
| **`AgentLoopGraph.destroy()` does not cancel running loop (resolved — internal abort signal)** | `destroy()` sets an internal `AbortController` signal; the `run()` loop checks it between iterations. Composes with existing `fromPromise({ signal })`. No polling — reactive cancellation via abort signal. Rejected: (b) reject-only (doesn't stop the LLM call); (c) document-as-limitation (violates `destroy()` safety contract). |
| **`chatStream.clear()` + `append()` race (resolved — serialize via `batch()`)** | Both `clear()` and `append()` internally use `batch()` so they are atomic within a reactive cycle. Callers who need deterministic ordering across multiple mutations use `batch(() => { stream.clear(); stream.append(msg); })`. No new mechanism needed — uses existing protocol. Rejected: (b) arbitrary "clear wins" rule; (c) microtask queue (fights the reactive-not-queued invariant). |

### AI surface (Phase 4.4) — deferred optimizations (QA 2026-03-31)

| Item | Status | Notes |
|------|--------|-------|
| **Re-indexes entire store on every change** | Deferred | Decision: diff-based indexing using `Versioned` snapshot version field to track indexed entries. Deferred to after Phase 6 — current N is small enough that full re-index is acceptable pre-1.0. |
| **Budget packing always includes first item** | Documented behavior | The retrieval budget packer always includes the first ranked result even if it exceeds `maxTokens`. This is intentional "never return empty" semantics — a query that matches at least one entry always returns something. Callers who need strict budget enforcement should post-filter. |
| **Retrieval pipeline auto-wires when vectors/KG enabled** | Documented behavior | When `embedFn` or `enableKnowledgeGraph` is set, the retrieval pipeline automatically wires vector search and KG expansion into the retrieval derived node. There is no explicit opt-in/opt-out per retrieval stage — the presence of the capability implies its use. Callers who need selective retrieval should use the individual nodes directly. |

### Tier 1 extra operators (roadmap 2.1) — resolved semantics (2026-03-31)

Applies to `src/extra/operators.ts` and `graphrefly.extra.tier1`. **Keep the table below identical in both repos’ `docs/optimizations.md`.**

| Item | Resolution |
|------|------------|
| **`takeUntil` / `take_until` + notifier `DIRTY` (resolved — DATA-only trigger)** | The notifier must emit **`DATA`** to terminate the primary. `DIRTY` is phase-1 transient signaling; termination is permanent and must only trigger on settled phase-2 data. Aligns with compat adapter rule (ignore DIRTY waves). A notifier that only sends DIRTY+RESOLVED (no payload change) never triggers — by design. |
| **`zip` + partial queues (resolved — drop + document)** | When one inner source completes, buffered values that never formed a full tuple are **dropped**; downstream then completes. This matches RxJS behavior and the zip contract (all slots always filled). Callers who need all values should use `combineLatest` or `merge`. Document in JSDoc/docstrings. |
| **`concat` + `ERROR` on the second source before the first completes (resolved — fail-fast short-circuit)** | `ERROR` from **any** source (even buffered/inactive) immediately terminates `concat`. Silent error swallowing is a bug magnet; fail-fast is the safer pre-1.0 default. Callers who need “ignore inactive source errors” can wrap source 2 in `retry` or `catchError`. |
| **`race` + pre-winner `DIRTY` (resolved — keep current + document)** | Before the first winning `DATA`, `DIRTY` from multiple sources **may** forward downstream. This is transient and harmless — downstream handles it via normal settlement. A stricter “winner-only” implementation adds complexity for minimal gain. Document the behavior clearly in JSDoc/docstrings. |

### Tier 2 extra operators (roadmap 2.2) — deferred semantics (QA)

Applies to `src/extra/operators.ts` and `graphrefly.extra.tier2`. **Keep the table below identical in both repos’ `docs/optimizations.md`.**

| Item | Status | Notes |
|------|--------|-------|
| **`sample` + `undefined` as `T`** | Documented limitation (2026-03-31) | Sampling uses the primary dep’s cached value (`get()`). If `T` allows `undefined`, a cache of `undefined` is indistinguishable from “no snapshot yet”; TypeScript currently emits `RESOLVED` instead of `DATA` in that case (JSDoc `@remarks`). This is a known TS-specific edge case (Python does not have the `undefined` ambiguity). Document in JSDoc; no sentinel needed. |
| **`mergeMap` / `merge_map` + `ERROR`** | Documented limitation (2026-03-31) | When the outer stream or one inner emits `ERROR`, other inner subscriptions may keep running until they complete or unsubscribe. Rx-style “first error cancels all sibling inners” is **not** specified or implemented. Current behavior (inner errors don’t cascade) is arguably more useful for parallel work — no change needed. Document in JSDoc/docstrings. |

### Ingest adapters (roadmap 5.2c / 5.3b) — deferred items (QA)

Applies to `src/extra/adapters.ts` and `graphrefly.extra.adapters`. **Keep the table below identical in both repos’ `docs/optimizations.md`.**

| Item | Status | Notes |
|------|--------|-------|
| **`fromRedisStream` / `from_redis_stream` never emits COMPLETE** | Documented limitation (2026-04-03) | Long-lived stream consumers intentionally never complete. The consumer loop runs until teardown. This is expected behavior for persistent stream sources (same as Kafka). Document in JSDoc/docstrings. |
| **`fromRedisStream` / `from_redis_stream` does not disconnect client** | Documented limitation (2026-04-03) | The caller owns the Redis client lifecycle. The adapter does not call `disconnect()` on teardown — the caller is responsible for closing the connection. Same contract as `fromKafka` (caller owns `consumer.connect()`/`disconnect()`). |
| **PY `from_csv` / `from_ndjson` thread not joined on cleanup** | Documented limitation (2026-04-03) | Python file-ingest adapters run in a daemon thread. On teardown, `active[0] = False` signals the thread to exit but does not `join()` it. The daemon flag ensures the thread does not block process exit. A future optimization could add optional `join(timeout)` on cleanup for stricter resource control. |

### Ingest adapters — intentional cross-language divergences (parity review 2026-04-03)

| Aspect | TypeScript | Python | Rationale |
|--------|-----------|--------|-----------|
| **`KafkaConsumerLike` protocol** | KafkaJS shape: `subscribe({topic, fromBeginning})`, `run({eachMessage})`, `disconnect()` | confluent-kafka shape: `subscribe(topics: list)`, `run(callback)` | Each port targets its ecosystem's dominant Kafka client library. Both are duck-typed; users plug in their library's consumer directly. |
| **`RedisClientLike` protocol** | ioredis shape: `xadd(key, id, ...fieldsAndValues)`, `xread(...args)` — variadic positional | redis-py shape: `xadd(name, fields: dict)`, `xread(streams: dict)` — dict-based | Same reasoning: each port matches the dominant Redis client for its ecosystem. Serialize defaults match (`string[]` vs `dict[str, str]`). |
| **`toSSE` / `to_sse` return type** | `ReadableStream<Uint8Array>` (Web Streams API) | `Iterator[str]` (Python generator) | Language-native streaming idiom. TS uses Web Streams for SSE (compatible with `Response` constructor); PY uses generators (compatible with WSGI/ASGI streaming responses). |
| **`fromPrometheus` / `fromClickHouseWatch` `signal` option** | `signal: AbortSignal` for external cancellation | No equivalent; uses `active[0]` flag on teardown | PY has no standard `AbortSignal`. External cancellation in PY is handled by unsubscribing (which triggers the cleanup/stop function). Both ports stop cleanly on teardown. |
| **`SyslogMessage` field naming** | camelCase: `appName`, `procId`, `msgId` | snake_case: `app_name`, `proc_id`, `msg_id` | Language convention applied to output data structures. Each port follows its ecosystem's naming idiom. |
| **`fromCSV` / `fromNDJSON` source type** | `AsyncIterable<string>` (async streams with chunk buffering) | `Iterable[str]` (sync iterators via threads) | PY uses threads for I/O concurrency; sync iterables are natural for `csv.reader` integration. TS uses async iteration for streaming I/O. |
| **`PulsarConsumerLike` protocol** | `pulsar-client` JS shape: `receive()` returns Promise, `acknowledge(msg)` returns Promise, getter methods (`getData()`, `getTopicName()`, etc.) | `pulsar-client` PY shape: `receive()` blocking, `acknowledge(msg)` sync, attribute methods (`data()`, `topic_name()`, etc.) | Each port matches the native Pulsar client API for its ecosystem. TS uses async loop; PY uses threaded blocking loop. |
| **`PulsarProducerLike.send()` call shape** | Single object: `send({data, partitionKey, properties})` | Positional + kwargs: `send(data, partition_key=..., properties=...)` | Matches respective native Pulsar client SDK calling conventions. |
| **`PulsarMessage` field naming** | camelCase: `messageId`, `publishTime`, `eventTime` | snake_case: `message_id`, `publish_time`, `event_time` | Language convention applied to output data structures. |
| **`NATSClientLike` protocol** | nats.js shape: `subscribe()` returns `AsyncIterable`, `publish(subject, data)` | Dual: sync iterable (threaded drain) or async iterable/coroutine (via `Runner`). Auto-detected at subscribe time. Optional `runner` kwarg. | TS uses native async iteration. PY auto-detects sync vs async subscriptions: sync uses threaded drain, async uses `resolve_runner().schedule()`. Both support queue groups. |
| **`RabbitMQChannelLike` protocol** | amqplib shape: `consume(queue, callback)` returns `Promise<{consumerTag}>`, `cancel(tag)`, `ack(msg)`, `publish(exchange, routingKey, content)` | pika shape: `basic_consume(queue, on_message_callback, auto_ack)`, `start_consuming()`, `basic_ack(delivery_tag)`, `basic_publish(exchange, routing_key, body)` | Each port matches its ecosystem's dominant AMQP library. Pika requires `start_consuming()` to enter the event loop; amqplib's consume is promise-based. |
| **`RabbitMQMessage` field naming** | camelCase: `routingKey`, `deliveryTag` | snake_case: `routing_key`, `delivery_tag` | Language convention applied to output data structures. |

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
| Production debug stripping | Resolved (§3) | `sideEffects: false` + `process.env.NODE_ENV` gate; consumer bundlers strip | Production builds |
| COMPLETE-all-deps semantics | Resolved (§A) | Effect/operator default true; derived default false | `completeWhenDepsComplete` option |
| `graph.disconnect` vs `NodeImpl` deps | Resolved (§C) | Registry-only is the long-term contract | Use `dynamicNode` for runtime rewiring |
