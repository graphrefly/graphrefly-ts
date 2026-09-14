# B121 owner 接线与剩余差距

本轮把已提交的 TS 分支快进到 canonical owner checkout，并将准确的 implementation producer 接入 root B121。没有新功能、真实 effect、性能测量或参与者实验。

## 接线已完成

- TS main 从 `1bf11e6c` 快进到 `0f537d9e`；这是本对话积累的 143 个提交。双方没有分叉，待合入文件与 main 的 16 个未提交文件零重叠；合入后这些文件的 SHA256 均未改变，index 仍为空。
- root resolver 保持原路径 `../graphrefly-ts`，没有复制 ledger、切换到临时 worktree 或改 resolver 规则。
- B121 新增精确 prerequisite/consumes：`CAUSAL-HOST-PROOF-PREPARATION-TS → preparation-v1`；`CAUSAL-PRESET-ASSEMBLY-TS → preset-v1`。前者 complete，后者 planned；B121 仍 proposed。
- root 的 `sessions/archive/b121-owner-evidence-intake-v1.json` 按 digest 引用 TS 准备/真实执行收据，并独立核对原始归档、执行收据与 46 个文件的 6,338 字节。该 intake 是机械完整性复核，不冒充完整 behavioral aggregate。

这次行政接线补的是过去遗漏的 owner 依赖；不回填“当时已接线”，不把已执行尝试包装为新增设计决定或新授权。

## B121 现在到底还差什么

| 要求 | 当前证据 | 尚未完成 |
|---|---|---|
| 原 contract 与 TS arm | 原 owner 记录仍有效，本轮不重签 | 无本轮新增缺口 |
| 普通用户/框架作者/维护者分级入口 | aa5bfc16 的实际 A/B 示例、原引用、退订/重连、五端口及离线测试 | 机器验证不能证明用户认知成本低 |
| 同拓扑实现变化、admitted effect、outcome 守恒 | 0f537d9e 的 23×2 真实文件臂；错误评分阻断，错误 outcome 不结算 | 仅覆盖冻结 consumer/domain，不能外推全部算法 |
| producer 接线 | 本轮 canonical checkout 和两个精确 producer 已接入 | 不代表所有 producer 已完成 |
| 支持的 assurance/diagnostics 组合 | 现有完整 runtime 的 off/summary 与分级 handle 暴露有证据 | 需要把 root 第5条与当前批准的支持范围逐项对应；不能宣称任意层级裁剪或所有未来组合都已验收 |
| 原 assembly 验收 | 历史与当前收据都保留 | 原53/54 owned-node约定需与后来版本显式映射；当前 proof 是含输入/宿主的62节点图，计数口径不能直接比较。正式性能方法/1.20、1.10门槛也未通过，不因真实文件成功而解除 |
| 谁改的 | 源码差异与加载字节绑定；工具生成的变异有声明 | 无独立身份凭证时仍 unknown，不从 Git 文案推作者 |
| Graph/plain 的理解与控制收益 | 两臂有限功能、结果字节一致 | 尚无合格的 human/agent 比较、隔离的预测阶段、sealed answer 和 root 评分汇总 |

因此，接下来不应继续堆 runtime 优化，也不能宣布 B121 只剩“做个演示”。功能证据已明显前进；剩下的是支持范围/旧验收映射和使用理解证据。

## 推荐下一次完整审阅的内容

用一个完整方案解决“如何证明用户真的更容易理解与控制”，一次审阅后再实施。沿用 B139 的上限：8 场景、20 个业务/边界节点、40 条关键事实、2 个 source diff；它们是投影上限，不删底层事实。

方案必须一次说明：

1. 三类用户各自从哪个现有入口进入，哪些事实默认隐藏、如何展开 exact refs；不新建 spending 公共 solution。
2. Graph/plain 获得相同业务事实和检索预算。第一阶段先预测变化/后果/unknown/effect eligibility并封存答案；第二阶段才给 verifier receipt，检验其是否正确解释证据。
3. hidden oracle 和 held-out 结果置于参与者不可搜索的位置。共享工作目录、文件白名单、当前对话代理或已看过结果的用户，不自动算盲测隔离。
4. 先冻结参与者数量、任务顺序、时间/工具预算及评分：错误放行、漏报影响、无依据的不变声明、unknown 校准、引用准确性。不得由当前46/46反向挑选容易题或事后改评分。
5. 对原 assembly 约定和 root 支持组合逐项标注“仍适用、口径不同、需要独立审阅”；不自动放宽性能门槛，也不自动开始新测量。

本轮仅完成接线与差距核对。上述实验设计是下一项建议，尚未选模型/人数、调用 provider、派发参与者或扩展公共 API。
