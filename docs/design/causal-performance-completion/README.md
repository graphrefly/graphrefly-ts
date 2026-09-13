# 性能诊断与验收结论

唯一 owner：graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS。用户已授权连续进行离线性能诊断、诊断工具修改和验收，不需要逐步请求“继续”。本批没有修改产品源码、公共 API、wave protocol 或验收预算；没有 provider/live/spend。

## 已经回答的问题

这里存在实际的共享执行成本，不能只用 preset/reference 比值来判断 library 是否轻量。两个 Graph 臂都出现明显的多波次调用放大；CPU 采样进一步定位到 causal evidence 的反复身份比较和 canonical JSON 工作。

| P1 重复输入，10 次动作计数均一致 | Graph 节点调用 | authority 调用 |
|---|---:|---:|
| 原 candidate/reference，单 DATA | 42 | 4 |
| 原 candidate/reference，双 DATA | 301 | 36 |
| 仅诊断 bundle 合并 selector 输出分组，candidate 双 DATA | 140 | 16 |
| 同一诊断中的未修改 reference，双 DATA | 301 | 36 |

诊断变体保留消息顺序、内容和最终 selector 状态，只在一次 callback 末尾统一发送。五组真实加载的 selector 检查通过；AST 对照确认仅 buildBusiness 改变，reference 函数未变。这证明输出分组贡献了放大成本，但尚不能证明改变波次后所有业务中间态都等价，不能直接作为产品优化交付。

四组不启用 Graph profiler 的 inspector CPU 采样全部完成。P3 双 DATA 的 14,523 个样本中，sortedJsonValue 为 6,212，stableJsonString 为 3,281，合计 **65.4%**；GC 为 249，约 **1.7%**。这是采样命中比例，包含 inspector 扰动，不是精确 CPU 时间预算。

代码归因：

- `packages/ts/src/solutions/causal-occurrence/evidence.ts:isEvidenceTerminal` 对每个 occurrence、每个 required kind 扫描 evidence/coverageGaps，并反复创建拼接数组。
- `identity.ts:sameRef` 调用两侧 refKey；refKey 对 sourceRefs 做 canonical JSON，匹配时 sameRef 又比较两侧序列化结果。
- CPU 栈的主要 JSON 路径经过 dataKey → refKey → sameRef → evidence 检查；波次放大使这些扫描反复执行。

因此下一项有依据的产品优化范围是减少终态检查中的重复扫描和身份编码工作。任何实现必须保留身份、生命周期、retained evidence 和错误行为；不能未经设计引入旁路注册表或通过退订清除义务。本批定位已经足以支撑该优化设计，无须继续无目标地追加 profile。

## 完整覆盖与实际量级

修复诊断收集器后，完整覆盖 **84 行、84 次原三臂业务预检、696 次动作观测**，包含 12 cold、60 steady、12 recovery；recovery 每个 Graph 臂 20 周期。独立 verifier 校验覆盖、逐行落盘、输入/源码散列和节点计数。

下表是 off/duplicate 的单次带 Graph profiler 观测，**不是正式 p95**：

| 场景 | candidate 单/双 DATA ms | reference 单/双 DATA ms | plain 单/双 DATA ms |
|---|---:|---:|---:|
| P1（1 evaluation） | 1.32 / 10.40 | 1.09 / 9.02 | 0.08 / 0.15 |
| P3（16 evaluations） | 48.83 / 429.94 | 49.58 / 440.97 | 3.74 / 8.17 |
| P4（64 evaluations） | 531.67 / 4929.18 | 558.52 / 5422.76 | 71.98 / 142.74 |

P2–P6 的节点调用为单 DATA 43、双 DATA 332，说明规模增长还显著增加了节点内部工作量。plain 是业务结果对照，不是拥有全部 Graph 能力的性能基线。

整次 profile 进程最大 RSS 438.48 MiB，含运行时、三臂预检、全部场景和诊断记录；不能解释为单个 Graph 的内存大小。此次没有完成 retained heap 的逐对象归因，不能宣称内存优化已通过。

## 正式验收结果

当前源码重新绑定 D169 的原计时函数、排程、AST 锁和统计方法。23 个静态负例、23 个加载案例、9 个源码 mutation、3 个真实 adapter/oracle 案例通过。

Z 阶段运行 **40 个独立进程、96,000 样本**，独立复算结果为 **method-not-qualified**：相同实现控制未满足原稳定性要求，信号区间也未通过。M 阶段 40 个进程按冻结规则未运行。另行复核全部进程身份和样本时间窗；7 个重新索引的证据篡改负例均被拒绝。

所以正式 consumer 性能验收仍未通过。此前优化的局部结果没有被抹去，但本批不能证明整体预算已满足，也不能把新的诊断变体耗时作为正式优化收益。未放宽 5% 控制要求或 1.20 等门槛，也未重试直到通过。

## 所有尝试与工具修复

1. 原工作量 coverage v1：16 个 job 完成，第 17 个在 P5 预检超过 256 MiB 收集上限，尚无该进程计时样本。
2. coverage v2：重新冻结全部排程，采用既有完整矩阵时间上限和 2 GiB 操作上限；57 个 job 完成、205,200 个完成 job 样本。第 58 个运行期间因实际成本过高，主动结束这次扫测；失败和未运行部分原样保留。不能称为完整计时矩阵。
3. 全覆盖 profile v1：900 秒超时，只有进度记录，无完整结果；未将进度冒充已验证行。
4. profile v2：每行即时落盘、每行一次动作观测，1800 秒上限；531 秒完成全 84 行。
5. 当前 D169 v1 只准备资格检查；补齐独立 verifier 后 v2 重新绑定。两者 bundle/driver/tests 相同，显式核对后复用加载资格证据。
6. 最后四组 CPU 采样固定排程、串行执行，每组 60 秒/总计 240 秒上限，全部成功。CPU 的临时外层运行器未在执行前冻结；保留实际 argv/exit/耗时，独立审计仅承诺结构、输入散列和采样归因，不把该运行器记录提升为正式验收收据。

证据归档：`archive/evals/causal-performance-completion-v1/evidence.tar.gz`。保留九个原始证据目录及所有失败尝试；外层 artifact-index 校验每个文件。解包复核在仓库内进行，需要固定 Node v24.18.0 和仓库 TypeScript 依赖，未宣称脱离环境即可复现。

工具检查包括加载/清理负例、当前 D169 独立复算与篡改检查、selector 分组对照、84 行 profile 审计、CPU 审计和归档解包复核。本批仅修改诊断工具和记录，不重跑产品全量测试，也不声称历史全量测试/全量 lint 已全绿。主 work 保持未完成；H/L 设计和产品性能优化不在本批伪装为已实现。
