# Approved spending-alerts audience design — audience-v1

2026-09-07。用户在任务 01a077c7-55e6-7f11-9d4f-e7c51944afb4 审阅返回 `{ view, capabilities }`、四组显式输入、完整冷接线与一次所有权移交以及 E1–E10 / Q5–Q9 后回复“同意”。这批准入口设计，未批准实现或 effect 执行。

持久入口边界见 `graphrefly-ts:D162`；设计工作见 `graphrefly-ts:CAUSAL-PRESET-AUDIENCE-DESIGN-TS`。本目录 manifest 绑定审阅稿摘要、此正文及设计/构造前置证据。D160/D161 的其余约束继续有效；详细私有 builder 接入和有限实施切片仍需在落码前具体化。

以下保留用户审阅的原文；其中“待审阅/本轮只读/未入账”描述原设计回合，不替代此批准状态，也不表示实现资格已经通过。

---

# Spending-alerts：分级入口与验收设计

2026-09-07。状态：**供用户审阅的设计提案；没有实施、公共导出、决策或 work 入账。**

本轮授权是继续上一轮提出的 package-private preset 入口设计。采用 project-governance、decision-guard、design-review；本附件不替代已冻结的 canonical design，不改写历史收据。唯一 package/consumer owner 为 `graphrefly-ts`；root 保有 D793 consumer 选择与 B121 独立汇总验证。当前完成的 composition-design work 不重开、不借其 complete 状态派发新实现；批准实现时再按唯一 owner 登记有限实施切片。

## 1. 推荐的具体形状

**同一个完整运行实例，返回业务 view 与精确 capabilities 两组引用。普通用户只拿 view；框架作者接 capabilities；维护者沿同一个 Graph 检查完整拓扑与证据。**

这延续 [D160 的 package-private preset 方向](/Users/davidchenallio/src/graphrefly-ts/docs/design/causal-composition-v1.md:100)，本次细化其返回对象和使用边界。候选 `.view` 分组与下面字段名待本次审阅；不增加 `audience` 模式、不构造三套 runtime、不将 identity-only 包装成低成本 runtime。

普通用户并不需要先理解 occurrence/admission/八条 lanes，但仍需知道四个业务责任：评估输入、独立验证、操作许可、发布目的地。框架可以准备这些输入，不能隐式替用户批准操作。

## 2. 当前事实与缺口

| 事项 | 本轮核实 | 可以得出的结论 |
|---|---|---|
| B139 / D793 | spending-alerts + exact-admitted local inbox 已选择 | 本轮不再比较或更换 consumer |
| CAUSAL-COMPOSITION-DESIGN-TS / D160 | complete；完整闭包、off/summary、有限 immutable preset 已批准 | 设计完成不等于入口已实现 |
| CAUSAL-CONSTRUCTION-OWNERSHIP-TS / D161 | complete；ts-v8 的 98 项绑定文件摘要全部匹配 | 构造/启动所有权资格可作为前置证据；不是 preset 资格 |
| 三组 capability | [capabilities.ts](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/capabilities.ts:22) 已有真实 frozen identity/execution/retained 对象和 lineage 检查 | 可以复用；不可复制对象后冒充精确 capability |
| `causalComposition(app).composeFull(...)` | [causal-occurrence.ts](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence.ts:106) 已存在，返回前执行 startConstruction | 不能把它当尚未启动的可追加 builder |
| 现有 consumer | [pipeline.ts](/Users/davidchenallio/src/graphrefly-ts/examples/spending-alerts/pipeline.ts:134) 自建 Graph、暴露 feed，profile/threshold/justifier 部分在闭包中 | 保留真实算法与具名关系；新路径须落实已批准的 graph-first、有限输入 prefix 和政策 DATA |
| npm 边界 | package exports / solutions barrel 没有 causal/preset 入口 | 此轮三类调用均是 workspace 内设计，不声称外部 npm 用户已能使用 |

ts-v8 receipt SHA-256：`a30c53ed2f19834089a2a74d8d5ff791426d2eeb8ce773b0b11043c48fbb5628`。本轮检查摘要和 owner 状态，没有重跑或重新宣称 2221 项测试通过。

## 3. 三类用户的调用示例

以下是**候选调用草图，不是当前可运行 API**。使用现有 `Graph` 起手；四组输入已经由同 graph 的具名 Nodes 或受限 host binding 提供。`inputs` 不是预先通过的验收证据包，更不是可以塞任意对象的 options bag。

### 普通用户：业务输入进，业务事实出

```ts
const app = new Graph({ name: "spending-alerts" });
// evaluations / verification / localAuthority / inbox 由明确的数据源提供。
const alerts = spendingAlertsFor(app, {
  limits: retainedBriefLimits,
  diagnostics: "off",
}).compose({ evaluations, verification, localAuthority, inbox }).view;

// alerts 只有这五项；每项是声明式输出 Node。
const { assessment, publication, coverage, issues, startup } = alerts;
// 展示组件接这些 Node；不调用 feed / publish / approve / retry / dispose。
```

`assessment` 表示评估结果，不能因 flagged 就显示已发布；`publication` 表示有相关证据的发布进展/结果；`coverage` 保留证据完整性和 unknown；`issues` 给出有限原因；`startup` 保留 starting/started/faulted 与实例/epoch 关联。startup=started 不能代替 effect admission。

普通 view 是真正独立的 frozen 小对象，运行时 keys 不含 capabilities、authority state、八条输入 lane 或 host 函数。不能只用 TS 的 `Omit` 隐藏同一个大对象。实例即使只剩 view 被引用，运行所有权仍属于 graph。

### 框架作者：同实例的能力按需交给组件

```ts
const app = new Graph({ name: "spending-alerts" });
const composition = spendingAlertsFor(app, defaults).compose(inputs);
const ordinaryPorts = composition.view;
const identityPorts = composition.capabilities.identity;
const executionPorts = composition.capabilities.execution;
const retainedPorts = composition.capabilities.retained;

// 组件以其所需 capability 为参数；只交付原始精确引用。
// executionPorts.identity === identityPorts
// retainedPorts.execution === executionPorts
```

composition 推荐只有 `{ view, capabilities }`；capabilities 复用底层 `FullCausalCapability`，startup 与 view 对齐。这里只传递引用，不重新组装/签发 authority，不允许用 spread 或结构断言“升级” lower handle。全量输入接线依然由 preset 内具名图完成；需要自定义有限拓扑的框架作者保留既有私有 composeFull 路径，不加入任意 runner 或插件注册。

“execution”是生命周期与执行记账的能力层，不是可调用的执行权限。现有 ExecutionCapability 没有 committed inbox request port；获得该 handle 不能调用 filesystem effect。

### Library 维护者：同一图检查，证据另行核实

```ts
const app = new Graph({ name: "spending-alerts" });
const composition = spendingAlertsFor(app, defaults).compose(inputs);
const snapshot = app.describe();
const startup = composition.capabilities.startup;
const conservation = composition.capabilities.execution.conservation;
const coverage = composition.capabilities.retained.coverage;
const quiescence = composition.capabilities.retained.retainedQuiescence;
```

维护者检查真实 input→business→authority→projection 关系、启动事实、未结 effect、retained coverage；源码 binding/provenance/verifier artifact 由证据包提供。`describe()` 可达性不能证明实现未变或后果等价，startup 也不是整个 lifecycle 的终点。不新增可改写 authority 的调试 setter。

此分级是易用性和显式能力传递边界，**不是对持有完整 Graph/同进程任意代码的安全沙箱**。保留完整 inspectability 是用户目标的一部分。

## 4. 四组输入：隐藏接线，不隐藏授权事实

| 输入组 | 显式内容及 owner | 缺失时的行为 |
|---|---|---|
| evaluations | consumer 输入 owner 的 bounded transaction prefix（含当前交易）、profile、统计/阈值政策、run/domain/revision、exact source/runtime binding；每组关联一致 | 没有值可以等待；非法/超界事实为有界 issue，不能默认旧政策通过 |
| verification | 独立 verifier 的 receipt DATA，绑定 source/runtime/input/policy/request 与 verifier revision | 缺失保持 pending；错绑定或明确失败拒绝发布，不从 graph 的“pass”标签生成 receipt |
| localAuthority | 本地操作 owner 的 scoped grant、当前 binding、逻辑时间、stop/revocation facts | 缺 grant 不执行；时间/撤销变化经 Node 消息进入，禁止每次执行窥读全局变量 |
| inbox | exact qualified focused binding 加上 readiness/outcome Nodes；真实 host 管私有 I/O 资源 | 类型缺口在构造期拒绝；暂不可用为 DATA，不借默认 runner 绕过 |

这四组不是四个吞掉所有字段的大 Node：可用有名字段组成的只读 Node 集合，或已批准的关联 snapshot。真正变化的政策/许可/时间必须出现在 deps/message flow 中。冻结配置只选 limits、diagnostics 和精确 binding 等构造参数；配置本身不产生覆盖或许可事实。

默认 diagnostics=off；summary 只增加声明的诊断产物。两者都必须给出相同业务、授权、义务与必要 coverage 事实。override 仅构造新冻结配置，undefined 继承；没有运行中切换、替换、自动重建。新 binding 不复用旧 receipt/grant。完整 stop/drain/replacement 不在本切片。

## 5. 最小真实拓扑与构造边界

沿用 [design-v1 的非回灌拓扑](/Users/davidchenallio/src/graphrefly-ts/docs/design/causal-composition-v1.md:126)：

```text
evaluations ─┬→ transaction ────────┐
             ├→ vendorStats ────────┼→ anomalyScore → thresholdGate
             └→ userProfile ────────┘                    ↓
policy facts ────────────────→ thresholdGate / reasonFactors → alertMessage
                                                       ↓
                         assessment / explanation / publication-policy terminals
                                                       ↓
proposal + verification + localAuthority + inbox readiness → admission facts
eight explicit lanes → single causal authority → existing exact capability projections
                                                       └→ consumer business view
```

完整发布还需未来已批准方向中的 committed exact request→quiet handoff→final current dispatch guard→focused inbox；真实 I/O outcome 从外部 source 返回。上图不能被当作已接通 effect 的证据。候选业务计算置于 admission 前；不接 released→业务→同一 authority 的同步回灌。

**构造建议：全部消费者节点和输出先冷构造，再一次移交，最后启动。** 当前 buildCausalComposition 是私有自持 scope 且返回前 start；未来 preset 若直接在其返回后追加业务投影，会留下后半构造失败及早期值遗漏的风险。推荐复用 C 的私有 cold scope/build 机制，使完整 manifest、所有输出和必要 roots 在启动前就绪；不添加公共 begin/commit，不用 ambient scope，也不以 try/catch 删除已启动实例。

这一点是必要的后续实现工作，ts-v8 没有验收整个 preset。落码前需确定私有 builder 与 consumer assembly 的明确调用边界；若不能在 D161 下保持一次 owner 移交，报告具体冲突再审阅，不能退化成两个独立启动且互相补救的实例。

预移交失败遵守现有冷资源清理、ID retirement 和 cleanup-error 报告，不要求失败后 ID 历史字节完全回滚。移交后故障返回同一 faulted 实例，保留既有义务和资源定位；UI 退订、错误 outcome、没有输出都不能结算义务。正确 exact outcome 到达健康已连接路径时才可能结算；不保证 faulted 实例自动恢复。

动态移除必需依赖不是本 preset 的合法配置操作。支持路径必须检测不兼容或保持 fail-closed/pending，绝不能偷偷补节点或用缺值产生许可。运行时删边作为 adversarial mutation 检查真实后果，不靠拦截所有 substrate rewire 扩大协议。

## 6. 入口验收：不是看起来短就算成功

以下均为待实施验收。每项同时跑 diagnostics off/summary；类型失败、结构失败、运行行为失败分开记录。

| ID | Given / When | 必须观察到的结果 |
|---|---|---|
| E1 普通路径 | 仅以四组具名输入构造并接五个 view ports | 无八 lane 接线、admission 手工创建、深层 capability import；运行时 view keys 精确为五项；无 imperative 发布方法 |
| E2 精确能力 | 从一次 compose 获取三组 handle；复制/混搭其他实例、graph、epoch 的 handle | 原件关联恒等；伪件和不匹配在允许消费点拒绝。缺前置能力编译不通过，强转也不能绕过运行验证 |
| E3 隐藏与诊断 | 相同输入分别 off/summary；普通组件只接 view | 必要业务/许可/coverage/outcome bytes 等价，额外诊断按声明归一；identity view 不泄露 retainedQuiescence；完整 Graph 仍可描述 |
| E4 空输入 | 合法 source 尚无 DATA，后续先到 policy/verification 再到 evaluation | 不产生假 assessment/pass/success；按 exact refs 等待，不读 cache 拼接不同修订 |
| E5 冷失败 | 缺必需 Node、错 graph/binding、重复名字、不支持的 runtime profile | 预检不激活；冷期失败清理本次已取得资源并报告清理错误；旧 graph 消费者不受破坏；host calls=0 |
| E6 启动中失败 | 已移交且 authority 可能接纳 effect，随后启动故障 | 同一 faulted 实例可见；没有自动重试/重新签发；在途记录保留，真实执行边界保持关闭 |
| E7 退订与再订阅 | 未结 effect 期间全部 UI 退订，再订阅；中间送错 outcome，再送正确 outcome | 不因退订 settle/evict；错 outcome 不结算；正确 outcome 才结算一次。再订阅只取得现有保留界限内事实，不许诺无限历史重放 |
| E8 丢依赖 | 实际移除 policy/verification/currentness/terminal/authority 输入之一 | 缺事实保持阻断或明确拒绝；原 active obligation 不消失。删 required-edge 后仅 describe 报错不算行为证明 |
| E9 算法编辑与汇合 | n−1→n 同拓扑负例、sample 等价正例；两 vendor 与三 branch 交错 | 实现变化、关联与判定如 root S1–S4；缺 branch 不补 skipped，不借错 key 终态。独立 verifier 的完整验收单独归属 root brief |
| E10 replay/负对照 | 同 ID 同事实重放、同 ID 换 payload、普通无异常交易 | 不重复记账，冲突不覆盖首事实；正常交易真实 no-publish，不能用“没日志”判成功 |

**分级隐藏的成功标准：**E1/E2 的类型样例和运行时对象字段检查通过，E3/E7/E8 证明隐藏没有削弱依赖与 lifecycle；另外由用户用普通 view 回答“结果是什么、为何未发布、是否缺证据/启动失败”。类型检查不能替代可理解性审阅，也不声称已经完成普通用户试用。

所有离线测试仍属于后续实现验证范围：既有 default 全量、长时离线、browser、lint/typecheck、build/export/artifact、authority/workspace 与相关 causal/construction mutations；具体 runner/预算在实施批次记录。此设计轮不运行测试来制造新资格。

## 7. 效果授权与证据分界

沿用 root brief S1–S8，不在本轮重定义 verifier/plain/人-agent 实验：独立两遍统计 oracle 和独立状态记账不得 import consumer/preset/authority 算法；plain arm 保持相同输入、许可、失败/replay/保留要求；人/agent 收到相同 bounded packet 与检索预算，隐藏答案用于事后评分。

入口切片的后续证据应包括三份调用样例、精确输出字段/类型检查、实际 describe、同输入 off/summary traces、资源所有权快照及源码修改绑定。构造标识 `implementationRevision: construction-v1` 是当前能力兼容坐标，**不能充当 vendorStats 的源码摘要**；谁改的需要独立 provenance，后果不变需要当前独立 verifier。

**实际写入证明仍有独立门槛：**已登记 obligation 的 exact admitted request 必须携带匹配 occurrence/payload/source/runtime/input/policy/verifier/grant/binding，在真正 dispatch 时仍 current 且未消费；host 只做 focused I/O。随后外部读回 inbox bytes 核实 outcome，不以 spy 或 UI 状态代替。analysis replay 永不写入；同 epoch 精确重放最多一次，跨崩溃 exactly-once 不在此证明中。

真正的授权路径 mutation 必须改运行代码/依赖并保持程序可执行，然后观察错误请求是否到达实际 host/inbox。编译失败只算静态拒绝；结构检查阻断只算结构保护；冗余 guard 使 mutant surviving 则如实记录。入口批用 no-I/O 受限边界记录器只能证明接线/阻断，不能据此宣称 B121 或实际 inbox 验收通过。

## 8. Q5–Q9 审查

### Q5：抽象和层级

consumer preset 放在现有 example 的私有 composition 模块；有限 capability 仍归 package 私有 solution；C 属 graph 的资源所有权机制。没有新 verb 或 domain 污染 kernel。返回 view/capabilities 描述产物，避免 `audience` 开关。一个 consumer 只证明这个 preset 有用，不能推导公共通用 factory。未来 core/patterns/solutions 的导出归属单独审阅。

### Q6：长期成本与隐藏不变量

INVARIANT：同 Graph/instance/epoch、完整下层闭包、单 authority 提交、无订阅即终态推断、只认 exact outcome；配置不产生证据。成本是完整 runtime 仍常驻，以及冷 assembly 需复用内部构造边界。禁止每个组件另建 authority。setup 预算零节点/订阅/I/O；view 分组只建两个固定小对象、转交既有 Node 引用，不新增稳态 dispatch 或 payload clone；业务/诊断投影另列节点、p95 与保留内存。wrapper 的额外稳态目标为 0 次 dispatch、0 次 payload clone；完整新 preset 性能须另测，不能沿用 C 的四行 aggregate 达标结论。既有预算不放宽。

### Q7：响应式、可组合、可解释

第5节有 ≥2 输入、实际 fan-out/fan-in 和输出 sink；describe 是真实平面节点/边，可用纯 renderer 呈现。政策及 grant 通过 Node，不放 closure 偷读；不继承旧 feed 方法，也不在 callback 中回灌 authority。view 只隐藏引用分组，无私有第二状态表。风险是启动前组装尚未接入；不能先 composeFull 激活再补图。失依赖验收以实际路径为准，符合 R-no-imperative/R-data-not-peek/R-dispatch-all/R-reentrancy。

### Q8：备选形状

| 方案 | 草图 | 好处 | 代价/先例 |
|---|---|---|---|
| A 大对象+类型隐藏 | `compose(...): Full & Business`；组件参数用 Pick | 引用少；改动小 | JS 运行时仍暴露全部字段；自动补全易泄露内部；不能证明真隐藏。当前 FullCausalCapability 是完整句柄先例，但不是 ordinary view |
| B 分开返回对象 | `compose(...) -> { view, capabilities }` | 精确下层引用不复制；普通 view 无内部字段；无运行模式；低固定开销 | 多一个分组；要在冷阶段准备所有输出。现有 frozen 三 capability 及真实字段投影是本仓库先例 |
| C 三个 audience factory | `forUser/forFramework/forMaintainer(...).compose(...)` | 顶层入口直接按人区分；可分别文档化 | 易被误解为三个 assurance runtime；多 factory/签名与重复实例风险。此次未核实外部库同等语义先例，不借类比当证据 |

### Q9：推荐与覆盖

推荐 **B**：保留已批准 full closure，用真实对象和精确引用满足分级；普通路径不必理解八 lanes；维护者保留完整 graph，固定对象开销可审计。

| 关注点 | 覆盖 | 剩余事项 |
|---|---|---|
| Q5 owner/层级/单 authority | 是（设计） | npm 公共推广后置 |
| Q6 identity/lifecycle/evidence 不变量 | 是（设计） | 新 preset 必须重新验收；C 收据不能替代 |
| Q6 低成本和普通用户认知 | 部分 | 无额外稳态 wrapper 工作的预算明确；真实性能与用户理解尚未测 |
| Q7 完整冷接线、DATA 依赖 | 部分 | 私有 builder/consumer assembly 需在实施切片接通；无公共 transaction |
| Q8 简化且真实隐藏 | 是（设计） | 运行时 key/type/trace 检查待实现 |
| 实际 host 与独立业务验证 | 否（本切片） | 保留 root brief 后续义务，不以入口设计关闭 B121 |

## 9. 本次审阅与后续停止点

请审阅这三个具体取舍：

1. 采用 `{ view, capabilities }`；普通 view 五个端口，不加 audience 模式，完整图始终可检查。
2. 四组事实显式输入；不提供 feed/publish/approve；只在构造期选有限 defaults，业务许可始终是精确 DATA。
3. preset 的完整冷接线与一次 owner 移交作为必要实现验收；入口证据和真实 host/verifier 资格分开报告。

这三项是 D160/D161 下的候选入口细化；如批准后形成新的持久边界，唯一登记位置为 TS owner ledger，须附 complete/historical 条件且 protocol_impact=none。此处不预占 D#，不冒充 execution grant。

建议后续首个实施切片只承接已审阅的入口、业务接线、完整构造与离线分级验收，保留精确输出/未来 handoff 接口的清楚界限。未接通的真实发布不能显示 succeeded 或伪造 admitted request。入账时必须明确它与后续 focused host/verifier 的前置依赖；如为了产生 publication 事实必须先实现 handoff，应调整实际批次依赖再请用户审阅，不能默默扩张为完整旗舰实现。

本轮交付到本附件，等待用户审阅。没有修改冻结 design-v1、construction-v1、ts-v8 收据、owner ledger 或实现；没有 stage/commit，也没有 provider/live/spend/inbox 写入。

本轮只读验证：`authority:check:workspace` 通过（0 unresolved refs、0 dependency cycles、0 work orphans；保留既有 Canvas legacy-revision 警告）；附件本地引用均存在；root 与 TS 仓库文件摘要前后无变化，已有未提交修改全部保留。
