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
