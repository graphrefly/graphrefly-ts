# Archived D159 root-eval harness

Archived on 2026-11-11 for the D797 kernel migration (Q14, option (a) for D159).

- `evals/graph-native-rerun-avoidance/` is the graph-native rerun-avoidance root eval harness, its
  receipts and artifacts, byte for byte as on `origin/main` (cadf3ca6).
- `src/__tests__/` holds the 13 tests that imported that harness, at the same bytes.
- `vitest.root-eval-soak.config.ts` was the live soak configuration.

This is history. It is not current `@graphrefly/ts` guidance, it does not run against the current
kernel, and it is outside the test, lint, build, docs and CI gates. Its recorded digests reproduce
from these bytes; `packages/ts/src/__tests__/archive-integrity.d159.test.ts` checks the artifact set
against its fixed external anchor and grants no current qualification. The root `eval:root:*` and
`test:root-eval-soak` scripts were removed with it.

## causal-occurrence qualification evidence

Archived on 2026-11-11 (Q14, option (a) for causal-occurrence). `qualification/causal-occurrence/`
is the D791 qualification evidence, byte for byte as before, and `archive/scripts/qualify-causal-occurrence.mjs`
the qualification that produced it; it mutates live source nodes the D797 kernel removed, so it no
longer runs and was not re-qualified. `scripts/check-causal-lint-evidence.py` accepts a frozen file
under `archive/` at its original path with the same sha256; `frozen-files.json` and biome's
`files.includes` are unchanged. The root `test:causal-occurrence:qualification` script was removed.

## D687 qualified evidence

Archived on 2026-11-11 (Q14, option (a) for D687). `evals/work-item-execution-default/d687-qualified-evidence.json`
is the frozen D687 evidence, bound to the preregistration with baselineCommit 963ab285, byte for
byte as before. Its frozen test is removed until the final migration head, where D687 is
re-qualified under a new preregistration whose baselineCommit is that head; the old
preregistration is archived as it is then, and no new digest is bound to it.

## D686 frozen evidence

Archived on 2026-11-11 (Q14, D686 as recommended). `evals/work-item-execution-project-fit/d686-showcase-evidence-v2.json`
and `d686-qualified-evidence.json` are the frozen D686 evidence, byte for byte as on `origin/main`;
`src/__tests__/work-item-execution-project-fit.d686.test.ts` and `work-item-execution-default.d687.test.ts`
here are those tests at `origin/main`'s bytes, including their frozen-evidence cases. D686's other
four tests stay live with the migrated harness.

## b121 graph runtime eval

Archived on 2026-11-11 (§4, Fable 4.1). `evals/b121/` (campaign, session and transport control
over a local graph runtime) calls APIs the D797 kernel removed and nothing references it; moved
unchanged.
