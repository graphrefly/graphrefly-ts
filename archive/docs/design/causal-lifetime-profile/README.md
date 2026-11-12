# Focused-host lifetime CPU attribution

Four finite captures completed on baseline `97dfb8a7f540f495036fe728dcc1b77a557eeb48`. Each used a fresh process and the current focused host, with two vendors and revisions 1–32 per vendor. All runs completed 64 exact oracle-matching simulated writes, retained 64 successful outcomes, and reached normal-end eligibility. No production source changed during capture.

The declared method and complete source closure hashes were written before the first captured worker. `archive/evals/causal-host-lifetime-cpu/attempt-1/` retains that method, the actual unminified worker bundle, its source map including source contents, four raw V8 CPU profiles, derived attribution files and the receipt. Reproduction entrypoint: `node scripts/profile-spending-host-lifetime.mjs`; a subsequent invocation creates a working attempt directory under docs/design/causal-lifetime-profile; this archived capture is not overwritten.

## Capture boundaries

Sampling interval was 100 microseconds. Each capture covers synchronous input publication and simulated asynchronous completion for either requests 1–8 or requests 57–64. Construction, fixture generation, initial pack publication, final stop, assertions, record inspection and teardown are outside sampling. Loop/send/batch wrappers, writer byte counting, the drain helper's promise continuations, five no-op view subscribers and inspector start/stop boundary overhead remain inside.

These are instrumented attribution runs, not latency benchmarks. The first and last windows have different JIT histories and retained frontiers. They are not independent stationary samples, and their durations cannot replace unprofiled measurements or establish a 100 ms guarantee.

| Mode / window | Samples | Profile duration |
|---|---:|---:|
| off / first 8 | 578 | 90.583 ms |
| off / last 8 | 3,374 | 474.000 ms |
| summary / first 8 | 565 | 87.750 ms |
| summary / last 8 | 3,444 | 478.292 ms |

## Disjoint sampled self attribution

The last-eight captures agree on the largest source groups:

| Source | off self time | summary self time |
|---|---:|---:|
| `examples/spending-alerts/causal-publication.ts` | 142.586 ms | 142.003 ms |
| `packages/ts/src/json/codec.ts` | 123.881 ms | 127.162 ms |
| causal occurrence `identity.ts` | 41.834 ms | 40.543 ms |
| causal occurrence `lifecycle.ts` | 24.419 ms | 24.129 ms |
| causal occurrence `evidence.ts` | 22.207 ms | 18.959 ms |
| Inspector boundary | 31.084 ms | 28.375 ms |
| Garbage collector | 10.372 ms | 13.083 ms |

Encoding traversal (`visit`, `string`, `sortedJsonValue`, `stableJsonString`) accounts for much of the sampled work. This supports inspecting repeated full-record processing in this actual host path. Sampling alone does not prove an exact operation count, the removable fraction, or that any serializer can safely be omitted. Native/anonymous/program samples remain visible rather than being silently assigned to graph nodes.

## Derived attribution limitation

**Use `selfBySource` and `selfUs` for the table above. Do not interpret the original `inclusiveUs` fields as union CPU time.** The initial derived aggregator counts each ancestor stack node before aggregating rows by source/line/function. Recursive frames can contribute repeatedly to one row, so its inclusive total can exceed the capture duration. Row keys also omit column coordinates and can merge same-line function locations. These issues do not alter raw profiles or the disjoint source-level self totals.

The original attribution files and method are preserved unchanged for audit. Any independent corrected union-of-ancestry analysis should be a separately identified artifact using full source/generated location identities. No extra capture is needed to correct derived analysis.

No public API, runtime semantics, resource limits or real inbox I/O changed. This is not formal performance qualification.

## 本轮结论与可复核计数

独立 untimed 计数确认：每步两个完整快照含 i−1 和 i 个结果。64个唯一成功结果，经
129个source快照产生4096条outcome DATA；前8步共64条，末8步共960条。
这解释了随历史增长而放大的工作量，但不能直接把4032条重复结果都视为可安全删除。
当前原authority负责精确replay、冲突与生命周期证据；省略重复交付必须先证明等价，
不能靠丢记录、订阅退订或新增跨wave缓存来换取性能。

counts.json绑定当前脚本、实际导入源码闭包和baseline，并在运行后复核无变化。
首次counts-attempt1.json缺少完整源码绑定，保留为历史尝试；补齐绑定后仅重跑untimed计数，
没有重采CPU。两次计数一致，不合并成更多性能样本。

corrected-attribution.json由独立Python分析器读取原始profiles，以完整generated line/column
及函数身份累计，每个sample的同一函数只算一次。递归和同一行不同column控制通过，
self权重守恒；原inclusive统计保留作问题记录。执行
`python3 scripts/analyze-spending-host-profile.py` 可重新计算，无consumer运行。

结合上一轮无插桩轨迹，当前优先级是共享的完整结果处理与编码，而不是继续优化创建入口。
两个编码模块在last8占采样权重约56%，但这不是可移除比例或预期加速倍数。
本轮不声称已解决热点，亦不建议改变生命周期/快照语义来直接丢弃这些工作。
先前小prefix轨迹低于100ms不能推出所有输入合格，D169资格状态不变。

本轮仅新增诊断工具和证据，产品源码、波协议、公共API都未修改；没有provider/live/spend。
