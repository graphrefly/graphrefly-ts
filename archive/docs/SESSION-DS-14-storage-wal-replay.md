---
SESSION: DS-14-storage-wal-replay
DATE: May 8, 2026
TOPIC: `restoreSnapshot mode:"diff"` WAL replay semantics — frame format, replay ordering, recovery boundary, codec contract, `BaseStorageTier.listByPrefix` extension, Rust-port deferral fence, §8.7 spec amendment fold-in. Locks the storage-tier API shape that Rust port M4 needs as a stable target.
REPO: graphrefly-ts (TS-primary; Rust port M4 substrate-aligned)
PARENT: [SESSION-DS-14-changesets-design.md](SESSION-DS-14-changesets-design.md) Phase 14 substrate. Deferred at [DS-14:312](SESSION-DS-14-changesets-design.md:312).
---

## PART 1: CONTEXT

DS-14 ([2026-05-05](SESSION-DS-14-changesets-design.md)) locked the universal `BaseChange<T>` envelope, `mutations` companion, `mutate(act, opts)` factory, and `restoreSnapshot mode:"diff"` lifecycle filter. Two follow-ons carved out as separate sessions:

1. Worker-bridge Option B wire protocol — separate session; pre-locked wire shape.
2. **`restoreSnapshot mode:"diff"` WAL replay (this session)** — depended on `BaseStorageTier.listByPrefix` extension + §8.7 spec amendment.

Rust-port migration ([SESSION-rust-port-architecture.md:240](SESSION-rust-port-architecture.md:240)) treats M4 (`graphrefly-storage` crate) as the home for ACID-tier hardening (`redb`), high-throughput WAL replay, content-addressed snapshots. Per Phase 14 STRONG DEFER ([implementation-plan.md:1542](../../docs/implementation-plan.md:1542)) the *rigor* lands Rust-side; the *user contract + frame format + replay ordering* lands TS-side now so M4 has a stable target.

Already-shipped TS pieces this session locks against:
- `SnapshotStorageTier<T>` ([packages/legacy-pure-ts/src/extra/storage/tiers.ts:197](../packages/legacy-pure-ts/src/extra/storage/tiers.ts:197)).
- `GraphCheckpointRecord` discriminating `mode:"full" | "diff"` ([graph.ts:552](../packages/legacy-pure-ts/src/graph/graph.ts:552)).
- `attachStorage` streaming snapshots + computing diffs ([graph.ts:5046](../packages/legacy-pure-ts/src/graph/graph.ts:5046)).

What's missing: history persistence + replay path + `listByPrefix` + INVALIDATE persistence + the §8.7 amendment.

**Source material:**
- [DS-14:312](SESSION-DS-14-changesets-design.md:312) — implementation-phasing carve-out.
- [DS-14:208–239](SESSION-DS-14-changesets-design.md:208) — lifecycle scopes + cross-scope ordering already locked.
- [DS-14.5-A:86](SESSION-DS-14.5-A-narrative-reframe.md:86) L5 — L0–L3 ownership staircase that rides the WAL.
- [implementation-plan.md:919](../../docs/implementation-plan.md:919) — `attachStorage` INVALIDATE persistence + §8.7 amendment (folded in here).
- [implementation-plan.md:589](../../docs/implementation-plan.md:589) §10.6 — `restoreSnapshot rejects mode:"diff"` (unblocked).
- [optimizations.md:335](../../docs/optimizations.md:335) — original `listByPrefix` / `readWAL` shape gesture from §9.3 /qa.
- [SESSION-rust-port-architecture.md:250](SESSION-rust-port-architecture.md:250) — M4 deferral fence.

---

## PART 2: L-LOCKS PRE-WALK

| # | Lock |
|---|---|
| **L1** | TS impl ships the *user contract + frame format + replay ordering*; Rust M4 ships the *ACID rigor*. Fence stays clean. |
| **L2** | `restoreSnapshot mode:"diff"` user surface stays IDENTICAL across TS / Rust impls; parity tests at `packages/parity-tests/scenarios/storage-wal/` gate divergence at M4 close. |
| **L3** | `WALFrame<T>` extends DS-14's bridge wire format `{ t:"c", lifecycle, path, change }` with on-disk-only fields — bridge wire format remains the schema-narrowed subset. |
| **L4** | DS-14's cross-scope replay ordering `spec → data → ownership` is taken as given; this session locks within-lifecycle and partial-restore semantics on top. |
| **L5** | §8.7 spec amendment FOLDED into this session per user request. Six sub-sections drafted; INVALIDATE persistence resolved as natural consequence of Q1+Q2+Q3. |

---

## PART 3: Q1–Q9 9Q WALK (2026-05-08)

### Q1 — On-disk WAL frame format

**Options:**
- (a) Reuse the bridge wire format verbatim: `{ t:"c", lifecycle, path, change }`. No on-disk additions.
- (b) Augment with one monotonic counter: bridge fields + `frame_seq`.
- (c) Augment with persistence-tier fields: bridge fields + `frame_seq` + `frame_t_ns` + BLAKE3 `checksum`.
- (d) Augment with persistence-tier fields PLUS per-frame `codec_version` hint for in-stream codec switching.

**Lock: (c).**

```ts
interface WALFrame<T = unknown> {
  readonly t: "c";                                          // bridge tag
  readonly lifecycle: "spec" | "data" | "ownership";        // DS-14
  readonly path: string;
  readonly change: BaseChange<T>;                           // DS-14 envelope (carries change.seq, change.t_ns, change.version)
  readonly frame_seq: number;                               // WAL-level monotonic; distinct from change.seq
  readonly frame_t_ns: number;                              // wall-clock at write time; distinct from change.t_ns
  readonly checksum: Uint8Array;                            // 32-byte BLAKE3 over frame body (torn-write detection)
}
```

Reasoning:
- (a) breaks under multi-bundle tiers — bundle A and bundle B independently bump `change.seq` from 1; replay can't order them. WAL needs its own cursor.
- (b) adds `frame_seq` but punts on torn-write detection; under best-effort cross-tier atomicity (Phase 14 STRONG DEFER §1542), no checksum = no way to drop partial trailing frames safely. Required.
- (d) per-frame codec hint adds 4–8 bytes/frame and complicates replay (every frame needs codec dispatch); offers no concrete win — codec migration via baseline rewrite (Q4) handles the case cleanly. Rejected.
- `frame_seq` ≠ `change.seq`: latter is bundle's `mutations` cursor (DS-14 T1); former is the WAL tier's own cursor. Replay matches on `frame_seq` for ordering; on `change.seq` only for bundle-level cursor restoration.
- `frame_t_ns` ≠ `change.t_ns`: latter is mutation-entry wall clock; former is WAL-write wall clock. Under debounced tiers they differ by `debounceMs`. Forensics + drift-detection want the latter.

### Q2 — Replay ordering + partial-restore semantics

**Options:**
- (a) Within a lifecycle, order by `change.seq`; cross-scope per DS-14 (`spec → data → ownership`); on phase failure, abort the entire restore (atomic all-or-nothing).
- (b) Within a lifecycle, order by `frame_seq`; cross-scope per DS-14; on phase failure, roll back the failed phase's `batch()` only — earlier phases stay committed; surface `RestoreError("phase-failed")`.
- (c) Within a lifecycle, order by `change.t_ns`; cross-scope per DS-14; partial-restore as (b).

**Lock: (b).**

Reasoning:
- (a) `change.seq` collides across bundles in the same lifecycle (multiple bundles, multiple cursors) — can't form a total order. Atomic-all rolls back too aggressively for users who narrowed `lifecycle` filter. Rejected.
- (c) `change.t_ns` collides under sync-through tiers (multiple frames same nanosecond on fast paths) and under debounced tiers (frames written out-of-order relative to mutation time). Rejected.
- (b) `frame_seq` is uniquely owned by the WAL tier writer; total-order guaranteed.
- Partial-restore: per-phase `batch()` transactions match DS-14 L0 substrate rollback (batch-frame discard on throw). Failed phase rolls back; earlier phases' commits stay. User gets `RestoreError("phase-failed", { lifecycle, frame_seq, error })` and chooses recovery (narrower `lifecycle` filter, different `targetSeq`).
- `atomicAllPhases?: boolean` knob deferred — recommended `false` default. Default falls out of per-phase `batch()` rollback for free; the `true` variant adds API surface without a concrete consumer. Revisit if a real need surfaces.

### Q3 — Recovery boundary + torn-write handling

**Options:**
- (a) Last-checkpoint-only: recover from most recent `mode:"full"` baseline; ignore WAL tail. (Today's behavior.)
- (b) Last-checkpoint-or-WAL-tail: baseline + replay all WAL frames after baseline; on torn-write at tail → drop frame, log warning, continue; on torn-write mid-stream → abort.
- (c) Last-checkpoint-or-WAL-tail with forward-recovery: baseline + replay; on ANY torn frame → skip and continue (best-effort forward recovery).

**Lock: (b).**

Reasoning:
- (a) is today's stub — defeats the purpose of `mode:"diff"` records.
- (c) skipping mid-stream torn frames silently corrupts replay (downstream frames depend on the skipped one's state). Forward recovery requires frame-level idempotence guarantees that `BaseChange<T>` does NOT make. Defer to M4 with `redb` transaction wrapping.
- (b) catches the common case (process crash mid-write at WAL tail; FS partial flush; network truncation). Drop-tail policy is safe because no later frame depends on the dropped trailing frame. Mid-stream corruption signals a deeper integrity failure that demands user attention.
- BLAKE3 checksum (Q1) is the detection mechanism. JSDoc on `restoreSnapshot({ mode:"diff" })` MUST loud-document the best-effort caveat — strict cross-tier atomicity is M4-side (Phase 14 STRONG DEFER §1542).
- Default `compactEvery: 10` retained ([graph.ts:5067](../packages/legacy-pure-ts/src/graph/graph.ts:5067)). Auto-tuning (compact when cumulative diff bytes > full-snapshot bytes × threshold) defers to M4.

### Q4 — Codec on disk

**Options:**
- (a) `jsonCodec` only — no codec dispatch on the WAL path.
- (b) `jsonCodec` default; `DagCborCodec` opt-in; `cborCodec` opt-in. Tier-level (one tier → one codec).
- (c) Per-frame codec hint (`codec_version` field) so a single tier can mix codecs on the wire.
- (d) `DagCborCodec` default (content-addressing for free); `jsonCodec` opt-in for human-readable WALs.

**Lock: (b).**

Reasoning:
- (a) blocks content-addressed scenarios — DagCbor + BLAKE3 CIDs are how snapshots become first-class IPLD documents ([SESSION-rust-port-architecture.md:301](SESSION-rust-port-architecture.md:301)). Future `peerGraph(transport)` needs content-addressing. Rejected.
- (c) handled in Q1 — adds bytes-per-frame and replay complexity for no concrete win. Codec migration goes via baseline rewrite: when the tier swaps codecs, the next `mode:"full"` baseline writes with the new codec; everything before that baseline gets re-encoded into the new baseline at compaction time. Same precedent `format_version` already exercises.
- (d) raises the bar for default storage to require the full IPLD ecosystem — too much weight on the default path. JSON is the right "just works" default; content-addressing is opt-in for users who want CIDs.
- (b) is what already ships ([tiers.ts:140](../packages/legacy-pure-ts/src/extra/storage/tiers.ts:140) `defaultTierOpts.codec = jsonCodec`). Locked here means: don't change the default; tier-level uniformity stays; mixed codecs in a single WAL rejected at restore with `RestoreError("codec-mismatch", { frame_seq, expected, found })`.
- `format_version` ([graph.ts:556](../packages/legacy-pure-ts/src/graph/graph.ts:556)) extended to `WALFrame` per-tier (frames in one WAL share a version; cross-version restore migrates at the boundary).

### Q5 — `BaseStorageTier.listByPrefix` extension shape

**Options:**
- (a) Eager: `listByPrefix(prefix): Promise<readonly { key: string; value: T }[]>`. Realize all entries before returning.
- (b) Lazy: `listByPrefix(prefix): AsyncIterable<{ key: string; value: T }>`. Stream entries as the consumer iterates.
- (c) Cursor-based: `listByPrefix(prefix, cursor?): Promise<{ entries: ...; cursor?: ... }>`. Caller drives pagination.

**Lock: (b).**

```ts
interface BaseStorageTier {
  // ... existing fields ...
  listByPrefix?<T>(prefix: string): AsyncIterable<{ key: string; value: T }>;
}
```

Reasoning:
- (a) eager realization breaks RAM budgets on edge runtimes (Cloudflare Workers, browsers, MCP server processes). Long-running graphs accumulate MB+ of WAL frames; one-shot Vec doesn't fit. Rejected.
- (c) cursor-based is more flexible but every consumer becomes a state machine; for the WAL replay use case, the consumer wants "give me all frames in order" — `for await` is the cleanest expression. Cursor opt deferable to consumer signal (probably never, given AsyncIterable's natural fit).
- (b) AsyncIterable matches the consumer's natural shape; backpressure falls out of `for await` cadence; tier wraps the underlying `StorageBackend.list?(prefix)` with codec-decode + lazy-yield.
- **Key format LOCKED:** `${prefix}/${frame_seq.toString().padStart(20, '0')}`. 20-digit zero-padded `frame_seq` ensures lexicographic-ASC string order = numeric ASC up to `frame_seq < 10^20` (safe).
- **Prefix semantics LOCKED:** literal byte-prefix match. NO glob, NO regex. Hierarchical paths use `/` (matches `Graph.observe(path)` convention; matches `SNAPSHOT_KEY_PREFIX` precedent at [optimizations.md:341](../../docs/optimizations.md:341)).
- **Backend support:** tiers wrap `StorageBackend.list?(prefix)` ([tiers.ts:47](../packages/legacy-pure-ts/src/extra/storage/tiers.ts:47)). Backends without `list?` throw `StorageError("backend-no-list-support", { tier })` on first iteration (lazy throw — caller sees it at consumption time).
- `readWAL(key)` (gestured in [optimizations.md:335](../../docs/optimizations.md:335)) **declined** — `backend.read(key)` already exists; per-key read is degenerate streaming; replay always wants the streaming variant.

### Q6 — Rust-port deferral fence

**Options:**
- (a) Lock everything TS-side now (frame format + replay + ACID + perf + cross-replica). Rust port becomes a "translate to Rust" exercise.
- (b) Lock the user contract + frame format + replay ordering TS-side; STRONG DEFER ACID + perf + cross-replica + auto-tuning + forward recovery to Rust M4.
- (c) Lock nothing TS-side; build the M4 substrate first, port back to TS as the parity shim.

**Lock: (b).**

TS-side LOCKED NOW (this session):
- ✅ User contract — `restoreSnapshot({ mode:"diff", ... })` API surface (Q9).
- ✅ Frame format — `WALFrame<T>` fields, `frame_seq` ordering, BLAKE3 checksum (Q1).
- ✅ Replay ordering — cross-scope (DS-14) + within-lifecycle `frame_seq` + partial-restore semantics (Q2).
- ✅ Recovery boundary — baseline-then-tail walk + drop-tail torn-write (Q3).
- ✅ Codec contract — JSON default, DagCbor opt-in, tier-level only, `format_version` migration (Q4).
- ✅ `BaseStorageTier.listByPrefix` interface — AsyncIterable, lex-ASC keys (Q5).
- ✅ Compaction discipline — `compactEvery` default 10, `truncateOnCompact` opt-in, manual `tier.compact()` (Q8).
- ✅ §8.7 spec amendment fold-in (Q7).

Rust-side STRONG DEFER (M4 close):
- ❌ Strict cross-tier ACID — `redb` write-transactions span snapshot+WAL atomically.
- ❌ High-throughput frame replay — `imbl::Versioned<T>` snapshot-and-revert per `BaseChange<T>` lifecycle (O(log n) per frame vs TS full apply).
- ❌ Cross-replica WAL merging — `peerGraph(transport)` post-1.0 (Phase 8.5; libp2p + IPLD).
- ❌ Auto-tuning compaction — adaptive `compactEvery` based on cumulative diff bytes.
- ❌ Forward recovery past mid-stream torn writes — frame-level skip + reconstruction where format permits.
- ❌ `loom`-checked storage-tier concurrency — TS can't replicate.

Reasoning:
- (a) building ACID-equivalent in TS first means writing a weaker version we'd throw away ([SESSION-rust-port-architecture.md:201](SESSION-rust-port-architecture.md:201) "TS proves the spec is right; Rust proves it's bulletproof").
- (c) blocks 1.0 ship on Rust port milestones; TS impl needs `mode:"diff"` replay before 1.0 to close §10.6.
- (b) is the existing fence per Phase 14 ([implementation-plan.md:1542](../../docs/implementation-plan.md:1542)) — re-stated here so the M4 surface is unambiguous.

### Q7 — §8.7 spec amendment integration

**Options:**
- (a) Fold §8.7 amendment INTO this session — write the amendment as part of the lock here.
- (b) Keep §8.7 amendment as a separate cross-repo session post-this-lock.
- (c) Defer §8.7 amendment until Phase 14.6 implementation lands.

**Lock: (a).**

Amendment to `~/src/graphrefly/GRAPHREFLY-SPEC.md` §8.7 (six sub-sections — final wording lives in spec repo):

- **§8.7.1** — WAL frame structure (Q1): `WALFrame<T>` shape; `frame_seq`/`change.seq` distinction; `frame_t_ns`/`change.t_ns` distinction.
- **§8.7.2** — Replay ordering (Q2): cross-scope `spec → data → ownership`; within-lifecycle `frame_seq` ASC; partial-restore phase isolation.
- **§8.7.3** — Recovery boundary (Q3): baseline-then-tail walk; BLAKE3 checksum; drop-tail / abort-mid-stream / best-effort caveat.
- **§8.7.4** — Codec contract (Q4): JSON default; DagCbor opt-in; tier-level uniformity; `format_version` migration.
- **§8.7.5** — `listByPrefix` interface (Q5): lazy AsyncIterable; lex-ASC key format; prefix semantics.
- **§8.7.6** — INVALIDATE persistence ([implementation-plan.md:919](../../docs/implementation-plan.md:919)): `attachStorage` writes INVALIDATE messages as WAL frames so replay restores SENTINEL slots deterministically. INVALIDATE is `messageTier === 4` (DS-13.5.A Q15), inside the `tier >= 3` auto-checkpoint trigger ([CLAUDE.md "Auto-checkpoint trigger rule"](../../CLAUDE.md)). Replay applies INVALIDATE in the same `batch()` as data frames; ordering is `frame_seq` ASC (no special tier ordering — INVALIDATE is just another data-lifecycle frame on the wire).

Reasoning:
- (b) (c) leave a stub references that drift; folding now keeps the spec aligned with the TS impl contract.
- The implementation-plan.md:919 entry had three open sub-questions: frame format for INVALIDATE (answered by Q1 — `change` envelope already discriminates), replay ordering (answered by Q2), SENTINEL determinism (answered by Q3 — replay applies INVALIDATE in batch frame; downstream `prevData[i]` resets per [DS-13.5.A Q15](../../docs/implementation-plan.md:913)). All resolve as natural consequences of this session's locks.
- Folding closes the §8.7 ungated-question entry at [implementation-plan.md:919](../../docs/implementation-plan.md:919) and lets §10.6 unblock cleanly.

### Q8 — WAL truncation / compaction discipline

**Options:**
- (a) Never truncate — keep all WAL frames forever (forensics-first).
- (b) Truncate frames preceding the previous baseline as soon as a new baseline lands (eager reclamation).
- (c) Default off (`truncateOnCompact: false`) for TS; default on for Rust M4 (`redb`-transaction backed).

**Lock: (c).**

Reasoning:
- (a) unbounded growth on long-running graphs; not viable for production. Rejected.
- (b) eager truncation requires "baseline durably persisted" guarantees that TS can't make under best-effort cross-tier atomicity (§1542 STRONG DEFER). Truncating before durability is confirmed risks losing recovery on crash. Rejected as TS default.
- (c) conservative TS default (`false` — keep frames; users opt in via `truncateOnCompact: true` per tier when they accept the durability tradeoff). Rust M4 with `redb` ACID transactions makes truncation safe under crash; default flips to `true`.
- New `tier.compact(): Promise<void>` method — opt-in, forces a `mode:"full"` baseline immediately regardless of `compactEvery`. Useful for explicit checkpoints (test fixtures, deploy boundaries, end-of-process drains).
- Frames between baselines are RETAINED until the NEXT baseline lands successfully. The `savePending` chain ([graph.ts:5131](../packages/legacy-pure-ts/src/graph/graph.ts:5131)) ensures async tiers don't acknowledge a baseline until persistence confirms.

### Q9 — `restoreSnapshot mode:"diff"` user-facing API surface

**Options:**
- (a) Minimal: `restoreSnapshot({ mode:"diff", source })`. No targeting, no torn-write callback.
- (b) Full: `restoreSnapshot({ mode:"diff", source, lifecycle?, targetSeq?, onTornWrite?, atomicAllPhases? })`.
- (c) Streaming: `restoreSnapshot.stream({ mode:"diff", source })` — async generator yielding per-frame events; user assembles their own transaction.

**Lock: (b) without `atomicAllPhases` (deferred).**

```ts
graph.restoreSnapshot({
  mode: "diff",

  /** Source of frames. Two forms:
   *  - Pre-collected stream (caller assembled WAL externally).
   *  - Tier handle (tier knows its own backend; `walTier` defaults to the
   *    same tier when not specified — single-tier WAL+snapshot is the
   *    common case). */
  source:
    | AsyncIterable<WALFrame>
    | { tier: SnapshotStorageTier<GraphCheckpointRecord>; walTier?: BaseStorageTier },

  /** DS-14 lifecycle filter. Default: full set. */
  lifecycle?: readonly ("spec" | "data" | "ownership")[],

  /** Point-in-time recovery — replay up to a specific `frame_seq`.
   *  Default: WAL tail. */
  targetSeq?: number,

  /** Torn-frame policy. Default: "skip" (drop frame, log warning, continue).
   *  "abort" exits restore with RestoreError. */
  onTornWrite?: (info: { frame_seq: number; reason: string }) => "skip" | "abort",
}): Promise<RestoreResult>;

type RestoreResult = {
  replayedFrames: number;
  skippedFrames: number;
  finalSeq: number;
  phases: readonly { lifecycle: "spec"|"data"|"ownership"; frames: number }[];
};
```

Reasoning:
- (a) too narrow — point-in-time recovery (`targetSeq`) and torn-write policy (`onTornWrite`) are first-class needs surfaced by Q3.
- (c) streaming-API forces every caller to assemble their own transaction; the common case is "give me back a restored graph." Streaming variant deferable to consumer signal.
- (b) gives the user explicit control on the four orthogonal axes (source / lifecycle / target / torn-write); telemetry on return enables inspection-as-test-harness ([CLAUDE.md "Dry-run equivalence rule"](../../CLAUDE.md)).
- `atomicAllPhases?: boolean` knob deferred per Q2 — recommended `false` default; opt-in if a real consumer needs cross-phase atomicity.

---

## PART 4: DECISIONS LOCKED THIS SESSION

| ID | Decision |
|---|---|
| Q1 | `WALFrame<T>` = `{ t:"c", lifecycle, path, change, frame_seq, frame_t_ns, checksum }`. Two seq fields (`change.seq` bundle vs `frame_seq` WAL) and two t_ns fields (`change.t_ns` mutation vs `frame_t_ns` write) by design. Per-frame codec hint rejected. |
| Q2 | Within-lifecycle: `frame_seq` ASC. Cross-scope: `spec → data → ownership` (DS-14). Partial-restore: per-phase `batch()`; failed phase rolls back, earlier phases stay; `RestoreError("phase-failed")`. `atomicAllPhases?` deferred. |
| Q3 | Recovery: most-recent `mode:"full"` baseline + WAL tail walk filtered by `frame_seq > baseline.seq`. BLAKE3 checksum per frame. Drop-tail on mismatch; abort on mid-stream mismatch. Best-effort caveat documented in JSDoc. |
| Q4 | `jsonCodec` default; `DagCborCodec` opt-in; `cborCodec` opt-in; tier-level uniformity; per-frame codec hint rejected. `format_version` extended from `GraphCheckpointRecord` to `WALFrame` per-tier. Codec migration via baseline rewrite. |
| Q5 | `BaseStorageTier.listByPrefix?(prefix): AsyncIterable<{key, value}>`. Lazy, NOT eager. Key format `${prefix}/${frame_seq.padStart(20)}` for lex-ASC = numeric ASC. Literal byte-prefix. Backends without `list?` throw `StorageError("backend-no-list-support")` on first iteration. `readWAL(key)` declined. |
| Q6 | TS-side: API surface, frame format, replay ordering, codec contract, `listByPrefix`, compaction, §8.7 amendment. Rust-side STRONG DEFER (M4): ACID via `redb`, `imbl` O(log n) replay, cross-replica merging, auto-tuning, forward recovery, `loom`. Fence stays clean. |
| Q7 | §8.7 spec amendment FOLDED into this session. Six sub-sections (§8.7.1–§8.7.6) drafted. INVALIDATE persistence resolved as natural consequence of Q1+Q2+Q3. Closes [implementation-plan.md:919](../../docs/implementation-plan.md:919). |
| Q8 | `truncateOnCompact: false` default for TS (conservative, no ACID); `true` default for M4 Rust (`redb`-backed). New `tier.compact(): Promise<void>` opt-in method forces immediate baseline. |
| Q9 | `restoreSnapshot({ mode:"diff", source, lifecycle?, targetSeq?, onTornWrite? }): Promise<RestoreResult>`. `source` accepts pre-collected stream OR `{ tier, walTier? }` handle. Telemetry on return for test-harness use. `atomicAllPhases?` deferred. |

## PART 5: DECISIONS DEFERRED (NOT MADE THIS SESSION)

- **`atomicAllPhases?: boolean`** for `restoreSnapshot` — recommended `false`; opt-in for users who need cross-phase atomicity. Defer until a real consumer surfaces — no concrete scenario today demands all-or-nothing across phases. Default `false` is the natural fallout of per-phase `batch()` rollback (DS-14 L0 substrate), no extra mechanism required.
- **Auto-tuning `compactEvery`** based on cumulative diff bytes — Rust-side (M4 close).
- **`DagCborZstdCodec`** — Phase 8.6 codec negotiation work; orthogonal to this session.
- **Cross-replica WAL merging semantics** — Phase 8.5 `peerGraph(transport)` POST-1.0.
- **PY parity port** — separate session per [optimizations.md:357](../../docs/optimizations.md:357) PY-parity tracking.
- **Streaming `restoreSnapshot.stream()` variant** — defer until a real consumer hits the per-frame-event use case.

## PART 6: IMPLEMENTATION DELTAS (gated on user "implement DS-14-storage")

Per [feedback_no_implement_without_approval](../../../../.claude/projects/-Users-davidchenallio-src-graphrefly-ts/memory/feedback_no_implement_without_approval.md), implementation does not begin until explicit user instruction. Canonical home is [Phase 14.6 in implementation-plan.md](../../docs/implementation-plan.md#phase-146--storage-wal-replay-implementation-ds-14-storage-substrate). Step numbers below match.

| Step | Work | Size | Dep |
|---|---|---|---|
| 14.6.1 | `WALFrame<T>` type + `BaseStorageTier.listByPrefix` interface + `StorageError` discriminants | S | None |
| 14.6.2 | `attachStorage` writes WAL frames per `mode:"diff"` record (BLAKE3 checksum at write; INVALIDATE persisted per Q7) | M | 14.6.1 |
| 14.6.3 | `restoreSnapshot mode:"diff"` replay path (baseline + WAL walk + per-lifecycle `batch()` + torn-write handling + `RestoreResult` telemetry); `unwrapCheckpoint` dispatches diff to new path | L | 14.6.1, 14.6.2 |
| 14.6.4 | §8.7 spec amendment cross-repo edit | S | None |
| 14.6.5 | parity tests `packages/parity-tests/scenarios/storage-wal/` (legacy-only at first; rust arm at M4 close) | S | 14.6.3 |
| 14.6.6 | JSDoc + COMPOSITION-GUIDE-GRAPH §27 update (defaults table refresh; loud caveat on best-effort cross-tier atomicity) | S | 14.6.3 |

**Sequencing:** 14.6.1 → 14.6.2 → 14.6.3 sequential; 14.6.4 / 14.6.5 / 14.6.6 parallel after 14.6.3 lands. Critical path ~3 days; full scope ~4.5 days. Unblocks [implementation-plan.md §10.6](../../docs/implementation-plan.md#106-restoresnapshot-rejects-mode-diff-records) and closes [optimizations.md:335](../../docs/optimizations.md:335).

**Parallelism with Rust M4:** independent threads. M4 consumes the design contract (locked here); TS impl 14.6.1–14.6.6 produces the legacy-pure-ts oracle. Couple only at 14.6.5 (parity tests), which gates main-branch merges once both impls ship `WALFrame` records.

---

## PART 7: RUST-PORT ALIGNMENT (M4 stable target)

The crate boundary in `~/src/graphrefly-rs/crates/graphrefly-storage/` consumes this session's locks:

```rust
// src/wal.rs
#[derive(Serialize, Deserialize)]
pub struct WALFrame<T> {
    pub t: &'static str,                 // "c"
    pub lifecycle: Lifecycle,            // enum { Spec, Data, Ownership }
    pub path: String,
    pub change: BaseChange<T>,
    pub frame_seq: u64,
    pub frame_t_ns: u64,
    pub checksum: [u8; 32],              // BLAKE3
}

// src/tier.rs
pub trait BaseStorageTier {
    fn name(&self) -> &str;
    fn debounce_ms(&self) -> u32 { 0 }
    fn compact_every(&self) -> Option<u32> { None }
    fn flush(&self) -> Result<()>;
    fn rollback(&self) -> Result<()>;
    fn list_by_prefix<T: DeserializeOwned>(
        &self, prefix: &str,
    ) -> Box<dyn Stream<Item = Result<(String, T)>>>;  // futures::Stream
}
```

`redb` provides ACID transaction wrapping; `serde_ipld_dagcbor` + `blake3` give content-addressing + checksum natively; `imbl::Versioned<T>` snapshots collapse per-frame replay cost to O(log n).

The TS user's `restoreSnapshot` call signature stays IDENTICAL across impls (per L2). Parity tests at M4 close gate divergence on main-branch merges.

---

## PART 8: FILES CHANGED (this session)

### New artifact
- `archive/docs/SESSION-DS-14-storage-wal-replay.md` — this file

### Edits to existing files
- `docs/implementation-plan.md` — Phase 14 substrate thread #5 flipped to ✅ DESIGN LOCKED with 9Q summary; line 919 §8.7 entry folded; §10.6 unblocked.

### Deferred to implementation phases ([Phase 14.6](../../docs/implementation-plan.md#phase-146--storage-wal-replay-implementation-ds-14-storage-substrate))
- `packages/legacy-pure-ts/src/extra/storage/wal.ts` — `WALFrame<T>` type + checksum helpers
- `packages/legacy-pure-ts/src/extra/storage/tiers.ts` — `BaseStorageTier.listByPrefix` extension
- `packages/legacy-pure-ts/src/graph/graph.ts` — `attachStorage` WAL frame emission; `restoreSnapshot mode:"diff"` replay path; INVALIDATE persistence
- `packages/legacy-pure-ts/src/patterns/surface/snapshot.ts` — `unwrapCheckpoint` dispatches diff records to replay
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §8.7 — cross-repo amendment per Q7
- `packages/parity-tests/scenarios/storage-wal/` — parity scenarios
- `~/src/graphrefly-py/...` — PY parity per language-specific invariants (separate session)

### Verification snapshot
- DS-14-storage-wal-replay design lock; no implementation in this session.
- Awaiting `/dev-dispatch` invocation per [Phase 14.6 step table](../../docs/implementation-plan.md#phase-146--storage-wal-replay-implementation-ds-14-storage-substrate).
- M4 (`graphrefly-storage` crate) has a stable target — user to flip `~/src/graphrefly-rs/docs/migration-status.md` M4 row to "ready" and pick up the substrate port.
