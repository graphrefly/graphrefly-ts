# 触发来源审计：排除输入返回包装，提出明确的结果交付契约

2026-09-13，基线81c270c5。TS owner 下的有限离线审计；未改 library 或协议。
沿用 project-governance/decision-guard/design-review。本报告不新增 durable lock。

## 结论

仅包装六个输入的 source 调用、在返回后 flush host completion，不能覆盖现有合法组合。
已用真实 Graph/dispatcher/batch 得到反例；停止此路线，不再逐个包装新的入口。
这不是性能失败、C 失败或分级 view 失败，而是候选执行结果交付契约缺少完整入口控制。

## 覆盖表：触发源与真正的外层边界

| 触发 | 现有路径 | 输入包装能否充分覆盖 | 证据性质 |
|---|---|---|---|
| evaluations.pack | Node.down→业务选择/material | 仅独立外部调用可作局部候选，嵌套 batch 不行 | 输入定义/Node源码；batch反例执行 |
| evaluations.arrivals | Node.down→业务计算/admission | 同上 | 同上 |
| evaluations.current | Node.down→currentness/admission | 同上；也可能是其他节点的派生值 | 源码 |
| verification.receipts | Node DATA→evidence/admission | 无权假定必须经过私有 wrapper | 输入是同图 Node，非专属 source 类型 |
| localAuthority.facts | Node DATA→grant/stop/time | 同上；最终 batch/RESUME 可成为实际触发点 | 源码 |
| inbox.facts | 外部 completion/readiness source→authority/新工作 | 真实异步回调可由 host 拥有；被动同图输入仍不保证包装 | 源码与职责审计 |
| 启动 | startConstruction→owned root subscribe→activation；startup.down | 单包输入不覆盖；初始缓存可触发 fn，是否派发须显式门控 | construction-scope.ts:315–360 |
| 外层/嵌套 batch | callback 中 down返回→外层commit→boundary drain | **不覆盖，已执行确定反例** | 新测试 |
| RESUME | Node.up→释放最后pause lock→已有buffer/owed pull | 可独立于六个输入包装发生 | node.ts:485；pull.test.ts:50–64已有场景，本轮未重跑 |
| 重订阅 | subscribe→START/cache/activation | 可独立发生；已有roots使普通UI重连不必重跑业务，但不能据此豁免全部source activation | node.ts:417–465 |
| 允许的外部 rewire | replaceDeps→加入依赖订阅/缓存交付 | 输入上游的合法组合不受wrapper控制 | node.ts:498–507；node-rewire-runtime.ts |
| upNext/rewireNext drain | outermost exit/最终RESUME后 fresh wave | 不是任意 source 调用之后的通用 flush hook | batch/boundary.ts |

动态移除 preset 必需边不属于合法配置；这里没有把那种错误用法当反例。
外层 batch 本身足以推翻全覆盖主张，无须靠修改不允许的内部依赖。
完整表是源码覆盖审计，不声称每行都进行了新的动态 host 测试。

## 实际反例

测试：packages/ts/src/__tests__/causal-ingress-owner-feasibility.test.ts。
source→guard 使用真实 Graph；guard 只记录假 host 拒绝编号，没有生产authority或I/O。
候选wrapper执行 source.down 后搬运当时的 pending completion。

```text
独立调用 ingress(1)：guard:1 → wrapped-return → delivered=[1]
batch(() => ingress(2))：wrapped-return → guard:2
最后 delivered=[1]，pending=[2]
```

外层batch返回后没有新的wrapper flush，所以2未交付。若等下一次输入才送，停机/静默时
就可能永久保留未结义务；若要求用户额外 flush，又破坏普通调用和可组合性的目标。
本测试可重复验证交付缺口，不宣称它运行了生产 cancellation。
连同之前quiet环路探针4测试通过，test typecheck与局部Biome通过；无runtime源码变更。

## 现在应选择的具体边界

推荐下一版设计明确：**focused host 的 completion delivery 是异步边界，包括同步确定的
no-submit 拒绝；最终 guard、reservation 和实际提交仍在原同步段相邻完成。**
不要继续要求结果必须由任意输入调用者在外层返回时交付。

这需要对 D160 第7节的限制做有范围的澄清/修订：它明确禁止临时 Promise/timer 仅为
排顺序。本推荐不能自动视作豁免，也不能只把同样的 microtask 改名成“host source”。
必须先锁定可检验的 host completion contract，再实现，而非在guard里零散添加延迟。

拟议契约应满足：

1. 同步前缀产生不可变 exact receipt，先保留，再通知；是否提交的证据由真实 host 提供。
   只有接收方 delivery 延后，guard/current-at-dispatch/提交时刻不后移。
2. 所有 host completion 同一条明确 source 路径，reject/success/unknown 都有精确关联。
   不新增业务registry、公共flush、轮询、自动重试或隐藏任务链。
3. 一份host生命周期记录拥有consumed/结果/待交付状态；有限队列、预留容量、只安排必要的
   completion notification。延后期间UI退订不丢记录，不等同于生命周期结束。
4. callback到达时可以合法作为外部source DATA进入图；递交失败保留未确认状态，不将
   “已安排通知”当作authority已结算。错误/重复outcome仍由原authority拒绝。
5. batch rollback、同步抛错、host关闭与未交付receipt的命运必须明确；不能从node调用
   返回猜commit成功，更不能用此次提案承诺effect rollback。原committed handoff门槛保留。
6. 只有completion通道改变；执行请求不排到下个turn再使用旧grant。真实I/O提交后发生的
   revoke依然不能撤销OS已接受的写。

候选契约还不是选定调度原语；究竟复用哪种source/host机制，及其失败/关闭语义，需要
在批准这项方向后形成具体设计。不能承诺当前代码已经提供它。

## Q5–Q9

Q5：放在focused host/source边界，不放进通用authority或kernel。
Q6：新增成本是有界completion记录和交付turn；可能增加可见结果延迟。应测每请求通知数、
延迟分布、峰值保留量；不能把“无新Node”当零成本，也不修改既有性能预算。
Q7：四组同图输入仍可自由组合；不用用户记住flush，不拦截全Graph入口。语义数据仍通过
Node DATA，外部因果来源需在证据包可追溯，不能只靠describe假装显示了外部回调。
Q8：继续wrapper会侵入batch/订阅/rewire并增加认知负担，排除；迁移host决策进authority
改变纯归约职责，暂不推荐；显式异步completion契约局部化执行边界，代价是修订D160约束。
Q9：推荐显式host completion契约，但当前未锁定。它保留单authority、完整lifecycle、
current-at-dispatch及输入可组合性；新增延迟/容量/关闭保证需独立验收。

本轮没有新公开API、协议改动、host文件准备、真实I/O或provider/spend。
下一步是审阅这项明确的D160局部变化；不是再进行一个不具备全路径覆盖的wrapper实验。
