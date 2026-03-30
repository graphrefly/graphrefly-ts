# Batch 8: Data Structures & Resilience Cross-Reference

**Date:** 2026-03-29
**Scope:** callbag-recharge `src/data/` + `src/utils/` vs graphrefly-ts `src/extra/` vs graphrefly-py `src/graphrefly/extra/`

---

## 1. REACTIVE MAP

### 1.1 TTL Expiration Edge Cases

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Exact boundary timing | Tested (exact threshold and just after) | Tested (pruneExpired) | Tested (prune) | COVERED (both repos) |
| Concurrent set + TTL fire | Timer-based (`setTimeout`); race possible between async TTL fire and manual `set()` | Lazy expiration (no timers); checked on read/has/prune | Lazy expiration via `time.monotonic()`; checked on next mutation or explicit `prune()` | GAP (graphrefly-ts, graphrefly-py): lazy model avoids timer races but no test for read-during-expiry boundary (key expires between `has()` and `get()` in same tick) |
| TTL=0 (immediate expiry) | Not explicitly tested | Not tested | Not tested | GAP (both repos): no test for TTL=0 or very small TTL values |
| Negative TTL validation | Not applicable (unsigned) | Not tested | Raises `ValueError("ttl must be >= 0")` — tested | GAP (graphrefly-ts): no validation for negative TTL |

**RISK:** callbag-recharge uses active timers (`setTimeout`) for TTL which can race with manual `delete()`. graphrefly ports use lazy expiration (check on read), avoiding timer races but introducing a different issue: expired keys remain in memory until next access. Users who `set()` many TTL keys without reading them will leak memory until `pruneExpired()`/`prune()` is called.

### 1.2 Eviction Policy Correctness

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| FIFO ordering | Tested; lazy deletion with compaction | Uses native `Map` insertion order | Uses tuple-based history tracking | COVERED (both repos) |
| LRU access patterns (get + set) | Tested (both `get()` and `set()` touch) | Tested (get/has refresh position) | Tested (LRU eviction on capacity overflow) | COVERED (both repos) |
| LFU frequency tracking | Tested (O(1) bucket-based) | Not implemented | Not implemented | GAP (both repos): LFU not ported |
| New key cannot self-evict | Tested (special scoring logic) | Not tested | Not tested | RISK: callbag-recharge guards against a newly-inserted key being immediately evicted by its own `set()` call. graphrefly ports don't document this invariant. |
| Eviction + TTL interaction | Not tested | Not tested | Not tested | GAP (all repos): what happens when an expired-but-not-pruned key is the eviction candidate? |
| Scored eviction with throwing score fn | Tested (returns -Infinity) | Not implemented | Not implemented | N/A for graphrefly |

### 1.3 Reactive Notifications

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| set/delete/expire events | Tested (keyspace event notifications) | Snapshot-based versioned emission | Versioned snapshots with dedup | COVERED (both repos) — different mechanism |
| No-change suppression (set same value) | Custom `equals` tested | Version-based equality (always bumps on mutation) | Versioned equality skips downstream if version unchanged | GAP (graphrefly-ts): always emits snapshot on any mutation even if value unchanged. callbag-recharge supports custom equals to suppress. |

### 1.4 Iterator Invalidation During Mutation

- **callbag-recharge:** `keys()`, `values()`, `entries()` return snapshots (array copies), safe from mutation.
- **graphrefly-ts:** Snapshot-based; immutable `ReadonlyMap` exposed. Safe.
- **graphrefly-py:** Returns `MappingProxyType` (read-only dict view). Safe.
- **COVERED (both repos)**

---

## 2. REACTIVE LOG

### 2.1 Append-Only Invariant

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| No update/delete API | Correct — only `append`, `appendMany`, `trimHead`, `clear` | Correct — only `append`, `clear` | Correct — only `append`, `clear` | COVERED (both repos) |
| Append after destroy | Returns -1 (tested) | Not tested | Not tested | GAP (both repos): no test for append after destroy |

### 2.2 Slice/Tail Reactivity on Append

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| `tail(n)` updates on append | Tested | Uses `keepaliveDerived()` noop subscription | Uses `_keepalive_derived()` with `subscribe(lambda: None)` | GAP (graphrefly-ts): no test verifying `tail()` updates dynamically after append |
| `logSlice` edge cases | Not tested (stop=None) | Not tested (stop=undefined) | `log_slice()` tested for `(1, 3)` only | GAP (both repos): no test for `logSlice` with unbounded stop |
| `tail(0)` or negative n | Not tested | Throws `RangeError` for negative n | Raises `ValueError` for negative n | GAP (both repos): `tail(0)` not tested (should return empty) |

### 2.3 Memory Bounds / Rotation

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Circular buffer bounded mode | Tested (`maxSize=2`, O(1) append, `headSeq`/`tailSeq` tracking) | Not implemented (unbounded array) | Not implemented (unbounded array) | RISK: callbag-recharge has bounded circular buffer with proper sequence math. graphrefly ports have no bounds — unbounded logs will grow without limit. |
| Sequence number overflow | Not tested (`_seq` is plain number) | Not tested | Not tested | GAP (all repos): no guard against sequence number overflow past `Number.MAX_SAFE_INTEGER` |
| Compaction | Tested extensively (manual + auto, reentrancy guard, threshold) | Not implemented | Not implemented | RISK: callbag-recharge has log compaction (dedup by key, reentrancy guard). graphrefly ports have no compaction — keyed logs will accumulate stale entries. |

---

## 3. REACTIVE INDEX

### 3.1 Dual-Key Correctness

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Primary key uniqueness | Forward + reverse map; tested | Binary search with duplicate filter; tested | Primary key uniqueness; tested | COVERED (both repos) |
| Upsert replaces old secondary | Tested (update removes old, adds new) | Tested (upsert filters old entry before bisect) | Tested (upsert) | COVERED (both repos) |
| Delete non-existent primary | Not explicitly tested but reverse map lookup returns empty | Silently returns (no snapshot change) | Returns silently | COVERED (both repos) |

### 3.2 Sort Order Maintenance

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Sort on insert/delete | Not sorted (Set-based grouping by index key) | Binary insertion `bisectLeft()` maintains sorted order | Sorted by (secondary, primary) tuple ordering | COVERED (both repos) — note: callbag-recharge uses grouping (not sorting), graphrefly uses sorted rows |
| Mixed type secondary keys | Not applicable (Set-based) | Falls back to `String.localeCompare()` | Python tuple comparison (type error if incompatible) | GAP (graphrefly-py): no test for mixed-type secondary keys; Python will raise `TypeError` on `<` between incompatible types |
| Large number of index keys | Not tested | Not tested | Not tested | GAP (all repos): no performance test for high cardinality |

### 3.3 Range Query Edge Cases

- **callbag-recharge:** No range query API (Set-based grouping). `get(indexKey)` returns frozen `Set<primaryKey>`.
- **graphrefly-ts:** No explicit range query API. `ordered` node exposes all sorted rows.
- **graphrefly-py:** No explicit range query API. `ordered` node exposes all sorted rows.
- **N/A** — range queries not implemented in any repo.

---

## 4. REACTIVE LIST

### 4.1 Positional Operations

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Insert at index | Tested; clamps to array length | Tested; validates bounds | Tested; validates indices strictly | COVERED (both repos) |
| Insert at 0 (prepend) | Tested | Tested | Tested | COVERED (both repos) |
| Insert negative index | No-op (tested) | Throws `RangeError` | Raises `IndexError` | RISK: callbag-recharge silently ignores negative insert index. graphrefly ports throw. Different semantics. |
| Pop with negative index | Returns undefined (tested) | Supports Python-style `-1` (last), `-2` (second-to-last) | Supports negative indexing | GAP (graphrefly-ts): no negative index pop tests |
| Pop from empty | Returns undefined (tested) | Throws `RangeError("pop from empty list")` | Raises `IndexError("pop from empty list")` | RISK: Different error semantics — callbag-recharge returns undefined, graphrefly throws. |
| Move/swap | Tested (no-op for same index, bounds check) | Not implemented | Not implemented | GAP (both repos): no move/swap API ported |

### 4.2 Index Stability After Mutations

- **callbag-recharge:** `at(index)` returns cached derived store. After structural mutation (insert/remove), indices shift but `at(0)` still refers to index 0 (not the original element). Tested.
- **graphrefly-ts:** Snapshot-based; no per-index derived stores. Consumers get full array snapshot. Safe.
- **graphrefly-py:** Snapshot-based; same as TS. Safe.
- **COVERED (both repos)** — different approach avoids the problem entirely.

### 4.3 Reactive Notifications Per Operation

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Version bumps on every mutation | Tested | Snapshot version bumps | Version bumps | COVERED (both repos) |
| Clear on empty (no-op) | Tested (no version bump) | No snapshot change if already empty | No change if already empty | COVERED (both repos) |

---

## 5. PUBSUB

### 5.1 Lazy Topic Creation and Cleanup

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Topic created on first publish/subscribe | Tested | Tested | Tested (thread-safe with `threading.Lock`) | COVERED (both repos) |
| Topic cleanup on last unsubscribe | Not implemented (topics persist) | Not implemented (topics persist forever) | Not implemented (topics persist) | GAP (all repos): no topic GC. Long-running systems leak topic state. |
| Version bump on new topic only | Tested (not on re-subscribe) | Tested | Tested | COVERED (both repos) |

### 5.2 Subscriber Lifecycle

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Subscribe after destroy | Throws (tested) | Not tested | Not tested | GAP (both repos): no test for subscribe-after-destroy |
| Publish after destroy | Silently ignores (tested) | Not tested | Not tested | GAP (both repos): no destroy behavior tested |
| Multiple subscribers same topic | Cached store returned (tested) | Cached node returned | Cached node returned | COVERED (both repos) |

### 5.3 Message Delivery Guarantees

- **All repos:** At-most-once, latest-value-only (no queue, no replay, no backlog). A slow subscriber misses intermediate publishes.
- **COVERED (both repos)** — semantics are consistent.

---

## 6. CIRCUIT BREAKER

### 6.1 State Transitions

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| closed -> open (threshold) | Tested | Tested | Tested | COVERED (both repos) |
| open -> half-open (cooldown) | Tested (`canExecute()` triggers) | Tested (auto-transition on `canExecute()`) | Tested (auto-transition) | COVERED (both repos) |
| half-open -> closed (success) | Tested | Tested | Tested | COVERED (both repos) |
| half-open -> open (failure) | Tested (increments openCycle) | Tested (increments openCycle) | Tested | COVERED (both repos) |
| Reset to closed | Tested | Tested | Tested | COVERED (both repos) |

### 6.2 Failure Threshold Accuracy

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Threshold < 1 clamped | Not explicitly tested | Clamped to 1 | Minimum `failure_threshold=1` (clamped) | GAP (callbag-recharge): no test for threshold < 1 |
| Success resets failure count | Tested | Tested | Tested | COVERED (both repos) |
| Concurrent recordFailure/recordSuccess | Not tested | Not tested | Thread-safe with `threading.Lock()` but no concurrent test | GAP (all repos): no concurrent state transition tests |

### 6.3 Half-Open: Single Test Request

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| `halfOpenMax` limits trials | Tested | Tested | Tested (`half_open_max=1` minimum) | COVERED (both repos) |
| Excess requests rejected in half-open | Tested | Tested (`canExecute()` returns false) | Tested | COVERED (both repos) |
| Escalating cooldown across cycles | Tested (backoff-based) | Tested (backoff strategy) | Tested | COVERED (both repos) |

### 6.4 Timer Cleanup on Teardown

- **callbag-recharge:** Circuit breaker itself is stateless (no timers); `withBreaker` operator handles cleanup via subscribe/unsubscribe.
- **graphrefly-ts:** Injectable `now()` clock, no internal timers. Cleanup is caller's responsibility.
- **graphrefly-py:** `threading.Timer` with daemon=True and generation counter to cancel stale timers.
- **RISK (graphrefly-py):** Generation counter mitigates stale timer fires, but no test for timer cancellation race (fire vs cleanup). If a timer fires between `stopped = True` and timer cancel, the callback may execute with stale state.

---

## 7. RETRY / BACKOFF

### 7.1 Max Retries Enforcement

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Count enforcement | Tested | Tested (negative count throws `RangeError`) | Tested (retry exhaustion) | COVERED (both repos) |
| `withMaxAttempts` wrapper | Tested (returns null to stop) | Tested | Tested | COVERED (both repos) |

### 7.2 Backoff Calculation Correctness

| Strategy | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|----------|-----------------|---------------|---------------|--------|
| Constant | Tested | Tested | Tested | COVERED (both repos) |
| Linear | Tested (base + step * attempt) | Tested | Tested | COVERED (both repos) |
| Exponential | Tested (with maxDelay cap) | Tested (nanosecond-based) | Tested | COVERED (both repos) |
| Fibonacci | Tested (caps at maxDelay) | Tested | Tested | COVERED (both repos) |
| Decorrelated jitter | Tested (stateless, prevDelay handling) | Tested | Tested | COVERED (both repos) |

### 7.3 Jitter Modes

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Full jitter (0 to delay) | Tested (range verified over multiple runs) | Tested | Not explicitly tested | GAP (graphrefly-py): jitter mode not tested in isolation |
| Equal jitter (delay/2 +/- delay/4) | Tested | Tested | Not tested | GAP (graphrefly-py): equal jitter not tested |
| No jitter | Tested | Tested | Tested (constant) | COVERED |

**RISK:** callbag-recharge's fibonacci strategy has O(n) per call with no memoization. graphrefly-ts likely inherited this. For high retry counts (>20), this becomes measurably expensive.

### 7.4 Cleanup on Teardown During Backoff Wait

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Unsubscribe during timer wait | `stopped` flag + `timerAc.abort()` (tested) | Generation guard prevents stale callbacks | `stopped` flag + generation counter | GAP (both repos): no explicit test for unsubscribe-during-backoff-wait race |
| Timer leak on rapid unsubscribe | Potential: `timerAc = null` after fire, race window | Generation counter mitigates | Generation counter mitigates | RISK: callbag-recharge has a narrow window where `timerAc` is null between timer fire and reassignment. graphrefly ports use generation counters which are safer. |

---

## 8. RATE LIMITER / TOKEN BUCKET

### 8.1 Token Refill Accuracy

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Refill over time | Tested (floating-point tokens) | Tested | Tested | COVERED (both repos) |
| Float precision loss | Not tested | Not tested | Not tested | GAP (all repos): accumulated float rounding errors in token bucket not tested. After millions of refills, `_tokens` may drift. |
| Clock source | `performance.now()` or injectable `now()` | Injectable `now()` for testing | `time.monotonic()` (immune to wall-clock changes) | COVERED (both repos) |

### 8.2 Burst Capacity

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Burst > rate allowed | Tested (defaults burst to rate) | Tested (capacity parameter) | Tested (`capacity > 0` validated) | COVERED (both repos) |
| Refill does not exceed burst | Tested | Tested | Tested | COVERED (both repos) |

### 8.3 Zero/Maximum Token Edge Cases

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Zero tokens available | Tested (acquire waits) | Tested | Tested | COVERED (both repos) |
| Capacity = 0 | Not tested | Not tested | Raises `ValueError` | GAP (graphrefly-ts): no validation for capacity <= 0 |
| Non-positive cost consume | Not tested | Not tested | Returns True without consuming (tested) | GAP (graphrefly-ts): no test for `tryConsume(0)` or negative cost |
| `refill_per_second = 0` | Not tested | Not tested | Not tested | GAP (all repos): zero refill rate means tokens never replenish; no test |

### 8.4 Sliding Window

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Window boundary expiry | Tested | Tested | N/A (no sliding window in Python) | COVERED (graphrefly-ts) |
| Minimum delay of 1ms | `Math.max(1, rawWait)` prevents spin | Minimum delay is 1ms | N/A | COVERED (graphrefly-ts) |
| Tokens > max (range error) | Throws `RangeError` | Not tested | N/A | GAP (graphrefly-ts): no test for oversized acquire |

---

## 9. CHECKPOINT

### 9.1 Round-Trip Fidelity

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| save -> restore identical state | Tested (all data structures via NodeV0) | Tested (Memory/Dict/File/SQLite) | Tested (Memory/Dict/File/SQLite) | COVERED (both repos) |
| JSON round-trip (deep copy) | Tested (snapshot/from) | Memory adapter uses `JSON.parse(JSON.stringify())` | Memory adapter uses `json.loads(json.dumps())` | COVERED (both repos) |
| Non-JSON-safe types (Date, Set, etc.) | Not tested | Not tested | Not tested | GAP (all repos): saving stores with non-JSON types silently loses data |

### 9.2 Adapter Error Handling

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| File not found on load | N/A (adapter pattern) | Returns null (tested) | Returns `None` (tested) | COVERED (both repos) |
| Empty file | N/A | Returns null | Returns `None` | COVERED (both repos) |
| Corrupt/invalid JSON | Not tested | Returns null (caught) | Returns `None` (caught) | GAP: no test with actual corrupt data |
| Permission errors | Not tested | Propagates to caller | Propagates to caller | GAP (both repos): no test for filesystem permission errors |
| Atomic write (temp + rename) | N/A | Tested (temp file + `renameSync`) | Tested (`mkstemp` + `os.replace`) | COVERED (both repos) |

### 9.3 Concurrent Checkpoint Safety

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|-----------------|---------------|---------------|--------|
| Concurrent saves | Not tested | Not tested | Not tested | GAP (all repos): no concurrent checkpoint test |
| SQLite thread safety | N/A | Node 22.5+ `node:sqlite`; no mutex | NOT thread-safe (no lock wrapping) | RISK (graphrefly-py): `SqliteCheckpointAdapter` has no threading lock. Concurrent saves from different threads will corrupt the database. |
| IndexedDB (browser) | N/A | Implemented but no tests | N/A | GAP (graphrefly-ts): IndexedDB adapter entirely untested |

---

## Summary Matrix

| # | Item | Status | Detail |
|---|------|--------|--------|
| 1.1 | Map TTL expiration boundaries | COVERED (both repos) | Exact boundary tested in all three repos |
| 1.2 | Map TTL concurrent access | GAP (both repos) | Lazy expiry avoids timer races but no read-during-expiry test |
| 1.3 | Map eviction LRU/FIFO | COVERED (both repos) | All repos test basic eviction |
| 1.4 | Map LFU eviction | GAP (both repos) | Not ported from callbag-recharge |
| 1.5 | Map iterator safety | COVERED (both repos) | Snapshot/proxy patterns prevent mutation |
| 2.1 | Log append-only invariant | COVERED (both repos) | No update/delete API in any repo |
| 2.2 | Log tail reactivity | GAP (graphrefly-ts) | No test for dynamic tail updates |
| 2.3 | Log memory bounds | RISK | graphrefly has no bounded mode or compaction |
| 3.1 | Index dual-key correctness | COVERED (both repos) | Primary uniqueness + secondary sort tested |
| 3.2 | Index mixed-type secondary | GAP (graphrefly-py) | Python `TypeError` on incompatible types |
| 4.1 | List positional ops | COVERED (both repos) | Insert/pop tested with bounds |
| 4.2 | List negative index semantics | RISK | callbag-recharge ignores; graphrefly throws |
| 4.3 | List move/swap | GAP (both repos) | Not ported |
| 5.1 | PubSub lazy topic creation | COVERED (both repos) | Tested in all repos |
| 5.2 | PubSub topic cleanup | GAP (all repos) | No GC; topics persist forever |
| 5.3 | PubSub destroy behavior | GAP (both repos) | No test for publish/subscribe after destroy |
| 6.1 | Breaker state transitions | COVERED (both repos) | Full cycle tested |
| 6.2 | Breaker concurrent transitions | GAP (all repos) | No concurrent test despite py having locks |
| 6.3 | Breaker half-open trials | COVERED (both repos) | halfOpenMax enforced |
| 6.4 | Breaker timer cleanup | RISK (graphrefly-py) | Timer fire vs cleanup race with generation counter |
| 7.1 | Retry max enforcement | COVERED (both repos) | Count + withMaxAttempts tested |
| 7.2 | Backoff strategies | COVERED (both repos) | All 5 strategies tested |
| 7.3 | Jitter modes | GAP (graphrefly-py) | Full/equal jitter not tested |
| 7.4 | Retry teardown during wait | GAP (both repos) | No explicit unsubscribe-during-backoff test |
| 8.1 | Token refill accuracy | COVERED (both repos) | Float precision untested but functional |
| 8.2 | Burst capacity | COVERED (both repos) | Defaults and caps tested |
| 8.3 | Zero/edge token cases | GAP (both repos) | capacity=0, cost=0, refill=0 untested |
| 8.4 | Sliding window | COVERED (graphrefly-ts) | Not in Python port |
| 9.1 | Checkpoint round-trip | COVERED (both repos) | All adapters tested |
| 9.2 | Adapter error handling | GAP (both repos) | No corrupt data or permission error tests |
| 9.3 | Concurrent checkpoints | GAP (all repos) | No concurrent save test |
| 9.4 | SQLite thread safety | RISK (graphrefly-py) | No mutex wrapping on SQLite adapter |

---

## Critical Risks for GraphReFly Users

### P0 — Will bite users in production

1. **SQLite checkpoint not thread-safe (graphrefly-py):** `SqliteCheckpointAdapter` has no `threading.Lock` around reads/writes. Multi-threaded apps saving checkpoints concurrently will corrupt data.

2. **Unbounded reactive log (both repos):** No `maxSize` / circular buffer / compaction. Long-running systems appending to reactive logs will exhaust memory. callbag-recharge solved this with bounded circular buffer + compaction with reentrancy guard.

3. **PubSub topic leak (both repos):** Topics are never garbage-collected. Services that dynamically create topics (e.g., per-request or per-session) will leak `state()` nodes indefinitely.

### P1 — Edge cases that cause subtle bugs

4. **List error semantics divergence:** callbag-recharge returns `undefined` on invalid pop/insert. graphrefly throws exceptions. Users porting code between repos will hit unexpected crashes or silent failures.

5. **Timer race in Python retry/rate_limiter:** `threading.Timer` with generation counter mitigates most cases, but there's a narrow window between timer fire and generation check where stale callbacks can execute.

6. **Non-JSON types silently lost in checkpoint (all repos):** Saving stores containing `Date`, `Set`, `Map`, `BigInt`, or custom classes silently loses data on JSON round-trip. No validation or warning.

### P2 — Missing coverage worth adding

7. **Concurrent state transitions on circuit breaker:** Python has locks but no test proving they work under contention. TS has no locks at all (single-threaded assumption).

8. **graphrefly-ts IndexedDB adapter entirely untested.** Browser users have zero safety net.

9. **Zero-value edge cases in token bucket:** `capacity=0`, `refill_per_second=0`, `tryConsume(0)` all untested.
