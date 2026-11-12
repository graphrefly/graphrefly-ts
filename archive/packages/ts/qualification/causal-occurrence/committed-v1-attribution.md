# committed-v1：原始布局的逐输入归属（attribution-v1）

Owner：graphrefly-ts；work：CAUSAL-COMMITTED-VIEW-TS；依据 D161/D163。用户在 diagnosis-v1 后回复「继续」，本次完成一次原始布局的有限离线归属测量。它是 attempt/evidence；生产源码、公开 API、C、wave protocol、D159 绑定和旧收据未改。此前「记得 commit」继续适用。

## 结论

**仍未通过资格。当前应集中检查冷构造成本。** 原长进程布局下，唯一超标行是 1 effect / 0 evidence / 0 背景节点的构造比值 1.221602。基线 p95 为 113.000 µs，候选 138.041 µs；按本次基线乘原 1.20 门槛为 135.600 µs，多出 2.441 µs。这个数只解释本次样本，不是新的固定绝对预算。

两个决定构造 p95 的样本均无可能重叠的主线程 GC 或 V8.DeoptimizeCode 事件，不能把它们简单归为 GC 异常值。也不能据此断言剩余时间全部来自某个函数：操作系统调度、JIT 及探针影响尚未被全部分离。

原 1000 背景节点的 1.839833 倍异常，本次未重现。此次测量补全了新进程的时间线，**没有补出旧进程缺失的历史证据**，因此旧异常的确切原因仍未确定。

## 完整布局及原始结果

原 runner 模板相对 `246ff0ac` 逐字节不变，摘要为 `80790407d414c05615a8196013ab3271f54d8087dc25f45836494c338b3220c4`。新增 `--attribution-dir` 只为可选运行插入记录逻辑：

- 六条原始轨迹，原七个被观察 ports、输出顺序、排序后拓扑比较及 cleanup 保留。
- 四行顺序固定：1/0/0、16/128/0、64/512/0、1/0/1000。
- 每行三批构造，每批 100 对预热、300 对正式样本；稳态两对预热，然后 15/15/9/15 对正式样本，原交替臂顺序不变。
- nearest-rank p95、稳态的 median-of-per-run-p95 比值、≤1.20/≤1.10 预算、ordinary/dynamic 控制组和 1,200,000 ms child timeout 保留。

一次完整运行于 2026-09-08 14:27:28–14:42:28 UTC 完成，耗时 900.411 秒，exit 0。运行期间 source 与 harness 摘要一致。没有第二次完整运行、强制 GC 或测量期间的事件循环让步。

| effects / evidence / 背景节点 | 构造比值 | 稳态比值 | 按原数值门槛 |
|---|---:|---:|---|
| 1 / 0 / 0 | 1.221602 | 1.039352 | 构造失败 |
| 16 / 128 / 0 | 1.160579 | 1.009072 | 满足 |
| 64 / 512 / 0 | 1.118783 | 1.004340 | 满足 |
| 1 / 0 / 1000 | 0.796737 | 0.940899 | 满足 |

这些仍是**插桩运行的描述性结果**。新增时钟、CPU/heap 读取、跨 run 保留 starts/timings 和 V8 trace 都可能改变内存/JIT/GC 历史。数值满足不能升级成 committed-v1 资格通过；原失败门槛及 D159 待重新取得离线资格的状态保留。

## 已取得的归属证据

原始记录包含 7,200 个构造样本、108 个完整 lifecycle、29,976 条正式输入。离线分析逐项重建构造时间数组和每个 lifecycle 的 p95，并与主报告原始数组严格相等；没有删除样本、扣除 GC 再计分或选择较好批次。

时钟通过 `process.hrtime.bigint()` 前后夹住 `performance.now()` 建立两端校准。当前 Node 的 performance.mark 没有进入所请求的 trace，因此不使用缺失 marker。独立小型验证用显式 MajorGC 证明 hrtime 与 trace 共享时间基准；强制 GC **只在小型验证中**，不在完整运行中。

主线程 trace 包含 35,784 个 MinorGC/MajorGC 完整 B/E 对；范围覆盖全部样本。两端时钟约束取交集，再加入 1 µs trace 量化余量，最终每个端点余量约 ±3.396 µs。分析分别给出 possible/definite overlap、时长中点估计和保守上下界，避免把边界事件视为确定停顿。

1-effect 构造行两臂各有 46 个达到或超过 p95 的尾部样本；其中基线 3 个、候选 2 个与 GC 确定重叠。候选一个 5.895 ms 构造样本含约 5.706 ms GC 重叠（保守下界约 5.699 ms），说明探针能捕获真实的毫秒级 GC 停顿。但决定 p95 的基线 batch 1 / pair 81 与候选 batch 0 / pair 223 都没有 GC/deopt 可能重叠。批次、pair 均为零基。

1000 背景节点行，基线 150 条正式输入中 1 条与 GC 确定重叠，候选 150 条中 0 条。两臂的 GC 重叠主要发生在 setup/cleanup：正式样本的 cleanup 总时长约 23.12/23.63 秒，其中 GC 重叠中点估计约 1.06/0.87 秒。cleanup 没被计入构造/输入时间，但会改变后续进程状态；不能把「1000 个背景节点」等同于「每条 DATA 重新遍历这 1000 个节点」。

本次记录没有进一步划分冷 builder 内的每个函数。上一轮探针已证明此空输入构造没有调用 authority transition 或 committed-view helper，因而 retained effects 快照复制不是该构造场景的解释。

## 具体下一步

停止对未改生产代码反复跑完整 gate。下一批应只针对冷构造的固定材料和验证分配做小范围定位/优化，优先查看 `causalColdNodeNames`、`causalOccurrenceRequiredEdges`、`assertCausalOccurrenceTopology` 及它们调用的 `ConstructionScope.readIncoming/seal`。现有实现会创建固定名称/required-edge 材料、实际 incoming 索引及资源检查对象；这是代码可见的优化候选，**尚未证明某一项单独造成 2.441 µs 超限**。

先形成可审阅的小 diff 和分配/调用证据，再进行一次适用资格重验收。必须保留实际边验证、取得点记录、唯一 owner、transfer-before-activation、原 getter/错误行为和精确 obligation 结算；不能以 manifest 声明替代实际依赖，不能删除检查来获得更快样本。若需要变更 C 的语义或公开 helper 的行为，应单独设计审阅，不能混入优化。

这一方向不要求新增用户配置、运行模式或公共入口，也不要求在 DATA 路径增加事务。完整 preset、真实 effect、provider/live/spend 和 B121 仍不在本批范围。D159 的离线资格只在后续源码及检查冻结后按已有流程重新绑定，本次不改常量。

## 审查与验证

qa 两路静态审查修复了：harness 摘要缺少运行后校验；主报告路径可能覆盖原始诊断证据。复审通过。分析复审另修复时钟不确定度未传播到 overlap 判定的问题，并验证 union 不产生负时长。

小型验证（独立缩小布局，不能计入资格）通过三个真实输出/拓扑对照、72 个构造及 24 个 lifecycle 的区间/计分检查、实际 GC 时钟校准。四个确定性控制从实际分析器 AST 提取函数，覆盖可能重叠但实际位于边界之外、确定内部重叠、重复区间合并和超出不确定度排除。

首个小型夹具提取断言错误，以及随后发现 performance.mark 不出现在 trace 的失败都保留在证据包，不计为通过。完整运行仅执行一次。新增内容限于诊断 runner/fixture、此报告和证据/工作记录；没有改 package runtime，因此本次不重复此前默认 suite/soak，也不声称那两个 D159 失败已修复。

人和 agent 共用 `committed-v1-attribution-receipt.json` 与其绑定的无损证据包，包含完整 runner/bundle、source/harness hashes、逐输入记录、V8 trace、分析代码、计分重建、审查记录及命令日志。原 committed-v1 和 diagnosis-v1 保持原字节。
