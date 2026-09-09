# Private spending preset — incomplete implementation preflight

2026-09-09。Owner：`graphrefly-ts`；同一 work：`CAUSAL-PRESET-ASSEMBLY-TS`。
基线：`0c249466fefe54a79b2f0cb87ba3db0f95f8bd0f`。这是实现进度与失败证据，**不是 preset-v1 完成收据，也不是 CSP11 eval**。

当前用户已批准 assembly-v1 私有实现、离线资格检查及 commit。现有实现文件边界和固定 edge 表出现两个必须审阅的缺口，因此保留 candidate 与最小未应用 diff；没有修改已有 solution、C、publication、公共 exports 或冻结设计原文。

## 当前实现与证据

- 四组被动输入、六个真实 source；Welford/statistics/gate/reason/message 的具名业务图；有限 graph-owned materialStore；八条内部 causal lane；原有单 authority/publication；真实五端口 view 与原件 capabilities。
- 53/54 owned nodes、两 roots、一次 seal/transfer/start；summary 是可选图内投影。普通组件只能拿实际 view，类型负例验证没有 publish/admit 等入口。
- 原始源码测试：**9 通过、8 失败**。失败集中在既有 lane 对安静的派生输入保持 dirty，authority 未推进；详见 `original-tests.log`。
- 仅在隔离 loader 中给既有 lane 加 `partial: true`：**17/17 通过**。涵盖 flagged/normal、detach/reconnect、wrong/exact outcome、缺 receipt 恢复、两 vendor、同 wave 多 DATA、receipt 冲突、原生 INVALIDATE 后异项 receipt 与原项恢复、明确 verifier fail。
- 类型检查通过。完整 lint 的第一次失败仅为新建 checks.json 格式；修正后结果单列，保留失败日志。workspace/dashboard 结果见 `checks.json`。
- 三种 audience 示例是实际对象/类型消费证据；不是 human/agent 理解成本实验，也未证明普通用户能创建最终可执行 preset。

原生 INVALIDATE 不需要产出一条业务 invalid DATA。测试观察真实 authorization：失效后即使另一个 receipt 到来，原项仍不能获准；原项真实 DATA 恢复后才获准。保留记录与事实可用性分离；UI 退订或错误 outcome 不能结清 authority 义务。

## 必要修订 A：既有 causal input lane 的缺失输入处理

位置：`packages/ts/src/solutions/causal-occurrence/construction.ts` 的 `lane()`。

```diff
- { name, factory: "causalOccurrenceInputLane" }
+ { name, factory: "causalOccurrenceInputLane", partial: true }
```

真实 consumer 的 inbox readiness 是 DATA，但“尚无 outcome”使 effectOutcomes 合法地安静；正常交易也不产生 proposal/admission。既有 adapter 在这些输入下不能完成缺失输入分支，合流/authority 保持 dirty。以假 outcome 或成功 DATA 填空会改变业务事实。

`probe-lane.mjs` 对 off/summary × flagged/normal 进行独立 bundle 对照：原版没有 authority state；单项 loader patch 后存在 state、dirty 列表为空，flagged 为 admitted-no-outcome，normal 为零 effect。补丁没有新增节点/root/registry，也不改 protocol；它使用已有 partial 行为，让空批次可以不输出业务 DATA 而正常 settle。

**建议应用** `proposed-lane.patch`。修改的是原 solution adapter 的调用配置，须纳入现有 causal/construction/publication 的回归及资格影响检查。不能拿当前 17 个测试代替这些检查，更不能沿用旧 CSP11 性能标签。

## 必要修订 B：evidence 直接依赖实际材料

冻结表第 25 行只有 evaluationSelections/verificationFacts，无法核对 receipt 中的 requestDigest 是否对应真实生成并保留的 payload。publicationPolicy 已有 materialStore 依赖，因而能够核对；evidence 自己不能借用该节点的内部判断或 peek 材料。

建议将第 25 行改为：

```text
evaluationSelections + materialStore + verificationFacts → evidence
```

- 增加一条直接边；owned nodes 仍为 53/54，roots 仍为 2，view keys 不变。
- 实际 retained 材料使用 payloadDigest；实际 normal 结果使用已定义的 no-publish digest；材料未就绪就等待，不提前把 receipt 终结为 included。
- code/input/policy/request/verifier/numeric domain 不匹配为 stale；不可用或材料拒绝为 unavailable。included 表示精确关联的验证证据已收到；pass/fail 仍是独立判定，included 不授予 effect 权限。
- 目前 candidate 将未核对 request 的 verification 标成 unavailable，避免虚构完整 coverage。不能用 external-only 代替：已有 authority 允许 external-only 满足部分覆盖条件。

`proposed-evidence-edge.patch` 是**附录修订草图**，不覆盖 assembly-v1 已冻结原文或摘要；批准后应保留原件并记录增补。`proposed-evidence-correlation.patch` 是未应用代码草图，尚未编译/运行验收。还需实际测试材料先到/后到、normal、错 request、fail/unavailable、replay/conflict 与真实删边阻断。

## Q5–Q9：这两个局部修订的取舍

| 问题 | 审查结论 |
|---|---|
| Q5 分层/抽象 | A 位于现有 solution adapter；B 位于 consumer-private evidence。都不增加 kernel verb 或公共能力层。 |
| Q6 长期与成本 | 不增用户参数、节点或 root。A 可能改变缺失输入时 dispatcher 的调用次数；B 增加材料变化引发的 evidence 推进。成本尚未测量，仍受构造 1.20/稳态 1.10 原门槛约束。 |
| Q7 可解释图 | 空 outcome 就是无 outcome；actual material 经直接 edge 进入 evidence。保留 graph 的真实依赖与唯一 authority，无 imperative 补洞、无全局 cache/轮询。 |
| Q8 替代方案 | 方案一：上述 partial 配置 + material 直接边。改动最小，仍需回归。方案二：consumer 向 lane 发送占位业务事实；会混淆缺失和存在，不采用。方案三：evidence 重算/读取隐藏材料或借用 policy 汇总；会复制材料逻辑或隐藏其实际依赖，不采用。 |
| Q9 推荐/覆盖 | 推荐方案一。事实正确性、分层和依赖透明覆盖；原资格/性能仍未覆盖，须执行原批准检查；认知成本仅能证明对象与入口数未增长，用户理解效果仍待独立证据。 |

两项属于原结果的最小修复/设计增补，不新开 work，不给运行尝试另发 D#，也不重新打开所有模块。B 的唯一设计 owner 仍是 graphrefly-ts；只有批准后才按 owner 流程登记必要的长期设计增补。

## 静态审查与本批修复

按 QA 的要求做了两路静态审查（preset_static_blind / preset_static_spec），无 agent/provider 实验。以下是需处理的发现与核实结果：

| 发现 | 处理与限制 |
|---|---|
| invalid arrival 的早返回丢掉同 wave 后续合法 DATA | 已在新 selection 中修复并测试。 |
| 明确 verifier fail 错误等待 grant/inbox | 已让精确 fail 独立形成 rejected 候选；它不能执行 effect。 |
| 多个 receipt/current/local DATA 只保留最后一帧 | 新 checked 节点做有限按 key 聚合；receipt 的双 DATA 测试已过，其余组合尚待完整矩阵。 |
| 同 receiptRef 跨帧冲突被遗忘 | 独立保留有限 seen/conflict 历史；冲突不因重送旧值洗掉。 |
| 原生 INVALIDATE 后使用旧 receipt | 加强为实际 authorization 负例；有序 wave SENTINEL 处理下异项 DATA 不恢复旧 receipt，原项 DATA 才恢复。 |
| evidence 未精确校验 request/verifier/numeric domain | 新代码校验后两个域；request 依赖是上述 B。当前 unavailable，完整覆盖未通过。 |
| 有限数值域接近退化方差 | 已复现，保留负例，不放宽容差。详见下段；不宣称域内所有合法输入都能获得 verifier pass。 |

数值反例为 `[999999999.9999999, 1000000000, 999999999.9999999]`。候选按原 Welford 计算，独立两遍重算在极小方差下超过当前相对/绝对容差，因此 `verifyBusiness` 返回 false。测试证明拒绝确实发生，**不证明哪个浮点近似更接近真值**。正式 verifier 域/数值稳健性仍有工作：需要独立高精度校核及明确资格域，不能把此负例自动改成 pass。当前 fixture 的 pass 仅用于被动 receipt 消费测试，并非实际加载代码的验证签发。

## 仍未完成

N1–N12 的完整证据、等价 plain/Graph reference、真实 source/runtime/dependency mutation 系列、有限 12/60/12 成本矩阵、所有适用离线 gates 和原资格闭包都尚未完成。构造/稳态/内存与理解成本没有通过结论。未启动完整性能矩阵或 root soak，避免在已知前提不成立时消耗长运行；既有失败如实保留。

未运行真实 inbox 写入、provider/live/spend、B121 人/agent 研究；不改变 B121 状态。完整实现仍留在原 work，待批准两项具体修订后继续，不自动启动下游。

## 重现与授权边界

从 TS 仓库根目录运行原测试：

```sh
pnpm --filter @graphrefly/ts exec vitest run src/__tests__/spending-alerts-causal-preset.test.ts
```

仅诊断的隔离 lane 修正：

```sh
pnpm --filter @graphrefly/ts exec vitest run --config qualification/causal-occurrence/preset-assembly-preflight/lane-partial.vitest.config.mts src/__tests__/spending-alerts-causal-preset.test.ts
node packages/ts/qualification/causal-occurrence/preset-assembly-preflight/probe-lane.mjs /absolute/existing/output-directory
```

该脚本生成两份临时 bundle 并报告原/补丁源码摘要；不会修改现有 construction.ts。用新的输出目录保留此前尝试。记录在 `checks.json`、逐项 logs、probe results 与 source-bindings.json。

当前批准的实施卡明确要求：“若实现遇到必须改变的既有语义或文件边界，先保留具体失败和最小必要 diff，再审阅；不把越界修复当隐式授权。”见[已批准实施卡](/Users/davidchenallio/.codex/visualizations/2026/09/06/01a077c7-55e6-7f11-9d4f-e7c51944afb4/preset-assembly-design-approval/implementation-scope.md)。[QA skill Phase 1d](/Users/davidchenallio/src/graphrefly-ts/.agents/skills/qa/SKILL.md) 同时规定：“Wait for user decisions on group 1.” 因此停在 A/B 两份具体 diff 的审阅边界；普通同范围修复已经完成，没有重复索取既有实现授权。
