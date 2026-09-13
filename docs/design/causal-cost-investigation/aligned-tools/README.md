# 时间归因采集工具已准备，真实采集未执行

2026-09-12 · 唯一owner `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。
用户在457137bd后“继续”授权私有采集工具准备与替身资格；本轮没有真实consumer、profile或GC探针。
`qualification.json`是工具资格，不是采集授权。原时钟probe通过记录和旧失败均保持不变。

## 已完成什么

从上次冻结reference/reference-copy及P2输入派生CONTROL/GC/GC_CPU三份driver。
60个当前输入源码哈希匹配；独立逆向白名单恢复原CPU driver，构造循环字节与已有证明一致。
逐条EAGER记录、构造前yield/memory、计时、构造后memory、记录、cleanup顺序不变。
观测在consumer模块导入前安装，首尾短hrtime锚点在三条件均有；不新增构造窗口内调用。

新增私有observer负责安装、profile、GC收尾与错误并存；公开library未改变。CONTROL也保留
固定两次收尾让出。发生启动、导入、业务、停止或写入失败时，能保存的时间线与profile前缀
仍走公共错误保存路径，失败不会写completion。事件安装失败会断开已经创建的observer。

独立子进程verifier使用已资格的精确区间公式，但不再要求已知函数，也不沿用probe偏移。
每个实际CPU进程都必须自身I≤0.1ms；否则停后续。输出包括：

- 每个构造窗口的确定/模糊样本数和GC并集交集，零命中窗口保留。
- 每个measured block固定最慢15/300与其余285窗口，两组都保留self、inclusive和模糊self计数。
- 原始timeDeltas、间隔分布、>250µs与>1ms间隔计数。它们是采样间隔，不是函数耗时。
- 栈父链、URL/scriptId/line/column，以及runtime/idle/harness/unknown分类。
  worker bundle中的library与consumer目前不可从已验证映射分开，明确标为未解析；不伪造graph节点身份。
- 同round/orientation/batch/arm的GC/CONTROL、GC_CPU/GC、GC_CPU/CONTROL时长及process CPU比值。
  inclusive不能与self相加，CPU与GC不能拼成100%耗时图，空白与native等待保持unknown。

GC并集索引复用，inclusive计数从叶向根一次传播，避免合法大输入导致二次复杂度。
独立验证进程也由现有监督器限制时间、RSS和目录，不能在parent内无限计算。

## 可复核的准备证据

| 检查 | 结果 |
|---|---|
| 加载真实派生driver，注入假工厂/时钟 | 12坐标、28800假构造，顺序/清理/计时边界一致 |
| 独立源码逆向白名单负例 | 12种篡改拒绝 |
| 观测器模拟生命周期 | 31案例：安装、启停、导入、写入、重复finish；没有真实Session/GC |
| 独立Python资格 | 5测试方法，包括6条件/方向组合、10错误输入、模糊/窗口外样本、2000层树 |
| 失败停止 | 在12个坐标分别注入失败，余下坐标停止 |
| 整包合成capture/replay | 12假consumer＋12假verifier，28800合成窗口、72组对比；单次claim拒绝复用 |
| 缺失证据负例 | 删除dispatch、verifier dispatch、claim、analysis或final boundary均拒绝 |
| 冻结verifier实际Python进程 | 仅读取2400合成窗口；-B不产生缓存，冻结文件清单不变 |
| 新目录归档复核 | 116文件哈希一致；Python整包测试与31观测器案例通过 |

检查详情见checks.json、frozen-verifier-smoke.json、archive-replay.json。prepared.tar.gz约516KB，
artifact-index.json列所有冻结文件；本地prepared解压目录忽略跟踪。46份私有工具被资格哈希绑定。
qualified archive不会被自动执行，里面的consumer bundle在本轮只读取/复制，未import。

```sh
python3 -B scripts/causal-aligned-tools.test.py
node scripts/causal-aligned-observation.test.mjs
node scripts/causal-aligned-driver.test.mjs archive/evals/causal-recording-tools-v1/prepared/frozen-driver-source.mjs
```

独立审查修正了：启动失败丢前缀、observer分配失败清理、验证计算未受资源监督、整包证据
关联缺口、末锚点未校验最终checkpoint、模糊栈/CPU比值遗漏，以及Python缓存污染冻结清单。
生产源码未变，因此本轮不重跑完整TS suite；使用受影响工具检查及治理gate。

## 下一次真实采集：待单独授权

范围保持[时间归因设计](../aligned-runtime-design.md)与[锚点替代](../clock-anchor-design/README.md)：

- **2轮×3条件×2方向＝12个串行新Node consumer进程**，随机次序一次固定，失败不替换。
- **28800样本**：7200warmup、21600measured，72measured blocks；24次三臂预检调用/72计时外实例。
- 每个Node成功退出后，至多一个**串行Python独立验证进程**，合计最多12个；它们不构造consumer。
- Node和Python各≤30秒；整次含准备复制、验证、写出≤900秒；观测RSS/目录≤256MiB，>1秒观测gap停。
- CPU仅4个GC_CPU进程，250µs请求间隔；每profile≤32MiB、200k样本、100k节点，GC<100k事件。
- 固定Node、Python二进制与显式环境、116文件清单、场景、工具哈希；每个CPU自身≤0.1ms。
- 实际consumer禁止强制GC，无网络inspector、provider/live/spend或额外重试。

收到这次具体授权后才写一次性approval artifact并调用 `scripts/capture-causal-aligned.py --capture`。
当前没有该approval或claim。成功后须用`python3 -B scripts/verify-causal-aligned-run.py <capture-dir>`
离线重算全包；复核支持重新解压，但路径字段作为历史来源保留。数据哈希不能证明机器上没有
未记录的进程，资源观测不是连续峰值证明。

本批不能宣称第二个library热点、构造稳定性或D169正式通过。若有效采集仍不足以归因，则按
原设计结束为unknown，不加轮次、不修改阈值、不恢复DEFERRED方向。
