# Causal consumer 成本诊断总表

更新：2026-09-12。唯一 owner：`graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。
本表是当前调查进度与证据索引；历史收据保留各自时点的结论，不改写。
用户要求完整诊断、防止重复和遗漏；暂不要求 library 提供公共 profiler。

## 当前结论

- **已得到的优化收益：** `f7ea7a52` 的私有 currentness 比较优化保留。指定 P2 场景的
  action-sum p95 下降20.8–27.8%，该指标匹配控制稳定；不是所有场景或正式 D169 资格。
- **尚未解决：** cold 构造的稳定性及有效 preset/reference 方法资格。优化前后比较、
  相同 reference 的方法控制和记录方式实验是不同问题，不能互相替代。
- **已结束的方向：** EAGER/DEFERRED 记录实验结果 mixed，未达到预先约定的一致改善规则。
  不追加轮次、不采用延后记录、不宣称 library 回归或全局变慢。
- **本轮完成：** [soak超时核对](soak-timeout-audit/README.md)：历史运行期间有明确合盖休眠与
  DarkWake记录；受限子进程运行冻结fixture，不是当前初始化性能测试。原deadline下仅重验
  两个失败用例，2通过/219跳过，56.4秒，期间无电源转换记录。解除这两个超时的准备阻塞，
  不改写旧整轮失败；候选仍未测量，既有lint/冻结manifest问题单列。

[替代设计](clock-anchor-design/README.md)已经落实为私有准备探针，不改registry C或library公开层级。

所有此前真实 capture 授权均已消费。当前继续覆盖只读分析、总表更新和下一项准备；
不授权新采样、provider/live/spend、公共 API、wave protocol 或新的语义锁。

## 进度与不可混淆的证据

| 状态 / 问题 | 证据 | 已知结果与限制 |
|---|---|---|
| 完成：早期 release B/C 构建与预检 | `causal-release-comparison-build-v2` / `causal-release-preflight-v1` 相邻目录 | 62输入/侧，33预检实例；不是完整性能比较 |
| 停止：早期 release 成本比较 | `causal-release-cost-comparison-v2` | B/B-copy先触发RSS；329原始样本，C未采样，无C/B比例结论 |
| 完成：旧版存活堆与分配诊断 | `causal-release-memory-v1` / `causal-release-allocation-v1` | 400次GC后约9.35–9.55MiB；旧版100次分配集中于输入/重复输入；不能据此证明当前无泄漏或精确RSS归属 |
| 完成：比较证明、有限计数与候选排序 | [comparison-proof](comparison-proof/review.md)、[candidate-review](candidate-review/README.md)、[implementation-preparation](implementation-preparation/README.md) | 首批限定currentness；sameRef、quiescence、publication等仍暂缓，旧分配比例不冒充优化后的剩余热点 |
| 完成：首批library实现与语义验证 | [implementation](implementation/README.md)，`f7ea7a52` | 单个内部比较点，无缓存/新注册表/公共入口；差分、transition与runtime mutation证据分开，既有gate失败单列 |
| 完成：同preset优化前后对比 | [performance-comparison](performance-comparison/README.md)，`af22eec7` | 48子进程/6720样本；action-sum与lifecycle span一致下降；构造等分项控制不稳定。保留验证器修正和暂停续跑限制 |
| 完成：剩余份额与源码就绪核对 | [followup-audit](followup-audit/README.md)、[source-readiness](source-readiness/README.md) | 构造占动作总和约5.90–6.43%；份额升高不证明变慢。60当前输入闭包匹配，candidate/reference共享优化，收益不能推出二者比例 |
| 未通过：D169 cold方法资格 | 相邻 `causal-cold-position-pairs-v3-implementation` / `causal-position-pairs-retained-audit-v1` | 相同reference控制不稳定；M灵敏度面板未运行。不得删除早期样本、改门槛或直接重跑正式矩阵 |
| 完成：固定工作量CPU/GC诊断 | [diagnostic-capture](diagnostic-capture/README.md)，`1c74c254` | 24进程/57600样本；早期进程CPU更多，不能归到构造独占成本；GC是观测子集，结果mixed/unknown |
| 完成并结束方向：记录路径干预 | [recording-capture](recording-capture/README.md)，`4ca15c37` | 16进程/38400样本，首批p95仅10/16配对下降，规则未过；whole耗时配对中位数约-6.3%但方向混合，延后flush成本已包含 |
| 完成：保留日志审计 | [retained-runtime-audit](retained-runtime-audit/README.md) | 慢块所在进程GC主耗时日志累计80.98ms，其他51.27–67.82ms；无独有deopt位置。整进程线索不能当作窗口因果归因 |

| 已停止：时间对齐准备 | [aligned-clock-preparation](aligned-clock-preparation/README.md) | 1个CPU探针，422样本；0.903669ms>0.1ms，余下3探针未运行；真实consumer零，不是library性能失败 |

| 完成：hrtime替代时钟资格 | [anchor-clock-preparation](anchor-clock-preparation/README.md) | 3CPU＋1GC，1769CPU样本，1579已知确定/2模糊/0误归属；31冻结输入归档回放，真实consumer零 |

| 完成：时间归因采集工具准备 | [aligned-tools](aligned-tools/README.md) | 12坐标28800假构造、31生命周期案例、116文件归档回放；真实consumer/profile零，实际采集待单独授权 |

| 完成：时间归因真实采集 | [aligned-capture](aligned-capture/README.md) | 12Node＋12verifier、28800样本；约0.05ms对齐；重复依赖记账源码候选，慢尾根因unknown；403文件重算一致 |

旧版累计分配约2.24GB/100次包含已回收对象，不等于RSS。约206–242MiB的近期RSS是
整个Node评测进程（模块、保留样本等），不能归给一个graph。当前没有单graph增量内存
或优化降低RSS的结论。用户若优先问这一指标，须独立设计同运行时空基线与存活图数量对照。

## 下一项的完成条件

[单循环初始化候选](dependency-initialization-implementation/README.md)与193文件验证归档保留。
[soak超时核对](soak-timeout-audit/README.md)已完成，原deadline两项重验通过。下一步准备
已提出的有限、无profiler对比工具，并把主机休眠识别/停止纳入准备审查；不重跑整套soak，
不把历史fixture子进程超时认作当前library性能回归，不自动启动新性能采集。

[保留日志审计](retained-runtime-audit/README.md#next-investigation-boundary)给出具体证据要求。
进入新capture前，设计必须能把构造窗口、GC与CPU采样放到有误差界的时间轴，并通过
测试替身核实；采样栈按模块/源码归属，native/idle/丢失部分明确未知。比较插桩扰动，
预先固定有限预算与停止条件。不能以“有profile文件”替代可解释的归因。

当前没有被证明的单一构造热点；已批准的单函数候选仍未测量，不能扩至其他函数或重做registry/C；不能用
elapsed减process CPU推算等待。无法定位时明确收敛到unknown，不再重复同类采样。

最终分级公开入口、qualified inbox、human/agent理解证据和正式性能资格仍未完成。
已有private view/type/完整graph能力证据见followup-audit；不能因为接口隐藏而声称
完整runtime或graph-owned lifecycle成本消失。

## 防重复与语义边界

每项行动先写清要区分的假设、现有证据缺口、source/input/runtime绑定和上限。
同一问题已有充分数据时只回放。已消费授权、失败或早期样本不可替换；工具修正和暂停
不得藏入“原计划完整通过”。本表与原work保持同步，不因脚本、一次失败或继续新增D#/work。

任何后续优化仍须保持identity、graph-owned lifecycle和retained evidence的独立职责；
退订与错误outcome不结算active obligation；原独立oracle、plain/reference、负对照与
真实runtime mutations不可省略。未证明immutable provenance就不按指针复用，不能用
自报digest绕过独立验证。具体library改动与新测量分别沿已约定的审阅和授权边界推进。
