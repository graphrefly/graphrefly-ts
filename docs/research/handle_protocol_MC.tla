---------- MODULE handle_protocol_MC ----------
(*****************************************************************************
Smallest MC harness exercising handle_protocol's HandleInvariants on top of
wave_protocol. Reuses the canonical 4-node diamond topology from
~/src/graphrefly/formal/wave_protocol_MC.tla so the existing wave_protocol
invariants run alongside the handle-specific ones.

To run:
    cp ~/src/graphrefly/formal/wave_protocol.tla /tmp/tla-check/
    cp docs/research/handle_protocol.tla /tmp/tla-check/handle_protocol.tla
    cp docs/research/handle_protocol_MC.tla /tmp/tla-check/
    cp docs/research/handle_protocol_MC.cfg /tmp/tla-check/
    cd /tmp/tla-check && \
      java -cp /path/to/tla2tools.jar tlc2.TLC \
           -workers 4 -config handle_protocol_MC.cfg handle_protocol_MC

Verified 2026-05-02: 22532 states generated, 9526 distinct, depth 25, 1s.
*****************************************************************************)

EXTENDS handle_protocol

NodeIdsMC     == {"A", "B", "C", "D"}
SourceIdsMC   == {"A"}
SinkIdsMC     == {"A", "D"}
EdgesMC       == {<<"A", "B">>, <<"A", "C">>, <<"B", "D">>, <<"C", "D">>}
ValuesMC      == {0, 1, 2}
DefaultInitMC == 0
MaxEmitsMC    == 2
BatchSeqsMC   == {}

GapAwareActivationMC == FALSE
SinkNestedEmitsMC == {}
MaxNestedEmitsMC  == 0

LockIdsMC             == {}
PausableMC            == [n \in NodeIdsMC |-> "off"]
ResubscribableNodesMC == {}
MaxPauseActionsMC     == 0

UpOriginatorsMC == {}
MaxUpActionsMC  == 0

ExtraSinksMC == [n \in NodeIdsMC |-> 0]
ResetOnTeardownNodesMC == NodeIdsMC \ SourceIdsMC

InvalidateOriginatorsMC == {}
MaxInvalidatesMC        == 0

AutoCompleteOnDepsCompleteMC == [n \in NodeIdsMC |-> TRUE]
AutoErrorOnDepsErrorMC       == [n \in NodeIdsMC |-> TRUE]

ReplayBufferSizeMC == [n \in NodeIdsMC |-> 0]
EqualsPairsMC == [n \in NodeIdsMC |-> {<<v, v>> : v \in ValuesMC}]

MetaCompanionsMC == [n \in NodeIdsMC |-> {}]
MaxTeardownsMC   == 0

==================================================================
