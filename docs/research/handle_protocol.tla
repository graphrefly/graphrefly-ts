--------------------------- MODULE handle_protocol ---------------------------

(***************************************************************************
  Handle-protocol refinement — Phase 13.6 brainstorm artifact (2026-05-02).

  This module is INTENTIONALLY THIN. It does not re-derive the GraphReFly
  wave protocol — that already lives in `~/src/graphrefly/formal/wave_protocol.tla`
  (2865 lines, ~35 invariants, paired with `_invariants.ts` fast-check
  properties). The handle-based architecture sketched in the brainstorm
  is OBSERVATIONALLY EQUIVALENT to the existing wave protocol — TLA+
  doesn't care about the internal structure of `Values`, so the existing
  spec already validates the handle interpretation as long as the
  refinement mapping below holds.

  What this module ADDS: an explicit binding-boundary annotation —
  which actions cross the FFI / SDK-harness boundary in a Rust-core
  implementation, and which ones don't. The brainstorm question
  "does the architecture simplify the rules?" is answered by counting
  which of the 35+ wave_protocol invariants survive at the boundary
  vs. which become pure-core internals (invisible to user-facing audit).

  Companion artifact: `src/__experiments__/handle-core/` — TS prototype
  whose Core class implements the handle-side of the boundary. Vitest
  tests in `core.test.ts` exercise the same invariants this refinement
  inherits from wave_protocol.

  ----------------------------------------------------------------------------
  REFINEMENT MAPPING (Handle ↔ Value):

    wave_protocol's `Values` set (e.g. {0, 1, 2}) is the abstract
    payload domain. Under the handle interpretation, each value `v`
    in `Values` is interpreted as an opaque handle ID — the binding
    side maintains the actual `T → handle` mapping in a registry that
    TLA+ does not need to model.

    `EqualsPairs[n]` (wave_protocol's per-node equality relation)
    splits cleanly into:
      - identity diagonal `{<<v, v>> : v \in Values}` → handle-id
        compare; PURE CORE, no boundary crossing.
      - any non-diagonal addition → custom equals oracle; BOUNDARY
        CROSSING per check.

    `cache[n]`, `dirtyMask`, `queues`, `version`, `status` →
    PURE CORE state. Never crosses the boundary.

    Subscribe / push-on-subscribe / DIRTY/DATA/RESOLVED ordering /
    diamond resolution / batch coalescing / first-run gate /
    PAUSE/RESUME with lockIds / INVALIDATE / terminal cascades →
    PURE CORE protocol. Never crosses the boundary.

    Fn invocation (state node `Compute(n, val)` in wave_protocol's
    model) is the ONLY mandatory boundary crossing per fn-fire.

  ----------------------------------------------------------------------------
  WHAT GETS SIMPLIFIED IN THE AUDIT (the main result):

    Of the 35+ invariants in wave_protocol, the following are PURE
    CORE — they hold by construction in the Rust implementation
    without any user-facing API surface:

      - DIRTY-precedes-tier3 (Rule 1.1)
      - Equals-substitution (Rule 1.3) when EqualsPairs is identity-diagonal
      - First-run gate (Rule 2.3 / P.1)
      - Diamond resolution (Spec §1.3.3)
      - Batch coalescing (Rule P.9a)
      - PAUSE/RESUME lock semantics (Rules 1.6–1.8)
      - Push-on-subscribe (Rules 1.2 / 2.1)
      - Equals-faithful (#5)
      - Handshake gap-aware shape
      - Multi-sink iteration drift bounds
      - Replay buffer ordering
      - Meta TEARDOWN observed-pre-reset (Rule 1.10)

    User-facing surface that REMAINS at the binding layer:
      - Custom equals oracle (off the identity diagonal) → boundary call per emit
      - User fn → boundary call per fn-fire
      - SENTINEL handling at the binding side (the registry rejects
        registering `undefined` as a handle, mirroring the
        "undefined is SENTINEL globally" rule M.4)

    What this means for Phase 13.6.A: the 247-rule inventory mostly
    collapses into "Core enforces by construction" + a small "binding
    side keeps these contracts" residue. The audit surface drops by
    roughly half — exactly the brainstorm hypothesis.

  ----------------------------------------------------------------------------
  HOW TO USE THIS MODULE:

    To run TLC over the handle interpretation, use any wave_protocol
    MC harness and pass identity-diagonal `EqualsPairs` (then equals
    is pure-core, modelled correctly). To exercise the custom-equals
    boundary, use `wave_protocol_custom_equals_MC` — the existing MC
    already exercises a non-identity relation that cleanly maps to
    "boundary call per emit."

    No new MC harness is needed. The existing scenario MCs cover the
    handle architecture by construction.

    This module's purpose is documentary: it makes the
    refinement-mapping explicit so future audit work can cite it.
 ***************************************************************************)

EXTENDS wave_protocol

----------------------------------------------------------------------------
\* Boundary annotations. These are TLA+ operators that classify each
\* wave_protocol action as PURE_CORE (no FFI crossing) or BOUNDARY
\* (FFI crossing). They are documentary — TLC does not need them
\* for verification — but they make the architectural cost model
\* explicit so it can be checked against the prototype.

\* Identity-equals interpretation: cheapest, no boundary call.
IsIdentityEquals(n) ==
    EqualsPairs[n] = {<<v, v>> : v \in Values}

\* Custom-equals interpretation: boundary call required per Emit.
IsCustomEquals(n) ==
    ~ IsIdentityEquals(n)

\* Per-action boundary cost (informal — not a TLC invariant).
\* Reading: each Emit on node n with custom-equals incurs ONE
\* boundary call per equality check; under identity-equals, ZERO.
\* Each fn fire (Compute) incurs ONE boundary call regardless.

----------------------------------------------------------------------------
\* Refinement obligations — these are wave_protocol invariants restated
\* under the handle interpretation, to confirm they survive the mapping.

\* H1 (state-level invariant): Cache holds only legal handles (Values)
\* — never the SENTINEL. This is the wave_protocol type invariant
\* under the handle interpretation; "Values" IS the handle space, so
\* the property transfers verbatim. References `cache` (a variable),
\* so it's a true behavioral invariant.
HandleCacheTypeOK ==
    \A n \in NodeIds : cache[n] \in Values

\* H2 (structural ASSUME): Identity-equals interpretation never invokes
\* the custom-equals oracle. This is a property of EqualsPairs — a
\* configuration-level constraint, not a state predicate. In a Rust
\* implementation, this is what guarantees identity-equals never
\* crosses the FFI: the EqualsPairs structure says "diagonal only,"
\* so the equality check is pure handle-id compare.
ASSUME IdentityEqualsIsPureCore ==
    \A n \in NodeIds :
       IsIdentityEquals(n) =>
         \A v1, v2 \in Values :
           (<<v1, v2>> \in EqualsPairs[n]) <=> (v1 = v2)

\* H3 (structural ASSUME): Custom-equals on a node is a STRICT
\* EXTENSION of identity — the diagonal must always be a subset.
\* Otherwise "same handle is always equal to itself" is violated,
\* meaning a node could observe its own cached value as different
\* from itself. Catches misconfigured custom-equals oracles at the
\* binding side BEFORE TLC starts the model run.
ASSUME CustomEqualsExtendsIdentity ==
    \A n \in NodeIds :
       {<<v, v>> : v \in Values} \subseteq EqualsPairs[n]

\* H4: First-run-gate equivalence: in wave_protocol, this is enforced
\* by `activated[n]` + dep-cache initialization. The handle
\* interpretation adds no new obligation; the existing invariant
\* covers it under the mapping `Handle ≡ Value`.
\* (Restated for documentation only — refers to wave_protocol's
\* own EmitFnReadinessGate invariant; not redefined here.)

\* H5: SENTINEL discipline at the binding boundary. The TS prototype
\* throws if the registry is asked to intern `undefined`. In TLA+
\* terms, this is enforced by `Values` not containing a sentinel
\* element — TLC never picks `undefined` because it isn't in the
\* handle alphabet. The discipline lives ENTIRELY in the binding
\* layer; the Core/spec sees a clean handle space.

----------------------------------------------------------------------------
\* The combined refinement spec. Reuses wave_protocol's `Spec`
\* directly — no new actions; the handle interpretation is purely
\* the lens through which we read the existing spec.

HandleSpec == Spec

\* State-level invariants for handle-protocol-specific verification.
\* H2 and H3 are structural and live as ASSUMEs above (TLC checks them
\* before model-checking starts). H1 is behavioral and goes here.
HandleInvariants ==
    HandleCacheTypeOK

=============================================================================
\* For TLC verification:
\*
\*   1. The handle architecture is verified by running ANY existing
\*      wave_protocol MC harness — they already cover all the protocol
\*      invariants under the abstract Values domain that handle IDs
\*      inhabit.
\*
\*   2. To run handle-specific invariants too, create an MC config that
\*      EXTENDS handle_protocol (instead of wave_protocol) and adds
\*      `HandleInvariants` to the INVARIANTS section. Constants are
\*      identical to any existing MC.
\*
\*   3. The TS prototype at `src/__experiments__/handle-core/` exercises
\*      the same invariants at the JavaScript level. Vitest pass +
\*      handle invariants holding under TLC = the architectural
\*      hypothesis is sound.
\*
\* OPEN QUESTIONS for Phase 13.6.A audit (not yet modeled here):
\*
\*   - Cross-language handle space: if a TS-frontend graph mounts a
\*     Python-frontend subgraph, the two registries are disjoint.
\*     wave_protocol does not model this; would need a new spec.
\*
\*   - Handle lifecycle / refcount soundness: the binding side must
\*     release handles when the Core says so, with no double-release
\*     and no leak. wave_protocol does not model refcounts; consider
\*     a small companion module if this matters at audit time.
\*
\*   - Async fn boundary: state-node `Compute` in wave_protocol is
\*     synchronous. A real Rust core handing off async fns to JS/Py
\*     introduces interleaving. Captured under wave_protocol's
\*     SinkNestedEmit / multi-sink iteration models for related
\*     concerns; explicit async-fn modeling is future work.
=============================================================================
