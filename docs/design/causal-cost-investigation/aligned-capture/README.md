# 时间归因真实采集完成：有源码候选，慢尾根因仍未知

2026-09-12 · 唯一owner `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。
用户在30ebe343列明固定采集后回复“好的，继续”，本次对应一次实际运行；approval.txt与唯一claim
绑定资格哈希。全部12Node consumer＋12Python verifier完成，没有重试或未运行坐标。授权已消费。

## 结论

**本次数据有效，可以查看构造窗口内的离散CPU栈，但尚不能宣布第二项优化或慢尾根因。**
四个CPU进程的偏移区间宽为0.049918、0.050292、0.049793、0.049376ms，都低于0.1ms。
此前时钟工具的失败不是本次失败，也不被覆盖；这次用每个进程自己的短锚点和父Mach读数。

### 1. 有了重复出现的源码线索

四个CPU profile都反复命中冻结bundle的`makeDepBookkeeping`（worker.mjs/worker-copy.mjs:1530）。
两份bundle SHA-256完全相同，报告仍保留各自命名空间；只在明确标注的源码位置汇总中合并。
它为每个节点构造batch、waveData、waveTokens、waveLive、prev、hasData、dirty、tier、terminal、
terminalInput等依赖记账数组。`_Node`构造函数在worker.mjs:2792附近调用它。

| 已确定叶帧样本 | 最慢组 | 普通组 |
|---|---:|---:|
| makeDepBookkeeping | 61 | 767 |
| 对应组全部确定叶帧样本 | 446 | 4505 |
| 样本比例 | 13.7% | 17.0% |

这是**构造成本审查候选**，不是它占CPU耗时13.7%或17.0%的证明。它在慢组中的比例没有更高，
所以不能解释为什么某个窗口特别慢。`_Node`、注册、拓扑验证等也反复出现，没有单一慢组独占热点。
没有应用source map或将bundle函数冒充graph节点身份；以上仅引用实际冻结bundle。

### 2. 当前交付的GC事件未与测量构造重叠

八个有GC observer的进程共交付840个事件（每进程104或106个）。与其measured构造窗口的
并集交集均为零，最慢组也为零。CONTROL没有observer，其零计数不用于此判断。
这只说明**已交付事件子集**中没有重叠，不能推出完全没有GC、GC没有其他成本或已排除所有runtime原因。

### 3. CPU采样有可见扰动，观测仍有缺口

同round/orientation/batch/arm的24组GC_CPU/GC比较中，20组p95更高，比例中位数1.0919，
范围0.9326–1.3948；construction sum中位数1.0474。完整三类对比在summary.json，方向混合照报。
不能把插桩条件下的数值直接当未插桩性能，也不能把这份比较当D169正式资格。

全部CPU profile共14622点：6835点确定属于某个构造窗口，2175点跨边界模糊，5612点在窗口外。
在measured最慢组360窗口中18个没有确定点；普通组6840窗口中2353个没有确定点。
这些缺口继续保持unknown，不插值、不把采样间隔全部归给某个函数，不用elapsed减process CPU推算等待。

## 工作量、预算与复核

- 28800构造样本：7200warmup、21600measured、72measured blocks；24次三臂预检调用/72计时外实例。
- 最终预算时点20.716938s；Node最大观测RSS209.578125MiB，Python41.921875MiB；最大观测gap0.148046s。
- 最终记录目录约43.77MiB，均在900s/30s每进程/256MiB/1s gap范围内。RSS是整个评测进程的离散观测，非单graph增量内存。
- 同一reference/reference-copy、P2 summary、EAGER记录；未修改library、公开API、wave protocol或原比较门槛。

原始证据归档：`archive/evals/causal-aligned-capture-v1/evidence.tar.gz`，403文件约4.12MB；
同目录artifact-index.json列哈希。receipt.json记录授权、资格、归档与完整分析哈希。
新临时目录解压后，用**归档内冻结验证器**重算，完整19MB分析输出逐字节一致。
`analysis.json`是可重建的本地派生文件，忽略跟踪；summary.json是可读的小型摘要。

在仓库根目录离线复核（不会运行consumer）：

```sh
# 将归档解压到独立目录，例如 /tmp/aligned-replay，然后：
python3 -B /tmp/aligned-replay/assets/tools/verify-causal-aligned-run.py /tmp/aligned-replay
# 本地raw/analysis仍在时，摘要可重算：
python3 -B docs/design/causal-cost-investigation/aligned-capture/summarize.py
```

复核证明保留记录一致，不能证明机器没有未记录进程；资源监视不是连续峰值证明。22个此前未提交
文件的哈希均保持不变。没有新增probe、provider/live/spend、重试或自动优化。

## 本方向结束与下一步

此固定采集已完成，不再追加同类采样。下一步是**只读审查makeDepBookkeeping及其调用者**：
检查构造时哪些依赖数组必需、是否重复初始化、零依赖节点成本，以及懒分配会不会破坏依赖变更、
生命周期、单一状态来源或引入新的隐式状态。先验证可避免工作与语义风险，再提交一个具体优化方案。

既有currentness优化收益保留。本次没有证明构造慢尾的单一根因，未完成D169 cold资格或分级公开
入口/human-agent证据；也没有授权实现下一项优化。
