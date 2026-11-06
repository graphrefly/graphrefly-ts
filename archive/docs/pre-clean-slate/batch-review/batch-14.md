# Batch 14 — RxJS Convention Alignment Audit

**Goal:** Assess whether GraphReFly operators behave consistently with RxJS/callbag
conventions for AI ergonomics — will an LLM trained on RxJS docs produce correct
GraphReFly code?

Scope: TypeScript (`src/extra/operators.ts`, `src/extra/sources.ts`) and Python
(`extra/tier1.py`, `extra/tier2.py`, `extra/sources.py`).

---

## Per-Operator Assessment

### 1. switchMap

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Inner teardown on new outer | Synchronous | Yes — `clearInner()` called before `forwardInner()` | Yes — `teardown_inner()` before `subscribe_inner()` |
| Outer complete waits for active inner | Yes | Yes — `sourceDone` flag, COMPLETE deferred until inner ends | Yes — `outer_done[0]` flag, same logic |

**Verdict: ALIGNED**

### 2. mergeMap / flatMap

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Concurrent limit param | Optional `concurrent` param | **Not supported** | **Not supported** |
| flatMap alias | `flatMap` deprecated alias of `mergeMap` | `export const flatMap = mergeMap` ✓ | `flat_map` is its own function (not alias, but same semantics) |
| Completion semantics | When outer + all inners complete | Same | Same |

**Verdict: DIVERGENT (intentional, minor)** — No `concurrent` parameter. This is a
meaningful gap: RxJS users frequently use `mergeMap(fn, 3)` for concurrency limiting.
`concatMap` covers `concurrent=1` but there's no middle ground.

**Documentation:** Not documented as intentional omission.

### 3. concatMap

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Semantics | `mergeMap(fn, 1)` | Dedicated impl, queues outer values while inner active | Same |
| Buffer overflow | N/A (no limit) | `maxBuffer` option to cap queue | `max_buffer` option |

**Verdict: ALIGNED** — Behavior matches RxJS. The `maxBuffer` option is a GraphReFly
addition (not present in RxJS) but doesn't break expectations.

### 4. exhaustMap

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Drop vs queue | Drop while active | Drop — emits `RESOLVED` when busy | Drop — ignores when `busy[0]` |
| Completion | Waits for active inner | Yes | Yes |

**Verdict: ALIGNED**

### 5. merge

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| API shape | Static `merge(a, b)` and pipeable `merge(b)` | `merge([a, b])` — array arg, static only | `merge(a, b)` — variadic, static only |
| Completion | When ALL complete | Same | Same |
| Empty | `EMPTY` | Immediate `COMPLETE` | Immediate `COMPLETE` |

**Verdict: DIVERGENT (intentional, minor)** — TS uses `merge([a, b])` (array) vs RxJS
`merge(a, b)` (variadic). Python uses variadic like RxJS. The TS array form is slightly
surprising for RxJS users but consistent with `combine` and `zip` in the same codebase.

**Documentation:** Not documented as a design choice. An AI writing `merge(a, b)` in TS
would get a type error.

### 6. combine / combineLatest

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Name | `combineLatest` | `combine` | `combine` |
| Emit on every dep change after all have emitted | Yes | Yes — `node(deps, vals => vals as T)` fires on any dep settle | Yes — same pattern |
| Initial combination when all deps have values | Yes | Yes — derived node recomputes on first cycle | Yes |
| API shape | `combineLatest([a, b])` | `combine([a, b])` (TS), `combine(a, b)` (Py) | Variadic |

**Verdict: DIVERGENT (intentional, naming)** — Named `combine` not `combineLatest`.
This is the **highest-impact AI discoverability issue**. An LLM searching for
`combineLatest` will not find `combine`. The behavior itself is aligned.

**Documentation:** The docstring says "combineLatest" in the TS remarks but the export
name is `combine`. No explicit alias or re-export as `combineLatest`.

### 7. withLatestFrom

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Only emits when primary emits | Yes | Yes — index 0 check in `onMessage` | Yes — `i == 0` check |
| Secondary alone silently updates cache | Yes | Yes | Yes |
| Output shape | `[primary, ...secondaries]` | `[primary, secondary]` (pair only) | `(primary, secondary)` (pair only) |

**Verdict: ALIGNED** — Single-secondary limitation is fine; RxJS also typically uses
one secondary. Pair tuple matches RxJS `[a, b]`.

### 8. zip

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Completion | When ANY source completes (shortest) | When ANY completes **with empty buffer**, or when ALL complete | Same logic |
| API shape | `zip(a, b)` | `zip([a, b])` (TS), `zip(a, b)` (Py) | Variadic |

**Verdict: ALIGNED** — The completion condition `active === 0 || queues[i].length === 0`
correctly implements shortest-source semantics. When a source completes with an empty
queue, the zip completes — matching RxJS. TS array API is a minor discoverability note
(same as `merge`).

### 9. scan

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Seed required? | Optional (first value becomes initial acc) | **Required** | **Required** |
| Behavior without seed | First value is accumulator, no emission | N/A — seed is mandatory | N/A |
| resetOnTeardown | N/A | Yes | Yes |

**Verdict: DIVERGENT (intentional)** — Seed is always required. This simplifies the
implementation and avoids the subtle "seedless scan" behavior that trips up even
experienced RxJS users. The `resetOnTeardown` behavior is a GraphReFly addition.

**Documentation:** Docstring documents seed as required parameter but doesn't explain
the divergence from RxJS's optional seed.

### 10. reduce

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Emits only on complete | Yes | Yes — `onMessage` intercepts `COMPLETE`, emits acc | Yes |
| Seed required? | Optional | **Required** | **Required** |
| Empty completion | Error in RxJS (no seed) | Emits `seed` | Emits `seed` |

**Verdict: DIVERGENT (intentional)** — Same seed-required pattern as `scan`. The
empty-completion behavior (emit seed) is more forgiving than RxJS (which errors without
seed). This is a reasonable improvement.

**Documentation:** Docstring says "if no DATA arrived, emits seed" — well documented.

### 11. debounce / debounceTime

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Name | `debounceTime(ms)` for fixed, `debounce(fn)` for selector | `debounce(source, ms)` | `debounce(seconds)` |
| Config | ms number / duration selector | ms number only | seconds (float) only |
| Flush on complete | Yes | Yes | Yes |
| RESOLVED handling | N/A | Debounces RESOLVED too (delays it) | Forwards RESOLVED directly |

**Verdict: DIVERGENT (intentional, naming)** — GraphReFly uses `debounce` for the
time-based variant (RxJS calls this `debounceTime`). No duration-selector variant
exists. An LLM writing `debounceTime(source, 300)` won't find it.

**UNDOCUMENTED:** TS debounces `RESOLVED` messages (delays them by `ms`), which is a
subtle behavioral difference. Python forwards RESOLVED immediately. This TS/Py
inconsistency should be documented or reconciled.

### 12. throttle

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Name | `throttleTime` for fixed | `throttle` | `throttle` |
| Leading/trailing defaults | `{ leading: true, trailing: false }` | `leading !== false` (true), `trailing === true` (false) → **same defaults** | `leading=True, trailing=False` → **same** |
| Config | `{ leading, trailing }` object | Inline in opts: `{ leading?: boolean; trailing?: boolean }` | Named kwargs |

**Verdict: ALIGNED** — Defaults match RxJS. Naming is `throttle` vs RxJS `throttleTime`
(same issue as debounce).

### 13. take(0)

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Behavior | Completes immediately, emits COMPLETE | `count <= 0` branch: emits COMPLETE immediately | `n <= 0`: emits COMPLETE immediately |

**Verdict: ALIGNED**

### 14. startWith

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| Synchronous emission | Yes | Yes — emitted in the compute function on first call | Yes — emitted in compute |
| Multiple values | `startWith(1, 2, 3)` | Single value only: `startWith(source, value)` | Single value: `start_with(value)` |

**Verdict: DIVERGENT (intentional, minor)** — Only single value (RxJS allows variadic).
Chain `startWith(startWith(source, 1), 2)` for multiple. Not a major issue.

### 15. share / shareReplay

| Aspect | RxJS | GraphReFly TS | GraphReFly Py |
|--------|------|---------------|---------------|
| share | Refcount, reset on zero | `producer` wrapper — refcount via subscription lifecycle | `node([source])` — dependency wire, inherent sharing |
| shareReplay / replay | Configurable refcount/reset | `replay(source, bufferSize)` — replays on new subscribe | `replay(source, buffer_size)` — same |
| Reset on zero subscribers | Configurable in RxJS | Always resets (producer teardown) | Always resets |

**Verdict: DIVERGENT (intentional)** — No `resetOnRefCountZero` / `refCount`
configuration. GraphReFly always uses refcount semantics and always resets. This is
simpler but less flexible than RxJS's configurable `share({ resetOnRefCountZero })`.

**Documentation:** Not documented as a simplification.

---

## Summary Table

| # | Operator | Verdict | Risk Level |
|---|----------|---------|------------|
| 1 | switchMap | ALIGNED | Low |
| 2 | mergeMap/flatMap | DIVERGENT (intentional) — no concurrent param | Medium |
| 3 | concatMap | ALIGNED | Low |
| 4 | exhaustMap | ALIGNED | Low |
| 5 | merge | DIVERGENT (intentional) — array arg in TS | Medium |
| 6 | combine | DIVERGENT (intentional) — name, not `combineLatest` | **High** |
| 7 | withLatestFrom | ALIGNED | Low |
| 8 | zip | ALIGNED | Low |
| 9 | scan | DIVERGENT (intentional) — seed required | Medium |
| 10 | reduce | DIVERGENT (intentional) — seed required | Low |
| 11 | debounce | DIVERGENT (intentional) — naming (`debounceTime`) | **High** |
| 12 | throttle | ALIGNED (behavior); naming diverges (`throttleTime`) | Medium |
| 13 | take(0) | ALIGNED | Low |
| 14 | startWith | DIVERGENT (minor) — single value only | Low |
| 15 | share/replay | DIVERGENT (intentional) — no refcount config | Low |

### Cross-language inconsistency (TS vs Py)

| Issue | Details |
|-------|---------|
| `debounce` RESOLVED handling | TS delays RESOLVED by `ms`; Py forwards immediately |
| API shape (array vs variadic) | TS `merge([a,b])`, `combine([a,b])`, `zip([a,b])` — Py uses variadic `merge(a,b)`, `combine(a, b)`, `zip(a, b)` |
| `flat_map` vs `flatMap` alias | TS: `export const flatMap = mergeMap` (true alias). Py: `flat_map` is a standalone implementation (same behavior, not aliased) |

---

## AI Discoverability Assessment

### Naming gaps (LLM will search for these and fail)

| RxJS name | GraphReFly name | Impact |
|-----------|----------------|--------|
| `combineLatest` | `combine` | **Critical** — most LLMs will generate `combineLatest(...)` |
| `debounceTime` | `debounce` | **High** — common RxJS import |
| `throttleTime` | `throttle` | **Medium** — same issue |
| `shareReplay` | `replay` | **Medium** |
| `forkJoin` | (not implemented) | Low — niche |

### Missing operators that LLMs commonly reach for

| Operator | Status | Notes |
|----------|--------|-------|
| `catchError` | `rescue` (Py only; TS has `rescue` too) | Name divergence |
| `finalize` | Not implemented | Common for cleanup |
| `tap` (with error/complete handlers) | `tap` exists but DATA-only | RxJS tap accepts `{ next, error, complete }` |
| `distinctUntilKeyChanged` | Not implemented | Common shorthand |
| `switchMapTo` / `concatMapTo` | Not implemented | Low priority, deprecated in RxJS 8 |

### Documentation coverage for nuances

- **Insufficient for AI users.** Docstrings describe "what" but rarely explain
  divergences from RxJS or the "why" behind design choices.
- No "Coming from RxJS" migration guide exists.
- No operator aliases or re-exports for RxJS names.

---

## Cross-reference: Batch 4-8 Processed Results

The following items from `batch-4-8-processed-result.md` directly affect the assessments
above.

### Python switchMap/concatMap/exhaustMap have confirmed inner-ERROR bugs

Batch 4-8 §Implementation Gaps documents four xfailed Python tests:

| Operator | Bug | Severity |
|----------|-----|----------|
| `switch_map` | Outer COMPLETE doesn't wait for active inner | P1 |
| `switch_map` | Inner ERROR not forwarded | P1 |
| `concat_map` | Inner ERROR not forwarded | P1 |
| `exhaust_map` | Inner ERROR not forwarded | P1 |

**Impact on Batch 14:** The assessments for operators 1, 3, and 4 (switchMap,
concatMap, exhaustMap) marked them as "ALIGNED" — but that's **only true for TS**.
Python implementations have confirmed bugs where inner ERROR doesn't propagate. An LLM
generating Python code that relies on error forwarding from inner subscriptions will
produce code that silently swallows errors.

**Recommendation:** Either fix the Py bugs before documenting alignment, or add a
prominent warning in any "Coming from RxJS" guide that Py inner-error forwarding is
broken for `switch_map`, `concat_map`, `exhaust_map`.

### share/replay zero-subscriber cleanup is untested

Batch 4-8 §Remaining Items lists "Share/cached/replay cleanup on zero subscribers" as
a P2 test gap. Batch 14 §15 claims GraphReFly "always resets" on zero subscribers.

**Impact:** This claim is **unverified** for edge cases. The `replay()` TS
implementation was recently patched (Batch 4-8 §4) to return a real `NodeImpl`, so the
replay path may still have rough edges under subscriber churn.

### `distinctUntilChanged` — `operator.is_` vs `Object.is`

Batch 4-8 §Remaining Items flags `distinctUntilChanged` NaN/+0/-0 edge cases as
untested. This intersects with a cross-language semantic gap:

| Runtime | Default equality | `NaN === NaN` | `+0 === -0` |
|---------|-----------------|---------------|-------------|
| TS (`Object.is`) | Value equality | `true` | `false` |
| Py (`operator.is_`) | Identity | `True` (singleton) | `True` (same object) |

For primitives, `operator.is_` in Python checks **identity**, not value equality.
While CPython interns small integers and `NaN` is a singleton (so `is_` works for
common cases), this is an **implementation detail**, not a language guarantee.

**Recommendation:** Python `distinctUntilChanged` should default to `operator.eq`
(value equality) rather than `operator.is_` (identity) to match the TS `Object.is`
semantics more closely. At minimum, document this difference.

---

## Recommendations

### 1. Add a "Coming from RxJS" guide (high priority)

A single `docs/coming-from-rxjs.md` mapping RxJS names → GraphReFly names would
dramatically improve AI code generation accuracy. Key entries:

```
combineLatest  → combine
debounceTime   → debounce
throttleTime   → throttle
shareReplay    → replay
catchError     → rescue
mergeMap(fn,n) → no concurrent param; use concatMap for serial
```

### 2. Consider re-exporting aliases (medium priority)

```ts
// In operators.ts or index.ts
export { combine as combineLatest };
export { debounce as debounceTime };
export { throttle as throttleTime };
export { replay as shareReplay };
```

This costs nothing and makes AI-generated code work without changes. The aliases
can be marked as `@deprecated` or `@alias` if preferred.

### 3. Reconcile TS/Py RESOLVED handling in debounce

TS debounces RESOLVED (delays it), Py forwards immediately. Pick one behavior and
document it. The Py behavior (forward immediately) is more intuitive — debounce should
only affect DATA emissions.

### 4. Document seed-required divergence in scan/reduce

Add a note: "Unlike RxJS, `seed` is always required. This avoids the surprising
seedless behavior where the first value silently becomes the accumulator."

### 5. Add concurrent param to mergeMap (low priority)

Not urgent, but `mergeMap(fn, { concurrent: 3 })` is a common RxJS pattern. Can be
deferred to a later phase.

### 6. Standardize array vs variadic API across TS/Py

Either both use arrays or both use variadic. Current split (TS arrays, Py variadic) for
`merge`, `combine`, `zip` creates cross-language confusion when an LLM switches between
the two implementations.
