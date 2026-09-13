# Single-version capture — stopped on invalid RSS evidence

用户在 `ba143fb7` 后确认一次32进程采集。本次已消费授权，启动 **1个B进程**，
余下31个未运行、零重试。整轮失败于RSS证据有效性，**不是内存超限，也没有性能比较结论**。
唯一 owner 仍为 graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS；本批是失败尝试与保留诊断证据。

## 事实

- job00/group0/position0/B，子进程退出码0，child写出120条样本（20warmup、100measured），
  另有7个不计时预检实例。0个进程取得完整测量资格；未运行C，不可能计算C/B。
- 全轮2.190812秒，子进程收据1.546498秒；wake/双时钟检查没有记录违规。
- 正数RSS最大142.78125MiB，小于256MiB。最后一个RSS点在子进程观察时间1.435550秒
  为0；之前是149716992字节。RSS指整进程，不能转成单graph内存结论。
- collector的exit记录failure=null，但随后的独立verifier拒绝`RSS`，父级result失败，
  停止全部剩余派发。这些不同层级收据全部原样保留，不把子进程成功写出样本当作资格通过。
- [失败报告](report.json)标记numericalComparisonComplete=false，只保留失败前缀和原始散列，
  不产出p50/p95对比。返回passed=true指失败证据格式可回放，不指测量通过。

## 已定位的工具缺口与未知

冻结collector `single-version-tools/collect.py:79`记录RSS后只即时检查超过上限，
而独立verifier `single-version-tools/verify.py:137`要求每个值严格为正数。
因此0被采集后，直到逐进程复核才被拒绝。停止路径有效，但资格测试漏掉了“ps返回0”这一
观测边界；这是私有测量工具的缺口，没有证据指向library性能退化。

`poll()`和`ps`分开执行，退出附近观测竞态是可能原因。但没有保留该次ps的进程状态、
原始stdout或调用前后退出证据，无法证明当时已经退出或处于何种状态；不得把猜测写成结论。
不得删除0、把它视为真实零内存、重写原失败或直接接着运行剩余31项。

下一项应先在私有工具中统一非正数RSS的拒绝规则，并保留每次观测原文及调用前后进程状态，
用假进程覆盖：活跃进程返回0、退出交界返回0、观察失败、正数超限及退出正常。
采用保守默认：无法证明为有效观察就停止；若要把某类终态观察排除出RSS序列，必须先明确
可独立核实的判定和间隔计算规则并审阅，不能从本次数据临时开例外。
先完成这项零consumer修复/资格，再审阅新的有限运行；本文件不提供新运行授权。

## 保留与复核

[授权上下文](authorization-context.json)、[collector日志](collector.log)、
[原始事实审计](failure-audit.json)、[回放收据](archive-replay.json)均保留。
[归档索引](../../../../archive/evals/causal-single-version-capture-v1/artifact-index.json)
绑定199文件，包括批准/一次性claim、冻结源码和工具、实际槽位、完整子进程证据及原始样本。
逐项hash检查后在新目录解压，只执行`python3 -B prepared/tools/verify.py prepared`，
失败报告与归档`evidence/report.json`逐字一致；回放没有执行consumer。

未改library/API/wave、测量阈值、冻结工具或旧证据。原currentness有限收益、双模块比较
inconclusive和p50中心改善线索仍分别保留；本次没有新增优化收益或回归结论。
D169正式资格与原work仍未完成。
