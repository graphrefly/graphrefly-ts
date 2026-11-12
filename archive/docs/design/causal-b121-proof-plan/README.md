# B121 下一批：同条件宿主证明设计

2026-09-14 · 基线 `aa5bfc16` · 待审阅；本轮只有现状核对与设计，未实施或执行 inbox effect。

**推荐把下一批聚焦为：准备可核实的真实本地 inbox 路径、匹配的 plain-host 对照和独立验证；先完成离线实现与资格准备，真实文件写入留到具体执行清单可审阅时授权。** 不再增加使用入口，不重开性能优化。此工作不能单独关闭 B121，但解决后续正式证明共同依赖的真实执行与对照缺口。

## 1. 当前结果和剩余差距

| 事项 | 本轮核对结果 | 下一步意义 |
|---|---|---|
| 分层使用 | aa5bfc16，2670测试通过/4跳过；实际A/B组合、退订/重连、原引用和拓扑已验收 | 不重复设计或重跑相同体验试验 |
| 当前source-binding旧证据 | 正常臂56个manifest输入，其中55个磁盘文件与当前字节一致；另1个是脚本内嵌worker | 可保留历史有限结论；不是新的构建/运行认证 |
| 该实验到底验证什么 | 等价的amount取值表达式变化、旧source/runtime receipt拒绝、当前receipt模拟写入 | 未证明B139要求的真实文件effect，不能把语法等价实验扩大成全部算法证明 |
| 当前Graph宿主 | OfflineAlertResource明确只报告模拟字节；真实guard、64条记录与单in-flight已经存在 | 不能把fs callback塞进OfflineAlertResource后改报告说“真实资格通过” |
| 当前plain | PlainSpending有独立协调/数值计算，接收inbox观察事实 | 没有与Graph宿主对等的writer、完成投递、故障/结束边界；当前体验比较not-comparable |
| 当前verifier独立性 | plain使用spending-publication-oracle的canonical/hash/material/snapshot helper；数字计算独立 | 不能再让同一个material构造器作为对plain自身请求正确性的唯一oracle |
| 原数字举例 | B139示例是Welford；D166已批准RN64精确统计。当前std与zScore分别计算 | 反例必须命中实际评分/请求路径，而非只改未参与判定的展示std |
| owner接线 | root B121还只依赖contract、原TS arm、B139 brief和composition design；原assembly仍planned | 后续必须补精确实施证据生产者；局部收据不等于root完成 |

上述source匹配是文件比较，不是新测试。原收据和worker仍需按自身版本读取；本轮不重签资格、不修改历史artifact。对应审计见 audit.json。

## 2. 有限业务与所有权

固定业务仍为已有 append-alert、完整contract-v2闭包、原请求/admission/outcome关联。保留D160/D161/D162/D166/D170的业务、构造、数字和host完成约束。

- TS owner负责消费实现、Graph/plain执行器、离线检查和产物；root负责B139语义、冻结真值与最终独立汇总。root的评分规则不由候选report里的passed字段定义。
- 本地effect只追加到为本次case预先准备的专属空文件；不采用已有用户inbox，不联网、不调用provider。执行时需明确每个文件路径/目录、候选摘要、场景、数量上限与清理规则。
- 每epoch继续最多64条保留请求记录（含拒绝）、一个in-flight、payload沿用现有容量上限。busy/额度不足不排队、不自动retry；unknown不能当作未提交或已成功。
- 保证范围仍是单进程受测host生命周期与保留记录；不承诺crash后exactly-once、持久checkpoint或fsync durability。实际readback证明本次可读内容，不证明断电持久性。
- UI仍只有原五端口；真实宿主准备/关闭由应用owner承担。关闭文件句柄只是资源操作，不能抹去未决义务。

## 3. Graph真实资源入口：建议的最小内部变化

建议将现有private资源的“单次claim→transfer→write”的身份/所有权机制保留一份，将模拟与本地文件的构造来源区分清楚。对外仍不新增任何package export。

候选实现位置：现有 `examples/spending-alerts/causal-focused-host.ts` 及一个本地资源模块。内部命名在实现前锁定；形状为同一个受控private资源契约，分别由offline factory和local-file preparation创建，mode不可由调用者通过普通对象伪造。

- 构造预检仍先验证Graph/binding/资源身份；实际文件准备是宿主边界的显式异步资源步骤，不进入同步wave核。
- 将审批范围绑定到已准备的专属资源/文件句柄；写入不接受request提供的新路径，不在每次请求时重新按路径打开文件。
- 复用原最终currentness/admission guard、reserve-before-write、原完成记录和coalesced source投递。资源层只做有限字节I/O和结果报告，不获得准许/重试/结算权。
- 同一epoch同一文件独占；新case用新资源。重放同request不得产生第二次真实调用。资源身份表不增加为进程全局或Graph第二份registry。
- 写入失败分类必须有证据：确认未尝试提交才能报告known-no-submit；短写/异常且可能有字节进入时为unknown，保留记录，停止新写，交给独立readback报告实际内容。不得看到文件最终内容就回填伪造的历史成功。

这会修改当前offline-only资源边界，属于新的TS局部设计取舍，需要批准和owner记录后实施；不是此前入口实施的隐含授权。没有批准前不改OfflineAlertResource或host。

## 4. Plain与verifier：同条件而非共享正确答案

| 边界 | Graph臂 | Plain臂 | 可共享 / 必须独立 |
|---|---|---|---|
| 输入/政策/数值域 | 现有真实graph lanes | 现有PlainSpending事件入口 | 冻结被动数据相同，处理独立 |
| 许可/因果/守恒 | 原authority与guard | 独立plain状态转移与host guard | 不共享Graph协调helper或Graph判定结果 |
| host obligations | 原bounded records、inFlight、完成投递 | 显式plain对应状态，具有相同限制/故障schedule | 不把Graph宿主包给plain后称完整独立对照 |
| 文件传输 | 受控写入字节 | 同契约受控写入字节 | 可共享只负责I/O的底层传输；不可共享admission/记账判定 |
| 真值与readback | 验证候选closure、预期请求、实际文件 | 用同一冻结标准验证plain | verifier独立生成/核对请求字段与字节；不依赖两臂的构造helper |

当前plain和oracle共享material helper要明确整改：保留plain已有实现，另在独立verifier中由被动schema、输入和政策重建字段/编码/摘要。禁止导入PlainSpending、其material helper、Graph计算或authority。共享标准SHA256库不等于共享业务真值；pass/label、候选自报writes和host journal不能替代独立文件读回。

先冻结相同输入、逻辑时间、grant、故障注入点、容量与结束判据，再运行两臂；输出包含before/after文件摘要、实际调用次数、请求/结果关联、unknown与保留状态。Graph不同角色示例不是plain，G/M同图装配对照也不是plain。

本批为后续比较准备同条件臂，不先宣称Graph胜出，也不更改原性能预算。正式时间/内存比较不混在功能资格里悄悄开始。

## 5. S1–S8接到当前实现

B139的场景语义保持，具体源码目标适配已批准D166。不能照旧查找不存在的Welford片段，也不能只运行“把解构写法换一下”。

| 场景 | 当前实现上的具体证据目标 |
|---|---|
| S1同拓扑错误 | 改 `causal-numeric.ts` 的实际sample评分因子为population关系；同时记录std/score受影响位置。构造如[1,2,3]、known category、dailyAverage=100、zThreshold=1.1，使sample score=1而population约1.224；独立verifier拒绝错误候选，实际writes=0。阈值/其他告警条件须在冻结输入中排除混淆 |
| S2同拓扑等价 | exact BigInt的评分表达式作等价代数改写，例如乘(n−1)改为乘n后减原项；保持RN64舍入与原拓扑。当前closure变化可见，独立域验证通过、有效许可下一次写入并读回精确匹配 |
| S3 fan-out/in | 两vendor与policy/profile修订按冻结合法顺序交错，缺branch保持pending，结果按key关联。不要用A/B两个实例的UI演示替代同实例的branch验证 |
| S4错因/过期/缺口 | 复用字段维度与quiet规则，连接实际writer零调用/零文件增量；修复缺口不是删除gap |
| S5 replay | 同生命周期精确重放无新写；同ID换payload不覆盖；analysis replay只读artifact且无writer能力 |
| S6 outcome | 成功、确定未提交、短写/未知、未返回、错误admission outcome；分别核对实际字节和未结状态，不能用无日志推成功 |
| S7 coverage | 缺verifier/旧source绑定不得写；缺provenance只使归因unknown；容量不足诚实降级，必要currentness缺失fail closed |
| S8负对照 | 已知类别/正常交易无新写；仅改CLI标题只记scope外source变化，不宣称全仓库不变；保留plain更简单的可能 |

示例数值用于说明触发条件，尚不是新冻结manifest或执行结果。实际完整域沿用D166已批准输入/容差/严格比较约束；root确认S1/S2源码映射与oracle方法衔接，不由TS自行降低B139要求。

真实mutation仍要改加载的代码/依赖并让同一host路径执行。只改describe、编译失败、超时、未触发、construct guard早拒绝都不能自动算业务kill。分别记录attempted调用、实际字节、哪条防线拒绝；保留survivor，不为凑kill数量关闭其他真实防线。

## 6. 一次准备批次与明确边界

批准后的**准备批次**建议一次完成：

1. 登记最小局部资源边界决定和相应owner work；不把旧assembly的正式性能条件改掉。root B121补依赖时引用精确producer，不把设计artifact当完成证据。该登记需要批准后的独立owner变更与workspace/dashboard gates。
2. 实现受控local资源和匹配plain-host；完善独立verifier依赖闭包、source/runtime/lock绑定和readback接口。此阶段用离线传输及故障注入验证，不使用真实inbox写入证明。
3. 固定Graph/plain场景manifest、实际mutation位置与执行器限制；完成编译、所有离线测试、lint/build/export、独立QA、收据与commit。
4. 交付可审阅的**真实执行清单**：已构建candidate/verifier摘要、每个case/mutant文件路径、总调用/字节/时间上限、fresh目录与读回/清理规则。批准这个具体清单后再运行真实写入。准备通过不自动dispatch。

准备完成的判据是路径和清单可执行且离线检查通过，不是S1–S8真实效应已通过。真实执行结果齐备后，再准备隔离的human/agent packet；当前聊天用户已看过结果，不能当盲测样本。

Human/agent实验沿用B139先预测后receipt的两阶段和8场景/20业务边界节点/40关键事实/2diff上限。共享工作目录的材料白名单不是隔离，必须把hidden answer/oracle移出参与者可搜索环境后才可称blind。模型、人数、工具与预算仍须先冻结；本计划不启动实验或provider工作。

## 7. Q5–Q9审查

**Q5**：真实文件I/O归private host资源边界，不归core/patterns/authority；plain是对照实现，verifier是独立资格工具。没有新公共primitive或任意effect runner。

**Q6**：核心风险是“模拟对象冒充真实资格”和“plain与oracle共享错误”。INVARIANT：mode来自受控资源准备，精确binding/单owner不变；两臂许可与义务独立；预执行通过不代表实际写入成功。最大维护成本是匹配plain故障模型，应只覆盖冻结有限域。

**Q7**：Graph保持真实输入→guard→host outcome source→authority的原路径；文件传输不重做策略。一个private资源机制比复制整套host少维护面，但要求清晰区分模拟/真实来源。不存在新registry、隐藏队列或timer重试。

**Q8**：A直接给OfflineAlertResource传fs callback：代码短但违背已有身份/证据标签；B同一内部所有权机制，显式两种准备来源，并补独立plain/verifier：可复用真实路径且证明边界清楚；C新建通用持久effect框架：扩大到durable/recovery，非首证据所需。

**Q9**：推荐B。覆盖真实执行路径、对照独立性、完整义务与有限成本；部分覆盖B121，因为人类研究、正式性能条件与root汇总仍缺；不覆盖crash恢复、通用solution发布或生产inbox安全性。残余项保持原owner，不从本准备批次推导完成。

## 8. 本轮交付与未授权动作

本轮只新增这份提案与只读source/owner审计；不更改任何决策、work状态、runtime、旧收据或qualification标签。按project-governance分类为审阅提案与attempt/evidence，非新的架构锁。拟议资源变化唯一owner是graphrefly-ts；B139场景方法与root依赖登记由graphrefly分别审阅。

尚未授权：上述新host边界实施、真实文件effect、provider/live/spend、正式人/agent实验、预算变更与B121完成。下一次批准可以覆盖第6节完整准备批次，但不自动包含尚未生成的真实执行清单。
