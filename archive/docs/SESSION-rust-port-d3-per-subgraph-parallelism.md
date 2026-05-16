# SESSION — Rust port D3: per-subgraph parallelism design

> **⚠️ SUPERSEDED 2026-05-16 by the §7 single-threaded substrate +
> `SerializationGroupId` contract** (`SESSION-rust-port-perf-value-investigation.md`
> §7; `docs/rust-port-decisions.md` D208–D212). The union-find
> per-subgraph partitioning described here (and decisions **D085 / D086**)
> is **deleted** in `graphrefly-rs` — replaced by static, user-declared
> serialization groups (no `find`/path-compression/epoch/`PARTITION_CACHE`/
> split/merge/retry-validate). Retained as historical design context
> only; do not implement against it.

**Status:** SUPERSEDED 2026-05-16 (was: LOCKED 2026-05-08, Slice X5 / Y1).
**Authority:** This session doc gates the Slice X5 / Y1 D3 implementation
batch in `graphrefly-rs`. The v1 single-`wave_owner` mutex stays in place
until X5/Y1 lands the per-partition substrate.

**Filed:** 2026-05-08, Slice X4 (the D2 + D4 + D3-design batch).
**Locked:** 2026-05-08, same-day follow-up after user surfaced the
graphrefly-py union-find precedent (`src/graphrefly/core/subgraph_locks.py`).

## Locked answers

| Q | Answer | Notes |
|---|---|---|
| Top-level | Option B (single Core, per-partition state) | Rejected A (multi-Core) and C (per-node Mutex). |
| Q1 | **(c-uf split-eager)** — union-find connectivity-based with split-eager reachability walk on edge removal | Mirrors graphrefly-py [`subgraph_locks.py`](file:///Users/davidchenallio/src/graphrefly-py/src/graphrefly/core/subgraph_locks.py) but adds split (py is monotonic-merge). Walk cost bounded by partition size; bounded smallness IS the parallelism premise. |
| Q2 | (a) cross-partition shared state in `cross_partition: Mutex<CrossPartitionState>` | Acquired alongside touched partitions; consistent ordering. |
| Q3 | (a-strict) reject mid-wave `set_deps` that triggers partition migration (merge or split) | Extends D1 reentrancy guard (`currently_firing` thread-local) to cover any topology mutation that would shift partition membership. Out-of-fire `set_deps` runs union/split synchronously. |
| Q4 | (a) per-partition `wave_owner: ReentrantMutex<()>` inside `SubgraphLockBox` | Required to make Option B actually parallel; cross-partition waves acquire multiple in `SubgraphId(root)` order. |
| Q5 | Locked as scope item: `Subscription::Drop` cross-partition cleanup cascade fires lock-released, acquires each upstream partition lock independently | Standard discipline; no new design needed. |
| Q6 | Locked as scope item: TLA+ extension of `wave_protocol_rewire` covering partition lock-ordering + cross-partition deadlock-freedom + union/split discipline | Mandatory before X5/Y1 acceptance. |
| Q7 | (a) cross-partition batches acquire all touched partitions upfront | Preserves user-facing "one batch = one wave" contract. |
| Q8 | Locked as scope item: multi-thread parallel-emit criterion bench validates sub-linear wall-clock scaling vs serialized | Mandatory before X5/Y1 acceptance. |

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

## 4. Locked design — union-find connectivity-based, split-eager

### Q1 lock: union-find + split-eager (rejected mount-aligned + monotonic merge)

**The user-surfaced precedent:** graphrefly-py's
[`src/graphrefly/core/subgraph_locks.py`](file:///Users/davidchenallio/src/graphrefly-py/src/graphrefly/core/subgraph_locks.py)
already implements union-find with `_LockBox` indirection and
`weakref.ref(node, finalizer)` for auto-cleanup on node GC. The
"WeakMap" referenced as the membership-tracking shape in prior
discussions IS the py weakref registry. Rust translates this directly:
no GC, but `Drop for NodeRecord` fires the equivalent finalizer.

**Why union-find connectivity-based wins over registration-based
(rejected (a) mount-aligned):** registration tags by *which Graph you
went through*, not by *connectivity*. Typical mount patterns import
parent values into a child Graph — the child's nodes get tagged as
the child's partition but transitively depend on parent partition
nodes. Every emit cascade across the mount boundary then crosses
partitions, producing constant cross-partition lock traffic that
defeats the parallelism premise.

**Why split-eager wins over monotonic-merge (the py choice):**
graphrefly-py was designed under GIL/free-threaded constraints where
parallelism is intrinsically limited; partition bloat under churn was
acceptable. The Rust port's primary motivation IS parallelism — the
same trade-off does not transfer. Long-running multi-agent /
dynamic-rewire workloads (the Wave 2 narrative target) churn `set_deps`
regularly; without split, partitions consolidate over time and
parallelism collapses asymptotically. Eager reachability walk on edge
removal is bounded by partition size (which is itself bounded by
keeping partitions small), so the cost stays tractable in exactly
the regime we want to enable.

**Implementation shape:**

```rust
// Newtype for partition identity
pub struct SubgraphId(u64);

pub(crate) struct SubgraphRegistry {
    parent: HashMap<NodeId, NodeId>,           // union-find parent
    rank: HashMap<NodeId, u32>,                // union-by-rank
    children: HashMap<NodeId, HashSet<NodeId>>, // reverse map for re-rooting on drop
    boxes: HashMap<NodeId, Arc<SubgraphLockBox>>, // root → lock box (only roots have entries)
}

pub(crate) struct SubgraphLockBox {
    // Per-partition wave_owner + state. On union, both old root boxes'
    // Arc<SubgraphLockBox> entries point to the same Arc — the lock
    // identity is preserved across merges (mirrors py's `_LockBox.lock`
    // redirect-on-union).
    wave_owner: parking_lot::ReentrantMutex<()>,
    state: parking_lot::Mutex<SubgraphState>,
}
```

**Lifecycle hooks:**

- **`Core::register(deps, …)`:** for each `dep` in `deps`,
  `union_nodes(new_node, dep)` after the new NodeId is allocated.
  Standalone register (no deps) creates a fresh singleton partition.
- **`Core::set_deps(n, new_deps)`:**
  - For each *new* edge in `new_deps - old_deps`: `union_nodes(n, new_dep)`.
  - For each *removed* edge in `old_deps - new_deps`: run reachability
    walk from n within partition WITHOUT the removed edge; if other
    endpoint reachable → no split; else → split partition into two,
    allocate fresh `SubgraphId` for the smaller half, migrate state.
  - Mid-wave `set_deps` that triggers union OR split is **rejected**
    via the existing `currently_firing` thread-local stack (extension
    of D1 reentrancy guard from Slice F A6).
- **`Drop for NodeRecord` (during teardown):** invoke registry cleanup.
  If `n` was the root, re-root one of its children (mirrors py's
  `_on_gc` re-rooting at lines 53-92). If `n` was non-root, remove from
  its parent's children set.
- **No edge-removal cleanup needed beyond split:** the union-find
  state for `n` itself stays until `Drop for NodeRecord`. Edge-removal
  only triggers reachability + possible split.

**Lock-acquisition discipline (mirrors py `lock_for` retry loop):**

- `lock_for(node)`: `_meta_lock` to find root + grab box's Arc; release
  meta lock; acquire `box.wave_owner`; under `_meta_lock` again,
  re-validate that the resolved root hasn't changed (concurrent union
  could have redirected the box). Bounded retry loop with
  `MAX_LOCK_RETRIES`.
- Cross-partition wave: sort touched components by `SubgraphId(root)`,
  acquire in ascending order. Deadlock-free.
- Cross-partition cascade hits the `defer_set` / `defer_down`-equivalent
  queue (mirrors py's `acquire_subgraph_write_lock_with_defer`) to
  avoid acquiring a second component lock under the first.

**Split walk algorithm:**

When `set_deps(n, new_deps)` removes edge `n → d`:
1. Hold `_meta_lock` + the partition's `wave_owner`.
2. BFS/DFS from `d` in the partition's node-set, traversing all
   edges *except* the removed `n → d`.
3. If `n` is reachable → no split, just remove the edge entry.
4. Else → mark all reachable-from-`d` as one new partition,
   reachable-from-`n` as another. Allocate fresh `SubgraphId` for
   the smaller half. Migrate `SubgraphState` entries (nodes,
   pending_notify, tier3_emitted_this_wave, etc.) from the
   originating box into the new box.
5. Update `parent` / `rank` / `children` / `boxes` maps under
   `_meta_lock` atomically.

**Cost:** O(K + E) within the affected partition. Most edge removals
are at leaf terminals where the walk is trivial. For internal edges,
the walk stays bounded by the partition's node count — and the whole
point of D3 is that partitions stay small.

**Mid-wave split rejection:** Slice F A6's thread-local
`currently_firing: Vec<NodeId>` is extended: when `set_deps(n, ...)`
detects either union or split, it checks if any node in the partition
that would be migrated is in `currently_firing`. If yes, return
`SetDepsError::ReentrantOnFiringNode` (current behavior) OR a new
`SetDepsError::PartitionMigrationDuringFire` variant. The simpler
choice: extend the existing variant to also fire here.

### Q2 lock: (a) cross-partition shared state in `cross_partition: Mutex<CrossPartitionState>`

Wave-scoped fields `pending_pause_overflow`, `pending_auto_resolve`,
`wave_cache_snapshots`, `deferred_handle_releases` move to
`cross_partition: Mutex<CrossPartitionState>`. Acquired alongside
the partitions a wave touches; each cross-partition wave acquires
`cross_partition` LAST (consistent ordering with partition-then-cross).

Wave-scoped fields are by definition wave-scoped, not partition-
scoped. Single cross-partition lock with fixed acquisition order is
simpler than per-partition replication.

### Q3 lock: (a-strict) reject mid-wave `set_deps` triggering partition migration

`tier3_emitted_this_wave` lives in `SubgraphState` (per-partition).
A node only ever emits in its own partition's wave (cross-partition
cascades emit on the consumer's node, which is in the consumer's
partition). So per-partition is the correct placement.

Mid-wave partition migration (union triggered by `set_deps` adding a
cross-component edge, OR split triggered by edge removal that
disconnects) is **rejected** by extending the D1 reentrancy guard.
`currently_firing` already prevents `set_deps(n, ...)` from inside
n's own fire (Slice F A6); we extend it: if a `set_deps` would
trigger union OR split AND any node in the affected partitions is in
`currently_firing`, return `SetDepsError::ReentrantOnFiringNode`.
Out-of-fire `set_deps` runs union/split synchronously without
constraint.

This keeps wave-scoped invariants simple: the partition a wave runs
in cannot change shape mid-flight. If a real consumer surfaces
pressure to allow mid-wave migration, lift via state-migration logic
in a follow-up.

### Q4 lock: (a) per-partition `wave_owner: ReentrantMutex<()>`

Lives inside `SubgraphLockBox`. Different components' waves run
truly parallel — same-partition re-entry passes through the
partition's own ReentrantMutex. Cross-partition waves acquire
multiple wave_owner locks in `SubgraphId(root)` ascending order.

Option (b) — Core-global `wave_owner` AND per-partition state
mutexes — defeats the parallelism premise: all waves still serialize
on one mutex. Rejected.

### Q5 scope: `Subscription::Drop` cross-partition cleanup cascade

When the last subscriber drops on a producer node in partition P,
the cleanup-hook cascade may unsubscribe from upstream sources in
other partitions (via `producer_deactivate`). Discipline: the drop
holds P's wave_owner when it observes "last sub", drops the wave_owner,
fires `cleanup_for` and `producer_deactivate` LOCK-RELEASED. Each
upstream unsub acquires its own partition's wave_owner independently.
Same-thread unsub via `ReentrantMutex` re-entrancy won't deadlock as
long as we acquire each partition lock lock-released.

No new design — standard Slice E2 D045-pattern lock-released firing.

### Q6 scope: TLA+ extension

Extend `wave_protocol_rewire.tla` to cover:
- Per-partition `wave_owner` model with `SubgraphId(root)` ordering.
- Cross-partition acquisition ordering invariant.
- `Subscription::Drop` cross-partition cleanup cascade.
- Cross-partition deadlock-freedom assertion under all interleavings.
- Union/split discipline + mid-wave reentrancy rejection.

Mandatory before X5/Y1 acceptance.

### Q7 lock: (a) cross-partition batches acquire all touched partitions upfront

`BenchCore` exposes `core.batch(...)` implicitly via
`batch_emit_handle_messages`. Under per-partition locks, cross-
partition batches acquire all touched partitions upfront (single-
batch semantics with multi-lock). Preserves user-facing "one batch
= one wave" contract.

Option (b) — per-partition batches with cross-partition split at
flush — breaks the contract for marginal parallelism gain. Rejected.

### Q8 scope: bench harness

Multi-thread parallel-emit criterion bench validates the
parallelism win. Today `dispatcher.rs` bench is single-thread. Add:
- N threads × M emits each on disjoint partitions; assert wall-
  clock time scales sub-linearly with N (the win signal vs
  serialized).
- N threads × M emits across cross-partition cascades; assert
  bounded cross-partition lock contention.

Mandatory before X5/Y1 acceptance.

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

**Current state:** **IMPLEMENTED + CLOSED 2026-05-09.** All 8 questions
answered; D3 closure batch landed across Slice X5 (substrate) and Slice
Y1+Y2 Phases B–L (wave-engine migration + split-eager + bench + Phase H
comprehensive tests + Phase I TLA+ verification + Phase K CLAUDE.md
invariant lift + Phase L closing docs). See
[`migration-status.md` Slice Y1+Y2 closing section](https://github.com/graphrefly/graphrefly-rs/blob/main/docs/migration-status.md)
and the strikethrough D3 entry in
[`porting-deferred.md`](https://github.com/graphrefly/graphrefly-rs/blob/main/docs/porting-deferred.md).
Decisions D089–D099 logged in
[`docs/rust-port-decisions.md`](../docs/rust-port-decisions.md).

**Outcome relative to acceptance bar:** disjoint-partition fn-fire-heavy
waves verified parallel (1.82× at 2 threads, 2.16× disjoint-vs-same
separation per Phase J bench); cross-partition `begin_batch_for`
ascending-`SubgraphId` acquisition + mid-wave reentrancy rejection +
union/split discipline verified deadlock-free across the TLA+ MC
configuration (3 nodes × 2 threads × MaxOps=7, see
`docs/research/wave_protocol_partitioned_MC.cfg`). **Important
spec-vs-impl note:** the TLA+ spec models the SAFE PROTOCOL — the
ascending-`SubgraphId` rule applied to EVERY acquire including
nested ones from inside a fire. The shipped Rust impl enforces the
rule WITHIN a single `compute_touched_partitions`-driven batch but
NOT across successive `begin_batch_for` calls on the same thread;
that gap is the deferred Phase H+ scope (see `porting-deferred.md`
"Cross-partition acquire-during-fire deadlock"). `Subscription::Drop`
in the v1 impl does NOT acquire wave_owners; the
`BeginSubscriptionDropCleanup` action in the spec is forward-compat
infra for the Q5 lift if/when Drop is widened to the cascade
shape. Tight-emit Regime A is the documented carry-forward —
addressed by the next batch ("Per-partition state-shard refactor
(Q2 + Q3 + Q-beyond)" in `porting-deferred.md`, bundled with the
H+ fix per the 2026-05-09 amendment).

**Original lock state (preserved for archive):** **LOCKED 2026-05-08.**
All 8 questions answered;
implementation gated only on Slice X5 / Y1 batch entry.

**Implementation summary:**
- Option B (single Core, per-partition state).
- Q1 = union-find connectivity-based, split-eager (mirrors
  graphrefly-py impl + adds split where py is monotonic-merge).
- Q2 = (a) cross-partition shared state in `cross_partition`.
- Q3 = (a-strict) reject mid-wave `set_deps` triggering migration.
- Q4 = (a) per-partition `wave_owner`.
- Q7 = (a) cross-partition batches acquire all touched partitions upfront.
- Q5/Q6/Q8 scope items locked.

**Implementation cost estimate (revised post-lock):** ~3500 LOC
(vs original 3000 estimate) — union-find registry adds bookkeeping
beyond the static partition assignment originally scoped under
Q1=(a) mount-aligned. Split-walk algorithm + mid-wave migration
rejection wiring + lock-validation retry loop (mirrors py's
`MAX_LOCK_RETRIES`) account for the delta.

**Cross-references:**
- `~/src/graphrefly-py/src/graphrefly/core/subgraph_locks.py` — **reference impl** (port directly with Rust newtypes + Drop-fired cleanup replacing Python weakref).
- `~/src/graphrefly-rs/docs/porting-deferred.md` — D3 entry.
- `~/src/graphrefly-rs/CLAUDE.md` — Rust invariant 3 wording updated to "current implementation" by X5/Y1.
- `archive/docs/SESSION-rust-port-architecture.md` — Part 8 (per-subgraph parking_lot::ReentrantMutex), Part 10 (perf simplifications).
- `docs/research/wave_protocol_rewire.tla` — base spec to extend per Q6.
- `docs/rust-port-decisions.md` — D085 (split decision + Option B recommendation), D086 (Q1 union-find + split-eager lock).
