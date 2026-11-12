# Private spending preset: D166 numeric repair

2026-09-09; baseline `6373ad77`; owner `graphrefly-ts`; same work `CAUSAL-PRESET-ASSEMBLY-TS`.
The user approved the concrete RN64/strict-Number contract, then confirmed continuation of the existing implementation/offline/commit scope. D166 records the lasting numeric semantics; this directory records an attempt, not execution authority.

## What changed

`evaluationSelections → vendorStats → anomalyScore → thresholdGate → reasonFactors → alertMessage` remains the real dispatcher/DATA path. `vendorStats` now supplies bounded exact moments, alongside mean/std projections. `anomalyScore` computes the final score from those moments and the actual transaction; it has no policy dependency, prefix reread, cache read, new root or authority. Strict `>` remains unchanged. The ordinary five-port view and 53/54-node topology are unchanged.

The new helper is private to the example, with no package export. Ordinary safe integer inputs use exact Number accumulation when every sum and square sum is a safe integer. Other inputs are decoded as exact dyadics. Final rounding still uses bounded integer arithmetic on both routes; this implementation does **not** claim a generally floating-only fast path. Local BigInts never enter DATA: the node sends decimal integer strings plus the common exponent. Maintenance complexity and arithmetic cost have increased; no new user knobs or runtime modes were added.

The independent verifier uses pairwise squared differences, ordered-binary64 bisection and exact midpoint comparisons. It independently formats Number values and checks both reference consequences and actual-score consistency. The plain arm uses centered exact deviations and candidate-cell certification with a finite bisection fallback. Neither imports candidate arithmetic; plain does not import verifier arithmetic.

Verifier revision is `spending-oracle-v2`; the input domain remains `spending-finite-v1`. Fixture receipt/artifact identities bind the new content. Historical v1 identities are not rewritten; a stale v1 receipt followed by a distinct v2 receipt recovers admission. Loaded verifier artifacts bind the contract digest, loaded source closure, observed assessment, actual and expected complete request material, and verdict.

## Arithmetic argument and its limits

For `X_i` in common dyadic units, let `S=ΣX_i`, `Q=ΣX_i²`, `D=nQ−S²`. Then sample variance is `D/[n(n−1)]` in squared units. The final z-square is `(nX_last−S)²(n−1)/(nD)`; its sign comes from `nX_last−S`. This uses no prematurely rounded mean or std. `D=0` means true constant prefix; a rounded std of zero is insufficient. Zero outputs are normalized to +0, including accepted −0 input.

For rational `a/b`, `exponentOfRatio` computes its exact floor base-two logarithm with one integer comparison. The output unit is the larger of `2^-1074` and the normal 53-bit significand unit. After exact scaling, integer quotient (or floor integer square root of that quotient) gives the lower quantized endpoint. Comparing to the exact midpoint, squared in the sqrt case, selects the nearest endpoint; equality chooses the even significand. The significand is exactly representable as Number, and multiplying by its binary unit is exact. Integer Newton iteration starts above the root and strictly decreases until it reaches the floor root; it is bounded by input integer width, not threshold proximity or a precision retry policy.

At units `2^-1074`, accepted amounts have integer values <2^1104, sum <2^1110, and D <2^2220. The two DATA integer strings therefore need at most 335 and 669 decimal digits respectively; remaining finite Number fields/key syntax fit comfortably within a 2 KiB stats object. Arithmetic temporaries can be wider; this is a representation bound, **not a runtime latency guarantee**. The verifier's pairwise identity `Σ(i<j)(X_i−X_j)² = D` supplies a different statistical route. Its rounding searches at most 63 subdivisions of the finite positive binary64 ordering. These are reviewed arithmetic arguments, not a machine-checked proof or exhaustive enumeration of all inputs.

## Verification

- 98 actual preset tests pass, including the 13 frozen vectors in both diagnostic modes, signed zero, old-version rejection/current-version recovery, exact threshold equality, near-threshold verifier self-consistency, material/retention/replay and existing fan-out/fan-in scenarios.
- 200 reproducible fixed-seed differential cases compare candidate mean/std/z against independent oracle and plain z. Raw values and source digests are retained. This is finite evidence, not whole-domain enumeration.
- 16 real loadable source mutations detected; zero load-error kills. Includes sample→population, rounded-zero variance, removed rounding, `>=`, display-based policy, stale verifier revision, missing dependency/progress and original authorization/retention mutations.
- Four loaded source variants × two scenarios × two diagnostic modes preserve exact topology. Baseline/equivalent: flagged is admitted; root negative has zero proposals. Population: wrong results are rejected. Payload-only corruption: assessment stays correct but complete request comparison fails and admission is rejected; its unchanged normal path has zero proposals. No effect executes; actor attribution remains unknown.
- Default suite: 2463 pass, 2 fail, 4 existing skips. The two failures and artifact gate rejection are the previously recorded D159 frozen implementation-manifest drift. No historical manifest/grant/receipt is refreshed to mask them.
- lint, example/package typecheck, browser, build/export pass. Workspace/dashboard gates are recorded with this attempt.
- Prior 221-test root-soak reused only after 181 source/config/fixture files (136 static inputs plus dynamic root-eval material and runner/package locks) match `70ca9af7`. Five prior prerequisite qualifications are likewise retained on 61 unchanged source/test/runner/lock bindings. These are **not new executions**. The final mutation test's actual 56-input closure remains byte-identical; a later correction to its unrelated copied loaded-verification runner does not enter that test closure.

Static QA found and fixed direct-plain signed zero, reused receipt identity, optional-chain no-proposal ambiguity, and the old loaded-runner gap that copied an actual request digest without independently checking its contents. Negative/positive regressions and the payload-only loaded variant demonstrate the fixes. Intermediate results and corrections are retained alongside final evidence.

## Still outstanding in the original work

The numerical implementation and its finite evidence have progressed; **preset-v1 is not qualified**. The complete independent Graph reference, complete plain input/lifecycle equivalence, N1–N12 audit package, unchanged 12 cold / 60 steady / 12 recovery performance matrix and existing D159 binding issue remain. No performance matrix or supplemental arithmetic-cost measurements ran in this attempt. C's older performance pass is not transferred to this preset.

Next: build and semantically verify the independent Graph reference on the already-approved consumer scenarios before freezing and running the original performance recipe. This is continuation of the chosen architecture, not another A/B/C selection. Public exports, final qualified four-input factory/inbox, actual effect execution, B121 studies and provider/live/spend are outside this attempt. User comprehension and cognitive benefit remain unmeasured.

## Review handoff

Concrete path: aab near 10^9 reaches vendorStats as exact input DATA, yields RN64 z=1.1547005383792515, and with the identical full Number threshold produces no z alert. For 63 zeros plus MIN_VALUE, std projects to 0 but true dispersion is nonzero, so z remains 7.875. A changed implementation is visible through loaded source/bundle digests even when topology and tested consequences are unchanged.

For later closed-book review: where does exact statistical evidence enter the graph; why is displayed std=0 insufficient; which node compares policy; what makes a v1 receipt stale without erasing history; and which evidence is still needed to claim acceptable performance? These questions are not recorded as answered or as ownership success.
