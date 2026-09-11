# Consumer 控制组：模块角色与加载顺序交叉诊断提案

2026-09-10 · 基线 `93011006` · 唯一 owner `graphrefly-ts`。
同一 work：`graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`，仍未完成。

**建议先查同代码差距是否随模块角色或加载顺序变化，再决定在哪里加构造探针。**
本页是待审阅的私有诊断方案；当前“继续”推进设计及提交，不启动实现或测量。
它不改 `graphrefly-ts:D168` 的性能验收方法，不新增 D#、work 或公共入口。
下一次批准的具体范围为：实现下述离线工具、完成工具资格检查、执行一次有上限的交叉诊断并提交证据。
不是自动恢复正式矩阵、CSP-11 或任何 provider/live/spend/effect 工作。

## 1. 已有事实与尚缺的证据

- [只读控制审计](causal-performance-control-audit-v1/README.md)确认：两个 module 字节相同，
  控制组两边都测 reference factory；但只有 original 驱动 `runRow`、调度、记录和本地调用，
  copy 通过 namespace 属性被调用，模块加载顺序固定。四个控制均未满足 1.05 容限。
- [保留 trace 的修复与回放](causal-console-marker-replay-v1/README.md)已证明特定 fixture
  的 console async marker、时钟区间及已记录事件可以独立验证。它没有产生 consumer 样本。
  当前 helper 限定 empty/gc/deopt 三窗口，不能直接宣称支持 consumer 节点计时。
- 原 D168 试验仍为 `inconclusive/control-instability`；原 v1 比值 1.211671 的 rejection
  和未运行的 80 行保留。均值约 1.0264 不能替代资格，也不能扣除控制偏差后认定通过。
- 当前无法区分 driver/local 与 external 调用角色、加载历史、预检历史或系统波动。
  allocation-site 事件数不是函数耗时。旧原生日志的 GC/deopt 时间关联仍为 unknown。

目标问题很具体：**两份相同 reference 的时延差距，是否随着可交换的运行角色而移动？**
若移动，下一步可优先调查 harness；若不稳定，不能据此优化某个 Graph 节点。
这不是重新选择产品 A/B/C，也不改变单一 authority、生命周期保留、可组合性或分级隐藏方向。

## 2. 推荐的最小干预

使用原归档 `archive/evals/causal-performance-repetition-v2/evidence.tar.gz`，不重编译业务。
只读核对归档及 index；仅将白名单中的普通文件复制到全新诊断目录，拒绝链接、路径逃逸、覆盖旧文件。
两份 worker 自包含业务依赖，外部静态 import 仅为 Node built-ins；保留原字节和文件名。

| 固定材料（tar 内路径） | SHA256 |
| --- | --- |
| `method-validation/worker.mjs`（M0） | `d9d8606d73e1bcfad66097f027d63c99fc409571042c5f1e7efffaa645356fb2` |
| `method-validation/worker-copy.mjs`（M1） | 同上；两文件各 368,125 bytes |
| `method-validation/P2-inputs.json` | `44f1165557fc1444540731a73846233ce3d71da7a0af3a3d4fa2137e249c2079` |
| `method-validation/reference-qualification.json` | `d6748e269f7c86cd838099e405a3eda70705b9bfdcff711fda630c2035afe60e` |

归档 SHA256 `3483b61f34da607ccd04ff99b86e49d14e90584f843ff3aefcf2640d60a4fbd7`。
上表是当前只读计算所得设计绑定，不是新运行收据。原完整资格及其依赖绑定仍需在实现时核实。

新入口按单元规定的顺序 **await import 第一个，再 await import 第二个**，随后调用指定
module 的原 `runRow(configPath)`。`control:true`，`copyModule` 指向另一个 module，
row 固定 `cold-P2-summary`。不插入新 factory wrapper、不修改 bundle 或原 D168 runner。
配置只更换输出路径、输入文件路径与 copyModule URL；输入字节及业务语义固定。

| 单元 | 先加载 → 后加载 | driver / 本地 reference slot | external / candidate slot |
| --- | --- | --- | --- |
| C0 | M0 → M1 | M0 | M1 |
| C1 | M0 → M1 | M1 | M0 |
| C2 | M1 → M0 | M0 | M1 |
| C3 | M1 → M0 | M1 | M0 |

candidate 仅是原样本 slot 名，两边实际都调用 reference。每次进程只执行一个单元。
固定进程序列为 **C0, C1, C3, C2, C2, C3, C1, C0**；四单元各两次，位置正反配对。
不随机追加、不按好坏换序、不运行到稳定为止。位置平衡不能消除机器漂移或非线性历史影响。

所有单元统一采用预先加载两个模块的入口。因此 C0 也不是历史原入口的逐字重现：历史 copy
在进入 driver 的 `runRow` 后才加载。目录重定位和入口结构也可能影响运行；这轮比较的是
**统一新入口内的交叉差异**，不能宣称重现或解释历史差距的全部成因。

`adaptWorker` 已固定两处计时 factory 调用以及 control 分流，见
`scripts/spending-preset-repetition.mjs:52`；原计时/清理循环见
`scripts/fixtures/spending-preset-performance-worker.ts:197` 和 `:329`。
继续保留每样本 setImmediate、时钟边界、memory 读取、计时外日志和计时外 cleanup。
各 module 仍按原序各做一次完整 preflight：先 driver，后 external。
**角色、local/namespace 调用形态、preflight 次序仍捆绑，不能从本轮分辨三者的独占成本。**
AB/BA/AB 仍按 slot 排列；交换 driver 时物理 module 的先后也会交换，必须同时报告这两种坐标。

## 3. 一次执行的预算及停止边界（待批准）

| 项目 | 固定上限 / 内容 |
| --- | --- |
| 测量进程 | 8 个，全串行，同一机器；每个全新 Node 进程 |
| 每进程 | 3 batches × 2 arms × (100 warmup + 300 measured) = 2,400 样本 |
| 合计 | 19,200 样本，其中 4,800 warmup、14,400 measured |
| 计时外 preflight | 每进程 2 次，每次构造 candidate/reference/plain 各一份；全轮共 48 个实例 |
| 时间 | 每子进程 30 秒；整轮自首个 spawn 起 300 秒；超时终止并收集已写证据 |
| 重试 | 0；中途异常停止，其余明确 not-run，不补齐、不重采 |
| 运行环境 | 与原样本一致的 Node v24.18.0 / V8 13.6.233.17-node.50；不一致则不启动 |

保留原 flags：`--trace-gc --trace-deopt --log-deopt --no-logfile-per-isolate --logfile=v8.log`，
每个进程有独立 cwd/log。保留原生日志但不使用它们的未校准时间作事件关联。
不增加 structured trace、CPU sampling、节点计时、强制 GC 或额外预热。
不与 build/lint/tests/其他测量主动并行；记录平台、架构、可执行文件 digest、完整 argv/env
中影响 Node 的选项及资源状态，敏感环境值不收集。NODE_OPTIONS 等隐式注入不允许改变 recipe。

上述预算只覆盖诊断采样及随行 preflight。实施前的确定性工具测试另行记录，不能调用原
`runRow` 偷跑样本；使用 stub modules 和离线样本验证入口/验证器。八个测量进程之外没有
“试跑”“热身进程”或额外基线。每个正式子进程自带原业务 preflight；失败也消耗本次名额。

## 4. 证据、独立验证与解释规则

每个子进程保留：入口和配置原字节、两个 bundle/input digest、加载顺序与 driver 映射、
PID/退出信息、preflight、metadata、全部 warmup/measured JSONL、completion、stdout/stderr
和原生日志。计时循环外记录 import 完成顺序，不向 timed loop 插入记录。输出目录必须全新且
与源归档隔离；整体 index 绑定所有原始和派生材料，失败/超时也生成可审阅的部分收据。

独立 Python verifier 不 import JS reducer/runner：

1. 核对归档、输入、bundle、入口/配置对应关系、8 槽位固定顺序和实际退出状态；不能只信 report。
2. 核对每样本唯一身份、三批 slot 顺序、phase/index、有限非负时长及 end-start 一致、完整计数。
3. 每批 300 measured 取第 285 个排序值为 p95；每 arm 取三批 p95 中位数；输出 external/driver
   比值，以及直接由对应 arm 中位数计算的 M1/M0、后加载/先加载比值，保留未舍入数值。
4. 两次重复分别列出全部三批及最终比值；不合并样本，不用平均值代替 p95，不新造显著性阈值。
   只输出 `complete-diagnostic` / `invalid` / `incomplete`，不输出性能 qualified/pass。

资格负对照必须实际加载被改变的**诊断入口或 verifier 输入**：错 driver、错 copy 指向自身、
错加载次序、不同 bundle、重复/漏样本、错误 phase/order、修改时长、漏 completion 均应拒绝。
入口可用具有独立身份且记录调用次序的 stub modules 验证，不能仅改一份描述 JSON 就声称测到了
角色交换。另检查生成入口确实引用原归档 bundle；实际业务 preflight 在每个诊断子进程执行。
这些 mutation 证明诊断工具会拒绝错误路径，**不是新的 library runtime mutation 资格**；
已有 authority/业务源码 mutation 证据继续由原收据承担，不追加实际 effect。

| 观察到的模式 | 能支持的下一步 | 不能推出 |
| --- | --- | --- |
| 换 module 后差距仍跟随 external/driver 角色 | 优先细分调度/分配历史、preflight 顺序与调用形态 | namespace 访问本身就是根因 |
| 换 driver 后差距仍跟随加载先后 | 优先设计加载/初始化历史的进一步对照 | V8 某个优化已被证明导致变慢 |
| 差距跟随 M0/M1 文件身份 | 检查 URL、源码位置和 harness 绑定 | 同字节保证同一运行状态 |
| 两次重复/各批不一致，或因素互相作用 | 明确保留未定位结论，审阅原始分布和环境证据 | 删除不利样本、扩大容限或自动重跑 |
| 各组均无明显差距 | 新入口下未见历史现象；报告全部数值 | 历史失败消失、正式性能通过 |

模式可同时出现；不强行选唯一标签。两次重复是有界筛查，不提供总体统计或因果保证。
任何后续采集/优化都需先给出具体方案，不能由表格自动 dispatch。

## 5. Q5–Q9 设计审查

**Q5 — 层次与抽象。** 放在私有 scripts/evidence 层，复用已有真实 consumer reference；
新入口只排列 module，不提炼通用 profiler 或 graph API。证据是
`scripts/spending-preset-repetition.mjs:52` 已有角色分流。普通用户、框架作者及 library
维护者均无新产品配置；维护者只在诊断工件中看到运行坐标。

**Q6 — 长期风险与隐含不变量。** INVARIANT：两个归档 bundle 字节相同、独立 URL/module
实例、copy 不能指向 driver；计时循环和业务字节固定；所有单元入口规则一致；不将两次
重复视为稳定性证明。冻结 Node/V8 和材料 digest，漂移即停止，不给版本维护承诺。
角色/调用形态/预检顺序耦合及新入口偏离历史是明确剩余风险。

**Q7 — 简化与可组合性。** 不改变 graph 拓扑、dispatcher、authority 或依赖生命周期，
也不加 runtime registry。既有 preflight 在 driver 及 external 两边核对实际图与 plain
业务后果。诊断进程的 import 顺序属于实验控制，不是产品 imperative 入口。
零新增库代码，因此本批不会给库引入额外运行开销；它也尚未降低已有构造开销。

**Q8 — 三种诊断路线（与产品 A/B/C 无关）。**

| 路线 / 形状 | 优点 | 代价与局限 / 已有先例 |
| --- | --- | --- |
| 模块交叉：ordered imports → selected runRow | 原业务与计时字节不变；可观察差距是否移动；无新探针 | 角色因素仍耦合；只筛查。先例是原 D168 双 module 控制 |
| consumer trace：calibrated anchors + consumer windows | 可定位记录到的 GC/deopt 与构造窗口关系 | 需扩展三窗口 helper；需另测插桩干扰；仍不能直接给节点独占耗时。先例是刚完成的保留 trace 回放 |
| 中立 driver：third module → two external factories | 使两边调用形态更接近；有望改善控制对称性 | 重写计时/调用上下文；无法先知道原差距由哪处造成。当前无已资格的中立 driver |

**Q9 — 推荐模块交叉。** 它先处理源码已经证明存在的不对称，复用真实 consumer 和计时
循环，成本与可回答问题均有明确上限。

| 关切 | 覆盖 | 剩余处置 |
| --- | --- | --- |
| Q5 私有边界 / 用户认知 | 是 | 无公共入口变化 |
| Q6 精确材料与预算 | 是 | drift/超时保留失败，不替换材料 |
| Q6 因果可识别性 | 部分 | 接受筛查局限；不声称独占成本或自动优化 |
| Q7 graph 组合与生命周期 | 是 | 复用实际 preflight；产品实现不变 |
| Q8 节点/事件耗时归因 | 否 | 本轮先判断混杂因素；细粒度探针另作有干扰对照的设计 |

下一项是批准这份有限诊断的实现及单次运行范围。当前只提交设计，D168、旧收据和 work
状态不变。human/agent 可审阅的材料是本页以及未来的逐单元原始证据，不宣称已证明分级隐藏
易用性、人工生产力收益或 teach-back 成功。
