# 真实本地文件证明结果

2026-09-14 · 运行基线 `c7d040e3` · TS owner · 对应已审阅的单次执行清单。

**23 个场景 × Graph/plain 两臂，46/46 通过。** 共 30 次宿主 write 请求，其中 26 次实际调用独占文件句柄，独立读回 6,338 字节。其余请求保持未返回或在故障注入中提交前拒绝；没有补写、重试或伪造成功。46 个文件均为新建、0600 权限，全部保留。

本轮没有修改 library/runtime 或原冻结输入、预算、源码 mutation；新增的是只读证据复核脚本。执行授权为用户在上一条具体清单交付后发出的“继续”，绑定清单 SHA256 `68e6fbcc564fb6ddc48c9780faa9f61de9c378f0f44075349233e145465a7ec3`。它只覆盖这一次受控本地文件验证，不授权后续自动重试、provider、研究或性能任务。

## 实际证明了什么

| 场景 | 实际文件结果（每臂） | authority / lifecycle |
|---|---|---|
| 同拓扑错误评分 | 0 调用、0 字节 | 独立 verifier 拒绝候选 |
| 同拓扑等价评分 | 1 调用、266 字节 | 精确请求与成功 outcome 成立 |
| 缺业务分支 | 0 调用、0 字节 | 不把缺失业务结果当成完整证明 |
| 缺终态报告 | 1 调用、266 字节 | effect 已成功，lifecycle 仍未结束 |
| 错 admission outcome | 1 调用、266 字节 | 宿主成功不能结算错误关联；authority 仍 pending |
| 短写 | 1 调用、1 字节 | 保留 unknown，不能正常结束 |
| 未返回 | 1 宿主请求、0 底层调用、0 字节 | 保留 pending；进程退出不冒充终态 |

其余场景覆盖两 vendor 与修订交错、重放、同 ID 冲突、旧 source、错/缺 currentness、缺 verifier、容量不足、正常交易与 scope 外标题变化。23 组 Graph/plain 的最终字节逐组一致，23 个 Graph 实例的节点身份、factory 与边均一致。

“46/46 通过”是冻结场景的预期行为通过，不是说错误评分或缺分支候选也获得了资格。源码变异在上一批的加载 bundle 中完成，本轮直接执行这些已绑定字节。

## 复核与保存

- 执行器在创建文件前检查 manifest、63 个源码输入、runtime、verifier、scenarios、lock 与 Node 摘要；首次异常即停止规则未触发。
- 每个 child 结束后，父进程独立读取真实文件并验证请求/outcome/authority；不会用 child 自报写入次数替代字节。
- 新增 `scripts/verify-spending-host-proof-execution.mjs` 只读重放，再核对文件权限、摘要、精确 transport schedule、两臂字节与拓扑。两次重放输出逐字节相同，运行 consumer 和新增写入均为零。
- [可读收据](receipt.json)、[逐场景复核](replay.json)、[授权](approval.json)、[预检](preflight.json) 已保存。
- [原始归档](../../../archive/evals/causal-host-proof-execution/local-files-v1.tar.gz) 包含 142 个条目：46 个 inbox、原始执行收据及 stdout/stderr、manifest、授权和预检；压缩后逐文件与现场字节核对一致。现场文件没有删除或复用。

本次脚本运行约 5.505 秒，仅记录本次调用耗时；这不是冻结性能矩阵或延迟资格。未重新运行此前 2712 测试：library/runtime 未改，沿用上一提交通过的资格；本轮新增只读脚本实际重放通过，lint 与已有证据完整性门禁另行检查。

## 还没有完成什么

实际本地文件的有限功能缺口已补上。**B121 仍未完成**：root owner 的精确 producer 接线尚未应用，root 独立汇总、human/agent 比较及原正式性能条件仍未完成。上一批 offline-preparation 收据保持历史原文，没有把当时的 zero-I/O 声明改写。

这些结果不证明 fsync/crash durability、生产 inbox、自然磁盘故障概率或完整身份归因。下一步应做 TS owner 证据接线与 root 差距核对，明确人/agent 比较需要的完整设计；不因此重开性能优化或发布通用 spending solution。
