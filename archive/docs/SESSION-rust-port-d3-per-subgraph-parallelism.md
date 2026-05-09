# SESSION — Rust port D3: per-subgraph parallelism design

**Status:** OPEN — recommendation pending user lock.
**Authority:** This session doc gates the Slice X5 / Y1 D3 implementation
batch in `graphrefly-rs`. Until it closes, the v1 single-`wave_owner`
mutex stays in place and `Core::emit` cross-thread blocking is the
documented v1 design (see `~/src/graphrefly-rs/docs/porting-deferred.md`
"Cross-thread emit blocks until in-flight wave completes").

**Filed:** 2026-05-08, Slice X4 (the D2 + D4 + D3-design batch).

## 1. The pain

Today the Rust dispatcher serializes everything on a per-Core
`parking_lot::ReentrantMutex<()>` (`wave_owner`) that the wave engine
acquires for every wave. Cross-thread `Core::emit` calls block at
`wave_owner.lock_arc()` until the in-flight wave's drain + flush +
sink-fire completes. The mutex re-entrant property handles same-thread
re-entry (`invoke_fn` calling back into Core, custom-equals oracles,
sink-time re-emit) transparently.

Trade-offs accepted in v1:

- Concurrent threads cannot drive parallel waves on the same Core,
  even when the waves touch totally disjoint nodes.
- A blocked thread waits for the owner thread's fn-fires + sink-fires
  to complete. Slow user fns or sinks block all other emit traffic.

The CLAUDE.md Rust invariant 3 names the goal: "Per-subgraph
`parking_lot::ReentrantMutex` (planned; mirrors graphrefly-py
per-subgraph RLock parity goal). Two threads operating on different
subgraphs run truly parallel; same subgraph serializes via the lock."
The v1 single-Core single-mutex is the placeholder until we lock how
"per-subgraph" maps onto Core's state.

## 2. Three architectural options

### Option A — Per-mounted-Graph Core (multiple Cores)

**Shape:** Each mounted Graph gets its own Core. Today mounted Graphs
share the parent Core via `Graph::with_existing_core`; under A,
`Graph::mount` would instantiate a fresh `Core` and connect it to the
parent via a cross-Core message-routing protocol.

**What "subgraph" means:** A separate Core entirely (own wave_owner,
own state mutex, own binding registry slot).

**Lock granularity:** Per-Core `wave_owner`. Two threads operating on
disjoint mounted Graphs run truly parallel.

**What stays the same:** A single Graph (no mounts) still has ONE Core
and ONE lock. Most users get zero parallelism win.

**Cross-Core wave handoff:** Parent Core emit → child Core wakes →
emits to child node → returns. Lock-ordering protocol: parent before
child by mount depth (acyclic tree by construction). Deadlock vector:
parent holds parent.wave_owner, fires sink on child node, child sink
re-acquires parent.wave_owner via meta companion or describe_reactive
callback. Need explicit lock-ordering protocol here.

**Cost estimate:** ~2500 LOC. New protocol, new TLA+ extension covering
cross-Core routing. `BenchGraph` napi binding reshapes around per-mount
Core lifecycle. Cross-Core mount tests rewrite.

**Why not:**

- Single-Graph users get zero parallelism win (most of the user base).
- Cross-Core routing is a new protocol with no existing TLA+ model;
  has to be designed from scratch.
- Diverges from graphrefly-py architecture (Py has one runtime).
- Public API churn: `mount` semantics shift, cross-Core invariants
  surface, BenchGraph rewrites.

### Option B — Single Core, per-subgraph state partition (RECOMMENDED)

**Shape:** One Core per binding instance (unchanged). Internally,
`CoreState` splits its node-bearing fields by subgraph partition.
Each partition has its own `parking_lot::ReentrantMutex<SubgraphState>`.
The wave engine acquires only the partitions touched by the wave.

**What "subgraph" means:** An internal logical partition of the Core's
node graph, defined by mount boundaries (1:1 with mounted Graphs)
or — alternative — by user-tagged subgraph IDs at register time.

**Lock granularity:** Per-partition `Mutex<SubgraphState>`. Two
threads emitting into nodes in disjoint partitions run truly parallel.

**Code shape sketch:**

```rust
pub(crate) struct CoreState {
    partitions: HashMap<SubgraphId, Mutex<SubgraphState>>,
    cross_partition: Mutex<CrossPartitionState>, // wave_cache_snapshots,
                                                 // pending_pause_overflow,
                                                 // pending_auto_resolve, etc.
    // ...
}

pub(crate) struct SubgraphState {
    nodes: HashMap<NodeId, NodeRecord>,
    children: HashMap<NodeId, HashSet<NodeId>>,
    pending_notify: IndexMap<NodeId, PendingPerNode>,
    pending_fires: HashSet<NodeId>,
    tier3_emitted_this_wave: AHashSet<NodeId>,
    // ... per-subgraph wave-scoped state
}
```

**Cross-partition wave acquisition:** Sort touched `SubgraphId`s,
acquire in ascending order. Deadlock-free by construction
(total-order acquisition is the textbook solution).

**Wave engine changes:** `run_wave` discovers touched subgraphs from
the seed node's edges + transitive cascade. For waves that stay in
one partition (the common case), only that partition locks. Cross-
partition waves (a parent emit cascading into children, or a multi-
partition combine operator) acquire all touched partitions in
SubgraphId order.

**Mirrors graphrefly-py** per-subgraph RLock pattern (CLAUDE.md Rust
invariant 3 "planned").

**Cost estimate:** ~3000 LOC. Heaviest CoreState refactor — every
wave-scoped field decides whether it lives per-partition or in
cross-partition shared state. TLA+ extension on `wave_protocol_rewire`
adding partition lock-ordering. Loom-checked tests for cross-partition
parallel emit + invalidate cascade across mount boundary.

**Public API impact:** None at the type-system level. `Graph::mount` /
`unmount` keeps its shape; partitioning is internal. The user-facing
parallelism win is observable but doesn't require API gestures.

**Trade-offs accepted:**

- Cross-partition waves still acquire multiple locks; pathological
  workloads that emit in heavy cross-partition cascades get less win
  than disjoint-partition workloads.
- Partition boundary decision has long-tail consequences. Mount-aligned
  is the default — but a single mounted Graph with N independent
  state-derived chains gets ONE partition. User-tagged subgraph IDs
  could reach finer granularity at the cost of API surface.
- `pending_pause_overflow` / `tier3_emitted_this_wave` / similar
  wave-scoped sets become per-partition; equals coalescing (Slice G)
  needs to verify it doesn't span partitions semantically.

**Why this is the recommendation:**

1. **Parity with graphrefly-py.** CLAUDE.md Rust invariant 3
   explicitly names this shape as planned.
2. **Public API stays.** Partition wiring is internal CoreState
   reshape.
3. **Parallelism aligns with composition pattern.** Users get
   parallelism by mounting subgraphs — already how multi-component
   apps are structured.
4. **Bounded mechanical work.** Not "design a new protocol" — extend
   existing protocol with partition locking.

### Option C — Single Core, per-node Mutex

**Shape:** Each `NodeRecord` gets its own `Mutex`. Wave engine holds
a "wave permit" coordinating across nodes. Lock-acquisition order:
topological by dep edges (acyclic by registration construction).

**What "subgraph" means:** Doesn't exist as a concept. Granularity
is uniform per-node.

**Lock granularity:** Per-node `Mutex<NodeRecord>`. Maximum
parallelism — any two non-overlapping waves run parallel.

**Why not:**

- `pending_notify` / `deferred_flush_jobs` / `wave_cache_snapshots`
  are fundamentally wave-scoped, not node-scoped. They become
  coordination hotspots needing their own locks or epoch-counter
  schemes.
- Wave engine becomes a distributed coordination problem — epoch
  counters, fences, hazard pointers. Hard to TLA+-model; subtle
  deadlocks likely.
- Doesn't match graphrefly-py architecture at all.
- Highest implementation cost and risk for marginal additional
  parallelism over Option B.

## 3. Recommendation: Option B

### Why B over A

- Option A only pays off for users who mount; single-Graph users get
  ZERO parallelism win. Option B's partition is an internal mechanism
  — even a single-Graph user implicitly gets partition-1 isolation
  from any later mount, without paying API churn upfront.
- Option A introduces a new protocol (cross-Core message routing)
  with no TLA+ ancestor. Option B extends `wave_protocol_rewire` with
  partition lock-ordering — bounded extension of existing model.
- Option A's deadlock vectors (parent.wave_owner held while sink
  fires on child node, child re-acquires parent) are real and hard
  to bound. Option B's cross-partition acquisition has a
  textbook solution (total-order sort).

### Why B over C

- Wave-scoped state (`pending_notify`, `wave_cache_snapshots`,
  `deferred_flush_jobs`, `tier3_emitted_this_wave`) is fundamentally
  wave-not-node-scoped. Option C makes them either single-locked
  (defeating per-node parallelism) or distributed (hard to verify).
- Option C's parallelism ceiling is theoretically higher but the
  delta over Option B for realistic graph topologies is small —
  most parallel emits in practice naturally fall into different
  mounted subgraphs.
- TLA+ effort for Option C is substantial; Option B reuses most of
  the existing model.

### Why B over status-quo

- Status quo accepts the v1 cross-thread emit block as "the design"
  per the porting-deferred 2026-05-07 reframe. That position is
  defensible only until a consumer surfaces real parallel-wave
  pressure on the same Core. Multi-agent harness work (which
  concurrently emits agent state into a shared hub) is an obvious
  near-term consumer.
- Closing this v1 design point ahead of multi-agent harness scaling
  removes a hard ceiling that would otherwise become the contended
  resource in any multi-agent benchmark.

## 4. Open design questions for Option B

If user picks B, these questions must lock before implementation:

**Q1 — Partition boundary policy.** Options:
- **(a)** Mount-aligned: every mounted Graph gets its own partition
  (the parent Graph's nodes are partition 0; each mount gets a fresh
  SubgraphId). Simple, deterministic, mirrors graphrefly-py.
- **(b)** User-tagged at register time: `register(... opts: { subgraph_id })`.
  Finer granularity, but adds public API surface. Risk: users
  mis-tagging breaks the partition invariant silently.
- **(c)** Auto-detect from connected components of the dep graph.
  Truly minimal API; expensive bookkeeping; partition shifts as
  edges change.

**Recommendation:** (a). Aligned with graphrefly-py and CLAUDE.md
"per-subgraph mutex". User-tagged is a future addition without
breaking change.

**Q2 — Cross-partition shared state placement.** The wave-scoped fields
`pending_pause_overflow`, `pending_auto_resolve`, `wave_cache_snapshots`,
`deferred_handle_releases` are referenced from across the wave engine.
Options:
- **(a)** Move them to `cross_partition: Mutex<CrossPartitionState>`,
  acquired alongside the partitions a wave touches. Each cross-
  partition wave acquires `cross_partition` last (consistent
  ordering with partition-then-cross).
- **(b)** Replicate per-partition; merge at flush time. Avoids the
  cross-partition lock contention but adds merge cost on every
  wave end.

**Recommendation:** (a). Wave-scoped fields are by definition
wave-scoped, not partition-scoped. Single cross-partition lock with
fixed acquisition order is simpler than per-partition replication.

**Q3 — `tier3_emitted_this_wave` partitioning.** The Slice G equals
coalescing detector is per-node-per-wave. Currently a single
`AHashSet<NodeId>` on `CoreState`. If we partition it, a node only
ever emits in its own partition's wave (cross-partition cascades
emit on the consumer's node, which is in the consumer's partition).
So per-partition is correct. Decision: live in `SubgraphState`.

**Q4 — `wave_owner` reentrant mutex.** Today there's exactly one
`wave_owner: ReentrantMutex<()>` per Core, used by `BatchGuard`,
`Core::subscribe` (for handshake serialization), and the wave engine
itself. Under Option B, candidates:
- **(a)** Per-partition `wave_owner`. Cross-partition waves acquire
  multiple (in SubgraphId order). Same-partition re-entry passes
  through the partition's own ReentrantMutex.
- **(b)** Single Core-level `wave_owner` AND per-partition state
  mutexes. The state lock is the parallelism enabler; `wave_owner`
  stays as a serialization point for in-flight wave ownership.

**Recommendation:** (a). The whole point is to allow concurrent waves
on disjoint partitions; (b) defeats it by serializing wave ownership.

**Q5 — `Subscription::Drop` cross-partition cascade.** When the last
subscriber drops on a producer node in partition P, the cleanup hook
cascade may unsubscribe from upstream sources in partitions Q, R, ...
(via `producer_deactivate`). Lock ordering: the drop holds P's lock
when it observes "last sub", drops the lock, fires `cleanup_for` and
`producer_deactivate` lock-released. Each upstream unsub acquires Q's
lock independently. Same-thread unsub via `wave_owner` re-entrancy
won't cause deadlock as long as we acquire each partition lock
LOCK-RELEASED.

**Q6 — TLA+ scope.** Extend `wave_protocol_rewire.tla` with:
- Per-partition `wave_owner` model
- Cross-partition acquisition ordering (SubgraphId-sorted)
- Subscription cleanup cascade across partitions
- Cross-partition deadlock-freedom assertion

**Q7 — napi binding parity.** `BenchCore` exposes `core.batch(...)`
implicitly via `batch_emit_handle_messages`. Under per-partition
locks, what does "batch" mean across partitions? Decision needed:
- **(a)** Cross-partition batches acquire all touched partitions
  upfront (current single-batch semantics, just with multi-lock).
- **(b)** Per-partition batches; cross-partition emits inside one
  user batch get split into per-partition sub-batches at flush
  time. More parallelism but breaks user mental model of "one batch
  = one wave."

**Recommendation:** (a). Preserves the user-facing "one batch = one
wave" contract.

**Q8 — Bench harness.** Need a multi-thread parallel-emit benchmark
to validate the parallelism win. Today `dispatcher.rs` bench is
single-thread. Add criterion bench: N threads × M emits each on
disjoint partitions; assert wall-clock time scales sub-linearly with
N (the win signal vs serialized).

## 5. Acceptance bar (before D3 implementation slice closes)

- All existing 473+ cargo tests pass.
- All 142+ parity tests pass against both impls.
- New `tests/per_subgraph_parallelism.rs` with at minimum:
  - Two threads emitting into disjoint partitions concurrently — both
    return without blocking each other (unlike the v1 lock_released.rs
    `concurrent_emit_blocks_until_in_flight_wave_completes` test,
    which becomes the inverse: NOW expected to NOT block).
  - Cross-partition cascade: emit in partition P invalidates a node
    in partition Q via mount edge — partition locks acquired in
    SubgraphId order, no deadlock.
  - Loom-checked test for cross-partition concurrent unsubscribe +
    emit — Subscription::Drop cleanup cascade across partitions is
    deadlock-free under all interleavings.
- TLA+ extension passes MC under representative configs.
- `cargo clippy --all-targets -D warnings` clean.
- `cargo fmt --check` clean.
- `#![forbid(unsafe_code)]` preserved.
- Bench: N-thread parallel-emit shows sub-linear wall-clock scaling
  vs serialized single-thread.
- `migration-status.md` Slice X5/Y1 entry documents the partition
  boundary decision (Q1 lock).
- `porting-deferred.md` D3 entry struck through with pointer to
  this session doc + the closing Slice.
- CLAUDE.md Rust invariant 3 wording updated from "planned" to
  current implementation.

## 6. Status

**Current state:** Recommended. Awaiting user lock on Q1–Q8 before
implementation slice begins.

**If approved:** Slice X5 / Y1 implements Option B, `Q1=(a)`,
`Q2=(a)`, `Q4=(a)`, `Q7=(a)` per the recommendations above; Q3 is
locked at session-doc-write time. Q5, Q6, Q8 are scope items, not
decisions.

**If rejected for Option A or C:** Re-open this session doc with the
chosen option's Q-walk and re-bound the implementation cost.

**Cross-references:**
- `~/src/graphrefly-rs/docs/porting-deferred.md` — D3 entry
- `~/src/graphrefly-rs/CLAUDE.md` — Rust invariant 3
- `archive/docs/SESSION-rust-port-architecture.md` — Part 8
  (per-subgraph parking_lot::ReentrantMutex), Part 10 (perf
  simplifications)
- `docs/research/wave_protocol_rewire.tla` — base spec to extend
