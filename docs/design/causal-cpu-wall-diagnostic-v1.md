# Cold 构造 CPU / 经过时间诊断：待审阅

2026-09-11 · 基线 `93d89fd8` · 唯一 owner `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。

**本轮只有设计、静态核算和 commit；未实现、未采样。** 推荐下一批做一次固定的三层观测诊断：原路径 B、阶段 CPU 观测 Q、Q 加结构化 trace 的 T。每层使用同一 reference/reference-copy、U/V 两种顺序和两次镜像排列。先完成私有工具资格，再执行一次有限诊断，结束后只报告证据和限制。

这不是替换 D169、重试 Z/M 或重开 library 架构选择。D169 的失败、M 的 not-run、D168 历史结果和 CSP-11 冻结 eval 保持。identity、graph-owned lifecycle、retained evidence、可组合性与分级隐藏目标保持；不增加公共 API 或业务状态。

## 1. 要回答的问题与已有证据

[上轮只读调查](causal-position-pairs-retained-audit-v1/README.md) 校验了 635 个归档文件、96,000 样本：240 个 measured block 中 p95 最高的 24 个和 p50 最高的 24 个均在前 20 个进程。样本间隔也变长，但最后控制对仍失败。不能删除前半段、延长预热或推断 registry 回归。

本诊断只回答：

1. 若相同业务再次出现耗时变化，同阶段的**主线程 CPU 时间、整个进程 CPU 时间、经过时间**分别怎样变化？
2. 变化仅出现在构造窗口，还是整个采样阶段及记录/清理/让出之间也有变化？
3. Q/T 观测本身是否伴随可见变化，使归因无法推广回 B？
4. 有哪些被支持的 VM 事件能与测量窗口建立可信时间关系？

不会承诺找出具体调度者、热降频、全部编译活动或某个节点的独占耗时。CPU 时间增加不等于执行了更多业务操作；频率、缓存、VM 和系统调用也能改变执行时间。新的诊断即使有效，consumer 性能资格也仍未通过。

## 2. 核实的接口与复用边界

固定 Node `v24.18.0` / V8 `13.6.233.17-node.50` / 当前 darwin 平台与可执行文件 digest。

Node 的 `process.threadCpuUsage()` 返回调用线程的 user/system CPU 微秒；`process.cpuUsage()` 返回整个进程，多个线程的累计 CPU 可以超过经过时间。`process.resourceUsage()` 同时提供进程 CPU 与资源计数。本稿用前者记录主线程，用后者记录进程 CPU、上下文切换和 page-fault 原始计数，避免重复读取进程 CPU。[固定版本官方说明](https://nodejs.org/download/release/v24.18.0/docs/api/process.html#processthreadcpuusagepreviousvalue)

结构化 trace 使用 hrtime 的时间源，以微秒记录；performance.now 的边界仍须通过同进程锚点换算。[固定版本 trace 说明](https://nodejs.org/download/release/v24.18.0/docs/api/tracing.html)

实际前例和缺口：

- `scripts/derive-causal-position-driver.mjs:19` 从冻结 bundle 派生 U/V driver，原测量 body 和 cleanup 保持。B 直接使用归档中的 `position.mjs` 原字节；Q/T 通过新的私有派生器增加下述边界钩子，原派生器及其证书不改。
- `scripts/fixtures/spending-preset-performance-worker.ts:240,269,329` 分别是让出、构造计时前内存读取、计时后 cleanup。原样本 start/end 与记录/清理顺序保留。
- `scripts/causal-event-correlation.mjs:14,45` 的三锚点换算和保守关系可复用；`:98` 的 `correlateTrace` 则绑定 `empty/gc/deopt` 三窗口，并要求 GC 和 deopt 实际出现。它是**夹具验收器**，不能直接放宽后冒称 consumer 已有资格。
- 新增独立 consumer trace adapter，固定本稿窗口表，复用已批准的小写 console b/e 配对规则与同步事件 B/E/X 规则。原夹具验收器保持原条件，继续作为历史回归。

本轮仅查阅文档和源，不执行 CPU API 或启动探测进程；运行时 API 可用性、计数有效性及采集格式由下一批的有限资格夹具核实。

## 3. 观测粒度、计算与不得作出的归因

每进程沿用三批、每批两槽，每槽 100 warmup + 300 measured。一个 block 分成两个**观测阶段**：索引 0–99 和 100–399，总计 12 阶段。阶段从第一次 `await setImmediate()` 之前开始，到最后一个样本的 finally cleanup 完成后结束。两阶段之间关闭前阶段，再打开后阶段；不把边界钩子放进原构造 start/end。

Q/T 每阶段两次快照，固定顺序：`p0=performance.now → threadCpuUsage → resourceUsage → p1=performance.now`。主线程身份须核实；不得从其他 worker 取数。保存两组原始 user/system 整数、资源计数、p0/p1、阶段身份和 PID。记录先保存在有界内存，整行业务循环结束后一次写出；失败时保留已完成阶段与未闭合坐标。

对阶段首尾快照 S/E：

```text
Wlo = E.p0 - S.p1
Whi = E.p1 - S.p0
Wpoint = (Wlo + Whi) / 2
T = (E.thread.user + E.thread.system - S.thread.user - S.thread.system) / 1000
P = (E.process.userCPUTime + E.process.systemCPUTime
   - S.process.userCPUTime - S.process.systemCPUTime) / 1000
```

Wlo/Whi 包围读取瞬间的经过时间差，不是 CPU 计数精度的证书；T/P 的读取时刻不完全重合，快照本身也有成本。原始计数、读取跨度和派生差值全部保留。计数倒退/非整数/错误单位/身份错误为 invalid；T 或 P 与 W 的关系不能作为丢弃样本的条件。

| 量 | 可以说明 | 不能说明 |
|---|---|---|
| 原 sample.ms、每阶段构造 ms 总和 | 原构造窗口经历的时间 | 构造的独占 CPU 时间 |
| T 与 P | 观测阶段的线程/进程 CPU 累计量 | CPU 指令数、业务额外工作量、某节点独占成本 |
| W−T（连同 W 边界及计数限制） | 未由观测线程 CPU 计数解释的经过时间估计 | 精确 scheduler 等待；本阶段本来就含让出和 I/O |
| P−T | 不同读取窗口的描述性差值 | 精确后台编译/GC CPU；不同时刻不能作严格分解 |
| 原样本之间的间隔 | 计时外混合工作经过时间 | 独立的记录、cleanup、磁盘或调度耗时 |
| context-switch/page-fault 增量 | 进程级原始计数变化 | 等待时长、其他进程身份或某慢样本的原因 |

**禁止用 W−P 计算等待、把负残差截为零、把 block CPU 按比例分摊到节点或单样本。** 例如 W=100ms、T=90ms、P=150ms 是允许的观测组合，P>W 不意味着证据损坏；也不能把 −50ms 当等待。W=100ms、T=40ms、P=80ms 则只有约 60ms 未由当前线程 CPU 解释，尚不知是哪种等待。

报告同时展示各阶段原样本 p50/p95、构造总时长、T/P/W、记录间隔和资源计数。warmup 和 measured 永不合并。任何相关变化只作描述，无 p 值、回归拟合、CPU 校正后的“新 p95”或跨阶段摊分。

## 4. 三层观测与插桩影响

| 模式 | CPU 快照 | 新结构化 trace / console markers | 保持的内容 |
|---|---|---|---|
| B | 无 | 无 | D169 原派生 driver 原字节与原 flags |
| Q | 每阶段首尾，共 24 次 | 无 | 相同业务、预检、每样本原计时/记录/清理 |
| T | 与 Q 相同 | 12 个阶段标记与三锚点 | 与 Q 相同的 CPU 观测安排 |

所有模式保留原五个 native trace-gc/deopt/log 参数；Q/T 不通过删旧日志降成本。T 只额外启用 `--trace-events-enabled`、`--trace-event-categories=v8,node.console`、私有目录中的 `--trace-event-file-pattern=trace-${rotation}.json`。不启用 sampling CPU profile、强制 GC、禁用 JIT、native optimization 语法或修改系统电源/优先级。

每个 T 阶段：校准锚点（如该边界预定需要）→ hrtime 包住 console.time → CPU 首快照 → 原阶段 → CPU 尾快照 → hrtime 包住 console.timeEnd。CPU 窗口取首快照 p1 至尾快照 p0；标记在它外面。三个锚点分别位于第一阶段前、第三个 block 后的阶段空隙、最后阶段后；每个都是 `p0,h,p1`，无动态重取。阶段标记含 run、进程、batch、slot、warmup/measured；console 输出保留在 T 自己的 stdout，属于该观测方式的影响。

新增快照缓冲、条件分支、console 输出、trace 后台写入及不同派生源的优化状态都算 Q/T 模式的整体影响，不能只报 getter 调用耗时。Q/T 不声称与 B 在机器执行历史上等价。

**影响核对**：在同一 pass、orientation、batch、slot 下逐项列出 Q/B、T/Q 的原样本 p50、p95 之比及总时长差；两个 pass 分开。它们是按预定坐标的描述性对照，不是 D169 的业务 C/R 对，也没有足够重复数提供稳定开销界。方向反复、变化接近待解释差异或 B 与 Q/T 的现象不一致时，结论明确为 instrumentation/confounding unresolved。即便接近 1，也不授予“无开销”或 consumer 性能资格。没有估计减法或有利模式择取。

这种安排代价是更多私有进程；好处是不会把 CPU 与 trace 的合并影响完全混成一个开关。它仍无法分解 trace 标记和 trace 后台开销，也不保证消除非线性主机漂移。

## 5. 事件时钟和支持范围

T 保留一份完整 `trace-1.json`，正常退出后解析。仍使用三锚点区间交集及向外取整、trace ±1µs、严格 run/source/PID/主线程身份，验证所有 console 的 b/e 完整身份和 hrtime 调用包围关系。不得使用 uptime offset、跨进程借用校准或只选择最窄锚点。

新的 consumer adapter 只接受该进程预定的 12 阶段窗口表；不会把 warmup 政名成 gc 或用假窗口绕过旧验收器。固定识别主线程 `MinorGC`、`MajorGC`、`V8.DeoptimizeCode` 的受支持 B/E/X，未知事件及其他线程保留原记录引用，不自动扩充原因类别。

每条受支持事件可与阶段和原构造 sample 计算 overlap / possible / disjoint / unknown。窗口内嵌关系不能交给旧 `calibrate` 的“窗口互不重叠”检查：先用 12 个非重叠阶段验证校准，再以同一有效区间调用纯 `relation` 对原 samples 逐个关联，另验每个 sample 属于唯一阶段且被其时钟覆盖。

Consumer 自然运行没有某类事件是 `not-observed`，不是 capture 失败，也不是“没有该类成本”。区别于旧强制 GC/deopt 夹具：新证据只证明本次记录到的受支持事件关系。所有事件与窗口逐项保留；不把重叠事件时长求和当独占暂停或从样本扣除。后台引用不冒充主线程阻塞。

错误标记、缺少锚点、空交集、截断、多 rotation、异常退出或解析超过 16MiB：trace 状态 unknown，保留原因和原始输出，**不改 CPU 原始结果，也不自动补跑**。下一节规定整体停止语义。已有 native 文本仍维持 uncalibrated；不把新结构化时钟套给它们。

## 6. 下一批具体上限与停止规则（待批准）

下一批建议批准本稿的私有实现、离线资格、**一个观察器夹具 + 一次固定 12 进程诊断**、复验归档和 commit。新的一次性 reservation 在任何夹具/consumer 子进程前持久化审批文本、源码、Node/V8/可执行文件、原 archive/source/input、全部模式/顺序与上限；准备失败也消耗该次尝试，不复用旧输出目录。

### 6.1 先做不采 consumer 性能的资格

- 实际加载派生 B/Q/T 与可数 stub/fake clocks，逐一证明 2,400 次 sample、两次原三臂 preflight、12 阶段、24 快照、清理与异常路径，且 warmup/measured 精确分界。B 无新钩子；Q 无 console/trace；T 无新增业务动作。恢复原循环后逐字节对比原始冻结 loop，其他 body 也做 allowlist。
- 独立 verifier 从 raw 累计 CPU 值重算 T/P/W；使用非零手算向量、单位错 1,000 倍、交换线程/进程计数、主线程身份错、缺尾快照、倒退、P>W、负 W−T 保留、phase错配和重建外层 hash 的伪造数据验证。禁止只验证报告标签。
- 新 consumer trace adapter 用保留的真实 b/e、B/E/X 片段和合成 12 阶段/样本数据资格验证，区别空类别、未支持相位、重复身份、边界接触、宽校准、多/缺文件与截断。原夹具的三窗口/必须出现 GC/deopt 的回归仍通过。
- 用实际加载的 observer/adapter mutations 验证：getter 移入构造计时窗口、CPU 单位错、丢最后 cleanup、跨进程校准、吞 unknown、将 P>W 拒绝、缺类别当无成本，均能被检出。测试只执行 stub 或保留数据，不隐含启动额外 consumer 性能采样。
- 同一批准内仅 **一个原生观察器夹具**，30秒上限，不导入 consumer：固定顺序 empty → 2,000,000 次 32-bit 整数混合循环 → 一次 50ms 异步 timer 等待。循环固定为 `h=2166136261; for(i=0;i<2000000;i++) h=Math.imul(h^i,16777619)>>>0`，返回并保存 checksum `2225220677`，由独立整数实现核对。三阶段使用同样快照和 marker，三锚点放在empty前、cpu后与yield后。CPU 累计须有效、busy 的主线程增量>0、yield 的 Wlo>T。任一不满足则资格未通过并停止，不加循环/改等待直到通过。这里的 timer 只验证私有观察器，不进入 graph 或测量工作量。无需人为制造 GC/deopt；自然事件可 not-observed。

原生夹具证明边界和信号路径的有限可用性，不校正或扣除 observer 的成本。其 marker 表为明确的三阶段 profile，与 consumer 的 12 阶段 profile 分开验，不放宽旧夹具入口。夹具失败则 12 consumer 进程全部 not-run。

### 6.2 一次固定 consumer 诊断

仅 `cold-P2-summary`，reference/reference-copy，无 current candidate、无 M 额外构造、无计时 plain。固定 U=CR/RC/CR，V=RC/CR/RC。C/R 在这里仅是两个 reference 槽，不是架构选择。

预定顺序：

```text
pass 0: B-U, Q-V, T-U, B-V, Q-U, T-V
pass 1: T-V, Q-U, B-V, T-U, Q-V, B-U
```

每个 mode×orientation 出现两次，位置之和为11；不根据机器负载、控制结果或先前数据重排。镜像只平衡线性时间位置，不证明消除了主机变化。每个新进程仍按 driver→M0→M1 加载、M0→M1 预检；全部 mode 使用同一业务 bundle 原字节、factory adapter 和原输入。

| 数量 | 固定上限 |
|---|---:|
| Consumer 进程 | 12（每个 mode 4） |
| Consumer 样本 | 28,800：7,200 warmup + 21,600 measured |
| 计时外原三臂 preflight / 实例 | 24 / 72 |
| CPU 阶段 / 快照（Q+T） | 96 / 192 |
| Consumer trace 文件 / 阶段标记 / 锚点（T） | 4 / 48 / 12 |
| 独立观察器夹具 | 1进程、3阶段；零 consumer 样本 |
| 实际采集进程合计 | 13；每进程30秒，整个尝试900秒 |
| 自动重试/补齐 | 0 |

900秒从 reservation 建立前的尝试起点算，包含运行前材料准备、原生夹具、所有 consumer、读取校验。fake-clock 离线资格和常规检查先完成再冻结源码，不计为真实采集；不得借测试命令额外执行本文 consumer body。输出总量软监督上限 256MiB，每100ms检查；超出即终止并保留现有文件，报告可能的检查间隔超量，不伪称硬字节隔离。单个 trace 解析仍限16MiB。无外部/付费工作。

出现结构、业务预检、CPU身份/计数、时钟连续性、host sleep、超时/体积或进程失败：停止，记录确切位置与未运行列表。T trace 无法建立有效时钟/结构也停止后续进程，但保留此前有效 CPU/样本数据，trace=unknown、attempt=incomplete。单纯没有自然 GC/deopt、耗时很大、模式差异很大不触发提前停止；按表完成并报告。异常处理保留主错误与 cleanup/收尾错误，不允许覆写首因或把缺数据当0。

## 7. 结果如何解释、什么时候本批结束

| 观察组合 | 允许的结论 | 后续边界 |
|---|---|---|
| 经过时间上升，T变化较小 | 当前线程 CPU 不能解释全部时间变化 | 未分离正常让出、I/O与调度；不能称“系统抢占已证实” |
| T也上升 | 当前线程执行时间也变化 | 未证明业务工作变多；需要具体代码/VM证据才能定位 |
| P比T多，或资源计数变化 | 进程其他活动/资源变化值得后续核查 | 不直接归为编译、GC或某个系统原因 |
| 某受支持事件与慢样本 overlap | 该事件与该窗口有可信时间重叠 | 不证明事件导致全部差额 |
| 仅Q/T出现或消失该现象 | 观测方式与现象不可分 | 保留插桩影响/时间混杂，不推广到B |
| 此次B也没有明显变化 | 本次未再现既有现象 | 不据此修复历史判定，不再测到出现 |

不新增“变化较大”的自动阈值：报告固定全部坐标和原值，以上是解释上限，不是因果分类器。交付可为 complete-diagnostic、complete-unresolved/not-reproduced 或 incomplete；均不意味着 D169-qualified，也不自动派发下一步。

人读报告先展示固定顺序、模式对照、T/P/W和事件覆盖；agent 读取同一数据、source hashes、阶段/样本身份、校准区间、unknown原因与独立重算结果。完整 tar、文件index、原始退出、not-run 和源码快照可在新目录独立复验，无需运行 consumer。用户 teach-back、分级入口易用性和实际 effect 授权证明均不借此批补成完成。

## 8. Q5–Q9 审查与取舍

**Q5 · 层级。** 私有离线观察器与纯 verifier，不是 graph primitive 或全库 profiler。复用原 driver、现有时钟区间和事件配对；仅为明确的阶段表新增 adapter。数据流为原输入→原 reference graph→原输出，旁路保存观测供纯分析，没有新的 domain authority。

**Q6 · 不变量与维护。** INVARIANT：时间单位/线程/进程/阶段不得混用；source、固定次数与全部失败不可丢；不从诊断推性能通过。主要维护点是Node版本计数和trace格式。CPU块级粒度与事件有限覆盖是接受的限制；不承诺scheduler/thermal根因。原工具严格入口保持，新增profile不能破坏既有夹具资格。

**Q7 · 简化与组合。** 两类输入→原业务节点→原输出的拓扑不变，所有业务fn继续经dispatcher；observer不触发graph。每阶段两次快照，避免逐节点counter。普通用户/框架作者不增加入口和运行成本；维护者多维护一个有界诊断路径，其实测扰动由B/Q/T明确呈现，不能声称免费。

**Q8 · 三种局部路线。** 仅加进程CPU最小，但不能区分当前线程和其他线程。逐构造/逐节点CPU能更细，却把getter直接放到短窗口并增加大规模测量扰动，需另行设计。推荐阶段CPU+单独trace层级：复用原loop与已验证时钟算法，保留细粒度原样本；代价是只能做阶段CPU描述、12进程仍不提供稳定开销估计。native OS scheduler profiler可更深入，但增加平台/权限/采集范围，本批不采用。

**Q9 · 推荐及覆盖。**

| 关注点 | 覆盖 |
|---|---|
| 当前线程与整个进程CPU区分 | 是，分别原值与单位，读取偏差显式保留 |
| 构造/记录/清理/让出独占时间拆分 | 部分：原构造时间+阶段总量；其余混合，不造细分 |
| CPU与trace观测影响分层 | 部分：B/Q/T两个pass全部对照；无无扰动或统计等价承诺 |
| 事件时钟可信度 | 部分：同进程校准+严格格式+unknown；不保证事件全覆盖 |
| 查明scheduler/GC/JIT/thermal唯一原因 | 否，接受为非目标；只决定下一次有证据的调查方向 |
| 可组合性、生命周期、无新用户认知负担 | 是，不改library、公共API或protocol |
| 性能/易用性资格完成 | 否，保持已有未完成状态 |

推荐这批有限观测，因为它补上上轮明确缺失的计数维度，且把观察器影响单独暴露；不再把换一套公式当作归因。若仍无法解释，本批以 unresolved 结束，不自动追加过程。

## 9. 本轮分类与审批边界

这是同一工作下的**诊断设计提案**，不改变持久架构、性能方法或成功标准，因而不新增D#。本轮只加设计及静态证据指针，不改work状态/acceptance，不重写历史收据。后续具体实现/13个采集进程仍需用户批准本稿第3–7节；审批保存在既有非决策approval/receipt路径，不能用方法D#代替。

本轮校验固定安排、样本/快照/预检数量和历史来源绑定；不会把这种静态核算或API文档当成原生观察器资格。批准后要做源allowlist/加载变体、独立verifier、必要offline/lint及治理检查；已有两项D159 manifest失败独立保留。完成后commit，不启动正式矩阵或provider/live/spend。
