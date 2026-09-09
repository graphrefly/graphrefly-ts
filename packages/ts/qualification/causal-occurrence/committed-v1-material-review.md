# committed-v1：冷构造材料复用实施与测量

Owner：graphrefly-ts；work：CAUSAL-COMMITTED-VIEW-TS；依据 D161/D163。用户在 `03e008cc` 提交的六局部字符串候选后回复「好的，继续」，本轮实施该候选、完成有限直接比较与一次原完整性能门槛。此前「记得 commit」继续适用。这是现有 work 的优化及 attempt/evidence，不是新架构决定、CSP-11 实验或下游 dispatch。

**本轮结果：保留优化，原性能门槛通过；整体资格仍未完成。** 当前默认套件中原有两项 D159 离线源码绑定失败保留，尚未刷新当前资格常量或派生 artifacts。生产差异只在 `packages/ts/src/solutions/causal-occurrence/construction.ts`。

## 改了什么

`causalOccurrenceBundle → buildCausalComposition → buildCausalNodes → readIncoming → assertCausalOccurrenceTopology → causalOccurrenceRequiredEdges` 的路径不变。helper 将 arrivals、authority、release-candidates、release-events、release-port、released 六个名称保存在一次调用内的局部字符串中，供内部边材料复用。

名称模板求值从 44 次降到 22 次；这不是 V8 实际字符串分配数量或 bytes 声明。仍新建每次调用的 22 个内部边对象与冻结返回数组，保留八遍 source 扫描、source 对象身份、getter/错误行为及缺边检查。适用接口声明的 primitive string 名称，不扩展到越界传入对象的隐式转换行为。

没有全局缓存、持久 Node 缓存、新配置、公共 API、DATA 路径、wave 或 C 资源语义修改。名称、实际依赖、唯一 owner、transfer-before-activation、原输出投影、未结算 obligation 及退订行为不变。

## 先对改动前源码做有限比较

直接基线为 `03e008ccb6adaf7844b75b0df6309f11c1094330`。两臂分别编译真实的改动前源码与当前候选，具有相同物理资源和生命周期；移除了旧 standalone harness 仅为更早版本补节点的分支。没有拿该直接基线冒充冻结 ts-v4。

测量前在 `scope.json` 固定四个新进程；每个三批，每批 100 对预热和 300 对正式空输入构造。组内顺序随进程、批次和 pair 交替，共 3,600 对正式样本。全部原始数组保留，不追加进程或挑选最好结果。继续条件预先写为：四进程 p95 比值均小于 1、中位数比值均不大于 1，才进入一次原完整 gate；否则撤回这项仅以性能为目的的改动。

| 进程 | p95 比值 | 中位数比值 | 中位数差 µs |
|---|---:|---:|---:|
| 0 | 0.907608 | 0.967435 | -2.958 |
| 1 | 0.958296 | 0.975512 | -2.209 |
| 2 | 0.999061 | 0.973547 | -2.416 |
| 3 | 0.962148 | 0.985000 | -1.375 |

达到预写的方向性继续条件。第 2 个进程的 p95 几乎持平，故不能声称已证明稳定的百分比提升；这些不是置信区间，也不是额外产品门槛。每个进程还对正常及启动错误场景比较八个端口、拓扑与 phase。QA 发现原 harness 只断言 phase 相同，随后用保留结果显式核对全部八个场景分别为 started/faulted，通过；没有为这一断言重跑性能样本。

## 一次原始完整性能门槛

随后运行未修改的 `scripts/compare-causal-construction.mjs`，不启用 attribution。使用原冻结 ts-v4 输入/收据、相同资源对照、原四行顺序、三批采样、原 p95 定义、≤1.20 构造与 ≤1.10 稳态预算。原脚本包含 `--expose-gc` 但测量未插入强制 GC。未增加探针、删除样本、改 timeout 或并行运行其他测试/构建。

UTC 2026-09-09 01:48:54–02:03:43（本地 2026-09-08）运行完成，888.979 秒，exit 0；source 与 harness 摘要未变。保留实际编译 bundle、运行日志、所有数组及 source hashes。独立脚本从原始数组重新计算各行 p95/中位数，并显式验证原数值门槛，不能仅以 exit 0 代替预算检查。

| effects / evidence / 背景节点 | 构造比值 | 稳态比值 | 原门槛 |
|---|---:|---:|---|
| 1 / 0 / 0 | 1.109535 | 1.022594 | 通过 |
| 16 / 128 / 0 | 1.117013 | 1.002214 | 通过 |
| 64 / 512 / 0 | 1.180854 | 0.990744 | 通过 |
| 1 / 0 / 1000 | 0.794525 | 1.004669 | 通过 |

六条原输出/拓扑对照全部匹配；7,200 个构造样本、108 个稳态 lifecycle 的分数数组保留。普通无 C 图的额外描述性中位数比值为 1.072508，动态创建/释放五组各 200 次完成；它们不被解释为本次 helper 改动引入或消除的 DATA 成本。

这是源码修改后预先安排的一次原门槛通过，不覆盖、撤销或改写此前 committed-v1、diagnosis-v1、attribution-v1 的失败/诊断证据。不同进程的差异不能全部归功于六个局部字符串，原 1.839833 稳态异常的历史原因仍未确定。

## 行为、错误路径与检查

- 现有 helper 168 个差分场景通过，覆盖字符串名称、重复/稀疏边、变化/抛错 getter、对象身份和缺边错误。
- 四个相关测试文件共 106 项通过：D791 43、D161 27、D162 18、D163 18。原始测试命令中的额外 `--` 被 Vitest 解析为完整默认套件，因此实际执行为 **2255 pass / 2 fail / 4 原有 skips**。保留原命令和日志，不将该失败命令标成通过，也未重复全套。
- 两项失败仍是 D159 当前源码与旧资格不匹配：当前 manifest `sha256:ace2a62ff60b37855cf8a50ef22990f5692086e823a34f148f4c57ee90b6af35`，旧绑定 `sha256:327820affe91a1ddd13e4968b9f2ee9f1c74b4e3b2a9a67cd25804f3f4a799ae`；派生 artifact 生成因此拒绝。没有只改 hash 来制造通过。
- 改动后的真实 bundle 保留自定义 describe 的错误路径：第二次读取 edges 抛错时，构造拒绝并回滚至八个外部输入节点。shadow runtime mutation 删除 source rescan 后错误地接受并保留 32 个节点，负对照检出；两个实验最终都清理至零节点。30 个普通缺边控制仍拒绝。
- 两路静态 QA 完成，唯一额外发现为预期 phase 断言不足，已由保留原始结果的显式复核闭合。源码改动无剩余发现。
- lint/typecheck、build/export 和独立数组/绑定核验通过。没有新增镜像实现的测试，也没有重跑完整 soak 或旧全 mutation 集合；本批没有宣称完成整个源码离线资格刷新。

## 下一边界

保留这项已测量的局部优化，不再叠加构造微调。下一批应对稳定源码按既有流程完成适用离线资格、冻结新 no-network 证据并刷新三个当前绑定及派生 artifacts，保留全部历史材料。它不需要新 D#，也不重开已消费的 D159 development-6/7、provider qualification 或 live grant。

本批未进入完整 preset、按等级隐藏入口、consumer/inbox 实施或任何 provider/live/spend 工作。性能检查通过不证明这些能力完成。
