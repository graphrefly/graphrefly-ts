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

- **Message array allocation in hot path (proposed, 2026-04-11):**
  Every `down([[DIRTY], [DATA, v]])` allocates two inner arrays + one outer array per write. This is the primary GC pressure source in write-heavy workloads. Options: (a) intern common message tuples (singleton `DIRTY_MSG = [DIRTY]` as frozen object), (b) accept pre-allocated message batches, (c) `emit()` path already frames internally — encourage `emit` over raw `down` for state writes. Benchmark `emit` vs `down` to quantify. **Partially landed 2026-04-12 (A2):** 6 payload-free tuples interned (`DIRTY_MSG`, `RESOLVED_MSG`, `INVALIDATE_MSG`, `START_MSG`, `COMPLETE_MSG`, `TEARDOWN_MSG`) plus 5 pre-wrapped batch singletons. Closes the alloc cost for tier-1/tier-5 control signals. Tier-3 DATA/ERROR still allocate per-call because they carry payloads — see passthrough `[msg]` wrapper item below.

- **Passthrough `[msg]` wrapper allocation — single-message `_emit` overload (proposed, 2026-04-13):**
  `_onDepMessage` passthrough branch (`src/core/node.ts:1088, 1097`) and the unknown-type forward-compat branch forward a single dep message by calling `this._emit([msg])` — a fresh one-element array wrapper per forwarded message. A2 interning doesn't help here: the inner tuple is `[DATA, v]` / `[ERROR, e]` which carries a per-call payload, and even if the inner was reusable the outer `[...]` wrapper is a new allocation. For passthrough-heavy graphs (identity operators, describe/observe layers, `graph.connect()`-spliced wrappers) this is 1 wasted allocation per forwarded message — in a 100K msg/sec write-heavy workload through a 5-level passthrough chain, ~500K wasted allocs/sec. GC pressure, not latency.
  **Fix shape:** add a single-message overload to `_emit`:
  ```ts
  _emit(messages: Messages): void;
  _emit(single: Message): void;
  _emit(input: Messages | Message): void { /* shape-discriminate like normalizeMessages */ }
  ```
  Passthrough callers become `this._emit(msg)` with zero wrapper alloc. The discrimination still allocates one array inside `_emit` in the slow path, but `_frameBatch`'s existing `messages.length === 1` fast path can be specialized further to avoid even that.
  **Why deferred:** (a) bench doesn't currently exercise passthrough — `linear 10-node chain` uses `derived`, not identity passthrough, so the win isn't measured; need a passthrough bench variant first. (b) Touches `_emit`'s signature which every core caller hits — worth doing in a standalone focused pass with before/after numbers so the delta is attributable. (c) Additive, not a correctness issue.
  **Prereq:** add a passthrough-heavy bench variant to `src/__bench__/graphrefly.bench.ts` to quantify the win before committing the refactor.

- **Fan-out scaling — sink notification overhead (proposed, 2026-04-11):**
  10→100 subscribers drops throughput 4x (3.1M→762K). Sink array is iterated with per-sink `downWithBatch` calls. Potential: share the same message array reference across sinks (already immutable by convention), reduce per-sink overhead to a single function call without re-framing.

- **P3 audit: `.cache` reads inside fn/subscribe callbacks (updated 2026-04-12):**
  Call sites reading `.cache` on a node from inside a reactive context (fn body, subscribe callback, or project function) — bypassing protocol delivery. These work "by accident" when execution is synchronous but could return stale values under batch deferral.

  **Originally tracked (still open):**
  1. `operators.ts:994` — `forwardInner` reads `inner.cache` after subscribe to seed value for synchronous producers. Fragile under batch.
  2. `composite.ts:78` — `sourceNode.cache` inside switchMap project fn. Should receive value through the trigger/dep protocol.
  3. `composite.ts:184` — `verdict.cache === true` inside derived fn. (Cross-ref: distill eviction redesign item below.)
  4. `resilience.ts:624` — `out.meta.status.cache === "errored"` in subscribe callback. Should react to status changes via protocol.
  5. `resilience.ts:733` — `(fb as Node<T>).cache` reads fallback value in callback. Should subscribe to fallback node.
  6. `adapters.ts:394` — `fetchCount.cache ?? 0` in subscribe callback. Should use protocol-delivered value.

  **Added by 2026-04-12 full scan:**
  7. `composite.ts:128` via `asReadonlyMap` called at `composite.ts:162` and `:214` — `store.entries.cache` inside switchMap project fns. **Folded into distill eviction redesign item below.**
  8. ~~`worker/bridge.ts:126` — exposed-node aggregator derived fn reads `n.cache` per entry instead of using the protocol-delivered `data` array.~~ **Attempted positional-zip fix 2026-04-12, reverted.** Root cause turned out to be framework-level: the aggregator's `lastSent` diff requires **wave-final** state across all exposed nodes, but the current framework only exposes wave-progressive state through `data[]`. When callers use raw `state.down([[DATA, v]])` (no DIRTY prefix), each dep's DATA delivery runs the fn independently with a partial `data[]` snapshot — the first run emits `{a: newA}`, the second emits `{b: newB}`, and the test "coalesces batch updates into single message" breaks because two wire messages go out instead of one. `.cache`, by contrast, is always fresh because `state.down()` writes the cache synchronously before queuing downstream delivery. **Fix deferred to the Option B worker-bridge redesign below**, which needs either (a) a framework-level "wave-end" hook for deriveds, (b) a primitive that always settles as one wave regardless of caller down/emit style, or (c) a different aggregator topology that doesn't need wave-final state. Inline comment added at `bridge.ts` + `self.ts` marking the exception.
  9. `worker/bridge.ts:138` — `(data[0] ?? aggregated.cache)` in effect fn; the `?? aggregated.cache` fallback stays for the same reason as #8 (consistent with the cache-based aggregator above). Same at `worker/self.ts:114`.
  10. `worker/bridge.ts:283` — `statusNode.cache === "connecting"` inside a `setTimeout` handshake-timeout callback. **Folded into worker bridge handshake-timer item below.**
  11. `orchestration.ts:350` — `if (isOpenNode.cache)` inside `gate()`'s manual `src.node.subscribe` DATA handler. `isOpenNode` is not declared as a dep of the producer — the gate decision rides entirely on an out-of-protocol read. High-impact correctness site (gate is the harness's flow control primitive). **Deferred 2026-04-12** — needs its own design pass (see dedicated item below).
  12. `reduction.ts:132` (`stratifyRule`) — `rulesNode.cache` inside a hand-rolled two-dep settlement state machine. `rulesNode` *is* a declared dep, but rules' DATA payload is discarded by the handler and re-read via `.cache`. The state machine exists specifically to avoid stale-rules races, then reads rules through `.cache` anyway. **Fix plan: replace with `withLatestFrom(source, rulesNode)` + filter.**
  13. `reduction.ts:482` (`budgetGate.checkBudget`) — `c.check(c.node.cache)` inside producer fn. Constraint nodes are declared deps; fix by threading the fn's `data` array into `checkBudget`.

  **Gray zone — self-owned counter reads (same rule, different judgment call):**
  14. `reduction.ts:402` — feedback effect reads+writes its own `counter` state node via `.cache` inside `condNode.subscribe`. Counter is not a declared dep (no protocol path to receive it).
  15. `harness/loop.ts:366, 368, 386, 388` — `totalRetries` / `totalReingestions` counters read+written via `.cache` inside `fastRetry` effect. **Fix plan: Option A — encapsulate in a local `tryIncrementBounded(node, cap)` helper with a documented "self-owned counter" P3 exception.**
  16. ~~`ai.ts:1915` — `retrieveFn` writes `queryInput` then reads `retrievalDerived.cache`, assuming synchronous settlement. Also uses a closure-variable (`lastTrace`) as a side channel to publish to `traceState`.~~ **Landed 2026-04-12 (Option W).** `retrievalDerived`, `queryInput`, and the `lastTrace` closure were deleted; `retrieval` and `retrievalTrace` are now `state()` nodes that `retrieveFn` batch-writes on every call. The consumer API stays sync. `store.entries.cache` and `contextNode.cache` are read at external-API call time (boundary reads, explicitly sanctioned by foundation-redesign §3.6). JSDoc marks `retrieveFn` as "do not call from reactive fn bodies" — if we ever want to invoke retrieval from inside a reactive context, we'll need a separate reactive entry point. **Revisit item: the `feedback_no_imperative` memory line says public APIs should be reactive-first; `retrieveFn` is now explicitly imperative. Worth revisiting whether `agentMemory.retrieve` should instead (a) stay imperative and be documented as a consumer-API exception alongside `graph.get(name)` / `chat.allMessages()`, or (b) gain a reactive sibling (a `query` NodeInput that drives a derived) for use cases that want to pipe queries reactively. No action needed until such a use case shows up.**

  **Acceptable — documented boundary / wiring-time exceptions (not violations):**
  - `core/sugar.ts:245, 251` — `dynamicNode` discovery stub (P3 boundary exception, explicitly documented).
  - `core/meta.ts:75, 134` + `graph/profile.ts:100` + `graph/graph.ts:881` — inspection/describe tooling.
  - `extra/resilience.ts:163, 398, 571, 655, 755, 837, 899`, `extra/sources.ts:112, 733, 769`, `patterns/cqrs.ts:243`, `patterns/messaging.ts:92`, `extra/reactive-log.ts:139, 186` — factory-time `initial:` seeding from `source.cache` (foundation-redesign session §3.6 explicitly allows this as "external observer reads at wiring time").
  - `patterns/messaging.ts` (retained/ack/pull/bridgedCount), `patterns/memory.ts` (readMap/readArray), `patterns/ai.ts` (allMessages/register/unregister/execute/getDefinition), `patterns/orchestration.ts:623` — external-consumer API methods called synchronously from outside the graph.
  - `extra/cascading-cache.ts:207` — read during external-consumer `load()` write path (demote-before-evict).
  - `extra/worker/bridge.ts:188` + `self.ts:251` — transport "worker ready" boundary handler; reads current state to build initial snapshot for wire transport.
  - `src/compat/{react,vue,solid,svelte,jotai,nanostores,signals,zustand,nestjs}/…` — framework adapter layer; consumer-framework getSnapshot/render calls.

  **QA findings from 2026-04-12 review:**
  - **H1 — budgetGate first-wave constraint freshness (patched 2026-04-12).** The original factory-time `latestValues = constraints.map(c => c.node.cache)` seed was stale if a caller updated a constraint between factory return and first subscribe. Fix applied: seed moved to inside the producer fn (activation-time boundary read) so constraint updates between factory and subscribe are reflected before `source`'s push-on-subscribe fires `checkBudget()` for the first time. **Follow-up concern:** even activation-time seeding has a narrow window where the subscribe-order matters — source is subscribed first, so its push-on-subscribe fires before any constraint subscribe runs. If the constraint value at activation-time differs from what the constraint would emit on its push-on-subscribe (unlikely but possible if the constraint is a derived that recomputes on subscribe), the first `checkBudget` could still see a stale value. Possible future tightening: reverse the subscribe order (constraints first, source last) so each constraint's push-on-subscribe populates `latestValues` via the handler before source's first DATA arrives. Deferred — the activation-time seed covers all cases observed in the test suite.
  - **BH-1 — retrieveFn inside caller batches (documented 2026-04-12).** `agentMemory.retrieve(q)` reads `distillBundle.store.entries.cache` and `contextNode.cache` at call time. If a caller invokes it inside their own `batch(() => { distillBundle.insert(...); mem.retrieve(q); })`, the store's state-backed mutations are visible (state.down writes cache synchronously), but derived-backed store transforms may not have settled yet. JSDoc caveat added to `AgentMemoryGraph.retrieve`. No runtime fix — this is a semantic of the sync API design.
  - **BH-2 — state-write house style: `[[DATA, v]]` without explicit `[DIRTY]` prefix (pre-existing, not introduced by the 2026-04-12 diff).** `src/patterns/ai.ts` has 14+ call sites that write state nodes with `[[DATA, v]]` instead of `[[DIRTY], [DATA, v]]` (e.g. `cancelSignal.down([[DATA, ++cancelCounter]])` at `:861`, `this.definitions.down([[DATA, next]])` at `:1117`/`:1125`, `_statusState.down([[DATA, ...])` at `:2048+`). Spec §1.3.1 says DIRTY should precede DATA; the framework's equals-substitution dispatch (`SESSION-foundation-redesign.md` §3.5.1) synthesizes a DIRTY prefix when needed, which is why this works today. If the house style is wrong, it's a codebase-wide cleanup pass — the QA diff under review matches the existing convention. Not a regression. Defer until the dispatch-layer invariant is audited for the "no equals substitution → no synthetic DIRTY" path (does it still prepend DIRTY for raw-down on state nodes, or only when DATA→RESOLVED substitution actually fires?).
  - **M1 — extractStoreMap silent empty-Map for sentinel snapshots (pre-existing, not introduced by the 2026-04-12 diff).** `extractStoreMap<TMem>(snapshot)` at `src/patterns/ai.ts:1537–1540` returns `new Map()` for any non-`Map` snapshot (including sentinel/undefined). Callers of `retrieveFn` can't distinguish "store not populated yet" from "store is empty" — both return `[]`. The new sync `retrieveFn` amplifies the likelihood of being called before the store settles (there's no reactive first-run gate). Defer — helper has been this shape since the original retrieval pipeline landed; if we care, the fix is either (a) throw on sentinel with a "store not ready" error, or (b) JSDoc-document the silent-empty semantics.

  **Suggested fix order** (from the 2026-04-12 scan triage):
  - **Landed 2026-04-12:**
    - #16 `retrieveFn` — Option W (sync pure inline + state writes). See above.
    - #12 `stratify._addBranch` — Option A (symmetric `latestRules` capture from the rules subscribe handler; keeps the original two-dep settlement state machine because neither `withLatestFrom` nor a plain producer-subscribe preserves the "future items only" silence-on-rules-only semantic under the framework's DIRTY auto-propagation).
    - #13 `budgetGate.checkBudget` — seeded `latestValues[]` closure, updated from the constraint subscribe handler's DATA branch. **QA-patched (H1):** seed moved from factory time to activation time inside the producer fn.
    - #15 harness counters — `tryIncrementBounded(node, cap)` helper encapsulates the read-modify-write with a documented self-owned-counter exception. Comment rewritten after QA to explain why it's safe today (single-threaded runner + synchronous `counter.down` cache-write).
  - **Deferred, tracked separately:**
    - #8/#9 worker bridge aggregator — attempted positional zip, reverted. Framework-level blocker (wave-final vs wave-progressive state), folds into Option B worker-bridge redesign below.
    - #10 worker bridge handshake timer — own item below.
    - #11 `orchestration.ts` gate — own item below.
  - **Later:** #1, #2, #4, #5, #6 (original audit) — each needs case-by-case structural work. #14 (feedback counter) pairs with harness-counter exception. #7 (composite/asReadonlyMap) + #3 pair with distill eviction redesign (below).

- **`orchestration.ts` `gate()` — `isOpenNode.cache` inside producer subscribe (proposed, 2026-04-12):**
  `gate()` at `src/patterns/orchestration.ts:350` reads `isOpenNode.cache` inside its producer's manual `src.node.subscribe` DATA handler. `isOpenNode` is not declared as a dep of the producer (`node<T>([], ...)` with empty deps), so the entire gate decision — pass the item through or enqueue it — rides on an out-of-protocol cache read. Same class as the stratify #12 issue: producer pattern with multiple effective dependencies that bypass the framework's settlement machinery.
  **High-impact:** gate is the harness's flow-control primitive (used by QUEUE→GATE→EXECUTE and by `promptNode`/`harnessLoop` approval flows). Under the current synchronous runner this works because cache reads are always fresh, but the decision is one wave off from "correct under any runner."
  **Fix options:**
  (a) Same pattern as stratify #12 Option A: capture `isOpenNode` DATA into a `latestIsOpen` closure variable updated from an `isOpenNode.subscribe` handler registered in the producer setup. Seed from `isOpenNode.cache` at wiring time.
  (b) Declare `isOpenNode` as a secondary dep via `withLatestFrom(src.node, isOpenNode)` — but inherits the same "future items only" silence issue stratify ran into under rules-only changes; probably doesn't match gate's intended semantics either.
  (c) Restructure gate to use a dep-declared node with `ctx.dataFrom` gating on the primary source, similar to how `withLatestFrom` handles primary-only emission — requires verifying terminal forwarding and RESOLVED suppression.
  Option (a) is lowest-risk and matches the pattern we landed for stratify. Deferred to a dedicated session so the orchestration test suite can be exercised thoroughly after the change.

- **Framework primitive: wave-final state for multi-dep derived (proposed, 2026-04-12):**
  The worker-bridge aggregator #8 blocker shows a real gap: there's no clean way for a `derived`'s fn to access the **wave-final** values of all deps when callers use raw `state.down([[DATA, v]])` without a DIRTY prefix. Under raw-down delivery, each dep's DATA fires the fn independently (because no dep is marked dirty to block `allSettled`), so `data[]` only contains progressive snapshots. `.cache` works today because `state.down()` writes the cache synchronously before queuing downstream delivery — but that's a runner-invariant exception, not a protocol guarantee.
  **Design options to explore:**
  (a) **Wave-end hook** — a second fn called once per wave after all `data[]` settlements, receiving the full final snapshot. Framework-level change.
  (b) **Coerce DIRTY prefix on raw down for state nodes** — if `state.down([[DATA, v]])` synthesized a DIRTY before delivery, `_markDepDirty` would fire, `allSettled` would gate correctly, and `data[]` would become wave-final. Would need to verify backward compat with current raw-down use cases (many tests rely on this exact shape).
  (c) **Dedicated "batchDerived" / "snapshot" primitive** — a one-shot-per-wave operator built on top of `derived` that buffers intermediate calls and only emits on wave end. Can be implemented outside `core/` using `ctx.store` for cross-run state.
  Depends on: worker-bridge Option B redesign (below) — that item is blocked on this primitive.

- **Worker bridge handshake timer → reactive deadline (proposed, 2026-04-12):**
  `extra/worker/bridge.ts:281–292` uses a raw `setTimeout` with `opts.timeoutMs` as a one-shot handshake deadline, then reads `statusNode.cache === "connecting"` inside the callback to decide whether the worker ever answered. Two overlapping violations: (a) raw `setTimeout` bypasses the central time abstraction (§5.11 "Non-central time"), and (b) `.cache` read inside a non-reactive async callback (P3 audit #10 above). Not a polling pattern — it's a single-fire race between the handshake and the deadline — so the severity is lower than the aggregator bug, but worth fixing for consistency.
  **Alternatives:**
  (a) `fromTimer(timeoutMs)` + `take(1)` as a one-shot deadline node, composed with the `"r"` ready message via a `race`/`first` primitive. Requires confirming that `fromTimer` supports one-shot mode (or that `take(1)` on a periodic timer is the idiom) and that a `race` primitive exists (may need to compose from `merge` + `first`).
  (b) Drive the deadline from a `fromTimer` source and an internal "handshake settled" state node; gate the timeout action on `!handshakeSettled` via a `derived` instead of reading `statusNode.cache`.
  Blocked on: audit of `fromTimer` one-shot semantics and confirming `race`/`first` primitive availability.

- **Worker bridge snapshot-delivery redesign (proposed, 2026-04-12):**
  `extra/worker/bridge.ts:121–135` and `extra/worker/self.ts:95–110` implement exposed-node aggregation as a `derived` with `equals: () => false` that reads every exposed node's `.cache` inside its fn and diffs against a `lastSent` closure Map. The `.cache` reads (P3 audit #8/#11) will be fixed in the short term by zipping the fn's `data` array with `exposeEntries` positionally (Option A — local, no wire-protocol change). **Long-term direction (Option B): drop the `lastSent` closure diffing in favor of per-node `equals`-based RESOLVED suppression**, so the aggregator emits the full current snapshot on real changes only and disables `equals: () => false`. This is the same structural theme as distill eviction — both use closure state to work around "framework doesn't deliver snapshots shaped the way I need them."
  **Reasons to defer:** (a) changing `lastSent` semantics affects the wire protocol (`{t: "b", u: updates}` currently implies per-field deltas; Option B would send full snapshots); (b) the fix is structurally similar enough to distill eviction that both should be considered under a unified "snapshot delivery" redesign rather than patched independently.
  Blocked on: (1) wire-protocol review for delta vs. full-snapshot emission, (2) alignment with distill eviction redesign (below) so both land consistently.

- **Distill eviction redesign — reactive verdict tracking (deferred, 2026-04-12):**
  `distill()` eviction with `Node<boolean>` verdicts was patched during foundation v5 rewrite with `forEach(verdict, ...)` subscriptions — functional but adds subscribe overhead per-key. The original design used `dynamicNode` to track verdict deps automatically. Redesign options: (a) store mutation events (§6 "composite.ts eviction — store mutation events") so verdict changes flow as protocol messages, (b) reactive per-entry eviction nodes managed internally by the store, (c) keep `forEach` approach but add cleanup-on-delete tracking. Separate session; blocked on store mutation event design.
  **P3 violations folded into this redesign (2026-04-12 scan):**
  - `composite.ts:128` `asReadonlyMap(store)` reads `store.entries.cache` from *inside* the `switchMap` project fn at `composite.ts:162` (extraction stream) and again at `composite.ts:214` (consolidation stream). Same class as the `composite.ts:78` switchMap verify violation — the snapshot is pulled through `.cache` instead of being delivered through the switchMap's outer source value. Fix belongs with the store-mutation-events redesign, not as a standalone patch (the whole `extractFn(raw, readonlyView)` signature assumes synchronous snapshot access).
  - `composite.ts:184` `verdict.cache === true` inside the `evictionKeys` derived fn — already tracked in the P3 audit list (§P3 item 3), noted here for cross-reference.

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

- **Stream extractor unbounded re-scan on every chunk (2026-04-09):**
  All stream extractors (`keywordFlagExtractor`, `toolCallExtractor`, `costMeterExtractor`, and generic `streamExtractor`) re-process the entire `accumulated` string from scratch on every `StreamChunk`. For long streams this is O(n×k) total work (n = final length, k = chunk count). `toolCallExtractor`'s brace-scanning is especially expensive. Optimization: maintain a cursor/offset between invocations so each chunk only processes the delta. Deferred — acceptable pre-1.0 where streams are short (LLM output typically <10K chars).

- **Stream extractor redundant emissions on identical chunks (2026-04-09):**
  If two consecutive `StreamChunk`s produce identical extracted results (e.g., same keyword flags), the extractor still re-emits a new array/object instance. Downstream subscribers miss memoization opportunities. Optimization: pass a structural `equals` function to the `derived` node options to suppress redundant emissions via `RESOLVED`. Deferred — identical consecutive chunks are rare in practice (accumulated text grows monotonically).

- **[py-parity-equals-dispatch-invariant] Equals substitution parity (TS 2026-04-12 → PY deferred):**
  TS landed the dispatch-layer equals-substitution invariant on 2026-04-12: every outgoing DATA payload runs through a single equals-vs-live-cache walk inside `_updateState`, regardless of emission path (`actions.emit`, raw `actions.down`, passthrough forwarding, bundle-wrapped down). Includes synthetic-DIRTY prefix for raw-down substitution (spec §1.3.1 compliance) and equals-throw atomicity (prefix delivered before ERROR). See `archive/docs/SESSION-foundation-redesign.md` §3.5.1–.2 + §9.8 and `src/core/node.ts:_emit` / `_updateState` for the TS impl; `src/__tests__/core/node.test.ts` `§3.5` describe block for the regression suite.
  **PY status:** not yet ported. `~/src/graphrefly-py/src/graphrefly/core/node_base.py` still runs equals inside `_down_auto_value` (pre-foundation-redesign shape), and raw `down` does NOT participate in equals substitution. Matches TS's pre-2026-04-12 behavior. Blocked on PY completing the foundation redesign (see §9.5 PY implementation plan). When that lands, port the TS invariant verbatim: move equals to the dispatch-layer walk, add synthetic-DIRTY prefix rule, implement equals-throw atomicity contract, port the `§3.5` test block. Ship atomically with the PY foundation rewrite.

- **`withLatestFrom` — secondary terminates before primary DATA (deferred, 2026-04-13):**
  If the secondary (dep 1) sends COMPLETE or ERROR before the primary (dep 0) ever sends DATA, `ctx.latestData[1]` is `undefined` when primary first fires. The operator emits `[primaryValue, undefined]` — a silent pairing with a missing secondary value. The `_sentinelDepCount` gate prevents the fn from running before both deps have delivered their first DATA/terminal, so this only manifests if secondary terminates *after* its first settlement but *before* primary's first DATA. Low priority: `withLatestFrom` is normally wired with a long-lived secondary. Fix: add a terminal-check guard for dep 1 in the fn (skip or down COMPLETE/ERROR when secondary is already terminal) and a test in the `withLatestFrom` describe block covering secondary-terminates-before-primary.

- **Graph causal trace logs `latestData` scalars, not `batchData` (deferred, 2026-04-13):**
  `Graph.observe` causal trace hooks fire in `_execFn` with the `latestData` snapshot (one scalar per dep), not the full `batchData` batch. Multi-value waves (batch size > 1) are invisible to observability tooling — trace shows only the last known value per dep, not all the values that arrived this wave. Low priority pre-1.0 because multi-value batches are rare in practice (most sources emit one value per wave). Fix when adding structured tracing: pass `batchData` alongside `latestData` in the inspector hook payload so observability consumers can distinguish scalar and batch waves.

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
