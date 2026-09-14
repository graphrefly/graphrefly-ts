# 分层使用走查与 B121 差距收口

2026-09-14。产品基线固定为 3bb60c9a；该批22文件以及引用的当前源码按 freeze.json 校验。
用户批准：对“分层使用体验验收与 B121 差距收口”回复“好的，继续”。本轮产物为 TS owner
证据与后续计划建议，不改 root B121 状态、决定或工作定义，不自动开始公共 API/host 实现。

## 本次方法（先于结果固定）

执行者：3个全新上下文的独立 agent，同当前会话模型与默认推理设置；每个角色1个样本，
各1次只读走查，不重试以挑更好答案。模型标识以运行环境实际暴露信息为准，不推测版本。
每个最多10次工具调用（可批量读文件）、最终回答最多1500中文词等量；不测耗时优劣。
工具限本地只读文件/git与可选已有离线 demo，不做网络、provider调用、性能采样、源码修改。
结果异常保留。本地代理工具共享文件系统，路径约束仅为执行指令，不是OS隔离。

定位：带证据的开发使用走查 / evidence interpretation。不是 B139 的 held-out 预测实验，
没有隐藏答案，没有可信盲测隔离，也不声称模型或真实人的一般认知收益。执行者未继承实现
对话，但代码注释与证据包含说明；正确复述不能单独证明独立后果推理。

共同材料：以下源代码/材料按源路径读取，不允许搜索其他历史review、root答案或测试期望。
所有角色都可请求以下相同集合；分层按先看入口再按需展开，记录首次必需展开点。

- examples/spending-alerts/{README.md,causal-entry.ts,causal-ordinary-panel.ts,causal-view-binding.ts,
  causal-graded-demo.ts,causal-audience.examples.ts,causal-inputs.ts,causal-business.ts,
  causal-focused-host.ts,causal-preset.ts,causal-publication.ts}
- packages/ts/src/solutions/causal-occurrence/{capabilities.ts,contracts.ts}
- scripts/fixtures/{spending-preset-plain.ts,spending-numeric-plain.js,spending-preset-reference-input.ts,
  spending-focused-host-direct.ts,spending-preset-harness.ts,spending-preset-oracle.ts,
  spending-publication-oracle.ts,spending-preset-reference.ts,spending-preset-reference-run.ts}
  文件后缀以实际仓库为准。
- docs/design/causal-graded-entry-implementation/{demo.json,source-binding.json,mutations.json}

对照分类先固定：
G=私有 Graph preset；P=独立 PlainSpending；M=directOfflineSpending 同 Graph 节点的手工装配。
M能验证创建便利性/等价接线，不能冒充plain无Graph对照。P是否具备与G相同host/lifecycle入口
必须核实，缺失即报告not-comparable，不为对照删掉义务或临时补一份实现。
读取顺序：ordinary G→P→M；framework P→G→M；maintainer M→P→G。三角色并非同质交叉组，
顺序记录只便于审计，不抵消学习效应；不汇总成胜率/统计显著性。

## 统一问题

Q1 最少调用/传递什么才能完成你的角色任务？给可用源码片段与明确路径；标记必要输入责任。
Q2 配置/compose/首次订阅分别创建或触发什么？两个实例能否隔离，哪些身份不能复用？
Q3 UI退订时请求已获准但outcome未回，谁负责？何时可以说正常结束？
Q4 从给定源码修改证据判断改变、作者来源、可能后果、可证明不变与未知；证据适用范围是什么？
Q5 旧receipt、错误admission、重放和无告警条件能否执行？分别引用事实或说明缺证据。
Q6 G/P/M哪些是等价体验对照，哪些不是？不要从代码长度或一个例子推断普遍性能/认知收益。

每个回答以 supported / unknown / not-comparable 分类，并给实际查过的路径:行号或JSON键。
额外记录：角色任务完成/部分/未完成；最低所需内部概念；首次不得不展开的细节；可复现障碍；
路径列表/工具调用数；尚不能证明的结论。不要改代码，也不要替人类做接受决定。

角色任务：
- ordinary：只实现展示组件，显示业务状态；退订与重连。应用接入由启动模块负责，需判断是否
  有把集成成本暗藏起来。先看 README/ordinary-panel，不先读authority内部。
- framework：组装两个实例，向子系统传递最小原能力，拒绝跨graph/epoch；比较手工装配入口。
- maintainer：在原图中找到受影响关系、请求/结果与证据；检验“拓扑不变”是否掩盖实现变化，
  独立审视本材料能否成为B121的完整验证。

## 结果审阅规则

只报告有引用的可复核答案。记录错误放行、把缺失当成功、无根据的不变/作者声明与未知校准；
不从解释得分推断实际代码构造通过。已有类型/行为测试是另一类证据。走查揭露的界面文案
或链接错误可修，但冻结基线结果保留，新语义或public入口设计集中另审。

真实人类阶段：当前没有被试、没有结果。开发者可先审阅 human-review.md；用户已看过本聊天
的结论，属于知情设计审阅，不可记作未暴露答案的正式被试。正式实验需在独立执行环境冻结
最多8场景、20业务/边界节点、40事实、2diff，分预测/receipt解释两阶段，保持Graph/plain信息
与完整host故障义务一致，并在查看结果前冻结评分规则与隐藏答案。此处只准备，不自动派发。
