---
SESSION: DS-14-changesets-design
DATE: May 4–5, 2026
TOPIC: Universal Change envelope, mutations companion bundles, universal mutation factory, lifecycle-aware diff restore. Substrate for op-log changesets / worker-bridge wire B / lens.flow delta / reactiveLog.scan / restoreSnapshot mode "diff".
REPO: graphrefly-ts (TS-primary; Rust port substrate-aligned via M5)
---

## CONTEXT

DS-14 was scoped at [implementation-plan.md:1442](../../docs/implementation-plan.md:1442) as a substantial 9Q audit co-designing five threads that share a version-counter substrate (Wave 4 `*Backend.version: number` already shipped). The user pulled it forward from POST-1.0 to pre-1.0 because changeset semantics affect every reactive primitive and need to land before Phase 15 evals.

This session worked through:

1. The six post-1.0 follow-ups consolidated as one design (`mutations` companion / op-log changesets / worker-bridge wire B / lens.flow delta / reactiveLog.scan / restoreSnapshot mode "diff").
2. The universal `Change<T>` envelope shape (T2) — open `structure: string` namespace, `version: number | string`, two-level discriminant.
3. The `mutations` companion as `ReactiveLogBundle<Change<T>>` (T1, alternative D) — re-uses Wave 4 reactive-log substrate, enables `scan` for O(1) running aggregates, integrates with `attachStorage` for free.
4. Backend optionality (T3, alternative a) — bundles own the log when backends don't expose `changesSince`; CRDT escape hatch preserved per Phase 14 STRONG DEFER list.
5. Universal mutation factory `mutate(act, opts)` collapsing `lightMutation` + `wrapMutation` into one factory with `frame: "inline" | "transactional"` + `down` rollback hook (your DB up/down framing).
6. Lifecycle discriminant (`"spec" | "data" | "ownership"`) for diff-restore boundary safety — surfaced from a parallel DS-14.5.A session reminder about the L0–L3 ownership staircase.

**Source material:**
- [docs/optimizations.md](../../docs/optimizations.md) lines 660, 684–691, 808–810, 836 (the six follow-up items being consolidated)
- [archive/docs/SESSION-ai-harness-module-review.md](SESSION-ai-harness-module-review.md) §1518 (retention API → mutations follow-up)
- [archive/docs/SESSION-orchestration-messaging-cqrs-review.md](SESSION-orchestration-messaging-cqrs-review.md) §3790 (op-log changesets post-1.0 candidate)
- [archive/docs/SESSION-rust-port-architecture.md](SESSION-rust-port-architecture.md) Phase 14 deferral guardrails
- [docs/implementation-plan.md:1442](../../docs/implementation-plan.md:1442) Phase 14 stub (this doc replaces it)
- DS-14.5.A pre-lock dialogue (catalog-vs-spec-vs-blueprint vision; L0–L3 ownership staircase) — surfaced concrete L3 supervisor-override / lifecycle-boundary requirements

---

## PART 1: UNIVERSAL CHANGE ENVELOPE (T2)

### Locked shape

```ts
interface BaseChange<T> {
  /** Structure namespace. Open string per per-structure variants:
   *  "map" | "list" | "log" | "index" | "pubsub" | "lens.flow" | "ownership" | … */
  readonly structure: string;

  /** Monotonic identity. number for V0 (counter); string for V1+ (cid).
   *  Mixed-type unions are user-resolved via custom version string design (Q-O7). */
  readonly version: number | string;

  /** Wall-clock at mutation entry — R4.2.3 / wallClockNs(). */
  readonly t_ns: number;

  /** Optional cursor seq for joining with audit logs. */
  readonly seq?: number;

  /** Lifecycle scope. Diff-restore filters on this to enforce boundaries. */
  readonly lifecycle: "spec" | "data" | "ownership";

  /** Structure-specific delta payload. Per-payload `kind` field discriminates inside. */
  readonly change: T;
}
```

Two-level discriminant: envelope-level `structure` for cross-structure narrowing; payload-level `kind` for per-structure verb narrowing.

### Per-structure unions (illustrative; full list in implementation session)

```ts
// "data" lifecycle —
type MapChangePayload<K, V> =
  | { kind: "set";    key: K; value: V }
  | { kind: "delete"; key: K; previous: V; reason?: "expired" | "lru-evict" | "explicit" }
  | { kind: "clear";  count: number };
type MapChange<K, V>  = BaseChange<MapChangePayload<K, V>>;     // structure: "map", lifecycle: "data"

type ListChange<T>    = BaseChange<…>;     // structure: "list", lifecycle: "data"
type LogChange<T>     = BaseChange<…>;     // structure: "log",  lifecycle: "data"
type IndexChange<K,V> = BaseChange<…>;     // structure: "index", lifecycle: "data"
type PubSubChange     = BaseChange<…>;     // structure: "pubsub", lifecycle: "data"
type LensFlowChange   = BaseChange<…>;     // structure: "lens.flow", lifecycle: "data"

// "spec" lifecycle —
type SpecChange =
  | BaseChange<{ kind: "graph.add";     nodeId: string; tag?: string }>
  | BaseChange<{ kind: "graph.mount";   path: string; subgraphId: string }>
  | BaseChange<{ kind: "graph.remove";  nodeId: string }>
  | BaseChange<{ kind: "schema.upgrade"; level: VersioningLevel }>;
  // structure: "graph" | "schema", lifecycle: "spec"

// "ownership" lifecycle —
type OwnershipChange = BaseChange<
  | { kind: "claim";    subgraphId: string; actor: AgentId; level: "L0"|"L1"|"L2"|"L3" }
  | { kind: "release";  subgraphId: string; actor: AgentId }
  | { kind: "override"; subgraphId: string; actor: AgentId; previousActor: AgentId; reason: string }
>;  // structure: "ownership"
```

### TTL/LRU prune fidelity (locked)

Read-time TTL/LRU prune paths in `reactive-map.ts` MUST emit `MapChange{kind:"delete",reason:"expired"|"lru-evict"}`. Without this, `changesSince(version)` desyncs from `entries` snapshots and worker-bridge Option B receivers diverge. Acceptable backend chatter cost.

---

## PART 2: MUTATIONS COMPANION (T1, alternative D)

### Bundle opt-in

```ts
type ReactiveLogConfig = {
  maxSize?: number;             // default 1024 — cross-primitive convention
  lazy?: boolean;               // default false; defer construction until first subscribe
  guard?: NodeGuard;            // override DEFAULT_AUDIT_GUARD
  graph?: Graph;                // mount under graph as `${name}`
  versioning?: VersioningLevel;
  name?: string;
};

reactiveMap<K, V>({
  ...,
  mutations?: ReactiveLogConfig | true;  // opt-in delta companion; `true` = defaults
});

// Bundle exposes:
type ReactiveMapBundle<K, V> = {
  ...,
  /** Present iff `mutations` was configured. */
  mutations?: ReactiveLogBundle<MapChange<K, V>>;
};
```

Same opt on `reactiveList` / `reactiveLog` / `reactiveIndex` / `pubsub`. `lens.flow.mutations` falls out for free since `lens.flow` is itself a `ReactiveMapBundle`.

### Same-wave consistency

`bundle.mutations.append(change)` runs INSIDE the same `batch()` frame as the snapshot emission. Subscribers that read both `entries` and `mutations` never see torn state. Bulk APIs (`setMany`/`appendMany`) emit one snapshot + N change records inside one frame.

### Backend extension (optional)

```ts
interface MapBackend<K, V> {
  ...,
  /** Optional. Native CRDT/append-only backends can return their own delta history.
   *  When implemented, the bundle SHORT-CIRCUITS the bundle-side log append (no double-recording). */
  changesSince?(version: number | string): Iterable<MapChange<K, V>> | null;
}
```

Native (TS) backends do NOT implement `changesSince` — bundle owns the log. CRDT backends (Yjs/Automerge/loro under future Rust M5) implement and short-circuit. Locked: bundles never assume `changesSince` exists.

---

## PART 3: UNIVERSAL MUTATION FACTORY

### Replaces `lightMutation` + `wrapMutation` (pre-1.0 break)

```ts
type MutationAct<TArgs extends readonly unknown[], TResult> = {
  /** The "up" — the mutation action. */
  up: (...args: TArgs) => TResult;

  /** The "down" — rollback for closure / backend state batch can't reach.
   *  Receives the SAME frozen args as `up`. Runs AFTER batch reactive rollback,
   *  BEFORE the audit failure record. Throws inside `down` are console.error'd
   *  without masking the original error. Only meaningful with frame:"transactional". */
  down?: (...args: TArgs) => void;
};

type MutationFrame = "inline" | "transactional";
//  inline        — no batch frame; up() runs raw. seq bumps before action; persists on throw.
//  transactional — opens batch(() => up(...)). Reactive emissions defer until commit.
//                  On throw: batch discards deferred deliveries, then `down` runs,
//                  then `onFailureRecord` builds the failure record (which persists).

type MutateOpts<TArgs, TResult, R> = {
  frame: MutationFrame;
  /** Bundle to append the produced record to. Optional — wrapper still provides
   *  freeze + seq + rollback semantics without it. */
  log?: ReactiveLogBundle<R>;
  /** Build the success record. Returns undefined to skip (idempotent no-op). */
  onSuccessRecord?: (args: TArgs, result: TResult, meta: SuccessMeta) => R | undefined;
  /** Build the failure record. Returns undefined to skip. Persists across batch rollback. */
  onFailureRecord?: (args: TArgs, error: unknown,  meta: FailureMeta) => R | undefined;
  /** Deep-freeze args at entry (default true). Opt out for hot paths. */
  freeze?: boolean;
  /** Optional sequence cursor — auto-advanced and stamped onto records. */
  seq?: Node<number>;
  /** Optional handler version — stamped per Audit 5. */
  handlerVersion?: { id: string; version: string | number };
};

export function mutate<TArgs extends readonly unknown[], TResult, R>(
  act: MutationAct<TArgs, TResult> | ((...args: TArgs) => TResult),
  opts: MutateOpts<TArgs, TResult, R>,
): (...args: TArgs) => TResult;
```

Function-shorthand for `act` auto-wraps as `{ up: fn }` (no `down`). One factory; no `lightMutation` / `wrapMutation` sugar.

### Rollback layers (canonical reference)

| Layer | What rolls back | Mechanism |
|---|---|---|
| **L0 substrate (free)** | Deferred reactive deliveries inside `batch()` | Batch frame discards pending tier-3 emissions on throw. |
| **L1 user `down`** | Closure mutations (`Map.set`, counters), backend imperative state | Explicit user-supplied callback in `MutationAct.down`. |
| **L2 (post-Rust)** | Auto-rollback common collections | `&mut T` ownership + `imbl` persistent collections; `registerMutable` / Proxy detection deferred per Lock 4.B (B+C). |

### `freeze` semantics (carried forward)

`freeze: true` (default) → `args.map(deepFreeze)` at entry. TOCTOU prevention, async-handler stability, audit-record immutability. Opt out (`freeze: false`) on hot paths where deep-freeze cost is measurable.

---

## PART 4: LIFECYCLE-AWARE DIFF RESTORE

### Three lifecycle scopes (locked)

| Lifecycle | Captures | Persistence story |
|---|---|---|
| `"spec"` | Topology mutations (`Graph.add`/`mount`), schema upgrades, policy changes | Production: `graph.describe()` snapshots committed to git (David's locked vision per session export `0c80b3de.jsonl`). Runtime WAL captures hot-swap rewires for replay-of-development. |
| `"data"` | `reactiveMap.set`, `reactiveLog.append`, `lens.flow` ticks, all bundle mutations | WAL-replayed via `restoreSnapshot mode:"diff"`. Standard substrate. |
| `"ownership"` | Ownership claims/releases/overrides (L0–L3 staircase) | WAL-replayed independently. Restoring `data` without `ownership` = "rewind work-in-progress, agents reclaim from scratch." |

### `restoreSnapshot` lifecycle filter

```ts
graph.restoreSnapshot({
  mode: "diff",
  source: walStream,
  /** Default: ["spec","data","ownership"] (full restore).
   *  Pass narrower set to scope the rewind. */
  lifecycle?: readonly ("spec" | "data" | "ownership")[];
});
```

Three concrete restore modes fall out:
- **Spec-only restore** (`["spec"]`): rebuild topology; data + ownership stay live.
- **Data-only restore** (`["data"]`): rewind data state; topology + ownership stay live.
- **Full restore** (`["spec","data","ownership"]`): full original semantic.

### Cross-scope ordering invariants (replay protocol)

- `"spec"` records apply BEFORE `"data"` in the same WAL window — can't restore data into nonexistent topology.
- `"ownership"` records apply AFTER `"data"` — can't claim a node that hasn't been restored.
- WAL records crossing lifecycle boundaries without corresponding `lifecycle` field rejected with diagnostic.

---

## PART 5: WORKER-BRIDGE WIRE PROTOCOL B (separate session)

Per Q-O5 lock — bridge migration is a distinct session, post-T1 substrate. Pre-locked wire shape:

```ts
type BridgeChangeMessage = {
  t: "c";
  lifecycle: "spec" | "data" | "ownership";
  path: string;          // target bundle path
  change: BaseChange<unknown>;
};
```

Workers selectively mirror by lifecycle: UI workers → `"data"` for rendering; supervisor workers → `"ownership"` for arbitration; dev workers → `"spec"` for hot-reload.

Connect-time protocol: full snapshot on `"r"` ready message; per-change deltas thereafter; receiver tracks `lastAppliedVersion` per path; sender catches up via `changesSince(snapshotVersion)` if receiver lags.

Backpressure: receiver acks every applied change; sender pauses or falls back to snapshot when ack lag exceeds threshold. Implementation detail; may defer until a real consumer hits the lag.

---

## PART 6: `reactiveLog.scan(initial, step)` OPERATOR

```ts
// Method form (discoverable):
bundle.scan<TAcc>(initial: TAcc, step: (acc: TAcc, value: T) => TAcc): Node<TAcc>;

// Standalone export (pipe-builder friendly):
import { scanLog } from "@graphrefly/graphrefly/extra";
scanLog<T, TAcc>(log: ReactiveLogBundle<T>, initial: TAcc, step: (acc, v) => TAcc): Node<TAcc>;
```

O(1) per append; replay via passthrough `replayBuffer: N` per Lock 6.G (no scan-internal buffering). Returns `Node<TAcc>` per Lock 5.A discipline (no `| undefined`).

Closes `optimizations.md:690` (`reactiveLog incremental-reduce`) and unlocks "current owner per node" derivations on the ownership stream — `O(1)` per claim/release event regardless of subscriber count.

---

## DECISIONS LOCKED THIS SESSION

| ID | Decision |
|---|---|
| Q-O1 | `compensate` → `down`. Pre-1.0 break. |
| Q-O2 | Single `mutate(act, opts)` factory; no `lightMutation` / `wrapMutation` sugar. |
| Q-O3 | Two frames (`"inline"` / `"transactional"`); `{ up, down? }` MutationAct shape; two named record builders (`onSuccessRecord` / `onFailureRecord`); `freeze: boolean` keeps current deep-freeze semantics. |
| Q-O4 | Phase 14 already opens; design locked here. |
| Q-O5 | Worker-bridge Option B = separate session, post-T1 substrate. |
| Q-O6 | Two-level discriminant: envelope `c.structure` (renamed from `c.type`); payload `c.change.kind`. |
| Q-O7 | Flat `version: number | string`; mixed-type unions user-resolved. |
| Q-O8 | Add `lifecycle: "spec" | "data" | "ownership"` field to `BaseChange<T>` envelope. |
| Q-O8b | Lifecycle vocabulary `"spec" | "data" | "ownership"` (matches user catalog/spec/blueprint discussion). |

## DECISIONS DEFERRED (NOT MADE THIS SESSION)

- **CRDT backend variants** (`yrs` / `automerge` / `loro`-backed reactiveMap/reactiveLog) — STRONG DEFER per Phase 14 Rust-port guardrail at [implementation-plan.md:1467](../../docs/implementation-plan.md:1467).
- **`peerGraph(transport)` multi-replica sync** — POST-1.0 per Phase 8.5; Rust + libp2p + IPLD content-addressing.
- **`registerMutable(node, value)` + dev-mode Proxy detection** (Lock 4.B B+C) — Rust port may obviate via ownership + `Drop`. Tracked at [optimizations.md:27](../../docs/optimizations.md:27).
- **9Q audit by DS-14.5.A** on this lock against the L1–L8 ownership/catalog decisions — they will run independently and compare. Per their session protocol: pull DS-14 locks, check Q1–Q9 conflicts, run 9Q in their next session.

## IMPLEMENTATION PHASING (gated on user "implement DS-14")

Per `feedback_no_implement_without_approval`, implementation does not begin until explicit user instruction. When given:

1. **Phase 14.1 — universal mutation factory (~1 day).** Replace `lightMutation` / `wrapMutation` with `mutate(act, opts)`. Migrate 12 in-tree sites per [implementation-plan.md:506](../../docs/implementation-plan.md:506) table (rows 1–12). Frames `"inline"|"transactional"`. `down` field replaces `compensate`. `onSuccessRecord` / `onFailureRecord` rename. Tests at `__tests__/extra/mutation/mutation.test.ts` rewrite.
2. **Phase 14.2 — `BaseChange<T>` types + per-structure unions + `lifecycle` field (~0.5 day).** Type-only file `src/extra/data-structures/change.ts`. Spec lifecycle types `SpecChange`. Ownership lifecycle types `OwnershipChange`.
3. **Phase 14.3 — bundle `mutations` opt (~2 days).** Wire `ReactiveLogConfig | true` into `reactiveMap` first (pilot); cascade to list/log/index/pubsub. Each setter goes through `mutate({ up: backendOp }, { frame:"inline", log: bundle.mutations, onSuccessRecord })`. TTL/LRU read-time prune emits `MapChange{kind:"delete",reason:"expired"|"lru-evict"}`.
4. **Phase 14.4 — `reactiveLog.scan` method + standalone `scanLog` (~0.5 day).** ~5 LOC duplication for both forms.
5. **Phase 14.5 — `lens.flow.mutations` (~0.5 day).** ~~Drops in for free as a `ReactiveMapBundle` consumer of T1; verify `LensFlowChange` payload semantics (tick / evict).~~ **SUPERSEDED 2026-05-15 by [SESSION-DS-14-changeset-residuals.md](SESSION-DS-14-changeset-residuals.md) D-DS14R3 — premise invalid.** `lens.flow` is a post-Tier-5.3 closure-mirror node, NOT a `ReactiveMapBundle`, so the "for free" path does not exist. Item **declined**: `lens.flow` is a diagnostic/observability surface, not a structure consumers replay. `LensFlowChange` type retained (cheap); re-open only on a real consumer signal.
6. **Phase 14 separate session — worker-bridge Option B (~2 days).** Wire format `{ t:"c", lifecycle, path, change }` + connect-time snapshot+catchup protocol + ack-driven backpressure.
7. **Phase 14 separate session — `restoreSnapshot mode: "diff"` WAL replay (~2 days).** Depends on `StorageTier.listByPrefix` extension; tracked at [optimizations.md:824](../../docs/optimizations.md:824).

Total ~6.5 days for substrate + bundle wiring; +4 days for bridge + WAL replay sessions.

## RUST-PORT ALIGNMENT

The user-facing API (envelope shape, lifecycle field, mutation factory, lifecycle-aware diff restore) lands in TS during Phase 14. Per [implementation-plan.md:1456](../../docs/implementation-plan.md:1456) DON'T DEFER list — these are the surface contracts both impls must honor.

M5 (`graphrefly-structures`) Rust port consumes the same shape: `BaseChange<T>` becomes a Rust enum with structure-tagged variants; `lifecycle` is `enum Lifecycle { Spec, Data, Ownership }`; `mutate` becomes a generic Rust function that opens a transaction frame via `imbl`-based persistent collections, getting auto-rollback for free. The `down` callback becomes optional in Rust because most closure-mutation gaps close structurally via ownership.

CRDT-backed structure variants (`yrs`-/`automerge`-/`loro`-backed reactiveMap/log) ship as Rust crates post-1.0. They consume the same `BaseChange<T>` shape but implement `changesSince(version)` natively — bundle layer short-circuits its own log per Part 2.

---

## FILES CHANGED (this session)

### New artifact
- `archive/docs/SESSION-DS-14-changesets-design.md` — this file

### Edits to existing files
- `docs/implementation-plan.md` — Phase 14 stub at line 1442 flipped from "DESIGN-SESSION-NEEDED (DS-14)" to "LOCKED 2026-05-05" with pointer to this file

### Deferred to implementation phases (Phase 14.1–14.5 + separate worker-bridge / WAL sessions)
- `src/extra/mutation/index.ts` — `mutate` factory + `MutationAct<TArgs,TResult>` + `MutationFrame` + `MutateOpts`; deletion of `lightMutation` / `wrapMutation` exports
- `src/extra/data-structures/change.ts` — `BaseChange<T>` + per-structure unions + `lifecycle` field
- `src/extra/data-structures/reactive-{map,list,log,index}.ts` — `mutations: ReactiveLogConfig | true` opt; setter routes through `mutate(...)`; TTL/LRU prune emits Change records
- `src/extra/pubsub.ts` — same opt
- `src/patterns/lens/index.ts` — `lens.flow.mutations` drops in via underlying `ReactiveMapBundle`
- `src/extra/data-structures/reactive-log.ts` — `bundle.scan(initial, step)` method + `extra/log-ops.ts` standalone `scanLog`
- `src/extra/worker/bridge.ts` — wire format `{ t:"c", lifecycle, path, change }` + connect-time catchup (separate session)
- `src/graph/graph.ts` — `restoreSnapshot.lifecycle` filter (separate session)
- `~/src/graphrefly-py/...` — PY parity per language-specific invariants (after TS lands)

### Verification snapshot
- DS-14 design lock; no implementation in this session.
- Awaiting `/dev-dispatch` invocation per Phase 14.1–14.5 phasing above.
