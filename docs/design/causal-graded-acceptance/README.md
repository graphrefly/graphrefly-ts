# 分层使用走查与 B121 差距收口

基线 `3bb60c9a`；2026-09-14；唯一证据 owner 为 graphrefly-ts。本轮只增加审阅材料，
未修改实现、公共 API、wave protocol 或任何 owner ledger。性能优化仍暂停。

**结论：私有分层路径已具有可解释的最小入口，但尚不能声称真实用户体验验收通过，
也不能声称 Graph 优于完整 plain-code 对照。** 三个独立 agent 完成了有据的角色走查，
只有普通角色运行了既有 demo；没有人独立编写新的集成。这是已暴露证据的开发走查，
不是 B121 的隐藏答案预测实验，三个“部分完成”不等于三个实现失败。

## 实际完成的工作

[协议](protocol.md)先固定三个角色、每人一次、阅读顺序、工具预算与非盲方法边界；
[冻结清单](freeze.json)绑定37个输入文件到产品基线。未挑选最好答案，未重试。

| 角色 | 观察到的结果 | 不能据此证明 | 原始答复 |
|---|---|---|---|
| 普通组件作者，9工具调用，G→P→M | 能通过 view/render/detach 消费；运行demo观察到退订期间完成、重连不重写 | 未独立写组件、未跑双实例或反例；不代表普通用户学习成本 | [ordinary](ordinary-response.md) |
| 框架作者，8工具调用，P→G→M | 推导出双实例调用、原能力传递与graph/epoch检查；明确集成责任 | 没有执行该双实例片段；能力验证不等于指定实例认证 | [framework](framework-response.md) |
| 维护者，8工具调用，M→P→G | 找到原图和请求/admission/outcome；核对同拓扑源码/绑定变化 | 未独立执行source qualification、不能证明任意算法等价 | [maintainer](maintainer-response.md) |

G是私有preset；P是独立PlainSpending；M是同Graph节点的手工装配。各角色都正确区分了
源码变化、工具来源声明与后果证据，没有把fixture digest认作生产加载源码认证。
这仅是整合者对引用和结论的人工复核，没有冻结数值评分、统计功效或一般性认知结论。
三角色任务不同，阅读顺序不是同质交叉试验，不能聚合成胜率。

### 方法异常原样保留

ordinary报告许可材料中的demo含内嵌断言，mutation stderr包含测试期望。这与“不得另搜测试
期望”在材料层存在泄漏，另外两位也有权看到相同材料；因此三份结果均不能用于盲测。
既定定位本就是receipt解释走查，故保留结果用于此用途，不换样本、不假称后验修复了盲法。
所有agent共享文件系统，材料白名单不是强隔离。原始答复归档是走查结束后的独立写入步骤，
不计入8/8/9次试验工具调用，也没有借归档改写回答。

## 被证据支持的体验与具体取舍

| 发现 | 整合者核实 / 分类 | 后续处理 |
|---|---|---|
| 普通组件入口小，但应用仍需五个Node、验证、许可和资源 | 符合既定职责分离；不是装配成本消失。普通角色为了共通源码问题才深入host，不能全部算作日常展示成本 | 保留完整应用接入例子；未来公开入口材料明确区分应用作者与组件作者 |
| 框架需对应CausalBinding与SpendingBinding；只拿下层能力者无本例独立验证入口 | `capabilities.ts:67`实际要求full；验证其原子集lineage后可下传。当前设计没有承诺任意子集独立认证 | 公共分层入口设计需一次决定验证责任；不在本轮增加registry/新validator |
| 验证器不接受expected-instance参数 | 同graph同binding的另一个合法full可能通过；当前功能验证合法签发与内部lineage，不声称指定业务实例认证。不是已确认的私有实现缺陷 | 未来跨组件信任/组合契约明确是否需要预期实例检查，不能靠强制转换或曝光所有能力回避 |
| 五端口没有normalEndReady | `causal-preset.ts:171`与`causal-focused-host.ts:567`确认；panel不谎称运行结束，应用owner能检查。符合当前批准设计 | 产品若要求普通用户看到整次结束，需要设计如何投影既有事实；不偷偷加第六端口或把startup当结束 |
| coverage/issues缺当前值，publication可为succeeded | 实际demo如实显示未知；最近端口值不是完整一致快照，成功结果不自动补齐证据覆盖 | 人工审阅重点：这些解释是否清楚；未发现需改authority的证据 |
| G/M与G/P混淆风险 | M复用同host builder；P的独立状态机没有同等writer/UI生命周期/normalEndReady宿主入口 | G/M只支持装配便利性；P有限协调对照继续有效，完整体验对照目前not-comparable |
| 大JSON首次读取截断 | 三位均需定向取字段，随后取得所需事实；这是真实检索摩擦 | 正式packet按既定上限准备可展开exact refs；本轮不启动通用Graph导航/B134实现 |

原始答复中“无告警完整链unknown”是角色受限材料/未执行的结论，不能当作库缺失了该行为。
上一批全量测试包含独立P/G的12种材料/义务transition对照
（`spending-alerts-causal-preset.test.ts:585`起），以及正常不告警和展示测试；它们是机器行为
证据，不能拿来补写本次参与者已经亲自验证的结论。

## B121 的边界清单

[逐条映射](b121-mapping.json)保留root实际8项acceptance原文与独立评估，未替root宣告验收。

- 已有：B139选择、TS contract arm、已批准设计、私有完整runtime与分级引用、机械回归、
  bounded源码绑定与真实runtime mutation证据。
- 尚缺：与完整宿主义务等价的plain arm；实际本地inbox写入与读回资格；冻结S1–S8所需
  当前端到端证据；真正隔离的预测/receipt双阶段human/agent实验；root独立汇总。
- owner接线仍需收口：root B121 prerequisites目前未纳入选定consumer implementation的
  精确证据生产者；TS CAUSAL-PRESET-ASSEMBLY-TS仍为planned，存在未完成的正式资格条件。
  不可根据局部commit直接把它改complete，也不可把public export当成B121既定前提。
- 原性能预算/资格未变化；暂停优化不等于性能验收通过。这里仅标记，不派发性能任务。

## 下一步建议：一次集中审阅公共分层入口的边界

继续library使用体验主线。准备一份完整设计，集中决定：
1. 哪些已验证私有能力进入core/patterns/solutions的哪一个入口；先核实依赖闭包和现有export，
   不把spending专用例子直接推广成所有业务都能用的承诺。
2. 应用作者必须提供什么、哪些默认值可以隐藏；两类binding如何让集成责任可理解。
3. 框架拿子集能力时由谁验证原身份/预期实例；普通组件是否需要整次lifecycle展示，以及
   如何从同一运行事实投影。完整closure不因隐藏入口缩减。
4. 对应类型、组合失败、依赖丢失、生命周期与导出/打包验收，形成一次批准后完整实施的包。

这是建议下一批设计范围，尚未锁定名称/API或启动实现。B121真实宿主与匹配plain、人类
实验作为独立资格清单保留，不能为了展示入口而把所有项目再串成前置大工程。

## 人工审阅与复核

[human-review.md](human-review.md)可直接开始知情设计审阅，尚无人工结果；不预填通过。
用户已读过本聊天结论，不能当作没有接触答案的正式被试。要关闭正式人类实验，仍须按
B139冻结协议准备隔离材料与匹配对照，不用三个agent的答复代替。

本轮验证只检查冻结源码、引用、映射和证据哈希；产品源码未变，复用上一批有效离线gates，
未重新跑全量测试、构建、runtime mutations或性能。运行 `python3 docs/design/causal-graded-acceptance/check.py`
可复核本包；原始基线commit仍可直接运行离线demo。
