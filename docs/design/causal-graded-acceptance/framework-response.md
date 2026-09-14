Framework 角色：**部分完成**。已完成只读装配推导和边界检查；未实际构造或执行两个实例，不能记为代码构造通过。阅读顺序 P→G→M。以下路径均相对 `/Users/davidchenallio/src/graphrefly-ts-latency-review`。

**Q1 — supported：最小装配与传递**

调用模式如下；`graph`、`inputsA/B` 是应用已创建的实际输入，片段未执行：

```ts
const preset = spendingAlertsFor(graph, { name: "alerts-a" });
const a = preset.compose(inputsA);
const b = preset.compose(inputsB, { name: "alerts-b" });

const executionA = frameworkExample(graph, a.capabilities, {
  contract: "contract-v2",
  implementationRevision: "construction-v1",
  scope: "full",
  epoch: inputsA.inbox.resource.binding.compositionEpoch,
});
// 子系统接收 executionA；只需身份的子系统接收 executionA.identity。
```

每份 inputs 必须包含 evaluations 的 pack/arrivals/current、verification.receipts、localAuthority.facts 五个 Node，以及 inbox.resource。resource 需要有效 SpendingBinding 和异步模拟写回调；应用仍负责提供评估、当前性、水位、独立验证和本地许可事实。入口没有消除这些责任（`causal-entry.ts:14,48–73`；`causal-inputs.ts:106–114`；`causal-focused-host.ts:48–53`）。可运行的一实例集成见 `causal-graded-demo.ts:33–60,81–90`。

最小原能力可以是 `.identity`、`.execution` 或 `.retained`，不能复制或重造下层对象。当前验证函数要求完整能力，验证后才能把原子集向下传递（`capabilities.ts:22–43,67–89`）。

**Q2 — supported / unknown：创建、隔离与身份**

配置只冻结 name/diagnostics；compose 创建节点、claim resource、seal/transfer owner，然后 startConstruction、afterStart；首次 UI 订阅只是开始观察已有实例（`causal-entry.ts:35–58`；`causal-focused-host.ts:103–137`；`causal-view-binding.ts:16–51`）。

每次 host builder 都创建独立 records Map 和计数状态，每份 capability 都获独立 instance 身份（`causal-focused-host.ts:165–174`；`capabilities.ts:122–146`）。同一 OfflineAlertResource 转移后不能再次 claim（`causal-focused-host.ts:60–76`）；各实例按 README 要求使用不同名字、输入和 resource binding（README:35–37）。

跨 Graph、错误 epoch 和复制 full 对象会被 WeakMap/绑定校验拒绝；混接下层 lineage 也会拒绝（`capabilities.ts:72–89`）。**边界限制**：validator 没有 expected-instance 参数；同一 Graph、同一 binding 的另一份完整原能力本身可通过，不能将它当作“指定实例身份验证”。仅拿下层能力的接收方也没有这里展示的独立验证入口。

**unknown**：跨 Graph 输入 Node 的拒绝具体实现委托给 prepareConstruction；其实现不在允许材料内，因此未独立验证。全局跨进程 epoch 唯一性、不同 resource 对象使用相同 binding 的隔离保证也不能由 claim 的对象内布尔值证明。

**Q3 — supported：UI 退订不结束义务**

应用保留 owner，host 的 records、Promise 回调和 source 负责结果回流；UI detach 仅 unsubscribe（`causal-view-binding.ts:16–35`；`causal-focused-host.ts:218–235,454–488`）。保存的 demo 记录 detach 时一个 in-flight 请求、离线完成后记录仍保留（`demo.json:observations`）；这是既有证据，非我的运行结果。

正常结束要求完整 pack frontier、stop、所有 domain lifecycle/retainedEvidence 成立、无 pending、所有 effect rejected 或已获非 unknown/reconcile-required outcome；还要无 fault/in-flight/scheduled/delivering（`causal-focused-host.ts:520–543,570–571`）。startup started 或单次 succeeded 都不够。宿主 Promise 永不 settle 时，没有读到可替代 outcome 的完成路径。

**Q4 — supported / unknown：源码变化证据**

`source-binding.json:provenance` 记录 qualification tool 在 esbuild onLoad 内把 vendorStats 的 `map((t) => t.amount)` 改为解构参数，未修改生产源码。作者来源只能归于该工具记录；不是人类作者认证。

我直接比较 JSON：control/fresh topology 与 calls 相等，bundle inputs 中仅 causal-business.ts 的 hash 改变。source/runtime binding、request/proposal/admission 标识改变；旧 source 或 runtime receipt 对应 calls 为空，新 receipt 恢复一次模拟写（`source-binding.json:bundles,results.control,results.staleSource,results.staleRuntime,results.fresh`）。

vendorStats 影响 anomalyScore→thresholdGate→reasonFactors/alertMessage→assessment（`causal-business.ts:307–399`）。因此拓扑不变不等于实现不变；任意算法修改的输出和授权后果仍 **unknown**。此次材料只支持指定等价编辑与指定离线样本；普通 demo 自己明确不认证当前加载源码及修改作者（`demo.json:evidence`）。

**Q5 — supported / unknown：执行条件**

- 旧 receipt：host 精确匹配 source/runtime/input/policy/request/verifier/domain，且必须唯一 pass；保存的 stale 实验没有写入（`causal-focused-host.ts:385–440`；上述 JSON）。
- 错 admission：proposal 不匹配则跳过；错误 admissionRef 在最终检查中取消，不执行写回调（同文件:335–352,426–443）。
- 重放：records 按 canonical proposal 留存；已有记录跳过，不重新写；冲突 admission 会标记 fault（同文件:370–375）。不能推广到重启后或新 resource 的全局去重。
- 无告警：P 明确不创建 material/effect（`spending-preset-plain.ts:228–245`）；G 明确输出正常评估（`causal-business.ts:328–399`）。**unknown**：允许材料未包含 G 的 material-owner 实现，本次未把“正常评估”直接认定为完整无请求/正常结束证明。

**Q6 — supported / not-comparable**

G/M 可比较装配便利性：M 手动 prepare、claim、build、seal、transfer、start、afterStart，且共享同一 host builder（`spending-focused-host-direct.ts:34–81`）。它不是无 Graph 对照。

P 是独立状态机，有输入推送、effects/evidence/obligation snapshots；自身没有 Graph capability、资源 lease、异步 writer、UI subscription 或完整正常结束入口（`spending-preset-plain.ts:90–143,158,491–558`）。所以业务/保留状态可作有限对照，framework host/lifecycle 体验 **not-comparable**；没有补实现或删义务来制造等价。

实际摩擦：入口层无法回答能力身份和生命周期，首次必须展开 `capabilities.ts` 与 focused-host；两套 binding（CausalBinding 与 SpendingBinding）需显式对应；完整身份验证需先持有 full；示例仅演示一个实例；正常清理仍用 example 内部 owner roots/topologyGroup（`causal-graded-demo.ts:161–167`）。最低概念是原对象 lineage、Graph、composition/host epoch、被动事实与执行许可、owner、quiescence。

实际工具使用 **8 次 functions.exec，各含一次本地 exec_command**；无写文件、网络、provider、性能采样、demo 执行或测试执行。读过 protocol；P plain；G entry/audience/view-binding/capabilities/focused-host/preset/inputs/README/graded-demo/business；M direct；demo/source-binding/mutations 三份 JSON。一次大 JSON 输出截断，随后定向读取 source-binding 关键键恢复；mutations 仅作为允许的保存证据读取，未搜索测试期望源码。没有证明普遍性能、认知收益、真实 host 合格性或 B121 完整验收，也不替人类作接受决定。
