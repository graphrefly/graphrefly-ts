# Focused inbox：有限 host 与结果回送设计

2026-09-13；基线92a27aaa。待审阅设计，未实施、未打开 inbox 文件或执行写入。
沿用 graphrefly-ts:D160/D162/D164；唯一实现 owner 为 graphrefly-ts。
不改 wave、不新增公共 runner、不重新选择 C、不产生新的执行许可或完成声明。

## 结论与先后顺序

保持固定 append-alert、单 host 一个在途写、完整 epoch 与请求关联，以及 current-at-dispatch。
优先验证 **I/O 前拒绝的 quiet outcome 回送**，再落定 host/factory。
这不是待实现的一行包装：当前无完整 qualified inbox；source lowering 的合法性必须先证明。
第一项应是有限 no-I/O 机制验证，不是先实现真正写文件，再用 Promise/timer 补救反馈。

## 现有实现能与不能支持什么

| 代码 | 已有能力 | 不能据此推导 |
|---|---|---|
| dispatcher/index.ts: PoolTable.invoke | 同步调用 NodeFn；async pool 的异步行为由 fn 自己承担 | 选 async pool 自动延后调用或结果 |
| ctx/types.ts: Ctx.upNext | committed boundary 上的自需求 PULL，新 wave 回送，含 batch rollback/pause 规则 | 任意 DATA 可向上发送，或可拿 PULL params 搬运业务 outcome |
| patterns/admission-handoff.ts:170 | correlation→admitted→quiet accepted；controller 以 upNext 拉取 | maxRecent 去重符合 host lifetime replay；该结构已证明适用于 authority 环路 |
| executors/local-untrusted-js-compute.ts | 外部 driver 完成后向 outcome Nodes 发事实的先例 | 多张闭包表、直接 emit 和该 executor 的资源策略可直接复制到本 consumer |
| causal-inputs.ts | 显式关联的 InboxObservationFrame | 被动 fixture readiness 是合格 host 或真实 I/O 证据 |

R-reentrancy 拒绝 fn 同步重驱自身上游；R-rewire-deferred-committed-boundary 规定 upNext
只能在已提交、未暂停边界应用，回滚丢弃任务。新的结果路线必须满足这些现有规则。
本轮未运行这个候选环路，所以下文中的拓扑与状态是设计要求，不是现有实现或通过收据。

## 资源、身份与唯一责任

1. 应用宿主先在独立授权下准备确切目的地及资源。preset factory 只接已准备的精确 binding，
   预检不打开文件，不从路径字符串临时创建 host；无默认临时文件、网络或通用脚本 runner。
2. binding 关联 graph/composition epoch、host epoch、固定 append-alert、目的地身份、有限
   profile 和 qualifier revision。可序列化描述用于检查，不能拿描述或结构复制冒充已发行能力。
   精确 handle 签发沿既有机制设计，不新增一组功能相同的全局 registry。
3. 单一 causal authority 继续拥有 admission、active obligation、终态及 retained evidence。
   host 仅拥有文件资源、一次消费记录及实际写结果；不重新判断业务政策或宣告 authority 已结算。
4. host 同一生命周期的有限记录统一到一个明确 owner：同一请求的 reservation/consumed/
   actual outcome 作为同一记录推进，不拆成多套 independently authoritative Maps。
   对 graph 可观察的 readiness、receipt 与关闭状态必须作为声明的 Node DATA，不能藏在隐式全局变量。
5. 临时 OS handle 与执行中的回调归 host 资源 owner；UI subscription 不拥有它们。
   生命周期结束前保留必要身份记录，不能凭 GC 可达性、无订阅者或一个已完成写就清空 epoch 历史。

沿用 D160 有限范围：记录≤4KiB、单写在途、host lifetime writes≤64，保留原 maxEffects 等
不同口径，不把 writes 上限偷换成全部请求/拒绝计数。拒绝结果和未回收 receipt 的容量也必须
单列、预留；满额时阻止新请求而非淘汰旧义务。精确容量字段在实施设计中绑定到同一个有限 profile。

## 实际执行路径

```text
业务与材料 → proposal → 唯一 authority committed record
                              ↓
                    quiet request handoff
                              ↓
当前 occurrence/binding/policy/grant/clock/stop/readiness → final guard
                              ↓ 同一同步执行段，无额外队列/await
                    exact reservation + focused write
                              ↓ 真正的外部完成
                    correlated outcome source → authority
```

所有 graph 业务 fn 经过 dispatcher。最终 guard 和 host 同步前缀必须相邻：验证 exact
request、占用唯一 slot/receipt 容量、记录 consumed，然后发起该绑定资源的写。
若把提交再 postMessage 到 worker、再入待执行队列或 await readiness，就必须重新解释最后
检查时刻，不能仍称原 current-at-dispatch。这里不采用这种未经审阅的变化。

host 不补取 latest payload、不读取 grant 闭包或另作政策判断。提交前到达的撤销/过期阻断；
提交后撤销不能保证撤回系统调用。没有自动 retry，不承诺 durable exactly-once。
明确的 no-submit 拒绝、提交后错误和未知结果不能共用“失败=肯定没写”的标签。

## I/O 前拒绝：具体缺口与候选方案

已 admitted 后被 final guard 拒绝，仍须返回 exact cancelled + typed issue 的已知未提交结果。
直接在 guard 内调用上游 outcome source 的 down 可能同步重入 authority；选 async pool
不会自动修复。单独包 Promise.resolve/queueMicrotask/setTimeout 只为排顺序也不满足 D160。

建议先验证复用既有 quiet demand 机制的候选：

```text
authority → request handoff → guard/result facts → quiet receipt boundary → authority
                                     ↓                    ↑
                                release controller ── upNext(PULL)
```

具体约束：guard 的拒绝作为下游 DATA 到 quiet receipt boundary，不能同步穿透回 authority。
controller 依赖结果事实及 quiet boundary，fresh result 才请求 committed-boundary PULL。
PULL 只表达拉取需求；业务 outcome 不塞进 params，返回的数据仍来自真实 receipt 依赖。
真正的异步 I/O completion 进入同一规范化 receipt 路径，不能另建一条会跳过关联检查的捷径。

这条边构成静态反馈，是否能在现有冷注册/订阅规则下正确构造、激活且无同步反馈，**尚未证明**。
不能仅引用 admissionHandoff 就把它标 supported，也不能要求 substrate 默认容忍重入。
同一批多个拒绝不能只保留 quiet cache 的最后一条；候选应交付有界完整未交付 receipt frame，
并在原 owner 中保持每条 exact 记录，直到对应结果已被 authority 接纳或明确保留等待。
确认/去重不得绕过 graph DATA，也不得因为触发一次 PULL 就认定每条结果已接纳。
这里的“原 owner”与实际 ack 依赖如何落在冷图上，属于首个机制验证必须给出的具体结果。

若 quiet 路径不能满足这些条件，回到本设计呈现失败 trace：不得偷偷新增 boundary callback、
DATA-up、generic task queue，或用 async 标签掩盖 timer；若确需协议能力，走 spec-amend。

## 应用结束与未结义务

- UI detach：仅停止观察。graph roots 和 host 仍承担原职责，重订阅查看同一实例。
- 应用请求停止：以显式 stop/currentness DATA 阻止新 dispatch；尚未提交的 admitted 请求
  必须走上述精确取消结果路径。请求停止不是 lifecycle-end。
- 已提交写：等待真实结果；超时或外部取消不能凭猜测结算。unknown 保持可检查，不自动重发。
- 资源关闭：只有无在途操作、结果回送责任已完成且没有所需 reconciliation 时，才可进入
  host 资源释放；物理关闭成功也不替 authority 宣告 retained lifecycle 已结束。
- 崩溃/强制退出：不提供本设计外的 durability；不能把内存丢失记录成已完成。应用宿主的正常
  结束路径必须保留原 owner 直到其 lifecycle-end 条件确实满足。

本稿不新增 dispose/drain/end 公共方法。结束请求的来源及 host 与 graph ownership 的具体
收束顺序必须在实例集成设计中固定；不能让普通组件负责先后调用若干隐藏 cleanup。

## 首个 no-I/O 机制验证的冻结问题

使用真实 Graph/dispatcher/quiet boundary 与可计数的假 host；不打开文件、不真实写入。
测试输入可使用 fixture source，但输出必须从上述实际路径产生，不能手工写最终 authority 状态。

| 场景 | 必须观察的事实 |
|---|---|
| 冷装配与启动 | 所有实际依赖可注册、seal、移交；无漏节点、无启动循环、无订阅副作用写 |
| final guard 拒绝 | 当次 fn 不同步回灌；新 committed wave 才收到 exact cancelled；active 从1到0且 host writes=0 |
| 同批多个拒绝 | 每个原 admitted effect 都保留并最终精确结算，不丢首项、不误关联、无无限 PULL |
| 重放/错 epoch/错 payload | 不重复消费、不覆盖首事实；伪件拒绝不得取消另一个合法 effect |
| 外层 batch rollback、pause/resume | 回滚没有 dispatch/PULL 残留；暂停不发布未提交 view；恢复只推进应有结果 |
| UI 全部退订 | roots 仍推进必要结果，未结记录保留；重连不重发请求 |
| 容量边界 | 接纳前留够结果记录空间；不能先消费再发现无处记 outcome |
| 假异步完成/结果未知 | 不冒充真实写入；检查关联/保留职责，记录为 fake-host 证据 |
| 必需边真实 mutation | 移除 guard/currentness/receipt-return/ack 边后，行为断言必须失败；结构拦截另记 |

先求可行性，不计作真实 focused host qualification、用户体验研究或性能资格。
若通过，才细化真实写入 adapter 的有限实施；那时再做另行授权的 exact host effect 验收。

## Q5–Q9

Q5：固定业务 executor/source 适配，复用原 authority 与 quiet demand；不增 kernel verb。
Q6：主要风险是同步反馈、receipt 覆盖丢失和 lifecycle 过早结束；身份、结果容量和所有权
不能依赖 UI 或垃圾回收。host 与 authority 各自记录不同事实，禁止各自宣告同一业务终态。
Q7：所有关联/结果推进可从实际图检查；控制需求与业务 DATA 分开。常态不增加全量 JSON
重编解码、源闭包重复 hash 或旁路缓存；新增节点/返回波次和保留 bytes 必须单列测量。
Q8：同步直接回送可能违背 R-reentrancy；人工 microtask 延后违背既定边界；quiet outcome
候选复用现有 committed-boundary，但有静态环路、缓存及 ack 的实际资格缺口。
Q9：推荐先做这一项有限机制验证。覆盖 scope/graph-first/no-timer 方向，尚未覆盖运行合法性、
完整 host 生命周期或性能；如失败，停止该路线并带证据回到设计，不提前承诺公开 factory。

本轮交付设计和源码定位，不发起机制验证、真实 I/O、provider/live/spend、公共 API 或协议改动。
