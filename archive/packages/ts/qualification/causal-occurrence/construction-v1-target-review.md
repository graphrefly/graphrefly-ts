# A2：每条 lane 只计算一次目标名

2026-09-07。唯一 owner：graphrefly-ts。沿用 `CAUSAL-CONSTRUCTION-OWNERSHIP-TS` 和 D160/D161；用户“同意，继续”批准本批单函数实现及离线验收，不是 B2 或其他下游工作授权。

## 改了什么

[causalOccurrenceRequiredEdges](/Users/davidchenallio/src/graphrefly-ts/packages/ts/src/solutions/causal-occurrence.ts:373) 将 `${name}/input/${laneName}` 从每条边的 filter 谓词移到每条 lane 的回调内。每条 lane 计算一次目标名称；仍进行八次筛选，仍读取当前提供的边。

这是唯一生产源码变化。原 B1 的全图身份发现、局部入边物化、override/mount 行为不变；原拓扑 checker、21 条内部边、capability/seal/transfer/start、authority 的一次提交和原输出投影不变。没有新 public export 或每 DATA 工作。`name` 的承诺范围是类型定义中的 primitive string，不包含伪装成 string 的带副作用对象。

## 实际路径与行为

真实输入 lanes → `causalOccurrenceBundle` → cold scope 取得实际节点 → B1 `readIncoming` → 原 checker 建索引 → 本 helper 提供来源边及内部预期边 → 缺边拒绝或进入原 seal/移交/启动。

helper 仍按 lane 顺序选取实际来源对象，保留重复项、稀疏孔跳过、`description.edges` 每 lane 的读取及 `edge.to` 顺序；无 description 时只返回 21 条内部预期边。每次返回独立的外层 frozen 数组，不冻结调用方的边。预期边没有成为真实边证明，也没有成为 effect admission。

展示退订仍不能结算 active obligation；Graph-owned instance 继续承担 lifecycle，错误或过期 outcome 不能替代精确终态。

## 验收

- 新增 4 项针对对象身份/顺序、动态 getter、getter 失败短路和独立 frozen 结果的行为测试；专项合计 85 项通过。
- `ts-v7-helper-inputs.json` 保留收据绑定的修改前完整 solution 源码。新的差分 runner 从旧/新源码提取实际 helper/checker 声明并编译执行，直接验证旧源码摘要属于 ts-v7 收据。
- 168 次 helper 差分执行通过，包括特殊字符、空名称、Unicode、重复/无关边、稀疏数组、缺少 description、动态 edges getter 及抛错。每次还比较完整结构和逐项缺边时的 checker 结果。部分模式忽略某些 seed 变化，不宣称 168 种互异输入或穷尽证明。
- 144 个 B1 实际 runtime 差分场景继续通过；原 73 个 causal 加 25 个 construction runtime mutants 全部被捕获。A2 纯函数差分不冒充新的 runtime mutants。
- 独立 resource verifier 的 12 个快照通过，2 个 plain-model 负对照单独计数。原生快路径实际删去 authority 依赖的反例继续拒绝并清理取得资源，保留借用输入。

最终全量 2221 项通过，原有 4 项 opt-in 跳过；长时测试 101/101 通过。lint/typecheck、构建及 ESM/CJS/DTS 导出、3 项浏览器 smoke、离线产物和 workspace/dashboard 检查通过。源码在各运行前后及收据生成时保持一致。

| count / evidence / background | 构造 baseline → candidate p95（µs） | 构造比值 | 稳态比值 |
|---|---:|---:|---:|
| 1 / 0 / 0 | 104.542 → 122.292 | 1.1698 | 0.9636 |
| 16 / 128 / 0 | 91.459 → 100.875 | 1.1030 | 0.9909 |
| 64 / 512 / 0 | 88.875 → 103.334 | 1.1627 | 0.9994 |
| 1 / 0 / 1000 | 390.792 → 287.000 | 0.7344 | 0.8557 |

本轮收据为 **complete**。All four rows meet the unchanged construction 1.20 / steady 1.10 thresholds in this single finite local qualification.

构造仍以冻结 ts-v4 实际 runtime 为基线，物理资源匹配但旧基线没有 C 所有权保证；原 runner、三批交替构造采样与独立预热的稳态配对均保持。六组原七端口轨迹完全匹配。所有原始批次保留，未挑最好一批。 通过判定沿用预先约定的四行聚合值；1/0 的首批构造比值 1.236，64/512 的后两批 1.265、1.218，单批仍高于 1.20。因此 complete 不表示每个批次都低于门槛。不能把本轮与 ts-v7 的独立运行差值冒充 A2 的配对净收益。普通图比值 0.9652 是每 update 批次平均计时的汇总，不是 p95；动态 view 的所有五批和全进程峰值堆保留于原报告，不等于窄视图稳态或 C 特有 retained bytes 的资格。

两位静态 reviewer 未发现生产修改引入的问题。证据 follow-up 指出新 runner 最初未直接核对“冻结源码摘要 = ts-v7 收据中的源码摘要”，现已增加并重新执行差分。没有为此修改生产逻辑。

全量首轮有两项失败：离线 manifest 更新误用了相邻 live-qualification 摘要，应使用 topology 摘要；另一个原有持久化用例超过原 5 秒超时。首轮失败日志保留；绑定修正后，单独重跑全量，未改测试断言或超时。最终各项结果以新收据为准。

更新 root eval 的三项摘要与派生工件只刷新 no-network 材料，不更新 operator 配置、凭证、live grant 或执行 provider。历史 ts-v7 及更早收据保持原字节。

## 证据边界与回看

本批区分：源码及 actor provenance 说明哪段实现由本任务修改；behavior/differential/mutation 说明哪些有限后果保持；性能对照单独判断成本。拓扑相同不能证明源码未改，测试通过也不授予外部 effect 执行许可。

与用户原预测的对照：主要入口仍是 library factory，生产变化收敛为一个 solution helper；所有权、实际依赖和无 imperative 旁路的约束保持。公共入口分级隐藏、普通 preset 和真实 consumer handoff 尚未完成，本批不证明这些。

已交付实现证据；用户 teach-back 尚未验证，不能标 ownership-verified。回看问题：

1. 真实输入从哪个 library 入口到达 helper？
2. 实际边和预期边各来自哪里？
3. 为什么只移动目标名计算，仍保留八次筛选？
4. 哪个失败场景能证明缺失实际依赖不会被 manifest 掩盖？
5. 差分、runtime mutation 和性能各证明什么，还不能证明什么？

没有人工对照，不能可靠估计无 AI 工时；各检查实际耗时保留在收据。review/rework 是一次证据绑定补强、一次离线摘要纠正及原超时复验；范围没有扩大。下一日 retrieval score 待用户回答。没有 staging、commit、B2 或自动下一批。
