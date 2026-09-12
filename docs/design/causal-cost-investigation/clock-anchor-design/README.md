# 替代时间锚定设计：短 hrtime 锚点 + 父进程 Mach 区间

2026-09-12 · 基线8c7ce678 · 唯一owner `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。
本轮仅设计与纯算术核对；没有实现采集器、运行时探针或consumer。推荐待审阅，不自动执行。

## 问题与推荐

上一方法首探针对齐宽0.903669ms，门槛0.1ms；start/stop请求区间分别9.408333ms和0.852375ms。
该尝试已结束，不重写原收据、不复用其claim。本方案避免依赖profiler启停延迟来确定时钟偏移。

推荐只在私有harness首尾各取一次短锚点：

```text
p0 = performance.now()
h  = process.hrtime.bigint()  // 以十进制字符串保存，禁止先转Number
p1 = performance.now()
```

两者都使用uv_hrtime，所以短锚点可约束固定的进程起点偏移。父进程继续在整个子进程生存期
前后各做A_before、C、A_after的Mach读数，约束continuous与absolute时钟之间的累计睡眠差。
**没有证据说明短锚点已经够快**；这里只有独立于profiler启停的推导与可验证方案。

## 固定版本证据

沿用[上一准备的源码索引](../aligned-clock-preparation/sources.json)、二进制及Darwin125/3时间基：

- node_perf.cc:309–312：performance.now是(uv_hrtime−固定进程起点)/1e6。
- node_process_methods.cc:707–711：HrtimeBigIntImpl直接读取uv_hrtime。
- [Node v24.18.0 per_thread.js:99–102](https://github.com/nodejs/node/blob/v24.18.0/lib/internal/process/per_thread.js#L99)：JS包装调用binding并返回BigUint64值。
- [node_process.h:87–90](https://github.com/nodejs/node/blob/v24.18.0/src/node_process.h#L87)：fast path也走同一实现，不能只核对slow path。
- 已冻结darwin.c:60及V8 time.cc:736–764分别使用continuous/absolute；后者先除1000整数截断再换算并加1µs。

新增源码原文与哈希见sources.json；node_process-inl.h仅记录include链。没有新增native addon，
没有私有Node binding调用、修改Node、网络inspector或library profiler。仍是版本源码对应，非可复现二进制构建证明。

## 区间推导（所有区间量单位ms）

令U(t)=floor(C(t)×numer/denom) /1e6，P(t)=U(t)+K（暂略浮点误差），K为固定进程起点偏移。
每个短锚点给出 J_k=[p0−h/1e6−f, p1−h/1e6+f]；J=J_first∩J_last。
这里f是performance.now数值换算误差上界，拟用4×max(ulp(p0),ulp(p1))，准备阶段须核对。
离线将JSON浮点解码后的精确二进制分数转为有理数，BigInt保持整数；全部区间运算用有理数，
最终再向外舍入显示。不先把大绝对时间戳转成double再相减。

父进程第0/1次读数给出整个子进程内S(t)=(C−A)×numer/denom/1e6的界：

```text
Slo = max(0, C0 − A0_after) × numer/denom/1e6
Shi =       (C1 − A1_before) × numer/denom/1e6
```

前提是Mach共享epoch、固定timebase、C−A非负且不减；父读数必须包围整个子进程。抢占会扩大
读数界，sleep会扩大S区间，二者都不能通过拟合消除。反序、溢出或无法证明前提则invalid。

V8采样戳q（µs）的量化误差E=q/1000−A×numer/denom/1e6满足：

```text
Elo = −999×numer/denom/1e6
Ehi = 0.001
```

这是保守闭区间：整数除法产生的误差下界严格大于Elo，上界不超过Ehi。libuv向下取整纳秒
再增加误差Uerr∈[−0.000001,0]。因此每个CPU样本的performance时间位于q/1000+I：

```text
I = [Jlo + Slo − Ehi − 0.000001,
     Jhi + Shi − Elo]
width(I) = width(J) + width(S) + (Ehi−Elo) + 0.000001
```

此处用S的**绝对差值区间**，不是只加睡眠变化量；不能漏掉系统此前累积的睡眠偏移。
125/3平台量化宽为0.042625ms。若短锚点J宽0.010ms，S宽取上轮父读数的0.001541667ms，
则算术宽约0.054168ms（另含f）。这是可行性示例，**不是实测新锚点，也不是资格**。

I非空且宽≤0.1ms才可接受。旧启停请求区间继续保存作一致性检查：映射后的profile起止
区间必须各与相应请求区间相交，但不能靠只选某端或改变方法来挽救不合格I。
每个真实进程都需自己的锚点与父读数。旧probe没有h，不能事后补造或按本方法重新验收。

## 放置、成本与验收边界

首锚点：观测设施安装后、consumer模块导入前。末锚点：最后清理/checkpoint后、停止profile前。
三种条件CONTROL/GC/GC_CPU都保留同样两次锚点；父Mach读数也保持一致。每进程新增两次hrtime
与四次performance读数、两条小记录；不逐节点、不逐block、更不逐构造校准。记录序列化在窗口外。
这只界定调用数为常数，不能据此宣称性能零代价；原三条件干扰对照仍必要，共有harness开销不被该对照单独隔离。

准备实现前需要审阅此替代。拟议资格仍最多3个独立CPU已知函数probe＋1个GCprobe，
每子进程≤10s、总≤40s、profile≤1s、RSS/目录≤256MiB，首失败即停；绝不复用旧授权claim。
这只是下一准备预算提案。实际12进程consumer capture仍未授权，原设计其余条件和上限不变。

独立verifier必须：

1. 核对源码/Node/平台/环境和父子包围关系，profile完整性及真实delta重建；拒绝溢出与错单位。
2. 用精确有理数独立构建J、S、E、I；保留两端原值，禁止midpoint、拟合和挑最快锚点。
3. 核对两次锚点顺序、J非空、profile起止一致性、≤0.1ms；错/缺锚点或机器身份不一致即停。
4. 已知函数probe中验证非零确定归属样本确实落在对应已知窗口、误归属/边界歧义分开统计；
   只有“函数出现在profile”不足以证明时间归属。窗口/样本不足就停止，不加长补采。
5. 合成负例覆盖睡眠增加、native读取被抢占、空J、ns/µs混用、截断BigInt、错误进程锚点、
   超限和一次claim不可复用。纯算术检查不能取代真实短锚点精度资格。

## Q5–Q9

**Q5 抽象与层次：** 放在现有私有harness与离线verifier。它是两种时钟的区间换算，不是graph能力，
不增加用户入口、registry或依赖。没有充分需求把平台特例泛化成library公共API。

**Q6 长期负担：** macOS/Node版本绑定、父子同机/同boot、精确整数、单调差值、源码对应均为不变量。
只维护私有脚本；改变平台就重新证明。尚未证明短锚点延迟和实际归属正确，准备阶段不能省略。

**Q7 简化与组合：** 两次锚点放在consumer序列外，Graph拓扑、dispatcher路径与graph-owned lifecycle
不变。相比新增native addon，复用Node已有接口；不尝试把诊断工具的命令式计时暴露给用户。

**Q8 备选（仅诊断方法，与先前registry C无关）：**

| 方法 | 形状/优点 | 代价/限制 |
|---|---|---|
| 短hrtime锚点＋父Mach（推荐） | P–H区间＋S区间；现有Node API、无构造内插桩 | 依赖平台证明、可能因调度/sleep失败，仍需新资格 |
| 子进程native时钟helper | 原位读取A/C/P；可缩窄跨进程差值界 | 新编译/加载/ABI与工具扰动；无证据说明有必要 |
| 保留粗粒度unknown | 不做CPU短窗口归属；使用已存整进程线索 | 无新增成本，但仍不能定位构造内热点 |

前例是现有父Mach记录与Node公开hrtime。Graph primitives/RxJS不承担时钟校准，不能以它们为强行复用依据。

**Q9 推荐短hrtime锚点方案供审阅**：避免已知profiler命令延迟、无library成本、误差可推导。

| 审查维度 | 覆盖 | 剩余问题 |
|---|---|---|
| 层次/可组合性/用户认知 | 是 | 不改用户代码与graph语义 |
| 平台与数值正确性 | 部分 | 源码推导成立；f边界和verifier实现待独立资格 |
| 构造热路径成本 | 是（结构） | 无新增窗口内调用；首尾开销未实测 |
| ≤0.1ms与正确样本归属 | 尚未 | 需一次有限资格；失败即unknown，不开新路线轮询 |
| 正式性能与精确CPU/等待划分 | 否，明确不做 | D169资格、精确耗时和OS调度仍无结论 |

下一步若同意：仅实现/资格这个私有替代，消费新准备claim；不启动consumer。
原currentness优化收益与未完成的cold资格/分级公开入口均保持原状态。
