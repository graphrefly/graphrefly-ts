# 分级消费验收与创建入口缺口

基于 d21a85ed；2026-09-13。继续 D160/D162/D164 已批准的消费验收。
本批新增测试和审阅材料，不新增公共入口、runtime profile、provider 或实际 inbox 执行。
工作 owner 仍为 graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS；不更新其完成状态。

## 当前能证明什么

| 使用者 | 实际入口 | 本轮证据 | 尚不能证明 |
|---|---|---|---|
| 普通展示组件 | `built.consume.view` | 五个实际自有字段，无额外 symbol/getter；字段不可写/删除；示例只收到 view，取得真实 publication DATA | 普通用户可独立创建完整 preset；无需了解协议；理解度提高 |
| 框架作者 | `built.consume.capabilities` | 示例返回原 execution；identity/retained 引用恒等；错误 epoch 拒绝 | 从公开 package 入口创建完整 qualified factory；任意能力裁剪 |
| library 维护者 | 同一个 `graph.describe()` | 执行三个示例不增加节点；能看到同一个 authority 与原节点 ID | describe 自身包含任意源码编辑、作者 provenance 或独立等价证明 |

实际普通端口仍为 assessment / publication / coverage / issues / startup。
这是真实对象分组，不是只用 TypeScript Pick 隐藏同一个大对象，也不是安全隔离。
所有人共用完整运行实例；隐藏字段不代表删除 identity/lifecycle/evidence 所需的节点。
`off/summary` 只改变诊断投影，没有给普通用户引入 audience runtime 开关。

源码依据：examples/spending-alerts/causal-preset.ts:175 创建 view；
examples/spending-alerts/causal-audience.examples.ts:11/17/26 是三个真实示例。
原测试已验五字段与业务；本轮新测试实际调用这三个示例，补足只验证结构的缺口。
新增4测试均通过：off/summary 各验对象/身份/同图，以及全部展示退订、错误 outcome、
重新订阅、精确终态。后者同时退订 harness 的观察者，graph roots 保持运行。
`admitted-no-outcome` 在重订阅后仍可见，正确 outcome 才变为 succeeded。
所有 outcome 都是 no-I/O fixture，不能说已经发出真实提醒。

## 入口审计

packages/ts/package.json 已有 `./core`、`./patterns`、`./solutions`；
当前私有 causal capability 和 spending preset 没有因此成为公开 package API。
causal-preset.ts 直接接收 Graph、ConstructionScope、startup、四组输入、binding 和 name，
返回的完整装配对象只供框架装配使用。三份例子也直接引用私有源码。
因此，**消费端按需隐藏已具备可执行证据，创建端渐进披露仍未完成**。
ordinaryExample 自己处理 DATA 消息；不能拿这份例子宣称普通调用者无需理解消息细节。

## 供用户审阅的问题卡

以下是透明审阅卡，不是 B121 隐藏真值试验，不把作者给出的参考解释计成人类答题结果。
人类实际作答/理解耗时尚未采集。每张卡应先只呈现普通 view，再允许显式查框架事实或完整图；
允许回答“不足以判断”，记录为正确的不确定性，不强迫猜测。

| 卡 | 呈现事实/情形 | 用户要回答的问题 | 应核对的边界 |
|---|---|---|---|
| 1 | assessment flagged；publication material matched、admitted-no-outcome | 提醒是否已经发送？ | flagged、材料匹配、admission 都不等于实际成功 |
| 2 | 验证 receipt 尚未到；已有业务结果 | 为什么没有进入获准状态？ | 查 coverage/issues 与 exact refs，不能把等待解释成计算失败 |
| 3 | 已 admission；所有展示退订，再订阅 | 义务是否还在？谁负责？ | 原 graph 实例继续持有；订阅数量不决定生命周期终结 |
| 4 | 收到其他 effectId 的 outcome | 能否把当前提醒标成成功？ | 精确关联不符不得结算，实际正确终态另行判断 |
| 5 | 框架拿到 execution，再复制或改 epoch | 能否当作原能力继续组合？ | 精确签发身份与完整前置能力；视图选择不签发新授权 |
| 6 | 节点 ID/边均相同，算法文件发生变化 | 实现是否变了？谁改的？ | 需要源码绑定/差异；谁改的另需 provenance，拓扑不能替代 |
| 7 | 源码变了，但声称某后果不变 | 该声明覆盖哪些输入和修订？ | 独立且当前的 verifier 证据；作者解释/图形相同不够 |
| 8 | normal transaction，没有 proposal | 没有提醒是成功还是链路坏了？ | 明确 normal/no-publish 与独立业务证据，不能以“没日志”为证据 |

卡1–4/8已有本次运行的相关离线行为测试，卡5的错误 epoch 本轮执行；复制/跨 graph 等
完整能力反例留在原 cold/construction 资格中，不宣称这4个新测试全部覆盖。
卡6–7要从已绑定源码变体与 verifier 包呈现，单凭目前 view/describe 不足；本轮未重跑
源码 mutation，也未将旧 mutation 结果冒充当前独立人类/agent 试验。

## Q5–Q9 与下一步

- Q5：继续既有业务 view / 框架能力 / 完整 Graph 三种消费职责；无新 primitive 或运行时等级。
- Q6：核心不变量是同一图、精确身份、完整依赖和退订不终结义务。最大剩余负担在创建端：
  scope、binding、输入来源以及真正的 focused inbox 尚由装配者处理。
- Q7：分组对象转交原 Node/handle；不新增转发节点、dispatcher hop、持久 registry 或临时缓存。
  本轮未测性能，所以只陈述源码与拓扑不增加，不宣称完整 preset 性能合格。
- Q8：直接把私有 builder 加到 solutions export，虽然工作少，却把装配职责暴露给普通用户；
  继续既有五端口消费、先细化创建端真实调用步骤，能保留当前已验行为。无需重开原 A/B/C。
- Q9：推荐后者。下一份设计限定为“普通用户如何从已有层级入口创建这个真实 consumer”：
  给出普通调用者、框架集成者各一条完整调用链；明确四组输入由谁供给、生命周期由谁结束、
  未具备 focused inbox 时如何诚实拒绝创建/执行，预算新增构造成本与需要理解的概念。
  不把测试 fixture 伪装成可发布 factory，不先锁定新 symbol 或 subpath。

验收结论：本轮消费侧机器验证通过；用户理解度、最终公共创建入口、真实 effect、B121 和
正式性能资格仍未完成。H/L 收尾不解除这些条件，也不要求再次做无关性能诊断。
