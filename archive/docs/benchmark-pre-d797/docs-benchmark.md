# Benchmarks

GraphReFly TypeScript uses [Vitest benchmark mode](https://vitest.dev/guide/features.html#benchmarking), which runs benchmarks with [Tinybench](https://github.com/tinylibs/tinybench). Layout matches callbag-recharge (`vitest bench`, files under `src/__bench__/`).

The suite in [`src/__bench__/graphrefly.bench.ts`](../src/__bench__/graphrefly.bench.ts) mirrors **callbag-recharge** `src/__bench__/compare.bench.ts` (local reference: `~/src/callbag-recharge`) where the APIs align: primitives (read/write/subscriber), derived (single-dep, multi-dep, cached read), diamond (flat, deep, wide), effect-style subscribers, fan-out (10 / 100 sinks), batch (10 sources + aggregate reader), and `equals` memoization. Omitted until GraphReFly has equivalents: producer, operator, `pipe` / `pipeRaw`, Inspector. Extra **graphrefly:** blocks cover a linear chain, batched fan-in, and the workload-driven equals subtree-skip variants described below.

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

## Equals subtree-skip — workload-driven variants (B3, 2026-04-13)

The classic `equals: diamond with memoization` bench comparing `without equals` vs `with equals (subtree skip)` has consistently shown ~1.0× across revisions — the skip never materializes in that workload. There were **two bugs** in how the bench exercised the skip path:

1. **No duplicate writes.** The source was incremented monotonically (`k++`) or toggled between 0/1 — every write produced a distinct value from the previous one, so there was nothing for equals substitution to collapse. The source needs the pattern `[0, 0, 1, 1, 0, 0, 1, 1, ...]` (`Math.floor(k / 2) % 2`) so that every other write is a true duplicate of the last wire DATA.

2. **Default `equals` at the source collapses duplicates before the derived chain sees them.** Setting `equals: () => false` (`alwaysDiffer`) only on the derived nodes doesn't help — the `state<number>(0)` source still has default `Object.is` equals, and collapses duplicate writes itself. Downstream never sees back-to-back DATA with the same value; the `alwaysDiffer` deriveds run on a RESOLVED cascade just like the optimized path. For an honest baseline, the source must also carry `alwaysDiffer`.

3. **Trivial fn body.** Cheap fns like `v => v + 1` produce savings (one fn elided) that are drowned by wire framing, tier sort, and counter bookkeeping. The new variants use `heavyTransform(v)` — a small fixed-work loop (50 iterations of `acc = (acc * 31 + 7) >>> 0`) — so skipping the fn actually dominates.

With all three corrections, the subtree-skip benefit is visible.

### New variants (src/__bench__/graphrefly.bench.ts)

| Variant | Setup | Measured |
|---|---|---|
| **`equals: 5-level linear chain, 50% no-op writes (heavy fn)`** | Two parallel 5-level chains; one with `alwaysDiffer` on every node (source + 5 levels), one with default `Object.is` throughout. Source receives `push(a, noopPattern(k))` where `noopPattern(k) = Math.floor(k / 2) % 2`. Each level runs `heavyTransform(v)`. | Baseline vs subtree-skip |
| **`equals: diamond with 50% no-op inputs (heavy fn)`** | Diamond topology: `src → {l, r} → j`. Same `alwaysDiffer`-vs-default split. Source driven by the same noop pattern. Each node runs `heavyTransform`. | Baseline vs subtree-skip |

### Results (2026-04-13 run)

| Variant | Baseline (alwaysDiffer) | With subtree skip (Object.is) | Speedup |
|---|---|---|---|
| **5-level linear chain, 50% no-op** | 216,917 ops/sec | **267,980 ops/sec** | **1.24×** ⇑ |
| **Diamond with 50% no-op inputs** | 319,495 ops/sec | **382,708 ops/sec** | **1.20×** ⇑ |

**What this measures.** On the subtree-skip path, the source's §3.5.1 equals substitution rewrites the duplicate `[DATA, v]` to `[RESOLVED]`. Downstream `_depSettledAsResolved` decrements `_dirtyDepCount` without setting `_waveHasNewData`, so `_maybeRunFnOnSettlement` hits the pre-fn skip branch and emits `[[RESOLVED]]` without running fn. The cascade propagates RESOLVED through all levels — the leaf sees exactly half as many fn invocations as the baseline. Under the heavy `heavyTransform` body, that translates to a **20–24% throughput improvement** on the no-op half of the workload.

### The old `equals: diamond with memoization` bench is retained

The classic variant (`without equals` vs `with equals (subtree skip)`) is kept because it's comparable to the pre-v5 baseline in `benchmarks/vitest-baseline.json`. It consistently shows ~1.00× because of bug (1) above — the source's monotone increments mean every write propagates. Treat it as a **regression alarm** for the fn/framing hot path, not as a subtree-skip benefit measurement.

### Correctness regression tests

The perf wins above are also guarded by two unit tests in [`src/__tests__/core/protocol.test.ts`](../src/__tests__/core/protocol.test.ts) (B3 block) asserting **exact leaf-fn-run counts** under the same noop pattern. Those tests catch the correctness side of cascade subtree-skip:

- `5-level chain: 50% no-op writes only re-run leaf fn on actual changes` — asserts 3 leaf runs for the pattern `[0, 0, 1, 1, 0, 0, 1, 1]` after initial activation.
- `diamond: both legs collapse to RESOLVED when source doesn't change` — asserts 0 join runs on duplicate source writes, 1 on actual change.

A future regression that breaks the pre-fn skip path (e.g., Flag A's dataFrom suppression bug) would fail the correctness tests and show a measurable slowdown in the benches above.

## Full bench snapshot (2026-04-13, machine-specific)

Latest `pnpm bench` run on the current development machine:

| Benchmark | ops/sec |
|---|---|
| state: read (`.cache`) | 35,561,715 |
| state: write (no subscribers) | 3,285,569 |
| state: write (with subscriber) | 3,167,364 |
| derived: single-dep | 1,221,355 |
| derived: multi-dep | 1,186,976 |
| derived: cached read | 35,094,481 |
| diamond: A → B, C → D (flat) | 484,224 |
| diamond: deep (5 levels) | 278,996 |
| diamond: wide (10 intermediates) | 137,166 |
| effect: single dep re-run | 2,789,219 |
| effect: multi-dep (diamond + effect) | 475,475 |
| fan-out: 10 subscribers | 2,119,183 |
| fan-out: 100 subscribers | 682,303 |
| batch: unbatched (10 sets) | 106,338 |
| batch: batched (10 sets) | 180,999 |
| equals: diamond (classic — monotone source) without | 471,252 |
| equals: diamond (classic — monotone source) with | 474,590 |
| linear 10-node chain | 189,584 |
| fan-in: batched two sources | 679,899 |
| **equals: 5-level chain 50% no-op — baseline (alwaysDiffer)** | **213,501** |
| **equals: 5-level chain 50% no-op — with skip (Object.is)** | **263,185** |
| **equals: diamond 50% no-op — baseline (alwaysDiffer)** | **317,823** |
| **equals: diamond 50% no-op — with skip (Object.is)** | **373,324** |

Headline ratios:

- **batched vs unbatched (10 sets):** 1.71× faster batched.
- **equals subtree skip (5-level chain, 50% no-op, heavy fn):** 1.24× faster with skip.
- **equals subtree skip (diamond, 50% no-op, heavy fn):** 1.17× faster with skip.

### Note on comparison to `benchmarks/vitest-baseline.json`

The committed baseline predates the v5 foundation redesign + this session's A2/A3/B1/C0 landings. `pnpm exec vitest bench --compare benchmarks/vitest-baseline.json` on the current development machine shows ~0.75×–0.97× across most benches. Interpret with caution:

1. **Different machine:** the committed baseline was recorded on a different host; absolute hz is not comparable across hardware.
2. **Session-added per-emit overhead:** the unified `_emit` waist now runs `_frameBatch` (tier monotone check + possible sort + synthetic DIRTY prefix) and the C0 PAUSE/RESUME filter loop on every outgoing batch. These add a few iterations per emit in exchange for (a) unified invariants across every entry point, (b) multi-pauser correctness, and (c) uniform DIRTY auto-prefix. The A3 settlement counters partially offset the overhead by removing two `every(...)` scans from `_maybeRunFnOnSettlement`.
3. **Refresh the baseline intentionally.** After any session that substantially changes the emit pipeline, run `pnpm bench:baseline` on the same machine you'll be comparing against. The committed baseline is a snapshot, not a permanent reference.

Refreshing the baseline from the current machine's numbers is a deliberate action — only do it when you're confident the current run represents "known good" performance, not a regression you haven't debugged yet.

## Other checks

- Loose wall-clock guard (skipped when `CI` is set): [`src/__tests__/core/perf-smoke.test.ts`](../src/__tests__/core/perf-smoke.test.ts)
- Correctness regression tests that double as perf alarms: `§B3` block in [`src/__tests__/core/protocol.test.ts`](../src/__tests__/core/protocol.test.ts)

## Lifecycle in benchmark mode

Vitest's benchmark runner does **not** run `beforeAll` before Tinybench. This file uses **`describe` callback bodies** (they run when the file loads, like callbag-recharge) to construct graphs. `afterAll` is used to unsubscribe where needed.
