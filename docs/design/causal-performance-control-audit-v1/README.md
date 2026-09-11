# 同代码控制调查：时钟关联缺陷与批次变化

2026-09-10 · owner `graphrefly-ts` · `CAUSAL-PRESET-ASSEMBLY-TS` · 基线 `46355332`。
用户“继续”授权只读调查既有证据，沿用 commit 授权。本页是调查证据，不新增 D#、方法、
实现或测量授权；D168 和此前完整记录的 inconclusive 结果不变。

**定位到一个确定的诊断缺陷：GC/deopt 的跨时钟关联没有得到校准。**
同时观察到四个控制的第三批均较慢，且两个 module 的 allocation-site 变化记录不同。
这些事实把调查缩小到了测量工具与运行历史，但尚未证明控制时延差异的单一根因。

## 1. 什么已核实

重新逐文件核对原归档全部 321 个 digest；读取四个控制全部 9,600 样本，重算每批 p95，
与原报告的 24 个 arm/batch p95 一致。全行独立 verifier 仍能复算原 67,200 样本及
inconclusive 结论；它核实算术/结构，不验证跨时钟校准。

原/copy bundle 字节相同。冻结入口对应原 `runRow`；控制 candidate slot 调用 copy
module 的 reference factory，reference slot 调用原 module 的 reference factory。
两边各执行一次完整 preflight，每批各 100 warmup + 300 measured。没有发现误测业务
candidate、漏 preflight、错输入或采样数量不足。

仍存在源码可见的执行不对称：只有原 module 驱动 async `runRow`、调度与记录；copy 通过
module namespace 属性调用，原 reference 通过本地函数调用。模块加载顺序和控制 arm 映射
固定，AB/BA/AB 只改变 block 次序，不交换两个 module 的身份。预热次数相同不等于各自的
JIT/分配状态相同。此处说明具体差异，不声称一次属性访问解释了数十微秒。

Codegraph 两次没有命中 worker 定义，仅取回 `adaptWorker` 及旁支；未覆盖路径直接读取。
核心路径限制在 adapter → 原 worker → graphArm/reference → 样本 → correlate。

## 2. 新证据：批次变化不是四次恒定偏移

各值为该批 copy/reference 的 p95 比值，只用于调查；**不替换 D168 的三批中位数之比**。
没有改变排序、合并批次、删除极端值、扣除控制偏差或追溯重算资格。

| 控制 | 第一批 AB | 第二批 BA | 第三批 AB | 冻结的最终比值 |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0.94527 | 1.11370 | 1.55053 | 1.195819 |
| 1 | 0.96729 | 0.91019 | 1.22023 | 1.076344 |
| 2 | 1.05166 | 0.93779 | 1.28832 | 1.136932 |
| 3 | 0.91252 | 0.93172 | 1.39438 | 1.070037 |

第三批 copy p95 为 478.21 / 394.54 / 397.50 / 417.79 µs，original 为
308.42 / 323.33 / 308.54 / 299.63 µs。相同 AB 次序在第一批没有同样的差距，因此
“总是先跑的 arm 较慢”不足以解释全部记录。100 个样本窗口的原始分位数见 analysis.json；
copy 第三批的中途变化也不支持把最终比例当作恒定函数调用开销。

V8 原始 `code-deopt` 中，copy 的 `dependent allocation site tenuring changed` 记录数
依次为 9、9、15、15，original 均为 2。位置涉及 Node 构造、Graph `_addWithId`、
dispatcher register、dep bookkeeping 和 registration/release。这些是代码依赖变化事件，
不是相应函数的调用数、GC 停顿时长或独占 CPU 时间，不能据此判 registry 是根因。
同字节代码出现不同事件记录，足以说明“字节相同”没有保证运行状态相同。

## 3. 确定缺陷：把不同起点的时钟直接对齐

`scripts/fixtures/spending-preset-performance-worker.ts:217` 只记录
`process.uptime()*1000 - performance.now()`。
`scripts/spending-preset-performance-report.mjs:69` 却把这个 offset 同时用于 GC 和
code-deopt 事件，称它们是 process uptime milliseconds。

在本次运行所报的 Node v24.18.0 官方源码中：

| 时间字段 | 起点/计算路径 |
| --- | --- |
| process.uptime | uv_hrtime 减 node_start_time |
| code-deopt | V8FileLogger::Time，正常模式使用 logger timer 的 elapsed；timer 在 SetUp 中启动 |
| trace-gc | isolate 的 time_millis_since_init，使用 isolate 初始化时刻 |

依据为对应 tag 的 [Node Uptime](https://github.com/nodejs/node/blob/v24.18.0/src/node_process_methods.cc)、
[V8 logger](https://github.com/nodejs/node/blob/v24.18.0/deps/v8/src/logging/log.cc)、
[GC tracer](https://github.com/nodejs/node/blob/v24.18.0/deps/v8/src/heap/gc-tracer.cc) 与
[isolate 时钟](https://github.com/nodejs/node/blob/v24.18.0/deps/v8/src/execution/isolate.h)。
获取字节的 digest 和 URL 记录在 receipt.json；这是版本源码核实，不是本机二进制可复现构建证明。

冻结 bundle 的第 10177 行是在全部样本完成后写 completion。四个控制都有这一位置的
deopt；用现有 offset 映射，事件却早于最后样本结束约 2.291 / 2.359 / 2.130 / 2.118 ms。
这是一项执行顺序 sanity check，不拿这些差值倒推出“正确 offset”。现有数据未记录独立
校准锚点，GC 与 logger 也不能共用一个从结果拟合出来的偏移。

旧关联器测试 `scripts/spending-preset-performance.test.mjs:98` 使用人工样本、人工日志和
单个 offset=100，只证明区间运算；测试名称中的 actual timestamps 不代表真实时钟校准。
`correlate` 同时被 v1 与 v2 runner 调用。因此过去仅凭这些关联数组得出的“决定 p95 的
样本没有 GC/deopt 重叠”应降级为**未校准、不能据此排除**。保留旧文件的原字节，以本次
调查更正其诊断可信度；不把这个问题延伸到无关 profiler 或所有历史证据。

这不会更改任何样本的 `end-start`、分位数、控制容限或原 verdict：它们使用同一个
performance 时钟并不依赖 correlate。时钟缺陷目前解释的是归因证据为何不足，
**不是已经证明它制造了 7%–20% 的时延差距**。

## 4. 取舍与下一步

| 假设 | 当前证据 | 处置 |
| --- | --- | --- |
| 两个控制测到不同业务/缺预热 | 字节、配置、factory 路径、preflight 与数量一致 | 未发现此错误 |
| 固定顺序/模块/JIT/分配历史影响 | 批次变化、module 角色不同、allocation-site 事件不对称 | 值得追查；未建立因果或排除系统负载 |
| 某个慢样本恰遇 GC/deopt | 原关联器时钟未经校准 | 不能采用已有 overlap/no-overlap 标签下结论 |

推荐下一项先做**私有诊断修复**：无校准的事件关联应显式报告 unknown；GC 和 logger
分别携带可验证的时钟起点/校准误差，补不同起点、缺锚点、错误符号及不确定区间的负对照。
不能通过移动旧时间轴来让控制“通过”，也不需要增加任何 library 用户入口。
具体校准如何取得、对计时的干扰怎样隔离，仍需一个可审阅的实现方案。
本轮未实现该修复、未补锚点采样、未交换 module 重测、未提高容限。

在诊断可信度恢复前不对 Graph/registry 再做性能修补，不重开产品 A/B/C，不把均值
1.0264 当作达标证明。正式矩阵、CSP-11、provider/live/spend/effect 均未启动。

## 5. 重现与交接

运行本目录 analyze.py，参数为 `archive/evals/causal-performance-repetition-v2`，只读 tar
及其 receipt/index，不 import worker、不启动子进程或网络，输出应与 analysis.json 一致。
全部新数据均为已有材料的确定性派生；原样本与所有失败尝试保持不变。

本批没有实现变更，因此不重复 runtime/full/mutation/lint/build 资格。原两项 D159 失败
仍在；本轮验证的是原归档完整性、确定性重算、独立 verifier、文档/authority 和 diff。
人类理解仍未通过 teach-back 验证；沿用用户已给出的 OWN/PREDICT，不重新索要卡片。

下次可闭卷复述：三个日志时钟为什么不能共用 uptime offset；为什么时钟问题影响归因却
不自动推翻样本时长；同字节控制实际哪一层仍不对称；分配事件计数能证明什么；下一项
修复如何保持普通用户没有新配置。人工耗时与无 AI 对照未测量，不作生产力收益主张。
