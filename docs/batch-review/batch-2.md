# Batch 2 — Node Primitive Contract Audit

Spec: `~/src/graphrefly/GRAPHREFLY-SPEC.md` sections 2.1 through 2.8
TS: `src/core/node.ts`, `src/core/sugar.ts`, `src/core/meta.ts`
Py: `~/src/graphrefly-py/src/graphrefly/core/node.py`, `core/sugar.py`, `core/meta.py`

---

## 1. Construction Table (spec 2.1)

### No deps, no fn = manual source (`state()`)

**PASS (both repos)**
- TS `sugar.ts:22-24`: `state()` calls `node<T>([], { ...opts, initial })` — no fn, no deps. Factory at `node.ts:866` resolves deps=`[]`, fn=`undefined`.
- Py `sugar.py:13-15`: `state()` calls `node([], {**opts, "initial": initial})` — same. Factory at `node.py:790` resolves deps=`[]`, fn=`None`.

### No deps, with fn = auto source (`producer()`)

**PASS (both repos)**
- TS `sugar.ts:44`: `producer()` calls `node<T>(fn, { describeKind: "producer", ...opts })` — fn provided, no deps. Producer starts on first subscribe via `_startProducer()` (`node.ts:816-819`).
- Py `sugar.py:18-20`: `producer()` calls `node(fn, describe_kind="producer", **opts)` — same. `_start_producer()` at `node.py:522-526`.

### Deps, fn returns value = reactive compute (`derived()`)

**PASS (both repos)**
- TS `sugar.ts:66-72`: `derived()` passes deps + fn. `_runFn()` (`node.ts:648-686`) auto-emits via `_downAutoValue()` when fn returns a non-undefined, non-function value.
- Py `sugar.py:23-25`: same pattern. `_run_fn_body()` (`node.py:366-400`).

### Deps, fn uses `.down()` = custom transform (`operator()`)

**PASS (both repos) — but sugar missing (see 2.8)**
- Both correctly detect `_manualEmitUsed` to skip auto-emit (TS `node.ts:679`, Py `node.py:393`).
- Actions object wires `down()` to set `_manualEmitUsed=true` (TS `node.ts:372-374`, Py `node.py:275-277`).

### Deps, fn returns nothing = side effect (`effect()`)

**PASS (both repos)**
- TS `node.ts:680`: `if (out === undefined) return;` — no auto-emit on undefined.
- Py `node.py:395`: `if out is None: return` — same.

### Deps, no fn = passthrough wire (`subscribe()`)

**PASS (both repos)**
- TS `node.ts:731-740` (`_handleDepMessages` with no fn): forwards all messages directly via `_downInternal([msg])`, except multi-dep COMPLETE which waits for all deps.
- Py `node.py:449-455`: same passthrough logic.

---

## 2. Interface Completeness (spec 2.2)

### get() returns cached value, never throws

**PASS (both repos)**
- TS `node.ts:424-425`: `get(): T | undefined { return this._cached; }` — no throw path.
- Py `node.py:648-652`: `def get(self)` — returns `_cached` with optional lock. No throw path.

### status returns correct union

**PASS (both repos)**
- TS `node.ts:21-27`: `NodeStatus` type is exactly the spec's 6 values. `statusAfterMessage` (`node.ts:266-276`) maps correctly.
- Py `node.py:29`: `NodeStatus = str` (structural). `_status_after_message` (`node.py:65-81`) maps the same 6 values.

### down(messages) sends downstream

**PASS (both repos)**
- TS `node.ts:427-439`: `down()` validates, applies guard, calls `_downInternal()` which dispatches to sinks.
- Py `node.py:712-730`: `down()` same flow with thread-safety wrapper.

### up(messages) sends upstream

**PASS (both repos)**
- TS `node.ts:541-557`: `up()` forwards to each dep's `up()`.
- Py `node.py:733-748`: same.

### unsubscribe() disconnects, retains cached value, status becomes "disconnected"

**PASS (both repos)**
- TS `node.ts:566-569`: `unsubscribe()` calls `_disconnectUpstream()`. At `node.ts:822-833`, `_disconnectUpstream` clears unsubs, sets `_status = "disconnected"`, but does NOT touch `_cached`.
- Py `node.py:761-769`: same — `_disconnect_upstream()` at `node.py:528-538` sets status to "disconnected", preserves cache.

### meta is an object of subscribable nodes

**PASS (both repos)**
- TS `node.ts:356-365`: builds meta nodes in constructor, `Object.freeze`d. Each meta value is a `Node` (via recursive `node()` call).
- Py `node.py:248-258`: builds `_meta` dict, exposed as `MappingProxyType` via property (`node.py:645-646`).

### Source nodes (no deps) do NOT have .up() or .unsubscribe()

**VIOLATION (both repos)**

Both implementations expose `up()` and `unsubscribe()` on ALL node instances regardless of deps. They silently no-op for source nodes:

- TS `node.ts:541-542`: `up()` returns early if `!this._hasDeps`. Always present on instance despite `Node` interface typing it optional (`node.ts:163`).
- TS `node.ts:566-568`: `unsubscribe()` returns early if `!this._hasDeps`. Always present despite optional interface type (`node.ts:165`).
- Py `node.py:733-741`: `up()` no-ops if `not self._has_deps` — always present.
- Py `node.py:761-762`: `unsubscribe()` no-ops if `not self._has_deps` — always present.

**Spec says:** "Source nodes (no deps) do not have `.up()` or `.unsubscribe()` — there is nothing upstream." The methods should be absent, not no-op.

**Severity:** Low. The TS `Node` interface types them as optional (`up?`, `unsubscribe?`), so type-level consumers get the right signal. Runtime presence as no-ops is a pragmatic implementation choice but doesn't match the spec's "do not have" language.

---

## 3. Meta Companion Stores (spec 2.3)

### Each meta key is a subscribable node

**PASS (both repos)**
- TS `node.ts:358-361`: each meta entry is created via `node({ initial: v, ... })` — full `Node` instance, subscribable.
- Py `node.py:249-258`: same — `node(**meta_opts)` produces a full `NodeImpl`.

### Meta nodes appear in describe() output

**PASS (both repos)**
- TS `meta.ts:48-58` (`metaSnapshot`): reads `node.meta` entries via `child.get()`, merged into describe output at `meta.ts:71`.
- Py `meta.py:26-39` (`meta_snapshot`): same approach. Used in `describe_node` at `meta.py:67-72`.

### Meta nodes are individually observable

**PASS (both repos)** — each meta node is a full `Node` with its own `subscribe()`.

---

## 4. fn Contract (spec 2.4)

### Returns value -> cache + auto-emit [[DIRTY], [DATA, value]] or [[DIRTY], [RESOLVED]]

**PASS (both repos)**
- TS `node.ts:633-639` (`_downAutoValue`): if unchanged per `_equals`, emits `[[RESOLVED]]` (when already dirty) or `[[DIRTY], [RESOLVED]]`. If changed, caches value, emits `[[DATA, value]]` or `[[DIRTY], [DATA, value]]`.
- Py `node.py:342-364` (`_down_auto_value`): identical logic.

### Returns nothing -> side effect, no auto-emit

**PASS (both repos)**
- TS `node.ts:680`: `if (out === undefined) return;`
- Py `node.py:395`: `if out is None: return`

### Uses down() explicitly -> no auto-emit from return value

**PASS (both repos)**
- TS `node.ts:679`: `if (this._manualEmitUsed) return;` — checked after fn runs.
- Py `node.py:393-394`: same check.

### Returns cleanup function -> called before next invocation or on teardown

**VIOLATION (both repos) — cleanup NOT called on TEARDOWN for compute nodes**

Cleanup is correctly called before next invocation:
- TS `node.ts:671`: `this._cleanup?.()` runs before re-executing fn.
- Py `node.py:385-387`: same.

Cleanup is called on teardown for **producer nodes only** (via `_stopProducer`):
- TS `node.ts:809-813`: `_stopProducer` calls `this._cleanup?.()`.
- Py `node.py:514-520`: same.

BUT for **compute nodes** (deps + fn), TEARDOWN does NOT call cleanup:
- TS `node.ts:605-626`: TEARDOWN handler calls `_disconnectUpstream()` + `_stopProducer()`. `_stopProducer` exits immediately at line 810 because `_producerStarted` is `false` for compute nodes (only set at line 817 for producer pattern). `_disconnectUpstream` at line 822 does not call cleanup.
- Py `node.py:326-333`: same — `_disconnect_upstream()` + `_stop_producer()`. `_stop_producer` exits at line 515 because `_producer_started` is false for compute nodes. `_disconnect_upstream` at line 528 doesn't call cleanup.

**Spec says:** "Returns a cleanup function: called before next invocation **or on teardown**."

**Fix:** Add `this._cleanup?.(); this._cleanup = undefined;` in the TEARDOWN branch of `_handleLocalLifecycle` (before `_disconnectUpstream()`), for both repos.

### Throws -> [[ERROR, err]] downstream

**PASS (both repos)**
- TS `node.ts:683-685`: catch block emits `[[ERROR, err]]`.
- Py `node.py:399-400`: same.

---

## 5. Options (spec 2.5)

### name

**PASS (both repos)** — TS `node.ts:337`, Py `node.py:204`.

### equals

**PASS (both repos)** — TS defaults to `Object.is` (`node.ts:339`), Py defaults to `operator.is_` (`node.py:205`). Used in `_downAutoValue` for RESOLVED detection.

### initial

**PASS (both repos)** — TS `node.ts:346`, Py `node.py:224`.

### meta

**PASS (both repos)** — See section 3 above.

### resubscribable

**PASS (both repos)**
- TS `node.ts:488-491`: on subscribe, resets terminal state if resubscribable.
- Py `node.py:547-549`: same.
- Both block messages after terminal unless resubscribable (TS `node.ts:445-449`, Py `node.py:675-682`).

### resetOnTeardown

**PASS (both repos)**
- TS `node.ts:604-606`: clears `_cached` on TEARDOWN when option set.
- Py `node.py:327-332`: same (with `_reset_on_teardown`).

### onMessage

**PASS (both repos)** — See section 6.

---

## 6. onMessage Contract (spec 2.6)

### Called for every message from every dep

**PASS (both repos)**
- TS `node.ts:722-729`: `_onMessage` check is the first thing inside the per-message loop in `_handleDepMessages`.
- Py `node.py:442-447`: same position in `_handle_dep_messages`.

### Return true -> consumed, skip default handling

**PASS (both repos)**
- TS `node.ts:725`: `if (this._onMessage(msg, index, this._actions)) continue;` — `continue` skips remaining dispatch for that message.
- Py `node.py:444-445`: same.

### Return false -> default dispatch

**PASS (both repos)** — if handler returns false (or isn't set), execution falls through to the default DIRTY/DATA/RESOLVED/etc. dispatch.

### Throws -> [[ERROR, err]] downstream

**PASS (both repos)**
- TS `node.ts:726-729`: catch block emits `[[ERROR, err]]` and returns (stops processing batch).
- Py `node.py:446-448`: same.

### depIndex and actions provided correctly

**PASS (both repos)**
- TS `node.ts:724`: `this._onMessage(msg, index, this._actions)` — `index` is the loop variable from subscribe setup, `this._actions` has `down/emit/up`.
- Py `node.py:444`: `self._on_message(msg, index, self._actions)` — same.

---

## 7. Diamond Resolution (spec 2.7)

### Bitmask implementation

**PASS (both repos)**

TS bitmask (`node.ts:174-257`):
- `createIntBitSet()` for <=31 deps (integer bitmask).
- `createArrayBitSet()` for >31 deps (`Uint32Array`).
- Correct `set/clear/has/covers/any/reset` operations.

Py bitmask (`node.py:34-61`):
- Single `_BitSet` class using Python's unlimited-precision int.
- Same operations.

### Single recompute after all deps settle

**PASS (both repos)**

Diamond flow (`_onDepDirty` + `_onDepSettled`):
- TS `node.ts:688-707`: DIRTY sets bit in `_depDirtyMask`, clears from `_depSettledMask`, emits DIRTY once (first dep only). DATA/RESOLVED sets bit in `_depSettledMask`. Recompute only when `_depSettledMask.covers(_depDirtyMask)`.
- Py `node.py:414-428`: identical logic.

Trace through diamond (A→B,C→D):
1. A emits DIRTY → B dirty → D receives DIRTY from dep 0 → `_onDepDirty(0)` → dirtyMask={0}, emits [[DIRTY]]
2. A emits DIRTY → C dirty → D receives DIRTY from dep 1 → `_onDepDirty(1)` → dirtyMask={0,1}, no re-emit (already dirty)
3. B settles (DATA) → D: `_onDepSettled(0)` → settledMask={0}. `{0}` doesn't cover `{0,1}`. No recompute.
4. C settles (DATA) → D: `_onDepSettled(1)` → settledMask={0,1}. Covers `{0,1}`. **Recompute once.** Masks reset.

Correct. D recomputes exactly once with both deps settled.

---

## 8. Sugar Constructors (spec 2.8)

### state(initial, opts?)

**PASS (both repos)**
- Spec: `node([], null, { initial, ...opts })`.
- TS `sugar.ts:22-24`: `node<T>([], { ...opts, initial })` — matches (no fn = null).
- Py `sugar.py:13-15`: `node([], {**opts, "initial": initial})` — matches.

### producer(fn, opts?)

**PASS (both repos)**
- Spec: `node([], fn, opts)`.
- TS `sugar.ts:44`: `node<T>(fn, { describeKind: "producer", ...opts })` — the factory resolves to deps=[], fn=fn. Correct.
- Py `sugar.py:18-20`: `node(fn, describe_kind="producer", **opts)` — same resolution.

### derived(deps, fn, opts?)

**PASS (both repos)**
- Spec: `node(deps, fn, opts)` — fn returns value.
- TS `sugar.ts:66-72`: `node<T>(deps, fn, { describeKind: "derived", ...opts })`.
- Py `sugar.py:23-25`: `node(list(deps), fn, describe_kind="derived", **opts)`.

### effect(deps, fn)

**PASS (both repos)**
- Spec: `node(deps, fn)` — fn returns nothing.
- TS `sugar.ts:93-95`: `node(deps, fn, { describeKind: "effect" })`.
- Py `sugar.py:28-30`: `node(list(deps), fn, describe_kind="effect", **opts)`.

**INCONSISTENCY (TS vs Py):** Py `effect()` accepts `**opts` kwargs, allowing extra options. TS `effect()` only accepts `deps` and `fn` — no `opts` parameter. Spec says `effect(deps, fn)` with no opts, so TS is stricter (and more spec-aligned). Minor.

### operator(deps, fn, opts?)

**VIOLATION (both repos) — missing sugar**
- Spec: `operator(deps, fn, opts?) = node(deps, fn, opts)` — fn uses down().
- Neither TS nor Py provides an `operator()` sugar constructor.

### subscribe(dep, callback)

**VIOLATION (both repos) — missing sugar**
- Spec: `subscribe(dep, callback) = node([dep], callback)` — single dep shorthand.
- Neither TS nor Py provides a `subscribe()` sugar constructor.

### pipe(source, ...ops)

**PASS (both repos)**
- TS `sugar.ts:121-127`: left-to-right fold.
- Py `sugar.py:33-37`: same. Also Py has `__or__` override (`node.py:771-776`) for `source | op` syntax per spec §6.1.

### All sugars create nodes, not distinct types

**PASS (both repos)** — all sugar constructors call through to `node()`, returning `Node`/`NodeImpl`. No separate classes.

---

## Summary

| Item | Result | Details |
|------|--------|---------|
| 2.1 Construction (6 patterns) | **PASS** | All 6 patterns work in both repos |
| 2.2 get(), status, down(), up(), meta | **PASS** | Correct in both |
| 2.2 Source nodes lack up/unsubscribe | **VIOLATION (both)** | Methods exist as no-ops instead of being absent |
| 2.3 Meta companion stores | **PASS** | Full node, subscribable, in describe output |
| 2.4 fn returns value / nothing / down() | **PASS** | Auto-emit, skip, manual all correct |
| 2.4 Cleanup called on teardown | **VIOLATION (both)** | Compute nodes (deps+fn) don't call cleanup on TEARDOWN |
| 2.5 Options | **PASS** | All 7 options exist and work |
| 2.6 onMessage | **PASS** | All 5 sub-requirements met |
| 2.7 Diamond resolution | **PASS** | Bitmask correct, single recompute verified |
| 2.8 Sugar: state, producer, derived, effect, pipe | **PASS** | Correct mappings |
| 2.8 Sugar: operator(), subscribe() | **VIOLATION (both)** | Missing (spec says SHOULD) |
| 2.8 effect() opts | **INCONSISTENCY** | Py accepts extra opts, TS does not |

### Critical Fixes Needed

1. **Cleanup on TEARDOWN (both repos):** In `_handleLocalLifecycle`'s TEARDOWN branch, add cleanup invocation before `_disconnectUpstream()`:
   - TS `node.ts:605`: add `this._cleanup?.(); this._cleanup = undefined;`
   - Py `node.py:326`: add `if self._cleanup: self._cleanup(); self._cleanup = None`

### Recommended (SHOULD)

2. **Add `operator()` sugar** to both repos — trivial: `node(deps, fn, { describeKind: "operator", ...opts })`.
3. **Add `subscribe()` sugar** to both repos — trivial: `node([dep], callback)`.
4. **Source node up/unsubscribe:** Consider making these methods conditionally absent on source nodes, or document the no-op behavior as an intentional deviation. The TS `Node` interface already types them as optional, which is the right API signal.
