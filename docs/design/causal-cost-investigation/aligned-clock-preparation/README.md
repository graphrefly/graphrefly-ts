# 时间对齐准备：精度资格未通过，已停止

唯一 owner：`graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。承接 `8ae1cffd`，用户“好的，继续”授权私有工具准备和有限无 consumer 探针。此记录是一次准备尝试，不新增 D# 或正式性能结论。

## 结果

只运行第一个 CPU 已知函数探针，正常退出；时钟区间宽度 **0.903669ms > 0.1ms**。立即停止，剩余两个 CPU 探针和一个 GC 探针未运行，无重试。真实 consumer、Graph 实例、性能比较样本均为零。capture tooling 未获资格，也没有启动拟议的12进程采集。

| 观测 | 数值 |
|---|---:|
| start 请求/回复区间 | 9.408333ms |
| stop 请求/回复区间 | 0.852375ms |
| ε（完整时钟变化界） | 0.044168ms |
| 交集宽度 | 0.903669ms |
| CPU 样本 | 422 |
| 已知整数/字符串函数样本 | 208 / 162 |
| 最后子进程退出（距预算起点） | 0.372447s |
| 最大观测进程 RSS | 56.984375MiB |

启停区间宽于精度要求；舍入与 native enclosing-read 误差界进一步扩大区间。已知函数出现证明采样工作，但不能缩窄时间界，也不能把栈样本数当函数耗时。RSS 是探针整个 Node 进程的离散观测，不是 Graph 内存。

## 可复核材料

- `source-proof.md`、`sources.json`、`platform.json`、SDK header：固定版本源码、平台和时钟关系。Node continuous 与 V8 absolute 对 sleep 不同，必须计完整变化界。
- `plan.json` 与唯一 `plan.json.claim.json`：运行前固定源文件哈希、环境和预算；claim 已消费。
- `probes/00/`：命令、进程信息、native enclosing reads、原始 CPU profile、请求区间、资源观测与分析；`probes/result.json`保留未运行坐标。
- `evidence-index.json`：原始证据和源码归档哈希。`source.tar.gz`保留八份带原许可证头的官方源码；本地解压副本忽略跟踪。
- 独立只读审查确认 full-variation 交集推导，补入 libuv <1ns 舍入变化。五项合成测试含12种错误输入、3000个精确分数余数和不启动进程的停止/单次领取/预算检查，全部通过。

离线复核（不会重新采样）：

```sh
python3 scripts/causal-aligned-clock.test.py
python3 docs/design/causal-cost-investigation/aligned-clock-preparation/replay.py
```

回放验证19个冻结文件、原始证据哈希、资源限额、原始 profile 算术与停止结果；源码缺少解压副本时直接读取归档。它校验已有记录，不能独立证明机器上不存在未记录进程。源码版本对应也不等于已完成可复现二进制构建证明。

## 收敛与下一边界

当前通过启停请求区间实现亚0.1ms归因的方法不够精确。停止此路线的采集准备，不扩大窗口、放宽阈值、取中点或追加探针。下一项只能先做无执行的替代时间锚定设计，证明能在固定 Node 上缩窄边界后再提有限验证；若无法做到，保留窗口归因 unknown，使用已有粗粒度证据。

这次结果不否定 `f7ea7a52` 的已验证 action-sum 收益，也不提供新的 library 热点或回归证据。生产代码、公共 API、注册表、lifecycle 与 wave protocol 均未改。正式 cold 资格和完整分级入口仍未完成。
