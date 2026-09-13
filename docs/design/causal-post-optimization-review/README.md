# 两次内部优化后的完整场景复核

Owner：graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS。用户批准收敛性能诊断并复核完整场景，明确不新增跨波次编码缓存、持久索引或旁路状态。本批只采集和复核，没有产品源码修改，也不新增架构决定。

当前产品基线为 b30ae176，包含 586fa795 的 evidence 终态查询汇总和 b30ae176 的同次 currentness 精确 admission 查询复用。两者都是调用内数据，不跨波次保留。

使用既有 prepare-causal-coverage-profile-v2 / run-causal-profile-v2 / verify-causal-coverage-profile 工具，固定原六组输入、84 行、每 cold/steady 臂一次动作及 recovery 每 Graph 臂 20 周期。Graph profile 选项仍只在诊断 bundle 中开启。与优化前 causal-coverage-profile-current-v2 的完整运行比较，独立检查源码差异只涉及 evidence.ts 与 identity.ts，并逐节点比较调用次数。

这张覆盖地图验证场景和执行形状，耗时是跨次运行的描述性数据，不是正式 p95 或同进程配对实验。两项优化的配对诊断分别见 causal-evidence-query-optimization 与 causal-currentness-query-optimization 的报告。已有 D169 Z 方法资格失败仍保留，本轮没有重复运行 Z 求绿，也未放宽门槛。

内存观测包括整个采集进程的 RSS、动作前后 heapUsed。进程同时包含预检、三个实现臂、历史诊断结果及 V8；heapUsed 受到 GC 时点影响。它们不等于单个 graph 占用或 retained heap，不能独立证明内存优化。

产品源码本轮未改，复用上一提交的全量结果（2553 通过、2 项既有 D159 manifest 漂移失败、4 skipped）、73 runtime mutation 和 build/export/typecheck 结果，不制造一轮新的“全量通过”。完整正式性能资格和分级隐藏的 consumer/API 验收仍未完成。

## 已完成结果

84 行、84 次预检、696 次动作观测复核成功；每个节点的调用次数与优化前一致。12 cold、60 steady、12 recovery 均覆盖，recovery 共 480 次重新连接动作的 retained state 与输出重新投递断言通过。采集耗时 531.02 → 204.79 秒，进程峰值 RSS 438.48 → 434.42 MiB；后者差异不足以宣称内存收益。

| off / duplicate / 双 DATA | 优化前 candidate ms | 当前 candidate ms |
|---|---:|---:|
| P1 | 10.40 | 7.01 |
| P3 | 429.94 | 162.26 |
| P4 | 4929.18 | 863.58 |
| P5 | 5009.06 | 929.45 |
| P6 | 5085.99 | 967.90 |

当前 candidate 的 12 次冷构造观测为 0.402–0.930 ms；这是单次构造，不能推出 p95 预算通过。12 个 recovery 行的各 20 周期中位数为 0.045–5.806 ms，行为和调用次数保持一致，也不将它们改称正式性能门槛。

60 steady 行中 candidate 与 reference 各有 57 行耗时下降。candidate 的三个上升行是 P2/off/all-new/1（3.023 → 3.581 ms）、P1/off/all-new/1（1.141 → 1.169 ms）、P1/summary/duplicate/1（1.052 → 1.068 ms）。保留这些反例，不能声称所有场景都更快；当前每行一次观测不足以确认真实回归。plain 也存在双向变化，因此不将不同日期的比值作为正式归因。

仍然最慢的 candidate 场景是 P6/summary/all-new/2，约 1870 ms；重复动作之外仍有明显处理成本，且调用次数放大尚未改变。本批没有足够新证据支持再改一个热点，停止追加猜测性优化。跨波次缓存仍不采用。

结论：两次局部优化的收益与完整业务覆盖已有证据；没有证据宣称整体时间/内存预算合格。正式 D169 方法资格问题、既有 D159 manifest 失败、分级隐藏 consumer/API 验收继续作为不同的未完成项保留。
