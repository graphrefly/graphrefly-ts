# Batch 4–8 Audit — Processed Results

**Date:** 2026-03-29
**Scope:** graphrefly-ts + graphrefly-py

---

## Changes Applied

### 1. Stale docstring fix (Batch 4 §9)

- **TS** `graph.ts:204` — `g.register(...)` → `g.add(...)` in class docstring example.

### 2. NodeImpl barrel leak (Batch 4 §9)

- **TS** `core/index.ts` — switched from `export * from "./node.js"` to named exports, excluding `NodeImpl`. Internal consumers (`meta.ts`, `graph.ts`) import directly from `./node.js`.

### 3. PubSubHub class unexported + `removeTopic()` (Batch 4 §5, Batch 8 §5)

- **TS** `pubsub.ts` — `PubSubHub` changed from exported class to exported interface. Implementation moved to private `PubSubHubImpl`. Added `removeTopic(name): boolean` that sends `TEARDOWN` and deletes the topic node.
- **Py** `data_structures.py` — Added `remove_topic(name: str) -> bool` method to `PubSubHub` class (thread-safe with `self._lock`), sends `TEARDOWN` and deletes topic.

### 4. replay() returns real NodeImpl (Batch 4 §9)

- **TS** `sources.ts` — `wrapSubscribeHook` now creates a real `NodeImpl` via `node()` (derived passthrough) with a patched `subscribe` method, instead of a plain object literal. `replay()` and `cached()` nodes now work with `Graph.add()` and `Graph.connect()`.
- **Py** — N/A (Python `_ReplayNode` already subclasses `NodeImpl`).

### 5. Bounded reactive log (Batch 8 §2.3 — P0)

- **TS** `reactive-log.ts` — Added `maxSize?: number` to `ReactiveLogOptions`. When set, the buffer is trimmed from head after mutations. Added `appendMany(values)` and `trimHead(n)` methods to `ReactiveLogBundle`.
- **Py** `data_structures.py` — Added `max_size: int | None` parameter to `reactive_log()`. Added `append_many(values)` and `trim_head(n)` methods to `ReactiveLogBundle`.

### 6. Resilience API standardized to direct form (Batch 4 §4)

Converted `retry` and `rateLimiter`/`rate_limiter` from curried/pipe form to direct form, matching operator conventions.

| Before | After |
|--------|-------|
| `retry({ count: 2 })(src)` | `retry(src, { count: 2 })` |
| `pipe(src, retry({ count: 2 }))` | `retry(src, { count: 2 })` |
| `rateLimiter(1, NS)(src)` | `rateLimiter(src, 1, NS)` |
| `pipe(src, rate_limiter(2, 0.06))` | `rate_limiter(src, 2, 0.06)` |

- **TS** — `resilience.ts`, tests, backoff.ts docstring updated. Removed unused `PipeOperator` import.
- **Py** — `resilience.py`, tests updated. Removed unused `PipeOperator` TYPE_CHECKING import.

**Rationale:** All operators in `operators.ts`/`tier1.py` use direct form `op(source, ...config)`. `withStatus` and `withBreaker` already used direct form (justified by bundle return types). Making `retry`/`rateLimiter` direct eliminates the only curried exceptions.

### 7. Python type alias style (Batch 5 §5b)

Standardized 5 plain-assignment type aliases to PEP 695 `type` statements (codebase already requires 3.12+):

- `node.py`: `NodeStatus = str` → `type NodeStatus = str`
- `node.py`: `NodeFn = Callable[...]` → `type NodeFn = Callable[...]`
- `guard.py`: `GuardAction = str` → `type GuardAction = str`
- `protocol.py`: `EmitStrategy`, `DeferWhen` Literal aliases converted

### 8. Python missing `__all__` (Batch 5 §6b)

- `graph/graph.py` — Added `__all__` with `Graph`, `GraphObserveSource`, `PATH_SEP`, `GRAPH_META_SEGMENT`, `GRAPH_SNAPSHOT_VERSION`, `META_PATH_SEG`.
- `extra/cron.py` — Added `__all__ = ["CronSchedule", "matches_cron", "parse_cron"]`.

### 9. Python drain iteration guard (Batch 6 §7)

- `protocol.py` — Added `_MAX_DRAIN_ITERATIONS = 1000` constant and guard in `_drain_pending` that raises `RuntimeError("batch drain exceeded 1000 iterations")`, matching TS `batch.ts`.

### 10. P0 + P1 edge-case tests (Batch 7)

- **TS** `src/__tests__/extra/edge-cases.test.ts` — 24 tests covering:
  - Debounce flush-on-complete, cancel-on-error, complete-without-pending
  - Throttle COMPLETE/ERROR forwarding
  - Timeout timer cleanup on complete/error, timer reset on DATA
  - Merge ALL-complete semantics, error propagation
  - switchMap outer-complete waits for inner, inner error propagation
  - concatMap/exhaustMap inner error propagation
  - Diamond glitch-freedom (combine invariant assertion)
  - Reentrancy safety (state change during emission, self-unsubscribe)
  - combine error/single-source, concat error, filter no-dedup, batch coalescing

- **Py** `tests/test_edge_cases.py` — 19 tests (15 pass, 4 xfail):
  - Same P0 coverage (debounce, throttle, timeout, merge)
  - Same P1 coverage (diamond, reentrancy, combine, concat, batch)
  - 4 xfailed tests document real Python implementation gaps (see below)

---

## Implementation Gaps Found (xfailed tests)

These tests confirm bugs that Batch 7 identified. They exist as `pytest.mark.xfail` tests for future fixing:

| Gap | TS | Py | Severity |
|-----|----|----|----------|
| `switchMap` outer-COMPLETE doesn't wait for active inner | Fixed | **Bug** | P1 |
| `switchMap` inner ERROR not forwarded | Fixed | **Bug** | P1 |
| `concatMap` inner ERROR not forwarded | Fixed | **Bug** | P1 |
| `exhaustMap` inner ERROR not forwarded | Fixed | **Bug** | P1 |

---

## Remaining Items (not addressed in this pass)

### From Batch 7 — P2 test gaps (~50 tests)

- Reconnect/reset semantics (scan seed reset, skip counter reset)
- Push/pull consistency (`get()` matches last subscribed value)
- `distinctUntilChanged` NaN/+0/-0 edge cases, custom comparator
- Share/cached/replay cleanup on zero subscribers
- Buffer operators: `bufferTime` flush-on-complete, cancel-on-error
- Window operator edge cases

### From Batch 8 — data structure gaps

| Item | Priority | Notes |
|------|----------|-------|
| PubSub topic GC (auto-cleanup) | P2 | `removeTopic()` added; auto-GC deferred |
| Reactive map TTL=0, negative TTL validation (TS) | P2 | Py validates; TS does not |
| LFU eviction policy | P2 | Not ported from callbag-recharge |
| List move/swap operations | P2 | Not ported |
| Checkpoint non-JSON types warning | P2 | Silently loses data on round-trip |
| IndexedDB adapter tests (TS) | P2 | Entirely untested |
| SQLite checkpoint thread-safety (Py) | P1 | No mutex wrapping — concurrent writes corrupt |
| Concurrent circuit breaker transitions | P2 | Py has locks but no contention test |

---

## Verification

| Check | TS | Py |
|-------|----|----|
| Tests | 300 passed | 291 passed, 1 skipped, 4 xfailed |
| Lint | Clean (biome) | N/A |
| Build | Clean (tsup) | N/A |
