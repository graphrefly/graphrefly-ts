# SESSION: Foundation Redesign (Core + Extras)

**Date:** 2026-04-10
**Status:** Active — architectural discussion, pre-implementation
**Scope:** `src/core/` primitives, `src/extra/` operators + sources.
**Out of scope:** `src/graph/`, `src/patterns/`, `src/compat/`.

**Goal:** Redesign the node foundation with fewer special cases, clearer
separation of signal vs data, and strict protocol-only internal communication.
All proposals must preserve spec §2.7 diamond correctness and the push-on-
subscribe START semantics.

---

## Discussion plan

1. Present bulletins about current modules by sub-area.
2. User describes expectations where they differ from current.
3. Iterate to consensus per sub-area.
4. Brainstorm scenarios that try to break the agreed architecture (draw on
   `COMPOSITION-GUIDE.md`, `archive/optimizations/`, `archive/docs/SESSION-*`).
5. Refine.
6. Iterate 4+5 until satisfactory.
7. Make changes to key files; expose further bugs.
8. Address with the new architecture.
9. Iterate 8+9 until satisfactory.

### Plan refinements (agreed)

- **Ground first.** Read SPEC + COMPOSITION-GUIDE + SESSION-d8 + scan
  `src/core/` + `src/extra/` before presenting any bulletin.
- **Partition step 1 by sub-area** so the discussion doesn't sprawl.
- **Freeze consensus into this document.** Living contract for step 7.
- **Failing tests before fixes** in step 4.
- **Staged rollout** in step 7: node.ts first → operators → sources.
- **Track PY parity implications inline.**
- **Explicit non-goals** (Graph, Phase 4+ patterns, compat).

---

## Sub-areas (iteration order)

1. **Node lifecycle** ← current
2. Message protocol (tiers, START handshake, two-phase)
3. Batch / diamond / wave tracking
4. Operators (`src/extra/operators.ts`)
5. Sources (`src/extra/sources.ts`)
6. dynamicNode API (touches lifecycle but defer surface API decisions)

---

## §1 Node lifecycle — current-state bulletin

(See conversation transcript for the full 10-section bulletin. Key takeaways
distilled here:)

- **Responsibility split:** `NodeBase` owns identity / cache / sinks /
  subscribe + START handshake / down pipeline. `NodeImpl` owns deps / wave
  masks / `_runFn` / `_handleDepMessages` / `_connectUpstream`.
- **Three init paths for fn:** (a) normal wave completion, (b) D8 fallback
  in `_connectUpstream`, (c) onMessage-consumed-DATA/RESOLVED branch. Each
  with subtly different preconditions. SESSION-d8 captured bugs across all
  three but the surface area remains large.
- **`_runFn` reads `deps[i].get()`.** This is the line that surfaces
  `undefined` for SENTINEL deps and forces operator-level `depHasData`
  tracking (see SESSION-d8 §Group C).
- **Multiple trackers:** `_depDirtyMask`, `_depSettledMask`,
  `_depCompleteMask`, `_allDepsCompleteMask`, `_lastDepValues`, `_cleanup`,
  `_manualEmitUsed`, `_active`, `_terminal`, `_sinkCount`,
  `_singleDepSinkCount`, `_singleDepSinks`, `_sinks`, `_upstreamUnsubs`.
- **Single-dep DIRTY-skip optimization** interacts with attempts to move
  DATA emission from fn to onMessage (SESSION-d8 Attempt 1 failure).
- **Pending-fallback in subscribe** uses `_cached === NO_VALUE` as the
  "did activation produce a value?" signal — fragile coupling between
  subscribe and `_onActivate`.
- **State-with-initial `settled` flip** lives in `NodeImpl` constructor,
  not `NodeBase` — fragile if a third subclass appears.

---

## User-provided architectural principles

Raw thoughts dumped by David on 2026-04-10 during §1 iteration. Each point
is classified as either **directly in-scope for §1** (node lifecycle) or
**deferred** to a later sub-area / later session.

### P1 — Foreseeable hooks catalog [in-scope §1]

> "Brainstorm and define what are all the foreseeable hooks that we need to
> insert in here, that help structure our procedures."

**Interpretation:** Before redesigning the lifecycle, enumerate every
extension point a node might need — so the new structure has the hooks
built-in rather than bolted on per-operator. This replaces the current
ad-hoc set (`_onActivate`, `_doDeactivate`, `_onInvalidate`, `_onTeardown`,
`_onManualEmit`, `onMessage`) with a deliberate taxonomy.

Deliverable for §1: a "hook catalog" table.

### P2 — Signal vs DATA separation [in-scope §1, core contract]

> "Separate the modules clearly by what are taking care of the signals
> (message Types), what are taking care of the DATA itself. `onMessage` can
> review the whole message including the message type and message payload
> but the `runFn` should only handle the resolved DATA payload from dep."

**Interpretation:**
- `onMessage` is the **signal/protocol layer** — sees full message tuples,
  can intercept any type, participates in wave tracking, handshake, tier
  routing.
- `fn` (compute function) is the **data layer** — receives ONLY resolved
  DATA payloads from deps. Never sees START / DIRTY / RESOLVED / COMPLETE /
  ERROR / INVALIDATE / PAUSE / RESUME / TEARDOWN. Never inspects message
  types. Never decides when to run based on message type.
- The protocol layer decides when fn is allowed to run; the data layer
  just computes.

This is a hard split. It resolves SESSION-d8's Group C class of bugs
(reduce/takeWhile/last) by construction: fn can't see the dep's
"SENTINEL state" because fn isn't called until DATA has actually arrived.

### P3 — No cross-node inspection [in-scope §1, HARD RULE]

> "Never have the node inspecting another node's `.get` or `.status`, not
> even dynamicNode. `.get` is only a peek to the data that flow by the
> node, it's not source of truth, it's not reflecting the accurate
> realtime data, it's only a snapshot of the flow, it can get stale.
> `.status` and `.get` is for everything outside of the nodes, maybe for
> graph to peek into the data. But inside, we should just rely on the
> callbag-ish protocol to transport data, if we need to transport status
> or something else, use that protocol too. Never bypass the protocol to
> retrieve data from other nodes."

**Interpretation:**
- `.get()` and `.status` are **external-observer APIs only** — for user
  code, graph introspection, debug tooling, describe output.
- **Inside a node**, dep values are obtained from DATA messages received
  via subscription. Never `dep.get()`. Never `dep.status`.
- If a node needs another node's status, model it as a message type that
  flows through the protocol.
- Rationale: `.get()` is a stale snapshot; the protocol is the source of
  truth. Bypassing it couples nodes to each other's internal cache and
  creates subtle wave-timing races.

**Direct implication on current code:** The line
`depValues[i] = this._deps[i].get()` in `NodeImpl._runFn` must go. fn's
input is accumulated from DATA messages seen in `_handleDepMessages`, not
pulled from dep cache. This naturally reinforces P2.

**Implication on dynamicNode:** Currently `dynamicNode((get) => ...)`
where `get(dep)` returns the dep's cached value. This must also route
through the protocol — it can't peek at `dep._cached` either.

### P4 — START handshake disambiguates "no value yet" [in-scope §1]

> "We use START at the handshake, which will simplify the undefined/null
> confusion for the downstream."

**Interpretation:** Reinforces spec §2.2. Downstream nodes learn "no value
yet" from receiving `[[START]]` alone, not from inspecting a value. This
is already in the spec but worth treating as a first-class design pillar
of the new architecture — it's the mechanism that lets P2 work
(fn-layer is only ever invoked after DATA).

### P5 — Up/down symmetry [in-scope §1, extends §2 scope]

> "Treat up and downstream equally important, including guarding, message
> handling."

**Current state:**
- `NodeBase.down()` runs the guard (write/signal action).
- `NodeImpl.up()` runs the guard (write action). `_upInternal` bypasses it
  with `internal: true`.
- `onMessage` only sees messages coming from deps (downstream direction
  from deps' perspective). There's NO `onUpMessage` hook — upstream
  messages flowing from sinks are just force-forwarded to each dep by
  `_upInternal`.

**Interpretation:**
- Guards apply symmetrically to both directions (already mostly true,
  modulo `internal`).
- Message handling should be symmetric: a node should be able to
  intercept messages flowing upstream the same way it intercepts
  messages flowing downstream. e.g. a PAUSE coming up from a sink might
  need operator-level handling before it reaches the source.
- **Open question:** single unified `onMessage(msg, direction, origin,
  actions)` handler, or two separate hooks? Leaning toward unified
  because P6 (tier-unification) wants fewer special cases.

### P6 — Tier-based unification [in-scope §1, architectural keystone]

> "Use as least properties, trackers, bitmasks, sets, special cases, as
> possible. Think of message type handling with tiers. We handle emission
> by tier ordering (so in batch handling always), handle connection /
> handshake / activation / subscription by tier ordering, handle
> disconnection / deactivation / cleanup / unsubscription by tier
> ordering. That way we don't have to put one-off special rules and
> forget to maintain it."

**Interpretation — the keystone insight:**

Today, the lifecycle is split across multiple orthogonal mechanisms:

- Subscribe flow has its own imperative order (START → register → activate → pending fallback).
- Activation has its own machinery (`_onActivate`, `_connectUpstream`).
- Dep-wave has its own machinery (BitSets, `_handleDepMessages`).
- Deactivation has its own machinery (`_doDeactivate`, cleanup fn).
- Teardown has its own machinery (`_onTeardown`, `_handleLocalLifecycle`, propagate-to-meta).
- Batch has tier ordering but only for outgoing emission.

**Proposal:** Collapse these into **one tier-ordered pipeline**. Every
lifecycle transition is an event that flows through tiers:

- Subscribe = receiving a START (tier 0) from a dep / emitting START downstream.
- Activation = the chain reaction when START propagates through the graph.
- Dep-wave = receiving DIRTY (tier 1) → DATA/RESOLVED (tier 3) on the same pipeline.
- Deactivation / cleanup = receiving TEARDOWN (tier 5) on the same pipeline.
- Pause / resume = tier 2, same pipeline.

Goal: kill most of `_depDirtyMask` / `_depSettledMask` /
`_depCompleteMask` / `_allDepsCompleteMask` / `_lastDepValues` /
`_manualEmitUsed` / the `_active` flag / the D8 fallback / the
onMessage-consumed-DATA special-case. Everything becomes "process this
message via its tier handler."

**Constraint:** must not sacrifice diamond glitch-free behavior (P7).
Wave tracking is the hard part — the current BitSet approach exists
*because* glitch-free diamond resolution is non-trivial. A tier-based
replacement needs a concrete mechanism for "don't run fn until all deps
on this wave have settled" that's simpler than BitSets, not just a
rename.

### P7 — Diamond correctness is acceptance criterion [invariant, all sub-areas]

> "All these need to satisfy the diamond patterns."

**Interpretation:** Any proposal from P1–P6 must be validated against
spec §2.7 (connection-time diamond, subsequent-update diamond) and
COMPOSITION-GUIDE §9 (two-phase protocol, source-node diamond path).
This is the minimum acceptance bar — a simpler architecture that breaks
diamonds is not acceptable.

---

### Deferred

### D1 — dynamicNode dep-access API rename [deferred — sub-area §6]

> "dynamicNode, I don't know if we should keep using `a.get()` to
> reference the dep's value. We should use something else to not let LLM
> confused that we use .get to retrieve the data internally. Jotai is the
> one that we should think about how compat should change, but we can
> leave that after we are done with the core."

**Interpretation:** The `get(dep)` proxy in `dynamicNode` collides
semantically with `.get()` the external observer API. Per P3, internal
dep-access must flow through the protocol, so this proxy needs to be
reframed as "subscribe and track" not "peek the cache." Naming should
signal the subscription relationship.

Jotai compat implications: Jotai's `get` atom-accessor is the model
dynamicNode borrows from. Revisit compat shape *after* the core
protocol is settled — compat should adapt to core, not constrain it.

**Defer to:** sub-area §6 (dynamicNode API), after core lifecycle
consensus is locked.

---

## Open questions carried forward

- **Q1** (P2): How are dep DATA values threaded into `fn` without
  `dep.get()`? Proposal sketch: `_handleDepMessages` accumulates
  latest-seen DATA per dep index into a small array; when the wave
  completes, pass that array to fn. Concretely this replaces
  `_lastDepValues` (which was only an identity-skip cache) with
  `_latestDepData` (the authoritative fn input).

- **Q2** (P5): Unified `onMessage(msg, ctx)` with `ctx` telling
  direction/origin, or separate `onDownMessage` / `onUpMessage`? Leaning
  unified.

- **Q3** (P6): What replaces the BitSet wave tracking? Options: a
  per-dep tri-state (unseen / dirty / settled) small-array; a monotone
  wave counter that increments per DIRTY and resolves when all deps
  reach the current counter; or something else. All must preserve P7.

- **Q4** (P6): Does the "tier-ordered pipeline" handle TEARDOWN the
  same way it handles DATA waves? TEARDOWN needs eager upstream
  disconnect *and* downstream propagation — that's two different
  behaviors per tier. May need explicit per-tier semantics rather than
  fully uniform handling.

- **Q5** (P1): What is the full hook catalog? TBD — deliverable for
  next iteration in §1.

---

## Decisions logged

**Q1 — fn dep-value sourcing:** per-dep latest-DATA array. `fn` receives
`readonly T[]` accumulated from DATA messages by the protocol layer. No
`dep.get()` calls from inside any node.

**Q2 — onMessage direction:** unified. Single `onMessage(msg, ctx, actions)`
handler sees messages in both directions; `ctx.direction` disambiguates.

**Q3 — wave tracker shape:** deferred until hook catalog is locked. Tracker
structure follows from how many flags per dep the hook catalog demands.

**Q4 — default dispatch granularity:** per-tier, NOT per-message-type. One
default handler per (direction, tier) pair, branching on tier alone. No
per-type switch/case inside hooks.

---

## §1 Hook catalog — proposal v1

### User-facing hooks (the only things a node author writes)

| Hook | Signature | Purpose | Layer |
|---|---|---|---|
| `fn` | `(latestData: readonly T[], actions) => value \| cleanup \| void` | Compute. Called after wave completes AND every dep has delivered ≥1 DATA. Sees only DATA payloads (P2). | Data |
| `onMessage` | `(msg, ctx, actions) => ConsumeResult` | Intercept any message in either direction before default dispatch (P5 unified). | Protocol |
| `equals` | `(a, b) => boolean` | RESOLVED detection (existing). | Value |
| `onResubscribe` | `() => void` | Reset user-local state on terminal re-subscribe (existing). | Lifecycle |

Hooks that DISAPPEAR from the user surface (folded into core tier dispatch
or expressed via `onMessage` / fn-cleanup): `_onActivate`, `_doDeactivate`,
`_onInvalidate`, `_onTeardown`, `_onManualEmit`, D8 fallback,
onMessage-consumed-DATA special case.

### ConsumeResult

```
type ConsumeResult =
  | undefined     // pass through to default dispatch
  | "consume"     // handled, skip default dispatch, don't forward
```

Proposed: NO `transform` variant. Authors who need to rewrite a message use
`consume` + `actions.down(...)` / `actions.up(...)`.

### MessageContext

```
type MessageContext =
  | { direction: "down-in"; depIndex: number }     // from a dep
  | { direction: "up-in" }                         // from a sink (no per-sink id)
```

Outgoing messages never flow through `onMessage` — observing your own
emissions is external-observer territory.

### Per-dep record (replaces 4 BitSets + _lastDepValues)

```
DepRecord<T> = {
  latestData: T | NO_DATA,   // last DATA payload, NO_DATA if never emitted
  dirty: boolean,            // DIRTY received, awaiting DATA/RESOLVED
  terminal: boolean,         // COMPLETE or ERROR received
}
```

One `DepRecord[N]` array. Derivations:
- First-run gate open: `every(dep => dep.latestData !== NO_DATA)`
- Wave complete: `every(dep => !dep.dirty)`
- All complete: `every(dep => dep.terminal)`

### Default down-in dispatch (per tier)

| Tier | Types | Default |
|---|---|---|
| 0 | START | Record dep as "subscribed". Paired DATA (if any) dispatches as a separate tier-3 message by the subscribe pipeline. |
| 1 | DIRTY, INVALIDATE | `dep.dirty = true`. On first dep dirtying in wave, emit DIRTY down. INVALIDATE also clears `dep.latestData = NO_DATA`. |
| 2 | PAUSE, RESUME | Forward down. |
| 3 | DATA, RESOLVED | DATA: `dep.latestData = payload; dep.dirty = false`. RESOLVED: `dep.dirty = false`. Then if wave complete AND gate open, run fn with `latestData[]`. |
| 4 | COMPLETE, ERROR | `dep.terminal = true; dep.dirty = false`. If all terminal, propagate down. Otherwise, if gate is now otherwise satisfied (D2 case), run fn. |
| 5 | TEARDOWN | Forward down. Trigger deactivation. |

### Default up-in dispatch (per tier)

| Tier | Types | Default |
|---|---|---|
| 0 | START | N/A (subscribe is a channel action, not a user-sendable message). |
| 1 | DIRTY, INVALIDATE | Forward up to deps. |
| 2 | PAUSE, RESUME | Forward up to deps. |
| 3 | DATA, RESOLVED | N/A (up direction carries no value by convention). If sent anyway, forward up. |
| 4 | COMPLETE, ERROR | Forward up. |
| 5 | TEARDOWN | Forward up. Trigger deactivation. |

### Non-hook channel-lifecycle (not user-overridable)

| Event | Default |
|---|---|
| `0 → 1 sinks` | Subscribe to all deps. For producer (no-deps + fn), call fn once. |
| `1 → 0 sinks` | Unsubscribe from deps. Run pending cleanup fn. Clear `_cached` for compute nodes (ROM/RAM). |

Not hooks — the mechanical bookkeeping of the subscribe channel. Users who
need custom activation behavior express it via fn's cleanup return or via
`onMessage` on TEARDOWN.

### D1.x decisions (locked)

- **D1.1 — onMessage outgoing:** NO. onMessage is one-sided (incoming
  only). Post-processing outgoing = wire another node downstream.
- **D1.2 — pre-fn skip vs post-fn equals:** BOTH, but no `lastFnInput`.
  Pre-fn: one node-level bool `waveHasNewData` set when any dep emits
  DATA during a wave. On wave completion: `!waveHasNewData` → skip fn,
  emit RESOLVED. RESOLVED-from-deps IS the protocol-native "unchanged"
  signal. Post-fn: `equals(oldCache, fnResult)` picks DATA vs RESOLVED
  for the emission; default `Object.is`.
- **D1.3 — D2 case (dep DIRTY→COMPLETE without DATA):** naturally handled
  by tier-4 default clearing `dep.dirty = false` on terminal arrival.
  Wave then completes normally (no dep dirty), gate stays open (the
  dep's last known `latestData` is intact), fn runs. No sub-case.
- **D1.4 — TEARDOWN visibility:** onMessage sees all tiers including
  TEARDOWN. No special-case bypass. Ceremony (ceremony = the mechanical
  work of emitting/tearing down) lives outside onMessage; observation
  of ceremony tiers stays inside onMessage.
- **D1.5 — fn cleanup fires:** DEFAULT both (a) before next fn re-run
  and (b) on deactivation, matching RxJS/useEffect. OPT-IN:
  deactivate-only mode for persistent resources. Exact return-shape API
  TBD until a concrete use case arises; likely `{ onDeactivate: fn }`
  vs plain `() => void`.

### Additional decisions from v3 iteration

- **onResubscribe removed.** Folded into `onSubscribe` via context flag
  `ctx.afterTerminalReset`. Users who need to reset operator-local
  state on resubscribable reset check the flag inside `onSubscribe`.
- **`emit(value)` removed from actions.** Replaced by the bundle-based
  `down()` API, which handles DIRTY auto-prefix and tier-ordering
  automatically. fn's return-value sugar still exists for the common
  case (return value → framed auto-emission).
- **Ceremony vs observation split for START/TEARDOWN:** ceremony
  (mechanical work: targeted START emission, dep teardown) lives in
  `onSubscribe` / mechanical core. Observation (user-visible message
  arrival) flows into `onMessage` normally. A user writing a custom
  protocol overrides `onSubscribe` for custom handshake ceremony and
  `onMessage` for custom tier handling.

---

## Architecture — v5 (SUPERSEDES v4)

### Singleton protocol config

Locked decision: `bundle`, `onMessage`, `onSubscribe`, `MessageTypeRegistry`,
and other cross-cutting config live in a **global singleton**, not on
individual nodes. Rationale: the protocol is foundational — LLMs and
humans need to trust it as consistent across the graph. Per-node
override of protocol hooks would make behavior arbitrary and
unpredictable.

```ts
interface GraphReFlyConfig {
  // Protocol foundation
  messageTypes: Map<symbol, MessageTypeRegistration>
  bundle: BundleFactory
  onMessage: MessageHandler
  onSubscribe: SubscribeHandler
  // Cross-cutting
  enableInspection: boolean
  // ... extensible
}

// Usage (app init time only):
configureGraphReFly((cfg) => {
  cfg.registerMessageType(MY_CUSTOM_TYPE, { tier: 3, wireCrossing: true, propagatesToMeta: false })
  // ... other custom configuration
})
// First node creation freezes the config; subsequent mutations throw.
```

Framework ships with defaults for everything. Most apps never touch
the singleton. Custom protocol extensions happen at app-init time, and
the config is frozen on first node creation.

### Per-node user-facing surface — final 2

| Hook | Signature | Purpose |
|---|---|---|
| `fn` | `(latestData, actions, ctx) => cleanup \| void` | Compute. ALL emission via `actions.emit(v)` or `actions.down(msgs)`. Return value is cleanup function only — anything non-function is ignored. |
| `equals` | `(a, b) => bool` | Used by `actions.emit(v)` to decide DATA vs RESOLVED. Default `Object.is`. |

That's it. No per-node `bundle` / `onMessage` / `onSubscribe` /
`onResubscribe`. Per-instance state (timers, accumulators, inner
subscriptions) lives in closures captured by the `fn` factory.

**CRITICAL — fn return is cleanup only (§7 decision, SUPERSEDES earlier design):**
- fn return value is NEVER auto-framed as DATA/RESOLVED
- ALL emission is explicit via `actions.emit(v)` (smart: equals check,
  DIRTY prefix, bundle) or `actions.down(msgs)` (raw pass-through)
- `_downAutoValue` DELETED. `_manualEmitUsed` DELETED. `_onManualEmit` DELETED.
- Sugar constructors (derived, map, filter, etc.) wrap user functions
  internally: `actions.emit(userFn(data))`.
- Operators responsible for two-phase invariant: if fn doesn't emit DATA,
  it must emit RESOLVED explicitly (`actions.down([[RESOLVED]])`).
- `undefined` and `null` are valid DATA payloads — no sentinel confusion.

### `FnCtx` — the lifecycle sliver that crosses into fn

```ts
interface FnCtx {
  /**
   * True on the single invocation after all upstream deps have
   * terminated. This is the "last chance to emit" call — e.g., `last()`
   * returns its final stored value here. Normal operators (map, filter,
   * scan-live) ignore this flag.
   */
  terminal: boolean

  /**
   * True on the first invocation after a resubscribable terminal
   * reset. Operators with closure state (reduce accumulator, takeWhile
   * done flag, bufferCount buffer) reset state when this is true.
   */
  afterResubscribe: boolean
}
```

This is a minimal, bounded protocol leak into fn. fn still never sees
raw `Message` tuples, never branches on tier, never inspects dep
status or cached values of other nodes. It sees **two booleans** that
describe its own lifecycle context. P2 (signal vs data separation)
survives in spirit.

### When fn is called (v5)

1. **Wave completion with new data** — all deps satisfied gate +
   `waveHasNewData` → fn(latestData, actions, `{ terminal: false, afterResubscribe: <first-after-reset?> }`)
2. **Wave completion with no new data** (all settling deps emitted
   RESOLVED) — skip fn, emit RESOLVED downstream.
3. **Upstream terminal** — when all deps have become terminal, if the
   gate ever opened, call fn once more with `ctx.terminal = true`.
   Then auto-propagate COMPLETE/ERROR downstream. If the gate never
   opened, skip fn and propagate directly.
4. **Producer (no deps + fn)** — call fn once on first-sink activation
   with `latestData = []`, `ctx.terminal = false`, `ctx.afterResubscribe`
   set appropriately.

### Operators under v5

Every operator from SESSION-d8 can be expressed:

| Operator | Implementation pattern |
|---|---|
| `map`, `filter`, `scan` | fn returns computed value; post-fn `equals` handles RESOLVED |
| `switchMap`, `exhaustMap`, `concatMap`, `mergeMap` | fn spawns inner subscription via `actions.down(...)` captured in closure; return `cleanup` that unsubs; next fn call triggers cleanup then new subscription |
| `debounce`, `throttle`, `audit`, `delay` | fn clears previous timer via cleanup, sets new timer; timer callback closes over `actions` and emits via `actions.down(bundle.resolve())` |
| `reduce` (live accumulator) | fn accumulates into closure, returns current value; `ctx.afterResubscribe` resets accumulator |
| `reduce` (terminal emission), `last` | fn stores latest value in closure; on `ctx.terminal === true`, emit stored value via return or `actions.down(...)` |
| `takeWhile` | fn evaluates predicate; if false, emit COMPLETE via bundle; closure tracks done state; `ctx.afterResubscribe` resets done |
| `bufferCount` | fn appends to closure buffer; when buffer full, emits and resets |
| `interval`, `fromTimer`, `fromCron` | producer fn sets up timer on first-sink activation, captures `actions`, returns cleanup |
| `fromPromise`, `fromAsyncIter` | producer fn kicks off async work, captures `actions`, returns cleanup |

None of these require per-node `onMessage`. All per-instance state
lives in the fn closure. The `ctx.terminal` + `ctx.afterResubscribe`
flags cover the two protocol-awareness needs that can't be expressed
through pure data flow.

### Safety caveat (documented)

Bare `actions.down([[DATA, v]])` without DIRTY is the spec §1.3.1
"compat path" — valid but breaks glitch-free diamond resolution
downstream. The diamond-safe idiom:

```
actions.down(actions.bundle([DATA, v]).resolve())
```

Or rely on fn's return-value auto-framing, which uses the singleton
bundle internally.

### Actions

```ts
interface Actions {
  down(messages: Messages): void
  up(messages: Messages): void
  bundle(...initial: Message[]): Bundle
}

interface Bundle {
  append(...messages: Message[]): this
  resolve(direction?: "down" | "up"): Messages
}
```

No `emit(value)`. No `downToSink` on per-node actions (downToSink is
an internal used by the singleton's default `onSubscribe`, which has
access to the sink reference).

### Core mechanical layer (non-overridable, non-hook)

- **Channel lifecycle:** sinkCount 0→1 subscribes to all deps (and
  runs producer fn once for no-deps+fn nodes); sinkCount 1→0
  unsubscribes from deps, runs pending fn-cleanup, clears `_cached`
  for compute nodes.
- **Tier dispatcher:** singleton `onMessage` handler runs per-message,
  updates `DepRecord` state, invokes fn at wave completion and on
  upstream terminal.
- **Pre-fn skip:** `!waveHasNewData` at wave completion → emit
  RESOLVED, skip fn.
- **Post-fn equals:** compare fn return to previous cache; emit DATA
  or RESOLVED via singleton bundle.
- **Resubscribable terminal reset:** clear `_terminal`/`_cached`/
  `_status`; next fn invocation gets `ctx.afterResubscribe = true`.

### Per-node state (minimal)

```ts
DepRecord<T> = {
  latestData: T | NO_DATA,
  dirty: boolean,
  terminal: boolean,
}

// Plus per-node flags:
waveHasNewData: boolean    // set on DATA arrival, reset on wave completion
hasCalledFnOnce: boolean   // for ctx.afterResubscribe tracking
```

No BitSets. No `lastFnInput`. No `_manualEmitUsed`. The surface is
tiny.

---

## §1 Hook catalog — (archived) proposal v4

### Shift from v3

- **`down()` / `up()` are now dumb raw-passthrough transports.** No
  auto-prefix DIRTY, no tier sort, no framing intelligence. Users who
  pass raw `Messages` arrays get exactly those messages emitted.
- **`bundle` is now a user-overridable hook** (third protocol extension
  point alongside `onSubscribe` and `onMessage`). It owns tier sort
  and DIRTY auto-prefix. `bundle.resolve()` returns the framed raw
  `Messages` array.
- **`resolve()` is pure** — does not mutate the bundle. Bundles are
  reusable: append more, resolve again, emit again. Developer tracks
  what's been sent.
- **Hook count: 5** — `fn`, `onSubscribe`, `onMessage`, `bundle`, `equals`.

### Safety caveat (documented)

Bare `down([[DATA, v]])` without DIRTY is the spec §1.3.1 "compat path"
— valid but **breaks glitch-free diamond resolution** downstream. The
diamond-safe idiom is:

```
actions.down(actions.bundle([DATA, v]).resolve())
```

Or rely on fn's return-value auto-framing, which uses the default
bundle internally. Raw `down()` is an expert escape hatch; document
prominently.

### User-facing hooks — final 5

| Hook | Signature | Purpose | Layer |
|---|---|---|---|
| `fn` | `(latestData, actions) => value \| cleanup \| void` | Compute. Runs after wave completes + gate open + pre-fn skip passes. Return value auto-framed via default bundle + `equals`. | Data |
| `onSubscribe` | `(sink, ctx, actions) => cleanup?` | Per-sink subscribe ceremony. Fires on every sink subscribe. Default emits START handshake via `downToSink`. `ctx.afterTerminalReset` covers old `onResubscribe`. | Protocol |
| `onMessage` | `(msg, ctx, actions) => "consume" \| undefined` | Incoming message interception. All tiers, both directions. | Protocol |
| `bundle` | `(node, ...initial) => Bundle` | Outgoing message framing. `bundle.append(...)` + `bundle.resolve(direction?)`. Default: stable tier sort + DIRTY auto-prefix when tier-3 present and node not dirty. User override for custom protocols. | Protocol |
| `equals` | `(a, b) => bool` | Post-fn RESOLVED detection. Default `Object.is`. | Value |

### `onSubscribe` context

```
ctx = {
  sinkCount: number,
  afterTerminalReset: boolean,
}
```

### Actions per hook

| Hook | Actions | Notes |
|---|---|---|
| `onSubscribe` | `downToSink(messages)`, `up(messages)`, `bundle(...)` | Sink-targeted `downToSink`. Raw arrays, no framing. |
| `onMessage`, `fn` | `down(messages)`, `up(messages)`, `bundle(...)` | Broadcast. Raw arrays, no framing. |

**No `emit(value)`.** fn's return-value sugar is the only auto-emit path
(uses default bundle internally for correct framing). For complex
emissions, use `down(bundle(...).resolve())`.

### Default `bundle` implementation

```ts
type BundleFactory = (node: NodeCtx, ...initial: Message[]) => Bundle

interface Bundle {
  append(...messages: Message[]): this
  resolve(direction?: "down" | "up"): Messages
}

function defaultBundle(node, ...initial) {
  const msgs: Message[] = [...initial]
  return {
    append(...newMsgs) { msgs.push(...newMsgs); return this },
    resolve(_direction) {
      // Stable tier sort
      const indexed = msgs.map((m, i) => ({ m, i, t: messageTier(m[0]) }))
      indexed.sort((a, b) => a.t - b.t || a.i - b.i)
      const sorted = indexed.map(x => x.m)
      // Auto-prefix DIRTY when tier-3 present and node isn't dirty
      const hasTier3 = sorted.some(m => messageTier(m[0]) === 3)
      if (hasTier3 && node.status !== "dirty") {
        return [[DIRTY], ...sorted]
      }
      return sorted
    }
  }
}
```

`NodeCtx` exposes read-only node self-state (`status`, `cached`). No
access to other nodes (P3).

### Core mechanical layer (non-overridable)

- **Channel lifecycle:** sinkCount 0→1 subscribes to all deps (and
  runs producer fn once); sinkCount 1→0 unsubscribes + runs pending
  fn-cleanup + clears `_cached` for compute nodes.
- **Tier dispatcher:** runs after `onMessage` returns `undefined`.
  Per-tier, per-direction. Updates `DepRecord` state.
- **Pre-fn skip:** `!waveHasNewData` at wave completion → emit
  RESOLVED (via default bundle), skip fn.
- **Post-fn equals:** compare fn return to previous cache; emit DATA
  or RESOLVED via default bundle.
- **Resubscribable terminal reset:** clear `_terminal`/`_cached`/
  `_status`; next onSubscribe call sets `ctx.afterTerminalReset = true`.

### Per-node state (minimal)

```
DepRecord<T> = {
  latestData: T | NO_DATA,
  dirty: boolean,
  terminal: boolean,
}

waveHasNewData: boolean  // set on DATA arrival, reset on wave completion
```

No `lastFnInput`. No BitSets. No `_upstreamUnsubs` BitSet. (A small
`unsubs: Array<() => void>` still needed for dep channel bookkeeping.)

---

---

## §3.7 Full core audit (completeness pass)

Catching up on files not examined in earlier sub-areas. Inventory:

**Examined in depth (dispatch-critical):** `node.ts`, `node-base.ts`,
`messages.ts`, `batch.ts`.

**Now examined (completeness pass):** `actor.ts`, `guard.ts`, `clock.ts`,
`timer.ts`, `versioning.ts`, `sugar.ts`, `meta.ts`, `bridge.ts`,
`dynamic-node.ts`, `index.ts`.

### No changes needed

- **`actor.ts`** — `Actor` type + `normalizeActor`. No dispatch.
- **`guard.ts`** — `policy()` + `accessHintForGuard`. Already symmetric
  across down/up. P5 satisfied at guard level.
- **`clock.ts`** — `monotonicNs` / `wallClockNs`. No dispatch.
- **`timer.ts`** — `ResettableTimer`. Used by resilience operators.
- **`versioning.ts`** — `advanceVersion` called on DATA inside
  `_updateOwnState` (renamed `_handleLocalLifecycle`). Plumbing only.
- **`sugar.ts`** — `state`/`producer`/`derived`/`effect`/`pipe`. Mechanical
  rewrite to match updated `node()` signature; no semantic change.
- **`index.ts`** — re-exports only.

### Flagged issues (v5 breaks)

#### `meta.ts` / `describeNode` — lock public API usage

Current code has three v5 violations:

1. Line 104 `metaSnapshot`: `out[key] = child.get()` → MUST become `child.cache`.
2. Line 203 `describeNode`: `out.value = node.get()` → MUST become `node.cache`.
3. Lines 197-198: `instanceof NodeImpl && node._cached === NO_VALUE` —
   reaches past the public API to detect SENTINEL. MUST be replaced by
   a public `hasCache` getter.

**Locked:** add `hasCache: boolean` to the `Node<T>` interface.

```ts
interface Node<T> {
  readonly cache: T | undefined
  readonly hasCache: boolean      // NEW — false = SENTINEL, true = any cached value
  readonly status: NodeStatus
  // ...
}
```

`describeNode` then uses:
```ts
if (!node.hasCache) out.sentinel = true
out.value = node.cache
```

No `instanceof` checks, no `_cached` access. describeNode operates
entirely through the `Node<T>` interface.

#### `bridge.ts` — conflicts with singleton `onMessage`

Current bridge creates a node with per-node `onMessage` that inspects
every incoming message type and selectively forwards to `to.down()`.
Under v5 singleton, per-node `onMessage` is gone.

**Rewrite under v5 (narrowed scope — Option B):**

```ts
export function bridge(from: Node, to: Node, opts?: BridgeOptions): Node {
  const allowedDown = new Set(opts?.down ?? DEFAULT_DOWN)
  return effect([from], ([value], actions, ctx) => {
    if (allowedDown.has(DATA)) to.down([[DATA, value]])
    if (ctx.terminal && allowedDown.has(COMPLETE)) to.down([[COMPLETE]])
  }, { name: opts?.name, describeKind: "effect" })
}
```

**Trade-off:** loses PAUSE/RESUME/INVALIDATE/TEARDOWN/unknown-type
forwarding (fn never sees those messages under v5). Forwarding of
these types is rare in practice; graph-wide teardown is handled by
`graph.destroy()`, not bridges. **Document the scope narrowing.**
Users needing raw-message forwarding use framework extensions.

#### `dynamic-node.ts` — §6 rewrite, scope now clearer

Current implementation has multiple v5 violations:

1. **Line 241 `dep.get()` in tracking `get` proxy** — P3 violation.
2. **Line 520 `dep.get()` in `_depValuesDifferFromTracked`** — P3 violation.
3. **`opts.onMessage` accepted in `DynamicNodeOptions`** — singleton conflict.
4. **Parallel wave machinery:** `_depDirtyBits`, `_depSettledBits`,
   `_depCompleteBits`, `_allDirtySettled`, `_updateMasksForMessage`.
   Separate implementation of wave tracking, not shared with NodeImpl.
5. **`_downInternal` + `_downAutoValue` call sites** — all migrate to
   unified `_emit` under v5.1.

**Key insight from the audit:** the ENTIRE rewire-buffer +
`_trackedValues` + `MAX_RERUN` stabilization complexity exists
**specifically** to work around `dep.get()` returning `undefined`
for SENTINEL deps on lazy dep-composition. Under v5 where dep values
flow through DATA messages, the tracking `get` proxy becomes trivial:
"record that this dep was requested; return the latestData from the
local DepRecord; if NO_DATA, the gate holds fn until DATA arrives."

**DynamicNodeImpl will shrink ~50% under v5.** Defer full rewrite to
§6, but the scope is now concrete: share the `DepRecord[]` + wave
machinery with `NodeImpl`, replace the proxy semantics with DATA
flow, delete the rewire buffer.

#### `_manualEmitUsed` + "operator" describeKind

Under v5.1, `actions.emit(value)` is deleted. `_manualEmitUsed` field
is also deleted. `describeNode` uses it at `meta.ts:68` to infer the
"operator" label vs "derived". Under v5 the distinction is gone —
fn either returns a value (auto-framed) or uses `actions.down()` for
complex emissions. These are not semantically distinct.

**Locked:** drop the "operator" label. `describeKind` collapses to
four values: `"state" | "producer" | "derived" | "effect"`. Users
who need a custom label pass `opts.describeKind` explicitly.

### Internal fields that survive v5 unchanged

- `NodeBase._versioning` — plumbed through `_updateOwnState` on DATA.
- `NodeBase._inspectorHook` — observability hook for `observe()`.
- `NodeBase._recordMutation` — guard audit trail, called from `_emit`.
- `NodeBase._guard`, `_resubscribable`, `_resetOnTeardown` — option-backed.
- `SubscribeHints.singleDep` — subscribe-time hint for DIRTY-skip optimization.
- `NodeOptions.completeWhenDepsComplete` — opt-out of auto-complete.

### Internal fields that DO NOT survive v5

- `_onMessage` (per-node hook) — deleted, singleton only.
- `_onResubscribe` (per-node hook) — deleted, folded into `FnCtx.afterResubscribe`.
- `_manualEmitUsed` — deleted, label collapse.
- `_depDirtyMask`, `_depSettledMask`, `_depCompleteMask`,
  `_allDepsCompleteMask` (BitSets) — deleted, replaced by `DepRecord[]`.
- `_lastDepValues` — deleted, `waveHasNewData` bool replaces its role.
- `_active` — questionable whether it survives; `_sinks != null` may be
  sufficient as the activation indicator.

---

## §3.6 Accessor rename: `.get()` → `.cache` getter

**Motivation:** TC39 Signals standardized `.get()` as the reactive-value
accessor. GraphReFly's `node.get()` is semantically different — it's a
**peek at a potentially stale cached snapshot**, NOT authoritative per P3.
Keeping `.get()` would mislead LLMs and users who map the name to
TC39-signal semantics.

**Locked:**

```ts
interface Node<T> {
  readonly cache: T | undefined   // getter, replaces .get()
  readonly status: NodeStatus     // existing getter
  // .get() removed entirely
}
```

- Matches existing `.status` getter pattern (no parens).
- Same V8 inlining characteristics as `.status`.
- External callers switch: `node.get()` → `node.cache`.
- Internal code never reads it (P3 — the protocol is authoritative, not the cache).
- `graph.get(name)` / `graph.set(name, v)` shortcuts STAY — these are
  Map-like idioms, not reactive-value accessors, no collision.
- `describeNode` reads the internal field directly; no behavior change.

---

## §3 Batch / Diamond / Wave tracking — decisions locked

### Diamond correctness under v5

Validated by trace (see conversation transcript for full step-by-step):

- **Connection-time diamond:** the first-run gate (every dep must have
  delivered `latestData !== NO_DATA`) blocks fn until all deps settle.
  Sequential dep subscription at first-sink activation naturally stages
  the settlements; fn runs exactly once with the complete snapshot.
- **Subsequent-update diamond:** glitch-free guarantee preserved by the
  **critical `_emit → downWithBatch → _deliverToSinks` structure** — tier
  partitioning ensures DIRTY reaches every sink before DATA reaches any.
  This is load-bearing; v5 must not regress it.

### v5 wave tracking (final)

```
DepRecord<T>[] = [{ latestData, dirty, terminal }, ...]

waveHasNewData: boolean   // set on DATA, reset on wave-complete
hasCalledFnOnce: boolean  // for ctx.afterResubscribe detection
```

- **Wave-complete predicate:** `every(!dep.dirty)` (trivially true initially)
- **Gate-open predicate:** `every(dep.latestData !== NO_DATA)`
- **fn invocation:** on tier-3 arrival, if wave-complete AND gate-open AND
  (waveHasNewData OR never-called-yet), invoke fn. Pre-fn skip when
  `!waveHasNewData` emits RESOLVED without calling fn.
- **No BitSets. No `lastFnInput` identity cache.** The two-step skip
  (pre-fn `waveHasNewData`, post-fn `equals`) replaces both.

### Edge case decisions locked

- **Q16** Single-sink DIRTY-skip optimization: KEEP in v5. Common case,
  cheap code, compatible with bundle auto-framing.
- **Q17** `MAX_DRAIN_ITERATIONS = 1000`: keep for now; configurable via
  singleton later.
- **Q18** Connection-time dep-subscribe loop: NOT wrapped in implicit
  `batch()`. The first-run gate already handles it.
- **Q19** Cycle detection: NOT added. Some graphs deliberately use cycles
  and break the loop via domain logic. Runtime `MAX_DRAIN_ITERATIONS`
  remains the safety net. Revisit in §6 (dynamicNode) if needed.
- **Q20** INVALIDATE on a dep under v5: clear `dep.latestData = NO_DATA`,
  mark `dep.dirty = true`. Re-closes the gate. fn won't run again until
  that dep delivers fresh DATA.
- **Q21** `_deliverToSinks` snapshot-for-safety: KEEP. Sinks that
  unsubscribe mid-iteration must not corrupt the walk.

---

## §3.5 Internal dispatch simplification (v5.1)

The v5 hook catalog simplified the user surface but left the internal
dispatch machinery with 9+ `_down*` / `_up*` methods and visible
asymmetry between directions. v5.1 collapses this into one unified
pipeline with a `direction` parameter.

### Before (current legacy)

| Method | Role |
|---|---|
| `down(messages, options?)` | Public, guard → `_downInternal` |
| `_downInternal(messages)` | Terminal filter + `_handleLocalLifecycle` + single-dep DIRTY-skip + `downWithBatch` |
| `_downToSinks(messages)` | Sink iteration with snapshot |
| `_boundDownToSinks` | Bound closure for `downWithBatch` |
| `_downAutoValue(value)` | Value → framed messages → `_downInternal` |
| `downWithBatch(sink, messages)` | Tier partition + batch queue |
| `_downSequential(sink, messages)` | Alternative walk (deleted in v5) |
| `up(messages, options?)` | Public, guard → forward to deps |
| `_upInternal(messages)` | Internal up forward, skips guard |

### After (v5.1)

| Method | Role |
|---|---|
| `down(messages, options?)` | Sugar → `_emit("down", ...)` |
| `up(messages, options?)` | Sugar → `_emit("up", ...)` |
| `_emit(direction, messages, opts)` | Unified pipeline: guard → terminal filter (down) → own-state update (down) → single-sink DIRTY-skip (down) → dispatch |
| `_dispatchToTargets(direction, messages)` | Direction-specific target iteration |
| `_deliverToSinks` | Snapshot-safe sink iteration (down only, arrow-bound) |
| `_updateOwnState(messages)` | Cache/status/terminal update on outgoing (renamed from `_handleLocalLifecycle`) |

**Deleted:** `_downInternal`, `_downToSinks`, `_boundDownToSinks`,
`_downAutoValue`, `_upInternal`, `_downSequential`. Six methods gone.

### `_downAutoValue` — deleted, replaced by explicit sugar wrapping

Under v5.1 + §7's "fn return is cleanup only" rule, `_downAutoValue` is **deleted outright**, not replaced. There is no framework-internal path that reads fn's return value and frames it as DATA.

**Plain `node(deps, fn)`** takes a full fn with the signature `(latestData, actions) => cleanup | void`. The user writes emission explicitly via `actions`:

```ts
node([a, b], (data, actions) => {
  actions.emit(data[0] + data[1])   // or actions.down(...) for raw framing
})
```

Fn's return value is treated as a cleanup function (if callable) or ignored (otherwise). No auto-framing. No framework post-fn hook reads the return value as data.

**Sugar constructors** (`derived`, `map`, `filter`, `scan`, etc.) take a value-returning `userFn` and wrap it at construction time so the user doesn't have to spell out `actions.emit` for the common case:

```ts
// derived(deps, userFn) desugars to:
node(deps, (data, actions) => {
  actions.emit(userFn(data))
})

// map(userFn) desugars (single-dep form) to:
node([source], (data, actions) => {
  actions.emit(userFn(data[0]))
})
```

The wrapping lives in the sugar constructor's body (`src/core/sugar.ts`), not in the framework dispatch path. From the core's perspective, every node has the same shape: full fn with explicit `actions`. Sugar is a user-surface convenience, not a protocol-level branch.

**What `bundle` actually owns:** multi-message batching — tier sort + DIRTY auto-prefix (§3.5.2). It does *not* own fn-return framing (there is no fn-return to frame), and it does *not* own equals substitution (that's a dispatch-layer invariant, §3.5.1).

**Deleted by this decision:** `_downAutoValue`, `_onManualEmit`, `_manualEmitUsed`, and the entire auto-framing machinery in `_runFn()`. See §7 inventory (lines 1790–1791) and §8.1 (line 1803 — `_runFn` rewrite: "No auto-framing, just call fn, store cleanup") for the inventory impact.

### §3.5.1 Equals substitution — tier-3 dispatch invariant (2026-04-12)

**Refines the "bundle.resolve() replaces `_downAutoValue`" subsection above.** Bundle owns *sort + DIRTY prefix*; the dispatcher owns *equals + cache advance*. The two are adjacent but not the same layer, and conflating them breaks multi-emit cases.

Equals/RESOLVED substitution is a **protocol invariant at the outgoing tier-3 dispatch step**, not an opt-in feature of `bundle.resolve()` or `actions.emit(v)`. It applies uniformly to every DATA payload leaving the node, regardless of which action API produced it. The singleton `_emit("down", ...)` walks the tier-3 slice sequentially:

```ts
// Conceptual, inside _emit("down", ...) after tier sort:
for (const msg of tier3Messages) {
  if (msg[0] === DATA) {
    if (this._cached !== NO_VALUE && this._equals(this._cached, msg[1])) {
      msg = [RESOLVED]           // substitute in place
    } else {
      this._cached = msg[1]      // advance cache
    }
  }
  dispatch(msg)
}
```

**Why this placement — the multi-emit edge case.** With `.cache = 2`, if fn calls `emit(1); emit(2); emit(3); emit(2)`:

- *Snapshot-at-fn-entry* semantics (naive reading of "post-fn equals") would produce `DATA(1), RESOLVED, DATA(3), RESOLVED`, leaving downstream's `dep.latestData` at 3 — **wrong**. RESOLVED means "unchanged from what you last saw," and downstream last saw 3, not the entry snapshot of 2.
- *Live-cache* semantics produce `DATA(1), DATA(2), DATA(3), DATA(2)`, leaving downstream at 2 — correct.

`.cache` therefore has one well-defined meaning: **"the last DATA payload this node actually emitted downstream."** It is owned by the dispatcher and advances synchronously as each tier-3 message is processed. Fn never writes `.cache` directly.

`lastFnInput` (the pre-fn input identity-skip, §1 v2 line 1362) is a separate, genuinely-snapshotted dep-value cache. Both concepts exist, at different layers, and neither should be confused with the other.

**Synthetic DIRTY prefix on substitution (QA P1, 2026-04-12).** When the walk substitutes `[DATA, v]` to `[RESOLVED]` and no DIRTY has been seen in the current wave (pre-walk `_status !== "dirty"` AND no DIRTY earlier in this batch), the walk **auto-prepends a synthetic `[DIRTY]`** to the rewritten batch. This keeps the emitted sequence `[[DIRTY], [RESOLVED]]` compliant with spec §1.3.1 (DIRTY precedes DATA or RESOLVED in the same batch) even when the caller used raw `node.down([[DATA, v]])` without explicit DIRTY framing. The prefix is inserted after any tier-0 messages, matching `defaultBundle.resolve()`'s existing DIRTY auto-prefix placement. Without this rule, raw `down([[DATA, sameValue]])` would produce a lonely RESOLVED on the wire, which §1.3.1's compat-path carve-out (bare DATA from raw/external sources) does NOT cover. The synthetic prefix is the mechanism that reconciles "equals substitution is non-negotiable for every emission path" with "§1.3.1 two-phase framing is non-negotiable."

Note: the raw `down` compat path for *bare* DATA (no substitution needed, `v` differs from cache) is unchanged — no synthetic DIRTY is inserted in that case, because §1.3.1's compat carve-out allows raw DATA without prior DIRTY.

**Equals-throw atomicity (QA P2, 2026-04-12).** When the user-supplied `equals` function throws mid-walk on message N of a multi-message batch, the walk:

1. Aborts immediately — message N and any subsequent messages are not processed.
2. Commits state mutations from messages 0..N-1 (already in-place on `this._cached` / `this._status` / `this._versioning`).
3. Returns the successfully-walked prefix from `_updateState` alongside an `equalsError`.
4. `_emit` delivers the prefix to sinks via `downWithBatch`, then recursively calls `_emit([[ERROR, ...]])` to emit a fresh ERROR batch.

Subscribers observe `[...walked_prefix, ERROR]` in order, coherent with `.cache` which was advanced during the prefix walk. This is a change from the pre-refactor single-value `actions.emit` path, which ran equals *before* any state mutation and was trivially atomic. With the unified dispatch-layer walk, atomicity is restored at the cost of a two-step emission (prefix then ERROR). Alternative "discard the whole batch on throw" semantics were considered and rejected: they would desynchronize `.cache` from what subscribers have observed, which is the whole point of making equals a dispatch invariant in the first place.

### §3.5.2 Action API taxonomy (2026-04-12)

Three action APIs produce outgoing messages, differing only in which conveniences wrap them. Equals substitution and cache advance are common to all three because they sit *below* the bundle layer.

| API | Tier sort | DIRTY auto-prefix | Equals + cache advance |
|---|---|---|---|
| `actions.emit(v)` | trivial (one msg) | yes (via bundle) | yes |
| `actions.down(bundle(...))` | yes | yes | yes |
| `actions.down(rawMessages[])` | no | no | **yes** |

- `actions.emit(v)` is sugar for `actions.down(bundle([DATA, v]))`. Always goes through the bundle path, so always picks up sort + DIRTY prefix.
- `actions.down(bundle(...))` is the protocol-safe multi-message path: sort by tier, auto-prefix DIRTY when any tier-3 message is present and the node is not already dirty, then dispatch.
- `actions.down(rawMessages[])` is the escape hatch: caller owns message ordering and DIRTY framing. Use when hand-framing is deliberate (operator-internal protocol sequences). Does not participate in tier sort or DIRTY auto-prefix.

**Raw `down` caller responsibility — tier ordering (QA D3, 2026-04-12).** Raw `actions.down(rawMessages[])` / `node.down(rawMessages[])` requires the caller to supply messages in **ascending tier order** (tier 0 → 5). This is the same invariant that `src/core/batch.ts:19–22` enforces on `downWithBatch`'s input: the phase-cut walker at `downWithBatch:162–167` assumes monotone tier order and will produce incorrect phase splits for out-of-order input. The `_updateState` walk itself processes messages in array order regardless of tier, so out-of-order raw input will also corrupt `_status` transitions (e.g., `[[COMPLETE], [DATA, v]]` would set status to `"completed"` first, then try to advance cache on a terminal node). Raw batch authors must pre-sort or route through `bundle(...).resolve()` — which does the sort automatically.

All three ultimately hit `_emit("down", ...)`, and `_emit` applies the equals+cache walk unconditionally. **There is no way for a node to emit DATA downstream without advancing `.cache`** — that's the invariant that keeps `.cache` coherent with the wire.

Corollary: `actions.emit(v)` and `actions.down([[DATA, v]])` are *not* equivalent. The former auto-prefixes DIRTY via bundle; the latter does not — unless the walk substitutes `[DATA, v]` to `[RESOLVED]`, in which case §3.5.1's synthetic-DIRTY rule kicks in and a `[DIRTY]` is auto-prepended so the resulting `[[DIRTY], [RESOLVED]]` is §1.3.1 compliant.

**Semantic broadening of `equals` scope (QA D1, 2026-04-12).** Because the walk runs for *every* outgoing tier-3 message regardless of path, a user-supplied `equals` function now fires in contexts where it didn't pre-refactor:

- **Passthrough / forwarding nodes** (`node([dep])` with no fn) — previously dep DATA was re-emitted 1:1 without running the passthrough's own `equals`. Now the passthrough's `equals` fires on every forwarded DATA against the passthrough's own `_cached`, so two identical dep emissions produce DATA then RESOLVED at the passthrough.
- **Raw `node.down([[DATA, v]])`** — previously raw down bypassed equals entirely. Now it participates in the substitution walk.
- **Operator-internal raw down** — any operator that uses raw `actions.down([[DATA, v]])` for hand-framed emission now picks up equals substitution automatically.

**Author implication:** a custom `equals` is now a global deduplication filter across every outgoing DATA, not just `actions.emit` / bundle.resolve. A pathological `equals: () => true` will absorb every DATA emission into RESOLVED regardless of payload, which was previously only possible for `actions.emit` paths. Operators that want per-path equals semantics must either (a) use the default `Object.is` at the node level and do their own in-fn comparison, or (b) accept the global filter behavior.

**`equals` contract — purity (QA D4, 2026-04-12).** The `equals` function MUST be pure. Specifically:

- No side effects. No network/disk I/O, no mutation of captured state, no reactive emissions (`node.down(...)`, `node.emit(...)`, etc.).
- No reads of `this.cache` / `this.status` via captured references. The walk mutates `this._cached` / `this._status` progressively during multi-message batches; an impure `equals` that reads them via a captured `this` sees intermediate state.
- Deterministic. Calling `equals(a, b)` twice with the same arguments must return the same result.

Violating the contract corrupts the reactive graph in undefined ways. The library does not enforce purity at runtime (the cost is too high and the contract is standard for reactive systems). Specifically, an impure `equals` that calls `node.down(...)` reentrantly will trigger a nested `_emit` / `_updateState` walk that commits its own state, which the outer walk's in-place mutation may then overwrite — the result is undefined and implementation-specific.

**Guard interaction.** Public-API calls (`node.down`, `node.emit`, `node.up`) from inside `equals` still hit `_checkGuard` on the target node. The guard is *not* bypassable via the public API. It *is* bypassable via `_`-prefixed internal methods (e.g., `node._emit(...)` reflectively), but that is true of all user code and not specific to `equals` — `_` prefix is a visibility convention, not a runtime boundary. Nodes that need strong isolation from `equals`-initiated writes should apply a guard to their public surface.

### §3.5.3 Mixed-tier cache-advance ordering (2026-04-12)

Within a single `actions.down(bundle(...))` call, the tier sort (lines 1216–1219) processes messages in tier order: 1 → 2 → 3 → 4 → 5. The equals+cache walk runs entirely within the contiguous tier-3 slice, so:

- Tiers 1 (DIRTY/INVALIDATE) and 2 (PAUSE/RESUME) dispatch before any cache change in this call.
- Tier 3 (DATA/RESOLVED) dispatches sequentially, advancing `.cache` per DATA.
- Tiers 4 (COMPLETE/ERROR) and 5 (TEARDOWN) dispatch after `.cache` is fully advanced.

No cross-tier interleaving; no "partial cache" visible to tier-4 handlers. A COMPLETE in the same bundle as a final DATA observes the post-DATA cache.

Sequential `actions.emit()` / `actions.down()` calls do not coordinate with each other — each is an independent dispatch with its own DIRTY-prefix check and its own tier-3 walk. Bundles are the only way to get single-wave multi-tier emission; sequential calls produce multiple waves.

### Remaining justified asymmetry

Inherent semantic differences, not cruft:

1. **Terminal filter** — `_terminal` is a down-direction concept.
2. **Own-state update** — only down-emissions change own cache/status.
3. **Single-sink DIRTY-skip** — `singleDep` hint is a subscribe-time
   downstream artifact; no upstream equivalent.
4. **Batch drain queues** — up direction carries only tier 0-2 + 5
   messages (all immediate), so drain queues are effectively unused
   for up. The code path is still shared.

### `downWithBatch` location (clarification)

Standalone function in `src/core/batch.ts`. Not a method on NodeBase.
Takes a sink callback as first parameter; reusable for any callable
target shape.

**Two call sites in v5.1:**
1. `NodeBase._dispatchToTargets(direction="down")` passes the node's
   `_deliverToSinks` (mega-sink iterating all sinks) as target.
2. Singleton `defaultOnSubscribe` passes the one specific new sink
   directly as target.

**Not used for up direction.** Up carries only tier 0-2 + 5 (all
immediate), so there's no deferral or tier partition to perform. Up
uses a plain for-loop calling `dep._emit("up", ...)`.

### `downToSink` for onSubscribe ceremony

Not a method on NodeBase anymore. Singleton's default `onSubscribe`
inlines one direct call:

```ts
function defaultOnSubscribe(node, sink, ctx, actions) {
  const initial = node.cache === NO_VALUE
    ? [[START]]
    : [[START], [DATA, node.cache]]
  downWithBatch(sink, actions.bundle(...initial).resolve())
}
```

---

## §2 Message protocol — decisions locked

### Phase vs tier (conceptual keystone)

| Concept | Scope | Purpose |
|---|---|---|
| **Tier** | Framework-wide | Type classification. Groups message types into categories (0–5 built-in). Extended by users via `MessageTypeRegistry` or per-node bundle override. |
| **Phase** | Per-procedure | Internal step order within one procedure. Each procedure maps phases → tiers independently. Different procedures collapse or split tiers differently. |

Concrete phase/tier mappings:

- **`bundle.resolve()` / `onMessage`**: 1:1 identity. Processes in tier order, one phase per tier. No reordering beyond tier sort.
- **`batch()` drain**:
  - Phase 1 = tiers 0–2 (immediate — START/DIRTY/INVALIDATE/PAUSE/RESUME — never deferred)
  - Phase 2 = tier 3 (DATA/RESOLVED — first drain queue)
  - Phase 3 = tier 4 (COMPLETE/ERROR — second drain queue)
  - Phase 4 = tier 5 (TEARDOWN — third drain queue)

**Drain queues renamed** from tier vocabulary to phase vocabulary:
- `drainPhase2` (was `pendingPhase2`, holds tier-3)
- `drainPhase3` (was `pendingPhase3`, holds tier-4)
- `drainPhase4` (new, holds tier-5 — unified TEARDOWN deferral)

### `downWithBatch` dispatch under v4

- Emissions arrive **pre-sorted** from `bundle.resolve()`. No need for the `partition` vs `sequential` strategy option — **deleted**.
- Dispatch walks the sorted array once, finds first tier-3 index (batch phase-2 cut), delivers `[0:cut)` sync, queues `[cut:]` into drain queues split by phase boundaries (second linear scan).
- Strictly fewer allocations than current 3-way partition.
- `downWithBatch` is **batch-aware** via `isBatching()`. Works inside or outside `batch(() => ...)` without explicit opt-in.

### `onSubscribe` START delivery

```ts
// Default onSubscribe body
onSubscribe(sink, ctx, actions) {
  const initial = cache === NO_VALUE
    ? [[START]]
    : [[START], [DATA, cache]]
  actions.downToSink(actions.bundle(...initial).resolve())
}
```

`downToSink` routes through `downWithBatch`, so when `subscribe()` is called inside `batch()`, the START delivers sync (tier 0 = batch phase 1 = immediate) but the paired `[DATA, cache]` defers to phase-2 drain. Consistent with all other emissions. User doesn't need to put `subscribe()` in `batch()` explicitly — the batch-awareness adapts.

### TEARDOWN unified deferral

Current code has two inconsistent behaviors: partition strategy treats TEARDOWN as immediate (tier 5 immediate); sequential routes it to the phase-3 queue. Under v4: **TEARDOWN always deferred to batch phase 4**, draining after tier-4 terminals. This prevents premature resource release (a known bug class).

### `MessageTypeRegistry` (new)

Global registry owned by the framework, queryable by:

- `messageTier(type)` — returns tier 0–5 (or registered custom tier)
- `isLocalOnly(type)` — wire adapters check this at SSE/WebSocket/worker boundaries
- `propagatesToMeta(type)` — `_handleLocalLifecycle` checks this (currently only TEARDOWN)
- `isKnownMessageType(type)` — debug/introspection

Registry entry shape:
```ts
interface MessageTypeRegistration {
  tier: number
  wireCrossing: boolean       // inverse of isLocalOnly
  propagatesToMeta: boolean
}
```

Framework registers the 10 built-in types at import time with their
existing tier/wire/meta semantics. User registration:

```ts
registerMessageType(MY_CUSTOM_TYPE, {
  tier: 3,
  wireCrossing: true,
  propagatesToMeta: false,
})
```

A per-node `opts.bundle` override can provide its own local tier
function for protocols that don't want to pollute the global registry.

### Dead code cleanup

`node-base.ts:828-830` — the branch
```ts
if (t !== TEARDOWN && propagatesToMeta(t)) {
  this._propagateToMeta(t);
}
```
is unreachable because `propagatesToMeta` only returns true for TEARDOWN
but the guard excludes TEARDOWN. Delete.

### §2 open items (for later)

- **Registry edit concurrency.** Global registry is mutable. If user
  code registers a type mid-runtime, cached tier lookups (if any) could
  be stale. Proposed: registration at module-import time only, frozen
  after first use. Enforce at runtime.
- **PY parity.** Python graphrefly needs the same split (phase vs tier,
  MessageTypeRegistry, drain phase rename). Note for §4+ PY parity pass.

---

## §1 Hook catalog — (archived) proposal v3

### User-facing hooks — final 4

| Hook | Signature | Purpose |
|---|---|---|
| `fn` | `(latestData, actions) => value \| cleanup \| void` | Compute (data layer). Runs after wave completes + gate open + pre-fn skip check passes. Return value auto-framed via `equals`. |
| `onSubscribe` | `(sink, ctx, actions) => cleanup?` | Per-sink subscribe lifecycle. Fires on every sink subscribe. Default emits START handshake to `sink`. Returned cleanup runs on that sink's unsubscribe. `ctx.afterTerminalReset` covers old onResubscribe. |
| `onMessage` | `(msg, ctx, actions) => "consume" \| undefined` | Protocol interceptor. Sees all messages, all tiers, both directions (including START arriving from deps and TEARDOWN in either direction). |
| `equals` | `(a, b) => bool` | Post-fn RESOLVED detection. Default `Object.is`. |

### `onSubscribe` context

```
ctx = {
  sinkCount: number,           // post-subscribe count (1 = first after 0)
  afterTerminalReset: boolean, // first subscribe after a resubscribable reset
}
```

### Actions per hook

| Hook | Actions | Notes |
|---|---|---|
| `onSubscribe` | `downToSink(msgs \| bundle)`, `up(msgs \| bundle)`, `bundle(...)` | Only hook with targeted `downToSink`. |
| `onMessage`, `fn` | `down(msgs \| bundle)`, `up(msgs \| bundle)`, `bundle(...)` | Broadcast only. |

No `emit(value)` on any hook. fn's return-value sugar is the only
"emit sugar" path; complex emissions use `down(bundle(...))`.

### Bundle builder (proposed, answers user's "batch action" idea)

```
interface Bundle {
  append(...messages: Message[]): this
}

actions.bundle(...initialMessages: Message[]): Bundle
```

**Semantics:**
- Mutable builder, accepts `Message` tuples via constructor and `append`.
- Drop-in replacement for raw `Messages` array in `down()` / `up()` /
  `downToSink()`.
- On emission, dispatch layer:
  1. **Sorts by tier** (stable within tier: insertion order preserved).
     Tier order: 1 (DIRTY/INVALIDATE) → 2 (PAUSE/RESUME) → 3 (DATA/
     RESOLVED) → 4 (COMPLETE/ERROR) → 5 (TEARDOWN). Tier 0 (START)
     not expected from hooks — if present, emitted first.
  2. **Auto-prefixes DIRTY** if the bundle contains any tier-3 message
     AND the node's current status is not already "dirty".
  3. **Flushes** — bundle becomes empty after emission (single-shot).

**Naming:** leaning `bundle` to avoid collision with existing
`src/core/batch.ts` transaction helper. Alternatives: `group`,
`compose`, `pack`, `frame`. User preference pending.

### Bundle walkthrough (from user's example)

```
const b1 = actions.bundle([DATA, x2])

actions.down([[DATA, xOneOff]])
// tier-3 present, not dirty → prefix DIRTY
// emits [[DIRTY],[DATA, xOneOff]]

b1.append([COMPLETE])
b1.append([DATA, x1])

const b2 = actions.bundle([DATA, x3])
actions.down(b2)
// sort: [[DATA, x3]]. Not dirty → prefix DIRTY.
// emits [[DIRTY],[DATA, x3]]

actions.down(b1)
// sort: [[DATA, x2],[DATA, x1],[COMPLETE]]  (tier-3 before tier-4)
// Not dirty → prefix DIRTY.
// emits [[DIRTY],[DATA, x2],[DATA, x1],[COMPLETE]]
```

### Open bundle questions

- **Q6** Single-shot vs reusable? Proposed: single-shot (cleaner).
- **Q7** Same bundle reusable across `down()` and `up()` directions?
  Proposed: yes (same object, caller picks direction).
- **Q8** Tier-5 (TEARDOWN) + tier-3 (DATA) in same bundle? Proposed:
  valid (tier sort emits DATA first, then TEARDOWN).
- **Q9** Naming. Proposed: `bundle`.

### Core mechanical layer (non-overridable)

- **Channel lifecycle:** sinkCount 0→1 subscribes to all deps (and runs
  producer fn once for no-deps+fn nodes); sinkCount 1→0 unsubscribes
  from deps, runs pending fn-cleanup (both modes), clears `_cached`
  for compute nodes.
- **Tier dispatcher:** runs after `onMessage` returns `undefined`.
  Per-tier, per-direction. No per-message-type branching in tier
  handlers.
- **Pre-fn skip:** if `!waveHasNewData` at wave completion → emit
  RESOLVED, skip fn entirely.
- **Post-fn equals:** compare fn return value to previous cache;
  emit DATA if changed, RESOLVED if unchanged. Default `Object.is`.
- **Resubscribable terminal reset:** clear `_terminal`, `_cached`,
  `_status`; next `onSubscribe` call gets `ctx.afterTerminalReset=true`.

### Per-node state (minimal)

```
DepRecord<T> = {
  latestData: T | NO_DATA,   // last DATA payload
  dirty: boolean,            // DIRTY received, awaiting settlement
  terminal: boolean,         // COMPLETE or ERROR received
}

// Plus one node-level bool:
waveHasNewData: boolean      // set on DATA arrival, reset on wave completion
```

No `lastFnInput`. No BitSets. Replaces v1/v2's 4 masks + identity-cache.

---

## §1 Hook catalog — (archived) proposal v2

### User-facing hooks — final 5

| Hook | Signature | Purpose |
|---|---|---|
| `fn` | `(latestData, actions) => value \| cleanup \| void` | Compute. Runs when wave completes + gate open. Producers: runs once on first-sink activation. Data layer (P2). |
| `onSubscribe` | `(sink, actions) => cleanup?` | Per-sink subscribe lifecycle. Fires on every sink subscribe (not just first). Default emits START handshake to `sink`. Returned cleanup runs on that sink's unsubscribe. Only hook with a sink-targeted action. |
| `onMessage` | `(msg, ctx, actions) => "consume" \| undefined` | Protocol interceptor. Sees all incoming messages in both directions. |
| `equals` | `(a, b) => bool` | Post-fn RESOLVED detection. |
| `onResubscribe` | `() => void` | Resubscribable terminal reset. |

Hooks that DISAPPEAR from user surface: `_onActivate`, `_doDeactivate`,
`_onInvalidate`, `_onTeardown`, `_onManualEmit`, D8 fallback,
onMessage-consumed-DATA special case.

### Actions per hook

| Hook | Actions |
|---|---|
| `onSubscribe` | `downToSink(messages)` — targeted at the subscribing sink; `up(messages)` — forward to deps |
| `onMessage` | `down(messages)`, `up(messages)`, `emit(value)` — broadcast |
| `fn` | `down(messages)`, `up(messages)`, `emit(value)` — broadcast |

**Why START lives in `onSubscribe`, not `onMessage`:** START is the only
message in the protocol that's inherently targeted at a single sink
(the one just subscribed). All other emissions broadcast to `_sinks`.
Routing START through onMessage + `actions.down()` would fan out to
every existing sink. `onSubscribe`'s sink-targeted `downToSink` action
is the right placement.

### Default `onSubscribe` body

```
onSubscribe(sink, actions) {
  const handshake = cache === NO_VALUE
    ? [[START]]
    : [[START], [DATA, cache]]
  actions.downToSink(handshake)
  return undefined
}
```

### Core mechanical layer (non-overridable)

- **Channel lifecycle:** sinkCount 0→1 subscribes to all deps (and runs
  producer fn once for no-deps+fn nodes); sinkCount 1→0 unsubscribes
  from deps, runs pending fn-cleanup, clears `_cached` for compute
  nodes (ROM/RAM rule).
- **Tier dispatcher:** runs after `onMessage` returns `undefined`.
  Per-tier, per-direction. No per-message-type branching inside
  tier handlers.
- **Pre-fn identity-skip:** if every `latestData[i]` is `Object.is`-same
  as `lastFnInput[i]`, emit RESOLVED, skip fn entirely.
- **Post-fn `equals`:** compare fn output to previous cached value;
  emit DATA if changed, RESOLVED if unchanged.
- **Resubscribable terminal reset:** clear `_terminal`, `_cached`,
  `_status`; fire `onResubscribe` hook.

### Per-dep record (one small record per dep)

```
DepRecord<T> = {
  latestData: T | NO_DATA,   // last DATA payload, NO_DATA if never seen
  dirty: boolean,            // DIRTY received, awaiting DATA/RESOLVED
  terminal: boolean,         // COMPLETE or ERROR received
}
```

Plus one node-level field: `lastFnInput: readonly T[] | undefined` for
the pre-fn identity-skip.

This replaces: `_depDirtyMask`, `_depSettledMask`, `_depCompleteMask`,
`_allDepsCompleteMask`, `_lastDepValues`.

### Default down-in tier dispatch

| Tier | Types | Default |
|---|---|---|
| 0 | START | Record dep as "subscribed". (Paired DATA, when dep was cached, arrives as a separate tier-3 message.) |
| 1 | DIRTY, INVALIDATE | `dep.dirty = true`. First dep dirtying in wave → emit DIRTY down. INVALIDATE additionally clears `dep.latestData = NO_DATA`. |
| 2 | PAUSE, RESUME | Forward down. |
| 3 | DATA, RESOLVED | DATA: `dep.latestData = payload; dep.dirty = false`. RESOLVED: `dep.dirty = false`. If wave complete AND gate open: check pre-fn identity-skip; if skipped emit RESOLVED; else run fn with `latestData[]`, then post-fn `equals` → DATA or RESOLVED. |
| 4 | COMPLETE, ERROR | `dep.terminal = true; dep.dirty = false`. If all terminal → propagate down. Otherwise, check wave-complete + gate (D1.3 case) → run fn if ready. |
| 5 | TEARDOWN | Forward down. Trigger deactivation. |

### Default up-in tier dispatch

| Tier | Types | Default |
|---|---|---|
| 0 | START | N/A |
| 1 | DIRTY, INVALIDATE | Forward up to deps |
| 2 | PAUSE, RESUME | Forward up to deps |
| 3 | DATA, RESOLVED | N/A by convention; if sent, forward up |
| 4 | COMPLETE, ERROR | Forward up |
| 5 | TEARDOWN | Forward up. Trigger deactivation. |

---

## §3.8 — Four deferred questions (frozen)

### Q1: Sentinel detection — status enum, not new property

**Decision:** Add `"sentinel"` to `NodeStatus`, replacing `"disconnected"`.

`NodeStatus = "sentinel" | "pending" | "dirty" | "settled" | "resolved" | "completed" | "errored"`

- `"sentinel"` replaces `"disconnected"` (no-subscribers / no-cache state).
- `"pending"` stays: means "activated, deps propagating, no DATA yet."
- Fresh node starts `"sentinel"` → `"pending"` on first subscribe + activation →
  `"dirty"` or `"settled"` once deps propagate.
- `describeNode` / `metaSnapshot` check `node.status === "sentinel"` via public API.
- No `hasCache` property needed. Eliminates the `_cached === NO_VALUE` encapsulation
  violation in `meta.ts`.

### Q2: "Two-tier authoring" — what it means

The term describes a risk: if some operators require framework-internal access (e.g.
per-node `onMessage` hooks, private APIs) that regular users can't access, the system
splits into two classes of node authors:

1. **Regular authors** — write `fn`, use `actions`, compose via `pipe()`
2. **Framework authors** — access singleton internals, register protocol hooks

This undermines the "everything is a node with the same primitives" promise. Under v5,
ALL operator logic must be expressible via `fn` + `actions` + closures. The singleton
`onMessage` handles protocol mechanics uniformly — no operator should need special
framework-level access.

### Q3: bridge.ts — DELETE

**Decision:** Remove `bridge.ts` entirely.

- `pipe()` and `graph.connect()` cannot directly replace bridge's cross-node forwarding.
- But bridge is just sugar for `effect([from], ...) { to.down(...) }` — trivially
  expressible under v5 with `fn` + `actions`.
- Per-node `onMessage` conflicts with v5 singleton. The single production call site
  (`reduction.ts:309`, funnel inter-stage wiring) will be rewritten.
- Pre-1.0: no backward compat aliases, no legacy sugar. Delete the file.

### Q4: afterResubscribe — DROP from FnCtx

**Decision:** Remove `afterResubscribe` from FnCtx.

- The first-call vs post-reset distinction IS real (closure state like reduce's
  accumulator persists across resubscribable cycles).
- But `fn` never needs to know. The reset happens in the `onResubscribe` hook
  (which resets closure variables) BEFORE fn ever runs again.
- Under v5, resubscribe-reset is a lifecycle concern handled by the singleton
  `onSubscribe` callback. Not a data-computation concern.

**FnCtx (final):** `{ terminal: boolean }` — SUPERSEDED by §4 FnCtx v6.

---

## §4 — Operators audit (frozen)

### FnCtx v6 (SUPERSEDES v5 FnCtx)

```ts
interface FnCtx {
  dataFrom: readonly boolean[];              // which deps sent DATA this wave
  terminalDeps: readonly (true | unknown)[]; // true = COMPLETE, value = ERROR payload
}
```

- `terminal` boolean removed — derivable from `terminalDeps`.
- `afterResubscribe` removed — lifecycle concern, not data concern (§3.8 Q4).
- `dataFrom[i]` is `true` if dep[i] sent DATA in this wave, `false` if RESOLVED.
- `terminalDeps[i]` is `undefined` (not terminal), `true` (COMPLETE), or the
  error payload (ERROR). Operators like `rescue` read the payload directly.

### PAUSE/RESUME — promoted to default singleton behavior

**Decision:** PAUSE buffering is a first-class protocol concern, not an operator.

- Default `pausable: true` on all nodes. Singleton tier-2 handler sets
  `_paused` flag on PAUSE, clears on RESUME. While paused, wave completion
  is suppressed — DepRecord updates but fn doesn't fire. On RESUME, if
  accumulated state satisfies gate, fn fires once with latest values.
- `pausable: false` for sources that must keep running during PAUSE (timers).
- `pausable: "resumeAll"` for operators that need replay of every buffered
  value on RESUME (e.g., bufferCount during pause).
- Node option shape: `pausable?: boolean | "resumeAll"` (default `true`).
- `pausable()` operator DELETED — default behavior covers it.

### repeat — already works under v5

`repeat` is a **producer** that manages inner subscriptions via closure
(`source.subscribe()` + catch COMPLETE + resubscribe). Same pattern as
switchMap/exhaustMap. Does NOT use deps, does NOT need `resubscribeDep`.

### `resubscribeDep` — CANDIDATE for §6 (dynamicNode), NOT confirmed

No operator in `src/extra/operators.ts` needs `resubscribeDep`. Operators
that resubscribe (repeat, switchMap, exhaustMap, concatMap, mergeMap) all
manage inner subscriptions via closures, not dep re-subscription.

`resubscribeDep` may be needed for dynamicNode dep-rewiring in §6.
Decision deferred. If added, it would execute immediately (like
`actions.down()`), with consequences batched by the batch system —
no separate lifecycle queue needed.

### Operator categories (v5 compatibility)

| Category | v5 mechanism | Example operators |
|---|---|---|
| Single-dep transform | fn + closure | map, filter, scan, distinctUntilChanged, pairwise, tap |
| Single-dep timer | fn + closure + timer-in-closure | delay, debounce, throttle, audit, timeout |
| Single-dep accumulate | fn + closure + `terminalDeps` | reduce, take, skip, first, last, find, elementAt |
| Multi-dep combine | fn + `dataFrom` | combine, valve, withLatestFrom |
| Multi-dep per-message | fn + `dataFrom` + `terminalDeps` | merge, zip, concat, race |
| Higher-order | fn + closure + inner subscription | switchMap, exhaustMap, concatMap, mergeMap |
| Window/buffer | fn + closure + producer | buffer, bufferCount, windowCount, bufferTime, windowTime, window |
| Protocol | singleton tier handler | pausable (deleted), rescue (via terminalDeps) |
| Lifecycle (inner sub) | producer + closure subscribe | repeat |
| Source | producer fn | interval |

### P3 violations — all replaced by latestData / dataFrom

- `take:262` `source.get()` → `data[0]`
- `withLatestFrom:753,759,762` `primary.get()`, `secondary.get()` → `data[0]`, `data[1]`
- `valve:2560-2561` `source.get()`, `control.get()` → `data[0]`, `data[1]`

### SESSION-d8 bug classes — eliminated by construction

- **Group A** (D8 fallback timing) — no D8 fallback, fn fires only on wave completion
- **Group B** (onMessage consuming DATA + stale dep.get() in fn) — no dep.get()
- **Group C** (identity-skip via stale dep.get()) — pre-fn skip uses DepRecord

### RxJS aliases — KEEP

`combineLatest`, `debounceTime`, `throttleTime`, `catchError` — kept for AI
code-generation accuracy. Not backward-compat sugar.

---

## §5 — Sources audit (frozen)

### Producer sources — all v5 compatible

fromTimer, fromCron, fromEvent, fromFSWatch, fromIter, fromPromise,
fromAsyncIter, of, empty, never, throwError — all use `producer()` with
closure-captured `actions`. fn runs once on activation, returns cleanup.
This IS the v5 producer pattern. No structural changes needed.

### `actions.emit(v)` — KEEP as sugar

`actions.emit(v)` stays as convenience for
`actions.down(actions.bundle([DATA, v]).resolve())`. All producers use it.

### `forEach` / `toArray` — rewrite to fn + terminalDeps

- `forEach`: fn receives data[0], calls user callback. No onMessage.
- `toArray`: fn accumulates in closure, emits array when
  `terminalDeps[0] === true`. Same pattern as `reduce`.

### `replay` + `wrapSubscribeHook` — replaced by `replayBuffer` node option

**Decision:** `replayBuffer: number` as a node option. Singleton onSubscribe
delivers buffered DATA after START but before live updates.

```ts
interface NodeOptions {
  replayBuffer?: number;  // buffer last N outgoing DATA for late subscribers
}
```

Internal: node appends to circular buffer on each outgoing DATA emission.
onSubscribe ceremony delivers buffer contents to new subscriber after START.

- `wrapSubscribeHook` — DELETED. No more monkey-patching subscribe.
- `replay(source, N)` simplifies to `producer(... , { replayBuffer: N })`.
- `cached(source)` = `replay(source, 1)` — unchanged externally.
- Any node can have replay: `state(0, { replayBuffer: 5 })`.

### `.get()` → `.cache` renames (6 call sites + docs)

- `share:740`, `replay:776`, `wrapSubscribeHook:117` → `source.cache`
- `isNode:524` duck-type check → `"cache" in x && typeof x.subscribe === "function"`
- `reactiveCounter:985,990,993` → `counter.cache`
- Docs (firstValueFrom, firstWhere, keepalive) → update references

### `reactiveCounter.cache`

Rename `.get()` → `.cache` on the bundle type to mirror `node.cache`:
`get cache() { return this.node.cache ?? 0; }`

### share/replay reading `source.cache` at factory time — ALLOWED

These are external observer reads at wiring time, not cross-node access
from inside fn. P3 prohibits `.get()` inside fn/onMessage only. External
`.cache` reads at factory construction time are the intended API.

---

---

## §6 — dynamicNode redesign (frozen)

### DynamicNodeImpl — DELETED, folded into NodeImpl

dynamicNode is NodeImpl with a different fn calling convention. No separate
class. No activeMask needed — all deps participate in wave tracking, post-fn
equals absorbs wasted fn calls when unused deps update.

```ts
// API
dynamicNode<T>(
  allDeps: readonly Node[],
  fn: (track: TrackFn) => T,
  opts?: NodeOptions
): Node<T>

// track() reads from pre-allocated DepRecord
const track = (dep) => depRecords[depIndexMap.get(dep)].latestData
```

### What gets deleted from dynamic-node.ts (527 lines → ~20 lines in NodeImpl)

- `DynamicNodeImpl` class — gone
- `_rewire()` — gone (deps fixed at construction)
- `_bufferedDepMessages` / `_rewiring` — gone
- `_trackedValues` — gone
- `MAX_RERUN` loop — gone
- `_depValuesDifferFromTracked()` — gone
- `_updateMasksForMessage()` — gone
- `_depDirtyBits` / `_depSettledBits` / `_depCompleteBits` Sets — gone (DepRecord)
- Per-node `onMessage` / `onResubscribe` — gone (v5 singleton)

### What gets added to NodeImpl

- `_depIndexMap: Map<Node, number>` for track() O(1) lookup
- `_isDynamic: boolean` flag
- track() proxy builder (reads depRecord[i].latestData)
- `dynamicNode()` sugar constructor (like `state()`, `derived()`, `effect()`)

### `get` → `track` rename — accepted

### No activeMask needed

All deps subscribed, all participate in wave tracking. When unused dep
updates, fn fires, computes same result, equals → RESOLVED. Correct and
simple. Extra fn call is negligible for typical 3-5 dep dynamic nodes.

### P3 compliance — FULL

track() reads from DepRecord (protocol-delivered DATA). No `.cache` read,
no cross-node access. Zero P3 violation.

### composite.ts eviction — store mutation events

Instead of dynamicNode tracking data-dependent verdict nodes, use:
1. **Custom message types** for store mutations (STORE_APPEND, STORE_UPDATE,
   STORE_DELETE) registered via MessageTypeRegistry. Flow through tier-3
   alongside DATA. Downstream consumers react to mutations without
   diffing full snapshots.
2. **Store-internal reactive eviction:** when `opts.evict(key, mem)` returns
   a `Node<boolean>`, the store subscribes to it internally and manages
   lifecycle (create on entry add, dispose on delete). No external
   dynamicNode needed.

### Jotai/nanostores compat — DEFERRED

Two-phase approach (discovery run → subscribe → real run) or grow-only
superset are candidates. Designed separately after core redesign. Compat
layers adapt to core.

### `resubscribeDep` — DROPPED

No concrete use case in any operator, source, or dynamicNode pattern.
Removed from consideration entirely.

---

### Timer-in-closure — ACCEPTABLE

Design invariant #3 applies to the reactive protocol layer, not operator fn
closures. `setTimeout`/`clearTimeout` in fn closures cleaned up via fn-cleanup.

---

## §7 — Scenario breaking (frozen)

Nine adversarial scenarios run against the v5 architecture. Results below.

### Scenario results

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 1 | Diamond: A→B, A→C, B+C→D | **PASS** | downWithBatch delivers DIRTY to ALL sinks before DATA reaches ANY. DepRecord[2] tracks both. Wave completes → fn fires once. |
| 2 | Multi-dep terminal: merge(A,B), A completes then B completes | **PASS** | `terminalDeps` encodes per-dep terminal state. fn fires on each terminal event. |
| 3 | Deep chain: A→B→C→D→E, 5 levels | **PASS** | Batch drain processes levels in topological order. Each level: DIRTY→DATA→RESOLVED per two-phase. |
| 4 | reduce: accumulator with "no emission" for some values | **PASS (redesigned)** | Originally failed: fn returning `undefined` as "no emission" breaks two-phase (undefined is valid DATA). **Resolution: fn return is cleanup only.** All emission explicit via `actions.emit()`. Operator emits RESOLVED when skipping. |
| 5 | PAUSE/RESUME: paused node, 3 updates, resume | **PASS** | Singleton tier-2 handler suppresses wave completion during pause. On resume, fn fires with latest DepRecord values. Only latest matters for `pausable: true`. |
| 6 | switchMap: outer emits A→B→C rapidly | **PASS** | Purely reactive: subscribe to outer, create inner subscription per value. Inner callback calls `actions.emit()` asynchronously — works because actions is closure-captured. No timers. |
| 7 | dynamicNode superset: fn tracks subset of declared deps | **PASS** | All deps participate in wave. Unused dep updates → fn fires → same result → equals absorbs → RESOLVED. Correct, simple. |
| 8 | replayBuffer: late subscriber joins after 5 emissions | **PASS** | Node option `replayBuffer: N`. onSubscribe delivers buffered DATA after START. No monkey-patching. |
| 9 | Internal method audit | **PASS (redesigned)** | `_manualEmitUsed` exposed as unexamined internal. Full audit triggered. Result: 14 DELETE, 3 NEW, 3 REWRITE, 24 KEEP. |

### Critical design change from §7: fn return is cleanup only

Scenario 4 (reduce) and Scenario 9 (_manualEmitUsed audit) together drove the
most impactful redesign decision of the session:

- **fn return value is NEVER auto-framed** as DATA or RESOLVED
- ALL emission via `actions.emit(v)` (smart) or `actions.down(msgs)` (raw)
- Sugar constructors (derived, map, filter) wrap user functions: `actions.emit(userFn(data))`
- Operators must emit RESOLVED explicitly when not emitting DATA (two-phase invariant)

This eliminates: `_downAutoValue`, `_manualEmitUsed`, `_onManualEmit`,
and the entire auto-framing machinery in `_runFn()`.

See the updated v5 architecture section (line ~491) for the canonical description.

### Internal methods/properties inventory

**NodeBase (26 members) — v5 status:**

| Member | v5 Status | Notes |
|--------|-----------|-------|
| `_id`, `_type`, `_deps`, `_subs` | KEEP | Core identity and topology |
| `_cache` | KEEP | Stores latest emitted value |
| `_status` | KEEP | NodeStatus enum |
| `_batchLevel` | KEEP | Batch nesting depth |
| `_wave` | KEEP | Current wave tracking |
| `_equals` | KEEP | Configurable equality |
| `_fn` | KEEP | User/wrapped function |
| `_cleanup` | KEEP | fn-returned cleanup |
| `_options` | KEEP | NodeOptions bag |
| `_depRecords` | **NEW** | Replaces 4 BitSets + _lastDepValues |
| `_waveHasNewData` | **NEW** | Per-wave flag for fn gating |
| `_replayBuf` | **NEW** | Circular buffer for replayBuffer option |
| `_depDirtyMask` | DELETE | → DepRecord |
| `_depSettledMask` | DELETE | → DepRecord |
| `_depCompleteMask` | DELETE | → DepRecord |
| `_allDepsCompleteMask` | DELETE | → DepRecord |
| `_lastDepValues` | DELETE | → DepRecord |
| `_onManualEmit()` | DELETE | fn return is cleanup only |
| `_downAutoValue()` | DELETE | fn return is cleanup only |
| `_onInvalidate()` | DELETE | Folded into tier-1 singleton handler |
| `_onTeardown()` | DELETE | Folded into tier-5 singleton handler |
| `_handleLocalLifecycle()` | REWRITE | Simplified, no onMessage dispatch |
| `_handleDepMessages()` | REWRITE | Uses DepRecord, singleton onMessage |
| `subscribe()` | REWRITE | Singleton onSubscribe, replayBuffer |

**NodeImpl (18 members) — v5 status:**

| Member | v5 Status | Notes |
|--------|-----------|-------|
| `_connectUpstream()` | KEEP (simplified) | No pre-set dirty masks |
| `_runFn()` | REWRITE | No auto-framing, just call fn, store cleanup |
| `_manualEmitUsed` | DELETE | fn return is cleanup only |
| `_depIndexMap` | **NEW** | For dynamicNode track() O(1) lookup |
| `_isDynamic` | **NEW** | Flag for dynamicNode calling convention |

**DynamicNodeImpl — DELETED entirely** (folded into NodeImpl, see §6)

---

## §8 — Implementation design (frozen)

### §8.1 — NodeBase + NodeImpl consolidation

**Decision:** Merge `NodeBase` (abstract) + `NodeImpl` into a single `NodeImpl`
class. The abstract class pattern existed solely because `DynamicNodeImpl` was a
second subclass. With `DynamicNodeImpl` deleted (§6), all abstract hooks collapse.

**Deleted by consolidation:**
- Abstract class `NodeBase` — gone
- All abstract hooks: `_onActivate()`, `_doDeactivate()`, `_onInvalidate()`,
  `_onTeardown()`, `_onManualEmit()`, `_createMetaNode()`, `_upInternal()` — gone
- `node-base.ts` as a separate file — merged into `node.ts`

### §8.2 — DepRecord as single per-dep state container

**Decision:** All per-dep state consolidated into one `DepRecord` array. No
separate arrays, no BitSets.

```ts
interface DepRecord {
  readonly node: Node;
  unsub: (() => void) | null;
  latestData: unknown;        // or NO_VALUE
  dirty: boolean;
  settled: boolean;
  terminal: boolean | unknown; // false=live, true=COMPLETE, other=ERROR payload
}
```

Node has ONE dep-related property: `_deps: DepRecord[]`.
Plus `_depIndexMap?: Map<Node, number>` for dynamicNode `track()`.

**Killed by DepRecord consolidation:**
- `_depDirtyMask`, `_depSettledMask`, `_depCompleteMask`, `_allDepsCompleteMask` — 4 BitSets
- `_lastDepValues` array
- `_upstreamUnsubs` / `_depUnsubs` array
- Entire `BitSet` abstraction (`IntBitSet`, `ArrayBitSet`, `createBitSet`)
- `_connectUpstream()`, `_disconnectUpstream()` — inline, operate on DepRecord
- `_onDepDirty()`, `_onDepSettled()` — inline in `_onDepMessage`
- `_maybeCompleteFromDeps()` — inline: `_deps.every(d => d.terminal)`

### §8.3 — Further member consolidation

| Member | Verdict | Replacement |
|--------|---------|-------------|
| `_terminal` | DELETE | `_status === "completed" \|\| _status === "errored"` |
| `_active` | DELETE | Guard via `_deps[0]?.unsub != null` or `_depUnsubs`-equivalent |
| `_lastMutation` | KEEP property, DELETE `_recordMutation()` method | Inline one-liner |
| `_singleDepSinks` / `_singleDepSinkCount` | DELETE | DIRTY-skip optimization removed |
| `_canSkipDirty()` | DELETE | Optimization removed |
| `_handleLocalLifecycle()` | RENAME → `_updateState(msgs)` | No subclass hooks |
| `_handleDepMessages()` | RENAME → `_onDepMessage(dep, msgs)` | Operates on DepRecord |
| `_runFn()` | RENAME → `_execFn()` | Cleanup + fn + store cleanup (~10 lines) |
| `_downAutoValue()` | DELETE | Logic moves into `actions.emit(v)` |
| `_upInternal()` | DELETE | Inline one-liner in `actions.up` |
| `_onActivate()` | DELETE | Inline in `subscribe()` activation path |
| `_doDeactivate()` | DELETE | Fold into `_deactivate()` |
| `_connectUpstream()` | DELETE | Inline, iterate DepRecord |
| `CleanupResult` / `isCleanupResult` / `CLEANUP_RESULT` | DELETE | fn returns cleanup fn or void |

### §8.4 — Consolidated NodeImpl shape

**Properties (~20):**
```
// Identity
_optsName?, _registryName?, _describeKind?, meta

// Topology
_deps: DepRecord[]                  // THE per-dep state array
_sinks: NodeSink | Set<NodeSink> | null
_sinkCount: number
_depIndexMap?: Map<Node, number>    // dynamicNode only

// State
_cached: T | typeof NO_VALUE
_status: NodeStatus
_cleanup?: () => void
_replayBuf?: CircularBuffer<T>

// Options (frozen at construction)
_fn?, _equals, _isDynamic, _resubscribable, _autoComplete
_pausable: boolean | "resumeAll"
_guard?, _hashFn, _versioning?

// ABAC (lazy)
_lastMutation?

// Observability
_inspectorHook?
```

**Methods:**
```
// Public API
get cache(): T | undefined
get status/name/v/lastMutation
down(msgs, opts?), up(msgs, opts?)
subscribe(sink, hints?) → unsub
allowsObserve(actor), hasGuard()

// Internal (6 core)
_activate()            // subscribe to deps OR run producer fn
_deactivate()          // unsub deps, run cleanup, clear cache
_onDepMessage(dep, msgs) // DepRecord update → wave check → _execFn
_execFn()              // cleanup + fn + store new cleanup
_emit(msgs)            // _updateState + deliver to sinks
_updateState(msgs)     // update _cached, _status, meta propagation
```

**`actions` object (built once in constructor):**
```ts
this._actions = {
  emit: (value) => {
    const unchanged = this._cached !== NO_VALUE && this._equals(this._cached, value);
    const wasDirty = this._status === "dirty";
    if (unchanged) {
      this._emit(wasDirty ? [[RESOLVED]] : [[DIRTY], [RESOLVED]]);
    } else {
      this._emit(wasDirty ? [[DATA, value]] : [[DIRTY], [DATA, value]]);
    }
  },
  down: (msgs) => this._emit(msgs),
  up: (msgs) => { for (const d of this._deps) d.node.up?.(msgs, { internal: true }); }
};
```

### §8.5 — Staged rollout

1. `node.ts` — single file: DepRecord, consolidated NodeImpl, actions, factory
2. `sugar.ts` — derived/effect wrap user fns with `actions.emit()`
3. `operators.ts` — rewrite all 42 operators to fn+closure
4. `sources.ts` — forEach/toArray rewrite, replay→replayBuffer, .get()→.cache
5. `dynamic-node.ts` → delete, `dynamicNode()` sugar in `sugar.ts`
6. `node-base.ts` → delete (merged into `node.ts`)

### §8.6 — Remaining src/core/ file audit (frozen)

| File | Lines | v5 Impact |
|------|-------|-----------|
| `node-base.ts` | 887 | DELETE — merged into node.ts |
| `node.ts` | 560 | REWRITE — single NodeImpl + DepRecord |
| `dynamic-node.ts` | 527 | DELETE — dynamicNode() becomes sugar |
| `bridge.ts` | 161 | DELETE — decided in §3.8 |
| `batch.ts` | 358 | KEEP — tier-based drain, pure function, no node coupling |
| `messages.ts` | 249 | KEEP — message types, tiers, helpers, pure protocol |
| `sugar.ts` | 134 | REWRITE — derived/effect wrap with actions.emit(), add dynamicNode() |
| `meta.ts` | 235 | REWRITE — remove DynamicNodeImpl, _manualEmitUsed, .get()→.cache |
| `index.ts` | 47 | REWRITE — remove deleted exports, clean up |
| `actor.ts` | 36 | KEEP |
| `clock.ts` | 30 | KEEP |
| `timer.ts` | 52 | KEEP |
| `guard.ts` | 224 | KEEP |
| `versioning.ts` | 166 | KEEP |

**Deleted exports (pre-1.0 cleanup):**
- `OnMessageHandler` — singleton config is internal
- `SubscribeHints` — DIRTY-skip gone, actor guard is internal
- `CleanupResult`, `cleanupResult`, `CLEANUP_RESULT` — fn return is cleanup or void
- `BridgeOptions`, `bridge`, `DEFAULT_DOWN` — bridge.ts deleted
- `DynamicNodeImpl`, `DynamicNodeOptions` — dynamic-node.ts deleted
- `NO_VALUE` — internal sentinel, never should have been public

**subscribe signature simplification:**
`node.subscribe(sink, actor?)` — one optional param, no wrapper type.

**meta.ts fixes:**
1. `inferDescribeType`: remove `_manualEmitUsed`. Operator detection from `_describeKind` only.
2. `describeNode`: remove `DynamicNodeImpl` instanceof. `node._deps.map(d => d.node.name)`.
3. `node.get()` → `node.cache` throughout.

**Net: 3 files deleted (1,575 lines), 4 files rewritten, 6 files untouched.**

### §8.7 — Stress-test: consolidated design (frozen)

Seven scenarios traced end-to-end through NodeImpl + DepRecord.

| # | Scenario | Result | Key validation |
|---|----------|--------|---------------|
| A | Simple chain: state→derived→effect | PASS | Full activate→data flow→cleanup |
| B | Diamond: A→B, A→C, B+C→D | PASS | Under batch(), wave tracking prevents glitch (same as v4) |
| C | Producer lifecycle | PASS | activate→fn→cleanup→deactivate→re-activate |
| D | Passthrough (no fn) | PASS | Direct forward, DepRecord partially used |
| E | PAUSE/RESUME | PASS | DepRecord.latestData is natural "latest" snapshot |
| F | Terminal + resubscribable | PASS | DepRecord reset on resubscribe |
| G | dynamicNode track() | PASS | Superset wave + equals absorption |

**Design note from Scenario E:** PAUSE/RESUME needs `_paused: boolean` on
the node. When paused, wave completion skips `_execFn()` and sets
`_pendingWave: boolean`. On RESUME, check `_pendingWave` → `_execFn()`.
~4 lines in `_onDepMessage`. Trivially simple with DepRecord since latest
values are already buffered.

**Design note from Scenario B:** Diamond safety depends on `batch()` wrapping
mutations, same as v4. Without batch, synchronous data flow can cause
d to fire fn before all deps have been notified. This is by design — spec
§1.3.7 requires batch for diamond-safe multi-source mutations.

---

## §9 — PY parity check (2026-04-11)

Parity analysis of `graphrefly-py` against the TS v5 architecture before
porting. Goal: confirm the redesign fits all three PY execution modes
(GIL-blocking, free-threaded, asyncio non-blocking), identify PY-specific
friction, then freeze a PY-ordered implementation plan. No code changes
in this pass — audit only.

### §9.1 — Baseline mapping (PY → TS v5)

**Current PY class hierarchy (v4-equivalent):**

| PY file | Lines | Role | v5 fate |
|---|---|---|---|
| `core/node_base.py` | 739 | Abstract base: subscribe/sink/lifecycle, per-node `_on_message` hook | MERGE into `node.py` |
| `core/node.py` | 540 | `NodeImpl` with 4 BitSets, `_last_dep_values`, `_upstream_unsubs` | REWRITE around `DepRecord[]` |
| `core/dynamic_node.py` | 382 | `DynamicNodeImpl`: `get()` proxy, `_rewire()`, rewire buffer, MAX_RERUN | DELETE → factory in `sugar.py` |
| `core/bridge.py` | 147 | Effect node with `on_message` hook | DELETE |
| `core/protocol.py` | 486 | Message types (StrEnum, closed), batch state (`_batch_tls`), tier/meta rules, subgraph-lock defer wrapper | SPLIT: messages.py (types+tiers) + batch.py (drain) + MessageTypeRegistry |
| `core/sugar.py` | 141 | `state`/`producer`/`derived`/`effect` factories | REWRITE to wrap user fn with `actions.emit(user_fn(data))` |
| `core/meta.py` | 250 | `describe_node`, `meta_snapshot` | REWRITE: drop `DynamicNodeImpl` instanceof, `_manual_emit_used` label; use `.cache`/`.status == "sentinel"` |
| `core/subgraph_locks.py` | 296 | Per-component RLock + defer queue (TLS) | KEEP — load-bearing for free-threaded mode |
| `core/runner.py` | 122 | Async/event-loop runner protocol (`schedule(coro, on_result, on_error)`) | KEEP — orthogonal to reactive core |
| `core/cancellation.py` | 91 | Cooperative cancellation token (`threading.Event`) | KEEP — used only at async boundary |
| `core/versioning.py`, `clock.py`, `timer.py`, `guard.py`, `actor.py` | 193/20/43/287/- | Same as TS | KEEP |

**Field-by-field deletion inventory:**

| TS v4 field | PY v4 analog | v5 replacement |
|---|---|---|
| `_depDirtyMask` | `_dep_dirty_mask` (BitSet int) | `DepRecord[i].dirty: bool` |
| `_depSettledMask` | `_dep_settled_mask` | `DepRecord[i].settled: bool` (derived) |
| `_depCompleteMask` | `_dep_complete_mask` | `DepRecord[i].terminal: bool\|error` |
| `_allDepsCompleteMask` | `_all_deps_complete_mask` | `all(d.terminal for d in deps)` |
| `_lastDepValues` | `_last_dep_values: list` | `DepRecord[i].latest_data` |
| `_upstreamUnsubs` | `_upstream_unsubs: list` | `DepRecord[i].unsub` |
| `_manualEmitUsed` | `_manual_emit_used` | DELETE (label collapse) |
| `_downAutoValue()` | `_down_auto_value()` | DELETE → `actions.emit(v)` inline |
| `_onInvalidate/Teardown/Activate` | abstract hooks in `NodeBase` | DELETE → singleton tier handlers |
| `_runFn` | `_run_fn_body` | RENAME → `_exec_fn(latest_data, ctx)` |

**Notable PY divergences from TS baseline:**

1. **`protocol.py` is ~2x larger than TS `messages.ts`** — it bundles
   message types, batch state machine (`_BatchState`, thread-local
   `_batch_tls`), defer queues, and subgraph-lock re-acquisition wrapper
   (`_wrap_deferred_subgraph`). Under v5 this splits: types/registry
   move to a new `messages.py`; batch state stays with batch.py.
2. **PY `MessageType` is a `StrEnum` (closed set)** — archive item
   `web3-research-type-extensibility` flagged this needs widening to
   `MessageType | str` for user-registered custom types. v5
   `MessageTypeRegistry` makes this a hard prerequisite.
3. **Per-node `_on_message` hook lives in `NodeBase`** (not singleton).
   Called from `_handle_dep_messages` before default dispatch. v5
   eliminates per-node override entirely.
4. **Batch state is thread-local** (`_batch_tls`), whereas TS batch
   is call-stack-local. PY's TLS model is *already correct* for
   free-threaded mode — no change needed, a quiet win.
5. **`DynamicNodeImpl._rewire()` runs inside `_run_fn_body`** under
   subgraph RLock. This is the only place `_dep_index_map` is mutated,
   so the rewire dict-iteration race concern is already neutralised
   by the lock.

**P3 (no cross-node `.get()`) current violations:**
- `NodeImpl._run_fn_body` calls `dep.get()` for each dep before
  invoking user fn. Under v5 the values flow from `DepRecord.latest_data`.
- Operator-level: `take`, `with_latest_from`, `valve` read `source.get()`
  (same bug class as TS SESSION-d8 Group C). Same fix: read from the
  fn's `latest_data` list.
- `DynamicNodeImpl` user-facing `get(dep)` proxy currently calls
  `dep.get()` — becomes `track(dep)` reading `DepRecord[i].latest_data`.

### §9.2 — Mode fit: three Python execution modes

CLAUDE.md + Phase 0.4 roadmap commit PY to three modes:

#### Mode A — GIL blocking (CPython 3.12, 3.13 default)

GIL provides atomic attribute read/write and atomic `int` (BitSet)
mutation. Contention matters, races don't.

- **DepRecord field writes** under tier-3 handler: atomic; safe.
- **Singleton `on_message`**: stateless, no shared mutable state; safe.
- **Batch drain queues**: TLS per thread; no inter-thread race.
- **`_paused`/`_pending_wave` flag flip**: atomic bool write; safe.
- **`replay_buf` deque append+iterate**: thread holds subgraph RLock
  during `subscribe()` and `_down`, so append and read can't interleave.

**Verdict: no new locking required.** Existing subgraph RLock covers
all DepRecord mutations trivially.

#### Mode B — Free-threaded CPython (3.13t+, 3.14 GA)

No GIL → every mutable access needs a declared owner. CLAUDE.md says
PY has `per-subgraph RLock` + `per-node _cache_lock`. Both survive v5:

- **DepRecord array mutation**: must happen under subgraph RLock. The
  existing `_handle_dep_messages` path already acquires it; the
  rewrite must preserve that acquisition point.
- **`_cache_lock` scope widens slightly**: all `_cached` writes (now
  routed through `actions.emit(v)` inside `_exec_fn`) must hold
  `_cache_lock`. Current code acquires it in `get()` reads and in
  `_down_auto_value`; under v5 `_down_auto_value` is gone, so the
  acquisition point moves into `actions.emit(v)`. Must verify every
  emit site holds or acquires the lock.
- **Singleton config freeze**: `_config_frozen: bool` module-level flag
  protected by a module-level lock. First-node creation flips the
  flag. Subsequent `configure_graphrefly(...)` raises.
- **`MessageTypeRegistry` post-freeze reads**: lock-free dict reads
  are safe once frozen (no mutation → no race). Treat the registry
  as immutable after import-time registration.
- **`_dep_index_map` (dynamicNode)**: dict written only during
  construction and during `_rewire()` inside `_exec_fn` (subgraph lock
  held). Safe.
- **`@property cache`**: replaces current `get()` method. Reading
  `_cached` must still take `_cache_lock` in free-threaded mode.
  Property body is 3 lines (acquire, read, release) — negligible cost.

**Verdict: free-threaded mode fits with existing locks.** Net-new
lock count: zero. Net-new lock *acquisition sites*: ~3 (the new
emit path, `actions.emit`, the replay buffer append). All bounded.

#### Mode C — Asyncio / non-blocking via `compat/`

PY's async strategy is hermetic: public reactive API is sync, async
boundary lives in sources (`from_awaitable`, `from_async_iter`) and
the `Runner` protocol in `core/runner.py`.

- **Async source emission**: `AsyncioRunner.schedule(coro, on_result, on_error)`
  uses `loop.call_soon_threadsafe(_create_task)`. `on_result` fires on
  the event-loop thread and calls `node.down([[DATA, v]])`. Under v5
  this goes through `_emit` → singleton tier-3 handler → `_exec_fn` on
  that thread. Subgraph RLock must be acquired — same as current
  behaviour.
- **Deadlock detection**: `AsyncioRunner.would_block_deadlock()`
  already flags the "reactive thread blocks on event loop" anti-pattern.
  No v5 impact.
- **`cancellation.py`** integrates with `fn` cleanup: async sources
  return a cleanup function that calls `token.cancel()`. Under v5
  (fn return is cleanup-only) this contract is *cleaner*, not
  broken — needs a regression test but no design change.
- **`with batch():` across async boundary**: `_batch_tls` is
  thread-local, but an awaited coroutine may resume on a different
  worker thread. Current `protocol.py` does not span `await` across
  batch boundaries (batch is synchronous). Invariant #3 (no bare
  awaitables in reactive layer) keeps this safe. **Preserve.**

**Verdict: asyncio mode fits.** All async→reactive transitions already
marshal through `Runner` + subgraph RLock. v5 does not perturb the
boundary.

### §9.3 — Stress-test matrix (PY-specific adversarial)

| # | Scenario | GIL | Free-threaded | Asyncio | Verdict |
|---|---|---|---|---|---|
| S1 | Concurrent diamond A→B, A→C, B+C→D; two threads both call `A.down(...)` | PASS | PASS | PASS | Subgraph RLock serialises both threads' `_handle_dep_messages`. DepRecord updates are lock-held. |
| S2 | Asyncio source fan-out: `from_awaitable` resolves on event-loop thread | PASS | PASS | PASS | `Runner` marshals to reactive thread; subgraph lock acquired before `_emit`. |
| S3 | Free-threaded `replayBuffer`: writer on emit, reader during subscribe | PASS | PASS | PASS | Both paths under subgraph RLock. `deque(maxlen=N)` append/iter are safe under the lock. |
| S4 | Singleton handler reentry: fn's `actions.emit(v)` triggers downstream `_on_dep_message` on same thread | PASS | PASS | PASS | Singleton is stateless/reentrant. Subgraph RLock is RLock, so same-thread re-entry works. |
| S5 | `dynamicNode` `_dep_index_map` mutation during `_rewire()` | PASS | PASS | PASS | `_rewire()` is only called from inside `_exec_fn` under subgraph lock. No concurrent iterator. |
| S6 | `@property cache` concurrent reader + mutator | PASS | PASS | PASS | `_cache_lock` guards both read (existing) and emit (v5 must preserve). |
| S7 | Asyncio task cancelled mid-fn-execution | PASS | PASS | **FLAG** | New fn-cleanup contract must capture `token.cancel()` in the returned cleanup. Not a blocker; needs regression test. |
| S8 | `with batch():` nested across threads | PASS | PASS | PASS | `_batch_tls` is thread-local; each thread independently nests. RLock-based re-entrance handles same-thread nesting. |

**7 PASS / 1 FLAG (S7 — informational).** No blockers for the port.

### §9.4 — PY-specific friction points

1. **`MessageType` StrEnum → `MessageType | str` widening** is a
   prerequisite, not a follow-up. `MessageTypeRegistry` cannot register
   user types until the type alias accepts arbitrary strings/symbols.
2. **`protocol.py` split**: not a 1:1 port of TS `messages.ts`. v5
   needs `messages.py` (types + tiers + registry) separated from
   `batch.py` (drain + TLS). The subgraph-lock defer wrapper
   (`_wrap_deferred_subgraph`) stays with batch.py.
3. **`_cache_lock` audit**: under v4 the lock is held during `get()`
   read and `_down_auto_value`. Under v5 the emit path is
   `actions.emit(v) → _emit(msgs)`, and `_emit` must hold `_cache_lock`
   while updating `_cached` + `_status`. Every emit call site needs
   an audit pass — not difficult, but easy to miss one.
4. **`subgraph_locks.py` interaction**: DepRecord mutation sites must
   be inside the write-lock region. Currently `_handle_dep_messages`
   holds the lock; preserve.
5. **`@property cache` replaces `get()` method**: external callers
   switch `node.get()` → `node.cache`. All `describe_node`/
   `meta_snapshot` call sites in `meta.py` update. Internal code
   never reads cache at all (P3).
6. **pytest fixture isolation**: singleton config freeze + module-level
   `_config_frozen` flag will fight test isolation unless a
   `conftest.py` fixture resets it between tests. Needs explicit
   test-isolation fixture for `configure_graphrefly`.
7. **`bridge.py` deletion**: PY has active call sites — must rewrite
   each to `effect([from], fn)` before deleting the module.
8. **`dynamic_node.py` deletion**: 382 lines collapse to ~20 lines
   of `NodeImpl` `track()` proxy + a factory in `sugar.py`. Largest
   single-file deletion in the port.
9. **No `Object.freeze` equivalent**: singleton config freeze is a
   runtime check (`_config_frozen` flag), not a language guarantee.
   Document the convention clearly.
10. **`actions` closure capture**: Python captures `self` cheaply;
    building `self._actions` once in `__init__` is idiomatic. No
    gotcha.

### §9.5 — PY implementation plan (ordered)

Staged to match TS §8.5 rollout *shape* but adapted for PY-specific
files. Each phase leaves the test suite runnable.

**Phase P0 — Prep (no behavior change)**

1. Widen `MessageType` from `StrEnum` to `MessageType | str` in
   `protocol.py`. Add normalization helper. Keep existing enum values;
   add fallback tier (tier 1) for unknown types.
2. Split `protocol.py` into:
   - `messages.py` — message type constants, `message_tier()`,
     `propagates_to_meta()`, `is_local_only()`, `MessageTypeRegistry`.
   - `batch.py` — `_BatchState`, `_batch_tls`, `down_with_batch`,
     drain, `_wrap_deferred_subgraph`.
3. Introduce `configure_graphrefly(fn)` module-level API with
   `_config_frozen: bool` guarded by a module lock. First node
   creation flips the flag. Add pytest `conftest.py` fixture that
   resets it between tests.
4. Add `TypedDict DepRecord` alongside existing state (not yet used).

**Phase P1 — DepRecord consolidation (`node_base.py` + `node.py`)**

5. Merge `node_base.py` into `node.py` as single `NodeImpl` class.
   Delete `node_base.py`. Keep all abstract-hook logic inlined.
6. Replace 4 BitSets + `_last_dep_values` + `_upstream_unsubs` with
   `self._dep_records: list[DepRecord]`. Migrate
   `_handle_dep_messages`, `_connect_upstream`, `_maybe_complete_from_deps`,
   `_on_dep_dirty`, `_on_dep_settled` to operate on DepRecord.
7. Rename `_run_fn_body` → `_exec_fn`. Change calling convention:
   `fn(latest_data, actions, ctx)` where `ctx` is `FnCtx` v6
   (`data_from`, `terminal_deps`). Sugar constructors in `sugar.py`
   wrap user fn with `actions.emit(user_fn(data))`.
8. **`_cache_lock` audit**: ensure every path that writes `_cached`
   or `_status` holds the lock (now includes the singleton tier-3
   emit path).

**Phase P2 — Singleton protocol handlers**

9. Move per-node `_on_message` logic into module-level singleton
   handlers keyed by tier. Preserve the pre-default-dispatch
   interception point as a *module-configurable* hook, not per-node.
10. Singleton default `on_subscribe` handles START + cached DATA +
    replay buffer delivery. Replace current `subscribe()` ceremony.
11. Implement `actions` object built once in `__init__`:
    `emit`, `down`, `up`, `bundle`. `emit` runs equals + DIRTY
    prefix via default bundle, then `_emit(msgs)`.

**Phase P3 — dynamicNode collapse**

12. Delete `dynamic_node.py` (382 lines). Add `_dep_index_map:
    dict[Node, int] | None` and `_is_dynamic: bool` fields to
    `NodeImpl`. Implement `track(dep)` proxy reading
    `self._dep_records[self._dep_index_map[dep]].latest_data`.
13. Add `dynamic_node()` factory in `sugar.py`.
14. Delete rewire buffer, `MAX_RERUN`, `_tracked_values`,
    `_dep_values_differ_from_tracked`. Verify `_rewire()` paths
    are all under subgraph lock.

**Phase P4 — Operators + sources rewrite (`extra/tier1.py`, `tier2.py`, `sources.py`)**

15. Rewrite all operators to fn + closure, matching the TS §4
    category table. Fix P3 violations in `take`, `with_latest_from`,
    `valve` by reading from `latest_data` arg.
16. `reduce`, `takeWhile`, `last` use `terminal_deps` from ctx.
17. Convert producers (`from_timer`, `from_cron`, `from_event`,
    `from_awaitable`, `from_async_iter`, `from_iter`, `of`,
    `empty`, `never`) to v5 producer pattern: fn runs once on
    activation, captures `actions`, returns cleanup.
18. Replace `replay()` / `wrap_subscribe_hook` with `replay_buffer: int`
    node option. Delete `wrap_subscribe_hook`. `cached(source)` =
    `replay(source, 1)`.

**Phase P5 — `.get()` → `.cache` rename**

19. Add `@property cache` on `NodeImpl` (holds `_cache_lock` in
    free-threaded build). Delete `get()` method.
20. Update `meta.py` — `describe_node`, `meta_snapshot` use
    `node.cache` + `node.status == "sentinel"`. Drop
    `DynamicNodeImpl` instanceof and `_manual_emit_used` probes.
21. Update all PY tests and docs calling `node.get()`.

**Phase P6 — PAUSE/RESUME promotion**

22. Add `_paused: bool`, `_pending_wave: bool` to `NodeImpl`.
    Singleton tier-2 handler sets/clears. Wave completion skips
    `_exec_fn` when paused. On RESUME, check `_pending_wave` and
    flush.
23. Add `pausable: bool | 'resume_all'` option. Delete the
    standalone `pausable()` operator.

**Phase P7 — Cleanup: `bridge.py` deletion + subgraph-lock audit**

24. Rewrite every call site of `bridge()` to
    `effect([from], lambda data, actions, ctx: to.down(...))`.
    Delete `core/bridge.py`. Document the narrowing (no PAUSE/
    RESUME/INVALIDATE forwarding — matches TS §3.8 Q3).
25. Full audit of subgraph RLock acquisition sites: tier handlers,
    `_emit`, `_exec_fn`, `_deactivate`, `subscribe` activation
    path. Confirm no DepRecord mutation escapes the lock.
26. Confirm `cancellation.py` integration: async source cleanup
    (`token.cancel()`) fires via fn-return cleanup. Add regression
    test for S7 (asyncio task cancelled mid-fn).

**Phase P8 — Test isolation + thread-safety regression**

27. `conftest.py`: reset `_config_frozen` and `_batch_tls` between
    tests via autouse fixture.
28. Free-threaded mode smoke test (gated on Python 3.13t+/3.14):
    concurrent diamond, concurrent `replay_buffer` read/write,
    `_dep_index_map` mutation under contention.
29. Asyncio regression suite: `from_awaitable` cancellation,
    deadlock detection, batch + event-loop interleaving.

**Net PY file impact:** 3 deletions (`node_base.py`, `dynamic_node.py`,
`bridge.py` — ~1268 lines), 2 new files (`messages.py`, `batch.py`
split from `protocol.py`), 4 rewrites (`node.py`, `sugar.py`,
`meta.py`, `extra/tier1.py`+`tier2.py`+`sources.py`), 4 untouched
(`subgraph_locks.py`, `runner.py`, `cancellation.py`, `versioning.py`).

### §9.6 — PY parity call-outs (differences from TS, intentional)

- **Batch state is TLS** (`_batch_tls`) in PY vs call-stack in TS.
  PY's model is free-thread-safe for free. Preserve.
- **`with batch():` context manager** stays, not `batch(fn)` callable.
  Same semantics via `__enter__`/`__exit__`.
- **`|` pipe operator** (`Node.__or__`) maps to TS `pipe()`. No change.
- **Unlimited-precision `int` bitmask** (if any bitmask survives v5
  for local wave-counter tricks): keep; cheap under both GIL and
  free-threaded.
- **No `async def` in public API** — invariant #3. v5 does not perturb.
- **Singleton config freeze-on-first-node** uses runtime check (no
  language-level freeze). Document in `core/__init__.py`.

### §9.7 — Open questions — resolved (2026-04-11)

- **OQ1 — `configure_graphrefly()` scope: MODULE-LEVEL.** Singleton
  protocol story stays intact. Pytest isolation handled by an
  autouse `conftest.py` fixture that resets `_config_frozen` +
  `_batch_tls` between tests (Phase P8 step 27).
- **OQ2 — Per-node bundle override: MATCH TS → NO.** Correction to
  prior claim: TS v5 (line 487, SUPERSEDES v4) explicitly states
  "No per-node `bundle` / `onMessage` / `onSubscribe`". The
  references at line 668 / 1146 are from archived v4 proposal and
  early §2 iteration, *not* v5. `bundle` lives exclusively in the
  global singleton config. PY ports the same: no per-node
  `opts.bundle` in `NodeOptions`. Users who need custom framing
  configure the singleton at app init.
- **OQ3 — `cancellation.py` reactive binding: GROW.** `cancellation.py`
  gains a reactive surface (a cancellation node / reactive token
  binding) so that cancellation can flow through the graph as
  protocol messages, not only live at async boundaries. Exact shape
  designed during Phase P7 step 26. Reactive cancellation is
  first-class, not a domain-layer afterthought.
- **OQ4 — Per-record lock vs subgraph lock: NO per-record lock.**
  DepRecord mutations stay under the coarser subgraph write lock.
  Simpler, sufficient, and avoids multiplying acquisition cost
  during wave settlement. Subgraph lock is already held by
  `_handle_dep_messages`; no new locks introduced.

### §9.8 — Equals substitution as dispatch-layer invariant (TS 2026-04-12 — PY parity deferred)

**TS landed 2026-04-12.** Equals substitution was moved from `_actionEmit` into `_updateState` so that every outgoing DATA payload — from `actions.emit`, raw `actions.down([[DATA, v]])`, bundle-wrapped down, and passthrough forwarding — runs through a single equals-vs-live-cache walk. `.cache` advances progressively per tier-3 message in a batch. Substitution that would produce a lonely RESOLVED without a prior DIRTY synthesizes a `[DIRTY]` prefix to stay §1.3.1 compliant. Equals-throw mid-batch delivers the successfully-walked prefix before emitting ERROR. See §3.5.1–.2 for details and `src/core/node.ts:_emit` / `_updateState` for the impl.

**PY status: parity item, not yet landed.** `~/src/graphrefly-py/src/graphrefly/core/node_base.py` still runs equals inside `_down_auto_value` (snapshot-at-entry per-call semantics), and raw `down` does NOT participate in equals substitution. This matches TS's pre-2026-04-12 behavior. PY has not yet executed the foundation redesign (the "fn return is cleanup only" rewrite of §7), so the refactor site doesn't exist there yet.

**When PY lands the foundation redesign** (see §9.5 PY implementation plan), port the TS invariant verbatim:

1. Move equals substitution out of `_down_auto_value` / any emit-sugar site and into the PY equivalent of `_update_state` (the dispatch-layer walk).
2. Apply it uniformly across `actions.emit`, raw `actions.down`, passthrough forwarding, and any bundle-wrapped down path.
3. Implement the synthetic-DIRTY prefix rule (§3.5.1) so substitution from a non-dirty wave stays §1.3.1 compliant.
4. Implement the equals-throw atomicity contract (§3.5.1): deliver walked prefix before emitting ERROR, return `(final_messages, equals_error)` from `_update_state`.
5. Port the `§3.5 equals substitution — dispatch-layer invariant` test block from `src/__tests__/core/node.test.ts` (TS) to `tests/core/test_node.py` (PY), adjusting for Python conventions.

**Why defer rather than patch both now:** PY hasn't deleted auto-framing, so there's no unified `_emit` → `_update_state` surface to patch yet. Trying to land this in PY before the foundation redesign would require porting the refactor first. Track as one atomic parity item that ships alongside the PY foundation rewrite.

**Parity tracker line:** add to `docs/optimizations.md` under "Active work items" as `[py-parity-equals-dispatch-invariant]`.

---

## §10 — TS implementation log (2026-04-11)

Session doc is the spec. Tests migrate to the new surface; tests do not
dictate the surface.

### §10.1 — Phase CORE completed pass 1 (shimmed)

First pass of Phase CORE landed with several compromises made to keep the
test surface green. User rejected the compromises ("no shim, no legacy,
it's pre-1.0"). Everything below was reverted in pass 2.

**Shims introduced (now being removed):**

1. **`NodeOptions.onMessage` + `_onMessage` field** — re-added as a
   "migration escape hatch" so the 31 `onMessage`-using operators in
   `src/extra/operators.ts` kept compiling. Violates §1 P6 and line 487.
2. **`NodeOptions.onResubscribe` + `_onResubscribe` field** — re-added
   for resubscribable operators (reduce, takeUntil, take) that reset
   closure state on terminal reset. Violates §3.8 Q4 ("dropped from
   FnCtx; reset is a lifecycle concern").
3. **`NodeFn` auto-emission of non-function, non-undefined returns** in
   `_execFn` — violates §7 Scenario 4 decision ("fn return is cleanup
   only — SUPERSEDES earlier design"). Added because existing tests and
   most operators used value-returning fns via `node(deps, fn)`.
4. **`NodeDescribeKind` kept `"operator"`** — violates §3.7 decision to
   collapse to 4 values. Kept because `operatorOpts()` in `operators.ts`
   set `describeKind: "operator"` everywhere.

**Internal fields I added that are NOT in §8.4 (flagged per invariant):**

- `_hasDeps` — derived cache for `_deps.length > 0`. Not in plan. Inline.
- `_isProducer` — derived cache for `!_hasDeps && _fn != null`. Inline.
- `_depRecords: DepRecord[]` kept separately from `_deps: readonly
  Node[]`. §8.2 says "Node has ONE dep-related property: `_deps:
  DepRecord[]`" — merge into single array.
- `_terminal: boolean` — §8.3 says DELETE (derive from `_status`). I
  kept it as a field. REMOVE.
- `_active: boolean` — §8.3 says DELETE (guard via `unsub != null`). I
  kept it. REMOVE.
- `_replayCap: number` — not in plan. Fold into the circular buffer's
  own capacity field.
- `_boundDeliver` — bound closure for `downWithBatch` callback, not in
  plan. Use arrow binding at call site.
- `_dispatch` method — §8.4 calls the unified pipeline `_emit(msgs)`.
  Rename `_dispatch("down"|"up", msgs)` → `_emit(msgs)` per plan.
- `_connectDeps` / `_disconnectDeps` helpers — not in §8.4 method list.
  Inline into `_activate` / `_deactivate`.

**Flagged but keeping (used by graph/ internals, pending a cleaner
interface):**

- `_assignRegistryName(localName)` — `Graph.add` assigns a registry name
  when options don't include one. §8.4 doesn't list it. Keep until
  `graph/` is rewritten.
- `_applyVersioning(level, opts)` — `Graph.setVersioning()` retroactive
  apply. §8.4 doesn't list it. Keep until `graph/` is rewritten.
- `_setInspectorHook(hook)` — `observe()` in `graph/` plumbs an
  inspector hook for observability. Plan lists `_inspectorHook` field
  but not the accessor. Keep until `graph/` is rewritten.

### §10.2 — Correctness flags raised for next session

1. **`downWithBatch` requires pre-sorted input.** v5.1 says "emissions
   arrive pre-sorted from `bundle.resolve()`". Pass 1 never implemented
   `bundle`, so all emission paths handed raw arrays to `downWithBatch`.
   Pass 2 implements `bundle` as singleton + routes emission through it.
2. **Gate-closed branch in `_checkWaveCompletion` clears
   `receivedDataThisWave` prematurely.** If dep A delivered DATA in a
   wave but dep B is still SENTINEL, the gate stays closed and fn
   doesn't run — but clearing A's flag means when B later delivers DATA,
   fn sees `ctx.dataFrom[A] = false`. Fix: keep flags until fn actually
   runs.
3. **ERROR early-return in `_onDepMessage`** drops remaining messages in
   the same batch after ERROR. Old code continued. Behavior drift — low
   impact since ERROR is terminal, but worth confirming.
4. **Passthrough (`_fn == null` with deps) branch** in `_onDepMessage`
   is a minimal shim that forwards dep messages 1:1. §8 Scenario D
   ("Passthrough") PASSes in the stress test. Pass 2: either make it a
   proper first-class mode or drop it and require users to write an
   identity `derived`. Decision: keep first-class (rare but real).
5. **Meta TEARDOWN re-entrancy.** `_propagateToMeta(TEARDOWN)` calls
   `_emit([[TEARDOWN]])` on each meta child while the parent is
   mid-`_updateState`. Fragile. **Open item — address next session.**

### §10.3 — Tests trashed in pass 1 (restoring in pass 2)

Without flag + approval. The following were moved to `TRASH/` and must
be rewritten against the v5 surface:

- `src/__tests__/core/bridge.test.ts` — `bridge()` is deleted, but its
  test cases (message-type forwarding, terminal-state transition on
  COMPLETE/ERROR, unknown-type forwarding) map to `effect([from], ...)`
  + singleton dispatch. **REWRITE** as `effect-forwarding.test.ts`.
- `src/__tests__/core/on-message.test.ts` — per-node `onMessage` hook
  removed. Scenarios it covered (custom message type propagation,
  consumed messages not forwarded, depIndex routing, diamond settlement
  with a custom tier-3 type) are real user features of the singleton
  dispatch. **REWRITE** as `custom-message-types.test.ts` using
  `configureGraphReFly` + `registerMessageType`.
- `src/__tests__/core/dynamic-node.test.ts` — `DynamicNodeImpl` deleted,
  `dynamicNode()` is now sugar. **REWRITE** to cover the v5 track proxy,
  superset wave absorption via `equals`, P3 compliance (no cross-node
  reads).
- `src/__tests__/core/semantic-audit.test.ts` — 48 tests covering
  first-subscriber push semantics, diamond resolution, dep mask
  correctness, dynamicNode lifecycle. The new architecture should
  satisfy the *intent* of every test. **REWRITE** against the v5
  mechanics (DepRecord, `_checkWaveCompletion`, bundle).

### §10.4 — Pass 2 plan (strict alignment)

Order:

1. Strip all 4 shims from `src/core/node.ts`, `messages.ts`, `index.ts`.
2. Collapse internal field list to §8.4 (delete `_terminal`, `_active`,
   `_hasDeps`, `_isProducer`, `_depRecords`/merge, `_replayCap`,
   `_boundDeliver`). Rename `_dispatch` → `_emit`. Inline `_connectDeps`
   / `_disconnectDeps`.
3. Implement `defaultBundle` as the central framing function, wired
   into `configureGraphReFly` via `GraphReFlyConfig.bundle`. All
   emission paths call `bundle(...).resolve()` before `downWithBatch`.
   `downWithBatch` retains the "walk pre-sorted array, split at phase
   boundary" algorithm (no re-sort inside).
4. Rewrite all 31 operators in `src/extra/operators.ts` to the fn-only
   contract per §4 category table. Fix the P3 violations in `take`,
   `withLatestFrom`, `valve`.
5. Rewrite `bridge.test.ts`, `on-message.test.ts`, `dynamic-node.test.ts`,
   `semantic-audit.test.ts` against the new surface.
6. Update `node.test.ts` / `sugar.test.ts` to use `derived(...)` for
   value-returning compositions instead of `node([deps], valueFn)`.
7. Fix the 9 previously-failing extra tests (composite distill
   eviction is the only one being deferred per user direction — it
   requires store mutation events, a larger design change).

### §10.5 — Explicit follow-ups (open items, deferred)

> **Status revalidated 2026-04-17.** All four items below resolved or intentionally deferred. See `archive/optimizations/resolved-decisions.jsonl` for landing entries.

- ~~**composite.ts eviction rewrite.**~~ **RESOLVED 2026-04-17** (`distill-eviction-p3-cleanup`) — replaced per-entry verdict-node pattern with factory-time-seed pattern (closure snapshot of `store.entries.cache`, subscribe handler keeps current). Full store-mutation-events redesign folded into a single post-1.0 "snapshot delivery" session per `docs/optimizations.md` § "Store-mutation-events protocol".
- ~~**graph/ + patterns/ + compat/ drift** (~33 typecheck errors).~~ **RESOLVED** — `tsc --noEmit` clean; 1641 tests pass.
- **PY parity** (§9 P0–P8). **Intentionally deprioritized** per `docs/optimizations.md` line 7 (rigor infrastructure Projects 1–3 must land first; trace-format approach replaces quarterly parity audits).
- ~~**Meta TEARDOWN re-entrancy audit** (§10.2 flag 5).~~ **RESOLVED 2026-04-12** (`meta-teardown-reentrance-fix`).

---

## §10.6 — Pass 2 refinements (2026-04-11, live session)

Clarifying decisions layered on top of §1–§9 as the TS rewrite proceeds.
These SUPERSEDE the corresponding earlier sections where they conflict.

### 10.6.1 — `ctx.store` replaces factory / afterResubscribe for persistent state

**Supersedes** §3.8 Q4, §4 FnCtx v6, §6 resubscribe-reset handling.

Closure state that must survive across fn re-runs (reduce accumulator,
takeWhile done flag, bufferCount buffer) lives in a framework-managed
per-node bag exposed on `FnCtx`:

```ts
interface FnCtx {
  dataFrom: readonly boolean[];
  terminalDeps: readonly (true | unknown)[];
  store: Record<string, unknown>;
}
```

**Store lifecycle:**
- A fresh empty object is created once per activation cycle.
- Persists across fn re-runs within the cycle.
- Wiped on deactivation AND on resubscribable terminal reset.

**Cleanup return shape (two-shape union, not a factory):**
- `() => void` — default, fires before every next fn run AND on deactivation
  (RxJS/useEffect semantics).
- `{ deactivation: () => void }` — opt-in, fires ONLY on deactivation. For
  long-lived resources that should not be rebuilt between runs.

Factory `fn: () => (data, actions, ctx) => ...` was considered and rejected
as an RxJS/callbag DX divergence that LLM code-gen would stumble on.
`ctx.store` + dual cleanup covers the same ground without changing fn arity.

**Reduce under this shape:**
```ts
const reduce = (src, reducer, initial) => derived([src], (data, actions, ctx) => {
  ctx.store.acc ??= initial;
  ctx.store.acc = reducer(ctx.store.acc, data[0]);
  if (ctx.terminalDeps[0]) actions.emit(ctx.store.acc);
});
```

### 10.6.2 — `GraphReFlyConfig` class + `configure` (not `configureGraphReFly`)

**Supersedes** §5 singleton sketch, §10.4 step 3.

Module-global mutable `Map` rejected. Instead: `GraphReFlyConfig` class with
**getter-based auto-freeze** on `bundle` / `onMessage` / `onSubscribe`. First
read of any hook flips `_frozen = true`; subsequent setter or
`registerMessageType` calls throw. Registry reads (`messageTier`,
`isLocalOnly`, `isKnownMessageType`) are free lookups that do NOT freeze.

**Public name: `configure`** (matches spec §2 example, not session doc's
`configureGraphReFly`).

**File layout (pass 2 final):**
- `core/messages.ts` — shrunk: symbols + `Message`/`Messages` types +
  `MessageTypeRegistration` / `MessageTypeRegistrationInput` interfaces.
  No registry. No free-function tier lookups. No
  `propagatesToMeta` / `isPhase2Message` / `isTerminalMessage` helpers
  (removed until re-needed; all derivable from
  `config.messageTier(t) === N`).
- `core/config.ts` — NEW. `GraphReFlyConfig` class + handler type shapes
  (`NodeCtx`, `NodeActions`, `MessageContext`, `SubscribeContext`, `Bundle`,
  `BundleFactory`, `OnMessageHandler`, `OnSubscribeHandler`) + `registerBuiltins`
  helper. Imports ONLY from `messages.ts`. Zero references to `NodeImpl`.
- `core/node.ts` — imports `GraphReFlyConfig` + `registerBuiltins` from
  `config.ts`. Owns concrete `defaultBundle` / `defaultOnMessage` /
  `defaultOnSubscribe` (they need NodeImpl internals). Constructs
  `defaultConfig = new GraphReFlyConfig({...})`, calls `registerBuiltins`,
  exports `defaultConfig` and `configure(fn)`.

Tree-shakability preserved: `import { configure }` pulls node.ts (which
anyone using primitives already pulls); `import { GraphReFlyConfig }` pulls
config.ts only. `extra/` imports nothing new.

### 10.6.3 — `opts.config` replaces 4th constructor arg

**Supersedes** "4th argument" phrasing in the pass 2 plan.

Isolated instances are passed through `NodeOptions.config?: GraphReFlyConfig`.
Sugar signatures stay `(deps, fn, opts?)`. NodeImpl constructor reads
`opts.config ?? defaultConfig` and touches one hook getter to trigger freeze.

### 10.6.4 — Removed (not deferred) internal accessors

Per user direction: clean the surface now, revisit in the graph/ redesign.
These are DELETED from `NodeImpl`:

- ~~`_inspectorHook` / `_setInspectorHook()`~~ **RESOLVED** — restored as per-node `_setInspectorHook` per §10.6.11 (`add-dep-reentrance-guard`). `Graph.observe(path, { causal, derived })` reattached. Global-inspection variant remains as Flag B below.
- ~~`_applyVersioning(level, opts)`~~ **RESOLVED 2026-04-13** (`retroactive-apply-versioning-config-defaults`) — `_applyVersioning` restored alongside `GraphReFlyConfig.defaultVersioning` and `defaultHashFn`. Versioning can be applied retroactively via `Graph.setVersioning()` and config-driven defaults exist.
- ~~`_assignRegistryName(localName)`~~ **RESOLVED BY DESIGN 2026-04-17** — name assignment is construction-time only (`state(0, { name: "counter" })`). The post-hoc-mutation follow-up was rejected; tests reflecting the old behavior were deleted.

Callers in `graph/` were redesigned as part of the graph-module 24-unit review (see `SESSION-graph-module-24-unit-review.md`).

### 10.6.6 — Benchmark results (v5 redesign vs pre-redesign baseline)

**Date:** 2026-04-11
**Environment:** macOS, Node.js, Vitest bench with Tinybench
**Baseline:** `benchmarks/vitest-baseline.json` (pre-redesign, same machine)

| Benchmark | v5 ops/sec | Baseline ops/sec | Speedup |
|-----------|-----------|-----------------|---------|
| state: read (`.cache`) | 34,949K | — | (API changed, no baseline) |
| state: write (no subscribers) | 5,460K | — | (API changed) |
| state: write (with subscriber) | 5,198K | — | (API changed) |
| derived: single-dep | 1,805K | — | (API changed) |
| derived: multi-dep | 1,750K | — | (API changed) |
| derived: cached read | 35,047K | — | (API changed) |
| diamond: flat (A→B,C→D) | 680K | 564K | **1.14x** ⇑ |
| diamond: deep (5 levels) | 380K | — | — |
| diamond: wide (10 intermediates) | 184K | — | — |
| effect: single dep re-run | 5,368K | 3,919K | **1.32x** ⇑ |
| effect: multi-dep (diamond) | 674K | 581K | **1.12x** ⇑ |
| fan-out: 10 subscribers | 3,251K | 2,640K | **1.17x** ⇑ |
| fan-out: 100 subscribers | 776K | 726K | **1.05x** ⇑ |
| batch: unbatched (10 sets) | 161K | 134K | **1.15x** ⇑ |
| batch: batched (10 sets) | 291K | 208K | **1.33x** ⇑ |
| equals: without | 674K | 564K | **1.14x** ⇑ |
| equals: with (subtree skip) | 665K | 575K | **1.10x** ⇑ |
| linear 10-node chain | 272K | 208K | **1.23x** ⇑ |
| fan-in batch (2 sources) | 1,046K | 824K | **1.21x** ⇑ |

**Key takeaway:** Every comparable benchmark improved 1.05x–1.33x without single-dep
optimization. The unified `NodeImpl` + `DepRecord[]` + config singleton design
reduces per-message overhead across the board. Batch and effect paths benefit most
(1.32–1.33x) from the elimination of `DownStrategy` dispatch and flattened
`_onDepMessage` → `_recompute` path.

**Note:** `equals` with subtree skip shows ~1.01x vs without in the same run because
the bench increments values (never unchanged). The `equals` benefit only manifests
when the fn output is unchanged — that path correctly emits RESOLVED and skips
downstream fn re-runs.

---

### 10.6.5 — File-by-file progress tracker

> **All items complete as of 2026-04-17.** Verified: `tsc --noEmit` clean; 1641 tests pass; `node-base.ts`, `dynamic-node.ts`, `bridge.ts` no longer exist on disk.

- [x] `messages.ts` — shrunk.
- [x] `config.ts` — new, class + handlers + registerBuiltins.
- [x] `batch.ts` — drainPhase2/3/4 rename, pre-sorted walk, TEARDOWN
      deferred to phase 4, delete `DownStrategy` / `partitionForBatch` /
      `_downSequential`.
- [x] `node.ts` — consolidated NodeImpl + DepRecord + actions +
      defaultConfig + configure + defaults.
- [x] `node-base.ts` — DELETED.
- [x] `dynamic-node.ts` — DELETED (autoTrackNode lives in sugar.ts).
- [x] `bridge.ts` — DELETED.
- [x] `sugar.ts` — rewritten.
- [x] `meta.ts` — rewritten.
- [x] `index.ts` — pruned.
- [x] `src/__tests__/core/` — passing.
- [x] `src/extra/operators.ts` — rewritten (Wave 1 + Wave 2 audits landed).
- [x] `src/extra/sources.ts` — rewritten.
- [x] `src/__tests__/extra/` — passing.
- [x] `src/graph/` + `src/patterns/` + `src/compat/` — drift fixed.


### 10.6.6 — Two-phase invariant: transitions only, not activation

Activation-wave emissions (RESOLVED from accumulating operators like `last`,
`reduce`, `toArray` during subscribe ceremony) do NOT require preceding DIRTY.
Two-phase (DIRTY → DATA/RESOLVED) applies to **state transitions** only.
Spec §2.2 already exempts START handshake from DIRTY. Activation RESOLVED
is analogous — "I started up, no value yet."

Terminal-emission operators (`last`, `reduce`, `toArray`) emit nothing during
accumulation waves. They stay silent until COMPLETE, then emit `[DIRTY, DATA,
COMPLETE]`. Downstream's pre-set-dirty DepRecord holds the wave open naturally.

### 10.6.7 — autoError split from autoComplete

`completeWhenDepsComplete: false` suppresses auto-COMPLETE only. ERROR always
propagates unless `errorWhenDepsError: false` (rescue pattern). This fixes
operators like `take`, `reduce`, `takeWhile` that previously swallowed
upstream ERRORs.

### 10.6.8 — Producer-based operators: atomic DIRTY+DATA at emit time

Timer operators (delay, bufferTime) do NOT forward source DIRTY immediately.
`a.emit(v)` in the timer callback handles DIRTY+DATA atomically via bundle
at the delayed time. Downstream sees a clean transition, not DIRTY-now +
DATA-later.

Similarly, exhaustMap silently drops outer DATA when inner is active — no
RESOLVED emission. Producer nodes that silently drop stay silent.

### 10.6.9 — Remaining test failures (88, grouped)

> **All resolved as of 2026-04-17.** Final state: 1641 passing, 0 skipped, 0 failed. Resolution summary below.

| Category | Count | Root cause | Resolution |
|----------|-------|------------|--------|
| Graph.connect() deps enforcement | ~70 | v5 validates target has source in _deps; pattern factories wire post-construction | RESOLVED via graph-module review Unit 7 — `connect()` deleted entirely; edges derived on-demand from `_deps` + `_mounts`. Pattern factories migrated. |
| dynamicNode auto-tracking | 11 | v5 requires upfront deps; jotai/signals need runtime discovery | RESOLVED via `autoTrackNode` two-phase discovery (§10.6.10) + sentinel guard (Wave 2 BUG-F2 fix). |
| Observer hook removed | 5 | _setInspectorHook deleted | RESOLVED — restored per §10.6.11 (`add-dep-reentrance-guard`). |
| Diamond recount | 1 | Wave tracking count differs | RESOLVED (cosmetic — test expectation updated). |
| INVALIDATE cache clearing | 2 | Behavior changed | RESOLVED via `invalidate-reactive-cache-flush`. |
| _applyVersioning removed | 1 | Construction-time only | RESOLVED — `_applyVersioning` restored 2026-04-13 (`retroactive-apply-versioning-config-defaults`). |

### 10.6.10 — autoTrackNode: two-phase dep discovery

Design for Jotai/signals compat (§6 deferred item). Procedure:

1. Run fn at activation. `track(dep)` for unknown deps:
   - Record the dep in a pending list
   - Return `dep.cache` as stub (P3 boundary exception for discovery)
   - try/catch the run (stale `.cache` may cause errors)
2. After fn returns, if new deps discovered:
   - Subscribe to each new dep, add to DepRecord
   - Pre-set dirty on new deps
3. Check if all dep dirty flags cleared (some may settle synchronously
   from subscribe handshake)
4. If all settled, run fn again (real run — protocol-delivered values)
5. If re-run discovers MORE new deps, repeat from step 2
6. Converges when no new deps found — O(n) total wasted runs for n deps

P3 violation is limited to discovery runs only. Once all deps are known,
subsequent waves use protocol-delivered data exclusively.

### 10.6.11 — _addDep + inspector hook restored

**`NodeImpl._addDep(depNode: Node): number`** — post-construction dep
addition. Creates DepRecord, pre-sets dirty, subscribes immediately.
Returns dep index. Used by:
- `autoTrackNode` for runtime dep discovery (Jotai/signals compat)
- `Graph.connect()` for post-construction reactive wiring (pattern
  factories: stratify, feedback, gate, forEach, etc.)

**Re-entrance guard in `_execFn`** — `_isExecutingFn` + `_pendingRerun`
flags. If `_addDep`'s synchronous subscribe triggers DATA during fn
execution, the recursive `_execFn` call sets `_pendingRerun=true` and
returns. The `finally` block picks it up after the outer fn returns.

**`_clearWaveFlags` also runs after fn** — fixes stale `dataThisWave`
from inner `_addDep` subscribes. Previously only ran before fn (captured
the snapshot), leaving new deps' flags uncleared.

**`_setInspectorHook(hook?)`** — restored per-node inspection hook for
`Graph.observe(path, { causal, derived })`. Fires two event kinds:
- `"dep_message"` — fired in `_onDepMessage` with `{ depIndex, message }`
- `"run"` — fired in `_execFn` before fn runs with `{ depValues }`

`Graph.observe` attaches via `_setInspectorHook`, records
`lastTriggerDepIndex` (for causal) and `lastRunDepValues` (for derived),
and emits synthetic `"derived"` events into the observe timeline.

### 10.6.12 — Flags for next session

> **Status revalidated 2026-04-17.** Most flags landed; only Flag B remains as a small, unscheduled enhancement.

**Flag A: `dataFrom`-based emission suppression — edge cases — RESOLVED 2026-04-11** (`flag-a-datafrom-suppression-closed`)

Current `autoTrackNode` implementation: track which deps current fn run
accesses (via `track()`). After fn returns, if (a) no accessed dep changed
this wave AND (b) result equals cache → suppress emission entirely.

**Known cases that need review:**
1. **Grow-only deps + unused-dep updates.** When a dep is tracked
   historically but not in the current run (e.g. `useA ? a : b` switching
   branches), the unused dep still triggers fn re-runs. Emission is
   suppressed correctly, but fn still runs (wasted cycles).
2. **Apply to `dynamicNode` too.** Same mechanism should work for
   dynamicNode (upfront deps with conditional access). Needs testing to
   confirm it behaves the same way.
3. **First run + no dataFrom.** On initial activation, ctx.dataFrom is
   empty/false. `hasCompletedOnce` gate prevents false-positive
   suppression on the first run. Edge case: what if a dep delivers DATA
   during initial activation via subscribe handshake → dataFrom includes
   it → normal path → emit. Works, but needs confirmation.
4. **Inside batch, discovery takes 2 fn calls.** Deferred DATA from
   `_addDep`'s subscribe handshake means the first fn call can't complete
   discovery (allNewSettled=false). Test expectations updated, but
   document: "one extra fn call per batch-wrapped dep discovery."
5. **Pure-fn assumption.** The optimization assumes fn is pure:
   same-deps-in → same-output-out. Side-effect fns that read external
   state could incorrectly suppress.
6. **Equals exception swallowing.** If `equals` throws during the
   suppression check, we fall through to emit. Should this be flagged
   differently?

**Flag B: Observer hook use cases — per-node vs global — STILL OPEN (small)**

Per-node `_setInspectorHook` restored. Global-inspection wrapper around singleton `onMessage` (Redux-DevTools-style full-graph tracing) not yet implemented — no concrete user need has surfaced. Defer until requested.

**Flag C: Pattern layer `Graph.connect()` consumers — MOOT 2026-04-17**

`Graph.connect` / `Graph.disconnect` deleted entirely in graph-module review Unit 7. Edges derived on-demand from `_deps` + `_mounts` walk. Every pattern factory migrated to declare deps at construction time or use `_addDep` (autoTrackNode discovery). The `Graph.link` distinction is no longer relevant.

**Flag D: Reactive-layout INVALIDATE tests — RESOLVED** (`invalidate-reactive-cache-flush`)

INVALIDATE cache clearing behavior aligned across reactive-layout primitives.

**Flag E: P3 audit — `.cache` reads in fn/subscribe callbacks — RESOLVED 2026-04-17**

All 6 original sites + later additions resolved. See `docs/optimizations.md` § "P3 audit" for full landing log. Open audit set is empty.

**Flag F: Composite distill eviction — RESOLVED 2026-04-17** (`distill-eviction-p3-cleanup`)

Replaced `forEach(verdict, ...)` per-key subscription pattern with factory-time-seed pattern. Full store-mutation-events redesign folded into a single post-1.0 "snapshot delivery" session per `docs/optimizations.md`.

**Flag G: Jotai diamond recount — RESOLVED** (cosmetic — test expectation updated to match correct 1-call behavior)

### 10.6.13 — compat-layer two-way bridge invariant + autoTrackNode cleanup

**Context.** Compat layers (Jotai `atom`, TC39 `Signal.Computed`,
Nanostores `computed`, Zustand `create`) are not one-way surfaces. Each
compat object exposes `._node`, and users are expected to reach into
the native graphrefly layer when they outgrow the compat feature set.
Two-way composition is the distribution story — drop-in usage first,
then graduated adoption via `._node` without rewriting existing code.

Decided invariant: **compat layers must be first-class composable Nodes
that satisfy the full wave protocol, not just the compat-surface API.**
A downstream native `derived([compat._node, ...])` must see the same
value/cb-count semantics a pure compat subscriber sees, including
diamond resolution, equality-based RESOLVED propagation, and dep
settlement tracking.

**Bugs found and fixed.**

1. **`autoTrackNode` dataFrom suppression (`src/core/sugar.ts`).**
   An uncommitted optimization added a `return;` path that skipped
   `actions.emit` when no currently-accessed dep changed AND the result
   equaled cache. This was invisible to leaf subscribers but left
   downstream `dep.dirty` records stuck forever (no RESOLVED ever sent
   to clear the earlier DIRTY relay). A subsequent sibling-dep update
   at the downstream would hang because one dep was frozen. Fix:
   restore HEAD's simple body. `actions.emit` → `_actionEmit` already
   folds same-value results to RESOLVED via the equals check, and
   `node.ts:972`'s pre-fn skip handles transitive propagation one hop
   up. No custom state, no flags beyond `foundNew`.

2. **`_execFn` finally ordering (`src/core/node.ts:1062`).** The finally
   block called `_clearWaveFlags()` BEFORE running `_maybeRunFnOnSettlement`
   for `_pendingRerun`. This meant the rerun's settlement check saw
   `!_waveHasNewData` and hit the pre-fn skip path → emit RESOLVED
   without running fn. autoTrackNode's discovery-then-real-run pattern
   relies on `_pendingRerun` driving the second pass, and this
   ordering swallowed it. Fix: reorder finally so `_pendingRerun`
   fires first, then `_clearWaveFlags` cleans up any flags set by
   `_addDep`'s synchronous DATA handshakes. One structural change,
   no new state.

3. **Jotai primitive atom `.set` missing DIRTY prefix
   (`src/compat/jotai/index.ts:123`).** `n.down([[DATA, value]])`
   bypasses the framed emit pipeline, so `bundle()` never auto-prefixes
   `[DIRTY]`. Downstream computed atoms in a diamond fired on glitch
   values mid-wave because the legs weren't coordinating. Latent — not
   surfaced by the existing jotai test suite, which asserted only fn
   call counts and final `.get()` values, both of which are insensitive
   to mid-wave glitches. Fix: use `n.emit(value)` / `n.emit(fn(current))`
   which routes through `_actionEmit` → `bundle()` → framed delivery.

4. **Nanostores `atom` / `map` same pattern
   (`src/compat/nanostores/index.ts`).** Same latent diamond glitch.
   Same fix: switch to `n.emit`. Nanostores' documented Object.is dedup
   is now load-bearing on the node's default equals (instead of being
   a side-effect of never-emit-same-twice conventions).

5. **Zustand `setState` + initial seed same pattern
   (`src/compat/zustand/index.ts`).** Same latent diamond glitch.
   Zustand fires on every setState regardless of equality, so the
   state node is configured with `equals: () => false` (`alwaysDiffer`)
   and writes go through `s.emit(nextState)`. Framing (DIRTY prefix)
   comes from `bundle`; the "always fire" semantics come from the
   equals config.

**Invariant distilled.** Any compat-layer write path that originates
value changes must go through the framed `emit` pipeline — either
`n.emit(value)` or a manual `[[DIRTY], [DATA, value]]` shape routed
through `n.down`. Raw `n.down([[DATA, value]])` without a DIRTY prefix
is a latent diamond glitch waiting to happen the moment someone
composes the compat object into a native derived chain. This applies
to any future compat layer (Preact signals, Svelte v5 runes, etc.) and
any existing one that still uses raw `down`.

**Tests added.**

- `signals-autotrack.test.ts` — 13 scenarios focused on value + cb
  count correctness (not fn-call counts): conditional branch switching,
  downstream chain advancement, transitive skip via equality, sibling-
  dep advancement past inner no-op waves, diamonds with no-op legs,
  multi-level nested auto-tracking, multiple subscribers, subscribe-
  after-set, deep chains, bucket-style equality absorption, rapid in-
  place updates, two independent state sources, and an explicit
  two-way bridge test (native `computed._node.subscribe` observing a
  `Signal.Computed`).
- `jotai.test.ts > derived atom: diamond resolution` — rewritten to
  use a live subscriber and assert the cb-observed value sequence
  (`[31]`, not `[23, 31]`).
- `nanostores.test.ts > diamond resolution` — same treatment.
- `zustand.test.ts > two-way bridge: native diamond over
  store.node('state') resolves without glitches` — new test that builds
  a native diamond on top of the zustand state node and asserts no
  glitch values.

**What Flag A becomes.** Flag A ("dataFrom-based emission suppression —
edge cases") is now closed. The suppression block was architecturally
wrong for the two-way bridge; it will not be revisited. If a future
optimization wants to reduce duplicate fn runs, it must preserve wave
correctness — i.e., still emit RESOLVED (not nothing) on no-op waves.
The `allNewSettled` gate (save-a-fn-call-on-sync-discovery) is a
reasonable shape for such a future optimization if the extra work
accounting can be justified, but it's not currently needed — HEAD's
simple double-discovery pattern is correct and cheap enough.

---

## §11 — Batch input model (2026-04-13)

### §11.1 — Motivation

`ctx.dataFrom[i]` was a boolean: "did dep i emit DATA this wave?"
It answered presence but not content — a node that receives two rapid
DATA emissions in the same wave (e.g. `of('a', 'b')`) only saw the
last one because the dep record stored only `latestData` (scalar).

### §11.2 — New `NodeFn` signature

```ts
type NodeFn = (
  data: readonly (readonly unknown[] | undefined)[],
  actions: NodeActions,
  ctx: FnCtx,
) => NodeFnCleanup | void;
```

`data[i]` is the batch of DATA values delivered by dep i in this wave:

| `data[i]` value      | Meaning                                    |
|----------------------|--------------------------------------------|
| `undefined`          | Dep not involved this wave                 |
| `[]` (empty array)   | Dep settled RESOLVED (unchanged value)     |
| `[v1, v2, ...]`      | Dep delivered N DATA values (in order)     |

Most waves: `[v]` — a single-element array.

### §11.3 — `FnCtx.latestData` replaces `FnCtx.dataFrom`

```ts
interface FnCtx {
  latestData: readonly unknown[];   // was: dataFrom: readonly boolean[]
  terminalDeps: readonly unknown[];
  store: Record<string, unknown>;
}
```

`ctx.latestData[i]` — last DATA payload from dep i, from any prior wave.
Use as fallback when `data[i]` is `undefined` or `[]`:

```ts
const v = batch != null && batch.length > 0 ? batch.at(-1) : ctx.latestData[i];
```

### §11.4 — Sugar constructors auto-unwrap

`derived`, `effect`, and `task` receive `data: readonly unknown[]`
(one scalar per dep, already unwrapped). The sugar wrapper applies:

```ts
const data = batchData.map((batch, i) =>
  batch != null && batch.length > 0 ? batch.at(-1) : ctx.latestData[i],
);
```

Raw `node()` callers must handle the batch format themselves.

### §11.5 — New `DepRecord` fields

```ts
interface DepRecord {
  involvedThisWave: boolean;   // replaces: dataThisWave: boolean
  dataBatch: unknown[];        // new: accumulates DATA values per wave
  latestData: Cached<unknown>; // unchanged
  // ...
}
```

- `involvedThisWave` is set in `_depDirtied`, `_depSettledAsData`,
  `_depSettledAsTerminal`. Cleared in `_clearWaveFlags`.
- `dataBatch` accumulates in `_depSettledAsData`, copied (snapshot)
  in `_execFn` before `_clearWaveFlags` truncates it in-place.

### §11.6 — Inspector hook update

```ts
| { kind: "run"; batchData: readonly (readonly unknown[] | undefined)[]; latestData: readonly unknown[] }
```

`batchData` replaces `depValues` in Graph observe causal traces.

### §11.7 — Migration summary

| Old | New |
|-----|-----|
| `data[i]` (scalar) | `data[i]` (batch array or `undefined`) |
| `ctx.dataFrom[i]` (boolean) | `data[i] != null && data[i].length > 0` |
| `ctx.dataFrom` | removed — use `data[i]` batch check |
| `ctx.latestData[i]` (was `FnCtx.dataFrom` in some drafts) | `ctx.latestData[i]` (last-known scalar) |
| `DepRecord.dataThisWave` | `DepRecord.involvedThisWave` |

Files updated: `src/core/node.ts`, `src/core/sugar.ts`,
`src/extra/operators.ts`, `src/extra/sources.ts`, `src/graph/graph.ts`,
`src/patterns/orchestration.ts`, `src/patterns/cqrs.ts`,
`src/patterns/reactive-layout/reactive-layout.ts`,
`src/patterns/reactive-layout/reactive-block-layout.ts`.

### §11.8 — D1 Option B: full batch iteration in operators (2026-04-13)

**Decision (QA 2026-04-13):** Operators must iterate the **full batch**, not just `.at(-1)`. Each value in `batch0` produces an independent wave downstream. Order: dep index (natural), then time received within dep (natural array order in `dataBatch`).

**Rationale:** The pre-D1 operators used `batch0.at(-1)` — silently dropping intermediate values in a multi-value wave. This was lossy: a source that fast-batched `[1, 2, 3]` would appear as a single emission of `3` to all downstream operators.

**Implementation pattern** for single-source operators:
```typescript
const batch0 = data[0];
if (batch0 == null || batch0.length === 0) {
    a.down([[RESOLVED]]);
    return;
}
let emitted = false;
for (const v of batch0) {
    // operator-specific logic — may call a.emit(processedV)
    emitted = true;
}
if (!emitted) a.down([[RESOLVED]]);
```

Each `a.emit(v)` call sends `[DIRTY, DATA(v)]` to downstream subscribers, triggering a separate wave for each value. The downstream accumulates these into its own `dataBatch` for the next settlement.

**Operators updated:** `filter`, `scan`, `reduce`, `take`, `skip`, `takeWhile`, `tap` (fn+observer forms), `distinctUntilChanged`, `pairwise`, `withLatestFrom`, `valve` in `operators.ts`; `forEach`, `toArray` in `sources.ts`.

**`last`**: keeps `.at(-1)` — semantically correct; `last` only cares about the final value before COMPLETE.

**`_depInvalidated` dead write fix (same session):** removed the unconditional `dep.involvedThisWave = false` before the `!dep.dirty` branch. The `false` assignment was immediately overwritten by `= true` in the `!dirty` case. Now: set `involvedThisWave = true` only in `!dirty` branch; set `involvedThisWave = false` in `else` branch (cancel prior involvement for already-dirty dep).
