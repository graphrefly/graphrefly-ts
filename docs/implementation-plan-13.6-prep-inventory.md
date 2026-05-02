# Phase 13.6.A — Rules / invariants inventory (precursor)

*Compiled 2026-05-01 by inventory subagent during DS-13.5 lock-down session. This is **inventory only**; contradictions, overlaps, and gaps are flagged in soft annotations but NOT resolved here. Phase 13.6.A picks up cold from this list.*

**Sources catalogued:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` (full)
- `~/src/graphrefly/COMPOSITION-GUIDE.md` (index)
- `~/src/graphrefly/COMPOSITION-GUIDE-PROTOCOL.md` (L0)
- `~/src/graphrefly/COMPOSITION-GUIDE-GRAPH.md` (L1)
- `~/src/graphrefly/COMPOSITION-GUIDE-PATTERNS.md` (L2)
- `~/src/graphrefly/COMPOSITION-GUIDE-SOLUTIONS.md` (L3)
- 14 `feedback_*.md` memory files at `~/.claude/projects/-Users-davidchenallio-src-graphrefly-ts/memory/`

**Summary statistics:** 247 rules inventoried across 12 sources.

**Rule forms distribution:**
- must: 42
- must-not: 16
- principle: 18
- pattern: 138
- anti-pattern: 9
- invariant: 24

**Soft annotations:** 180+ cross-references and clarifications flagged for the audit.

---

## Source: GRAPHREFLY-SPEC.md §1.3 (Protocol Invariants)

**Rule 1.1:** DIRTY precedes DATA or RESOLVED; DATA and RESOLVED are mutually exclusive per wave.
- **Origin:** GRAPHREFLY-SPEC.md lines 83–190, esp. §1.3.1–1.3.3
- **Form:** invariant
- **Soft annotation:** related to Protocol Rule 41 (tier-3 wave exclusivity)

**Rule 1.2:** A node with a cached value pushes `[[START], [DATA, cached]]` to every new subscriber on subscribe.
- **Origin:** GRAPHREFLY-SPEC.md §2.2 (Subscribe and subscribe-time messaging)
- **Form:** must
- **Soft annotation:** push-on-subscribe semantics; inverse of pure fire-and-forget

**Rule 1.3:** Equals-substitution is a dispatch-layer invariant — every outgoing DATA runs through equals-vs-cache check; on match, tuple is rewritten to `[RESOLVED]`.
- **Origin:** GRAPHREFLY-SPEC.md §1.3.3, v0.3.1 changelog
- **Form:** invariant
- **Soft annotation:** cannot be bypassed by choice of API (actions.emit vs actions.down)

**Rule 1.4:** ERROR auto-propagates when any dep errors, independently of COMPLETE auto-propagation.
- **Origin:** GRAPHREFLY-SPEC.md Appendix D.1 (`errorWhenDepsError`)
- **Form:** must (default true)
- **Soft annotation:** only rescue/catchError set `errorWhenDepsError: false`

**Rule 1.5:** When tier-3 is present and node is not already dirty, dispatcher synthesizes `[DIRTY]` unconditionally before `[DATA]`.
- **Origin:** GRAPHREFLY-SPEC.md v0.4.0 changelog, §1.3.1 compat-path removal
- **Form:** must
- **Soft annotation:** raw and framed paths are observationally identical on wire

**Rule 1.6:** PAUSE/RESUME lockId is mandatory — bare `[[PAUSE]]` / `[[RESUME]]` throws.
- **Origin:** GRAPHREFLY-SPEC.md v0.4.0 changelog
- **Form:** must (breaking in v0.4.0)
- **Soft annotation:** per-node lock set provides multi-pauser correctness by construction

**Rule 1.7:** Tier-3 outgoing messages are buffered while any lock is held under `pausable: "resumeAll"` mode, replayed on final-lock RESUME.
- **Origin:** GRAPHREFLY-SPEC.md v0.4.0 changelog, §2.6 PAUSE/RESUME
- **Form:** invariant
- **Soft annotation:** equals substitution applies during replay; duplicates collapse to RESOLVED

**Rule 1.8:** Unknown-lockId RESUME is a no-op for dispose idempotency.
- **Origin:** GRAPHREFLY-SPEC.md v0.4.0 changelog
- **Form:** must
- **Soft annotation:** enables multi-pauser pattern where one pauser may not know all others

**Rule 1.9:** Function-form cleanup fires on `[[INVALIDATE]]` as well as deactivation and pre-re-run.
- **Origin:** GRAPHREFLY-SPEC.md v0.4.0 changelog
- **Form:** must
- **Soft annotation:** reactive hook for flushing external caches on broadcast `graph.signal([[INVALIDATE]])`

**Rule 1.10:** Meta TEARDOWN fan-out fires at the top of `_emit` before parent's own state-transition walk.
- **Origin:** GRAPHREFLY-SPEC.md v0.4.0 changelog
- **Form:** invariant (ordering)

**Rule 1.11:** `actions.down` and `actions.up` accept either single `Message` or `Messages` array.
- **Origin:** GRAPHREFLY-SPEC.md v0.4.0 changelog
- **Form:** must (signature change)
- **Soft annotation:** one action call = one wave; no fn-return accumulation boundary

**Rule 1.12:** `actions.up` throws on tier-3/4 (DATA/RESOLVED/COMPLETE/ERROR are downstream-only).
- **Origin:** GRAPHREFLY-SPEC.md v0.4.0 changelog
- **Form:** must

---

## Source: GRAPHREFLY-SPEC.md §2 (Node)

**Rule 2.1:** All nodes with cached value (state, derived after first run) push `[[DATA, cached]]` to every new subscriber.
- **Origin:** GRAPHREFLY-SPEC.md §2.2, v0.2.0 changelog
- **Form:** must
- **Soft annotation:** late subscribers receive current value; ordering does not matter for state-like nodes

**Rule 2.2:** Producer and streaming sources emit fire-and-forget; subscribe BEFORE emitting to avoid loss.
- **Origin:** GRAPHREFLY-SPEC.md §2.2, Composition Guide Protocol §2
- **Form:** must (ordering)
- **Soft annotation:** inverse of state-node push-on-subscribe

**Rule 2.3:** A compute node (derived/effect) does NOT run fn until every declared dep has delivered at least one real value.
- **Origin:** GRAPHREFLY-SPEC.md §2.2 (first-run gate), Composition Guide Protocol §1
- **Form:** must (invariant)
- **Soft annotation:** SENTINEL dep blocks first-run gate; no `undefined` until all deps initialized

**Rule 2.4:** Deduplication is opt-in (`equals` option or `distinctUntilChanged`), not default; nodes forward messages they don't recognize.
- **Origin:** GRAPHREFLY-SPEC.md §5.3 (Nodes are transparent by default)
- **Form:** principle
- **Soft annotation:** no silent swallowing of unrecognized messages

**Rule 2.5:** `.cache` is a read-only accessor for external consumers; reactive graph relies exclusively on messages for state propagation.
- **Origin:** GRAPHREFLY-SPEC.md §5.12 (Data flows through messages, not peeks)
- **Form:** must
- **Soft annotation:** initial values at connection time flow through message protocol

**Rule 2.6:** State nodes are ROM (read-only memory) — cached value survives deactivation.
- **Origin:** GRAPHREFLY-SPEC.md, Composition Guide Protocol §12
- **Form:** invariant
- **Soft annotation:** contrasts with compute nodes (RAM) which clear cache on deactivation

**Rule 2.7:** Compute nodes (derived, producer, effect, dynamic) are RAM — cache clears on deactivation.
- **Origin:** GRAPHREFLY-SPEC.md, Composition Guide Protocol §12
- **Form:** invariant
- **Soft annotation:** reconnect always re-runs fn from scratch; DepRecord cleared on deactivate

**Rule 2.8:** `.cache` returns `undefined` when a compute node is deactivated (no subscribers).
- **Origin:** Composition Guide Protocol §12 (ROM/RAM cache semantics)
- **Form:** must
- **Soft annotation:** test pattern: always read `.cache` before `unsub()` for compute nodes

**Rule 2.9:** A node's versioning level can be bumped **upward only** after construction via `_applyVersioning`.
- **Origin:** GRAPHREFLY-SPEC.md §7.2 (Retroactive upgrade)
- **Form:** must (monotonic)
- **Soft annotation:** downgrade (e.g. V1 → V0) is a no-op

**Rule 2.10:** `_applyVersioning` is rejected mid-wave; must be called at quiescent points only.
- **Origin:** GRAPHREFLY-SPEC.md §7.2
- **Form:** must
- **Soft annotation:** safe points: before first sink subscribes, after all sinks unsubscribe, between external `down()`/`emit()` calls

**Rule 2.11:** V0 → V1 retroactive upgrade produces **fresh history root** with `cid = hash(currentCachedValue)` and `prev = null`.
- **Origin:** GRAPHREFLY-SPEC.md §7.3 (Linked-history boundary at V0 → V1 upgrade)
- **Form:** invariant (intentional design)
- **Soft annotation:** audit tools walking `v.cid.prev` backwards encounter `null` boundary at upgrade point

**Rule 2.12:** `DepRecord` consolidates per-dep tracking: `node`, `unsub`, `latestData`, `dirty`, `settled`, `terminal`.
- **Origin:** GRAPHREFLY-SPEC.md §6.3 (DepRecord per-dep state)
- **Form:** implementation-detail invariant
- **Soft annotation:** replaces separate BitSet masks, last-dep-values arrays, upstream-unsub arrays

---

## Source: GRAPHREFLY-SPEC.md §3-4 (Graph, Utilities)

**Rule 3.1:** Edges are derived from `(nodes, each node's _deps, mounts)` not declared; edges are a pure function.
- **Origin:** Composition Guide Protocol §24 (Edges are derived, not declared)
- **Form:** principle
- **Soft annotation:** if edge doesn't appear in `describe()`, it's not a real subscription

**Rule 3.2:** If a node's dep isn't a real constructor argument (in `_deps` array), the edge is intentionally invisible.
- **Origin:** Composition Guide Protocol §24 (Edges are derived)
- **Form:** principle
- **Soft annotation:** producer-pattern factories with manual `source.subscribe` have empty `_deps` by design

---

## Source: GRAPHREFLY-SPEC.md §5 (Design Principles)

**Rule 5.1:** Control flows through the graph, not around it; lifecycle events propagate as messages, never as imperative calls.
- **Origin:** GRAPHREFLY-SPEC.md §5.1
- **Form:** principle
- **Soft annotation:** if registering in a flat list for lifecycle, design is wrong

**Rule 5.2:** Signal names must match behavior; rename the signal, don't change behavior to match misleading name.
- **Origin:** GRAPHREFLY-SPEC.md §5.2 (RESET → INVALIDATE example)
- **Form:** principle

**Rule 5.3:** Nodes are transparent by default; no silent swallowing.
- **Origin:** GRAPHREFLY-SPEC.md §5.3
- **Form:** principle
- **Soft annotation:** deduplication is opt-in via `equals` or `distinctUntilChanged`

**Rule 5.4:** High-level APIs speak domain language; protocol internals accessible via `inner` or `.node()` but never surface in primary API.
- **Origin:** GRAPHREFLY-SPEC.md §5.4
- **Form:** principle
- **Soft annotation:** surface never mentions DIRTY, RESOLVED, bitmask, etc.

**Rule 5.5:** Prefer composition over configuration (pipe with operators vs single node with options).
- **Origin:** GRAPHREFLY-SPEC.md §5.5
- **Form:** principle
- **Soft annotation:** each concern is a separate node

**Rule 5.6:** Everything is a node; one kind of thing connected by one kind of thing (edges).
- **Origin:** GRAPHREFLY-SPEC.md §5.6
- **Form:** principle
- **Soft annotation:** transforms on edges or conditional routing? Add a node

**Rule 5.7:** Graphs are artifacts; can be snapshotted, versioned, restored, shared, composed.
- **Origin:** GRAPHREFLY-SPEC.md §5.7
- **Form:** principle
- **Soft annotation:** persists beyond process that created it; represents a solution

**Rule 5.8:** No polling; state changes propagate reactively via messages.
- **Origin:** GRAPHREFLY-SPEC.md §5.8
- **Form:** must-not
- **Soft annotation:** if periodic behavior needed, use timer source (`fromTimer`, `fromCron`) emitting through graph

**Rule 5.9:** No imperative triggers outside the graph; all coordination uses reactive `NodeInput` signals.
- **Origin:** GRAPHREFLY-SPEC.md §5.9
- **Form:** must-not
- **Soft annotation:** reaching for `setTimeout` + manual `set()` signals design needs reactive source node

**Rule 5.10 (TS):** No bare `Promise`, `queueMicrotask`, `setTimeout`, or `process.nextTick` to schedule reactive work.
- **Origin:** GRAPHREFLY-SPEC.md §5.10
- **Form:** must-not
- **Soft annotation:** use central timer in `core/clock.ts`; batch system for deferred delivery

**Rule 5.10 (PY):** No bare `asyncio.ensure_future`, `asyncio.create_task`, `threading.Timer`, or raw coroutines to schedule reactive work.
- **Origin:** GRAPHREFLY-SPEC.md §5.10
- **Form:** must-not
- **Soft annotation:** use `core/clock.py`; batch context manager for deferred delivery

**Rule 5.11:** Domain-layer APIs (orchestration, messaging, memory, AI, CQRS) must be developer-friendly: sensible defaults, minimal boilerplate, clear errors, discoverable options.
- **Origin:** GRAPHREFLY-SPEC.md §5.11
- **Form:** principle
- **Soft annotation:** developer unfamiliar with spec should use from examples alone

**Rule 5.12:** All data propagation flows through messages, not peeks; nodes do not peek dep values via `.cache` to seed computation.
- **Origin:** GRAPHREFLY-SPEC.md §5.12
- **Form:** must
- **Soft annotation:** ensures single mental model: if data moved, a message carried it

---

## Source: COMPOSITION-GUIDE-PROTOCOL.md (L0)

**Rule P.1:** Derived node do NOT compute on subscribe if deps declare a SENTINEL (no `initial`).
- **Origin:** Composition Guide Protocol §1 (first-run gate), same as spec §2.2
- **Form:** must (same invariant, composition perspective)
- **Soft annotation:** status becomes "pending" until SENTINEL dep transitions

**Rule P.1a:** Don't emit placeholder (null, 0, empty) for "no value yet"; stay SENTINEL (return `[]` for RESOLVED-only waves).
- **Origin:** Composition Guide Protocol §1a (Stay SENTINEL)
- **Form:** pattern (preferred)
- **Soft annotation:** `prevData[i] === undefined` is the canonical "never emitted DATA" detector

**Rule P.1a-antipattern:** Don't emit `null` on empty + add `hasFooData: Node<boolean>` companion dep.
- **Origin:** Composition Guide Protocol §1a (anti-pattern)
- **Form:** anti-pattern
- **Soft annotation:** creates type ambiguity when `T` includes `null`; duplicates SENTINEL info

**Rule P.2:** For streaming sources (producer, fromPromise, etc.), wire subscribers BEFORE emitters fire.
- **Origin:** Composition Guide Protocol §2 (subscription ordering)
- **Form:** must (ordering)
- **Soft annotation:** late subscribe misses fire-and-forget emissions

**Rule P.2-topicgraph:** `TopicGraph.retained()` returns buffered entries for late subscribers; `SubscriptionGraph` provides cursor-based catch-up.
- **Origin:** Composition Guide Protocol §2 (escape hatches)
- **Form:** pattern

**Rule P.5:** Graph factory wiring order: create TopicGraphs/state → create derived/effect → subscribe/keepalive → mount subgraphs → return controller.
- **Origin:** Composition Guide Protocol §5 (graph factory wiring order)
- **Form:** must (ordering)
- **Soft annotation:** ensures stage N+1 wired before stage N emits

**Rule P.5-keepalive:** Keepalive subscriptions (`node.subscribe(() => {})`) serve to activate computation chain.
- **Origin:** Composition Guide Protocol §5
- **Form:** pattern
- **Soft annotation:** first subscriber triggers dep connection; deps push cached values; drives computation

**Rule P.9:** Use `batch()` explicitly in source nodes for diamond paths; derived nodes auto-emit `[[DIRTY], [DATA, value]]`.
- **Origin:** Composition Guide Protocol §9 (diamond resolution)
- **Form:** pattern (recommended)
- **Soft annotation:** one update wave produces one settle — downstream fn runs once glitch-free

**Rule P.9a:** K consecutive `.emit()` calls to same source inside `batch()` coalesce per-node into ONE multi-message delivery per edge.
- **Origin:** Composition Guide Protocol §9a (batch-coalescing rule)
- **Form:** invariant
- **Soft annotation:** K emits → one wave with `data: [v1, v2, …, vK]` not three separate waves

**Rule P.12:** Derived nodes receive `data: readonly unknown[]` — batch unwrapped using `batch.at(-1) ?? ctx.latestData[i]`.
- **Origin:** Composition Guide Protocol §19 (batch input model — sugar constructors)
- **Form:** invariant
- **Soft annotation:** each element latest DATA value for that dep

**Rule P.12-raw:** Raw `node()` callers receive `data: readonly (readonly unknown[] | undefined)[]` — full batch per dep or `undefined` if no DATA.
- **Origin:** Composition Guide Protocol §19 (batch input model — raw node)
- **Form:** invariant
- **Soft annotation:** must guard with `batch != null && batch.length > 0` to check DATA presence

**Rule P.19:** Terminal-emission operators emit ONLY `RESOLVED` (not per-dropped-item) when entire wave produces zero DATA.
- **Origin:** Composition Guide Protocol §19 (terminal-emission operators)
- **Form:** pattern (convention)
- **Soft annotation:** `filter`, `take`, `skip`, `takeWhile`, `distinctUntilChanged` emit one `RESOLVED` only when nothing passed

**Rule P.19-antipattern:** Don't emit `RESOLVED` on every accumulation wave.
- **Origin:** Composition Guide Protocol §19 (anti-pattern)
- **Form:** anti-pattern
- **Soft annotation:** pollutes wave ordering; use `completeWhenDepsComplete: false` + explicit `actions.down([[COMPLETE]])`

**Rule P.21:** `actions.emit(v)` for value emission (common case); `actions.down` for multi-message or mixed-tier batches.
- **Origin:** Composition Guide Protocol §21
- **Form:** pattern (rule of thumb)
- **Soft annotation:** no way to bypass equals substitution by choice of API

**Rule P.22:** Use `autoTrackNode` for compat layers (Jotai, TC39 Signals) where deps discovered at runtime.
- **Origin:** Composition Guide Protocol §22 (autoTrackNode)
- **Form:** pattern
- **Soft annotation:** P3 "no cross-node `.cache` reads" relaxed at compat boundary during discovery

**Rule P.22-limit:** Each discovery re-run increments counter; if exceeds 100, emits `[[ERROR]]` immediately.
- **Origin:** Composition Guide Protocol §22 (re-run depth limit)
- **Form:** guard (safety)
- **Soft annotation:** safety guard against reactive cycles during dep discovery

**Rule P.25:** START handshake exempts first emission during activation wave from DIRTY requirement.
- **Origin:** Composition Guide Protocol §25 (activation wave is ceremony)
- **Form:** invariant
- **Soft annotation:** two-phase kicks in starting from first post-activation state transition

**Rule P.25-test:** Don't check "DIRTY precedes any DATA globally" for accumulating operators (initial activation RESOLVED has no preceding DIRTY).
- **Origin:** Composition Guide Protocol §25 (test implication)
- **Form:** pattern (test guidance)
- **Soft annotation:** rewrite to check "DIRTY precedes terminal DATA" instead

**Rule P.28:** Capture dep's `.cache` at wiring time (sanctioned boundary read), update via subscribe handler, read closure inside reactive fn.
- **Origin:** Composition Guide Protocol §28 (factory-time seed pattern)
- **Form:** pattern (closure-mirror)
- **Soft annotation:** avoids `withLatestFrom` initial-pair loss under state+state deps

**Rule P.28-reason:** `withLatestFrom(primary, secondary)` loses initial pair when both deps are state() — primary's push-on-subscribe fires before secondary subscribes.
- **Origin:** Composition Guide Protocol §28
- **Form:** explanation
- **Soft annotation:** sequential subscribe → separate waves → operator fn sees "primary fired, secondary hasn't"

**Rule P.32:** State-mirror pattern for cross-wave reset checkpoints — introduce `state()` mirror that session boundary explicitly resets.
- **Origin:** Composition Guide Protocol §32 (state-mirror pattern)
- **Form:** pattern
- **Soft annotation:** switchMap output cache persists across runs; mirror provides reset target

**Rule P.32-checklist:** Use mirror when: (1) upstream cache survives session boundaries, (2) reset event needs to invalidate downstream view, (3) downstream would emit wrong DATA against stale cache.
- **Origin:** Composition Guide Protocol §32
- **Form:** pattern (decision checklist)

**Rule P.38:** `::` separates compound-factory internals; `/` separates independent nodes in same domain.
- **Origin:** Composition Guide Protocol §38 (naming conventions)
- **Form:** pattern (convention)
- **Soft annotation:** never mix `::` and `/` in one path

**Rule P.39:** When fn identity matters, caller stamps identifier onto node's `meta` via `meta.fnId("role::version")`.
- **Origin:** Composition Guide Protocol §39 (function identity via meta)
- **Form:** pattern (convention)
- **Soft annotation:** survives decompile, audit logs, cross-process snapshots

**Rule P.41:** Tier-3 slot is either ≥1 `DATA` OR exactly 1 `RESOLVED` — never mixed per wave.
- **Origin:** Composition Guide Protocol §41 (tier-3 wave exclusivity), same as spec §1.3.3
- **Form:** invariant
- **Soft annotation:** RESOLVED = single-DATA equals-substituted; not interleavable with real DATA

**Rule P.41-protocol-error:** Mixed shapes: `[[DATA, v1], [RESOLVED], [DATA, v2]]` in single delivery OR nested `batch()` with `node.down([[RESOLVED]]); node.emit(v2)` in same wave.
- **Origin:** Composition Guide Protocol §41 (protocol violations)
- **Form:** must-not

---

## Source: COMPOSITION-GUIDE-GRAPH.md (L1)

**Rule G.3:** Only two guard patterns: SENTINEL (preferred) OR `== null` (loose) when null is meaningful initial.
- **Origin:** Composition Guide Graph §3 (null/undefined guards)
- **Form:** pattern (exclusive)
- **Soft annotation:** never use `=== undefined` as normal reactive guard; exception: `partial: true`

**Rule G.3-sentinel:** Use `node<T>()` with no `initial`; first-run gate blocks computation until every dep delivers real DATA.
- **Origin:** Composition Guide Graph §3 (SENTINEL pattern)
- **Form:** pattern (preferred)
- **Soft annotation:** no guard code needed; `undefined` never emitted as DATA

**Rule G.3-null-guard:** Use `== null` (loose) when `null` is meaningful initial value; catches both `null` and `undefined`.
- **Origin:** Composition Guide Graph §3 (null-guard pattern)
- **Form:** pattern
- **Soft annotation:** `undefined` never appears in practice but loose equality is idiomatic

**Rule G.3-never-undefined:** Never use `=== undefined` as reactive dep guard — with one exception (partial mode).
- **Origin:** Composition Guide Graph §3
- **Form:** must-not (with exception)
- **Soft annotation:** first-run gate ensures fn never runs with uninitialized dep

**Rule G.3-partial:** `partial: true` allows fn to run with uninitialized deps; guard with `=== undefined` is correct here ONLY.
- **Origin:** Composition Guide Graph §3 (exception)
- **Form:** pattern
- **Soft annotation:** only case where `=== undefined` guard is documented and correct

**Rule G.3-companion-restriction:** `hasValue` / `hasLatest` companion restricted to `reactiveLog` (primitive allowing `T | undefined`).
- **Origin:** Composition Guide Graph §3 (companion-node pattern)
- **Form:** pattern (restricted)
- **Soft annotation:** higher-layer surfaces (topic, queue) reject `publish(undefined)`, so companion redundant

**Rule G.3-topicgraph-companion:** `TopicGraph<T>` has `topic.latest: Node<T>` (SENTINEL on empty) but no boolean companion.
- **Origin:** Composition Guide Graph §3 (Why TopicGraph dropped companion pair)
- **Form:** invariant (design)
- **Soft annotation:** `publish(undefined)` rejected, so SENTINEL unambiguous

**Rule G.3-reactiveLog-companion:** `reactiveLog.lastValue` emits `RESOLVED` instead of `DATA(undefined)` on empty-log path.
- **Origin:** Composition Guide Graph §3
- **Form:** invariant
- **Soft annotation:** preserves spec §1.2 "DATA(undefined) not valid emission"

**Rule G.4:** `ReactiveMapBundle.node` emits `Versioned<{map}>` snapshots; use `.get(key)` directly for single-key reads.
- **Origin:** Composition Guide Graph §4 (Versioned wrapper navigation)
- **Form:** pattern
- **Soft annotation:** `Versioned` wrapper for efficient RESOLVED dedup (compare versions not deep equality)

**Rule G.6:** TS `ReactiveMapBundle` has `.get()`, `.has()`, `.size`; PY exposes `.data` (node) with `.set()/.delete()/.clear()` but no `.get()`.
- **Origin:** Composition Guide Graph §6 (cross-language parity gap)
- **Form:** invariant (parity gap documented)
- **Soft annotation:** always check language-specific API

**Rule G.7:** To break feedback cycle, use `withLatestFrom(trigger, advisory)` to sample advisory without making it reactive trigger.
- **Origin:** Composition Guide Graph §7 (feedback cycles)
- **Form:** pattern (feedback cycle avoidance)
- **Soft annotation:** A → B → C → write(A) creates infinite loop; only primary causes emission

**Rule G.10:** First SENTINEL in pipeline silences every downstream node through first-run gate; any null-guard break re-starts downstream emissions.
- **Origin:** Composition Guide Graph §10 (SENTINEL vs null-guard cascading)
- **Form:** principle (cascading rule)
- **Soft annotation:** wrong guard at early stage propagates through every join

**Rule G.13:** Use `derived` with `initial` instead of `startWith`; `initial` option sets cache before subscriber connects.
- **Origin:** Composition Guide Graph §13 (startWith removal)
- **Form:** pattern (replacement)
- **Soft annotation:** START handshake pushes initial immediately on subscribe

**Rule G.14 (PY):** `first_value_from()` blocks on event-loop thread under `AsyncioRunner`, creating deadlock.
- **Origin:** Composition Guide Graph §14 (blocking async bridge deadlock)
- **Form:** must-not (PY only)
- **Soft annotation:** use `_ThreadRunner` in test conftest; long-term fix is reactive refactor

**Rule G.14-safe-runners:** PY `_ThreadRunner` safe with `first_value_from`; `AsyncioRunner` and `TrioRunner` deadlock.
- **Origin:** Composition Guide Graph §14
- **Form:** invariant (runner behavior)

**Rule G.20:** `ctx.store` persists across fn runs within one activation cycle; wiped on deactivation or resubscribable terminal reset.
- **Origin:** Composition Guide Graph §20 (ctx.store for persistent fn state)
- **Form:** pattern
- **Soft annotation:** replaces closure `let` vars needing `onResubscribe` reset

**Rule G.20-cleanup-default:** Cleanup `() => void` fires before next fn run, on deactivation, AND on `[[INVALIDATE]]`.
- **Origin:** Composition Guide Graph §20 (cleanup shapes)
- **Form:** invariant
- **Soft annotation:** reactive hook for flushing external caches on broadcast `graph.signal([[INVALIDATE]])`

**Rule G.20-cleanup-deactivation:** Cleanup `{deactivation: () => void}` fires ONLY on deactivation, NOT on fn re-run or INVALIDATE.
- **Origin:** Composition Guide Graph §20
- **Form:** invariant
- **Soft annotation:** for persistent resources (sockets, intervals) that survive fn re-runs

**Rule G.23:** Rescue-style operators use `errorWhenDepsError: false` to suppress auto-ERROR, handle via `ctx.terminalDeps[i]`.
- **Origin:** Composition Guide Graph §23 (rescue pattern)
- **Form:** pattern
- **Soft annotation:** only exception to default `errorWhenDepsError: true`

**Rule G.26:** Compat layers (Signal.State, Jotai, Nanostores, Zustand) MUST expose backing node and be wave-correct natively.
- **Origin:** Composition Guide Graph §26 (compat layers are two-way bridges)
- **Form:** must
- **Soft annotation:** see GRAPHREFLY-SPEC.md Appendix D.4 for full invariant set

**Rule G.26-test:** Always include two-way bridge test — subscribe directly to `._node` and compare DATA sequence.
- **Origin:** Composition Guide Graph §26 (testing rule)
- **Form:** pattern (test guidance)
- **Soft annotation:** `.cache` reads miss mid-wave glitch bugs

**Rule G.27:** Storage is N-tier and free-form; framework prescribes nothing about count, order, or kinds.
- **Origin:** Composition Guide Graph §27 (tiered storage composition)
- **Form:** principle
- **Soft annotation:** users decide hot/warm/cold combinations

**Rule G.27-read-order:** First tier in array checked first; stop at first hit. Put fastest tier first.
- **Origin:** Composition Guide Graph §27 (read order)
- **Form:** must
- **Soft annotation:** cross-tier merge not in v0.1; first-tier-wins only mode

**Rule G.27-per-tier:** Each tier tracks own pending state and last fingerprint; no cross-tier contamination.
- **Origin:** Composition Guide Graph §27
- **Form:** invariant
- **Soft annotation:** cold tier diff against own last save, not hot tier's

**Rule G.27-debounce-independent:** Sync tiers (`debounceMs === 0`) flush at wave-close; debounced tiers fire own timer.
- **Origin:** Composition Guide Graph §27
- **Form:** invariant
- **Soft annotation:** one debounce window covers N waves

**Rule G.27-filter-wholesale:** `filter?` returning `false` skips save entirely.
- **Origin:** Composition Guide Graph §27
- **Form:** pattern

**Rule G.27-compactEvery:** `compactEvery: N` forces flush every N entries regardless of debounce.
- **Origin:** Composition Guide Graph §27
- **Form:** pattern
- **Soft annotation:** caps buffer for append-log tiers

**Rule G.27-transaction:** Every storage tier owns transaction; one wave = one transaction per tier.
- **Origin:** Composition Guide Graph §27 (transaction model)
- **Form:** invariant
- **Soft annotation:** `save()` / `appendEntries()` add to buffer; `flush()` commits; `rollback()` discards on throw

**Rule G.27-debounce-deferred:** If `debounceMs > 0`, `flush()` deferred until debounce fires; buffer accumulates.
- **Origin:** Composition Guide Graph §27
- **Form:** invariant
- **Soft annotation:** transaction-of-record extends to debounce boundary

**Rule G.27-atomicity:** Cross-tier atomicity is best-effort; each tier is own transaction.
- **Origin:** Composition Guide Graph §27
- **Form:** invariant
- **Soft annotation:** if tier A succeeds and tier B fails, partial persistence results

**Rule G.27-codec:** `Codec<T>` is (de)serialization shim; built-in `jsonCodec` covers most cases.
- **Origin:** Composition Guide Graph §27 (codec parameterization)
- **Form:** pattern
- **Soft annotation:** v1 envelope carries codec name + version for read-side discovery

**Rule G.27-keyOf-recommended:** Each primitive exports default `keyOf` for partitioning audit/event records.
- **Origin:** Composition Guide Graph §27 (keyOf recommended exports)
- **Form:** pattern (convention)
- **Soft annotation:** users override with custom `keyOf` if storage strategy differs

---

## Source: COMPOSITION-GUIDE-PATTERNS.md (L2)

**Rule L2.8:** `promptNode` gates on nullish deps and empty prompt text; skips LLM call and emits `null`.
- **Origin:** Composition Guide Patterns §8 (promptNode SENTINEL gate)
- **Form:** must
- **Soft annotation:** guard with `!= null` (not `!== null`) to catch both

**Rule L2.11:** `dynamicNode` declares superset of all possible deps at construction; fn receives `track(dep)` for selective reads.
- **Origin:** Composition Guide Patterns §11 (dynamicNode superset model)
- **Form:** pattern
- **Soft annotation:** same first-run gate as static nodes; no rewire buffer; O(1) track lookup

**Rule L2.11-gate:** All declared deps must deliver at least one value before `dynamicNode` fn fires.
- **Origin:** Composition Guide Patterns §11
- **Form:** must
- **Soft annotation:** same as static nodes; no `undefined` first-pass

**Rule L2.11-equals:** When unused dep updates, fn fires but equals absorption prevents downstream propagation.
- **Origin:** Composition Guide Patterns §11
- **Form:** invariant
- **Soft annotation:** no wasted downstream propagation; no rewire, no `MAX_RERUN`

**Rule L2.15:** Standard scenario patterns indexed in spec Appendix C: LLM cost control, security policy, human-in-loop, multi-agent, LLM-builds-graph, git-versioned, custom signals.
- **Origin:** Composition Guide Patterns §15 (scenario patterns)
- **Form:** pattern (indexed set)

**Rule L2.16:** Nested `withLatestFrom` for multi-stage context — fire on stage N, sample N-1 and N-2 as context.
- **Origin:** Composition Guide Patterns §16 (nested withLatestFrom)
- **Form:** pattern
- **Soft annotation:** outer trigger prevents mismatched values in pipeline

**Rule L2.17:** Stable identity for retried items via `relatedTo[0]` as key, not mutated summary.
- **Origin:** Composition Guide Patterns §17 (stable identity for retried/reingested items)
- **Form:** pattern
- **Soft annotation:** all retries share identity via `relatedTo: [originalKey]`

**Rule L2.29:** Full handoff: triage routes to specialist queue via TopicGraph; specialist owns response.
- **Origin:** Composition Guide Patterns §29 (multi-agent handoff)
- **Form:** pattern (mode 1)
- **Soft annotation:** specialist becomes active agent; prompts focused

**Rule L2.29-mode2:** Agent-as-tool: manager calls specialist as bounded subtask; manager synthesizes outputs.
- **Origin:** Composition Guide Patterns §29 (agent-as-tool mode)
- **Form:** pattern (mode 2)
- **Soft annotation:** manager retains control; combines specialist results

**Rule L2.29-context:** Use `agentMemory` shared between agents; no explicit context-object passing.
- **Origin:** Composition Guide Patterns §29 (context transfer)
- **Form:** pattern
- **Soft annotation:** graph IS the shared state

**Rule L2.30:** Parallel guardrail: agent starts immediately, guardrail checks concurrently, cancelled if tripwire fires.
- **Origin:** Composition Guide Patterns §30 (parallel guardrail pattern)
- **Form:** pattern
- **Soft annotation:** optimistic execution + AbortSignal via `switchMap` + `gatedStream`

**Rule L2.30-modes:** Three execution modes: blocking (guardrail before agent), parallel (optimistic + cancel), post-hoc (final output check).
- **Origin:** Composition Guide Patterns §30
- **Form:** pattern (three alternatives)
- **Soft annotation:** parallel good when guardrail fast, agent expensive, tripwire rate low

**Rule L2.31:** Dynamic tool selection composes constraints reactively; tool list updates mid-conversation as state changes.
- **Origin:** Composition Guide Patterns §31 (dynamic tool selection)
- **Form:** pattern
- **Soft annotation:** each constraint independent node; add/remove freely

**Rule L2.31-antipattern:** Don't use tool selection as sole security boundary; pair with `toolInterceptor` for enforcement.
- **Origin:** Composition Guide Patterns §31 (anti-pattern)
- **Form:** anti-pattern
- **Soft annotation:** selection is UX (reduce confusion); interception is security

**Rule L2.33:** `frozenContext` wraps drifting source in stable snapshot; only re-materializes on explicit refresh trigger.
- **Origin:** Composition Guide Patterns §33 (frozenContext snapshot)
- **Form:** pattern
- **Soft annotation:** keeps 90%+ prefix cache hits while context stays useful

**Rule L2.33-modes:** Two modes: single-shot (read once on first activation) or refresh-on-trigger (re-materialize on firing).
- **Origin:** Composition Guide Patterns §33
- **Form:** pattern (two alternatives)
- **Soft annotation:** source-only drifts held under refresh-on-trigger mode

**Rule L2.34:** `handoff` primitive is sugar over full-handoff mode (§29); specialist lifetime = "active while condition open."
- **Origin:** Composition Guide Patterns §34 (handoff primitive)
- **Form:** pattern (sugar)
- **Soft annotation:** reactive route from one agent output into specialist factory

**Rule L2.35:** Five primitives share imperative-controller-with-audit shape: pipeline.gate, JobQueueGraph, CqrsGraph, saga, processManager.
- **Origin:** Composition Guide Patterns §35 (imperative-controller-with-audit)
- **Form:** pattern (shared shape)
- **Soft annotation:** helpers: `createAuditLog`, `wrapMutation`, `registerCursor`, `registerCursorMap`

**Rule L2.35-freeze:** `wrapMutation` surrounds action with freeze-at-entry (`Object.freeze(structuredClone(args))`).
- **Origin:** Composition Guide Patterns §35 (freeze-at-entry)
- **Form:** invariant
- **Soft annotation:** args immutable inside transaction

**Rule L2.35-rollback-layers:** Two rollback layers: helper-level (batch rollback) and spec-level (universal protection).
- **Origin:** Composition Guide Patterns §35 (rollback-on-throw)
- **Form:** invariant
- **Soft annotation:** helper catches throws in open `batch()`; spec-level any user code in `batch()`

**Rule L2.35-rollback-scope:** Batch rollback discards reactive emissions and seq cursor but NOT closure-state mutations.
- **Origin:** Composition Guide Patterns §35 (what rollback does NOT cover)
- **Form:** invariant
- **Soft annotation:** array splices, `Map.set`, plain JS counters committed

**Rule L2.35-cursor:** Closure counter elevated to state node via `registerCursor` / `registerCursorMap` for observability.
- **Origin:** Composition Guide Patterns §35 (registerCursor / registerCursorMap)
- **Form:** pattern

**Rule L2.35-guard:** `DEFAULT_AUDIT_GUARD` denies external writes; allows `observe` / `signal`.
- **Origin:** Composition Guide Patterns §35
- **Form:** invariant

**Rule L2.35-saga-error:** Saga error policy: `"advance"` (default) moves cursor past failure; `"hold"` stops at failure.
- **Origin:** Composition Guide Patterns §35 (saga error policy)
- **Form:** pattern (two alternatives)

**Rule L2.35-audit-duplication:** `.audit` is property (set once), not getter; no method-call overhead.
- **Origin:** Composition Guide Patterns §35
- **Form:** implementation-detail

**Rule L2.35-storage:** Storage attach via bundle with recommended `keyOf`.
- **Origin:** Composition Guide Patterns §35 (storage attach via bundle)
- **Form:** pattern

**Rule L2.36:** Process manager for long-running async stateful workflows correlating events across aggregates.
- **Origin:** Composition Guide Patterns §36 (process manager pattern)
- **Form:** pattern
- **Soft annotation:** use when: multiple steps, per-instance state survives, cross-aggregate correlation, retry/compensation

**Rule L2.36-not:** Don't use process manager when: one-shot sync no state, linear pipeline, natural graph expression.
- **Origin:** Composition Guide Patterns §36 (don't use)
- **Form:** pattern (anti-pattern context)

**Rule L2.36-step-result:** Step returns discriminated union: `continue`, `terminate`, or `fail` (triggers compensate).
- **Origin:** Composition Guide Patterns §36 (step result shape)
- **Form:** invariant

**Rule L2.36-synthetic:** Synthetic event types namespace process lifecycle; reserve `_process_<name>_*` prefix.
- **Origin:** Composition Guide Patterns §36 (synthetic event types)
- **Form:** must-not (avoid collision)
- **Soft annotation:** avoid user event-type names starting with `_process_`

**Rule L2.36-concurrency:** Multiple events for same `correlationId` serialize through step pipeline.
- **Origin:** Composition Guide Patterns §36 (concurrency safety)
- **Form:** invariant
- **Soft annotation:** `cancel()` during async step is single-shot

**Rule L2.37:** Handler versioning via audit metadata — opt-in registration stamped onto audit records.
- **Origin:** Composition Guide Patterns §37 (handler versioning)
- **Form:** pattern
- **Soft annotation:** no handler-as-node ceremony; no hot-swap atomicity

**Rule L2.37-field:** `BaseAuditRecord.handlerVersion` is canonical; every audit record extends this base.
- **Origin:** Composition Guide Patterns §37
- **Form:** invariant
- **Soft annotation:** optional so non-versioning callers don't need to pass

**Rule L2.37-convention:** `id: string` stable identifier; `version: string | number` semver / build / git SHA.
- **Origin:** Composition Guide Patterns §37 (conventions)
- **Form:** pattern (convention)

**Rule L2.37-not-hot-swap:** Hot-swap intentionally NOT library feature; users build own indirection if needed.
- **Origin:** Composition Guide Patterns §37 (hot-swap not supported)
- **Form:** principle
- **Soft annotation:** atomicity issues with in-flight calls, version skew across replicas

**Rule L2.37-replay:** Projection reducers NOT versioned; projections replay via pure reducer (deploy-time-pinned).
- **Origin:** Composition Guide Patterns §37 (replay determinism)
- **Form:** must-not (don't version reducers)

**Rule L2.40:** `distill`'s `extractFn` wires reactive flow — user picks cancellation semantics via `switchMap` / `concat` / `mergeMap`.
- **Origin:** Composition Guide Patterns §40 (reactive extractFn)
- **Form:** pattern
- **Soft annotation:** cancel-on-new-input most common; uses `switchMap`

**Rule L2.40-closure-mirror:** Use closure-mirror + subscribe-handler (not `withLatestFrom`) to avoid initial-source-emission loss.
- **Origin:** Composition Guide Patterns §40 (why closure-mirror)
- **Form:** pattern
- **Soft annotation:** `withLatestFrom` swallows initial when primary's push-on-subscribe fires before secondary subscribes

**Rule L2.41:** Criteria-grid verifier recipe: N binary axes instead of single yes/no; aggregated via `.every()` and approval gate.
- **Origin:** Composition Guide Patterns §41 (criteria-grid verifier recipe)
- **Form:** pattern (recipe)
- **Soft annotation:** locked as recipe not factory; human and LLM verifiers substitutable

**Rule L2.42:** Cost-bubble recipe: per-agent `bundle.cost: Node<CostState>` bubbled to parent via `derived` aggregation.
- **Origin:** Composition Guide Patterns §42 (cost-bubble recipe)
- **Form:** pattern (recipe)
- **Soft annotation:** `{ usage, turns }` where usage is canonical `TokenUsage`

**Rule L2.42-honest-cost:** Two pieces needed: (1) bubble for observability, (2) adapter-abort hookup to cancel in-flight calls.
- **Origin:** Composition Guide Patterns §42 (honest cost control)
- **Form:** principle
- **Soft annotation:** without (2), gate cuts propagation but token burn continues

**Rule L2.43:** `boundaryDrain` recipe (locked as recipe): accumulate on topic until boundary signal, drain batch downstream.
- **Origin:** Composition Guide Patterns §43 (boundaryDrain recipe)
- **Form:** pattern (recipe, locked)
- **Soft annotation:** alias for `buffer(source, notifier)` operator; maps to `bufferWhen` semantics

**Rule L2.43-when-upgrade:** Upgrade to factory if: max-buffer-size cap, fallback emission on timeout, per-boundary TTL.
- **Origin:** Composition Guide Patterns §43
- **Form:** pattern (upgrade decision)

**Rule L2.44:** Don't wrap imperative helper as reactive primitive if bundle is trivial (3+ items one-line each); widen helper with `T | Node<T>` instead.
- **Origin:** Composition Guide Patterns §44 (T | Node<T> parameter widening)
- **Form:** pattern (alternative to wrapping)
- **Soft annotation:** no new semantic content → wrapping is packaging not abstraction

**Rule L2.44-when-wrap:** Wrap as primitive when underlying structure is reactive (map/list/topic/queue); mutation commits into multi-edge state.
- **Origin:** Composition Guide Patterns §44 (when to wrap)
- **Form:** pattern (decision rubric)

**Rule L2.44-vicious-cycle:** Wrap → realize primitive needs imperative entry → bolt it back as method → ship more API for no gain.
- **Origin:** Composition Guide Patterns §44 (vicious cycle)
- **Form:** anti-pattern

---

## Source: COMPOSITION-GUIDE-SOLUTIONS.md (L3)

**Rule L3.Harness:** Reactive collaboration loop (INTAKE → TRIAGE → QUEUE → GATE → EXECUTE → VERIFY → REFLECT) is canonical solution-level pattern.
- **Origin:** Composition Guide Solutions (harness 7-stage composition)
- **Form:** pattern (named)

**Rule L3.Harness-triage-queue:** TRIAGE → QUEUE: use `withLatestFrom(intake.latest, strategy.node)` to avoid feedback cycles.
- **Origin:** Composition Guide Solutions (harness composition)
- **Form:** pattern (specific wiring)

**Rule L3.Harness-exec-verify:** EXECUTE → VERIFY: wire via `verifiable(executeOutput, verifyFn, {autoVerify: true})` for switchMap cancellation.
- **Origin:** Composition Guide Solutions (harness composition)
- **Form:** pattern (specific wiring)

**Rule L3.Harness-verify-reflect:** VERIFY → REFLECT: use nested `withLatestFrom` (§16) — fire only on verify settle.
- **Origin:** Composition Guide Solutions (harness composition)
- **Form:** pattern (specific wiring)

**Rule L3.Harness-strategy:** REFLECT updates `strategy.node` with `rootCause × intervention → successRate`; TRIAGE samples via `withLatestFrom`.
- **Origin:** Composition Guide Solutions (harness strategy model)
- **Form:** pattern
- **Soft annotation:** closed-loop learning improves routing over time

**Rule L3.Memory:** `agentMemory` composes: collection (reactiveMap) + vectorIndex (derived) + knowledgeGraph (reactiveMap) + decay (effect) + retrieval (distill).
- **Origin:** Composition Guide Solutions (memory tier composition)
- **Form:** pattern (named)

**Rule L3.Memory-frozen:** Wrap `memory.context` in `frozenContext` to stabilize system prompt prefix across turns.
- **Origin:** Composition Guide Solutions (frozenContext integration)
- **Form:** pattern

**Rule L3.Pipeline:** Resilient pipeline order: rateLimiter → budgetGate → withBreaker → timeout → retry → fallback.
- **Origin:** Composition Guide Solutions (resilient pipeline composition)
- **Form:** pattern (ordered)
- **Soft annotation:** order matters; each stage is Node in graph

**Rule L3.Pipeline-order:** Order matters: rateLimiter prevents burst, budgetGate stops before spend, withBreaker fast-fails provider down.
- **Origin:** Composition Guide Solutions (order rationale)
- **Form:** principle

**Rule L3.MultiAgent-seq:** Sequential chain: researcher → writer via `derived([researchResult])` transformation.
- **Origin:** Composition Guide Solutions (sequential chain)
- **Form:** pattern (simplest)

**Rule L3.MultiAgent-fanout:** Fan-out/fan-in: one input → N specialists → `merge(outputs)` → synthesizer.
- **Origin:** Composition Guide Solutions (fan-out/fan-in)
- **Form:** pattern

**Rule L3.MultiAgent-supervisor:** Supervisor with handoffs: specialists registered as tools; supervisor calls via tool registry.
- **Origin:** Composition Guide Solutions (supervisor with handoffs)
- **Form:** pattern
- **Soft annotation:** agent-as-tool mode; § 29 §34 wiring

**Rule L3.MultiAgent-shared-state:** All agents mount in same Graph; share `agentMemory` — no explicit context passing.
- **Origin:** Composition Guide Solutions (shared state across agents)
- **Form:** principle
- **Soft annotation:** graph IS the shared state

---

## Source: Memory feedback files

**Rule M.1:** When debugging reactive graph, read COMPOSITION-GUIDE first before improvising workarounds.
- **Origin:** feedback_debug_process.md
- **Form:** must (process prescription)
- **Soft annotation:** use inspection tools (graphProfile, harnessProfile); isolate failing test first

**Rule M.2:** GraphReFly v0.2+ uses push-on-subscribe (hot-with-last-value), not pure fire-and-forget.
- **Origin:** feedback_fire_and_forget.md
- **Form:** principle
- **Soft annotation:** late subscribers to state-like nodes receive current cached value

**Rule M.3:** `.cache` read is sanctioned at external-observer boundary (wiring-time, outside reactive fn).
- **Origin:** feedback_fire_and_forget.md
- **Form:** pattern (sanctioned exception)
- **Soft annotation:** foundation-redesign §3.6 permits this boundary read

**Rule M.4:** `undefined` is reserved globally as SENTINEL (never-sent); valid DATA type is `T | null` only.
- **Origin:** feedback_guard_patterns.md
- **Form:** invariant
- **Soft annotation:** v5 semantics (2026-04 onward)

**Rule M.5:** `=== undefined` / `!== undefined` is valid sentinel check; means "has this dep ever produced DATA?"
- **Origin:** feedback_guard_patterns.md
- **Form:** pattern (valid guard)
- **Soft annotation:** valid everywhere: dep values, `.cache` reads, observer gates

**Rule M.6:** `== null` / `!= null` (loose) is domain guard when `null` meaningful; conflates `null` and `undefined`.
- **Origin:** feedback_guard_patterns.md
- **Form:** pattern
- **Soft annotation:** only use when conflation intentional

**Rule M.7:** When spec ↔ code conflict arises, STOP and raise flag with options — never make silent architectural decision.
- **Origin:** feedback_no_autonomous_decisions.md
- **Form:** must-not
- **Soft annotation:** user loses trust; spec is the session log

**Rule M.8:** Shape preservation during migrations (Object.hasOwn results, JSON, key presence/absence): require explicit lock, not autonomous decision.
- **Origin:** feedback_no_autonomous_decisions.md (shape preservation constraint)
- **Form:** must
- **Soft annotation:** audit-record shape changes break downstream consumers silently

**Rule M.9:** Don't rename local variables, reshape test patterns, or introduce helpers "just to make tests green" without approval.
- **Origin:** feedback_no_autonomous_decisions.md
- **Form:** must-not

**Rule M.10:** Avoid imperative trigger methods in public API; use reactive `NodeInput` signals in opts instead.
- **Origin:** feedback_no_imperative.md
- **Form:** pattern (preferred)
- **Soft annotation:** user allergic to imperative; design invariant = public API returns Node/Graph/void/sync-value

**Rule M.11:** ACTIVELY REMOVE existing imperative paths when grep shows no consumer depends — don't keep as "convenience."
- **Origin:** feedback_no_imperative.md
- **Form:** must
- **Soft annotation:** no real caller = sufficient reason to remove pre-1.0

**Rule M.12:** Dual-boundary patterns (reactive method shadowed by imperative twin) — imperative twin usually redundant.
- **Origin:** feedback_no_imperative.md
- **Form:** anti-pattern
- **Soft annotation:** example: `executeReactive` + `execute` → remove `execute`

**Rule M.13:** Don't wrap imperative helper as reactive primitive if bundle trivial; widen helper's args to `T | Node<T>` instead.
- **Origin:** feedback_no_imperative_wrap_as_primitive.md
- **Form:** pattern (alternative)
- **Soft annotation:** gives callers reactive control when wanted; imperative fallback when not

**Rule M.13-vicious:** Vicious cycle: wrap helper → realize primitive needs entry point → bolt method back → ship more API for no gain.
- **Origin:** feedback_no_imperative_wrap_as_primitive.md (vicious cycle)
- **Form:** anti-pattern

**Rule M.13-structure:** Reserve "primitive with mutation method" for cases where underlying structure reactive (map keys, list elements, topic log).
- **Origin:** feedback_no_imperative_wrap_as_primitive.md
- **Form:** pattern (decision rubric)

**Rule M.14:** Do not proceed to implementation after locking decisions unless user explicitly says to implement.
- **Origin:** feedback_no_implement_without_approval.md
- **Form:** must-not
- **Soft annotation:** "decisions locked" = end of Phase 2, not start of Phase 3

**Rule M.15:** No backward compatibility shims, legacy aliases, or deprecated re-exports.
- **Origin:** feedback_no_backward_compat.md
- **Form:** principle
- **Soft annotation:** both repos pre-1.0; no external consumers yet; no legacy debt allowed

**Rule M.16:** Change function signatures freely; update all call sites, tests, docs in same pass.
- **Origin:** feedback_no_backward_compat.md
- **Form:** pattern (refactoring)
- **Soft annotation:** no `_old` suffixes, no overloads, no migration layers

**Rule M.17:** Phase 4+ features must have developer-friendly APIs: no polling, no raw Promises/microtask, use central timer & message tier utils.
- **Origin:** feedback_phase4_api_design.md
- **Form:** principle (phase 4+ requirement)

**Rule M.18:** Always read COMPOSITION-GUIDE and test-guidance before implementing composition fixes or factory changes.
- **Origin:** feedback_read_guides_before_implementing.md
- **Form:** must (process prescription)
- **Soft annotation:** skipping leads to null-guard violations, layer-breaking optimizations

**Rule M.19:** CLAUDE.md is pointer file, never duplicate content; maintain exactly one source of truth per topic.
- **Origin:** feedback_single_source_of_truth.md
- **Form:** must (doc hygiene)
- **Soft annotation:** write in canonical location, reference from CLAUDE.md

**Rule M.20:** For `awaitSettled({skipCurrent:true})` over sync upstream, capture call BEFORE the kick.
- **Origin:** feedback_subscribe_before_kick.md
- **Form:** must (ordering)
- **Soft annotation:** subscribe must happen before upstream drains; otherwise skipCurrent swallows only DATA

**Rule M.20-reason:** `awaitSettled` is async; returns Promise whose body subscribes during next microtask; sync pipeline drains first.
- **Origin:** feedback_subscribe_before_kick.md
- **Form:** explanation

**Rule M.20-load-bearing:** Document the ordering as load-bearing in comment; natural "do work, await" shape regresses silently if reordered.
- **Origin:** feedback_subscribe_before_kick.md
- **Form:** pattern (documentation requirement)

**Rule M.21:** Use `ctx.prevData[i] === undefined` (paired with empty `batchData[i]`) as canonical "dep never sent DATA" detector.
- **Origin:** feedback_use_prevdata_for_sentinel.md
- **Form:** pattern (canonical)
- **Soft annotation:** don't bolt on separate `hasLatest` companion when SENTINEL already answer

**Rule M.21-upstream-fix:** Stop upstream from eagerly emitting `null` on empty; let it stay SENTINEL.
- **Origin:** feedback_use_prevdata_for_sentinel.md
- **Form:** pattern (upstream fix)
- **Soft annotation:** avoids need for companion and type ambiguity

**Rule M.21-exception:** `hasLatest` companion genuinely necessary at `reactiveLog` layer (allowing `T | undefined` payloads) only.
- **Origin:** feedback_use_prevdata_for_sentinel.md (exception)
- **Form:** pattern (restricted exception)

---

## Notes for Phase 13.6.A audit

This inventory is **deliberately uncondensed**. Phase 13.6.A's job is to:

1. **Group** rules covering the same subject (e.g. SENTINEL appears across spec §2.2, P.1/P.1a, G.3 family, M.4/M.21 — likely the most heavily-restated rule).
2. **Resolve overlaps** — pick one canonical home; cross-references in others.
3. **Surface contradictions** — none flagged during compile, but the audit should look hard at:
   - Imperative boundary rules (M.10/M.11/M.12 vs M.13/L2.44 vs L2.35) — when *is* an imperative method sanctioned?
   - Bundle vs Node vs Graph form (DS-13.5.G surfaced no migration work, but the question of "when to extends Graph" remains worth a pass).
   - `.cache` read sanctioned exceptions (M.3, P.28, P.22) — three different sanctionings; audit consolidation.
   - StatusValue / GateState central vocabularies (DS-13.5.B added them; ensure no clashing per-primitive enums in code).
4. **Identify gaps** — cases observed in DS-13.5 walks that don't have a codified rule yet:
   - "Per-call subgraph + keepalive-on-projection-TEARDOWN" (DS-13.5.C) — should this become a recipe at L2 alongside §44?
   - "Per-claim eval mount at `eval/${claimId}`" (DS-13.5.D.4) — same recipe instance.
   - When to ship audit-record types proactively vs on-demand (DS-13.5.E).
5. **Lock the ultimate invariants document** as amendments to spec / COMPOSITION-GUIDE.

Phase 13.6.B uses the locked output to drive a per-layer cleanup pass: core → extras → patterns → solutions.
