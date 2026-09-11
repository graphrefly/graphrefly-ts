# 第二次模块角色交叉诊断：八个进程完整，角色方向一致

2026-09-10 · owner `graphrefly-ts` · work `CAUSAL-PRESET-ASSEMBLY-TS`。
用户“好的，批准，继续”明确批准新的完整尝试。授权见 approval.json；设计仍为
[原交叉诊断方案](../causal-control-role-crossover-v1.md)，不新增决策或改变 D168。
基线 `2867455b`；源码只替换 runner 的 OUTPUT / APPROVAL 两个路径常量。

**本次 8 个进程、19,200 样本均完成，独立 verifier 重算一致。八次最终比值均是
external reference 比 driver/local reference 慢。** 这支持优先调查角色相关的调用和
运行历史；仍不能分辨 local/namespace 调用形态、driver 调度或 preflight 次序的独立贡献。
此次诊断完成不等于 consumer 性能验收通过，整个 work 仍未完成。

## 执行与绑定

固定顺序 C0、C1、C3、C2、C2、C3、C1、C0，全串行；每进程 2,400 样本。
合计 4,800 warmup、14,400 measured；随行 16 次 preflight 共 48 个计时外构造实例。
实际整轮约 11.8833 秒，8 个子进程均退出 0，零重试、零 not-run。
Node v24.18.0 / V8 13.6.233.17-node.50；原 flags、setImmediate、计时及清理边界不变。

仍使用原 D168 归档内的两份相同 worker、原 P2 输入。重新核对 321 个归档文件、60 个
运行依赖以及原 8 个已加载资格 case。source closure 未漂移；未重编译业务。
第一尝试的 2,400 样本、错误校验和后续离线修复全部保留，**不进入此次统计**。
普通用户、框架作者及 library 维护者均没有新增产品入口或配置。

## 描述性结果

下表均为每 arm 三批 p95 中位数之比；两次重复分别展示，不合并或取平均替代 p95。
两个 slot 实际测的都是 reference；candidate slot 名不表示本次测了业务 candidate。

| 单元 | 加载先后 | driver | 第一次 external/driver | 第二次 external/driver |
| --- | --- | --- | ---: | ---: |
| C0 | M0 → M1 | M0 | 1.046672 | 1.060463 |
| C1 | M0 → M1 | M1 | 1.186633 | 1.006458 |
| C2 | M1 → M0 | M0 | 1.221686 | 1.003794 |
| C3 | M1 → M0 | M1 | 1.116412 | 1.109263 |

8/8 最终 external/driver > 1，额外时延范围约 **0.38%–22.17%**。
M0 为 driver 时 M1 较慢，M1 为 driver 时 M0 较慢；加载较早或较晚的一方也不具有统一
快慢方向。这是观察到的角色相关性，不是随机因果实验或显著性检验。

第三批 external/driver 的 p95 比值在 8 次中均 > 1，范围约 1.08457–1.36975。
第一、二批没有同样一致的方向；同样的 AB block 顺序在第一和第三批呈现不同结果。
因此后续应把运行历史纳入调查，不能把它简单解释为一次 namespace 属性访问的固定成本。
完整三批及三个坐标的未舍入数值见 `archive/evals/causal-control-role-crossover-attempt-2/analysis.json`
以及便携包中的 `logs/independent-verifier.json`。

## 能证明什么，仍不能证明什么

- 有效的完整交叉记录已取得；模块角色和加载顺序按冻结计划交换，计数、进程身份、输入、
  入口、preflight、时钟差分及分位数经独立 verifier 核对。
- 仅凭固定文件身份或固定加载先后，不能解释此次所有最终差距方向。角色相关的不对称仍需
  优先处理；它可能影响后续对业务 candidate/reference 的性能判断。
- C1 的两次比值约 1.1866 / 1.0065，C2 约 1.2217 / 1.0038，重复幅度仍有明显变化。
  两次重复只用于有界筛查，不构成稳定效应大小或唯一根因证明。
- driver/local 调用、调度/分配历史和 preflight 次序仍耦合；role 与物理 module 的 AB 顺序
  也会一起变化。新入口预先加载两模块，不能声称逐字复现了历史入口。
- 原生 GC/deopt 时钟仍未校准，相关事件保持 unknown；没有新增节点耗时探针或 CPU profile。
- 不能把这些同代码控制比值当作 library、registry 或 C 方案的成本，不做控制偏差扣除。
  原 v1 rejection、80 not-run 和 D168 inconclusive/control-instability 完整保留。

## 验证与保存

9 项工具测试、33 个负对照再次通过，包含四份历史真实 cold 样本的字段回归和实际 Node
stub 的角色/加载测试。它们不启动真实 consumer 计时循环。两份静态 QA 对两个路径常量和
新授权绑定无可操作发现；其中一份只审阅 parent 提供的精确 diff/批准内容，范围在 review.json 中注明。

本批没有业务、库、测试逻辑、采样或 verifier 修改。上一批 2,547 passed / 2 既有 D159
failures / 4 skipped 的全量结果按源码不变复用，不声称新跑了一次 full suite；不重复
build/export/browser/soak。当前 lint/typecheck、dashboard、workspace authority 另行检查。
旧 attempt 的全部已跟踪文件与 root 的六个既有修改逐字节保留。

原始材料保存为本 attempt 的 `evidence.tar.gz` 和完整 `artifact-index.json`；独立验算在
新临时目录解包后再次运行，证明包可离线复核。此 replay 不执行任何 worker，也不创建样本。
仓库保留 `run/reservation.json`，不允许把同一次授权再次执行。

## 下一步（尚未启动）

建议细化**中立 driver 对照**：把测量调度移到两份业务 module 外，两边均通过外部 factory
调用，并把 preflight 次序及其历史作为明确实验坐标。先审阅怎样保留计时/清理规则和验证
工具开销，再决定是否采集。这是测量工具的进一步设计，不是重新选择产品 A/B/C。
本轮没有实现它、没有自动追加诊断、正式矩阵或 provider/live/spend/effect。

沿用用户 OWN/PREDICT 与 lifecycle 约束；本批仅私有诊断路径改变。分级隐藏易用性、用户
teach-back 和无 AI 工作效率未测量，不作成功或生产力主张。供之后复述：

1. 两个控制 slot 实际分别执行哪份业务 factory？
2. 本次交换了哪些坐标，还有哪些因素耦合？
3. 为什么 8/8 同方向仍不证明单一根因？
4. 新旧两次尝试为何不能合并成一份结果？
5. 中立 driver 对照会改变什么，必须保留什么？
