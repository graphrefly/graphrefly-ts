# committed-v1 失败定位（diagnosis-v1）

Owner：graphrefly-ts；work：CAUSAL-COMMITTED-VIEW-TS；依据 D160–D163。用户本次「好的，定位一下」授权有限离线诊断，此前「记得 commit」继续适用。本记录是 attempt/evidence，不是新架构决定、实现扩围或资格通过。生产候选保持 `f208028b366b13ddbc078d111fca372bdfcd7c86` 的字节，原 committed-v1 收据不改。

## 已定位与未定位

1. **D159 的两个测试及 artifact 拒绝已有确切原因。** 当前 source manifest 是 `59ec59c0…`，旧离线资格绑定 `327820af…`；原始换入基线实验恰好定位到五个生产文件、三个测试文件。当前只读重测得到相同摘要。它证明旧资格不覆盖当前源码，不表示旧 D159 实验或历史收据失效。已关闭的 development-6/7 不重开。
2. **构造超标属于冷构造范围，不能归因于 effects 快照复制。** 同一原始空输入构造在诊断探针中没有执行 transitionCausalAuthority，也没有执行 prepareCommittedEffectsView。新增 Node 必须经过 name manifest、资源取得、实际边验证和能力闭包检查；旧对照补的 dummy Node 只补物理资源，不具备这些保证。不能把原门槛约 20% 的累计差异全部归于 D163。
3. **1000 背景节点的 1.839833 倍原始异常仍未获得确定根因。** 四个新进程、两种行顺序、两个真实基线的有限诊断未稳定重现该差距；不能反推原样本是 GC、系统负载、JIT 或某个业务函数造成的。原测量没有逐输入时间戳或停顿证据，无法事后补出因果归属。

本次没有证据要求修改 C 的生命周期或所有权设计，也没有证明 committed-v1 已满足 F-PERF。构造尾延迟仍是待处理项。

## 原始失败为何不能只看一个比值

原 `matched-perf-final.json` 保留四行及全部样本。小场景每个 lifecycle 只有十次输入；nearest-rank p95 取第十个值，即单次最慢输入。稳态门槛再分别对两臂十五个最大值取中位数后相除。这是原定义，不能临时改成平均值。

1000 背景节点行：基线最大值中位数 193.292 µs，候选 355.625 µs；两臂同时存在约 2–9 ms 尖峰。此前 64-effects 行末三对样本，两臂一起从约 74 ms 升至约 125–138 ms。这证明原长进程末段存在时间分布变化，**不证明其原因**。构造 16/64 两行的 1.201307/1.200487 仍按原 ≤1.20 门槛失败。

## 有限追加诊断

`scripts/diagnose-causal-committed-performance.mjs` 固定以下布局后运行：每个配置独立进程；背景节点 0/1000 的两种顺序；ts-v4 冻结实际 runtime 和 `d9c868dc8c2cec395f96a5ae327f692cc37c6df7` 实际 runtime 两个基线；每行 80 对构造预热、100 对构造采样、20 对全轨迹预热、80 对全轨迹采样。原七个被观察 ports、十次输入、返回事件及清理仍使用原 runner；先断言事件和排序后的拓扑等价。

新增逐输入时钟、整个 run 的 CPU/heap、阶段时钟及 GC observer。每个测量 run 后让出事件循环以收集 GC 事件，**这会改变进程历史**；短诊断也没有运行原来昂贵的 16/64 大轨迹。因此本次不能作为原门槛重验收。没有强制 GC，没有移除耗时样本或从多轮中挑最好结果。

| 对照与行顺序 | 背景节点 | 构造 p95 比值 | 稳态比值 |
|---|---:|---:|---:|
| ts-v4，0→1000 | 0 | 1.163367 | 1.011556 |
| ts-v4，0→1000 | 1000 | 0.786902 | 1.002300 |
| d9，1000→0 | 1000 | 1.089075 | 0.998638 |
| d9，1000→0 | 0 | 0.992713 | 1.019374 |
| d9，0→1000 | 0 | 1.044287 | 0.976713 |
| d9，0→1000 | 1000 | 1.427845 | 1.027605 |
| ts-v4，1000→0 | 1000 | 0.825503 | 1.027786 |
| ts-v4，1000→0 | 0 | 1.326113 | 1.004450 |

1280 个测量 lifecycle、12,800 条输入均保留。大多数最慢输入是合并两个分支终态的 fan-in；其余尖峰分散在多个 lane。新 GC observer 确实收到了事件，但没有报告与测量中的输入/构造区间重叠的 GC 事件；不能用它解释旧进程的异常，也不能排除未被此探针捕获的其他停顿。

**构造结果并不稳定通过。** 新诊断仍有 1.427845、1.326113 等尾延迟比值，不能只引用稳态接近 1 的部分。下一步需要保留尾部样本的阶段归属，而非凭一次 p95 调优整个 C。

## 冷构造阶段探针

另在已绑定的 d9/current bundle 副本上给固定函数插入计数和计时；每行 100 对预热、100 对记录，背景 0/1000。没有修改仓库 production。插桩本身增加耗时，以下只是定位数据，嵌套时间不能相加。

无背景时，`buildCausalNodes` 的中位时间为 81.646→83.375 µs，其中 topology 验证 15.063→15.500 µs，capability 创建 4.854→4.708 µs；包含启动的 outer builder 为 110.542→111.958 µs。1000 背景时 outer builder 为 209.229→206.542 µs。没有稳定的大额新增 helper 热点；较小差异落在节点组装/检查阶段，不能从这种插桩精度推出精确分配成本。

所有 400 个测量 run 都断言只调用一次各自 outer builder，并且未调用 authority transition 或 view helper。此结论只针对原 benchmark 的空输入构造，**不适用于预存 DATA 的热输入构造**。

## D159 正确处理路径

`implementation-manifest.ts` 会绑定整个 `packages/ts/src/**/*.ts`（包括测试）、指定 eval 文件和 toolchain；因此增加一个测试也会使旧摘要不再匹配。当前三项绑定分别是 implementation manifest、qualification identity、qualification artifact identity。历史 cold-v1 已采用过冻结新源码、完成离线检查后刷新这三个当前绑定及五个派生 artifacts 的流程。

后续修复源码稳定并完成所需离线资格后，可沿现有流程生成新的 no-network 绑定及派生工件，保留旧收据。不能只替换 implementation hash、复用旧 passed 声明，也不能同步修改 operator configuration、provider qualification 或 consumed/live grant。`ROOT-EVAL-D159-CLOSEOUT` 仍 complete，`ROOT-EVAL-EFFICACY-METHODOLOGY-RESTART` 仍 deferred。这一步无需创设新的 D#，也不是 D159 新一轮实验。

本次未刷新任何常量或派生工件，未运行 provider/live/spend、凭证访问或真实 inbox。

## 推荐下一步与仍需审阅的选择

先给**现有门槛 runner**补上不改变原采样数、行顺序、cleanup、p95 定义或预算的逐输入时间戳及阶段归属，再审阅一次有限重验收的具体范围。若要用独立进程、让出事件循环、缩小 manifest 闭包或修改统计估计来作为新门槛，必须明确作为方法/设计变化审阅，不能直接把本次诊断脚本升级为 gate。

对 C 或 D163 的生产优化，应等到尾部样本定位出可重复的具体工作再给出小修复；目前不建议移除所有权检查、引入按 DATA 事务、删除共享视图或增加用户配置开关。完整 preset、public export 与真实 effect 路径继续保持原边界。

## 证据完整性

新 `committed-v1-diagnosis-receipt.json` 绑定本说明、汇总、runner 和无损证据 archive。archive 保留所有成功进程、逐输入样本、GC entries、source closure、bundle、冻结布局及以下夹具缺陷：

- 首轮 d9 cleanup 错用 current runtime 的 registrar，旧 startup lease 未释放而触发真实拒绝；补做对照改用各自 runtime 的 constructionOf。首个已成功 ts-v4 进程没有重跑取代。
- 构造 profile v1 把一个 stats 对象直接挂到结果，后续背景行预热污染最后一条已有记录；v2 在采样后复制统计对象，并断言计数。v1 不用于任何时间/次数结论，原字节保留。

诊断完成不改变原资格失败状态。代码正确性、所有离线测试及 mutations 的历史结果见原 committed-v1 收据；本次只检查新增诊断脚本、实际有限运行与证据/owner 一致性，不重复无关全量测试。
