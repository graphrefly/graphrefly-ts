# 统一计划的离线验收核对

批准入口：`../causal-completion-integrated-plan.md`；当前代码基线 `bd425208`。
这是 TS 原工作下的证据核对，不新增决定、授权或第二套 sequencer。

## 本轮补齐

- 真实 host 已获准但尚未调用资源：stop、撤销 grant、grant 过期、删除 verifier receipt
  都必须零写入，并把精确 known-no-submit 返回原 authority。
- 真实资源已被调用：撤销与 UI 退订不清理未结记录；实际 completion 到达后才能结算。
- source.down 完成当前 wave、但 host 仍在通知期间，第二个真实资源调用同步 throw：
  保留 unknown，恰好再发一个包含前后两个结果的完整快照，不递归或不断通知。
  测试只在真实 down 返回处插入输入，没有注入伪造 outcome。

以上在 off/summary 下共12项新测试通过，原40项 focused回归同时通过，总计52项。
测试类型检查通过；独立审查确认这关闭了原计划§5.2、§5.5和§8的覆盖缺口。
本轮没有修改产品源码；此前全量2626/4skip与build/export、完整lint收据仍保留在
`../causal-construction-closeout/`，不是本轮重跑的全量结果。

## 一次看清验收与范围

| 原计划项 | 当前证据 | 结论和限制 |
|---|---|---|
| 输入→原 authority→exact host→结果 source | causal-focused-host.ts；host17项及failure12项 | 私有离线链已接通，只有写资源模拟 |
| 同拓扑算法修改、独立证据 | construction-closeout/source-binding.json | source/runtime旧绑定3负例零写；等价编辑通过oracle，不推广成任意算法等价 |
| fan-out/fan-in、正常不发布、缺失/冲突输入 | spending-alerts-causal-publication/preset测试与host行为测试；先前全量日志 | 下层行为证据与集成测试分别保留 |
| replay、错admission/outcome、UI detach | construction-closeout/mutations.json；host行为测试 | 9正常controls通过、9真实源码mutants被杀死 |
| stop/revoke/currentness与通知重入 | 本轮authorization12项；failure晚期policy/watermark3项 | 覆盖实际最终边界与原authority，不仅preadmission判定 |
| 生命周期、容量和失败 | failure12项；本轮64次顺序lifetimes | 顺序64成功且可正常结束；同批64原pending过载仍不能正常结束，不改预算 |
| 普通用户 / framework / maintainer | audience4项、construction7项；causal-audience.examples.ts类型正负例 | 原view、原capability、原图；无新公共export，无用户易用性实测结论 |
| cold/factory与reconnect | construction-closeout/performance.json | 同拓扑自动/手工及同代码负对照；未建立稳定封装额外成本 |
| 运行期成本、内存和帧大小 | 本目录receipt.json | 有限64记录增长轨迹、分离GC测量，原始数据完整；不是stationary稳态或allocation attribution |
| human/agent证据包 | 三轮README、当前核对与exact source/receipt哈希 | 可阅读、可复核；作者provenance仍标工具合成agent，不是假人类试验 |
| 回归与打包 | construction-closeout完整日志；本轮52focused、类型和scoped lint | 产品源码没变，沿用仍适用的全量/build证据 |

## 性能判断与后续边界

私有有限 consumer 的当前行为证据齐备，且不会因为 UI 退订而丢失生命周期责任。
但不能将统一计划所有性能验收写成合格：原冻结1.20/1.10资格没有通过，D169仍是
method-not-qualified；allocation归因与稳定稳态测量也没有被本轮post-GC数字替代。

这次64记录轨迹足以明确风险所在：共享执行链的处理成本随历史增长，自动与手工装配一致。
前8次约5ms，末8次约49–51ms；本次所有操作的input+completion观察值低于100ms，
只覆盖小prefix、两个vendor、模拟即时结果、有限64记录，不能作为端到端100ms承诺。
不继续重复同一构造对照，也不自动重跑失格的正式矩阵。后续若继续优化，应针对共享历史
处理，而不是改回多个registry、减少保留证据或削弱最后授权检查。

公共创建入口发布、真实inbox资格、B121人类/agent理解度试验仍是范围外的后续工作。
全工作保持未完成，本核对不改owner ledger状态。下一项实质工作应集中审阅真实consumer
的展示与人类核实路径，或先确定正式性能方法的适用性；这两者不能由当前离线通过自动启动。

## 建议审阅顺序

1. 本目录 README.md 的性能/内存表，先理解共享成本和测量限制。
2. `packages/ts/src/__tests__/causal-focused-host-authorization.test.ts`：执行前撤销与执行后责任。
3. `examples/spending-alerts/causal-focused-host.ts`：原最终guard、保留结果、完整快照通知。
4. `receipt.json` 的原始frontier记录；`verification.json` 的独立重算和绑定检查。

编译溯源限制：本次lifetime工具保留脚本与56个源依赖的hash，但未保留或hash临时执行bundle；
因此它不是独立可重放的二进制归档。这不改变此前source-binding工具的另一份实现绑定证据。
