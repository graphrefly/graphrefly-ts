# Private node-attributed cold-construction diagnosis v1

The probe now identifies **every actual graph node** in both arms: 59 nodes in off mode and 60 in summary mode (six input sources plus 53/54 owned nodes). This is offline diagnostic evidence for `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS` under D164–D166. It changes no product/runtime/reference source, public API, protocol, C design, frozen runner or old receipt. The user approved per-node attribution and instrumentation-cost comparison, then said “好的，继续”; the existing commit grant remains applicable.

**The historical 1.211671 > 1.20 rejection remains unchanged, with 80 rows not run.** This probe does not qualify performance, explain the historical slow window, or demonstrate final user ergonomics.

## Findings

These values are the median of four batch p50s, in μs, from the generated probe. They describe the instrumented node-method interval, not business execution or exact uninstrumented CPU cost. Means and every raw sample remain available; no outlier is removed.

| Stable role (summary mode) | Candidate | Reference |
|---|---:|---:|
| `spending/causal/release-candidates` | 6.563 | 6.667 |
| `spending/currentFacts` ↔ `spending/reference/current` | 4.187 | 2.563 |
| `spending/consumerIssues` ↔ `spending/reference/issues` | 3.916 | 4.145 |
| `spending/causal/arrivals` | 3.729 | 3.813 |
| `spending/evaluationSelections` ↔ `spending/reference/selection` | 3.416 | 3.771 |

**`currentFacts` is the strongest consistent local lead.** Its candidate-minus-reference batch p50 differences are +1.792/+1.625/+1.876/+1.667 μs in off mode and +1.917/+1.625/+1.375/+1.625 μs in summary mode. Both nodes have the same single actual input edge from `current`. The recorded construction ordinals differ: candidate 22, reference 18 (one-based, including input sources). This warrants examining the creation path around that node; it does not prove the source cause, that a repair saves that amount, or that it explains the old gate failure. Construction order/JIT and probe effects are not isolated by this run.

**The largest mean is not a reliable culprit.** Summary candidate `release-candidates` has a 32.392 μs mean versus reference 6.983 μs, but its typical costs are close in the table. A single recorded interval (batch 1, measured index 241) lasted 28,139.083 μs. Off reference `watermarks` also has a 17,121.875 μs interval. Such wall intervals may include GC/scheduling; this run does not identify their cause. All are retained. Naming the active node locates where the delay was observed, not which code caused it.

**The observer has material cost.** The median of within-batch probe-minus-control total-construction p50 contrasts is:

| Mode | Candidate contrast μs | Reference contrast μs |
|---|---:|---:|
| off | +26.875 | +27.396 |
| summary | +26.937 | +42.083 |

These are observed contrasts, including clocks, record allocation, wrapper/JIT changes, module layout, ordering and machine variation. They are not an exact timer tax and are not subtracted from individual nodes. Every raw batch result is retained. The diagnostic is private generated code, so it adds no shipped runtime cost or user configuration.

## Measurement boundary and identity

- Instrument exactly `ConstructionScope.node` for owned nodes and `Graph.node` for the six input sources, with the same method wrappers in both arms. Clock before the original body and in `finally`; preserve return/throw/`this`. This interval includes validation, acquisition, allocation, dispatcher setup and registration performed by those methods. It excludes caller-side dependency/options preparation and excludes later node business execution. The post-clock collector allocation is outside each node interval but inside total cold construction.
- Ten existing shell marks plus an explicit entry interval partition the full cold clock into graph/sources, name generation, preparation/startup-source creation, consumer building, sealing, transfer, startup, observer setup, subscription and return. Node intervals are disjoint and contained within these stages. Per-sample assertions reconcile node totals, stage totals and residuals; stage p95s are never added.
- Residual is **all measured work outside the node intervals**, including caller preparation, factory assembly, topology checks, lifecycle startup and probe-recording overhead. It is not all avoidable abstraction overhead. Summary-mode means total 309.322/314.279 μs, node intervals 187.965/174.031 μs and residual 121.358/140.248 μs (candidate/reference). Consumer-builder residual alone is 82.041/98.406 μs. Means are sensitive to retained long intervals and do not support a new arm ranking.
- `freeze.json` contains an explicit 28-role reference mapping; identical remaining IDs map directly. Compare the actual described nodes and all mapped edges, not creation indices or display names alone. Require control/probe topology equality and candidate/reference mapped-topology equality. Factories remain recorded separately; same role does not assert identical implementation. `node-ranking.csv` contains all 119 mode/node rows with batch deltas and both mean/typical measures.

## Controls, retained evidence and validation

One bounded run completed: two modes × four balanced-order batches × four arm/probe cells × (100 warmup + 300 measured) = **12,800 constructions**. The probe covers **285,600 measured node intervals**, plus warmups; every measured graph requires complete unique node coverage with no overlapping intervals. Four P2 mode/variant preflights pass the existing independent oracle/Graph/reference/plain comparisons and lifecycle checks. No real effect executes.

Both ESM bundles are built from the same verified immutable 63-file source snapshot. Control source is unmodified; probe changes only two method wrappers and shell marks in generated copies. The bundles have separate module/runtime instances in one process; cell positions rotate across four batches. Raw timing JSONL is appended outside the cold clock. A failed accounting sample is retained separately before rethrow. A recorded 180-second outer timeout bounds the run (completed in about 7.6 seconds). No heavy test or lint command from this task overlapped measurement; external load was uncontrolled.

Four new diagnostic-tool tests cover byte-preserving wrappers, return/throw/this, identity/interval/reconciliation rejection and explicit mapping rejection. Together with prior probe/analyzer tests, **8 tests pass**. Two static reviewers found and re-reviewed fixes for missing entry accounting and failed-sample retention. Full suite: **2514 passed, 2 existing D159 manifest failures, 4 skipped**; lint/typechecks pass. No public build behavior changed; no new runtime mutation qualification or artifact-gate pass is claimed.

`evidence.tar.gz` retains the frozen recipe, both bundles/metafiles, transformed sources, topologies, preflights, raw samples, summaries, descriptive analyses and their Python replay source, tool sources, review and check logs, wrapper setup incident, and baseline rechecks. The first wrapper setup encountered a collapsed untracked directory before launching any benchmark; it was corrected to enumerate files explicitly and retained as a non-measurement setup incident. The archive/index and current scripts are bound by `receipt.json`. `node-analysis.json` and `node-ranking.csv` are convenient copies for human/agent review. `record-gates.json` binds the subsequent workspace/dashboard checks. All earlier attempts are preserved.

## Next useful boundary

The selected C/authority/lifecycle design stays in place. The next focused diagnosis is why `currentFacts` has a consistent extra node-method interval, distinguishing source work from allocation/order/JIT effects; a repair requires a concrete mechanism. The 28 ms observed pause needs synchronized function/system context if pursued. Neither finding authorizes deleting samples, changing criteria, starting a formal retry, or declaring the wider preset work complete.
