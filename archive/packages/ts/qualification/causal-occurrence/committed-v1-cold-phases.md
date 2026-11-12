# committed-v1：冷构造阶段与安全优化边界

Owner：graphrefly-ts；work：CAUSAL-COMMITTED-VIEW-TS；依据 D161/D163。2026-09-08 用户询问测试是否属于冻结 CSP-11 eval，并要求「继续你的下一步」。本批只推进有限离线定位与可审阅候选 diff；未修改生产源码、C、公开 API、wave protocol、eval manifest、旧资格或任何 live/provider/spend 权限。原 work 仍未完成。

## 先澄清测试来源

| 材料 | 实际入口与用途 | 能证明什么 |
|---|---|---|
| CSP-11 / root eval | `packages/ts/evals/graph-native-rerun-avoidance/`；独立的 eval/qualification/manifest 体系 | 本次未执行该 eval，也未改其冻结材料 |
| C 原有性能资格 | `scripts/compare-causal-construction.mjs`；冻结 `ts-v4-construction-inputs.json` 和绑定的 ts-v4 收据；原设计构造 ≤1.20、稳态 ≤1.10 | 原 committed-v1 资格失败继续有效 |
| 上轮 1.221602 | 上述 C runner 的原布局，加可选 attribution 插桩；`committed-v1-attribution-receipt.json` | 插桩运行仍有冷构造超限，p95 决定样本没有 GC/deopt 可能重叠；不是 CSP-11 结果或新的资格 |
| 本轮阶段和负对照 | 新增 `scripts/diagnose-causal-cold-phases.mjs` 及证据包内的临时边界实验 | 定位实际调用、观察粗粒度成本、排除破坏语义的优化；属于 ad hoc 诊断 |

测量在本机 TS checkout `codex/causal-committed-view` 上执行。开始时 HEAD 为 `d1f0d0f1`，运行源码与该提交一致；脚本用 esbuild 编译真实源码到独立 bundle，由本地 Node 子进程执行。没有在 actor 工作树或冻结 CSP-11 campaign 中运行。此前完整 TS 离线回归会检查 D159 的绑定，所以曾报告旧源码绑定失效；那不意味着本次构造 ratio 来自该 eval。

## 实测缩小了哪些范围

诊断固定运行 plain、phases、counts 三个进程，各 200 次空输入预热、500 次正式构造；每个再跑一条 1-effect 完整轨迹和一次 1000 背景节点计数控制。复用原 C runner 的实际构造、七个旧输出端口、describe、输入和 cleanup。三个版本的 102 条输出事件及拓扑完全相等。单条七端口对照不代表完整 committed-effects/lifecycle 回归。

初测的审查发现源码摘要是在编译后读取，无法严密绑定编译读取瞬间。保留初测和原脚本后，修正为 esbuild loader 捕获实际交付的每份源码，核对全部 metafile 输入，再做编译后、跨进程及运行后复核。修正后按同样规模再运行一次；不是挑选更好的性能样本，初测不能升级为严格源码绑定证据。

修正后的 500 次构造，每次都只调用一次 names、options、prepare、build、readIncoming、topology checker、required-edge helper、seal、transfer 和 start。source helper 每次执行 **240 次 predicate：30 条实际边 × 8 个输入 lane**。1000 个无关背景节点下该计数仍为 240；这只限定被测函数和 predicate，不证明所有构造内部工作都与 graph 大小无关。

| 阶段 | 插桩 inclusive 中位数 µs | 解释 |
|---|---:|---|
| 整个 buildCausalComposition | 92.584 | 包含嵌套阶段，不可与下面逐项相加 |
| buildCausalNodes | 72.917 | 排除被插桩子调用后约 53.583；仍包含实际节点创建、闭包及其他未细分工作 |
| assertCausalOccurrenceTopology | 13.167 | 包含 required-edge helper |
| causalOccurrenceRequiredEdges | 3.917 | 包含固定边材料、八遍扫描与结果组装 |
| readIncoming | 5.667 | 取得、检查实际成员和边 |
| seal | 3.250 | 再验资源与 root plan |
| causalColdNodeNames | 0.500 | 一次调用，当前不优先优化 |

这些是带时钟、计数、嵌套探针的描述性耗时，不是分配 bytes，也不能换算成旧 p95 超限的成因或可回收时间。各阶段中位数不可相加。plain/phases/counts 的小型 p95 分别为 147.875/148.708/163.333 µs；进程顺序固定、历史不同，不能拿它们算优化比值，也没有重跑或替换原完整 gate。

## 被真实负对照否决的捷径

直觉上的改法是让 checker 调用 `causalOccurrenceRequiredEdges(name)`，省掉传入 description 的八遍扫描，因为 checker 已建立 incoming 索引。但 `Graph` 的实际 registrar 会在 `describe` 被替换时尊重自定义 inspector，不能假设传入的是稳定普通对象。

证据包的 `boundary-check.mjs` 编译原实现和只删这一个实参的 shadow 版本：

- 普通快照正常通过；逐一删掉 30 条必需边，两个版本都拒绝，错误结果一致。
- 在**真实 causalOccurrenceBundle 构造**中替换 `graph.describe`，让快照第二次读取 `edges` 时抛错：原实现读取两次并拒绝，回滚后剩 8 个外部输入节点；shadow 版本只读取一次并接受，留下 32 个节点。
- 两个实验最终均显式清理至 0 节点。shadow 版本只存在于实验 bundle，未应用到生产源码。

因此，本批不推荐全局删扫描，也不推荐把构造路径直接视为可信普通快照。原错误路径并不是无用开销。若将来需要 native snapshot 专用快速校验与自定义 inspector 回退，必须先审阅真实来源识别和 C 边界，不应藏在一个「性能修复」里。

## 可审阅的最小候选

`committed-v1-material-proposal.patch` **尚未应用**。它只把 `causalOccurrenceRequiredEdges` 内六个重复的节点名称存成每次调用的局部字符串：arrivals、authority、release-candidates、release-events、release-port、released。

静态材料从 44 次名称模板求值降到 22 次；仍创建 22 个新的内部边对象，返回新的冻结数组，保留八遍实际扫描及 source 对象身份。没有全局缓存、Node 缓存、用户选项、新入口、每 DATA 检查或依赖省略。模板求值次数不等于 V8 的实际字符串分配次数或内存节省。

此候选限定于接口声明的 primitive string 名称；不声称对越界传入对象的隐式字符串转换次数或顺序保持等价。

候选用现有 `compare-causal-required-edges.mjs` 的 168 个差分场景，在只替换 candidate 来源的独立副本上通过：包含不同名称、重复/稀疏边、getter 变化和异常、返回对象身份及缺边错误。原冻结 ts-v7 helper 与 D163 必需的新增 view 边对齐规则沿用原脚本。这是窄 helper 兼容性证据，不是全路径资格。

推荐先审阅这个小 diff，再在批准的生产候选上验证实际成本；它比新建 native 快速路径更容易保持现有语义。**尚无证据证明这 22 次求值足以解决 1.20 门槛，也不预承诺收益。** 若收益无法测出，就保留结果并停止扩大此类微调，不把扫描、owner 或错误检查当作可随意删除的成本。

本批产物是诊断证据和具体候选，生产源码与旧资格未动；完整 preset、consumer 实施、live/provider/spend 和 CSP-11 冻结 eval 均未进入。

## 审查与保留

两路静态 QA 完成。除阶段脚本编译摘要时序问题外，边界实验也修正了 shadow 源码与 loader 实际读取之间的绑定空隙；原脚本与两次结果均保留，修正后的负对照结果相同。复审无剩余发现。新增脚本 lint/typecheck 通过；生产代码不变，本批未重复完整 default suite/soak，也不声称原 D159 失败已经修复。完整原始 bundle、源码摘要、样本、负对照与候选差分由 cold-phases 收据绑定。
