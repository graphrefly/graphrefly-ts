# Quiet outcome 可行性结果：候选静态环路不成立

2026-09-13；基线0feab45b。用户授权本次有限 no-I/O 机制验证。
本报告收束 focused-inbox-review 中尚未验证的 quiet outcome 候选，不改旧提案字节。
唯一工作上下文仍为 graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS；不产生新决策或执行权限。

**结果：该候选在现有受支持的冷装配/rewire 路径上不可构造。**
`authority → guard → quiet receipt → authority` 是静态依赖环。
quiet/PULL 控制数据交付时机，不豁免依赖环校验。

## 实际验证

新增 packages/ts/src/__tests__/causal-quiet-outcome-feasibility.test.ts，使用真实 Graph、
ConstructionScope、dispatcher、replaceDeps 和 quiet/PULL；没有 mock substrate。
名为 authority/guard 的两个节点是最小结构探针，不是生产 causal authority 或 host。
这一层已经拒绝，因此没有必要假装已运行生产 guard 的取消流程。

| 探针 | 实际观察 |
|---|---|
| authority 先依赖 receipt，最后把 receipt 接到 guard | replaceDeps 拒绝 would create a cycle |
| receipt 先依赖 guard，最后把 authority 接到 receipt | 同样拒绝，改变接线顺序无效 |
| 两次拒绝后的 cold abort | ColdConstructionError；已获节点清理，原外部 input 的 describe 恢复；业务 fn 调用为0 |
| 无环 input→result→quiet receipt 与 controller | seal/transfer/start 成功；一次输入波中的1、2作为完整 frame在 PULL 后交付一次 |

源码定位：node/node-rewire-runtime.ts:209–217 对自依赖及传递可达环明确拒绝；
Ctx.upNext 的 committed-boundary 能力不改变该检查。
未通过内部数组修改、私有字段写入、临时取消校验或任意 callback 绕过注册路径。

测试命令：

```sh
node node_modules/vitest/vitest.mjs run --root packages/ts \
  causal-quiet-outcome-feasibility.test.ts pull.test.ts patterns-admission-handoff.test.ts
node node_modules/typescript/bin/tsc --noEmit -p packages/ts/tsconfig.tests.json
```

3个新探针 + 11个 pull + 13个 admission-handoff 测试，合计27通过。
测试通过表示观察符合不变量，不表示所提 inbox 路径成功；正对照仅证明无环机制可工作。
测试文件 Biome 和 test typecheck 通过。没有改 library 源码；不为这个测试/文档改动重跑
全量性能诊断、build、正式矩阵或真实 host。

## 停止点与未测项

第一项“可冷装配”不满足，所以未进入以下拟议路径验收：真实 authority active1→0、
同批多个 admitted 拒绝、错 epoch/payload、batch rollback、pause/resume、全部 UI 退订、
结果容量、异步结果未知、receipt ack、必需边 runtime mutation。
无环正对照中的两个整数不代表上述 exact outcome/容量/生命周期资格。
本次真实文件写入0；没有 host 资源准备，也没有由 fake completion 冒充的实际 I/O 证据。

## 下一步设计边界

先撤回“用同一静态图 quiet 环路回送”的候选，保留现有 C、D160 单一 authority、完整
生命周期与 current-at-dispatch。不能把此次限制归因于性能，也不需要优化 dispatcher。

接下来应重新审查 **I/O前拒绝究竟由哪个 owner 在哪个合法边界产生终态**：

- 若保持独立 focused host 回送，必须指出真实外部执行/source 边界如何同时满足最终当前性
  检查与合法结果交付。仅换 async pool、人工 microtask 或排队后沿用旧 guard 不成立。
- 若调整 guard/终态责任的位置，必须显式审阅它对 D160 committed handoff、已 admitted
  obligation 和取消证据来源的影响；不能在实现中把取消判断移入另一张旁路表。
- 不以新 wave 消息、DATA-up、允许静态环或通用 boundary task 作为默认修复。若方案确实
  需要协议变化，先说明必要性并走 spec-amend，不用一个 consumer 需求暗改 kernel。

这是一个已证实的方案限制，尚不是已选定的新架构。下一份设计需要给出可构造的图、
严格的同步/外部边界和终态 owner，再进入有限验证；本次不自动开始真实 host 实施。
