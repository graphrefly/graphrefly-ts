# Session — Graph Module 24-Unit Review

**Date:** 2026-04-16
**Scope:** `src/graph/` — `graph.ts` (2721 lines), `codec.ts`, `profile.ts`, `sizeof.ts`, `index.ts`
**Format:** Per-function walkthrough (implementation, ecosystem counterparts, alternatives, open items, pros/cons, stress scenarios including message-tier handling)
**Precedent:** Same format as `SESSION-extras-wave1-audit.md` — continued from extras review into graph-container layer

---

## Why this review

User wanted to validate the Graph container layer against:
- v5 foundation redesign invariants (P2 signal/data split, P3 no cross-node inspection, P4 START handshake, P6 tier-based unification)
- Central config singleton pattern established in Unit 2
- Pre-1.0 simplification opportunity (no backward-compat shim needed)
- The extras review had surfaced multiple "hardcoded message type check" violations and escape-hatch patterns; the same theme was expected in graph.ts

Review was scoped to 24 units covering all of `src/graph/` plus adjunct files.

---

## Unit ordering

Waves A–H, 24 units total, walked sequentially:

| Wave | Units | Topic |
|---|---|---|
| A | 1–2 | Identity & lifecycle foundation (path helpers, constructor, setVersioning) |
| B | 3–6 | Registry CRUD (add, remove, node/get/set, mount) |
| C | 7–9 | Wiring & resolution (connect/disconnect/edges, resolve, signal) |
| D | 10–16 | Introspection (describe, observe, dumpGraph, resourceProfile, trace, static diff, reachable) |
| E | 17–19 | Persistence (snapshot/toJSON, restore/fromSnapshot, autoCheckpoint) |
| F | 20 | Diagram rendering (toMermaid, toD2) |
| G | 21–22 | Lifecycle + factories (addDisposer/destroy, registerFactory) |
| H | 23–24 | Adjunct files (codec.ts, sizeof.ts) |

---

## Graph layer role — locked in

Clarified during Unit 4 discussion, confirmed throughout:

- **Managing** — registry (add/remove/node/get/set), mount, lifecycle cascade (TEARDOWN), control signal broadcast.
- **Introspection** — describe/observe/diff/trace/resourceProfile/reachable/diagrams.
- **Persistence** — snapshot/restore/fromSnapshot/autoCheckpoint.

**Message flow is never Graph's concern** — it follows construction-time `_deps` via node subscriptions. Graph is pure encapsulation on top of already-wired nodes. Nodes are standalone protocol objects; they work without a Graph (most core tests use bare nodes).

---

## Key semantic correction (Unit 5)

**v5 SENTINEL semantics tightened:** `undefined` is reserved globally as the SENTINEL value. Valid DATA type is `T | null` only. This means `.cache === undefined` IS a valid sentinel guard.

- Updated `memory/feedback_guard_patterns.md` and `MEMORY.md` index (stale pre-v5 guidance replaced).
- Flagged stale docstring at [src/core/node.ts:247](src/core/node.ts:247) that still says "undefined and null are valid cached values" — inconsistent with lines 309/585/590 which correctly treat `undefined` as sentinel. Reconcile.

---

## Decisions — Wave A (in-place cleanup, touches most units)

Single cohesive batch landing across multiple files:

1. **Path/naming foundation (Unit 1)** — forbid tab and control chars in names (closes edge-key collision); unify `assertLocalName`/`assertNoPathSep`/`assertNotReservedMetaSegment` into single `assertRegisterableName`; inline meta-filter fast path; stronger edge-key separator.
2. **Config-driven meta-filter (Unit 1+9)** — replace hardcoded `META_FILTERED_TYPES = {TEARDOWN, INVALIDATE, COMPLETE, ERROR}` with per-type `metaPassthrough` flag on `GraphReFlyConfig.registerMessageType`. Eliminates spans-three-tiers-hardcoded anti-pattern.
3. **Typed `GraphOptions` (Unit 2)** — `{versioning?, config?, factories?, [key: string]: unknown}`. Open index signature keeps `unknown` for extensions. `Object.freeze(opts)` in constructor.
4. **Central config singleton (Unit 2)** — `Graph` references `defaultConfig` from `core/node.ts`, never defines its own. Delete `_defaultVersioningLevel` field. Keep `setVersioning` as thin bulk-apply helper (no default-for-future semantic).
5. **Graph name meta-segment guard (Unit 2)** — reject `new Graph("__meta__")`.
6. **`inspectorEnabled` on config (Units 11/14)** — move from `Graph.inspectorEnabled` static to `GraphReFlyConfig.inspectorEnabled` (freeze-on-read like other hooks). Default `NODE_ENV !== "production"`.
7. **`describe`/`observe` graceful degrade (Unit 11)** — when inspector disabled, extras (causal/derived) silently fall back instead of throwing on `expand()`.
8. **Node SENTINEL docstring fix (Unit 5)** — [node.ts:247](src/core/node.ts:247) reconciled with lines 309/585/590.
9. **`autoCheckpoint` tier read (Unit 19)** — use `this.config.messageTier` not `defaultConfig.messageTier`.
10. **Exclude TEARDOWN from autoCheckpoint trigger (Unit 19)** — tier `>= 3 && < 5` gate; TEARDOWN (tier 5) shouldn't schedule saves on graph death.

---

## Decisions — Structural simplifications

Breaking changes enabled by pre-1.0 status. Six major simplifications:

### Delete edge registry entirely (Unit 7 — the big one)

**Motivation discovered empirically:** grepped all 30+ `connect()` call sites across `patterns/*.ts` and `domain-templates.ts`. Not a single one triggers the `_addDep` path. Every site is redundant-with-construction (deps declared at node construction → `add` auto-registers the edge → `connect` runs `_addDep` check, finds dep already there, just touches `_edges`).

- `Graph._edges: Set<string>` — delete.
- `Graph.connect(from, to)` — delete.
- `Graph.disconnect(from, to)` — delete (was registry-only; created runtime/introspection desync lies).
- `add`'s forward/reverse edge-scan code — delete.
- `remove`'s edge cleanup loops — delete.
- `fromSnapshot`'s edge replay loop — delete.

**Replaced by:** `Graph.edges(opts?)` → derived on-demand from `_deps` + `_mounts` walk. `scanEdges(graph, opts?)` free helper with version-counter cache (increment counter on `add`/`remove`/`mount`/`unmount`/`_addDep`).

**Enables:** `autoTrackNode` runtime-discovered deps now show up correctly in introspection — counter bumps on `_addDep`, next `edges()` call re-scans.

### Delete dead resolver family (Unit 8)

Post-Unit-7, `_resolveEndpoint`, `_resolveEndpointFromSegments`, `_resolveMetaEndpointKeys` are unreachable (sole callers were connect/disconnect). Delete all three (~75 lines).

### Fold `dumpGraph` into `describe` (Unit 12)

`describe({format: "pretty" | "json"})` subsumes `dumpGraph`. Default detail becomes `"minimal"` to match describe/observe consistency.

### Fold `toMermaid`/`toD2` into `describe` (Unit 20)

`describe({format: "mermaid" | "d2"})` — same format dispatch. Drop `toMermaid`/`toD2` as separate methods. Shared `buildDiagramModel(described)` helper.

### Drop `toObject`/`toJSONString` (Unit 17)

- `snapshot()` — primary data access API with `{format, sparse, actor}` options.
- `toJSON()` — ECMAScript hook only (required so `JSON.stringify(graph)` works). Always returns snapshot object.
- `toObject()` — delete (alias for `snapshot()`).
- `toJSONString()` — delete (no sugar; callers who want stable text use `snapshot({format: "jsonString"})` if that option is added, else `JSON.stringify(graph)` suffices).

### Delete static factory registry (Unit 22)

Per Unit 7 + Unit 18, factories move from process-global static state to `fromSnapshot(data, {factories})` per-call parameter.

- `Graph._factories: Array<...>` — delete.
- `Graph.registerFactory(pattern, factory)` — delete.
- `Graph.unregisterFactory(pattern)` — delete.
- `Graph._factoryForPath(path)` — delete.
- `Graph._ownerForPath(root, path)` — move to module-level helper (per Unit 18 J).

**Closes:** test-isolation hazard flagged in Unit 2 §5 F.

---

## Decisions — Extractions

Two shared utility modules to create:

### `extra/utils/ring-buffer.ts` (Units 14 + 24 concluded)

**Three independent ring-ish implementations found in the repo:**

1. `graph.ts:307` `RingBuffer<T>` class (we've been reviewing).
2. `extra/reactive-log.ts:160+` `NativeLogBackend` — its own inline `_head` + modular arithmetic. Duplicate impl.
3. `extra/reactive-sink.ts:389–402` — uses `buffer.push(entry); buffer.shift()` for drop-oldest. **O(n) shift per drop — perf bug.**

Plus Unit 11 alt F (observe `events` ring buffer) would be a fourth use site.

**Action:** extract `RingBuffer<T>` to `extra/utils/ring-buffer.ts`. Migrate all three sites. Fixes the reactive-sink O(n) → O(1). Pairs with Unit 14 configurable capacity.

### `extra/utils/sizeof.ts` (Unit 24)

Move from `src/graph/sizeof.ts` to `src/extra/utils/sizeof.ts` — shared with reactive data structure profiling, pattern-layer profiles. Add:
- Common class type coverage (Date, RegExp, Error, URL).
- BigInt scaled estimate.
- Iterative walk (no stack-overflow on deeply nested values).
- Try/catch per-key (protect against throwing getters).
- Shared-buffer dedup (Unit 13 alt I resurrected).
- `Symbol.for("sizeof")` hook for user-defined sizes.
- Export `OVERHEAD` constants.

---

## Decisions — Per-unit batches (post Wave-A)

Unit-by-unit short-term batches executed:

| Unit | Method(s) | Batch |
|---|---|---|
| 1 | Path helpers / `filterMetaMessages` | F+G+H+I + config `metaPassthrough` |
| 2 | Constructor / `setVersioning` | A+C+G + remove `_defaultVersioningLevel`, `setVersioning` thin helper |
| 3 | `add` | B (WeakMap `_nodeToName`) + E (return node) + H (reject torn-down) |
| 4 | `remove` | A+C+D+E+G+H+I |
| 5 | `node`/`get`/`set` | A+C+D+H |
| 6 | `mount` | A+B+C+D+E+G(warn) |
| 7 | `connect`/`disconnect`/`edges` | **Delete all; derive `edges()` via `scanEdges()`** (see above) |
| 8 | `resolve` + meta internals | A (delete dead family) + B (resolution cache) + D (`tryResolve`) + E (normalize self-name) + H (iterative refactor) |
| 9 | `signal` | A+B+C+F+G + resilience try/catch |
| 10 | `describe` | A+B+E+F+K + iterative meta walk + filter try/catch |
| 11 | `observe` + fallbacks + format logger | A+B+C+D+E+F+G+I+J+K+L+M |
| 12 | `dumpGraph` | **Fold into describe(format)** + default minimal + colorize + versioning/meta in pretty + cyclic/BigInt try/catch |
| 13 | `resourceProfile` + `profile.ts` | A+B+C+D+E+G+H + optimizations.md status update |
| 14 | `trace` + RingBuffer | A+B+C+D+E+F+G+K + **extract RingBuffer** |
| 15 | static `diff` | A (deep-equal) + B + C + D + F + G + I + sentinel field |
| 16 | `reachable` | A+B+C+D+E+F |
| 17 | `snapshot` / `toJSON` / `toObject` / `toJSONString` | **Drop toObject + toJSONString; keep snapshot primary + toJSON ES hook** + B+C+E+G (CBOR via codec.ts) |
| 18 | `restore` / `fromSnapshot` | A+B+C+D+E+F+H+J+K+N |
| 19 | `autoCheckpoint` | A+B+C+E+F+G+H+J+K+N |
| 20 | `toMermaid`/`toD2` | **Fold into describe(format)** + A+B+C+D+E+G+H+I+K |
| 21 | `addDisposer`/`destroy` | A+B+C+D+E+F+G+H+J |
| 22 | `registerFactory` family | **Delete all** (see above) |
| 23 | `codec.ts` | A+B+C+D+E+H+J+K+L+M |
| 24 | `sizeof.ts` | A+B+C+D+E+G + **extract to utils** + K |

---

## Added to active batch (2026-04-16 follow-up)

**V0 version-counter shortcuts across diff, autoCheckpoint, fromSnapshot** — per `SESSION-serialization-memory-footprint.md:205` recommendation, promote NodeV0 from Phase 6 to Phase 3.x as prerequisite. Enables:

- `Graph.diff(a, b)` fast-path skip when both snapshots carry matching `v.id` + `v.version` for each node (Unit 15 V0 fast path was partial; now graph-wide).
- `autoCheckpoint` skips redundant writes when graph-level version counter unchanged.
- `fromSnapshot` hydration shortcut when version matches live state (no-op restore).

Implementation: ensure every node that participates in persistence has `v` metadata; thread version counter through describe output; consume in diff/autoCheckpoint/fromSnapshot. Pairs naturally with `scanEdges` version counter from Unit 7 edge-registry deletion.

## Landed post-hoc (2026-04-17 follow-up batches)

The two biggest "deferred" items from this review were executed after the main batches with design decisions locked up-front. Both landed against the specs that follow.

### Persistence unification → `graph.attachStorage(tiers)` (landed 2026-04-17)

Collapsed `Graph.autoCheckpoint` + `AutoCheckpointAdapter` + `extra/checkpoint.ts` + `tieredStorage` into one `StorageTier` primitive. Q&A decisions locked before execution:

| # | Decision |
|---|---|
| Q1 | `save(key, record): void \| Promise<void>` — dual return. Sync tiers stay zero-microtask; callers awaiting a non-Promise get a no-op. |
| Q2 | `tieredStorage` deleted. Users call `cascadingCache(tiers)` directly. |
| Q3 | `*CheckpointAdapter` classes deleted. Replaced with factory fns: `memoryStorage()`, `dictStorage(obj)`, `fileStorage(dir)`, `sqliteStorage(path)`. Matches extra/ convention. |
| Q4 | `indexedDbStorage(spec): StorageTier` added as async tier. `saveGraphCheckpointIndexedDb` / `restoreGraphCheckpointIndexedDb` deleted. `fromIDBRequest` / `fromIDBTransaction` kept (Wave 5 reactive sources, different layer). |
| Q5 | Both `Graph.fromStorage(name, tiers)` (cold boot) and `attachStorage(tiers, {autoRestore: true})` (hot attach). Shared `_cascadeRestore` helper. |
| Q6 | Per-tier `{lastSnapshot, lastFingerprint}`. `graph.snapshot()` memoized per-event across sync tiers; debounced tiers compute their own on timer fire. |

Session log for the storage work: prior Q&A answered and captured above. Delivered surface in `extra/storage.ts` + `graph/graph.ts` + `core/config.ts`. 1634 tests pass post-landing.

### Codec wire-protocol maturation → envelope + registry (landed 2026-04-17)

Bundled Unit 17 G (CBOR snapshot option) + Unit 23 J+K (codec versioning + binary envelope) + Unit 11 M adjacent type tightening. Q&A decisions locked before execution:

| # | Decision |
|---|---|
| Q1 | Registry on `GraphReFlyConfig` — `registerCodec` / `lookupCodec`, freeze-on-read (matches message-type registry). |
| Q2 | Envelope v1: `[envelope_v=1:u8][name_len:u8][name:utf8][codec_v:u16 BE][payload:rest]`. Skip timestamp/producer_id; defer to v2. |
| Q3 | `GraphCodec.version: number` required. Pre-1.0 breaking (zero external callers). `decode(buf, codecVersion?)` — codec dispatches on historical layouts. |
| Q4 | `negotiateCodec` deleted. Zero callers; envelope self-describes on the read side. YAGNI for write-side peer negotiation until peerGraph lands. |
| Q5 | `snapshot()` overloads: no arg → object; `{format: "json-string"}` → string; `{format: "bytes", codec: name}` → `Uint8Array`. `"json-string"` name (not `"json"`) to avoid conflict with `describe({format: "json"})`. |
| Q6 | Scope bounded to: registry on config + `snapshot({format})` + `Graph.decode(bytes)`. WAL records / `GraphCheckpointRecord` stay as JS objects; envelope is a boundary format only. |

Delivered surface in `codec.ts` (`encodeEnvelope` / `decodeEnvelope` / `registerBuiltinCodecs`) + `graph.ts` (`Graph.decode` static + `snapshot({format})` overloads) + `core/config.ts` (`_codecs` map).

## Deferred — separate sessions

Tracked in `docs/optimizations.md` for future sessions:

1. **Codec lazy decode + eviction policy** (Unit 23 F + G) — post-1.0. `LazyGraphCodec.decodeLazy` Proxy-backed nodes record; dormant subgraph serialization + release. Pairs with `attachStorage` cold-tier work.

2. **Reactive-operator rewrite of `attachStorage`** (supersedes Unit 19 D) — rewrite the observe/debounce/flush pipeline as composable operators. Blocked pending a "sample" operator or lives inside the storage subsystem.

3. **Streaming snapshot for huge graphs** (Unit 17 L, Unit 23 N) — async iterable yielding sections. Low priority; deferred post-1.0.

4. **Observe tier-surfacing gaps** — INVALIDATE/PAUSE/RESUME/TEARDOWN event variants on the discriminated `ObserveEvent` union. Small, self-contained; blocked on nothing.

---

## Open design questions (unresolved, surfaced for future decision)

1. **Unit 18 O — producer in restore.** Reactive semantics: producers recompute. Restoring their value overrides what the fn would compute. Safer default = skip producer alongside derived/effect. **But some audit use cases legitimately want producer values round-tripped.** Needs explicit policy call.

2. **Unit 9 H — primary vs meta filter asymmetry.** Today primaries get the unfiltered batch while meta gets the filtered batch. Alt H proposes always-filtered (symmetric). Needs TEARDOWN cascade audit before committing.

3. **Unit 21 — disposer added during disposer iteration.** Current: spread copy means new disposers added during drain are NOT run this round. Either document or redesign.

4. **Unit 11 observe tier-surfacing gaps** — INVALIDATE, PAUSE, RESUME, TEARDOWN are not surfaced as observe events. Should any of them be?

---

## What changed outside graph/

- **Memory note updated:** `memory/feedback_guard_patterns.md` — v5 SENTINEL semantics. Index entry in `memory/MEMORY.md` updated.
- **Optimizations doc:** added storage unification item to `docs/optimizations.md`.
- **Stale docstring flagged:** `src/core/node.ts:247` for reconciliation.

---

## Outcome / status

- Review complete for all 24 units.
- Execution: Wave A + structural simplifications + extractions approved for implementation.
- Deferred items logged in `docs/optimizations.md`.
- Open design questions surfaced; not resolved this session.

---

## Related files

- `src/graph/graph.ts`, `src/graph/codec.ts`, `src/graph/profile.ts`, `src/graph/sizeof.ts`, `src/graph/index.ts`
- `src/core/node.ts:247` (docstring reconciliation)
- `src/core/config.ts` (add `metaPassthrough` flag, move `inspectorEnabled`)
- `src/extra/reactive-log.ts`, `src/extra/reactive-sink.ts` (RingBuffer migration targets)
- `src/extra/cascading-cache.ts`, `src/extra/checkpoint.ts` (storage unification scope)
- `docs/optimizations.md` (persistence unification item added)
- `memory/feedback_guard_patterns.md`, `memory/MEMORY.md` (v5 SENTINEL update)
- `archive/docs/SESSION-extras-wave1-audit.md` (precedent)
- `archive/docs/SESSION-foundation-redesign.md` (v5 invariant source)
- `archive/docs/SESSION-serialization-memory-footprint.md` (codec + V0 design reference)
- `archive/docs/SESSION-snapshot-hydration-design.md` (autoCheckpoint design reference)
- `archive/docs/SESSION-inspection-consolidation.md` (describe/observe/trace/diff/reachable consolidation reference)
