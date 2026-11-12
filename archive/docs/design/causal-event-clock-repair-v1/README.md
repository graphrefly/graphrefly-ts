# 私有事件时钟修复：可审阅方案

2026-09-10 · 基线 `cab725ea` · owner `graphrefly-ts` · **待批准，未实现或运行夹具**。
归属 `CAUSAL-PRESET-ASSEMBLY-TS`，遵循 D168；本轮只设计和 commit。
这是诊断可信度修复，不改变性能统计方法、预算、产品 C 或 work 的完成标准，不新增 D#。

推荐：**旧文本日志显示 unknown；未来诊断使用 Node 结构化 trace 与带边界的 hrtime 校准。**
先修复错误声明并用一个独立小夹具验证整个路径。本批不为 consumer 加插桩，不跑 P2 或正式矩阵。

## 1. 要修什么

已确认的缺陷及原始证据见 [control audit](../causal-performance-control-audit-v1/README.md)。
`scripts/spending-preset-performance-report.mjs:69` 把一个 uptime offset 同时用于 GC/deopt；
两个 runner 调用它。旧测试只验证人工共同 offset，未验证实际时间源。

验收问题是：“这条已记录事件与这个样本在时间上能否确定相交？”
不是“GC/registry 已被证明导致变慢”，也不是“没有重叠就能排除所有 runtime/system 开销”。

保持 `percentile/summarize/decide`、原 samples、worker、recipe、16+4 次数、1.20/1.10 及
1.05 控制容限不变。旧报告只增加独立更正说明，不覆写收据或重新拟合其时间轴。

## 2. 具体数据路径

两条明确的私有路径共用一个结果格式：

- 原 v1/v2 runner → 原 native 文本日志 → 解析原事件及其 native clock → 每个样本 unknown。
- 新小夹具 → Node trace + 三组时钟锚点 + fixture window → 纯解析/关联 → 独立 verifier。

第一条不新增采样，不接受数值 offset 作为校准凭证。即使日志为空也不能返回“无 GC”。
第二条是前向的诊断能力，不把旧 logger/trace-gc 时间混进新 trace，不按序号把两个日志的
事件强行配对。Node trace 的实际 deopt span 与 logger 的 dependency-change 记录并不等价。

私有结果包含原 artifact digest、run/worker/进程身份、Node/V8 版本、采集参数、事件源/时钟、
校准依据、支持的事件覆盖范围、raw event refs 和每个样本的关联。主要状态为：

| 状态 | 含义 |
| --- | --- |
| `overlap` | 在保守误差范围内，事件仍确定与样本内部相交 |
| `possible` | 误差范围允许相交，也允许不相交；端点仅接触也归此类 |
| `disjoint` | 与这条已记录、受支持事件确定分离 |
| `unknown` | 缺校准、错误身份/时钟、超出覆盖范围或数据无效，不能判断 |

集合汇总只能说“在已记录且支持的事件中未见重叠”；不说“没有 GC/deopt”。缺失类别、
截断、非正常退出或未匹配 B/E 会让相应覆盖范围 unknown；不能用空列表代表通过。
有 overlap 也不代表事件独占了整个样本时长，不能从样本减去事件时间。

## 3. 如何取得可信的时间关系

Node v24.18.0 文档明确：结构化 trace 与 `process.hrtime()` 使用同一时间源，trace 单位
为 µs、hrtime 为 ns。[官方版本文档](https://github.com/nodejs/node/blob/v24.18.0/doc/api/tracing.md)
本方案固定从这一接口取依据，不将其推广为文本 GC/logger 也共用该时间源。

独立诊断夹具在开始、中间、结束各取 **一组**：

`p0 = performance.now(); h = process.hrtime.bigint(); p1 = performance.now()`

三组锚点均在 fixture window 外，顺序固定，不因结果增加次数或择取最窄的某组。
保存 h 的十进制整数 ns，避免先转不安全浮点数；p0/p1 原值保留。
以整数/有理数保留 ns→µs 精度，区间端点向外取整。定义 δ = H_us − P_us，每组给出区间 `[h − p1, h − p0]`；
取三组区间的交集。必须有限、单调、单位一致、来自同一运行与主线程，且时间覆盖所有窗口。
交集为空、锚点缺失或跨进程复用一律 unknown，不拟合斜率、不加大容差直到通过。

这依赖版本绑定的一比一单调时间关系；三个点本身不能证明任意环境不存在中途漂移。
变化版本、休眠/中断、时钟连续性检查失败需重新取得证据，不能复用机器级 offset。
区间较宽本身不硬造一个“校准通过”门槛：传播到样本后，自然可能只能得到 possible。

trace 时间戳按 µs 向外扩 1 µs 处理记录精度；样本边界同样向外取整，不把小数截断成精确值。
对 trace span `[a,b]`、δ∈`[dL,dU]`：

- 起点范围 `[a−1−dU, a+1−dL]`，终点范围 `[b−1−dU, b+1−dL]`。
- 事件最晚终点早于样本最早起点，或最早起点晚于样本最晚终点：disjoint。
- 事件最晚起点早于样本最早终点，且最早终点晚于样本最晚起点：overlap。
- 其余有效情况：possible。无效校准或记录：unknown。

在应用上述判定前，原始零时长事件只可返回 disjoint 或 possible，不输出正时长 overlap。
这些是保守的充分条件；不为更多确定结论舍去误差。精确零时长与边界接触不声称正时长重叠。

## 4. 事件来源与完整性

版本适配只认主线程、同 PID 的 `MinorGC`、`MajorGC` 和 `V8.DeoptimizeCode`。
GC 名称来自对应版本 [heap scope](https://github.com/nodejs/node/blob/v24.18.0/deps/v8/src/heap/heap.cc)，
deopt span 来自 [Runtime_NotifyDeoptimized](https://github.com/nodejs/node/blob/v24.18.0/deps/v8/src/runtime/runtime-compiler.cc)。
GC scope 包括它定义的阶段，不称为精确 stop-the-world 停顿；deopt span 也不覆盖全部编译、
依赖失效或后台优化。后台线程记录单列，不冒充当前 JS 线程的阻塞时间。

解析完整 trace JSON，核对 run manifest 与实际 PID/主线程标记；处理 `X` 完整事件和严格
配对的同线程 `B/E` 栈，不能用“下一个同名 E”配对。异步相位不套同步规则；受支持名称若
出现未支持相位，显示 coverage unknown。检查非有限时间、负 duration、倒序、重复来源身份、
缺失/重复片段、rotation 缺口、未关闭事件与最终正常退出。未知事件原样留存，不偷偷扩展支持表。

用于检验原始 trace 时间的标记选用 `console.time/timeEnd` 的 `node.console` 事件，
不是未经实测的 usertiming 假设；对应版本
[console timer](https://github.com/nodejs/node/blob/v24.18.0/lib/internal/util/debuglog.js) 直接写 trace。
每次调用分别用前后 hrtime 包住，核对 B/E 时间确实在相应区间内；timeEnd 的日志输出在
夹具内保留，不作为样本成本。标记只存在于这个资格夹具，不放进 library 或 consumer 热路径。

## 5. 下一批的可执行范围（待批准）

实现只涉及私有 report/correlation、两个调用点、新关联器测试、一个独立 clock 夹具及其
独立 verifier。原 worker、所有 library 源码、public export、wave protocol 不变。
现有 runner 改为输出 native-clock unknown，不改其测量调度或 numeric verdict。
候选文件边界：

| 文件/入口 | 改动 |
| --- | --- |
| spending-preset-performance-report.mjs | 保留统计函数；替换错误关联调用及输出语义 |
| compare-spending-preset.mjs / compare-spending-preset-repetition.mjs | 去掉 uptime 校准参数，仅更新诊断接线；不执行它们 |
| 私有 event-correlation helper + tests | native unknown、trace 解析、误差传播、保守判断与负对照 |
| 私有 clock qualifier / fixture / verifier | 真实捕获与独立核实；无 consumer import |

实际验证限 **一个新 Node 子进程、30 秒、零重试**；启动参数固定为 `v8,node.console`
trace 类别，GC/deopt 夹具所需的 `--expose-gc` 与 `--allow-natives-syntax` 仅在测试进程中使用。
不启用 CPU sampling、不调用 provider、不开浏览器。三个窗口顺序固定：简单空工作、一次
显式同步 GC、一次预声明 deopt 触发。deopt 函数固定至多 16 次预热、一次强制优化后的
稳定输入、一次改变对象形状的调用；不循环到“终于出现事件”。

绑定确切 Node/V8、参数、脚本和输出 digest。实际 trace 中必须出现同线程标记、正向 GC
及 deopt 证据；无事件、优化器策略不支持或工具故障即不合格，保留原因并停止，无 fallback。
最大解析输入 16 MiB，超出即拒绝解析并保留原输出；30 秒监督器终止时保留 partial，不能
把 timeout 当“无事件”。最终 trace 在子进程正常结束、文件关闭后读取。

这个夹具只证明采集/校准/解析/关联路径能工作，不提供任何 Graph 性能结论。后续真正
consumer trace 的插桩成本和 module 对照仍需另行设计；本方案不包含那次采样。
新增普通离线测试与必要 full/lint/authority 检查按 QA 执行；已有默认 suite 的 D159 两项
失败单列。不会以跑现有 P1/P3/P6 timing tests 为由增加未经声明的 consumer 测量进程。

## 6. 必须交付的证据

1. happy path：三个校准锚点、真实标记和至少一个 GC/deopt 事件；独立 verifier 从 raw
   trace 重算边界，不能只读 reporter 的 overlap 标签。所有有效事件/样本保留。
2. 简单负对照：同一 trace 上选择与已知事件分离的窗口，得到 observed-event disjoint；
   不把空工作窗口当作“保证没有自动 GC”。
3. 缺锚点、反向 offset、ns/µs 错误、跨 PID/run/source digest、倒序锚点、空交集、
   边界接触、宽误差、重复/缺失 B/E、错误线程、缺 rotation、截断/超时均不得生成虚假 overlap/disjoint。
4. 真实执行的纯关联器 mutations：恢复旧 uptime-only 假设、去掉身份检查、反转 δ 符号、
   去掉误差扩展、把缺失当空列表、宽区间强行取中点；必须触发行为断言，不靠字符串命中。
   使用保存的真实 trace 和合成边界输入，不再启动第二个采集进程。
5. 只读重算旧 321 文件归档：原 67,200 样本/数值 verdict 不变，legacy 诊断更正为 unknown。
   输出新 sidecar，不改原 receipt、GC/deopt 日志或 frozen worker 字节。

`vectors.json` 给出设计算例与预期，算术演算不是运行验收。人读状态、来源和限制；agent
读取同一 raw input、scope、digest、calibration bounds 与 verification。二者均不得从诊断证据
推导 implementation/live/spend 权限或用户已理解的结论。

## 7. Q5–Q9

**Q5 — 层级。** 目标在私有离线 tooling，不进入 graph/substrate，也不增加公共动词。
原日志解析与时间关联分开；仅复用两个已有调用方，不做跨项目通用 profiler。数据流是 raw
事件与锚点/样本共同进入纯关联器，再进入报告和独立 verifier；没有新的业务 imperative 路径。

**Q6 — 维护与不变量。** INVARIANT：时钟域/身份/误差不可缺；缺数据不能等价于零事件；
overlap 不等价于因果。INVARIANT：不修改历史数值，不从控制结果拟合校准。六个月风险是
Node trace 的实验性接口和事件覆盖变化，靠版本适配与真实夹具拒绝静默漂移。测试原生语法
仅限夹具；没有对用户的兼容层或 runtime 依赖。

**Q7 — 简化、组合与认知。** 普通用户与框架作者没有新增入口、节点、状态或参数，原
core/patterns/solutions 组合保持。维护者多看到一个明确的 unknown/possible 状态与可展开
证据。用固定三锚点替代每样本校准，所有锚点在片段外；trace 仍有成本，不能宣称免费。

**Q8 — 局部替代（不是重开产品 A/B/C）。** A：仅把旧关联全部置 unknown。最便宜且立即
消除误导，但没有前向可用的采集证据。B：给旧 logger 和 trace-gc 各自补可靠锚点。保留
事件来源，但 Node 公共 API 不直接提供这两个 native 起点，容易引入 native hook/版本负担。
C：A 加 Node 结构化 trace、hrtime 区间和一个小夹具。复用 Node 已有时间源关系，代价是
实验性 trace 适配与受限事件覆盖；不尝试修复旧日志或添加 native addon。

**Q9 — 推荐 C。** 错误声明覆盖：是；前向校准可核实路径：设计已具体化、待实测；普通
用户成本：无代码变化；私有诊断开销：有、不能作性能资格；GC/deopt 全原因覆盖：部分，
明确限定主线程受支持 span；原控制差异的根因：未覆盖。接受后两项作为本批非目标，
不给诊断修复冒加 library 优化或完整矩阵。待用户批准第 5–6 节的实现与有限夹具，才进入 QA。

## 8. 当前交接

本轮只保存方案、设计算例/来源绑定及 docs index；不改 owner 决定、work 状态或 acceptance。
执行预算仍是提案，不由本页授予。沿用先前 OWN/PREDICT；human/agent teach-back 未验证。
下次可复述：unknown 为什么必要、δ 的方向、为什么边界只能 possible、真实夹具与 consumer
测量的区别、为什么 overlap 不能当成根因。人工工时与无 AI 对照未测量。
