# D170 私有 consumer 集成交付与证据

2026-09-13（本地日期）。批准基线 9350d4a5。TS owner；新架构 D170 只局部修订 D160 的
focused host 交付责任。统一计划见 ../causal-completion-integrated-plan.md。

## 结果

实际 spending graph、原单 authority 与私有 offline host 已接通。普通 view、原 capabilities、
完整冷构造和保留职责继续共用一个实例。没有公共 export、wave 修改、provider/live/spend，
没有真实告警文件 I/O。OfflineAlertResource 明确表示模拟资源；不能改个 evidenceMode 标签
冒充合格真实 inbox。真实 inbox 指将获准告警追加到指定本地收件文件，不是电子邮件。

B139 的 consumer 选择与 B121 的人类/agent 理解和核实目标保持区分。本批不完成 B121，
不发布普通用户公共创建入口，也不更改 D169 的 method-not-qualified 状态。

## 可一次阅读的审阅顺序

1. examples/spending-alerts/causal-focused-host.ts::composeOfflineSpending：一次冷装配、一次移交；
   应用持有 owner，UI 仅消费 consume.view。OfflineAlertResource 自有单次 lease 状态，
   不使用共享 WeakMap、动态 permit 或第二个业务 authority。
2. 同文件 hostGuard：声明依赖为真实 committed effects、retained material、checked current /
   verification / local / inbox 与固定 pack。精确 join 不能由展示字符串替代；拒绝旧 policyRef、
   watermark、grant、source/runtime、epoch。记录先保留，slot 同步检查，忙时不排队或重试。
3. 同文件 schedule/complete：先保留精确结果，再唯一 microtask 完整通知；错配 outcome
   不能结算。调度/交付失败阻断新调用，未知写入不伪造未提交。runEndReady 对全 pack frontier
   核对原 quiescence，并额外阻止 unknown/reconcile-required，不能只看 active=0。
4. 两个 causal-focused-host*.test.ts：真实 consumer、真实 Graph、真实 authority，只有资源
   调用是假的；33 个 focused 测试含原 audience4 项。forced test teardown 不是正常结束证明。
5. mutations.json、source-binding.json、performance.json：分别回答保护能否抓错、实现变更如何
   绑定证据、增加 host 的可观测成本；三者不能互相替代。

## 容量与故障结果

| 场景 | 实际观察 |
|---|---|
| 两个 domain、同 batch 同 ready=1 | 两个 admitted；一个模拟 write，另一个 exact busy cancellation |
| 顺序64项、固定pack、两个vendor | 64 writes、64 retained成功记录；stop且最终frontier齐全后 normalEndReady=true |
| 同批64项、192个分支 | host64记录与结果保留；原 pending64 报 terminal-pending-bound，正常结束=false |
| 第65项 | 输入pack/不可变pack边界拒绝，不回收已完成host记录去执行它 |
| UI退订/重订阅 | 原运行实例继续承担义务和保留结果 |
| source调度/交付失败 | fault、无新执行、保留记录；通知失败时 authority 仍可未结 |
| throw/reject/短写/null/getter返回 | unknown 保留；结果存在不意味着可正常结束 |
| 未到达normal occurrence或缺watermark domain | 原完整pack frontier使正常结束保持false |
| guard丢依赖、晚期注册失败 | 阻断执行；冷构造失败清理原有本次节点，保留原始诊断 |

64是epoch lifetime容量，不能推出原pending64可以同时缓存192个分支。本批没有放宽这条
原批准上限。完整批次过载是可解释的失败结果，不是正常结束，也未被统计成成功生命周期。

## 机器审查与修复

独立 blind/edge/verification-gap 三种审查已执行。修复并回归：最后guard watermark方向和
policyRef遗漏；所有冷分配覆盖同一abort边界、避免二次abort掩盖原始原因；旧lease不能
影响后续claim；恶意/异常返回字段不能抛出无收据的异步异常；调度失败不能继续调用write；
正常结束必须覆盖尚未到达或超过旧watermark的完整pack frontier。

验证审查指出的薄弱断言也已补齐：重放不仅检查write次数，还检查不能误取消原义务；
实际mutations包括authority匹配被删后注入counterfeit，以及UI退订时清host记录的错误实现。

## 运行与收据

- 全量默认TS离线套件：2619 passed / 4 skipped，156个文件通过、1个文件按既有配置跳过。
  不是新跑历史root-soak；本批没有修改其历史源码/冻结方法，既有历史收据不改写。
- 新host两文件29项 + audience4项 = focused33通过；测试类型检查、源码/示例类型检查通过。
- 完整lint通过，保留20条既有 useTemplate info；build/export检查通过。
- D159历史artifact完整性通过；它明确 currentQualified=false，未冒充当前资格。
- root workspace authority/dashboard通过；它们指向主checkout。owner-check.json 另以保持原
  locator相对路径的临时symlink family核实本隔离checkout：0 errors / 0 warnings。
- 9个真实源码mutants各有独立正常control，9个均由行为断言杀死：guard、slot、replay、
  completion保留、错误结果关联、counterfeit被错误接纳、UI退订清记录、结果配额过小、
  65项pack被错误接纳。最后一项检验前置容量门，不谎称单独移除host冗余64检查就会导致65项。
  overflow是隔离进程输入拒绝探针，不声称该错误输入图已经正常结束。
- 等价vendorStats实现修改：实际transformed source closure与执行bundle分别hash；节点ID、
  factory和边相同；旧source/旧runtime/两者旧三种receipt均0write；新独立oracle收据通过，
  payload与plain-code oracle一致。作者provenance标记为qualification tool的合成agent修改，
  不把它称成人工修改或推广成所有算法替换都等价。

复跑（仓库根目录）：

```sh
node node_modules/vitest/vitest.mjs run --root packages/ts causal-focused-host.test.ts causal-focused-host-failures.test.ts spending-alerts-audience.test.ts
node scripts/qualify-spending-focused-host.mjs
node scripts/qualify-spending-host-source-binding.mjs
node scripts/measure-spending-focused-host.mjs
```

## 性能结果与证据范围

最终硬化后的有限诊断：off/summary × size1/8，每cell每arm5 warmup +20 measured；
数字不是正式CSP11矩阵或约100ms资格。最终size8 first-input均值：off direct12.513ms /
 host18.537ms；summary direct11.735ms / host17.330ms。新增host完整检查与结果通知有可测成本，
不能说免费。独立64-result帧为51,305bytes，3次通知；不是进程RSS或整个运行的内存上限。

直接旧preset没有host，两个arm的topology不同：这是整个执行集成的增量，不是相同topology
下的薄factory开销证明。当前只实现私有完整constructor，没有发布新的薄公共facade；
统一计划中相同topology的公共创建封装比较仍不能由这份数字背书。正式performance qualification
和公共创建体验都保持未完成，不能把这一证据缺口隐藏成通过。

第一次size8数据准备错误（8vendor超既有2vendor限制）保留在 performance-attempt1.json。
修复fixture后的首次完整数值保留 performance-pre-final-hardening.json；最后资源身份硬化后
重跑的数据在performance.json。脚本沿用method revision的attempt2字段，实际执行以各自
startedAt及本段文件关系识别；未跨次拼接、平均或挑选最优。

## 尝试保留与边界

初次mutation工具曾因replay断言只看write次数而放过误取消、completion清表导致重建记录、
错配outcome用TypeError代替明确assert而拒绝资格；已修为独立状态断言。65项输入初次用
尚无完整上游事实的consumer issue投影作观测点，改为实际hostPackFacts的验证结果。它们是
测试工具修复，记录在会话工具输出；临时bundle当时已清理，不声称保留了那些失败bundle。
最终每个control/mutant的进程输出和bundle hash保留在mutations.json。

这是本次私有执行链的代码与离线证据交付，不是所有owner工作的complete收据。
CAUSAL-PRESET-ASSEMBLY-TS原canonical状态不提前推进；授权持续有效，没有新增审批点。
