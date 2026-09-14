# Focused host completion contract：具体修订稿

2026-09-13；基线c0dc23ec。用户已同意显式异步结果通知方向；本稿细化调度、保留与失败语义，
供审阅。未实施、未新增公共API、未执行真实I/O。TS是唯一设计/实现owner。
D160的同步请求提交、单一authority、精确关联与D162/D164的完整生命周期继续保留。

## 推荐的有限契约

请求检查和提交在同一同步段完成；**所有host结果统一通过host-owned microtask通知交付**，
包括同步确定的未提交拒绝与真实异步I/O完成。固定使用一个宿主调度机制，不开放 scheduler
注入、任意任务队列或用户flush方法。测试可控制宿主调度，但不将此能力公开给consumer。

这个microtask是拟新增的、有契约约束的外部source交付机制，不是已存在的合格机制。
其用途限定为交付已记录的真实host事实；不延后guard/提交，不在域内修复同步环。
在同一个JavaScript事件循环中，它在当前同步调用栈结束后运行；不依赖输入来自down、
batch、RESUME、启动或其他合法Node组合。同步batch不可跨await；不更改batch协议。

## D160的精确修订边界

原第7节限制“不能临时加Promise/timer专为域内排顺序”保留一般效力。
提议新增一项明确限定：

> consumer-private focused host 可在先保留精确completion记录后，使用其唯一microtask
> 通知将结果作为外部source DATA交付。该通道同时承载确定未提交、实际完成和明确未知的
> host事实；不得调度执行请求、推迟最终guard或重新决定业务政策。不得同步重入authority。
> host生命周期内的必要记录、容量与交付失败责任不受展示订阅影响。

这是一项TS-local source/执行适配职责的局部架构修订，不声称已有实现等价。
不修改wave消息、静态环规则、dispatcher.invoke、upNext/batch行为或root conservation语义。
旧design-v1与收据保持原字节；具体稿件批准后再按owner ledger记录局部修订，不覆盖D160全文。

## 状态与唯一owner

host只使用一份epoch内的有限请求记录集合，按完整请求身份查找。
每条记录包含：exact request关联、是否占用写slot、提交状态、可选不可变completion。
另有host自身的调度标志 `scheduled/delivering/faulted` 与递增结果revision；这些是
外部资源交付状态，不是第二个业务authority。它们不能判定业务获准或结算。

记录不在通知后删除，不引入ack表，不回收已消费身份为旧请求重发腾位置。
authority仍唯一拥有active obligation、接纳终态和retained evidence。
source输出的receipt snapshot是host记录的投影，不是另一个可独立修改的记录集合。
图持有者可看到source/执行边界节点；跨外部边界的来源和请求/结果关联另由证据明确展示，
不能伪造一条静态依赖环来让describe看似完整。

## 容量：拒绝也必须有位置

建议首个host epoch最多64个**distinct已接纳到host边界的请求记录**，包括未提交拒绝，
并保留既有最多64次writes、单个在途write、每条payload最多4KiB限制。
这是新增更严格的host记录预算提案，不能暗中声称与D160的writes上限是同一口径。
完成receipt也需有限字节校验；建议每条canonical结果≤4KiB，异常诊断不保留任意stack/body。
具体裁剪不得损坏exact refs：过大结果应保留有限unknown/typed issue，不伪造成功或no-write。

必须在causal admission之前证明这个请求有host结果记录配额；host满时不能先admit再丢拒绝。
单个cold composition独占这个host epoch的消费权，多实例共享不在首批支持范围。
这个容量前置是否能通过现有policy/admission路径实现，需要专项多请求同batch验证；
若要新增reservation事实，必须在实现前细化，不得用readiness的一次旧值放行任意多个请求。
因此completion机制通过本身仍不意味着完整host admission/容量已资格化。

## 精确执行与通知次序

1. graph final guard检查当前occurrence/binding/policy/grant/clock/stop/readiness。
   已admitted但拒绝时，只有验证过的exact request才可进入host的no-submit记录流程；
   伪造request不得给另一个合法effect制造cancelled结果。
2. host同步前缀查exact身份、有限配额、是否已消费。对新合法请求先保留记录；
   接受写时记录consumed并立即调用已准备资源的写，不await、不转发请求队列。
3. 确认没有进入写调用的拒绝产生cancelled+typed issue；写调用抛出若无法证明无提交，
   记unknown/reconcile-required，不能因为同步throw就归类no-write。
4. 真实I/O完成记录exact receipt。重复相同结果不增加revision/通知；冲突保留首事实并
   产生有界诊断，不能覆盖既有completion。原authority仍独立检查精确关联。
5. 新结果记录后，若没有待运行通知则安排一个microtask；同同步段多个结果合并。
   **调度前已保留记录**，调度异常进入host faulted，不自动重试、不丢记录。
6. microtask取当前结果revision和全部已完成receipt的冻结snapshot，交给owned outcome source
   一次DATA。source仍在host/graph运行owner控制之下，不由UI subscription启动或取消。
7. 交付期间若新的工作产生新completion，只标记revision变化；本次交付返回后最多安排
   一个后续microtask，不同步递归flush。每个新completion最多贡献一次后续调度机会；
   同epoch记录上限限制该链，重复事实不能自激无限microtask。
8. source交付抛错：host标记delivery-faulted，保留记录，停止新dispatch，不自动重投。
   部分接收也不能假定全体失败或成功；应用以真实authority与host事实核实。
   source.down正常返回同样不表示authority已接纳，不能据此关闭生命周期或清空记录。

不新增ack协议：完整快照允许现有exact outcome接纳/去重处理重复事实；必要记录一直保留。
代价是最多64条结果的通知快照。实施前应比较增量frame和完整快照的实际成本；本推荐先选
有界完整快照以避免丢最后缓存、ack丢失和新增回收状态，不做跨wave编码缓存。

## 停止与关闭

UI退订：不改变通知与记录生命周期。正常应用stop通过显式事实阻断新dispatch；
待交付receipt和实际in-flight写继续保留责任。仅scheduled=false不足以关闭。
host资源可关闭的条件须包括无在途write、无待执行/进行中的通知，以及结果交付路径健康；
这仍不等于authority所有义务已结算或retained lifecycle结束。
完整graph销毁前必须由运行owner核实其业务结束条件。未知结果、delivery fault或未结义务
使正常结束保持未完成；不暴露一个无条件dispose把这些状态擦掉。
强制进程退出不提供durability，本设计不承诺跨crash exactly-once。

## 验收与实施边界

首批仅实现私有no-I/O completion机制探针，不修改生产authority/host/factory：

- 同步拒绝在当前stack内不可见，下一microtask以真实source DATA可见；authority无同步重入。
- 独立输入、外层/嵌套batch、RESUME后产生结果，均无需调用者flush；回滚不产生新dispatch。
- 同段多结果完整交付；交付中新增结果只调度一次后续通知；重复不重复调度，冲突不覆盖。
- 所有UI退订后仍交付；运行owner尚在时不释放；delivery异常保留记录并关闭新的派发许可。
- 容量边界在接纳前检查；无记录空间时不得丢一个已经承担的effect。
- 独立记录通知数、最大帧bytes、callback延迟，不将microtask次数减少当作正式性能合格。

机制测试之外，真正的guard→reservation→write、精确来源binding、no-submit证明、多请求
admission配额和完整shutdown仍需后续有限集成验收；不得用简单整数探针冒充全部完成。
真实文件准备/写入、provider/live/spend仍没有授权。

## Q5–Q9

Q5：host/source局部交付机制，无新verb或通用scheduler。纯transition保持原职责。
Q6：风险是容量、调度失败、microtask饥饿与关闭过早；通过有限记录、不重试、不递归flush、
明确fault保留责任处理。不能保证同步栈长期不返回时的墙钟响应，也不承诺约100ms总延迟。
Q7：输入仍是可组合Node，不包装每个Graph入口，不要求用户flush；普通view不增加选项。
Q8：逐输入wrapper已有batch反例；静态quiet环已被拒绝；完整host通知契约增加一处有界
异步交付责任，但避免遍历所有入口和新增ack/回收协议。
Q9：推荐上述契约作为D160局部修订稿。仍需批准具体microtask机制与“64总请求记录”预算；
不把上一轮方向同意扩展成这些细节已锁定。批准后先做no-I/O机制验证，再谈真实host。
