# Host guard call-local comparison prototype

This source-transformed prototype completed four bounded diagnostic cells on baseline `7d3a5539b325943cf5919ed0d78543af3e93e878`. It did not modify production source. The current evidence does not establish enough benefit to recommend adopting it.

## Exact change

Inside the existing hostGuard callback, immediately before reading the committed effects view, the prototype inserts a lazy `Map<unknown,string>` of complete canonical comparison strings. A callback-local `same(left,right)` shadows the imported comparison helper. The first use evaluates the left operand before the right, uses the existing `canonicalMaterial`, and stores a string only after successful encoding. The map disappears after that callback. No digest substitution, cross-call registry, admission authority, public API or resource budget is added.

The source anchor must match exactly once; esbuild must transform exactly one host source. Both complete bundles and source maps, including original/transformed source contents, are retained unchanged in `archive/evals/causal-host-call-local/attempt-1/`. The method and source binding were recorded before execution. Production dependencies had no hash changes during the run.

## Finite comparison

Each mode (`off`, `summary`) has a baseline/prototype cell and an identical-baseline control cell. Each arm runs one complete warmup lifetime and three measured lifetimes. Each lifetime has 64 successful sequential writes, two vendors and revisions 1–32 per vendor, using unchanged original bounds and one write in flight. Arm order alternates; each cell runs in a fresh process. No forced GC or real I/O occurs.

Every pair checks exact topology, all independently generated oracle payloads, retained outcomes, and normal-end eligibility. All checks passed. Every lifetime retains 64 successes, publishes 129 notifications, and reaches `normalEndReady=true`; maximum frame size remains 47,167 bytes.

Input and completion intervals exclude assertions, record inspection and memory sampling. The recorded rows are successive points along growing retained history, not independent stationary samples.

## Observed benefit and control variation

The table shows the range across the three paired measured lifetimes. Percentage change compares the sum of recorded input plus completion intervals for the second arm against the first. It is not a formal confidence interval.

| Mode | Prototype vs baseline | Baseline-B vs identical baseline-A |
|---|---:|---:|
| off | −1.29% to −0.87% | −2.65% to −0.14% |
| summary | −1.29% to −0.86% | −5.54% to +0.67% |

The small observed prototype gains sit within larger identical-control variation. These cells also differ in module-instance structure: baseline/prototype load separately bundled implementations while the identical control calls the same baseline module twice. JIT and GC history therefore remain a measurement limitation.

The main growth persists: final-eight prototype input means are roughly 34.6–35.9 ms, with completion means roughly 13.4–14.0 ms. This bounded comparison does not establish a material reduction in the growing retained-history cost. It does not justify claiming performance qualification or changing budgets.

Retain this as a tested prototype. Further work should follow the independently established dominant call paths or counts, rather than repeatedly rerunning this tiny optimization to obtain favorable timing.

## Artifacts

- `scripts/compare-spending-host-call-local.mjs`: reproducible bounded experiment; new invocations create new attempt directories.
- `archive/evals/causal-host-call-local/attempt-1/method.json`: frozen transform, method, script and source hashes.
- `archive/evals/causal-host-call-local/attempt-1/baseline.mjs` and `prototype.mjs`, with their source maps: actual executed implementations.
- `archive/evals/causal-host-call-local/attempt-1/driver.mjs`: exact pair/control driver.
- `archive/evals/causal-host-call-local/attempt-1/receipt.json`: all raw per-frontier measurements and outcome witnesses, failure list and source-drift check.

No failed cells or reruns occurred. No product implementation or commit was made by this diagnostic task.

## 独立复核与结论

`python3 scripts/verify-spending-host-call-local.py` 可不运行consumer而重算24条测量轨迹、
1536条frontier记录和12对witness，核对完整source/bundle/map/driver哈希及唯一源码替换。
本轮独立复核通过；工具lint通过。产品源码未改，未重复全量测试或build，不冒用历史通过。

另一个候选“全局canonicalEntry只编码一次”被排除：真实Proxy反例可使第二次读取变化或抛错，
因此复用第一次编码会改变当前可观察结果。excluded-global-change.json保留两个实际反例，
此处不把输入边界改变伪装成等价性能修复。当前host快照不可变的前提不能推广到所有原始DATA。

结论：这一个host回调内Map方案不落地、不再靠重复采样追逐有利数字。保留前一轮所识别的
共享历史处理成本；小幅比较缓存不足以解决它。这个结论只否定当前原型的落地依据，不意味着
整个library已经没有优化空间，也不改变正式性能资格未完成的状态。
