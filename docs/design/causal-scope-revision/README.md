# 范围修订：旗舰保持私有，先修真实跨入口缺陷

2026-09-14；检查基线 `493e61be`。用户批准本轮修订、可复用能力审查与打包最小复现，
没有批准新增公共API、展示端口或全包构建改造。本轮只改设计/证据文件，业务实现未改。
本稿替代上一份未批准的公共入口提案；旧D160/D161/D162/D170仍有效，未产生新的owner决定。

## 结论与实际下一步

**spending-alerts保持旗舰私有；不公开它的solution/testing路径，不增加预期实例检查器，
不增加第六个展示端口。** 分层继续通过传递原view/capabilities实现，不裁减runtime依赖。

实际打包复现找到了一个独立于旗舰的现有问题：**CommonJS跨公共入口使用batch，会失去
本例的批处理合并效果，向下游发布中间值。** ESM的同样用法正常。下一批应针对这个确定
的缺陷做有限修复与回归；尚无证据需要把整个包所有产物改成上一稿建议的布局。

## 1. 能力审查：必要性与入口

| 能力/用途 | 实际使用与现有入口 | 结论 |
|---|---|---|
| occurrence/request/admission/outcome关联 | causal-occurrence/lifecycle.ts及focused-host进行精确请求关联；错配不得结算/执行 | 必需业务正确性，保留；它不是新增组件路由identity |
| identity/execution/retained原能力分传 | spending preset构造、frameworkExample、graded demo；reference/性能fixtures属于同一consumer | 私有已够用；没有第二个独立业务consumer证明公开通用能力API必要 |
| 额外expected-object检查 | 当前固定装配直接传原handle；未发现接受任意外来子capability并需核实预期实例的业务入口 | 不新增；同一consumer三个角色不算三个独立需求 |
| 普通值观察 | `/adapters`已有subscribeNodeValues/readableStore/externalStore/recordReadableStore；Node.subscribe公开 | 不新增spending公共observer |
| 五端口失效显示 | 私有mountSpendingView在ERROR/INVALIDATE清旧值；subscribeNodeValues当前只对ERROR调用onError，忽略INVALIDATE | 现有adapter不是drop-in替代。保留私有wrapper，不为“复用”丢掉缺失事实语义 |
| 维护者下钻 | 原Graph.describe/topology/observe、原节点和owner诊断 | 现有入口足够，暂无新增public inspection需求 |
| 生命周期展示 | startup、业务quiescence和inspect.normalEndReady不是同一件事 | 当前五端口不假称整次结束；没有实际展示需求前不增加graphEndEligible |
| spending领域本身 | 固定交易统计、spending-oracle-v2、append-alert、fixture-observations和OfflineAlertResource | 特定旗舰组成部分；不因放在“solution”目录就自动成为成熟公共方案 |

审查覆盖packages/ts/src、examples与scripts中的实际符号引用，排除测试/派生构建物后没有
找到第二个独立业务consumer；这是当前仓库范围内结论，不宣称未来无法复用。
`causalComposition(...).composeFull`内部入口同样不等于已存在第二个消费者或公共导出。
保留现有issued表，不因暂停新的检查器顺便删除旧构造lineage校验；这种删除需要单独证据。

参考源码：
- [原capabilities](../../../packages/ts/src/solutions/causal-occurrence/capabilities.ts)
- [生命周期关联](../../../packages/ts/src/solutions/causal-occurrence/lifecycle.ts)
- [宿主guard与收尾](../../../examples/spending-alerts/causal-focused-host.ts)
- [现有公共adapter](../../../packages/ts/src/adapters/store.ts)
- [私有值绑定](../../../examples/spending-alerts/causal-view-binding.ts)

## 2. 真实构建产物最小复现

重新运行现有build-local-untrusted-js-runner + tsup，成功后把实际dist及package.json复制到
临时 `node_modules/@graphrefly/ts`，分别启动纯ESM、纯CommonJS进程，通过真正的package
export路径加载。没有生成未来spending公开入口，没有混ESM/CJS，也没有混安装副本。

两个source初值1、2。derived计算和；清掉初始观察后，在一个batch内依次写10、20。
已有batch实现说明是延迟settle、共享下游只在提交后重算一次，因此预期只有 `[30]`。

| 格式 / 来源 | 实际输出 | 本例结果 |
|---|---|---|
| ESM：root Graph + root batch（控制） | [30] | 正常 |
| ESM：/graph Graph + /core batch | [30] | 正常 |
| ESM：root Graph + /core batch | [30] | 正常 |
| CJS：root Graph + root batch（控制） | [30] | 正常 |
| CJS：/graph Graph + /core batch | [12,30] | 不符合；中间值泄漏 |
| CJS：root Graph + /core batch | [12,30] | 不符合；中间值泄漏 |

ESM的root和/graph导出同一Graph构造器，root和/core导出同一batch函数；CJS两者均不同。
结合控制/交叉行为，问题与多入口CJS打包产生各自batch模块上下文一致。只读批处理源码
[batch.ts](../../../packages/ts/src/batch/batch.ts)声明同一个batch的settle合并意图。
这不是“函数引用不等所以有bug”的推断：可见中间值是直接的行为反例。

**范围限制：**该证据直接验证batch上下文，不直接验证私有issued或graphRegistrations失配；
它们仍是相似机制下需确认的风险，不能把所有注册表一律宣布损坏。也不代表所有CJS用法
失效；本例同root控制正常。没有测性能，没有证明全包模块保留是最小或最优修复。

- [可复跑脚本](reproduce.mjs)：临时安装布局使用后自动清理，源码/包不写入。
- [精确结果与全部JS产物哈希](result.json)：probeCompleted不等于consumer通过，两个CJS跨入口结果明确false。
- [构建日志](build.log)：固定DONE exit，未跑新的全量业务测试。
- [现有export smoke](export-smoke.log)：检查是否覆盖组合行为，不能取代上述反例。

复跑：仓库根目录执行 `node docs/design/causal-scope-revision/reproduce.mjs`。
它使用当前dist并覆盖本目录result.json，所以历史复核应先checkout本commit或写到独立工作区，
不要用新产物覆盖后仍当作本次历史证据。脚本自身退出0表示诊断成功完成，不表示所有case通过。

## 3. 修复应如何限界（建议，未实施）

目标是：同一安装副本、同格式中，公开Graph与/core batch组合保持原批处理语义。
控制同root/ESM路径不回退；增加实际安装包组合回归，不能只增加源码单入口测试。

先围绕CJS共享batch及它依赖的wave/boundary上下文评估最小产物共享方案。不能仅共享
一个activeBatch变量就假定boundary协作、rollback等已经正确；需追踪实际依赖闭包。
不新增globalThis/Symbol.for状态表、不重新设计runtime注册，不默认选择全包模块迁移。
修复候选需验证commit/rollback、嵌套batch、错误路径和跨入口组合，并检查导出/打包与冷加载
实际增量。若证明最小修复仍涉及更广构建契约，再给出具体范围与成本，不用假设提前扩大。

本轮没有修复此缺陷；旧机器QA通过依然只是当时实际测试范围的结论。新反例会成为后续
打包验收的缺口，不能因为既有export smoke绿灯而忽略。

## 4. 设计一致性与证据状态

Q5：保留consumer专用代码，通用基础问题只在实际出现的batch构建边界处理。
Q6：拒绝没有消费者的公共承诺，避免维护额外identity与终态概念；CJS问题保留为明确缺陷。
Q7：继续原Graph/原handle/原依赖，普通UI清理不结算义务，不新增表和转发Node。
Q8：A立即公开旗舰并全包改构建，范围无充分依据；B保持私有、复现真实问题后限界修复。
Q9：推荐B。复用与渐进披露已可继续通过私有组合验证，公共API不应成为证明它们的前置。

B121、真实宿主、匹配plain/human研究、正式性能资格状态不变。上一稿关于第五构建项的
设计审查通过只是方案自洽，不构成用户批准或必要性证明；已显著标记撤回，历史原稿在493e61be。

本轮检查由独立host_acceptance完成可复用消费者审查；打包复现由主agent执行，独立复核
脚本与结论后记录于receipt。没有宣称新的正式人类验收或跨runtime conformance完成。
