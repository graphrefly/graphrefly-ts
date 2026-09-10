# D167 冷构造成本定位

2026-09-10 · TS 私有诊断证据 · 实现保持 `194e72ee`，基线 `8e13d831`。

用户在核对 registry 修改前后成本后批准“好的,你继续”。本轮沿用
`graphrefly-ts:LIBRARY-REGISTRATION-TS` / `graphrefly-ts:D167` 的调查背景，
只记录诊断，不新增架构决定、不改变 sequencer 状态、不启动生产优化。
此前实现与冻结结果见 [实现证据](library-registration-implementation/README.md)。

## 当前结论

**新增校验路径是最清楚的成本线索；原先 summary candidate 的 p95 增加
26–27 微秒，尚不能稳定归因给 registry、WeakMap 或某项必要保护。**

在四轮独立进程对照中，撤去 D167 新增校验后，candidate 的构造中位数每轮都下降：

| 模式 | 四轮 p50 减少范围 | 四轮配对差值的中位数 |
| --- | --- | --- |
| off / candidate | 4.73%–7.31% | 15.125 微秒 |
| summary / candidate | 3.05%–6.65% | 12.1875 微秒 |

reference 的 off 四轮也都下降；summary 三轮下降、一轮增加 1.01%。
这些是整条构造路径的干预结果，包括代码布局/JIT 的间接影响，不能读成
每个检查函数的精确 CPU 自耗时或可安全删除的固定成本。

只撤去新增取得保护与构造控制流时，summary candidate 的 p50 变化为
`+3.46%、−1.04%、+0.63%、−3.51%`，没有一致方向；四轮配对差值中位数
为 `−0.5` 微秒。本轮不能认定资源记账或 WeakMap 是主要原因。

## p95 与测量噪声

“当前副本”与 current bundle 字节相同，却有以下 summary candidate p95：

| 轮次 | current（微秒） | 相同副本（微秒） | 副本相对变化 |
| --- | --- | --- | --- |
| 0 | 306.750 | 340.583 | +11.03% |
| 1 | 343.125 | 391.625 | +14.13% |
| 2 | 562.250 | 538.500 | −4.22% |
| 3 | 314.875 | 293.042 | −6.93% |

因此此前两轮 `+9.08% / +9.86%` 是保留的观察值，不能提升为稳定的
registry 因果成本。也不能用新诊断覆盖历史拒绝、改写门槛或宣称已无性能问题。
本轮没有 GC/deopt 事件证据，不把波动进一步归咎于 GC 或 JIT。

## 实际多做了什么

独立的、不参与计时的 runtime 计数 probe 包装原方法并继续执行原方法体。
记录绑定稳定节点 id，比较 current 与撤去新增校验的 bundle：

| 模式（candidate/reference 相同） | `_assertAvailableId` 次数 | `_assertDepsLocal` 遍历的依赖元素数 |
| --- | --- | --- |
| off / current | 177 | 178 |
| off / 撤去新增校验 | 59 | 0 |
| summary / current | 180 | 186 |
| summary / 撤去新增校验 | 60 | 0 |

summary 有 60 nodes / 93 edges。新增部分即每节点两次名字检查（120 次）和
两次依赖遍历（186 个元素）。off 有 59 / 89，对应 118 次与 178 个元素。
这里只统计两个方法；`_addWithId` 内的直接 owner 检查以及 D161 的已注册节点
检查仍然存在，表中 0 不表示“没有任何依赖检查”。

相关源码为 `packages/ts/src/graph/graph.ts` 的 `_createRegistered` 和
`_addWithId`：前者增加构造前检查，后者在完成用户可控字段读取后增加最终检查。
这些检查之间存在用户代码/重入边界，次数重复不等于语义冗余。

原 D161 scope 中的节点本来就有 supplied acquisition。撤去取得保护的变体
保留这部分记录及正常发布标记，只恢复本批之前的 constructor 行为，并保留当前
统一 identity registry。它包含 early version validation、异常控制流和登记发行顺序
变化，绝不是孤立的 WeakMap 微基准。

## 阶段计时

before/current 另建有六个阶段时钟的 bundle，独立于主测量，四轮交换版本顺序并
轮换模式/arm 顺序。summary candidate 的结果为：

| 轮次 | 整体 p50 增量（微秒） | consumer builder 阶段 p50 增量（微秒） |
| --- | --- | --- |
| 0 | 6.708 | 5.083 |
| 1 | 15.125 | 13.333 |
| 2 | 10.250 | 8.625 |
| 3 | 11.417 | 10.959 |

这继续把调查重点指向 consumer 构造阶段。阶段分位数不可相加或当作各阶段
因果贡献；时钟插桩也有干扰。current 插桩版相对无插桩版的 p95 四轮变化为
`+3.19%、+17.18%、−6.96%、−8.16%`，这些独立进程差值还混有测量噪声，
不能解释为插桩的精确开销。本轮未进一步测每个节点的独占 CPU 时间。

## 方法与边界

- 六个主变体：修改前、current、字节相同 current 副本、撤去新增校验、撤去新增
  取得保护/constructor 控制流、同时撤去两者。另有两个阶段插桩变体。
- 每变体四轮，每轮一个新子进程；轮换四个 mode/arm 的顺序，每格 100 warmup、
  300 measured。主计时 38,400 次构造，阶段计时 12,800 次，共 51,200 个样本
  （38,400 measured、12,800 warmup）。所有样本保留，无剔除、无自动重试。
- “冷构造”指每次新建 consumer，进程内有预热；不是每次重启 Node。
  新版诊断每变体/轮独立进程，与上轮所有版本共享进程的诊断不同，绝对值不直接拼接。
- 预检 32 个 variant/mode/arm 组合，节点 id/factory、edges、启动 latest/counts、
  authority state 相同；另做 8 次不计时调用计数。它们只证明该冷启动观察相同，
  不证明完整语义等价。尤其删保护变体故意失去某些失败路径的正确性。
- 所有变体仅在 esbuild 输入和独立 bundle 内生成；生产源码、consumer fixture、
  既有冻结脚本/收据不变。没有场景输入、外部 effect、provider/live/spend。
- 两个删除因素的差值不能简单相加；剩余结构对照包含 registrar、factory funnel
  和构造布局，不能单独证明“合表节约了 X 微秒”。

执行脚本 `scripts/diagnose-library-registration-cost.mjs`；它绑定历史源 HEAD，
在其他 HEAD 上默认拒绝运行。复现需在对应历史 checkout 中放入已绑定的诊断脚本，
使用新输出目录；本记录不授权重试。分析/计数脚本为
`scripts/inspect-library-registration-cost.mjs`。

原始 plan、source/bundle bindings、变体源码、bundle、逐次样本、阶段结果、
计数与分析在 `archive/evals/library-registration-cost-v1/evidence.tar.gz`。
独立结果与完整性 locator 见该目录的 `result.json`、`receipt.json`、`artifact-index.json`。

## 下一步建议（未实施）

先审查校验位置与依赖，不回到 A/B/C 选择，也不因成本删除 identity/lifecycle 保护。
具体检查创建前、取得资源后、发布前这几处之间，哪些操作可能执行用户 getter、
dispatcher register 或依赖迭代器；只有能证明中间不会改变被检查事实的重复检查
才可能合并。必须保留所有用户可控读取之后的最终发布校验和失败资源收尾。

若形成具体优化，再用名字抢占、依赖重入、部分 slot/handle 失败和正常构造的行为
回归及真实 runtime mutation 检查其授权/释放路径。不要把本轮删保护变体带入生产。
本轮没有选择或实现新方案，也没有证明可以通过换一种校验排列完全回收成本。

正式性能资格仍是历史 P2 summary `1.211671 > 1.20` 拒绝、80 行未运行。
稳态性能、内存和用户学习成本未由本轮证明。
