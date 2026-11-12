---
SESSION: rewire-gap-findings
DATE: 2026-05-04
TOPIC: TS exploratory `_setDeps` / `_rewire` impl — integration findings + design-session resolution
REPO: graphrefly-ts (Phase 13.8)
RELATED: docs/research/rewire-design-notes.md, docs/research/wave_protocol_rewire.tla, ~/src/graphrefly-rs/crates/graphrefly-core/tests/setdeps.rs
---

## Context

Phase 13.7 produced a TLA+-verified `node.setDeps` substrate primitive (`wave_protocol_rewire.tla`, 35,950 distinct states clean) and 9 integration tests in M1 Rust core (`graphrefly-rs/crates/graphrefly-core/tests/setdeps.rs`). The Rust impl validates substrate semantics; it can't exercise interactions with the **full graphrefly feature set** (PAUSE/RESUME, INVALIDATE, TEARDOWN, replay buffer, meta companions, batch coalescing, COMPLETE/ERROR cascade, mounts).

This doc records what the TS exploratory impl surfaced — first via a deliberately aggressive full-disconnect/resubscribe variant probe, then locked in to surgical-strict semantics after design-session iteration.

## Final TS implementation summary (post-design-session 2026-05-04)

**Variant locked: surgical (Option C) + optional fn replacement.**

A dep that appears in BOTH the old and new dep sets is left completely alone — its subscription stays attached, its DepRecord (`prevData`, `dirty`, `dataBatch`, `terminal`) is unchanged. Only **removed** deps are unsubscribed (DepRecord discarded), only **added** deps get a fresh DepRecord + subscription.

**Reorder + interior-remove are allowed** because subscription callbacks bind to the DepRecord reference (not a closure-captured index). At dispatch time the callback computes the current index via `_deps.indexOf(record)` (O(N) over typically-small N). Kept deps may shift position freely without re-subscribing.

**All three substrate APIs accept `opts?: { fn?: NodeFn }`** to swap the transform fn atomically with the dep mutation:

```ts
nodeImpl._setDeps(newDeps, opts?: { fn?: NodeFn })
nodeImpl._addDep(depNode, opts?: { fn?: NodeFn })
nodeImpl._removeDep(depNode, opts?: { fn?: NodeFn })  // NEW
```

The new fn lands BEFORE the next `_execFn` invocation. The existing rerun-cleanup path in `_execFn` fires the OLD cleanup's `onRerun` hook (clean wrap-up of "old fn's last run completed"), then runs the NEW fn, then sets `_cleanup` from the new fn's return. `_store`, `_hasCalledFnOnce`, cache, replay buffer, pause locks all preserved. This is essential because the user-fn signature is **positional** (fn reads `data[i]` and `prevData[i]` by hardcoded index), so any rewire that changes dep count or order may need a new fn aware of the new shape. The fn-swap is the canonical mechanism.

Three design-iteration passes were required:
1. **Probe variant** — full disconnect/resubscribe (per "expose as many issues as possible"). Surfaced G1 (wedge) and cacheless-producer fragility.
2. **Surgical-strict** — first lock attempt with a "same-index-kept rule" rejecting reorder/interior-remove. User pushed back on UX cost.
3. **Surgical + Option C** — DepRecord-ref dispatch removes the same-index constraint. User then surfaced that this is silently unsafe at the user-fn level (positional reads break under reorder).
4. **Surgical + Option C + opts.fn (final)** — user proposed making the fn replaceable at rewire/add/remove time. Now the fn-shape concern is solved at the source: when shape changes, supply a fresh fn. `_removeDep` added for symmetry with `_addDep`.

**Files:**
- [src/core/node.ts](../../src/core/node.ts) — `NodeImpl._setDeps()`, `_addDep` (extended with `opts.fn`), new `_removeDep`, `_reachableUpstream` cycle helper. `_fn` field changed from `readonly` to mutable-via-substrate-only.
- [src/graph/graph.ts](../../src/graph/graph.ts) — `Graph._rewire()` (with `opts.fn`), new `Graph._addDep()` and `Graph._removeDep()` path-aware wrappers, `GraphRewireAudit` type, `TopologyEvent { kind: "rewired" }` variant, observe-tree handler.
- [src/__tests__/core/rewire-integration.test.ts](../../src/__tests__/core/rewire-integration.test.ts) — 34 substrate tests.
- [src/__tests__/core/rewire-mock-harness.test.ts](../../src/__tests__/core/rewire-mock-harness.test.ts) — 13 Graph-layer tests including AI self-pruning use case + Graph-layer wrapper coverage.

All 2962 tests pass; 47 are new. No public API exports added — all five new APIs are single-underscore internal-only.

## Design-session resolutions (2026-05-04)

### Q1 — Terminal-dep wedge state → REJECT (Option A)

**Resolution.** Both `_setDeps` and `_addDep` now reject adding a non-resubscribable terminal dep with a clear error citing the silent-handshake root cause and suggesting alternatives (mark resubscribable, use a fresh node, remove from rewire). Resubscribable terminal deps ARE allowed because `subscribe()` triggers `_resetForFreshLifecycle` on them — re-arming the dep into a clean sentinel state with no value yet.

**Why this resolution.** Symmetric with the existing "reject rewire ON terminal N" guard. Defensive, clean, fixes the same pre-existing bug in `_addDep`. The alternative (Option B — change `defaultOnSubscribe` to deliver `[START, terminal]` to late subscribers) is a v0.2 spec-§2.2 contract change worth opening as a separate spec session if the late-subscriber-silently-misses-COMPLETE behavior surfaces in real use; not in scope for Phase 13.8 → DS-14.

**Action item carried forward:** track the "subscribe to terminal node delivers nothing" foot-gun for a future spec session. Filed in `docs/optimizations.md` under Active work items.

### Q2 — Auto-complete cascade tail-check → DISSOLVED

With Q1 = A, you can no longer end up with a "rewire to a set of terminal deps" — at least one dep must be live (or resubscribable). The auto-complete check fires naturally on the next dep message arrival via the existing `_onDepMessage` path. No explicit tail-check needed.

### Q3 — Synthetic DIRTY downstream on rewire → KEEP AS-IS

Rewire emits no synthetic DIRTY on its own. Topology observers use `graph.topology.subscribe(...)` (which now includes `kind: "rewired"` events with full audit). Value observers are data-coupled to N's outgoing emissions; if a rewire causes N's fn to fire and emit, the auto-prefix DIRTY in `_emit` still wraps the wave correctly. Implementation detail: `_setDeps` DOES emit `[DIRTY]` downstream when adding new deps (mirroring `_addDep`), because that's wave-state machinery — not "synthetic from rewire" in the Q3 sense.

### Q4 — Surgical vs full-disconnect → SURGICAL + Option C + opts.fn

The original Phase 13.8 probe used full-disconnect/resubscribe ("expose maximum integration surface"). That variant surfaced the wedge bug (G1) and the cacheless-producer issue, then was retired.

A first attempt at surgical-strict added a "same-index-kept rule" because subscription callbacks closed over `depIdx`. User pushed back: "I like B interpretation until I see fn fires once for kept-only DATA replay. I'm thinking can we adapt the third option and use reference of dep to be the key of the map of dep records?" The final lock adopts that suggestion.

**Surgical + Option C semantics (LOCKED):**
1. **Removed deps:** unsub, DepRecord discarded.
2. **Kept deps:** untouched. Subscription stays attached. DepRecord state survives. Position in `_deps` may change without re-subscribing.
3. **Added deps:** createDepRecord, pre-dirty, subscribe.
4. **Closure binding:** subscription callbacks close over the DepRecord reference. At dispatch time the current index is computed via `_deps.indexOf(record)` (returns -1 if record was evicted → callback no-ops). The public `MessageContext.depIndex` and `NodeInspectorHookEvent.depIndex` stay numbers; they just reflect the dep's *current* position rather than a stale snapshot.

**Why this works.** The 3 subscribe-callback sites in `node.ts` (`_activate`, `_addDep`, `_setDeps`) all swap their closure-captured `depIdx` for a `_deps.indexOf(record)` lookup. Public types are unchanged. Inspector hooks, observe-tree consumers, autoTrackNode — all continue to receive valid `depIndex` numbers and can index into `_deps` correctly.

**Trade-off cost.** O(N) lookup per dep message instead of O(1) closure read. For N typically <10 this is negligible; can be promoted to a `Map<DepRecord, number>` cache if profiling demands. The substrate primitive is for AI-self-pruning-rate rewires, not hot-path optimization.

**The "natural" rewire shapes work without throwing:** append at end, tail-remove, partial swap, reorder, interior-remove — all just work at the substrate level.

**Discovered gap during the design session: positional fn semantics.** User-fns read `data[i]` and `prevData[i]` by hardcoded index. With Option C alone, reorder/interior-remove silently broke fn semantics (the substrate routes messages correctly, but `data[0]` now refers to a different dep than the fn was written for). The fix: **`opts.fn` on all three substrate APIs** (`_setDeps`, `_addDep`, `_removeDep`) lets the caller atomically swap the fn alongside the dep mutation. The next `_execFn` invocation fires old cleanup's `onRerun` (clean wrap-up), then runs the new fn, then captures new cleanup from its return. No special-case logic at swap time — the existing `_execFn` rerun-cleanup path picks it up naturally.

Symmetric `_removeDep` was added at the same time so the trio of dep-mutation APIs has consistent shape: each accepts an optional fn replacement, since dep shape change is exactly when fn replacement is needed.

### Q5 — R3.3.1 spec amendment timing → DEFER WITH STUB

Add a one-line cross-reference in canonical-spec R3.3.1 pointing at `rewire-design-notes.md`; full spec lock with DS-14. Stub text:

> **R3.3.1.1 (exploratory, Phase 13.8).** Topology mutation post-construction may be added via the experimental `node._setDeps()` substrate primitive and `Graph._rewire()` wrapper. Surgical-strict semantics; same-index-kept rule. See [docs/research/rewire-design-notes.md](docs/research/rewire-design-notes.md) and [docs/research/rewire-gap-findings.md](docs/research/rewire-gap-findings.md). Spec lock targeted for DS-14.

## What the gap-finding probe surfaced (historical record)

The following gaps were discovered during the full-disconnect probe phase. Some are now closed by the surgical lock; others remain as separate design issues.

### G1 — Rewire-to-terminal-non-resubscribable-dep wedge state ✅ RESOLVED

**Probe finding:** `_setDeps(N, [completedDep])` succeeded silently; new DepRecord stayed in `prevData=SENTINEL, dirty=false, terminal=undefined` forever; N appeared wired but received no signal.

**Root cause:** `defaultOnSubscribe` returns `undefined` early for terminal nodes ([src/core/node.ts:540](../../src/core/node.ts:540)) — silent no-op handshake.

**Resolution:** rejected at substrate via Q1 = A.

**Pre-existing bug exposed:** `_addDep` had the same silent failure. Now also fixed.

### G2 — Auto-complete cascade gating only re-evaluates on dep message ✅ DISSOLVED

Per Q2: with Q1 = A, you can't reach the failure case. Removed.

### G3 — Rewire emits no synthetic DIRTY downstream ✅ ACCEPTED AS DESIGNED

Per Q3. `graph.topology` is the proper channel for topology-change observers.

### G4 — Full-disconnect re-fires push-on-subscribe even for kept deps ✅ DISSOLVED BY SURGICAL LOCK

The probe's full-disconnect variant tore down kept-dep DepRecords, causing the resubscribe handshake to re-deliver cached DATA and fire fn redundantly. For cacheless producers, fn fired with `data[i]=undefined && prevData[i]=undefined` → user code returned undefined.

Surgical strict eliminates this entire class of bug — kept deps are not touched, so neither the closure rebind nor the handshake replay happens.

### G5 — Mid-fn rewire structurally rejected (carried forward)

`_setDeps` rejects with `Error("rewire during fn")` if `_isExecutingFn === true`. Re-entrancy hazard in cleanup-hook-triggered rewire is a TLA+ follow-up. Sufficient for the AI self-pruning use case (rewires happen between waves, not mid-fn). Filed for future spec session.

### G6 — Cycle detection is O(V+E) per call (carried forward)

`_reachableUpstream` walks the upstream cone fresh per call. O(N · (V+E)) for N sequential rewires. Not a problem for AI self-pruning (low frequency); flag for the Rust port.

## Scenarios — outcome table (post-surgical lock)

| # | Scenario | Outcome |
|---|---|---|
| 1 | rewire mid-`batch()` | ✅ Clean. Mid-batch rewire works; pre-rewire emits go to old DepRecord, post-rewire to new. |
| 2 | rewire × INVALIDATE same wave | ✅ INVALIDATE clears cache; rewire to fresh dep restores via push-on-subscribe. |
| 3 | rewire while paused (`resumeAll`) | ✅ Pause locks preserved; post-rewire wave buffered; RESUME drains correctly. |
| 4 | rewire × TEARDOWN cascade | ✅ Rewire on terminal N rejected; TEARDOWN on a removed dep does NOT cascade to N. |
| 5 | rewire × non-empty replay buffer | ✅ N's replay buffer preserved; new emissions append. |
| 6 | rewire × meta companions | ✅ Meta unaffected — orthogonal to deps. |
| 7 | rewire × dep COMPLETE/ERROR | ✅ Rewire AWAY from completed dep clean. |
| 7b | rewire TO non-resubscribable terminal dep | ✅ REJECTED (Q1 lock). |
| 7c | rewire TO resubscribable terminal dep | ✅ ALLOWED — dep re-arms via subscribe handshake. |
| 8 | rewire × resubscribable terminal-reset in flight | ✅ Clean re-arm. |
| 9 | cross-mount rewire `mount::leaf` | ✅ Path resolution + cycle detection both work. |
| Surgical kept-dep DepRecord identity | ✅ Same DepRecord object survives rewire. |
| Surgical kept dep no fn-re-fire | ✅ Adding a new dep to N does NOT cause kept-dep handshake replay. |
| Reorder rejection | ✅ Throws with two-step rebuild guidance. |
| Interior-remove rejection | ✅ Throws (would shift remaining kept deps). |
| Two-step rebuild | ✅ `_setDeps([])` → `_setDeps(newOrder)` allows arbitrary topology change. |

## Recommendations carried forward

### For Rust M1 setDeps

1. **Add a "rewire-to-terminal-dep" test** matching Q1 = A (reject non-resubscribable, accept resubscribable).
2. **Match the same-index-kept rule** for the surgical variant. Two-step rebuild pattern documented.
3. **Match the structural rejections** — self-rewire, cycle, mid-fn, terminal-N, terminal-non-resubscribable-newDep.
4. The TLA+ `wave_protocol_rewire.tla` spec corresponds to surgical semantics with kept deps preserved. No spec changes needed.

### For DS-14 design

The five DS-14 threads (op-log, worker bridge, lens.flow, reactiveLog.scan, restoreSnapshot diff) all rest on a delta protocol. Rewire interactions:

- **Op-log changesets:** rewire does NOT bump version. Topology change events flow through `graph.topology` (not the data-plane delta protocol). Already validated.
- **Worker bridge:** rewire on a worker-bridged node remains undefined for now. Flag in DS-14 worker-bridge thread.
- **`restoreSnapshot mode: "diff"`:** snapshot diffs that include topology must use full graph rebuild path, not `_setDeps` (substrate is tactical, not snapshot-replay-grade). Flag in DS-14 restoreSnapshot thread.

### For canonical spec

Stub R3.3.1.1 cross-reference (Q5 = defer-with-stub). Full lock with DS-14.

### For follow-up spec session

Open: "subscribe to non-resubscribable terminal node delivers nothing" — universal foot-gun, not just for `_setDeps`. Filed in `docs/optimizations.md`.

## Real-consumer ergonomics validation (2026-05-04, post-/qa)

A 10-scenario test file ([src/__tests__/core/rewire-real-consumer.test.ts](../../src/__tests__/core/rewire-real-consumer.test.ts)) takes the substrate out of synthetic `[a, b, c]` shapes into realistic AI self-pruning patterns. Findings:

### What the substrate handles ergonomically (no friction)

- **Dropping a no-op stage:** `g._rewire("score", ["normalize"])` to skip a `trim` stage that's a no-op for current input. Output unchanged, audit clear, removed node stays registered (just off the data path). [Scenario A]
- **Tool swap with shape change:** `g._rewire("planner", ["toolSQL", "toolDocs"], { fn: newFn })` to swap a broken tool for one that emits a different shape. The `opts.fn` mechanism lets the AI atomically update the consumer's positional reads. [Scenario B]
- **Extending an existing node's deps:** `g._addDep("output", "validator", { fn: newFn })` to wire in an additional input + update the consumer fn to use it. Idempotent on existing deps. [Scenario C]
- **Removing a dep with shape collapse:** `g._removeDep("total", "tax", { fn: newFn })`. `data.length` shrinks; new fn knows about the new shape. [Scenario D]
- **External-driver pattern:** AI controller in the test code (or driver loop) reads `node.cache` and calls rewire. Clean, zero ceremony. [Scenario E]
- **Cascade isolation:** completing a pruned dep doesn't propagate to the consumer (full disconnect of removed deps holds end-to-end). [Scenario F]
- **Sequential rewires emit clean audits:** topology subscriber sees one `TopologyEvent { kind: "rewired", audit }` per call, with accurate `removed`/`added`/`kept` lists. [Scenario G]
- **`graph.observe` stays coherent:** observer subscription on a rewired node continues to receive values across the rewire — node identity is stable. [Scenario H]

### Foot-guns surfaced (real consumers must know)

**FG1 — Subscriber-driven rewire is rejected mid-fn (silent failure if uncaught).**

When a subscriber callback fires synchronously during the upstream's `actions.emit(...)`, the upstream's `_isExecutingFn === true`. If that subscriber calls `g._rewire(...)`, the substrate's mid-fn guard rejects with `"mid-fn topology mutation"`. If the caller doesn't catch the throw, it propagates into the upstream's `_execFn` catch and is wrapped+emitted as ERROR — silently breaking the caller's intent. [Scenario E2]

**Mitigation:** AI controllers must call rewire from OUTSIDE any subscriber callback that fires during fn-emit. The natural pattern: the outer driver loop reads state via `node.cache` or `graph.observe()`, decides, and calls rewire. The reactive way to express "auto-rewire on a condition" requires designing the controller as a separate node (which itself receives DATA from the metric node and calls rewire — but it must call rewire from a NON-subscriber path, e.g. via `setInterval` is forbidden by spec §5.10, so this currently has no clean reactive expression).

**Open design question for DS-14:** is there a clean reactive expression for "rewire when condition X holds"? Currently no — the substrate API is imperative because reactive triggers conflict with the mid-fn guard. May warrant a `ReactiveRewireGuard` factory or similar.

**FG2 — Shape-changing rewire silently misroutes positional reads. ✅ RESOLVED via required-fn lock (2026-05-04).**

Original finding: the substrate routes messages correctly (DepRecord-ref dispatch is sound), but the user fn is positional. If an AI rewired `score` from `[tens, ones]` to `[different, ones]` without supplying a new fn, the existing fn read `data[0]` thinking it's "tens" but got "different". Math valid, semantics wrong. [Scenario I]

**Resolution:** all three external-facing substrate APIs (`_setDeps`, `_addDep`, `_removeDep`) and their Graph wrappers (`_rewire`, `_addDep`, `_removeDep`) now take `fn` as a **required positional second argument**. Type system enforces it. Caller MUST acknowledge fn-deps pairing at every call site:

```ts
// Phase 13.8 LOCKED API:
g._rewire("score", ["different", "ones"], existingFn);  // explicit pass-through
g._rewire("score", ["different", "ones"], newFn);       // explicit new fn
g._rewire("score", ["different", "ones"]);              // type error — won't compile
```

The required-fn signature doesn't prevent the caller from passing the WRONG fn (the OLD fn for new shape) — but it forces the decision visible in the call site. Code review and AI-controller logs now show the pairing explicitly, which is the audit step we wanted. Scenario I in `rewire-real-consumer.test.ts` documents both paths: passing OLD fn for new shape (still 997, semantically wrong but visible) vs. passing fresh fn that handles the new semantics correctly (57).

`_addDepInternal` keeps `fn?` optional — autoTrackNode and `Graph.connect` use it as the no-checks/no-fn-change escape hatch (autoTrack discovery doesn't change fn).

### Audit/observation surface — real-consumer feedback

- `topology.subscribe(...)` audits are fully sufficient for an external auditor (e.g. a self-reflective AI logging its own topology mutations). The `removed`/`added`/`kept` lists are sorted lexicographically — stable for diff-comparison.
- `graph.observe(path)` returns `GraphObserveOne` (a sink-style API), not an async iterable. For async-iteration semantics the caller needs to pass `StructuredTriggers` options. **Doc gap:** the JSDoc/type signature could surface this more clearly — exploratory consumers may try `for await` and find it doesn't work.
- The audit `kept` list does NOT distinguish live vs terminal kept deps (FG3 / G2 pre-existing finding). Real consumers writing reflective AI loops would benefit from this distinction; defer to DS-14.

### Code-shape findings — what the API looks like in practice

The Graph-layer wrappers (`_rewire`, `_addDep`, `_removeDep`) read very naturally:

```ts
g._rewire("score", ["ingest"]);                          // simple bypass
g._addDep("output", "validator", { fn: newFn });         // extend + reshape
g._removeDep("total", "tax", { fn: newFn });             // strip + reshape
g._rewire("planner", ["sql", "docs"], { fn: newFn });    // full rewire + new fn
```

The single-underscore prefix (`_rewire` not `rewire`) is a friction point for real consumers writing AI controllers — it screams "don't use me" while we explicitly want them to. **Recommendation for DS-14 lock:** drop the underscore once stable. Until then the prefix correctly signals exploratory status.

### Verification

10 scenarios, all passing. Total suite: 2979 tests, lint clean, build green. The substrate API survives contact with realistic shapes; the foot-guns it has are documented and have clear mitigation paths.

---

## QA pass (2026-05-04, /qa skill)

Two parallel adversarial reviewers (Blind Hunter + Edge Case Hunter) surfaced ~25 findings. Triaged into 4 architectural decisions (resolved with user) and ~12 auto-applied fixes. Final state: 2969 tests passing, lint clean, build green.

**Architectural fixes from QA:**

1. **Q4 / B — `_addDep` split into `_addDepInternal` (no checks) + `_addDep` (full checks).** AutoTrackNode and `Graph.connect` use the internal path (bypass mid-fn / cycle / self-dep / terminal-`this` rejections — autoTrack runs from inside `_execFn` by design). `Graph._addDep` (Phase 13.8) and external callers use the full-check path. Symmetric with `_setDeps` and `_removeDep`. ([src/core/node.ts:1574-1771](src/core/node.ts:1574-1771))

2. **Q4 / A — `autoTrackNode` cache refactored from `Map<Node, number>` to `Map<Node, DepRecord>`.** With surgical Option C dispatch, kept-deps' indices may shift under `_setDeps`. Re-resolving the index per `track()` call via `_deps.indexOf(record)` matches the substrate dispatch pattern; the DepRecord ref is stable across reorders. ([src/core/sugar.ts:174-220](src/core/sugar.ts:174-220))

3. **Q4 / C — `_inDepMutation` reentrancy guard added across all three substrate APIs.** Set on entry, cleared in `finally`. Rejects synchronous re-entry from a push-on-subscribe DATA → downstream subscriber → re-call path. The TLA+ spec assumes single-step atomicity; this flag enforces that contract at the substrate boundary. ([src/core/node.ts:707-718](src/core/node.ts:707-718))

4. **Q4 / D — Orphan DIRTY downstream on subscribe-throw closed.** Previously `_setDeps` and `_addDepInternal` emitted `[DIRTY]` downstream BEFORE subscribing added deps; if `subscribe()` threw, downstream was permanently in `dirty` status (R1.3.1.a violation: DIRTY without follow-up DATA/RESOLVED). Now: subscribe-throw catches emit `[ERROR]` to close the wave deterministically before rethrowing. Rollback also drops failed records from `_deps` so subsequent `_setDeps` doesn't see them as kept-and-live. ([src/core/node.ts:1656-1697](src/core/node.ts:1656-1697), [:2080-2113](src/core/node.ts:2080-2113))

**Auto-applied fixes from QA:**

- `_activate` re-checks Q1 terminal-non-resubscribable for inactive-node race (dep transitions to terminal between declaration and first activation).
- `Graph._rewire` topology-emit wrapped in try/catch — substrate state is committed before audit emission; a throwing subscriber must not propagate an exception suggesting rollback.
- Mid-batch test wrapped in `batch(() => ...)` (was missing).
- Direct `_addDep` Q1 + cycle + self-dep + terminal-`this` + mid-fn tests added.
- Reentrancy guard test exercises the DIRTY-window path (where `_inDepMutation === true` but `_isExecutingFn === false`).
- "Idempotent" test name corrected from "full disconnect/resubscribe round-trip" (probe-variant leftover) to "no-op (kept deps untouched, fn does not re-fire)".
- `_addDep` JSDoc documents `opts.fn` `onRerun` timing and the autoTrackNode escape-hatch.

**Verified non-issues:**

- `_findNamePath` recursion was flagged as a stack-overflow risk; verified that `Graph.mount` already rejects mount cycles at registration ([graph.ts:2421-2427](../../src/graph/graph.ts:2421-2427)) — recursion can't encounter a cycle.
- TopologyEvent consumer exhaustiveness: 4 consumers (audit.ts, topology-tree.ts, graph.ts mount-walker, graph.ts observe-tree) all handle the new `"rewired"` variant correctly.
- TLA+ `wave_protocol_rewire.tla` spec is consistent with Option C lock; no spec-model corrections needed.

**Carried forward to gap follow-ups (not blocking Phase 13.8 close):**

- `Graph._rewire` audit `kept` reports terminal deps as "kept" (structurally retained, not live). Doc clarification.
- `_setDeps([])` silences downstream until rewire-back. Doc clarification.
- `<unregistered>` collapsing in audit `.sort()` when multiple foreign nodes are involved. Lossy but rare.
- Late-subscriber-to-terminal-node-delivers-nothing universal foot-gun — separate spec session.
- Multi-hop fn-fire propagation post-rewire TLA+ verification.

## What's not in this doc

- Performance characterization. Exploratory impl is correctness-only; no benchmarks. Rust M1 will own the perf story.
- ChangeSet/diff protocol interactions. Blocked on DS-14.
- Multi-hop fn-fire propagation post-rewire — covered analytically in design notes; full TLA+ verification is a deferred follow-up.
