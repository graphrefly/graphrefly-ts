# 有边界的诊断总结与候选排序

状态：诊断决策材料，未实现优化。唯一 owner 仍为 `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。用户确认先完成候选清单、优先级和取舍，不采用“发现一处立即修改再继续找”的循环。本批只分析已保留 evidence，不新增 consumer / profile / capture，不新增 D#。

## 本轮诊断覆盖范围

对象是冻结 B 上的 P2 summary consumer 生命周期及其重复输入，不是整个 library 的所有 workload。已有证据分别回答构建归因、真实语义、RSS 中止、GC 后存活堆、分配阶段、调用链和有限重复计数。现在将 allocation profile 的全部 selfSize 分为互斥类别，总量守恒；未解释到具体优化动作的部分明确保留。

以下比例是同一 100-cycle allocation profile 的累计分配估计，含已回收对象；不是 RSS、耗时、节省承诺或精确调用次数。归类顺序见 analyze.py，native frame 继承最近可见源码位置；JIT 内联/缺帧会改变归因，不能据此宣称所有成本精确定位。

## 候选清单

| 优先级 / 候选 | 归属、分配证据 | 已知必要工作与潜在重复 | 决策与实施门槛 |
|---|---|---|---|
| P1 currentness 前后比较 | library causal identity；39.699% | 状态变化必须检测；同一次 duplicate 有 10 次比较全相等，完整 occurrence payload 反复规范化 | 首批唯一推荐候选。证明 canonical occurrence provenance、恢复路径和所有 metadata 字段后，才允许局部快速比较；条件外原路径。已有 review 仍是建议而非批准 |
| P2 publication 材料处理 | TS repo 的真实 consumer，非通用 library core；15.558% | 被动 JSON、大小/字符串/属性检查和 digest 是真实边界责任；makeMaterialSnapshot 可见 canonicalize→parse→canonicalize，是否可复用文本需证明 | 暂缓。不能把该成本都归咎 library；要区分 producer-owned 规范化与接收新 frame 的独立验证，不能让 producer 的自报 digest 代替验证 |
| P2 sameRef 子树 | library identity；10.422%，包含可见 caller 下的 native/codec 分配 | revision domain/id/revision/digest/sourceRefs 精确匹配不可删除；反复 sourceRefs 规范化可疑 | 暂缓。没有与 currentness 同等级的逐比较有效计数；此函数用于多个 authority 安全路径，误放宽影响更大。只比较 digest/引用不接受 |
| P2 quiescence 比较 | library transition；8.302% | 生命周期、retained evidence、pending refs/effect ids 需要保持独立且完整 | 暂缓。此前计数标签错误已校正，不能拿 currentness 的 10 次冒充其计数；pending refs 来源多，不直接复用 currentness 的证明 |
| P3 其他 identity/canonicalization | library identity 及其 dataKey caller；8.918% | 外部 occurrence 验证、digest、snapshot、replay conflict 主要必要；存在 canonicalEntry 的重复编码候选 | 保留次级队列，不整体跳过 ingress 验证；必须说明是哪一份已验证 immutable 数据跨了哪个边界 |
| P3 其他 shared codec | library JSON codec；5.797%（不含已归入前面路径的 codec 成本） | stable/strict JSON 是 storage/checkpoint 等共用行为 | 不改 shared serializer。影响面广，需独立兼容证明，现有 caller 局部方案未评估完前收益/风险较差 |
| 未分解成首批动作 | runtime/consumer/harness 剩余；11.304% | 混合 node dispatch、业务输入、构造和工具分配 | 显式残余，不伪称已找到全部原因。按另一条阶段统计构造仅 2.61%、cleanup 1.52%、快照+验证约0.48%；这两个维度不可相加。没有重新设计 registry/C 的证据 |

此表用明确优先级互斥归类，所以 10.422% sameRef 与前次“最近 dataKey caller 是 sameRef 的 0.041%”不是同一口径：后者只统计可见 dataKey 帧直接 caller，前者包括 sameRef 子树中内联/没有 dataKey 帧的工作。保留两个原始结果，不能无说明地替换旧比例。

## 为什么首批仍是 currentness

不是“最先发现所以先改”，而是它同时满足：最大单项可归因分配、真实重复动作计数、源码能解释重复遍历、可限制在一个内部比较点、无需永久缓存/额外入口。材料/identity 的其他热点虽然显著，主要涉及更广的外部验证边界或尚缺计数，不能因为都是 serialization 就打成一个大改动批次。

但首批的约束仍未自动满足：comparision-proof/review.md 提出的 canonical occurrence provenance 必须覆盖恢复/输入通道；只凭深冻结的假设或 pointer equality 不够。此前实际 same-occurrence 指针计数没有成功采集，不能宣称动态证明齐全。如果实施前的源码/恢复审查不能闭合这一条件，当前 fast path 不具备进入实现的条件，应提交更小的替代方案或具体阻点，而不是偷偷新增 WeakMap 或放宽 guard。

建议首批仅包括该证明、一个局部比较点及其完整验证。拒绝把“约39.7%分配”直接当成可消除上界或预计提速。所有回退输入、小 payload、合法状态变化都可能有新增成本，必须报告。

## 哪些问题已回答，哪些仍未回答

已回答：本 workload 的主要分配集中在输入/重复输入；完整 occurrence 状态比较确实重复；GC 后 live JS heap 在400次有界诊断中相对稳定；首个 capture 在 B/B 控制阶段触发 RSS，不涉及 C 的采样。

尚未回答：原始无插桩进程的精确峰值构成/native retention；是否存在更慢/不同 workload 的泄漏；任何优化在自然 GC 下是否降低 RSS、是否提高速度；C/B 完整性能结论；分层隐藏与恢复能力。这些不能用新增 public profiler 或直接提升RSS上限代替证据。

本轮完整性的含义是：已形成有证据、含残余项的排序，足以审阅首批范围；不是全面根因证明、不是 library 全部工作负载资格，也不是全部候选已经证明可优化。

## 一个批次后的统一验证和结束规则

1. 先验证功能：旧完整比较差分 oracle、完整字段矩阵、input/identity/replay/admission/retention 负对照、真实 runtime mutations、全部离线测试和 required gates。旧已知失败单列；不可删掉义务或检查来过关。
2. 再统一评估成本：在一次具体预算审阅中同时安排分配、post-GC live heap、自然 GC RSS、无插桩耗时；before/after 同输入、同工具、同路径。GC 和 profiler 数据单列，不并入性能结果。原60-child grant不复用。
3. 评价用“保持语义且减少对应重复工作、匹配成本证据支持改善、未引入不可接受的其他成本”。若无改善或有回归，保留结果并撤回/修正此范围；不得放宽既定阈值将它标为成功。
4. 一批完成后先看目标和残余证据。解决当前目标就停止；只有证据表明另一个候选仍重要才安排下一轮。不能自动依次优化上表每一行，也不能为获得漂亮结果不断重复诊断。

本次优先级评估不授权 library 实现、额外内存运行、性能 capture 或预算变化。下一次集中审阅应针对首批具体范围，后续常规检查按已批准批次连续执行，避免每个脚本/文件单独请求继续。
