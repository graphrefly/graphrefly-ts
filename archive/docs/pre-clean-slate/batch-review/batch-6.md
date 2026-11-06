# Batch Review 6 — callbag-recharge Design Cross-Reference

Cross-referencing known design lessons and optimizations from callbag-recharge against
both GraphReFly implementations (TS + Python).

**Date:** 2026-03-29

---

## 1. OUTPUT SLOT OPTIMIZATION (spec §6.2)

**IMPLEMENTED (both)**

Both repos use the `null → single sink (function) → Set<sink>` tri-state pattern for
`_sinks`, saving Set allocation overhead for the ~70-80% of nodes with 0-1 subscribers.

- **TS:** `node.ts:327` — `_sinks: NodeSink | Set<NodeSink> | null = null`
  - Subscribe: `null → sink` (line 499), `function → new Set([prev, sink])` (line 502)
  - Unsubscribe: `Set → function` when size=1 (line 527-529), `function → null` (line 524)
  - Dispatch: `node.ts:573-584` — `_emitToSinks` checks `null`, `typeof === 'function'`,
    then iterates Set with snapshot for reentrancy safety.

- **Python:** `node.py:242` — `_sinks: Callable | set[Callable] | None = None`
  - Subscribe: `None → sink` (line 567-568), `callable → {prev, sink}` (line 572)
  - Unsubscribe: `set → single` when len=1 (line 589-590), `callable → None` (line 593-594)
  - Dispatch: `node.py:283-293` — `_emit_to_sinks` checks `isinstance(set)`, snapshot for
    reentrancy, else direct call.

---

## 2. SINGLE-DEP OPTIMIZATION (spec §6.3)

**IMPLEMENTED (both)**

When a node has exactly one dep and is the sole subscriber, DIRTY is stripped from
batches that also contain a phase-2 message (DATA/RESOLVED). Standalone DIRTY still
passes through.

- **TS:** `node.ts:636-638` — `_canSkipDirty()` returns true when
  `_sinkCount === 1 && _singleDepSinkCount === 1`.
  Applied in `_downInternal` (lines 455-476): inline check for phase-2, then filter
  DIRTY messages out before `downWithBatch`.

- **Python:** `node.py:342-343` — `_can_skip_dirty()` identical logic.
  Applied in `_down_body` (lines 696-713): same phase-2 check and filter.

Both implementations track `_singleDepSinkCount` / `_single_dep_sink_count` via
`SubscribeHints.singleDep` (TS: `node.ts:494-496`, Python: `node.py:563-565`).
The hint is set during `_connectUpstream` when `deps.length === 1 && fn != null`
(TS: `node.ts:798-799`, Python: `node.py:510-511`).

---

## 3. EQUALS ASYMMETRY

**IMPLEMENTED (both)**

Both repos handle the state-vs-derived asymmetry correctly:

**State nodes** (no deps, no fn beyond producer): `_downAutoValue` checks `_equals`.
If unchanged and already dirty: emit `[[RESOLVED]]`. If unchanged and NOT dirty:
emit `[[DIRTY], [RESOLVED]]`. Value never reaches sinks.

- **TS:** `node.ts:640-649` — `_downAutoValue` with `wasDirty` check.
- **Python:** `node.py:345-371` — `_down_auto_value` identical logic with thread-safe
  `_cache_lock` reads.

**Derived nodes** (deps + fn): `_runFn` computes dep values, then calls `_downAutoValue`
for the return value. Additionally, if all dep values are identity-equal to previous,
the fn is skipped entirely and RESOLVED is emitted (push-phase memoization).

- **TS:** `node.ts:663-676` — identity check on `_lastDepValues`, emit `[[RESOLVED]]`
  if all same.
- **Python:** `node.py:381-391` — same identity check with `all(... is ...)`.

---

## 4. NO RAW PROMISE/FUTURE

**IMPLEMENTED (both) — with acceptable boundary bridges**

Neither repo uses `new Promise()` or `asyncio.Future()` for reactive coordination in
core. Promise/Future usage is confined to boundary bridges in `extra/`:

- **TS `extra/sources.ts`:**
  - `promise()` source (line 212): `Promise.resolve(p).then()` — bridge from user Promise.
  - `firstValueFrom()` (line 430): `new Promise` — user escape hatch from reactive to imperative.
  - `asyncIterable()` (line 250-270): Promise-based async iteration pump.
  - `checkpoint.ts` (lines 230-252): `new Promise` wrapping IndexedDB requests — system boundary.

- **Python `extra/sources.py`:**
  - `from_awaitable()` (line 212-253): spawns worker thread with `asyncio.run()` — system boundary.
  - `from_async_iter()` (line 256-297): same pattern for async iterables.
  - `first_value_from_future()` (line 451-491): `concurrent.futures.Future()` — user escape hatch.

- **Core (both repos):** Zero Promise/Future usage. All reactive coordination is
  synchronous message-passing.

**queueMicrotask usage (TS only):**
  - `extra/sources.ts:102` — `delay()` source COMPLETE emission.
  - `extra/sources.ts:254-265` — `asyncIterable()` iteration pump and COMPLETE.
  - `extra/sources.ts:438,444,450` — `firstValueFrom()` safe unsubscribe.
  All are deferred cleanup after external async, not reactive coordination. Acceptable.

---

## 5. NO SETTIMEOUT FOR COORDINATION

**IMPLEMENTED (both)**

`setTimeout` / `threading.Timer` usage is confined to genuine time-based operators:

- **TS `extra/operators.ts`:**
  - `delay()` (line 1408-1428) — intentional delay operator.
  - `debounce()` / `throttle()` (lines 1458-1602) — time-based operators.
  - `audit()` (line 1716), `timeout()` (line 1758) — time operators.
  - `extra/resilience.ts:90-121` — `retry()` with backoff delay.

- **Python `extra/tier2.py`:**
  - `debounce_time`, `throttle_time`, `audit_time` — use `threading.Timer`.
  - `delay_when` — time-based delay.

- **Core (both repos):** Zero timer usage. Batch coordination is fully synchronous.
  No `queueMicrotask` or microtask scheduling in core paths.

---

## 6. TWO-PHASE PUSH CORRECTNESS

**IMPLEMENTED (both)**

The DIRTY-then-DATA/RESOLVED protocol is consistently enforced:

**Batch system defers only phase-2:**
- **TS:** `batch.ts:128-142` — `partitionForBatch` splits on `isPhase2Message` (DATA, RESOLVED).
  DIRTY propagates immediately even inside `batch()`.
- **Python:** `protocol.py:158-173` — `partition_for_batch` and `is_phase2_message` — identical.

**Diamond resolution via bitmask:**
- **TS:** `node.ts:696-715` — `_onDepDirty` sets dirty bit, forwards DIRTY on first dirty.
  `_onDepSettled` clears settled bit, recomputes when `settled.covers(dirty)`.
- **Python:** `node.py:422-436` — identical bitmask logic.

**No bypass paths found.** All `_downInternal` / `_down_body` calls go through
`downWithBatch`, which respects phase partitioning. The only message emission that skips
batch is passthrough for non-fn nodes forwarding lifecycle signals (TEARDOWN, PAUSE, etc.),
which is correct — lifecycle signals are not phase-2.

**One nuance worth noting:** In `_downAutoValue`, when a node is NOT dirty and emits
unchanged value, it sends `[[DIRTY], [RESOLVED]]` as a single `_downInternal` call.
Under batching, the partition splits this correctly — DIRTY goes immediately, RESOLVED
defers. Both repos handle this identically.

---

## 7. BATCH NESTING

**IMPLEMENTED (both)**

Both repos correctly handle nested `batch()` — only the outermost batch triggers flush.

- **TS:** `batch.ts:57-78` — `batchDepth` counter. Flush at `batchDepth === 0` only.
  Error handling: if `threw`, clear queue (unless `flushInProgress` — decision A4).
- **Python:** `protocol.py:113-149` — `bs.depth` counter (thread-local). Same flush-at-zero
  semantics. Error handling: check `sys.exc_info()[1]`, same A4 decision.

Both use iteration-limited drain loops to prevent infinite cycles:
- **TS:** `batch.ts:91-96` — `MAX_DRAIN_ITERATIONS = 1000`
- **Python:** No explicit iteration limit in `_drain_pending` (lines 89-110) — it drains
  until `bs.pending` is empty, with error aggregation.

**Minor difference:** Python uses `ExceptionGroup` for multiple drain errors (line 110),
TS re-throws only the first error (line 115). Both are valid approaches.

**Potential concern (Python):** No `MAX_DRAIN_ITERATIONS` guard in `_drain_pending`.
A pathological cycle could spin indefinitely. TS has the 1000-iteration cap. Consider
adding a matching guard to Python for parity.

---

## 8. TEARDOWN ORDERING

**IMPLEMENTED (both)**

Both repos follow the same teardown sequence: cleanup before notification, producer stop
after disconnect.

- **TS:** `node.ts:605-631` — TEARDOWN handler:
  1. Run `_cleanup` (line 613-614)
  2. Propagate TEARDOWN to meta nodes (lines 621-627)
  3. `_disconnectUpstream()` (line 629)
  4. `_stopProducer()` (line 630)
  `_stopProducer` (lines 817-823): clears `_producerStarted`, runs cleanup.

- **Python:** `node.py:319-340` — TEARDOWN handler:
  1. Run `_cleanup` (lines 325-328)
  2. Propagate TEARDOWN to meta nodes (lines 330-337)
  3. `_disconnect_upstream()` (line 339)
  4. `_stop_producer()` (line 340)
  `_stop_producer` (lines 522-530): clears `_producer_started`, runs cleanup, double-clears
  `_cleanup = None` (line 530 — redundant but harmless).

**Unsubscribe path:** Both repos disconnect upstream and stop producer when `_sinks`
becomes null (TS: lines 534-537, Python: lines 596-598). Upstream unsubs are spliced/cleared
before reset (TS: line 833, Python: lines 541-544).

**Meta node TEARDOWN:** Both repos propagate TEARDOWN to meta companions in try/catch,
best-effort (TS: lines 621-627, Python: lines 330-337). COMPLETE/ERROR intentionally NOT
propagated to allow post-mortem meta writes.

No resource leak paths identified.

---

## 9. INSPECTOR.ENABLED PATTERN

**NOT APPLICABLE**

GraphReFly uses a fundamentally different observation model. Instead of a global
`Inspector` singleton with an `enabled` flag:

- **TS:** Guard-based `allowsObserve()` (node.ts:418-421) checks per-node guard permission.
  Graph-level `observe()` (graph.ts:775-816) collects targets filtered by actor permissions.
  No global overhead when observation is not requested.

- **Python:** Same guard-based model — `allows_observe()` (node.py:760-765), graph-level
  `observe()` with actor filtering. Thread-local batch state adds no observation overhead.

The callbag-recharge `Inspector.enabled` pattern was needed because `Inspector.register()`
created WeakRefs on every node at construction time. GraphReFly has no analogous per-node
registration cost — observation is purely subscription-based.

**No overhead gating needed** — the architecture avoids the problem entirely.

---

## 10. DERIVED LAZINESS

**IMPLEMENTED (both)**

Derived nodes (deps + fn) do NOT compute at construction. Computation happens on first
subscriber.

- **TS:** `node.ts:347` — `_status = this._hasDeps ? "disconnected" : "settled"`.
  `_connectUpstream` (lines 791-815) is called from `subscribe` (line 508) — not from
  constructor. `_runFn()` is called at the end of `_connectUpstream` (line 813) — first
  computation happens here.

- **Python:** `node.py:225` — `_status = "disconnected" if self._has_deps else "settled"`.
  `_connect_upstream` (lines 502-520) called from `_subscribe_body` (line 574-575).
  `_run_fn()` at end of `_connect_upstream` (line 520).

**`get()` behavior:**
- **TS:** `node.ts:423-425` — returns `_cached` directly (may be `undefined` if not yet
  computed). No pull-compute.
- **Python:** `node.py:658-663` — returns `_cached` with optional lock. Same — no
  pull-compute.

This is a conscious design choice: `get()` returns the cached value (which may be the
`initial` option value or `undefined`/`None`). Unlike callbag-recharge where derived
eagerly connects to deps via closures for always-honest `.get()`, GraphReFly defers
everything until first subscription. This is the correct trade-off for GraphReFly since
nodes are typically graph-managed and subscribed before reading.

---

## Summary

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | Output slot optimization | IMPLEMENTED (both) | Identical tri-state null→fn→Set |
| 2 | Single-dep optimization | IMPLEMENTED (both) | Skip DIRTY when sole single-dep subscriber |
| 3 | Equals asymmetry | IMPLEMENTED (both) | State suppresses, derived uses RESOLVED |
| 4 | No raw Promise/Future | IMPLEMENTED (both) | Core clean; boundary bridges in extra/ only |
| 5 | No setTimeout for coordination | IMPLEMENTED (both) | Timers only in time-based operators |
| 6 | Two-phase push correctness | IMPLEMENTED (both) | No bypass paths found |
| 7 | Batch nesting | IMPLEMENTED (both) | **Python missing MAX_DRAIN_ITERATIONS guard** |
| 8 | Teardown ordering | IMPLEMENTED (both) | Cleanup → meta → disconnect → stop producer |
| 9 | Inspector.enabled pattern | NOT APPLICABLE | Guard-based model avoids global overhead |
| 10 | Derived laziness | IMPLEMENTED (both) | No compute until first subscribe |

### Action item

- **Python `protocol.py:_drain_pending`**: Add iteration limit matching TS's
  `MAX_DRAIN_ITERATIONS = 1000` to prevent unbounded drain loops. Low severity
  (requires pathological reactive cycle) but important for parity and safety.
