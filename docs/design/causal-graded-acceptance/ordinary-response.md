ordinary 角色走查：**部分完成**。已按 G→P→M 阅读，运行一次现有离线 demo，观察展示、退订期间完成与重连；未编写自己的组件、未执行双实例或反例实验。共 **9 次工具调用**，无源码写入、网络或性能采样。

方法异常须保留：读取许可集合中的 `causal-graded-demo.ts` 时看到了内嵌断言；整读 `mutations.json` 时看到了 stderr 中的测试期望。因此本样本不能声称“完全未暴露测试期望”，不应重试替换。后续判断区分实际运行、源码判断与既有证据。

1. **Q1 — supported：展示入口足够小，但集成成本确实存在。**

   在应用已创建实例的前提下，组件只需原始 `view`、渲染回调及保存退订函数：

   ```ts
   let detach = ordinarySpendingPanel(app.view, show);
   detach();
   detach = ordinarySpendingPanel(app.view, show);
   ```

   入口见 [ordinary-panel:5](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-ordinary-panel.ts:5)，退订实现见 [view-binding:32](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-view-binding.ts:32)。

   应用负责 Graph、五个真实输入 Node、独立验证事实、许可事实和 `OfflineAlertResource`；不是把普通业务数组直接交给 preset 即可运行。实际启动代码见 [graded-demo:33](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-graded-demo.ts:33)。README 已披露这些责任，并非完全隐藏，但普通展示入口本身不能让人估计启动模块的工作量。

2. **Q2 — supported / unknown：配置、运行创建和观察是三件事。**

   `spendingAlertsFor` 只验证并冻结配置；`compose` 调用完整 host 装配，claim resource、创建 startup 和内部节点、seal/transfer、调用 `startConstruction`。[entry:48](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-entry.ts:48)、[host:103](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-focused-host.ts:103)。

   首次 panel mount 创建五个订阅和局部最新值缓存，收集同步到达的数据后 render；不调用 compose 或 host startup。[view-binding:17](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-view-binding.ts:17)。本次未展开 Node 订阅底层，不能进一步保证订阅不会触发任何按需计算。

   不同实例需独立 names、inputs、resource bindings，这是 [README:35](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/README.md:35) 的明确要求。已 transfer 的同一 resource 不能再次 claim，源码明确抛错。[host:55](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-focused-host.ts:55)。**双实例完整隔离：unknown，本轮未构造验证；不能仅从 README 推导所有身份拒绝规则。**

3. **Q3 — supported：UI 退订不会接管或完成请求。**

   panel stop 仅解除五个订阅。host 持有 request/admission/outcome 记录和异步写回调；回调在 promise 完成后减少 inFlight 并记录 outcome。[host:464](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-focused-host.ts:464)。

   正常结束不仅是成功 outcome：还要求 local stop、pack frontier 覆盖、生命周期及 retained evidence 条件、没有 pending occurrence/effect、结果不是 unknown/reconcile-required；最终再检查无 fault、无 inFlight、无 scheduled/delivering。[host:520](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-focused-host.ts:520)、[host:570](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-focused-host.ts:570)。

   本次 demo 输出：`pendingAtDetach=1`、`retainedAfterDetach=1`、`completedWhileDetached="succeeded"`、`simulatedWrites=1`、`normalEndReady=true`。这是单次离线成功路径观察，不能证明真实 host 故障恢复。

4. **Q4 — supported / unknown：拓扑不变不能推出实现未变。**

   [source-binding.json](/Users/davidchenallio/src/graphrefly-ts-latency-review/docs/design/causal-graded-entry-implementation/source-binding.json) 的 `provenance` 报告：qualification tool 用 esbuild 内存转换，把 `map((t) => t.amount)` 改成 `map(({ amount }) => amount)`，没有修改生产源码。`bundles[].binding` 的 source/runtime digests 均变化。

   我比较了保存的 `results.control.topology` 与 `results.fresh.topology`：相等；两者 calls payload 相同，结果均 succeeded，但 request/admission/proposal 身份不同。可支持的是**该转换、该离线输入的保存证据**。实际工具操作者是谁、当前生产加载源码、任意算法修改的业务后果均 **unknown**。`provenance.actor` 是文件报告的来源声明，不是独立身份认证。

   阅读 `causal-business.ts` 的定位结果显示 vendorStats 进入 anomalyScore，后续 thresholdGate、reasonFactors、alertMessage、assessment；因此一般统计实现修改存在下游业务影响路径，但本次等价投影不能量化该影响。

5. **Q5 — supported / unknown：必须分别判定。**

   - **旧 receipt：**保存证据 `results.staleBoth/staleSource/staleRuntime` 均为 `calls=[]`、`records=0`；host 同时检查 occurrence、input/policy/source/runtime/request digests 和 verifier/numeric domain。[host:385](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-focused-host.ts:385)。不能把所有时间较早但仍完全匹配的 receipt 一概叫无效。
   - **错误 admission：**与 proposal 不匹配时跳过；错误 admission kind/hash 会进入 final-guard cancellation。[host:335](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-focused-host.ts:335)、[host:426](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-focused-host.ts:426)。这是源码支持，本轮未注入错误值。
   - **重放：**同 proposal 已有 record 则跳过，admission 冲突设置 fault。[host:370](/Users/davidchenallio/src/graphrefly-ts-latency-review/examples/spending-alerts/causal-focused-host.ts:370)。未证明跨进程持久去重。
   - **无告警：**P 明确在 `!result.flagged` 时保留 assessment 后跳过 material/effect 创建。[plain:228](/Users/davidchenallio/src/graphrefly-ts-latency-review/scripts/fixtures/spending-preset-plain.ts:228)。G 的 formatter 明确说明“未触发”不等于验证完成；G 的完整 no-alert 路径本轮未运行，**unknown**，不能以零发布推定完成。

6. **Q6 — not-comparable / supported：**

   G 与 M 都调用同一个 `buildOfflineSpendingHost`；M 显式执行 construction/lease/startup orchestration，适合比较创建入口和接线责任，不是无 Graph 对照。[direct:34](/Users/davidchenallio/src/graphrefly-ts-latency-review/scripts/fixtures/spending-focused-host-direct.ts:34)。

   P 提供 `push`、业务/证据/义务 snapshots，但所读完整 class 没有 panel subscribe/detach 接口、异步写执行器或与 G 相同的 normalEndReady host 边界。[plain:90](/Users/davidchenallio/src/graphrefly-ts-latency-review/scripts/fixtures/spending-preset-plain.ts:90)。因此本角色“展示＋退订时在途写＋重连”的端到端体验 **G/P not-comparable**。没有依据宣称 G 更省总代码、性能更好或一般认知收益。

最低概念是 view、render、detach、缺失值、逐端口最新值非原子快照。首次必要展开是为了知道 detach 的范围打开 `causal-view-binding.ts`；判断 pending outcome 则必须继续进入 host。实际最终展示仍是 `coverage, issues` 缺失，同时 publication succeeded；文案没有冒称验证成功，但普通读者不能从该显示判断运行结束，因为五端口没有 normalEndReady。

实际读取路径：protocol；上述 README、entry、ordinary-panel、view-binding、graded-demo、inputs、focused-host、preset、business；plain、direct；source-binding.json、mutations.json。运行障碍：无，已有离线 demo 可运行；源码读取 JSON 曾被输出截断，随后对 source-binding 做只读摘要。未读旧 reviews、其他 agent 回答或许可集外源码。
