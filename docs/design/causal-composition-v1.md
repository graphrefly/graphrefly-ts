# TypeScript causal composition — design-v1

2026-09-06；对应既有 `graphrefly-ts:CAUSAL-COMPOSITION-DESIGN-TS`。设计状态由 `docs/docs.jsonl` 与 owner work 记录；持久选择见 `graphrefly-ts:D160`。

Artifact：`graphrefly-ts:causal-composition-design`；schema：`graphrefly-ts/causal-composition-design/v1`；revision：`design-v1`。用户在任务 `01a077c7-55e6-7f11-9d4f-e7c51944afb4` 审阅本设计和三个取舍后回复“同意”。同目录 manifest 绑定已审阅草案、此正文、brief-v1 和 ts-v3。以下保留设计分析；第 1 节记录审阅时基线，不替代 owner work 的当前状态。

建议：**一个 authority、三组可独立测试的内部职责、精确 capability handles、一个 graph-bound spending-alerts preset、一个 focused inbox adapter。首个支持的运行组合固定为完整 contract-v2 闭包；diagnostics 可独立关闭。**

本提案细化 B139 已选 consumer 的 package/consumer 接口，不重新选择业务，也不改变 D791。本轮设计已获批准；public generic occurrence primitive、arbitrary-effect runner、provider/live/spend、Stack/Canvas 与 durable runtime 都不在此次批准范围。

## 1. 已核实的输入与关键发现

- [B139 brief-v1](/Users/davidchenallio/src/graphrefly/sessions/archive/SESSION-b139-causal-flagship-brief-v1.md) 的正文摘要与 manifest 相符；root D793 已选择现有 spending-alerts + local inbox effect。B139 complete，B121 proposed。
- [owner work](/Users/davidchenallio/src/graphrefly-ts/plan/work.jsonl:61) 仍 proposed，消费 brief-v1 与 ts-v3。没有新的实现 work 或执行许可。
- [TS D151](/Users/davidchenallio/src/graphrefly-ts/decisions/decisions.jsonl:56) 要求复用适用的 focused execution、exact correlation，禁止新的公共任意 effect runner。
- [bundle 输入与输出](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence.ts:155) 目前是八类输入 lane、七个输出；没有 exact admitted-effect 输出。代码里的 `export` 不等于 npm public export；当前 package 没有 causal 子路径，solutions barrel 也没有导出该 bundle。
- [单一 authority](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence.ts:598) 共用 domain/high-water/retention/pending/terminal/effect/evidence 状态。[回收判断](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence.ts:694) 依赖已释放 occurrence、required terminal 和未结清 effect。
- [提交与 release](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence.ts:1802) 有同步有限进展 drain、先提交 ctx.state 再输出事实、pull-quiet 生命周期边界。不能靠换几个输出名称完成分层。
- [admissionHandoff](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/patterns/admission-handoff.ts:170) 是现有 quiet handoff 先例，但它的 bounded recent 去重不能直接替代 D791 的连续 currentness 与 lifetime retention 证明。
- [focused adapter 先例](/Users/davidchenallio/src/graphrefly-ts/packages/ts/evals/graph-native-rerun-avoidance/focused-async-adapters.ts:13) 在调用 transport 前登记 consumed identity，保存有限 lifetime receipts 并跟踪 active promises。它只是机械执行先例，不能照搬其 kind 检查就声称获得本 consumer 的授权。

root 中上一轮未提交的 D793/B139/DS-14/brief 文件保留；TS 工作区当前干净。审阅阶段只新增任务附件；本次批准后冻结本正文并完成原设计 work，不更改上一轮 root 文件。

## 2. 先决定真正需要拆开的东西

| 方案 | 形状 | 优点 | 风险/代价 |
|---|---|---|---|
| A 保留完整 bundle，直接加 consumer 接线 | 全部 lanes → 原 bundle → 新 focused handoff | 内部改动少；ts-v3 可直接作为旧行为基线 | 单函数很大；ordinary consumer 承担 lane/correlation 组装；仍缺 actual host proof |
| **B 内部职责拆分，单 authority 协调，外部有限 handles + preset** | typed facts → 单次 authority transition → typed projections / admitted request | 唯一 identity/记账权威；跨层回收不变量集中；普通路径小；能对内部职责独立测，再做 full closure 对照 | 需要受控重构和新资格；最初完整 runtime 的资源成本仍在 |
| C 三个独立有状态 runtime 节点 | identity → lifecycle → evidence；回收情况再反馈 identity | 看似可单独按层付费 | identity 回收需要上层义务，容易反向循环、重复 currentness 或异步补丁；不是现有 bundle 的安全机械拆分 |

**推荐 B。**小 kernel 指共享的身份、接纳、状态提交与有限进展协调骨架；统计政策、inbox 授权和报告逻辑不进入这个 kernel。三组内部职责真正分文件、分状态责任、分 transition 测试，但不各自宣布同一个 occurrence 是否当前、可回收或可执行。

**明确的第一版取舍：**先提供完整闭包的 capability 视图及受支持组合；不支持“去掉 lifecycle 但仍自动回收 occurrence”“去掉证据却仍宣称 retained proof”等减配 runtime。后续若要真正 identity-only/执行-only 的更低成本 runtime，需要它自己的关闭/回收/缺失能力验收，再增加支持矩阵。这里没有把小接口宣传成低成本运行时，也没有用假 terminal 填补删掉的层。

这保留 D792 的 audience rings，并允许 ordinary preset 先落在一个可证明组合；B121 对所有**支持**组合的验收仍适用。这项首版收敛已获本轮批准。

## 3. 内部模块与唯一状态责任

下列路径、符号均是设计目标，不是已新增文件或公共 API。

| 内部模块（`packages/ts/src/solutions/causal-occurrence/` 下） | 负责 | 明确不负责 |
|---|---|---|
| `identity.ts` | canonical DATA/ref 校验，domain lifetime 注册，revision/high-water/gap/currentness，occurrence admission 与 release-once 集合 | consumer policy；文件 I/O；重新解释 verifier |
| `lifecycle.ts` | exact branch terminals、effect proposal/admission/outcome、DataResult、conservation、义务集合 | 独立复刻 identity registry；自行驱逐 occurrence |
| `evidence.ts` | required evidence coverage、bounded retained facts/gaps、retained quiescence 所需证据 | 赋予执行权限；用 coverage.complete 代替业务 verifier |
| `transition.ts` | 一个 ctx.state 根、固定调用顺序、容量与回收协调、有限进展 drain、提交原子性 | 插件回调链；可配置协议策略；共享 graph-global 状态 |
| `topology.ts` | 声明 lanes/authority/projections/quiet ports、私有拓扑组生命周期 | 从 metadata 注入隐藏节点；无依赖的全局读取 |
| `contracts.ts` | 当前被动 typed facts、内部 branded handles、闭合 descriptor 类型 | 公开任意 runner 或 plugin registry |

状态根由一个 authority node 的 `ctx.state` 持有。内部模块可通过受限 transition context 操作其负责的 slice；各模块不得持有跨 transition 的外部可变引用。`transition.ts` 负责统一 commit；异常前不发布半份业务事实。业务函数仍作为 graph node function 经 dispatcher 调用；内部纯校验 helper 不作为可插拔 fn 绕开 dispatcher。

回收流程由 identity 提出 victim，经 lifecycle 的 unresolved obligation 检查后统一提交，再清理相应 evidence。不能由 evidence 模块独立清掉身份 tombstone。已接受的 terminal/result/capacity/replay 语义保持 D791/ts-v3；只要重构不能保持这些结果，就停止该路线而不是修改 contract 迁就代码。

## 4. 有限 capability 接口与构造过程

### 类型轮廓

以下伪签名只用于评审，第一版均 package-private：

```ts
causalComposition(graph, defaults): CausalSetup

setup.composeFull(facts, binding, limits): FullCausalCapability

FullCausalCapability = {
  identity: IdentityCapability,
  execution: ExecutionCapability,
  retained: RetainedEvidenceCapability
}

IdentityCapability = {
  released, currentness, issues // typed Node ports
}
ExecutionCapability = {
  identity, terminals, conservation, causalQuiescence
}
RetainedEvidenceCapability = {
  execution, coverage, retainedQuiescence
}
```

实际 handle 还带 private nominal brand 与 immutable binding coordinate：所属 Graph 对象、composition 实例、contract-v2、实现/qualification revision、scope/domain policy、生命周期 epoch。后两层持有前一层的**同一个 exact handle**，不是拷贝一个形似 DTO 的 lower capability。品牌只防误接，不是抵御同进程恶意代码的安全沙箱。

手工接线者使用 returned `identity`/`execution`/`retained` 接口连接各自所需的输出，仍可 inspect 全部真实边。不能把一个裸 `Node<CausalEffectAdmission>` cast 成执行能力，也不能把两个 composition 的不同下层拼成“完整”。第一版没有 `installPlugin`、`registerCapability` 或运行中 `.upgrade()`。

`causalComposition(graph, defaults)` 只创建冻结的 construction material，零 topology、零 subscription、零 I/O。`composeFull` 才建图；输入来自声明的 graph-local Nodes。它的 inputs 不接受裸 callbacks 来注入授权、retry、terminal 或 currentness。

默认值仅包含固定 profile 的资源上限和 diagnostics 姿态。业务 profile、阈值、verifier receipt、操作 grant 和当前 binding 都是 DATA，不是 setup config。

### 两阶段构造

1. **Resolve/preflight，无 graph mutation：**验证全部必需输入、exact graph ownership、qualified contract/revision/domain family、finite bounds、名字冲突、handle lineage、支持的完整 profile 和合法 diagnostics 选项。reject 缺 capability，不能偷偷补一层。
2. **Construct，统一 group：**创建被声明的 nodes/edges，最后才启用必要 keepalive 和 adapter subscription。所有 foreseeable compatibility errors 必须在第一阶段失败；第二阶段异常清理本次新增 registration/retain，原图保留。不得先订阅实时 source、执行效果后再发现配置错误。

当前 bundle 在内部调用 `graph.retain`，因此第一版实现必须把这项激活移到构造尾部；仅在外面包 try/catch 不满足失败原子性。验收比较失败前后 registrations、edges、订阅/retain 数与 host calls=0，不声称 JS OOM 可事务恢复。

运行时缺 occurrence/decision/terminal/verifier/grant 属于 quiet/pending/typed issue，而非构造错误。预先没有值的 source 仍合法；禁止 eager-placeholder 让缺数据变成默认“通过”。

## 5. 一个普通用户 preset，职责仍可见

建议保留在现有 example consumer 中，暂不加 npm 子路径：

```ts
const app = graph({ name: "spending-alerts" });
const alerts = spendingAlertsFor(app, {
  limits: retainedBriefLimits,
  diagnostics: "off"
}).compose({
  evaluations,      // bounded transaction-prefix/profile/policy facts
  verification,    // exact independent verifier receipts
  localAuthority,  // scoped local grant + current binding/time/stop facts
  inbox            // focused, qualified local host binding + readiness/outcomes
});

// Outputs: assessment, publication, coverage, issues, capabilities.
// graph.describe() continues to reveal every real node and dependency.
```

`spendingAlertsFor` 是本地 preset 的候选命名，不是新 Graph verb。第一行仍构造 graph。默认 factory 选择完整闭包；不会让 ordinary user 填八条内部 lane、手工生成 admission 或写 RESOLVED。输入整合为四个有严格责任的组，不意味着一个大对象可以携带不声明的隐式事实。

首个 extension slot 仅支持 exact qualified inbox binding；消息模板使用绑定到候选源码 closure 的现有 deterministic justifier。更换算法或模板需要新的源码 binding 与 verification，不提供 `algorithm: "buggy"` 一类演示开关，也不开放任意插件 callback。

local override 只允许 diagnostics `off ↔ summary`、qualified limits，以及另一个具备同一受支持 contract 的 exact inbox binding。override 解析为新冻结配置：字段明确继承、替换，不拼凑两个 policy 对象；`undefined` 表示继承，不表示禁用依赖。binding 变更也会失效旧请求/旧 verifier/grant，不能因为类型相同自动接受。

## 6. 实际 topology 与不成环的数据流

若 `released → business nodes → proposals → 同一个 occurrence authority`，便会形成回灌环。本 consumer 建议把无外部 effect 的候选计算放在 admission 前，最终发布仍由 authority 控制：

```text
evaluation input + exact source/policy binding
    │
    ├→ vendorStats ─┐
    ├→ transaction ┼→ anomalyScore → thresholdGate → reasonFactors → alertMessage
    └→ userProfile ┘                             │
                     policy facts ──────────────┼→ candidate branch terminals
                                                └→ exact publish proposal

proposal + independent verification + current local authority/readiness
    → publishPolicyDecision (candidate admission DATA, no effect)

occurrence / occurrence decision / branch terminals / proposal / effect admission
verification evidence / currentness watermarks / external outcome source
    → causal authority → committed exact effect candidate
    → quiet handoff → final current dispatch guard → focused inbox I/O
                                                      │
                    genuine I/O completion → outcome source
```

外部 outcome source 的事件来自真实 I/O 返回，是明确的外部 effect 因果边界；不是另开一个 timer 或 caller queue 给同步业务环“让一拍”。图内不把 host outcome 直接 `ctx.down` 回调到仍执行中的 authority。

**输入的具体化：**第一版用 brief 的有限 input pack 给出每个 vendor 的有界、不可变 transaction prefix（包含当前交易）、profile 和 policy snapshot。`vendorStats` 对这个 prefix 跑原 Welford 公式；不让一个被拒绝候选污染全局统计 accumulator，也不把候选验证过程当成消费一次真实交易。前缀 snapshot 的最大条数/bytes 明确；这是 finite proof 的 consumer 输入形状，不是库要求全部交易历史搬进 graph。

这个 source 形状调整属于本轮已批准的 consumer composition 选择。它避免双跑 base/candidate 共享可变历史；算法 mutation 仍发生在同一具名 vendorStats 的实现，正反例的相同 topology 对比在这套新基线上进行。

`revisionDomain` 建议由输入 owner 按 evaluation run/vendor 分配；每个 domain 使用连续 snapshot revision。Git SHA、交易 id 和 graph clock 都不能替代这条序列。base/candidate 使用不同 exact run/binding，比较器按共同 business subject 对齐；不重用 effect admission。相同 vendor 的输入顺序有语义；不同 vendor 的交错以及同 occurrence 的独立 branch 到达可以排列。r2 已使 r1 过期时不要求 r1 再执行以追求排列相等。

branch manifest 首版固定为 `assessment / explanation / publication-policy`。没有异常时 publication-policy 真实给出 no-publish 终态，零 effect proposal；不能把缺失 branch 记成 skipped。若 verifier 明确失败且仍有 flagged proposal，则该 proposal 拒绝；若 verifier 只缺失则 pending，不编造 terminal refusal。

## 7. 实际 effect handoff 的精确 contract

### 增加什么，以及不把什么当授权

现有 `released` 只证明 occurrence release；`conservation.admitted > 0` 只是 aggregate。两者都不足以说明“这一个请求现在可以写文件”。建议增加 **consumer-private exact dispatch envelope**，由 shared authority 的 committed effect record 导出，再经当前 guard 进入 inbox；不导出一个公共 generic effect runner。

envelope 被动 DATA 至少包含：完整 occurrence ref、effectId、requestRef、admissionRef、proposalDigest、payloadDigest、destinationRef、input/policy/source/runtime closure digest、verificationReceiptRef、grantRef、composition/host epoch。payload 有上限且 canonical；大内容只能是受绑定的外部 ref，host 不从不相关 latest cache 补字节。

consumer 的 `publishPolicyDecision` 检查 verifier 与 local policy 后给出 effect admission 候选；authority 只接纳 exact-correlated admission，并在登记 active obligation 后发布该精确 effect envelope。内部需要记录 issued/dispatch identity 的一次性资格；这是 TS consumer handoff 的局部状态，不新增 root conservation bucket。所有新 acceptance 输出与 ts-v3 旧输出分开绑定资格，旧 receipt 不为新端口背书。

### Dispatch 时刻与一次消费

1. quiet handoff 后的 guard 依赖 committed envelope、当前 occurrence/binding/policy/grant/clock/stop facts；exact join，禁止读取 `.cache` 或任意 host policy closure。
2. 同一同步执行段完成最后检查与一次性 dispatch reservation，然后调用已准备好的 focused adapter 提交 I/O。期间不 await、不再排队、不另建预执行定时器。若需等待资源准备，先由 readiness source 给出事实，回到 graph 重新判定。
3. adapter 的同步前缀检查同一个 runtime/epoch 发行的 exact request、digest、是否已消费及有限 receipt 容量，登记 consumed 后立即发起绑定 file handle 的 write；没有会重新决定业务的公开 `run(rawJson)` 路径。
4. I/O promise 完成后以 correlated DataResult/DataIssue 返回 outcome source；只有 authority 接纳的 exact outcome 可结清 effect。短写/可能写入但未确认不能报告 known-no-write；使用有根据的 unknown/reconcile-required。不自动 retry。

已 admitted 但在最后 dispatch 边界被阻止的 effect 也不能丢失：它需要一个 exact `cancelled` + typed `DataIssue` 的已知未提交结果，作为真实 focused execution boundary 的拒绝收据结清原 active obligation；只有 proposal 阶段的拒绝才属于 rejected bucket。这个边界包含已知拒绝与实际 I/O 两种返回，不把拒绝伪装成做过 I/O。其结果回送必须沿现有受支持的 adapter outcome source 机制，不能从 graph fn 同步重入上游 authority，也不能临时加 Promise/timer 专为域内排顺序。后续资格须单列“拒绝发生在 I/O 前”以及“已写入但结果不确定”两臂；若现有 focused source lowering 无法满足该要求，必须回到此设计补足机制，不能擅自实现一条旁路。

**current-at-dispatch 是本轮推荐的线性化边界。**提交之前已收到的撤销、过期或 revision 更新必须阻断。提交之后发生的撤销不能保证撤回 OS 已接收的写操作；最终如实报告实际 outcome 和先后证据。若要求 commit-at-latest、提交后撤回或跨 crash exactly-once，现有 brief 的有限 host 不够，需要另外的 transaction/durable 设计，不能暗加保证。

grant 的适用目的地、host epoch、数量上限、clock horizon、stop/replay 范围由 local consumer authority 事实明确；clock readiness 过期保持 quiet。物理 descriptor、私有资源准备和 I/O 完成归 adapter。这里设计的是运行中 consumer 的授权输入，不是创建 B137 项目级执行授权账本。

第一版 adapter 只认固定 append-alert 操作：建议 canonical UTF-8 JSONL 单条最多 4 KiB，单 host 最多一个在途 write；目的地 handle 已在另行授权的 host 准备阶段绑定到确切目标。factory/预检不打开文件。资源未 ready 时不发行 dispatch；不能把 pending requests 藏进 adapter queue。并发槽释放作为明确 readiness/outcome DATA 驱动下一次 graph 判断。

receipt capacity 是整个 host 生命周期的上限，不回收 consumed identities 换取重发空间。重启产生新 host epoch，旧 admission 永不自动迁移。仅重放历史 artifacts 的 analysis path 不 attach writing adapter。此范围与 brief 的 bounded replay 非声明一致。

## 8. Retention、quiescence 和替换

先保留 ts-v3 的四个语义上限及其实际作用：`maxOccurrences` 同时约束 retained occurrences 与 lifetime domains；`maxPending` 按现有 lanes 的实际口径生效；`maxEffects` 限记账能力；`maxEvidence` 限 retained facts。不要把 `maxPending` 描述成全局 pending 总数，也不能给旧字段换含义。

首个 finite profile 的建议值：occurrences=64、pending=64、effects=64、evidence=512；input prefix ≤64 笔、每项 evaluation ≤64 KiB、inbox record ≤4 KiB、host lifetime writes≤64。它们是待批准的演示支持上限，不是性能测量或生产建议。容量检查必须包括 bytes，不能只限制条数却允许无限大 payload。

| 情况 | 必须行为 |
|---|---|
| occurrence/domain 当前性证明不足 | quiet + bounded DataIssue/gap；不删 gap 恢复执行 |
| 记账容量满、存在未结清 proposal/outcome | 按 ts-v3 留在有界 pending；没有“容量失败就已 settle” |
| optional diagnostic recorder 满 | 明示截断/coverage，不改变业务授权；不会清空必要 tombstone |
| verifier 证据缺失/过期 | 即使 diagnostics=off 仍阻断该 consumer dispatch |
| causal quiescent，但必需 retained evidence 仍缺 | 可以诚实显示前者，不能标 retained-quiescent 或 complete proof |

**替换协议：**不热改已接受 composition。输入 owner 先提供 stop-new-work fact；继续接受已有 exact outcomes 并 drain。pending proposal 必须得到真实 rejection/cancellation 事实或维持未决；active/unknown 未妥善处理时拒绝释放旧组。只有 causal quiescence、保留策略所需 evidence posture、adapter active=0 与所有订阅退出都满足，才能释放 owned group 并显式构造新实例。旧 receipt/tombstone 不被偷偷 reset。新实例/host epoch 不能消费旧 grant/admission。

把 retained handle 换成 execution handle 仅改变调用方可见视图，不降低旧 composition 的责任和保留策略；若要真正降运行 profile，第一版拒绝。切换 diagnostics 的“局部升级/降级”通过新 frozen construction 及上述替换完成，不修改运行中的 accepted topology。

## 9. 支持矩阵与 qualification

| 组合或边界 | 第一版支持 | 验收 |
|---|---|---|
| Full closure + diagnostics off | 是 | S1–S8、实际写入/拒绝/守恒全部通过；retained proof 必需事实仍保留 |
| Full closure + diagnostics summary | 是 | 与 off 相同 request/outcome/业务 bytes；仅增加声明的诊断产物 |
| 同 full runtime 的 identity/execution/retained handle | 是 | 精确 lineage、只读能力视图；不能伪造或交叉接 graph/epoch |
| qualified limits / inbox binding 的构造期 override | 是 | exact qualifier 与资源边界；新 binding 使旧 receipt/grant 不再适用 |
| identity-only 或 execution-only 资源裁剪 runtime | 否 | compile-time 无对应受支持构造；强转/JSON 输入也同步拒绝 |
| retained without execution；execution without identity | 否 | 先于 topology mutation 拒绝，不隐式注入 |
| wrong graph/contract/revision/domain family/capability | 否 | failure-atomic、零激活、零 host call |
| 运行中 `.upgrade()`、plugin discovery、任意 callback runner | 否 | 无此 surface |

对受支持两种 diagnostics 姿态，覆盖默认和合法 override、替换成功和有 outstanding effect 时拒绝替换。每个拒绝路径都需实际 graph/subscription/host 断言；类型错误验证不能代替运行时兼容性验证。

**必须新增的 acceptance arms：**

1. 内部 identity/lifecycle/evidence transition fixtures 与重构后完整 bundle 回归；保留并重新适配 26 focused tests、73 runtime mutations 的不变量，不把旧通过结果称为新资格。
2. construction failures：静态缺 handle；runtime wrong graph/epoch/version；duplicate names；资源不支持；零 partial topology/retain/source activation。
3. exact handoff：wrong payload/admission/verifier/grant；same-turn revoked/stale；quiet buffer 内变旧；host identity replay；receipt cap；只允许一次真实写入。
4. state/result failure：known failure、短写/uncertain、wrong outcome、no outcome；无 domain failure protocol ERROR。
5. B139 S1–S8：base/candidate same-topology 正反例、bounded prefix、跨 vendor 到达、policy revision、replay、负对照；独立 verifier/plain/human-agent packet沿用 root brief，而不是由 TS 重写标准。
6. 移除真实 proposal/admission/currentness/terminal/payload/consumption/conservation/source-binding 路径，并观察实际 host 请求与 inbox。结构拒绝与行为断言分别记录；编译失败和 snapshot-only 不算行为 kill。
7. 关闭诊断仍必须杀死安全/业务 mutants。若一条边被冗余防线覆盖而 surviving，如实说明，不用额外结构断言冒充业务 load-bearing。

### 性能与规模预算

没有执行 benchmark；下面是设计预算，不是实测结论。

- graph-bound setup：零节点、零订阅、零 I/O；构造成本按已声明节点和输入数量计。
- brand/coordinate 检查只在构造或真正 handoff 做；不把全量源码、receipt manifest 或 I/O 证据在每个节点重新 hash。
- 内部拆模块后的额外 dispatch/包装预算：同一 bounded trace 相比 ts-v3，authority 额外纯协调目标 ≤1,000 ns/occurrence，完整同步路径 p95 增幅目标≤10%。复杂 hash、DATA clone 和 I/O 分开报告。超预算触发设计复核，不变成全 repo 的 benchmark CI 硬门槛。
- inbox transport 同步前缀的附加核对目标≤2,000 ns/request（不含 payload hash 与系统调用），每个运行 epoch 的 receipts 明确≤64，active≤1。
- 现有 reducer 有 clone、全表扫描和 pending drain，不承诺 O(1)；在 occupancy 1/16/64、evidence 0/128/512，以及 reverse-arrival trace 上测时间、peak RSS、保留字节、节点/edge 数。报告 superlinear 增长，不用简单 case 的均值掩盖容量边界。
- positive 与 simple negative control 都对照 plain；允许 graph 开销更高。节点包装不能重复拷贝大 payload；必要 correctness memory 不能通过关闭 diagnostics 被“优化”掉。

## 10. Q5–Q9：三个具体设计目标

### 目标一：单 authority 的内部职责拆分

**Q5。**层在 solution 私有实现，保留薄 node/固定协议。identity、lifecycle、evidence 有清楚的输入与状态责任；跨层回收由一个 transition owner 完成。没有 public generic primitive。依据：[state slices](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence.ts:214)。

**Q6。**INVARIANT：domain 注册覆盖全部 lanes；先验非法 result 不占容量；retention 不能丢 active obligation；finite drain 后提交一次 state。最大风险是“重构”时改变 arrival/capacity 行为，必须用旧不变量和新 consumer trace 双重验证。完整 closure 仍有扫描成本。

**Q7。**保留真实 input/authority/projection 边，算法与模块 source binding 可钻取。不要为画出三层图复制三个 mutable authority。其内部多个纯 helper 属于同一节点实现，应在 source binding 中覆盖；不把 helper 名当新的业务节点。

**Q8。**A 直接保留 1,000+ 行 closure：复用强，难隔离单测。B 单 state、固定模块 transition：可测试、唯一权威，但重构有成本。C 三状态机互反馈：图更分散，却需新的闭环/回收约定。现有 bundle 是 A 先例。

**Q9。**推荐 B。身份唯一、无协议变化、可回归均有明确路线；真实低成本裁剪尚不覆盖，第一版明确拒绝。下一步仅批准内部结构与完整支持矩阵，之后才能注册实现范围。

### 目标二：CausalSetup / capability handles / spending-alerts preset

**Q5。**setup 是 immutable construction，handle 是受限 topology outputs，preset 是真实 consumer 的有限装配；三者责任不同。先保留 package-private，避免单个 example 直接变公共框架。数据行业告警与已存在 WorkItem admission 提供横向适用先例，但不足以代替第二非测试 consumer 的公共泛化资格。

**Q6。**INVARIANT：brand+runtime lineage 同时匹配；lower handle exact identity 不复制；no activation before successful construction；override 不改变政策 authority。名字和路径可以在实现前调整，语义不能隐式漂移。两种 diagnostics 的兼容矩阵是首版维护成本。

**Q7。**应用先 graph、再一个 `.compose`；四组输入都有具名 Nodes。完整 topology 始终 inspectable。省去用户手动八 lane 装配，仍提供相同 exact capability handles 给 framework 作者。默认配置不会暗建图或自授权。

**Q8。**A 裸 bundle options：最透明但接线重。B graph-bound setup + 有限 preset：普通入口小、failure-atomic 可测，但需 qualifier/lineage。C dynamic plugins：可扩展，存在顺序语义、隐藏节点和无限组合；违反当前约束。A 有代码先例，B 沿 D792 已锁方向细化。

**Q9。**推荐 B。可解释、唯一配置 owner、支持组合可枚举；首版只提供 full runtime，不能宣称任意层可裁剪。残余是 ordinary API 还需真实用户走通后才能对外发布，当前只冻结候选 package-private 形状。

### 目标三：exact inbox handoff

**Q5。**是固定 append-alert consumer adapter，不是第九个 verb 或 generic sink。共享机械去重/active tracking可 package-private 复用；业务 admission 是 graph DATA。既有 Eval focused adapter 提供同步前缀消费先例，不能提供本业务授权语义。

**Q6。**INVARIANT：active obligation 登记在调用前；最终 guard 到真实 I/O 提交无 await；receipt 不回收；后续撤销不伪装成已阻止写入；unknown 不报告 succeeded。跨 crash、文件事务和取消提交后效果不覆盖。

**Q7。**候选纯计算在上游，admission 后才执行；真实 I/O completion 作为外部 source，避免同步反馈。actual request/outcome 可见，文件 handle 隐私保持外部。不要给普通用户 `flush/emit/retry` 作为正确性条件。

**Q8。**A `released.subscribe(write)`：短，却缺 exact effect/currentness 消费。B committed exact request + final guard + focused adapter：授权路径可测，但增加两个责任边界。C 任意 effect runner：复用大，冻结了不必要的执行框架且违背 D151。B 的机制可借鉴现有 focused adapter。

**Q9。**推荐 B，承诺 current-at-dispatch + bounded single-host replay。实际请求、conservation、DataResult、mutations 均有验收；提交后撤销与 durable exactly-once 明确未覆盖。线性化边界已获本轮确认，不能由实现者自行解释。

## 11. Cross-cutting synthesis 与批准记录

- 单一 identity/currentness lineage贯穿所有 handles、request 与 outcome；source digest、actor provenance、verifier verdict 仍是三种不同证据。
- “retained”统一表示证据保留能力，不能命名为“verified”来暗示 oracle 已通过。`publication` 输出区分 proposal/admitted/dispatched/outcome；不能直接布尔 `done`。
- 有限 bounds、construction validation、exact tuple comparison复用私有校验；业务 admission 函数不能被 UI/adapter 重复实现。
- 新层级不制造新的 work identity。只有设计批准后，为 material architectural choice 登记 TS owner 决策；实现 work、资格 revision 和运行许可各走原有独立步骤。

持久决策的唯一正文位于 `decisions/decisions.jsonl` 的 `graphrefly-ts:D160`；本文件保留详细设计与验收，不复制 ledger 记录。

**本轮批准的三项具体取舍：**

1. 单一 authority + 三组内部职责；首版 full closure，有限 capability 视图，真正减配 runtime 后置。
2. package-private graph-bound preset，第一 consumer 使用有限 immutable transaction prefixes，暂不新增 npm 公共入口。
3. exact admitted inbox handoff 采用 current-at-dispatch；单 host 有限去重，不承诺提交后撤回或跨 crash exactly-once。

本设计以 `graphrefly-ts:causal-composition-design` / `graphrefly-ts/causal-composition-design/v1` / `design-v1` 冻结，并以 immutable evidence 完成原设计 work。当前不注册实现 work、不完成 B121、不触碰 root contract 与 wave protocol、不运行任何 inbox/provider effect。新实现必须履行本文全部 qualification 义务；尤其 I/O 前拒绝的 outcome lowering 如不能沿现有受支持机制安全回送，须先补足设计，不得旁路修复。
