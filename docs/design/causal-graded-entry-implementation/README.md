# 分层入口：实施与一次复核

2026-09-14。执行批准为用户对 `causal-graded-entry-integrated-review.md` 的“ok 同意，继续”；
实施基线 `761b2cc9`，沿用 D162/D170，由 graphrefly-ts 唯一 owner 负责。这是已有设计的
实现收据，不新增决定、不改变 B121/公共发布/性能资格状态。

从 [保存的审阅页](review.html) 开始。它展示本次执行产生的业务结果，并可展开原能力、
完整节点/依赖和源码证据。页面是静态观察，不是另一个正在执行的 Graph。

## 完成的使用链

- 应用作者准备四组责任来源，一次 `spendingAlertsFor(...).compose(...)` 创建完整实例。
- 普通组件只拿五端口 view；值级绑定处理 DATA/ERROR/INVALIDATE 与观察清理。
- 框架作者拿原 identity/execution/retained 引用；维护者检查原 Graph 与 owner。
- UI 退订后待完成义务继续保留；精确结果返回后重连看到同一实例；已有 stop 事实与
  完整完成条件共同决定 normalEndReady，不新增 imperative end/publish API。
- 两个 projection 过去使用固定名称，会阻止同 Graph 多实例；已改为实例前缀，原独立
  publication 构造器仍可采用它自己的明确名字。实际两实例行为已验证。

直接运行：

```sh
node --import tsx examples/spending-alerts/causal-graded-demo.ts
```

入口与例子在 `examples/spending-alerts/causal-entry.ts`、`causal-graded-demo.ts`、
`causal-ordinary-panel.ts`、`causal-view-binding.ts`。没有 package export 变更，没有新 registry、
能力副本或转发 Node。应用接入责任仍明确；组件简单不代表验证和资源来源可以省掉。

## 什么证据说明了什么

| 证据 | 结果与限制 |
|---|---|
| [运行观察](demo.json) | 62 节点/101 边；一次模拟写入；退订保留1记录、后台完成、重连不重写；normalEndReady=true。完整原图随附 |
| [创建入口测试](focused-tests.log) | 24 创建测试＋初始4绑定测试。配置零节点、默认值隔离、原引用/输出一致、双实例、错误配置/graph/epoch/resource 清理 |
| [全量离线](tests.log) | 160 文件通过、1文件既有跳过；2666测试通过、4既有跳过 |
| [审查修复后测试](view-panel-tests.log) | 11通过：7绑定/实际demo/面板测试＋4既有audience测试。全量之后新增3个有效场景并复跑受影响路径，没有把相同测试重复相加 |
| [源码绑定试验](source-binding.json) | 当前闭包中 vendorStats 的等价表达式改写；拓扑相同、oracle payload相同；3类过期绑定均零调用。记录了变更来源与执行bundle哈希 |
| [真实 runtime mutations](mutations.json) | 9 control 通过、9 mutant 被行为断言杀死，包括guard绕过、重放、结果错配和记录保留。临时bundle实际修改，未改生产源码 |
| [历史artifact检查](artifact-check.log) | 历史完整性检查通过；`currentQualified=false` 保留 |
| [总收据](receipt.json) | 命令、状态、相关当前文件SHA256；lint/typecheck/build/export通过 |

独立 deterministic oracle 位于 `scripts/fixtures/spending-preset-oracle.ts`，与 graph business
实现分开；普通 plain-code 路径及对照测试沿用现有 fixtures，全量离线测试包含它们。
源码试验仅证明列出的等价改写和输入，不证明任意算法改动等价。作者来源是工具实验记录，
不是外部签名身份。demo 使用 fixture binding；源码试验另有真实闭包/bundle binding，不能混用。
审阅页生成器会核对该试验基线闭包中的所有实际文件字节；生成 worker 由试验工具哈希覆盖。

普通视图最后可能没有 coverage/issues 当前值；页面如实显示尚无事实，不用 owner 中存在记录
来冒充完整证据覆盖。无告警条件、暂无评估、暂无发布行都分别显示；它们不自动等同验证完成。

## 审查与边界

独立 blind/edge 审查未发现需要修复的运行问题。verification-gap 审查指出 ERROR 旧值、
面板含义和完整图证据缺口；已补上并复核关闭。新测试实际由 example tsconfig 类型检查，
没有把 limited package test tsconfig 的通过冒充这些新文件被检查。

性能没有继续优化或重采样。新增入口使用原构造且不增加图节点/每事件转发；UI适配器会做
少量普通值投影分配，本批没有量化其耗时，不据此宣称性能资格通过。projection 命名已变，
旧性能收据仍是历史证据，未改写为当前源码资格。

human 和 agent 可读同一 review.html/receipt.json/source-binding.json，不必读取内部装配协议才能
开始。此处是开发审阅，未执行 B121 正式理解度试验；将来真实参与者需隔离答案键。
公共导出、真实 inbox I/O/qualified host、B121 用户研究及正式性能资格仍待后续独立工作。
