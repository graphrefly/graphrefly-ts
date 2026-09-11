# Phase CPU / wall diagnostic v1 — complete, attribution unresolved

本批已按 `cf20118b` 第 3–7 节批准完成私有工具、离线资格、一次采集、独立复验与归档。**得到可信的阶段 CPU 和结构化事件关系；尚未得到稳定插桩开销或 registry/C 的因果结论。D169 仍未 qualified。**

唯一 owner 是 `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。本批没有新增架构决定，没有重选 A/B/C。观测工具只在维护者的私有诊断入口使用；library、公共 exports、分级接口和 wave protocol 均无变化。分级隐藏、普通用户理解与实际 effect 授权仍不是本批已证实的能力。

## 这次实际运行了什么

这是新增的、事先批准的有限诊断，**不是冻结 CSP11 eval 或正式 consumer 性能矩阵的重验**。B 使用冻结 D169 `position.mjs` 原字节；Q/T 仅由三处允许的源码替换加入阶段观察。两槽均为同一 reference 的独立 module，沿用输入、factory 和两个原三臂 preflight；没有 current candidate/M 计时。

一次 reservation 共用 **24.5972 秒**，运行 **1 个原生观察器夹具 + 12 个 consumer 进程**，采集并复验 **28,800 样本**（7,200 warmup、21,600 measured），24 个三臂 preflight / 72 个计时外实例。未重试，not-run 为空。输出 72,391,428 字节，低于 256 MiB 软上限。固定顺序：

```text
pass 0: B-U, Q-V, T-U, B-V, Q-U, T-V
pass 1: T-V, Q-U, B-V, T-U, Q-V, B-U
```

原生夹具 checksum `2225220677`，CPU 阶段线程增量 **4.345 ms**，yield 阶段 **Wlo=51.897708 ms > T=0.869 ms**。夹具的 empty 阶段也保留了 `T>Wlo`，没有错误地裁剪或拒绝它。夹具及 4 个 T consumer 的 trace 均通过同 PID/主线程/源码身份、三锚点、标记和事件结构验证。四个 consumer 的校准区间宽度均为 2 µs；这不是 CPU 计数精度或无插桩成本的证明。

## 结果与解释上限

[完整人读表](tables.md)、[全部匹配坐标 CSV](matched-comparisons.csv)、[原值与 p50/p95 对照](analysis.json)保留两个 pass、两种 orientation、每个 batch/slot 及 warmup/measured 的全部坐标。

| measured 阶段，同坐标逐项对照 | pass 0 | pass 1 |
|---|---:|---:|
| Q/B 原始 p95 比值范围 | 0.8892–1.1758 | 0.8773–1.2018 |
| T/Q 原始 p95 比值范围 | 0.8458–1.2390 | 0.8304–1.0705 |

每个范围包含两种 orientation × 六个 block 的全部 12 项，不是置信区间或 D169 判定统计。方向不一致，变化可接近正在解释的差异，因此结论为 **instrumentation/confounding unresolved**，不能授予“无开销”、稳定开销上限或 consumer 性能通过。

Q/T 每进程六个 measured 阶段合计：Wpoint **923.44–987.95 ms**，主线程 CPU T **896.48–958.49 ms**，整个进程 CPU P **1,170.66–1,266.85 ms**。T 与 W 较接近，P 可以超过 W；P−T 不是精确后台编译或 GC 耗时，W−T 也不是精确 scheduler 等待。

同一 Q-U 的两个 pass：T 增加约 52.06 ms，W 增加约 55.84 ms；Q-V 则 T 减少约 50.45 ms，W 减少约 52.00 ms。构造时间和原样本间隔也一起变化。这补上了上一轮缺失的 CPU 维度：**不能把这里的全部差额归为纯粹等待，但也未证明多做了业务操作。** 正常让出、记录/清理、频率、缓存、VM 与主机活动尚未分离。这次 B 的构造总时长也没有提供此前前半段整体抬高现象的清晰重现；不能用一次较平稳的 B 改写历史控制失败。

[事件覆盖](event-coverage.json)显示：T 每进程记录了 165–167 条受支持主线程事件。GC 与 measured 阶段有重叠，但没有记录到受支持 GC span 与原 measured 构造窗口重叠；deopt 则分别与 5、4、4、5 个 measured 样本重叠。**事件重叠不证明其导致全部差额；没有重叠也不证明没有相关成本。** 模块加载/阶段外事件超出锚点覆盖，逐关系保留 unknown，不借其他进程或旧文本时钟校准。没有对事件时长求和当独占暂停、扣除成本或制造 CPU 校正后的 p95。

## 工具、资格与证据包

数据路径：冻结材料 → B 原入口或 Q/T 派生入口 → 同一业务循环 → 有界阶段 CPU/trace 原始记录 → JS 纯报告 → Python 独立重算 → 固定坐标描述性表。原 sample start/end、record、finally cleanup 保持原位置。CPU 快照在阶段首尾，包含该阶段内让出、构造、记录和清理的整体执行；不分摊到节点或单样本。

- [批准](approval.json)绑定原设计和唯一输出目录；[离线资格](qualification.json)绑定 15 份工具/历史源及全部日志。实际加载 B/Q/T × U/V 入口、可数 stub 与 fake clocks；15 个加载正例/失败路径、2 个 profile 正例、15 个 JS 反例、12 个加载源码 mutation、29 个 Python 反例，以及完整合成 13 进程证据复验。离线资格没有采集真实 consumer 样本或额外原生观察器。
- [静态 QA](review.json)修正失败样本漏计、CPU 随 trace 丢失、预算与收尾、身份类型、IEEE-754 转换、中间锚点位置、逐进程源码资格和 continuation 收据校验。过期预算阻止 Popen、双重失败保留首因也以 fake backend 检查。
- 旧 JS 时钟/重放测试与 Python 16 项旧 verifier 回归通过；旧夹具仍要求其 GC/deopt 事件出现，没有放宽历史入口。新 profile 的自然缺类别保留 `not-observed`，不能改称无成本。
- lint、类型与治理检查通过。全量 TS **2,547 pass / 2 fail / 4 skip**；两项仍是既有 D159 冻结 implementation manifest drift，未改冻结 manifest，也未声称全量通过。
- [独立复验](independent-verification.json)从 raw 累计计数、样本、trace、配置、源码与进程记录重算；[新目录重放](portable-verification.json)给出相同结果。人读表与 agent JSON 使用同一来源。已采集数和已复验数分开保留，trace unknown 不清掉 CPU 原始记录。
- [完整 archive](../../../archive/evals/causal-cpu-wall-diagnostic-v1/README.md)包含 266 个文件、完整原始日志、15 份源码快照、入口、材料、资格、单次 reservation、退出与原始 index。压缩包 2,140,896 字节；不需要再次运行 consumer 即可复验。

本批到此结束。既有 v1 `1.211671` 拒绝/80 行未运行、D168 control-instability、D169 Z method-not-qualified/M 未运行均保持；不启动正式矩阵、provider/live/spend 或额外采集。

## Ownership checkpoint

用户此前已明确谁使用分级能力、生命周期由 graph 运行实例掌握，以及退订不能结算义务。本批只增加诊断证据，**用户独立解释与分级入口易用性仍未验证**，不重复要求已经回答的问卷。

可用于以后自行检索核实的五个问题（本批无需再答）：

1. B/Q/T 各多观察了什么；为什么需要保留 B？
2. CPU 阶段的边界在哪里，为什么不能直接当成节点构造 CPU？
3. P>W 或 W−T 为负时，原始证据应怎样保留？
4. 哪份原始记录和独立检查决定下一进程是否可以派发？
5. 本批哪条结论仍不足以授予 D169 性能通过或实际 effect 执行？
