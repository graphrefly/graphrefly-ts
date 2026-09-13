# Single-pass dependency initialization candidate

Owner `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`; baseline `8253488b`.
The user's “继续” after the source review authorizes the single-function implementation, offline
verification, comparison proposal and commit. It does not grant a new timed performance capture.
No D# or new work is created. This is an unmeasured candidate, not an accepted performance improvement.

## Change and review

`packages/ts/src/node/core.ts:284` now allocates the existing arrays and initializes all dependency
slots in one eager loop. Every default, field order and independently mutable nested array is retained;
the bookkeeping object is returned only after initialization. Zero-dependency nodes retain twelve
independent outer arrays. Allocation syntax changes; no reduction of the 12+2n array count is claimed.
`packages/ts/runners/local-untrusted-js/local-untrusted-js-runner.mjs` is the matching generated build
artifact, containing the same factory change. There is one handwritten production function change.

Source audit/Q5–Q9 remain in [the reviewed proposal](../dependency-initialization-review/README.md).
Codegraph confirmed current source and constructor ownership; final diff inspection found no new
public export, option, state owner, registry, dispatcher bypass or lifecycle code. Loop indices cover
all entries of the constructor's deps.length before Core can expose them. The changed function never
clears an admitted obligation or decides when a graph lifetime ends. Existing rewire, restoration,
async context snapshots and edge cleanup paths remain unchanged. No new implementation-mirroring test
was added: the existing behavioral suites and loadable mutations exercise those paths.

The engine may optimize the original builtins better, and the representation's engine element kinds
may differ despite identical observable array entries. No speedup, RSS saving, slow-tail explanation,
public graded-entry completion or D169 qualification follows from passing behavior checks.

## Verification and limitations

Exact command exits, source hashes, generated patch and raw logs are retained in the indexed evidence
archive linked by `receipt.json`. Checks executed against this candidate include the default offline
suite, build/export, source and test typechecking, async boundary, causal occurrence qualification,
private consumer mutations and independent plain/reference mutations. Summary counts are in the receipt.
Root soak completed219/221 cases; development-3/target hit the420000ms test timeout and
 development-4/target hit the existing admitted subprocess deadline. These are unresolved timing
failures, not asserted pre-existing failures or proof the factory caused a regression. The configured
wrapper timeout was1800s, but recorded elapsed was2051.38s with child exit1 rather than a wrapper timeout;
its configured value is not evidence of a demonstrated hard elapsed bound. No clock/suspension cause
is inferred. Keep these failures as qualification blockers before a new performance comparison.
Default suite's two failures concern the existing frozen D159 implementation manifest; artifact check
rejects the same drift. Frozen historical evidence was not regenerated. Full lint also scans retained
raw diagnostic artifacts and reports formatting/lint errors; the changed factory passes scoped lint.
Thus this batch is not labelled all-offline green or whole-work complete.

First-attempt anomalies are retained separately:

- Example typechecking ran while build was regenerating package declarations and failed on missing
  modules; it passed after build. Test typechecking passed. No compiler configuration was relaxed.
- The consumer mutation scripts hash all `docs/design` inputs. Initial outputs/logs were placed there,
  so their final preservation checks correctly rejected changing log bytes. Neither initial run counts
  as complete, even though behavioral mutants were detected. Final runs write entirely outside that
  input tree, preserving the same production candidate and checker code.
- The initial root-soak wrapper had a900s limit, shorter than the retained prior1069.77s run. Its process
  tree was explicitly stopped; the corrected externally logged run uses1800s. The interrupted run is
  not a passing receipt. This is verification supervision repair, not a performance sample retry.

All22 pre-existing dirty files across TS and root are preserved byte-for-byte against the prior
snapshot. Only this batch's source, generated artifact and evidence/work records are committed.

## Next boundary

[Comparison proposal](comparison-plan.md) retains a fixed48process/6720sample uninstrumented comparison,
matched controls, construction and subsequent lifecycle costs, explicit unknowns and stop conditions.
It is a preparation proposal, not a frozen runnable manifest or execution grant. Adapted tooling and
synthetic qualification must precede any fresh timed run. No new performance samples were taken here.
If controls or improvement direction remain unqualified, retain that result and stop the direction;
do not keep appending measurements until a favorable number appears.
