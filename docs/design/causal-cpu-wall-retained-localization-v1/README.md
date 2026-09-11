# Retained CPU/wall localization — cleanup hotspot, no causal verdict yet

在 `ec5aa5e2` 的既有 28,800 样本上继续调查，**找到一个具体的二次遍历热点：每个样本后完整 graph cleanup 中的 `_releaseNodes` 活跃订阅检查。** 这是可单独验证的嫌疑点，还不是构造 p95 超预算的已证实根因。本轮没有运行 consumer、原生 observer、provider 或性能矩阵，也没有修改 library、捕获工具或冻结材料。

## 现有数据把范围缩到哪里

12 个进程每个 measured 阶段的构造总时长为 512.74–538.68 ms；同阶段样本之间的间隔总时长为 408.23–449.25 ms。间隔占这两部分合计的 **44.28%–45.68%**。这里不含阶段首尾未覆盖的零碎时间，也没有把 warmup 混进 measured。

每个 T 进程有 6×299=1,794 个 measured 内部间隔。沿用已经独立验证的校准区间，将原样本 `end` 到下一样本 `start` 与受支持事件逐个关联：

| 进程 | 全部间隔 ms | 有 GC 重叠的间隔数 | 这些完整间隔合计 ms | 无受支持事件重叠或边界不确定的间隔合计 ms |
|---|---:|---:|---:|---:|
| 02-T-U | 449.25 | 68 | 58.73 | 390.51 |
| 05-T-V | 408.23 | 65 | 50.63 | 357.59 |
| 06-T-V | 418.65 | 65 | 50.31 | 368.35 |
| 09-T-U | 418.89 | 68 | 55.44 | 363.45 |

最后一列占全部间隔时间 **86.77%–87.98%**。这些值是整个混合间隔的时间，**不是 GC 暂停时长或可扣除成本**；未把事件 duration 相加。未知或未记录的 VM/系统活动仍可能存在，不能据此宣称间隔只剩 cleanup。

以同为 T-U 的两次记录为例，间隔相差约 30.36 ms，其中无受支持事件重叠/边界不确定的间隔相差约 27.06 ms。仅拿 GC 重叠来解释整个间隔差异缺乏证据。Python 分类与既有 JS `relation` 对四个进程全部 **9,552 个 warmup/measured 内部间隔**的关联结果相同。

## 对应的实际调用路径

计时窗口内是 `makeArm → measurementArm → graphArm`，包含构造、启动和连接。冻结 `position.mjs` 的计时窗口外依次有：

```text
memoryAfter → record（保存在 samples 并 JSON/appendFileSync）
→ cleanup → 下一轮 setImmediate → memoryBefore → 下一次构造 start
```

冻结 worker 的 `graphArm.cleanup`（9838–9843 行）为：

```js
disconnect();
for (const root of owner.roots) root.unsubscribe?.();
const group = graph.topologyGroup();
for (const n of graph.describe().nodes) group.add(graph.find(n.id));
group.release();
```

它每次都物化完整 describe 节点/边快照，只为枚举待释放节点；`group.add` 还以数组 `includes` 去重。更明确的热点在 [当前 `_releaseNodes`](../../../packages/ts/src/graph/graph.ts#L340)，冻结 worker 7473–7545 行保留同一流程：

```js
for (const { node, entry } of entries) {
  // quiescence check
  let internalSubscribers = 0;
  for (const { node: dependent } of entries) {
    if (dependent === node || !isNodeActiveForRelease(dependent)) continue;
    for (const dep of dependent.deps) {
      if (dep === node) internalSubscribers += 1;
    }
  }
  // subscriberCount <= internalSubscribers check
}
```

预检中 candidate/reference 均为 60 个节点；原 reference 冷构造路径释放这整套节点。**按该固定 60 节点路径静态计算**，每次 cleanup 需要 60×59=3,540 次 active 配对检查；2,400 个样本对应 8,496,000 次。另有每次 group.add 的至多 1,770 次已有成员比较。它们不是本轮新增的 runtime counter，也没有换算成独占毫秒数。

这些检查保护外部依赖、quiescence 和活跃订阅不变量，不能直接删除。后续可评估“一次遍历活跃内部依赖，统计每个被释放节点的内部订阅数”，但必须保留释放前全部拒绝条件与失败原子性；这里没有采用或实现该改法。

## 本轮完成与下一步边界

定位进度从“整体构造/主机波动”推进到：

1. 间隔是总采样时间的显著部分，且多数间隔时间没有受支持事件重叠。
2. 间隔内存在明确的完整 describe 和二次 release 校验路径；有实际代码与固定规模，而非 registry 名称猜测。
3. **尚缺每个间隔子步骤的计时和因果对照。** 现有 CPU 粒度不能区分 memoryUsage、record、cleanup、让出或其他活动，也不能从间隔成本直接推导冷构造 p95 的回归。

推荐下一次只检验这个具体假设：将原间隔的 memory/record/cleanup/yield 分开观察，重点核实 describe、group membership 与 release subscriber 扫描。保留原 B、所有 cleanup 不变量、输入和性能门槛，分别暴露新增观测成本；若需要新采集，先给出单独的次数/时间预算。本轮不自动执行这一步。

本轮是 `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS` 的同一 work 下保留数据调查，不新增 D# 或执行授权，不改变 D168/D169、原控制失败、M not-run 或性能资格。

## 复算

原始材料在 [既有 archive](../../../archive/evals/causal-cpu-wall-diagnostic-v1/README.md)。解压到新目录后，以下命令只读保留数据：

```sh
python3 -B docs/design/causal-cpu-wall-retained-localization-v1/analyze.py /path/to/run
node docs/design/causal-cpu-wall-retained-localization-v1/verify.mjs /path/to/run
```

[analysis.json](analysis.json) 保存逐阶段原值及非 disjoint 的间隔关系；[verification.json](verification.json) 保存跨语言逐关系复算结果。[receipt.json](receipt.json)绑定原始 index、分析脚本和结果。原始事件与样本没有删改，未对 native 文本日志强行套用结构化时钟。用户理解、分级入口易用性和实际 effect 授权仍未由此证明。
