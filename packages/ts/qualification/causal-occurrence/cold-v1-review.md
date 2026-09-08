# cold-v1：私有 cold assembly 实施与资格审阅

Owner：graphrefly-ts；work：CAUSAL-COLD-ASSEMBLY-TS；依据 D160、D161、D162。用户在当前任务对精确 scope 回复「批准」。本批不 commit、不进入后续 consumer/preset 实现。

**资格状态：complete。** 获批的私有 cold assembly 切片及其适用离线资格完成；精确证据由 cold-v1-receipt.json 绑定。

## 本批改变与运行路径

原 causalOccurrenceBundle 与 causalComposition(...).composeFull 现在共用一个私有 cold builder。outer 先验证并捕获原 options，准备完整 manifest，创建唯一 startup，再让 builder 在同一个 ConstructionScope 内追加原 causal 闭包。outer 最后 seal、transferToGraph、startConstruction 各一次。原独立路径仍是 23 个具名节点，名字、创建顺序、原输出 ports 均保留。

新组合验收 caller 由两个真实外部输入分流为 left/right，汇合成 occurrence，沿真实 input lane → arrivals → authority → released，再分流为 value/count 并汇合为 final。一个 owner 持有整个组合，causal 子闭包没有另一个 startup、owner 或独立启动步骤。caller 使用 contract-v2 fixtures，尚未接入 spending-alerts 的真实四组业务输入。

authority 内部仍是 transitionCausalAuthority → identity/lifecycle/evidence 的有限推进 → 一次 ctx.state.set → 原有事实投影。新增代码没有改这些业务函数。scope 新增只读 assertContext，检查 cold phase、graph registrar、原始 startup 引用和最终 binding epoch；不在 per-DATA 路径增加工作。

| 文件 | 本批职责 |
|---|---|
| src/solutions/causal-occurrence.ts | 两个既有入口的固定 outer 构造步骤 |
| src/solutions/causal-occurrence/construction.ts | 原节点构造、options 捕获、名字与实际 topology 检查的唯一私有实现 |
| src/graph/construction-scope.ts | 有限 context 一致性断言 |
| src/__tests__/causal-cold-assembly.d162.test.ts | 18 项真实组合、故障、生命周期、context 与缓存顺序测试 |
| scripts/qualify-causal-cold-assembly.mjs | 新构造 mutations，区分结构拒绝、错误契约与 runtime 输出失效 |
| scripts/compare-causal-cold-standalone.mjs | 对冻结 ts-v8 实际 runtime 的原 ports/节点顺序/故障分类对照 |
| scripts/measure-causal-cold-resources.mjs | 实际组合 caller 的描述性资源记录 |

以上 src 路径相对于 packages/ts。原 73 causal、25 construction mutation runner 的目标语义未改，仅迁移提取后的 source/anchor；required-edge differential 同样只更新当前源码位置。没有新增 npm export 或公共 barrel。

## 验收与证据边界

| 范围 | 证据 |
|---|---|
| V1 冷组合 | 两条上游路径与两个下游投影；seal/transfer 前零 fn/root 订阅；单次启动 |
| V2 独立入口 | 冻结 ts-v8 receipt 和全部 98 份历史绑定文件；实际 baseline/candidate 运行原 8 ports，比较创建顺序、输出顺序、容量与 startup 故障分类 |
| V3 冷失败 | 取得点 1、4、12、26、29 后抛错；精确 node/dispatcher handle 集合恢复；共享消费者继续收到更新；既有 cleanup-error 定位测试继续保留 |
| V4 context | wrong graph/startup/epoch、sealed、最终 getter epoch、漏 union 成员；原重复名及未列名检查保留 |
| V5/V6 lifecycle | authority 已接纳 fixture effect 后末尾 root 启动失败，保留同一个 faulted owner；展示退订不能结算；错 outcome 不结算；精确 outcome/replay 仅结算一次 |
| V7 输入顺序 | 预存输入、晚到 required input、有限重复 DATA 批次、早到 admission/terminal；released 的原保留语义支持晚激活视图 |
| V8 依赖真实有效 | 三段真实依赖分别移除：先报告 topology 拒绝，再在隔离副本中绕过检查器、报告 started 后 business output 缺失；相同 bypass-only control 必须通过 |
| V9 成本 | 原 ts-v4 matched 口径、原四行 construction/steady 预算；ts-v8 提取前后描述性时延；组合 caller 另报绝对资源，不制造同保证历史基线 |

**既有边界：**晚订阅的 authority 投影不保证收到过去所有事实种类。测试按 released 的原保留语义验收早到数据；义务以实际 authority state 和活跃订阅接收的 conservation 事实验收。没有增加 authority replay buffer，不能从本批推导所有五端口都已可按需隐藏。

**mutation 解释：**旧 98 项继续按既有 runners 的契约断言记录。新 16 项分为 9 项构造/所有权断言检测、1 项错误契约检测、3 项结构拒绝、3 项 runtime 输出失效；不得将 16 项全部称作业务授权 kill。phase mutant 只使错误从 context mismatch 变为 construction is sealed；它没有成功构造错 context capability。runtime dependency arms 在隔离副本中实际切断依赖并绕过结构检查；相同探针先验证 startup 为 started，再检查固定 final 结果，失败不能归因于编译或构造拒绝。这里验证组合依赖负载，不验证真实 effect grant。

## 独立审阅与修正

静态 blind/spec 两路审阅完成后，已修复三个本批问题：

1. 双重 options 验证会改变 getter 的已有可观察顺序。现在通过私有 PreparedCausalOptions 一次捕获，builder 读取同一快照；沿用原先 validate-then-spread 行为，不扩成 options 契约修订。
2. 在归一化 binding 之前读 epoch 会错过 getter 改变。现在先冻结 binding，再用最终 epoch 校验 context；回归测试覆盖该路径。
3. 新 mutation runner 最初把错误文字变化计作行为 kill。最终 runner 明确分类，并补充三段依赖的 runtime probe 和 bypass-only 对照。原失败/被替代尝试均保留，不作为最终通过证据。

两路最终静态复审没有剩余 actionable finding。没有自动选择新的架构或修改 wave protocol。

## 离线验证

已通过：专项 103、默认 suite 2,239（4 项原有 opt-in 跳过）、显式离线 root soak 101、browser smoke、lint/typecheck、build/export、no-network artifact、workspace authority 与 dashboard。原 73 + 25 mutations 全部检测，新 16 项按上述分类检测；required-edge helper 168、incoming differential 144、独立 resource verifier 12 snapshots + 2 负对照均通过。冻结 ts-v8 六条轨迹及 startup fault 比较通过。

组合 caller 的最终 12 个描述性样本均记录 29 owned nodes、39 总节点、39 条实际边、3 个 owned root leases、28 个活跃 dispatcher handles（其中 1 个来自外部 fixture）。冷构造含 fixture setup 的 median 0.639 ms；seal/transfer/start median 1.123 ms。GC 后进程级 retained heap delta 的 median 为冷态 126,368 bytes、启动态 174,660 bytes；包含 JIT/进程噪声，不能当作每个 owner 的精确分配量。每个样本都完整清理到 0 nodes/0 handles。原始 12 行全部保留。

原预算四行全部通过，以下为未四舍五入判定后的展示值。使用原 ts-v4 冻结基线与相同物理资源口径；基线本身不具备 C ownership 保证。

| occurrence / evidence / 背景节点 | 构造 aggregate p95 比值 | 稳态比值 | 三个构造批次比值 |
|---|---:|---:|---|
| 1 / 0 / 0 | 1.1254 | 0.9772 | 1.0157 / 1.1222 / 1.1283 |
| 16 / 128 / 0 | 1.1130 | 1.0013 | 1.1393 / 1.1505 / 1.0539 |
| 64 / 512 / 0 | 1.1329 | 0.9959 | 1.1021 / 1.1173 / 1.1728 |
| 1 / 0 / 1000 | 0.7052 | 1.0477 | 0.6580 / 0.7763 / 0.7027 |

原构造门槛 ≤1.20，稳态 ≤1.10。普通无 C 图的 median 比值为 1.0110，作为额外描述性回归；动态创建/释放的 5 组、每组 200 次运行全部保留。全部原始 ns、所有批次与基线/candidate 闭包在 cold-v1-construction-comparison.json 中，未缩短 timeout、删样本或挑选重跑。全部命令、日志、输入闭包及失败尝试绑定于 cold-v1-receipt.json。

原 audience design manifest 使用已经批准的不可变字节格式；biome 只为该文件追加到已有 formatter 例外，保留其 hash，JSON/schema/linter 检查仍运行。源闭包变化使 no-network root eval manifest 及五个生成 artifacts 需要刷新；只运行既有离线生成与检查，没有改 operator configuration/grant 或执行 live。

## 已证明与后续义务

本批证明一个 private cold builder 可以在调用方同一 scope 中完成真实上下游组合，并由运行实例保留义务直到精确 terminal。UI 退订和 startup fault 均不能被当作 end lifecycle。

尚未证明：普通用户五端口的按需隐藏；完整 spending-alerts preset；真实 policy/grant/verifier 输入；exact request/payload port；本地 inbox current-at-dispatch、consume-once 和真实写入；root B121 或旗舰 S1–S8、audience E1–E10 的完整资格。这些需要后续设计/实施批准，本批结果不会自动派发它们。

## 给维护者的交接检查

代码与 agent 证据包包括本说明、revision-bound 收据、实际 mutation patches/失败信息、冻结 baseline、原始轨迹和所有命令日志。人类理解尚未验证；下列问题用于后续讲解，无需通过它们才能阅读本批交付：

1. 为什么 builder 能追加全部节点，却不能自行 seal 或 start？
2. graph、startup 和 epoch 中任一错配，在哪一步被拒绝？
3. 末尾视图 root 启动失败后，谁继续持有已经 admitted 的 effect？
4. 删除一条边时，结构拒绝和实际输出失效分别证明什么？
5. 本批通过后，为什么仍不能宣称普通用户五端口或真实 inbox 已完成？
