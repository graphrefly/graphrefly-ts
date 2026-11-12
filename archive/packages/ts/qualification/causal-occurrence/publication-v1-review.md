# Spending-alerts 请求材料关联：资格审阅

当前工作仍为 `graphrefly-ts:CAUSAL-PUBLICATION-MATERIAL-TS`，唯一 owner 是 graphrefly-ts。本轮已完成该私有切片的离线资格；它不代表后续preset、分层入口或真实执行宿主完成。

已应用用户批准的两处 typecheck 前置修正：construction 泛型断言补 `unknown` 中转；evidence 的可空 gap tuple 直接使用与原 helper 相同的 `JSON.stringify`。没有修改 authority 的状态机、提交点或 C 生命周期。

私有 consumer 仍只有 `requestMaterialJoin → publication` 两个新增节点，复用原完整 authority 和两个 retained roots。publication 将已提交记录的状态与材料是否匹配分开表达；材料匹配本身不授权 effect。

本次补齐独立 verifier、两个真实 Graph arm、等价 plain arm，以及完整输入/结果/graph/源码绑定。专项有110个测试，加上原 committed-view/cold重点回归共146个；13个实际加载执行的 mutation 均被相应断言捕获。类型、lint 已通过。

成本首轮有7个稳态超限，且触及30分钟进程上限，只完成16/18个构造与96/108个稳态配置，结果按失败且未完成保留。没有将它归为GC波动，也没有删除失败项。

局部修正仅复用已完整验证且冻结的四字段 binding 引用，避免重复编码。新引用、可变 binding、错误身份和 accessor 仍被验证；真实依赖与 native DATA 有效性检查保留。缓存是 join 的派生RAM，UI退订即释放，不拥有或结算 authority obligation。

第二轮 reference、oracle、harness、输入矩阵、采样数和1.20/1.10门槛均保持冻结。进程等待上限延至60分钟以完成同一有限工作量。两臂逻辑检查义务相同，candidate 的实际编码操作减少；结果只针对这份合理冻结对照，不证明优于所有实现。

第二轮完整矩阵与独立统计复核通过：18构造、108稳态、36冷恢复；构造最高1.107467（门槛1.20），稳态最高1.004283（门槛1.10）。每臂构造16,200个、稳态97,200个、冷恢复32,400个测量样本，以及720次重连均保留。

绝对成本仍取决于材料变化量。在本机/本次冻结运行中，64条×8KiB、无观察、单DATA波、100%材料更新的candidate中位批次p95为10.326ms（reference14.155ms，plain14.161ms）；材料不变为0.077ms。plain绝对值仅覆盖等价材料关联/投影，不包含上游authority生命周期，不能据此宣称整个Graph总成本低于plain。

原C原始无attribution命令运行885.094秒，四组原始预算独立重算全部通过；构造最高1.171772，稳态最高1.000909。仅在原C通过后，暂存刷新当前源码的三项资格常量与五个生成artifact，并固定新的源码快照。只有全部离线检查通过才保留刷新。

原root-eval离线soak221/221通过（外层1152.112秒）；全量2367通过、4个既有opt-in skips。原authority/construction/cold/committed-view的73/25/16/11个mutation全部通过。独立oracle、依赖边、资源、冻结ts-v8与已资格d9c868dc两个基线对照、浏览器离线、lint/typecheck、build/export、artifact、owner/workspace及dashboard检查均通过。

最终独立核验27份检查记录、432个package源码文件，以及包含example、fixtures、runner、design和eval的完整检查快照。每次检查的前后版本必须一致，各检查也必须对应同一版本；仅三项常量所在manifest与五份生成artifact允许在性能检查之后刷新。刷新现已保留。13个publication mutant的实际加载源码和Vitest原始结果摘要均重新核实。封存包含首轮失败、后续冻结源差异、原始样本、source/bundle bindings、命令、review和实际mutant文件。

静态审查修正了证据门槛的两处缺口：原C比较脚本退出0不等于预算通过，现从原始样本独立重算；单次sourceUnchanged不等于跨检查版本相同，现严格交叉绑定。封存还复核新旧报告摘要，避免只凭passed字段作结论。

环境记录为Node24.18.0、darwin/arm64、Apple M1 Pro、32GiB；机器元数据在性能运行结束后记录，不用于解释并发负载或GC。

新增公共exports：0。协议、C语义、authority提交点均未变化。owner/work状态与本收据一起提交；root仓库已有未提交文件保持原样。

本批不证明完整五端口/三角色入口隐藏，不运行B121的人或agent理解对照，不授权或执行inbox/provider/live/spend；不新增公共API、不修改wave protocol、不启动下游实现。
