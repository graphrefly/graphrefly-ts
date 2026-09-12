# 首批优化审阅：currentness 比较避免重复遍历已验证 occurrence

状态：具体设计建议，未实现，待用户审阅。唯一 owner 仍为 `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。本批不新增 profiler、公有 API、全局表或 wave 行为，不改 lifecycle/evidence 的结算。

## 实际计数与证据质量

原计划上限 12 实例。第一次诊断进程执行了 6 个现有三方 preflight 和 5 个 case 实例后失败：错误假设 local stop 必须改变 publication snapshot。已获准、尚无 outcome 的 effect 保留，快照未改变；这不是 library 失败。首次脚本没有及时保存前四个 case 的计数，因此不能引用这些丢失的计数。

第二个诊断进程只用剩余 1 个生命周期（总计 12），在同一实例中依次执行首次输入、同对象重复、等值 clone 重复、local stop。每个阶段立即写 partial-counts.jsonl。重复和 stop 后均与先前归档的独立三方 expected snapshot 一致；occurrence 数为 1，cleanup 后 membership 为空。第二次是诊断脚本修正后的剩余实例，不是单进程全绿、不声称零诊断修正；没有性能重试。

插桩逐点审计又发现 raw 标签错位：`currentness` 标在 retainPending，`quiescence` 标在 recomputeCurrentness；真正 recomputeDomain 未插桩。因此只按 instrumentation.patch 的实际位置解释：首次 arrivals 后 currentness 比较 11 次、10 次相等、字符串总长 196981；每个 duplicate action 有 5 次 transition、10 次比较且全部相等、字符串总长 179060；local stop 有 1 次 transition、2 次相等比较、字符串总长 35812。单位是 JS 字符串 code units，不是分配 bytes。same-occurrence 指针相同计数未获得，不能把默认零当反证或成功。正确解读在 corrected-counts.json，原始文件不改写。

这足以支持先处理 currentness 全记录重复序列化；quiescence 动态计数未完成，本次不再加实验或把它混入首批。累计分配占比仍引用既有 profile 的 39.699%，不能承诺等量性能收益。

## 字段与所有权证明

| 项目 | 当前事实 | 优化必须保留 |
|---|---|---|
| occurrence | contracts.ts 要求 ref；identity.ts:415–456 实际赋完整 retained CausalOccurrence，含 value payload | 不裁剪对外值、不用 digest 替代 payload 语义 |
| 被保留 occurrence | transition.ts:237 调 canonicalSnapshot；identity.ts:127–135 先 dataKey、JSON.parse，再递归 freeze | 外部输入每次应有的被动 JSON / digest / replay 验证仍执行 |
| transition 克隆 | cloneState 复制 Map 容器，保留 entry.value 指针；已存在 revision 不直接替换 entry | 只在当前 retained canonical occurrence 与前后记录 occurrence 均为同一对象时考虑跳过该子树 |
| currentness record | 每次重建；kind、watermark、state、supersededBy、missingRevision、gapRef 都可能影响输出；外层不是递归冻结保证 | 所有字段、可选字段存在性、gap 内容都仍比较；不能只比 state |
| supersededBy | 可携带另一份完整 retained occurrence | 首批不优化它，仍走原有 metadata serialization |
| quiescence | 含 watermark、lifecycle、retainedEvidence、pending refs 和 effect ids；pending refs 可从多类已保留事实聚合 | 不纳入首批，不丢弃 pending/active obligation，不合并 lifecycle 与 evidence |

“两个对象只是 reference 相同”本身不是充分理由。所省的是一个在当前 authority 中已建立 canonical/passive/deep-frozen 保证的、两边完全相同的 occurrence 子树。诊断计数没有证明所有潜在调用均满足此条件；实现必须用局部 guard，无法证明就回退原比较。

## 推荐的最小形状（仅 identity.ts）

在 recomputeCurrentness 的前后相等性判断引入一个 private、无持久状态的比较路径。输入包括当前 retained occurrence；guard 要求前后外层为普通被动 data record，并且两边 own occurrence data property 都精确指向该已验证 retained occurrence。外层的 symbol、accessor、non-enumerable、异常 prototype 或 provenance 无法成立时，完整回退当前 `dataKey(prior) !== dataKey(value)`，不得绕过错误。

guard 成立后，构造两个仅供本次比较的浅层 metadata record：保留全部原有字段和值，只把已证明相同的 occurrence 属性在两侧换成同一个无载荷占位值，再调用原 dataKey 比较。不枚举并挑选“已知几个字段”，以免漏掉可选字段/扩展字段；descriptor 检查必须先于取值，不能触发 getter。保持原 `state.currentness.set`、输出对象和顺序、maybeRelease、authority 单次 commit 全部不变。

相等性依据：对两份 passive canonical JSON record，若同名 occurrence 子树字节必然相同，把它同时替换为同一 canonical 常量，不改变其余字段决定的整体相等关系。该证明只覆盖 guard 接受域。无法确认深层 immutable/provenance 的 restored/forged state 必须回退；实现审查若发现现有恢复路径无法提供此证明，应停止该 fast path，不新增标记表或放宽准入。优化不允许修改任意外部输入验证，也不将 `Object.isFrozen` 单独视为深冻结证明。

临时内存上界：两个外层 metadata object + 外层 descriptor 检查所需临时数据；生命周期只到一次比较返回，不随 history 累积。不新增 Map/WeakMap、不新增 public 参数、不改 payload、不跨 transition 缓存。第一份记录（prior undefined）仍直接输出。

## 可选方案比较

1. 推荐：局部受保护的相同 canonical occurrence 子树替换。范围最小，复用旧 codec；代价是小 record 的 descriptor/浅复制成本，必须测 tiny payload 与 fallback。
2. 全局/跨 transition 缓存序列化结果：可能省更多，但增加 ownership、失效和 retained memory 负担，不作为首批。
3. 重写 shared stableJsonString 为更少分配的 serializer：覆盖广，但牵涉 storage/checkpoint 等调用者及错误行为，本阶段不选。
4. 只比较 digest/ref/scalar：实现最短，但当前类型和实际 payload 范围不同，容易漏字段或吞掉非数据输入，不选。

## Q5–Q9

**Q5**：优化属于 causal identity 内部的派生状态比较，不属于 substrate、共享 codec 或 profiler 产品。无需新通用 primitive。

**Q6**：INVARIANT：被跳过子树是当前 authority 已 canonical 化且保持 immutable 的同一个 occurrence；其他字段完全保留；guard 外保持原行为。最大风险是恢复/状态注入路径或错误地把 shallow freeze 当深冻结，必须验证，不用隐式注册表弥补。

**Q7**：用户不增加概念，拓扑/数据/dispatch/单次提交不变；只缩短确定无变化的内部比较。不能改成旁路 imperative 更新或把展示退订当释放依据。

**Q8**：以上四案中选择局部比较，因为热点明确且修改边界小。原有图构造与 registry 设计不重开 A/B/C。

**Q9**：当前达到“值得实施验证的最小方案”，未达到“优化已证明有效”。动态收益、tiny case 成本、所有恢复入口以及 mutation 资格均留在实施验收；不保证通过原 RSS 或性能矩阵。

## 实施验收与集中批准范围

建议批准一个批次：private 比较 helper + 该调用点、对应语义/negative/runtime mutations、所有离线测试与 lint/build/export/artifact/workspace gates、review 和 commit。先验证同结果/同输出顺序，再测成本。若 guard 证明无法闭合，不擅自引入新缓存或改变协议，提交具体阻点。

必须用旧完整 dataKey 作为差分 oracle，覆盖每个 currentness 字段、字段缺失/添加、current/stale/superseded/unverifiable、same canonical object/equal distinct object、changed payload/sourceRefs、retention/missing gap、prototype/accessor/symbol/non-enumerable、不可信 prior/restore。副作用 getter 不得被 fast path 触发。真实 consumer 覆盖重复输入与合法变更；错误 admission/replay 与 active obligation 不受影响。mutations 删除单个 metadata 字段、放宽 occurrence guard、只比较 digest、提前结算义务必须被抓到。

成本验收另用集中设计的有界 before/after 方案，分别报告累计分配、存活堆、自然 GC RSS 和未插桩耗时；旧 capture grant 不复用。此审阅尚未授权 library 实现或新的性能采集。
