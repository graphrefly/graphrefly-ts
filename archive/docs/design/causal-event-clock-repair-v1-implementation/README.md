# 私有事件时钟修复：真实资格尚未通过

2026-09-10 · owner `graphrefly-ts` · 基线 `1fa9171d` · `CAUSAL-PRESET-ASSEMBLY-TS` 保持 incomplete。

**旧日志的错误关联已移除；真实 trace 资格未通过。** 本批只执行一次独立夹具，无重试、
无 consumer 测量，无 library/public API/wave protocol 修改。原性能差异的原因仍未确定。

## 实际变化

两个 performance runner → report → `legacyCorrelation` → 原事件、来源 digest 和 unknown。
不再传递 uptime offset；空日志也不是“无事件”。两个 runner 的源码绑定补入新 helper。
`percentile/summarize`、repetition estimator/decide、worker 和所有 library 源码未变。

新私有关联器核对 manifest/原始字节 digest、身份、Node/V8、单位、三个锚点及其交集、主线程、
完整首个 trace 分片、同步 B/E 与 X、标记 hrtime 边界、跨时钟顺序和窗口包含关系。
缺证据为 unknown，边界不确定为 possible，零时长不声称正时长重叠；覆盖外的事件为 unknown。
独立 Python verifier 从原始数据重算，不导入 helper；当前真实输入在标记核对处被拒绝。

## 唯一一次采集

用户在具体设计/30 秒/零重试提案后说“好的，继续”；见 [approval.json](approval.json)。
原始材料位于 [archive](../../../archive/evals/causal-event-clock-repair-v1/)。

- 一个 fixture 子进程，Node v24.18.0 / V8 13.6.233.17-node.50，监督器上限 30 秒。
- 外层耗时约 0.098 秒；fixture 退出码 0，collector 与独立 verifier 均为 1。
- 保存 31 条 trace 记录、三个锚点、三个窗口、manifest、stdout/stderr 和当时工具源码。
- 主线程确有一个 MajorGC B/E span、两个 V8.DeoptimizeCode X span。
- **console 标记实际是 `time::<run>:<window>`，使用小写异步 b/e，带 id: 0x0。**
  先前方案误以为是无此前缀的同步 B/E。当前解析器找不到预期标记，返回 unknown。

[原始拒绝结果](../../../archive/evals/causal-event-clock-repair-v1/capture/correlation.json) 保留。
没有把异步事件套入同步栈，没有修改采集参数或覆写失败收据；观察到事件不等于完整关联资格。

## 验证

21 个 helper 测试通过，含保留真实 trace 的拒绝回归。六个实际加载的 helper mutation 被行为
断言检测：旧 uptime-only、删身份检查、反转 offset、删精度边界、缺失当空列表、宽误差取中点。
正向 mutation 判别使用合成输入；真实 trace 目前只证明拒绝路径，不是 Graph runtime mutation。
原统计工具另有四项、repetition 统计/结构/verifier 七项定向测试通过；未执行 consumer timing bodies。

全量 TS：2,547 passed / 2 已有 D159 manifest drift failures / 4 skipped。lint/layer/typecheck 通过。
公共 API 未变，本批未增加 build/export/browser/soak。两个静态 reviewer 的发现均已修复：
缺类别误报、异常写文件后的子进程清理、零长度窗口、首分片丢失、跨时钟顺序及标记包含检查。
最终静态复核无未解决发现。

[旧证据更正](../../../archive/evals/causal-event-clock-repair-v1/legacy-correction.json) 验证全部
321 个归档文件，独立重算 67,200 样本，原 verdict 仍为 inconclusive、qualified=false。
全部 50,400 measured coordinates 的关联明确 unknown。原 v1 的 1.211671 rejection 和 80 not-run 保留。

首轮 lint 发现上一批三个证据 JSON 的格式问题，按既有 formatter 例外机制保留其原始字节。
首次只读提取因 macOS 临时目录 symlink 的安全路径比较而停止，双方 resolve 后通过；未采集。
两次纯文件写入命令被环境文件安全 hook 拒绝，未执行；工具改为显式最小子进程环境。
这些错误、修复和最终日志均保留，不增加 fixture 次数。

## 下一步提案，尚未实现

只补 Node v24.18.0 console 异步标记适配：按完整 run/name/category/PID/TID/id 匹配 b/e，
核对重复 begin、孤立 end、跨身份和未关闭标记；GC/deopt 的同步 B/E 与 X 规则保持分离。
用已保存 trace 做离线重放、独立 verifier 与负对照即可，**不需要新采集进程**。
先纠正标记格式假设；未来若离线适配通过，另出绑定新工具版本的 replay 证据，旧失败收据保持。
本批没有启动这项适配，也没有启动性能矩阵。

普通用户与框架作者没有新增入口或 runtime 成本；私有 trace/console 有诊断成本，不能用作
Graph 性能成绩。沿用用户 OWN/PREDICT 的组合性、分级隐藏和 graph-owned lifecycle 目标。
实际改动仅在私有工具；diff、离线 behavior 和真实拒绝路径已验证，真实正向关联及 teach-back 未验证。
闭卷复述点：入口、三步数据路径、保护不变量、本次失败路径、测试证明和未证明的内容。
无 AI 工时、人工审阅/返工和次日检索分数未测量，不从代码量推断生产率。
