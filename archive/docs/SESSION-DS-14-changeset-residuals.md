---
SESSION: DS-14-changeset-residuals
DATE: 2026-05-15
TOPIC: Gap-closure 9Q walk for the DS-14 changesets/diff substrate. Premise correction — DS-14 is NOT "designed, awaiting an implementation walk"; it is ~85% shipped (mutate factory, BaseChange + all per-structure unions incl. Spec/Ownership, mutationLog on map/list/log/index, scanLog, restoreSnapshot mode:"diff" + WAL replay via Phase 14.6 landed 2026-05-08). Three residuals remain; all change-payload types already exist in change.ts, only wiring/correctness is open. One is a real correctness bug vs the DS-14 Part-1 lock.
REPO: graphrefly-ts (substrate: @graphrefly/pure-ts data-structures, M5-aligned; presentation: src/base/composition/pubsub.ts)
SUPERSEDES: SESSION-DS-14-changesets-design.md "Phase 14.5 — lens.flow.mutations (~0.5 day) — drops in for free as a ReactiveMapBundle consumer" (premise invalidated — see R3).
---

## CONTEXT

The Session-2 task premise ("Phase 14 changesets / diff implementation walk — substrate already designed, needs implementation-walk session before Phase 14 opens", from the `SESSION-rust-port-layer-boundary.md` 2026-05-14 design-sessions-still-needed table) is **stale**. Verification against current code shows DS-14 substantially shipped:

| DS-14 phase | Status |
|---|---|
| 14.1 `mutate(act,opts)` (replaces lightMutation/wrapMutation, `down` hook, frames, audit) | ✅ [src/base/mutation/index.ts:218](../../src/base/mutation/index.ts:218) |
| 14.2 `BaseChange<T>` + per-structure unions + `SpecChange`/`OwnershipChange`/`GraphValueChange` + `lifecycle` | ✅ [change.ts](../../packages/pure-ts/src/extra/data-structures/change.ts) (177 lines) |
| 14.3 bundle `mutations`/`mutationLog` opt on map/list/log/index | ✅ wired on all 4 |
| 14.4 `reactiveLog.scan` + standalone `scanLog` | ✅ [log-ops.ts](../../packages/pure-ts/src/extra/data-structures/log-ops.ts) |
| (separate Q-O5/Q-O-WAL) `restoreSnapshot mode:"diff"` + WAL replay | ✅ Phase 14.6 landed 2026-05-08 (SESSION-DS-14-storage-wal-replay.md) |

Reframed (user-confirmed) as a **gap-closure walk** on the 3 confirmed-open residuals. Worker-bridge wire B is *correctly* absent — Q-O5 made it an explicit separate session, not part of this.

**Source material:**
- [SESSION-DS-14-changesets-design.md](SESSION-DS-14-changesets-design.md) (locked 2026-05-05; Q-O1…Q-O8b) — Part 1 TTL/LRU prune fidelity lock; Part 2 backend optionality
- [change.ts](../../packages/pure-ts/src/extra/data-structures/change.ts) — all payload types incl. `MapChangePayload.delete.reason: "expired"|"lru-evict"|"archived"|"explicit"`, `PubSubChange` (publish/ack/remove), `LensFlowChange` (tick/evict)
- [reactive-map.ts](../../packages/pure-ts/src/extra/data-structures/reactive-map.ts) — `NativeMapBackend` (TTL/LRU internal), reactive-layer `pushSnapshot`/`enqueueChange`/version-advance seam

---

## 9Q WALK — Unit: DS-14 Changeset Residuals (3 sub-residuals)

**Q1 — Semantics.** See CONTEXT. Residuals R1/R2/R3 below; all `change.ts` types pre-exist.

**Q2 — Correctness:**

- **R1 — TTL/LRU prune fidelity (REAL BUG vs DS-14 Part-1 lock).** `NativeMapBackend` owns TTL expiry + LRU eviction internally, exposing only `version: number`. Reactive layer ([reactive-map.ts:598-604](../../packages/pure-ts/src/extra/data-structures/reactive-map.ts:598)): `prev = backend.version; …op…; if (backend.version !== prev) pushSnapshot()`. `pushSnapshot` ([:516](../../packages/pure-ts/src/extra/data-structures/reactive-map.ts:516)) drains `pendingChanges` into `mutLog`; `enqueueChange` is called ONLY from explicit `set`(625/634)/`delete`(643/659)/`clear`(667)/`applyRetention`(573, `reason:"archived"`). **TTL prune (backend `get`/`has`/`pruneExpired`: `_store.delete(key); _version+=1` at :305/:317/:386) and LRU evict (`_evictLruWhileOver` :425-432) never call `enqueueChange`** — the backend has no reference to it (different layer). Read-time prune → `entries` snapshot emits correctly, `mutLog` gets **zero** records → `mutationLog` desyncs from `entries`; `changesSince`-equivalent stream diverges; worker-bridge Option-B receivers diverge. Exactly the failure DS-14 Part-1 locked against. Type already carries `reason:"expired"|"lru-evict"`; call sites missing.
- **R2 — pubsub `mutationLog` missing.** `PubSubChange` type exists (publish/ack/remove); [pubsub.ts](../../src/base/composition/pubsub.ts) (212 LOC) has zero `mutationLog` opt or wiring. DS-14 Part-2: "same opt on … pubsub."
- **R3 — `lens.flow.mutations` premise invalid.** DS-14 Phase-14.5: "drops in for free since lens.flow is itself a `ReactiveMapBundle`." FALSE — [lens.ts:216](../../src/utils/inspect/lens.ts:216) is a plain closure-mirror `new Map()` + `actions.emit(new Map(flowMap))` ([:264](../../src/utils/inspect/lens.ts:264)); [lens.ts:25](../../src/utils/inspect/lens.ts:25) confirms flow *was* a `ReactiveMapBundle` "Pre-Tier-5.3" and was refactored off it. "For free" justification gone.

**Q3 — Invariants.** 🟢 R1 fix (backend reports internal prunes upward via a drain the bundle owns) — no imperative trigger, rides the existing same-wave `pushSnapshot` batch. 🟢 R2 rides the existing `enqueueChange`+drain pattern. 🟢 R3 decline keeps the surface minimal.

**Q4 — Open items.** Tracked in `docs/optimizations.md` Active-work entry added this session.

**Q5 — Abstraction.** R1's right uniform shape: "backend surfaces *what/why* it pruned; bundle owns the log" — an additive `MapBackend` drain extending the existing `pendingChanges` pattern. Deliberately **not** the DS-14 Part-2 `changesSince(version)` route — Part-2 itself locked "native TS backends do NOT implement `changesSince` — bundle owns the log." A prune-record drain *reports*; it does not make the backend *own* a log, so the Part-2 contract is preserved.

**Q6 — Caveat.** R1 touches the `MapBackend` interface — a public substrate contract the **M5 Rust port consumes**. Optional `drainPruneRecords?()` is additive + Rust-aligned (Rust backend buffers prune records identically; `&mut` makes it natural). Custom backends that skip it simply don't get expired/lru records (documented; acceptable — same posture as Part-2's `changesSince?` optionality).

**Q7 — Perf/topology.** R1 fix A: O(1) per prune, **zero cost when `mutationLog` unset** (backend no-ops the buffer when the bundle didn't request it); no new node; `describe()` unchanged; rides existing `pushSnapshot` batch. (Rejected B — before/after `toMap()` diff — O(n) per prune-causing read, defeats DS-14's O(1) goal.)

**Q8 — Alternatives.** R1: (A) backend prune-record drain / (B) before-after toMap diff / (C) backend `changesSince`. R3: (A) hand-wire onto closure-mirror / (B) revert flow to ReactiveMapBundle / (C) decline-with-rationale.

**Q9 — Recommendation.** R1→A, R2→wire existing publish/ack/remove verbs, R3→C. User-locked below. Coverage: R1 closes the DS-14 Part-1 bug; R2 completes DS-14 Part-2 structure coverage; R3 records the invalidated premise so the stale "for free" claim can't mislead a future implementer.

---

## DECISIONS LOCKED (2026-05-15)

| ID | Decision | Rationale | Affects |
|---|---|---|---|
| **D-DS14R1** | **R1 fix = backend prune-record drain.** Add optional `drainPruneRecords?(): Iterable<MapChangePayload<K,V>>` to the `MapBackend` interface. `NativeMapBackend` buffers `{kind:"delete",key,previous,reason:"expired"}` on TTL prune (`get`/`has`/`pruneExpired`) and `{…reason:"lru-evict"}` on LRU evict (`_evictLruWhileOver`) — but only when the owning bundle configured `mutationLog` (backend told via a flag at construction, else the buffer is a no-op). Reactive layer drains it in the version-advance branch ([reactive-map.ts:598-604](../../packages/pure-ts/src/extra/data-structures/reactive-map.ts:598)) into `pendingChanges` before `pushSnapshot`. | Closes the DS-14 Part-1 desync bug. O(1), zero-cost when `mutationLog` unset, M5-Rust-aligned, honors Part-2 "bundle owns the log" (backend *reports*, doesn't own). | `packages/pure-ts/src/extra/data-structures/reactive-map.ts` (`MapBackend` interface, `NativeMapBackend`, reactive wrapper) |
| **D-DS14R2** | **R2 = wire pubsub `mutationLog` against the existing `PubSubChange` verbs** (`publish`/`ack`/`remove`). `mutationLog?: true \| {maxSize?,name?}` opt on `pubsub()` mirroring the other 3 structures; emit `publish` on publish, `ack` on cursor-ack, `remove` on topic removal, same-wave batch drain. Subscribe/unsubscribe are cursor state, NOT pool mutations → no change record. | Type already encodes intent (no new verbs); completes DS-14 Part-2 structure coverage; lifecycle:"data" framing matches the other structures. | `src/base/composition/pubsub.ts` |
| **D-DS14R3** | **R3 = decline `lens.flow.mutations` with rationale.** `lens.flow` is a diagnostic/observability surface (per [lens.ts](../../src/utils/inspect/lens.ts) purpose), not a data structure consumers replay. Drop the item from DS-14 active scope. Keep the `LensFlowChange` type (cheap, harmless, leaves the door open). Re-open ONLY if a real consumer needs flow-delta replay. The DS-14 Phase-14.5 "drops in for free (ReactiveMapBundle)" line is **invalidated** (post-Tier-5.3 closure-mirror refactor) and superseded by this doc. | "For free" premise is false; no consumer signal; hand-wiring a companion onto a pure inspection surface adds API for zero demonstrated need (cf. `feedback_no_imperative_wrap_as_primitive` minimalism posture). | doc-only (supersede note in SESSION-DS-14-changesets-design.md scope) |

---

## IMPLEMENTATION PHASING (gated on explicit user "implement" — per `feedback_no_implement_without_approval`)

1. **DS14R1 — prune-record drain (~1 day).** Extend `MapBackend` with `drainPruneRecords?()`; add a construction flag so the backend only buffers when `mutationLog` is configured; buffer `delete{reason:"expired"}` at the three TTL-prune sites + `delete{reason:"lru-evict"}` in `_evictLruWhileOver`; drain into `pendingChanges` in the version-advance branch before `pushSnapshot`. Tests: TTL-expiry-on-read and LRU-evict-on-set each produce a matching `MapChange` in `mutationLog` AND a consistent `entries` snapshot in the same wave; replay of `mutationLog` reconstructs `entries` exactly (the desync regression test).
2. **DS14R2 — pubsub mutationLog (~0.75 day).** `mutationLog` opt + publish/ack/remove emission + same-wave drain mirroring reactive-map's `pushSnapshot` shape. Tests: publish/ack/remove each append the typed `PubSubChange`; subscribe/unsubscribe do not.
3. **DS14R3 — doc supersede (~0.1 day).** Add a one-line supersede note to `SESSION-DS-14-changesets-design.md` Phase-14.5 lens.flow line pointing here; no code.

Total ~1.85 days. Worker-bridge wire B remains a separate session (Q-O5) — out of scope.

## RUST-PORT ALIGNMENT

R1 is the load-bearing one for M5. `MapBackend` is the substrate contract `graphrefly-structures` (M5, `imbl`-backed) must honor. `drainPruneRecords?()` maps cleanly: the Rust backend buffers a `Vec<MapChangePayload>` on internal TTL/LRU prune and the bundle drains it under the per-subgraph mutex — `&mut` ownership makes the retain/release discipline automatic (no refcount gymnastics). The optionality posture matches Part-2's `changesSince?` — CRDT backends (yrs/automerge/loro, post-1.0) that have native delta history can implement `changesSince` and short-circuit; native backends implement only the narrow `drainPruneRecords`. R2/R3 are presentation-side, no Rust impact.

## FILES CHANGED (this session — documentation only)

- **New:** `archive/docs/SESSION-DS-14-changeset-residuals.md` (this file)
- **Edit:** `docs/optimizations.md` — Active-work entry for DS14R1/R2/R3
- **Edit:** `archive/docs/design-archive-index.jsonl` — append index entry
- **Deferred to implementation phases:** `packages/pure-ts/src/extra/data-structures/reactive-map.ts`; `src/base/composition/pubsub.ts`; supersede note in `SESSION-DS-14-changesets-design.md`

### Verification snapshot
- **✅ IMPLEMENTED + QA-passed 2026-05-15.** DS14R1 (`drainPruneRecords`), DS14R2 (pubsub `mutationLog`; QA P3 fixed `removeTopic` to record-before-TEARDOWN), DS14R3 (doc supersede) all landed. Gates: pure-ts 1172/1172, pubsub 21/21, biome-clean.
