# 公共分层入口与生命周期展示：一次审阅稿

2026-09-14；源码基线 `26dc7350`。当前仅设计，所有拟议符号/路径都尚不存在。
依据 graphrefly-ts:D160/D161/D162/D170 与 graphrefly:B139；唯一 package owner 为 graphrefly-ts。
本轮不实现、不发布、不改wave、不执行真实inbox或provider/live/spend，也不重开性能优化。

## 1. 推荐与你需要确认的决定

**推荐：公开轻量业务观察面和明确标为 testing 的离线创建面；完整运行不按用户等级裁剪。**
框架组合传原能力引用，验证预期实例时使用可信原引用；普通界面新增图侧收尾条件，但不把
它叫“运行已结束”。真实宿主尚未合格时，不把离线callback包装成可生产执行的solution。

一次确认以下五项即可作为后续完整实现包的设计依据：

1. 两个focused subpath：`solutions/spending-alerts`只提供观察/组合面；`testing/spending-alerts`
   提供明确离线创建。root/core/patterns大入口不新增本业务导出。
2. 创建继续 `spendingAlertsFor(graph, defaults).compose(inputs, overrides?)`，不新增assurance
   档位；从资源绑定派生内部CausalBinding，用户不手填construction-v1/full等实现常量。
3. 下传原identity/execution/retained；新增只读 `assertSameCausalCapability(expected, actual)`，
   验证可信预期原引用与传入引用一致，不新建registry，不替代currentness或执行许可。
4. 公共view保留五端口，再加原 `runEndReady` Node 的业务投影名 `graphEndEligible`。
   true只显示“图侧收尾条件已满足”；没有actual end事实时，不提供`ended`/`completed`字段。
5. 构建产物在每种模块格式内保留单份内部模块身份，公共子路径只是薄入口；同实例的有状态
   ESM/CJS混用不支持，跨子路径同格式必须支持。这是必要的打包工作，不是只加两个export键。

这是新的公共边界与私有view增量，需要本次设计批准；不是重批既有单authority/C事务，
也不是把普通“继续”解读成发布或真实宿主实施批准。

## 2. 现有事实与设计起点

| 已核实位置 | 当前事实 | 意义 |
|---|---|---|
| `causal-entry.ts:48` | 配置零节点；compose调用现有完整host；只支持name/diagnostics | 保留形状，不再创造第二个创建系统 |
| `capabilities.ts:67` | 当前验证需要full+graph+CausalBinding，校验签发/内部lineage | 子集消费者不应被迫拿full来验证一个原引用 |
| `capabilities.ts:45` | 已有issued WeakMap，保存graph/instance/binding/level | 复用既有签发身份，不新增表、缓存或全局runtime状态 |
| `causal-preset.ts:171` | 原五端口assessment/publication/coverage/issues/startup | 普通组件不需要输入lane/authority，但目前没有整图收尾条件 |
| `causal-focused-host.ts:499` | runEndReady以quiescence、committedEffects、local、pack为显式deps | 可复用已有Node，不需为展示再扫描一遍authority |
| `causal-focused-host.ts:567` | inspect.normalEndReady额外检查fault/inFlight/scheduled/delivering | 图侧条件不能替代宿主完成，更不是已经end |
| `causal-publication.ts:2`、inputs/material-owner | Node crypto、Buffer依赖 | 离线构造目前限定Node；轻量观察入口不得把这些依赖拉进浏览器 |
| package.json、solutions/index.ts、core/index.ts、patterns/index.ts | 无公开causal-occurrence/spending子路径 | 本设计是新公共面，不是修改已有用户API；不得默默export *内部目录 |

本工作区没有live Codegraph index；核实使用实际源码/导出配置和rg，不创建索引。
现有shared-control-panel-authority focused facade、patterns/event-flow与testing focused面是
package内的入口分工先例；它们不证明本spending宿主已经取得生产资格。

## 3. 三类用户如何进入

以下为批准后目标代码，不是当前可执行import。

```ts
// 普通组件：只使用观察面，不加载Node-only host。
import { observeSpendingView, type SpendingView, type SpendingViewObservation } from '@graphrefly/ts/solutions/spending-alerts';
function mountPanel(view: SpendingView, render: (x: SpendingViewObservation) => void) {
  return observeSpendingView(view, render); // cleanup只结束观察
}
```

`SpendingViewObservation`的值是各端口最近观察值，
不是事务快照。ERROR/INVALIDATE清除相应旧值；缺事实不补成功；展示绑定不创建Node。
普通用户愿意直接compose原Nodes也可以，用户等级不是权限墙。

```ts
// 应用接入/框架测试：此路径公开声明离线模拟。
import { spendingAlertsFor, offlineAlertResource } from '@graphrefly/ts/testing/spending-alerts';
const resource = offlineAlertResource(binding, simulatedWrite);
const preset = spendingAlertsFor(appGraph, { name: 'alerts' });
const app = preset.compose({ evaluations, verification, localAuthority, inbox: { resource } });
mountPanel(app.view, render);
// 应用保留app.owner、app.inspect；组件只得到view。
```

`binding/simulatedWrite/evaluations/...`由应用集成提供；完整demo随包示例一起迁移，不用这段
简写冒充零接入成本。评估pack/current/arrivals、独立verifier receipt、本地grant/stop及资源
绑定仍有明确责任方。offlineAlertResource接受callback只属于testing模拟，不签发真实host资格。
框架手工组合仍可通过原Node引用与既有Graph操作；不把cold-builder、scope或完整内部ports
作为公共装配协议暴露出去。任意业务causal runtime创建仍不是本批承诺。

```ts
import { assertSameCausalCapability } from '@graphrefly/ts/solutions/spending-alerts';
const expected = app.capabilities.execution; // 由可信应用装配选择目标实例
function attachExecution(actual: unknown) {
  assertSameCausalCapability(expected, actual);
  // actual就是该原execution；所需identity为actual.identity。
}
```

维护者通过原 `appGraph.describe()`、原capabilities与应用owner诊断下钻。观察入口没有
隐式开启summary、重建runtime或隐藏节点。源码绑定、provenance与独立verifier仍是三份独立
证据；本设计不发明源码→节点映射或把无映射文件diff标为所有节点实现变化。

## 4. 导出、模块与认知边界

| 路径 | 拟议公开内容 | 不公开的内容 |
|---|---|---|
| `@graphrefly/ts/core`、`/graph` | 现有基础API保持原状 | spending factory、host和业务类型不加入 |
| `/patterns` | 保持现有横向组合模式 | 不把单consumer能力强推为新的通用pattern |
| `/solutions/spending-alerts` | observeSpendingView、assertSameCausalCapability；SpendingView、SpendingViewObservation、SpendingViewValues；CausalCapability union与原四种capability只读类型 | runtime constructors、authority state、transition、writer、raw outcome source、cold manifests |
| `/testing/spending-alerts` | spendingAlertsFor、offlineAlertResource；不透明OfflineAlertResource类型、SpendingDefaults/Overrides/CreationInputs、SpendingBinding及构造所需输入帧类型、离线composition结果类型 | 真正生产inbox的认证、任意effect执行器、自动许可、fixtures固定grant/oracle样本 |

本稿附[精确named-export清单](proposed-exports.json)，批准后作为验收断言，禁止通过 `export *` 扩大以上集合。
输入帧类型限现有Evaluation/EvaluationPack/ArrivalFrame/CurrentFrame/VerificationFrame/
LocalAuthorityFrame及它们引用的公共数据类型；内部材料索引、Checked、hash/helpers不出口。
`offlineAlertResource(binding, simulatedWrite)`返回既有资源实例的窄类型引用，公开仅kind/binding，
不公开claim/transfer/abort/write方法；DTS用不导出的unique symbol必需brand保留名义类型，
禁止仅用Pick生成可结构伪造的资源类型。brand只是声明期约束，不生成新runtime token。
内部class仍由现有constructor/claim逻辑拥有，工厂不新建
另一资源表。不能仅凭结构相同的数据伪造实例，原instanceof/绑定校验仍执行。此helper是测试
资源构造，不是触发effect；callback只由原guard路径调用。

公开离线结果精确为 `{ view, capabilities, owner, inspect }`。不使用`...host`泄漏guard/source/
built/afterStart，不额外导出consume别名；内部consume.view与public view保持同一原对象。
owner保留原OwnedConstruction身份，作为testing高级检查/强制清理的明确例外，包含原root
leases；它不成为普通组件依赖，也不是生产生命周期API。手工unsubscribe roots只可在测试
强制清理中使用，不能产生正常结束证明或结算未回结果；完整example明确区分这一步。
inspect保留现有只读host诊断，返回快照的成本只在调用时产生；普通观察不自动调用。

capability类型保持既有 IdentityCapability/ExecutionCapability/RetainedEvidenceCapability/
FullCausalCapability 名称与结构；不再创造三个同义的“用户级”类型体系。

源码归属推荐：观察类型/绑定/只读验证放 `packages/ts/src/solutions/spending-alerts/`；
离线host与创建入口放 `packages/ts/src/testing/spending-alerts/`；被两者共享的business/contracts
留solution内部目录。现有causal-occurrence内部位置保留，避免为本批搬整个library。
运行时代码迁移而不是复制一份；example只保留应用接入/业务面板，内部import和测试统一迁移，
无兼容别名。顶层barrel和其他subpath依赖闭包应字节级不扩大到Node-only host。

观察包只需类型依赖Graph/Node；值级绑定调用传入Node.subscribe。测试模块依赖观察/业务层，
反向运行时依赖不允许。浏览器bundle必须确认没有node:crypto、Buffer使用或host初始化。
真实生产 `solutions/spending-alerts` factory 何时可发布需其真实host contract合格；本批不是
把testing factory偷偷别名导出到solution。将来有生产能力也无需为了兼容而保留不合理形状。

### 4.1 打包必须保留模块身份：本批实际范围的重要增量

源码的 `issued` 位于capabilities.ts，`graphRegistrations` 位于graph/graph-lifecycle.ts，
都是模块局部WeakMap。现有tsup多入口ESM/CJS配置不能仅靠源码import相同就证明运行时单份。
分开的Graph入口与testing构造入口若复制后者，会在注册检查失败；solution validator与testing
签发若复制前者，也会拒绝合法原引用。源码单入口测试不能验收这一点。

推荐统一**构建产物**的模块身份，不修改Graph的语义或注册设计：所有现有和新增公共入口
生成薄facade，转到同格式canonical内部模块树，内部依赖保留相对导入，不能各自再次bundle。
示意为 `dist/esm/...` 与 `dist/cjs/...`；CJS树以局部package.json标commonjs，稳定的现有
`dist/*.js`/`*.cjs` facade维持package export布局。DTS按对应模块树生成、闭包完整。
这条规则覆盖全部公共facade的产物，业务源码和分层位置不用全库改写；不能仅迁移新的
testing入口而继续导入另一份旧Graph bundle。生产revision define、runner资源、sourcemap、
第三方external规则以及type/Node/browser条件分支都保留原构建契约，逐项验收。
同时遵守graphrefly:D647的manifest零runtime依赖要求（通过TS历史owner locator解析），
不能为了新的构建产物给消费者加依赖。

每个格式树内，Graph/core/solution/testing都解析到同一份graph registry与capability发行模块。
ESM与CJS树之间明确是两个runtime身份域：不把Graph/Node/capability/resource跨格式混用，
必须在构造预检/引用验证处拒绝而不留资源。两个独立安装副本同理。浏览器观察纯值订阅不
声称解决跨realm身份认证。不得通过globalThis、Symbol.for表、重复registrar或全局instance
缓存“修好”跨格式共享；若未来需要跨格式有状态互操作，应另行设计而不是放宽此批门槛。

模块保留可能增加磁盘文件数、冷加载模块数和启动I/O；不能拿“节点数没变”替代这项成本。
实施验收需固定同机器同Node的基线/候选冷import对照，报告实际加载模块、安装体积与延迟，
复用现有适用预算，不把旧构造预算冒充已批准的import新门槛。若发现新的显著代价，作为
公开发布的未决取舍反馈，不能默许或自行展开无限优化；本设计尚无数据证明其成本可接受。
这是构建输出层面的明显范围增量，要在批准时一并看到成本。若不接受这项工作，替代方案
是暂不公开有状态factory/validator，只继续私有示例；不能声称两个独立bundle已满足本设计。
验收必须用实际安装产物：Graph分别从root、/graph构造，Node从/core接入，factory从/testing，
checker从/solutions，分别以纯ESM和纯CJS组合。另测试混格式/重复副本失败原子性。旧全部
subpath smoke、browser bundle与包内依赖解析都通过，才可认为这次打包迁移没有破坏其他入口。

## 5. 能力与binding：保留身份，不增加协商协议

现有两种binding职责不同，不能合并成一个万能config：SpendingBinding绑定业务来源、
政策证据所依赖的源码/runtime、目的地与composition/host epoch；CausalBinding是内部
contract/implementation/scope/epoch约束。应用选择前者；preset沿用固定full构造，内部机械
派生后者并校验，不向普通人暴露 `construction-v1` 字符串，不猜测业务digest或grant。

拟议验证签名：

```ts
function assertSameCausalCapability<C extends CausalCapability>(
  expected: C, actual: unknown
): asserts actual is C;
// CausalCapability是四种原签发handle的type union，无新实例对象。
```

验证规则是**可信expected必须在既有issued表中，然后actual===expected**。这足以同时确保
同一个graph/instance/level/原对象；不得只比较shape、binding或epoch。full的既有内部lineage
校验继续保留在构造/既有验证路径，不在每个UI事件再全量检查。冻结handle不能被替换成员。

expected必须由装配方从目标composition捕获。若攻击者同时决定expected和actual，API无法
判断应用真正想要哪个实例；这不是sandbox。跨进程序列化/结构复制永不作为合法handle。
同graph同epoch的另一真实实例在本检查下也拒绝，因为它不是expected原引用。
验证旧实例原handle仍可用于历史观察，不能据此认定当前许可有效或恢复已经结束的runtime。
真实release/dispatch始终走现有currentness/admission/host guard。

为什么不新建instance token或graph registry：应用已经持有原引用，额外token会复制同一
身份信息并增加生命周期清理问题。为什么不让子消费者拿full：会抵消渐进披露。为什么不
提供“任意合法子capability升级”：那是另一个组合/信任协议，当前consumer不需要。

## 6. 生命周期：展示收尾条件，不创造结束事实

**推荐增加原view第六个只读Node引用 `graphEndEligible: Node<boolean>`。** 它就是当前
`runEndReady`节点，id/factory/deps不改，不创建转发Node，不另存条件Map。最终host组装时一次
创建公共view，`app.view === app.consume.view`；内部五端口中间对象不再冒称完整公共view。
G/M两种装配采用同一个final view组装点；原五个Node引用全部保持。

| 观察 | 允许显示 | 禁止推出 |
|---|---|---|
| startup无DATA/ERROR | 尚无启动事实/启动事实不可用 | 已启动 |
| startup started | 已启动 | 业务成功、已获准、运行已结束 |
| graphEndEligible缺值 | 尚无图侧收尾事实 | false=拒绝、true=完成 |
| graphEndEligible false | 图侧收尾条件尚未满足 | 整次运行失败；某个特定effect失败 |
| graphEndEligible true | 图侧收尾条件已满足；宿主结束尚未证明 | writer已排空、所有投递完成、owner已释放、可以清记录 |
| publication succeeded | 该精确请求有成功结果；离线仍显示模拟 | 全run完成、coverage完整、作者身份已证明 |

现有图条件涵盖pack frontier、stop、各domain lifecycle/retained quiescence、没有pending，
以及结果不是unknown/reconcile-required。**true不是不可逆终态承诺**，新事实/失效可使其
改变；显示必须遵从DATA/INVALIDATE/ERROR，重连缺事实就回unknown，不能继承旧UI缓存。

`inspect().normalEndReady`是应用诊断时刻的额外宿主检查，不是响应式业务Node，也不是已经
执行了end生命周期。普通绑定不轮询inspect、不读cache、不加timer。在已有宿主尚无精确
结束事实的情况下，宁可明确不显示“已结束”。未来真实host end/release证据需单独锁定；
不能仅加一个布尔值或把UI退订当end来完成它。

UI cleanup只解除观察，runtime owner/root仍掌握未结义务、故障及记录。无故障不等于无义务；
record/outcome保留按现有有限contract，不能因graphEndEligible=true提前删掉authority记录。

## 7. Q5–Q9：三个相互关联的设计点

### 入口与模块

**Q5** vertical观察与离线testing各归其层；core不应承载spending。只有一个真实consumer，
不足以公开通用causal runner或新pattern。**Q6** 主要风险是从Node-only实现泄漏依赖，以及
使用者把测试writer误当生产host；用物理subpath和打包负例约束。**Q7** 同一套节点构造，
轻入口无初始化和额外节点；移源码不复制实现。**Q8** A直接把全部私有实现export到solution：
接入短，但暴露模拟writer与低层协议；B分观察/离线创建：职责清楚、增加一个明确测试路径。
现有focused facade/testing分工支持B。**Q9** 选B；partial是生产factory仍无资格，公开名称不
制造执行权限。部署生产前置继续由B121相关owner资格承担。

### 原能力验证

**Q5** 精确原对象检查是现有签发机制的只读辅助，不是授权primitive；要求4.1的同格式模块单份身份。**Q6** expected的可信
来源必须文档化；不能跨进程或验证作者。**Q7** expected已有身份，O(1)lookup+相等，无新表。
**Q8** A所有消费者传full+两类binding：沿用旧函数但暴露过多；B可信expected原子集对比：
参数少且精确指定实例；C新增token：多一套身份。既有issued/冻结lineage是B的源码先例。
**Q9** 选B；type安全与运行签发都覆盖，跨信任域远程认证不覆盖且非本slice目标。

### 生命周期展示

**Q5** 本consumer的收尾条件属于solution观察，不改wave COMPLETE语义。**Q6** 命名最易把
条件当终态，需上述真值表与unknown显示。**Q7** 复用原runEndReady和显式4deps；没有新的
扫描、闭包cache或宿主消息回路。**Q8** A保持五端口只给owner诊断：最少变化但普通界面无
收尾线索；B第六原端口仅展示graph eligibility：明确可解释且零新节点；C另造host-completed
Node：当前没有精确结束来源，必须先设计新的宿主终态契约。**Q9** 选B；覆盖可见性和性能，
不覆盖实际end证明。残余风险用文案/反例限制，C不在本批夹带实现。

### 交叉检查

同一个输入：两个实例共享Graph，各自独立inputs/resource/epochs；A请求未回时UI退出，
B图侧可收尾。A的execution不能通过以B.execution为expected的检查；B.graphEndEligible
不能结算A；切换观察不重建instance。绑定派生、原能力身份和生命周期展示在这一个场景
同时成立才通过，不分别绿灯后假定可组合。

## 8. 一次批准后的实施与验收包

按一个完整批次迁移/实现/测试/QA/commit，不要求你逐文件继续。构建产物规则涉及全包入口，需要完整package gates；运行时语义改动仍集中在spending
example、上述两个focused目录、capabilities只读helper、package exports/build配置与相关测试。
不改所有模块、不改authority transition、构造C协议、数值算法或host记录状态机。

| 验收 | 必須证据 |
|---|---|
| 分层导出 | proposed-exports.json精确清单；安装产物跨root/graph/core/testing/solution同格式共享身份，混格式/重复副本拒绝；名义资源DTS负例；ESM/CJS/DTS与类型负例；普通入口browser bundle无Node host依赖；包内无examples反向import |
| 创建默认值 | config零节点、默认off、override不污染、错误配置/graph/epoch/resources预转移原子失败；复用原24测试并迁移import |
| 原能力 | 每层原对象通过；copy/cast/未签发expected/wrong level/不同graph/同graph不同instance拒绝；不授予执行或升级权限 |
| view | final view唯一；原5Node+第6原Node精确引用；G/M一致；观察0新增Node、无网络/I/O、无按UI创建runtime |
| lifecycle | started但pending；graph条件true但host仍scheduled或fault；unknown/reconcile；缺dep与ERROR/INVALIDATE；全部不得显示ended |
| 组合 | 上述A/B交叉场景；detach/reconnect仍承担A义务；B结果不能settle A；图证据与原capabilities同实例 |
| 有效验证 | 覆盖新增分支的真实runtime mutation，删除/改错预期实例检查与eligibility依赖会失败；复用未变authority旧证据，不乱改冻结收据 |
| 整体gate | 所有TS离线测试、lint/typecheck/build/export/artifact；独立QA修复；完整实际应用例子与审阅包；显式commit |

性能要求：新增公共配置/验证/观察不得增加runtime node数、热路径JSON编码、注册表或定时器；
唯一新增view字段复用现有Node。绑定会增加一个订阅，这是实际增量，需要检查清理/重连且
记录构造和事件计数。只做本改动必要的增量验收，不重启原性能矩阵，不改1.20/1.10预算；
若测量发现异常回退，保留结果并先核实本diff，不把发布声明变成当前性能资格通过。

正式人工实验、等价完整plain host与真实inbox、root B121汇总、通用导航/B134不混入本实施包。
新公共面通过离线验收也不等于B121完成或真实效应获准。

## 9. 拟议决定的登记边界

分类为TS package-local公共接口/展示语义决定；拟在批准后登记到 `decisions/decisions.jsonl`，
由owner届时分配D号。本稿不抢占编号。concerns：ts.spending-alerts.public-entry、ts.spending-alerts.capability-reference-
validation、ts.spending-alerts.lifecycle-eligibility-display、ts.package.module-instance-identity。decision_kind=durable-architecture；change_kind采用owner
合法枚举的partial-supersession，范围仅D162原私有五端口展示边界；protocol_impact=none。
D160完整closure、D161构造所有权、D170host完成机制不被替换。

complete_when：本设计获明确批准并登记唯一owner及不可变设计证据，设计完成不等于实施完成；
实施完成另由第8节验收收据判断。historical_when：
后续owner决定替换公开形状或真实host契约。批准设计与实际实施授权分开记录；本轮仅请求
对第1节五项及第8节完整批次范围审阅。没有新执行D、没有改root B121状态或旧收据。

## 10. 审阅依据与当前验证状态

- [创建入口](../../../examples/spending-alerts/causal-entry.ts)、[宿主与收尾条件](../../../examples/spending-alerts/causal-focused-host.ts)
- [原能力签发与校验](../../../packages/ts/src/solutions/causal-occurrence/capabilities.ts)、[Graph注册表](../../../packages/ts/src/graph/graph-lifecycle.ts)
- [当前构建配置](../../../packages/ts/tsup.config.ts)、[精确拟议导出](proposed-exports.json)、[源码哈希](source-audit.json)

独立架构审查指出了模块局部表跨bundle复制，以及opaque资源结构类型泄漏；已把统一产物
身份、实际包组合测试和声明期brand纳入设计。没有为设计运行全量测试或做新性能试验。
当前设计的通过不等于拟议实现已验证；源码基线与引用检查仅证明审阅基于哪些文件。
