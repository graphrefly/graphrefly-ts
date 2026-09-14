# 分层入口与渐进披露：集中审阅稿

2026-09-14；源码基线 `9268727c`。本稿只交付设计，未批准新的公共 API 或实施。
唯一 package/consumer owner：graphrefly-ts。依据 D160、D162、D170；root B139 已完成，
B121 仍待独立汇总与用户验证。此前批准的单 authority、完整 lifecycle、C 构造事务继续有效。
本稿整合旧 creation-entry 草稿与已完成实现，不替换其历史收据，不重开 A/B/C。

## 1. 推荐一次确认的方向

一个完整运行实例，按责任传递三个暴露面：普通用户拿业务 view，框架作者拿原 capabilities，
library 维护者检查原 Graph 和证据。推荐保留候选形状：

```ts
// 设计示意；spendingAlertsFor 尚不存在，以下不是当前可复制运行的 API。
const preset = spendingAlertsFor(appGraph, { name: "alerts", diagnostics: "off" });
const composition = preset.compose(integration.inputs);
// 应用的展示组件只收到 composition.view。
// 框架集成可以取得 composition.capabilities。
```

`integration` 在应用启动模块显式准备；它不是全局单例，也不是待新增的万能 provider。
应用集成模块持有运行所有权与实际 host 资源，UI 只持有展示所需引用。
先把这条使用链做成一个完整的私有离线示例并验收，再单独确认 public export 与真实宿主资格。
本次推荐实施范围不包含公共发布。批准本稿也不授权真实 inbox、provider/live/spend。

**这次设计的完成标准是普通使用者无需理解装配协议，并且下钻后看到同一个真实系统。**
少几个参数但把授权来源、依赖或 lifecycle 藏进全局对象，不算成功。

## 2. 已经实现什么，还缺什么

| 项目 | 当前事实 | 本批要补的体验 |
|---|---|---|
| 身份/lifecycle/evidence | authority内部职责已分开，统一推进与提交；capabilities有原引用 lineage | 呈现“哪些是身份、哪些是未结义务、哪些是保留证据”，不要求普通人读内部结构 |
| 构造 | composeOfflineSpending 已完成预检、冷构造、seal、transfer、start | 集中默认值与应用接入示例，调用者不复制构造步骤 |
| 分级对象 | 已有五端口view及identity/execution/retained handles | 三个端到端使用示例、清晰类型入口、实际下钻路径 |
| 普通消费 | ordinaryExample 仍手动辨识 DATA | 示例内提供值级展示绑定；普通组件不写协议分支 |
| 资源 | OfflineAlertResource 为真实graph提供模拟写入与结果source | 接入示例明确标离线模拟；不能包装成qualified host |
| 代码变化 | 实际同拓扑vendorStats等价修改、新旧source/runtime绑定证据已有 | 把实现变化、作者来源、独立后果证明并排展示，避免只看拓扑 |
| 验证 | 类型负例、52项相关行为测试、mutation与源码绑定证据已有 | 加入创建→消费→下钻→退订/重连的一次完整验收 |
| 性能 | 既有构造与有限lifetime收据可复核；局部Map原型未落地 | 沿用证据与预算，只对新增入口做必要回归；暂停编码优化 |

主要实现位置：`examples/spending-alerts/causal-focused-host.ts`、`causal-preset.ts`、
`causal-audience.examples.ts`；capabilities位于`packages/ts/src/solutions/causal-occurrence/`。
这些路径的内部导出不等于package公共export。当前没有spendingAlertsFor的公共入口。

## 3. 三类用户的完整使用路径

### 普通用户：选择业务接入，创建并消费

这里区分“应用作者”和“展示组件作者”。应用作者仍需选择输入、独立验证、许可和目的地；
组件作者只需拿view。不能把组件的简单用法冒充应用接入也无需准备。

应用启动文件明确列出：输入来自哪里、verifier是谁、谁签发许可、写向哪里。
由集成代码把这些责任连接成现有Nodes，并持有运行所有权；业务使用文件执行一次compose。
首批用已有离线fixture提供完整可运行接入，页面持续显示“模拟执行”，没有隐藏真实资源调用。

展示组件默认只看五类结果：assessment、publication、coverage、issues、startup。
界面用业务文字解释“评估结果”“发布及结果”“证据覆盖”“问题”“启动状态”；字段名仍沿用
已有view。缺数据时显示尚无事实，不能默认成功；startup完成不能显示成整次运行完成。

值级绑定先放在该示例的展示适配层：接收原view并输出显示值，内部处理现有订阅与清理。
它不成为新公共verb，不创建第二个authority或转发Node，不提供feed/publish/approve/retry。
以后React等适配器是否可复用，需核实具体适配器；本稿不假定仓库已有某个hook。

### 框架作者：组合原能力，掌握集成责任

框架作者从同一次compose返回值取得capabilities，按用途传递：

| 能力 | 使用者能查看/组合什么 | 不代表什么 |
|---|---|---|
| identity | released、currentness、issues | 没有创建低配runtime，也没有执行许可 |
| execution | 原identity、terminal fan-in、conservation、causalQuiescence | 不是可调用的I/O句柄 |
| retained | 原execution、coverage、retainedQuiescence | 不是完整历史永不丢失的承诺；以coverage事实为准 |

execution.identity必须是原identity；retained.execution必须是原execution。
跨graph/epoch、结构拷贝或强制类型转换不能构成合法升级。选择少暴露一组引用不移除底层依赖。

需要自定义接线时保留现有内部完整构造路径；普通preset与手工组合使用相同节点构造器，
不形成两份业务实现。本批不发布通用runner或任意插件注册接口。
运行owner负责资源和生命周期，UI绑定的cleanup只结束观察。停接新工作走已有stop事实；
已提交请求等待精确结果，unknown/fault保留。首批不新增公共dispose/flush/end方法。

### Library维护者：完整图与证据下钻

维护者检查原appGraph.describe()、原capabilities及运行owner诊断。
下钻入口关联稳定节点ID、输入/政策、请求/admission/outcome和相应证据文件。
切换展示层级不重新构造实例、不改变授权、不自动开启额外运行诊断。

“同一个图”不等于“实现没变”。节点关系页面旁边提供三个独立区域：
1. 实现绑定：当前source/runtime与审阅基线的差异。
2. 修改来源：明确human/agent/tool provenance；缺来源就显示未知。
3. 后果证据：独立verifier的适用输入、政策、算法修订与结论；旧证据失效可见。

只有有精确源码到节点关联时才标“此节点实现变化”。只有闭包级diff时标“关联源码闭包变化”，
不把一次文件变化自动归因给所有节点。拓扑、作者身份和结果等价分别需要各自证据。

## 4. core / patterns / solutions 的职责

分级暴露与package分层是两个维度，不能一一绑定成“普通人只许用solutions”。

| 层级/入口 | 角色 | 本批变化 |
|---|---|---|
| core与graph | 通用执行基础、显式Nodes、graph inspection | 复用；不新增spending专用符号 |
| patterns | 多业务可复用的组合模式 | 保持现状，不为三个用户等级新增三个pattern |
| solutions | 业务preset与有限语义能力的入口位置 | 未来focused spending入口的候选位置；先在consumer-private位置完成验收 |
| 应用/框架集成 | 准备业务来源、独立证据、许可、host与展示绑定 | 新示例把这些责任完整展示 |

候选公共路径仍是`@graphrefly/ts/solutions/spending-alerts`，不是当前可import的承诺。
本批先确认创建形状和类型边界，不把所有library模块重新搬层。新增公共导出清单、依赖加载
与ESM/CJS/DTS要求在发布资格批次集中确认，不能靠“root index没改”绕过公共API审阅。

## 5. 创建契约与默认值

- `spendingAlertsFor(graph, defaults)`只形成绑定graph的不可变配置，不创建节点或占用host。
- `.compose(inputs)`才创建一次实例；自动执行已批准的完整冷构造顺序，不由UI首次订阅启动。
- defaults只含实例名和off/summary等构造选项；省略diagnostics取off。完整contract-v2闭包固定。
- 若支持compose局部override，合并到新的不可变配置；undefined继承、非法值拒绝，绝不修改
  factory或已创建实例。本批建议只开放name与diagnostics，不开放内部容量或assurance切换。
- graph、epoch、source/runtime、目的地等精确绑定由集成上下文提供并交叉验证，不由便利函数
  猜测，也不从defaults签发grant。默认值不是覆盖证明或执行许可。
- 缺少必要Node/资源身份属于构造错误；Node存在但尚无receipt/grant DATA属于运行等待。
- 复用factory不表示复用实例。重复名字或资源epoch冲突按既有规则拒绝，不自动编号或返回旧图。

创建输入保留evaluations、verification、localAuthority、inbox四个逻辑责任组。
当前offline实现由host拥有inbox source，所以物理调用可由集成层传入前三组与OfflineAlertResource；
普通组件看不到这个区别。不可同时接入caller注入的outcomes和host source形成双重结果来源。
本批只支持已有offline resource类型；公共qualified-host类型的签发、来源和真实I/O验收尚未完成。

## 6. 验收场景：一次批准后完整执行

| 场景 | 必须观察到的结果 |
|---|---|
| 仅创建配置，随后两次独立compose | 配置阶段零节点；compose精确创建，名字/epoch规则按原合同执行 |
| 普通组件接入 | 不导入scope、authority、lane或Message，不写DATA分支；拿到五类业务结果 |
| framework组合与maintainer下钻 | 原handle引用/lineage与原Graph一致，没有复制节点或第二套authority |
| 暴露面切换 | 只更改传递/展示引用；相同输入产生相同请求、结果和保留事实 |
| 同拓扑改vendorStats算法 | 显示实现绑定变化；独立作者来源；旧receipt不能授权，新证据核实后果 |
| fan-out/fan-in | assessment/explanation/publication-policy关系可见；缺分支不得假称完成 |
| 错误/过期receipt、grant、epoch | 构造错误和运行等待/拒绝明确区分；最终边界零未授权调用 |
| UI全部退订后重连 | 原运行继续履责，保留记录；重连看到同一实例事实 |
| stop/撤销、unknown、依赖丢失 | 新调用阻断；原义务不被展示cleanup清空；问题及证据缺口可见 |
| replay与正常不发布 | 不重复执行；正常不发布与缺证据/未知结果在展示上不同 |
| defaults和局部override | 无全局泄漏、无运行中切换；非法配置不留下本次部分资源 |
| 类型负例与打包边界 | 普通view无执行/内部装配字段；伪造handle不通过；本批不新增package export |

行为复用当前oracle、真实runtime mutation与精确outcome断言；只对新增接入/绑定补缺口。
实施验收运行所有TS离线测试及相关lint/typecheck/build/export/artifact gates。
性能仅核实新入口未增加额外图/每事件转发、默认off，并使用现有同拓扑方法验证必要增量；
原1.20/1.10预算不变，失格方法不会在本批重跑，亦不把“分层完成”说成正式性能资格通过。

给human和agent提供同一证据包：简洁业务页、完整图下钻、前后源码绑定、provenance、独立
verifier、请求/结果与失败原因。答案键独立保存；真实参与者回答前不得透露预期答案。
机械验收可以证明入口/接线/行为一致，不能替代B121的人类理解度试验或root独立汇总。

## 7. Q5–Q9集中审查

**Q5 定位：** 这是现有solution的创建与暴露面设计，不是新kernel primitive。
部署/来源选择属于集成方；跨语言contract与Canvas产品UI不归本批修改。

**Q6 长期风险：** 最容易隐藏的是输入/授权接入成本，以及把UI清理误当运行结束。
通过完整应用启动示例、原owner引用和退订测试约束。公共真实host资格仍是明确发布前置，
不以mock成功补位。现有capability签发机制复用，不因分级新建注册表。

**Q7 简化与可解释性：** 一次完整构造，四组逻辑来源，多分支→原authority→最终guard→host；
结果由host source回原authority。展示绑定不改变图和执行；维护者始终能定位同一组节点。
不增加audience运行模式、按用户等级重建runtime或隐藏订阅触发业务执行。

**Q8 两个候选：**
- 直接暴露现有composeOfflineSpending全部参数：实现最少、手工组合明确，但普通应用作者
  仍承担binding/资源接线细节，难以证明渐进披露；作为维护者路径保留即可。
- graph绑定不可变配置＋一次compose＋view/capabilities分传：沿用D162既有候选形状，
  集中接入与默认值，保留原节点；代价是必须交付完整集成示例与默认值规则。
  两者均源自当前仓库路径，本次未借未核实的外部框架作先例。

**Q9 推荐第二项。** 对身份、可组合性、可解释性与lifecycle完全沿用现有约束；对易用性
增加真实示例与类型验收；对真实I/O资格、公共发布和B121用户研究仅给出明确边界，不称完成。
先交付完整私有离线使用链，足以审阅“如何接入、如何隐藏、如何下钻”，无需继续性能优化。

## 8. 审阅后的一批实施范围

请一次确认：采用上述创建形状；完整runtime固定；只允许name/diagnostics构造默认值；
三类使用者共享原view/capabilities/Graph；交付完整离线应用接入、值级展示绑定及全部验收。

实施顺序作为内部步骤：核实并实现私有创建入口 → 完整离线接入示例 → 三类使用路径与
证据下钻 → 类型/运行失败矩阵 → 全量离线gates → 一份总收据与commit。
普通内部步骤不再逐次请求继续。若出现新的公共语义或真实资源边界，才集中提交具体取舍。

本稿审批不会重批D160/D162/D170，也不追加新D#。若最终名称/defaults规则形成新的持久
package边界，审批后由TS唯一owner按现有ledger格式记录必要增量；实现授权与决定分开。
本轮仅提交这份可审阅设计，不修改owner状态、不启动实现、性能试验或真实资源调用。
