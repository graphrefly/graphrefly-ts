# 私有分级创建入口：同拓扑对照

本批承接已批准的 `../causal-completion-integrated-plan.md`，代码基线 `6d2a67eb`，
沿用 TS D170。没有新增架构决定、公共 package export、wave 规则或真实 I/O。

## 结论

自动入口与显式装配现在复用同一个冷节点构造器；原来的单 authority、资源独占 claim、
失败清理、一次移交和 startup 顺序保持一致。测试用手工装配仅展开 orchestration，
不复制业务节点。这补上了此前“完整 host 对无 host preset”无法回答的同拓扑对照。

7 个新测试核实 off/summary 两模式下实际节点 ID、factory、边、普通 view 的 DATA 流、
独立 plain-code oracle 的写入 payload、保留结果及 framework capability 原引用一致。
维护者仍观察原 graph；错误 graph、冷构造失败、重复启动通知分别有负例。
这是私有入口的分级消费与组合证据，不是普通用户易用性的人工研究，也不是公共入口发布。

## 性能

一次有限诊断：off/summary × size1/8 × 自动/手工及自动/自动负对照，共8 cells；
每 arm 5 warmups +20 measured，成对交替先后次序，每 cell 独立子进程。没有重试择优。
每一对都断言完整拓扑、oracle 写入、保留结果和全部 view DATA 流相同。

| 模式 / size | 自动构造均值 ms | 手工构造均值 ms |
|---|---:|---:|
| off / 1 | 0.3765 | 0.3606 |
| off / 8 | 0.3949 | 0.4246 |
| summary / 1 | 0.3884 | 0.3688 |
| summary / 8 | 0.3970 | 0.4326 |

差值方向随 cell 改变，且与相同代码负对照的波动重叠；不能归因出稳定的封装额外成本，
也不能据此声称零开销。size8 自动路径首批输入均值 off17.32ms / summary17.18ms，
模拟 completion 均值2.53/2.56ms，重订阅0.86/0.85ms。这里没有真实 I/O 等待。

`performance.json` 保留原始阶段时间、heapUsed 前后值、RSS、帧字节及源文件哈希。
RSS 是含两臂反复创建与 GC 的整个 worker，不能说成单 graph 占用；heap 差值不是
分配量或 retained-memory 证明。没有 steady-state 长期流、heap attribution 或正式矩阵结论。
原冻结1.20/1.10预算未变，D169仍 method-not-qualified，约100ms目标没有被替换成新门槛。
此前完整 host 的增量证据仍在 `../causal-integrated-implementation/`，不覆盖历史收据。

## 验证与审查

- 默认 TS 离线套件：2626 passed /4 skipped（157文件通过、1文件跳过），见 tests.log。
- 9个真实源码 mutation 的正常 controls 全通过，9个错误实现均由行为断言杀死。
  冷构造函数抽取后，保留结果 mutant 的定位锚点改到结果赋值；没有改弱行为断言。
- 同拓扑等价算法编辑：新源码/runtime 绑定通过；3种旧证据组合零写入；oracle payload相同。
- lint、源码/示例/测试类型检查、build与package export smoke、历史artifact完整性均单列日志。
- 独立 blind/edge 和 verification-gap 审查没有发现具体缺陷；性能由独立执行者采集，主执行者复核。
- lint-attempt1.log保留生成JSON缩进问题；仅格式化收据后修复。
  lint-attempt2-build-overlap.log保留并行构建尚未生成DTS导致的类型检查失败；最终lint在构建完成后运行。

只改私有 consumer 源文件与诊断/测试，没有变更 owner ledger，故未重复 owner gates。
整体 B121、公共渐进披露入口、真实 inbox 与正式性能资格保持未完成；不能称统一计划所有
性能验收项都已关闭。当前证据支持私有组合入口的行为等价，构造封装未测出稳定额外成本。

## 复核入口

- `examples/spending-alerts/causal-focused-host.ts`：composeOfflineSpending 与共享冷构造器。
- `scripts/fixtures/spending-focused-host-direct.ts`：显式装配对照。
- `packages/ts/src/__tests__/causal-focused-host-construction.test.ts`：7个构造/分级/失败测试。
- `scripts/measure-spending-construction-pair.mjs`：完整有限采样方法。
- `receipt.json`：本批源码、收据和日志哈希。旧baseline收据保留原样。

运行 `node scripts/measure-spending-construction-pair.mjs` 会写默认 performance.json；复核时应先
另存已有收据，不能把新的采样与本次合并。mutation/source-binding工具接受新输出路径。
