# Receipt identity optimization: held-out operation audit

Owner context: graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS. Read-only product audit; no new semantic lock, product change, formal threshold, or qualification claim. Fixed baseline351a7ace versus optimized056e1fda; two bundles differ only in buildAdmission (AST checked). This audit changes private diagnostic tooling only.

## Results

| Size / operation | Before ms | After ms | After/before repeats |
|---|---:|---:|---|
| P1 / initial | 2.546 | 2.428 | 0.9305, 1.0191, 0.9871 |
| P1 / verification | 0.460 | 0.436 | 0.9613, 0.9835, 0.9276 |
| P1 / sparse | 1.471 | 1.743 | 1.1884, 0.8355, 1.2269 |
| P1 / missing-material | 0.323 | 0.335 | 0.9988, 0.9331, 1.0470 |
| P6 / initial | 693.521 | 632.583 | 0.7443, 0.9174, 0.9005 |
| P6 / verification | 311.036 | 242.512 | 0.7833, 0.7815, 0.7797 |
| P6 / sparse | 8.897 | 8.261 | 0.9159, 1.0430, 0.9239 |
| P6 / missing-material | 34.082 | 35.587 | 1.0433, 1.0531, 1.0559 |

24/24 jobs, 48 ordinary three-arm preflights, 144 measured observations complete; exact subscribed traces/retained states matched. Seven reindexed corruptions rejected. Scoped Biome and Python syntax passed. Fresh archive replay reproduced summaries and negative results. Product tests were not rerun because this turn changes diagnostic tools only; prior qualification evidence remains separate.

Verdict: benefit extends beyond the repeated-input tuning cases. P6 verification improves about22% in each repeat; initial processing also improves, although its first before observation is slower than later ones. There is no evidence for a universal speedup: sparse/small results vary by order, and missing-material P6 is consistently4–6% slower (~1.5ms median). With no identical-version controls, do not claim a precise causal percentage for small differences. The direction matches the source-level extra eager work when no material is available.

Recommend a later minimal lazy call-local encoding change: construct receipt keys only when an evaluation actually reaches receipt matching; reuse for the remainder of the same invocation, preserving existing receipt order and complete exact identity. This proposal adds no persistent state or registry. Do not modify product based on a single favorable timing. Retain this fixed eager-version evidence and use the same frozen recipes to evaluate any subsequent repair.

The sparse P6 recipe starts with only one selected evaluation, unlike the preceding one-new/duplicate experiments retaining63/64 prior evaluations. Its ~8ms result must not be substituted for those ~460/81ms paths. No production workload, summary-mode or whole-library conclusion is established. Formal acceptance stays incomplete.

Question: does the measured benefit extend beyond the repeated-arrival cases used to select the optimization, and is there a downside from eager encoding? These are newly exercised operation recipes, **not an independently sampled production dataset**: P1/P6 fixtures and the same spending consumer are reused. No global-library claim follows. Earlier shared authority optimizations have a different call graph; they are not remeasured here.

Recipes, all with a fresh runtime per observation:
- Initial: send the original scenario steps. Construction and process/module startup excluded; this is warmed first processing of a fresh instance.
- Verification: send every original step except verification before the clock, then supply original verification. This exercises first evidence availability, not a changed/stale receipt replacing an existing one.
- Sparse: preload all original non-arrival steps, then send only the last evaluation reference. Receipt cardinality remains P1/P6; one evaluation is selected.
- Missing material: complete initialization, then explicitly inject a validly shaped but unavailable/empty material frame at the internal materialStore output outside the clock. Confirm material invalid and evaluationSelections valid. Time original verification input; traced execution must emit no spending-verification DATA. This is a fault-injection diagnostic, not an ordinary public input or lifecycle recovery test.

24 fresh processes: two sizes × four recipes × three repeats, before/after positions alternate. Each arm has one traced correctness observation, one untraced warmup, three measured observations, all on fresh runtimes. 144 retained timings total. Before/after subscribed evidence/authority DATA traces compare exactly; those subscriptions can include cached initial delivery before the action. Complete authority state matches across versions and all measured observations. Original three-arm correctness preflight also runs per variant/job. Trace equality is for two product versions, not an independent oracle for every new recipe. Timed work excludes preparation, injected fault, assertions, subscriptions, cloning and teardown. No identical-version controls this round; prior controls are context, not substitutes. Small timing differences are inconclusive; report all repeat ratios and no formal p95.

Original matrix/input bytes, failure history and formal qualification remain untouched. One finite capture, 120s child/900s total, no timed retry. Temporary receipt arrays remain invocation-local; this audit does not add caches or registries. No downstream automatic implementation follows an unfavorable sample.

Reproduction: extract archive/evals/causal-receipt-holdout-evidence-v1/evidence.tar.gz and run `python3 tools/verify-causal-receipt-holdout.py capture/final` and `python3 tools/causal-receipt-holdout.test.py capture/final`. The verifier independently checks artifact integrity, recipes and arithmetic; source/runtime review supplies clock and behavior evidence. Independent read-only QA reviewed the four paths and documented these limits.
