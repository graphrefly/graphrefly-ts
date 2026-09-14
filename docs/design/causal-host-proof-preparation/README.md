# 同条件宿主证明：离线准备交付

本批完成 D171 的 private resource、Graph/plain 宿主对照、独立 verifier 和受控执行器。**完成的是离线准备，尚未写入真实 inbox，也未完成 B121。** 原公共分层入口和五个展示端口保持不变；没有恢复性能优化。

## 可以复核的结果

- 23 个冻结场景 × Graph/plain 两臂全部通过；23 次实际 Graph 拓扑完全一致。
- 同拓扑评分错误被独立 verifier 拒绝；等价 BigInt 改写保留精确请求与结果。
- 缺业务分支没有写入；缺终态报告保持 lifecycle 未完成。错误 admission outcome 即使宿主已成功，也不能结算 authority 的义务。
- 重放、旧 source、错 currentness、缺 currentness、未返回、短写、容量不足都有明确结果；checkpoint 验证许可前没有提前调用。
- 2712 个离线测试通过，4 个原有跳过；最终标签修改后重验 59 个相关测试。Lint/typecheck、build、export（含 64 个 CJS/ESM batch 场景）、历史 artifact integrity 通过。

最终证据：[summary](../../../archive/evals/causal-host-proof-preparation/attempt-2026-09-14T20-26-15-335Z/summary.json) · [QA 与修复](qa.md) · [收据](receipt.json)。失败/中间尝试原样压缩保存于 archive/evals/causal-host-proof-preparation，索引见 prior-attempts.json。

## 建议审阅顺序

1. `examples/spending-alerts/causal-resource.ts`：同一个 claim/transfer 所有权机制，真实来源需提前独占打开与 binding 完全一致的路径；退订或关闭句柄不结算义务。
2. `scripts/fixtures/spending-proof-plain-host.ts`：独立记账与最终 guard；unknown 后短暂旧 readiness 窗口也保留新 admission 并精确取消。
3. `scripts/fixtures/spending-proof-scenarios.ts` 与 `spending-proof-verifier.ts`：冻结输入、实际源码目标、独立请求真值、checkpoint 和 authority 结果。Verifier 的运行依赖仅自身与独立 numeric oracle。
4. `scripts/execute-spending-host-proof.mjs` 与下面清单：审批、source/runtime/lock/Node 绑定、fresh 目录、父进程读回与停止规则。

## 下一步可审批的真实执行

[完整执行清单](../../../archive/evals/causal-host-proof-preparation/attempt-2026-09-14T20-26-15-335Z/future-execution-manifest.json) 已绑定具体 bundle、verifier、source 和执行器摘要。授权对象是该文件的确切 SHA256，不是再次运行任意当前源码。

- 46 个独立空文件，仅在 `/Users/davidchenallio/src/graphrefly-ts-latency-review/latency-inputs/proof-7dc208e850ee10af` 下创建；该目录当前不存在。
- 冻结场景预期共 30 次 host write 请求；full/short 才调用真实句柄，reject-before-write/pending 不调用底层写入。
- 保守硬上限每臂 64 次、每次 4096 字节、30 秒；全批最多 2944 次、12058624 字节、23 分钟。一个 in-flight，无排队、无自动 retry；首个异常停止后续场景并保留全部文件和收据。
- 这是真实句柄上的**受控故障注入**，不是自然磁盘故障测量，也不证明 fsync/crash durability。pending 的进程退出仅释放 OS 资源，不伪造正常 lifecycle 结束。
- 需要另行明确批准后才生成非决策类授权记录并执行。本批没有此授权记录，未运行 local 模式，也不删除或复用任何目标文件。

Root B121 保持 proposed。TS producer 目前在隔离 worktree，canonical workspace 仍指向 main TS checkout，因此本批留下精确的 [root 接线提案](root-linkage-proposal.json)，未向 root 写入一个暂时无法解析的依赖，也未改动 root 已有未提交修改。合入 owner checkout 后再接线；准备证据不能替代后续真实 effect producer。

源变异记录可见并绑定具体输入字节；它记录本次工具生成的变异，不提供额外的人类身份认证。没有独立 provenance 的归因仍为 unknown。Human/agent 盲测、原正式性能条件及 root 独立汇总仍是后续工作。

完整 raw attempt 以 [压缩归档](../../../archive/evals/causal-host-proof-preparation/attempt-2026-09-14T20-26-15-335Z.tar.gz) 提交，summary 和执行清单另外保留可读文件，避免把生成的 runtime 当作手写源码审阅。归档已逐文件校验原始字节。新 checkout 如需复核，先解压到 `archive/evals/causal-host-proof-preparation`；这一步只恢复构建证据，不创建 inbox。当前 worktree 已保留展开文件。
