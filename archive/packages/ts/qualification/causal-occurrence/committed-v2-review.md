# committed-v2：离线资格刷新未通过，保留失败与下一步方案

Owner：graphrefly-ts；沿用 CAUSAL-COMMITTED-VIEW-TS。本次不标记 complete，不启动下游。稳定生产源码仍为 861a9a468c5d767997a4bec70df159f327faa512；本次没有修改生产代码。源码通过上一轮原始四行性能门槛的证据仍有效，但完整离线资格尚未完成。

## 实际结果

| 检查 | 结果 |
|---|---|
| 候选 current binding 下的默认全量 | 2257 passed，4 个原有 Podman live opt-in skips |
| 原 causal / construction / cold mutation | 73 / 25 / 16 分类检测通过 |
| 新 view mutation | 11 通过：8 实际输出、2 不可变、1 工作量；另 2 处 deferred 邻接审计不计 runtime kill |
| 独立 plain-code / oracle | 两臂各 12 场景、2 热输入顺序、33 行工作量/观测；原始结果与独立期望一致 |
| 原八 ports 对照 | 冻结 ts-v8 与合格 d9c868dc 两个不同基线，各 6 条轨迹及 startup fault 一致 |
| 辅助/资源 | 168 required-edge、144 incoming、12 快照和 2 负对照通过 |
| browser、lint/typecheck、build/export、artifact 重生成、owner/workspace/dashboard 预检查 | 通过 |
| 显式完整 no-network soak | **96 passed / 5 failed**，1326.25 秒 |
| 原失败五项单独执行 | **4 passed / 1 failed**；shuffle 仍为 7767 ms，超出原 5000 ms |
| grant 单项诊断 | 1 passed；不能替代完整 soak |
| 临时单 fork CPU 采样 | 仍因原 5000 ms deadline 失败；仅用于定位，不计资格通过 |

完整 soak 的四项超时分别为 thirty-truncated responses、D159 horizon、development-3 shuffle、历史 D85。第五项是临时 synthetic grant 的 execution-grant closure 拒绝。前一个 horizon 用例跨 await 修改测试进程的 manifest-directory，并在 finally 恢复；Vitest 超时不会取消底层异步函数，可能与后续 grant 的两次 manifest 读取交错。单项及五项诊断中 grant 已通过。这是有代码依据的可能级联，**尚未证明它就是首次故障根因**。

五项诊断没有全部通过，因此未启动预设条件下的完整再次确认，没有以重复运行挑选通过结果，也没有增加 timeout。

## 已定位到的剩余成本

超时测试与直接 task/canonical/codec 文件和已合格 d9c868dc 字节一致。本批变化的 causal 文件不在这些直接文件中；这不是穷尽动态调用图的证明。

该测试将全部 120 种排列放进一个同步 it，在其显式循环中为 5 个 task、public/hidden 两种 verifier 分别创建 input、expected 和 3 个 candidate 的新 VM context，共 6000 次显式 runInNewContext 调用。临时 CPU profile 的主要 worker 中，createContext 自身的采样加权时间约 3457 ms，相关 VM 栈约 3670 ms。采样包含收集/运行阶段，不能用它推算精确调用耗时或未经采样的最终速度；它表明继续微调 causal 构造不针对这个测试的主要已见成本。

本轮从上一轮封存包独立核对全部 145 个成员，复算 7200 构造样本和 108 稳态 lifecycle。前后全部 431 源码摘要及实际 runner/closure 与当前相同，原四行 ≤1.20 construction / ≤1.10 steady 均通过。没有再跑该性能 gate；历史失败和 1.839833 异常原因未知这一事实继续保留。

## 候选绑定已撤回

本轮曾按既有流程生成三个 candidate current 摘要和五个派生工件，默认测试及 artifact 检查在这些候选字节上通过。但完整 soak 失败，不允许把它们发布为已完成的新资格。已将这六个文件恢复为本批开始时的精确字节，并在证据包保留全部候选内容、diff 和撤回校验。

因此，**最终 checkout 仍保留旧资格摘要与新 runtime 的已知 drift**；不能把候选绑定下的 2257 通过声称为最终 checkout 的完整全绿。旧收据、科学输入、真实 grant、C/core/public API/wave protocol 均未更改。所有进程已退出；对于发生 timeout 的异步测试，不额外声称其每项临时 fixture 清理均完成。

## 下一步的具体推荐，尚未应用

推荐审阅同一个 shuffle 测试的参数化方案：一个 enumeration/support 对照，加上 120 个顺序执行的参数化 case。保留全部排列、6000 个独立 VM context、每个 manifest 的三候选/public/hidden、rebinding/disjointness 和 bank-support 断言，不改任务内容、科学方法、provider 配置或 runtime。总验证工作不减少，不承诺更快，也不影响 library 用户入口或产品 runtime 成本。

**需要明确接受的变化：原来所有 120 排列合计受一个 5 秒 watchdog 约束，改为每个排列和 enumeration 各受原默认 5 秒约束。** 这改变了测试超时的粒度，超出本批“只刷新绑定、原测试 timeout 不改”的已批准范围，不能悄悄执行。全量 soak 的 case 数预计从 101 变为 221，需要重新运行完整资格并记录新的测试源码闭包。当前只提供未应用 patch 和语法检查，不提供通过承诺。

相较提高整个测试 timeout，该方案让失败直接指向具体排列，并保留 fresh-context 隔离；相较复用 VM context 或改成宿主函数执行，它保留更多既有执行语义。代价是测试项增多、总时长不降低、总计 5 秒的旧限制不再保留。若用户仍要求该排列矩阵合计必须在 5 秒内，便不能采用此方案，而需要另行审阅 verifier 成本优化。

待审 patch：[committed-v2-shuffle-proposal.patch](committed-v2-shuffle-proposal.patch)。批准的是测试组织/资格粒度调整；不需要新 D#，更不是 provider/live/spend 许可。

## 证据与未覆盖项

人和 agent 共用 committed-v2-receipt.json 与无损 evidence tar：所有原始报告、source/runner/test/oracle/基线身份、完整日志/DONE、失败诊断、临时 profiler/config、撤回前后字节和未应用方案都被绑定。两位静态 reviewer 修正了新封存验证器的报告身份核对缺口与 upper-middle 中位数口径；原始测量与 harness 未改。

本批仍不证明按用户等级隐藏入口、完整 preset、五端口按需恢复、materializer/current-at-dispatch guard、真实 inbox、B121 或实际 effect 执行许可。UI 退订不结束 graph-owned lifecycle，旧 admission/evidence 不等于当前执行许可。
