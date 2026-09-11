# 固定重复性能方法：工具与单行验证

2026-09-10 · `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS` · 基线 `8939de31`。

本批完成私有测量工具及一次获准的 P2/summary cold 方法验证，结论为
**inconclusive / control-instability**，未取得性能资格。20 个进程与 67,200 个样本全部保留，
runner 用时 30.461 秒，外围监督器用时 30.726 秒；没有重试或完整矩阵运行。

方法正文仍是 [已批准设计](../causal-performance-repetition-v2.md) 的原始字节。
`graphrefly-ts:D168` 位于唯一 TS owner 的 `decisions/execution.jsonl`，类别为
`evaluation-method`。设计草稿第 7 节提出的 package-local/durable-architecture 路由与
root authority 合约不符，登记时仅纠正这一元数据；第 1–6 节的方法没有改变。
[approval.json](approval.json) 单独记录本批用户授权，不由方法决定或测量结果授予执行权限。

## 具体路径与范围

`compare-spending-preset-repetition.mjs` 读取当前 reference 资格、原冻结 P2 输入和批准正文，
生成原 performance worker 的私有适配副本，再按固定顺序串行启动子进程。
worker 输出原始样本；`spending-preset-repetition.mjs` 保留每批 p95 → 三批中位数 → arm 比值
的算法，再计算 16 次重复的区间。`verify-spending-preset-repetition.mjs` 不调用该 reporter，
从原始样本独立重算并核对来源、真实入口/配置路径、顺序、数量、绝对时间、区间和结果。

主进程仍使用原 AB/BA/AB、每批每 arm 100 warmup + 300 measured，含独立 plain arm。
两个控制在前、两个在后：逻辑 candidate 调用同字节 copy module 的 reference factory，
逻辑 reference 调用原 module 的 reference factory；控制不制造 plain 样本。
每个控制分别要求比值在 `[1/1.05, 1.05]`。所有有效样本都参与原统计；没有删除 GC/deopt
重叠或离群样本，也没有用控制偏差校正主比值。

生产 runtime、业务 consumer、原 v1 worker、public export、wave protocol 均未修改。
这没有增加普通用户或框架作者的运行负担、开关或概念；新增成本在离线工具的维护和执行。
同字节的两个 module 仍具有各自的模块/JIT 身份，因此不能预设控制一定无偏。

## 实际结果

| 指标 | 本次结果 |
| --- | --- |
| cold 预算 | 1.20 |
| 16 次主重复中位数 | 1.030224 |
| 主重复算术平均数（补充展示） | 1.026383 |
| 条件性次序统计区间 `[R(2), R(15)]` | `[0.962864, 1.077653]` |
| 主重复 min / max | 0.916040 / 1.116568 |
| 4 个控制比值，按运行顺序 | 1.195819 / 1.076344 / 1.136932 / 1.070037 |
| 结论 | inconclusive，四个控制均超过 1.05 |
| 独立核实 | 20 个新进程、67,200 样本；validEvidence=true，qualified=false |

以下绝对时间均为每个 arm 的三批 p95 中位数，单位 µs；不是整个运行时长或单节点耗时。

| 主重复 | candidate | reference | plain | 比值 |
| --- | ---: | ---: | ---: | ---: |
| 0 | 334.791 | 329.708 | 16.208 | 1.015417 |
| 1 | 349.667 | 342.000 | 15.541 | 1.022418 |
| 2 | 345.792 | 355.125 | 15.959 | 0.973719 |
| 3 | 347.458 | 324.584 | 17.083 | 1.070472 |
| 4 | 342.416 | 340.541 | 15.584 | 1.005506 |
| 5 | 406.291 | 363.875 | 16.041 | 1.116568 |
| 6 | 363.917 | 341.166 | 18.875 | 1.066686 |
| 7 | 349.625 | 326.125 | 16.167 | 1.072058 |
| 8 | 379.083 | 388.250 | 17.542 | 0.976389 |
| 9 | 331.667 | 332.042 | 15.875 | 0.998871 |
| 10 | 341.209 | 328.708 | 15.458 | 1.038031 |
| 11 | 330.500 | 360.792 | 17.042 | 0.916040 |
| 12 | 366.042 | 339.666 | 17.000 | 1.077653 |
| 13 | 345.000 | 325.125 | 15.791 | 1.061130 |
| 14 | 323.041 | 335.500 | 15.292 | 0.962864 |
| 15 | 349.084 | 333.000 | 16.542 | 1.048300 |

| 控制 | copy reference | original reference | 比值 |
| --- | ---: | ---: | ---: |
| 0 | 410.166 | 343.000 | 1.195819 |
| 1 | 393.000 | 365.125 | 1.076344 |
| 2 | 397.500 | 349.625 | 1.136932 |
| 3 | 405.500 | 378.959 | 1.070037 |

控制全部失稳，故主区间虽低于 1.20 仍不能通过。这也不是确认 library 回归：copy/original
差异的具体原因未证明，不能仅称为随机噪声，不能把它从主结果扣掉。
该 reference 是等价 consumer 对照，并非 registry 修改前的生产版本；这些比值不能用来
计算 registry 修改的净提速。本机同格重复独立、同分布的统计假设仍未由控制证明。

旧 v1 的 `P2/summary=1.211671` 拒绝及 80 行 not-run 保留。本次方法验证不能并入未来
正式矩阵，不能追溯改写 v1；CSP-11、完整矩阵、稳态/恢复/内存和最终 ergonomics 均未验收。

## 验证、修复与保留的失败

两位静态 reviewer 分别审查工具与设计边界。修复了资格 mutant 集合不够严格、独立 verifier
未绑定实际入口/配置目标、未核对 arm 绝对中位 p95、运行中行状态未及时落盘的问题。
修复均在实际 P2 测量前完成；最终静态复查无剩余发现。静态复查不替代运行证据。

| 本批检查 | 结果与边界 |
| --- | --- |
| 当前 reference 重新资格 | baseline 52 项通过；7 个真实加载 mutation 检出 |
| 新工具测试 | 最终 10/10，包括真实 P1 worker/control、copy factory 路径、真实挂起子进程超时清理 |
| verifier 负对照 | 缺失/重复/错配/非有限样本，零分母，绝对值/区间/门槛结果伪造，错入口，异字节副本，超时/partial、来源与资格错误均拒绝 |
| 全量默认离线 suite | 2547 通过、2 个既有 D159 失败、4 跳过；没有新增超时或 unhandled error |
| conformance | 77 项通过，包含在本次全量 |
| lint/typecheck/no-raw-async | 最终通过 |
| dashboard / workspace authority | 结果见 receipt.json 的最终 gates |
| 未重跑的检查 | build/export、browser、soak、独立 frozen artifact gate；本批未改变其 runtime/API 路径，不宣称本批新通过 |

当前 runtime 相对旧 reference receipt 有 12/65 个来源绑定改变，故没有直接复用旧资格标签。
本批重新资格并将被测 runtime 闭包绑定至新结果；旧冻结 fixture 和收据全部保留。
两项 D159 失败位于 `solutions-agentic-memory-work-item-root-eval-topology.test.ts`：冻结资格
manifest 不匹配，以及 raw describe/observe/run summary 重现拒绝已有 manifest drift。
没有修改它们的冻结预期或将全量 suite 标绿。

首轮工具测试为 7/8：设计向量由 Python 计算，展示用平均数与 JavaScript 差一个浮点步长。
只为展示 mean 增加跨语言舍入容差；判定、排序与门槛仍精确比较。第二轮 9/9，增加真实
超时负对照后为 10/10。首轮 lint 因新 approval 和旧冻结 design-check JSON 的格式失败；
新 approval 格式化，旧设计 JSON 按已有惯例仅关闭 formatter、保留字节。随后一轮新脚本
格式失败亦保留，最终 lint 通过。所有尝试日志均归档，没有增加第二次 P2 测量。

## 证据入口与重算

[receipt.json](../../../archive/evals/causal-performance-repetition-v2/receipt.json) 绑定完整归档、
索引和最终源码。[result.json](../../../archive/evals/causal-performance-repetition-v2/result.json)
保留不舍入的全部主/控制比值和绝对时间。
`archive/evals/causal-performance-repetition-v2/evidence.tar.gz` 保存所有原始日志、样本、
V8 关联、preflight、输入、原/副本 bundle、资格 mutants、监督器及执行源码。

仅重算已有数据，不启动计时进程：

```sh
audit_dir=$(mktemp -d)
tar -xzf archive/evals/causal-performance-repetition-v2/evidence.tar.gz -C "$audit_dir"
node scripts/verify-spending-preset-repetition.mjs "$audit_dir/method-validation"
```

verifier 使用冻结的原 executionRoot 核对当时入口绑定，因此解压目录不必与测量目录一致。
归档逐文件 digest 与压缩文件 digest 在 receipt/index；重算报告不能证明任意人都无法重新
制造一套数据，它证明所保留数据在当前 verifier 下的内部一致性和方法结果。

## 所有权交接

沿用用户的 OWN/PREDICT：维护者、框架作者和普通用户应可从不同层级进入；依赖与 lifecycle
不能被隐藏状态破坏。此次实际修改仅是私有资格入口，未触及用户预测的 core/patterns/solutions。
Diff 已核对没有生产/API 改动；行为证据包括正常和失败路径；真实 trace 为固定 P2 输入经
原 worker 输出样本，再由独立 verifier 得到 control-instability。
组件依赖、runtime mutation 授权路径与分级隐藏没有在这次测量中新增产品证明。

状态：本批交付与证据已完成，**human/agent 所有权理解尚未验证**。无需重新回答旧 OWN/PREDICT；
下一次交接可复述本批路径及证据能证明/不能证明的内容。本批不自动进入下一项设计或测量。

下次闭卷问题：

1. 用户的 public 入口是否有改变，本批实际入口在哪里？
2. 从固定输入到最终结论的三个主要步骤是什么？
3. 什么不变量防止“多跑几次直到通过”？
4. 为什么相同代码控制超界时，主区间低于预算仍不能通过？
5. 哪些证据证明工具确实执行了，哪些仍不能证明 library 更快或更易理解？

不借助 AI 的预计时间、实际人工工作时间及 review/rework 时间未测量；不能由采样 30.5 秒
推算生产力收益。范围纠正一次：方法记录路由；next-day retrieval score 待验证。
类似工作适合 AI 负责实现、对照和独立复算，最终方法解释仍需人工审阅。

下一项具体候选是只读分析本次控制的已存 raw/preflight/V8 证据，区分 copy module、
预热/顺序与环境影响；原因未定位前不调整 5% 容限，不补样本，不启动完整矩阵。
