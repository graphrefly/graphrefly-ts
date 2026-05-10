--------------------------- MODULE wave_protocol_partitioned_MC ---------------------------

(***************************************************************************
  Model-checking entry point for `wave_protocol_partitioned.tla`
  (Phase I of D3 closure, Slice Y1+Y2, 2026-05-09).

  Topology: 3-node graph with 2 threads, opCount-bounded for tractability.

    NodeIds = {1, 2, 3}    (integers — `<` ordering matches Q6.2)
    Threads = {"t1", "t2"}
    MaxOps  = 7

  Exercises (across all interleavings):
    - Union of two singleton partitions via dep edge (Q6.5 union path)
    - Cross-partition acquire of {P_x, P_y} via meta-companion (Q6.1 + Q6.2)
    - Two threads acquiring overlapping touched-partition sets — only
      one succeeds, the other goes pending (Q6.4)
    - Subscription drop cleanup walking upstream (Q6.3)
    - Mid-fire union/split rejection — EnterFire-then-Union must not
      take if the union would migrate the firing node (Q6.5)
    - Reciprocal cross-partition acquire-then-release-then-reacquire
      cycles (needs MaxOps ≥ 7 — minimum trace: T1.BeginBatchFor +
      T2.BeginBatchFor + T1.ReleaseAll + T2.ReleaseAll +
      T1.BeginBatchFor with new seed + cleanup = 6 ops, plus
      topology setup pushes to 7).

  State-space: 3 nodes × 2 threads × MaxOps=7 keeps the explored states
  bounded but exercises full release-and-reacquire cycles. Note: the
  action set is rich (9 distinct actions × parameter cross-product) —
  each opCount step branches widely. MaxOps was 5 in the initial Phase I
  draft (per /qa it was raised to 7 to reach the reciprocal-cascade
  scenario the spec is built to verify). Larger MaxOps values
  (e.g., 10+) explode combinatorially; if a future audit needs deeper
  traces or a richer topology (e.g., 4 nodes), file a follow-up MC
  variant rather than expanding this CI-targeted harness.

  Invariants asserted: PartitionedInvariants composite (TypeOK +
  HoldsAreRoots + SinglePartitionOwner + PartitionPartitioning +
  AscendingAcquisitionOrder + NoWaitForCycle + MidFireMigrationRejected +
  DropCleanupAscending).
 ***************************************************************************)

EXTENDS wave_protocol_partitioned

\* Topology constants
NodeIdsMC   == {1, 2, 3}
ThreadsMC   == {"t1", "t2"}
MaxOpsMC    == 7

============================================================================
