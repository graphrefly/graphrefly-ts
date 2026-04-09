# Session: Protocol Semantics Revalidation

> **Date:** 2026-04-08 (second session, same day)  
> **Triggered by:** Continued investigation after inspection-harness-revalidation session. 12 test failures from incorrect `first_where` replacements led to deep examination of subscription semantics, push/pull behavior, and protocol foundations.  
> **Prerequisite:** `SESSION-inspection-harness-revalidation.md`

---

## Context

The previous session replaced `_wait_for` polling with `first_where` but introduced 12 test failures. This session diagnosed the root cause, fixed all failures, and then conducted a deep revalidation of the protocol's connection-time semantics (push vs pull, subscribe behavior, `.get()` vs subscribe, operator chain composition).

---

## Part 1: Diagnosing and fixing the 12 test failures

### Root cause

All 12 failures had the same root: `first_where` subscribes and waits for **future** emissions, but the data had **already flowed** before `first_where` was called. GraphReFly is fire-and-forget — data flows once to current subscribers and is gone. There is no replay.

The previous session's agent (running in a compacted context) confused GraphReFly with TC39 Signals semantics, where subscribers receive the current value on subscribe.

### Why the confusion persisted

1. **Context compaction amnesia** — the compacted summary said "replace `_wait_for` with `first_where`" as settled fact. The approach was inherited without re-examining from first principles.
2. **TC39 Signals contamination** — LLM training data is saturated with Signals libraries where `subscribe` replays the current value.
3. **Tests initially passing masked the bug** — some tests passed due to race conditions (background thread happened to emit after `first_where` subscribed). "Tests pass" was taken as "approach is correct" instead of reasoning from protocol semantics.

### The `filter → take(1) → first_value_from` composition bug

The original `first_where` implementation composed `filter → take(1) → first_value_from`. This fails even when the source has a value because:

- `filter` creates a derived node depending on the source
- When `first_value_from` subscribes to the `take(1)` node, subscription propagates up through `filter` to `source`
- The source's value flows synchronously through the chain during this wiring
- By the time `first_value_from`'s `done.wait()` is reached, the data has already passed through and `done` was never set (the sink was registered but the synchronous flow completed within the `subscribe` call stack before `done.wait()`)

**Verified empirically:**
```python
from graphrefly.extra import of
from graphrefly.extra.tier1 import filter as rf_filter
from graphrefly.extra.sources import first_value_from

# of(42) emits DATA(42) then COMPLETE synchronously
source = of(42)
filtered = source | rf_filter(lambda v: v == 42)

# Subscriber to filtered sees: [('DIRTY', None), ('COMPLETE', None)]
# DATA(42) is MISSING — consumed during wiring, never reaches late subscriber
```

**Fix:** Rewrote `first_where` as a direct subscriber with inline predicate check (both TS and PY). No operator chain.

### Fixes applied (12 tests, 3 categories)

#### Category 1: Adapter tests (6 failures)

Pattern: Collector subscriber wired → data emitted → `done.wait()` guarantees delivery → `first_where` subscribes too late.

**Fix:** Remove `first_where` entirely — the collector is already populated by the time `done.wait()` returns. The `_wait_for` was unnecessary paranoia; `done.set()` is called after the producer emits, and subscribers fire synchronously within `down()`.

Files: `tests/test_adapters_ingest.py` (Kafka, Syslog, StatsD, Pulsar, NATS, RabbitMQ data tests)

#### Category 2: HTTP error test (1 failure)

Pattern: `from_http` starts a fetch thread on `bundle.node.subscribe()`. With mock `side_effect=Exception(...)`, the thread throws immediately and sets `bundle.status` to `"errored"` before `first_where(bundle.status, ...)` subscribes.

**Fix:** Wire `bundle.status.subscribe()` with a `threading.Event` **before** calling `bundle.node.subscribe()` (which activates the fetch thread). The observer catches the status change because it's wired before the producer starts.

```python
errored = threading.Event()
unsub_status = bundle.status.subscribe(
    lambda msgs: [errored.set() for m in msgs
                  if m[0] is MessageType.DATA and m[1] == "errored"]
)
unsub = bundle.node.subscribe(lambda _: None)  # activates fetch thread
errored.wait(timeout=5.0)
```

File: `tests/test_extra_sources_http.py`

#### Category 3: Harness tests (5 failures)

**Key discovery:** With `MockLLMAdapter`, the entire harness pipeline processes **synchronously**. `promptNode` uses `switch_map` which calls `fn(v)` inline. The mock adapter's `invoke()` returns immediately. So after `h.intake.publish(item)`, the full chain (intake → triage → router → queue → execute → verify → strategy) has already settled within the `publish()` call.

**Fix for gate test:** Replace `first_where(queue.latest, ...)` with `queue.latest.get()` — the value is already cached.

**Fix for trace tests:** Remove `first_where` entirely — the trace logger is wired via `harness_trace()` before `publish()`, so it captures events synchronously during `publish()`. Just assert on the `lines` list directly.

Files: `tests/test_patterns_harness.py`

### Test results after fixes

- **TS:** 50 files, 1370 tests — all pass
- **PY:** 1157 passed, 1 skipped — all pass

---

## Part 2: Protocol semantics deep dive

### Push/pull at connection time

In callbag terminology:
- **Push at connection** = source sends DATA down to sink without the sink asking
- **Pull at connection** = sink sends a signal UP to source requesting data

**Verified behavior (identical in TS and PY):**

| Node type | On `subscribe` | DOWN (push)? | UP (pull)? | `.get()` | `.status` |
|-----------|---------------|--------------|------------|----------|-----------|
| `state('hello')` | Sink registered, nothing flows | **No** | **No** | `'hello'` | `'settled'` |
| `state(None)` | Sink registered, nothing flows | **No** | **No** | `None` | `'settled'` |
| `derived` (1st sub) | `_connect_upstream` → `_run_fn` → DIRTY + DATA | **Yes** (DIRTY + DATA) | **No** | computed value | `'settled'` |
| `derived` (2nd+ sub) | Sink registered, nothing flows | **No** | **No** | cached value | `'settled'` |

**Empirical verification:**

```python
# state('hello') — INERT at connection
s = state('hello')
collected = []
unsub = s.subscribe(sink)
# collected = []  ← no push, no pull
# s.get() = 'hello'  ← cache read (peek)
# s.status = 'settled'

# derived — PUSH on first activation only
d = derived([s], lambda deps, _: deps[0].upper())
c1 = []
u1 = d.subscribe(sink)
# c1 = [('DIRTY', None), ('DATA', 'HELLO')]  ← push on activation
# d.get() = 'HELLO'

c2 = []
u2 = d.subscribe(sink)
# c2 = []  ← no push for 2nd subscriber
```

### Key finding: GraphReFly is push-only, lazy-activated, no-replay

The protocol is **neither pure push nor pure pull** at connection:

1. **`state` is inert at connection.** It holds a cached value accessible via `.get()`, but does NOT push it to new subscribers. It also does not respond to pull (no UP signal during subscribe). Future `.down(DATA, v)` / `.set(v)` calls push to all current subscribers.

2. **`derived` pushes on first activation only.** The first subscriber triggers `_connect_upstream()` → `_run_fn()` → emits DIRTY + DATA synchronously. This is a side effect of connection (the node activating its computation), NOT a pull mechanism (no UP signal is sent). Subsequent subscribers get nothing.

3. **No pull-at-connection exists.** The `up()` method exists in the protocol but is never called during `subscribe`. There is no mechanism for a sink to request the current value from a source at connection time.

4. **`.get()` is always a peek.** It reads the cache. It does NOT trigger computation (spec: "Does NOT guarantee freshness and does NOT trigger computation"). `.status` tells you whether the cached value is trustworthy.

### How this differs from related systems

| System | Subscribe behavior | Pull mechanism |
|--------|-------------------|----------------|
| **TC39 Signals** | Reading `.value` triggers lazy computation + returns current value | Implicit pull on read |
| **RxJS BehaviorSubject** | Subscriber immediately receives current value on subscribe | Push-on-subscribe (replay 1) |
| **RxJS Observable** | Subscriber receives only future emissions | No replay |
| **callbag (pullable)** | Sink sends type 1 to source after handshake to request data | Explicit pull |
| **GraphReFly** | Subscriber receives only future emissions (except derived 1st-sub activation) | **No pull.** `.get()` is a separate peek path. |

GraphReFly is closest to RxJS Observable — no replay, push-only. The `derived` first-subscriber activation looks like BehaviorSubject replay but it's actually the node's lazy computation firing, not a replay mechanism. The second subscriber proves this — it gets nothing.

### The `_subscribe_body` code path (PY, verified identical in TS)

```python
def _subscribe_body(self, sink, hints):
    # ... add sink to sink set ...
    
    if self._has_deps:
        self._connect_upstream()    # derived: subscribe to deps, run fn
    elif self._fn is not None:
        self._start_producer()      # producer: start producer fn
    # state (no deps, no fn): nothing happens — sink just registered
```

For state nodes: no deps, no fn → sink is registered, nothing else happens. The cached value from construction is accessible via `.get()` but never pushed.

For derived nodes: `_connect_upstream` → subscribes to all deps → `_run_fn()` (line 644). But `_connect_upstream` has an early return: `if self._connected: return`. So only the FIRST subscriber triggers computation. Subsequent subscribers are just added to the sink set.

### The `derived` first-subscriber DIRTY + DATA explained

When `derived` activates for the first time:
1. `_connect_upstream()` subscribes to deps
2. Deps may emit DIRTY to the derived node (via `_handle_dep_messages`)
3. After all deps are subscribed, `_run_fn()` is called
4. `_run_fn()` reads dep values via `.get()`, runs the compute function, calls `_down_auto_value(result)` which emits `[DIRTY, DATA(result)]` to all subscribers

The DIRTY is the derived node signaling "I'm recomputing", and the DATA is the result. Both are pushed DOWN synchronously within the `subscribe()` call stack.

### Implications for test patterns

| Scenario | Correct approach |
|----------|-----------------|
| Need current value of any node | `.get()` + check `.status` |
| Need to wait for a future emission | Wire `subscribe` or `first_where` **BEFORE** the trigger |
| Need to verify data flowed through a chain | Wire collector subscriber **BEFORE** emitting, then assert on collector |
| Mock adapter pipeline (synchronous) | Everything settles within `publish()` — just use `.get()` after |
| Real adapter pipeline (async/threaded) | Wire observer before trigger, use `threading.Event` or `first_where` |

### Implications for `first_where` / `first_value_from`

These are bridges from reactive to synchronous/async. They subscribe and wait for the **next** emission. They are correct tools when:
- The emission will happen in the **future** (background thread, async source)
- The subscription is wired **BEFORE** the emission trigger

They are the **wrong** tools when:
- Data has already flowed (use `.get()`)
- The pipeline processes synchronously with mock adapters (use `.get()`)

Docstrings updated in both TS and PY to make this explicit.

---

## Open questions for future sessions

1. **Should `state` push its value on subscribe?** Currently it doesn't. The spec says "Implementations MAY pull-recompute on `get()` when disconnected, but the spec does not require it." There is no equivalent "MAY push current value on subscribe." Is this intentional or an omission? The current behavior (inert at connection) is clean and predictable, but it means every consumer must know whether to use `.get()` or `subscribe` based on timing.

2. **Should the COMPOSITION-GUIDE document the operator chain composition subtlety?** The `filter → take(1) → first_value_from` failure is a real composition pitfall: synchronous data flowing through intermediate nodes during wiring gets lost because the terminal subscriber isn't yet attached. This isn't specific to `first_where` — any chain of operators on a synchronous source has this risk.

3. **Is the `derived` first-subscriber activation the right design?** It means derived nodes behave differently for the 1st vs 2nd subscriber. The keepalive pattern (`subscribe(() => {})`) exists specifically to normalize this — by making all "real" subscribers effectively 2nd subscribers. Is this a code smell or a feature?

4. **Push/pull asymmetry:** The protocol has no pull mechanism (no UP signal at connection). This means sinks cannot request the current state. `.get()` exists as a peek but it's outside the reactive flow. Is this the intended design, or should there be a `PULL`/`REQUEST` message type for sinks that want the current value reactively?

---

## Files changed in this session

### PY
- `src/graphrefly/extra/sources.py` — Rewrote `first_where` as direct subscriber (not operator chain), updated docstrings for both `first_where` and `first_value_from`
- `tests/test_adapters_ingest.py` — Removed 6 redundant `first_where` calls after `done.wait()`/sync emit; fixed 3 ERROR tests (use `first_value_from` for terminal events); fixed 1 COMPLETE test (same); removed unused `first_where` where `done.wait()` sufficient
- `tests/test_extra_sources_http.py` — Wired status observer before producer activation; added `threading` and `MessageType` imports
- `tests/test_patterns_harness.py` — Removed all `first_where` (pipeline is synchronous with mock adapter); used `.get()` for cached state; removed unused import

### TS
- `src/extra/sources.ts` — Rewrote `firstWhere` as direct subscriber (not operator chain), removed `filter`/`take` imports, updated docstrings for both `firstWhere` and `firstValueFrom`

### Docs
- `docs/roadmap.md` — Added "Immediate follow-ups" section: Category A (move protocol ops to extra/) and Category B (.set() sugar)
- `archive/docs/design-archive-index.jsonl` — Added `inspection-harness-revalidation` entry

### Skills
- `.claude/skills/dev-dispatch/SKILL.md` — COMPOSITION-GUIDE mandate for patterns/ work
- `.claude/skills/qa/SKILL.md` — COMPOSITION-GUIDE verification check
- `.claude/skills/parity/SKILL.md` — COMPOSITION-GUIDE read for cross-repo patterns/

---

## Verified test results

- **TS:** 50 files, 1370/1370 tests pass
- **PY:** 1157 passed, 1 skipped, 0 failed
