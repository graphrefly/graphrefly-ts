# Benchmarks

GraphReFly TypeScript uses [Vitest benchmark mode](https://vitest.dev/guide/features.html#benchmarking), which runs benchmarks with [Tinybench](https://github.com/tinylibs/tinybench). This matches the pattern used in the callbag-recharge repo (`vitest bench`, benches under `src/__bench__/`).

## Run

```bash
pnpm install
pnpm bench
```

## Baseline JSON

The committed file [`benchmarks/vitest-baseline.json`](../benchmarks/vitest-baseline.json) is a snapshot from `vitest bench --outputJson` (absolute `filepath` entries and timing numbers are environment-specific).

Refresh after intentional performance work:

```bash
pnpm bench:baseline
```

## Compare locally (optional)

```bash
pnpm exec vitest bench --compare benchmarks/vitest-baseline.json
```

Vitest prints relative speed vs the baseline; it does not fail the process on regressions. CI runs `pnpm bench` as a **smoke** only (no strict compare), because absolute ops/sec differs across machines.

## Sources

- Bench definitions: [`src/__bench__/graphrefly.bench.ts`](../src/__bench__/graphrefly.bench.ts)
- Loose wall-clock guard (skipped when `CI` is set): [`src/__tests__/core/perf-smoke.test.ts`](../src/__tests__/core/perf-smoke.test.ts)

## Note on `beforeAll`

Vitest’s benchmark runner does not run `beforeAll` before Tinybench executes. Graphs are built at **module load** in `graphrefly.bench.ts` so each `bench` body runs against initialized nodes.
