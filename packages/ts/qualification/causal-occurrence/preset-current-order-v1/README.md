# Private current/verification construction-order diagnosis v1

**The recurring extra node interval follows construction position 22, not the `currentFacts` business role.** Swapping two independent node declarations moves the higher interval to verification, while topology, factories, dependency order and existing semantic preflights remain unchanged. Generated step probes then place most of this local difference in the explicit Node constructor body; a non-timed V8 inspection observes a backing-table replacement in the shared `checkpointReaders` WeakMap at insertion 22.

This is evidence for the existing `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS` work under D164–D166. The user said “好，继续” after the proposed currentFacts investigation; private offline diagnosis and the prior commit grant apply. No product/runtime/reference source, public API, protocol/C design, decision or formal runner changed. **Historical P2-summary 1.211671 > 1.20 remains rejected; all 80 unrun rows remain unrun.** No repair or final preset qualification is claimed.

## Order counterfactual

Only generated copies exchange adjacent independent declarations:
- Candidate `buildAdmission`: currentFacts and verificationFacts (positions 22 and 23 including six source nodes).
- Reference `buildReferencePreset`: current and verification (positions 18 and 19).

Both variants have identical Graph.node/ConstructionScope.node instrumentation. Every node identity, factory and ordered dependency list is checked across variants. Candidate/reference roles map explicitly through the prior probe; corresponding mapped dependencies agree. Every sample checks the actual constructor sequence, exact current/verification ordinals, complete unique node coverage and full shell/node/residual reconciliation. No guard, policy, callback body, return value or retained obligation is removed. The run never executes a real effect.

Summary-mode median of four batch p50s, μs (instrumented node-method interval):

| Arm / order | current | verification | Earlier position |
|---|---:|---:|---|
| Candidate original | 4.000 | 1.917 | current, 22 |
| Candidate swapped | 2.084 | 4.187 | verification, 22 |
| Reference original | 2.480 | 2.250 | current, 18 |
| Reference swapped | 2.605 | 2.896 | verification, 18 |

In every candidate batch in both off and summary modes, the earlier node is slower, and exchanging the declarations reverses which role is slower. The full table retains batch means and p50s. This supports order-associated work, not an optimization by moving declarations: the cost moves to the other node. Instrumentation, module layout, JIT and allocation state still affect absolute timings. It is not a general claim that all graphs have a slow 22nd node.

## Localizing the shared work

A separate `--core` run times `NodeCore.createSlot` within every node interval. In summary mode candidate original, current and verification both have median batch p50 core intervals around **0.042 μs**, despite their whole-node difference. The corresponding earlier reference node has approximately 0.292 μs in createSlot. This does not support attributing the candidate position-22 excess to its slot-array writes.

A separate `--steps` run retains the order counterfactual and instruments the shared entry points. Summary candidate original medians of batch p50s:

| Step | current at 22 | verification at 23 |
|---|---:|---:|
| Entire scoped node method | 4.354 | 2.437 |
| `createOwned` | 4.063 | 2.146 |
| Explicit `Node.constructor` body | 2.813 | 1.146 |
| `Graph._nodeOpts` | 0.208 | 0.208 |
| `Graph._addWithId` | 0.667 | 0.333 |

After the swap, the larger constructor-body interval moves to verification (3.167 vs current 1.459 μs). These are nested intervals, **not additive components**. Constructor-body clocks exclude automatic class field initialization. Separate probe runs cannot be subtracted to infer savings, and even clock-level values include timer/collection interference. All raw means, quantiles and long intervals are retained.

A **non-timed, single-fresh-graph** V8 inspection takes the already frozen original bundle and adds read-only debug calls around `checkpointReaders.set`. It observes the backing-table identity unchanged at insertion 21, replaced during insertion 22, and unchanged at insertion 23. `capacity.txt`, the exact generated source, replay script and hashes are retained. This is direct evidence of a table replacement consistent with registry maintenance/rehashing/growth. **The debug output does not expose capacity, so no specific capacity increase is claimed.** It does not measure that operation's exclusive duration, prove every other registry behaves identically, or retroactively explain the original qualification p95 failure. The Node constructor contains multiple shared WeakMap registrations; their ownership design is unchanged.

## Runs and integrity

- `run-01`: original/swap node-timing counterfactual, 12,800 constructions.
- `core-01`: additional nested createSlot probe, 12,800 constructions.
- `steps-01`: additional shared-entry-point probes, 12,800 constructions.
- Each uses two modes, four balanced cell-order batches, candidate/reference × original/swapped, 100 warmup + 300 measured per cell. Both variants are instrumented, unlike the earlier probe-versus-uninstrumented comparison. Each completes four existing P2 semantic preflights, 59/60-node topology assertions and exact constructor sequence checks. Each has 571,200 measured node intervals, plus retained warmups.
- Each timing run has a recorded **180-second external child-process timeout**. The in-script 120-second limit is only a cooperative measurement-loop guard. Actual runs completed in about 8.8/8.9/13.6 seconds. The debug inspection has a separate 30-second bound and is not timing evidence. No heavy check from this task overlapped any measurement; external machine load was uncontrolled.
- Both bundles in each run use the same immutable verified 63-file source snapshot. All old formal/reference bindings remain unchanged. The first executed tool source is retained under `executed-run-01`; the second under `executed-core-01`; final source under `sources`. Freeze records bind the exact executed revision, not a later tool version. Subsequent improvements retain preflight successes incrementally and record timeout/cleanup/other attempt failures at the outer boundary, in addition to per-sample failures. Existing output directories fail closed.
- Five new tool tests cover declaration preservation, executable order/return equivalence, fail-closed seams, the nested core wrapper and byte-preserving step wrappers. Together with prior diagnostic tests, 13 pass. Two static reviewers reviewed transformations, attribution, bounds and failure retention. Full suite remains 2514 passed / 2 existing D159 manifest failures / 4 skipped; lint/typechecks pass. No new public build, runtime mutation qualification or artifact-gate pass is claimed.

`receipt.json` binds the portable raw archive/index, exact tool revisions, review copies and prior sources. `analysis.json`, `order-comparison.csv` and their archived Python source support human/agent review. `record-gates.json` binds post-record workspace/dashboard checks. No old attempt, sample or threshold is replaced; existing dirty root files are preserved.

## Consequence

Do not optimize the currentFacts business code or reorder nodes merely to move its measured cost. The next potential performance work belongs to shared construction/registry costs across the whole graph, with an equivalent reference and whole-construction measurement. This evidence does not justify a new ownership model, a public API, or a repair yet: total benefit and the historical rejection remain unresolved. The original work stays incomplete.
