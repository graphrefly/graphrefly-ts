# Archived measurement scripts

Archived on 2026-11-11 with the D797 kernel migration (Q14's principle), byte for byte as on
`origin/main` (cadf3ca6). These scripts measured or qualified the spending host, the causal
preset and library registration on the pre-D797 kernel. They call APIs the D797 kernel removed
(module-level batch, standalone node(), Node.down, the old describe and observe), so they no
longer run, and they are not ported. Only old receipts reference them; no gate ran them.

- compare-spending-host-call-local, compare-spending-preset, compare-spending-preset-repetition,
  compare-spending-publication (with fixtures/spending-publication-measure.ts)
- count-spending-host-lifetime, measure-spending-construction-pair, measure-spending-focused-host,
  measure-spending-host-lifetime, profile-spending-host-lifetime
- qualify-spending-host-source-binding
- qualify-library-registration with fixtures/library-registration-probe.ts
- verify-spending-host-call-local.py and analyze-spending-host-profile.py, which checked the
  receipts of compare-spending-host-call-local and profile-spending-host-lifetime by script digest

The receipts that cite them (under docs/design and archive/evals) are unchanged; their
`scripts/...` paths now resolve under `archive/scripts/...`. qualify-causal-occurrence.mjs is
archived here too (see archive/packages/ts/ARCHIVE.md).

## §4b: the rest of the historical scripts

Archived on 2026-11-11 (§4b, the maintainers' rule): a script stays in `scripts/` only if a package
script, a gate, CI or a current doc tells someone to run it and it runs on the current head.
Everything else moved here at `origin/main`'s bytes, unported: 257 scripts (every causal-*,
spending-*, qualify-*, verify-* and run-* measurement or qualification script and the script-local
*.test.{mjs,py} files, which no gate ran) and the 18 fixtures only they used. Ten of them had been
ported on the D797 branch; those edits are not kept. Kept in `scripts/`: the three lint checks
(check-causal-lint-evidence.py, check-no-raw-async.ts, check-typecheck.ts), the package build
checks (check-ts-package-exports.mjs, check-ts-package-batch.mjs), the untrusted-JS runner builds,
the IndexedDB browser smoke and its bundle, the 17 fixtures that tests and examples import, and
`hermes-smoke`, pending the maintainers' decision. Six of the archived scripts are frozen lint
files; `scripts/check-causal-lint-evidence.py` accepts them here by sha256. Their receipts under
`docs/design` and `archive/` cite the old `scripts/...` paths, which resolve to `archive/scripts/...`.
