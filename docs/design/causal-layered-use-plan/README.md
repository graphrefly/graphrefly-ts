# 分层入口与生命周期使用方案

2026-09-14 · 审阅基线 `8d1f01db` · 状态：设计提案，未实施。

**推荐：用现有公共入口说明 library 的层次，用私有 spending 旗舰完成三类角色的可运行接入示范；不新增公共 API。** 用户拿到的接口可以逐层展开，运行中的必需依赖和生命周期责任保持完整。后续实施按本文的一份完整批次执行、QA、提交，不再按每个小文件要求“继续”。

这份稿件承接已批准的[范围修订](../causal-scope-revision/README.md)，并记录[CJS 修复](../causal-cjs-batch-fix/README.md)已完成；不重新选择 flagship 或重开构造方案 C。旧公共 spending 提案已撤回，其新路径、额外 identity checker、第六个 view 端口和整体模块树迁移均不在本方案中。

## 1. 实际归属与进入方式

“library 分层”和“使用者等级”不是一一对应关系：普通应用作者通常从 Graph 或已有领域 solution 开始；只写展示组件的人甚至无需构造 Graph。维护者也可以直接使用 preset，再下钻实际图。无需强制依次学习 core → patterns → solutions。

| 使用任务 | 当前可用入口 / 归属 | 应看到什么 |
|---|---|---|
| 编写节点/运行时适配 | `@graphrefly/ts/core` | Node、Ctx、batch、协议和 dispatcher 的既有低层契约 |
| 组装并检查应用图 | `@graphrefly/ts/graph` 或 root | Graph、显式依赖、组合与图检查；常规应用不必从 bare Node 开始 |
| 复用跨领域组合 | `@graphrefly/ts/patterns` | 当前 admissionHandoff、eventFlow 等已公开模式；不会因消费 spending 而要求手动重建它的 authority |
| 使用已公开领域方案 | 已有 `/solutions/*` focused 入口 | 该领域既有契约与接入责任；solutions 可以是领域专用，不要求所有业务都能用 |
| 观察既有值 | `@graphrefly/ts/adapters` | 当前值适配器；必须根据其真实失效语义选用 |
| 本轮 Causal 旗舰 | `examples/spending-alerts/` 的本地入口 | 私有、离线模拟的完整应用示例，不可当作已发布 package 子路径 |

当前 package exports 没有 spending 或 causal-occurrence 专用公开路径。`causal-occurrence` 位于 `src/solutions/` 是源码组织事实，不是公共可导入承诺。公共入口清单以后由 package manifest 校验，文档不能自行发明一个路径。

**spending-alerts 的归属结论：**它现在是被选定的具体旗舰组件。其异常统计、政策、append-alert、oracle 和模拟 host 都有领域限制。领域专用本身并不妨碍未来成为 solution；当前欠缺的是清楚的可支持接入契约、真实宿主资格和独立复用证据，不能仅把文件搬进 solutions 就宣称成熟。第二个真实业务 consumer 是提炼通用 causal factory 的重要证据，不把同一旗舰的三个角色、测试 fixture 或 plain 对照算作三个 consumer，也不以这个数量要求阻止所有领域 solution。

## 2. 同一个实例，三种使用深度

| 人员 / 任务 | 拿到的对象 | 可以隐藏 | 仍须承担 |
|---|---|---|---|
| 普通展示组件作者 | 原 `app.view`，通过 `ordinarySpendingPanel` / 本地值绑定观察 | Node 消息处理、构造 scope、authority、输入 lanes、binding 与 host | 表示“缺当前事实”；解除观察只调用返回的 detach |
| 应用集成者 / 框架作者 | 原 inputs、一次 compose 结果、需要下传的原 capabilities | 不需要重写 identity/lifecycle/evidence 算法 | 明确五个输入 Node 的四组职责、独立验证来源、许可来源与资源归属；保持运行 owner |
| library 维护者 | 同一 Graph、原 capabilities、按需 owner 诊断和证据引用 | 日常可先看业务视图 | 核实实际边、authority 单次提交、请求与结果的精确关联；解释证据边界 |

“普通用户”要区分只写展示的人和负责接入数据的应用作者。后者的来源、验证、许可和资源责任不能凭简短调用消失。本轮把这项成本直接写在应用示例中，不用四个来历不明的变量冒充零配置接入。

沿用实际存在的本地调用链：

```ts
// 位于 spending 示例目录；应用先构造显式 inputs 和离线资源。
const preset = spendingAlertsFor(graph, { name: "alerts" });
const app = preset.compose(inputs);
const detach = ordinarySpendingPanel(app.view, show);
// 应用保留 app.owner 和 app.inspect；框架只向对应组件传原子集。
const execution = app.capabilities.execution;
const retained = app.capabilities.retained;
```

这是已有符号的责任示意，完整可运行应用仍需展示 inputs 的创建。`inputs.evaluations` 包含 pack/arrivals/current，另外是 verification、localAuthority、inbox。配置只持有不可变默认值，compose 才构造完整运行实例。diagnostics 默认 off；summary 不是保证级别，也不提升许可。

identity、execution、retained 维持原包含关系。**只传 identity 不会删除 lifecycle/evidence 节点；只传 execution 也不意味着拥有执行 I/O 的方法。** API 渐进披露与运行时裁剪是不同问题，后者不在当前支持范围。原 Node 引用不是安全沙箱，TypeScript 窄类型也不构成安全隔离。

固定装配中直接传 A 的原 capability，不新增 expected-object 参数或注册表。已有构造时签发/lineage 检查、Graph/binding 检查及运行中的 occurrence/admission/outcome 匹配继续保留。实例接对和某次操作获准需要不同证据。

## 3. 生命周期展示与责任

普通 view 仍为 assessment、publication、coverage、issues、startup 五个原端口；本批不扩展字段。

| 可见事实 | 可以表达 | 不能据此表达 |
|---|---|---|
| 尚无 DATA，或 ERROR/INVALIDATE 清掉旧值 | 当前没有可用事实 | 默认成功、false 或已经结束 |
| startup=started | 该实例启动事实成立 | effect 已获准、发布成功、整次运行结束 |
| assessment 触发条件 | 有待处理业务结论 | 已满足全部许可和独立验证 |
| 某精确 publication 成功 | 该请求报告成功；本例仍标离线模拟 | 所有请求成功、所有证据完整或整个 run 已结束 |
| coverage 或 issue 的当前值 | 该端口所关联的范围/问题 | 与其他端口自动形成同一时刻的完整证明 |
| 应用诊断 runEndReady=true | 图侧收尾条件在该时刻满足 | 已释放运行资源、可删义务 |
| 应用诊断 normalEndReady=true | 原宿主当前额外排空条件满足 | 已执行完整生命周期结束、持久 checkpoint 已提交 |
| UI detach / 全部展示退订 | 此组件停止观察 | 取消请求、结算 obligation 或结束 owner |

本协议没有 END 消息；业务 stop、节点 COMPLETE、图侧收尾条件和整个运行结束不能混称。stop 后新到的事实如何拒绝和保留，由已有有界 host/authority 契约处理，不增加“无限记录所有被拒绝消息”的要求。

`runEndReady` 已有四条真实依赖；`inspect().normalEndReady` 还检查 fault、inFlight、scheduled、delivering。这里只在维护者/应用手动检查中解释这些现有事实。普通界面不新增轮询、不读其他节点 cache、不自动调用 inspect，也不显示一个没有精确事实来源的“已结束”。

本地 `mountSpendingView` 继续处理 INVALIDATE/ERROR 后清值。公共 `subscribeNodeValues` 当前忽略 INVALIDATE，故不是本例可直接替换的适配器。本批不顺便改变全库 adapter 语义。

## 4. graph is the system that runs：本批如何呈现

一个完整运行例子分三条阅读路径，但保留同一输入与实例：

1. 普通路径：输入尚缺 → 有评估 → 已提交请求待结果 → UI 退出 → 结果返回 → 重连观察；明确最近值与未知。
2. 框架路径：在同一个 Graph 创建 A/B 两实例，分传原 execution/retained；A 等待期间挂载和移除展示、观察 B，A 的义务与结果归属不变。使用既有不同名字、inputs、资源及 epoch 约束；不新建组件身份协议。
3. 维护者路径：从业务结果引用定位原图中的相关节点与请求、admission、outcome，再打开当前可用的源码绑定/provenance/独立验证引用。节点 ID 和拓扑相同不等于实现没改。

展示逻辑只格式化事实；不负责准许、执行、重试或结算。真实推进仍由输入 lane → authority 调用 transitionCausalAuthority → 同一 context 中 identity/lifecycle/evidence → 一次 ctx.state.set → 原输出投影完成。host 按既有精确路径消费请求。

同拓扑变更的说明保留三列：**实现修订变了什么**、**谁改的有什么 provenance**、**哪些后果有当前独立验证**。无绑定范围显示“未覆盖”，无 provenance 显示“未知”，旧 receipt 不能给新修订标“验证不变”。本批不实现全仓库自动源码映射，也不重新计算旧资格来制造当前通过。

## 5. 一次实施的具体交付与验收

推荐下一批只完成以下文档/示例/验证范围，保持 runtime、公开符号和既有语义不变：

| 交付 | 具体文件范围 | 完成标准 |
|---|---|---|
| 公共入口指引 | `packages/ts/README.md` | 按使用任务指向真实 exports；区分领域 solution 与通用 pattern；不承诺 private spending import |
| 旗舰阅读入口 | `examples/spending-alerts/README.md` | 区分原五跳演示与完整 causal 离线示例；列明普通组件、应用集成、维护者路径和命令 |
| 完整角色组合示例 | 原 `causal-graded-demo.ts`、`causal-audience.examples.ts`；必要时一个本地辅助示例 | A/B 运行、精确原引用、缺事实、detach/reconnect 均可实际运行；不得只提交未经执行的片段 |
| 生命周期解释 | 原示例说明与 ordinary panel 的必要文案 | 遵守第3节表；不加端口、总完成布尔值或自动读取内部诊断 |
| 验收与收据 | 既有 graded-entry/audience 测试及一份本批证据 | 只补缺失的行为断言，保存命令/结果/源绑定；已有双实例与身份测试直接复用，不重复写一套镜像测试 |

具体检查：

- **静态入口**：示例普通组件不导入 authority/host/construction；仅获取 view，不获得 publish/approve/feed；框架原能力引用保持一致。公开路径由实际 package exports 查证，private imports 明示仅仓库内可运行。
- **运行组合**：配置零节点；compose 一次完整闭包；挂载不增加节点、不启动第二实例。对每个实例比较挂载前后 topology；退出不改义务，重连不重发 effect。
- **依赖/身份失败**：复用错误 Graph、epoch、重复输入和资源的已有构造负例；复用错误 outcome、过期 admission/currentness 的既有行为测试。保持 failure-atomic 与已承担义务的区别；不以运行失败时“补依赖”作为恢复。
- **失效与空值**：ERROR/INVALIDATE 清旧值、无 DATA 为未知；成功 publication 不覆盖缺失 coverage；结果不是跨端口原子快照。
- **图与证据**：展示的对象来自原运行，源码绑定与证据引用可追溯；旧机器证据作为历史，不以本文更新日期重签。只检查本批引用与行为，不启动 B139 正式 human/agent 实验。
- **整体 gates**：涉及示例源码后运行所有 TS 离线测试、lint/typecheck/build/export 与历史 artifact integrity；保留 currentQualified=false。独立 QA、修复本范围问题、显式 commit。未变的 authority runtime mutation 不伪称本轮重跑；如确需改 authority/host 语义，则先报告为超出本批的设计问题。

测试先盘点 `causal-graded-entry.test.ts` 已有同图多实例/override/资源用例和 `spending-alerts-audience.test.ts` 的退订/重连用例。新的 demo 集成只需验证此前未执行的用户路径；不为了凑验收数量复制它们。

## 6. 性能与认知成本

本方案没有新的 library 运行时抽象。文档增量为零运行成本；调整示例不会改变既有应用的依赖闭包。原 view 的五次订阅、值对象格式化/分配、summary 可选节点和按需 inspect 均是已有成本，不能称为全流程零成本。

新增 A/B 演示真实运行两个完整实例，会自然增加演示资源；不能拿它与单实例比较并归因为分层开销。验收比较同实例、同配置下的节点/订阅与 effect 次数。若示例确实引入新的持续工作，应先消除该新增工作或说明具体必要性，不重开无限性能诊断。

已有 CJS 共享修复的短测增加约3ms导入中位数，保留为独立已知代价；不归因于本次入口指引。原正式性能预算与未合格状态不变。

认知成本的可检查目标：普通组件只处理业务值和缺值；框架清楚四组来源与运行 owner；维护者能够下钻同一图。编译、运行 demo 和作者走查只能证明这些路径存在，不证明普通人更快或学得更好。人类使用效果以及与完整 plain-host 的优势仍缺独立研究，不能在文案里预填成功。

## 7. Q5–Q9 设计审查

### 目标一：入口层次与角色路由

**Q5 抽象/归属**：沿用当前 core/graph/patterns/solutions，公开面依据 package manifest；spending 专用的 inputs/oracle/host 保留 example。源码依据：`packages/ts/src/core/index.ts:1`、`patterns/index.ts:1`、`solutions/index.ts:1`、`examples/spending-alerts/causal-entry.ts:51`。不是新增 verb，也不是把每个私有实现都推广。

**Q6 长期风险**：文档路径可能与 exports 漂移，通过 manifest 与实际构建包门禁检查。INVARIANT：视图缩窄不减少完整依赖；四组输入和 owner 必须仍有责任方。未来新的真实集成才触发通用公开 factory 审查，不把测试 reuse 当产品资格。

**Q7 简化/响应式**：pack 与 current 等显式源 → assessment/explanation/publication-policy 分支 → admission/authority → 原 publication sink；describe 显示同一组实际节点/边，角色切换不重建图。既有 authority 的唯一提交见 `construction.ts:175–188`；入口没有隐藏状态推进器。

**Q8 替代**：A 立即发布 spending focused solution/testing：npm 接入更短，但背负未合格宿主与单 consumer 泛化承诺；B 现有公开入口指引 + 私有完整角色示例：不新增运行机制，承认库外普通应用还不能直接 import 本 preset；C 再造通用 capability factory：暂缺独立需求，会重开有限组合/身份设计。

**Q9 推荐 B**：覆盖已有层次、可组合性与必要性；部分覆盖易用性，因为公开 causal 接入与真实用户实验尚未完成；不覆盖新公共 preset。接受这个已明确的阶段边界，不以它宣告 B121 完成。

### 目标二：原引用与生命周期展示

**Q5 抽象/归属**：组件只负责观察；authority 和 host 保持义务与保留。原capability字段见 `capabilities.ts:22–42`，view见 `causal-preset.ts:171`。没有第二套组件注册/身份表。

**Q6 长期风险**：窄类型不是沙箱；最近值不是一致快照；ready不是ended。INVARIANT：UI退出不能结算；错误/过期结果不能清掉 obligation；无事实不能沿用旧UI值。当前 `causal-focused-host.ts:500/567` 只提供条件与诊断。

**Q7 简化/响应式**：保留 `mountSpendingView` 的五个原Node订阅和失效清理（`causal-view-binding.ts:20/47`）；不新增投影Node、timer或按事件 identity 检查。框架从同一次 compose 分传原引用。

**Q8 替代**：A 沿用五端口，在应用诊断解释收尾条件：最小且符合当前事实；B 增加第六端口：多一个普通用户概念，尚无需求；C 新增“已结束”事件：当前没有精确终态来源，将引入新host契约。既有公共adapter也不能无条件代替本地失效处理。

**Q9 推荐 A**：覆盖组合、当前事实和owner责任；部分覆盖整体生命周期可见性，因为普通view不显示整次结束。该限制直接说明；若真实产品必须显示结束，需先有精确宿主事实，而不是把ready改名。

### 交叉验收

A 有未返回请求，UI切到同Graph中的B。B收到成功publication；A随后在无UI时完成并重连。要求A/B原引用、原依赖、请求结果归属、失效显示和owner记录同时保持，不能分别通过类型检查和生命周期用例便推定组合成立。

## 8. 状态与登记边界

- 已有：B139选定spending、TS分层设计D160/D161/D162/D170、私有factory/view/capabilities、机械组合与CJS修复证据。
- 本批待做：第5节的使用指引和可执行接入示范收口；不是新增library算法。
- 尚未解决：通用causal公开面是否有足够consumer、生产inbox资格、精确整次结束事实、完整plain-host与隔离human/agent比较、原正式性能条件及root B121汇总。它们是边界清单，不是这批的并行任务。

唯一交付 owner：graphrefly-ts。本文属于已有设计下的实现/验收提案与审阅证据，不新建D号或work，不改变已完成的设计记录，也不将仍planned的CAUSAL-PRESET-ASSEMBLY-TS改成complete。若实施中出现新公共接口或语义选择，再由唯一owner办理单独决定；本次继续只授权准备本文。

本轮仅做源码/authority核对与设计文件检查，没有重跑产品测试、性能或任何provider/live/spend。批准本方案后，按第5节一次完成实施、离线验证、QA和commit；无需另批每个常规修复。
