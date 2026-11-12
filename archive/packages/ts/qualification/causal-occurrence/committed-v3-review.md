# committed-v3：已批准的测试拆分与离线资格完成

Owner：graphrefly-ts；同一 work CAUSAL-COMMITTED-VIEW-TS。用户明确“批准” committed-v2 待审方案后执行。本批只修改离线测试的组织方式、三个 current 摘要及五个派生工件；生产 runtime、C/core、公共 API、wave protocol 与真实执行许可未变。

## 验收结果

- 原 120 排列拆为 120 个串行参数化 case 加一个 enumeration/support 对照；专项 121 passed，100 项因筛选未执行。全部候选/public/hidden verifier、6000 次显式 fresh VM context、rebinding/disjointness 和 bank-support 断言保留。
- 完整 no-network soak：221 passed，1085.69 秒。没有和本任务其他重测试并行；保留完整日志及结束标记。
- 默认全量：2257 passed，4 个原有 Podman live opt-in skips（3 个 local-untrusted-JS、1 个 PostgreSQL）。最终资格绑定与被验收源码一致。
- 原 causal/construction/cold mutation：73 / 25 / 16 分类检测通过。新 view mutation：11（8 实际输出、2 不可变、1 工作量）；另 2 项 deferred 邻接审计仅为结构检查，不计 runtime kill。
- 独立 plain-code/oracle：两臂各 12 场景、2 热输入顺序、33 行工作量/观测；原八 ports 分别对照冻结 ts-v8 和合格 d9c868dc，各 6 轨迹及 startup fault 一致。d9 对照添加一个空 view Node 匹配物理资源，不代表旧实现具备新能力。
- required-edge 168、incoming 144、资源 12 快照和 2 负对照、组合资源、browser、lint/typecheck、build/export、artifact、owner/workspace/dashboard 检查通过。

## 接受的取舍

用户批准将原来全部 120 排列合计 5 秒改为每个排列及 enumeration 各 5 秒。测试数从 101 变为 221；总验证工作未减少，不据此承诺更快，也不将通过解释为恢复了旧的合计 5 秒门槛。library 用户的入口、认知负担和 runtime 成本没有变化。

历史 committed-v2 的 96 pass/5 fail 及诊断继续保留；本次通过不证明首次超时或 grant 失败的历史根因。没有删除失败样本或重写旧收据。

## 性能与证据边界

独立复核 material-v1 原始 7200 构造样本、108 稳态 lifecycle 和六条对照轨迹；原四行 construction ≤1.20 / steady ≤1.10 均通过。全部被测 runtime 与实际 harness 摘要相同；431 个源码文件中唯一差异是本次测试文件，位于测量闭包之外。没有新性能运行，也没有新增性能提升声明。历史 1.839833 异常原因仍未知。

本次 receipt、archive 绑定命令、原始报告、源码、测试、runner、oracle、基线、运行前后摘要及静态审阅。批准本身是同一 work 的测试调整许可，不另立 D# 或执行 grant。

本批完成的是 private committed-effects view 及其离线资格。graph-owned lifecycle 与未终结义务仍不因 UI 退订而结算。按用户等级隐藏入口、完整 preset、业务 materializer/current-at-dispatch guard、真实 inbox 和 B121 仍未完成；没有 provider/live/spend 或自动下游工作。
