# 拒绝终态归属：保留 host 事实来源，撤回静态回送环

2026-09-13，基线754eced2。设计审阅，未改 runtime、协议或执行权限。
沿用 project-governance、decision-guard、design-review；TS 为唯一候选实现 owner。
本稿不替换 D160，任何实际改变提交/终态来源的方案仍需明确批准。

## 本轮收敛

推荐继续保留：**host 产生“是否提交/实际结果”的证据，唯一 authority 接纳并结算精确义务。**
不把 focused I/O 或自造取消事实塞进通用 transitionCausalAuthority，不重新尝试静态 quiet 环。
但目前还没有覆盖全部合法输入路径的、可直接实施的同步拒绝回送方案；这点必须保留。

上轮已证明的是特定静态拓扑不可构造，不是“所有同步拒绝都必须新造异步任务”，也不是
“Graph 不能接收真实外部结果”。需要分开请求派发、source 的外层调用与 authority 的状态归约。

## 源码边界与不能偷换的事实

- transitionCausalAuthority(prior, arrivals, opts) 返回新 state、outputs 与变更标记，
  不接 host/Graph/资源句柄；identity/lifecycle/evidence 在同一有限 context 推进。
- prepareCommittedEffectsView 是同 invocation 内的被动投影，不能主动消费外部请求。
- lifecycle.receiveEffectOutcomes 校验原 proposal、admission、occurrence 与结果关联。
  “当前 grant 撤销”本身不能证明某个已提交 write 没有发生。
- dispatcher 的 async pool 同步 invoke。真正异步结果在 source/pool 边界完成，不能凭标签
  解决同步反馈；现有 quiet/PULL 也不允许静态依赖环。
- batch/boundary.ts 的 outermost exit 会 drain 已有 rewire/upNext 工作；batch(fn) 包住
  callback 与 commit。因此内层 source.down 返回，不能一概当成外层 batch 已提交。
  内部 deferRewire/批次 topology 回调不是可借用的通用 effect completion 接口。

## 两个 owner 选项的具体取舍

| 选项 | 具体变化 | 收益 | 必须承担的代价 | 本轮结论 |
|---|---|---|---|---|
| A authority 自行产生取消 | final guard/host no-submit 决策进入 authority invocation；同次 commit 写 outcome | 无需从下游同步回送 | 改 D160 事实来源；可能耦合资源/业务归约；若外部调用先发生再提交则有原子性缺口，若先取消则需证明无提交路径 | 不作为小修补采用；需要单独语义设计 |
| B host 保持结果 owner | guard 与 host 同步前缀仍紧邻；真实 host 结果经外部 source 进入 authority | 保留精确证据来源、单一 state authority 与纯 transition | 必须找出合法的同步拒绝交付时刻，并覆盖所有允许的触发来源 | 推荐职责方向；具体回送机制尚未资格化 |

A 并非逻辑上永远不可行，但不能用“少一条边”把它包装成等价重构。
B 也不能只画一个 source 方框就宣布完成，以下给出它必须接受检验的调用栈。

## B 的一个有限候选：真实 ingress owner 的外层返回

假设某个真实外部事件由集成 owner 交给同一 graph，且 owner 覆盖整个同步 batch/波次调用：

```text
外部事件回调进入
  owner 开始本次 ingress（不是新的 Graph transaction）
    source DATA → 原 Graph/dispatcher → final guard
      exact host 同步前缀：可能立即拒绝，也可能开始真实 write
      host 在本次调用拥有的有限 completion record 中记录确定的同步拒绝
    整个外层 batch / wave / 已有 boundary drain 返回
  owner 把尚未交付的真实 completion 作为 source DATA 交给 Graph
    authority 校验 exact outcome → 一次 state commit
外部事件回调结束
```

请求不是通过 PULL params 向上运送；结果也不是拓扑上的 guard→authority 反向边。
host record 是执行边界的真实记录，source 可观察其来源；不是 graph fn 之间共享业务状态。
不额外安排 Promise/timer、不使用 substrate 私有 queue。真正 I/O 在 final guard 后同一
同步段就发起，不推迟到 outer-return；outer-return 候选只用于结果交付，不能改变最后检查时刻。

这仍是假设，不是当前已有 capability。要称它可用，至少必须满足下面全部条件：

1. 所有可能派发的 ingress 都有合法 owner，包括交易、验证、grant/revoke、readiness、
   异步 completion、外层 batch、最终 RESUME 和边界任务。只包装一个 source.down 不够。
2. 首次构造/激活不打开文件或发起写；晚订阅、外部合法 rewire 或其他组件触发不能绕过
   来源资格。不能为了证明成立而悄悄禁止原来支持的 Node 组合。
3. 外层返回的判断对异常和 batch rollback 正确。finally 不是“肯定已经 commit”；
   必须知道 host 是否实际接受过请求，不能丢失已产生的确定结果，也不能伪造未发生的写。
4. 交付 completion 可能引发下一项工作。后续结果用同一有限 host owner 有界推进，
   不递归无限 flush，不启动自发重试；每个请求/结果容量在消费之前预留。
5. 宿主记录是一个统一的、生命周期有界的资源记录集合，不为 pending/delivered/consumed
   各建独立权威表。向 graph 暴露真实 ready/receipt/close DATA，来源关系可检查。
6. 进入了既定合法路径但 host 不可用时是 pending/issue；没有可证明安全的派发上下文时
   不执行。但若这要求新增输入品牌、禁止任意同图 Node、增加公共 owner scope，就已经影响
   D162 可组合性，必须作为设计变化提出，不能在 factory 里暗加限制。

**目前第1/2/6条没有完成覆盖证明。** 现有四组输入允许同图 Node，不能假设全部由某个
私有 ingress wrapper 控制。因此本稿不推荐立刻实现一个私有 flush 队列再宣称问题已解决。

## 失败、生命周期与用户可见意义

无 grant 或不完整验证时仍等待；已 admitted 的请求若确定未提交，host 提供精确取消事实，
authority 接纳后才结算。提交后结果不确定不能沿相同取消分支结算。
全部 UI 退订不结束 graph/host 的生命周期；completion record 的交付责任不能转给展示组件。
正常结束前保留在途和所需结果，未知状态不能用 cleanup 成功洗成成功终态。

普通用户仍只理解来源、目的地和业务状态；框架作者不应被要求自己在每个事件之后调用 flush。
如果实现需要用户记住该步骤，就是本方案的认知与正确性失败，不是“高级用法”。
这也不是公开 approve/publish/retry 方法的理由。

## Q5–Q9 及下一项应做的事

Q5：保持 host 执行事实与 causal 归约各自的 owner；不把业务 executor 放进 kernel。
Q6：风险集中在全路径覆盖、外层 batch fate、容量和结束责任；不以局部正例代替完整证明。
Q7：候选不增静态反馈边、不增虚假异步任务；若必须通用拦截所有 graph 入口，就已扩大
范围，不能当作零成本 façade。per-ingress 及首次构造成本应独立预算。
Q8：A 改变归约/执行责任，B 保留责任但存在集成可行性缺口。人工 timer、私有 scheduler
与旁路 setter 不列为默认替代方案。
Q9：选择 B 的责任边界，暂不选择其具体 wrapper 实现。下一项应一次性完成触发来源覆盖审计：
列出六个输入、启动、batch、RESUME、重订阅和允许 rewire 的实际调用栈；找到不能由
外部 owner 包住的反例就否定该 wrapper，不再靠不断增加特殊情况补洞。
随后才能判断是否存在现有 source 机制可用，或确需另审阅执行边界/authority 职责变化。

本轮无代码修改或测试重跑，没有可执行方案通过声明，也没有新增架构锁或授权。
