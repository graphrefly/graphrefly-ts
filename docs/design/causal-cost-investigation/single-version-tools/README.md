# Single-version measurement tooling — qualified

用户在 `3d59cd0f` 设计后确认，本批完成私有工具实现和假样本资格。
唯一 owner：graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS；属于执行准备/证据，不新增D#。
真实consumer执行数与新真实性能样本数为 **0**。初始化收益、D169与原work仍未完成。

## 工具行为

采用 [已确认设计](../dependency-measurement-design/README.md)：32串行新进程、8个对称
BCCB/CBBC组；每进程只导入固定绝对路径下一个bundle，20warmup+100measured。
3840生命周期样本与224个不计时预检实例。70种平衡排程抽取一次后已冻结，禁止重新抽取。

复用原sample函数完整字节；真实P2输入、B8253488b/C9c30967c源码闭包及bundle来自
已经hash验证的准备归档，不重新修改或执行consumer。源码Git对象证明和loaded变换检查保留。
新child去掉第二module/slot；Slot仅在前一个子进程结束后替换执行投影，每次保留bundle
字节与前后散列。entry绑定批准的源码/输入散列，不能临时重设基线。
Node绝对路径、版本与可执行文件散列由collector内部绑定冻结资产。

独立Python verifier只读取证据，分别重算p50/p95、同版本晚/早控制和四进程组比值。
中心下降与慢尾上升/未知可同时出现；任何结果不能替代正式D169预算或分级隐藏验收。
原对比的inconclusive和旧失败证据保持原样。

## 资格结果

- 实际collector接假进程/假时钟：32进程、3840样本完整完成。
- 23种证据损坏被拒绝，覆盖错误版本、第二模块、槽位路径/散列/未回收、PID、Node、
  预检、样本坐标、时钟、occurrence、snapshot、release、RSS、终态与重试。
- 14类执行失败保留可回放证据；包括初始化、spawn、中断、清理竞态、RSS、wake、
  Node变化、源码变化和槽位变化。最后一次wake/源码变化在子进程启动前被拒绝。
- 4类时钟拒绝、70种排程平衡、错误/重复/复制授权、活跃槽位拒绝覆盖。
- 真实Node运行假模块：一次import，121次假构造/释放，120条假测量记录，第二模块被拒绝。
  这不是library consumer或真实性能样本；准备另有Node元数据探针。
- 独立只读复查推动修复两处分派前漂移缺口并确认修复，详见[review](checks/review.md)。
- 194文件归档逐项hash检查，新解压目录重跑合成collector/独立verifier后，输出逐字一致。
  [回放收据](checks/archive-replay.json)、[日志](checks/)与
  [归档索引](../../../../archive/evals/causal-single-version-preparation-v1/artifact-index.json)保留。

冻结manifest包含176资产，SHA256：
`cc76132404e850809a0a1a36f5b587efd79cab20f2b2daafb96518d0a2f72541`。
实际approval、capture claim、reservation、run-slot与jobs均未创建。
`approval.example.json`含exampleOnly，不能启动采集。

## 复核与下一次执行边界

先按artifact-index检查归档和成员散列，安全解压到新目录，执行
`python3 -B test_pipeline.py`，输出应与`checks/pipeline.log`逐字一致。
该流程只使用假进程，不运行collector CLI或真实consumer。
`prepare.py`拒绝重复准备，`freeze.py`拒绝覆盖freeze；不自动改动随机顺序或历史证据。

待单独批准的真实采集上限：32串行Node consumer，3840样本；900秒全轮、30秒/进程、
256MiB观察RSS。目标100ms轮询、wake/双时钟/观察间隔检查保持既定限制；休眠期间
父进程无法即时强制，恢复后停止。错误立即停止剩余项，零重试，不延长或补样本。

批准后使用冻结`prepared/tools/collect.py --approval <approval.json>`，严格绑定规范路径、
manifest、数量与一次性claim。资格通过没有授权这次运行。本批没有library/API/wave更改，
生产测试结果沿用原未变代码证据，不宣称全库离线门槛重新通过。
