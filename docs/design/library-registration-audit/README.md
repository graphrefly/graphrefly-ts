# Library 注册机制审查

2026-09-10 · 唯一 owner：graphrefly-ts · 代码基线：`9f4a2429`

用户要求按此前 WeakMap 审查标准检查整个 library。本报告是静态审查和有限离线
探针证据，不是新架构决定、实现授权或全库正确性资格收据。没有改变
CAUSAL-PRESET-ASSEMBLY-TS 的验收范围、历史性能结果或任何冻结 eval。

**结论：并非所有注册都与六张 Node accessor WeakMap 相同。确有其他无条件成本，
也有更重要的失败收尾和隐藏协调问题；Dispatcher、真实依赖、身份与资源所有权
注册则不能整体删除。**

## 标准与覆盖

逐类检查：记录内容与权威来源；唯一 owner；构造/激活/使用时机；数据是否沿真实
依赖传播；失败回滚、解绑、运行实例结束与 GC 的区别；未使用能力的固定成本；
用户是否需要理解额外概念。必要职责不等于当前容器与注册方式必不可少。

规范依据通过 root authority locator 解析：`graphrefly:D5/D21/D23/D26/D39/D51`、
`D80/D94/D122/D124/D145/D160/D279/D284/D285/D332/D562`，以及
`R-node-thin/R-data-not-peek/R-no-imperative/R-dispatch-all`。Causal 实例保留职责仍受
`graphrefly-ts:D160/D161` 约束。这里的 root D160 指 collection backend，不能与 TS D160 混同。

[inventory.json](inventory.json) 对 **282 个生产 TS 源文件**做 AST 枚举：
493 个 Map、349 个 Set、28 个 WeakMap、23 个 WeakSet 构造表达式；另列出 44 个
名称匹配的注册/订阅声明。它们是**代码位置数，不是一次运行的分配数量**。
51 个弱集合位置中，29 个属于持久或组件生命周期登记，22 个属于临时遍历工作集。
未发现 WeakRef 或 FinalizationRegistry 构造。

范围为 `packages/ts/src`；排除 tests、bench、声明文件、生成 runner、qualification、
examples 和其他语言仓库。Codegraph 路径审查补充了数组形式的 pool、订阅、hook、
boundary queue 与资源 retain。下表覆盖全部 29 个持久弱集合位置，并逐类检查主要
非弱注册机制。AST 枚举不是逃逸分析；**不把全部 893 个集合表达式都称为注册表，
也不声称逐条验收了所有业务 Map、所有 callback 或所有外部执行器生命周期。**
本报告能回答注册机制的共性与已发现问题，不能充当全库“无隐藏状态”的证明。

## 优先处理的发现

### 1. 普通 Graph.node 构造失败留下 Dispatcher 注册——已复现

`node/node.ts:251` 先注册函数；`graph/graph.ts:269` 随后才拒绝重复名字。
普通 `Graph.node` 路径（421）没有在该拒绝路径撤销已取得的 handle。

真实公共入口探针：创建 `same` 后再次创建 `same`。可见节点数保持 1；Dispatcher
累计注册数从 1 变成 2，撤销数保持 0。没有访问私有 pool 数组，也没有注入运行时补丁。
这证明失败构造有一个已取得但未撤销的函数注册；未测量堆字节或长期增长速度。

**判断：资源收尾缺陷，优先于微小常数优化。** D161 私有 ConstructionScope 的取得点
记账不能被当作普通 `g.node` 已享有同样保障的证据。后续修复需明确普通入口的取得点
与失败收尾；仅提前检查重复名字还不能证明所有构造后失败路径都被覆盖。

### 2. MessageBus 私有注册列表与真实 deps 在失败后分裂——已复现

`messaging/internal.ts:31` 先 push，34 才 replaceDeps；异常没有回滚。
传入外图 source 后，D22 正确拒绝，但私有列表长度是 1、真实 deps 长度是 0；
之后添加合法同图 source 仍被旧的外图残项阻挡。全新 bus 上同一合法 source 成功。
这是对内部 helper 的实际运行探针；公共 `toTopic` 会先校验/构造自己的输入节点，
本报告**不声称这个外图触发能直接穿过该公共入口**。

解绑也先设置 released 和修改列表，再执行 replaceDeps，存在相同的提交顺序风险；
该解绑异常路径仅作静态发现，未宣称已动态复现。Bridge/Process 的相似代码至少
尝试恢复 previousSources，可以作对照，但其双重失败路径也不能因此视为已证明安全。

**判断：注册失败一致性缺陷。** 需要真实 deps 与辅助列表的失败一致性，不能依赖 WeakMap 的 GC。

### 3. WireEdgeGroup 的 WeakMap 承担跨节点消费确认——规范张力

`adapters/bridge-wire-edge-group.ts:168` 的 `releaseDrains` 保存可变 pending 集合。
gate 在 683 注册；各 inbound projector 在 235 直接调用 `ack` 修改同一个集合；
gate 在 686 读取 missing，并据此在 696–698 发出 release、写 tombstone、reset。
finally 删除条目只证明临时表有清理，不证明消费确认沿 graph DATA/dep 回到 owner。

**这不是 accessor 或身份品牌表，而是参与 cause 生命周期推进的共享确认状态。**
`graphrefly:D562` 要求 adapter 自己的 projector drain-before-tombstone，并指出
graph-visible adapter topology/state 的实现方向；结合 D23，当前确认回路存在明确
架构张力。releaseCohorts 的 DATA 可见，不能替代 ack 返程的可见性。

建议单独审查由 graph-owned ack/finalizer 表达的方案，严格保留 D562 的 adapter-local
范围。不能把它扩成任意 downstream drain、换 wave protocol，或仅把 WeakMap 换成 Map。
本轮没有运行此路径的 mutation，也没有宣称发生了错误 effect。

### 4. checkpoint contributor 未随 runtime release 撤销——已复现内部可达性

`graph/checkpoint.ts:97–114` 只有 set/get，没有注销；Node runtime release 不删除此表。
探针注册一个 contributor、释放节点、继续持有该 Node，内部 checkpoint helper 仍可
调用 contributor 并返回其值。Graph 正常 checkpoint 不会因这个探针而自动暴露已释放节点。

**判断：释放后仍可达的闭包/后端引用与内部读取边界值得修复审查。** Weak key 可在 Node
不可达后回收，不保证调用方持有已释放 Node 时释放 backend 捕获。尚未测量真实大集合
内存，也未证明公共 checkpoint 数据泄漏。D160 所要求的 contributor 能力应保留，
其注册生命周期应与 owner 对齐。

### 5. Collection bind 解绑后仍保留辅助节点——已复现，契约选择未解决

ReactiveList 的 bindDeps 是分类标记；真正保留对象的是 Graph 注册表和 binds 数组。
`graph/data-structures/reactive-list.ts:347–384` 每次 appendFrom 创建注册节点，
disposer 只 unsubscribeDep，parent.dispose 清理 subscriptions/retains。
三次绑定并解绑：Graph 节点数 **3 → 7**（三个 bind 节点加一个 apply）；parent.dispose
之后仍是 7。三个 bind 辅助节点仍在 describe 中。

当前接口注释明确说 dispose 释放 widening subscriptions，因此不能按未经批准的
“销毁全部节点”语义判它违约。但长寿命 Graph 反复接入/移除组件会留下注册资源，
这是实际累积成本。ReactiveMap/ReactiveIndex 有同类结构，只有 List 做了动态探针。
若未来改为释放辅助节点，需要同时保留仍被外部依赖的节点及 D122/D124 的拒绝规则。

### 6. 无条件注册成本不只 Node 的六张表——静态确认，尚无新性能结论

- **每个 Node**：既有六张 accessor 表，各自有逐节点闭包。
- **每个 Graph**：constructor 注册 restore/lifecycle 两个对象、多个闭包和 constructions Map，
  即使没有 restore 或 ConstructionScope 使用。
- **每个 graph-registered Node**：注册 owner token 和 topology callback，后者在无观察者时
  仍创建闭包。事件生成本身有无观察者快速返回，不应错误报告为总在生成 topology events。
- **Ctx 创建/刷新**：`node/node-context-runtime.ts:96/115` 都创建 `{live: ...}` 并写
  `ctxDepWaveOrigins`；它影响 wave-origin 区分，属于需要保留的语义，但这种保存方式
  不由规范强制。它发生在执行路径上，不是此前冷构造慢节点结论的自动解释。

**判断：按频率分别做成本对照。** 不新增用户选项来让普通用户负责内部优化；不以
方法隐藏为理由自动接受 eager registration。当前没有量化这些替代方案的收益。

## 全部持久弱集合的分类

路径均相对 `packages/ts/src/`，行号绑定上述源码基线。数量为构造表达式位置。

| 注册机制（位置数） | 内容与 owner | 注册/释放时机 | 判断 |
| --- | --- | --- | --- |
| `node/runtime-accessors.ts:19` 六表（6） | Node 私有 runtime 访问函数 | 每个 Node；runtime release 显式删 | 职责保留，注册实现可替换；见前轮报告 |
| 同文件 `ownerTokens:14`（1） | Node → Graph 所有权身份 | Graph 注册；release 删除 | D22 所有权校验有必要，不能简单去掉 |
| 同文件 topology observer:15（1） | Node → topology egress 回调 | 每个 Graph 节点；release 删除 | D145 egress 有用途，无 observer 成本值得优化 |
| 同文件 releasedNodes:25（1） | 已释放身份标记 | release 添加；对象不可达后可回收 | 防复用/幂等检查，不是 active obligation 账本 |
| `node/owned-acquisition.ts:17`（1） | exact options → 资源取得记录 | 私有构造设置，Node 消费并 delete | D161 失败收尾记录；必要信息，容器可评估 |
| 同文件 runtimeReleaseFailures:33（1） | 节点 → 残余资源与失败证据 | 释放失败时记录 | 不能用 GC 或清表假装清理成功；不是 retry 授权 |
| `ctx/types.ts:36`（1） | Ctx → live/replay wave origin | 创建/刷新写入；Ctx 不可达后回收 | 语义必要；无条件写入与包装对象可优化 |
| `graph/graph-lifecycle.ts:20/36`（2） | Graph 私有 restore 与 lifecycle registrar，含 constructions owner 集合 | 每个 Graph 创建；Graph 不可达后回收 | 同属隐藏访问入口成本，但 constructions 是运行实例保留责任，不能懒删 |
| `graph/graph.ts:191`（1） | bare/live dependency 的稳定合成身份 | 表随 Graph 创建；实际身份按检查需要写入 | D51 避免为临时 inner 永久注册，保留这一职责 |
| `graph/checkpoint.ts:97`（1） | collection backend checkpoint reader | 仅 restorable collection 注册；无显式撤销 | 能力有 D160 依据，释放对齐缺口见发现 4 |
| `graph/restore.ts:220`（1） | fresh restore 中的 collection 重建索引 | restore 按需建；finally delete | 阶段临时协调，有明确 fresh-graph 边界 |
| `messaging/internal.ts:13`（1） | bus 实现身份与 command-source wiring；实际值为 MessageBusState 对象 | 每个 bus；无显式 bus 注销 | 不是第二份复制数据，但不能只称 branding；失败一致性有缺陷 |
| `adapters/bridge.ts:149/153/157`（3） | bundle → command sources、inbound target/sources | 每个 bridge；sources attach/detach，表无 delete | 真实 replaceDeps wiring 有用途；重复列表与失败边界需保留审查 |
| `orchestration/process.ts:85`（1） | process → command-source wiring | 每个 process；成功 release 后 delete | 生命周期较明确；不要删除真实 command deps |
| `solutions/causal-occurrence/capabilities.ts:51`（1） | exact issued object → graph/instance/binding/level | 每个 full instance 发四个身份条目 | 拒绝伪造、复制和跨实例混合所必需的信息；不是效应批准或 settlement |
| Docker host `executors/local-container-postgresql-docker-engine-api-v0/node.ts:161/162`（2） | opaque token → 私有 host handle | 明确 probe token 签发时 | 私有外部资源句柄身份，不能从普通 Graph 构造成本推断；GC 不删除 Docker 资源 |
| `graph/data-structures/reactive-{list,index,map}.ts:197/342/449` bindDeps（3） | 已接入 helper 的角色分类 | collection 创建；binding 添加；弱标记无主动删除 | 输入通过真实 deps；实际节点生命周期累积见发现 5 |
| `adapters/bridge-wire-edge-group.ts:168`（1） | cohort → 跨 projector 的可变 pending ack | 每次 release cohort；finally delete | 不同于身份/accessor：参与生命周期，见发现 3 |

其余 22 个弱集合位置：describe/blueprint/render/checkpoint 的递归访问集，scoring、
agent-runtime-common、local-untrusted-js、agentic-memory、work-item 的循环检测或深比较。
它们是一次计算的遍历工作集，不是需要注册/注销的组件或业务实例。

## 非 WeakMap 注册同样适用这些标准

| 类别 | owner / 权威与生命周期 | 是否应取消 |
| --- | --- | --- |
| Dispatcher pool 的 fns/free 数组，pools 数组（dispatcher/index.ts:46） | Dispatcher 拥有执行函数；register/unregister 和槽位重用支撑纯数据 handle、F-DISPATCH-ALL | 不能跳过；先修取得后失败未释放。pools 的 dispatcher-lifetime 注册不是节点退订时回收 |
| NodeCore slot 数组、subscribers Set、hooks 数组 | 核心状态/真实订阅；激活、退订、重新运行、release 各有不同收尾时机 | 属于运行系统；不能为少注册而用隐藏 callback 替代依赖 |
| Graph `_entries/_byId/_retiredIds` | 同一 Node 身份及索引；正式 release 移除 live 注册，retired IDs 不复用 | 多个索引不等于多个业务 authority。退休身份的累积是已锁语义，不可为压内存自动忘记 |
| Graph topology observers / mounted forwarders，observe sink | 使用时订阅并返回清理；egress 不是 business graph node（D39/D145） | 按需使用，保留；不把 UI observer 数量当业务 obligation 生命周期 |
| Dispatcher `_stats`（103） | 空 Map 随 Dispatcher 存在；仅 recording 时记项；unregister/clearStats 清项 | profile 的功能成本，不是每个 Node 都注册 profile 项；注释“zero overhead”不等于无分支/空容器 |
| restoreRegistry/define 的 Map 或 Record（graph/operators.ts:83） | 调用方提供 factory descriptor registry；显式添加、重复 ref 拒绝；fresh restore 消费 | 不可改为反射隐式执行或自动全库注册；按需配置已有用途 |
| ViewMemoCache.live 与 memo、reactiveLog tail/slice memo | collection 持有返回 view；memo eviction 与 live disposal 分离（D80/D122） | 缓存淘汰不能自动结束仍被使用的 view；同时核查 owner.dispose 的资源界限 |
| adapter/store 的 listeners、source 的 event/webhook 注册 | UI/host 订阅时接入；返回 unsubscribe 或 deactivation 清理 | 属于外部边界；不能据退订清业务 authority |
| backend Map、RuntimeRetentionIndex、ctx.state 中的 correlation/dedupe tables | 分别是 collection owner、runtime retained index 或节点私有状态；不必一项对应一个 Graph 节点 | 不以容器命名判错；检查跨节点读写、业务事实传播及保留规则。所有业务 reducer 的穷举审计未在本轮声称完成 |
| external executor active calls/cancels/host handles | 外部执行资源；只在该 adapter 使用时取得 | 必须与 admission/outcome 分开；本轮未调用任何 provider、Docker、网络或 spend |
| batch boundary pendingCores、graph-local queued tasks | JS 同步 cascade 深度与 graph-owned 待执行任务（D47/D110） | 已指定 runtime 机制，不能私自改成业务调度器或改 wave protocol |
| TIMEZONE_FORMATTERS（graph/sources.ts:467） | 模块级按需 formatter cache，无 eviction；不保存任务/政策决定 | 容量/键归一化可评估，未量化风险；singleFromAny 的 inFlight 则是 host 调用去重，settlement 时 delete |

特别澄清：MessageBus 的 retained topic backend、collection backend 具有 D160/D284 的
特定所有权设计，不应一律搬进 ctx.state 并复制数据。workQueue 的 deferred command sink
有 **D332 明确依据**，因此回调的存在不是新发现的违规；不过仅凭 describe 的 deps
无法完整展示其延后 ack 返程，当前 unsubscribe 返回值也未被 workQueue 保存（262）。
它需要以既定 bridge/sink 契约审查可见性和 owner 生命周期，不能直接按普通 DAG 加边
形成反馈回路，也不能假借性能审查静默撤销 D332。

## 相同设计标准下的取舍

- **Q5：** 把执行注册、身份校验、检查访问、真实依赖和业务协调分开；不设计一个总注册中心。
- **Q6：** 先保证取得/失败/释放一致性；WeakMap 弱引用不替代资源所有权、active obligation 或终态证据。
- **Q7：** 共享函数可简化 accessor；消费确认应在批准的 adapter-local graph 里可核实。
  观察 egress、fresh restore、host I/O 则保留各自既定边界。
- **Q8：** accessor 可比较共享内部函数或单一私有记录；运行注册保留正确 owner；
  业务确认比较 graph-owned ack/finalizer。把所有表合并或全部去掉都会混淆职责。
- **Q9：** 优先核实/修复失败注册收尾（发现 1、2）；独立审查 WireEdgeGroup 的确认权威；
  明确 contributor 和 collection bind 的释放边界；然后按每 Node、每 Graph、每 Ctx
  分别评估固定成本。选择与实现需具体批准，本报告不新增公共 API 或锁定容器替换。

推荐后续验收：重复 ID/invalid config/注册后激活失败的 acquired-resource 守恒；
attach/detach 异常前后的真实 deps 与辅助表一致；未知/已释放身份及 restore 拒绝路径；
组件重复绑定/解绑的注册数量；未结束义务在 UI 退订后仍保留；ack 路径删除或错配时
不能提前 tombstone；无使用者与有使用者的冷构造、执行和释放成本分开计量。
这些是未来验收要求，不是本轮已跑测试清单。

## 可重放证据

- `inventory.mjs` / `inventory.json`：AST 枚举、完整生产源 SHA-256 绑定。
- `probe-initial.mjs` / `result-initial.json`：首次三个有限探针，原样保留。
- `probe.mjs` / `result.json`：增加普通 Graph.node 重复名字探针；此前三个结果一致。
  每份结果绑定实际输入文件、探针、bundle、Node/esbuild 版本。

从 TS 仓库根执行：

```sh
node docs/design/library-registration-audit/inventory.mjs "$PWD" /tmp/registration-inventory.json
node docs/design/library-registration-audit/probe.mjs "$PWD" /tmp/registration-probe.json
```

探针通过 assertion 表示**问题按所述方式复现**，不表示 library 正确性通过。
它们使用原有生产源编译的临时内存 bundle；没有修改生产源、没有性能采样、
没有运行 CSP-11/冻结性能矩阵，没有实际 effect、provider/live/spend。
不根据源码或三个小图推断六张表的性能收益；原 Causal 性能拒绝仍然有效。
