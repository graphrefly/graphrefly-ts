# B1 局部入边物化：实现与验收

2026-09-07。唯一 owner：graphrefly-ts；沿用 `CAUSAL-CONSTRUCTION-OWNERSHIP-TS`。本轮用户“同意”批准 B1 内部实现和离线验收。本文是实现证据，不是新的语义决策、执行许可或下游工作批准。

## 实现路径

真实输入 → `causalOccurrenceBundle` / 私有 composition → cold scope 的实际 acquired nodes → registrar 的 `readIncoming` → Graph 共享身份/依赖遍历 → 原拓扑校验 → capability、seal、移交 owner → 启动 → 原 authority 与输出投影。

四个生产文件承担四个职责：

- `src/graph/construction-scope.ts`：读取现有 acquisition journal，核实此刻实际注册的成员。尚未构造的 manifest 名称不能成为实际节点。
- `src/graph/graph-lifecycle.ts`：通过既有私有 registrar 传递只读材料，不新增公共入口或持久 registry。
- `src/graph/graph.ts`：公开 describe 与私有读边共用发现顺序。私有模式仍扫描本图当前 deps 和传递裸依赖，只为取得成员生成入边，不生成本图节点的 value/status/version/meta 快照；mount 的原 describe 调用保留。
- `src/solutions/causal-occurrence.ts`：在原校验位置使用上述材料。A 的精确字符串校验器、required-edge helper、capability/seal/transfer/start 顺序均保持。

`describe` override 仍走完整原路径，包括实例、子类、prototype 和 getter 形式。读取方法属性一次，用 Reflect.apply 保留原 graph receiver 和空参数列表，不读取函数的 call 属性。父图入边在读取挂载子图前捕获，子图 override 即使改变父图依赖，也不能让这次检查变成较晚的二次快照。

**B1 仍然遍历全图。** 减少的是本图快照物化，挂载子图仍支付原快照成本；不能宣称严格局部复杂度或零开销。用户没有新增操作、配置或公共 exports。

## 证据与限制

最终源码专项共 81 项：39 个 causal contract、27 个 construction、12 个 B1 incoming、3 个 authority responsibility；默认全量 2217 项通过，原有 4 项环境/live opt-in 跳过。lint/类型检查、构建及 ESM/CJS/DTS 导出检查、3 个浏览器 smoke、派生产物重现检查通过。

新增 `ts-v6-inputs.json` 保留 ts-v6 收据与其绑定文件共 79 份原始字节。`compare-causal-incoming.mjs` 在临时源树实际加载旧 runtime；记录的 29 个旧 runtime 源文件哈希均匹配冻结收据。144 个配对场景覆盖普通图、mount、getter override、函数 call 属性 override、child rewire 和 child throw，比较入边顺序、synthetic IDs、后续 topology events、完整 snapshot/checkpoint、异常类型/文字和两输入 view 的运行输出。它是有限场景差分，不是独立业务 verifier，也不是穷尽证明。

原 73 个 causal runtime mutants 全部被捕获；construction 的原 17 个与新增 8 个 B1 mutants 全部被捕获。新增 mutants 实际修改临时 runtime：读 construction-time deps、跳过无关身份发现、跳过传递发现、绕过 override、跳过 mount、混入非 owned targets、延后父图捕获、绕过真实拓扑检查。每个都有成功编译及相应行为断言失败，不能用编译错误当作 kill。

独立 finite resource verifier 的 12 个快照通过，保留 2 个 plain-model 负对照。模型负对照与真实 runtime mutants 分开计数。原 business authorization、错误或过期 occurrence/admission、replay、fan-out/fan-in、active obligation 保护继续由原资格约束；局部读边没有成为 effect admission。

新增真实快路径反例：在 `causal/issues` 注册时，通过 topology observer 删除 cold authority 的实际依赖，保留原预期 manifest。原生 describe 身份不变，构造仍拒绝缺边、清理取得资源并保留八个借用输入。旧 override 反例也继续运行。循环遍历的单元压力夹具使用冷 deps getter；公开 rewire 拒绝环的规则保持，不声称运行图接受新的环。

展示组件退订仍不能结算 active obligation；Graph-owned instance 保持承担 lifecycle，错误 outcome 不能冒充精确终态。没有新增缓存资格、跳过 seal 复查、推迟所有权登记或独立 imperative 执行入口。

## 长时检查与性能

最终串行 soak：101/101 通过，绑定的全部 src 字节在运行前后及收据生成时一致。性能对照原七端口的六组完整轨迹匹配。

| count / evidence / background | baseline p95 µs | B1 p95 µs | 构造比值 | 稳态比值 |
|---|---:|---:|---:|---:|
| 1 / 0 / 0 | 121.375 | 140.500 | 1.1576 | 1.1206 |
| 16 / 128 / 0 | 96.125 | 118.792 | 1.2358 | 1.0034 |
| 64 / 512 / 0 | 93.625 | 116.041 | 1.2394 | 1.0095 |
| 1 / 0 / 1000 | 359.375 | 276.750 | 0.7701 | 0.9899 |

收据状态：**partial**。Rows [1, 2, 3] exceed at least one unchanged aggregate construction 1.20 / steady 1.10 budget.

普通图比值 1.0094；该项是每 update 的批次平均计时，不能当成 p95。动态 view 的五个交替对照批次及峰值堆数据保留在原始报告；峰值堆是全进程诊断，不能归因成 C retained bytes。所有构造批次比值也保留，未挑选最优批次或承诺跨硬件结果。

构造性能沿用冻结 ts-v4 实际 runtime、相同 23 个 composition 节点和八个输入、原四行、三批交替配对及所有原始样本。构造场景容量匹配、arrivals 为空；occupancy/evidence 在随后的完整稳态轨迹中运行。原预算仍为构造 p95 ≤1.20、稳态 ≤1.10。性能 runner 与 ts-v6 相同，没有一起优化基线、修改采样或挑选最佳批次。

## QA 与开发过程

两名静态 reviewer 分别检查普通代码风险和 R-describe/R-edges-derived、D160/D161 一致性。override 调用的两处 introduced 差异已修复：读取两次 describe 属性，以及通过 .call 额外读取函数属性。最终用捕获一次 + Reflect.apply；回归覆盖 receiver、getter 次数和带抛错 call 属性的合法函数。

开发失败保留在任务日志：初版测试误用公开 rewire 建环及误猜释放错误文字；一个 mutation anchor 同时匹配 describe 与 checkpoint，已缩窄定位后完整重跑；类型检查发现 DescribeSnapshot 模块导入错误，已修正并绑定最终字节重跑资格。全量首轮两项失败是旧 implementation manifest/artifact 绑定，重新测量并生成后全部通过。初次 lint 的生成报告格式问题也已修复。最后的 Reflect.apply 修复前，串行 soak 运行约 367 秒后主动中止，随后针对最终字节重跑；该中止记录不算通过。未修改任何错误规则或降低资格要求。

当前源码/测试变化要求刷新 root eval 的三个 no-network hash 及派生工件；这只更新离线材料，不更新 operator 配置、凭证、live grant 或 provider execution。历史 ts-v4/v5/v6 收据及报告保留，新证据使用 ts-v7。

## Ownership handoff

本批 contract：给定同一真实图，当冷构造从完整快照改为 B1 入边物化时，校验、后续 ID/事件与失败所有权保持，而物化工作减少。路径起点仍是现有 library factory；优化位于私有 Graph/scope 构造路径，不扩展 core/patterns/solutions 的公共分层设计。

与你原预测的对照：Graph 必须掌握 lifecycle、组件失去依赖要被发现、业务推进不能落到 imperative 旁路，这三点保持；涉及模块收敛为四个生产文件及其离线证据，未展开全库改造。

实现/验证完成程度见最终收据；用户 teach-back 尚未验证。供回看时自测：

1. 这条路径从哪个现有 library 入口开始？
2. scope、Graph reader、原拓扑校验各负责哪一步？
3. 为什么减少物化后仍保留全图身份发现？
4. 哪个真实失败场景能证明没有拿 manifest 伪造实际边？
5. 差分、runtime mutation 和性能对照各证明什么、还不证明什么？

普通 preset、分级公共 API、真实 consumer 的独立 deterministic business verifier、plain-code 等价产品对照、effect host 接入和 B121 展示仍未完成。本批没有 provider/live/spend、staging、commit 或自动下一批。

AI 协作记录：没有人工对照，不能可靠估计“无 AI 工时”；实际各项耗时在收据 checks，静态 review 两轮，返工为上述局部修复；范围未扩展到 B2。下一日 retrieval score 尚待用户回答。
