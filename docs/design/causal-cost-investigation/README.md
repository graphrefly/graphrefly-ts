# Causal consumer 成本诊断总表

唯一 owner：`graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。这是同一 work 的调查计划和证据索引，不是新架构决策。用户要求完整诊断、避免重复和遗漏，并明确暂不要求 library 提供新的 profiler 能力。持续维护本目录；原始收据不改写。

## 目标与边界

解释 P2 consumer 的分配、保留和运行成本；找出必要工作与可消除的重复工作；提出可审阅的最小优化，防止 library 臃肿。普通用户不增加新概念，框架作者的组合方式不变。profile 产品化/公共 API、wave protocol、provider/live/spend、自动性能重试均不在本轮范围。

当前用户授权覆盖诊断推进，不必每读一个文件、每完成一项分析重新确认。具体 library 改动在证明义务和 diff 范围明确后集中审阅；改变语义/持久缓存/生命周期/预算须单独决策，不能借优化带入。两次 capture 授权均已消耗。

## 已完成证据：不重复运行

| 问题 | 证据 | 结论与局限 |
|---|---|---|
| B/C 是否只有指定算法不同 | build-v2 / ed90f747 | 每侧 62 输入；独立重建一致；仅 `_releaseNodes` 内容不同 |
| 真实 consumer 是否能跑通 | preflight-v1 / 0bb8149d | 33 实例通过；不是内存压力或完整恢复资格 |
| 性能比较是否完成 | comparison-v2 / 83dc4608 | 首个 B/B-copy RSS 超限，329 原始样本；C 未采样，无比例结论 |
| 存活 JS 堆是否随循环明显增长 | memory-v1 / 1b0ecd26 | 400 次中 GC 后约 9.35–9.55 MiB；不能排除慢泄漏/native retention；checkpoint 不是原父进程 guard |
| 分配发生在哪个阶段 | allocation-v1 / adebc19d | 100 次 B：输入 59.98%、重复输入 35.41%、构造 2.61%；强制 GC + 采样，不能替代时间/RSS 结果 |
| 主要序列化调用来自谁 | 本目录 caller-attribution.json | dataKey 子树最近直接调用者：recomputeCurrentness 39.699%、recomputeDomain 8.302%；分区 selfSize 总和守恒，无重复累计 |

上表的目录分别位于相邻 `causal-release-comparison-build-v2`、`causal-release-preflight-v1`、`causal-release-cost-comparison-v2`、`causal-release-memory-v1`、`causal-release-allocation-v1`。所有比例分母是同一 retained profile 的累计分配估计，不是同时存活字节。JIT/采样栈可能缺失或内联帧；“最近调用者”不是源码调用次数。总分配约 2.24 GB/100 次不等于 RSS 2.24 GB。

## 调查顺序、完成标准和停止条件

| 顺序 / 状态 | 问题与最小动作 | 完成标准 / 后续 |
|---|---|---|
| 1 已完成 | 核对 artifact、consumer、B/C 身份、采样语义 | 沿用上表；只有输入/source/runtime 变化才重新限定相关检查 |
| 2 已完成到函数调用链 | 回放现有 profile，按阶段和 dataKey 最近调用者分区 | `analyze-profile.py` 只读分析，绑定 profile SHA，重算总量一致 |
| 3 下一项 | 逐个证明 currentness/quiescence 的前后比较在比较什么 | 覆盖输出所有字段、occurrence payload 是否纳入、retained value 是否 immutable、cloneState 是否保持引用；列明必须重算和可复用的边界 |
| 4 待执行，接着 3 | 运行有限的私有计数诊断，核实同一输入/重复输入内的重复规范化 | 一次最多 12 个 candidate 生命周期，覆盖首次输入、同对象重复、等值新对象、合法变化；记录 lane、transition 次数、比较次数、输入规模和输出；不把对象相同视为语义相同。30 秒、无重试，异常保留；不扩大为持续采样 |
| 5 待执行，依据 3–4 | 比较最小优化选择：避免全 payload 重复比较、调用内复用、serializer 分配简化 | 推荐至多一个首批范围；每个选择给出相等性证明、所有权/生命周期、内存上界、负对照和可能回归。不能直接把 `dataKey` 换成 digest 相等，也不默认加 WeakMap |
| 6 具体改动批准后 | 实现首个最小优化、语义/安全验证 | 见下方测试矩阵；失败先修此范围，不同时展开所有热点 |
| 7 6 通过后，独立授权测量 | 比较分配、post-GC 存活堆、自然 GC RSS 和未插桩耗时 | 先提出一个完整实验清单及预算；使用匹配 before/after、plain/control，保留每个结果。不得把诊断 GC 插入正式 worker，不能重复采样直到通过 |
| 8 待完成 | 汇总并决定结束/下一热点 | 报告改善、回归、未知项和限制；只有残余证据显示另一热点影响目标，才启动下一项；不是把整个 library 逐个重写 |

步骤 3–5 是下一段连续诊断工作；常规只读、计数分析和文档推进无需用户逐项说“继续”。到具体 library 优化选择/改动边界时提交一份完整审阅结果。当前文档未宣称步骤 3–8 已完成。

## 首要假设与反证

H1：currentness 的输出相等性检查重复遍历完整 occurrence payload，造成显著分配。源码依据：identity.ts `recomputeCurrentness` 内 `dataKey(prior) !== dataKey(value)`；`value.occurrence` 来自 retained occurrence。transition.ts 每次输入处理后 recomputeDomain，并在有限推进循环中再次检查。profile 提供热点支持，但尚无“同一对象重复几次”的计数证明。

H2：quiescence 比较与 exact admission/ref 检查也有重复成本，但不能与 H1 重复计算。先以现有 profile 的互斥分类排序，再做必要计数。

H3：publication 的被动 JSON/材料规范化是次级候选。输入信任边界检查可能必要；若只是检查了不同外部对象，不能称为冗余。不得为提速调用 getter、跳过 mutable 对象验证或忽略同 id 内容冲突。

反证包括：比较对象的可变字段确实不同、复用会漏掉恶意输入、对象被跨 transition 修改、当前分配主要来自不可消除的验证、较小分配导致更高 retained memory/更慢 small-case。出现这些结果就缩小或否定方案，不再反复同样测试。

## 验证矩阵（依实际修改选择范围）

- 正例：现有独立 deterministic oracle + plain/reference；首次输入、相同重复、等值新对象、合法新 revision、fan-out/fan-in、清理后 graph membership。
- 身份/序列：相同 id/revision 但 payload/sourceRefs/digest 改变；错 admission、过期/缺失 revision、水位、retention gap、superseded currentness、replay conflict。
- lifecycle/evidence：展示退订不结算 active obligation；错误 outcome 不结算；精确终态才推进；retained evidence 与 lifecycle 独立；在结束前重新观察仍可用。
- JSON 边界：getter/setter 不被调用、symbol/non-enumerable/sparse array/cycle/non-plain object/数字边界按既定 codec 规则拒绝或接受；共享子对象不能误判循环；mutable/深冻结输入分别检查。
- 真实 runtime mutations：删除关键字段比较、只比较引用/只比较 digest、跳过 replay/admission 验证、提前清掉 obligation，必须被独立预期抓到。不要只测新 helper 本身。
- 若只改 causal 内部比较，先专项回归与对应 mutations；若改共享 codec，扩大到 storage/checkpoint/bridge 等实际 callers 的 codec 兼容测试。实施批最终按用户要求完成所有离线测试及 lint/build/export/artifact/workspace gates；记录既有失败，不能伪称全绿。
- 成本：tiny input/empty/single node、重复/新对象、合法变化与拒绝路径；禁止仅报改善最大场景。强制 GC 数据、自然 GC RSS、分配估计、耗时分别报告。

## 防重复和遗漏规则

每个实验执行前记录“要区分的假设、输入与源码 hash、可观测量、上限”；执行后只追加精确证据和结论。不得重用 consumed capture 输出目录，失败样本不得丢弃。相同源码/输入/问题已有充分证据时只重放分析，不创建新 consumer run。结果无法区分假设时先改变诊断设计，不直接多跑取平均。

每轮结束只维护本总表的已完成/下一项及原 work 的 evidence ref。不要因一个脚本修补、一次失败或一次继续再建 work/D#。保留用户已有未提交文件。产品 profiler 是否进 library 暂不决策；内部诊断充分性不以新增产品功能为前提。
