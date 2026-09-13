# hrtime 锚点准备资格通过

2026-09-12 · 唯一owner `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。
承接da7d02ad与用户“继续”：实现私有替代、离线检查和最多3CPU＋1GC准备探针。
本次claim已消费；没有consumer执行、library改动或正式性能资格结论。

## 结果与意义

| 新进程 | 时间区间宽ms | 已知函数确定归属样本 | 边界模糊 | 误归属 |
|---|---:|---:|---:|---:|
| CPU 00 | 0.047918 | 366 | 2 | 0 |
| CPU 01 | 0.048918 | 599 | 0 | 0 |
| CPU 02 | 0.047751 | 614 | 0 | 0 |

三次均通过原0.1ms门槛和已知函数归属检查。共1769个CPU采样点，其中1579个已知函数叶帧
确定在对应窗口内，2个模糊，188个其他叶帧；不是耗时份额。GC新进程交付2个事件，分别与
两个主动GC窗口重叠。它证明GC功能路径可用，不证明事件完整或GC造成全部重叠耗时。

四个进程正常完成，无重试、替换或未运行坐标；最后子进程退出距预算起点1.177969s。
最大观测RSS57.203125MiB，最大观测间隔0.114434s；RSS为探针整个Node进程的离散观测。
真实consumer、Graph实例、性能比较样本均为零。

此前8c7ce678首探针0.903669ms的失败原样保留。这次不是重算旧数据或放宽门槛：
使用独立授权的短hrtime锚点和自己的父Mach读数。通过说明当前固定Node/macOS上这三次
准备探针具备时间对齐能力，不保证长运行、睡眠或其他版本同样通过。

## 实现与验证

新增四个私有scripts，历史脚本不变：probe-causal-anchor-clock.mjs负责原始读数；
verify-causal-anchor-clock.py用精确分数验证J/S/E区间及样本归属；run-causal-anchor-probes.py
负责单次claim、实时timebase核对、进程资源和失败停止；causal-anchor-clock.test.py负责合成检查。
原结构验证器仅复用profile输入校验，旧对齐公式的qualification不参与新通过判定。

独立只读审查修正了两个问题：函数内窗口不能完整包围进出阶段，因此改为调用者侧计时；
GC也必须检查自己的父时钟包围区间。两项均在冻结/执行前修正。另核对实时Mach timebase，
保证计划里的125/3与实际一致。浮点误差论证与执行前检查见pre-execution.md。

五项离线测试通过，覆盖14种错误输入、错误样本归属、sleep/调度扩大误差界、GC错时钟/缺事件，
以及不启动子进程的单次claim和首失败停止替身。以前的3000余数/54000区间算术证明也被绑定。
这些检查和真实已知函数探针承担不同证据职责，不能互相替代。

## 离线复核

```sh
python3 scripts/causal-anchor-clock.test.py
python3 docs/design/causal-cost-investigation/anchor-clock-preparation/replay.py
```

plan.json绑定31个运行前文件及固定Node哈希、显式环境；claim.json仅存在一个且已经消费。
frozen-inputs.tar.gz保存全部31个冻结输入，evidence-index.json绑定原始读数、profile、资源记录
和归档。replay.py从归档解出验证器到临时目录，检查冻结哈希并重算全部4个进程。当前对应文件
存在时也核对其字节。原始时间戳与精确有理数端点可直接审计，不使用中点或拟合结果。

资源数据是监督器观测，并非连续峰值证明；哈希回放校验保留记录，不能证明机器不存在未记录进程。
本轮只运行影响到的私有工具检查与治理gate，没有重新运行完整TS suite（生产源码没有变化）。

## 下一边界

**时钟探针已资格，真实capture工具尚未资格。** 下一批可以准备12进程CONTROL/GC/GC_CPU
采集工具，沿原设计复用consumer输入闭包，先用测试替身验证窗口分类、GC区间并集、栈计数、
错误清理、预算停止与完整回放；准备时首尾锚点在三条件均保留。每个真实进程仍须自己的区间≤0.1ms。

当前不启动该consumer采集；实际12进程/28800样本仍需要单独授权。不得将此准备结果当正式
D169 cold资格、第二处library热点或新的性能优化结果。currentness既有收益保留，分级公开入口
及human/agent证据仍未完成。不增加公共profiler、registry或wave协议行为。
