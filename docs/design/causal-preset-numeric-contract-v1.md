# Spending preset 数值契约细化 — v1 审阅稿

2026-09-09；基线 `70ca9af7`；唯一 owner：`graphrefly-ts`；沿用 `CAUSAL-PRESET-ASSEMBLY-TS`。
用户本轮“同意”接受上一轮方案 A 的方向：保留输入域、明确数值/阈值语义，再修算法和独立 verifier。**下面首次具体化的舍入规则仍供审阅，尚未登记为 D#，没有修改运行代码或执行性能矩阵。** 原实现、离线验证和 commit 授权保留；具体数值规则确认后，继续原批次，不另造 work 或执行 D#。

## 1. 推荐的用户规则

**使用 graph 实际给出的完整精度 Number 分数与阈值做严格 `>`；相等不触发。** 两位小数的解释文本只负责展示。普通组件仍接收原有五个端口，不增加 precision、epsilon、numeric mode 或手动校验入口。

为使独立判定可复现，定义一个唯一的参考数值模型：精确解释输入 Number，按 sample 公式计算数学结果，再对每个最终分数舍入一次到最近的 binary64 Number，中点取偶数（下称 RN64）。参考分支比较这个 Number 与输入阈值。实现可以优化，但不能靠不同的浮点累加顺序自行改变政策。

### 明确的字段规则

| 项目 | 提案 |
|---|---|
| 输入 | 保持 finite binary64 amount/dailyAverage `[0,10^9]`、threshold `[0,10^6]`、prefix 1–64；包含 subnormal。输入 `1.005` 是已解析 Number 的精确值，不是隐式 decimal money；不先取分 |
| 输入编码 | 沿用现有 canonical bytes/digest；不更改既有 `-0` 的编码归一行为。数学中零符号无差别；新计算输出统一 `+0` |
| sample 统计 | 对包含当前交易的整个不可变 prefix，`μ=Σx/n`，`v=Σ(x−μ)²/(n−1)`，`σ=√v`；`n=1` 时 v=0 |
| z-score | v>0 时参考值为 `RN64((x_last−μ)/σ)`，直接对该数学商舍入；不先舍入 μ/σ 再相减相除。v=0 时 z=+0（prefix 常量，等价于原零方差 fallback 的精确结果） |
| daily ratio | `RN64(x_last/max(dailyAverage,1))`；max 比较原输入值 |
| mean/std 投影 | 可报告 RN64(μ)、RN64(σ)，但它们不能替代精确矩用于 z 计算；`std Number === 0` 不能单独证明 v=0 |
| 分支 | 参考 z Number > zThreshold，或参考 ratio Number > dailyRatioThreshold，或未知 category。保持严格比较及原 OR 结构 |
| 图内一致性 | 实际 thresholdGate 和 reasonFactors 继续只比较实际上游 score Number；不在 verifier、UI 或隐式精确比较器中另发运行许可 |
| 文本/请求 | 保持原 factor 顺序、severity、message 模板和 Number 的既有定点显示结果：z 两位、ratio 一位、amount 两位。显示结果不回灌政策；request payload bytes/digest 必须完全匹配参考输出 |

**参考模型与原等价验收区分。** 生产修复的推荐目标是得到参考 RN64 分数。独立 verifier 仍保留既有数值误差界 `1e-10 × max(1,|reference|)`，不放宽，也不悄悄改成 bitwise-equal 门槛。容差只用于数值字段；flagged、factor、severity、message、request/no-publish 必须与参考模型完全相同，而且 actual score 的实际比较必须自洽。一个相差 1 ulp 的等价候选可在某个有限场景通过；若它在相邻阈值处改变后果，该场景必须失败。通过有限向量不等于证明任意输入下等价。

## 2. 为什么选 Number 比较，而不是隐藏的精确实数比较

取 `a=999999999.9999999`、`b=1000000000`，prefix `[a,a,b]`。关闭其他两个触发分支：dailyAverage=10^9、dailyRatioThreshold=5、category 已知。

精确 z 为 `2/√3 ≈ 1.154700538379251529…`；RN64(z) 为 `1.1547005383792515`，其精确 binary64 值略小于数学结果。

| zThreshold | 推荐 Number 比较 | 精确实数比较 |
|---|---:|---:|
| `1.1547005383792512`（前一个 Number） | true | true |
| `1.1547005383792515`（同一个 Number） | **false** | **true** |
| `1.1547005383792517`（后一个 Number） | false | false |

推荐中间行为为 false：graph 中完整分数等于阈值，原 `thresholdGate` 的 `>` 就足以解释结果。选择精确实数比较也能定义正确系统，但需要携带额外政策比较事实，并向用户解释“相同 Number 为什么触发”，超出本 consumer 所需的认知成本。

这里的“完整分数”不等于 UI 两位小数；例如显示 `1.15` 并不说明原 score 与阈值完全相等。现有完整 score 可用于详细检查，无需新 API。

### 必须覆盖的极小数

`prefix = 63 个 0 + Number.MIN_VALUE`：精确方差非零，RN64(std)=0，而参考 z=7.875。不能因为显示 std=0 就走零方差路径。单项 `Number.MIN_VALUE`、dailyAverage=2 的精确 ratio 为半个最小正 Number，RN64 ties-to-even 得到 +0；ratioThreshold=0 时不触发。这两项保持原输入范围，没有新增“太小就拒绝”的政策。

13 个具体设计向量见 [vectors](causal-preset-numeric-contract-v1.vectors.json)。它们由精确有理数 midpoint 比较核对 RN64 候选，并交叉核对 pairwise 与 moment 两种 sample 方差公式；是设计演算，不是已实现 oracle 或 runtime qualification。

## 3. 数值修复的最小 graph 路径

现有代码依据：`causal-business.ts:313` vendorStats、`:327` anomalyScore、`:344` thresholdGate、`:357` reasonFactors；`spending-preset-oracle.ts:10` 与 `:63` 为旧 oracle/验收器。以下只描述待批准修复，不把草图当性能证据。

```text
evaluationSelections → vendorStats ───┐
evaluationSelections → transaction ───┼→ anomalyScore → thresholdGate → reasonFactors → alertMessage
userProfile ─────────────────────────┘                      ↑               ↑
policy ────────────────────────────────────────────────────┴───────────────┘
```

- vendorStats 负责有限 prefix 的可靠统计，输出含真实零方差判定和可继续计算的矩表示。正常可精确表示的数据优先走缩放/居中及补偿的 Number 计算；不能证明足够精度时，在本节点做有界精确 dyadic 计算。μ/std 的显示投影不作为唯一计算凭据。
- anomalyScore 从 transaction、vendorStats、userProfile 的实际 DATA 计算最终分数。可用浮点候选值加有保证的舍入区间；区间落在同一 RN64 cell 内才接受，否则对原矩做一次有限精确消歧。**不能依赖 policy 判断是否需要提高精度**，因为该节点没有 policy 依赖；也不能读取 selection/cache 或重跑另一个具名节点来绕过 vendorStats。
- 私有矩使用有界、可序列化的 Number/字符串表示；BigInt 可在有限局部算术中使用，不进入 graph DATA、public types 或共享全局状态。表示须足以让 score 的消歧不重新拉取原 prefix。确定形式属于实现细节，必须证明其精确性和 bytes 上界。
- thresholdGate/reasonFactors 的直接 deps、比较方向、类别判断保持现形。一旦需要额外边/节点/root、异步数值服务或第二 authority，就超出此草图，不能静默补入。

源代码审阅后的具体范围：private `causal-business.ts` 的统计/score 计算及内部矩表示；独立 oracle/finite plain/reference fixtures；相关测试与 qualification runners；private `VERIFIER_REVISION` 及 fixture receipt 字面量。原 `pipeline.ts` 保留为已有 consumer 基线，其算法不是新的正确性真值。`causal-composition-v1.md:152` 的“原 Welford”实施约定将在新数值决定生效后，由本新正文明确替代该项实施选择；旧正文及其 hash 原样保留。D160 的 authority/capability/lifecycle 语义不被替代。

不新增公共 export，不更改 wave protocol，53/54 节点、2 roots、5 view 端口及 D165 材料边不因数值修复改变。UI 退订、unknown outcome、历史证据、旧义务保留仍走原 authority。

## 4. 独立 verifier、证据与代价

**独立数学路线。** verifier 从输入 Number bits 解码精确 dyadic 值，用 `Σ(i<j)(x_i−x_j)²/[n(n−1)]` 重算 sample 方差；candidate 使用的居中矩/数值 helper 不进入 verifier。对平方根/商的舍入，用精确有理数与相邻 binary64 midpoint 比较，并明确 tie-to-even；固定 100/160 位 Decimal 只能生成候选或辅助分析，不能以“精度看起来够高”代替边界证明。格式 oracle 独立用有理数模拟现有 Number 定点输出，不复用 candidate renderer。

**证据身份。** 输入范围不变，`numericDomainRef=spending-finite-v1` 保留；候选 verifier revision 提升为 `spending-oracle-v2`，其独立 artifact 绑定此契约 digest、加载 closure、input/policy、actual request、verdict 和检查详情。沿用现有 receipt 字段，不加公共字段。旧 v1 receipt 保留为历史并对 v2 当前检查判 stale；相同 receiptRef 不换内容。标签/同进程 fixture 不能充当可信发行者或实际执行权限。

**成本不能省略。** 输入精度和 n 均有限；按 2^-1074 单位表示 amount，单值整数 <2^1104，ΣX <2^1110，`nΣX²−(ΣX)² <2^2220`。这是矩宽度的数学上界，不是执行耗时保证；舍入比较的乘积另计。禁止按接近阈值程度无限增加 Decimal 精度或循环重试。

性能报告必须包括普通路径/精确消歧的次数、prefix 大小、整数位宽、算术 CPU/alloc，以及整体构造/steady/reconnect。诊断放在离线测量层，不在 thin node 加计数器。普通输入不声称必定免除精确工作；未测前不承诺 fallback 很少。

原 12 cold / 60 steady / 12 recovery 矩阵及 1.20/1.10 门槛保持。极大近邻、subnormal、舍入边界形成**额外数值成本行**，不替换原 P1–P6。candidate 与 Graph reference 必须满足同一语义及保留义务；不能为让 candidate 过关，强迫 reference 使用较慢的精确算法。慢的 pairwise oracle 在计时外核实各 arm，plain 继续单列绝对成本。没有自动跑矩阵、重试超预算或 provider/live/spend 授权。

## 5. 验收表（确认后沿用原实现批次）

| 场景 | 必须证明 |
|---|---|
| root 原始 `[100,200]`、zThreshold=.8 | sample 正常；实际 n−1→n 源码 mutation 告警差异被独立 verifier 拒绝；节点身份/拓扑不变 |
| 大数近邻 aab / aba | 正确参考 score；隔离 z 分支后 .5 与 1.3 阈值的不同结果；不能用其他已触发分支掩盖差异 |
| RN64 分数的相同阈值与相邻阈值 | false / true / false 的精确离散行为；epsilon 不改变 `>` |
| 常量、单项、0、subnormal pair/64 | 真零方差与显示 std=0 分开；最终有限 score；不缩减输入域 |
| money 显示 | `1.005` 输入保持原 bytes/值；两位显示独立，不回灌分数、政策或 inputDigest |
| 等价实现 | 数值误差维持旧界，离散结果/完整 request bytes 精确一致；实现 changed 与受测后果 equal 分开显示 |
| 真实 mutations | 除 sample→population，删除舍入/零方差保护、改成 `>=`、以显示文本比较、复用旧 verifier revision，都必须由相应实际行为断言检出；load error 不计 kill |
| graph/lifecycle 回归 | 实际删 vendorStats 等依赖必须阻断；多 DATA、扇出/合入、replay、失效 receipt、detach/unknown outcome 继续通过旧回归 |
| 独立性/资格 | verifier 独立 source/算法/rounding；全域算术论证 + 有限边界向量，不能以少量随机样本声称穷举全部 binary64 输入 |
| gates | 先数值与 plain/Graph reference 语义，再成本矩阵及全部适用离线 gates；D159 既有 manifest 漂移另列，旧收据不重写 |

## 6. Q5–Q9

**Q5 — 抽象。** consumer-private 数值政策与 verifier 由 TS owner 持有；不推广为 core numeric primitive。矩属于现有 vendorStats DATA，score/阈值仍有真实依赖（上述源码行）；没有为一个 consumer 创建通用精度 API。

**Q6 — 长期成本。** INVARIANT：输入域、sample、严格比较、原数值容差与 exact 离散后果、唯一 authority/材料保留均不弱化。维护者需承担舍入证书和精确消歧的复杂性；普通组件没有新增配置。性能只部分覆盖，仍须实测，不能因有限/O(n) 就认定轻量。

**Q7 — 响应式。** statistics→score→policy 在原 dispatcher/deps 路径；subnormal 的非零方差来自 stats DATA。数值步骤是节点内有限运算，不调用另一具名 NodeFn，不读 cache、不发命令触发器；符合 R-dispatch-all/R-data-not-peek/R-no-imperative/R-node-thin。

**Q8 — 两个具体语义选择。** A1（推荐）：数学参考先 RN64，再 strict Number `>`；沿用现在 `thresholdGate:349` 可解释的比较，保留数值容差但不容忍离散差异。代价是明确舍入及消歧。A2：直接比较精确实数；数学边界清晰，但同一 Number score/threshold 可有 true，需要额外政策比较事实/解释。另一个低成本实现候选是只用居中补偿且由 verifier fail-closed；它可能减少复杂性，却不能单凭经验稳定性证明整个已接纳域，暂不作为完成方案。

**Q9 — 推荐。** 选 A1，与 graph 的实际 Number 比较和原组件端口一致。层级/拓扑/生命周期/证据独立性均有具体约束；全域算术实现正确性和性能仍需证明；人类认知收益仍只是一项设计假设。确认这组数值规则后，在原授权批次修复并验证；不另加一次相同范围的实现批准。

## 7. 拟登记的持久决定（未分配 ID）

唯一 owner/class：`graphrefly-ts` / `package-local`；`decision_kind: durable-architecture`；`change_kind: new`；`protocol_impact: none`；`supersedes: []`；concern：`ts.spending-alerts.numeric-semantics`。问题：如何定义 private sample score 的数值真值和阈值行为，使独立验证不继承浮点算法的错误？拟锁定正文：本稿第 1–2 节的参考/接受规则和原 graph 依赖边界；实现算法、每次测量与收据不写成 D#。

`complete_when`：上述具体规则经用户确认后在唯一 owner 登记，并绑定本文及向量；仅指设计完成。`historical_when`：后续 TS owner 明确替代数值语义。新关切补齐过去未定义的舍入/参考真值，不撤销 D160–D165 的 authority、capability、材料或 lifecycle 关切，也不改变 root D793 的 sample/独立证据要求。未确认前，不向 ledger 追加该记录。

## 8. 对上一轮审阅文字的校正

`causal-preset-numeric-review.md` 写“旧 fixture 的 .5 阈值使 flagged/no-publish 改变”过强。重新核对已冻结 numeric-semantic-preflight-2：dailyAverage=100、dailyRatioThreshold=100，aab 的两条实现都因 dailyRatio 告警，实际不同的是 z 分支的 factor、severity、message/request；aba 的离散输出相同，仅 score 超出容差。数值错误与验收失败仍成立。旧文件、收据、raw bytes 保留，本节作为明确校正；本稿隔离向量把 dailyAverage 设为 10^9，才单独比较 z 分支。
