# Session: Tier 2 Operator Parity — Signal Ordering, nonlocal, forwardInner, sample Architecture

**SESSION ID:** tier2-parity-nonlocal-forward-inner
**DATE:** March 30, 2026
**REPOS:** graphrefly-ts, graphrefly-py

---

## Topic

Cross-repo parity analysis and fixes for three divergences discovered during the `/parity` skill run following the COMPLETE-before-DATA batch ordering fix (session: batch 9–15 signal classification). The fixes address:

1. **`_forward_inner` double-DATA prevention** (#4) — Python's `_forward_inner` unconditionally called `actions.down([(DATA, inner.get())])` after `inner.subscribe()`, risking double-DATA if the inner emitted during subscribe.
2. **`nonlocal` replaces `[value]` list-boxing** (#5) — Python operators used `[False]`/`[None]`/`[0]` list patterns to work around closure capture. Replaced with idiomatic `nonlocal` across all 18 operators.
3. **`sample` architecture alignment** (#7) — Python sample used a mirror node + raw subscribe; TS used a two-dep node with `onMessage`. Python rewritten to match TS.

Additionally, the session established that **Tier 2 operator regression tests are the highest-priority testing gap** — their logic will get increasingly complex as we wire more message types, composite data patterns, and adapters that RxJS/callbag never had to handle.

---

## Key Discussion

### Problem: Three Architectural Divergences

The parity analysis (Phases 2–4) compared graphrefly-ts and graphrefly-py after the signal classification overhaul and found 8 "intentional divergences" — 3 of which were actually solvable:

| # | Divergence | Root Cause | Risk |
|---|-----------|------------|------|
| 4 | `forwardInner` subscribe-only (TS) vs subscribe+get (Py) | Python subscribe doesn't auto-emit initial DATA | Double-DATA for derived inners in Python |
| 5 | `attached` as `let` (TS) vs `[False]` list (Py) | Python 2 closure workaround carried forward | Readability, misleading ruff lints |
| 7 | `sample`: 2-dep node (TS) vs mirror+subscribe (Py) | Different operator architecture per language | Extra intermediate node, different error propagation paths |

### Fix #4: `_forward_inner` — emitted flag

**Before:** After `inner.subscribe(inner_sink)`, Python always ran:
```python
if unsub[0] is not None:
    actions.down([(MessageType.DATA, inner.get())])
```

This compensated for Python's subscribe not auto-emitting initial DATA (unlike TS where subscribe triggers `_onSubscribe` → `_runFn` → initial DATA). But if the inner was a derived/computed node that DID emit DATA during subscribe, this caused double-DATA.

**After:** Added `emitted` flag set inside `inner_sink` when DATA is received:
```python
emitted = False

def inner_sink(msgs):
    nonlocal emitted
    for m in msgs:
        if m[0] is MessageType.DATA:
            emitted = True
        ...

unsub = inner.subscribe(inner_sink)

if unsub is not None and not emitted:
    actions.down([(MessageType.DATA, inner.get())])
```

The manual emit only fires when subscribe didn't already deliver DATA. This is the correct behavior for both state nodes (no DATA on subscribe → manual emit needed) and derived nodes (DATA on subscribe → skip manual emit).

### Fix #5: `nonlocal` replaces list-boxing

**Before (Python 2 era pattern):**
```python
source_done = [False]
def on_complete():
    source_done[0] = True
```

**After (idiomatic Python 3):**
```python
source_done = False
def on_complete():
    nonlocal source_done
    source_done = True
```

Applied to all 18 operators in tier2.py: `_forward_inner`, `switch_map`, `concat_map`, `flat_map`, `exhaust_map`, `debounce`, `throttle`, `audit`, `timeout`, `buffer_time`, `interval`, `repeat`, `pausable`, `window`, `window_count`, `window_time`.

**Kept as list:** The `holder: list[NodeActions | None] = [None]` pattern inside `open_win()` — this is a one-shot capture mechanism (local to function, read immediately after callback writes to it). `nonlocal` doesn't help here.

**Lint fix:** Moving `flush()`/`close_window()`/`fire()` function definitions out of `for m in msgs:` loops to fix ruff B023 (function definition does not bind loop variable). These functions always read the latest nonlocal value, so defining them once is correct and cleaner.

### Fix #7: `sample` — dep+onMessage architecture

**Before (Python):** Producer-style with mirror node:
```python
mirror = node([src], lambda d, _: d[0], describe_kind="sample_mirror")
def start(_deps, actions):
    u0 = mirror.subscribe(in_sink)
    u1 = notifier.subscribe(n_sink)
    ...
return node(start, ...)
```

**After (matches TS):** Two-dep node with `onMessage`:
```python
def on_message(msg, index, a):
    if index == 1 and t is MessageType.DATA:
        a.emit(src.get())
        return True
    if index == 0:
        return True  # swallow source messages
    ...
return node([src, notifier], compute, on_message=on_message, ...)
```

This eliminates the mirror node, uses the same index-based `onMessage` dispatch as TS, and has identical error/complete propagation paths.

---

## Rejected Alternatives

### Option A: Align Python subscribe to auto-emit initial DATA
Considered making Python's `subscribe()` auto-emit initial DATA like TS. Rejected because:
- Would touch `node.py` subscribe internals — high blast radius
- Any Python code relying on subscribe NOT emitting initial DATA would break
- The `emitted` flag in `_forward_inner` is a targeted fix with zero side effects

### Option C: Targeted `_forward_inner` fix only (defer #5 and #7)
Considered fixing only the double-DATA bug and deferring `nonlocal` + sample rewrites. Rejected because:
- The `[value]` pattern was causing misleading ruff lints throughout the file
- The sample divergence was easy to fix and eliminates an entire intermediate node
- Doing all three in one session avoids re-reading the same code later

---

## Key Insights

1. **Python subscribe semantics differ from TS** — TS subscribe triggers `_onSubscribe` → `_runFn` → initial DATA emission. Python subscribe does NOT auto-emit initial DATA for state nodes. This is a fundamental architectural difference that `_forward_inner` must compensate for. The `emitted` flag makes this compensation safe for both state and derived inners.

2. **`nonlocal` is strictly better than `[value]` for boolean/counter flags** — The list-boxing pattern was a Python 2 workaround. With `nonlocal`, the code reads identically to the TS closures, ruff doesn't complain about unbound loop variables, and the type annotations are cleaner (`bool` vs `list[bool]`).

3. **Tier 2 operators are the highest regression risk** — Unlike Tier 1 (stateless transforms), Tier 2 operators manage inner subscriptions, timers, buffers, and completion tracking. As we add more message types (beyond the 9 current), composite data patterns (IDB transactions, streaming LLM chunks), and adapters (WebSocket, SSE, cron), the message-handling logic in every `onMessage` callback gets more complex. RxJS/callbag never had to handle DIRTY/RESOLVED/INVALIDATE/PAUSE/RESUME — they only had next/error/complete. Our operators must correctly route 9+ signal types through dynamic inner subscriptions, which is a combinatorial testing surface that needs comprehensive regression coverage.

4. **The `holder` capture pattern is the one valid use of `[None]` boxing** — When you need to extract a value from a synchronous callback (`win_start` writes `NodeActions` to `holder`, `open_win` reads it immediately after), a mutable list is the simplest mechanism. `nonlocal` doesn't help because the inner function writes and the outer function reads in the same scope.

---

## Forward: Tier 2 Operator Regression Testing Strategy

The current test coverage for Tier 2 operators is:
- **TS:** `operator-protocol-matrix.test.ts` (1046 lines, 50+ operators) — protocol-level DIRTY-before-DATA, terminal sequencing, RESOLVED handling
- **Python:** `test_extra_tier2.py` (375 lines) — functional tests only, no protocol-matrix equivalent

**Gaps that will bite us:**
- **Composite message ordering** through dynamic inner subscriptions (e.g., `switchMap` receives `[[DIRTY], [DATA, x], [COMPLETE]]` from outer while inner is active)
- **Void sources** (`Node<void>` / `Node[None]`) through every Tier 2 operator — the `[[DATA, undefined], [COMPLETE]]` pattern must work through `switchMap.forwardInner`, `concatMap.tryPump`, etc.
- **PAUSE/RESUME propagation** through `switchMap`/`exhaustMap` — should the inner be paused? Should the outer?
- **INVALIDATE through operators** — does invalidating the outer source invalidate the inner? The current operators don't handle INVALIDATE at all.
- **Error recovery** — `rescue(fn)` wrapping a `switchMap` — does the inner's ERROR bubble correctly? Does recovery re-subscribe?
- **Timer-based operators under batch** — `debounce`/`throttle`/`audit` fire timer callbacks that emit DATA. These callbacks may run during a batch drain. Do they defer correctly?

**Recommended test structure:** A `test_tier2_protocol_matrix.py` mirroring TS's `operator-protocol-matrix.test.ts`, with heavy commenting explaining what each test defends and why the assertion order matters.

---

## Files Changed

### graphrefly-py
- `src/graphrefly/extra/tier2.py` — `_forward_inner` emitted flag, `nonlocal` conversion (18 operators), `sample` rewritten to dep+onMessage, lint fixes (B023 loop definitions, SIM114/SIM103 simplifications)

### graphrefly-ts
- No code changes (TS was already correct for all three divergences)

---

**Cross-reference:** This session follows `SESSION-cross-repo-implementation-audit.md` (batch 9–15 signal classification fixes). The signal tier system, `partitionForBatch` three-way split, and `attached` flag pattern established in that session are prerequisites for understanding these fixes.
