# D171 preparation QA

Baseline: `75ac5832db6bd1c92549d31533294440111c6315`. This review covers the approved private resource, matched plain host, independent verifier, source-mutating preparation runner and deferred local executor. No actual inbox execution took place.

Three independent review assignments inspected components outside their implementation ownership: resource/host against the original plan; worker/executor lifecycle and failure edges; verifier/scenario coverage. Integration also checked exact resource origin and destination binding. Findings were triaged as in-scope patches:

- Real destination must equal the canonical absolute local-inbox reference before open; tested with rejected paths and zero opens.
- Repeated/concurrent failed close must retain one failure and never retry; resource tests cover this.
- Plain unknown handling skipped reservation during the completion-to-delivery window. A controlled microtask regression failed before repair (one retained record instead of two), then passed with exact cancellation and no second write.
- Plain opaque result and Graph journal labels must not claim a simulated/physical origin they do not establish. Physical origin belongs to the prepared resource; independent byte readback remains separate.
- Final-only observations missed premature calls and authority-delivery corruption. Frozen checkpoint call counts and independent committed-effect/quiescence observations now cover both.
- Worker acquisition/initialization cleanup was outside finally; moved inside. Detailed checkpoint observations are projected to the verifier's exact schema.
- Parent executor previously skipped independent readback on malformed/missing child output. It now records bytes/hash or a readback error regardless of child report validity.

The initial preparation attempt used destination references beyond the existing 128-byte limit. The next attempt passed before the final metadata fix. A later launcher check incorrectly equated held host requests with actual underlying writes, exposing short/reject/pending differences. It was corrected to derive actual transport events from frozen settle steps. These attempts remain byte-for-byte archived; construction errors and harness errors are not business mutation kills.

Final finite evidence: 23 cases × two arms, independent parent verifier, same Graph topology; source transforms alter loaded business/terminal/outcome code. Success of expected rejection or retained pending evidence does not qualify the erroneous candidate. Missing business observations cannot be counted as a semantic score-mutation kill.

Gates: 2712 full-suite tests passed, four pre-existing skips; after final host metadata edit, 59 affected tests passed. Lint/typechecks, package build, installed ESM/CJS/DTS exports (including 64 batch cases), historical artifact integrity passed. Artifact currentQualified remains false: this is not a new formal performance qualification. Executor missing-grant invocation fails before destination preparation. Resource tests use injected memory only, including held full/one-byte/reject/pending transport.

No unresolved in-scope behavioral finding remains. The actual local executor path has not been exercised against a real file; that is exactly the separately authorized execution being prepared. Root aggregate, real-effect proof, formal performance and human/agent comparison remain incomplete.
