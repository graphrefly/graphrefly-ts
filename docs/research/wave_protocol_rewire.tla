--------------------------- MODULE wave_protocol_rewire ---------------------------

(***************************************************************************
  Rewire-protocol design verification — Phase 13.7 prep artifact (2026-05-03).

  PURPOSE: verify the design of `node.setDeps(newDeps)` (the substrate
  primitive underlying `graph.rewire(name, newDeps)`) before M1 implements
  it. This spec is FOCUSED on the rewire-specific design questions, not
  a re-derivation of the full wave protocol.

  CANONICAL SPEC: full wave protocol lives in
    `~/src/graphrefly/formal/wave_protocol.tla` (2865 lines, ~35 invariants).
  Once rewire semantics verify clean here, M1 implementation integrates
  them into the production code; full wave_protocol.tla integration of
  the SetDeps action happens post-M1.

  ----------------------------------------------------------------------------
  DESIGN QUESTIONS UNDER VERIFICATION:

  Q1. After SetDeps(n, newDeps), is dirtyMask[n] consistent? Specifically:
      bits for removed deps are cleared; bits for added deps start clean.
      → Invariant: RewireDirtyConsistency.

  Q2. Is firstRunPassed[n] preserved across SetDeps?
      → Invariant: RewirePreservesFirstRun (relational, via ghost).

  Q3. Are pauseLocks[n] and pauseBuffer[n] preserved across SetDeps?
      → Invariants: RewirePreservesPauseLocks, RewirePreservesPauseBuffer.

  Q4. Is the DepRecord collection (prevData) consistent with deps post-SetDeps?
      → Invariant: DepRecordDomainConsistency.

  Q5. Is SetDeps(n, deps[n]) idempotent (no observable effect)?
      → Invariant: IdempotentSetDepsIsNoop (verified by action shape).

  Q6. Mid-wave SetDeps: if removed dep was sole DIRTY participant, wave closes.
      → Invariant: WaveClosesWhenSoleDirtyDepRemoved.

  Q7. ROM/RAM rule: cache preserved across SetDeps for compute nodes that
      remain activated. (R2.2.7/R2.2.8.)
      → Invariant: RewirePreservesCache.

  ----------------------------------------------------------------------------
  MODEL SIMPLIFICATIONS (intentional):

  - One-hop dep wiring only. No fn-fire-emits-downstream. The rewire
    invariants are about per-node state, not multi-hop propagation.
    Multi-hop interaction lives in wave_protocol.tla and gets exercised
    when SetDeps integrates there post-M1.
  - Identity equals only.
  - No batch coalescing, no INVALIDATE, no terminal lifecycle, no replay.
  - Pause mode = "resumeAll" implicitly (pauseBuffer captures emissions
    when paused).
  - Always activated (no subscribe/unsubscribe).
 ***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
    NodeIds,            \* All nodes
    SourceIds,          \* Sources can Emit
    ComputeIds,         \* Fn-of-deps; disjoint from SourceIds
    InitialDeps,        \* NodeId -> SUBSET NodeIds
    DepCandidates,      \* NodeId -> SUBSET NodeIds (universe of possible deps)
    Values,             \* Payload alphabet
    LockIds,
    MaxEmits,
    MaxRewires,
    MaxPauses,
    MaxDeliveries       \* Bound on DeliverDirty/DeliverData firings (queues drain)

\* SENTINEL marker. Per R1.2.4, undefined/None is the global SENTINEL;
\* we model with the string "SENTINEL".
SENTINEL == "SENTINEL"

ValueOrSentinel == Values \cup {SENTINEL}

\* Edge universe: every <<p, c>> where p could be a dep of c.
EdgeUniverse ==
    {<<p, c>> \in NodeIds \X NodeIds : p \in DepCandidates[c]}

\* Message records.
DirtyMsg    == [type |-> "DIRTY"]
DataMsg(v)  == [type |-> "DATA", val |-> v]

MessageDomain ==
    [type : {"DIRTY"}]
        \cup [type : {"DATA"}, val : Values]

----------------------------------------------------------------------------
VARIABLES
    deps,                  \* NodeId -> SUBSET NodeIds (mutable)
    cache,                 \* NodeId -> ValueOrSentinel
    status,                \* NodeId -> {"settled", "dirty"}
    firstRunPassed,        \* NodeId -> BOOLEAN
    dirtyMask,             \* NodeId -> SUBSET NodeIds
    prevData,              \* NodeId -> [NodeId -> ValueOrSentinel]
    queues,                \* <<p, c>> -> Seq(MessageDomain)
    pauseLocks,            \* NodeId -> SUBSET LockIds
    pauseBuffer,           \* NodeId -> Seq(MessageDomain)
    emitCount,
    rewireCount,
    pauseActionCount,
    deliveryCount,
    \* Ghost: pre-rewire snapshots, used by relational invariants.
    ghostPreFirstRun,
    ghostPrePauseLocks,
    ghostPrePauseBuffer,
    ghostPreCache,
    ghostJustRewired       \* NodeId -> BOOLEAN; TRUE only in the step right after SetDeps.

vars == <<deps, cache, status, firstRunPassed, dirtyMask, prevData, queues,
          pauseLocks, pauseBuffer,
          emitCount, rewireCount, pauseActionCount, deliveryCount,
          ghostPreFirstRun, ghostPrePauseLocks, ghostPrePauseBuffer,
          ghostPreCache, ghostJustRewired>>

----------------------------------------------------------------------------
\* Helpers

IsSource(n) == n \in SourceIds
IsCompute(n) == n \in ComputeIds
IsPaused(n) == pauseLocks[n] # {}

DefaultInit == CHOOSE v \in Values : TRUE

\* Edges currently active in the topology.
ActiveEdgesNow == {<<p, c>> \in EdgeUniverse : p \in deps[c]}

----------------------------------------------------------------------------
Init ==
    /\ deps = InitialDeps
    /\ cache = [n \in NodeIds |->
                  IF IsSource(n) THEN DefaultInit ELSE SENTINEL]
    /\ status = [n \in NodeIds |-> "settled"]
    /\ firstRunPassed = [n \in NodeIds |-> IsSource(n)]
    /\ dirtyMask = [n \in NodeIds |-> {}]
    /\ prevData = [n \in NodeIds |-> [d \in NodeIds |-> SENTINEL]]
    /\ queues = [e \in EdgeUniverse |-> <<>>]
    /\ pauseLocks = [n \in NodeIds |-> {}]
    /\ pauseBuffer = [n \in NodeIds |-> <<>>]
    /\ emitCount = 0
    /\ rewireCount = 0
    /\ pauseActionCount = 0
    /\ deliveryCount = 0
    /\ ghostPreFirstRun = [n \in NodeIds |-> IsSource(n)]
    /\ ghostPrePauseLocks = [n \in NodeIds |-> {}]
    /\ ghostPrePauseBuffer = [n \in NodeIds |-> <<>>]
    /\ ghostPreCache = [n \in NodeIds |->
                          IF IsSource(n) THEN DefaultInit ELSE SENTINEL]
    /\ ghostJustRewired = [n \in NodeIds |-> FALSE]

----------------------------------------------------------------------------
\* ACTIONS

\* Source emits DATA. Two-phase: enqueue [DIRTY, DATA(v)] to each child
\* edge that's currently active.
EmitFromSource(src, v) ==
    /\ IsSource(src)
    /\ ~ IsPaused(src)
    /\ emitCount < MaxEmits
    /\ cache' = [cache EXCEPT ![src] = v]
    /\ status' = [status EXCEPT ![src] = "settled"]
    /\ queues' = [e \in EdgeUniverse |->
                    IF e[1] = src /\ src \in deps[e[2]]
                    THEN Append(Append(queues[e], DirtyMsg), DataMsg(v))
                    ELSE queues[e]]
    /\ emitCount' = emitCount + 1
    /\ ghostJustRewired' = [n \in NodeIds |-> FALSE]
    /\ UNCHANGED <<deps, firstRunPassed, dirtyMask, prevData,
                   pauseLocks, pauseBuffer,
                   rewireCount, pauseActionCount, deliveryCount,
                   ghostPreFirstRun, ghostPrePauseLocks,
                   ghostPrePauseBuffer, ghostPreCache>>

\* Deliver DIRTY at child c from parent p.
DeliverDirty(p, c) ==
    /\ <<p, c>> \in EdgeUniverse
    /\ p \in deps[c]
    /\ Len(queues[<<p, c>>]) > 0
    /\ Head(queues[<<p, c>>]).type = "DIRTY"
    /\ deliveryCount < MaxDeliveries
    /\ queues' = [queues EXCEPT ![<<p, c>>] = Tail(@)]
    /\ dirtyMask' = [dirtyMask EXCEPT ![c] = @ \cup {p}]
    /\ status' = [status EXCEPT ![c] = "dirty"]
    /\ deliveryCount' = deliveryCount + 1
    /\ ghostJustRewired' = [n \in NodeIds |-> FALSE]
    /\ UNCHANGED <<deps, cache, firstRunPassed, prevData,
                   pauseLocks, pauseBuffer,
                   emitCount, rewireCount, pauseActionCount,
                   ghostPreFirstRun, ghostPrePauseLocks,
                   ghostPrePauseBuffer, ghostPreCache>>

\* Deliver DATA(v) at child c from parent p. Updates prevData[c][p] = v,
\* clears the dirty bit for p, settles status if mask now empty.
\* No downstream fn-fire-emit (out of scope for this rewire-focused model).
DeliverData(p, c) ==
    /\ <<p, c>> \in EdgeUniverse
    /\ p \in deps[c]
    /\ Len(queues[<<p, c>>]) > 0
    /\ Head(queues[<<p, c>>]).type = "DATA"
    /\ deliveryCount < MaxDeliveries
    /\ LET v == Head(queues[<<p, c>>]).val
           newMask == dirtyMask[c] \ {p}
       IN
       /\ queues' = [queues EXCEPT ![<<p, c>>] = Tail(@)]
       /\ prevData' = [prevData EXCEPT ![c][p] = v]
       /\ dirtyMask' = [dirtyMask EXCEPT ![c] = newMask]
       /\ status' = IF newMask = {}
                       THEN [status EXCEPT ![c] = "settled"]
                       ELSE status
       /\ \* Update firstRunPassed if all deps now have non-SENTINEL prevData
          \* (first-run gate condition). Once TRUE, stays TRUE.
          firstRunPassed' =
            [firstRunPassed EXCEPT ![c] =
               firstRunPassed[c] \/
               (IsCompute(c) /\
                  \A d \in deps[c] :
                    (IF d = p THEN v ELSE prevData[c][d]) # SENTINEL)]
       /\ \* Cache for compute: if first-run-gate just opened, cache becomes
          \* the latest delivered value (simplified fn output). For verification
          \* of rewire invariants the actual fn semantics don't matter.
          cache' = IF IsCompute(c) /\ newMask = {} /\
                      (\A d \in deps[c] :
                          (IF d = p THEN v ELSE prevData[c][d]) # SENTINEL)
                     THEN [cache EXCEPT ![c] = v]
                     ELSE cache
    /\ deliveryCount' = deliveryCount + 1
    /\ ghostJustRewired' = [n \in NodeIds |-> FALSE]
    /\ UNCHANGED <<deps, pauseLocks, pauseBuffer,
                   emitCount, rewireCount, pauseActionCount,
                   ghostPreFirstRun, ghostPrePauseLocks,
                   ghostPrePauseBuffer, ghostPreCache>>

\* Pause node n with lockId l.
Pause(n, l) ==
    /\ pauseActionCount < MaxPauses
    /\ l \notin pauseLocks[n]
    /\ pauseLocks' = [pauseLocks EXCEPT ![n] = @ \cup {l}]
    /\ pauseActionCount' = pauseActionCount + 1
    /\ ghostJustRewired' = [n2 \in NodeIds |-> FALSE]
    /\ UNCHANGED <<deps, cache, status, firstRunPassed, dirtyMask, prevData,
                   queues, pauseBuffer,
                   emitCount, rewireCount, deliveryCount,
                   ghostPreFirstRun, ghostPrePauseLocks,
                   ghostPrePauseBuffer, ghostPreCache>>

\* Resume node n with lockId l. If l was the last lock, drain pauseBuffer
\* into outgoing edges (per R2.6 "resumeAll" mode).
\* This model doesn't synthesize buffered emissions during pause (we don't
\* model fn-fire-while-paused), so pauseBuffer is empty at Resume time
\* unless populated by a future enrichment. The action is here for symmetry
\* and to model lock release.
Resume(n, l) ==
    /\ pauseActionCount < MaxPauses
    /\ l \in pauseLocks[n]
    /\ LET newLocks == pauseLocks[n] \ {l}
           willDrain == newLocks = {}
       IN
       /\ pauseLocks' = [pauseLocks EXCEPT ![n] = newLocks]
       /\ IF willDrain
            THEN /\ queues' =
                      [e \in EdgeUniverse |->
                         IF e[1] = n /\ n \in deps[e[2]]
                         THEN queues[e] \o pauseBuffer[n]
                         ELSE queues[e]]
                 /\ pauseBuffer' = [pauseBuffer EXCEPT ![n] = <<>>]
            ELSE /\ queues' = queues
                 /\ pauseBuffer' = pauseBuffer
    /\ pauseActionCount' = pauseActionCount + 1
    /\ ghostJustRewired' = [n2 \in NodeIds |-> FALSE]
    /\ UNCHANGED <<deps, cache, status, firstRunPassed, dirtyMask, prevData,
                   emitCount, rewireCount, deliveryCount,
                   ghostPreFirstRun, ghostPrePauseLocks,
                   ghostPrePauseBuffer, ghostPreCache>>

\* THE REWIRE ACTION UNDER VERIFICATION.
\* SetDeps(n, newDeps) atomically replaces deps[n].
SetDeps(n, newDeps) ==
    /\ rewireCount < MaxRewires
    /\ IsCompute(n)
    /\ newDeps \subseteq DepCandidates[n]
    /\ LET removed == deps[n] \ newDeps
           added == newDeps \ deps[n]
           clearedMask == dirtyMask[n] \ removed
           \* prevData: removed deps reset to SENTINEL; added deps start at SENTINEL.
           \* Unchanged for deps that stay.
           newPrevDataN ==
             [d \in NodeIds |->
                IF d \in removed THEN SENTINEL
                ELSE IF d \in added THEN SENTINEL
                ELSE prevData[n][d]]
           \* Drain queues for edges that are no longer active (removed deps).
           \* Per the design: "discard with the DepRecord."
           drainedQueues ==
             [e \in EdgeUniverse |->
                IF e[2] = n /\ e[1] \in removed
                THEN <<>>
                ELSE queues[e]]
           \* Push-on-subscribe for added deps with cached DATA.
           \* Per R1.2.3: subscribe handshake delivers cached DATA to new subscriber.
           \* If the added dep's cache is SENTINEL (never emitted DATA), no push.
           pushOnSubscribeQueues ==
             [e \in EdgeUniverse |->
                IF e[2] = n /\ e[1] \in added /\ cache[e[1]] # SENTINEL
                THEN drainedQueues[e] \o
                       << DirtyMsg, DataMsg(cache[e[1]]) >>
                ELSE drainedQueues[e]]
       IN
       /\ deps' = [deps EXCEPT ![n] = newDeps]
       /\ dirtyMask' = [dirtyMask EXCEPT ![n] = clearedMask]
       /\ prevData' = [prevData EXCEPT ![n] = newPrevDataN]
       /\ queues' = pushOnSubscribeQueues
       \* Preserved per design:
       /\ firstRunPassed' = firstRunPassed                       \* (Q2)
       /\ pauseLocks' = pauseLocks                               \* (Q3)
       /\ pauseBuffer' = pauseBuffer                             \* (Q3)
       /\ cache' = cache                                         \* (Q7)
       /\ status' = IF clearedMask = {} /\ status[n] = "dirty"
                       THEN [status EXCEPT ![n] = "settled"]
                       ELSE status
       /\ rewireCount' = rewireCount + 1
       /\ ghostPreFirstRun' = [ghostPreFirstRun EXCEPT ![n] = firstRunPassed[n]]
       /\ ghostPrePauseLocks' = [ghostPrePauseLocks EXCEPT ![n] = pauseLocks[n]]
       /\ ghostPrePauseBuffer' = [ghostPrePauseBuffer EXCEPT ![n] = pauseBuffer[n]]
       /\ ghostPreCache' = [ghostPreCache EXCEPT ![n] = cache[n]]
       /\ ghostJustRewired' = [n2 \in NodeIds |-> n2 = n]
    /\ UNCHANGED <<emitCount, pauseActionCount, deliveryCount>>

----------------------------------------------------------------------------
\* Next-state relation
Next ==
    \/ \E src \in SourceIds, v \in Values : EmitFromSource(src, v)
    \/ \E p \in NodeIds, c \in NodeIds : DeliverDirty(p, c)
    \/ \E p \in NodeIds, c \in NodeIds : DeliverData(p, c)
    \/ \E n \in NodeIds, l \in LockIds : Pause(n, l)
    \/ \E n \in NodeIds, l \in LockIds : Resume(n, l)
    \/ \E n \in ComputeIds :
         \E newDeps \in SUBSET DepCandidates[n] : SetDeps(n, newDeps)

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
\* INVARIANTS

\* Type invariant.
TypeOK ==
    /\ \A n \in NodeIds : deps[n] \subseteq DepCandidates[n]
    /\ \A n \in NodeIds : cache[n] \in ValueOrSentinel
    /\ \A n \in NodeIds : status[n] \in {"settled", "dirty"}
    /\ \A n \in NodeIds : firstRunPassed[n] \in BOOLEAN
    /\ \A n \in NodeIds : dirtyMask[n] \subseteq NodeIds
    /\ \A n \in NodeIds : pauseLocks[n] \subseteq LockIds
    /\ \A n \in NodeIds : \A d \in NodeIds : prevData[n][d] \in ValueOrSentinel

\* Q1: dirtyMask[n] only contains current deps.
RewireDirtyConsistency ==
    \A n \in NodeIds : dirtyMask[n] \subseteq deps[n]

\* Q4: prevData entries for current deps are well-typed. (The strict version
\* "prevData[n][d] = SENTINEL for newly-added deps until first DATA arrives"
\* is verified via the SetDeps action shape — newPrevDataN sets added deps
\* to SENTINEL by construction.)
DepRecordDomainConsistency ==
    \A n \in NodeIds :
        \A d \in deps[n] :
            prevData[n][d] \in ValueOrSentinel

\* Q2 (relational, ghost-driven): firstRunPassed unchanged by SetDeps.
RewirePreservesFirstRun ==
    \A n \in NodeIds :
        ghostJustRewired[n] => firstRunPassed[n] = ghostPreFirstRun[n]

\* Q3 (relational): pauseLocks and pauseBuffer unchanged by SetDeps.
RewirePreservesPauseLocks ==
    \A n \in NodeIds :
        ghostJustRewired[n] => pauseLocks[n] = ghostPrePauseLocks[n]

RewirePreservesPauseBuffer ==
    \A n \in NodeIds :
        ghostJustRewired[n] => pauseBuffer[n] = ghostPrePauseBuffer[n]

\* Q7 (relational): cache unchanged by SetDeps for compute (always activated).
RewirePreservesCache ==
    \A n \in NodeIds :
        ghostJustRewired[n] => cache[n] = ghostPreCache[n]

\* Q6: When sole DIRTY participant is removed by SetDeps, wave closes.
\* Stated as: post-rewire, if dirtyMask[n] = {} then status[n] = "settled".
WaveClosesWhenSoleDirtyDepRemoved ==
    \A n \in NodeIds :
        ghostJustRewired[n] /\ dirtyMask[n] = {} => status[n] = "settled"

\* Coverage check: this invariant is TRUE when rewireCount = 0.
\* TLC tripping it means SetDeps actions ARE being explored — confirms
\* the model isn't vacuous. (Remove from cfg once confirmed.)
NoRewireExecuted == rewireCount = 0

\* Composite of all rewire-design invariants.
RewireInvariants ==
    /\ TypeOK
    /\ RewireDirtyConsistency
    /\ DepRecordDomainConsistency
    /\ RewirePreservesFirstRun
    /\ RewirePreservesPauseLocks
    /\ RewirePreservesPauseBuffer
    /\ RewirePreservesCache
    /\ WaveClosesWhenSoleDirtyDepRemoved

============================================================================
