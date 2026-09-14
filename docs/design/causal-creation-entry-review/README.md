# 普通用户创建入口：具体设计稿

2026-09-13，基于 fbd6e705。状态：待审阅，未锁定新公共 API，未实施。
沿用 graphrefly-ts:D160/D162/D164 的单实例、四组输入、完整冷装配、view/capabilities；
不重开 C。TS package/consumer 为唯一实现 owner；B121 仍由 root 独立汇总。
这份稿件是后续创建入口的提案，不新增 work/decision，不把当前 assembly 标 complete。

## 推荐与实际前提

保留已批准的 `spendingAlertsFor(graph, defaults).compose(inputs)` 候选形状。
普通调用者只创建一次完整实例并取 view；框架作者从同一次返回取原 capabilities。
core/patterns 不为此增添符号，业务 preset 放在 solutions 层；建议未来使用 focused
`@graphrefly/ts/solutions/spending-alerts` 入口，名称与导出清单在本稿审阅后再锁定。
这是拟新增入口，不是当前可 import 的模块；不要求普通用户依次调用 core→patterns→solutions。
高级使用者可以下钻，分层不是一条必须手工执行的流水线。

本轮查证：

- `packages/ts/package.json` 已有 core/patterns/solutions 分类；没有此 focused preset。
- `examples/spending-alerts/causal-preset.ts:95` 的 builder 仍要求 Graph、scope、startup、
  四组输入、binding、name 和 diagnostics。运行图、53/54 owned nodes 与2 roots 已存在。
- `scripts/fixtures/spending-preset-harness.ts:181` 展示了完整冷装配顺序；它直接驱动测试
  source，不能作为普通用户的 production 创建示例。
- `causal-inputs.ts` 的 SpendingBinding/Assessment 明确为 fixture-observations；
  InboxObservationFrame 是被动测试事实，不是 host capability。源码没有 spendingAlertsFor
  或 qualifiedInbox 的实现，append-alert 当前只有事实类型及检查。
- D160 第7节已给出 current-at-dispatch 和 focused adapter 方向，但 I/O 前拒绝如何经
  合法 outcome source 回送仍要求具体设计。公开 factory 不能先假定该能力已完成。

## 完整责任链：谁准备，谁调用，谁运行

| 环节 | 普通调用者需要知道 | 集成方/框架必须完成 | graph 内的责任 |
|---|---|---|---|
| 评估输入 | 选择交易、统计前缀与政策来源 | 提供同图 pack/arrivals/current Nodes；关联输入、源码与政策修订 | 校验有限输入，业务 fan-out/fan-in，显式 currentness |
| 独立验证 | 选择可信的独立验证来源；知道不可用会等待 | 提供 receipt Node 与真实 verifier revision/证据来源 | 验精确关联；图内自报 pass 不生成独立证明 |
| 本地操作许可 | 明确谁准许什么目的地、范围、数量 | 提供 grant/stop/revocation/逻辑时间事实来源 | exact admission 与最终当前性判断；没有默认同意 |
| 发布目的地 | 选择确切 inbox；知道未 ready 不会执行 | 提供预先准备的合格 focused host binding、readiness/outcome source | 消费 exact committed request，记账并接收关联终态 |
| 创建 | 选 Graph、实例名和四组来源 | factory 内部完成预检、冷构造、seal、一次移交与启动 | 一个 authority、完整依赖；预移交失败清理本次资源 |
| 消费/结束 | view 可随展示挂载、退订；结束应用是另一责任 | 应用运行实例的 owner 管理结束；不能把 UI dispose 当运行结束 | 未结义务保持；精确终态才能结算；不因没人看而丢记录 |

这里没有消失的复杂性：来源适配、独立证据和授权仍需要集成方承担。
创建体验成功的标准包括“一次真实集成可供普通调用者复用”，不能只展示已有 inputs 变量
却不交代它们从哪里来。首批完整体验至少需要一个具体宿主集成；其资源/source API 未定，
本稿不凭空发明四个万能 prepare 函数或第二个隐藏注册表。

## 两条调用链

以下是设计草图，故意不伪装成可运行代码。Graph 来自现有 package 入口；
spendingAlertsFor 是待实现的 focused solution。evaluations 等变量必须来自上表的真实集成。

```ts
// 普通调用者：四组来源已由应用集成层在 app 中显式创建。
const preset = spendingAlertsFor(app, { name: "alerts" });
const alerts = preset.compose({ evaluations, verification, localAuthority, inbox }).view;
// 将 alerts 交给展示组件。没有 publish/approve/feed/retry 方法。
```

name 是实例命名，不是授权坐标。重复名字按冷构造规则拒绝；不猜测或自动重用旧实例。
默认配置固定到一个受支持的有限 profile、diagnostics=off；不要求普通用户理解证据计数等
内部预算。实例 binding 从各个显式输入/host 的一致性和创建上下文获得，不能从松散字段
拼出“资格”。它的精确签发来源与校验格式须在 host 设计中落定，而不是隐藏后免检。

```ts
// 框架作者：使用完全相同的创建流程；不多建一套 graph/runtime。
const composition = spendingAlertsFor(app, defaults).compose(inputs);
renderAlerts(composition.view);
wireExecutionPanel(composition.capabilities.execution);
wireEvidencePanel(composition.capabilities.retained);
// 维护者以 app.describe() 下钻同一完整图。
```

wire/render 在此只是组件边界示意，不是新增产品 API，也不可以发起任意 effect。
framework component 接收原 handle；execution.identity 和 retained.execution 的原引用关系
不变。只读 identity 不裁掉 lifecycle/evidence，选择 diagnostics 不改变授权或保留责任。
当前 ordinaryExample 仍直接辨识 DATA；最终框架集成应展示现有 value-level 消费方式，
不能用今天的示例声称普通用户已不需要懂消息协议。是否缺适合的既有绑定，须按实际框架验证。

## 缺失与失败：构造期和运行期分开

| 条件 | 设计要求 |
|---|---|
| 没有必要输入 Node/合格 host，或伪造/错误 graph、epoch、contract | 在启动前拒绝；能静态表达的先由类型拒绝；不留下本次部分拓扑，不打开文件 |
| 类型/身份合法，但 receipt、grant 或 readiness 尚无 DATA | 允许实例启动并等待，输出既有 issue/coverage/startup 事实；不伪造通过，不触发 I/O |
| assembly 在移交前失败 | 复用 C 的精确资源清理、ID retirement 和 cleanup-error 行为 |
| 移交后启动失败或已承担义务 | 原实例 faulted；保留未结记录，不换 epoch 假装重试，不假称已经安全释放 |
| UI 全部退订，然后重订阅 | 同一实例继续拥有整个生命周期；在保留界限内重新观察原事实 |
| dispatch 前 receipt/grant/source 过期或撤销 | 现有 current-at-dispatch 规则阻断；已 admitted 义务需精确的已知未提交终态，回送机制必须先设计清楚 |
| 写入已提交但结果未知 | 不自动重试，不标 known-no-write；按真实 outcome 处理，创建 facade 不添加跨 crash 保证 |

没有合格 host 时，本拟议执行入口拒绝创建；既有离线 fixture 仍供测试/证据审阅使用。
不新增 `mode: analysis/live` 来混用两种资格，不把 fixture inbox 当 public factory 默认值。
结束/替换运行实例的完整公共操作仍不在本稿锁定范围。不能承诺创建 facade 自动解决 drain；
在可执行入口发布前，宿主结束责任与在途结果回收路径必须能具体复核。

## 认知和性能预算

认知预算先按责任计数，不把短代码行数当体验指标：普通调用者需理解 Graph 所属应用、
实例名、四组业务来源，以及“业务判断/获准/结果”三种不同事实；无需理解八 lanes、
scope/startup 接线、手工 admission、签发 registry 或底层终态协议。
高级诊断和 limits 可按需展开，不新增 audience、runtime level、缓存或生命周期模式选项。
这个预算是可审阅目标，不是已测理解度；最终至少用一次真实集成进行普通用户创建与错误恢复任务。

性能增量只允许配置对象/引用与必要构造预检；factory defaults 本身不建 topology、不订阅、
不打开资源，compose 复用完整冷 builder。分级返回不增加包装 Node、额外 root、per-event
转发、重复序列化或持久索引。必须以同 inputs/相同最终 topology 的直接冷装配为对照，
分别报告 factory 对象创建、compose/首值、steady/reconnect，以及 allocation/RSS。
不在节点热路径反复验整个源码闭包；来源变化仍经 graph-visible binding/currentness 生效。

现有 1.20/1.10 预算和 D169 method-not-qualified 保留；没有为 facade 自定宽松门槛。
新增 host 节点及资源成本必须单列，不能混入“只多一个对象”的承诺。用户约100ms交互期待
依然是体验目标；本稿无测量，不声称整体已符合。实现后只跑与新增路径相关的对照和所需资格，
不自动再开一轮无界诊断。

## Q5–Q9

**Q5：层次。** 这是 spending 业务 solution 的创建入口，不是 kernel、graph verb 或通用
因果 primitive。core/patterns 保持原职责。原 view、capabilities、construction 机制可复用，
不把它们重新实现进 facade；首次仅一个完整受支持闭包。

**Q6：长期风险。** 主要风险是用“已准备 inputs”遮住真实集成成本，或把 host 资源关闭
错误地绑到 UI。必须保留来源/许可责任与运行实例 ownership；固定默认不是资格证明。
公共类型、构造错误和 current-at-dispatch/source lowering 尚需具体资格，不能宣布已解决。

**Q7：组合。** 一次冷装配、一次所有权移交；普通/框架/维护者查看同一图。拆开消费对象
不拆开 authority，不强制用户依次穿过三层 API。节点算法绑定、作者 provenance、独立后果
证据分别可追溯，隐藏详细字段不隐藏“未知/证据不足”。

**Q8：备选。** 直接公开现有 builder 会暴露 scope/startup/fixture binding，不能满足创建
体验；增加一个包揽来源与授权的零输入 factory 会隐藏事实和资源副作用。推荐既有 graph-bound
factory + 四组显式真实集成：保留组合能力与可核实来源，代价是必须先完成 focused host。
这不是重新争论此前 C；三种方案只比较本次创建边界。

**Q9：覆盖。** 推荐形状覆盖分级消费、可组合性、完整依赖和冷构造；部分覆盖认知/性能，
因为真实集成和测量尚缺；不覆盖任意插件、可裁剪 runtime、跨 crash exactly-once。
先细化首个 focused inbox 的有限实现设计，再把 factory 薄接到已资格的真实路径。
最终导出路径和签名需在该边界清楚后批准，不先发布一个只能喂 fixture 的公共壳。

## 后续有限批次及验收

1. **focused host 设计**：只定现有 append-alert 操作的准备资源/身份、readiness、精确消费、
   I/O前拒绝 outcome 回送与应用结束责任。必须展示合法 dispatcher/pool/source 调用链，
   明确哪里支持，哪里需要新语义；不借设计稿授权打开文件或真实写入。
2. **薄 factory 实施（另行批准）**：在上述前置条件满足后接既有冷 builder，保留同图精确
   capabilities 与五字段 view。运行前构造失败、缺运行事实、退订/重连、错误终态须验证。
3. **创建体验验收**：一份真实来源准备例子 + 普通调用例子 + 框架组合例子；编译正/负例、
   实际对象检查、必需依赖 mutation、same-topology代码变更/证据绑定，以及有界增量性能对照。
   人类试用与 B121 agent/plain 比较分别记录，不能用作者自答补齐。

本轮仅设计与源码审计。没有新增公共 export、实现、测试重跑、性能采集、provider/live/spend，
没有修改 wave 或任何 owner 完成状态。下一步要审阅的是有限 focused host 设计，不是所有下游模块。
