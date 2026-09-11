# Consumer 性能矩阵：固定重复与区间判定（v2 审阅稿）

2026-09-10 · TypeScript owner · 基线 `68461c18` · **设计提案，尚未生效或运行**。
用户“好，你继续”授权细化测量设计；保留此前 commit 授权。
使用 project-governance、decision-guard 和 design-review 的 Q5–Q9。

推荐：每个 latency 格子固定 **16 次新进程重复**，每次保留原三批 p95 算法。
从这些重复得到区间，区间完全低于预算才通过，完全高于预算才拒绝，跨界则证据不足。
平均值作为补充，不能替代尾部成本，也不把不同格子混合平均。

## 1. 已核实的基线与此次改变

当前私有 consumer 矩阵属于 `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`，其工作仍未完成；
不是 CSP-11 原始 eval，也不是已完成的 `LIBRARY-REGISTRATION-TS` 再开工。
`graphrefly-ts:D164` 对应 assembly 设计，D165/D166 的依赖和数值规则、D167 的登记
语义都保持。此次改变的是 consumer 的性能验收方法，不是一次普通重跑。

| 项目 | v1 已冻结行为 | v2 提案 |
| --- | --- | --- |
| 行集合 | 12 cold、60 steady、12 recovery | 行 identity、顺序和输入保持 |
| 一次 latency 行执行 | 一个进程内 AB/BA/AB；每 arm 每批 100 warmup + 300 measured | 每次独立重复仍使用相同三批 |
| 一次重复的指标 | candidate 三批 p95 的中位数 / reference 三批 p95 的中位数 | 保持；记为 Rj |
| 进程级重复 | 每行一次 | 每行预定 16 次，新进程串行执行 |
| 行判定 | 单个 R 与 cold 1.20 / steady 1.10 比较 | 16 个 R 的区间与相同门槛比较 |
| recovery | 每 arm 同一实例 20 次真实退订/重订；时间 informational | 保持一次，不扩成 latency gate，不虚构 plain reconnect |
| 停止 | 第一失败行后停止 | 第一 rejected/inconclusive/invalid 行后停止；其余 not-run |
| 时限 | child 15 分钟、整个矩阵 2 小时 | 每个行组（全部重复和控制）最多 15 分钟；整个尝试仍 2 小时 |

源码依据：`scripts/fixtures/spending-preset-performance.ts:31`（recipe）、
`scripts/fixtures/spending-preset-performance-worker.ts:227`（进程内三批）、
`scripts/spending-preset-performance-report.mjs:11`（统计）、
`scripts/compare-spending-preset.mjs:108`（逐行进程和停止）。
原 assembly 方法见 `docs/design/causal-preset-assembly-v1.md:348`。

**明确改变了 estimand。** v1 是一次进程得到的比值；v2 要估计相同 recipe 在固定
机器/环境下重复时的典型比值（总体中位数）。不是宣称所有进程的 p95 都在预算内，
也不是把 v1 的结果换个算法重算就可以改为通过。

## 2. 每格怎样运行

每格先做两个 reference/reference-copy 控制进程，随后 16 个主进程，最后两个控制
进程。所有进程串行；主进程仍按原 AB/BA/AB 运行，plain 跟在各 pair 后独立报告。
不在本版额外翻转三批顺序：这保留原被测 recipe，不能把它解释成顺序完全无偏。

每个主进程的 candidate/reference/plain 共 3 × 3 × 400 = 3,600 个样本。
每份 reference-copy 使用与 reference 相同的 bundle 字节、构造壳、输入和观察配置，
在控制进程中分配为两个独立实例，按相同三批交替次序运行；无 plain，2,400 个样本。
控制发生在单独进程，不能给主测量进程的 JIT 预热。两种控制身份和源码 hash 必须公开。

固定控制规则：四个控制的各自三批 p95 比值均须在 `[1/1.05, 1.05]`，包括边界。
任一个超出则该行 **inconclusive / control-instability**，不称为 library 超预算。
5% 是本提案的测量有效性筛查容限，需要随本设计一起批准；不是误差校正量，不允许
从 candidate 结果扣掉控制偏差，也不证明系统误差最多 5%。四个控制不能用于声称正式
置信覆盖；它们只会阻止通过/拒绝，不会把一个未通过的主结果改成通过。

每次用计时外的独立 oracle/当前语义证据核对等价义务、输入、拓扑和实际结果。
语义、来源、样本完整性、cleanup 或绑定失败立即标 invalid 并停止；不补充“有效样本”。
旧 reference 资格只能在精确闭包匹配时复用；当前 runtime 已改变，不能假定旧收据
自动有效。需要的再资格应绑定新证据，不能改写旧冻结收据。

计时范围保持原定义；首次材料 hash、准备/构造成本、steady、reconnect、绝对内存分别
保留。GC/deopt 仍记录并关联，不因看到 GC、离群值或较差结果删除任何样本。
复验时不与本任务的 build、lint、soak、mutation、其他 benchmark 并发。固定机器、
Node、启动参数、电源设置与源码；睡眠/中断/已知配置改变导致 invalid，不自动重启。
其他应用与温度变化记录为局限；新进程并不保证系统状态独立。

## 3. 区间、平均数与三种结论

对每次重复 j：每批 300 个 measured 按升序取第 285 个为 p95；各 arm 三个 p95 取
中位数，再相除得到 Rj。reference 分母必须有限且大于零。禁止先合并所有原始样本
计算一个 p95，或在三批内部改为“配对比值的中位数”。

将 16 个 R 排序为 R(1)…R(16)：

- 点估计：`(R(8)+R(9))/2`；同时展示全部 R、算术平均数、min/max 和绝对微秒。
- 判定区间：`[R(2), R(15)]`；这是次序统计量，不是删掉极端值后重算样本。
- **passed**：全部有效性检查通过且上界 ≤ 本格门槛。
- **rejected**：全部有效性检查通过且下界 > 本格门槛。
- **inconclusive**：跨越门槛或控制不稳定；不是通过，也不是确认存在性能回归。

例如 cold 区间 `[1.17,1.19]` 通过，`[1.205,1.23]` 拒绝，`[1.18,1.22]` 证据不足。
单个很慢重复不会必然左右结论，但仍原样呈现；至少两个高结果便可能阻止通过。
上界恰为 1.20 可通过，下界恰为 1.20 而上界更高则证据不足。设计演算的八个例子见
[design-check](causal-performance-repetition-v2.design-check.json)，不是 runtime 测试。

**为什么选 16：** 在重复独立、同分布且目标中位数可定义的前提下，次序统计区间
可通过 Binomial(n, 0.5) 推导。16 次取第二小到第二大的区间，两侧未覆盖概率上界为
`2 × (1+16) / 2^16 = 0.000518798828125`；为预声明的全部 72 个 latency 格子使用
union bound，联合未覆盖上界为 0.037353515625，即覆盖下界约 **96.26%**。
不要求不同格子互相独立，但要求同格各重复满足上述假设。不得把每格普通 95% 区间
声称为整个 72 格矩阵的 95% 保证。

这是基于二项分布的直接演算，使用未插值区间；方法依据为
[NIST 的 median/order-statistic 说明](https://itl.nist.gov/div898/software/dataplot/refman1/auxillar/mediancl.htm)。
16 是允许每侧一个极端重复落在区间外、且上述 72 格联合下界达到 95% 的最小整数。
这个界针对重复 recipe 的总体中位数；不覆盖任意输入、任意设备或业务调用的真实 p95。
跨进程热状态、系统性偏差或时间相关性可能使假设不成立，控制通过也不能证明这些假设。
因此报告必须写“条件性统计区间”，不能写无条件保证或已证明消除噪声。

## 4. 停止、成本与权限

一格的 16 次是**同一预声明实验内的计划重复**。不得根据中途结果选择 8 次停、
再加到 32 次，或者择取某几次平均。正常完成全部 16 次和四个控制后才作性能判定；
只有语义/工具/时限故障允许提前停止，并标未完成。首次不可通过行之后仍停止整个矩阵。
所有 72 格通过，且 12 recovery 的原行为检查完成，才能报告本版性能矩阵通过；
inconclusive、invalid、not-run 都阻止该结论。其他 work gates 仍单独成立，矩阵通过
不会清除既有 D159 manifest 失败，也不会完成 B121 或创建端 ergonomics。

满矩阵采样上限：主测量 4,147,200、控制 691,200、recovery 480，共 **4,838,880**；
其中 warmup 1,209,600，measured/recovery 3,629,280。latency 样本量是 v1 的约
18.67 倍。这是离线资格成本，不会进入 library 用户的运行路径；不保证墙钟按比例增长。
原两小时总时限优先，不扩大为 18 倍时间预算。来不及完成则保留 partial 和 not-run，
不能提高时限、减少剩余样本、拼接另一天的结果或自动启动下一个两小时。

为了降低首次成本，后续可单独批准一个**固定 P2/summary cold 格子的方法验证**，
上限 20 个进程、67,200 样本、15 分钟；只验证工具、控制和成本，不授予完整矩阵标签。
该批无论好坏均保留，不能在看完后把它并入正式矩阵，或者只有通过才选择继续。
完整矩阵必须另有明确的当前来源绑定与运行范围。这个小批次在本轮也没有获准执行。

## 5. 人与 agent 如何核实

人读每格一行：预算、典型比值、区间、控制范围、结论/停止原因，附全部重复和绝对时间。
agent 读相同原始样本及绑定，用纯 deterministic verifier 重算分位数、R、区间、控制
结果、数量和状态。报告生成器的 `passed` 标签不能作为独立真值。

未来工具验收必须覆盖：区间跨界与等于边界、一个极端重复、缺失/重复样本、零分母、
错误 arm 配对、拷贝字节不同、来源过期、控制失稳、timeout、先停后补、修改排序/门槛。
可合成数据验证 reporter；真实短路径核对加载的 worker、实际回收与原计时边界。
只用合成 JSON 通过不能算实际测量工具合格。实现 verifier/worker 与测试均留到批准后。

## 6. Q5–Q9

**Q5 — 层级。** 只作用于 TS 私有离线测量工具；无新 library API、runtime 状态或 graph
节点。复用原 recipe 的一轮定义，新增重复调度和纯报告计算；不做全库 benchmark 平台。

**Q6 — 不变量与维护。** INVARIANT：计时、场景、义务、分母和数值门槛保持；先声明次数，
后看结果。INVARIANT：历史失败、所有样本和停止状态不删。独立/同分布是条件，不能由新
进程或控制通过证明。残余风险是更保守的区间和系统相关性导致无法判定；接受停止。

**Q7 — 组合与认知。** 原 graph `inputs → business/authority → view` 完全不变；普通
用户和框架作者没有新开关。维护者看到一个行结论与证据展开入口。过程复杂度局限于资格
工具，仍增加其维护和离线成本；不声称已验证人/agent 的理解成本。

**Q8 — 具体替代。** A：沿用 v1 三批，一次超预算即停；最便宜，已有实现，但跨进程
不确定性未量化。B：固定多次后只比较均值；实现简单，但把目标改为平均重复成本，不能
继续称其为原 p95 资格。C（推荐）：保留批内指标，固定 16 次与上述区间；统计口径和
失败原因更清楚，代价是更多样本及可能 inconclusive。另一种 bootstrap 路线有灵活性，
但需要额外重采样/种子与小样本覆盖论证；本版不增加这套机制。这里不是重开产品 A/B/C。

**Q9 — 覆盖。** 保留性能门槛、语义/组成边界、每格报告：覆盖。进程间波动：部分覆盖，
受环境相关性限制。多格统计：在明示假设下覆盖。测量负担：显著增加，以原时限封顶。
稳态或所有格子最终能通过、跨机器泛化、用户理解提升：未证明。推荐 C，先批准方法，
再实现并验证工具；原正式结果继续保持拒绝。

## 7. 记录与实施边界

本轮只新增本设计、算术/来源绑定和 docs index，**不改源码、脚本、work 状态或旧收据**。
这是 `CAUSAL-PRESET-ASSEMBLY-TS` 下待批准的方法变更，不是已完成登记优化的追加实现。
旧 `P2/summary = 1.211671`、80 行 not-run 和 v1 的解释保留；v2 不追溯替换它们。

采用本方法会改变成功判据，须由 TS owner 确认方法正文后记录；不能仅以“又跑一次”绕过。
拟议持久记录（未分配 D#）：owner/class `graphrefly-ts/package-local`，
`decision_kind: durable-architecture`，`change_kind: new`，`protocol_impact: none`，
concern `ts.spending-alerts.performance-qualification`，`supersedes: []`。
该记录的 decision 应明确替代 assembly-v1 的**性能聚合与停止部分**，保留其场景和
语义要求；complete_when 为本方法获批、正文绑定并在唯一 owner 登记，historical_when
为后续 TS owner 明确替代此方法。设计完成不等于工具实现或运行授权。

每次实现、方法验证或正式运行仍用非决定的 approval/attempt/evidence 引用，不因
次数、机器或结果变化新建 D#。本轮不启动 provider/live/spend、CSP-11 重验或任何 effect。
