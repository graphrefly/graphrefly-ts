# Archived benchmark page

Archived on 2026-11-11 with the D797 kernel migration (REVIEW-D797-migration-fable §4.1: the old
baselines of `docs/benchmark.md`). `docs-benchmark.md` is `docs/benchmark.md` byte for byte as last
committed (c8516922). The website copy, `website/src/content/docs/benchmark.md`, was an untracked,
gitignored copy of the same body under the legacy website banner, so it is not kept here.

The page describes the Vitest/Tinybench suite `src/__bench__/graphrefly.bench.ts`, the
`pnpm bench:baseline` refresh and the 2026-04-13 ops/sec snapshots, including the equals
subtree-skip variants. They were measured on the pre-D797 kernel: that suite, its scripts and the
equals substitution it measured no longer exist, and `benchmarks/vitest-baseline.json` is a snapshot
from the same suite. The numbers do not compare with anything the current package measures.

This is history, not current guidance. The archived file is not edited, so its relative links
no longer resolve. The current page is [docs/benchmark.md](../../../docs/benchmark.md).
