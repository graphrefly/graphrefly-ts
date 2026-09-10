# 按 owner 收敛注册与失败收尾：修复设计 v1

2026-09-10 · owner：graphrefly-ts · 源码基线 `e8b939f6`

用户已同意：先处理失败注册的资源与一致性问题；同 owner、身份键和生命周期的
内部登记应收敛，不能只给每张散表补 delete。本文件细化该方向，不把方向批准
解释为下面全部实现细节的批准。此次交付设计，无生产代码或协议变更。

依据：[全库审查](library-registration-audit/README.md)、
[accessor 审查](causal-runtime-accessor-review.md)。规范继续由 root locator 解析，
特别是 graphrefly:D5/D23/D42/D94/D110/D122/D124/D145/D160/D332、
graphrefly-ts:D160/D161，以及 R-node-thin/R-rewire/R-dispatch-all。

## 推荐形状：一份 owner 记录，共享操作函数

合并的是登记与收尾责任，不是把所有数据复制到一个新容器。

| 身份/owner | 建议唯一内部记录 | 合并或复用的内容 | 明确保留的区别 |
| --- | --- | --- | --- |
| Node 实例 | `WeakMap<Node, NodeRegistration>` | 六张 accessor 表；同键 owner/topology attachment；released 身份、release failure；可选 backend contributor | 构造成功、Graph 接管、开始释放、关闭访问、清理失败不是同一时刻 |
| Graph 实例 | `WeakMap<Graph, GraphRegistration>` | restore/lifecycle 两份 registrar；复用 Graph 原有 entries/byId/retiredIds；construction owners 按需存在 | Graph 本体、注册节点、各运行实例各自有生命周期；不一起清表 |
| 一次尚未转交的构造 | 现有 `NodeAcquisition` 形状的局部记录 | handle、slot、Node、是否已交给 owner、资源取得点 | 不是 Node 成功后的第二份长期台账；不是模块级 current transaction |
| MessageBus command wiring | 已提交 deps + 现有 batch boundary 中的待执行操作 | 消除 commandSources 的“实际列表”副本，body 按当前 Ctx deps 读输入 | 等待提交的 add/remove 不能冒充已提交 deps；不新建业务调度器 |

NodeRegistration 的示意形状（仅内部设计，不新增 export）：

```ts
type NodeRegistration =
  | { kind: "live"; host: NodeRuntimeHost; graphAttachment?: GraphAttachment;
      backendContributor?: BackendStateContributor }
  | { kind: "retired"; failures?: readonly RuntimeReleaseFailure[] };
```

`host` 引用已有 Node/NodeCore runtime；不复制 cache、deps、ctx.state、版本或 authority。
Node/Core 内部热路径继续使用已有直接引用，不在每次 DATA 传播上新增登记表查找。
共享 checkpoint/read/restore/release 函数做一次身份查找后访问现有状态，取代每个
节点六个闭包。可选 Graph attachment 和 contributor 只在使用时添加。
一个固定的小记录仍有成本，不能把“六张表变一张”直接称为性能通过。

记录在完整 Node 初始化成功时签发；非签发对象、复制对象、Object.create(node)、
结构化 cast 不能获得 runtime 访问。bare Node 可签发并被 checkpoint 读取，不要求先
成为 Graph 注册节点。内部签发函数不经过公共入口，不能向调用方开放“注册任意对象”。

开始 release 时仍由现有 `_released` 标记阻止重新使用；它与“辅助访问已关闭”是两个
现有时间点。保持当前 release 中访问关闭的位置，之后把同一身份条目替换成轻量
retired 记录，丢掉 host/Graph attachment/contributor；仅保留必要失败证据。
已释放身份仍可识别，不因清理失败被当作重新可用，也不自动重试清理。
失败证据中的句柄可能继续保留资源，这是诚实的残余责任，不应为了内存指标删掉。

GraphRegistration 使用 checked internal host 和共享操作函数，取代逐 Graph 的操作
闭包。Graph 的 entries 等索引保持唯一权威，不能在新记录里复制一套。
construction owners Map 首次真正需要时创建；只要 owner 尚在，active obligation 与
启动失败后的 leases 必须保留。签发 capability 的 issued 表不并入 Node/Graph 表：
其 key、签发语义及存活范围不同；Ctx 的实现方式留在后续执行成本批次。

## 第一部分：普通构造也必须有取得点收尾

统一使用有限的、带类型的取得记录与固定 cleanup 函数，不做任意 callback 的通用事务栈。
覆盖 bare Node、Graph.node/state/producer/derived/effect/initNode 和 fresh restore 的
实际共同构造路径；D161 ConstructionScope 复用相同取得/释放机制，不能重复释放。

1. 先检查能在取得资源前确定的参数、依赖、名字、metadata、versioning 配置。只读取/
   规范化必要输入，不为优化偷偷改变用户函数执行或 dispatcher 路径。
2. 取得新的 dispatcher handle 或 core slot 后立即记入当前局部取得记录；已传入的
   Handle 是借用，失败时不能 unregister。修改原有 core 的取得点来记录部分成功，
   不能只在构造函数最终 return 后才记账。
3. 完整 Node 签发其内部记录；bare 构造成功返回即交给 Node。Graph 构造继续完成
   entries/byId/owner 的一次内部发布，再交给 Graph；依赖和名字在发布前仍须验证。
   重入构造可能改变名字占用，早检查不能代替发布前检查。
4. 发布前失败只释放此次取得的资源，不动既有同名节点、借用 handle、外部依赖或
   其他 scope 的节点。清理本身失败时保留原异常及残余 locator，不冒充全回滚成功。
5. Graph 已完成发布后才发送现有 topology egress。观察回调可能触发其他工作，因此
   不能把“工厂还没返回”当作仍可 cold abort。发布/转交之后沿现有 Graph/D161 owner
   语义处理，不能撤销已发生 DATA 或把未完成义务自动结算。

这修复的是原公共入口“注册被拒绝却留下函数”的缺陷；不是让普通 g.node 获得公开
begin/commit/abort API，也不把 Causal instance 的生命周期缩成函数调用生命周期。
成功路径不额外生成 Graph 节点、DATA、dispatcher invoke、观测事件或名字。

**能力边界：** 内建 runtime 可记录自己的取得点。自定义 Pool 若在内部偷偷取得
不可见资源后抛错、又不返回 handle，调用方无法凭空知道如何清理。此次修复不能
声称覆盖这种不合作的实现；若要约束它，须另审 Pool 的异常契约，不能暗改公共协议。

## 第二部分：MessageBus 使用一次实际接线，不维护第二份已提交列表

现状 `messaging/internal.ts:31–34` 的 push → replaceDeps 在拒绝后留下残项。
仅调换两行仍不充分：新 fn 可能在 replaceDeps 内同步执行；也可能延后提交。
`node/node-rewire-runtime.ts:102` 与 `batch/batch.ts:63` 明确说明：目标有未提交
settle slice 时，拓扑操作可能被排到 batch 提交之后，rollback 则丢弃。

推荐 adapter 内部使用以下形状，不修改公共 rewire 协议：

- commandBody 使用 `depCount/depBatch` 读取当次真实输入，不闭包读取可变 source 数组。
- 每个 toTopic 创建自己的 commands Node，add/remove 持有这个 exact identity。
  不把这些 token 当作业务 command、admission 或执行授权。
- 调用时做现有适用的输入与 rewire 拒绝检查；需要延后时，把**add/remove 操作**交给
  现有 target/batch boundary。执行时再从当时的真实 deps 计算 next，重新验证后应用。
  不提前计算并排队整份可能过时的 deps 快照，也不另起一张 pending registry。
- 无延后时直接调用同一 apply 路径。结构已接入后发生的用户代码异常不能声称
  “没有提交”，更不能盲目执行一次反向 replaceDeps 以重演或撤销外部效果。
- disposer 的幂等性以该 exact binding 实际是否存在为依据；不得在请求 remove 时就
  把它永久标成已移除。如果 remove 被 batch rollback 丢弃，之后仍可有效移除。

内部接线身份必须唯一。公开 toTopic 的每次调用本来就创建不同 commands Node；
内部 helper 对“同一个 commands Node 多次取得独立租约”的支持范围尚无明确契约。
本设计建议只接受一次 exact binding，重复 add 不创造第二份租约。这个限制需在
实现批准前确认，不把现有数组重复项/dedup 的偶然行为偷偷变成新公共语义。

| 边界例子 | 应有结果 |
| --- | --- |
| 外图 source 被拒绝，再添加合法 source | 拒绝不留任何接线记录；后一次成功 |
| 目标有未提交 slice；连续 add A、add B；batch commit | 按现有 FIFO 顺序应用，最终含 A/B，body 与实际输入一致 |
| 同样的 add A、add B；batch rollback | 两个操作一起丢弃，真实 deps 不变，无假的已注册列表 |
| add A 后在同一 batch remove A；commit | 依现有顺序执行；不能自动合并而隐藏可能已经发生的激活/清理 |
| remove 请求所在 batch rollback，之后再次 remove | binding 仍在，后一次可以移除 |
| 结构提交后新增依赖的激活/外部观察抛错 | 保留真实已发生状态与原异常；不自动重演接线或宣称 effect 回滚 |

使用原有 boundary 与验证逻辑是此方案的前提。若实现必须改变公共 rewire 的提交、
rollback、异常或波次语义，应停在具体差异并走 spec-amend，不能以“内部表合并”绕过。
D332 的 workQueue deferred ack 仍保持；WireEdgeGroup ack 权威是另一审查对象。

## 六个内部 accessor 的兼容矩阵

对本批设计而言保留的是内部可观察行为，不引入公共兼容层。

| helper | 已签发且访问开放 | 未签发或访问关闭 |
| --- | --- | --- |
| checkpointStateOfNode | 读取同一 runtime，保留 version clone 等现有规则 | 原 unknown node state 错误 |
| restoreStateOfNode | 同一 fresh-graph restore commit 和校验 | 原 unknown node state 错误 |
| releaseRuntimeOfNode | 调用固定 release 实现；再次调用不重复收尾 | no-op |
| isNodeRuntimeQuiescentForRelease | 原 quiescence 判断 | false |
| subscriberCountOfNode | 原实际订阅计数 | 0 |
| isNodeActiveForRelease | 原 activation 状态 | false |

isNodeRuntimeReleased 对未签发对象为 false；release 开始后保持 true。
backend contributor 在访问关闭后不再调用并丢掉捕获，这是针对审查发现的修复，
不宣称旧行为已经如此。Graph release 的 external-dependent/quiescence 拒绝检查保持。
UI 退订、runtime 静止、辅助表关闭都不等价于 Causal obligation 的精确终态。

## Q5–Q9 审查

### Q5：抽象与层级

Node/Graph 各一个身份登记，共享内部操作函数；不是一个全库 registry service。
NodeRecord 指向现有 runtime，GraphRecord 指向现有索引；可选检查附件按需配置。
构造取得记录只活在未转交阶段。Messaging 的接线工作依赖现有 topology 机制，
不成为另一个 business reducer。没有新动词或公共 API。

### Q6：长期维护与不变量

INVARIANT：资源只由取得者释放，borrowed handle 不被回收。
INVARIANT：对象身份不能由复制/继承/结构字段伪造；live bare Node 可被合法检查。
INVARIANT：发布后不能按 cold failure 清理；清理失败保留证据。
INVARIANT：source 的已提交成员关系只有真实 deps；pending 操作服从原 batch fate。
INVARIANT：未结束义务由运行实例持有，不由 UI 或 GC 决定。
最大的维护风险是把这些不同时间点压成一个 `registered` 布尔值。

### Q7：可解释性与简化

两个 source → bus commands → runtime 的 describe 仍反映真实 deps。
auxiliary 表消失不改变 DATA 走向或 dispatcher 次数；注册拒绝后不存在影子成员。
共享固定函数代替六份闭包，统一 cleanup 代替多处 delete 清单。保留 D145 的
read-only egress 和 D94 的 fresh restore 特例，不能把这些都伪装成 domain DATA。

### Q8：替代方案

| 方案 | 优点 | 风险/成本 | 现有先例 |
| --- | --- | --- | --- |
| 保留散表逐点修补 | 改动局部，短期回归范围小 | 生命周期清单继续分散；不解决重复注册与闭包成本 | 当前代码 |
| **按 owner 合并记录 + 固定操作函数** | 身份/清理同处；少表少闭包；公共概念不增 | 新小记录、released 时序、pending 操作仍需测试 | NodeRuntimeHost、NodeCore、D161 取得记录 |
| 直接 cast Node/Graph 并完全取消身份登记 | 最少注册写入 | 结构伪造/unknown 行为丢失；仅 TypeScript private 不构成身份检查 | 现有内部 cast 仅能作受控访问先例 |

### Q9：推荐与剩余证明

推荐中间方案；选它是为了统一 owner 和异常责任，不是宣称一张表永远最快。

| 关注点 | 覆盖 | 后续证据 |
| --- | --- | --- |
| 公共概念、exports、拓扑、波协议不增加 | 设计覆盖 | export、behavior/conformance、真实 topology 比较 |
| 失败取得资源守恒 | 内建路径覆盖；不合作外部 Pool 不覆盖 | 重复 ID、参数失败、取得后故障、cleanup 故障、borrowed handle |
| 实现对象身份及 released 访问 | 设计覆盖 | copy/prototype/wrong graph/bare/released negative controls |
| deferred 接线与 rollback | 设计覆盖，未实现 | 上述六种时序 + failed activation；删 boundary/忽略 rollback 的真实源 mutation |
| 未完成 obligation 保留 | 保留既有语义 | pending effect 下 UI detach/reconnect、错误 outcome、精确终态回归 |
| 性能与内存 | 未证明 | 分开测 Node/Graph/Ctx，保留每次原始样本；不修改冻结门槛 |

## 可批准的实现范围与证据要求

建议后续实现批次覆盖 Node/Graph 内部登记、普通 cold acquisition 收尾、
backend contributor 释放对齐、MessageBus 接线一致性；相应内部调用点同步迁移。
Ctx 高频保存方式、collection bind 的正式销毁语义、WireEdgeGroup ack 设计、
capability issued 身份以及其他 provider/host 表均不纳入此批。

这不是全库多模块无边界重写：具体源文件集中在 node runtime-accessors/owned-acquisition/
node/core/lifecycle、graph graph-lifecycle/graph/checkpoint/construction-scope 与 messaging
internal/index，另有必要的内部 import 调整。禁止新增公开 registry、事务或调度入口。

成功证据必须同时包含：四个既有审查探针对应问题的修复断言（collection bind 探针保留
原结果，因为该语义不在本批）；新 identity/失败/延后接线测试；真实可加载 mutation；
所有适用离线 tests/lint/typecheck/build/export/artifact/conformance gates。
冻结 D159 manifest 的既有不一致不得改写成绿色；基线失败与本批新回归分开报告。
性能先做有限私有对照，候选和 reference 使用相同底层改动；不自动重跑已停止的
Causal 正式矩阵、不换阈值、不把注册次数减少当实际时延通过。

本轮没有运行新的测试或测量。前次探针与源码绑定原样保留；本文件及索引以 commit
保留，原 Causal 工作仍 incomplete。批准本设计时，需要明确上述 exact-binding 规则
以及这一具体实现范围；不需要重新选择先前的 A/B/C 产品方向。

## Owner 决定草案（未写入 ledger）

若批准，持久架构由 `graphrefly-ts:decisions/decisions.jsonl` 唯一拥有，D# 届时分配；
本文件不是一个已生效 D#，也不使用旧 root-origin-history。拟入账字段如下：

- layer：TS private runtime registration and ownership；date：2026-09-10。
- question：如何在不增加公共概念或改变 wave protocol 的前提下，统一同 owner 的内部
  登记并保证已知取得资源和 command wiring 的失败一致性？
- decision：按本文件 Node/Graph 单一内部记录、共享函数、有限取得记录及既有 batch
  boundary 中的 exact-binding add/remove 方案实现；保留检查、恢复、释放与运行义务边界。
- rationale：消除按操作重复登记及其清理清单；保持实际 runtime/Graph deps 为唯一权威；
  修复已复现的失败注册残留，且不把未证实性能收益写成成功。
- status：proposed；decision_kind：durable-architecture；change_kind：new；
  protocol_impact：none；supersedes：[]。
- concerns：ts.runtime.registration-ownership、ts.runtime.cold-acquisition-cleanup、
  ts.messaging.command-binding-consistency。
- completion.complete_when：具体设计和内部 exact-binding 规则获得批准并由唯一 owner
  保留；这只完成设计决定，实施及全部资格由独立 work/evidence 证明。
- completion.historical_when：后续 TS owner 决定明确替换登记/接线机制，或批准的 root
  协议修订改变其前提。

实现许可属于本任务的明确批准与后续 work/evidence，不放进这个持久架构决定里。
