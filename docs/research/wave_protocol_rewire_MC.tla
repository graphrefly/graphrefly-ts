--------------------------- MODULE wave_protocol_rewire_MC ---------------------------

(***************************************************************************
  Model-checking entry point for `wave_protocol_rewire.tla` (2026-05-03).

  Topology: 3-node graph
    A (source, value emitter)
    B (source, value emitter)
    C (compute, initial deps = {A}; rewire candidate universe = {A, B})

  Exercises:
    - SetDeps(C, {B}) — straight rewire from {A} to {B}
    - SetDeps(C, {A, B}) — add B without removing A
    - SetDeps(C, {}) — remove all deps (edge case)
    - SetDeps(C, {A}) — no-op idempotent
    - Rewire while C paused (via Pause + SetDeps interleaving)
    - Rewire mid-wave (after EmitFromSource(A) → DeliverDirty(A, C),
      before DeliverData(A, C))
    - Rewire to dep with cached DATA (push-on-subscribe verified)
    - Rewire when removed dep is sole DIRTY participant (wave closes)

  State-space: 3 nodes, 2 values, MaxEmits=2, MaxRewires=2, MaxPauses=2,
  MaxDeliveries=4. Tight bound; should verify in <30s.

  Invariants asserted: RewireInvariants from wave_protocol_rewire (composite
  of TypeOK + Q1/Q2/Q3/Q4/Q6/Q7 invariants).
 ***************************************************************************)

EXTENDS wave_protocol_rewire

\* Topology constants
NodeIdsMC     == {"A", "B", "C"}
SourceIdsMC   == {"A", "B"}
ComputeIdsMC  == {"C"}

InitialDepsMC ==
    [n \in NodeIdsMC |-> IF n = "C" THEN {"A"} ELSE {}]

\* Universe of possible deps for each node. C can have any subset of {A, B}
\* as deps post-rewire. Sources have no candidate deps (sources don't rewire).
DepCandidatesMC ==
    [n \in NodeIdsMC |->
       IF n = "C" THEN {"A", "B"}
       ELSE {}]

ValuesMC      == {"v0", "v1"}
LockIdsMC     == {10}
MaxEmitsMC      == 2
MaxRewiresMC    == 2
MaxPausesMC     == 2
MaxDeliveriesMC == 4

============================================================================
