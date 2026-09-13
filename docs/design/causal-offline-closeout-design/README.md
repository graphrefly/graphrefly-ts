# H/L 离线收尾设计（待审阅，未实施）

基于7248c094及当前源码。唯一sequencer：graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS；
D159资格规则由TS owner持有。本设计不修改D159，不新增D#，不开放执行权限。
推荐把历史完整性、当前行为回归、当前执行资格分别检查；lint按文件职责和冻结绑定划界。
本批不改变library代码、公开入口、wave、registry C或性能方法。

## H：拆开三个不同的问题

源码证据：implementation-manifest.ts:56把整个运行时、测试与toolchain纳入当前测量；
solutions-agentic-memory-work-item-root-eval-topology.test.ts:1019要求当前测量等于D159冻结值；
同测试:1445又使用当前源码生成历史字节。generate-root-eval-artifacts.ts:479在生成前
拒绝manifest drift，:673的check先调用生成器。两条失败与artifact拒绝来自同一绑定。
已有checkRootEvalGeneratedArtifactSnapshot（:144）检查冻结marker、成员、散列和读取稳定性，
可以复用，但必须再用独立固定的artifact-set摘要锚定marker，不能仅相信包内自报散列。

推荐具体改动（获准后）：

1. 保留implementation-manifest.ts中的冻结值、测量闭包和runtime要求；保留live authority、
   precredential、claim、grant对源码和资格的精确绑定。不得更新expected hash来绿灯。
2. 增加私有历史验证入口，读取现有D159产物、固定marker摘要、资格摘要，验证全部文件成员、
   内容散列和相互引用。固定摘要从受版本控制的既有冻结产物取得，记录Git出处，不能在检查时
   从待验目录自生成expected。输出明确为historical-integrity，不声称当前资格或历史重新执行。
3. 第一条测试拆为历史资格结构/授权关闭断言、当前测量闭包覆盖、当前漂移拒绝三组。
   保留release-version例外与scripts变化敏感性断言；用受控输入变异验证拒绝，不能把
   “当前必须一直不同于历史”写成新的固定断言。当前是否匹配应是状态，拒绝逻辑才是不变量。
4. 第二条测试保留现有describe、observe、run-summary的行为断言。历史字节一致性改由历史
   验证负责；当前运行在独立临时目标产生诊断输出，带实际源码摘要和unqualified标记。
   仅分离生成器的无网络计算部分与资格发布包装，不传入allowDrift或fake frozen digest。
   不调用provider，不写入artifacts目录，不生成live qualification/claim/grant。
   现有生成/发布包装仍先检查精确manifest，仍拒绝当前漂移。
5. 保留eval:root:artifacts:check的严格重生成语义，另加名称明确的历史完整性命令。
   不悄悄把现有资格gate换成较弱检查。收尾报告分别列历史完整性、当前回归、当前资格；
   严格重生成在当前源码上仍可能失败，不能据此宣布“全部原有gate已绿”。

这是H的边界修复，而非新D159资格。若assembly验收要求该严格历史重生成也通过，
此设计不能解除该项：需后续独立批准当前无网络资格方案或明确适用gate，不能本批偷偷豁免。
历史源码完整回放也不等于散列完整性；本轮未验证存在可运行的D159完整源闭包，故不承诺重演。

## L：冻结证据不格式化，可维护工具继续检查

当前biome.json已排除archive/evals及root-eval/artifacts，但未排除
`docs/design/causal-cost-investigation/aligned-capture/raw`。本地该raw目录存在，
`git ls-files`未列入它；历史lint因此会被本地展开产物影响。只看tracked文件会漏掉此问题。

推荐最小改动：

- biome.json增加上述一个精确raw目录排除；保留现有archive/evals边界。
  不排除docs/design、causal-cost-investigation或所有名叫raw的目录。
- 对此次lint发现的其他文件先分类：有已验证archive/index绑定的冻结副本不改字节；
  若还需要排除，先写精确路径、摘要与归档出处清单，再扩充排除。没有绑定不能因报错而豁免。
- `single-version-rss-v2-tools`、`dependency-comparison-tools`、`performance-comparison`等
  authored工具默认仍受lint约束。若散列被历史收据引用，先确认历史归档完整保存原版，
  再创建带新版本路径的维护副本并格式化；历史工具按冻结文件清单留存，不重写旧收据。
  不把新的维护副本冒充旧资格版本。未绑定的维护工具可原地格式修复。
- 增加边界检查：每条新增排除必须对应有效归档成员/摘要；未分类文件仍进入lint。
  临时维护工具中的明确lint错误必须被捕获，冻结副本损坏必须被完整性检查捕获。
  Python verifier使用语法检查及自身已有离线fixture，不能声称Biome覆盖Python。

## 验收与负对照

| 场景 | 要求 |
| --- | --- |
| 当前library源码改变，D159文件未变 | 历史完整性通过；当前行为实际执行；当前旧资格仍拒绝，零credential/network |
| 修改产物并重算其包内marker | 外部固定摘要拒绝；不是自证成功 |
| 缺失/新增成员、错误资格摘要、marker读取期间变化 | 历史验证拒绝，保留失败原因 |
| 错误/过期源码或grant、重放claim | 既有授权负测试保持拒绝；不真实读取凭据 |
| 当前无网络输出与历史不同 | 可审阅差异；不得覆盖历史或自动取得资格 |
| 原始证据含格式错误 | 字节保持，散列验证通过，未作为可维护代码格式化 |
| 新工具引入lint错误；冻结文件损坏 | 前者lint失败，后者完整性失败，各自独立 |

实施次序：冻结基线与排除清单 → H测试/私有诊断输出分离 → L精确边界与工具版本处理 →
受影响root-eval拓扑/live离线测试、artifact完整性及漂移负测试 → 一次默认离线测试、
完整lint、build/export、authority/dashboard。若改到root-eval执行生命周期，补其相关soak；
不因设计文档自动重跑性能capture。保留所有失败记录；严格当前资格单独报告。

## Q5–Q9

**Q5，抽象与层次。** 两项均在package-private eval/开发工具层，不属于graph runtime。
H使用现有snapshot验证，新增输出只表明历史或当前诊断；L使用现有归档与lint机制。
不新建通用证据平台、公共verb或registry，普通library用户无新增概念和运行成本。

**Q6，长期风险。** INVARIANT：历史摘要固定；当前资格不从历史完整性推导；全部排除有
可验证冻结出处；维护版本不继承旧收据。风险是维护两类检查和工具版本，需名称明确、
统一清单避免重复。新的当前资格是后续工作，当前设计不解决它。

**Q7，简化与组合。** 不更改consumer图或执行lane，也不把授权判断搬入脚本。
历史读取、当前无网络运行、授权拒绝各自可独立复核；临时输出不能流入live admission。
无需新的节点或imperative触发入口；真实业务仍通过原Graph/dispatcher。

**Q8，备选。** H-A：刷新冻结hash并重生成，容易绿但会改写历史且可能扩大授权，拒绝。
H-B：仅拆测试、继续保留严格gate，加独立历史验证与当前无网络回归，推荐；代价是不能
宣称当前D159资格已恢复。H-C：直接建立新当前资格，可能完整收尾，但扩大范围，单独审批。
L-A：排除整个docs/design，维护简单但隐藏工具错误，拒绝。
L-B：精确冻结路径+完整性检查+维护副本，推荐，清单有成本。
L-C：格式化所有raw，破坏证据，拒绝。现有snapshot checker与archive/evals排除是仓库先例，
无需借用旧runtime的实现来设计开发工具。

**Q9，推荐与覆盖。** 采用H-B/L-B。

| 关注点 | 覆盖 |
| --- | --- |
| 历史完整性、当前源码漂移拒绝 | 是，独立固定摘要与保留严格gate |
| 当前行为仍真实验证 | 是，无网络计算与发布包装分离，保留行为断言 |
| library性能/认知负担、可组合性/分级隐藏 | 无runtime改动，不增加负担；也不新增分级隐藏完成证据 |
| 冻结证据与可维护工具质量 | 是，精确路径与两种独立检查 |
| 当前D159完整资格、完整历史执行回放 | 未覆盖，单列，不降格冒充 |
| assembly最终完成 | 未覆盖，P正式性能资格仍缺 |

本提案可批准为有限离线修复范围。若用户期待本批使所有原gate通过，必须选择另行审阅
H-C，不能把H-B包装成等价结果。批准前不实施、不改冻结值、gate或authority含义。
