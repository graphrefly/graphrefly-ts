# Benchmarks

GraphReFly TypeScript uses [Vitest benchmark mode](https://vitest.dev/guide/features.html#benchmarking), which runs benchmarks with [Tinybench](https://github.com/tinylibs/tinybench). Layout matches callbag-recharge (`vitest bench`, files under `src/__bench__/`).

The suite in [`src/__bench__/graphrefly.bench.ts`](../src/__bench__/graphrefly.bench.ts) mirrors **callbag-recharge** `src/__bench__/compare.bench.ts` (local reference: `~/src/callbag-recharge`) where the APIs align: primitives (read/write/subscriber), derived (single-dep, multi-dep, cached read), diamond (flat, deep, wide), effect-style subscribers, fan-out (10 / 100 sinks), batch (10 sources + aggregate reader), and `equals` memoization. Omitted until GraphReFly has equivalents: producer, operator, `pipe` / `pipeRaw`, Inspector. Extra **graphrefly:** blocks cover a linear chain and batched fan-in.

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

## Other checks

- Loose wall-clock guard (skipped when `CI` is set): [`src/__tests__/core/perf-smoke.test.ts`](../src/__tests__/core/perf-smoke.test.ts)

## Lifecycle in benchmark mode

Vitest’s benchmark runner does **not** run `beforeAll` before Tinybench. This file uses **`describe` callback bodies** (they run when the file loads, like callbag-recharge) to construct graphs. `afterAll` is used to unsubscribe where needed.
