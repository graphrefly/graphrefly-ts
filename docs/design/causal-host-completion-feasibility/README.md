# Host completion通知机制：有限验证通过

2026-09-13，基线d9959578。用户批准具体microtask通知/64记录方向后进行的no-I/O探针。
同一TS owner工作上下文；本报告是实现探索证据，不是D160 owner ledger修订或生产实施资格。
未改library、wave、公共API，未打开文件或执行真实host请求。

## 运行结果

真实Graph、dispatcher、source与microtask完成9项新测试，加之前4项机制探针，共13通过。
新增测试位于 packages/ts/src/__tests__/causal-host-completion-feasibility.test.ts。
测试局部实现了有限host记录/通知模型；没有生产authority、request digest/epoch或实际写入。
固定9项：

1. 嵌套batch提交后，保留两条记录；同步阶段尚无输出，下一microtask完整交付一次冻结snapshot。
2. rollback输入不产生host记录/通知。
3. UI全部观察退订后仍通知；重连收到完整snapshot；重复不调度，冲突不覆盖首结果。
4. 交付中产生两个新completion，仅追加一次通知；得到[1]、[1,2,3]两个snapshot。
5. 64记录满后拒绝第65个reservation；完成后不回收身份；无reservation的结果被拒绝。
6. 真实source subscriber抛错时，host标faulted，保留receipt，拒绝新reservation，不自动重试。
7. 消费节点最终RESUME后触发结果，无需source wrapper或调用者flush。
8. 测试专用scheduler故障注入：先保留receipt，安排失败后faulted，无自动重试。
9. 较晚到达的fake异步成功结果走同一microtask路径，交付前不可见。

测试fixture的scheduler参数仅用于故障注入，不是公共可配置scheduler。其余场景使用真实
queueMicrotask。cleanup发生在通知耗尽后，不表示已经实现生产shutdown/drain。
一次通知最多完整64条结果；本轮未量测wall-clock延迟、真实receipt字节或正式性能。
通知次数/记录数断言是机制计数，不是吞吐/内存成本结论。

## 首轮失败及修正

首轮7测试中1失败：测试对无依赖source发PAUSE后预期停止产生DATA，但现有source语义
允许自身生产，因而产生了1条记录。将PAUSE/RESUME应用于消费guard后符合所测
“消费暂停后恢复”场景；没有修改runtime或原pause语义。最终补齐调度故障/异步结果共9项。

## 结论边界

两个先前候选已被反例排除；本次机制在所测来源与错误路径上成立，因此可以停止继续寻找
替代的基本通知方式。它尚未证明以下生产集成条件：

- 真实full occurrence/request/admission/host epoch关联，实际authority从active到终态；
- 64个host记录配额在admission之前保证，尤其同batch多个候选不能透支旧readiness；
- dispatch与源绑定、同步throw的no-submit证明、unknown结果、每条4KiB边界；
- 生产source故障如何由应用owner观察并阻断图上的新admission；
- 已提交write、待交付结果与正常应用结束责任；
- 真实runtime mutation、三类用户集成及成本资格。

模型中的reserve在fake guard里调用，不是上述“admission之前预留”的证明。
模型中的faulted阻止本地reserve，不是生产graph已具有fault/readiness事实链的证明。
成功source.down仅意味着交付返回；测试没有把它当authority接纳ack，也没有删除records。

下一项具体设计应解决**admission前配额与真实authority集成**，复用此次通知机制；
先固定一个请求从配额、admission、host消费、结果回送到结算的完整路径，再批准有限实现。
不用为了这一步扩大公共API或重新运行完整性能诊断。D160局部修订仍需按唯一owner ledger
正式落账后才能把测试内模型升成生产source能力；本批没有自动创建D#或改完成状态。

验证命令：

```sh
node node_modules/vitest/vitest.mjs run --root packages/ts \
  causal-host-completion-feasibility.test.ts \
  causal-ingress-owner-feasibility.test.ts causal-quiet-outcome-feasibility.test.ts
node node_modules/typescript/bin/tsc --noEmit -p packages/ts/tsconfig.tests.json
```

上述13测试与test typecheck通过；新增文件Biome通过。仅测试/文档变更，未重跑build、
全量library测试或正式性能矩阵。采用本地三种QA视角检查测试边界，不宣称独立review。
