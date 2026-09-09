# Spending-alerts publication：请求材料与已提交记录的精确关联

2026-09-08；基线 `d333a7b8`。状态：待审阅的新切片设计，未实施、未登记新 decision/work、未改变公共 export。唯一代码 owner 为 graphrefly-ts；root B121/CSP-14 仍 proposed。

## 1. 本轮推荐

下一批完成 consumer-private 的 **request material → committed record 精确关联 → publication 事实**。目标是让普通用户看到“这条告警处于什么状态、正文是否与记录匹配、哪些信息还缺失”。继续使用同一个完整 authority 和已验收的 C；不再扩展它们。

本切片生成被动事实。它既不签发执行许可，也不预先实现 quiet handoff、current-at-dispatch guard 或 inbox I/O。它为 D162 的 publication 端口提供真实内容，不能单独宣称五端口 preset 或按用户等级隐藏入口全部完成。

当前依据：

- [owner work](/Users/davidchenallio/src/graphrefly-ts/plan/work.jsonl) 中 CAUSAL-COMMITTED-VIEW-TS complete；[committed-v3](/Users/davidchenallio/src/graphrefly-ts/packages/ts/qualification/causal-occurrence/committed-v3-review.md) 证明 221 soak、2257 default 与该私有视图的离线资格。
- [buildCausalNodes](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/construction.ts:134) 已返回内部 committedEffects；[同次提交](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/construction.ts:177) 先准备视图，再唯一 state.set，最后 DATA 输出。无需改 authority。
- [CommittedEffectsView](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/contracts.ts:201) 含 proposal/admission/outcome、authorityId/binding、retention；[proposal](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence/contracts.ts:37) 只有精确 refs/digest，没有告警正文。
- 现有真实 [spending-alerts 算法](/Users/davidchenallio/src/graphrefly-ts/examples/spending-alerts/pipeline.ts:134) 产生统计、判定、原因和消息；仍有 feed 与闭包政策。它不是已实现的 graph-first preset，不可直接改名作为新入口。
- 已锁定 [D160 具体请求关联](/Users/davidchenallio/src/graphrefly-ts/docs/design/causal-composition-v1.md:160)、[D162 五端口/三角色](/Users/davidchenallio/src/graphrefly-ts/docs/design/causal-preset-audience-v1.md:29)、[D163 DATA 恢复](/Users/davidchenallio/src/graphrefly-ts/docs/design/causal-committed-view-v1.md:67)。本提案细化其 consumer 局部数据形状；不重开 B139 consumer 选择。

## 2. 一个具体用户问题

交易 A 的告警正文已算出；A 的 proposal/admission 已由 authority 接纳。随后交易 B 的正文先到，A 的 outcome 尚未返回，UI 退订再回来。

用户应能看到：A 的入账状态仍存在、A 正文是否匹配、目前尚无确认 outcome；不会展示 B 的正文配 A 的 admission，不会因退订显示“取消/完成”，也不会把“已接纳”展示为“现在可以执行”。

节点算法改了、topology 没改时，request material 的 source/runtime binding 必须改变；旧材料不能悄悄替代新材料。实现变更证据、actor provenance、受测后果不变证据继续分别由 source diff、provenance 与独立 verifier 提供。本切片的 digest 匹配只证明关联，不能证明算法正确或是谁写的。

## 3. 输入及推荐数据形状

两组真实 DATA 输入：

1. 同一 cold assembly 的 `built.committedEffects`，不从调用者按名字 find 一个任意 Node。构造时验证同 graph/scope/epoch，并保留预期 authorityId/binding。
2. consumer input owner 提供的不可变、有限 **material snapshot**。snapshot 带 exact evaluation pack/source/runtime/目的地及 host epoch 坐标，列出该有限 pack 的请求材料。其存在本身不产生 grant、coverage 或 currentness。

首个离线 qualification profile 建议限定：最多 64 项 material；单项 payload UTF-8 最多 8192 bytes；完整 canonical frame 最多 1 MiB。这是本次待批准的有限测试/私有构造范围，不新增普通用户必填选项，不改 maxEffects/maxPending 的已有含义。超限在接纳新 frame 前拒绝，不能为了过预算丢弃 authority 记录。

建议只接受 strict passive JSON；payload 使用确定的 canonical JSON 文本，实际 bytes 定义为 UTF-8(text)，不依赖共享可写 Uint8Array。字段：

| 层 | 具体坐标 |
|---|---|
| material body | schema revision、完整 occurrence ref、effectId、destinationRef、composition/host epoch、input/policy/source/runtime digests、payload text 与 payloadDigest |
| requestRef | consumer 专用 kind；id 为 canonical material body 的 digest；body 不含 requestRef，避免自引用 |
| proposalDigest | 对 schema revision、完整 occurrence ref、effectId、requestRef 的 canonical digest；payload 及其绑定通过 requestRef 间接完整绑定 |
| snapshot | 有限 input pack 的 exact binding、完整 material 列表及 canonical digest；明确是该 pack 的材料范围，绝不称完整执行历史 |

以上为候选私有编码，未修改 root CausalEffectProposal。所有派生 digest 在接收材料时重新计算；不相信材料自报的 digest。请求材料在 verifier/grant 到来前即可确定；verificationReceiptRef/grantRef 不进入该请求摘要。未来完整 dispatch envelope 从已提交 admissionRef 及独立证据输入关联它们。这样 receipt 可以绑定 requestRef，而不出现 request digest → receipt digest → request digest 的循环。本节点不产出这个完整执行 envelope。

构造期冻结本次有限 source/runtime/pack/目的地坐标；不匹配的 frame 显式 invalid-binding。以后如何从一般应用持续生成、保留和替换 material，归完整 preset 的输入 owner 设计，本切片不藏一个自动补材料的 registry。

## 4. 关联和显示规则

先验证材料，再按完整 occurrence（domain/id/revision/digest/sourceRefs）、effectId、requestRef、proposalDigest 关联已提交 proposal。admission/outcome 仅取 authority 已接纳的同一 record，不能从原始 admission lane 或 aggregate conservation 重建。

publication 分开保留两个维度，避免“正文丢了”抹去真实 outcome：

| 维度 | 候选事实 / 普通显示含义 |
|---|---|
| recorded state | proposal 已记录但未接纳；rejected；admitted 且无 outcome；或 authority 的 exact outcome state |
| material state | matched、missing、invalid/conflicting、binding-mismatch；明确缺的是正文/关联证据 |

`unknown` 与 `reconcile-required` 按 authority 原事实保留；无 outcome 和 exact unknown 是不同状态。此 projector 不另立终态/回收算法，不自行改变 active/守恒分类。没有执行成功证据时不能显示已发布；有 exact succeeded 但正文丢失时，应显示“已记录成功，正文材料缺失”，不能伪造正文或改成从未执行。

- admission 和 outcome 同一次提交：直接投影该最终 record，不生成短暂“可执行 request”。
- 只有 material、没有 committed record：不能显示 admitted/no-publish；只保留材料范围与尚无匹配入账事实的不足信息。
- material snapshot 同一 key 重复相同字节可归一；同一 key 冲突则拒绝该 frame，不取 first/latest 任一值。非法新 frame 显式变为 invalid，不能静默沿用旧 frame 作为当前材料。
- committed record 存在、完整有效 frame 内没材料：missing；proposal 仍在 authority，projection 没有清理权限。
- authority 的空 effects/retention floor/gap 都不等于 never-admitted、no-publish 或完整历史。正常无异常交易的 no-publish 需要未来业务 branch 的肯定事实，不从空表推导。
- 两个 source 尚未都发过合法初值时允许 publication 保持 SENTINEL；不造空初值来绕过 first-run gate。未来完整五端口由 startup/coverage/assessment 表达等待原因。
- 输出带 as-of pack/authority binding 与实际 retention 范围。材料匹配旧 record 仍可用于解释历史；本切片不产生“现在仍 current”的判断。

## 5. 拓扑、生命周期和恢复

```text
八条真实 lanes → 单 authority → committedEffects ─┐
                                               ├→ requestMaterialJoin → publication
有限 material snapshot source ──────────────────┘
```

首个实现只增加两个 consumer-private 具名计算节点：关联节点与普通 publication 投影。所有节点在既有 scope 内冷构造，一次 transfer/start；原 roots 不变，不增加为了 UI 历史而常驻的 collector root。两个节点的 fn 均通过 dispatcher，材料只经 DATA；不读 dep.cache、不拉 getter、不回灌 authority。

材料 snapshot 的 source 必须由运行实例/input owner 持有，或者能按正常 DATA 再交付同一有限 pack。离线 harness 使用本来就持有完整有限 pack 的 source；不得用 UI callback 提供唯一副本。失去材料只能降低显示完整性，不能结算 obligation。一般持续应用的材料保留/替换尚待完整 preset 设计，不能宣传本 slice 已解决它。

UI 全退订时两个派生节点可按 RAM 语义释放缓存；graph-owned authority 的整个 lifecycle 独立存在。再订阅从两边正常 DATA 重建，不要求 UI 安排订阅顺序。必要依赖缺失/ERROR/INVALIDATE 时不能继续输出新的 matched 行；protocol 终止与领域 unknown 分别表达。非法删边是 adversarial mutation，不把禁止全部 rewire 的新规则塞进 C。

## 6. 成本与认知预算

普通用户的 publication 只表达业务状态和材料不足；requestRef、三种 digest 与 admission 拼接留在 consumer 内部。框架仍拿原精确 capabilities；维护者可 describe 两条真实输入边。这个切片不新增 audience mode、snapshot API、refresh/publish/approve 方法或 npm export。

令 E 为保留 effects、M 为材料数、B 为材料 bytes：新材料验证最坏 O(B+M)，新 committed view 关联 O(E+M)，输出 O(E+M)，派生存储有界 O(E+M)。缓存仅保存从 DATA 得到的不可变 frame/index/输出引用；没有第二个 lifecycle authority。相同不可变输入引用可跳过重复投影；新 frame 不能因自报 digest 相同而跳过校验。

确定性预算：新增节点恰为 2、额外常驻 root 为 0；无 UI subscriber 时不执行这两个派生节点；没有深 clone/hash 原 authority 表；材料不变时不重复验证 payload；没有逐 effect 再扫描完整 material 的 O(E·M) join；UI 重连允许一次当前数据重建。普通 view 包装的额外稳态 dispatch/payload clone 仍遵守 D162 的零目标，两个业务投影的实际调度另计，不能混称零成本。

未来测量固定 E/M=1/16/64、payload 0/1KiB/8KiB、输入变化 0%/1%/100%、同批多消息、两种冷启动顺序、20 次重连及 off/summary 观察。报告绝对 p50/p95、分配/保留内存、实际工作次数和观察字节。独立 plain-code 承担同样检查和恢复语义，冻结对照后再看结果；不预先承诺 Graph 更快。

既有 C ≤1.20 construction / ≤1.10 steady 门槛不变。若实际被测 C/runtime/harness 闭包完全未改，可以重新核实保留的原证据；新 consumer 成本必须单独测量。新切片使用附录的同语义对照和预先声明的比率门槛，必须报告绝对延迟/内存；不承诺通用毫秒 SLA，不能用 C 的旧通过代替新 consumer 测量。

## 7. 有限验收与独立证据

| 场景 | 必须观察到的结果 |
|---|---|
| P1 真实消息材料 | 使用保留 consumer 100/200 正常交易负例，以及 100/1000、dailyAverage=100、dailyRatioThreshold=5 的真实告警正例；冻结各自 sample 统计政策与 payload；先后两种 DATA 顺序均与独立关联 oracle 相同；不宣称这里重验了 Welford |
| P2 A/B fan-in | 两 vendor/两个 effect 交错；B 的材料绝不能借 A admission；完整 key 每个分量的错误均不匹配 |
| P3 同拓扑源码变化 | source/runtime binding 改动，旧材料拒绝；等价/非等价算法都须显示 binding changed。算法正确性及 actor 归因仍交给独立证据 |
| P4 早到/缺材料 | material 先到、record 先到、显式空 frame、缺初值，分别等待或显示缺口；不输出假 pass/no-publish |
| P5 replay/冲突 | 相同事实重放不重复 publication 行；同 key 改 payload、错误自报 hash、frame 内重复冲突拒绝，原 authority 字节不变 |
| P6 退订/重连 | proposal/admission 期间所有 UI 退订；送 wrong outcome 后 exact outcome；graph 继续管理 lifecycle；恢复匹配当前保留记录 |
| P7 unknown/同提交终态 | 无 outcome、unknown、reconcile-required、succeeded/failed 分开；同提交已有 outcome 不闪现可执行候选 |
| P8 保留与上界 | 材料被显式移除、authority 合法回收、retention gap、超限 frame；真实缺失可见，不能把空表当否定证据；不驱动 authority 清理 |
| P9 冷故障/断依赖 | 错 graph/epoch 在冷期拒绝；移交后故障保持同一 owner。实际删 material/authority 依赖不能通过旧缓存补 matched |
| P10 简单负对照 | 无匹配 effect，或仅改普通展示标签；不新增 admitted/成功事实；既有 canonical request bytes 不被格式化改写 |

独立 verifier 不 import consumer join/digest builder/authority transition；按已审阅被动编码自行计算 digest、逐字段关联、解释 record/retention。plain arm 显式保存两份同样有界输入及其派生结果，支持相同乱序、缺失、冲突、重连和 unknown，不能删掉这些义务换短代码。

实际 runtime mutations 至少：完整 key 降级成 effectId/latest；绕过 payload/source binding；接受材料自报 digest；admission 改为从未接纳 lane 取；丢掉同提交 outcome；缺材料回退旧缓存；UI cleanup 删除 authority 记录；每次无关 DATA 重验 payload；以及两条真实依赖删边。必须保持 mutant 可运行，观察错误行/authority 变化/工作量断言失败；编译拒绝、结构拒绝、业务输出失败与成本检测分开计数。投影不读 lane 的 mutant 须说明实际重接线，不能只改 describe。

资格包供 human/agent 共用：源码/运行闭包、完整输入顺序、候选与 plain 原始结果、独立 oracle、实际 graph、mutation 位置/加载摘要、性能原始样本与 coverage。这里只验 consumer association，不启动 B121 的 blinded 人/agent 对照，也不把本任务 agent 的审阅当用户理解试验。

后续实现仍执行全部适用离线测试、显式 soak、browser、lint/typecheck/build/export/artifact/owner/dashboard 及原 causal/construction/view mutations；新的关联专项不能替代它们。没有真实 host，本切片不能证明实际写入授权路径；actual inbox 与边界 mutation/readback 留给后续明确获批批次。

## 8. Q5–Q9

**Q5 抽象：**在 examples/spending-alerts 私有模块关联 consumer payload，复用已合格的 solution record。两个具体投影足够，无通用 request registry 或新 verb。先例为 buildCausalNodes 的精确私有输出和 projectFact（construction.ts:111），不是把历史 proposal aggregate 当 request。

**Q6 长期不变量：**authority 唯一；材料关联不授权；digest 不证明作者/正确性；请求摘要必须先于 verifier/grant 可计算；UI 不拥有 lifecycle；缺席非否定证据。维护成本是私有 canonical 编码与有界 snapshot 的输入 owner 责任。首批 finite pack 足够验证，持续应用的材料生命周期不能藏在此有限保证里。

**Q7 响应式：**两条显式 dep、两级具名 projection；所有资料经 DATA、scope 冷构造、正常重连。缓存可重建，只是派生索引，没有 read callback/第二 authority/同步环。描述图可以准确说明 A 正文与 A 记录如何汇合。

**Q8 备选：**

| 路线 / 形状 | 好处 | 代价与先例 |
|---|---|---|
| 事件 collector：material events → retained Map → join | 追加少；可以逐事件更新 | UI 退订会丢唯一材料，若常驻则新增 owner/retention/recovery 协议；现有 RAM compute 与 D163 冷恢复问题已说明仅增量不足 |
| **有限 snapshot + exact join**：两个当前不可变输入 → index → projection | 可正常 DATA 恢复；复用 pack owner；不新增 lifecycle 状态机 | 更新/重连 O(E+M)，新材料需 O(B) 校验；只覆盖有限 pack。先例为 D160 immutable input prefix 与已实现 D163 retained view |
| payload 放回 authority：proposal/effect record 内携正文 | 一处保留，恢复直接 | 改动已合格 contract/source、增加每次 clone/观测体积，影响全闭包；当前 record 只有 refs，不能声称这是零成本补字段 |

**Q9 推荐有限 snapshot + exact join。**它针对当前真实缺口，保留 graph-owned lifecycle，且没有普通用户新增操作步骤。

| 关注点 | 覆盖 | 明确剩余项 |
|---|---|---|
| 层级/单 authority/不扩 C | 是，设计上 | 未来实际接线与 mutations |
| exact 关联/缺失/冷恢复 | 是，设计上 | P1–P10 与独立 oracle |
| 性能 | 部分 | 工作上界、同语义对照和门槛已列；实际数值仍待获批实施后测量 |
| 普通用户认知 | 部分 | 一个 publication 端口更可解释；完整四组输入起步样例及五端口用户审阅未完成 |
| 材料持续保留/真正执行 | 未覆盖 | 仍属于完整 preset/input owner 与 host 边界的后续设计 |

## 9. 后续实施边界，尚不派发

拟修改范围：新增 `examples/spending-alerts/causal-publication.ts`（私有材料编码、关联与业务投影）、`packages/ts/src/__tests__/spending-alerts-causal-publication.test.ts`、独立 oracle fixture 与资格/performance runner；在专项的 cold assembly harness 中接入真实 buildCausalNodes。修改 example 的 tsconfig 纳入新模块/专项，并将该 example 加入 `scripts/check-typecheck.ts` 的 TARGETS。目前 example 的 include 只有 index/pipeline，根 gate 只有 keyed-rate-limit example，不能默认已有 typecheck 覆盖。新测试置于 default suite 的真实 include 下。所有配置/runner 及受影响 source binding 一起验收。不得顺便改原 pipeline 的算法、feed、CLI 或公开 exports，也不改 FullCausalCapability。

本提案和附录一起构成下一批可批准范围。批准后才登记唯一 TS owner 的新实施 work，前置引用 audience-v1 与 committed-v3；不重开已完成的 committed-view work。实施批准仅覆盖本切片、规定的离线资格和 commit。若实施发现需要改 authority/C/protocol 或普通用户必须管理材料 registry，则超出本推荐，应带具体冲突回到设计。

本轮只生成任务审阅附件，仓库仍为 d333a7b8；无需再跑全量测试。无新 decision/work 记录、无实现、无 provider/live/spend/actual inbox 工作。已有 commit 与失败/通过收据均保留。


## 附录 A：编码与向量（待本次审阅，不是新公共 contract）

Canonical JSON 规则：仅 null/bool/string/有限 number/array/plain object；递归按 UTF-16 code unit 顺序排列 object keys，数组顺序保留；JSON.stringify 的字符串转义与数字表示，-0 归一为 0；UTF-8，无 BOM/尾随换行。禁止 undefined、non-finite number、bigint、symbol、function、getter/setter、非数据 prototype、重复 JSON object keys 与 unpaired surrogate。occurrence ref 完整保留，不能删除 sourceRefs 或为了匹配擅自重排它们。

payloadText 必须本身已是上述 canonical JSON，且符合这个有限 consumer 的结构：`{transactionId, vendor, severity, message}`，transactionId/vendor/message 为 string，severity 为 low/medium/high。它承载现有 consumer 的消息结果，本轮不修改真实统计或模板算法。payloadDigest = SHA-256(UTF-8(payloadText))。

material body 精确键集：schema=`spending-alerts/request-material/v1`、occurrence、effectId、destinationRef、compositionEpoch、hostEpoch、inputDigest、policyDigest、sourceDigest、runtimeDigest、payloadText、payloadDigest。两个 epoch 是正 safe integer；refs 使用既有 passive `{kind,id}`；digest 使用 sha256: 加 64 个小写 hex。

requestRef.kind=`spending-alerts/request-material/v1`，requestRef.id=SHA-256(canonical body)。proposalDigest 计算的对象精确为 `{schema:"spending-alerts/effect-proposal/v1", occurrence, effectId, requestRef}`。material row 精确为 `{body,requestRef,proposalDigest}`。

snapshot 精确为 `{body,digest}`；snapshot body 精确为 `{schema:"spending-alerts/material-snapshot/v1",packRef,sourceDigest,runtimeDigest,destinationRef,compositionEpoch,hostEpoch,materials}`。digest 覆盖整个 body；逐行 binding 必须与 frame 及本次构造的 frozen profile 相符。重复行也计入原始条数/bytes 上限，然后才允许相同字节的重复归一；冲突拒绝整个 frame。绑定是内容关联而非签名/安全沙箱，完整 Graph/同进程任意代码仍可被维护者检查和操作。

附带 `vectors.json` 给出一组完全公开的编码向量（ASCII string/整数），保留 canonical bytes 和各 digest。该向量只固定编码，不作为业务真值或预执行 grant。实施验收还需 Unicode、负零、额外键、重复键、非法数值、超界与每一 exact 坐标的负向量；不能只证明编码器能解自己的输出。

## 附录 B：预声明成本验收

新增 `scripts/compare-spending-publication.mjs` 在实现结果未知时先冻结两个臂：相同 d333a7b8 full causal runtime 和同一 frozen 输入，分别接生产两个节点与独立 reference 两个节点。reference 的关联/校验函数不得 import 生产实现，使用合理的 O(E+M) 索引、材料引用变化时才校验 payload；不得故意每次深 clone、嵌套扫描或省掉语义检查来改变对照。另运行完全脱离 Graph 的 plain arm，公开其绝对成本，Graph 不被要求胜过 plain。

构造和 DATA 比较使用相同节点数、source/root、观察模式、容量和实际校验工作。每组先 100 对 warmup，再 300 对 measured，三组按 AB/BA/AB 交替；全部样本保留。生产/reference：construction p95 比率 ≤1.20；稳态每组 p95 的中位数比率 ≤1.10。冷恢复/20次重连另报 p95 和工作量；不混进 steady 平均掩盖成本。若 reference 自身的算法/上下文不等价，整组 non-evaluable，不补一个有利基线。

内存接受条件以确定性可达对象/bytes 为主：恰为两个新增 Node、零新增常驻 root；material 原始 frame ≤1MiB、索引 ≤64 项；每次调用最多一份新输出及一个材料索引替换；实现不保留历史版本数组，UI 退出后这两个节点的派生 state/cache 可释放。外部 observer 自己保存版本导致的内存另报。GC heap delta 只作辅助，不假称对象字节精确测量。

一次完整 gate 失败后保留结果并定位，不自动多跑选最好的一次，也不降低语义/上界/门槛。因为本轮是设计，没有运行该新 harness，也没有声称它已通过。
