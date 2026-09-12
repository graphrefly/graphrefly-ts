# 构造窗口与 runtime 观测对齐：设计稿

2026-09-12 · 基线 `f911bfe9` · owner `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。
本轮只设计；没有实现、probe、consumer执行或新capture。D168/D169不变。

## 要回答的问题与诚实的能力边界

[保留日志审计](retained-runtime-audit/README.md)指出慢块所在进程的GC日志累计耗时更高，
但缺少窗口归因。本方案问：在同一进程的慢构造窗口中，是否观测到GC重叠、哪些源码栈
更常被采到，以及哪些窗口没有足够观测？**不承诺把每毫秒拆成互斥的CPU、GC和等待。**

GC事件区间可以与构造计时比较；CPU profile给出离散栈，不是函数精确耗时。
没有OS线程调度轨迹就不能区分被抢占、原生等待和其他未观测时间。profile空白保持未知。
这不是公共profiler或graph node计时能力；只服务一次私有成本诊断。

## 已核实的能力与仍需资格的前提

- 固定Node 24.18.0支持进程内`inspector.Session`的Profiler start/stop，使用本地session，
  不开放端口、不启用Debugger或precise coverage。[版本文档](https://nodejs.org/download/release/v24.18.0/docs/api/inspector.html#cpu-profiler)
- CPU profile含start/end微秒时间戳、samples及相邻采样timeDeltas；首项相对于startTime。
  这是采样时间，不是每个函数的占用区间。[协议](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-Profile)
- `performance.now()`以当前进程起点为零；GC `PerformanceEntry`进入同一性能时间线，
  回调送达时间与事件startTime分开保存。observer自身有开销。
  [Node 24.18.0 perf_hooks](https://nodejs.org/download/release/v24.18.0/docs/api/perf_hooks.html)
- 固定版本[Node计时源码](https://github.com/nodejs/node/blob/v24.18.0/src/node_perf.cc#L284)
  使用uv_hrtime；[V8 profile构造](https://github.com/nodejs/node/blob/v24.18.0/deps/v8/src/profiler/profile-generator.cc#L527)
  使用TimeTicks。V8源码还明确提醒CPU profile startTime不可直接当成Perfetto trace时钟。
  **本轮没有证明它与performance.now()可直接相减。**

后续准备须绑定实际Node二进制、OS/架构和相关源码，再完成下面的时钟资格。
源代码中的微秒字段不保证端到端只有1微秒误差；Darwin TimeTicks换算还涉及整数截断。
[固定V8 Darwin实现](https://github.com/nodejs/node/blob/v24.18.0/deps/v8/src/base/platform/time.cc#L684)
因此“请求250微秒采样”不等于实际每250微秒获得可靠执行证据。

## 推荐方案：本地 Inspector + perf_hooks，保留三个条件

| 条件 | 原有block process-CPU checkpoint | GC observer | Inspector CPU采样 |
|---|---|---|---|
| CONTROL | 保留 | 无 | 无 |
| GC | 保留 | 有 | 无 |
| GC_CPU | 保留 | 有 | 有，固定请求250µs |

GC/CONTROL描述GC观测开销；GC_CPU/GC描述增加CPU采样后的差异；GC_CPU/CONTROL也完整报告。
这些比较覆盖整个观测机制，包括安装/连接对VM的影响，不能称为纯采样回调开销。
不使用前几轮数据作本轮分母。保留EAGER逐条记录，不重新打开已结束的DEFERRED方向。

从当前已核实的同一reference/reference-copy、P2 summary、U/V、三批两槽、100warmup+
300measured派生。所有条件保留同一构造start/end、预检、yield、memory读取、清理和输出。
观测安装在加载两份consumer模块之前，覆盖预检和全序列；构造窗口内不增加函数包装、
手动标记、调度或native调用。只在整个序列外安装/停用观测，模块导入和预检单列。
不增加每个block的校准动作，避免重新改变块间状态。

成功收尾：最后清理与checkpoint→请求Profiler.stop（有则执行）→固定两次event-loop
让出并takeRecords→断开observer/session→写原始观测文件→completion。收尾及文件写入
全部由父进程资源监督覆盖。保留错误前缀；业务错误和观测/写入/断开错误并存；无重试。
GC回调内不打印、序列化或执行graph函数。保留start/duration/kind/flags/receivedAt。

## 时钟对齐：资格先于真实consumer

GC与构造都使用performance时间线，但只声称**已交付GC事件**的区间重叠，不证明完整GC。
两次让出和takeRecords不是事件完整性证明；晚到/越界/丢失可能性要报告。

CPU时间重建为`q_i = startTime + sum(timeDeltas[0..i])`，单位µs。不得先按1000µs等距补点。
对Profiler.start/stop的请求与回复分别用performance.now记录前后界：`[s0,s1]`、`[e0,e1]`。
在**后续源码资格证明两时钟速率关系与截断界ε之后**，才允许测试常量偏移模型
`p_ms = q_us/1000 + offset`：

```
I_start = [s0 - profile.startTime/1000 - ε, s1 - profile.startTime/1000 + ε]
I_end   = [e0 - profile.endTime/1000 - ε, e1 - profile.endTime/1000 + ε]
I       = I_start ∩ I_end
```

请求/响应包围实际profile起止的前提也须核对固定版本实现。只有两端交集非空不证明
中间时钟无漂移；速率/舍入/平台来源证明是独立条件，不用拟合斜率或取中点掩盖缺口。
平台关系不能证明，则CPU跨时钟归因不具备资格，停止准备，不启动consumer碰碰运气。

准备最多3次独立、无consumer的已知函数profile探针，每次最多1秒采样，10秒进程上限；
一个独立GC功能探针最多10秒、两个主动GC（仅probe允许该flag）；总准备探针≤40秒、
256MiB观测RSS/目录。不自适应增加探针次数或频率。实际consumer禁止强制GC。
这些是拟议准备预算，本轮未执行；准备阶段须先批准并固化probe输入和断言。

真实进程仍逐个保存起止包围界和I，不沿用probe偏移。I宽度≤0.1ms才接受窗口级CPU
分类；这只是相对约0.3ms构造尺度的保守工具精度门槛，不是性能标准。准备3个probe
有任何一个不能满足，工具不得标为capture-ready。实际运行越界则invalid并停后续。
对每个点保存映射区间`q_i/1000 + I`：完全落在一个构造窗口内才算确定归属；跨边界
记ambiguous；完全在窗口外记outside。不将不确定点强行塞进最近的节点。

## 输出与不重叠计数

1. **精确到观测区间的量：** 每个构造start/end，已交付GC区间并集与构造窗口交集长度。
   GC之间先求并集，不能重复累计；重叠不是被GC阻塞的因果证明，更不是全部GC成本。
2. **采样量：** 按模块URL/脚本ID/line/column/完整栈路径报告确定与不确定样本数量。
   叶帧self计数互斥；父调用链inclusive另表，不能与self相加。库、consumer、harness、
   runtime/native/idle/未知分别标识，两个worker命名空间分别保留。映射bundle到源码须
   重建相同JS字节再核对映射；无法验证的映射只保留bundle位置，不伪称原始node身份。
3. **覆盖量：** 每个窗口命中点数、零命中窗口数、实际采样间隔分布、长间隔、边界歧义。
   不把timeDelta全部算给某个栈，不补样；GC交集长度与栈命中比例不能组成100%饼图。
4. **慢/普通窗口：** 每个measured block独立按(ms降序,index升序)固定取最慢15/300个，
   其余285个全部保留；这是组内描述分组，不宣称复现历史异常。报告两组绝对时长、GC
   交集、栈计数及分母，不能只展示profile命中丰富或改善明显的窗口。无足够采样即unknown。
5. **干扰：** 所有同round/orientation/batch/position的p50/p95/构造sum/共同跨度及CPU，
   三种条件对比列全部比值，不把profile数据当未插桩性能。两轮方向混合照报，无显著性结论。

## 拟议一次真实采集的固定上限

**2轮 × 3条件 × 2方向 = 12个串行新进程**，每轮6组合随机固定一次。
2,400样本/进程，共**28,800**：7,200warmup、21,600measured、72measured block。
24次原三臂预检调用/72计时外实例。只有4个GC_CPU进程生成CPU profile。
采用两轮是为有限的可观测性诊断，不足以证明长期稳定性或替代D169控制资格。

沿用30秒/子进程、15分钟/整次、256MiB观测RSS/运行目录、100ms目标观测、>1秒gap停止。
每份CPU原始文件≤32MiB、samples≤200,000、profile nodes≤100,000；GC事件<100,000。
Profiler返回前的内存由父RSS监督；返回后才知道的数组/文件超限同样invalid，不能截断保通过。
Node24.18.0二进制、原flags/显式环境、60输入闭包和新工具全绑定；无inspect网络端口。
不改采样间隔、不补轮次、不替换失败进程、不提高资源线。准备失败亦消费届时的capture授权。

## 有限结束规则与后续权限

- 工具时钟/完整性/资源门槛失败：invalid，留存可保存前缀并停；不继续consumer采集。
- 有窗口级证据但无重复源码线索，或只有进程总量差异：unknown，本批结束。
- 有特定函数栈在慢组重复出现：只形成源码审查候选；先审查其语义和重复工作，不自动优化。
- GC重叠较多：只支持GC相关线索，不能据此删验证、加缓存、放宽生命周期或改registry。
- observer改变时长/慢组形态：仍报告，但结论限定在插桩条件；不推广为真实未插桩根因。
- 未出现历史1.414ms等极端尾部：照常结束，不以复现为理由追加采样。

本设计不改变正式日志、预算或公开API；先审阅设计，再准备与离线资格，真实capture单独授权。

## Q5–Q9

**Q5 位置：** 私有评测工具，已有CPU/GC sidecar为前例；不进入substrate、dispatcher或用户preset。
没有普遍library能力需求，不泛化为新注册表或用户概念。

**Q6 长期与不变量：** 时钟来源、样本完整性、清理、错误并存和一份授权只消费一次。
固定Node/平台变动须重新检查相应时钟假设；helper不能让工具复杂度进入library。
最大限制是源码/探针时钟资格尚未闭合，CPU采样不能精确分割CPU与OS等待。

**Q7 简化：** 复用原构造窗口、输入和清理，不逐函数包装，不新增graph节点、imperative入口或
额外业务依赖。三个条件保留区分两类observer开销所需的最小层次；不重测DEFERRED。

**Q8 替代：** A为推荐的本地Inspector+perf_hooks，有正式接口、无端口、可包围起止，缺点是
跨时钟资格和采样空白。B为CLI `--cpu-prof`，入口更简单但启动时的profile起点难由JS包围，
不能直接满足当前窗口归因。C为OS全线程调度追踪，可回答更多native/等待问题，但工具、
权限与平台复杂度更大；未证明必要前不纳入。这里的A/B/C仅是观测工具选择，与已选registry C无关。

**Q9 推荐A，有条件：** 私有位置/组合不变/有限预算覆盖；精确函数耗时与OS等待不覆盖并接受；
时钟和观察扰动仅部分覆盖，须经独立源码证明、probe和verifier资格，不能提前写成已解决。
如时钟资格失败，提交具体失败证据，不能静默切B/C或新建公共profiler。
