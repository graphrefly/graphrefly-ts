# Causal spending consumer：统一设计与一次实施授权范围

2026-09-13；源码基线 e697b801。本稿为集中审阅稿，尚未批准新增取舍。
唯一设计/实现 owner：graphrefly-ts。已有 D160/D162/D164 等决定继续有效；历史收据保持原字节。
本稿是当前剩余私有 consumer 执行链的完整实施计划，不是全部 library 的重设计。
读完本稿即可决定本批是否实施；下方历史材料只用于复核，不是审批的必读前置。

## 1. 本批完成后得到什么

完成一个可运行、可审计的 spending consumer 私有集成：真实输入 Nodes → 业务计算与独立
验证 → 单一 causal authority → exact 请求 → focused host 边界 → 结果 source → 原 authority。
它具有同一实例的普通 view、框架 capabilities 和维护者 graph/evidence 视图，并有完整离线
资格证据与可复核的增量性能对照。实现的是可组合运行链，不能只把几个探针拼成演示。

本次批准覆盖私有实现、所需精确类型/接线调整、测试工具、runtime mutations、回归修复、
文档、owner 记录和本地 commits，连续执行到验收结论清楚。内部阶段不是新的用户审批点。

保留此前边界：不新增公共 export/API，不修改 wave protocol，不运行 provider/live/spend，
不准备或写入真实 inbox。本批使用测试内 fake resource 验证执行调用；测试日志/收据照常落盘。
生产 adapter 可以实现并编译，但未获真实 I/O 验证时不能标 qualified 或向普通用户发布。
公共 creation/export 的发布与真实宿主资格不在本批完成声明中；不是用离线通过冒充产品完成。

## 2. 用户与分级入口

普通用户消费一个包含 assessment/publication/coverage/issues/startup 的 view；无需传递
lane、authority、scope、permit 或手工 flush。框架作者从同一装配结果取原 execution/retained
capabilities；维护者通过原 Graph.describe 和证据下钻。三者共享一个完整运行实例。
隐藏入口不减少依赖、保留责任或授权检查；diagnostics off/summary 不改变业务结果。

本批把完整冷装配集中在一个 consumer-private 创建入口，参数保持已有 Graph、四组来源、
精确 binding 与命名/defaults，不让每个调用方手工复制 scope/startup/seal/transfer/start。
创建返回原 view/capabilities；不增加代理 Node、二次 authority 或每事件包装转发。
未来 spendingAlertsFor(...).compose(...) 的公共形式仍是设计方向，本批不锁定新公共符号。

四组来源是 evaluations（pack/arrivals/current）、verification（receipts）、localAuthority
（grant/stop/tick）、inbox（真实边界事实）。离线 fixture 仍明确标 fixture-observations。
真实 host 绑定和 fixture binding 必须在类型/运行资格上区分；不得把 evidenceMode 改个字符串
就当真实来源。来源适配与许可由应用集成方负责，普通 view 不能自产授权。

## 3. 单一责任与数据路径

| 责任 | 唯一 owner | 禁止代替它的东西 |
|---|---|---|
| 请求字节与源码/政策关联 | materialStore | latest payload 缓存、任意 caller JSON |
| 候选业务 admission | publicationPolicy | readiness、UI 点击或 host 私有政策 |
| exact identity、义务 lifecycle、retained evidence | causal authority | host receipts、订阅计数 |
| 实际消费、写槽、提交事实、completion | focused host 的一份有限记录集合 | 第二个 permit/ack/重试 registry |
| 运行实例和资源存续 | application/run owner | 展示组件 mount/unmount |

声明的图内边为 inputs → business/material/policy → authority → committed publication → final
currentness guard → host sink；host source → inboxFacts → outcomes → authority。
外部执行/返回关联由 exact refs 与证据说明，不伪造静态依赖环。
所有 reactive 函数经 dispatcher；authority 在同 context 内调用有限 transition，最终一次
ctx.state.set。host 异步仅用于已记录结果的 source 通知，不进入同步 wave core。

输入/材料/验证不齐时等待或报告具体 issue。独立 verifier fail 拒绝 proposal；验证缺失不能
伪造失败终态。fan-out/fan-in 三分支继续是 assessment/explanation/publication-policy。
正常不发布必须有真实 no-publish 分支终态，没有 effect proposal 和 host 调用。

## 4. 容量与执行契约：本次集中确认的取舍

采用一个 composition 独占一个 host epoch，整个 epoch 最多 64 个 distinct host 请求记录，
包含 known-no-submit 拒绝；最多一个 in-flight write，最多 64 次 writes。payload≤4KiB，
completion canonical body≤4KiB；精确关联字段不可截断，大诊断变成有界 typed issue。
这些是 finite consumer 的预算，不推广成所有 library 的通用限制。

容量由现有材料边界覆盖：materialStore 在 proposal 前保留最多 64 个完整 occurrenceKey 的
不可替换材料；policy 每个 key 至多发出一份决策；host 只能接纳本实例真实 committed admission
与 retained material 精确匹配的请求。因此 host records 是 retained materials 的子集。
不增加动态 reservation 数据流、回收协议或跨 wave 编码缓存。

此证明的独占 owner、exact membership、无旁路、材料不替换与跨 epoch 拒绝必须在实现中
强制并用负例验证。若证明不成立，先修实现；不可偷偷加 registry 或放宽上限。

readiness=1 是观察事实，不是 reservation。已测真实 consumer 在同 batch 产生两个 admitted。
最终边界仍同步检查真实 slot；第一个取得 slot 的请求立即调用已准备资源，无 await/队列。
另一请求遇忙，记录 exact cancelled + busy/known-no-submit；不等待、不自动重试，不承诺公平
或固定业务赢家。若用户需要最终每条都写入，那是另一种排队语义，不能暗中加入本批。

## 5. 每个请求的完整生命线

1. 材料先提交保留，proposal/admission 经真实 authority 关联，登记 active obligation。
2. committed projection 与原材料精确 join；final guard 通过显式依赖检查当前 occurrence、
   policy、grant、source/runtime binding、逻辑时间、stop 和 host readiness。丢依赖即失效，
   不读 .cache 或隐式 host 政策去补齐。
3. host 验证精确来源和关联，查唯一记录集合。重复相同请求不再执行；冲突不覆盖首事实。
   不合法请求不能占用合法请求的记录，或伪造 cancelled 去清掉它的义务。
4. 新合法请求先保留记录，再同步最终检查/占槽/调用。前置阻断可证明未调用资源时，产生
   known-no-submit。同步 throw、短写、异常返回若可能已提交，记 unknown/reconcile-required。
5. 实际完成或未提交结果先保留不可变 completion，再安排 host 唯一 microtask 通知。
   同段合并，交付完整快照；交付中产生新结果最多安排一次后续通知；无同步递归 flush。
6. outcomes 经原 source lane 回到 authority；只有 exact outcome 可结算。错误 requestRef、
   admissionRef、proposalDigest、occurrence 或 epoch 均不能结算原义务。
7. source.down 正常返回不是 authority ack；不据此删除记录。重复 receipt 不产生重执行；
   冲突 receipt 保留首事实并报告有界诊断。

调度/交付失败：保留记录并 fault host，同步前缀拒绝新增执行。若通知通道本身已坏，不承诺
fault 能沿同一路可靠投递；run owner 必须保有可检查的资源 fault 状态，authority 未结义务
继续可见。不得用重复 microtask 或重建 epoch 自动恢复。该资源诊断不是第二个业务状态源。

## 6. 构造、退订、停止与结束

冷构造复用已实现 C：预检 → scope 装配 → seal → 一次 transfer → start。
预检发现 graph/epoch/name/输入闭包不一致就拒绝；移交前失败只清理本次构造资源，保留原图。
host source/guard 属于运行实例必需闭包，不能由 UI 订阅启动或取消。

UI 全退订继续保留 host record 和 active obligation，重订阅观察同一事实。
stop-new-work 阻断新执行，已有 I/O 与 completion 继续履责。busy/revoke 的 no-submit 也必须
回到 authority。正常结束要求：无实际在途写、无待发/正在发通知、无 delivery fault、
authority 无未结义务，并满足原 retained evidence 生命周期条件。
结束不能仅检查 aggregate admitted=0 或 subscribers=0；unknown 不得静默关闭。

本批通过 run owner 的私有装配/测试控制验证上述生命周期，复用已有 stop 事实和 construction
所有权；不增加公共 dispose/flush/retry 方法。强制进程退出不提供 durability/exactly-once。
新 composition 必须新 epoch，不能复用旧 grants/receipts 或清空旧未结记录制造完成。

## 7. 证据如何避免自证与过拟合

独立 deterministic verifier 沿用已分离的 oracle，不能调用 candidate 业务计算得到预期值。
plain-code 对照使用同一输入/政策、业务动作、有限预算、错误与结果分类；不靠去掉验证/保留
成本来制造更快的参考。分别报告业务计算、graph 集成和 host 资源层成本。

同 topology 替换 vendorStats 内算法时：节点稳定 ID 不变，source closure digest 改变；旧 verifier
receipt 不允许新实现执行。human/agent 谁修改来自独立 provenance 记录，不能从 digest 推断作者。
“后果不变”需要新实现的独立验证与实际对照，不能从 topology 相同推出。

最终 human 包包含：一页结果、同图前后绑定、输入/政策/授权事实、实际边界调用与结果、
失败原因、性能表及复跑命令。agent 包包含同一事实的机器可读 exact refs、hashes 与 verdict。
不得把作者自答当成完成 B121 人类/agent 理解度试验。

## 8. 一次授权后的执行清单与完成标准

按依赖顺序实施，必要时内部调整文件拆分；不在每项之间等“继续”。

| 阶段 | 交付与必须通过的检查 |
|---|---|
| 集成 | 私有构造入口、exact host/source/guard 完整接线，单 authority，无额外 quota registry |
| 行为 | off/summary；同 topology 改算法；fan-out/fan-in；正常不发布；缺失/过期/冲突 facts；错误 epoch；replay |
| 资源 | 同 batch 多 admitted 至多一个在途调用；64/65 边界；拒绝也保留记录；throw/短写/unknown；调度和交付失败 |
| lifecycle | UI 全退订/重连；stop/revoke；必要依赖删除/失效；构造失败清理；不能提前正常结束 |
| runtime mutation | 绕过 guard、跳过 slot、重复写、错误 outcome 结算、满额继续接纳、退订清记录：独立观测必须杀死 |
| 分级 | 普通 view 不泄露执行方法；framework 原 handle；维护者原图；同图无重复闭包；类型正/负例 |
| 性能 | 与相同输入/拓扑直接装配对照，单列 factory/host 增量、cold/首值/steady/reconnect、allocation/RSS、帧 bytes |
| 回归与交付 | 所有 TS 离线测试、lint/typecheck/build/export/artifact gates；涉及 owner/plan 时 authority/workspace/dashboard gates；提交证据与代码 |

性能沿用已有冻结方法和预算，不改 1.20/1.10、不通过多跑挑最好值或临时平均覆盖失败。
历史 D169 method-not-qualified 不会被本次诊断自动改变；新路径结果单列可复核性与资格状态。
约100ms保留为用户交互目标，报告绝对延迟，不宣称这个目标替代其他预算。
失败先定位/修复/重验受影响项，不把每次失败升级为新设计请求，也不无限扩张优化。

完整离线验收通过才说本批完成。真实 inbox 写入、公共导出发布、B121 用户试验分别明确仍未完成。
发现必须改变政策/容量/等待语义、wave、公共 API 或真实外部执行范围时，才暂停相关部分并
集中说明哪项原批准不再成立；其余不依赖它的工作继续。常规实现选择、调试和修复不再请求审批。

## 9. Q5–Q9 集中结论

Q5：私有业务 solution 的执行适配；复用 kernel/construction/authority，不抽象通用 runner。
Q6：主要风险是 exact 独占容量前提、通知失败、unknown 生命周期和完整快照成本；均有上界、
失败保留策略和明确验收项，不承诺共享 host、无限流或 crash recovery。
Q7：四组显式 Nodes、单一 authority、分级投影；没有 imperative 用户触发或隐藏依赖。外部
source 合法闭合执行反馈，不修改静态环规则。首个真实资源仍需后续独立资格。
Q8：采用已有材料上界与有限 host 记录；动态 permit/回收/队列增加资源握手和语义，不适合
首批。静态 quiet 环和 caller-return flush 已被反例否定，不重新开 A/B/C 讨论。
Q9：本方案覆盖完整离线执行链与分级消费；性能需要测量、真实资源与公共发布明确不覆盖。
推荐整体批准后一次推进，实现中的探针只作为内部证据，不再作为用户任务的停顿边界。

## 10. 审批与记录

已有决定、此前用户批准及其证据继续有效，不要求重批 C、单 authority 或分级目标。
本稿集中确认的实质取舍是：独占 finite host 的容量证明、busy 时 exact no-submit 而非排队、
统一 completion/故障/生命周期契约，以及上述连续离线实施范围。

批准后将必要架构修订记录到 TS 唯一 owner ledger，并引用本稿作为正文；实现授权记录在
现有 work/会话授权机制中，不能拿 D# 代替执行许可。按当时 ledger 分配唯一 ID，避免与并行
工作冲突；保留 D160 未修改部分，局部修订只覆盖本稿明确列出的 host 交付等职责。
本稿自身不追加或锁定任何 decision/work 状态。

历史证据（可选复核）：causal-creation-entry-review、causal-host-completion-contract、
causal-host-completion-feasibility、causal-admission-capacity-review；此前设计草案仅为历史依据，
本批审批内容以本稿为准，批准前它不覆盖任何已锁定 authority。
