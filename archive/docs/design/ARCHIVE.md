# Archived design receipts

Archived on 2026-11-11 with the D797 kernel migration (Q14's principle: history keeps its bytes
and leaves the live paths). These directories are the receipts of the spending measurement and
qualification scripts archived under `archive/scripts/`, moved unchanged from `docs/design/` with
their layout kept: causal-b121-proof-plan, causal-construction-closeout,
causal-event-clock-repair-v1, causal-event-clock-repair-v1-implementation,
causal-graded-entry-implementation, causal-host-call-local, causal-integrated-implementation,
causal-lifetime-closeout, causal-lifetime-profile, causal-performance-repetition-v2-implementation,
and causal-publication-material-v1 (.md, .json). Links in live files were rewritten to these
paths; the archived files themselves are not edited, so their own relative links to live
`docs/design` siblings may no longer resolve.

References inside digest-pinned history files (frozen lint files, and files whose digest a sibling
receipt records) deliberately keep their old paths, byte for byte; read them through this map:

| Old path | New path |
| --- | --- |
| `docs/design/<entry>/...` for each entry above | `archive/docs/design/<entry>/...` |
| `docs/design/causal-publication-material-v1.{md,json}` | `archive/docs/design/causal-publication-material-v1.{md,json}` |
| `scripts/<name>` for the scripts listed in `archive/scripts/ARCHIVE.md` | `archive/scripts/<name>` |
| `scripts/fixtures/library-registration-probe.ts`, `scripts/fixtures/spending-publication-measure.ts` | `archive/scripts/fixtures/...` |
| `scripts/qualify-causal-occurrence.mjs` | `archive/scripts/qualify-causal-occurrence.mjs` |
| `packages/ts/qualification/causal-occurrence/...` | `archive/packages/ts/qualification/causal-occurrence/...` |

Four history entries that stay in `docs/design/` cite archived scripts by their old `scripts/...`
paths, resolved through the map above: `causal-b121-owner-integration/` (all fifteen archived
scripts), `causal-cost-investigation/` (qualify-causal-occurrence.mjs), and
`causal-performance-repetition-v2.md` and `causal-performance-repetition-v2.design-check.json`
(compare-spending-preset.mjs).
