# Cleanup segment diagnostic v1 — proposed finite experiment

Owner：`graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。基于 `a87f0653` 的保留数据调查，本稿只设计下一次诊断，不改变 C、D168/D169、公共 API 或 wave protocol，不采用 release 算法优化。**实现和新采集待批准第 2–6 节。**

## 1. 要回答的具体问题

原 measured 构造合计约 513–539 ms、同阶段间隔约 408–449 ms；四个 T 进程中约 87% 间隔时间没有受支持事件重叠。冻结 `graphArm.cleanup` 每次完整 describe、逐节点 group.add，再调用 release；`_releaseNodes` 在固定 60 节点路径有每次 3,540 次 active 配对检查。这是静态热点，不能据此宣布它占了多少毫秒或造成构造 p95 超预算。

下一次只回答：

- 原间隔中的 memoryUsage、记录、cleanup、让出分别经历多少时间？
- cleanup 中，取消订阅、group/describe、加入成员、release 哪部分值得优先优化？
- 新计时本身是否显著改变原始构造 p95 或阶段行为，使结果不能推广到原基线？

不声称拆出节点独占 CPU、scheduler 等待或 release 内二次检查的独占耗时。`group.release()` 先作为整体观测，包含其安全检查、runtime 释放和 owner 收尾。

## 2. 三种模式，保持相同业务

| 模式 | 原始 driver / worker | 新观测 |
|---|---|---|
| B | D169 冻结 position.mjs 和两个 reference module 原字节 | 无 |
| S（外层分段） | 私有派生 driver 和 worker | 阶段 CPU + 每样本外层 8 个时间读数 |
| D（清理分段） | 与 S **同一份**私有派生 driver 和 worker | S 全部观测 + cleanup 内 5 个时间读数 |

S/D 的 module 两槽均为同一 derived reference 的独立导入，driver→M0→M1 顺序、两个原三臂 preflight、U/V、输入和原样本记录不变；没有 current candidate、M 额外构造或计时 plain。

原五个 flags 完整保留：`--trace-gc --trace-deopt --log-deopt --no-logfile-per-isolate --logfile=v8.log`。本批不加新的结构化 trace、console marker、sampling profiler、强制 GC、JIT 或系统设置。旧 native 文本日志仍不与 sample 时钟强行关联。

S/D 的阶段 CPU 保持 v1 的 12 阶段、24 快照、`performance → threadCpuUsage → resourceUsage → performance` 次序，且只在阶段首尾读取。可以复用 v1 Q 的低层 observer 和纯算术，但必须在新 envelope 明示 `cpuMode=Q, gapMode=S|D`、绑定新的派生入口。新整行 verifier 单独验证 S/D，不能放宽旧 B/Q/T 验收器或借旧资格冒称新入口已通过。

## 3. 精确时间边界与源变换

### 3.1 外层每样本 8 个新增读数

| 时间戳 | 放置位置 | 报告的区间 |
|---|---|---|
| y0 / y1 | 原 `await setImmediate()` 紧前 / 紧后 | yield elapsed，不能称纯 scheduler 等待 |
| m0 | 原 `memoryBefore=process.memoryUsage()` 紧前 | m0→**原 start**，保留原 start 位置 |
| m1 | 原 `memoryAfter=process.memoryUsage()` 紧后 | **原 end**→m1，保留原 end 位置 |
| r0 / r1 | 原 `record(...)` 调用紧前 / 紧后 | 原 record，包括 samples.push / stringify / appendFileSync |
| c0 / c1 | 原 sample finally 的 `cleanupAll([run], sampleFailure)` 紧前 / 紧后 | 完整 cleanupAll elapsed |

原 start→end 仍是原构造样本；其两次 performance.now 不移动、不替换、不在其中插入新 getter。新增区间不包含全部 bookkeeping；剩余时间须保留为未细分部分，不能强行归到某个区间。不得用 CPU 给上述 elapsed 分摊成本或制造校正后的 p95。

### 3.2 D 在实际 cleanup 内的 5 个读数

仅对私有 worker 的 `graphArm.cleanup` 做允许的变换：增加可选的诊断参数；读取 d0–d4；将原 `for (const n of graph.describe().nodes)` 中的 snapshot 在同一位置提为局部变量，以便放置 d2。不修改 Graph、dispatcher、registry、release 算法或真实业务 fn。

```text
d0
  disconnect + 原 owner.roots unsubscribe
d1
  原 topologyGroup() + 原 graph.describe()
d2
  原逐节点 graph.find + group.add
d3
  原 group.release()
d4
```

d1→d2 名称为 **group-create-and-describe**，不冒称独占 describe。d3→d4 名称为 **group-release**，不冒称二次检查独占时间。四段嵌套于外层 c0→c1，不把内外区间相加。

诊断对象由 driver 的 sample cleanup 调用显式传给 cleanupAll，再传给该 run.cleanup。S 不传深层对象，D 传；两者 bundle 字节相同，S 仍承担新增可选分支/签名的影响，因此 S/B 是整个模式差异，不能仅解释成 getter 成本。原 preflight 和 shared-finally 不传诊断对象。无全局 WeakMap、node 注册或 graph 侧通道，也不从构造计时内绑定对象。

阶段起点位于首个 y0 之前，终点位于最后 cleanup 与 sidecar 追加之后；sidecar 追加成本计入阶段观测。每进程只保留当前样本坐标与有界 2,400 条 sidecar，整行结束后单次写出。原 samples.jsonl 的结构/写入次数不变。sidecar 追加、计时回调、分支和派生源码的优化状态都属于插桩影响。正常路径单调时间、整数身份和边界数量必须精确；失败保存 partial/active、原错误及 cleanup/写出错误，缺读数不能当 0。

## 4. 实现前资格与独立复验要求

先完成以下不采 consumer 性能的资格，再冻结源码、输入、批准和一次性 reservation：

1. 原材料绑定现有 archive `9c7f02c656d2403bd09a645ace3a2fc0955d494d8675334dd7610c6be2a9b325`；B 的 position/worker 原字节不变。S/D 源变换逐处 allowlist，去掉允许变换后恢复原业务源码；没有函数替换或安全检查删除。
2. 实际加载 B/S/D×U/V、可数 factory 和 fake clocks，验证每进程 2,400 原样本、两个原三臂 preflight 调用、12 阶段、cleanup 次数、全部时间边界和原 start/end 位置。D 的四段只出现于 sample cleanup，不进入 preflight/构造；B 不调用观察器。
3. 实际加载源码 mutations：把 getter 移入原构造窗口、删除最后 cleanup、跳过 release、交换段名、漏 d4、把 S 当 D、错误坐标、吞原错误，都必须检出。失败要核实原错误与收尾错误同时保留。
4. 独立 verifier 从 raw 时间戳重算区间；非零手算向量、单位错、非有限/倒退、重复/缺样本、错 run/PID/源码、越出 CPU 阶段和内外区间重复求和等反例需失败。仍允许 P>W 与负 W−T。
5. 外层段按时间顺序不重叠，D 四段嵌套于同一 sample cleanup；每个 sidecar 对应唯一原 sample。原值、时间读取跨度、原 p50/p95、sidecar 与失败必须保留；不对 GC/deopt duration 求和或做减法归因。
6. 两份静态 QA、必要私有资格与 lint、同一 work 的治理/保留检查。library 不改，不因本诊断重写 D159 frozen manifest；全量 TS 的既有失败要单列。没有额外原生观察器夹具：沿用已核实的底层 API 可用性，新入口资格仍由上述加载测试及本次逐进程 raw 验证决定。

## 5. 一次性执行范围与停止

批准后的唯一 consumer 安排：

```text
pass 0: B-U, S-V, D-U, B-V, S-U, D-V
pass 1: D-V, S-U, B-V, D-U, S-V, B-U
```

| 项目 | 固定数量/上限 |
|---|---:|
| 真实 consumer 进程 | 12；B/S/D 各 4 |
| consumer 样本 | 28,800（7,200 warmup；21,600 measured） |
| 原三臂 preflight / 计时外实例 | 24 / 72 |
| S/D sidecar | 19,200 条 |
| D 深层 sidecar | 上述之中 9,600 条，不能重复算样本 |
| 外层新 performance 读取 | 153,600（8×2,400×8） |
| D 深层新 performance 读取 | 48,000（5×2,400×4） |
| 阶段 CPU 快照 / 其 performance 读取 | 192 / 384 |
| 真实进程总数 / 单进程 / 总时间 | 12 / 30 秒 / 900 秒 |
| 输出量软上限 / 检查周期 | 256 MiB / 100 ms |
| 自动重试、补齐、额外 fixture | 0 |

U=CR/RC/CR，V=RC/CR/RC；C/R 只是两个 reference 槽。每个 mode×orientation 两次位置之和为 11。这种安排只能平衡线性位置，不能消除非线性主机漂移，也不提供稳定开销置信区间。

原材料、输入、运行时 Node/V8/可执行文件、派生源、全部安排和数量在第一进程前落盘。总时间从准备开始，含准备、所有运行及读取验证；事先离线资格不计真实采集。准备失败也消耗尝试，一次性输出目录固定为 `archive/evals/causal-cleanup-segments-v1/run`，不得复用。每次派发前校验剩余时间、源码/可执行文件、host wake；子进程按 100 ms 监督时间/体积，承认检查间隔可能超量。

结构、业务预检、source/identity、CPU/raw 时间、sidecar 数量、时钟连续性、sleep、超时、体积或退出失败，均停止后续；保存失败位置、实际采集数、复验数与 not-run，零重试。单纯慢、模式差异大或未再现不提前停止，也不加样本。下一进程只在独立 raw/source verifier 接受当前进程后派发。

## 6. 报告与本批结束条件

所有 phase、batch、slot、orientation、pass 的原值均保留；warmup/measured 分开。每个 matching coordinate 列 S/B、D/S 的原构造 p50/p95 比、构造合计和阶段 CPU/W；S/D 列外层段分布，D 列四个 cleanup 子段。另列整个 cleanup 与 group-release 的原 elapsed 占比，但不用它改原预算或解释成因果份额。

- 若 group-release 不是主要 cleanup 部分，优先级转向实际较大的记录/取消订阅/group+describe/其他区间；不为二次遍历假设挑数据。
- 若 group-release 是明显的大项且跨两次记录可见，获得进一步评估 release 算法的依据，仍未分离其内部安全检查与实际释放成本。
- 若 S/B 或 D/S 明显改变构造行为，保留 instrumentation/confounding unresolved；不挑较有利模式、不扣插桩成本、不扩测。
- 若 interval 内没有单一大项或新现象没有重现，报告未定位的剩余部分，本批结束。

不给“明显”发明自动阈值，不新增统计检验或 D169 verdict。交付 raw/source/approval/exit、完整 archive/index、独立新目录复验、人读与 agent 报告、同一 work 证据和 commit。结束可以是 complete-diagnostic/unresolved 或 incomplete；均不自动启动优化、正式矩阵、provider/live/spend。

## 7. Q5–Q9 审查

- **Q5 · 层级**：维护者私有诊断，不是通用 profiler 或新 graph 能力。显式 cleanup 诊断参数仅存在于派生副本，原库无新入口；不增加普通用户或框架作者的认知负担。
- **Q6 · 不变量/维护**：保留原构造窗口、所有 unsubscribe/release 安全拒绝与失败原子性；固定源变换与 Node 格式有维护成本。sidecar 和计时器本身会影响分配/优化，因此整个模式成本必须公开，不能假设免费。
- **Q7 · 简化/可组合性**：先测 group.release 整体，不侵入 `_releaseNodes` 或增加注册表。业务 graph、dispatcher、authority/lifecycle/evidence 都不变；不把私有维护工具变成普通用户的必需 API。
- **Q8 · 局部选择**：直接优化二次循环再前后比较，可能改变过多因素且无法先证明热点占比；一次把所有 release 内部步骤都插桩，归因更细但干扰和变换范围更大。推荐外层/cleanup 两级分段，代价是仍不知道 group.release 内部独占分布。这里比较的是诊断粒度，不重选原 A/B/C 架构。
- **Q9 · 推荐覆盖**：外层归属、清理大项、source/失败边界覆盖；观测影响只部分覆盖，两次镜像不能给稳定开销上限；节点 CPU、优化收益、冷构造因果、D169 性能资格均不覆盖。接受这些限制，先决定是否值得针对 release 做下一步，不自动实现优化。

这是同一 work 的有限诊断设计，非新的长期语义或性能成功标准，因而不新增 D#。下一批审批对象是第 2–6 节：私有实现与离线资格 + 一次固定 12 进程/28,800 样本诊断 + 独立复验/归档/commit；不是未来无限定位、优化或重试授权。
