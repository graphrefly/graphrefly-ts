# Currentness optimization: remaining evidence audit

Owner: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. Source checkpoint: `af22eec7`.
This is an evidence follow-up under the user's continuation, not a new design lock or execution grant.
No library changes, consumer executions, new samples, public exports, protocol changes or provider calls.

## Result and interpretation

Retain the approved private currentness optimization. The [completed comparison](../performance-comparison/README.md)
supports an action-sum p95 reduction of **20.8–27.8%** across the retained main pair-position medians,
with stable matched controls for that metric. It does not qualify construction performance against reference.
The comparison is the same preset before/after one optimization; CSP11/D169 asks a different comparison.
Individual phase controls were unstable. The descriptive construction maximum ratio 1.2223 cannot be
used as a formal 1.20 preset/reference budget failure, or as evidence against C or layering.

The original run had a verifier stop after child 0, an exact Darwin environment-field correction and
a paused continuation of entries 1–47. Child 0 was retained, not rerun. The original stop, correction,
elapsed-time assumption and archive replay remain disclosed in the preceding report; this audit
does not upgrade that evidence to an uninterrupted or formally qualified capture.

The following ranges are per-block **duration sums divided by the same block's action-sum**, across
16 measured main blocks per revision. They are not ratios of p95s, statistical confidence intervals,
or estimates of removable cost. All original controls remain in the source report; they are not
used for this descriptive within-block partition.

| Phase | Before share | After share |
|---|---:|---:|
| Construction | 4.26–4.86% | 5.90–6.43% |
| Initial actions | 59.09–60.19% | 63.96–65.06% |
| Duplicate actions | 33.81–34.89% | 27.04–27.89% |
| Cleanup | 1.23–1.69% | 1.55–1.87% |

Construction's larger share does not establish a slowdown: its denominator also became smaller.
Initial and duplicate actions dominate this workload, but phase totals do not identify a safe next
implementation change. The earlier allocation profile describes an older revision and cannot be
relabeled as the optimized revision's remaining allocation profile. We therefore do not automatically
advance to publication, sameRef, quiescence, or another registry redesign.

Observed maximum RSS remains **242.23 MiB for a mixed-slot Node process**. It is not one graph's
retained memory, an arm-specific measurement, or evidence that memory improved.

## Graded hiding: existing proof and gaps

| Question | Evidence already present | Still unproven |
|---|---|---|
| Can a component receive a small ordinary view? | `examples/spending-alerts/causal-preset.ts` builds a frozen five-field view: assessment, publication, coverage, issues, startup. The preset test checks its actual keys and frozen state. | Final public creation and export ergonomics. |
| Can framework authors retain composition capabilities? | The same composition returns exact identity/execution/retained capability objects; execution.identity and retained.execution preserve object identity. | A final qualified inbox/factory and its end-to-end acceptance. |
| Can maintainers inspect the full graph? | The audience example uses the same graph's `describe()`; D162 retains one full runtime. | User comprehension across the three audiences. |
| Are unwanted ordinary operations hidden? | Audience compile examples reject view.capabilities, view.publish(), and view.effectAdmissions. | Runtime access isolation or security, which this interface hiding does not promise. |
| Does hiding reduce runtime cost or lifecycle obligations? | No such claim: D162/D164 separate component exposure from the full runtime and graph-owned obligations. | No lazy graph pruning or memory-saving claim follows from these interfaces. |

Static source inspection this turn found no causal/spending preset entry in the package export map
or the solutions barrel. Existing core/patterns/solutions layers alone do not prove the final consumer
entry is available. This qualifies the earlier shorthand “graded hiding unproven”: private component
surface/type/lineage evidence exists; complete public entry and usability acceptance remain open.
No new runtime or type tests were run for this read-only audit.

## Next bounded step

The next priority within this work is to establish whether a **current preset/reference comparison
can be validly qualified**, before collecting another matrix or selecting a second optimization.
This is not another A/B/C choice. D169's reference-identical Z method qualification failed, so the
current optimization cannot be claimed to repair that measurement prerequisite.

The next offline preparation should produce one reviewable manifest/checklist:

1. Bind the current candidate and reference reachable source closures, adapter roles and output
   semantics. Mark exactly which previous artifacts can be reused and which are revision-specific.
2. Map the retained Z failure and unrun M sensitivity check to D169's frozen method requirements.
   Do not delete early samples, average away failed controls, or change budgets after seeing results.
3. Identify the smallest unresolved measurement defect supported by retained evidence. If no defect
   is established, report that limitation rather than invent a corrective patch or rerun justification.
4. End with exact readiness conditions for any future qualification/capture. A required method change
   is a separate review boundary; readiness is not an automatic execution grant.

Keep final public factory/export design, qualified inbox, actual external effects and human/agent
studies outside this follow-up. Work remains incomplete. The next step is preparation of valid
comparison evidence, not automatic expansion of the implementation or profiler API.

## Reproduce this audit

From the repository root:

```sh
python3 docs/design/causal-cost-investigation/followup-audit/analyze.py > /tmp/causal-phase-shares.json
cmp /tmp/causal-phase-shares.json docs/design/causal-cost-investigation/followup-audit/phase-shares.json
```

The script binds the retained report to the previous receipt's SHA-256, checks that four phase sums
partition each main block's action sum, checks 16 blocks per arm, and emits every selected block and
summary range. It executes no consumer. This is derived evidence, not independent recapture.
