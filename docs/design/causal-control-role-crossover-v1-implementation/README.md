# 模块角色交叉诊断：首进程后停止，保留样本离线修复

2026-09-10 · owner `graphrefly-ts` · 同一 work `CAUSAL-PRESET-ASSEMBLY-TS`，仍未完成。
设计基线 `eb0de27d`，用户“好的，继续”批准[原方案](../causal-control-role-crossover-v1.md)
中的工具实现、一次有限诊断及 commit；精确非决策授权见 approval.json。
本批为尝试与修复证据，不新增 D#，不改 D168 的验收方法或历史收据。

**诊断启动了 1 个真实进程，取得 2,400 个样本，然后因新校验器的错误停止。**
剩余 7 个进程没有启动，没有重试。已修正字段校验，并用保留样本完成独立离线回放；
整个交叉实验仍为 `incomplete`，不能声称找到了性能根因。

## 发生了什么

路径为固定归档 → 私有 Python runner → 两个 module 的顺序 import → 选定 driver 的原
`runRow` → 原始样本 → 独立 Python verifier。两份 bundle、P2 输入、计时循环未修改。
原归档 321 个文件、60 个运行源码依赖及 8 个已加载资格 case 的绑定均已核对。

C0 按 M0→M1 加载，M0 为 driver/local reference，M1 为 external/candidate slot。
Node v24.18.0 / V8 13.6.233.17-node.50；PID 99203；子进程退出码 0，原 worker 的业务
preflight 和 completion 均通过。三批每 arm 100 warmup + 300 measured，共 2,400 样本，
其中 600 warmup、1,800 measured；随行两次 preflight 共构造 6 个计时外实例。
子进程约 1.681 秒；原 runner 在约 1.695 秒处保留 incomplete 收据。

错误来自本次工具：它要求 `constructionMs == ms`。冻结 worker 的 cold 分支实际用
`ms = end - start` 记录构造时间，而 `constructionMs` / `preparationMs` 保持 0；
`constructionMs` 是非 cold 分支的计时外准备字段。新 runner 和新 verifier 都误用了这一
假设，合成测试也重复了它。这是本次实现错误，不能归咎于 Graph、registry 或 C 方案。

原始执行脚本快照、错误停止原因、退出记录、所有样本和原 index 均保留。修复只把 cold
字段检查改为 `constructionMs == 0`、`preparationMs == 0`，仍要求严格 `end-start == ms`。
新增四个历史真实控制的 9,600 样本回归，避免合成 fixture 再次充当字段契约的唯一证据。
独立实现本身不保证独立发现共同的契约误读，必须与实际 producer 字节及保留输出核对。

## 保留样本的结果与边界

以下为修复后的独立 verifier 对同一 C0 样本的重算，未重新运行 worker。

| 指标 | external / M1 / candidate slot | driver / M0 / reference slot |
| --- | ---: | ---: |
| 第一批 p95，µs | 429.667 | 517.334 |
| 第二批 p95，µs | 371.791 | 413.375 |
| 第三批 p95，µs | 388.042 | 625.709 |
| 三批 p95 中位数，µs | 388.042 | 517.334 |

external/driver、M1/M0、后加载/先加载在此单元均为 **0.7500802189688621**。
完整未舍入值在 `retained-replay.json`。这只是 C0 的一个观测，缺少 C1/C2/C3 和第二轮，
没有任何交叉证据允许把差距归于 driver、调用形态、预检或加载顺序。
不能把它当成优化收益、稳定控制或性能通过。新入口也不等同于历史入口。
原 v1 rejection/80 not-run、D168 的 inconclusive/control-instability 均不变。
原生 GC/deopt 时间仍无校准关联，保留 unknown。

## 验证与审查

- 修复后 9 项工具测试通过，33 个负对照 case 被检测：其中 12 个实际加载 Node stub
  入口变体；其余为 verifier 原始输入/完整证据变体。不同 bundle、错 driver、自指 copy、
  反转加载、错样本身份/phase/order/时长、漏 completion、第九进程和伪造整轮时限均受检查。
  测试中的 Node 仅加载 stub；没有额外 consumer 计时、试跑或热身进程。
- 独立 verifier 核对原归档、运行 index、原始执行身份、入口/配置、preflight、全部样本和
  分位数；离线回放验证 1 个保留单元，但保持 `incomplete`、七个 not-run 和
  `performanceQualification:false`。CLI 退出码 1 表示整体未完成，不伪装完整实验通过。
- 两份静态 QA 发现并修复：从进程时间重算整体跨度、拒绝额外执行证据、准备失败也保留部分
  收据。两份最终复核覆盖 cold 字段修复与 partial replay，没有剩余实质性问题。
- 全量 TS：2,547 passed / 2 既有 D159 manifest failures / 4 skipped；lint/typechecks
  通过。两个失败与本批前一致，不修改冻结 D159 manifest 来转绿。
- 不改 library、public export、wave protocol；本批不重跑 build/export/browser/soak，
  不新增 library runtime mutation 资格。已有实际 authority/业务 mutation 证据继续由
  其原收据承担。

首轮工具测试因 macOS 临时目录 `/var` 与 canonical `/private/var` 的测试路径问题失败，
修正测试 setup 后通过；该失败也保留。此前通过的合成测试不能替代本次补上的真实字段回归。
所有 gate 尝试均保留，不能只挑最终通过的日志。

## 工件与继续边界

便携包：`archive/evals/causal-control-role-crossover-v1/evidence.tar.gz`；完整文件 index 与
本页 receipt.json 绑定原始 run、日志、执行时工具快照和修复后工具快照。仓库保留
`run/reservation.json`，使同一命令在当前目录及新 checkout 都不能重复占用这次运行。
离线验证应将包解压到新的临时目录，读取其中 run；验证器支持保留的原执行路径坐标，
不 import 或执行 worker，也不覆盖历史结果。

按原方案“重试 0”，本轮到此停止测量。若继续，需要重新明确批准一次完整的 8 进程交叉
诊断及独立输出位置；不能把本次 C0 挑入下一次完整结果。当前工具修复与保留数据回放已完成，
新增测量未获得授权，也没有任何 provider/live/spend/effect 或正式矩阵 dispatch。

沿用此前 OWN/PREDICT：本次纠正的具体链路是 worker 的 cold 输出字段如何进入 verifier；
此前担心的 graph 生命周期和 imperative 逃逸不是本次库变更。用户理解、分级隐藏易用性与
人工生产力收益仍未验证。无 AI 耗时/审阅耗时未单独测量，不作收益推断。

供之后闭卷复述：

1. 冷构造时间在原 worker 的哪个字段里？
2. 同字节 module 还可能有哪些不同的执行历史？
3. 为什么本次 2,400 样本不能回答角色交叉的问题？
4. 原始失败收据与修复后的离线回放各证明什么？
5. 再次测量的授权边界是什么？
