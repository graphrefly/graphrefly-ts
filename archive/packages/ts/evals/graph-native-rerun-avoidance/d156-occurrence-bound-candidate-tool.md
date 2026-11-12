# D156 occurrence-bound candidate tool

This package-private Eval contract isolates the causal question—whether admitted prior memory
selects the correct mechanism—from the unrelated ability of a model to reproduce invisible source
bytes.

## Causal path

1. Each source or target Work Item occurrence—including each of the six target arms—carries its own
   frozen candidate-catalog digest and two opaque candidate refs through its Graph DATA.
2. The provider request presents the two refs with symmetric, plausible mechanism actions. The
   strict response schema accepts either ref and does not contain a correct-answer `const`.
3. Provider output contains only `candidateRef`. It cannot author a path, old span, or replacement.
4. The caller validates the provider outcome against the candidate refs and catalog digest already
   bound into the Graph-admitted provider request before returning that outcome to the Graph.
5. The tool-admission node independently revalidates task, replicate, Work Item role, candidate ref,
   and catalog digest.
6. The exact tool rechecks the isolated workspace snapshot and unique old-byte span, then writes the
   catalog's frozen replacement bytes verbatim. Public and hidden verifiers determine the arm result.

The verified action alternates between opaque `candidate-a` and `candidate-b` refs across
replicates. Both candidates produce real, publicly plausible source changes; neither is a no-op.
The source insight names one of fifteen task-specific mechanism invariants and contains no ordinal,
candidate ref, path, patch, or verifier answer. Selecting the wrong valid candidate is therefore an
ordinary evaluated failure; an unknown, stale, cross-arm, replayed, or cross-task candidate is a
technical contract rejection.

## Fail-closed boundaries

- Old `path`/`oldText`/`newText` provider proposals are rejected; there is no compatibility reader.
- Candidate refs and catalog digests are conserved through Work Item request, provider admission,
  provider outcome, tool admission, exact-tool result, and Graph-native observation.
- The writable file plus every actor-visible readonly fixture are checked as one workspace snapshot
  before mutation; the unique old span and replacement bytes are then checked independently.
- The executor validates the complete provider/admission/proposal/tool receipt before looking up a
  workspace or performing any side effect.
- No caller normalization, whitespace repair, fallback candidate, `partial: true` override, manual
  `RESOLVED`, domain-ordering timer, external domain map, or imperative queue is introduced.
- Existing real Work Item and Agentic Memory solution composition remains authoritative.

## Qualification boundary

No-network QA covers symmetric/counterbalanced candidates, wrong-valid-candidate evaluation,
cross-task, cross-arm and stale-catalog rejection, exact CRLF/tab byte preservation,
public/hidden verifier behavior,
six-arm integration, replay, cleanup, privacy, budget, and retry conservation. Provider
qualification uses the same two-choice schema but harmless refs, remains outside the efficacy
campaign, and cannot authorize live execution or spending.

Development entries created before D156 remain immutable cost/evidence history but contribute zero
to the D156 efficacy streak. Development-3 is the first candidate-contract epoch occurrence.
