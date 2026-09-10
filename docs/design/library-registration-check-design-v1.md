# 登记校验优化：保留检查时点，合并单次身份读取

2026-09-10 · owner：graphrefly-ts · 状态：供审阅，未实现。
设计基线 `81a4cfc1`；生产代码仍为 `194e72ee`。
背景为 `graphrefly-ts:D167`，本轮是既有机制内的实现优化提案，不新增 D#、
不改变已完成的 `LIBRARY-REGISTRATION-TS` 状态、不授予测量或实现许可。

## 推荐及理由

**保留全部构造前/发布前检查，先将一次 `assertGraphLocalNode` 内部的两次
Node registry 查询合成一次。** 不引入“已检查”缓存、额外登记表或用户选项。

[上一轮诊断](library-registration-cost-v1.md) 表明撤去新增校验时 candidate 的 p50
有下降，但删保护的变体不是合法实现。进一步审查发现，重复检查之间并非都没有
用户代码，不能把 120 次名字检查和 186 个依赖元素检查直接视为可删冗余。

可以局部证明的重复查询在 `packages/ts/src/graph/graph.ts:127`：

```text
assertGraphLocalNode
  → isNodeRuntimeReleased(n) → registrations.get(n)
  → nodeOwner(n) → getNodeOwner(n) → registrations.get(n)
```

对一个未释放的正常节点，这两次读取之间没有用户回调、dispatcher invoke、
依赖迭代或外部属性读取。`Node._released` 是库自己初始化和维护的 runtime 字段
（`node/node.ts:171`、`node/node-lifecycle-runtime.ts:130`）。
这里的证明不把篡改库内部私有字段或登记条目作为支持的用户扩展方式。

## 为什么暂不删除多处检查

| 位置（graph/graph.ts） | 中间可能发生的工作 | 本批处理 |
| --- | --- | --- |
| 各 factory 的早期依赖检查 → `_createRegistered:215` | 读取 opts.factory/name；调用方 getter 可重入 | 保留，不传“已经检查”标记 |
| `_createRegistered:215–217` → `_addWithId:247–249` | `_nodeOpts` 解构/getter、metadata 规范化、dispatcher.register、Node 创建 | 保留；重入可释放依赖或抢占名字 |
| `_addWithId:247–249` → `263–264` | metadata 规范化、读取 opts.name/restore | 保留；晚期 getter 的副作用与错误顺序不能悄悄改变 |
| `_assertDepsLocal:263` → `_assertAvailableId:264` | 遍历 caller-owned deps 会执行自定义迭代器 | 保留先依赖、后名字的顺序；迭代器可能抢占名字 |
| 最终校验 → entries/owner/byId 发布 → topology egress | 库内部发布后才通知观察者 | 保持责任转交点；观察回调异常不能 cold rollback |

`registration.d167.test.ts` 已覆盖 register 中抢占名字、第二次 restore getter
读取时重入，以及最终依赖迭代时抢占名字。改变 getter 读取次数、deps 的复制方式、
拒绝错误的先后顺序，都超出本批推荐方案。现有最终遍历是否足以抵御任意恶意
迭代器对先前元素的再次修改，也不是本轮新增的已证明承诺。

## 具体内部形状

在 `node/runtime-accessors.ts` 加一个 package-private helper，暂名
`nodeOwnerForGraphUse(node, label)`：

```text
读取 exact node key 对应的既有 record 一次
若 record 已 retired，或 live host 已开始 release：抛出原 released 错误
否则返回 live record 的原 graphAttachment.owner，或 undefined
```

Graph 的 `assertGraphLocalNode(owner, node, label)` 保持原签名：调用该 helper，
再执行原有 foreign-owner 比较和原错误。只移动 release 拒绝和 owner 读取的组合，
不把 Graph membership 或 Graph 类型搬进 Node registry。

helper 不返回新状态对象/tuple，不暴露 record，不缓存结果到下一次检查；不新增
Graph/Node 实例字段、WeakMap、闭包或公共 barrel export。已有独立查询函数继续
服务各自调用者，不全库机械替换所有 owner/release 读取。

| 原有状态 | 推荐 helper 行为 | 保留的意义 |
| --- | --- | --- |
| 正常已登记、属于当前 Graph | 返回原 owner；Graph 检查通过 | 原 identity 和 owner 不变 |
| 正常已登记、属于别的 Graph | 返回原 owner；Graph 抛原 cross-graph 错误 | wire bridge 边界不变 |
| 已签发 bare Node，无 Graph attachment | undefined | 不把 Graph 变成强制容器 |
| release 已开始、访问尚未关闭 | 抛 released 错误 | `_released` 与 access-close 继续区分 |
| retired，包括残余 cleanup failure | 抛 released 错误 | 不把失败证据清空或恢复可用 |
| 未签发对象 | 维持此 guard 原有的 undefined-owner 行为 | 不暗改此 guard 为签发鉴权 |

最后一行不授予 runtime 访问：checkpoint/restore 等 exact-identity 检查和
`_assertRegisteredNode` membership 检查保持原样。此 guard 通过从来不等于签发成功。

## Q5–Q9

### Q5：抽象与层级

推荐合并同一 record 的两项读取，而非新建注册服务。Node 层掌握其既有 release
和 attachment 字段，Graph 层继续执行 cross-graph policy。两个文件局部调整，
命名表示供 Graph 使用的 owner 查询，不新增动词或 substrate 消息。
依据为 R-graph-role、D167 的单 owner 记录；无需跨 runtime API 对齐。

### Q6：维护与不变量

INVARIANT：每次检查重新读取；不复用前一检查的“live/owner”结果。
INVARIANT：release-start 必须拒绝，即使 retained evidence 或辅助访问仍在。
INVARIANT：所有用户 getter、迭代器和 dispatcher 路径的执行位置/次数保持。
INVARIANT：pre-publication acquisition 与 post-publication lifecycle 的责任不变。
风险是后来在 helper 的两项字段访问之间插入用户 callback；必须在 helper 注释和
行为用例中保留这一局部读取前提。当前只提案，不宣称时延资格通过。

### Q7：可组合、分级隐藏与简化

`a,b → joined → sink` 的节点、边、identity、DATA 顺序和 dispatcher 次数不变。
变化只发生于现有登记检查，无业务 imperative 调度。普通用户继续使用 solutions，
框架作者继续组合 patterns/capabilities，维护者检查同一个 core/graph。
没有新入口或需要用户理解的校验模式；认知成本改善未做人体/agent 实测。

### Q8：局部替代方案

| 方案 | 形状与好处 | 代价/风险 | 当前先例 |
| --- | --- | --- | --- |
| 保持现状 | 两次 helper/record lookup；无需改动 | 未减少校验执行成本 | 当前 assertGraphLocalNode |
| **同次查询合并（推荐）** | 一个 helper 读取 record，判断 release，再返回 owner | 微观操作减少，实际 p95 收益未知；须保持状态矩阵 | D167 各 accessor 从一次读取访问原 host |
| 跨边界去重/预先快照 | 更少验证轮次或统一 prepared 输入 | 改变 getter/迭代次数、错误顺序；新增快照分配或信任边界 | 当前 _nodeOpts 已部分整理输入，但不足以证明全部无重入 |

这是现有方案内部的实现比较，不重新打开此前产品/构造 A/B/C 选择。

### Q9：推荐与覆盖

| 关注点 | 覆盖 | 剩余证明 |
| --- | --- | --- |
| 同拓扑、组合性、分级入口 | 设计覆盖 | export/identity/topology 与既有 consumer 回归 |
| 重入后的校验与早期拒绝 | 保留全部时点 | register/getter/iterator 重入用例及 mutation |
| release、借用资源、残余证据、义务 | 原机制不变 | 已有 D161/D167/causal lifecycle 回归 |
| 单次访问成本 | 正常成功路径 lookup 2 → 1，不增加对象 | 静态/不计时计数确认；编译器行为和端到端时间待测 |
| 构造时延 | 未证明 | 有相同代码副本控制的有限离线比较 |
| 原正式性能资格 | 未覆盖 | 仍拒绝，不自动重试 |

推荐同次查询合并，因为可在保留全部边界的前提下消除已确认的重复读取，改动小，
公共概念和持有状态都不增加。不能承诺回收上轮删保护变体的 12.2 微秒，也不能
把 lookup 减半说成构造时间减半。若实测无收益或新回归，保留证据并停止扩大优化。

## 后续可批准的实现与验证范围

实现仅限 `node/runtime-accessors.ts`、`graph/graph.ts` 的该组合查询，以及必要的
行为测试/诊断绑定；不重排 factory、options、deps、发布、MessageBus、authority。
这不改变 D167 的持久语义，通常不需要新 D#；若实现时发现必须改变上述边界，
应单独呈现具体语义差异，本设计不授权该扩展。

验收优先级：

1. 状态矩阵：same/foreign graph、bare、release-start/access-open、retired/failure、
   fake 对象不获得 runtime access；在 deactivation hook 内触发 Graph 使用必须拒绝。
2. 保持八种 factory 的早期 duplicate 拒绝，以及 register/restore getter/deps iterator
   重入后的 winner、资源账本和 Graph.describe 结果。错误后不能新增 provider/effect。
3. 真实 runtime mutation：去掉 release-start 分支、去掉 foreign-owner 拒绝分别必须
   被行为断言检出；沿用现有取得/发布保护 mutations，不以编译或加载失败当检出。
4. 原有 offline suite、conformance、适用 soak、lint/typecheck/build/export/artifact
   gates；既有 D159 两项 manifest 失败如仍存在应原样报告，不改冻结证据。
5. 性能单独使用当前生产 `194e72ee` 作为修改前，不再拿更早 baseline 当本批对照。
   固定 off/summary × candidate/reference、轮换顺序、保留全部样本和 identical-copy
   控制；计数不参与计时，测量不能与重型测试同时运行。正式矩阵仍不在范围。

本轮仅保存设计及文档检查，没有生产代码、测试源码或测量脚本改动，没有新性能运行。
