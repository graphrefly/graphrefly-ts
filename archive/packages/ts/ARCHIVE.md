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
