# Private spending preset: numeric qualification review

2026-09-09. Same work: `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`. **Review proposal only; no changed numeric contract, algorithm, tolerance, public API, or execution authority.** D164/D165 assembly and finite offline repairs remain approved. This document records a newly demonstrated prerequisite failure, not a new work item or decision.

## Reproduced failure

All three inputs below are legal under the approved finite `[0, 10^9]` amount domain. Let `a = 999999999.9999999` as an actual binary64 value (exactly `999999999.99999988079071044921875`), and `b = 1000000000`. Sample standard deviation uses `n−1`.

| Prefix | Actual Graph z-score | Independent two-pass oracle / plain | High precision over exact binary64 inputs |
|---|---:|---:|---:|
| `[a,b,a]` | −1.414213562373095 | −1 / −1 | −1/√3 ≈ −0.5773502691896258 |
| `[a,a,b]` | 1.414213562373095 | 0 / 0 | 2/√3 ≈ 1.1547005383792515 |
| `[100,140]` | 0.7071067811865475 | same / same | 1/√2 ≈ 0.7071067811865475 |

The second prefix with the fixture's strict `zThreshold=0.5` changes flagged/no-publish behavior. This is not merely formatting or a marginal timing result. The current two-pass oracle and plain agreeing does not make either mathematically correct. Graph Welford loses precision around the large mean; the oracle loses precision while summing and subtracting that mean. No result has been rewritten into a pass.

Evidence: `packages/ts/qualification/causal-occurrence/preset-assembly-approved/receipt.json` links the loaded probe, exact source/bundle hashes, input/output records, and supplementary Python Decimal precision-100 calculation. The latter is analysis, not an unreviewed replacement qualification oracle. The attempt receipt identifies the actual artifact locations and explicitly records incomplete qualification.

## Q5 — Layer and owner

Keep the repair in the consumer-private finite prefix computation and offline verifier. Unique owner remains graphrefly-ts. A numeric semantic choice affects business correctness and evidence credibility; it does not imply a kernel primitive, new capability/export, or a wave amendment. Relevant files are `examples/spending-alerts/causal-business.ts` (vendorStats/anomalyScore), `scripts/fixtures/spending-preset-oracle.ts`, and the finite plain/reference fixtures.

## Q6 — Cost and invariants

INVARIANT: retain the approved finite input domain, strict threshold semantics, `n−1`, same input/code/request binding, and fail-closed admission. Do not round money to cents, increase tolerance, or replace a failing vector with an easier one. A bounded prefix (≤64) permits stable recomputation; constant-factor CPU and allocation cost still require the original cold/steady matrix. No performance pass is inferred from O(n), test duration, or the absence of additional nodes. Ordinary consumers should not gain a new numeric configuration field.

## Q7 — Reactive shape and concrete repair candidate

Proposed production computation: use a centered prefix (`d_i = x_i − x_0`), compensated sums, and sample variance over deviations; compute `x_last − mean` in the centered coordinate, without subtracting a rounded mean near 10^9. This remains inside the existing dispatched vendorStats/anomalyScore path. Preserve serializable statistics and the actual input→statistics/profile→score→policy→assessment/material dependencies. No inline invocation of another named node, new root, global cache, imperative trigger, or topology change.

Proposed independent truth: interpret accepted binary64 inputs exactly and use rational/integer sums in the offline verifier. For positive variance, `z² = (n*x_last−S)²*(n−1) / (n*(n*Q−S²))`, with the numerator's sign retained. This allows independent threshold comparisons and high-precision reported-score checks. The acceptance rule for values on a floating-point threshold boundary must be specified before implementation: mathematically exact comparison versus a specified rounded computation are distinct contracts. A stable floating implementation must still be checked across the full admitted domain; the centered sketch alone is not a proof.

## Q8 — Choices

| Choice | Benefit | Cost / limit |
|---|---|---|
| A. Repair finite computation and independently specify numeric truth (recommended) | Preserves input range; makes verifier credible; existing graph and consumer shape can remain | Requires explicit threshold/rounding semantics, new numerical qualification, and measured runtime cost |
| B. Narrow to a quantified well-conditioned domain | Smaller verification burden for a demo | Changes approved input acceptance; adds rejection cases users must understand; not selected |
| C. Increase tolerance or let candidate and oracle share their arithmetic | Cheapest apparent pass | Can mask different business decisions; forfeits independent evidence; unsuitable |

Precedents are the actual current Welford candidate and independently written two-pass oracle; both now have concrete counterexamples. No external library or generic statistics API is proposed from this one consumer.

## Q9 — Recommendation and stopping boundary

Recommend A. It covers private layer placement, existing topology, independent evidence, and the agreed user-facing finite domain. It only partially covers performance and all-domain correctness until the numeric contract and tests are fixed and measured. These are explicit remaining obligations, not accepted waivers.

The next review should settle the threshold/rounding rule and resulting minimal source diff before running the frozen full consumer matrix. Complete Graph reference semantics, all N1–N12 evidence, and 12 cold / 60 steady / 12 recovery rows remain outstanding. No measurements from CSP11/C have been changed or repurposed. The current work stays incomplete.

A separate pre-existing D159 manifest mismatch also prevents the full package/artifact gate from being green. Diagnose its old and current closure independently; do not replace historical qualification hashes to make a new run appear current. No provider or empirical campaign follows from this offline diagnosis.
