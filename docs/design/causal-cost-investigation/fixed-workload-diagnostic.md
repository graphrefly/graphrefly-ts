# 固定工作量诊断：CPU、经过时间与观测干扰（待审阅）

2026-09-12 · 源基线 `ce927af1` · 唯一 owner/work：`graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。
本稿是一次私有诊断的设计，不修改 D168/D169、性能门槛或 library 架构，不授权执行。

## 1. 要回答的问题与明确终点

在同一 reference、相同数量的构造与清理下，较慢 block 是否同时消耗更多进程 CPU？
可观察的 GC 事件是否与较慢阶段重叠？新增观测是否改变原有耗时分布？

依据是 [Z 的失败](../causal-cold-position-pairs-v3-implementation/README.md)、
[已经完成的时间聚集调查](../causal-position-pairs-retained-audit-v1/README.md) 和
[当前源码绑定](source-readiness/README.md)。不要再次复算相同历史分布或声称找到了新缺陷。
当前 60 个 harness 输入与归档优化后版本相同；candidate/reference 共用优化的 identity.ts。

本批成功是交付可复核的活动类别证据，允许结论为 **未复现 / 混合 / 无法区分**。
不是让 Z 通过，也不保证一次诊断定位到函数。一次结束后必须明确：
有证据支持哪种下一步干预，或现有观测无法支持任何优化；不自动追加同类运行。

## 2. 推荐方案与三个处理条件

仅运行当前 reference/reference-copy，保持 cold-P2-summary、两份独立模块实例、
三批互补 U/V 顺序、每槽 100 warmup + 300 measured，以及原始逐样本
让出→内存读取→构造计时→内存读取→同步记录→清理顺序。
原 worker 的边界见 `scripts/fixtures/spending-preset-performance-worker.ts:240`、`:269`、`:329`；
实际执行须使用已核对的派生 driver，不能把普通三臂 worker 当作 D169 两臂入口。

| 条件 | 新增观测 | 用途 |
|---|---|---|
| BASE | 无；保留原样本和原 trace flags | 当前路径的对照 |
| CPU | 每个 warmup/measured block 边界读取进程 CPU 与经过时间 | 描述整段工作是否消耗更多 CPU |
| CPU_GC | CPU 条件加 Node GC PerformanceObserver | 观察 GC 时间重叠，同时暴露 observer 的增量干扰 |

原 flags 固定为 `--trace-gc --trace-deopt --log-deopt --no-logfile-per-isolate --logfile=v8.log`，
三个条件完全相同。本批不研究关闭 trace 的效果；它可能影响三个条件的共同基线。
不强制 GC、不关闭 JIT、不改变记录方式、不移动 cleanup、不减少 graph 节点。
CPU 与 CPU_GC 使用同一派生 loop；BASE 不经过每样本 observer 分支。
构建时只允许边界观测和 observer 安装差异，生成 bundle 均独立保留。

CPU_GC 的事件缓冲只在 observer 回调收集，固定最多 100,000 条；达到上限记失败并停止，
不得静默丢弃。在最后 cleanup 后固定让出两次，调用 takeRecords 后断开并写出。
保留 disconnect 时刻；这个有限排空不证明捕获了所有 VM 活动，末端无事件不能证明无 GC。
不在构造窗口内序列化 GC 事件。回调和缓冲仍可能改变后续执行历史，由三条件对照显示。

## 3. 观测边界、单位与不可推断的内容

CPU 条件在每个槽的 warmup 开始、measured 开始、measured 清理结束分别取 checkpoint。
每个 checkpoint 顺序固定：`wallBefore = performance.now()` → `process.cpuUsage()` →
`wallAfter = performance.now()`。记录两端 wall 与原始 user/system 累计微秒值。
CPU 差值转换为毫秒；经过时间保留 checkpoint 两端的不确定范围，不伪造同时读取。
计入段内的边界调用也必须保留，不减去估计的调用成本。

每个 measured block 的 CPU 覆盖 **300 次构造以及让出、内存读取、记录和清理**。
它不是构造独占 CPU，更不是 graph 节点 CPU。原样本的 start/end 提供构造经过时间总和、
p50/p95；block 经过时间与构造总和之差只能叫“其余经过时间”，不能叫 I/O 或 scheduler 时间。
构造之外各项这批不再细拆，避免每个样本增加多次 CPU 系统调用。

Node 的 `process.cpuUsage()` 返回进程 user/system CPU 微秒；多核工作可使其大于经过时间。
所以不计算或解释 `elapsed - processCPU` 为调度等待，也不把结果截断为零。
这是 API 的限制，不是异常样本删除理由。
[Node 24.18.0 文档](https://nodejs.org/download/release/v24.18.0/docs/api/process.html#processcpuusagepreviousvalue)。

GC PerformanceEntry 使用 startTime/duration，和本进程 performance 时轴对应。
只做区间重叠描述，重叠不等于该事件造成全部变慢；重叠区间取并集，不能重复相加。
回调到达时间另存，不能当作 GC 发生时间。使用 detail.kind/flags。
[Node 24.18.0 文档](https://nodejs.org/download/release/v24.18.0/docs/api/perf_hooks.html#garbage-collection-gc-details)。

实现资格阶段须验证字段有限、非负、时轴范围、事件开始不晚于回调接收时间，并用合成
跨边界事件检验关联算法。真实 observer 通道在单独工具探针内验证；不得在 consumer 内强制 GC。
若工具探针没有收到事件，记录 unsupported/unverified，停止准备，不以“零 GC”运行。
native trace-gc/deopt 的时钟映射仍为 unknown；不得使用旧 uptime 偏移或其他进程的校准。
本方案不做 native 时钟拟合，改用同一时轴的可观测 GC 子集；JIT、后台编译和调度细因仍留空。

## 4. 固定数量、运行环境与失败保留

拟议一次采集：**4 轮 × 3 条件 × 2 方向 = 24 个串行新进程**。
每轮六个条件/方向组合各一次；完整顺序在 reservation 中一次随机生成并保留，不按结果重排。
U/V 都仍包含两个相同 reference 槽，仅保留原始位置历史；不是 candidate/reference 性能比较。

- 每进程 3 批 × 2 槽 × 400 = 2,400 样本。
- 共 **57,600 样本：14,400 warmup、43,200 measured**，144 个 measured block。
- 每进程沿用两份原三臂 preflight：48 次调用、144 个计时外实例；业务资格不删掉 candidate/plain。
- 无 M、无正式矩阵、无 plain 计时面板、无额外诊断 workload，零样本替换或自动重试。

Node 固定 24.18.0，并在准备时绑定可执行文件 digest、平台/架构、依赖锁、esbuild、
60 文件闭包及新增工具；源有变化则准备停止。环境显式 allowlist，保留既有精确 Darwin
系统字段处理，禁止隐式 NODE_OPTIONS、coverage、compile cache。不会在采样后修改 allowlist。

上限：每子进程 30 秒、采集整段 15 分钟（从 reservation 起包括构建/准备）、
每子进程 RSS 256 MiB、整个新运行目录 256 MiB。父进程目标每 100 ms 观测 RSS/目录大小，
保留实际观测间隔；这是观测停止线，不声称硬内存上限或连续峰值。超过或观测间隔超过 1 秒
即停止后续调度并终止活跃子进程，保留原始退出/失败和所有 not-run。
原 trace 文件写入也计入目录预算。历史出现接近 RSS 上限，本稿不偷偷放宽。

结构、来源、业务、清理、输出写入、时限、主机睡眠或计数错误立即停止，准备失败也保留单次记录。
分布不稳定、没有复现慢段、某个条件更慢均不是提前删样或续跑理由；资源/结构有效时收齐固定24进程。
这只是拟议采集额度，不包括尚未实现的工具资格程序。执行前的准备收据必须另列资格命令、
工具探针的固定工作量/上限及实际 adapter 实例数；不能把这些隐藏成“零执行”。

## 5. 固定分析与结果如何改变下一步

独立 verifier 不 import collector 算法，从原始样本/CPU/GC记录复算：每 block p50、nearest-rank
p95（285/300）、构造总和、block elapsed 范围、CPU user/system 差值及 GC 重叠并集。
全部144个 block 按原始进程顺序展示，warmup 单列；不依据最快窗口设定“稳定段”。

插桩对照：每轮每方向每批每位置对应，分别列 CPU/BASE 与 CPU_GC/CPU 的构造 p95、
构造总和、block elapsed 比值；每个坐标仅4轮，列全部比值及范围，不宣称置信区间。
BASE 无 block checkpoint，其 block elapsed 只能用已有第一个 start 到最后 end 的跨度，
故三条件的 **对照 elapsed 都用该共同跨度**；CPU 内部完整 checkpoint elapsed 单独报告。
不得把两个不同边界直接求比。所有指标只描述，5%和1.20均不用于给新诊断判通过。

| 观察 | 可以说什么 | 不能直接采取什么行动 |
|---|---|---|
| elapsed 与 CPU 同增 | 与整段执行工作增多相容 | 不能说某个构造函数更贵；还含日志/清理/VM |
| elapsed 增、CPU 变化小 | 与更多等待或未计入 CPU 的因素相容 | 不能断言 scheduler 根因，不能减去“等待”后过门槛 |
| GC 事件重叠慢段 | 可观察 GC 与慢段同时发生 | 不能删掉 GC 样本或给 library 分摊全部 GC 成本 |
| CPU/GC 条件表现不同于 BASE | 观测改变运行历史的风险可见 | 不把插桩后数据当原 Z 路径的无扰动替代 |
| 24 进程未出现此前波动 | 本次未复现 | 不宣布修复或增加采样直到出现 |
| 多种信号冲突或变化幅度不可分 | mixed/unknown | 不制造单一根因 |

最终只交付一次分类和支持它的完整坐标。若只是 whole-block CPU 增多而没有更细证据，
下一项最多是针对日志/清理或构造路径的单因素干预提案，不直接改 library。
没有足够区分度就结束为 unknown，并说明需要何种新增证据，不重复同一诊断。

## 6. 实现前后工具资格与独立证据

准备阶段需完成：真实加载计数 stub 校验24进程计划/6槽/400次数、原业务适配器与独立
oracle/plain 对照、派生源 AST 差异白名单、构造计时窗口内无新增 CPU/日志调用。
检查 observer 在 CPU_GC 安装而其他条件未安装、checkpoint 在 cleanup 后闭合。
合成输入必须覆盖 CPU>elapsed、微秒换算、交叉边界GC、重叠GC去重、迟到事件、缺失末端、
复制PID、漏样、重复轮次、错误来源、失败后续跑以及 cleanup 与记录同时失败。
手算不同边界与非1比值，拒绝混用 BASE 跨度和完整 checkpoint 区间。

收据必须分开记录工具探针、真实业务资格实例和性能样本，保存失败而不只保存最终通过。
先提交可审阅的实现/资格/来源包，再进入单次采集授权边界。原始数据、生成源、环境、
时间/资源记录归档；新目录解包后的独立重放不启动 consumer，须重现全部数值与分类。

## 7. Q5–Q9 审查与取舍

**Q5：抽象位置。** 私有评测 driver 外围观测。没有新 graph primitive、用户配置或公开
profiler；实例与业务图沿用现有可组合构造。不要抽象成跨语言通用监测平台。

**Q6：长期风险。** INVARIANT：原单次构造边界、固定计数、失败保留、同源reference。
CPU 的进程范围和 observer 干扰无法消除；明确限制解释。脚本只服务此诊断，不承担产品能力。

**Q7：简化与可解释性。** 使用 block CPU，避免逐节点或每样本 CPU 观测。GC使用 Node
同一时轴，保留 native 未知而不另造校准系统。graph-owned lifecycle、退订不结算义务、
dispatcher 路径、identity/evidence 区分与分级入口均不改变。

**Q8：替代路线。**

- 逐样本 CPU/多阶段探针：时间分解更细，但数百微秒构造受边界调用干扰更大，需更多对照。
- 外部系统 profiler/线程调度跟踪：更接近等待原因，但需额外平台工具、权限与时钟校准，
  本轮没有已资格的该路径，不能承诺即装即得。
- 推荐 block CPU + 独立 GC 条件：复用原 driver，提供有限活动类别证据，明确无法精确归因。
  真实前例是原 worker 的 block/样本和原调查；不虚构其他 runtime 的先例。

**Q9：覆盖。** 源/工作量一致、产品零新增机制、原数据不丢弃：覆盖；插桩影响：有对照但
不能证明零干扰；GC关联：只覆盖可观察子集；构造独占CPU、调度根因、JIT归因和正式预算：
不覆盖。接受这些限制是为了有限诊断，不以扩建 library 来解决测试宿主问题。

推荐按此设计准备私有工具和资格证据，尚不采样。本次只更新原 work 的设计引用，
不新增 D#、不把一次诊断升级成永久验收方法，不启动 provider/live/spend 或实际 effect。
