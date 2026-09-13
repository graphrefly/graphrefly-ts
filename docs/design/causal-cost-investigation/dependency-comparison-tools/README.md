# Dependency initialization comparison — tooling qualified

本批只准备、冻结和验证私有测量工具。真实 consumer 执行数与真实性能样本数均为 **0**；
候选优化收益仍未知，原 CAUSAL-PRESET-ASSEMBLY-TS 与 D169 正式资格仍未完成。

## 冻结比较对象

- B：`8253488bd7458a8f6caeb31e79fa04e4f870c77b`。
- C：`9c30967c8953ae09aa8de5949e0fbdd6de3c4813`。
- 两侧使用同一 private P2 summary consumer；各 60 文件源码闭包，仅 `core.ts` 中已批准的
  `makeDepBookkeeping` 初始化改变。配套生成 runner 不在测量 bundle 内。
- P2 输入 SHA256：`44f1165557fc1444540731a73846233ce3d71da7a0af3a3d4fa2137e249c2079`。
- 175 项冻结资产；manifest SHA256：
  `104dc394658be721db0f08a1be08ad5bdf9a7fbac76bee5a25d58efd80949be6`。
- [归档索引](../../../../archive/evals/causal-dependency-comparison-preparation-v1/artifact-index.json)
  保留 198 文件；逐项 hash 检查后，独立 verifier 在新解压目录重放，输出逐字一致。

## 工具资格证据

[checks](checks/) 保留完整输出：实际 collector 走完 48 假子进程/6720 假样本；
10 类执行失败、23 种证据损坏、4 类时钟异常全部覆盖，错误、重复和复制授权被拒绝。
原 sample 与 child 主体保持一致，driver 检查 280 个坐标。
测试中存在 Node 元数据探针，但没有加载执行真实 consumer。

独立只读复查发现并推动修复了初始化缺失失败收据、清理竞态、中断、截断样本回放、
复制授权重放、授权到分派之间重新散列资产、源码漂移报告和失败原因覆盖问题；
复查确认该组问题均已解决。失败证据保持失败，漂移或主机异常报告不能进入数值结论。
这证明工具的已测拒绝与回放路径，不是性能结果。

## 待批准的一次真实采集

[PLAN.md](PLAN.md) 固定两个测量行：P2 生命周期和 inactive-1 release。
后者仅为计时路径负对照，其构造准备仍调用变化的 factory，不能称为完全未受影响进程。

48 个串行 Node consumer 子进程；6720 生命周期样本（1920 warmup、4800 measured），
另有 384 个不计时语义预检实例。24 个顺序位只抽取一次且已冻结。
每进程 30 秒、观察 RSS 256 MiB、全轮 900 秒，目标每 100ms 观察一次；零重试。
主机 wake 变化、墙钟/单调钟相对偏差超过 0.5 秒、同子进程观察间隔超过 1 秒均停止。
父进程休眠时无法即时强制上限，只能恢复后停止派发；不改系统休眠设置。
不添加 profiler、强制 GC 或计时子进程；失败保留前缀与未运行清单。

构造为主指标，同时核对输入、重复输入、清理与总成本是否转移。
输出绝对 p50/p95/sum 和成对 C/B 比值；控制不稳定时结论为 inconclusive。
50 样本 p95 只作描述，不能升级成显著性结论、单 graph 内存结论或 D169 正式验收。

`approval.example.json` 含 exampleOnly，因此不是有效授权。实际 approval、claim、jobs 和
采集结果尚不存在。后续获准后使用冻结 `prepared/tools/collect.py --approval <approval.json>`；
授权绑定规范路径、manifest 和一次性 claim。本批没有 library/API/wave 改动。
