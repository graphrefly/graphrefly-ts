# Dependency initialization comparison — complete, inconclusive

本次授权已用完。48/48 个真实 Node consumer 子进程和 6720 个生命周期样本完成，
无失败、未运行项或重试。**控制不稳定，不能确认单循环初始化的性能收益或回归。**
这次采集完成不等于 CAUSAL-PRESET-ASSEMBLY-TS 或 D169 正式资格完成。

## 比较对象与结果

使用 [冻结方案](../dependency-comparison-tools/PLAN.md)：同一 private P2 summary consumer，
B `8253488bd7458a8f6caeb31e79fa04e4f870c77b`，
C `9c30967c8953ae09aa8de5949e0fbdd6de3c4813`；仅已批准的 eager 初始化循环不同。
包含 1920 warmup、4800 measured 和另计 384 个不计时语义预检实例。

以下比值为同位置、两次重复的 p95 比值中位数范围，低于 1 表示后者较低。
控制使用相同 B 字节在两个模块 URL 下运行；稳定范围预定为 [0.95238, 1.05]。

| 指标 | C/B 主比较范围 | B-copy/B 控制范围 | 冻结结论 |
| --- | --- | --- | --- |
| 构造 | 0.6645–1.0572 | 0.8418–1.0166 | 控制不稳定 |
| 六次初始输入合计 | 0.7182–1.0323 | 0.9361–1.0393 | 控制不稳定 |
| 重复输入 | 0.9718–1.0523 | 0.9434–1.0314 | 控制不稳定 |
| 清理 | 0.8935–1.1453 | 0.8503–1.0337 | 控制不稳定 |
| actionSum | 0.7291–1.0395 | 0.9228–1.0429 | 控制不稳定 |
| wall span | 0.7299–1.0400 | 0.9226–1.0458 | 控制不稳定 |
| residual | 1.0515–1.4031 | 1.0038–1.1763 | 控制不稳定 |
| inactive-1 release | 0.6949–2.5135 | 0.7531–1.3603 | 控制不稳定 |

主比较各块构造 p95 的绝对范围：B 0.4947–1.0298ms，C 0.4302–0.5703ms。
这些是不同块的描述范围，不能相减宣称收益。全部绝对 p50/p95/sum 与配对坐标见
[独立重算报告](report.json)。同代码控制也产生明显差异，说明该次比较尚不能隔离改动效果；
不据此归因于特定 GC、JIT、系统调度或某个 graph 节点，也不声称改动没有效果。

## 资源与证据

- 全轮 56.527718 秒，未触及 900 秒；每子进程检查和语义、释放检查通过。
- 最大观察 RSS **233.59375 MiB**，低于 256 MiB；这是整个 Node 评测进程，包含模块与样本等，
  不是单 graph 内存，也不是优化节省的内存量。
- 最大 RSS 观察间隔 0.117294 秒；主机连续性检查通过。轮询并非连续内存上限保证。
- Node v24.18.0、V8 13.6.233.17-node.50；[运行时预检](runtime-preflight.json) 与 reservation
  的路径、散列、版本和固定 PATH 均一致。[复查说明](runtime-review.md) 保留工具本身的
  PATH 选择局限及本次固定执行环境的补偿措施，冻结工具没有修改。
- 619 文件原始归档逐项散列验证；新目录解压后只运行独立 Python verifier，
  完整报告逐字相同，回放真实 consumer 数为零。
- [授权上下文](authorization-context.json)、[采集日志](collector.log)、[回放收据](archive-replay.json)
  和 [归档索引](../../../../archive/evals/causal-dependency-comparison-capture-v1/artifact-index.json) 保留。
  归档含一次性 approval/claim、全部源码与工具、原始样本、每个子进程收据和最终 result。

复核时先按 artifact-index.json 检查 archive 及每个文件 SHA256，再在新目录安全解压
`evidence.tar.gz`，执行 `python3 -B prepared/tools/verify.py prepared`。
输出应与归档内 `evidence/report.json` 逐字相同；不要运行 collector。

## 当前进度与后续边界

本轮完成了有限真实对比及可复核证据，未改变 library、公共 API、wave 或 registry。
先前 currentness 优化的有限收益证据仍独立成立；本次不能确认第二个初始化候选的收益，
也不能将两个不同方法的时间合并。原冻结 manifest 检查失败和历史 whole-soak 失败记录仍保留。

本方法按冻结规则止于 inconclusive，不追加采样或用平均数绕过控制失败。
下一步可只分析这批已保留数据中位置、重复和先后控制的差异，判断还能解释什么；
无法区分的部分明确保留 unknown。新测量方法或新优化须另行审阅，不能自动派发。
