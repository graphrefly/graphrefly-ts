# Batch 7: Operator Edge Cases — Cross-Reference Audit

**Source:** callbag-recharge `src/__tests__/extra/{edge-cases,dedup-correctness,batch7-gaps}.test.ts`
**Targets:** graphrefly-ts `src/__tests__/extra/{operators,sources}.test.ts`, graphrefly-py `tests/test_extra_{tier1,tier2,sources}.py`

---

## 1. MERGE

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| Error from one source propagates immediately | `edge-cases.test.ts:64` | Not tested | Not tested | **GAP (both)** |
| COMPLETE only after ALL sources complete | `edge-cases.test.ts:77` | Not tested | Not tested | **GAP (both)** |
| Teardown of remaining sources on error | Implicit in error test | Not tested | Not tested | **GAP (both)** |
| Diamond: both branches emit independently | `edge-cases.test.ts:676` | Not tested | Not tested | **GAP (both)** |
| Diamond: single DIRTY, two DATAs | `edge-cases.test.ts:697` | Not tested | N/A (no DIRTY) | **GAP (TS)** |
| No dedup of same value from different sources | `dedup-correctness.test.ts:585` | Not tested | Not tested | **GAP (both)** |

**RISK:** GraphReFly merge may silently complete after the first source completes (ANY semantics) instead of waiting for ALL sources. This is a common footgun.

---

## 2. SWITCHMAP

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| Inner teardown on new outer emission | `edge-cases.test.ts:860` (rapid switches) | `operators.test.ts` (basic test) | `test_extra_tier2.py` (basic) | COVERED (basic) |
| Outer completion waits for active inner | `edge-cases.test.ts:354` | Not tested | Not tested | **GAP (both)** |
| Error in inner propagates to output | `edge-cases.test.ts:110` | Not tested | `test_switch_map_outer_error` (outer only) | **GAP (both — inner error)** |
| Rapid switching: only last inner survives | `edge-cases.test.ts:860` | Not tested | Not tested | **GAP (both)** |
| Sync inner completion after outer completes | `batch7-gaps.test.ts:165` | Not tested | Not tested | **GAP (both)** |

**RISK:** Without the "outer complete waits for active inner" test, switchMap may complete prematurely, dropping the last inner's remaining emissions.

---

## 3. CONCATMAP

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| Queue semantics (outer queued while inner active) | `edge-cases.test.ts:898` | `operators.test.ts` (sequential basic) | `test_concat_map_sequential` | COVERED (basic) |
| Inner error forwards to output | `edge-cases.test.ts:125` | Not tested | Not tested | **GAP (both)** |
| max_buffer overflow behavior | Not tested | Not tested | `test_concat_map_max_buffer` | COVERED (Py only) |

**RISK:** Inner error handling untested in both repos. If concatMap swallows inner errors, queued items may never drain.

---

## 4. EXHAUSTMAP

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| Drop outer emissions while inner active | `edge-cases.test.ts:930` | `operators.test.ts` (basic) | `test_exhaust_map_drops_while_busy` | COVERED |
| Inner error forwards to output | `edge-cases.test.ts:141` | Not tested | Not tested | **GAP (both)** |
| Resume accepting after inner completes | Implicit | Basic test | Basic test | COVERED (basic) |

---

## 5. DEBOUNCE / THROTTLE

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| Debounce: flush pending value on source completion | `edge-cases.test.ts:376` | Not tested | Not tested | **GAP (both)** |
| Debounce: cancel pending on upstream error | `edge-cases.test.ts:390` | Not tested | Not tested | **GAP (both)** |
| Debounce: forwards upstream completion | `edge-cases.test.ts:332` | Not tested | Not tested | **GAP (both)** |
| Throttle: forwards upstream completion | `edge-cases.test.ts:344` | Not tested | Not tested | **GAP (both)** |
| Throttle: forwards upstream error | `edge-cases.test.ts:406` | Not tested | Not tested | **GAP (both)** |
| Debounce: no dedup of repeated values | `dedup-correctness.test.ts:293` | Not tested | Not tested | **GAP (both)** |
| Throttle: same value in consecutive windows passes | `dedup-correctness.test.ts:278` | Not tested | Not tested | **GAP (both)** |
| Leading vs trailing edge (throttle) | Tested | `operators.test.ts` (leading) | `test_throttle_leading_edge` | COVERED (leading only) |

**RISK (HIGH):** Debounce flush-on-complete is critical. Without it, the last debounced value before stream completion is silently lost. This is one of the most common operator bugs.

---

## 6. BUFFERCOUNT / BUFFERTIME

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| bufferTime: flush remaining on upstream completion | `edge-cases.test.ts:1113` | Not tested | Not tested | **GAP (both)** |
| bufferTime: cancel timer on upstream error | `edge-cases.test.ts:1097` | Not tested | Not tested | **GAP (both)** |
| bufferTime: empty buffer on completion = no emission | `edge-cases.test.ts:1129` | Not tested | Not tested | **GAP (both)** |
| bufferCount: basic N-item batching | Tested | `operators.test.ts` | `test_buffer_count` | COVERED |
| bufferCount(0) throws RangeError | Tested | `operators.test.ts` | Not tested | **GAP (Py)** |

**RISK:** Same as debounce — unflushed buffer on completion loses data silently.

---

## 7. WINDOW / WINDOWCOUNT / WINDOWTIME

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| Inner window completion | Not explicitly tested | Not tested | Not tested | **GAP (all)** |
| Outer completion closes active window | Not explicitly tested | Not tested | Not tested | **GAP (all)** |

**Note:** Window operators exist in both GraphReFly repos (windowCount, windowTime, window) but have no dedicated edge case tests.

---

## 8. TIMEOUT

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| Source completes before timeout — timer cleared | `edge-cases.test.ts:1208` | Not tested | Not tested | **GAP (both)** |
| Source errors — timer cleared | `edge-cases.test.ts:1224` | Not tested | Not tested | **GAP (both)** |
| Timer resets on each emission | `edge-cases.test.ts:1247` | Not tested | Not tested | **GAP (both)** |
| TimeoutError fires when source too slow | `edge-cases.test.ts:1235` | `operators.test.ts` (basic) | `test_timeout_fires` | COVERED (basic) |

**RISK:** Without timer cleanup on completion/error, timeout can fire after the stream is already terminal, causing double-END or use-after-free errors.

---

## 9. TAKE / SKIP / FIRST / LAST

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| take(0) completes immediately | `edge-cases.test.ts:178` | `operators.test.ts` | Not tested | **GAP (Py)** |
| take(1) completes after one value | `edge-cases.test.ts:198` | Not tested | Not tested | **GAP (both)** |
| take: error forwarding from upstream | `edge-cases.test.ts:817` | Not tested | Not tested | **GAP (both)** |
| skip: counter resets on reconnect | `edge-cases.test.ts:766` | Not tested | Not tested | **GAP (both)** |
| skip: completion/error during skip phase | `edge-cases.test.ts:792` | Not tested | Not tested | **GAP (both)** |
| Completed store rejects new subscriptions | `edge-cases.test.ts:832` | Not tested | Not tested | **GAP (both)** |
| take + filter interaction (count filtered values) | `edge-cases.test.ts:723` | Not tested | Not tested | **GAP (both)** |

---

## 10. COMBINE / ZIP / WITHLATESTFROM

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| Diamond glitch-freedom (consistent snapshots) | `dedup-correctness.test.ts:910` | `operators.test.ts` (diamond basic) | Not tested | **GAP (Py)** |
| RESOLVED propagation (one/both branches) | `dedup-correctness.test.ts:33,51,69` | Not tested | Not tested | **GAP (both)** |
| 3-way diamond with mixed RESOLVED/DATA | `dedup-correctness.test.ts:119` | Not tested | Not tested | **GAP (both)** |
| combine: error from any source | `edge-cases.test.ts:595` | Not tested | Not tested | **GAP (both)** |
| combine: completion when any source completes | `edge-cases.test.ts:609` | Not tested | Not tested | **GAP (both)** |
| combine: single source | `edge-cases.test.ts:567` | Not tested | Not tested | **GAP (both)** |
| RESOLVED counting stress (many deps) | `dedup-correctness.test.ts:836` | Not tested | Not tested | **GAP (both)** |
| zip: basic pairing | Tested | `operators.test.ts` | `test_zip_pairs` | COVERED |
| withLatestFrom: secondary-only updates suppressed | Tested | `operators.test.ts` | `test_with_latest_from_suppresses_secondary` | COVERED |

**RISK (HIGH):** Diamond glitch-freedom is a core promise. If combine exposes intermediate state in a diamond topology, users get inconsistent reads. The callbag-recharge tests prove this with invariant assertions inside derived callbacks.

---

## 11. CONCAT / RACE

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| concat: error from first source stops chain | `edge-cases.test.ts:1044` | Not tested | Not tested | **GAP (both)** |
| concat: error from second source after first completes | `edge-cases.test.ts:1074` | Not tested | Not tested | **GAP (both)** |
| concat: completes after all sources complete | `edge-cases.test.ts:1058` | Not tested | Not tested | **GAP (both)** |
| concat: buffers second source during first | Tested | `operators.test.ts` | `test_concat_buffers_second_during_phase0` | COVERED |
| race: first DATA wins, others unsubscribed | Tested | `operators.test.ts` | `test_race_first_data_wins` | COVERED |
| race: winner continues forwarding | Tested | `operators.test.ts` | `test_race_winner_continues` | COVERED |

---

## 12. DISTINCTUNTILCHANGED

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| Custom comparator | `dedup-correctness.test.ts:757` | Not tested | Not tested | **GAP (both)** |
| Reference vs value equality (Object.is semantics) | `dedup-correctness.test.ts:713-770` | Not tested | Not tested | **GAP (both)** |
| NaN === NaN (Object.is returns true) | `dedup-correctness.test.ts:713` | Not tested | Not tested | **GAP (both)** |
| +0 vs -0 (Object.is returns false) | `dedup-correctness.test.ts:723` | Not tested | Not tested | **GAP (both)** |
| Error/completion forwarding | `edge-cases.test.ts:644` | Not tested | Not tested | **GAP (both)** |

---

## 13. SHARE / CACHED / REPLAY

| Edge Case | callbag-recharge | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|:---:|--------|
| share: single upstream subscription (refcount) | Tested | `sources.test.ts` | `test_share_multicast_wires_one_upstream` | COVERED |
| replay: late subscriber gets buffered values | Tested | `sources.test.ts` | `test_replay_buffer_replays_to_late_subscriber` | COVERED |
| replay: buffer size validation | Not tested | Not tested | `test_replay_rejects_zero_buffer` | COVERED (Py only) |
| cached: single-value replay | Tested | `sources.test.ts` | `test_cached_and_replay_are_nodes` | COVERED |
| Cleanup on zero subscribers | Not tested | Not tested | Not tested | **GAP (all)** |
| Late subscriber after completion | Not tested | Not tested | Not tested | **GAP (all)** |

---

## Additional Edge Cases (callbag-recharge specific)

### Reentrancy Safety
| Edge Case | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|--------|
| Subscriber modifies state during emission | Not tested | Not tested | **GAP (both)** |
| Reentrant set during batch → single final value | Not tested | Not tested | **GAP (both)** |
| Self-unsubscribe during emission | Not tested | Not tested | **GAP (both)** |
| Adding subscriber during emission | Not tested | Not tested | **GAP (both)** |
| Effect triggering state change in callback | Not tested | Not tested | **GAP (both)** |

**RISK (HIGH):** Reentrancy bugs are the #1 source of infinite loops and stack overflows in reactive systems. If a subscriber sets a state that triggers the same subscriber, the system must remain consistent.

### Scan Accumulator Reset
| Edge Case | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|--------|
| Accumulator resets to seed on reconnect | Not tested | Not tested | **GAP (both)** |
| Getter idempotency (repeated get() doesn't re-accumulate) | Not tested | Not tested | **GAP (both)** |
| Pull-push-pull lifecycle | Not tested | Not tested | **GAP (both)** |

### Pairwise First-Emission
| Edge Case | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|--------|
| No emission on first upstream change | Not tested | Not tested | **GAP (both)** |
| get() returns undefined before two changes | Not tested | Not tested | **GAP (both)** |

### Delay Completion/Error
| Edge Case | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|--------|
| Error cancels pending timers | Not tested | Not tested | **GAP (both)** |
| Completion waits for pending delayed values | Not tested | Not tested | **GAP (both)** |
| Immediate completion when no pending timers | Not tested | Not tested | **GAP (both)** |

### Push/Pull Consistency
| Edge Case | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|--------|
| map: get() matches last subscribed value | Not tested | Not tested | **GAP (both)** |
| filter: get() returns last passing value | Not tested | Not tested | **GAP (both)** |
| combine: get() reflects latest state between emissions | Not tested | Not tested | **GAP (both)** |

### Filter No-Default-Dedup
| Edge Case | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|--------|
| filter passes consecutive identical values (no dedup) | Not tested | Not tested | **GAP (both)** |
| filter re-emits after fail→pass with same value | Not tested | Not tested | **GAP (both)** |
| Opt-in dedup via explicit equals | Not tested | Not tested | **GAP (both)** |

### Batch + Diamond Coalescing
| Edge Case | graphrefly-ts | graphrefly-py | Status |
|-----------|:---:|:---:|--------|
| Batch coalesces to final value | Not tested | Not tested | **GAP (both)** |
| Batch returning to original value still emits | Not tested | Not tested | **GAP (both)** |
| Batch + diamond: consistent snapshot | Not tested | Not tested | **GAP (both)** |

---

## Summary

### Gap Counts by Category

| Category | TS Gaps | Py Gaps | Shared Gaps |
|----------|:---:|:---:|:---:|
| merge | 5 | 5 | 5 |
| switchMap | 4 | 4 | 4 |
| concatMap | 1 | 1 | 1 |
| exhaustMap | 1 | 1 | 1 |
| debounce/throttle | 7 | 7 | 7 |
| buffer operators | 3 | 4 | 3 |
| timeout | 3 | 3 | 3 |
| take/skip/first/last | 6 | 7 | 6 |
| combine/zip/wlf | 6 | 7 | 6 |
| concat/race | 3 | 3 | 3 |
| distinctUntilChanged | 5 | 5 | 5 |
| share/cached/replay | 2 | 1 | 2 |
| Reentrancy | 5 | 5 | 5 |
| Scan/Pairwise/Delay | 8 | 8 | 8 |
| Push/pull consistency | 3 | 3 | 3 |
| Filter dedup semantics | 3 | 3 | 3 |
| Batch coalescing | 3 | 3 | 3 |
| **Total** | **~68** | **~70** | **~68** |

### Top 5 Highest-Risk Gaps

1. **Debounce flush-on-complete** — Last value silently lost on stream completion. Affects any UI that debounces user input before save.

2. **Diamond glitch-freedom** — combine/derived must never expose intermediate dep state. No invariant-assertion tests exist in either GraphReFly repo.

3. **Reentrancy safety** — Subscriber-triggered state changes can cause infinite loops or inconsistent reads. Zero coverage in both repos.

4. **Timeout timer cleanup** — Timeout can fire after stream completion, causing double-END or crashes. Zero coverage.

5. **switchMap outer-complete waits for inner** — Without this, the last inner subscription's emissions are dropped when the outer completes.

### Recommendations

**Immediate (P0):** Add tests for debounce flush-on-complete, timeout timer cleanup on completion/error, and merge ALL-complete semantics. These are data-loss bugs.

**Short-term (P1):** Add reentrancy safety tests, diamond glitch-freedom invariant tests, and error propagation tests for all tier-2 operators (switchMap, concatMap, exhaustMap inner errors).

**Medium-term (P2):** Add reconnect/reset semantics (scan seed reset, skip counter reset), push/pull consistency tests, and dedup-boundary tests (filter no-dedup, NaN/+0/-0 edge cases).
