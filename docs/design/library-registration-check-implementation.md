# D167：同一次 Graph 校验只读一次登记记录

2026-09-10 · owner：`graphrefly-ts` · 修改前生产基线：`194e72ee`。
用户在 [具体设计](library-registration-check-design-v1.md) 提交 `6d818419` 后批准继续。
原设计保留审阅时的字节；本页记录获准实现和本批证据，不新增决定或改变原 work 状态。

## 实现与边界

`Graph.assertGraphLocalNode` 通过内部 `nodeOwnerForGraphUse` 一次读取原 Node
登记记录，先拒绝 release-start/retired，再返回原 owner，由 Graph 执行原跨图检查。
没有增加表、实例字段、检查缓存、用户配置或公共 export。

各 factory、取得资源前、发布前的全部校验时点保持；options getter、依赖迭代、
dispatcher register 的位置和次数也保持。两次检查之间可能发生用户重入，因此本批
只合并一次检查内部的读取，不保存“已检查”的结果。生成的本地 runner 同步更新。

Node 签发身份、Graph membership、开始释放、内部访问关闭与 retained failure 仍分开。
释放钩子执行时 checkpoint 可以尚可读取，但新的 Graph 使用必须拒绝；保留证据不恢复
使用资格。未签发对象维持此 guard 的旧结果，也仍无法取得 exact-identity runtime access。
这不改变 authority 的 obligation 结算路径，展示退订仍不能结束运行实例的完整 lifecycle。

## 验证与局限

新增回归覆盖 same/foreign owner、bare/fake identity、释放钩子中的实际 Graph.node
调用和 retired failure。两个新增 mutation 分别破坏 release-start 与 foreign-owner
拒绝，并要求真实 runtime 行为断言失败。原取得、发布、重入与 lifecycle mutations 保留。
两位独立静态 reviewer 审查源码与不变量；另一次工具复审检查有限测量和 mutation 方法，
没有待修复发现。静态审查本身不构成运行证明。

全量首轮与 soak、mutation 编译同时运行，出现 6 项额外超时及一次 worker 通信超时，
除去 2 项既有 D159 manifest 失败还有新问题需要核实。保留首次失败日志，使用原命令和
原超时设置串行复验；没有把这些超时算成既有失败，也没有提高门槛。
首轮 soak 为 220 通过、1 项 120 秒超时；该用例单独复验，首次失败同样保留。
隔离后通过只能说明当次超时未复现；并行负载是合理解释，但没有独立证明唯一根因。

本批曾误向三支旧 mutation 脚本传入位置参数；它们实际要求 `--output`。construction
和 assembly 报告写入默认路径后，已移入本批归档，历史报告按 HEAD 原字节恢复。
occurrence 的 73 项检出有完整 stdout、成功退出和源码绑定，但本次没有详细逐断言报告。
不为补齐收据重新运行；该限制随 `output-routing-incident.json` 和原始命令保留。

最终运行结果与性能数据见下方完成记录，以及
`archive/evals/library-registration-check-v1/receipt.json`。

## 性能解释方式

这是本批私有、有限离线构造对照，使用修改前生产代码和当前代码，并包含当前代码的
相同字节副本。沿用已冻结诊断 worker 的计时区间、warmup 和采样方法，不调用其旧
baseline 或删保护的 ablation。不是 CSP-11 或 Causal 正式矩阵重新验收。

四轮 × off/summary × candidate/reference × 三份代码，保留全部 19,200 样本；
其中 4,800 warmup、14,400 measured。拓扑、节点身份、初始投影和 authority 状态先做
等价检查。单次 guard 的查询计数在计时外进行，计时使用另起的干净进程。
cleanup 不在计时内，没有业务场景输入或外部 effect 执行。

查询 2 → 1 是局部操作数证据，不代表构造时延减半；相同代码副本用于显示采样波动。
全部轮次保留，不择取最好一次，不自动重跑。稳态、内存、学习成本仍未由本测量证明。
原正式性能 `P2/summary = 1.211671 > 1.20` 的拒绝及其余 80 行未运行状态保持不变。

## 所有权交接

沿用用户此前的 OWN/PREDICT：依赖不能悄悄丢失，运行实例掌握完整 lifecycle，
普通用户、框架作者和维护者从各自层级进入同一个系统。本批没有增加用户概念，
现有组合入口保留；这不能替代按用户等级隐藏细节的 usability 验收。

可以从 Graph 的 guard 追到 Node 的同一记录，再回到 Graph 的 owner policy；
没有绕过 dispatcher 增加业务 imperative 路径。工程证据已记录，human/agent 的
闭卷理解检查仍未验证，不能据此声称用户已经掌握或学习成本已经降低。

供下次闭卷回忆：

1. 从哪个入口检查一条依赖是否能供 Graph 使用？
2. 什么情况下 runtime access 尚未关闭、Graph 使用已经禁止？
3. 为什么可以合并同一次读取，却不能跨 getter/iterator 保存检查结果？
4. mutation 怎样证明两个拒绝分支有实际作用？
5. 查询数、构造时间与分级隐藏，分别由什么证据支持、还有什么未证明？

本批结束于获准的局部优化、证据和 commit，不自动进入下一项优化或正式矩阵重试。

## 完成记录

| 检查 | 结果 |
| --- | --- |
| D167 / D161 / incoming 专项 | 32 / 28 / 12 通过（共 72） |
| 登记 / construction / assembly / occurrence mutation | 13 / 25 / 16 / 73 检出；occurrence 详细报告缺口见上文 |
| 隔离全量 | 2547 通过、2 个既有 D159 manifest 失败、4 跳过；无额外超时或 worker 错误 |
| conformance | 77 通过，包含在全量 |
| 离线 soak | 首轮 220 通过、1 超时；该用例单独复验 55.78 秒通过，未重跑其余 220 项 |
| 诊断脚本测试 | 21 通过 |
| lint/typecheck、build/export、browser | 通过 |
| frozen artifact gate | 拒绝既有 D159 implementation manifest drift，未修改冻结文件 |
| dashboard / workspace authority | 通过 |

两次全量分别为 208.93 秒和 88.49 秒。隔离结果支持并行负载影响的解释，不能独立证明
超时的唯一根因。soak 证据是首轮和定向复验的合并覆盖，不能称为“一次全绿的 221 项运行”。

以下是 **summary candidate 冷构造**四轮结果；每个单元均有 300 个 measured 样本。
修改前为 `194e72ee`，不是更早的合表前基线。

| 轮次 | p50 修改前 → 当前（µs） | p50 变化 | p95 修改前 → 当前（µs） | p95 变化 | 相同副本 p95 变化 |
| --- | --- | --- | --- | --- | --- |
| 1 | 245.000 → 236.583 | -3.44% | 293.500 → 291.708 | -0.61% | -7.91% |
| 2 | 258.125 → 259.875 | +0.68% | 322.208 → 338.042 | +4.91% | +44.31% |
| 3 | 278.750 → 269.375 | -3.36% | 563.958 → 543.709 | -3.59% | +2.61% |
| 4 | 240.958 → 232.958 | -3.32% | 318.125 → 287.917 | -9.50% | +4.25% |

正常同 owner guard 在计时外验证为两次查询变为一次。summary candidate 的 p50 三轮
下降约 3.3%、一轮增加 0.68%；其 p95 从 −9.50% 到 +4.91%，而相同代码副本的 p95
从 −7.91% 到 +44.31%。因此保留局部减少查询的实现，但**不宣称已经证明稳定的端到端
提速，也不据此启动更大优化**。这不能证明此前约 9–10% 的增幅已被消除。

off candidate/reference、summary reference 的全部轮次以及绝对值在收据的 analysis
和归档 `performance/results.json` 中，没有用单个较好数字替换其他结果。拓扑校验为
off 59 nodes / 89 edges、summary 60 / 93；三个变体的对应节点身份、边和初始状态一致。
本机为 macOS，计时期间未并行执行本批其他重型检查；操作系统和其他应用负载未控制。
