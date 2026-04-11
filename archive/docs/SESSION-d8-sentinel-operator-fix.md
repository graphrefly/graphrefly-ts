# SESSION: D8 / SENTINEL Operator Initialization Fix

**Date:** 2026-04-10
**Scope:** TS (`graphrefly-ts`) + PY (`graphrefly-py`)
**Status:** Complete — all tests green, both repos

---

## Problem Statement

The D8 fallback in `_connectUpstream` (TS `node.ts:277`, PY `node.py:347`) fires
`_runFn()` for all fn+onMessage operators after subscribing to deps. When a dep is
SENTINEL (pushes only `[[START]]`, no DATA), `dep.get()` returns `undefined` (TS) /
`None` (PY). Operators treated this as real data, corrupting internal state:

- **switchMap/exhaustMap/concatMap/mergeMap**: called the user's project function
  with `undefined`, spawning an inner subscription to a garbage source.
- **reduce**: accumulated `undefined` as a real value → `NaN` or wrong total.
- **takeWhile**: evaluated predicate on `undefined` → premature completion or crash.
- **last**: tracked `undefined` as the last value → spurious emission on COMPLETE.
- **bufferCount**: pushed `undefined` into the buffer → corrupted batch output.

### Why D8 exists

D8 fires fn for operators whose `onMessage` consumes ALL dep messages (DATA, DIRTY,
RESOLVED, etc.) during the subscribe loop, preventing the normal mask-based wave from
ever completing. Without D8, these operators would never get their fn called for
initialization (registering cleanup functions, setting up inner subscriptions, etc.).

### Design constraint (non-negotiable)

- **NO null/undefined guards.** `undefined` and `null` are valid DATA payloads.
  The protocol (START/SENTINEL/DATA) is the mechanism, not value inspection.
  COMPOSITION-GUIDE §3 allows only SENTINEL or `!= null` guard patterns — never
  `=== undefined`.

---

## Root Cause Analysis

### Three categories of operators

| Category | Examples | fn purpose | D8 safe? |
|----------|----------|-----------|----------|
| **A: *Map** | switchMap, exhaustMap, concatMap, mergeMap, bufferCount | Return cleanup only | Yes, if fn doesn't use dep values |
| **B: Timer** | debounce, throttle, audit, delay, interval | Initialize timers | Yes, timer setup doesn't depend on dep values |
| **C: Accumulator** | reduce, takeWhile, last | Process dep values | No — fn reads `deps[0]` which is `undefined` for SENTINEL |

### TS vs PY divergence

**TS:** `_runFn()` is NOT blocked during `_connecting`. The normal wave path fires fn
for plain derived nodes during the subscribe loop. D8's guard
`this._lastDepValues === depValuesBefore` prevents double-runs.

**PY:** `_run_fn()` IS blocked during `_connecting` (line 426: `if self._connecting: return`).
ALL fn-nodes rely on the post-connect D8 fallback for their initial computation. This
means PY's D8 cannot be scoped to onMessage-only operators — it must fire for all
fn-nodes.

### Failed attempts

1. **Attempt 1: Move DATA from fn to onMessage for accumulators.** Broke two-phase
   protocol because single-dep DIRTY-skip optimization (`_canSkipDirty`) strips DIRTY
   from upstream delivery, and `a.down([msg])` doesn't auto-prepend DIRTY like
   `_downAutoValue` does.

2. **Attempt 2: Add `!_depDirtyMask.any()` to D8 condition.** Prevented timer operators
   (debounce, throttle) from initializing with SENTINEL deps — they need fn for timer
   setup regardless.

3. **Attempt 3 (final): Protocol-level `depHasData` tracking.** onMessage watches for
   DATA message type (not null check), fn guards with `if (!depHasData) return`. *Map
   operators changed to not use dep values in fn at all.

---

## Fix Design

### Group A — *Map operators

**Principle:** fn returns cleanup only; onMessage handles all DATA.

```typescript
// Before (switchMap)
([v], a) => { if (!attached) attach(v as T, a); return clearInner; }

// After
() => clearInner
```

D8 fires fn, fn returns `clearInner` without calling the project function. The project
function is only called from `onMessage` when real DATA arrives. Removed dead `attached`
variable from all *Map operators.

**Applied to:** switchMap, exhaustMap, concatMap, mergeMap (TS) / switch_map, exhaust_map,
concat_map, flat_map (PY), bufferCount / buffer_count.

### Group C — Accumulator operators

**Principle:** Protocol-level DATA tracking via `depHasData` flag.

```typescript
// reduce
let depHasData = false;
node([source],
  ([v]) => {
    if (!depHasData) return undefined; // D8 fallback — dep is SENTINEL
    sawData = true;
    acc = reducer(acc, v as T);
    return undefined;
  },
  { onMessage(msg) {
    if (msg[0] === DATA) depHasData = true; // protocol-level tracking
    // ... rest unchanged
  }}
);
```

onMessage tracks DATA receipt at the protocol level (checks message type, NOT value).
fn guards early when no DATA has been received. On resubscribe, `depHasData` resets.

**Applied to:** reduce, takeWhile, last (TS + PY).

### evalSource / eval_source

Removed wrong null guards from previous session:

```typescript
// Before
return switchMap(trigger, (v) => {
    if (v == null) return fromAny(null); // WRONG
    return fromAny(runner());
});

// After
return switchMap(trigger, () => fromAny(runner()));
```

With the *Map operator fix, the project function is only called from onMessage when real
DATA arrives — the null guard was both wrong (blocks valid null/undefined payloads) and
unnecessary.

### PY last() initial value fix

PY `last()` with no default was passing `initial=None` to `node()`, causing push-on-subscribe
to emit `DATA(None)`. Fixed to omit `initial` when no default is specified.

### PY core D8 — kept as-is

PY's D8 fallback (`if self._fn is not None: self._run_fn()`) fires for ALL fn-nodes, not
just onMessage operators. This is correct because PY blocks `_run_fn` during `_connecting`,
so ALL fn-nodes need the post-connect fallback. The SENTINEL safety comes from the
operator-level fixes (depHasData, fn-not-using-deps), not core gating.

---

## Files Changed

### TypeScript (graphrefly-ts)

| File | Change |
|------|--------|
| `src/core/node.ts` | Added dirty bit clearing when onMessage consumes DATA/RESOLVED/START |
| `src/extra/operators.ts` | switchMap, exhaustMap, concatMap, mergeMap fn→cleanup-only; reduce, takeWhile, last fn+depHasData; bufferCount fn→`() => undefined` |
| `src/patterns/harness/bridge.ts` | evalSource: removed `v == null` guard |
| `src/__tests__/extra/operators.test.ts` | 8 new SENTINEL dep safety tests |

### Python (graphrefly-py)

| File | Change |
|------|--------|
| `src/graphrefly/extra/tier2.py` | switch_map, exhaust_map, concat_map, flat_map fn→cleanup-only; removed dead `attached` vars |
| `src/graphrefly/extra/tier1.py` | reduce, take_while fn+dep_has_data; last initial kwarg fix |
| `src/graphrefly/patterns/harness/bridge.py` | eval_source: removed `value is None` guard |
| `tests/test_extra_tier2.py` | 5 new SENTINEL tests; 2 tests updated (removed old D8 assumptions) |
| `tests/test_extra_tier1.py` | 3 new SENTINEL tests |

---

## Key Insights

1. **PY `_connecting` guard is load-bearing.** PY blocks `_run_fn` during subscribe,
   meaning ALL fn-nodes need D8. TS doesn't block, so TS D8 is narrower
   (`this._fn && this._onMessage`). This divergence is by design, not a bug.

2. **Single-dep DIRTY-skip optimization matters.** `_canSkipDirty()` strips DIRTY from
   batches when `sinkCount === 1 && singleDepSinkCount === 1`. Moving DATA from fn to
   onMessage + `a.down([msg])` breaks two-phase protocol because the stripped DIRTY
   means downstream only sees `[[DATA, v]]` (no DIRTY predecessor). Must use
   `_downAutoValue` (return from fn) for correct two-phase framing.

3. **Protocol-level tracking beats value inspection.** The `depHasData` flag watches for
   `msg[0] === DATA` in onMessage — a protocol-level check. No ambiguity between
   "dep has no value" vs "dep's value is undefined/null". This aligns with
   COMPOSITION-GUIDE §3: only SENTINEL or `!= null` patterns.

4. **`initial=None` in PY is a real value.** Unlike TS where `undefined` means "no initial",
   PY `None` is a valid initial value that triggers push-on-subscribe `DATA(None)`. Must
   omit `initial` kwarg entirely when no default is intended.

---

## Test Results

- **TS:** 1479 tests pass (53 files), lint clean
- **PY:** 1206 tests pass, ruff clean
