# 分层使用入口实施与验收

基线 `6a5eb7e4`。用户批准[完整方案](../causal-layered-use-plan/README.md)后，本批完成 package 入口指引、私有旗舰角色路径与对应离线验收。唯一 owner 为 graphrefly-ts；批准记录见 approval.json。

## 已完成的行为

- 按任务说明现有 core/graph/patterns/solutions/adapters 入口；不增加公开符号，不推广 private spending 为公共 solution。
- 一个 Graph 中创建 A/B 两个完整实例，组件接收原 view，框架分传原 capability，维护者检查同一图。
- A 请求未回时退出界面；B 成功后 A 仍有1个 pending。A 在退出期间完成，重连后各实例写入仍各1次。
- 初始缺事实、admitted-no-outcome、最终成功均保留实际展示值；发布关联到实际 authority、request/admission/outcome 与 fixture verifier 引用。
- 配置和观察不新增节点；展示退出不清记录；ready 与生命周期结束明确分开。

本批产品文件范围为2份README、1个原demo和1个既有测试文件（新增1项组合路径测试）。library runtime、host、authority、公共 exports 与协议均未改。A/B示例运行两个完整实例是演示本身的工作量，不是新增分层运行开销；没有进行新性能测量。

## 执行证据

| 检查 | 实际结果 |
|---|---|
| 最终 full TS offline suite | 2670 passed / 4 skipped；160通过文件、1跳过；tests.log exit0 |
| Build | build-local-untrusted-js-runner + tsup exit0；仅编译未变的library源码 |
| Installed package exports | ESM/CJS/DTS与64项跨入口batch行为通过；exports.log exit0 |
| Lint/layers/types | causal lint evidence、Biome、raw-async、package/example typecheck、test tsc通过；lint.log exit0，最终示例修改后final-types.log exit0 |
| 实际示例命令 | node --import tsx examples/spending-alerts/causal-graded-demo.ts；demo.log exit0；demo.json为完整输出，经JSON格式化保存 |
| 历史artifact integrity | exit0；明确 currentQualified=false，不重签旧性能或源码资格 |
| 文档与范围 | 本地链接、精确inline package subpaths、无新public路径、无library runtime改动；docs-check.log |

初轮全量测试已通过，QA随后补上初始/等待画面的输出与断言；最终代码冻结后重新完成全量测试。tests-initial.log仅保存初轮轨迹，不代替最终结果。既有失败原子性、错Graph/epoch/outcome、失效、退订测试由全量套件复用；未复制一套相同测试，未声称本轮重跑未变authority的runtime mutations。

## QA与修复

独立blind阅读发现接入说明漏了64条record上限、单in-flight、busy不排队/重试以及unknown阻止正常收尾，已补文档。独立edge检查确认A/B分离、清理、原引用/拓扑和证据非主张，无额外问题。独立verification-gap检查提出两项修复：保留初始/等待实际展示；localAuthority应写grants/tick/stop而非evaluation currentness。两项已修复并由reviewer确认关闭。

没有未解决的本批QA发现。机器通过不代表人类使用体验验收，不代表完整plain-host比较或B121完成。普通panel仍用已有五端口，无第六端口、轮询、额外identity检查器或registry。正式性能条件、真实inbox资格和root汇总状态保持原状。

## 建议审阅顺序

1. [入口指引](../../../packages/ts/README.md#choose-an-entry-by-task)：先按任务选入口，不强制依次学习各层。
2. [完整接入说明](../../../examples/spending-alerts/README.md#private-causal-integration)：明确输入来源、角色和执行界限；命令可直接运行。
3. [实际应用](../../../examples/spending-alerts/causal-graded-demo.ts)：从runGradedSpendingDemo进入，观察A等待→B成功→A退订完成→重连，并查看同一Graph。
4. [组合回归](../../../packages/ts/src/__tests__/causal-graded-entry.test.ts)：末尾新用例执行整个示例；前面的既有构造/identity用例继续有效。

查看demo.json的ordinary字段可读三个画面；composition字段显示aPendingAfterB=1、bSucceededWhileAPending=succeeded、writes={a:1,b:1}；evidenceNavigation来自真实运行对象。完整topology较大，放在maintainer字段供按需检查，不用它代替普通路径。

证据中fixture source/runtime digest不认证本次加载源码。historicalSourceExperiment指向另一已存实验，不能用于当前A/B运行的变更者归因或“后果不变”判断。普通显示不标整次运行结束；最后roots释放是示例强制清理，不是生产终态证明。
