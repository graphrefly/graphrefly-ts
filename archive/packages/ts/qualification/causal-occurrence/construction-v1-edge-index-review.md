# C 边索引优化 A — ts-v6 审阅

2026-09-07。用户“好，继续”批准已审 A 方案的本地实现与离线资格。唯一 owner/work：graphrefly-ts:CAUSAL-CONSTRUCTION-OWNERSHIP-TS；持久语义继续由 D161/D160/D791 约束。

## 实际改动

[assertCausalOccurrenceTopology](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence.ts) 把 JSON 字符串元组集合改为按目标 ID 分组的 `Map<string, Set<string>>`，减少构造期编码与重复查找。索引遍历保留旧实现跳过稀疏空位的行为；每次调用重新建立索引；端点仍按精确字符串关联。`causalOccurrenceRequiredEdges`、完整 `ownerGraph.describe()`、冷构造校验顺序、移交与启动以及所有 authority/lifecycle 路径未改。

新增 12 个测试覆盖 5 组名称下逐条缺边与多缺边的首错顺序，重复/额外/自环/多个源边，4 类拼接碰撞，以及 cold 阶段实际移除 authority 入边后必须拒绝并清理本次节点。后者通过真实 Node 依赖修改，再由真实 describe 读取；没有从预期 manifest 伪造实际边。

## 证据与结果

- 专项 68/68；默认全量 2204 passed，4 个既有 opt-in skips；额外 root-eval soak 101/101（启动早于最终稀疏数组修正；该 checker 不在已记录的 soak 静态模块闭包内；不称为全仓库最终字节的 soak）；浏览器 3 项；lint、类型检查、build/export、artifact、workspace/dashboard gates 通过。
- 固定种子额外生成 10,000 个快照，与冻结 ts-v5 校验器比较接受结果和完整错误；3,343 accepted / 6,657 rejected，全部一致。此为实现表示差分，不替代独立业务 verifier。
- 原 73 个 causal 与 17 个 construction runtime mutants 全部 killed，ID 与原义务逐一核对未删减。业务对照主动隔离拓扑 guard，新增纯拓扑测试与原拓扑测试一样从该特殊对照排除；它们仍由常规专项及全量执行。
- 独立 plain resource oracle：12 个实际资源快照、2 个 model-only 负对照。它不调用生产 transition 来生成期望，也不把 model 负对照计作 runtime mutant。
- 冻结 ts-v4 的真实 runtime 与本批 runtime 比较，原七端口 6 组完整轨迹相同；双方实际资源匹配。不是 consumer 独立业务 verifier 或 plain-code 产品资格。
- 两位静态 reviewer 复核后无剩余 findings。初次新增测试及 runner 选择/参数错误作为开发尝试保留在任务附件，修复后重跑成功；未把工具错误当 mutation kill。

本轮仍有场景未满足原预算，C work 继续 partial。 构造预算为 p95 ratio ≤1.20；稳态预算为 ratio ≤1.10。时间单位 µs。构造阶段为空输入；规模与证据量用于随后运行的稳态轨迹。

| 稳态规模/证据/背景节点 | ts-v4 构造 p95 | ts-v6 构造 p95 | 构造 ratio | 稳态 ratio |
|---|---:|---:|---:|---:|
| 1/0/0 | 110.21 | 128.33 | 1.164 | 1.012 |
| 16/128/0 | 93.25 | 114.58 | 1.229 | 1.019 |
| 64/512/0 | 85.21 | 95.38 | 1.119 | 1.030 |
| 1/0/1000 | 366.67 | 450.29 | 1.228 | 0.959 |

- 1/0/0：三个构造批次 ratio 为 1.265 / 1.216 / 1.074。
- 16/128/0：三个构造批次 ratio 为 1.186 / 1.090 / 1.196。
- 64/512/0：三个构造批次 ratio 为 1.055 / 1.149 / 1.151。
- 1/0/1000：三个构造批次 ratio 为 1.308 / 1.307 / 1.110。

16/128 场景比原构造预算多约 2.683 µs；大图场景多约 10.292 µs。这是超出预算的差额，不是相对 baseline 的全部增量。点值与批次波动都保留，不能选最好的批次通过。

本轮为一个完整无插桩测量尝试，没有筛选最佳 run。沿用每场景 3 批、每批 100 warm pairs + 300 measured pairs；稳态按原配对布局执行。原始样本在 `ts-v6-construction-comparison.json`。阶段诊断均值不用于推算本表 p95；优化减少双方原有共有成本，不意味着 C 所有权记录免费。

## 用户可沿图核实的路径

八类输入 → lanes → authority 的同一 transition / 一次 state commit → 原输出与窄视图。构造校验发生在 seal/owner transfer/start 之前。如果真实 arrivals→authority 边丢失，校验拒绝，authority fn 未运行，本次冷节点被清理，8 个借用输入仍在。

若实例已经移交并开始运行，UI 退订和错误 outcome 仍不能结算未结 obligation；只有原 exact outcome 路径可结算。这条生命周期保证由既有行为与 runtime mutations 重跑提供证据，不能从边索引的代码 diff 单独推出。

维护者可用[本批源码差异](/Users/davidchenallio/.codex/visualizations/2026/09/06/01a077c7-55e6-7f11-9d4f-e7c51944afb4/C-edge-index-2026-09-07/v5-to-v6-source.patch)与 hash 确认谁改了哪些实现；框架作者可追踪原 exact handle 和依赖；窄视图消费者不用操作内部事务。普通用户的公共 core/patterns/solutions 分层和 preset 尚未完成，本轮没有新增入口。

## 保留的限制与下一步边界

完整 describe 仍扫描全图；A 没有实施 B 的局部 live-edge reader。大图 synthetic ID 分配与观察语义若需要改变，须先单独审查。当前性能 arm 只订阅原七端口，未建立窄投影激活后的专门成本资格；dynamic peak heap 是全进程诊断，不是 C 专属 retained bytes。

旧 ts-v5 partial 收据、报告和原审阅文档不改写，71 个绑定文件的原始字节保存在 `ts-v5-inputs.json`；新收据 `ts-v6-receipt.json` 单独绑定源码、runner、测试、报告和命令日志。没有 commit、public API/protocol 修改、provider/live/spend 或自动下游实施。

交接 trace：在冷校验前移除 arrivals→authority，与移交后 UI 退订分别会保留什么？前者清理本次未运行资源并保留借用输入；后者保留原实例与未结义务。用户复述尚未作为已验证 ownership 记录。
