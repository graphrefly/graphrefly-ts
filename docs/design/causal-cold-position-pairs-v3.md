# 冷构造验收：互补进程、同位置比较（v3 待审阅）

2026-09-11 · 基线 `9f99314e` · owner `graphrefly-ts` · **设计稿，未采用、未实现、未测量**。

推荐先替换 D168 的 **12 个 cold 行**的测量安排和统计量：两个新进程运行互补顺序，在同一批、同一位置比较 candidate/reference，再取两个位置中较差的结果。plain-code 独立计时，保留原行为等价要求。先用相同实现和真实额外构造验证这把尺子；不直接重跑 consumer 矩阵。

这不是重新选择 library 架构 A/B/C。下文 C 是 candidate 测量槽，R 是 reference 槽。library 的 identity、graph-owned lifecycle、retained evidence、可组合性和分级隐藏目标均保持。本方案只增加离线评测成本，没有新的 library export 或运行时机制。

## 1. 依据、范围和取舍

已核实的证据：

- `docs/design/causal-block-history-v1-implementation/README.md:5`：相同 reference 实现的第三批 8/8 次先测者较慢；交换第三批顺序，较慢槽也交换，first/later 为 1.116340–1.300899。两种前序历史均出现这一方向。它证明顺序敏感，未分离位置、调用历史、JIT 或 GC 的机制。
- `scripts/fixtures/spending-preset-performance.ts:31`：原三批 CR/RC/CR、100 warmup + 300 measured、cold 1.20 / steady 1.10。
- `scripts/fixtures/spending-preset-performance-worker.ts:229`：原主实验每批在 C/R 后测 plain；旧控制不测 plain。中性 driver 目前只资格验证了 cold。原 worker 的冷构造计时在 `performance.now()` 两点之间，`constructionMs` 和 `preparationMs` 均为零；不得再用错误字段假设拒绝真实样本。
- `scripts/spending-preset-performance-report.mjs:1`：旧指标明确为三批 p95 中位数之比，不能把下面的新算法冒称为旧算法的修复。
- `decisions/execution.jsonl` 的 `graphrefly-ts:D168` 仍是现行方法。原 v1 1.211671 拒绝 / 80 not-run、v2 inconclusive/control-instability 和后续诊断均保留，不用新方法回算成通过。

| 安排 | 能处理什么 | 代价 / 未覆盖 |
| --- | --- | --- |
| 原顺序多跑、取平均 | 降低部分随机波动 | 已复现的方向偏差仍在；不推荐 |
| 单进程改成六批或逐样本交错 | 均衡先后次数，少启动进程 | 改变调用热度和清理历史；只求总平均仍可隐藏某位置退化；不是已资格验证的原循环 |
| **互补的两个新进程，同位置比较** | 每批两槽各占两个位置一次；避免把先测 C 与后测 R 直接作预算比较 | 跨进程噪声仍在，需相同实现控制；两个进程不共享 VM 状态；推荐 |

本稿只对 cold 部分提出取代。60 steady / 12 recovery 的方法保持 D168；这不是对它们公平性的背书，也不据 cold 资格自动允许运行它们。任何共同 driver 扩展到 steady/recovery 都需要另行核实其 preparation/shared-instance/lifecycle 行为。CSP-11 冻结 eval 不改。

## 2. 一次 cold 重复：两进程，同批同位置

每个重复单元 j 使用全新的两个串行进程，分别执行：

| 批号 | U 进程 | V 进程 | 要比较的两个位置 |
| --- | --- | --- | --- |
| 0 | C → R | R → C | U.C / V.R；V.C / U.R |
| 1 | R → C | C → R | V.C / U.R；U.C / V.R |
| 2 | C → R | R → C | U.C / V.R；V.C / U.R |

每个箭头两侧各是一整个 block：100 warmup + 300 measured。保留三批、批内 setImmediate、计时窗口、样本记录和 finally cleanup 的原有边界。两槽每批各构造 400 次，进入第三批前各 800 次。每个进程 2,400 个样本，每对 4,800 个；不能把这 4,800 个样本当成独立重复。

中性 driver 通过相同 namespace 调用位置访问两槽 factory；固定加载 driver→M0→M1，R=M0、C=M1，固定 preflight M0→M1。main 的 M0 为 reference、M1 为 candidate；control 两份都是同一 reference bundle，只有绑定的业务实现不同。两种顺序走同一配置入口，不改业务 namespace 的原 RECIPE。实际 main 路径的 source allowlist、预检和 cleanup 必须重新资格验证，不能拿旧 reference-only driver 的证书直接替代。

**对内先运行 U 还是 V**：每对独立公平随机选择 U,V 或 V,U。实现阶段用系统随机源预先生成整个尝试的顺序位串，连同行表、source hashes、配对身份写入单次 reservation 后，才能启动第一个计时子进程。记录原始位串即可复放，不重新抽签、不强制抽到各半、不中途按结果换顺序。这里不规定随机样本交错；只随机两个完整新进程的先后。顺序随机化并不保证机器环境独立、平稳。

进入配对前校验同一 row/input/runtime/flags/source revision；缺一个进程、映射不符、计数错、时钟非法、清理失败、deadline 或主机睡眠均 invalid，不能拿下一对补齐。只用原计时字段；旧 native GC/deopt 时钟关联继续 unknown，不删除相关样本。

## 3. 指标、控制和判定

令 p(j,b,s,C) / p(j,b,s,R) 是 **同一个重复对、同一批 b、同一位置 s** 的两臂 p95 比值，分别来自 U/V 两个进程。s 为 first 或 second；每个 p95 仍取该 block 300 个 measured 样本的第 285 个值。

```text
q[j,b,s] = p(j,b,s,C) / p(j,b,s,R)
g[j,s]   = median(q[j,0,s], q[j,1,s], q[j,2,s])
T[j]     = max(g[j,first], g[j,second])
```

这明确改为“三批同位置比值的中位数”，再取较差位置；不是旧的“中位数之比”。例：三个批次两位置分别都得到 1.30 和 0.80，T=1.30，不用平均 1.05 判通过。只有位置倍率、两臂业务相同且跨进程条件相同的理想算例，两位置比值才都等于1。真实环境是否足够接近这个条件必须由控制实测，不能假定抵消。

每行固定 **16 个完整重复对**。将 T 排序，点估计仍为 (T8+T9)/2，区间 [T2,T15]（一基序号）。预算仍为1.20：upper≤1.20 才 passed；lower>1.20 为 rejected；其余 inconclusive。不能遇到有利/不利 T 提前结束这一组16，也不能剔除 outlier 或补跑；结构/语义/工具/时限错误仍立即 invalid。

估计对象现在是“同位置比较后，两个位置较差值 T 的总体中位数”。它不声称每个批次、每次构造、每个位置的所有尾部或真实用户首启均在预算内。median 仍可能掩盖单个异常批次，所以完整报告保留每批绝对 p95、所有 q/g/T、两进程的旧槽比（仅描述）、按 U/V 启动顺序分组的结果、原始时间与内存。

区间的条件覆盖计算沿用 order-statistic 逻辑，但独立单位变成“随机顺序的完整进程对”。在16对独立同分布、目标中位数定义合适的条件下，单行非覆盖上界仍为 2×(1+16)/2^16=0.000518798828125；只看12 cold 行的并集上界为0.0062255859375。若以后其余60行的方法也有效，72行并集仍为0.037353515625；**本稿不因此宣布完整矩阵有效**。固定机器漂移、历史依赖或选择性重试可破坏这些条件；随机位串、控制和 max 均不能提供无条件统计保证。max 也可能放大噪声，宁可 inconclusive，不减去观察到的偏差。

每行主组前两个、后两个 **reference/reference 配对控制**（共8进程），与主组相同 driver、两臂工作量和随机先后机制。每个控制对的 g[first] **和** g[second] 都须落在 [1/1.05,1.05]（含端点）；不能只检查 max 而漏掉向下偏差。任何控制越界为 inconclusive/control-instability，即使主组区间低于1.20也不通过。控制不用于校正 T，不是5%误差界证明。

固定顺序：两控制对 → 16主对 → 两控制对 → plain informational。控制越界也保留本行预定主/控制组直至完整（结构错误除外）；plain 只在主/控制均有效且控制稳定时执行，主结果是否跨预算不影响是否保留 plain。本行不通过后停止整个矩阵，未进入行保持 not-run。

## 4. Plain、资源和产品负担

plain 不再混进 cold C/R 的计时进程：它有独立新进程，3批×400=1,200样本，绝对 p95 和内存仅描述，不作 C/plain 相对性能结论。原 deterministic oracle、等价 plain-code 的输入/结果/失败/replay 校验仍保留。每个 pair 子进程仍执行两份原 preflight（各包含三臂），次数和顺序在 main/control 完全一致；这里只移出 **计时 plain blocks**，不是取消行为验证。

独立 plain 进程固定先运行一次原三臂 preflight，再开始三批。它的源绑定和 cleanup 一样需要资格检查；没有订阅 API 的 plain 不新增虚构 recovery。少测 plain 重复是一项明确取舍：它保留行为等价和描述性成本，不提供16对的 plain 置信区间。

| 范围 | v2 | 本提案（成功走完的上限） |
| --- | ---: | ---: |
| 每 cold 行主样本 | 57,600 | 76,800（16对） |
| 每 cold 行控制样本 | 9,600 | 19,200（4对） |
| 每 cold 行独立 plain | 0（已计入主样本） | 1,200 |
| 每 cold 行总计 / 进程 | 67,200 / 20 | **97,200 / 41** |
| 混合方法全矩阵，含480 recovery cycles | 4,838,880 | **5,198,880（+7.44%）** |

cold 单行样本增加44.64%，启动进程翻倍以上；总样本的7.44%不能当作运行时间增幅承诺。每 cold 行另有81次原三臂 preflight / 243个计时外实例（40 pair 子进程各2次，plain进程1次）。原15分钟行组、2小时整个矩阵上限不放宽，未完成即 invalid；本稿不允许自动加预算。60 steady 的样本计算暂沿用 D168，只供资源规划，不授予执行或公平性资格。

维护成本在私有 schedule、collector 和独立 verifier。普通 library 用户、框架作者和维护者的 core/patterns/solutions 入口均不变；本批既不增加其 API 认知负担，也不证明此前分级隐藏已经成功。组件退订不能结束 graph lifecycle、不能结算 active obligation 的约束保持；不通过改业务或绕 dispatcher 降低测试成本。

## 5. 先验证尺子：下一批的精确范围（仍待批准）

建议下一批批准 **私有 cold 工具实现、离线资格检查和一次固定 cold-P2-summary 方法资格尝试**，不用当前 consumer candidate 作性能判断。新路径、完整 source/输入/Node/flags/随机位串/审批文本绑定于一次 reservation；失败保留全部退出和 not-run，不重试。Node/flags沿用已冻结诊断；隐式 NODE_OPTIONS、compile cache、coverage 等环境漂移拒绝。准备失败也消耗单次锁并保留最小失败记录。

先完成无需性能取样的工具资格：

1. 实际加载 U/V driver 与可数 stub，核实每个 factory、计时范围、样本与 cleanup 的映射；分别核实 main/control/plain 路径。冻结 namespace 对象、负序列、互换物理模块、遗漏最后一批、一个进程重复冒充另一个、错误输入/旧 receipt/错误 p95 字段、采集与清理双失败均能被检出。
2. 独立 verifier 不 import collector 的统计代码；从归档原样本重算 p95→q→g→T→区间及控制判定。非1手算向量验证方向、同位置配对、max和边界；实际篡改样本并重建外层index后仍拒绝内部不一致。原 D168 和历史诊断算法继续回归，旧数据不混入新指标。
3. 实际 source allowlist 限定新的调度、factory绑定和独立 plain 入口；没有改 business closure、计时边界或记录/清理顺序。为下一步 formal candidate 的分支做源绑定和实际入口资格，不能把 reference-copy 成功推成 candidate 成功。

随后仅两个固定 panel，顺序如下。每 panel 都是2控制对→16主对→2控制对，不运行 informational plain（其入口先由上面的实际 stub 资格覆盖）。

| panel | 主槽 | 方法资格成功条件 |
| --- | --- | --- |
| Z：相同实现 | reference / reference-copy | 四控制对稳定；两个位置 g 及 T 各自16值的 [第2,第15] 都包含在5%带内 |
| M：真实成本正对照 | reference / 同一reference的测试专用额外构造变体 | 四控制对稳定；两个位置 g 各自区间下界均>1.20，T区间也拒绝1.20 |

M 不是改日志数字或延时睡眠：测试专用变体在被测 factory 内真实构造额外一个相同 reference 实例并清理，再返回原本那一个实例；额外构造及其清理都处于计时窗口内。两槽使用相同 adapter 形状，只有明确的变体开关开启额外工作；所有图仍通过原 construction/dispatcher 路径。静态源绑定与计时外的实际调用/资源核算先证明每次有两个真实构造、额外实例精确清理；定时主样本内不增加逐节点 counter/日志插桩。错开关、额外工作移到计时外、只篡改结果、吞掉 cleanup error 的加载变体必须被拒绝。原 namespace preflight 不经过新增 adapter，故还须在工具资格阶段实际加载 adapter 返回实例，执行同一业务向量与独立 oracle 比较，证明返回值行为等价；不能拿原 preflight 冒充这条路径已经受检。

预计 M 有显著额外成本，但不承诺精确2倍。若 Z 不满足条件，M 全部 not-run；若 M 未在两个位置均检出，方法尚未资格通过，不能调大变体或再测到通过。真实额外构造只证明本场景可检出大幅成本，不证明对1%退化的灵敏度，更不是 effect 授权路径的替代证据。

一次上限 **80串行进程 / 192,000样本**（48,000 warmup / 144,000 measured）；其中64主进程、16控制进程。原 preflight 共160次 / 480个计时外实例，M额外实例单独列账，不混为样本。每子进程30秒、整个尝试15分钟，超限停止；无自动重试。每 panel 的性能控制/区间结果要完整收齐后判定，结构/工具错误立即停。没有 full-matrix、provider/live/spend 或实际 effect。

资格成功只表示 **cold-P2-summary 的这个新方法可用性有证据**。其他 cold rows仍须原业务资格和各自控制，steady/recovery仍未被新 driver 资格覆盖，当前 consumer 是否达到1.20仍待单独获准的实际主实验。若失败，交付明确的“方法未资格通过”及失败坐标，不能继续追加相同尝试。

## 6. Q5–Q9 审查

**Q5 · 抽象位置。** 私有评测编排，不进入 substrate 或公开 graph API。复用原 cold sample 和 cleanup 边界，仅提取 U/V配置与位置统计；通用跨运行时benchmark框架不在本批。真实前例是原 worker 的三批 block 和已资格验证的 source-derived neutral driver，不引用未核实的其他库。

**Q6 · 长期与不变量。** INVARIANT：一对两个新进程、相同 row/source revision、同批同位置、固定16对、不可换配对/抽签/补跑；同实现控制禁止校正主结果。源变动后资格需要重新绑定。隐患是跨进程漂移、不同实现引入的历史交互，以及 max 的噪声放大；用控制和显式 inconclusive 约束，不能声称根治。

**Q7 · 简化、可组合、可解释。** 只在 cold 保留两臂，对照表能直接从 sample身份追到 numerator/denominator。plain拆出避免三臂排列框架；不增加用户配置或图内状态。两源→原consumer→原输出的业务图不变，没有新的 imperative触发、隐藏cache或绕dispatcher。调度脚本的串行命令不成为产品API。

**Q8 · 替代方案。** 第1节三种安排中，增加原顺序重复无法回答现有偏差；六批/逐样本交错要重新定义热点与状态历史。推荐的互补进程以更多离线启动成本换取可核对的位置对应，不要求先解释VM根因。

**Q9 · 覆盖与推荐。**

| 关注点 | 覆盖 | 剩余处理 |
| --- | --- | --- |
| 每批两槽先后机会一致、原单次工作边界 | 是 | U/V逐批映射和实际加载资格 |
| 两位置不被平均抵消 | 是 | T=max；所有位置/批次公开 |
| 原plain历史差异 | 是（cold） | 同实现控制与main均无计时plain；独立plain仅描述 |
| 无条件消除VM/进程漂移、定位根因 | 否 | 明确不作此声明；控制失败则未资格通过 |
| 暴露真实成本增加 | 部分 | 先做M；不声称细小回归检出力 |
| 所有84行公平性/性能完成 | 否 | cold限定；其余仍未被新方法资格覆盖 |
| library性能与用户认知负担 | 是（不新增产品机制） | 评测资源预算见第4节；分级入口易用性仍未验证 |

推荐互补进程和较差位置指标，因为它直接处理本次观察，保留不利位置，并使控制与主实验的计时工作量一致。接受的剩余风险是配对噪声和场景推广限制；下一批用Z/M给出有限的通过或失败，不无限扩展诊断坐标。

## 7. 拟议 admission 与本轮交付

分类：**evaluation-method**，唯一owner `graphrefly-ts`，目标 `decisions/execution.jsonl` 的 evaluation-execution 类；不是新架构决定、运行审批或工作完成。采用须用户明确批准后再分配D#，本轮不入账。拟议元数据：

```json
{
  "concerns": ["ts.spending-alerts.performance-qualification"],
  "decision_kind": "evaluation-method",
  "change_kind": "partial-supersession",
  "supersedes": ["graphrefly-ts:D168"],
  "protocol_impact": "none",
  "completion": {
    "complete_when": "Approved immutable cold-method sections 1–4 are bound in the unique TS evaluation ledger; adoption alone is not tooling qualification or permission to run.",
    "historical_when": "A later TS owner evaluation method explicitly replaces these cold qualification provisions."
  }
}
```

替换内容精确为 cold 的进程编排、plain计时位置、统计量及控制；保留行身份/输入/业务预检/预算、其余行规定和历史收据。第5节是具体可批准的下一批，不由方法adoption隐式授权；审批引用该节和整份文件digest。第6节为审查，第7节为admission草案，不复制到root。实施时还需为决定填入正常问题/结论/理由/日期/status字段和不可变文档digest。

本轮仅设计文档、静态算术与历史证据绑定检查、现有 `CAUSAL-PRESET-ASSEMBLY-TS` 的审阅指针。未新增样本、未修改库/工具/协议/现行D168。work仍未完成，全量测试最近状态仍为2,547通过 / 两项已有D159 manifest失败 / 4跳过；本次没有冒充重跑全量测试。保留root六个既有修改。后续必须证明分级隐藏的人类/agent易用性，不能用性能方法或mutation通过代替。
