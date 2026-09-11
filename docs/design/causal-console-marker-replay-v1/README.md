# Console 标记适配：保存 trace 的离线资格

2026-09-10 · `graphrefly-ts` · 基线 `1b883c08` · 现有 `CAUSAL-PRESET-ASSEMBLY-TS`。

**已保存真实 trace 的时钟关联路径通过独立离线验证。** 本批新增采集进程为 0，consumer
测量为 0；旧采集失败收据、旧性能样本和 verdict 保持不变。整个 preset work 仍未完成。
用户在具体 async marker / retained-trace-only 提案后批准“同意，继续”；见 [approval.json](approval.json)。

## 本次改动

`replay-causal-event-clock.mjs` 只读取 capture → `correlateTrace` → 新的 correlation/replay 文件。
独立 `verify-causal-event-clock.py` 读取相同原始输入、重算标记和误差区间，再核对新报告。
它们不会加载或执行 capture 中的 fixture。replay 的输出必须位于 capture 外，解析符号链接
后检查；新目录的创建和排他写入阻止覆盖已有结果。

Node v24.18.0 console 标记按完整 `time::<run>:<window>`、category、PID、TID、id 配对小写
异步 b/e；待配对记录只存在于一次纯解析调用内。重复 begin、孤立 end、未关闭、错误身份、
错误相位或不支持的 id scope 均拒绝。GC/deopt 的同步 B/E 栈与 X span 规则仍独立。
此前把 console marker 当同步 B/E 的假设已更正，没有把两种生命周期混用。

没有 library/runtime/API/protocol 或 performance estimator 改动，没有通用 profiler 或公共入口。
普通用户与框架作者没有新增性能/认知成本；这是维护者私有诊断解析，不能把它的结果称为
Graph 性能资格、完整 GC 原因覆盖或 latency 因果证明。

## 真实证据与边界

最终材料：[replay-final](../../../archive/evals/causal-console-marker-replay-v1/replay-final/)。
使用原 capture 的全部 31 条 trace 记录、三个时钟锚点和三个测量窗口，原始字节未变化。
原 trace 的三个 console marker 均成功配对；一个 MajorGC、两个 V8.DeoptimizeCode span
被识别。GC/deopt 正向窗口得到 overlap，empty 窗口与这些已记录事件得到 disjoint。
这不等于 empty 窗口不可能发生其他未记录事件。

JS 与独立 Python 得到一致 offset 区间 `[84084539230, 84084539232]` µs，宽度 2 µs。
该宽度是校准不确定性的一部分，另有 trace 记录精度与样本边界传播，不能称为统一测量精度。
Python verifier 核实 3 events / 3 windows / 3 markers，并给出限定意义的 qualified=true。

这是新工具对旧数据的 **离线 replay 资格**；原 `causal-event-clock-repair-v1` 采集尝试仍然
是当时的 unknown/not-qualified。两份结果分别绑定各自工具字节，没有覆写或追认旧收据。
它也不能替旧 native GC/logger 文本补时钟锚点，原 67,200 样本的性能 verdict 仍为 inconclusive。

## 检查与审查

37 个 JS 工具测试通过：原 21 项、14 种真实标记错误输入、一个加载 mutation 检查和一个
路径保护测试。共 10 个实际加载的 helper mutation 被检测：原六个，以及基于真实 trace 的
漏 id、漏重复 begin、漏线程匹配、接受模糊 id scope 四个。不是 Graph runtime mutation 资格。

16 个独立 Python verifier 测试通过：真实正向、14 种原始 trace 损坏、伪造报告。测试只改
临时副本，并重绑测试 digest，让行为检查实际执行；原 capture 不动。
两个静态 reviewer 最终没有未解决发现。路径检查的符号链接缺口已修复并回归。
完整离线 gate 结果和局限见 [receipt.json](receipt.json) 及 archive/logs；不重跑无关 performance bodies。

## 交接

本批只关闭 console-marker 解析与保存 trace 的离线验证缺口。consumer 构造为何变慢、
相同代码 controls 的原始差异、完整性能矩阵和分级隐藏的用户证据仍不是已完成事项。
下一步应回到 consumer 归因方案；新的采集或矩阵不由本次 replay 自动授权。

沿用先前 OWN/PREDICT；diff、behavior、真实 trace 的正向和负向路径均有证据，用户 teach-back
仍未验证。闭卷复述点：入口、三步路径、完整标记身份、不可信输入如何拒绝、证据没有证明什么。
无 AI 工时、人工审阅/返工时间与次日检索分数未测量。
