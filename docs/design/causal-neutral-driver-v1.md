# 中立 driver：同批 hosted 对照与独立 preflight 次序

2026-09-10 · 基线 `796d7218` · 唯一 owner `graphrefly-ts`。
仍属 `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。本页是待批准的私有诊断设计，当前“同意，继续”
推进设计及 commit；未实现、未测量。沿用 project-governance、decision-guard 和 Q5–Q9。
不新增 D#，不改 D168 验收方法、library、公有 API 或 wave protocol。

**推荐使用从冻结源码派生的中立 driver，并保留同批 hosted 对照。**
它首先回答“将两边都放在外部调用位置后，控制差距怎样变化”，其次回答“在同一个中立
上下文内，交换预检先后会怎样”。不能把这两个问题扩写为已经分别测出 dispatcher、JIT、
namespace 属性访问或某个节点的独占成本。

## 1. 依据和本轮取舍

[第二次交叉诊断](causal-control-role-crossover-attempt-2/README.md)完整取得 8 进程、
19,200 样本。八次最终 external/driver 比值均 >1，范围 1.00379–1.22169，第三批也均
external 较慢；固定文件和固定加载次序没有统一方向。C1/C2 两次重复幅度仍明显变化。
这是选择调查方向的证据，不是根因证明，更不是 consumer 性能通过。

单纯把原 `runRow` 放进第三个完整业务 bundle，并不能得到干净的中立 driver：它会额外
加载第三份业务定义，容易把其本地 factory 或 preflight 再带回来。另一方面，手写更短的
cold loop 会同时改变分支、分配和异常清理结构，难以与原 loop 对照。

因此推荐只派生实验 driver 的必要函数，**两份业务 bundle 继续保持原字节**。加载顺序
这次固定，不继续展开所有轴；把新增进程用于同批 hosted 对照和 preflight 次序。

## 2. 入口和允许的源派生

材料仍来自 `archive/evals/causal-performance-repetition-v2/evidence.tar.gz`，两份 worker
SHA256 均为 `d9d8606d73e1bcfad66097f027d63c99fc409571042c5f1e7efffaa645356fb2`。
P2 输入与原资格绑定不变；`RECIPE`、`measurementArm`、`preflight`、`runRow` 已是该归档
bundle 的 export，无须给 library 或 bundle 添加 export。

只读 AST 检查确认以下顶层函数唯一存在；hash 对函数节点原文本的 UTF-8 字节计算，不含
相邻空白。AST 位置是 UTF-16 字符偏移，不能当作字节偏移。

| 函数 | SHA256 |
| --- | --- |
| `runRow` | `c36a27e4a40aaae9cec16aea83a5bfa9db5afff04ddd184eb392838645eec5a3` |
| `schedule` | `20db86119f6367133cb1534d3d94c9606d8a764801d8176c2fcbc4475c66063a` |
| `cleanupAll` | `512a11336f9831c67126edc36b62e214c29e5817be759788a9fbb2eda369d782` |

生成独立 `neutral-driver.mjs`，仅包含 Node built-in imports、原文 `schedule` / `cleanupAll`
和经过下述白名单替换的 `runRow`。不用第三份 Graph/Node/business 定义，不 tree-shake 或
重新编译两份业务 bundle。使用已有 TypeScript parser 解析归档 JS；不得凭字符串长度猜函数
边界。生成清单逐项保留原节点 hash、转换节点和派生 hash，源形状漂移即停止。

允许的 `runRow` 替换限于：

1. 接收入口已经顺序加载的 M0/M1 namespace 和实验坐标；前置检查仅允许精确
   `cold-P2-summary` / `control:true`。不添加通用 steady/recovery 支持。
2. 原模块本地/外部混合的 `makeArm` 改为两边共同的外部调用点：按 slot 选择 namespace，
   调用其 `measurementArm("reference", mode)`。选择和函数调用继续在原计时边界内；
   不在计时外提前构造实例，不缓存构造结果，不插入额外测量 wrapper。
3. 原本地 `preflight` → twin `preflight` 块替换为配置规定的两份 namespace 顺序，各执行
   一次完整原 preflight，对返回结果 deepEqual；按该顺序写计时外身份记录。共享同一已解析
   scenario，不能重新读取/复制输入来制造另一套分配历史。recipe 从 M0 的原 export 获取，
   并在计时外核对与 M1 相同。
4. 增加计时外诊断 metadata，标明 driver 类型、slot→module、preflight 次序。采样字段及
   原 metadata 内容保留。入口和派生 driver 都拒绝其他 row；原函数非 cold 分支的
   `graphSnapshot` 用明确抛错的私有 guard 绑定，绝不提供未经资格的 fallback。

除这些前置/绑定块外，原 `runRow` 的循环、计时、sample record、try/catch/finally 和
completion 节点须与归档源码一致，`schedule` / `cleanupAll` 全文相同。不是只比较字符串
包含几个关键词。保留三批 AB/BA/AB、100 warmup +300 measured、每样本 setImmediate、
memory 读取、计时外 JSONL append 与 cleanup，以及原错误/cleanup 错误合并顺序。
**cold 的时间是 `ms=end-start`，`constructionMs=0`、`preparationMs=0`。**

入口统一先加载只含工具函数的 N，再依次 await M0、M1。Hosted 条件调用选定 M 的原
`runRow(configPath)`；neutral 条件调用 N 的派生 `runRow`，传入 M0/M1。N 在 hosted
条件中不执行采样。所有单元共用这一导入约定；N 的额外解析会改变启动上下文，所以同批
hosted 是必要比较，不能直接把上批数值当作本批 baseline。

## 3. 六个单元：分离能分离的因素

M0/M1 文件名、输入及加载次序始终固定。reference slot / candidate slot 只是统计坐标，
两边都执行 reference 业务。中立条件没有“本地 factory”，下表仍保留原 reference slot，
避免把 hosted 的角色标签误当成中立条件的实际执行角色。

| 单元 | 谁执行 loop | reference slot | candidate slot | preflight 顺序 |
| --- | --- | --- | --- | --- |
| H0 | M0 原 runRow | M0 本地 | M1 外部 | M0 → M1 |
| N0 | N 派生 runRow | M0 外部 | M1 外部 | M0 → M1 |
| R0 | N 派生 runRow | M0 外部 | M1 外部 | M1 → M0 |
| H1 | M1 原 runRow | M1 本地 | M0 外部 | M1 → M0 |
| N1 | N 派生 runRow | M1 外部 | M0 外部 | M1 → M0 |
| R1 | N 派生 runRow | M1 外部 | M0 外部 | M0 → M1 |

- H0↔N0、H1↔N1：保持 slot、输入、加载和预检次序，比较 hosted→neutral 的**整组上下文
  干预**。loop 宿主、调用点和工具自身运行历史一起变化，不能单独归因于某次属性访问。
- N0↔R0、N1↔R1：在相同中立 driver、slot 和加载约定下，交换 preflight 次序。
  仍会受进程间环境波动影响；两次重复不能保证总体因果推断。
- N0/R1、R0/N1：物理 preflight 顺序相同而 slot 相反，可观察差距是否更接近 slot 顺序。
  slot 的 AB/BA/AB block 位置与 factory 在共同调用点的访问历史仍不能拆开。

## 4. 拟批准的单次预算

固定运行序列：**H0,N0,R0,H1,N1,R1,R1,N1,H1,R0,N0,H0**。
六单元各两次，正反位置配对；不根据结果换序、追加或挑选重复。

| 项目 | 上限 |
| --- | --- |
| 真实采样进程 | 12 个，全新、全串行 |
| 样本 | 28,800：7,200 warmup、21,600 measured |
| 随行 preflight | 每进程两次完整预检，共 24 次 / 72 个计时外实例 |
| 时间 | 每子进程 30 秒，整轮从首个 spawn 起 420 秒 |
| 自动重试 | 0；异常停下并保留所有剩余 not-run |

比上轮多 4 个进程，用于在中立条件内反转预检次序。Node/V8、flags 与原方案相同，仍不加
GC/CPU/node trace、强制 GC、额外预热或 provider/live/spend/effect；不并行运行测试/构建。
这是新的私有诊断预算，尚未授权，不是扩大 D168 的正式矩阵预算。

## 5. 实现后、采样前必须拿到的证据

- **源与字段资格：** 先对归档原文验证 AST 派生白名单及依赖闭合。先用全部保留的真实 cold
  样本验证字段、计时/分位数规则，再接受合成数据。不得重复把 fixture 自己的假设当作契约。
- **实际加载的 stub：** 六个条件都必须观察真实 import、preflight、factory 和 cleanup
  顺序。证明两份 module 各预检一次、N 不构造第三份业务、实际构造发生在计时区间内。
  注入错误 row/driver/slot、copy 自指、漏/重复/反转 preflight、缓存实例或漏 cleanup，均拒绝。
- **实际调用路径：** 加载生成的 neutral driver，在 fake clock / Node built-in 测试替身下
  跑 stub，验证冷构造字段、record 前后顺序和抛错/cleanup 双失败保留。不能只改 metadata。
  此资格不使用真实 worker 的测量循环，不产生额外 consumer 样本。
- **真正的业务 preflight：** 正式子进程用原 namespace 执行原预检，比较 graph/reference/
  plain 后果。工具测试中的 stub 不能替代它；预检失败消耗本次名额并停止。

独立 Python verifier 增加显式新诊断版本，保持既有 archive/replay 路径可独立使用。
它检查源派生 manifest 与限定 AST 修改证据、原/派生源码绑定、加载与预检身份、执行目录、
PID/argv、所有样本及完整退出。AST 结构检查可由独立只读 parser 输出；verifier 必须绑定
实际源码和该输出，不能只信 generator 的“转换成功”标记。

重新验证每批第 285 个 measured 排序值及三批 p95 中位数。分别列出所有重复和三批数据，
输出 candidate-slot/reference-slot、M1/M0、preflight 后执行/先执行的比值；hosted 才另注
external/local。核对整轮原始时间跨度及精确 12 进程库存，拒绝第 13 个进程、改时长、缺
样本/预检/完成记录或错误坐标。保持 complete-diagnostic / incomplete / invalid，不输出
性能 qualified，不扣控制偏差、不将旧样本合并成新结果。

## 6. 解释结果的预先约定

| 观察 | 下一步可优先做什么 | 不能声称 |
| --- | --- | --- |
| 同批 H 保留差距，N/R 接近对称 | 评估中立 harness 是否值得进一步资格化 | 原差距已精确归因；正式矩阵可立即转绿 |
| N↔R 的方向随预检先后移动 | 进一步隔离预检造成的历史差异 | 独立证明某个 V8 机制或 GC 根因 |
| N/R 仍更随 slot/block 移动 | 调查 block 调度及共同调用点的访问历史 | 普通用户必须新增性能配置 |
| H 不复现原方向，或重复互相冲突 | 保留不确定结论，审阅环境与原始批次 | 删除不利重复、改预算或自动继续采样 |

不预设新的“接近对称”通过阈值：报告完整数值，它只是描述。选择正式方法或成功 criterion
仍必须走其独立方法审阅；不借一次诊断改变 D168。

## 7. Q5–Q9 审查

**Q5 层次。** 私有 scripts 的测量工具，入口是两份既有 `measurementArm` export。
不是 graph primitive、library preset 或 profiler API。继续保证普通用户没有新概念和配置。

**Q6 风险。** INVARIANT：业务 bundle 与输入不变；派生循环只有白名单差异；cold 字段与
实际 producer 一致；不能把中立代码形状等同于相同 JIT 状态。派生工具的 parser/AST 形状
需随源 hash 显式失效，不支持自动跨版本迁移。剩余运行历史耦合是设计限制，不隐藏它。

**Q7 简化。** 只支持一个真实 cold row，避免建立通用 harness 框架。所有计时和 cleanup
都在私有工具；不改 graph 的依赖、authority、生命周期记录、分级隐藏或 dispatcher。
本批设计及后续私有工具不会给 library 增加运行成本，也尚未减少已有构造成本。

**Q8 可选形状。**

| 方案 | 优点 | 代价 / 先例 |
| --- | --- | --- |
| 手写精简 cold loop | 容易读、代码少 | 同时删除分支/分配结构；比较面更大。现有原 worker 可作对照，暂无资格化精简 loop |
| 源派生的中立 driver | 可列举原循环的精确差异；业务 bundle 不动 | AST 派生/独立验证有工具维护成本。已有 adaptWorker 的限定位点转换为先例 |
| 第三个完整 bundle 当 driver | 复用原完整模块 | 引入第三份业务定义及本地历史，容易重造不对称。现有双 module 控制不足以证明它中立 |

**Q9 推荐源派生方案。** 保留同批 H 对照，同时用 R 明确预检次序。覆盖 Q5/Q7 的产品边界
和可解释性；部分覆盖 Q6 的比较公平性，接受“整组上下文干预”限制；Q8 的源漂移通过 hash
与结构负对照拒绝。节点独占耗时、CPU/GC 归因及正式方法资格未覆盖，留在本 work 的后续
设计中，不自动展开。

下一项可批准的范围是：只实现上述私有派生/验证工具，先完成离线资格，再执行一次上述
12 进程诊断并提交全部证据。当前仅提交本页，旧设计、收据、root 修改和 work 状态保留。
