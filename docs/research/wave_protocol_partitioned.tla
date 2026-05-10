--------------------------- MODULE wave_protocol_partitioned ---------------------------

(***************************************************************************
  Per-partition lock-ordering protocol verification — Phase I of D3
  closure (Slice Y1+Y2, 2026-05-09). Companion to `wave_protocol_rewire.tla`
  (which verifies the per-node SetDeps semantics).

  PURPOSE: model the partition lock-acquisition protocol that the Rust
  port (`graphrefly-rs`, Slice Y1 / Phase E) shipped, and verify the
  cross-partition deadlock-freedom + ascending-`SubgraphId` ordering
  invariants under an arbitrary interleaving of:

    - Cross-partition `begin_batch_for(seed)` (acquire-all-upfront).
    - Single-partition `Subscription::Drop` cleanup cascade
      (Q5 scope item).
    - Partition union (dep-edge addition) and split (edge removal that
      disconnects) — Q1 = (c-uf split-eager) per session-doc D086.
    - Mid-wave `set_deps` migration rejection (Q3 = (a-strict) per
      session-doc D086).

  CANONICAL SPEC: full per-node wave protocol semantics in
    `~/src/graphrefly/formal/wave_protocol.tla` and the rewire-specific
    slice in `wave_protocol_rewire.tla`. This module is ORTHOGONAL —
    it does NOT model message delivery, fn-fire, dirty/data semantics,
    or pause locks. It models ONLY the partition-locking concurrency
    layer that those protocols compose with.

  ----------------------------------------------------------------------------
  D094 / Q6 SCOPE — five items, all encoded:

  Q6.1. Per-partition `wave_owner` model with `SubgraphId(root)` ordering.
        → Variables `partitionHolder` (NodeId -> SUBSET Threads;
        singleton-or-empty), `threadHolds` (Thread -> SUBSET NodeIds).
        Action `BeginBatchFor`.
  Q6.2. Cross-partition acquisition ordering invariant — every acquisition
        sequence is ascending by partition id. ENCODED via per-action
        guards on `BeginBatchFor`, `BeginPending`, and
        `BeginSubscriptionDropCleanup`: every NEW partition this thread
        acquires must have an id strictly greater than every partition
        already held (`\A r \in newTargets : \A h \in threadHolds[t] : r > h`).
        **This is a SAFE-PROTOCOL spec.** It models the protocol AFTER
        the Phase H+ fix lands (option (d) detect-and-reject, or option
        (b) defer-to-post-flush). The shipped Rust impl in v1 enforces
        the rule WITHIN a single `compute_touched_partitions`-driven
        batch but NOT across successive `begin_batch_for` calls on the
        same thread (e.g., a producer fn that calls `subscribe` on a
        node in a different partition mid-fire). Removing the per-action
        guard from this spec reproduces the AB/BA counterexample within
        ~5 model actions (verified during Phase I development); the
        verified state-level evidence that the safe protocol works is
        `NoWaitForCycle` (Q6.4). See `porting-deferred.md`
        "Cross-partition acquire-during-fire deadlock (Phase H+)" for
        the impl-vs-spec gap and the chosen lift options.
  Q6.3. `Subscription::Drop` cross-partition cleanup cascade — when the
        cleanup walks upstream into another partition, it acquires in
        the same ascending-id order rule, no separate "drop-time"
        exception.
        → Action `BeginSubscriptionDropCleanup` (same atomic-acquire-all
        shape as `BeginBatchFor`).
  Q6.4. Cross-partition deadlock-freedom assertion under all interleavings.
        → Invariant `NoWaitForCycle` — the wait-for graph (thread A
        waits for partition held by B; B waits for one held by A;
        ...) never has a 2-cycle. With the model's bound of 2 threads,
        cycle-freedom reduces to "no two-cycle"; the protocol invariant
        generalizes via ascending-order acquisition.
  Q6.5. Union/split discipline + mid-wave reentrancy rejection.
        → Actions `Union`, `Split`, `EnterFire`, `ExitFire`. Invariants
        `PartitionPartitioning` (every node maps to exactly one
        partition root via the union-find); `MidFireMigrationRejected`
        (a `Union` or `Split` that would migrate a currently-firing
        node's partition is REJECTED by the action guard, not silently
        allowed; restated as a state invariant for adversarial
        verification).

  ----------------------------------------------------------------------------
  MODELING SIMPLIFICATIONS (intentional):

  - "Thread holds zero or one wave_owner per partition" is encoded as
    `partitionHolder[r] \in {{}, {t}}` — a SUBSET-of-Threads that's
    singleton-or-empty. Avoids mixed-type equalities (NIL sentinel vs
    Thread value) under TLC's strict typing.
  - "Thread is waiting on at most one partition" is encoded the same
    way: `threadPending[t]` is a SUBSET-of-NodeIds with cardinality
    at most 1.
  - Partitions are union-find ROOTs (`parent` map). Path compression
    is NOT modeled — it's a perf optimization, not a semantic one
    (see graphrefly-py `subgraph_locks.py:_find_locked` for the
    iterative two-pass walk).
  - Meta-companion edges are modeled separately from dep edges. Dep
    edges union partitions (Phase E `Core::register` /
    `Core::set_deps`); meta-companion edges do NOT union but DO
    contribute to `compute_touched_partitions`.
  - `set_deps` is modeled abstractly: an Add (which may union) or a
    Remove (which may split). Per-message semantics live in
    `wave_protocol_rewire.tla`.
  - The retry-validate loop (epoch-bump + retry on lost race) is
    NOT modeled — it's the IMPLEMENTATION of acquire-correctly under
    concurrent topology mutation; the SPEC just requires the final
    acquire matches the current partition assignment.
  - Union/Split require NO thread to hold the involved partitions —
    abstracts the "set_deps outside any in-flight wave" case (the
    common shape exercised by Phase F's test scenarios). Mid-wave
    migration is rejected via the `currentlyFiring` guard (Q3
    a-strict).
 ***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
    NodeIds,            \* Universe of nodes
    Threads,            \* Set of threads (e.g. {"t1", "t2"})
    MaxOps              \* Bound on total actions (to make state-space finite)

----------------------------------------------------------------------------
VARIABLES
    parent,             \* NodeId -> NodeId (union-find; parent[r] = r when r is its own root)
    depEdges,           \* SUBSET (NodeIds \X NodeIds): set of (parent, child) dep edges
    metaEdges,          \* SUBSET (NodeIds \X NodeIds): meta-companion edges
    partitionHolder,    \* NodeId -> SUBSET Threads (singleton-or-empty; encodes "this partition
                        \*   root is held by zero or one thread" without a sentinel value)
    threadHolds,        \* Thread -> SUBSET NodeIds (held partition roots)
    threadPending,      \* Thread -> SUBSET NodeIds (singleton-or-empty; partition root the thread
                        \*   is currently waiting on. Empty = not waiting.)
    currentlyFiring,    \* Thread -> SUBSET NodeIds (the firing-stack, for Q3)
    opCount             \* Total actions taken (state-bound)

vars == <<parent, depEdges, metaEdges, partitionHolder,
          threadHolds, threadPending,
          currentlyFiring, opCount>>

----------------------------------------------------------------------------
\* Helpers

\* Iterative root-finder. TLA+ does not have unbounded recursion; we
\* unroll with bounded fuel. Without path compression the worst-case
\* chain in a union-find of N nodes is N-1 hops; we use `Cardinality + 1`
\* as defensive headroom (catches off-by-one if a future Union variant
\* lengthens chains by one). If fuel hits 0 with `parent[n] # n`, the
\* returned value is NOT a root — `PartitionPartitioning` invariant
\* will catch the inconsistency loudly rather than the model silently
\* using a non-root as a partition id.
RECURSIVE Find(_, _)
Find(n, fuel) ==
    IF fuel = 0 \/ parent[n] = n
    THEN n
    ELSE Find(parent[n], fuel - 1)

PartitionRoot(n) == Find(n, Cardinality(NodeIds) + 1)

\* Set of all partition roots currently in the model.
AllRoots == { n \in NodeIds : parent[n] = n }

\* Touched-partition closure: starting from seed, follow current dep
\* edges (children: edges p->c) AND meta-companion edges. Returns the
\* set of partition roots reachable.
TouchedFrom(seed) ==
    LET reachable ==
        CHOOSE R \in SUBSET NodeIds :
            /\ seed \in R
            /\ \A m \in R :
                  /\ \A c \in NodeIds : (<<m, c>> \in depEdges => c \in R)
                  /\ \A c \in NodeIds : (<<m, c>> \in metaEdges => c \in R)
            /\ \A R2 \in SUBSET NodeIds :
                  ( /\ seed \in R2
                    /\ \A m \in R2 :
                         /\ \A c \in NodeIds : (<<m, c>> \in depEdges => c \in R2)
                         /\ \A c \in NodeIds : (<<m, c>> \in metaEdges => c \in R2) )
                  => R \subseteq R2
    IN { PartitionRoot(m) : m \in reachable }

\* Wait-for graph edge: thread t1 has a pending acquire on a partition
\* held by t2. Used by the deadlock-freedom invariant.
WaitsFor(t1, t2) ==
    /\ t1 # t2
    /\ \E p \in threadPending[t1] : p \in threadHolds[t2]

----------------------------------------------------------------------------
Init ==
    /\ parent = [n \in NodeIds |-> n]
    /\ depEdges = {}
    /\ metaEdges = {}
    /\ partitionHolder = [n \in NodeIds |-> {}]
    /\ threadHolds = [t \in Threads |-> {}]
    /\ threadPending = [t \in Threads |-> {}]
    /\ currentlyFiring = [t \in Threads |-> {}]
    /\ opCount = 0

----------------------------------------------------------------------------
\* ACTIONS

\* Union two partitions via a dep-edge addition. Per Phase E
\* `Core::register` / `Core::set_deps`, dep edges union partitions.
\* Tiebreak: smaller-id root absorbs into larger-id root (deterministic
\* — TLC explores all reachable states regardless).
\*
\* Q3 = (a-strict) MigrationRejection: if any node currently-firing on
\* ANY thread is in either involved partition, reject.
\*
\* Held-partition rejection: under the abstract model, Union only fires
\* when neither involved partition has an active wave_owner. Corresponds
\* to `set_deps` outside any in-flight wave (the common Phase F case).
\* Mid-wave migration is the cross-thread race the protocol must reject;
\* it is captured by the firing-guard above (Q3) — held-but-not-firing
\* would manifest under `Core::set_deps` from inside a wave that's not
\* currently in `invoke_fn`, but that scenario is folded into the
\* "thread holds partition" disposition: same-thread set_deps from
\* inside its own wave goes through `currently_firing` rejection.
Union(t, from, to) ==
    /\ opCount < MaxOps
    /\ from # to
    /\ <<from, to>> \notin depEdges
    /\ LET rFrom == PartitionRoot(from)
           rTo   == PartitionRoot(to)
       IN
       /\ \A th \in Threads :
            \A f \in currentlyFiring[th] :
              PartitionRoot(f) # rFrom /\ PartitionRoot(f) # rTo
       /\ \A th \in Threads :
            rFrom \notin threadHolds[th] /\ rTo \notin threadHolds[th]
       /\ depEdges' = depEdges \cup {<<from, to>>}
       /\ IF rFrom = rTo
            THEN parent' = parent
            ELSE
              LET newRoot == IF rFrom < rTo THEN rTo ELSE rFrom
                  oldRoot == IF rFrom < rTo THEN rFrom ELSE rTo
              IN parent' = [parent EXCEPT ![oldRoot] = newRoot]
       /\ \* Wave-owner state: both involved partitions are unowned by
          \* protocol guard, so partitionHolder for both stays empty.
          partitionHolder' = partitionHolder
       /\ opCount' = opCount + 1
       /\ UNCHANGED <<metaEdges, threadHolds, threadPending,
                      currentlyFiring>>

\* Split a partition by removing a dep edge that disconnects it.
\* Abstract model: when an edge is removed and both endpoints were in
\* the same partition, the `from` endpoint becomes its own root. This
\* mirrors the SPEC of Phase F split-eager — the actual split-walk
\* algorithm lives in `crates/graphrefly-core/src/node.rs`.
\*
\* Same migration-rejection rules apply (Q3 + held-partition).
Split(t, from, to) ==
    /\ opCount < MaxOps
    /\ <<from, to>> \in depEdges
    /\ LET rFrom == PartitionRoot(from)
           rTo   == PartitionRoot(to)
       IN
       /\ rFrom = rTo
       /\ \A th \in Threads :
            \A f \in currentlyFiring[th] :
              PartitionRoot(f) # rFrom
       /\ \A th \in Threads : rFrom \notin threadHolds[th]
       /\ depEdges' = depEdges \ {<<from, to>>}
       /\ parent' = [parent EXCEPT ![from] = from]
       /\ partitionHolder' = [partitionHolder EXCEPT ![from] = {}]
       /\ opCount' = opCount + 1
       /\ UNCHANGED <<metaEdges, threadHolds, threadPending,
                      currentlyFiring>>

\* Add a meta-companion edge. Does NOT union partitions but DOES
\* contribute to `TouchedFrom(seed)`.
AddMetaEdge(from, to) ==
    /\ opCount < MaxOps
    /\ from # to
    /\ <<from, to>> \notin metaEdges
    /\ metaEdges' = metaEdges \cup {<<from, to>>}
    /\ opCount' = opCount + 1
    /\ UNCHANGED <<parent, depEdges, partitionHolder, threadHolds,
                   threadPending, currentlyFiring>>

\* Cross-partition `begin_batch_for(seed)`: thread `t` attempts to
\* acquire every partition in `TouchedFrom(seed)` atomically, in
\* ascending root-id order. Modeled as ATOMIC for tractability —
\* TLA+ MC explores interleavings BETWEEN threads, not within a
\* single partition_wave_owner_lock_arc step (the real impl is a
\* sequence of parking_lot lock acquires; the abstract guarantee
\* is the same).
\*
\* Successful acquire: every targeted partition is either unowned
\* (`partitionHolder[r] = {}`) or already held by `t` (re-entrance).
\* If any is held by ANOTHER thread, we model this as `BeginPending`.
BeginBatchFor(t, seed) ==
    /\ opCount < MaxOps
    /\ threadPending[t] = {}  \* not currently waiting
    /\ LET targets == TouchedFrom(seed)
           newTargets == targets \ threadHolds[t]
       IN
       /\ \A r \in targets :
            partitionHolder[r] = {} \/ partitionHolder[r] = {t}
       /\ \* Q6.2 ascending-order rule: any NEW partition this thread
          \* acquires must have an id strictly greater than every
          \* partition already held. Re-entrance (target already in
          \* threadHolds[t]) is fine. Without this guard, two threads
          \* could acquire single partitions in opposite orders and
          \* then each pend on the other — the AB/BA cycle. The
          \* hazard is documented in `porting-deferred.md` under
          \* "Producer-pattern cross-partition subscribe deadlock"
          \* (Phase H+ scope item — v1 ships with the hazard); the
          \* SAFE protocol that THIS spec verifies enforces the rule.
          \A r \in newTargets :
            \A h \in threadHolds[t] : r > h
       /\ partitionHolder' =
            [r \in NodeIds |->
              IF r \in targets THEN {t} ELSE partitionHolder[r]]
       /\ threadHolds' = [threadHolds EXCEPT ![t] = @ \cup targets]
       /\ opCount' = opCount + 1
       /\ UNCHANGED <<parent, depEdges, metaEdges, threadPending,
                      currentlyFiring>>

\* If any target partition is held by another thread, the acquire is
\* PENDING. We record the FIRST contended target (lowest id) in
\* threadPending. This abstracts parking_lot's queue-on-lock semantics.
\* The deadlock-freedom invariant (NoWaitForCycle) proves no cycle
\* can form via this state.
BeginPending(t, seed) ==
    /\ opCount < MaxOps
    /\ threadPending[t] = {}
    /\ LET targets == TouchedFrom(seed)
           newTargets == targets \ threadHolds[t]
           contended == { r \in targets :
                            partitionHolder[r] # {} /\
                            partitionHolder[r] # {t} }
       IN
       /\ contended # {}
       /\ \* Same Q6.2 ascending-order rule as BeginBatchFor — pending
          \* attempts must also obey ascending order. The protocol
          \* invariant is about ATTEMPTED acquires, not just successful
          \* ones; without this guard, the deadlock-attempt itself
          \* manifests in the model.
          \A r \in newTargets :
            \A h \in threadHolds[t] : r > h
       /\ LET firstContended == CHOOSE r \in contended :
                                  \A r2 \in contended : r <= r2
          IN threadPending' = [threadPending EXCEPT ![t] = {firstContended}]
    /\ opCount' = opCount + 1
    /\ UNCHANGED <<parent, depEdges, metaEdges, partitionHolder,
                   threadHolds, currentlyFiring>>

\* `Subscription::Drop` cross-partition cleanup cascade (Q5 scope).
\* Walk upstream dep edges from `n`, acquire each upstream partition
\* in ascending order. Same protocol shape as BeginBatchFor — the
\* ascending-id rule applies uniformly to drop-time acquisitions.
BeginSubscriptionDropCleanup(t, n) ==
    /\ opCount < MaxOps
    /\ threadPending[t] = {}
    /\ LET upstreamPartitions ==
            { PartitionRoot(u) : u \in { x \in NodeIds : <<x, n>> \in depEdges } }
            \cup { PartitionRoot(n) }
           newTargets == upstreamPartitions \ threadHolds[t]
       IN
       /\ \A r \in upstreamPartitions :
            partitionHolder[r] = {} \/ partitionHolder[r] = {t}
       /\ \* Same Q6.2 ascending-order rule as BeginBatchFor.
          \A r \in newTargets :
            \A h \in threadHolds[t] : r > h
       /\ partitionHolder' =
            [r \in NodeIds |->
              IF r \in upstreamPartitions THEN {t} ELSE partitionHolder[r]]
       /\ threadHolds' = [threadHolds EXCEPT ![t] = @ \cup upstreamPartitions]
       /\ opCount' = opCount + 1
       /\ UNCHANGED <<parent, depEdges, metaEdges, threadPending,
                      currentlyFiring>>

\* Release all partitions held by thread `t`. End of `run_wave` /
\* `run_wave_for`. Drops the BatchGuard's wave_guards in reverse
\* order; abstractly the held set empties.
\*
\* Pre-condition: thread has exited all fires. Mirrors the real impl
\* — `BatchGuard::drop` runs AFTER `drain_and_flush` has drained every
\* `pending_fires` entry, which means every `FiringGuard` constructed
\* during the wave has already been dropped (popping its node from
\* `currentlyFiring`). Without this guard the spec admits a state
\* where MidFireMigrationRejected fails — see Phase I development
\* notes.
ReleaseAll(t) ==
    /\ opCount < MaxOps
    /\ threadHolds[t] # {}
    /\ currentlyFiring[t] = {}
    /\ partitionHolder' =
        [r \in NodeIds |->
           IF r \in threadHolds[t] /\ partitionHolder[r] = {t}
             THEN {}
             ELSE partitionHolder[r]]
    /\ threadHolds' = [threadHolds EXCEPT ![t] = {}]
    /\ \* Wake any thread that was pending on a partition we released.
       threadPending' =
         [t2 \in Threads |->
            IF t2 # t /\ \E p \in threadPending[t2] :
                          partitionHolder'[p] = {}
              THEN {}
              ELSE threadPending[t2]]
    /\ opCount' = opCount + 1
    /\ UNCHANGED <<parent, depEdges, metaEdges, currentlyFiring>>

\* Enter the firing stack for node n. Models `FiringGuard::new` push.
EnterFire(t, n) ==
    /\ opCount < MaxOps
    /\ n \notin currentlyFiring[t]
    /\ \* Pre-condition: thread holds n's partition.
       PartitionRoot(n) \in threadHolds[t]
    /\ currentlyFiring' = [currentlyFiring EXCEPT ![t] = @ \cup {n}]
    /\ opCount' = opCount + 1
    /\ UNCHANGED <<parent, depEdges, metaEdges, partitionHolder,
                   threadHolds, threadPending>>

\* Exit the firing stack for node n. Models `FiringGuard::drop` pop.
ExitFire(t, n) ==
    /\ opCount < MaxOps
    /\ n \in currentlyFiring[t]
    /\ currentlyFiring' = [currentlyFiring EXCEPT ![t] = @ \ {n}]
    /\ opCount' = opCount + 1
    /\ UNCHANGED <<parent, depEdges, metaEdges, partitionHolder,
                   threadHolds, threadPending>>

----------------------------------------------------------------------------
\* Next-state relation
Next ==
    \/ \E t \in Threads, from \in NodeIds, to \in NodeIds : Union(t, from, to)
    \/ \E t \in Threads, from \in NodeIds, to \in NodeIds : Split(t, from, to)
    \/ \E from \in NodeIds, to \in NodeIds : AddMetaEdge(from, to)
    \/ \E t \in Threads, seed \in NodeIds : BeginBatchFor(t, seed)
    \/ \E t \in Threads, seed \in NodeIds : BeginPending(t, seed)
    \/ \E t \in Threads, n \in NodeIds : BeginSubscriptionDropCleanup(t, n)
    \/ \E t \in Threads : ReleaseAll(t)
    \/ \E t \in Threads, n \in NodeIds : EnterFire(t, n)
    \/ \E t \in Threads, n \in NodeIds : ExitFire(t, n)

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
\* INVARIANTS

\* Type invariant.
TypeOK ==
    /\ \A n \in NodeIds : parent[n] \in NodeIds
    /\ depEdges \subseteq (NodeIds \X NodeIds)
    /\ metaEdges \subseteq (NodeIds \X NodeIds)
    /\ \A n \in NodeIds : partitionHolder[n] \subseteq Threads
    /\ \A n \in NodeIds : Cardinality(partitionHolder[n]) <= 1
    /\ \A t \in Threads : threadHolds[t] \subseteq NodeIds
    /\ \A t \in Threads : threadPending[t] \subseteq NodeIds
    /\ \A t \in Threads : Cardinality(threadPending[t]) <= 1
    /\ \A t \in Threads : currentlyFiring[t] \subseteq NodeIds

\* Q6.1: every held partition root is its own root in the union-find.
HoldsAreRoots ==
    \A t \in Threads :
        \A r \in threadHolds[t] : parent[r] = r

\* Q6.1: a partition is held by at most one thread (encoded by
\* TypeOK's cardinality bound, restated for clarity).
SinglePartitionOwner ==
    \A r \in NodeIds : Cardinality(partitionHolder[r]) <= 1

\* Q6.1 / Q6.5: every node's PartitionRoot is consistent — the union-find
\* parent map is a forest (no cycles).
PartitionPartitioning ==
    \A n \in NodeIds : PartitionRoot(n) \in AllRoots

\* Q6.1 / Q6.5: partitionHolder and threadHolds are kept in sync.
HolderAndHoldsConsistent ==
    /\ \A r \in NodeIds, t \in Threads :
         (t \in partitionHolder[r]) <=> (r \in threadHolds[t])

\* Q6.4: the wait-for graph is acyclic. With the model's bound of 2
\* threads (see MC harness), cycle-freedom reduces to "no two-cycle":
\* threads t1 and t2 cannot both be pending on partitions held by
\* the other. Generalizing to N threads requires fixed-point
\* reachability; the protocol invariant is that ASCENDING-ORDER
\* acquisition rules out cycles of any length, but the model
\* checker only needs to verify the bounded scenario.
NoWaitForCycle ==
    \A t1, t2 \in Threads :
         (t1 # t2 /\ WaitsFor(t1, t2) /\ WaitsFor(t2, t1)) => FALSE

\* Q6.5: a `Union` or `Split` that would migrate a currently-firing
\* node's partition is REJECTED by the action guard. Restated as a
\* state invariant: every currently-firing node's partition is
\* held by the firing thread.
MidFireMigrationRejected ==
    \A t \in Threads :
        \A n \in currentlyFiring[t] :
            PartitionRoot(n) \in threadHolds[t]

\* Composite invariant — what the MC harness asserts.
PartitionedInvariants ==
    /\ TypeOK
    /\ HoldsAreRoots
    /\ SinglePartitionOwner
    /\ PartitionPartitioning
    /\ HolderAndHoldsConsistent
    /\ NoWaitForCycle
    /\ MidFireMigrationRejected

============================================================================
