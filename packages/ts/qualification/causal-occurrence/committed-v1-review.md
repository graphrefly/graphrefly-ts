# committed-v1：私有已提交 effects 视图的实施与失败资格

Owner：graphrefly-ts；work：CAUSAL-COMMITTED-VIEW-TS；依据 D160–D163。用户批准了精确五文件实施与离线资格范围，并已要求 commit。本批资格**未完成**，不能进入下游 consumer 实施。候选代码与失败证据保留在 `codex/causal-committed-view`；原 main 基线不移动。

## 实现结果

真实 lanes → authority 内同一个 transition context → 准备/复用不可变 effects 视图 → authority 一次 `ctx.state.set` → 原 fact 按原 wave 顺序携带同一视图引用 → 原 ports 解包，新私有 Node 投影视图。

只在实际接纳 proposal/admission/outcome、删除 effect 或推进 retention floor/gap 时重建。初次真实 fact 可以发布空的 retained 集合；无输入仍无 DATA。pending、相同 replay、无关事实不直接标记变化。旧版本复用 canonical payload，冻结外壳与数组，不暴露 state Map。相同 transition 内 deferred admission/outcome 一起推进时只发布最终记录。

新增一个 owned Node、一个 authority → committed-effects 声明式依赖。没有新增保留 root；standalone 的业务 root 仍是 release-controller，加上 C 自动持有的 startup 共两个实际 root。UI 退订不结算义务，错 outcome 不结算。投影的 RAM 状态断连可清理；INVALIDATE 通过现有 hook 清理引用去重，每次 invocation 重新登记 hook，下一条相同视图 DATA 仍可恢复。

五个生产文件仅为 causal-occurrence 下的 contracts、lifecycle、transition、construction 和新 committed-view。C/core/node/dispatcher、公开 barrel/package exports、root wave protocol 均未修改。binding 是定位信息，视图中的 admission 是历史入账事实；两者都不是当前 dispatch 许可。

## 不能通过的门槛

保留原 ts-v4 基线、三批交替构造采样与四行门槛。只给旧基线增加与候选相同的物理视图 Node；没有更改采样数、timeout 或 ≤1.20 / ≤1.10 门槛。以下是完整有限测量的结果，不选最好的一批：

| effects / evidence / 背景节点 | 构造比值 | 稳态比值 | 判定 |
|---|---:|---:|---|
| 1 / 0 / 0 | 1.180264 | 1.005861 | 通过 |
| 16 / 128 / 0 | 1.201307 | 1.004342 | 构造超标 |
| 64 / 512 / 0 | 1.200487 | 0.996924 | 构造超标 |
| 1 / 0 / 1000 | 0.725607 | 1.839833 | 稳态超标 |

runner exit 0 只表示完成采样和轨迹对照；独立 threshold 评估为失败。第一轮在审查发现 hook 修复后中止，保留日志和编译 bundle，不计为通过测量。没有对未改代码重跑来挑选更好结果，也没有将极小构造越界算作容差通过。尚未定位 1000 背景节点行的根因，不能归因于噪声或断言由某一个 helper 造成。

默认全量有 2255 项通过、2 项失败、4 项原有 opt-in 跳过。两项失败及 artifact gate 都在拒绝 D159 implementation manifest drift。独立换入本批开始时的 src 字节后，摘要恢复为旧收据的 `327820af…`；当前为 `59ec59c0…`，恰好涉及本批 8 个源码/测试文件。旧 D159 资格和许可绑定没有被改写；这是当前源码不再受旧资格覆盖的真实拒绝，不能只换常量让测试变绿。

## 已有证据及其边界

- 新视图 18 个专项测试；原有 causal/C 测试通过。默认全量中的失败仅为上述两个源码资格检查。
- 新 mutation：11 个实际输出、不可变性或工作量检测，另有 unchanged 与 topology-bypass-only 对照。authority → view 真删边在可运行的 bypass 图里导致记录缺失。两个 deferred 标记另做写点邻接审计：当前覆盖的可达提交中它们与其他已标记写入共现，不能伪称单独移除时获得了业务 mutation kill。
- 原 73 causal、25 construction、16 个分类后的 cold 检测通过。后者保留资源、错误契约、结构和 runtime 输出分类，不把所有拒绝都称为授权路径证明。
- 独立有限 plain-code 模型不 import transition/lifecycle/committed-view；从固定原始输入计算 exact records、pending、replay、capacity 和 retention，再与实际图逐 checkpoint 对照。12 个双启动顺序轨迹和两个热输入顺序通过，并有独立固定终态期望。它只覆盖声明的单 domain fixture 词汇，不覆盖所有 malformed-input diagnostics；不会在 retention gap 后伪造新的连续 currentness。
- 冻结 ts-v8 和当前 `d9c868dc` 实际 runtime 的原八 ports、六条轨迹及 startup fault 均等价。当前基线另增加一个不保留的 dummy Node，使物理数量相同；它不假装拥有新增功能。该对照只提供描述性绝对时长，不能替换原性能门槛。
- required-edge 168、incoming 144、资源 verifier 的 12 个快照与两个负对照通过。新增 required edge 单独断言，原边的顺序、getter 访问和错误行为仍参与原对照。
- lint/typecheck、build/export、browser 通过。显式长时离线 soak 101 项通过（1113.5 秒）；它不访问 provider，不能作为 live 授权。

## 工作量和观察成本

E=1/16/64，相关变化比例 0%/1%/100%。测量阶段的无关输入为严格递增 watermark，确实产生不同的 quiescence 坐标；有变化输入为首次 exact outcome，绝不把已饱和 replay 算作成功接纳。setup transitions 单列在测量阶段之前。计数版与未修改 runtime 的描述性时长分开保存。

无关变化的 full-view 构造次数为零；每个真实接纳 outcome 恰好构造一次；相关 commit 内的 facts 共用视图；没有额外收尾波。每种负载另做 20 次断连/再订阅并保留旧版本字节。计数来自临时插桩；生产代码没有新增计数器。profile、控制消息和原始样本保留在 evidence bundle。

另实测无 observer、`graph.observe(authority)` 与整个 `graph.observe()`，按实际 envelope 序列化。E=64 的 0% 场景含 6400 次新 watermark：虽然没有重建视图，整图 observer 仍序列化了 695,556,616 bytes。16 条 64 KiB outcome 的最终视图约 1.07 MB，describe 约 2.35 MB。这些是该有限负载的实际字节，不是所有应用的预测；共享引用没有压缩日志/bridge/describe 的 JSON。新投影仍为相关变化 O(E+D)，原 transition 的 Map clone/聚合成本也仍存在。

## 接下来的明确边界

本批保留同一 work，状态不置 complete，不新建执行 D#。下一次有限工作应先定位未通过的构造/1000 背景节点稳态路径，并明确新源码如何获得新的离线资格绑定。任何预算、发布策略、C 或 root qualification authority 的语义改动，都需要具体方案审阅；本记录没有批准这些变更。

完整普通用户五端口、从真实四组输入开始的易用 preset、exact request materializer、current-at-dispatch guard、真实 inbox 和 B121 仍未证明。没有新增普通用户入口，但这不能证明使用者已能按需隐藏全部细节。用户此前给出的 lifecycle 判断继续有效；本批没有做新的用户理解测验或把维护者测试当作普通用户成功证据。

人和 agent 使用同一个 `committed-v1-receipt.json`、本审阅稿及其绑定的无损压缩证据包：实际输入、describe、轨迹、独立期望、source hashes、actor/approval provenance、所有采样批次、失败尝试及 mutation 分类都可以回查。它是一份候选实现资格记录，不是 effect 执行许可。
