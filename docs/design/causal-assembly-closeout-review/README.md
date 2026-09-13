# Assembly closeout review

当前审查基于5da131b1，唯一owner为graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS。
本批只有证据与范围审查，无consumer、测试、矩阵、源码或公开API改动。
结论：**实现行为证据可保留，assembly整体仍不能标complete；三个实际阻塞需要处理。**
停止追加初始化小优化的诊断，保留该实现为收益未确认，不等于放弃F-PERF。

## 验收映射

| 原验收要求 | 已有证据与当前性 | 剩余条件 |
| --- | --- | --- |
| 53/54 owned nodes、一个authority、两root、一次转移、五字段view | approved/reference包保留实际拓扑、对象身份和有限行为检查；候选核心自9c30967c未变 | 汇入最终索引，不把私有view当作公开易用性完成 |
| N1–N12业务、join、材料先于proposal、退订/重连、replay/冲突/容量 | approved包的真实源变体、numeric-v2/reference-v1修复及后续consumer mutation检查保留 | 使用最终证据覆盖早期限制；旧README是历史快照，不重新标绿 |
| 独立oracle、Graph/plain对照、真实mutation | 最后候选检查：73 causal、16consumer、7plain/reference mutations；独立reference不加载候选业务实现，共用Graph/C底座 | 有限场景证据不是穷举，也不是整体library对plain性能比较 |
| D169 cold12行、D168 steady60/recovery12行、1.20/1.10预算 | 正式D169方法Z未取得资格，M未运行；后续before/after诊断已完成但估计对象不同 | **阻塞P：正式方法资格与完整consumer矩阵尚缺** |
| 默认离线、build、artifact、lint与精确绑定 | build/export、源/测试typecheck、局部lint、async boundary通过；默认2550pass/2fail/4skip；root原219pass/2fail、两失败项随后原deadline重验通过 | **阻塞H：D159绑定；阻塞L：lint边界。**不可宣称全离线通过 |

绑定证据：[binding-audit.json](binding-audit.json)。118个本地文件引用散列全部匹配，
9个qualified artifact refs交由既有workspace resolver，本脚本不冒充已展开其全部文件。
193文件实现归档逐项复核；当前factory和生成runner均匹配原after散列；soak重验的四个
绑定文件仍匹配。packages/ts、scripts、examples、biome/package/lock配置，自9c30967c
以来无提交或工作区变化。这支持保留行为检查，**不等于重新取得当前环境下全部资格**。
新增私有诊断工具与docs并不属于上述“源码无变化”断言。

## 唯一阻塞清单

**H — D159当前性与历史冻结混用（离线基础门槛）。**
两失败均在`solutions-agentic-memory-work-item-root-eval-topology.test.ts`：
“freezes D159 no-network qualification with live authority closed”和
“reproduces raw describe, raw graph.observe envelopes, and the derived run summary”。
artifact check也因同一implementation manifest drift拒绝。它不是三个不同的library行为bug。
D159是另一个root-eval资格/授权关注点，其历史源绑定不能跟着每次library改动静默刷新。
建议下一批先设计如何分别验证历史包自洽与当前实现的资格失效：历史回放使用历史源，
当前live admission仍对缺失/过期绑定fail closed。若需要当前新资格，形成新的无网络证据，
不覆盖旧manifest/claim、不开放provider。不直接删断言、skip测试或改expected hash。
这是TS owner下的相关资格关注点，不能借assembly scope改动live授权含义；具体方案先审阅。

**L — 不可变证据与可维护代码的lint边界（离线工具门槛）。**
已保留lint日志首批错误来自`aligned-capture/raw/00/entry.mjs`等原始诊断产物。
biome只排除archive/evals等，docs内的raw产物仍被扫描；修改原始产物会破坏证据散列。
建议用已有archive/index区分不可变产物，限定排除到确切原始证据范围；手写collector、
verifier适用各自语言检查，JS工具不能通过排除整个docs/design躲过lint。
当前新工具可能也有格式问题，本批没有重跑lint，不能把历史raw错误宣称为唯一剩余错误。
具体修复和测试留到批准后的离线收尾批次。

**P — 正式性能方法与结果尚未资格化（核心验收门槛）。**
D169的Z identical-reference方法资格：40进程/96000样本，控制pair0/1/19失败，
M的后40进程未运行。该失败是方法资格，不是preset/reference预算失败。
D168保留的steady/recovery要求也不能被后续单行P2诊断替代；没有完整84行通过证据。
最近单版本32进程证明采集可完成，有构造下降线索，但仍控制不稳定；不构成D169修复。
下一项性能工作应直接审阅现有正式方法能否回答原1.20预算问题，明确Z/M、估计对象和
可行控制，不再让初始化收益诊断承担正式资格。若需更改方法，另行review/批准，
不得放宽预算、换成p50、忽略不利位置或自动重跑矩阵。

## 不属于这批的开放事项

最终公开core/patterns/solutions入口、qualified factory/inbox、真实effect、三类用户的
理解/操作验证和B121仍未完成。私有五字段view、capability identity和完整describe证据
已经存在；“分级隐藏全部没有做”也不准确。它们是后续有独立验收与授权的工作，不能为了
把assembly标complete而悄悄加入，也不能因为assembly收尾而声称它们已完成。
原authority identity/lifecycle/retained evidence边界、退订不结算义务、全部fn经dispatcher
保持原锁；本审查没有重开registry/C的架构选择。

## 推荐最小收尾顺序

1. **下一批只设计H/L离线收尾方案。** 指出历史/当前资格断言边界与原始证据目录边界，
   列出精确改动和检查；保留live fail-closed与不可变历史。获准后实施并执行受影响的检查，
   再跑一次适用默认离线门槛。不要重跑与改动无关的全部诊断。
2. **P单独做正式性能方法适用性审阅。** 没有可行的资格路径就明确保持未完成，提出需用户
   决定的方法调整或work拆分；本次不调整acceptance、不撤销F-PERF、不制造“有条件complete”。
3. 当H/L/P分别满足后，组合最新源绑定、N1–N12/数值/reference/mutation与性能证据，
   形成最终assembly收据再结案。当前可复用行为证据，不必为了新索引机械地全部重跑。

建议保留单循环初始化实现，不对其收益作合格声明，也不继续扩展优化。
本轮已给出收尾判断，未授权或执行下一批实现、任何矩阵或公共入口工作。

复核：运行`python3 -B docs/design/causal-assembly-closeout-review/audit.py`，只检查Git/文件/
归档绑定，不执行consumer。报告中的文件引用来自当前work；将来新增证据会扩展列表，
不能要求未来输出与本次整体字节相同。
