# SESSION: START Protocol + ROM/RAM Refactor

> **Date:** 2026-04-09 → 2026-04-10
> **Origin:** graphrefly-ts
> **Trigger:** Systematic fix of all problems identified in `SESSION-connection-time-diamond-and-subscribe-semantics.md`, including incorrectly-fixed items. User requested clean-room redesign of node lifecycle.
> **Outcome:** Full `NodeImpl`/`DynamicNodeImpl` refactor on shared `NodeBase`. `[[START]]` handshake as first-class protocol message. ROM/RAM cache semantics. Rewire buffer for `dynamicNode`. 1426 tests passing, build green, lint clean.

---

## Motivation

The previous session (`SESSION-connection-time-diamond-and-subscribe-semantics.md`) exposed deep spec-impl gaps:
- Connection-time diamond glitch (deps settling out of order)
- Subscribe-time double-delivery (derived/producer pushing value twice on first subscribe)
- SENTINEL deps not gating first-run (fn computing with garbage `undefined` values)
- `_activating`/`_emittedDataDuringActivate` flags — brittle, incomplete, duplicated between `NodeImpl` and `DynamicNodeImpl`

The user requested: "forget about the existing implementation and try to implement from scratch" — a clean-room redesign of node lifecycle.

---

## Plan evolution

### Plan v1 — Initial proposal

Seven clarification questions (C1–C7) asked before proposing:

**C1: SENTINEL gating for dynamicNode.** User pushed back on strict gating — `a ? b : c` shouldn't gate on `c`. Resolution: static nodes gate strictly via pre-set dirty mask; dynamic nodes use rewire buffer (option C) since deps are discovered at runtime.

**C2: Reconnect re-run semantics.** User chose: reconnect always re-runs fn.

**C3: DynamicNodeImpl composition strategy.** User selected option (c): buffer dep messages during rewire, detect discrepancies, re-run fn (bounded by MAX_RERUN=16).

**C4: Tier ordering for START.** User chose option A: START at tier 0, everything else shifts up.

**C5: Cross-language scope.** TS only at this point; PY parity tracked separately.

**C6: START emission timing.** Suppress during the connect/start call (not deferred to microtask).

**C7: NodeBase shared class.** User agreed: abstract base with shared subscribe/sink/lifecycle.

### Plan v2 — User feedback

User agreed on Q1–Q4, Q6. Key feedback:
- **Q5 (START in describe()):** "If we show COMPLETE in describe(), then we should show START."
- **All emissions through downWithBatch:** User insisted all emissions including START go through the batch system for consistency.
- **Q7 (reconnect):** "We don't push any stale data" — confirmed ROM/RAM.

User proposed the `[[START]]` or `[[START], [DATA, cached]]` pattern: "SENTINEL is internal NO_VALUE case; this determines `[START]` or `[START]` and then `[DATA, data]`. Every subscription, including late subscription, will get `[START]` from upstream."

User also proposed: "sending NO_VALUE or EMPTY or FIRST to downstream will simplify a lot of logic" — this became the START message.

### Plan v3 — Final (approved)

Incorporated all feedback. Key refinements:
- ROM/RAM: "state is ROM and derived is RAM" — user's exact words
- START replaces all `_activating`/`_emittedDataDuringActivate`/`_connecting` flags
- Pre-set dirty mask unifies first-run gate and subsequent-wave logic
- Tier reshuffle: 0=START, 1=DIRTY/INVALIDATE, 2=PAUSE/RESUME, 3=DATA/RESOLVED, 4=COMPLETE/ERROR, 5=TEARDOWN

User approval: "go"

---

## Key decisions

### D1: START protocol message (tier 0)

Every `subscribe()` call emits `[[START]]` (SENTINEL node) or `[[START], [DATA, cached]]` (node with cached value) to the new subscriber only. START is:
- **Not forwarded** through intermediate nodes — each node emits its own START to its own new sinks
- **Tier 0** — lowest priority, processed first in batch drain
- **Carries no wave-state implication** — doesn't set dirty bits or trigger settlement
- **Replaces** `_activating`, `_emittedDataDuringActivate`, `_connecting` flags entirely

### D2: Pre-set dirty mask (first-run gate)

On `_connectUpstream`, set `_depDirtyMask = all-ones` (every bit set). Wave completes only when every dep has delivered DATA (clearing its bit). This:
- Unifies first-run gating and subsequent-wave logic into ONE code path
- Eliminates `_everValueMask`, `_firstRunPending` flags
- Makes SENTINEL dep gating automatic — SENTINEL deps never deliver DATA, so their bit stays set, fn never runs until they do
- Introduces `"pending"` status: subscribed but fn hasn't run (blocked on SENTINEL dep)

### D3: ROM/RAM cache semantics

- **State nodes (no fn):** ROM — preserve `_cached` across disconnect. `get()` returns last value even when disconnected.
- **Compute nodes (derived/producer/dynamic):** RAM — clear `_cached` and `_lastDepValues` on `_onDeactivate`. `get()` returns `undefined` when disconnected. Reconnect always re-runs fn (C2).

### D4: Tier reshuffle

| Tier | Messages | Old tier |
|------|----------|----------|
| 0 | START | (new) |
| 1 | DIRTY, INVALIDATE | 0 |
| 2 | PAUSE, RESUME | 1 |
| 3 | DATA, RESOLVED | 2 |
| 4 | COMPLETE, ERROR | 3 |
| 5 | TEARDOWN | 4 |

### D5: NodeBase abstract class

Shared machinery extracted to `NodeBase<T>`:
- Subscribe flow with START handshake
- Sink management (`_sinks`, `_downToSinks`, `_downInternal`)
- Lifecycle (`_handleLocalLifecycle`, status tracking)
- Meta node propagation
- `BitSet` with `setAll()` for dirty mask

Abstract hooks: `_onActivate()`, `_onDeactivate()`, `_createMetaNode()`, `up()`, `unsubscribe()`, `_upInternal()`.

### D6: Rewire buffer (DynamicNodeImpl)

Option C from C3 discussion:
1. `_runFn` runs fn with tracking `get()` proxy
2. `_rewire` subscribes new deps with `_rewiring = true` — messages go to `_bufferedDepMessages`
3. After rewire, scan buffer for DATA values differing from `_trackedValues`
4. If discrepancy found, re-run fn (bounded by MAX_RERUN=16)
5. `_depValuesDifferFromTracked()` identity check prevents deferred handshake DATA from triggering redundant runs

### D7: START-consumption-clears-dirty heuristic

When `onMessage` consumes a dep's START handshake (returns `true`), clear that dep's pre-set dirty bit. This treats the dep as "user-managed" for wave gating.

Needed for operators like `takeUntil` where the notifier dep is SENTINEL but shouldn't block fn execution.

### D8: onMessage fallback for operators

After `_connectUpstream`, if the node has `onMessage` AND `_lastDepValues` didn't change (all messages consumed by onMessage), run fn once for side-effect initialization. Needed for `concatMap`, `sample`, and other onMessage-driven operators.

---

## Errors encountered and fixes

### Pass 1: 68 test failures after initial implementation

Expected — START appearing in message sequences and ROM/RAM clearing derived caches on unsub.

**Fix:** Updated test assertions to include START; moved `unsub()` after `.get()` checks throughout test suite.

### D1 sink snapshot crash

`unsubB` called before defined because START fired synchronously during subscribe.

**Fix:** Made sink callback check for DATA before unsubscribing.

### D2 DIRTY→COMPLETE without DATA stuck dirty

After clearing dep's dirty bit on COMPLETE, if dirty mask is empty but status is "dirty", fn never ran.

**Fix:** Added `else if (!_depDirtyMask.any() && _status === "dirty") { _runFn(); }` fallback after COMPLETE handling.

### _onDepSettled not propagating DIRTY for DATA-without-prior-DIRTY

Under pre-set dirty mask, the first subsequent wave's DATA didn't propagate DIRTY to downstream.

**Fix:** Route through `_onDepDirty(index)` when dirty bit isn't set (restoring old behavior for non-first-run waves).

### takeUntil with SENTINEL notifier blocked

Pre-set dirty mask included the notifier dep, which never settled.

**Fix:** D7 — when onMessage consumes START for a dep, clear that dep's pre-set dirty bit.

### onMessage-driven operators never ran fn

onMessage consumed all messages, wave never progressed through default dispatch, fn never called.

**Fix:** D8 — fallback in `_connectUpstream`: if fn && onMessage && lastDepValues unchanged, run fn once.

### sample terminal tier check hit DATA

After tier shift, `messageTier(DATA) === 3` matched `tier >= 3` in sample's onMessage.

**Fix:** Changed to `tier >= 4`.

### startWith broken under first-run gate

startWith's fn waited for source dep to deliver DATA, but source might be SENTINEL.

**Fix:** Reimplemented with onMessage pattern: emits initial on START handshake, forwards subsequent DATA.

### DynamicNodeImpl deferred handshake DATA causing extra fn run

During batch drain, rewire subscribes new dep, but handshake DATA is deferred by batch. After rewire and `_running` clears, deferred DATA triggers another `_runFn`.

**Fix:** D6.5 — `_depValuesDifferFromTracked()` identity check in wave completion. If all dep values match what fn last tracked, skip the re-run.

### DIRTY in START handshake causing bridge filter failures

Initially included `[[START],[DIRTY],[DATA,v]]` per user proposal. Caused spurious DIRTY in bridge filter tests.

**Fix:** Dropped DIRTY from handshake — `[[START],[DATA,v]]` only.

---

## Files changed

### New files
- `src/core/node-base.ts` — NodeBase abstract class, BitSet, types, shared lifecycle

### Core rewrites
- `src/core/node.ts` — NodeImpl extends NodeBase, pre-set dirty mask, ROM/RAM, D7/D8 heuristics
- `src/core/dynamic-node.ts` — DynamicNodeImpl extends NodeBase, rewire buffer, MAX_RERUN
- `src/core/messages.ts` — START symbol, tier reshuffle, updated messageTier()
- `src/core/batch.ts` — tier checks updated for new numbering

### Tier-dependent updates
- `src/extra/worker/bridge.ts` — wire filter `< 3`
- `src/extra/worker/self.ts` — wire filter `< 3`
- `src/extra/worker/protocol.ts` — comments updated
- `src/graph/graph.ts` — autoCheckpoint `>= 3`
- `src/extra/adapters.ts` — terminal flush `>= 4`, START skip in toSSE
- `src/extra/operators.ts` — sample terminal `>= 4`, take(0) START consumption, startWith onMessage
- `src/compat/react/index.ts` — key re-sync `>= 3`
- `src/compat/solid/index.ts` — key re-sync `>= 3`
- `src/compat/svelte/index.ts` — key re-sync `>= 3`

### Pattern-level fixes
- `src/patterns/domain-templates.ts` — observabilityGraph wraps branches in `startWith(raw, null)`
- `src/patterns/ai.ts` — promptNode wraps messagesNodeRaw in `startWith(messagesNodeRaw, [])`

### Test updates (all files)
- `src/__tests__/core/node.test.ts`
- `src/__tests__/core/lifecycle.test.ts`
- `src/__tests__/core/sugar.test.ts`
- `src/__tests__/core/protocol.test.ts`
- `src/__tests__/core/semantic-audit.test.ts` — 5 tests rewritten for correct spec behavior
- `src/__tests__/extra/adapters.storage.test.ts`
- `src/__tests__/extra/adapters.ingest.test.ts`
- `src/__tests__/extra/operators.test.ts`
- `src/__tests__/extra/operator-protocol-harness.ts`
- `src/__tests__/extra/operator-protocol-matrix.test.ts`
- `src/__tests__/extra/sources.test.ts`
- `src/__tests__/graph/graph.test.ts`
- `src/__tests__/compat/jotai.test.ts`
- `src/__tests__/compat/nanostores.test.ts`
- `src/__tests__/compat/signals.test.ts`
- `src/__tests__/compat/nestjs.test.ts`
- `src/__tests__/phase5-llm-composition.test.ts`

### Spec/docs updated
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` — §1.2 (START + tier table), §1.3 (invariant #8), §2.2 (subscribe flow + ROM/RAM + pending + first-run gate)
- `~/src/graphrefly/COMPOSITION-GUIDE.md` — §1 (START + first-run gate + dynamicNode exception), §3 (null guards simplified)
- `docs/optimizations.md` — consolidated resolved items, logged PY parity TODO

---

## Observations and insights

### Pre-set dirty mask is the key insight

The single most impactful change was setting `_depDirtyMask = all-ones` on `_connectUpstream`. This one trick:
- Eliminates 3+ boolean flags (`_everValueMask`, `_firstRunPending`, `_connecting`)
- Makes SENTINEL gating automatic (composition guide §1)
- Unifies first-run and subsequent-wave into one code path
- Makes the "when does fn first run?" question trivially answerable: when all dirty bits are cleared by DATA

### START simplifies subscribe-time semantics

The START message eliminates the entire class of "did we already emit during subscribe?" bugs. Instead of tracking state with flags, the subscribe flow is deterministic:
1. Emit START (always)
2. If cached, emit DATA (always)
3. Done — no flags, no conditions, no race

### ROM/RAM is the right trade-off

State-as-ROM means `get()` always returns the last set value, even when disconnected. Compute-as-RAM means disconnected derived nodes don't hold stale values. The user's framing — "state is ROM and derived is RAM" — captures the invariant perfectly.

### onMessage is an escape hatch, not a pattern

The D7 (START-consumption-clears-dirty) and D8 (onMessage fallback) heuristics exist because some operators need to intercept messages before the default dispatch. This works but adds complexity. Future operator designs should prefer the standard dep→fn flow when possible.

### DynamicNodeImpl is fundamentally different

Despite sharing NodeBase, dynamicNode cannot use the pre-set dirty mask trick (deps unknown at subscribe time). The rewire buffer approach is correct but intrinsically more complex — bounded by MAX_RERUN=16 to prevent infinite loops.

---

## Pending: PY parity port

Logged in `docs/optimizations.md`. Apply the same refactor to:
- `graphrefly-py/src/graphrefly/core/node.py` — NodeBase + NodeImpl
- `graphrefly-py/src/graphrefly/core/dynamic_node.py` — DynamicNodeImpl
- `graphrefly-py/src/graphrefly/core/messages.py` — START + tier reshuffle
- `graphrefly-py/src/graphrefly/core/batch.py` — tier checks

Verify Python test suite catches the same edge cases (SENTINEL gate, diamond resolution, rewire stabilization).
