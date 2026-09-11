# Release boundaries v1 — proposed finite diagnostic

Owner: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. Based on `159cf5ad`; this is a design proposal, not a new grant, implementation or D169 qualification. Implementation and the one capture below await approval of §§2–5. The original A/B/C architecture is not being reconsidered.

## 1. Source findings and remaining uncertainty

The prior 239-file archive has SHA256 `f854a39e4af9e6989f357addf83939f4754b939492a6db2d9c2b67f91db6b2ac`; index SHA256 `aa843f453f5403c745531533e787a3bd81e0c12211eed40491c118a52b820123`. Receipt refs and qualified sources were checked unchanged. Its four deep-mode measured results put whole `group.release()` at 74.72–75.46% of cleanup, not exclusive guard cost. Mode D/S original construction p95 variation still prevents a zero-overhead or cold-cause claim.

Concrete path, checked with Codegraph and the actual frozen bundle:

1. `graph-topology-group.ts:122`: copy membership; call graph lifecycle release; clear membership and mark released only after successful return.
2. `graph.ts:312`: deduplicate and resolve entries; prepare releaseSet/releaseIds; reject external dependencies; reject nonquiescence and external subscribers; prepare events; remove entries/IDs; release each runtime; clean completed owner constructions; publish release events; propagate runtime release failure.
3. `runtime-accessors.ts:172,177,182,187`: exact issued-identity access to release, quiescence, subscriber count and active state.
4. `node-lifecycle-runtime.ts` as bundled in `worker.mjs:1979–2050`: quiescence is a compound condition over wave/dep/control state; runtime release unsubscribes dependencies, invokes deactivation hooks, unregisters a dispatcher handle when present, clears runtime data, then closes identity. It is not merely a registry delete.

Prior preflight topology has 60 nodes / 93 dependency entries in both arms. On a full 60-member successful release, the nested guard performs 60×59 = 3,540 active checks; active dependencies can additionally be traversed repeatedly. This is static arithmetic, not captured activity counts or a timing attribution. In particular **inactive is not the definition of runtime-quiescent**; do not remove subscriber/dependency guards based on a presumed inactive fixture.

Two uncertainties remain: how much whole release time is pre-release checking versus actual release; how much extra internal observation changes the observed behavior. The next experiment addresses those only.

## 2. Recommended intervention and exact boundaries

Use two diagnostic modes, both reference/reference-copy with original input, load order, two three-arm preflights, original construction windows and original record writes:

- **D**: exact driver, worker pair and observers from the prior frozen deep mode. Do not add dormant forwarding parameters to D.
- **R**: a private derived copy of that D path, forwarding a sample-scoped diagnostic object to `_releaseNodes` and adding **seven clock reads per sample**, outside all per-node loops. CPU observation remains Q; an explicit `releaseMode=D|R` envelope distinguishes this experiment. Do not relax the old B/S/D verifier or represent R as already qualified D.

D and R have different worker bytes; R/D measures the **whole observation intervention**, including optional parameter forwarding, object allocation and optimization effects, not pure clock getter overhead. The prior outer 8 and cleanup 5 reads remain in both modes. No uninstrumented B arm is claimed in this batch.

R's additional timestamps:

| Timestamp | Exact frozen `_releaseNodes` boundary | Interval ending here |
|---|---|---|
| r0 | Immediately before `const seen` | Starts internal elapsed |
| r1 | After releaseSet/releaseIds, before external-entry loop | Entry preparation |
| r2 | After external-entry loop, before `for (const {node, entry} of entries)` | External dependency checks |
| r3 | After that entire guard loop, before `const releasedEvents` | Quiescence + internal/external subscriber checks |
| r4 | After registry deletion and releaseError/releaseFailed declarations, before runtime loop | Event preparation + registry removal |
| r5 | After entire runtime release loop, before `if (!releaseFailed)` | Runtime release, including its original catch/continuation |
| r6 | After owner cleanup, events and original `if (releaseFailed) throw releaseError` | Owner/event finalization; successful path only |

All six intervals nest inside the original d3→d4 whole-group-release interval. The difference is separately reported as wrapper/forwarding remainder. r2→r3 is **not** called exclusive quadratic-check cost; r4→r5 is **not** called exclusive dispatcher cost. No per-node timestamps, per-edge counters or summation of overlapping durations.

Explicit private forwarding path: sample sidecar → existing graphArm cleanup diagnostic → a separate optional diagnostic argument on the generated `GraphTopologyGroup.release` → generated registrar `releaseNodes` → generated `_releaseNodes`. Preserve the normal options/reason values. Only the R sample-cleanup call supplies the object; preflight and any other caller leave it absent. No global current-sample variable, WeakMap, registry, graph attachment, context state or public export is added. Every forwarded private signature and call-site substitution is allowlisted and reversibly checked against the frozen bytes.

Clock failures are collected without aborting release or invoking it twice; after the original cleanup attempt, report original, cleanup and diagnostic failures together. Rejected guards remain before registry mutation. Runtime release failure still continues the original per-node attempts, preserves its original failure behavior and skips successful owner cleanup. Missing r6/d4 stays incomplete, never zero. No release algorithm, guard order, lifecycle semantics, business fn or observation event order changes.

## 3. Qualification before any real consumer

- Pin approved design/commit, old archive/index, executable/Node/V8 and all private sources before dispatch. Independently reverse every R transform and verify original function statements/order. D is byte-identical to archived D modules/observers.
- Load the actual generated entries and actual extracted release functions against countable hosts/fake clocks. D/R×U/V must retain 2,400 samples, both original preflights, original start/end placement, 12 CPU phases and exact outer/deep/internal read counts. No real performance factories may run as a test.
- Guard fixtures: duplicate/unregistered members; outside dependent; nonquiescent member; external subscriber; active internal dependents; no active dependents. Confirm reject-before-mutation, including late-member rejection. Respect identity/dependency multiplicity in fixtures; do not invent an alternative predicate.
- Runtime fixtures: unsubscribe/hook/dispatcher failure, preserved first runtime error and remaining-node attempts, no successful owner cleanup after failure, group membership/released flag unchanged on throw; successful release retires IDs and closes identities exactly once. Observer failures before checks, inside release timing and after runtime failure must not skip or repeat cleanup or swallow errors.
- Loaded mutations must catch a clock in the original construct window, skipped/reordered guards, removal before validation, skipped runtime node, swallowed error, wrongly cleared owner, missing/misnamed timestamp, wrong mode/identity, an R object reaching preflight, and nested intervals summed twice.
- Independent verifier checks full admission **before first dispatch**, then exact raw/source identity, original samples, all timestamps/containment/phase accounting and complete/incomplete execution inventory before every next dispatch. Negative nonzero vectors, malformed units/nonfinite/backward time, missing/duplicate coordinates, stale PID/source, hidden execution files and failed-row identity must fail. Retain P>W and negative W−T as permissible.
- Two static QA reviews, focused private qualifications, relevant offline/lint/governance gates. Full TS results must separately retain the existing D159 failures; do not rewrite their manifest. No extra native observer fixture or unauthorized performance smoke test.

## 4. Finite execution proposal

Fixed mirrored schedule:

```text
pass 0: D-U, R-V, D-V, R-U
pass 1: R-U, D-V, R-V, D-U
```

U=CR/RC/CR, V=RC/CR/RC; both slots are reference. Each mode×orientation appears twice at positions summing to 7. This balances linear position only; it does not remove nonlinear drift or establish a confidence bound.

| Coordinate | Exact quantity / ceiling |
|---|---:|
| Consumer processes | 8 (D 4, R 4) |
| Samples | 19,200 (4,800 warmup / 14,400 measured) |
| Original three-arm preflights / untimed arm instances | 16 / 48 |
| Outer/deep sidecars | 19,200 each, same samples |
| Internal release sidecars | 9,600, nested subset |
| Existing outer clock reads | 153,600 |
| Existing cleanup clock reads | 96,000 |
| New internal release clock reads | 67,200 |
| CPU snapshots / their clock reads | 192 / 384 |
| Total additional clock reads versus original construct-only driver | 317,184 |
| Child time / total time | 30 seconds / 900 seconds |
| Output soft ceiling / supervision interval | 256 MiB / 100 ms |
| Retries / replacement rows / extra native fixtures | 0 / 0 / 0 |

Original start/end reads are separate and unchanged. Total time starts at preparation/reservation, includes material extraction and verification. Output is single-use `archive/evals/causal-release-boundaries-v1/run`; preparation failure consumes the attempt. Reject stale approval, qualification, source, executable, implicit Node options or budget before any consumer. Freeze all files and the schedule before the first child. Preserve the original five native flags, no sampling profiler/structured trace/forced GC/JIT or system changes.

Independently verify each row before dispatching the next. Stop for preflight/identity/source/CPU/sidecar/time/sleep/size/exit failure, preserving actual captured versus verified samples and not-run rows. Do not stop or add samples merely because a ratio is unfavorable, a mode changes behavior, or the suspected hotspot is not reproduced. No automatic optimization, formal matrix or provider/live/spend action.

## 5. Result interpretation and delivery

Preserve all warmup/measured phase×batch×slot×orientation×pass original construction p50/p95/sums and D/R absolute phase CPU/wall. Compare R/D original construction and whole-release distributions; report internal six segments, wrapper remainder and full outer phase residual. No correction/subtraction of measured instrumentation overhead or claim that D represents an uninstrumented baseline.

If r2→r3 is repeatedly large, the next review can assess a guard-accounting optimization that preserves all rejection predicates and multiplicity. If runtime release dominates, investigate unsubscribe/hooks/dispatcher/reset costs instead. If both matter, report both. If observation changes the behavior materially or data remain mixed, retain unresolved; do not choose a favorable pass or broaden the experiment. These are descriptive choices, not new numeric significance or performance thresholds.

Deliver source/raw/approval/exit evidence, archive/index, fresh-directory independent replay, human/agent report, same-work receipt and commit. End this batch whether the diagnostic is complete/unresolved or incomplete. D169 and original cold-p95 root cause remain separate; this batch does not grant an algorithm change.

## 6. Q5–Q9

- **Q5 — abstraction:** maintenance-only diagnostic on the actual release path; no library/framework/user entry, graph verb or persistent registry. A generic profiler is unnecessary for this bounded question.
- **Q6 — invariants/cost:** all rejection checks precede mutation; runtime failure and identity/retained-failure semantics remain exact. R adds seven clock reads and forwarding/allocation costs; these can perturb optimization. Frozen-source transforms need qualification on each future source revision; no free-performance claim.
- **Q7 — simplicity/composition:** two modes, six large intervals, explicit ephemeral parameter forwarding. No node/edge instrumentation and no new user choice. Graph topology, fn dispatch, authority lifecycle and retained evidence remain unchanged; release continues to be graph-owned.
- **Q8 — alternatives:** (i) directly replace quadratic accounting: could reduce repeated checks without user API burden, but would mix semantic equivalence and performance-cause questions before proving the guard dominates; defer. (ii) per-node/per-edge timing: finer identity attribution, but much more instrumentation in the nested loops and difficult observer-cost separation; reject for this batch. (iii) selected coarse internal boundaries: limited attribution with only seven additional reads; recommend. Existing cleanup-segments-v1 supplies the local precedent, not a new public profiling design.
- **Q9 — coverage:** source/error boundary and check-versus-release localization: covered by design; user cognition: no added public API; instrumentation influence: partial, documented R/D comparison cannot isolate pure observer overhead; exclusive quadratic/dispatcher cost, original cold-p95 cause, optimization benefit and D169/graded-entry qualification: not covered. Accept those limits for this finite diagnostic. Approval target is §§2–5 only.
