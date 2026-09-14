# Focused host：admission 配额与完整请求路径

2026-09-13；基线 ce4201bc。TS-local 设计建议与离线行为证据；不新增架构锁。
沿用已同意的 microtask completion 方向。本轮没有生产修改、真实 I/O 或公共 API。

## 已验证的关键区别

真实 spending preset 的 publicationPolicy 对同批两个独立 domain 的 exact 请求，
在同一份 availableSlots=1 的 readiness 下产生两个 admitted、无 outcome 的 authority 记录。
off/summary 两臂均验证；重复该 readiness 不增加 effect，也不结算。
测试见 packages/ts/src/__tests__/causal-admission-capacity-feasibility.test.ts。
这证明 readiness 不是 reservation，不能把 admitted 数当成已经独占写槽的请求数。
测试没有执行 host，不能证明两次写入、host 竞态或整条路径已经合格。

## 推荐：用现有材料边界覆盖记录容量

不新建动态 permit/ack/回收 registry。先完成以下有限证明，再接真实 host：

- materialStore 在 effectProposals 之前提交保留记录；按完整 occurrenceKey 最多 64 项。
  同 key 不同 canonical material 报 conflict，不替换已有材料；相同材料可重复投影。
- host 仅接受本 composition 的真实 committed authority、exact admission 与 retained material
  三者一致的请求；完整关联包括 occurrence、effectId、requestRef、proposalDigest、admissionRef、
  source/runtime/destination/composition/host binding。不得仅按 evaluationRef 或摘要显示名称接纳。
- 每份 retained material 至多对应一条可接纳 admission；publicationPolicy 的 issued 也按
  occurrenceKey 终身保留第一份决策。旧 admission/冲突身份不能成为新的 host 请求。
- host epoch 与 composition 一对一独占，生命周期中不重建/重置任一侧去复用另一侧的预算。
  没有第二个 producer、任意调用入口或多 composition 共享此资源。

因此目标集合关系是：host distinct records ⊆ exact admitted materials ⊆ retained materials，
且 |retained materials| ≤ 64。这是逐请求 admission 之前已经存在的容量覆盖，
不依赖 readiness 减计数或 host 通知及时到达，也不要求预先分配 64 个空对象。
被 policy 拒绝或正常不发布的 evaluation 不占 host 记录；保守保留材料不回收容量。

这是条件性源码推导，尚非 host 集成资格：真实 host 的 exact membership、唯一入口与独占构造
必须被负例验证。不能用当前 private factory 尚未存在的所有权保证冒充现有能力。
现有 s.issued 的 64 项包含正常/拒绝决策；maxEffects 是 authority 资源上限；二者都不是写槽。

## 两个请求怎样走完整路径

1. evaluation/current/verification/local/host facts 经声明的输入边进入 business 与 materialStore。
   材料先保留，再发 proposal；publicationPolicy 依据 exact verifier、grant/currentness 发 admission。
2. authority 的 transition 在同一 context 有限推进 identity/lifecycle/evidence，一次提交，
   committedEffects 与 retained material 合成 exact publication。不能从候选 admission 直接执行。
3. graph-visible final guard 显式依赖 committed publication、current/local/clock/stop 和 host facts；
   缺失或失效的依赖不得用旧缓存通过。host 调用只发生在受 dispatcher 管理的边界节点。
4. host 同步前缀先核实 exact 请求属于上述有限集合，查唯一记录集合做 replay/conflict 检查；
   对新的合法请求先保留结果记录位置，再检查真实单在途写槽。伪造请求只出有界诊断，
   不能给合法 effect 制造 cancelled。合法但过期/撤销/忙的请求保留 exact no-submit 收据。
5. A 取得 slot 后就在同一同步段调用已准备资源；不 await、不排请求队列。若此时 A 仍在途，
   同批 B 即使也 admitted，也只能得到 cancelled + busy/no-submit，不发生第二次写调用。
   不承诺 A 的业务优先级；首批依实际边界到达顺序，测试断言至多一次而非固定赢家。
6. 真正完成/确定未提交/明确未知的事实先写入 host 唯一记录集合，再通过既有提案的唯一
   microtask 输出完整 completion snapshot。source DATA → inboxFacts → effectOutcomes → authority。
   authority 独立验证 exact refs 后才能结算；错误、旧 epoch、伪造 outcome 不结算。
7. 重复 exact 请求不重新执行；冲突不覆盖已记录事实。UI 退订不清理 host/authority 记录。
   新 readiness 不能重新执行已 consumed/cancelled 的同一请求。正常关闭仍需要 run owner
   核实无在途/通知故障/未结义务，不能把 source.down 返回当作 ack。

第 5 步沿用 D160 已 admitted 后最终边界阻止则 exact cancelled 的语义，明确应用到 busy。
若产品希望 B 等待后自动写入，将需要新的等待/公平/取消/重新核权契约，不混入首批。
同步 write throw 若不能证明未提交，必须 unknown；不能按 busy/no-submit 处理。

## 拟验收矩阵

| 场景 | 必须观测的证据 | 目前状态 |
|---|---|---|
| 同 batch 两请求、同 ready=1 | 两 admitted；假 host 至多一个在途写，另一 exact no-submit；各自结算 | 前半真实 consumer 已通过；host 未接 |
| 64 retained / 第 65 个 | 第 65 个没有可执行 admission；64 个请求包括拒绝都有记录位置 | 源码有限上界；边界集成待测 |
| replay / 冲突 material / 假 admission / 旧 epoch | 无新增执行和记录身份；合法义务不被伪造结果清掉 | 必须接 actual authority 与 host 复核 |
| stop/revoke/readiness 失效或依赖丢失 | final guard 阻止；精确已接纳请求保留 no-submit 或 unresolved fault | 待集成 |
| 微任务交付失败 / UI 全退订 | 保留 host 事实和未结义务；fault 阻断新派发 | 机制探针已测；exact 集成待测 |
| 正常不发布 / verifier fail | 没有 host 调用；不得耗用一次 write | 待集成 |

必要 runtime mutations：绕过 final guard；跳过 host slot 检查；允许重放重写；按错误 admissionRef
结算；满额时继续接纳。分别由独立调用日志、同时在途计数、exact authority 未结记录判死，
不能只检查 candidate 自报 passed。离线 fake I/O 不冒充真实文件执行证据。

## 成本与分级披露

新增成本只在私有执行边界：每个新请求一次 exact membership/record 查找与 slot 检查，
最多 64 份已有提案规定的 host 记录。材料/issued 不增加另一份 quota 副本。
具体复杂度取决于 exact membership 实现；不预先声称 O(1)，不为查找擅自加跨波缓存。
完整通知最多 64 条、每 receipt ≤4KiB 是 payload 上界，另有 refs、容器和编码开销；
不能据此宣称 RSS ≤256KiB。还应测 frame bytes、构造/执行时间、通知干扰。
普通用户仍消费 view，框架作者消费 exact capabilities，维护者能检查声明边界与证据。
没有新增必须手动理解/传递的 permit、flush 或 retry。它不会裁掉底层 lifecycle/evidence。

## Q5–Q9 审查

Q5：consumer-private 材料容量与 focused host 接线，不属于通用 kernel quota API。
现有 materialStore 负责材料保留、authority 负责义务、host 负责真实执行事实，各自单 owner。

Q6：隐藏不变量是独占 epoch、材料不可替换、host exact membership 和无旁路入口。
上界失效应在构造/集成资格中阻止启用，不能在已承担义务后无记录空间地失败。
不覆盖共享 host、无限流、跨 crash、自动排队或公平性。

Q7：声明边为 inputs → material/policy → authority → publication → final guard/host sink；
host source → inboxFacts → outcome lane → authority。外部关联以 exact 证据展示，不伪造静态环。
可组合 Node 输入保持不变；不增加 UI 控制生命周期的入口。

Q8：A 复用 lifetime 材料上界，少状态、旧 readiness 不影响容量证明；代价为固定独占 64。
B 动态 reservation 事实，支持共享/回收，但需额外资源握手、失败释放与公平性协议。
A 的源码先例是当前 materialStore 与 issued；B 本轮没有资格化先例，不以通用队列类比当证明。

Q9：推荐 A。分层/单 authority/同步最终检查：覆盖；容量：条件性覆盖，尚需 actual host
负例证明；性能：仅有上界，无新测量；动态扩展：明确不覆盖。
下一实施单元应是实际 preset + 私有 no-I/O host 的 exact 集成和上述 mutations，先完成
容量与单写槽证据，再评估真实资源准备。新架构锁仍由 TS owner 审阅后入账；本稿不是锁。
