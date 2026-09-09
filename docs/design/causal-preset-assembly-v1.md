# Spending-alerts：业务装配与分级消费入口 — 实施设计审阅 v1

2026-09-09。**待审阅，未批准实现，未登记新 work 或 D#。** TS 基线 `f42fb43e12e351dc86601d184ae26e45cf8ed909`，工作树干净。唯一 consumer/package owner：`graphrefly-ts`。本附件属于当前任务的设计材料，不替代 root B139/D793 或已冻结的 D160–D163。

## 1. 推荐与必须保留的边界

推荐下一批完成**真实业务计算 → 八条内部事实 lane → 已验收 authority/publication → 五端口 view**的私有冷装配，并验收普通组件、框架组件和维护者的不同消费方式。

存在一个具体前置缺口：[D162 的最终入口](/Users/davidchenallio/src/graphrefly-ts/docs/design/causal-preset-audience-v1.md:104)要求 exact qualified focused-inbox binding，但该 binding、最终 dispatch guard 与真实 inbox 尚未实现。不能把测试记录器强转成这个 capability。

因此推荐明确拆开以下完成声明：

- 本批：内部业务 builder、真实五端口对象、精确 capabilities、有限 no-I/O 装配与离线消费验收。
- 后续：`spendingAlertsFor(app, defaults).compose(inputs)` 的完整创建入口，接真实 qualified inbox 后再验收四组输入的端到端起步体验与执行边界。

不另造 `forUser/forFramework/forMaintainer` 或 `analysis/live` 公共模式。测试从框架装配层进入同一个内部 builder；普通组件只接最终真实 `view`。这证明“组件可以按需只接业务接口”，**暂不证明普通用户已可独立创建完整可执行 preset**。这是本次需要明确认可的批次边界，不是重新选择 D162 的返回形状。

根本目标仍是：用户能看懂结果、缺什么证据、哪些记录仍未结；框架保留精确能力传递；维护者能检查执行这些计算的同一张图。

## 2. 当前事实、复用与缺口

| 事项 | 实际证据 | 本批处理 |
|---|---|---|
| 原业务算法 | [pipeline.ts:163](/Users/davidchenallio/src/graphrefly-ts/examples/spending-alerts/pipeline.ts:163) Welford、score、strict `>`、reason/message；原入口有 feed 和闭包政策 | 保留为旧业务先例；新私有路径按已批准 bounded prefix 重建具名业务节点，不包装 feed |
| 完整冷装配 | [construction.ts:137](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/construction.ts:137)、[scope:213](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/graph/construction-scope.ts:213) | 复用同一个 scope/startup/epoch、一次 seal/transfer/start；不修改 C |
| 三组 capabilities | [capabilities.ts:67](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/capabilities.ts:67) 精确对象与 lineage 校验 | 直接返回已签发 full 及 lower 引用，不 spread、不重新签发 |
| 材料关联/publication | [causal-publication.ts:392](/Users/davidchenallio/src/graphrefly-ts/examples/spending-alerts/causal-publication.ts:392) 内部调用真实 causal builder；publication-v1 已资格化 | 复用；外层绝不能再调用 buildCausalNodes 生成第二个 authority |
| 材料持有者 | [当前 harness:121](/Users/davidchenallio/src/graphrefly-ts/scripts/fixtures/spending-publication-harness.ts:121) 仍由输入 fixture 持有限 pack | 本批增加真实图内有限材料保留节点，区别于 UI 派生索引 |
| 发布/执行 | publication 是被动事实；没有 qualified inbox、quiet handoff、final guard | no-I/O 只验证事实装配；实际 host 与 B121 仍有独立验收 |
| 根级证明 | B139 已完成，B121/CSP-14 仍 proposed | 不改 root brief，不用 TS 自验报告关闭 B121 |

Codegraph 已核实调用关系和当前来源；它的摘录未覆盖完整算法/builder 部分，因此对未展示范围做了定向源码读取。没有重跑测试、初始化索引或新增运行资格。

## 3. 四组输入的责任与有限数据形状

下面是内部 builder 的拟议被动输入契约，不是 npm API。所有 Node 属于同一 Graph；业务数据均经 DATA 进入。node 名称、实例与资源界限是冷构造材料；变化的 policy、grant、clock、stop 不能放进闭包。

| 输入组 | 拟议 Node 字段 | 内容与责任 |
|---|---|---|
| evaluations | `pack`、`arrivals`、`current` | 输入 owner 保留不可变有限 pack；arrival 仅列 pack 内 evaluation refs 及确定顺序；current 提供域 watermark、当前 policy/binding facts |
| verification | `receipts` | 独立 verifier 的有限 receipt facts：source/runtime/input/policy/request/verifier revision 与 verdict；来源、缺失和失败明确 |
| localAuthority | `facts` | grant/ref、作用域、有效区间、当前逻辑时间、stop/revocation；没有默认 grant |
| inbox observations | `facts` | **仅被动边界观察 DATA**：destination/host epoch、readiness、correlated outcome、证据来源；无 submit/write/consume 方法，无 qualified-host brand |

最终公开意义上的第四组仍应由真实 qualified inbox 暴露其被动 Node 字段。当前内部 seam 接被动观察，不声称校验了 host capability。离线夹具的来源标为 fixture；不能因字段吻合就视为真实宿主收据。

**有限 pack 提案：**每实例最多 64 个 evaluation、两个 vendor；每项含本 vendor 的有序 prefix（当前交易恰为最后一项）、profile snapshot、policy ref/snapshot、domain/revision、source/runtime binding。prefix ≤64 笔，每 evaluation canonical bytes ≤64 KiB，整个 pack ≤4 MiB。arrival refs 必须精确属于 pack；同一波内的多条 arrival 全部处理，保持声明顺序，不靠排序补 revision gap。支持域内 r1/r2/r3、跨 vendor 交错与明确 replay。

每项 validation 校验有限数字、合法金额/时间字符串域、唯一 transaction refs、prefix vendor 一致、policy/profile 的完整字段与摘要。数值与字符串域见附录 A 的具体提案。非法新 DATA 清除其当前可用性并输出有界 issue；不得继续借旧 latest 事实放行。固定 pack 是本次有限证明的输入 owner，不推广成一般持续应用的全历史要求。

同一 source/runtime/pack/目的地/host/composition epoch 绑定贯穿实例。换绑定需新实例及新证据；没有运行中替换或旧 grant/receipt 自动迁移。当前 publication 使用固定节点名，本批支持每 Graph 一个该 consumer 实例；第二次装配必须预检拒绝，不顺手泛化命名系统。

## 4. 真实业务图与内部 lane 生成

```text
evaluations.pack + arrivals + current
                ↓
       evaluationSelections（校验、exact refs、有限关联）
          ├→ transaction ──────────┐
          ├→ vendorStats ─────────┼→ anomalyScore → thresholdGate
          ├→ userProfile ─────────┘                    ↓
          └→ policy ───────────────→ thresholdGate / reasonFactors
                                                       ↓
                                                   alertMessage
                                                       ↓
                   thresholdGate + exact evaluation → requestMaterials
                                                       ↓
                                          materialStore（先保留）
                                           ├→ materialSnapshot → requestMaterialJoin
                                           └→ effectProposals ────────────────┐
verification + localAuthority + inbox observations + policy/current + material result
                ↓                                                         │
       publicationPolicy → effectAdmissions                               │
                └→ publication-policy terminal                            │
assessment terminal + explanation terminal + publication-policy terminal  │
                ↓                                                         │
  occurrences / occurrence-admissions / branch-terminals / effect-proposals
        / effect-admissions / effect-outcomes / evidence / watermarks
                ↓
        buildSpendingPublication 内的唯一 authority
                ├→ 精确 capabilities
                ├→ committedEffects + materialSnapshot → publication
                └→ coverage / issues；与 assessment / startup 组成 view
```

图中业务计算都在 authority 上游，不把 released/committed output 同步回灌 policy 或材料节点。新增 keyed join 只保存有限关联与去重，不裁决 occurrence 当前性、effect 是否已 admitted/settled。其权威仍在原 authority。每个 branch 带完整 occurrence tuple；不能用三路各自 latest 拼接两个 evaluation。

**业务规则复用：**vendorStats 在单个不可变 prefix 上跑原 Welford 样本标准差；count<2 的回退、score 的 scale/dailyAverage 回退、strict `>`、分类与 reason/severity/message 格式均以原算法为参照。policy 是具名依赖，reason 与 gate 使用同一 policy ref。固定 deterministic template 绑定到源码，不开放任意 justifier callback，也没有“buggy 算法”配置开关。

**八条 lane 的明确来源：**

| lane | 生成者与约束 |
|---|---|
| occurrences | 合法 evaluation + exact source refs/value/digest；不从判定成功反推 occurrence |
| admissions | 输入/域/绑定接纳候选；不是 effect 的操作许可，最终由原 authority 接纳 |
| branchTerminals | 固定 assessment、explanation、publication-policy 三分支 exact fan-in |
| effectProposals | 只有被 materialStore 成功保留的 flagged request 才输出；正常交易零 proposal |
| effectAdmissions | 业务 policy 对 exact proposal、receipt、grant、current 与边界观察生成候选事实；不以 coverage.complete 代替 verifier |
| effectOutcomes | 有来源的 exact 被动 outcome 转换；no-I/O 夹具模拟事实单列，不生成 I/O 成功 |
| evidence | 有来源的 evaluation/verification 等 evidence；缺失、stale、失败不写 included/pass |
| watermarks | 显式 current facts；不从最大到达 revision 推导“中间都已处理” |

缺 receipt/grant/readiness 时 publication-policy 等待，不能伪造 skipped。正常交易明确完成 no-publish 分支。明确验证失败或材料容量/格式拒绝产生对应失败/拒绝事实；不将业务拒绝升级为协议 ERROR。判定以后出现撤销，只改变当前事实，不能改写已提交的首个 admission、主动 settle 或伪造 cancelled；当前 dispatch 边界的拒绝 outcome 留给未来真实宿主。

receipt/grant 字段、来源判定与 evidenceKind 见附录 A；本附件不借一个 hash 字符串解决可信发行问题。独立 root verifier 的真正 receipt producer 未完成时，只能验收固定来源的离线输入消费。

## 5. 材料由图持有，容量成为可见事实

推荐一个 `materialStore` Node，输入是合法 request material，`ctx.state` 保存每个 exact request 的唯一不可变材料。它同时向 proposal lane 与已有 publication 供给数据，因而处于已有 authority root 的真实依赖闭包内。**在输出 proposal 之前完成材料保留**；没有第二个命令式 registry、UI callback 唯一副本或额外 keepalive root。

- 每实例 lifetime 最多 64 个 request material，总 canonical snapshot ≤1 MiB；不按 outcome 或 UI 订阅回收槽位。拒绝新请求不能抹掉旧材料/义务。
- 原组件 MAX_PAYLOAD=8 KiB 不改；本 consumer 候选 inbox payload（canonical AlertPayload + 换行）收紧至 ≤4 KiB，以衔接 D160 的有限 JSONL 方向。最终 host wire record 仍须另行验收。
- 相同 exact material replay 复用；同键不同内容报冲突，不覆盖。超限先给 typed issue，零新增 proposal；不让 authority 接纳一个已知无法保留正文的新请求。
- materialStore 只管理字节，不存第二份 admitted/active/settled 状态。它的去重不是执行去重，不赋予重放许可。
- 正常 UI 全退订时，上游路径由原 authority root 保持，materialStore 仍在；publication 的派生 RAM/index 可释放。再订阅通过正常 DATA 重建。
- 如果必需边被恶意删除，不能保证 RAM 材料仍完整；必须阻断/报告缺失，原 active obligation 保留。不能恢复旧缓存假装路径仍有效。健康重新构造的输入依据来自图/输入 owner 持有的有限 pack，而非 UI。

这是有意的有限内存取舍：最多约 1 MiB canonical 材料加 JS 对象/索引开销；实际 heap/RSS 另测。它避免让材料节点监听 authority outcome 再反馈 proposal 的同步环，也不需要修改 retention/lifecycle 协议。连续长期运行与有条件材料回收后置。

## 6. 三类调用、实际返回对象与冷装配

内部候选签名（非公开入口）：

```ts
buildSpendingPresetNodes(ownerGraph, scope, startup, preparedInputs, binding)
  // 构造全部业务/lane/材料节点，再调用一次 buildSpendingPublication
  // 返回私有装配记录，含 consume: { view, capabilities } 和必要 roots
```

私有装配记录只给 framework assembly；实际交给组件的是两个 frozen 分组对象：

```ts
const composition = built.consume; // { view, capabilities }
const ordinary: SpendingAlertsView = composition.view;
// ordinary 的 own keys 精确为 assessment/publication/coverage/issues/startup
const execution = composition.capabilities.execution;
// execution.identity === composition.capabilities.identity
// capabilities.retained.execution === execution
// 普通组件 renderAlerts(ordinary)，不接 built/scope/输入 lane。
// 维护者继续从 ownerGraph.describe() 检查真实完整图。
```

`publication`、`coverage`、`startup` 尽可能转交现有 Node 的精确引用；`assessment` 是真实业务输出 Node；`issues` 如需汇合 consumer 与 causal issue，用一个声明的 Node，单独计算成本。对象分组自身不增加派发、clone 或新 authority。隐藏只针对组件收到的运行时对象，不宣称 Graph 持有者被安全隔离。

| 端口 | 用户可回答的问题 | 明确不能推导 |
|---|---|---|
| assessment | 哪笔交易、哪版政策、为何 flagged/normal，关联的实现/输入是什么 | flagged ≠ 已发布 |
| publication | authority 记录到了哪一步、正文匹配/缺失/冲突吗 | material matched ≠ 当前可执行；fixture outcome ≠ 真实写入 |
| coverage | 当前保留证据覆盖什么、哪些缺失/过期 | coverage.complete ≠ 独立业务验证成功 |
| issues | 这次等待/拒绝的有限原因与 exact refs | 无 issue ≠ 成功 |
| startup | 同一实例 starting/started/faulted | started ≠ lifecycle 已结束 |

no-I/O 证据来源在输入 metadata 与 assessment 的运行关联中明确为 observation-only；这是当前受测装配的事实，不是切换 runtime 的 audience 参数。展示使用统一事实词汇，不把 admitted-no-outcome 简化成“已发送”。

冷流程：先验证 external Node ownership、有限配置与所有名字；prepareConstruction → startup → 全部业务/lane/material/publication/view nodes → 检查实际边 → seal（startup 加已有必要 root）→ transferToGraph → startConstruction。不先启动 composeFull 再补业务节点。预移交失败仅清理冷资源；移交后 faulted 仍为同一实例，原 obligation 保留。

## 7. no-I/O 与真实执行的资格分界

离线 Graph 实际运行业务函数、事实转换和原 authority。输入夹具可以提供合成 grant/readiness/outcome，让真实 authority 出现 admitted、active 和 exact settlement；这只证明该组被动事实下的装配行为。没有文件打开、writer、真实 dispatch、消费预留或自动 cancellation。所有状态必须与“fixture/observation-only”来源一起呈现。

测试不得把 `InboxObservations` 强转成 QualifiedInboxBinding，不能通过默认 allow/mock-success 替代缺前置条件。测试驱动可以按固定 schedule 向外部 source 送 DATA；生产组件/factory 不暴露 feed/publish/approve/retry，不用 timer/Promise 给图内反馈错峰。

后续最终创建入口先验证真实宿主的精确能力与 binding，再交给同一 builder 的被动 Node seam；quiet handoff/final current-at-dispatch guard 在独立切片实现并验收。此前没有完整可执行 `spendingAlertsFor`，也不声称创建端隐藏已完成。真实写入、写入前拒绝、未知 outcome、读取 inbox bytes、once-consumption 和宿主路径 mutations 保留 D160/root brief 原义务。

## 8. 验收与反例

全部场景均在 diagnostics off/summary 下运行，按固定规则去掉仅诊断字段后比较。以下是拟议验收，不是已通过结果。

| ID | 场景 | 必須证据 |
|---|---|---|
| N1 | 普通组件只接五端口，框架接 exact handles | 编译正/负例；Object.keys/own symbols/descriptors/freeze；无大对象类型隐藏；lower identity 恒等；三份真实消费样例 |
| N2 | 空 DATA、policy/receipt 先到、两条 DATA 同波 | 不造默认成功/空初值；全部输入按 exact key 处理；不丢中间 evaluation，不跨 vendor 取 latest |
| N3 | 原业务 normal/flagged、threshold 恰好相等 | 独立两遍样本方差重算；数值容差沿 brief，flag/reason/severity/payload exact；正常零 proposal |
| N4 | 同拓扑 n−1→n 负例、等价 sample 正例 | 修改实际 vendorStats 源码并证明加载字节；Node identity/edge set 相同、source binding 变化；离线独立 verifier 判定，缺 provenance 则作者 unknown |
| N5 | 三 branch、跨 vendor/晚到/缺 branch | 真实 keyed fan-out/fan-in；缺 branch 不造 skipped，错误 occurrence 的 terminal 不完成目标 |
| N6 | 错/旧 receipt、grant、policy、epoch、watermark gap | 装配不产生有效 admission，或原 authority 拒绝；独立重建预期 facts，不能只比较 describe |
| N7 | 合成 admitted/active 后全 UI 退订，再送错/unknown/exact outcome | materialStore 与 authority 仍在原 root 闭包；错/unknown 不结算；精确合适终态才结算；恢复 DATA；明确不代表真实 host |
| N8 | replay、同键换内容、material64边界与超限字节 | 原材料不覆盖；已接纳义务不消失；超限前零新增 proposal；全实例不回收 dedup 槽制造重发 |
| N9 | 丢 policy/receipt/material-store/terminal/authority 的实际依赖 | loadable runtime mutant 造成语义断言失败；静态拒绝、结构保护、行为检测分别记录，surviving 如实保留 |
| N10 | 冷失败、启动后失败、重复创建、跨 Graph/epoch | 零提前激活；同一 faulted owner，无重新签发/隐式重建；名字冲突在预检拒绝 |
| N11 | ordinary/framework/maintainer 同输入 | 指向同一图与同一 authority；off/summary 必要业务/证据/义务等价；普通组件无需接八 lanes |
| N12 | 用户只读 view 的有限问题卡 | 回答结果、为何未发布、证据是否足够、退订后义务归谁，并引用事实；记录未知和误判，不预设“更容易” |

N7 的结论限定合成边界事实。N12 是当前调用/消费设计的用户审阅，不冒充 B121 冻结 human/agent 比较；不启动其他 agent/provider 实验，不接触 root 的隐藏答案。

独立业务 verifier 不 import consumer 的 Welford/gate/template/admission/join/authority helper。publication-v1 的 oracle 只验材料关联，不能冒充业务 oracle。新独立离线检查是 TS 实施证据；root 仍拥有最终 acceptance oracle/真值与 B121 汇总。plain arm 必须有相同有限输入、精确关联、缺失/冲突/replay/生命周期与保留责任；不为短代码删去失败路径。

**成本验收分三账：**

1. 对象暴露层：固定两个分组对象，零额外稳态 dispatch、零 payload clone；引用恒等与实际计数，不能只靠微基准。
2. 新业务/材料装配：附录 B 的 27 个新增内部节点（现有 26 节点 publication 冷闭包另列），summary 再加 1；外部输入 source 独立计数。无按交易新建拓扑，root 总数目标仍为 2。精确 manifest/edge 表见附录 B；数量不是结构正确性证明。
3. 时间/内存：同逻辑义务的 Graph reference 与 plain 先冻结再量测；1/16/64 evaluations、prefix1/16/64、两个 vendor、精确重复/单项新增/全新输入、单/双DATA与off/summary。完整私有 Graph 对合理 Graph reference 的构造≤1.20、稳态≤1.10，绝对时间/heap/RSS、首次验证、材料hash与reconnect分报；plain绝对成本与负对照照实报告。禁止直接继承 publication-v1/原C 的通过标签。

附录 C 给出有限 run matrix，采用代表性组合与边界覆盖，并说明未取全笛卡尔积的依据。wrapper目标0不代表完整图零成本。性能超限保留失败，不放宽门槛。

后续实施仍需所有适用离线 gates：default、root-eval soak、browser、lint/typecheck、build/export/artifact/workspace/dashboard，原causal/construction/cold/view/publication mutations，以及新业务与入口反例。源码不变的旧资格只可经精确闭包比对复用；否则按绑定失效处理，不覆盖历史收据。

## 9. 拟议文件范围与先后依赖

仅在后续明确批准实施后新增以下私有文件；名称为可审阅候选，不新增 exports。

| 文件 | 职责 |
|---|---|
| `examples/spending-alerts/causal-inputs.ts` | 四组被动 Node 契约、有限 pack/ref/receipt/grant schema、预检与 issue 分类 |
| `examples/spending-alerts/causal-business.ts` | prefix统计、具名业务节点、exact多源关联、assessment/三分支材料 |
| `examples/spending-alerts/causal-material-owner.ts` | 有限 graph-owned materialStore、snapshot与成功保留后的proposal投影 |
| `examples/spending-alerts/causal-admission.ts` | policy候选、八lane转换、有限证据与outcome来源处理；不拥有settlement |
| `examples/spending-alerts/causal-preset.ts` | 单一冷装配、实际manifest/required edges、view与capabilities返回；无最终host factory |
| `packages/ts/src/__tests__/spending-alerts-causal-preset.test.ts` | N1–N12离线行为、计数和mutation断言；新source/code绑定 |
| `examples/spending-alerts/causal-audience.examples.ts` | 三类只读消费样例与TS负例（必要时另置typecheck fixture） |
| `scripts/fixtures/spending-preset-{oracle,plain,reference}.ts` | 独立业务/协调真值、公平两种对照；不得复用candidate算法 |
| `scripts/{qualify,compare}-spending-preset.mjs` | source绑定、真实runtime mutants、冻结的有限成本矩阵 |
| `examples/spending-alerts/tsconfig.json` | 显式纳入新增示例、fixture与测试 |

现有 pipeline.ts、causal-publication.ts、authority/C/capabilities、package exports 和 wave protocol 默认不修改。若具体调用迫使修改，先给出必要 diff 和原因；不能借“整合”重新打开全部模块。root 不新增实现 body。

附录 A–C 已给出被动字段/limits、节点/edge manifest、receipt 来源规则与有限成本矩阵，可随本方案一起审阅。它们均为候选设计，尚无实现资格。若批准设计，按现有 owner 流程登记同一份材料；实现仍须明确批准，不从本次“继续设计”推断。

## 10. Q5–Q9

### Q5 — 抽象与层级

推荐留在 consumer-private example；identity/lifecycle/evidence 继续由原 solution authority 管。材料持有是字节生命周期，Node 分组是能力暴露，二者均不是新 kernel/verb。出处：publication builder:392、capabilities:67、scope:213。一个 consumer 尚不能证明公共 core/patterns/solutions API 应怎样推广。

### Q6 — 长期成本与不变量

INVARIANT：一authority、一Graph/epoch、一转交；proposal前有材料；UI退订不结算；exact终态；fixture不冒充host；observer facts不授予外部执行。主要代价是有限实例材料不回收与一次性pack输入；这样没有跨authority同步回灌或隐藏持续应用承诺。普通组件少接字段的收益要实测；创建端认知问题保留到真实binding就绪。出处：D160第6–9节、D162第4–7节。

### Q7 — 响应式与可解释性

第4节具名图含≥2输入、真实多路join和输出；所有动态政策/许可经deps/DATA，符合R-data-not-peek/R-no-imperative/R-dispatch-all。materialStore通过proposal成为既有root祖先；完整describe保留其真实边。输入/data issue处理与schema在附录A具体化，不能用隐式global latest或set/callback修补。无独立UI collector root。

### Q8 — 备选

| 方案 | 形状 | 收益 | 代价 |
|---|---|---|---|
| A 先完整focused host，再完整创建入口 | qualifiedInbox → spendingAlertsFor.compose → view/capabilities | 四组输入创建体验与真实效果可一起证明；不需要观察-only解释 | 把当前关注的入口设计与dispatch/reservation/I/O outcome lowering绑成更大批次；需另行执行授权。先例为D160设计方向，非已落地能力 |
| B 真实业务冷builder + 分级消费对象（推荐） | passive Node inputs → internal cold builder → {view,capabilities} | 立即验证依赖、材料保留、真实五端口与三类组件；复用现有C/publication；不造host能力 | 创建端、真实host及B121仍不完整，必须清楚标识fixture来源。先例为已落地cold/publication builder与精确capabilities |
| C 只给现有harness套五字段view | existing synthetic lanes → wrapper | 最小改动，容易展示类型与keys | 不接真实业务/材料owner；无法证明普通用户无需准备八lane，认知收益不足。先例是当前测试harness，不能升级成完整consumer |

### Q9 — 推荐与覆盖

推荐B，A保留为后续真实边界切片；不把C当本批成功。

| 关注点 | 覆盖 | 剩余事项 |
|---|---|---|
| Q5层级/唯一authority | 是，按设计 | 需真实describe与源码验收 |
| Q6材料/生命周期 | 有限实例内是 | 长期回收与持续输入不覆盖 |
| Q6认知/性能 | 部分 | wrapper计数、整体成本、用户问题卡待测；完整创建体验后置 |
| Q7 DATA/dependency | 设计已明确 | 附录A/B已有具体schema与manifest，真实删边行为待实现 |
| Q8实际字段隐藏 | 是，组件消费层 | 不能声称npm公开入口或安全沙箱 |
| D160实际执行 | 本批不覆盖 | qualified host、final guard、真实inbox/outcome/consumption proof后置 |

**需用户确认的三个取舍：**

1. 下一批选B：真实业务装配和五端口消费验收先行，最终四组输入的可执行factory后置；不以假binding补齐。
2. 材料由现有authority依赖闭包内的受限Node持有，lifetime64/1MiB，不增加keepalive root，不自动回收材料槽；接受有限实例的容量边界。
3. 组件消费层与创建层分别声明认知收益；no-I/O合成事实与真实host证明严格分开，成本按wrapper/业务/host分账。

本附件与D160–D163方向一致；上述新具体输入/保留取舍仍是提案。附录已包含在本次审阅内，不另设一次仅用于补附录的批准。不从这次设计审阅自动启动实现。没有修改已冻结design、owner ledger、运行代码或当前资格；没有新执行/付款权限。


## 附录 A — 被动字段、来源与有限关联提案

以下是 consumer 私有 DATA 格式的字段表。重用已有 `CausalOccurrenceRef`、`CausalEffectProposal/Admission/Outcome`、`RequestMaterial`、`DataResult` 的完整结构，不复制/修改原 contract。新增格式版本候选为 `spending-input-v1`；它不属于 wave protocol，也不是跨项目的授权记录格式。

**共同域。** ref/id 非空 UTF-8 ≤128 bytes；正文标签 ≤256 bytes；digest 为带 `sha256:` 前缀的 64 位小写 hex。policy 明确包含 `zThreshold, dailyRatioThreshold`，profile 包含 `dailyAverage, typicalCategories`，不从旧demo defaults补字段。金额与 dailyAverage 是有限数，范围 `[0, 10^9]`；阈值是有限数，范围 `[0, 10^6]`，不偷偷四舍五入为分。交易时间仅接受可原样 round-trip 的 UTC 毫秒 ISO 字符串；不读系统当前时间。revision/逻辑 tick 为安全非负整数，occurrence revision 遵循现有 authority 的合法域。typicalCategories 最多32个唯一项。拒绝 NaN/Infinity、未知字段、非 JSON 值和超界 bytes。canonical 编码沿用已有材料编码规则；oracle 独立实现该被动格式，固定正负向量比较 bytes，不能 import candidate canonicalizer。

| 数据 | 必需字段与关联 |
|---|---|
| Binding | `packRef, sourceDigest, runtimeDigest, destinationRef, compositionEpoch, hostEpoch`，对齐既有 MaterialProfile；另列 `runRef` 和证据模式 `fixture-observations`。标签不是 qualified host 品牌 |
| EvaluationPack | `format, binding, evaluations[]`；每项 `evaluationRef, subjectRef, occurrence, inputDigest, profileRef, profile, policyRef, policyDigest, policy, prefix[]`。occurrence 含全部 ordered sourceRefs，prefix 最后一笔是受测交易；每个 domain 对应一个 vendor |
| ArrivalFrame | `packRef, evaluationRefs[]`；每 DATA ≤64 refs。重复 exact ref 是 replay；不让同 ref 重算成另一个 input。未到 pack 的 refs 最多保留64个等待项，超限 typed issue，不丢弃旧义务 |
| CurrentFrame | `binding, current[]`；每项 `revisionDomain, occurrence, policyRef, policyDigest, watermark`。每 DATA ≤64项。值只是输入 owner 的当前事实候选，原 authority 独立裁决 currentness/gap；不在 consumer 复制 high-water 注册表 |
| VerificationFrame | `binding, receipts[]`；每项 `receiptRef, issuerRef, verifierRevision, occurrence, inputDigest, policyDigest, sourceDigest, runtimeDigest, requestDigest, numericDomainRef, verdict, artifactRef, artifactDigest`。verdict 为 `pass/fail/unavailable`；正常交易 requestDigest 指明确的 no-publish 结果，不能省略而默认 pass |
| LocalAuthorityFrame | `binding, tick, stop, grants[]`；每项 `grantRef, ownerRef, operation:'append-alert', occurrence, requestDigest, destinationRef, hostEpoch, validFrom, validThrough, maxWrites, replayScope, revoked`。有效区间为闭区间；maxWrites 为1–64；replayScope 限本 composition/host epoch。缺字段不授权 |
| InboxObservationFrame | `binding, issuerRef, artifactRef, artifactDigest, readiness, outcomes[]`；readiness 含 `ready, observedAt, validThrough, availableSlots`，slots 为0或1。每个 outcome 使用既有 exact correlated 结构；边界事实来源单独保留。字段没有 write/reserve/submit 能力 |

除 pack 外每帧 ≤1 MiB、每集合 ≤64项；相同输入 lane 一波可有多条帧，每条都处理，不能只拿最后一条。qualifier 的固定单场景 schedule ≤256帧；超出不在本批运行资格内，不能外推持续服务吞吐。有限 pack 在实例内不换内容；非法新帧使该输入的当前可用性失效并报告 issue，下一条合法完整帧可恢复可用性。不会用残留前值继续产生许可候选。

**receipt 来源规则。**离线 runner 在激活前核对只读 artifact manifest 的摘要、producer 路径/版本、受测加载 closure、输入和政策域，并保留这一核对记录。Graph 只消费这些已标明出处的被动 receipts，再逐项检查 exact binding。修改某行自称 `issuerRef` 不等于取得可信来源；fixture 的 pass 只能证明消费逻辑。N4 的真正候选验证必须由独立 oracle 对实际加载产物的输出重算并发行单列 artifact，不能从 candidate 的 pass 标签制造 receipt。相同 receiptRef 不同内容为冲突；旧 code/input/policy/request/verifier 域不匹配只产生 stale/mismatch，不可用作当前 pass。没有签名基础设施或可信宿主时，不声称同进程防伪；root 的独立验收权不转给 TS runner。

**policy 有限判定顺序。**正常交易完成 no-publish；flagged 先生成并保留 exact material/proposal。publicationPolicy 只读取 proposal 材料与当前四组事实：缺项等待；明确 verifier fail、明确 grant rejection 或 material拒绝产生相应拒绝；全部 exact 且当前 policy/本地时间/stop/readiness允许，才生成 admission 候选及 publication-policy terminal。它不等 authority release/commit 后再决定 branch terminal，因此没有释放死锁。对应 terminal 和 admission 可以先后到原 authority，由原 pending lanes 汇合。

`maxWrites` 与 availableSlots 的候选检查不做执行预留，不能把允许多个 admission 误称为 host 配额 enforcement。真实 host 的 once-consumption、当前剩余额度和最后时刻 guard 仍是后续义务。已发出的首个 admission 不因后来撤销而被改写；撤销也不制造 outcome。缺 receipt 后恢复只处理未判定候选；同 key 换决定不覆盖。去重/待关联表最多64个 evaluation/request，各只保留候选生成所需字段，不镜像 authority 的 current/active/settled 分类；满时 typed issue、零新增 admission，旧 exact outcomes 仍向 authority 传递。

**保留证据。**本 consumer 的候选 required kinds 固定为 `spending-input / spending-code-binding / spending-verification`。included 表示材料已纳入，不表示 verdict=pass；fail receipt 也可被完整保留。missing/stale/unavailable 不转换成 included。provenance 是可选 `spending-provenance`：缺失显示 actor unknown，不单独阻断业务许可。正常无异常可以先完成 no-publish，但 verifier 尚缺时 coverage 仍不完整。evidence 每条关联完整 occurrence 与原 artifact；不以 diagnostics=off 删除必要 facts。

## 附录 B — 固定 manifest、边与激活责任

以下27个新增节点均带实例前缀；表内缩写是名字后缀。`$pack/$arrivals/$current/$verification/$local/$inbox` 是6个外部同 Graph Node。每个具名节点是实际 dispatcher 调用；同一节点里的格式检查是有限内部步骤，不偷偷 inline 调用另一个具名节点的业务 fn。

| # | 节点 | 直接 deps |
|---|---|---|
| 1 | evaluationSelections | $pack, $arrivals |
| 2 | transaction | evaluationSelections |
| 3 | vendorStats | evaluationSelections |
| 4 | userProfile | evaluationSelections |
| 5 | policy | evaluationSelections |
| 6 | currentFacts | $current |
| 7 | verificationFacts | $verification |
| 8 | localFacts | $local |
| 9 | inboxFacts | $inbox |
| 10 | anomalyScore | transaction, vendorStats, userProfile |
| 11 | thresholdGate | anomalyScore, policy |
| 12 | reasonFactors | thresholdGate, policy |
| 13 | alertMessage | reasonFactors |
| 14 | assessment | thresholdGate, reasonFactors, alertMessage |
| 15 | requestMaterials | evaluationSelections, thresholdGate, alertMessage |
| 16 | materialStore | requestMaterials |
| 17 | materialSnapshot | materialStore |
| 18 | effectProposals | materialStore |
| 19 | publicationPolicy | evaluationSelections, thresholdGate, materialStore, currentFacts, verificationFacts, localFacts, inboxFacts |
| 20 | occurrences | evaluationSelections |
| 21 | occurrenceAdmissions | evaluationSelections, currentFacts |
| 22 | branchTerminals | assessment, alertMessage, publicationPolicy |
| 23 | effectAdmissions | publicationPolicy |
| 24 | effectOutcomes | inboxFacts |
| 25 | evidence | evaluationSelections, verificationFacts |
| 26 | watermarks | currentFacts |
| 27 | consumerIssues | evaluationSelections, currentFacts, verificationFacts, localFacts, inboxFacts, requestMaterials, materialStore, publicationPolicy, causal/issues |

内部中间输出统一带 exact evaluation/occurrence key；可能失败的步骤输出有限 tagged DATA result，投影只传对应有效事实。表中节点直接从列明 deps 收取 DATA，不遍历 closure 拉值。`materialStore` 的 DATA 带 retained snapshot 与本次新增/拒绝结果；17投影 snapshot，18仅投影成功保留的 proposal。consumerIssues 仅合并事实，不持有业务许可或材料唯一副本。

20/21/22/18/23/24/25/26 分别接既有八条 causal input adapter；`materialSnapshot` 接现有 requestMaterialJoin 的材料输入。已有 publication 的26个冷节点及内部 edges 原样复用。新增节点27 + 既有26 = **53个 owned节点，6个外部 source另列**。summary 模式额外1个 `diagnosticSummary`，deps为 assessment/publication/coverage/consumerIssues，仅作可选投影；不进入 view keys，不持有必须事实，不自动另订阅。54是summary拓扑数，实际激活成本由相同明确 observer workload 比较。

固定 root 仍是已有 startup 和 causal release-controller，共2个。materialStore→effectProposals→causal input→authority→release-controller 的真实依赖链保证正常 UI 退订后材料仍有生命周期 owner；业务 assessment 也经 branchTerminals 在同一闭包。view 端口对应14/既有publication/既有coverage/27/既有startup。所有真实 deps 在冷 seal 前与表逐一核对；运行时关键 join 对缺失/换位/跨实例依赖及失效数据保持阻断。mutation 把这些保护与行为断言分别计数，不能只让 manifest gate 杀死全部 mutant 就声称运行语义有效。

这里没有声明持续动态 rewire、第二个同 consumer 实例或按交易构造节点。若实现发现表中必要边缺失或root必须增加，修订此表并解释原因，不能静默把额外节点归为“免费 wrapper”。

## 附录 C — 有限测量和审阅材料

这是待批准的测量提案，不是本次启动 eval，也不改已冻结 CSP11/C 或 publication-v1 runner。

| 行组 | evaluations / prefix | 数据与观察 | 目的 |
|---|---|---|---|
| P1 | 1 / 1 | normal；两个诊断姿态 | 最简单负对照与固定装配负担 |
| P2 | 1 / 64 | flagged；两个姿态 | 单次统计最大prefix |
| P3 | 16 / 16 | 两vendor交错，半数flagged | 中间occupancy与join成本 |
| P4 | 64 / 1 | 两vendor，含category异常 | 多occurrence、最小计算 |
| P5 | 64 / 64 | 两vendor，含严格阈值边界 | 同时最大输入与材料容量 |
| P6 | 64 / 64 | reverse branch/receipt arrival，最大许可等待 | pending drain与多路晚到 |

构造6组×off/summary=12行；每行 DATA 稳态分别固定 `(精确重复, 全部新到)` × `(单DATA, 双DATA)`，共48行。再在P3/P5/P6测每帧仅1项新增而其余精确重复、单/双DATA、off/summary，共12行，总稳态60行；明确报告实际变化比例（1/16或1/64），不用虚构精确1%。新到工作从有剩余 lifetime容量的预声明实例段开始，容量耗尽后的拒绝另测，不能偷偷 reset 同实例冒充持续吞吐。每次实例构造/准备的时间独立计账，不能藏入warmup而不报告。

恢复6组×两个姿态=12行，每行20次全UI退订/再订阅，原root仍在。容量/冲突/非法frame边界另做行为验收，不据其极端错误路径推出平均性能。没有穷举各数值/到达组合：P1/P2/P4/P5覆盖两个独立大小轴端点，P3覆盖中间，P6覆盖最坏声明等待；若发现未覆盖的新复杂度路径，单列补充，原结果保留。

与既有局部成本比较方法一致，候选/Graph reference 用AB/BA/AB三个配对批次，每批100 warmup+300 measured；先算每批p95，再以三个batch-p95的中位数比值判定1.20/1.10门槛。cold、首次材料hash、steady unchanged/changed、reconnect分开；保留单样本、GC/deopt时间关联、超时与失败。plain arm报告相同义务和场景的绝对时间/内存，不用其不含Graph的构造时间冒充C开销分母。Graph reference必须冻结完整业务与同等保留/失败语义、独立源码和节点/边表；不得向reference塞冗余工作使candidate达标。它与plain都先经独立oracle验语义，再进入计时。

固定 recipe 和字节绑定在实施资格脚本中成为新的 consumer 矩阵；它是**新建的正式私有 consumer qualification**，不是修改 CSP11，也不是临时 ad hoc 结果补过旧门槛。当前只有设计，无这批性能结论。离线 suite 的实际运行预算/机器与超时上限随批准的实施 attempt记录，不登记成产品D#。

**可审阅证据包。**本批产物应含源码/加载closure摘要、实际53/54节点describe与公开投影规则、两个真实源码diff（错误sample变population、sample等价改写）、有序输入/政策/被动来源、逐项oracle结果、plain/Graph reference与成本、mutation实际加载及失败断言、三份真实view/capability消费样例。普通组件问题卡以root的8场景/20业务边界节点/40关键事实/2diff上限组织；底层完整图保留链接，不能按答案挑删。人类可审阅上述包；本批不自动运行agent研究。未来B121的人/agent双臂试验另行冻结相同预算与隐藏真值，不能用本任务作者的自答冒充认知证明。

**拟登记的持久取舍（无预占D#）。**唯一owner为graphrefly-ts；分类 durable-architecture，change_kind=new，protocol_impact=none，supersedes=[]；concerns候选为 `ts.spending-alerts.material-ownership` 与 `ts.spending-alerts.offline-assembly-qualification-boundary`。decision正文只锁定：材料先保留再proposal、在现有authority真实依赖闭包内有限持有，组件消费资格与最终创建/host资格分开；其细节引用本设计唯一正文，不复制D160–D163。complete_when为用户批准后owner-local设计正文与不可变绑定登记完成（设计完成而非runtime完成）；historical_when为后续同owner明确替代这两项边界。性能运行方法和每次receipt属于attempt/evidence，不混入该D#；未批准前不向ledger追加。
