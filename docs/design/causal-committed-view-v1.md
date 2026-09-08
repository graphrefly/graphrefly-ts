# 已批准的 committed effects 视图设计 v1

2026-09-07。状态：用户已批准 v2 发布策略，登记为 graphrefly-ts:D163；未实现、未测量。唯一 owner：graphrefly-ts。代码基线：`d9c868dc8c2cec395f96a5ae327f692cc37c6df7`；本轮读取时工作区干净。

本稿保留已批准的 v2 审阅内容，替换任务附件 publication-handoff-design/review.md 中“每个 transition 重建并在末尾广播全量 snapshot”的推荐及相关验收方式。保留精确已提交事实、请求内容关联、publication 非执行许可的目标。旧稿作为尝试历史，不可继续按其第 7 节派发实现。

## 1. 建议选择与 C 的关系

推荐审阅“**相关状态变化时重建一个不可变视图，既有 authority 消息携带该视图的共享引用**”。这是一项有限的 solution 内部发布策略，不是通用增量存储引擎。

C（graphrefly-ts:D161）继续负责取得资源时计账、首次执行前移交 owner、启动失败后保留同一实例与义务。此次没有必要修改 ConstructionScope、订阅协议或 C 的核心实现。新视图节点列入同一 cold manifest，通过普通依赖订阅 authority；不要求调用者额外安排一个必须最先启动的保留 root。

相关状态不变时，不扫描 effect 表来比较快照、不 clone/hash 全部记录、不额外发送用于收尾的 snapshot wave。相关状态变化时，首个候选实现仍允许 O(E + D) 的浅层只读投影，E 为当前保留 effect 数、D 为视图涉及的有界 domain 数。因此本推荐减少无关更新的工作，**不声称单条 effect 更新已经是 O(1)，也不声称整体 runtime 已是增量算法**。

如果实际成本不合格，回到本选择；不能把预算放宽、把记录丢掉或把额外配置交给普通用户。是否采用持久化数据结构，应由这个明确失败证据触发另一次有限比较。

## 2. 当前代码与规范给出的证据

| 来源 | 实际事实 | 设计含义 |
|---|---|---|
| [construction.ts:161](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/construction.ts:161) | authority 调用 transition，一次 state.set，逐个旧 fact 各发一波 | 新发布仍先提交；保留旧端口输出值与顺序，不借此把多波合成一波 |
| [construction.ts:107](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/construction.ts:107) | projectFact 只筛选某种 fact | 它本身不能重建在激活前遗漏的其他种类 |
| [construction.ts:262](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/construction.ts:262) | 当前内部 roots 是 releaseController | 添加第二个“必须先订阅”的收集器会产生真实的冷启动顺序问题，不能只靠 root 数组换顺序解释 |
| [transition.ts:53](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/transition.ts:53) | cloneState 已复制 effects 等 Map | Map 引用每次变，不能用引用变化当作业务变化；已有 O(E) 成本必须与新视图增量分开报告 |
| [lifecycle.ts:139](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/lifecycle.ts:139) | proposal 接纳写入记录；admission/outcome 接纳替换记录；deferred 路径也会写入 | 变化标记必须覆盖所有实际写入点，不能只按输入 lane 名称判断 |
| [transition.ts:115](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/transition.ts:115) | occurrence 回收会删除 effects 并推进保留边界 | 删除及范围变化也必须使视图更新 |
| [node.ts:492](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/node/node.ts:492) | sink 先入订阅集合，START/cache 经消息交付，随后按需激活 | 冷订阅可以接实时提交，晚订阅可以接 authority 的最后一个 DATA；无需窥读 cache |
| root R-rom-ram / R-push-subscribe / R-data-not-peek | compute 断连清缓存；再激活从正常 DATA 重建 | 按需 projection 可以释放自身派生状态，但不得影响 graph 持有的 authority 生命周期 |
| [core.ts:81](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/graph/data-structures/core.ts:81) | 现有 ReactiveView 有 delta、pull snapshot、pullId 与 dispose | 存在可比较的按需物化先例；不能直接把这些概念加到已批准的普通五端口上 |

C/cold-v1 的原始收据仍只证明其有限资源与运行资格。本稿未重跑测试，也没有消费旧通过结论来声称新视图合格。

## 3. 推荐方案的具体规则

### 3.1 唯一事实源和更新条件

authority 的同一次 transition 在现有 identity/lifecycle/evidence context 内推进。仅在实际改变已接纳 EffectRecord、删除记录或改变其声明的 retention floor/gap 时标记 publication 视图受影响。未接纳的早到输入仍留在原 pending 机制；错 outcome、相同 replay、无关 evidence 更新不凭 lane 名称使视图更新。

变化标记是本次 transition 内的有限 bookkeeping，不是第二个 admission 状态机。要覆盖 direct acceptance、flushPending、eviction 与 retention metadata 的全部实际改变点。仅监测 effects.size 不够；仅比较新旧 Map 引用也不够。相关 schema 不纳入一般 currentness/high-water/全部 evidence，否则正常无关更新又会退化为全量刷新；这些事实继续走其原 ports。视图里的 admitted 是历史入账事实，不是当前执行授权。

同一 transition 多次改变同一 effect，最终只构造一份最终记录视图。先准备被动投影，将状态及投影引用一起纳入 authority 的一次提交，再发布；投影准备失败不得先输出成功事实。投影含 exact binding、当前 retained records、各 domain 的明确保留边界/gap。不暴露可写 Map、state 或读取函数。不可变 canonical payload 可以复用；EffectRecord 外壳与集合必须真正不可变，不能只写 Readonly 类型。旧版本不得随后续更新变化。

每个已发布视图对象可有内部 generation 坐标，用于排查重复与错接；它不是 source digest、actor provenance、grant 或全局时钟。序号溢出策略须在实施范围冻结时明确。相同 generation 不可对应两个不同内容；消费者用同一不可变引用跳过重复投影，无需每次深比较。无输入仍为 SENTINEL；初次真实提交的空集合只表达“此时没有保留的已接纳记录”，不表达 no-publish、无 pending、从未执行或历史完整。

### 3.2 携带引用，而非要求额外收尾消息

概念形状（私有草图，不是 npm API）：

```text
AuthorityEmission = { fact: 原 AuthorityFact 或明确的 view-change 标记,
                      committedEffects: 同次最终提交的不可变视图 }
```

每个原 fact 按原顺序、原来的单波发送方式携带同一视图引用。旧 capability projection 从 fact 取回原 value，输出形状不变。若相关视图变化而原 outputs 为空，才允许一个专用 view-change DATA；若既无原 fact 又无相关变化，保持无输出。不制造 heartbeat 或假的业务 fact。

这些新增字段是通过 DATA 传递的实际被动值，不是一个允许 consumer 读取隐藏 mutable state 的句柄。无需消费者窥读 authority.cache。authority 最后缓存的无论是 conservation、issue 还是其他 fact，都附带当时最新视图；不再需要每次末尾另发全量 frame。

私有 committedEffects Node 从 emission 投影视图；同一次提交多条 fact 只对相同引用做常数检查，不能逐条重建物化表。新 Node 激活时仍会收到既有消息并经 dispatcher 计算；过滤重复 DATA 不代表没有控制波或调度成本。对多次提交组成的批次，按真实提交顺序处理，不能用“取最后一个”静默丢掉需要保留的变化。

原 authority 内部 DATA 形状会改变，因此源码绑定、原始 authority 轨迹和依赖收据必须重新验收；只有旧业务/capability ports 可要求字节与顺序等价。这不是“完全无行为变化”的重构，也不是 wave protocol 修订。

### 3.3 冷启动、晚订阅和退订

路径为：真实 lanes → 单 authority → committedEffects → 与精确 request material 汇合 → publication。

当其他已存在的 root 先激活 authority，晚启动的 committedEffects 通过最后 DATA 中的完整当前视图恢复；当 committedEffects 首先激活上游，它通过已建立的订阅接到首次真实输出。这一设计不依赖“收集器必须在所有其他消费者之前订阅”。同一转移中 admission 与 outcome 都接纳时，视图直接包含最终 outcome，不先发迟到的执行候选。

所有 UI 退订后，派生 view 可以按 RAM 语义断连；graph-owned authority 仍运行并保留义务。再订阅重建当前 retained view，不重放无限历史、不重新签发 admission。持有新 projection 的根是否由后续 materializer 的持续执行需要产生，应在那个具体 consumer manifest 中计数；本方案不为保存历史强制新增保留 root。

这个保证适用于健康、仍被 graph 持有的 authority 路径。faulted owner、protocol ERROR、非法删边或缺少真实 material 时，不保证 publication 可恢复成当前完整事实；它们必须表现为明确失败/不足，不能以残留缓存显示可执行或成功。新方案只解决 exact effects 视图的恢复，不自动解决 assessment/coverage/issues/startup 的全部按需展示验收。

## 4. 用户实际要承担什么

沿用 graphrefly-ts:D162 的三个角色；不新增受众模式或 factory。以下仍是设计样例，不能伪称已编译。

```ts
// 四组具名真实事实已经由同图的数据源/受限 host binding 提供。
const composition = spendingAlertsFor(app, defaults).compose({
  evaluations, verification, localAuthority, inbox,
});
const { assessment, publication, coverage, issues, startup } = composition.view;
// 展示接这些 Nodes。无需操作 snapshot、generation、flush 或订阅排序。
```

| 用户 | 需要理解 | 应被隐藏的细节 |
|---|---|---|
| 普通使用者 | 评估结果；为何尚未发布；缺什么证据；实例是否启动失败 | 八 lanes、事务阶段、视图 generation、记录复制、精确 admission 对象的组装 |
| 框架作者 | 同图输入、原始 capability 引用、运行实例负责 lifecycle | 不自行重建 authority；不为 UI 挂载安排 retain/start 顺序 |
| Library 维护者 | 一次提交、不可变版本、所有变化点、资源与成本 | 内部图仍可完整检查，不隐藏算法修改或真实依赖 |

这里的短调用只覆盖事实源已就绪的调用者。独立用户首次接入 verification/localAuthority/inbox 的准备成本仍未解决，不能把它们藏进变量名后宣称易用。至少需要一份从实际输入绑定起步的完整 consumer 接线样例，再由用户用五端口回答“结果是什么、为什么还没发布、缺什么”；类型和 keys 检查不能代替理解验证。

## 5. 成本模型与验收门槛

令 T 为 transition 次数，C 为相关视图变化次数，F 为原 fact 消息数，E/D 为保留记录/domain 上界。旧提案新增投影成本大致 O(T·(E+D))，且每次多一波。本候选新增投影约 O(C·(E+D))，携带引用 O(F)，活跃 projection 对收到的 F 条消息有常数检查。若每次更新都改变 effect，C=T，重建成本仍是原量级。初次读取/序列化完整视图也仍是 O(E+D)。这些是算法预期，不是实测。

原 transition 的 Map clone、conservation 扫描仍存在。不能把它们隐藏在基线中后宣传“全链路只按改动量付费”。如果要承诺每个 effect 的增量复杂度，需单独审查原状态表示与聚合路径。

特别检查 serialization：进程内共享引用不等于日志/bridge 序列化会共享字节。若每条 authority emission 被序列化，仍可能产生 O(F·E) 字节；必须报告 describe/观测/证据包的实际使用口径。不能擅自关闭必要观测来过关，也不为此自动新增跨进程缓存协议。现有 replay buffer 或观察者可能延长旧版本寿命，保留内存不能只数一个当前数组。

后续实现的必测矩阵：原 C 四行与原 ≤1.20 构造、≤1.10 稳态预算保持；同时对本轮 commit 做直接基线比较并报告绝对 ns/bytes，不把不同基线混成一个比值。增加 E=1/16/64、相关变化比例 0%/1%/100%、批内多 fact、冷/晚订阅、反复挂载、所有 UI 退出及正常观测模式。继承的原 gate 通过也不能免除 100% 变化压力结果。

确定性工作量断言：初始化后 0% 相关变化时新增 full-view 构造次数=0、深 clone/hash=0、专用收尾 wave=0；每个相关 commit 至多构造一次；相同提交多 facts 共用引用；新增节点数量固定且随组件数不重复创建 authority。记录额外 dispatcher 次数、控制消息、保留各版本的 heap、序列化字节和重连次数。没有性能数据前只能称“候选更少做无关工作”。

## 6. 具体资格与负对照（尚未执行）

| 场景 | 必须证明 |
|---|---|
| effect A/B 交错，只有 A admitted | 视图和 material 按完整 exact 坐标关联；B 不能借聚合数或 latest 得到 envelope |
| UI 不在场时 proposal → admission → wrong outcome → exact outcome | obligation 不受退订影响；错 outcome 不结算；回来只读到正确当前记录 |
| 同 transition 完成 admission/outcome | 各 emission 携带同一最终视图；无过渡 ready 候选 |
| authority 最后输出为 issue/coverage/quiescence | 冷启与晚启新 projection 都从 DATA 得到当前 effects，不要求最后 kind 特殊 |
| 两种 root 启动顺序、热缓存输入、输入晚到 | 不改根顺序也不丢当前视图；无真实 DATA 时不生成业务默认值 |
| deferred promotion、相同 replay、冲突 replay、合法 eviction | 实际接纳/删除/边界变化更新视图；纯 replay 不重建；已回收不等于 never-admitted |
| wrong graph/epoch/request/payload/source revision | 拒绝关联；同拓扑算法修改使旧证据失效，视图 generation 不能替代 implementation digest |
| 持有旧版本再推进新版本 | 旧对象字节不变；嵌套写入不能污染 authority；不能靠 TS readonly 通过 |
| fan-out/fan-in、批内多条 emissions | 原八 ports 值/顺序不变；不会因共享引用漏掉不同 commit；新关系在 describe 中可见 |
| 无异常交易、缺 verifier、unknown outcome、断依赖 | 真实 no-publish 与缺证据区分；unknown 不显示成功；断依赖不产生假许可 |

runtime mutations：漏掉 deferred/eviction 的变化标记；复用应更新的旧视图；每个无关 transition 重建；仅特定 kind 携带视图；把共享视图引用改成窥读 cache；commit 前发送；共享可写记录；exact join 降级成 latest；UI 清理 authority；实际切断 authority/material 依赖。性能 mutations 用工作量断言检测，业务 mutations 用输出检测；编译拒绝、结构拒绝和实际运行失效分别计数。每条删边探针需可运行的 bypass-only 对照，不能把构造拒绝计成业务证明。

独立 deterministic verifier 从冻结原始 facts 重建逐 effect 记录、retention 与 exact join；不 import transition/lifecycle/新视图代码。plain-code arm 承担相同容量、乱序、replay、挂载/退订和未知结果语义。语义比较不要求 plain arm 模拟相同内部引用优化；引用/分配预算另测。人/agent 包保存同一有限输入、source/provenance、graph、实际轨迹、oracle/plain 结果、原始性能与 mutation 分类，隐藏答案继续按 B139 隔离。

此轮未来无 I/O 切片只证明 exact envelope/视图。真实授权仍需 actual host/inbox 运行修改、读回 bytes 和边界证据；snapshot、view 或零 host spy 不能替代它。material 完整、admitted 与 current-at-dispatch 分别是不同事实。

未来获批实施后仍需所有适用离线检查：default 全量、显式长时离线测试、browser、lint/typecheck、build/export/artifact、原 causal/construction mutations，以及新视图专项和成本测量；owner 记录变化另跑 authority/workspace/dashboard。不得用新专项代替这些既有要求。本轮仅检查设计文件、源事实与 git 状态。

## 7. Q5–Q9

### Q5 — 层级与抽象

方案留在 private causal solution，publication/material 命名归 spending-alerts。复用既有单 authority、普通 DATA、projection 和 C owner；无新 verb、公共事务、持久化树或任意 runner。一个真实 consumer 还不足以要求公共通用 snapshot API。内部类型名应描述已提交视图，不称 permission/token。

### Q6 — 不变量和维护成本

INVARIANT：先提交后发送；所有 emission 的视图对应同次最终提交；只在真实相关改变时重建；记录及旧版本不可变；缺席非否定证据；UI 不决定 lifecycle。主要维护风险是漏标一个实际写入点、消费者保留版本造成内存扩大。变化点审计和 runtime mutations 是必要成本；不能把这一责任分散给各个 consumer。

### Q7 — 响应式、组合与解释

两个真实输入为 committed effects 与 request material，在同图 exact join 汇合，输出 publication。authority 的原输入边和旧投影边保留，新增 authority → committedEffects → join 与 material → join 的声明式边。无 cache 偷读、getter 回调、跨节点 state.set、同步反向回灌或用户触发 refresh。一次 state.set 只由 authority 做；C 不进入每条 DATA 路径。

### Q8 — 有名字的备选（避免和历史 C 混淆）

| 方案 / 草图 | 好处 | 代价与先例 |
|---|---|---|
| 每次全量收尾：commit → snapshot | 晚订阅容易解释；单一来源 | O(T·E)、每次多波，上一稿已撤回推荐；现有有界表不是其成本证据 |
| 变化重建、消息共享：fact + immutable view | 无额外 root 顺序；无关变化复用；保持旧端口 | O(C·E) 仍非逐记录增量；原 fact 加引用、投影调度与日志字节要测。先例是当前 projectFact、cache 消息交付与已接纳记录替换，不声称完整组合已实现 |
| 增量镜像加 demand snapshot：delta → read model → pull | 每次小改载荷小；读取时才全量物化 | 需证明首次基线、版本连续性、按需 demand 与有界保留；先例 ReactiveView 已有这些额外概念，但未按 causal authority/C 集成验收，不直接套用它的可写入口或 backend 闭包 |

单纯先 retain 增量收集器不能解决全部冷启动：激活该收集器会启动 authority，而其他旧投影可能尚未订阅。通用消息隔离/原子发布需要更大协议设计，不混入本批。consumer 自己根据 admission 输入重建许可也不作为等价方案。

### Q9 — 推荐与证据覆盖

推荐“变化重建、消息共享”作为下一份有限设计的候选：它具体解决冷/晚订阅缓存问题，沿用 C 的资源语义，并去掉每次全量收尾的必然成本。

| 关注点 | 当前覆盖 | 剩余处理 |
|---|---|---|
| 单 authority、正确层级、C 不扩张 | 设计覆盖 | 新内部 emission 与原端口等价需真实运行 |
| lifecycle/retention/同批终态 | 设计覆盖 | 全写入点审计与 mutations |
| 低性能负担 | 部分 | 相关变化仍 O(E)，观察字节与持续更新必须测；失败回到本选择 |
| 普通用户认知 | 部分 | 只承诺不增加新概念；完整事实源起步样例及用户审阅尚缺 |
| 响应式按需读取 | 设计覆盖 | 两种启动顺序、无输入、断连/再订阅、错误状态资格 |
| 全五端口/真实 effect | 未覆盖 | 保留 D162 与 B121 后续义务，不能以此关闭 |

## 8. 已批准设计的登记边界

分类：durable-architecture；记录 graphrefly-ts:D163；owner graphrefly-ts；layer 私有 solution 发布视图；decision_kind durable-architecture；change_kind new；protocol_impact none；supersedes 空（替换的是未批准尝试，不是 D161）。本记录仅锁定已审阅发布策略。

concerns：ts.causal-composition.committed-effect-view、ts.spending-alerts.publication-evidence。complete_when：这一有限发布/恢复语义被用户明确批准，并在唯一 TS owner 保存精确审阅体与证据绑定；只算设计完成。historical_when：后续 owner 决定明确替换视图发布/恢复语义或 root 协议修订使前提不成立。

用户在审阅 v2 后回复“同意，继续”，批准这一发布策略并继续具体化。原始审阅体的精确摘要与批准上下文由同名 JSON manifest 保留。文中实施草图、性能预期和未覆盖项维持其证据边界；本记录不是实施批准。下一步冻结具体字段/变化点/文件范围及离线资格，再按已有治理流程审阅那一个实施切片。无需重开已完成 C，不提前展开所有下游设计。
