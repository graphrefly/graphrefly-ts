# Retained evidence 终态检查优化

Owner：graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS。用户同意减少运行时重复 JSON 工作，并要求继续。本批是 D160 单 authority 内部、保持结果不变的性能实现与证据；不新增 D#、公共 API、持久化状态、协议语义或执行权限。

## Q5–Q9 审查与限定范围

- Q5：位置是现有 evidence 职责的内部查询。继续由 authority 固定调用，不把查询或策略搬到 graph 外。
- Q6：依赖现有不变量：byRevision 的 occurrence 和 retained evidence/gap 均为 canonicalSnapshot；refKey 包含 sameRef 比较的全部坐标。只在这些保留记录上用已有 canonical key 替代重复同值编码。原始输入校验和通用 sameRef 不变。
- Q7：将 occurrences × required kinds × evidence 的重复扫描改成一次 transient Map 汇总与查询。它只存在于函数调用内，不跨波次、不注册、不成为第二份 authority；不改变消息拓扑、ctx.state 提交或输出顺序。
- Q8：A 保持原嵌套扫描，简单但重复编码显著；B 本次查询临时汇总，无失效/生命周期协调，仍支付每条记录一次编码；C 在入口保留编码和跨波次索引，潜在收益更高，但需要修改 retained state、所有写入/清理/恢复路径，当前证据不要求先承担该改动。
- Q9：采用 B，先消除已确认的大量重复工作。输入校验、可组合性、分级隐藏、单 authority 和稳定身份均保持；尚未覆盖的优化是入口编码一次并跨波次复用。本批不声称运行时已经完全移除 JSON。

实现保留 pending evidence 在 watermark 范围内阻止终态的条件；空 occurrence/required kinds 保留原真值；evidence 与 coverageGaps 均参与；完整 sourceRefs 内容仍参与身份。查询不删除任何 retained evidence，也不结算 effect obligation。

## 验证与实验

新增测试将结果和原谓词对照，固定 seed 的 500 组组合覆盖缺失/重复种类、gap、其他 domain 与未来 pending；另测精确身份坐标、sourceRefs 额外数据、恢复后新对象，以及 pending 加入/移除。现有 73 个 runtime mutation 继续全部被杀死。

对照实验使用相同当前依赖构建两个 bundle，仅 before 从 commit 9d4b8078 读取 evidence.ts。AST 检查确认两个 bundle 只有 isEvidenceTerminal 函数不同。P1/P3/P4 × 单/双 DATA × 3 次独立进程，顺序 before-after/after-before/before-after；另有 3 个 before-before 控制，共 21 进程。每臂原三臂业务 preflight，实际 Graph candidate，warmup 1 次、测量 3 次，断言动作前后 retained state 不变并比较两个版本的 state。没有 profiler 插桩。

这是限定工作量的优化诊断，不是 D168/D169 正式验收。中位数与每次比值全部保留，不选择最好的一轮，不校正控制比值。每进程 120 秒、总计 900 秒，没有失败后挑样本重试。首次准备的 comparison 因复制工具的相对 import 不可解析，在首个计时动作前失败；修复外层运行器使用散列绑定的仓库工具后，新 comparison-v2 从完整排程开始；原失败保留。

全量测试 2552 通过 / 2 失败 / 4 skipped；两项失败均为此前已有的 D159 manifest 漂移，未改资格 manifest 求绿。build（含 export gate）、示例 typecheck、package test:typecheck 通过。全量 lint 仍因归档/已有文件等失败；范围检查另行记录。正式 consumer performance qualification 仍未完成。

## 实测结果

21 进程全部完成（225.49 秒），42 次业务预检、126 个动作计时样本；独立复算通过，6 个重新索引的证据篡改负例被拒绝。下表是每进程中位数再取三次中位数，非 p95。

| 场景 | 改前 ms | 改后 ms | 三次 after/before |
|---|---:|---:|---|
| P1 / 1 DATA | 1.563 | 1.323 | 0.8873, 0.7379, 0.8997 |
| P1 / 2 DATA | 10.524 | 9.085 | 0.8350, 0.8712, 0.8617 |
| P3 / 1 DATA | 49.845 | 21.203 | 0.4185, 0.4254, 0.4211 |
| P3 / 2 DATA | 434.932 | 168.824 | 0.3868, 0.3907, 0.3875 |
| P4 / 1 DATA | 539.407 | 105.242 | 0.1940, 0.1973, 0.1929 |
| P4 / 2 DATA | 4951.440 | 928.126 | 0.1874, 0.1863, 0.1865 |

相同 before 版本的双 DATA 控制比值：P1 0.9405、P3 0.9899、P4 1.0048。P1 存在约 6% 位置/热度波动，不将其小幅收益提升为正式性能结论。P3/P4 的信号在全部三轮远大于对应控制差异；P4 耗时下降约 81%，但双 DATA 仍约 928 ms，整体性能目标未完成。未测量本批 retained heap/RSS 差异，不能宣称内存收益。

独立只读 QA 未发现阻断问题；补充多 sourceRefs 顺序、空 required kinds、其他 domain pending 的测试后，新增测试文件 3/3 通过。全量 2552 通过的运行发生在补充这一个测试之前，未把它改写为一次新的全量结果。

原始 comparison（启动前 import 失败）和 comparison-v2（完整运行）保存在 archive/evals/causal-evidence-query-optimization-v1/evidence.tar.gz，解包后逐文件散列校验并重新执行独立 verifier。
