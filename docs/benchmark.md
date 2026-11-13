# Benchmarks

The package has one performance probe: the B49 TypeScript probe in
[`packages/ts/src/__bench__/b49-probe.ts`](../packages/ts/src/__bench__/b49-probe.ts). It is
informational, not a CI gate, and it has no committed baseline.

## Run

From the repository root, after `pnpm install`:

```bash
pnpm run bench
```

`bench` runs `probe:b49:ts`, which is `tsx packages/ts/src/__bench__/b49-probe.ts`. The probe
runs each workload once or twice to warm up, then 5 times (7 for the boundary queue), and prints
the median, minimum and maximum wall time in milliseconds with the Node version. Each workload
also checks its own delivery counts and throws if they differ from the expected numbers, so a
timing is reported only for a run that delivered what it should.

## Workloads

| Probe | What one run does |
|---|---|
| boundary FIFO queue | Queues 20,000 deferred boundary tasks inside one `graph.batch` and drains them |
| fanout DATA push | 512 `derived` nodes on one state, 2,000 writes |
| INVALIDATE set-only baseline | 256 `derived` nodes on one state, 2,000 writes |
| INVALIDATE set+invalidate | The same topology, 2,000 rounds of a write followed by `invalidate()` |
| diamond pending join | One state, 128 `derived` legs, one `derived` join over all legs, 2,000 writes |
| rewire churn | 10,000 `ctx.rewire` calls alternating a node between two dependencies |
| active lifecycle retained cleanup | 2,500 nodes, each with a 4,096-byte payload released through its lifetime's abort signal on unsubscribe |

## Reading the numbers

Timings depend on the machine, its load and the Node version. Compare runs on the same machine
and Node version, back to back, and look at the medians across several runs rather than one.

For reference, these are the medians one development machine measured on 2026-11-11 (Node
v24.18.0, `packages/ts` at commit 65e5ca2b, after the D797 kernel migration, system load average
about 7-12). They are informational numbers from one machine, not targets or guarantees.

| Probe | Median (ms) |
|---|---|
| boundary FIFO queue | 0.90-0.92 |
| fanout DATA push | 634-650 |
| INVALIDATE set-only baseline | 296-303 |
| INVALIDATE set+invalidate | 448-454 |
| diamond pending join | 180-183 |
| rewire churn | 52-55 |
| active lifecycle retained cleanup | 45-47 |
